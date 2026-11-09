// cost-ledger: Kostenbuch über alle Chats. Reiner Beobachter: bucht nach jedem Turn die Differenz von `usage().cost.usd`,
// dazu die Modellaufrufe anderer Mods, und zeigt per /ledger eine Übersicht (Sprache aus userConfig `language`).
// Fail-open: Jeder Erfassungs-Hook gibt das Ergebnis von `next` unverändert zurück, Fehler gehen nur ins Debug-Log; kein `.catch`.
// Ein $.store-Schlüssel pro Session (`s:<sessionId>`), den nur diese Session schreibt: $.store ist nicht atomar (CHEATSHEET).
import type { ConfigRow, EngineInterface, FsEntry, On } from 'claude-code'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { T, dateTime, shortDate, usd } from './i18n.ts'
import { isLanguage, languageCommand } from './language.ts'
import { migrateSettings, readSettings, writeNote, writeSettings } from './settings.ts'
import type { Values } from './settings.ts'
import { SETTINGS } from './fields.ts'
import {
  HELP_WORDS,
  HERE_WORDS,
  NAME_WORD,
  NO_FOLDER,
  NO_SYNC,
  notesOf,
  OFF_WORDS,
  LEGACY_LABELS,
  LEGACY_PLANS,
  PLANS,
  currentPlan,
  SYNC_WORD,
  VIEW_WORDS,
  ledgerHelp,
  aggregate,
  baselineFor,
  bookChat,
  bookLim,
  bookLimAt,
  bookMod,
  bookModel,
  bookRate,
  bookTurn,
  cleanPlan,
  cleanRemote,
  callCost,
  cleanRec,
  cleanSettings,
  dayKey,
  DAY,
  deltaOf,
  folderOf,
  limitsOf,
  newRec,
  parsePlan,
  parseRange,
  planLabel,
  planMonth,
  pluginName,
  projectOf,
  summaryText,
  titleFromPrompt,
  tokensOf,
} from './logic.ts'
import type { Carry, HelpInfo, Kind, Limit, Plan, Rec, Settings, SyncInfo, TurnInfo, Usage } from './logic.ts'
import { FILE_LIMIT, buildFile, cleanDevice, cleanDeviceName, cleanSync, fileName, idFromName, inDir, mergeRecs, newDeviceId, parseFile, safeProj, usersIn, utf8Bytes, validDir } from './sync.ts'
import type { Device, SyncFile } from './sync.ts'
import { hereLine, hereOf, hereState, hereText, hereTree } from './here.ts'
import type { Here, HereState } from './here.ts'
import { ledgerTree } from './view.ts'
import type { View } from './view.ts'

const SELF = 'cost-ledger'

let settings: Settings = cleanSettings(undefined)
// Einstellungen (0.11.0, docs/SETTINGS-SPEC.md §4): Abo, Sync-Ordner und Gerätename liegen in userConfig (`options`), nicht mehr in
// `meta:plan`, `meta:sync` und `meta:device.name`. Befehle schreiben über hooks/settings.ts. Die Geräte-ID bleibt im Store.
let ucfg: Values = readSettings(SETTINGS, undefined)

/** Abo aus userConfig; `none` = kein Abo, ein alter Name gilt als neuer (0.12.0). Einen Zeitpunkt gibt es dort nicht (`at` 0). */
function cfgPlan(): Plan | null {
  const plan = currentPlan(String(ucfg.plan ?? 'none'))
  if (plan === 'none' || !Object.prototype.hasOwnProperty.call(PLANS, plan)) return null
  const day = Number(ucfg.billingDay)
  const price = Number(ucfg.planPrice)
  return { v: 1, plan, day: Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1, ...(price > 0 ? { price } : {}), at: 0 }
}

/** Gerätename aus userConfig, leer → Standard aus der ID. */
const deviceName = (id: string) => cleanDeviceName(String(ucfg.deviceName ?? ''), id, deviceDefault)
/** Sync-Ordner, wie er in userConfig steht (leer = aus); geprüft wird in `syncConfig`. */
const syncRaw = () => String(ucfg.syncFolder ?? '').trim()
let sessionId = '' // aus classic.SessionStart (kommt vor session.start), nach einem Modul-Reload aus UserPromptSubmit
let rec: Rec | null = null // eigener Datensatz, im Speicher führend; geschrieben wird er immer ganz
let seen = 0 // Baseline: letzter gebuchter Stand des Zählers in diesem Prozess
let rebase = false // Sessionwechsel mitten im Prozess (Resume, Branch): Baseline beim nächsten Messen neu setzen
let started = false
let hasCost = true
let lastModel = '' // Modell der Hauptschleife, für model.fork
let title = ''
let titleDirty = false
let titleFromSession = false // Titel kam als session_title (gewinnt immer) statt aus der ersten Nachricht
const meta: { project: string; root: string; kind: Kind; remote: string } = { project: NO_FOLDER, root: '', kind: 'terminal', remote: '' }
// Kennung im Text → Daten der Zeichnung, höchstens 10: eine Ansicht von /ledger oder die Hilfe, dazu die Argumente des
// Aufrufs. Der Render-Hook zeichnet nur, wenn die Zeile dieselben Argumente hat: `/ledger #<kennung>` gibt „Unbekannt: …“
// mit der Kennung in der ersten Zeile zurück und darf trotzdem nicht als Tabelle erscheinen (Review worklist 0.7.0, K2).
type Drawn = ({ kind: 'ledger'; view: View } | { kind: 'help'; data: HelpData } | { kind: 'here'; here: Here }) & { args: string }
const reports = new Map<string, Drawn>()
let reportNo = 0
// Akzent der Hilfe als Theme-Key: passt sich hell und dunkel an (docs/HELP-SPEC.md §4, Fynn 2026-10-09)
const ACCENT = 'success'

/** Argumente vergleichbar machen: ohne Rand, klein, einfache Leerzeichen. */
const normArgs = (s: string | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Neue, eindeutige Kennung `#…` für die erste Textzeile; ui.render findet darüber die Daten der Zeichnung. */
function remember(now: number, d: Drawn): string {
  const tag = `#${(++reportNo).toString(36)}${now.toString(36).slice(-5)}`
  reports.set(tag, d)
  while (reports.size > 10) reports.delete(reports.keys().next().value as string)
  return tag
}
let chain: Promise<unknown> = Promise.resolve() // Messen und Schreiben dieser Session nacheinander
let writeError = '' // letzter Schreibfehler (z. B. Speicher voll), /ledger zeigt ihn
// Limit-Fenster der letzten Messung: Mod-Aufrufe buchen hierhin, ohne eigenes usage() (SPEC Nachtrag 0.5.0, Verhalten 2)
let limits: Limit[] = []
let carry: Carry = {} // Beträge, die auf das nächste gültige Fenster warten
let carryAt = 0 // seit wann `carry` Beträge hält; ein späterer Reset (auch aus einem anderen Chat) verwirft sie
let limSinceChecked = false // `meta:limSince` in diesem Prozess schon geprüft
let pendingGap = 0 // Nachbuchung beim Start (Resume): gehört ins Fenster der letzten Buchung, nicht ins laufende
let gapAt: number | undefined // Zeitpunkt der letzten Buchung beim Start; spätere Mod-Aufrufe verschieben ihn nicht
// Geräte-Sync (SPEC Nachtrag 0.7.0): letzter guter Stand je fremdem Gerät, falls dessen Datei gerade halb geschrieben ist
const peerCache = new Map<string, SyncFile>()
const SYNC_EVERY = 15 * 60 * 1000 // nach Turns höchstens so oft schreiben (Verhalten 1)
const CONFLICT_SLACK = 60 * 1000 // doppelte Geräte-ID erst ab einer Minute Vorsprung der Datei (Review S1)
let nextSyncCheck = 0 // vorher fragt syncAfterTurn den Store nicht
type SyncCfg = { dir: string; device: Device }

/** `carryAt` nach einer Fenster-Buchung nachführen. */
function noteCarry(now: number) {
  if (!Object.keys(carry).length) carryAt = 0
  else if (!carryAt) carryAt = now
}

/** `fn` nach allem, was schon in der Kette steht; ein Fehler bricht die Kette nicht. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn)
  chain = p.catch(() => undefined)
  return p
}

const msg = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 200)

function log($: EngineInterface, text: string) {
  try {
    $.ui.log(`cost-ledger: ${text}`, { to: 'debug' })
  } catch {
    // Debug-Log ist Beiwerk
  }
}

/** Desktop, Terminal oder Skript-Lauf (`-p`: keine Surface, API-DETAILS.md:303-304). */
function kindOf(surfaces: readonly string[]): Kind {
  if (surfaces.includes('desktop')) return 'desktop'
  return surfaces.length ? 'terminal' : 'script'
}

async function load($: EngineInterface, id: string): Promise<Rec | null> {
  return cleanRec(await $.store.get(`s:${id}`))
}

async function save($: EngineInterface) {
  if (!rec || !sessionId) return
  try {
    await $.store.set(`s:${sessionId}`, rec)
    writeError = ''
  } catch (err) {
    writeError = msg(err)
    throw err
  }
}

/**
 * Hat eine andere Session `/ledger reset` ausgeführt, seit dieser Datensatz zuletzt gebucht wurde, beginnt er leer;
 * sonst schriebe dieser Chat die gelöschten Beträge zurück ($.store ist geteilt, interface.md:821-826).
 */
async function honorReset($: EngineInterface) {
  const held = Object.keys(carry).length > 0
  if (!rec && !held) return
  const at = await $.store.get('meta:resetAt')
  if (typeof at !== 'number') return
  // Wartende Fenster-Beträge von vor dem Reset, auch ohne Datensatz (z. B. nach /clear in eine neue Session)
  if (held && carryAt < at) {
    carry = {}
    carryAt = 0
  }
  if (rec && rec.lastAt < at) {
    rec.days = {}
    rec.mods = {}
    rec.models = {}
    rec.modModels = {}
    rec.act = {}
    rec.hours = {}
    rec.rl = {}
    rec.lim = {}
  }
}

/**
 * An eine Session binden. Mitten im Prozess (`started`): bei /clear beginnt der Zähler bei 0 (types:11148-11151), sonst
 * (Resume, Branch, Reload) wird die Baseline beim nächsten Messen aus dem Datensatz gesetzt.
 */
async function bind($: EngineInterface, id: string, source: string | undefined, newTitle: string | undefined) {
  switchOthers(sessionId, rec, id) // der bisherige Chat zählt ab jetzt zu den anderen des Projekts
  publishedHere = undefined // $.state gilt nur bis /clear, /resume, /branch (interface.md:760): neu schreiben
  sessionId = id
  rec = await load($, id)
  pendingGap = 0 // gehört zur bisherigen Session
  gapAt = undefined
  title = newTitle || rec?.title || ''
  titleDirty = !!newTitle && newTitle !== rec?.title
  titleFromSession = !!newTitle
  if (!started) return
  if (source === 'clear') seen = (await $.session.usage()).cost?.usd ?? 0
  else rebase = true
}

/**
 * Messpunkt (SPEC Verhalten 4): Zähler lesen, Differenz auf heute buchen, dazu Tokens, Aktivität und Limits des Turns.
 * `final`: am Session-Ende nur das Nötigste (Budget 1,5 s, CHEATSHEET Limits).
 */
async function measure($: EngineInterface, final = false, usage?: Usage & { model?: string }, turn?: TurnInfo): Promise<void> {
  // Ein Aufruf ohne `breakdown` (kostenlos): Kosten, dazu vorsorglich Kontext-Füllung und Limit-Stände
  const u = await $.session.usage()
  const cost = u.cost?.usd
  const counted = typeof cost === 'number' && Number.isFinite(cost)
  hasCost = counted // Host ohne Kostenbuch: keine Chat-Buchung, /ledger nennt den Grund; Tokens je Modell trotzdem
  // Fenster der letzten API-Antwort (types:11386-11390); leer ohne Abo oder vor der ersten Antwort des Prozesses
  limits = limitsOf(u.rateLimits)
  if (!sessionId) return
  let delta = 0
  if (counted) {
    if (rebase) {
      rebase = false
      seen = baselineFor(rec, cost)
    }
    const d = deltaOf(seen, cost)
    seen = d.seen
    delta = d.delta
  }
  const hasUsage = tokensOf(usage) > 0
  if (!(delta > 0) && !(titleDirty && rec) && !hasUsage && !turn) return
  const now = await $.clock.now()
  if (!final && meta.kind === 'script') meta.kind = kindOf(await $.session.surfaces()) // Desktop meldet sich evtl. erst später
  await honorReset($)
  const r = rec ?? newRec({ ...meta, title }, now, 0)
  if (r.kind === 'script' && meta.kind !== 'script') r.kind = meta.kind
  if (titleDirty) r.title = title
  if (counted) bookChat(r, dayKey(now), delta, now, cost)
  if (hasUsage) bookModel(r, usage?.model ?? '', dayKey(now), usage, now)
  if (turn) bookTurn(r, dayKey(now), turn, delta, u.context?.percent)
  let windowed = false
  if (turn || delta > 0) {
    bookRate(r, dayKey(now), u.rateLimits)
    // Der Rest, der beim Start schon auf dem Zähler stand, fiel vor diesem Prozess an: ins Fenster der letzten Buchung
    const gap = Math.min(pendingGap, delta)
    pendingGap = 0
    windowed = bookLim(r, limits, now, 'chat', delta - gap, carry)
    if (gap > 0 && gapAt !== undefined) bookLimAt(r, gapAt, gap)
    gapAt = undefined
    noteCarry(now)
  }
  rec = r
  titleDirty = false
  await save($)
  // Beginn der Fenster-Daten für „unvollständig“; einmal je Prozess, nicht im knappen Budget von session.end
  if (windowed && !final && !limSinceChecked) {
    limSinceChecked = true
    if ((await $.store.get('meta:limSince')) === undefined) await $.store.set('meta:limSince', now)
  }
}

/**
 * Modellaufruf eines anderen Mods buchen (SPEC Verhalten 5). `usage` steht auf jedem Zweig des Ergebnisses (types ModelCompleteResult).
 * `single`: `usage` ist genau eine Anfrage (nur `model.complete`), dann gilt eine Preisstufe nach Prompt-Länge (Haiku 5.5).
 */
async function bookCall($: EngineInterface, origin: string | undefined, model: string, usage: unknown, countOnly: boolean, single = false) {
  const name = pluginName(origin ?? '')
  if (!name || name === 'engine' || name === SELF || !sessionId) return
  const now = await $.clock.now()
  const amount = countOnly ? 0 : callCost(usage as Parameters<typeof callCost>[0], model, single)
  await honorReset($)
  rec ??= newRec({ ...meta, title }, now, seen)
  bookMod(rec, name, dayKey(now), amount, now, countOnly ? undefined : (usage as Usage | undefined))
  if (!countOnly) {
    bookModel(rec, model, dayKey(now), usage as Usage | undefined, now, 'modModels', single)
    // Fenster aus der letzten Messung, kein eigenes usage(): Mod-Aufrufe sollen nicht warten (Verhalten 5)
    bookLim(rec, limits, now, 'mod', amount, carry)
    noteCarry(now)
  }
  await save($)
}

/**
 * Alle Datensätze lesen; dabei alte löschen (älter als `keepDays` seit der letzten Buchung). Das Aufräumen liegt hier und
 * nicht im awaiteten session.start, weil `/ledger` ohnehin jeden Datensatz liest. `bytes` schätzt die Größe des Speichers
 * (4 MiB JSON insgesamt, docs/raw/en/reference.md:294).
 */
async function collect($: EngineInterface, now: number) {
  const recs: { id: string; rec: Rec }[] = []
  let unreadable = 0
  let bytes = 0
  const plan: Plan | null = cfgPlan()
  let limSince: number | null = null
  const cutoff = now - settings.keepDays * DAY
  await honorReset($) // Reset aus einem anderen Chat auch ohne neue Buchung beachten
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    bytes += key.length + (JSON.stringify(value ?? null)?.length ?? 0)
    if (key === 'meta:limSince' && typeof value === 'number') limSince = value
    if (!key.startsWith('s:')) continue
    const id = key.slice(2)
    // Eigener Datensatz aus dem Speicher: der ist mindestens so frisch wie der gespeicherte
    const r = id === sessionId && rec ? rec : cleanRec(value)
    if (!r) unreadable++
    else if (id !== sessionId && r.lastAt < cutoff) await $.store.delete(key)
    else recs.push({ id, rec: r })
  }
  const hasData = (r: Rec) => [r.days, r.mods, r.models, r.modModels, r.act, r.lim].some((x) => Object.keys(x).length > 0)
  if (rec && sessionId && hasData(rec) && !recs.some((x) => x.id === sessionId)) recs.push({ id: sessionId, rec })
  const since = await $.store.get('meta:since')
  return { recs, unreadable, bytes, since: typeof since === 'number' ? since : null, plan, limSince }
}

/**
 * `/ledger help` (docs/HELP-SPEC.md §3): Schnappschuss mit Plan, Speicherbelegung und Beginn der Erfassung, nur lesend
 * (kein Aufräumen, kein Buchen). Scheitert das Lesen, zeigt die Hilfe trotzdem Befehle und Einstellungen.
 */
async function helpCommand($: EngineInterface, args: string): Promise<string> {
  const now = await $.clock.now()
  const info: HelpInfo = {
    plan: cfgPlan(),
    storeBytes: 0,
    since: null,
    syncDevice: null,
    config: { billingDay: Number(ucfg.billingDay), planPrice: Number(ucfg.planPrice), syncFolder: false, deviceName: String(ucfg.deviceName ?? '') },
  }
  try {
    const on = syncRaw() !== '' && validDir(syncRaw(), /^[A-Za-z]:/.test(await $.session.root())) !== null
    info.config!.syncFolder = on
    let device: Device | null = null
    for (const key of await $.store.keys()) {
      const value = await $.store.get(key)
      info.storeBytes += key.length + (JSON.stringify(value ?? null)?.length ?? 0)
      if (key === 'meta:since' && typeof value === 'number') info.since = value
      if (key === 'meta:device') device = cleanDevice(value, deviceDefault)
    }
    info.syncDevice = on ? (device ? deviceName(device.id) : String(ucfg.deviceName ?? '') || T[settings.lang].helpDeviceAuto) : null
  } catch (err) {
    log($, `/ledger help: ${msg(err)}`)
  }
  const data = ledgerHelp(settings, info)
  return helpMarkdown(data, remember(now, { kind: 'help', data, args: normArgs(args) }))
}

/**
 * `/ledger plan …`: Abo und Abrechnungstag in `meta:plan` (SPEC Nachtrag 0.5.0, Bedienung). Den Plan kann ein Mod nicht
 * abfragen (kein Feld in der Mods-API, Login-Daten sind tabu: CLAUDE.md Grundregel 3), deshalb stellt der Nutzer ihn ein.
 */
async function planCommand($: EngineInterface, args: string[]): Promise<string> {
  const t = T[settings.lang]
  const lang = settings.lang
  const now = await $.clock.now()
  const price = (p: Plan) => {
    const v = p.price ?? PLANS[p.plan]?.price
    return v === undefined ? t.noPrice : `${t.perMonth(usd(v, lang))}${p.price === undefined ? ` (${t.listPrice})` : ''}`
  }
  const first = (args[0] ?? '').toLowerCase()
  if (!first) {
    const p = cfgPlan()
    return `${p ? t.planCurrent(planLabel(p.plan), p.day, price(p)) : t.planNone}\n${t.planHelp}`
  }
  // Schreibt die Felder in userConfig (SETTINGS-SPEC §4). Weg 1 lädt die Mod neu, Weg 2 zieht die Werte hier nach.
  if (OFF_WORDS.includes(first)) {
    const r = await writeSettings($, SELF, SETTINGS, { plan: 'none' }, lang)
    if (r.ok && r.way === 'cli') ucfg = { ...ucfg, plan: 'none' }
    return r.ok ? `${t.planDeleted}\n\n${writeNote(r, lang)}` : writeNote(r, lang)
  }
  const p = parsePlan(args, now)
  if (!p) return `${t.planInvalid(args.join(' '))}\n${t.planHelp}`
  const patch: Values = { plan: p.plan, billingDay: p.day, planPrice: p.price ?? 0 }
  const r = await writeSettings($, SELF, SETTINGS, patch, lang)
  if (!r.ok) return writeNote(r, lang)
  if (r.way === 'cli') ucfg = { ...ucfg, ...patch }
  const m = planMonth(p.day, now)
  return `${t.planSaved(planLabel(p.plan), p.day, price(p), shortDate(m.start, lang), shortDate(m.next, lang))}\n\n${writeNote(r, lang)}`
}

// ---------- Geräte-Sync (SPEC Nachtrag 0.7.0) ----------
// `$.fs` nur im per `/ledger sync` gesetzten, absoluten Ordner: gelesen werden nur `cost-ledger-<id>.json`, geschrieben nur
// die eigene Datei. Die Rechte-Zeile kennt keine Pfade (en/reference.md:181), deshalb setzt das der Code durch.

const deviceDefault = (id: string) => T[settings.lang].deviceDefault(id)

/**
 * Sync-Einstellung dieses Geräts: Ordner aus userConfig (geprüft wie bei `/ledger sync`), Geräte-ID aus `$.store`; `null` = Sync
 * aus oder Ordner ungültig. Ohne ID (Ordner über die Einstellungsseite gesetzt, ohne `/ledger sync`) wird sie jetzt angelegt; eine
 * doppelte ID fängt `syncRound` ab.
 */
async function syncConfig($: EngineInterface): Promise<SyncCfg | null> {
  const raw = syncRaw()
  if (!raw) return null
  const dir = validDir(raw, /^[A-Za-z]:/.test(await $.session.root()))
  if (!dir) return null
  let device = cleanDevice(await $.store.get('meta:device'), deviceDefault)
  if (!device) {
    device = { id: newDeviceId(), name: '' }
    await $.store.set('meta:device', { id: device.id })
  }
  return { dir, device: { id: device.id, name: deviceName(device.id) } }
}

/**
 * Alten Eintrag markieren (0.12.1), nur wenn ihn seit dem Lesen niemand geändert hat; sonst zieht der nächste Start die Änderung um
 * (Review K1). Kein Objekt (kaputter Eintrag): leeren wie bis 0.12.0.
 */
async function markIfSame($: EngineInterface, key: string, raw: unknown) {
  const now = await $.store.get(key)
  if (JSON.stringify(now) !== JSON.stringify(raw)) return
  await $.store.set(key, raw && typeof raw === 'object' ? { ...raw, migrated: true } : null)
}

/**
 * Geräte-ID speichern. Ein schon umgezogener (markierter) Name bleibt stehen, damit ein Chat mit 0.10.x ihn bis `/reload-plugins`
 * weiter liest (Review K3); ein nicht markierter Name fällt weg wie bisher (sonst sähe der Umzug ihn als eigenen Namen, Review 0.11.0 S2).
 */
async function setDeviceId($: EngineInterface, id: string) {
  const old = (await $.store.get('meta:device')) as { name?: unknown; migrated?: unknown } | undefined
  await $.store.set('meta:device', old?.migrated === true && typeof old.name === 'string' ? { id, name: old.name, migrated: true } : { id })
}

/**
 * Einmal je Start (0.11.0, SETTINGS-SPEC §4): `meta:plan`, `meta:sync` und ein eigener Gerätename aus `meta:device` galten bis 0.10.0
 * im Store. Abweichende Werte gehen nach userConfig, danach werden die alten Einträge markiert (0.12.1). Im Hintergrund.
 */
async function migrate($: EngineInterface) {
  let planRaw: unknown, syncRawOld: unknown, devRaw: unknown
  try {
    planRaw = await $.store.get('meta:plan')
    syncRawOld = await $.store.get('meta:sync')
    devRaw = await $.store.get('meta:device')
  } catch {
    return
  }
  // Markiert statt gelöscht (0.12.1, wie sidekick 0.23.0 Review S1): Ein Chat, der nach dem Update bis `/reload-plugins` noch mit
  // 0.10.x läuft, liest Plan, Sync-Ordner und Gerätenamen weiter aus dem Store; gelöscht verlöre er sie. 0.10.x übergeht das Feld
  // `migrated` und schreibt ohne es; dann zieht der nächste Start jedes Feld um, das von userConfig abweicht (auch eins, das inzwischen auf der Seite geändert wurde).
  const fresh = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'object' && (v as { migrated?: unknown }).migrated === true)
  if (!fresh(planRaw)) planRaw = undefined
  if (!fresh(syncRawOld)) syncRawOld = undefined
  const dev = devRaw as { id?: unknown; name?: unknown; migrated?: unknown } | undefined
  const id = typeof dev?.id === 'string' ? dev.id : ''
  const oldName = typeof dev?.name === 'string' && dev.migrated !== true ? dev.name.trim() : ''
  const named = !!oldName && oldName !== T.en.deviceDefault(id) && oldName !== T.de.deviceDefault(id)
  if (planRaw === undefined && syncRawOld === undefined && !oldName) return
  const legacy: Partial<Values> = {}
  const p = cleanPlan(planRaw)
  if (p) Object.assign(legacy, { plan: p.plan, billingDay: p.day, planPrice: p.price ?? 0 })
  const sy = cleanSync(syncRawOld)
  if (sy) legacy.syncFolder = sy.dir
  if (named) legacy.deviceName = oldName
  const clear = async () => {
    if (planRaw !== undefined) await markIfSame($, 'meta:plan', planRaw)
    if (syncRawOld !== undefined) await markIfSame($, 'meta:sync', syncRawOld)
    if (oldName && id) await markIfSame($, 'meta:device', devRaw)
  }
  const before = { ...ucfg }
  const { apply } = await migrateSettings($, SELF, SETTINGS, ucfg, legacy, clear, settings.lang)
  // Ein /ledger plan … während des Umzugs gewinnt (Review 0.11.0 K2)
  for (const [k, v] of Object.entries(apply)) if (ucfg[k] === before[k]) ucfg = { ...ucfg, [k]: v }
  if (apply.syncFolder !== undefined) rescan($, true)
}

/** `meta:planRenamed`: letzter Umzug eines alten Plannamens; `shown` = Toast gezeigt. */
type Renamed = { from: string; to: string; shown: boolean }

/** Gespeicherte Markierung prüfen; `null` bei fehlender oder kaputter (Review 0.12.0 K4). */
function cleanRenamed(v: unknown): Renamed | null {
  const o = v as Partial<Renamed> | null | undefined
  return o && typeof o === 'object' && typeof o.from === 'string' && typeof o.to === 'string' ? { from: o.from, to: o.to, shown: o.shown === true } : null
}

/**
 * Toast zum Umzug, wenn er noch aussteht. Die Markierung kommt vor den Toast, damit ihn ein zweiter Aufruf nicht wiederholt.
 * Ohne Oberfläche (`claude -p`) sieht ihn niemand: dann wartet er auf den nächsten Chat (Review 0.12.0 K2).
 */
async function renameToast($: EngineInterface, r: Renamed) {
  if (r.shown || !(await $.session.surfaces()).length) return
  await $.store.set('meta:planRenamed', { ...r, shown: true })
  const t = T[settings.lang]
  $.ui.toast(t.planRenamed(LEGACY_LABELS[r.from] ?? r.from, planLabel(r.to)), { timeoutMs: 15000 })
}

/**
 * Alte Plannamen (SPEC Nachtrag 0.12.0): ein gespeichertes `max5` wird `max`, ein `max20` wird `ultra`. Einmal je Start im
 * Hintergrund, über den Weg der SETTINGS-SPEC (nur `plan`, ein eigener Preis bleibt). Eine per --plugin-dir geladene Kopie
 * (`@inline`) zieht nicht um. Toast einmal: nach Weg 2 hier, nach Weg 1 in der neu geladenen Instanz (session.start läuft
 * dort erneut, docs/LANGUAGE-SPEC.md §2c).
 */
async function migratePlan($: EngineInterface) {
  const done = cleanRenamed(await $.store.get('meta:planRenamed'))
  const old = String(ucfg.plan ?? '')
  if (!Object.prototype.hasOwnProperty.call(LEGACY_PLANS, old)) {
    if (done && done.to === old) await renameToast($, done)
    return
  }
  // Weg 1 schriebe in einer @inline-Kopie deren eigene Zeile, Weg 2 lehnt sie selbst ab (settings.ts viaCli)
  let rows: ConfigRow[] = []
  try {
    rows = await $.config.list()
  } catch {
    rows = []
  }
  const owner = rows.find((r) => r.key === `${SELF}.plan`)?.provider?.plugin
  if (typeof owner === 'string' && owner.endsWith('@inline')) return
  const next = LEGACY_PLANS[old]!
  const mark: Renamed = done && done.from === old && done.to === next ? done : { from: old, to: next, shown: false }
  await $.store.set('meta:planRenamed', mark)
  const r = await writeSettings($, SELF, SETTINGS, { plan: next }, settings.lang)
  if (!r.ok) {
    log($, `Planname ${old} → ${next} nicht umgezogen: ${r.reason}`)
    if (!done || done.from !== old) await $.store.delete('meta:planRenamed')
    return
  }
  if (r.way === 'config') return // die neu geladene Instanz zeigt den Toast
  if (ucfg.plan === old) ucfg = { ...ucfg, plan: next }
  await renameToast($, mark)
}

/** Alle Datensätze dieses Geräts, nur lesend (das Aufräumen bleibt bei `/ledger`). */
async function ownRecs($: EngineInterface): Promise<{ recs: { id: string; rec: Rec }[]; since: number | null }> {
  const recs: { id: string; rec: Rec }[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith('s:')) continue
    const id = key.slice(2)
    const r = id === sessionId && rec ? rec : cleanRec(await $.store.get(key))
    if (r) recs.push({ id, rec: r })
  }
  const since = await $.store.get('meta:since')
  return { recs, since: typeof since === 'number' ? since : null }
}

/**
 * Eigene Gerätedatei schreiben. Die Uhr erst unmittelbar davor lesen, dann `meta:syncAt` (für alle Chats des Geräts), dann
 * die Datei mit demselben Zeitpunkt: So ist `at` in der Datei nicht jünger als `meta:syncAt`, solange nur dieses Gerät
 * schreibt; bis auf die Millisekunden zwischen zwei gleichzeitigen Chats (dafür der Spielraum in `ownConflict`, Review S1).
 */
async function writeOwn($: EngineInterface, cfg: SyncCfg, recs: { id: string; rec: Rec }[], since: number | null) {
  const at = await $.clock.now()
  // Benutzernamen aus bekannten Pfaden: ein Ordnername mit ihnen bleibt leer (SPEC Nachtrag 0.8.0, Schutz)
  const users = usersIn([cfg.dir, meta.root, ...recs.map((x) => x.rec.root)])
  const text = buildFile(cfg.device, since, recs, at, users)
  if (utf8Bytes(text) > FILE_LIMIT) throw new Error(T[settings.lang].syncTooBig)
  await $.store.set('meta:syncAt', at)
  await $.fs.write(inDir(cfg.dir, fileName(cfg.device.id)), text)
}

/**
 * Schreibt ein anderes Gerät mit derselben ID (Speicher kopiert)? Dann ist die eigene Datei deutlich jünger als die letzte
 * eigene Schreibmarke `meta:syncAt`. Erst die Datei lesen, dann die Marke: Ein anderer Chat dieses Geräts setzt die Marke
 * vor der Datei. Spielraum eine Minute: Zwei Chats dieses Geräts, die gleichzeitig schreiben, liegen weit darunter.
 */
async function ownConflict($: EngineInterface, cfg: SyncCfg, entries: readonly FsEntry[]): Promise<boolean> {
  const name = fileName(cfg.device.id)
  if (!entries.some((x) => x.kind === 'file' && x.name === name)) return false
  const f = parseFile(await $.fs.read(inDir(cfg.dir, name)), cfg.device.id)
  const at = await $.store.get('meta:syncAt')
  return !!f && f.at > (typeof at === 'number' ? at : 0) + CONFLICT_SLACK
}

/** Fremde Gerätedateien lesen; halb geschriebene oder kaputte → letzter gute Stand aus diesem Prozess, sonst „nicht lesbar“. */
async function readPeers($: EngineInterface, cfg: SyncCfg, entries: readonly FsEntry[]): Promise<{ peers: SyncFile[]; unreadable: number }> {
  const peers: SyncFile[] = []
  let unreadable = 0
  for (const x of entries) {
    const id = x.kind === 'file' ? idFromName(x.name) : null
    if (!id || id === cfg.device.id) continue
    let f: SyncFile | null = null
    if (x.size <= FILE_LIMIT)
      try {
        f = parseFile(await $.fs.read(inDir(cfg.dir, x.name)), id)
      } catch (err) {
        log($, `Sync lesen ${x.name}: ${msg(err)}`)
      }
    if (f) peerCache.set(id, f)
    else f = peerCache.get(id) ?? null
    if (f) peers.push(f)
    else unreadable++
  }
  return { peers, unreadable }
}

/**
 * Eine Sync-Runde für `/ledger`: Ordner lesen, eigene Datei schreiben, fremde lesen, zusammenführen. Fehlt der Ordner, wird
 * weder gelesen noch geschrieben (nicht neu anlegen); das lokale Ergebnis bleibt, der Fehler steht als Hinweis da.
 */
async function syncRound($: EngineInterface, cfg: SyncCfg, own: { id: string; rec: Rec }[], since: number | null, now: number) {
  const info: SyncInfo = { on: true, devices: 1, unreadable: 0, error: '', dupId: false, names: [cfg.device.name] }
  let entries: FsEntry[]
  try {
    entries = await $.fs.list(cfg.dir)
  } catch (err) {
    info.error = msg(err)
    return { recs: own, since, info }
  }
  // Doppelte Geräte-ID: Dieses Gerät nimmt eine neue und schreibt ab jetzt dorthin; die alte Datei gehört dem anderen
  try {
    if (await ownConflict($, cfg, entries)) {
      cfg = { dir: cfg.dir, device: { id: newDeviceId(), name: cfg.device.name } }
      // Nur die ID: der Name liegt in userConfig (sonst sähe der Umzug ihn als eigenen Namen, Review 0.11.0 S2)
      await setDeviceId($, cfg.device.id)
      info.dupId = true
    }
  } catch (err) {
    log($, `Sync eigene Datei: ${msg(err)}`)
  }
  try {
    await writeOwn($, cfg, own, since)
  } catch (err) {
    info.error = msg(err)
  }
  const p = await readPeers($, cfg, entries)
  lastPeers = p.peers
  info.unreadable = p.unreadable
  info.devices = 1 + p.peers.length
  info.names = [cfg.device.name, ...p.peers.map((f) => f.device.name)]
  const starts = [since, ...p.peers.map((f) => f.since)].filter((x): x is number => typeof x === 'number')
  return { recs: mergeRecs(own, p.peers, now - settings.keepDays * DAY, { root: meta.root, project: meta.project }), since: starts.length ? Math.min(...starts) : null, info }
}

/**
 * Nach einem Turn: eigene Datei höchstens alle 15 Minuten (Marke `meta:syncAt` gilt für alle Chats des Geräts). Den Store
 * fragt der Prozess erst wieder, wenn ein Schreiben fällig sein kann (Review K2); ein Sync, den ein anderer Chat einschaltet,
 * greift hier so spätestens nach 15 Minuten.
 */
async function syncAfterTurn($: EngineInterface) {
  const now = await $.clock.now()
  if (now < nextSyncCheck && nextSyncCheck - now <= SYNC_EVERY) return // rückwärts springende Uhr: neu prüfen
  nextSyncCheck = now + SYNC_EVERY
  const cfg = await syncConfig($)
  if (!cfg) return
  const at = await $.store.get('meta:syncAt')
  if (typeof at === 'number' && now >= at && now - at < SYNC_EVERY) {
    nextSyncCheck = at + SYNC_EVERY
    return
  }
  // Ordner weg (Laufwerk getrennt): nicht neu anlegen, nur beim nächsten /ledger melden
  await $.fs.list(cfg.dir)
  const own = await ownRecs($)
  await writeOwn($, cfg, own.recs, own.since)
}

/** `/ledger sync …` (SPEC Nachtrag 0.7.0, Bedienung). `rest`: der Rest der Zeile in Originalschreibung (Pfad, Name). */
async function syncCommand($: EngineInterface, rest: string): Promise<string> {
  const t = T[settings.lang]
  const lang = settings.lang
  const words = rest.split(/\s+/).filter(Boolean)
  const first = (words[0] ?? '').toLowerCase()
  if (!first) {
    const cfg = await syncConfig($)
    if (!cfg) return syncRaw() ? t.syncCfgInvalid(syncRaw()) : t.syncOffState
    const lines = [t.syncState(cfg.dir, cfg.device.name, cfg.device.id)]
    try {
      const p = await readPeers($, cfg, await $.fs.list(cfg.dir))
      for (const f of p.peers) lines.push(t.syncPeer(f.device.name, dateTime(f.at, lang), Object.keys(f.recs).length))
      if (p.unreadable) lines.push(t.syncUnreadable(p.unreadable))
      if (!p.peers.length && !p.unreadable) lines.push(t.syncNoPeers)
    } catch (err) {
      lines.push(t.syncFailed(msg(err)))
    }
    lines.push(t.syncPrivacy)
    return lines.join('\n\n')
  }
  if (OFF_WORDS.includes(first) && words.length === 1) {
    const r = await writeSettings($, SELF, SETTINGS, { syncFolder: '' }, lang)
    if (r.ok && r.way === 'cli') ucfg = { ...ucfg, syncFolder: '' }
    return r.ok ? `${t.syncOffDone}\n\n${writeNote(r, lang)}` : writeNote(r, lang)
  }
  const now = await $.clock.now()
  if (first === NAME_WORD) {
    const raw = rest.slice(rest.indexOf(words[0]!) + words[0]!.length).trim()
    if (!raw) return t.syncNameMissing
    const old = cleanDevice(await $.store.get('meta:device'), deviceDefault)
    const id = old?.id ?? newDeviceId()
    const device = { id, name: cleanDeviceName(raw, id, deviceDefault) }
    if (!old) await $.store.set('meta:device', { id })
    const r = await writeSettings($, SELF, SETTINGS, { deviceName: device.name }, lang)
    if (!r.ok) return writeNote(r, lang)
    ucfg = { ...ucfg, deviceName: device.name }
    const cfg = await syncConfig($)
    if (cfg)
      try {
        await $.fs.list(cfg.dir)
        const own = await ownRecs($)
        await writeOwn($, cfg, own.recs, own.since)
      } catch (err) {
        return `${t.syncNamed(device.name)}\n\n${t.syncFailed(msg(err))}\n\n${writeNote(r, lang)}`
      }
    return `${t.syncNamed(device.name)}\n\n${writeNote(r, lang)}`
  }
  const dir = validDir(rest, /^[A-Za-z]:/.test(await $.session.root()))
  if (!dir) return t.syncInvalid(rest.trim())
  const stored = cleanDevice(await $.store.get('meta:device'), deviceDefault)
  let device = stored ? { id: stored.id, name: deviceName(stored.id) } : (() => {
    const fresh = newDeviceId()
    return { id: fresh, name: deviceName(fresh) }
  })()
  let entries: FsEntry[] = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    // Ordner gibt es noch nicht: `$.fs.write` legt ihn an (types:3243-3248)
  }
  let renewed = false
  try {
    if (await ownConflict($, { dir, device }, entries)) {
      device = { id: newDeviceId(), name: device.name }
      renewed = true
    }
  } catch (err) {
    log($, `Sync eigene Datei: ${msg(err)}`)
  }
  // Erst schreiben, dann speichern: Lässt sich der Ordner nicht beschreiben, bleibt der Sync aus
  const own = await ownRecs($)
  try {
    await writeOwn($, { dir, device }, own.recs, own.since)
  } catch (err) {
    return t.syncUnreachable(msg(err))
  }
  await setDeviceId($, device.id)
  // Erst nach dem gelungenen Schreiben: der Ordner geht nach userConfig (SETTINGS-SPEC §4)
  const r = await writeSettings($, SELF, SETTINGS, { syncFolder: dir }, lang)
  if (!r.ok) return writeNote(r, lang)
  if (r.way === 'cli') ucfg = { ...ucfg, syncFolder: dir }
  let n = 0
  try {
    n = (await readPeers($, { dir, device }, await $.fs.list(dir))).peers.length
  } catch (err) {
    log($, `Sync lesen: ${msg(err)}`)
  }
  return `${t.syncOn(dir, device.name, n, renewed)}\n\n${t.syncPrivacy}\n\n${writeNote(r, lang)}`
}

// ---------- $.state `cost-ledger.here` für limit-bars (SPEC Nachtrag 0.10.0) ----------
// Dieselbe Rechnung wie `/ledger here all` (`hereOf`). Die Projektsumme braucht alle Datensätze. Das Lesen kostet je Schlüssel
// einen Aufruf (Probe 2026-11-04: 58 Schlüssel 180 ms, Fynns Speicher hat 512), deshalb nie im Weg einer Buchung: Die anderen
// Datensätze dieses Projekts (lokal und von den Gerätedateien) liegen hier im Modul, die eigenen Beträge kommen aus `rec`.
// Neu gelesen wird im Hintergrund: beim Start (mit Sync samt Gerätedateien, Fynn 2026-11-04), nach `/ledger reset` und nach
// einem Turn, wenn der Stand 15 Minuten alt ist (Buchungen anderer Chats). `/ledger` liefert ohnehin einen frischen Stand.

type Others = { recs: { id: string; rec: Rec }[]; since: number | null; devices: string[] | null; at: number }
let others: Others | null = null
let lastPeers: SyncFile[] | null = null // fremde Gerätedateien vom letzten Lesen (Start oder /ledger)
let scanning = false
let scanGen = 0 // Reset und /ledger erhöhen ihn: Ein Lesen, das davor begann, verwirft sein Ergebnis (Review 0.10.0 K1)
let publishedHere: string | undefined // Wert beim letzten erfolgreichen Schreiben; `undefined` = sicher neu schreiben
let hereChain: Promise<unknown> = Promise.resolve()
const HERE_RESCAN = 15 * 60 * 1000

/** Nur die anderen Datensätze dieses Projekts behalten; der eigene kommt beim Schreiben aus `rec`. */
function keepOthers(recs: { id: string; rec: Rec }[], since: number | null, devices: string[] | null, now: number, gen = scanGen) {
  if (gen !== scanGen) return
  others = { recs: recs.filter((x) => x.id !== sessionId && x.rec.project === meta.project), since, devices, at: now }
}

/**
 * Sessionwechsel mitten im Prozess (/clear, /resume, /branch): Der bisherige Chat zählt ab jetzt zu den anderen, der neue
 * kommt aus `rec`. So stimmt die Summe sofort, ohne den Speicher neu zu lesen.
 */
function switchOthers(oldId: string, oldRec: Rec | null, newId: string) {
  if (!others) return
  const recs = others.recs.filter((x) => x.id !== oldId && x.id !== newId)
  if (oldId && oldRec && oldRec.project === meta.project) recs.push({ id: oldId, rec: oldRec })
  others = { ...others, recs }
}

/** Speicher (ohne Aufräumen) und, mit `files` und Sync, die fremden Gerätedateien lesen; Grenze `keepDays` wie bei `/ledger`. */
async function scanOthers($: EngineInterface, files: boolean) {
  const gen = scanGen
  const now = await $.clock.now()
  // Skript-Lauf: kein Projekt, also keine anderen Datensätze nötig (projectUsd bleibt null; Review 0.10.0 K3)
  if (meta.kind === 'script') return keepOthers([], null, null, now, gen)
  const cutoff = now - settings.keepDays * DAY
  const own: { id: string; rec: Rec }[] = []
  const keys = await $.store.keys()
  for (const key of keys) {
    if (!key.startsWith('s:')) continue
    const r = cleanRec(await $.store.get(key))
    if (r && r.lastAt >= cutoff) own.push({ id: key.slice(2), rec: r })
  }
  const s = await $.store.get('meta:since')
  let since = typeof s === 'number' ? s : null
  // Rechenaufwand der Projektsumme (SPEC Nachtrag 0.10.0): Dauer im Debug-Log
  log($, `here: ${keys.length} Schlüssel in ${(await $.clock.now()) - now} ms gelesen`)
  const cfg = await syncConfig($)
  if (!cfg) return keepOthers(own, since, null, now, gen)
  if (files)
    try {
      lastPeers = (await readPeers($, cfg, await $.fs.list(cfg.dir))).peers
    } catch (err) {
      log($, `Sync lesen für here: ${msg(err)}`)
    }
  const peers = lastPeers ?? []
  const starts = [since, ...peers.map((f) => f.since)].filter((x): x is number => typeof x === 'number')
  since = starts.length ? Math.min(...starts) : null
  keepOthers(mergeRecs(own, peers, cutoff, { root: meta.root, project: meta.project }), since, [cfg.device.name, ...peers.map((f) => f.device.name)], now, gen)
}

/**
 * Im Hintergrund neu lesen und danach schreiben; läuft schon ein Lesen, nichts. Niemand wartet darauf: Der Aufruf kehrt sofort
 * zurück (Start, Turn), Fehler gehen ins Debug-Log.
 */
function rescan($: EngineInterface, files = false) {
  if (scanning) return
  scanning = true
  void scanOthers($, files)
    .catch((err) => log($, `here lesen: ${msg(err)}`))
    .then(() => {
      scanning = false
      return publish($)
    })
}

/** Ist der Stand der anderen Chats alt (oder fehlt er), im Hintergrund neu lesen. */
async function rescanIfOld($: EngineInterface) {
  const now = await $.clock.now()
  if (!others || now - others.at >= HERE_RESCAN || now < others.at) rescan($)
}

/** `cost-ledger.here` schreiben, wenn sich etwas auf den Cent geändert hat. Ohne Session-ID oder vor dem ersten Lesen nichts. */
async function publishHere($: EngineInterface) {
  if (!sessionId || !others) return
  const now = await $.clock.now()
  const o = others
  const h = hereOf([...o.recs, ...(rec ? [{ id: sessionId, rec }] : [])], {
    now,
    range: 0,
    sessionId,
    project: meta.project,
    kind: meta.kind,
    since: o.since,
    devices: o.devices,
  })
  const value: HereState = hereState(h, meta.kind === 'script' ? '' : safeProj(folderOf(meta.root), usersIn([meta.root])))
  const key = JSON.stringify(value)
  if (key === publishedHere) return
  // Nie aus ui.render heraus (dort abgelehnt, types:3549-3552); `plugin` und `key` als Literale (validate)
  await $.state.set({ plugin: 'cost-ledger', key: 'here' }, value)
  publishedHere = key
}

/**
 * Nacheinander und nie werfend: Eine Ablehnung bricht keine Buchung ab (SPEC Nachtrag 0.10.0), nur das Debug-Log hört davon.
 * Schnell: kein Lesen des Speichers, nur `clock.now` und höchstens ein `state.set`.
 */
function publish($: EngineInterface): Promise<void> {
  const p = hereChain.then(() => publishHere($))
  hereChain = p.catch(() => undefined)
  return p.catch((err) => log($, `$.state here: ${msg(err)}`))
}

async function reset($: EngineInterface): Promise<string> {
  const t = T[settings.lang]
  const cfg = await syncConfig($)
  let answer: string
  try {
    // Empfohlene Antwort auf Platz 1 (Fynns Regel für Rückfragen); in -p wird ask abgelehnt (API-DETAILS.md:149-154)
    answer = await $.ui.ask(cfg ? t.askQuestionSync : t.askQuestion, [t.askCancel, t.askDelete])
  } catch {
    return t.notDeletedNoAsk
  }
  // Beide Sprachen gelten, falls die Einstellung zwischen Frage und Antwort wechselt
  if (answer !== T.en.askDelete && answer !== T.de.askDelete) return t.notDeleted
  const now = await $.clock.now()
  // Zuerst die Marke: Wer ab jetzt bucht oder /ledger zeigt, verwirft seinen alten Stand (honorReset)
  await $.store.set('meta:resetAt', now)
  await serial(async () => {
    rec = null // Die bisherigen Kosten dieser Session werden nicht neu gebucht: `seen` bleibt
    others = null
    scanGen++
    scanning = false // ein laufendes Lesen zählt nicht mehr; rescan darf neu beginnen
    carry = {}
    carryAt = 0
    pendingGap = 0
    gapAt = undefined
    limSinceChecked = false
    reports.clear()
  })
  // Löschen außerhalb der Kette: Mod-Aufrufe warten nur auf das eigene Schreiben (SPEC Verhalten 5).
  // `meta:plan` bleibt: eine Einstellung, keine Buchung (SPEC Nachtrag 0.5.0, Verhalten 5); ebenso Sync und Gerät (0.7.0)
  const keep = ['meta:resetAt', 'meta:plan', 'meta:sync', 'meta:device', 'meta:syncAt', 'meta:planRenamed']
  let n = 0
  let hadLimits = false
  for (const key of await $.store.keys()) {
    if (keep.includes(key) || (!key.startsWith('s:') && !key.startsWith('meta:'))) continue
    if (key === 'meta:limSince') hadLimits = true
    await $.store.delete(key)
    if (key.startsWith('s:')) n++
  }
  await $.store.set('meta:since', now)
  // Die Fenster-Daten beginnen mit dem Reset neu. Gleich setzen statt löschen: Sonst setzte der nächste Prozess, der ein
  // Fenster bucht, einen späteren Beginn, und Fenster anderer Chats seit dem Reset gälten als unvollständig (Review 0.5.0)
  if (hadLimits) await $.store.set('meta:limSince', now)
  // Nur dieses Gerät: seine Datei leer neu schreiben, andere Geräte behalten ihre (SPEC Nachtrag 0.7.0, Verhalten 6)
  if (cfg)
    try {
      await $.fs.list(cfg.dir)
      await writeOwn($, cfg, [], now)
    } catch (err) {
      return `${t.cleared(n)}\n\n${t.syncFailed(msg(err))}`
    }
  return t.cleared(n)
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  settings = cleanSettings(options)
  ucfg = readSettings(SETTINGS, options)

  on('session.start', async ($, e, next) => {
    // Erst der Umzug aus dem Store (0.11.0), dann die alten Plannamen (0.12.0)
    void migrate($)
      .then(() => migratePlan($))
      .catch((err) => log($, `Umzug der Einstellungen: ${msg(err)}`))
    try {
      await serial(async () => {
        const root = await $.session.root()
        const repo = await $.session.repo()
        meta.root = root
        meta.project = projectOf(repo?.name, root)
        meta.remote = cleanRemote(repo?.remote) // nur host/owner/repo, nie Zugangsdaten
        meta.kind = kindOf(await $.session.surfaces())
        if (sessionId && !rec) rec = await load($, sessionId)
        const cost = (await $.session.usage()).cost?.usd
        hasCost = typeof cost === 'number'
        // Resume zählt `cost` weiter: Baseline = gespeicherter Stand, sonst der aktuelle → keine Doppelbuchung
        seen = typeof cost === 'number' ? baselineFor(rec, cost) : 0
        // Was zwischen letzter Buchung und Prozessende anfiel (hartes Ende), bucht der nächste Messpunkt nach
        pendingGap = typeof cost === 'number' ? Math.max(0, cost - seen) : 0
        gapAt = pendingGap > 0 ? rec?.lastAt : undefined
        rebase = false
        started = true
        if ((await $.store.get('meta:since')) === undefined) await $.store.set('meta:since', await $.clock.now())
      })
    } catch (err) {
      log($, `Start: ${msg(err)}`)
    }
    try {
      await $.command.register({
        name: 'ledger',
        description: T[settings.lang].commandDescription,
        argumentHint: '[here|weeks|chats|projects|models|limits|plan|sync|language|reset|help]',
      })
    } catch (err) {
      log($, `/ledger nicht registriert: ${msg(err)}`)
    }
    // Kosten für limit-bars: Speicher und mit Sync die Gerätedateien lesen, im Hintergrund, der Start wartet nicht (Fynn
    // 2026-11-04). Nach einem Modul-Reload ist die Session-ID noch unbekannt: Der Wert in $.state bleibt dann, bis der nächste
    // Prompt die Session bindet.
    rescan($, true)
    return next(e)
  })

  // Session-ID und Titel; /clear, /resume und /branch wechseln die Session ohne neues session.start (interface.md:786)
  on('classic.SessionStart', async ($, e, next) => {
    let bound = false
    try {
      await serial(async () => {
        if (e.session_id && e.session_id !== sessionId) {
          bound = true
          await bind($, e.session_id, e.source, e.session_title)
        }
        else if (e.session_title && e.session_title !== title) {
          title = e.session_title
          titleDirty = true
          titleFromSession = true
        }
      })
    } catch (err) {
      log($, `SessionStart: ${msg(err)}`)
    }
    // Mitten im Prozess (/clear, /resume, /branch) hat der Host $.state geleert; beim Prozessstart schreibt session.start
    if (started && bound) await publish($)
    return next(e)
  })

  // Titel nur merken; geschrieben wird beim nächsten Buchen. Nach einem Modul-Reload feuert nur session.start, nicht
  // classic.SessionStart (types:4173-4178, interface.md:789): dann bindet die Session-ID von hier (BaseHookInput)
  on('classic.UserPromptSubmit', async ($, e, next) => {
    let bound = false
    try {
      await serial(async () => {
        if (e.session_id && e.session_id !== sessionId) {
          bound = true
          await bind($, e.session_id, undefined, e.session_title)
        }
        else if (e.session_title && e.session_title !== title) {
          title = e.session_title
          titleDirty = true
          titleFromSession = true
        }
        // Ohne Titel vom Host: die erste eigene Nachricht benennt den Chat (keine System- oder Weck-Prompts). Nicht bei
        // Skript-Läufen (-p): Skripte schicken oft fremden Text, der sonst in /ledger bei Claude landet
        const own = e.source === undefined || e.source === 'user' || e.source === 'sdk'
        if (!title && !titleFromSession && own && meta.kind !== 'script') {
          const t = titleFromPrompt(e.prompt)
          if (t) {
            title = t
            titleDirty = true
          }
        }
      })
    } catch (err) {
      log($, `UserPromptSubmit: ${msg(err)}`)
    }
    if (started && bound) await publish($) // Session erst hier gebunden (Modul-Reload)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (!e.agentId && e.usage?.model) lastModel = e.usage.model
      // Tokens je Modell aus der Usage des Turns (TurnUsage: Summe seiner Anfragen, Modell der letzten), auch Subagents
      await serial(() => measure($, false, e.usage, { agentId: e.agentId, durationMs: e.durationMs, reason: e.reason, isAborted: e.isAborted }))
    } catch (err) {
      log($, `Buchen: ${msg(err)}`)
    }
    await publish($) // außerhalb der Kette: Mod-Aufrufe warten nicht darauf
    try {
      await rescanIfOld($)
    } catch (err) {
      log($, `here: ${msg(err)}`)
    }
    try {
      await syncAfterTurn($) // außerhalb der Kette: Mod-Aufrufe und session.end warten nicht auf den Ordner (Review K1)
    } catch (err) {
      log($, `Sync schreiben: ${msg(err)}`)
    }
    return r
  })

  // Modellaufrufe anderer Mods: `next(e)` liefert `{ value }` oder `{ deny }` (types OpEventResult). Nie ändern, nie verzögern
  // außer um das eigene Schreiben; den eigenen Hook überspringt die Engine ohnehin (types OpEventOf).
  on('model.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if ('value' in r) {
        await serial(() => bookCall($, next.origin?.plugin, e.model, r.value.usage, false, true))
        void publish($) // der Mod-Aufruf wartet nur aufs eigene Speichern, nicht auf $.state (SPEC Verhalten 5; Review 0.10.0 K2)
      }
    } catch (err) {
      log($, `Mod-Aufruf: ${msg(err)}`)
    }
    return r
  })

  on('model.fork', async ($, e, next) => {
    const r = await next(e)
    try {
      // Der Fork läuft auf dem Modell der Hauptschleife; „nothing-to-fork“ hat keine Usage und kostet nichts
      if ('value' in r && 'usage' in r.value) {
        await serial(() => bookCall($, next.origin?.plugin, lastModel, r.value.usage, false))
        void publish($) // der Mod-Aufruf wartet nur aufs eigene Speichern, nicht auf $.state (SPEC Verhalten 5; Review 0.10.0 K2)
      }
    } catch (err) {
      log($, `Mod-Aufruf: ${msg(err)}`)
    }
    return r
  })

  // classify liefert nur einen String ohne Usage: nur die Anzahl zählt (types:6539-6546, :6871)
  on('model.classify', async ($, e, next) => {
    const r = await next(e)
    try {
      if ('value' in r) {
        await serial(() => bookCall($, next.origin?.plugin, '', undefined, true))
        void publish($) // der Mod-Aufruf wartet nur aufs eigene Speichern, nicht auf $.state (SPEC Verhalten 5; Review 0.10.0 K2)
      }
    } catch (err) {
      log($, `Mod-Aufruf: ${msg(err)}`)
    }
    return r
  })

  // Letzte Buchung; ein Schreibvorgang, kein Warten auf anderes (Budget 1,5 s)
  on('session.end', async ($, e, next) => {
    try {
      await serial(() => measure($, true))
    } catch (err) {
      log($, `Ende: ${msg(err)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'ledger' }, async ($, e) => {
    const t = T[settings.lang]
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest[0]
    const what = sub.toLowerCase()
    // Sprache aller fynn-mods (docs/LANGUAGE-SPEC.md §6 Punkt 2); fängt Fehler selbst ab
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: SELF, cmd: 'ledger', lang: settings.lang }, e.args) }
    // Hilfe: nur das erste Wort, ohne weitere Wörter (docs/HELP-SPEC.md §2)
    if (HELP_WORDS.includes(what)) return { text: rest.length ? t.unknownArg(e.args.trim()) : await helpCommand($, e.args) }
    // Speicher voll o. Ä.: ein lesbarer Hinweis statt einer Fehlerzeile (Review 0.5.0 K1)
    if (what === 'reset' || what === 'plan' || what === SYNC_WORD) {
      try {
        if (what === SYNC_WORD) return { text: await syncCommand($, e.args.trim().slice(sub.length).trim()) }
        if (what !== 'reset') return { text: await planCommand($, rest) }
        const text = await reset($)
        rescan($) // Summe neu aus dem geleerten Speicher, im Hintergrund
        return { text }
      } catch (err) {
        log($, `/ledger ${what}: ${msg(err)}`)
        return { text: t.writeFailed(msg(err)) }
      }
    }
    const here = HERE_WORDS.includes(what)
    if (what && !here && !VIEW_WORDS.includes(what)) return { text: t.unknownArg(sub) }
    // `/ledger here` nimmt nur einen Zeitraum an; sonst gälte `/ledger here foo` still als „gesamt“
    if (here && (rest.length > 1 || (arg !== undefined && parseRange(arg) === 30 && arg !== '30'))) return { text: t.unknownArg(e.args.trim()) }
    try {
      await serial(() => measure($)) // den laufenden Chat mitzählen
    } catch (err) {
      log($, `Buchen vor /ledger: ${msg(err)}`)
    }
    const views: Record<string, View['view']> = { chats: 'chats', projects: 'projects', models: 'models', weeks: 'weeks', limits: 'limits' }
    const view = views[what] ?? 'overview'
    const now = await $.clock.now()
    const data = await collect($, now)
    // Andere Geräte dazu; ohne Sync oder bei Fehlern bleibt es beim lokalen Kostenbuch
    let recs: { id: string; rec: Rec; device?: string }[] = data.recs
    let since = data.since
    let sync: SyncInfo | undefined
    try {
      const cfg = await syncConfig($)
      if (cfg) ({ recs, since, info: sync } = await syncRound($, cfg, data.recs, data.since, now))
    } catch (err) {
      log($, `Sync: ${msg(err)}`)
    }
    // Frischer Stand für den Kostenring: dieselben Datensätze wie diese Ansicht; ein laufendes älteres Lesen verwirft seins
    scanGen++
    keepOthers(recs, since, sync ? (sync.names ?? []) : null, now)
    await publish($)
    // Dieses Projekt und dieser Chat (SPEC Nachtrag 0.8.0); Standard ist „gesamt“, nicht 30 Tage
    const hereFor = (range: number) =>
      hereOf(recs, {
        now,
        range,
        sessionId,
        project: meta.project,
        kind: meta.kind,
        since,
        devices: sync ? (sync.names ?? []) : null,
        notes: notesOf({ hasCost, unreadable: data.unreadable, storeBytes: data.bytes, writeError, sync: sync ?? NO_SYNC }, settings.lang),
      })
    if (here) {
      const h = hereFor(arg === undefined ? 0 : parseRange(arg))
      const tag = remember(now, { kind: 'here', here: h, args: normArgs(e.args) })
      return { text: hereText(h, settings.lang, tag) }
    }
    const range = view === 'overview' || view === 'weeks' || view === 'limits' ? 30 : parseRange(arg)
    const report = aggregate(recs, now, {
      range,
      unreadable: data.unreadable,
      hasCost,
      since,
      sync,
      storeBytes: data.bytes,
      writeError,
      plan: data.plan,
      limSince: data.limSince,
      live: limits,
    })
    // Eindeutige Kennung im Text: ui.render findet darüber die Daten der Zeichnung (SPEC Verhalten 7)
    // Übersicht und Wochen enden mit „Hier: …“ (ab 0.8.0)
    const line = view === 'overview' || view === 'weeks' ? hereLine(hereFor(0), settings.lang) : ''
    const tag = remember(now, { kind: 'ledger', view: { report, view, range, ...(line ? { here: line } : {}) }, args: normArgs(e.args) })
    return { text: summaryText(report, view, range, tag, settings.lang, line) }
  })

  // Die Übersicht und die Hilfe: ein eigener Baum statt der Markdown-Zeile; „a hook's own tree draws in the row's place“
  // (types CommandOutput). `command` gehört zu den Props, daher `props: { command }` im Matcher (oben auf `e` feuert er nie).
  on('ui.render', { component: 'CommandOutput', props: { command: 'ledger' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    // Kennung irgendwo in der ersten Zeile: in -p steht davor „cost-ledger: “ (HELP-SPEC §8 Punkt 1)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const d = tag ? reports.get(tag) : undefined
    // Unbekannt (nach Neustart, alte Zeile, reset, plan): die Engine zeichnet den Markdown-Text
    if (!d || d.args !== normArgs(e.props.args)) return next(e)
    const columns = e.viewport?.columns ?? 100
    if (d.kind === 'here') return hereTree(d.here, settings.lang, columns, e.surface)
    return d.kind === 'help' ? helpTree(d.data, columns, e.surface, ACCENT) : ledgerTree(d.view, settings, columns, e.surface)
  })
}
