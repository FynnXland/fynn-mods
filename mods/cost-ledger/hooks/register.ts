// cost-ledger: Kostenbuch über alle Chats. Reiner Beobachter: bucht nach jedem Turn die Differenz von `usage().cost.usd`,
// dazu die Modellaufrufe anderer Mods, und zeigt per /ledger eine Übersicht (Sprache aus userConfig `language`).
// Fail-open: Jeder Erfassungs-Hook gibt das Ergebnis von `next` unverändert zurück, Fehler gehen nur ins Debug-Log; kein `.catch`.
// Ein $.store-Schlüssel pro Session (`s:<sessionId>`), den nur diese Session schreibt: $.store ist nicht atomar (CHEATSHEET).
import type { EngineInterface, FsEntry, On } from 'claude-code'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { T, dateTime, shortDate, usd } from './i18n.ts'
import {
  HELP_WORDS,
  NAME_WORD,
  NO_FOLDER,
  OFF_WORDS,
  PLANS,
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
import { FILE_LIMIT, buildFile, cleanDevice, cleanDeviceName, cleanSync, fileName, idFromName, inDir, mergeRecs, newDeviceId, parseFile, utf8Bytes, validDir } from './sync.ts'
import type { Device, SyncFile } from './sync.ts'
import { ledgerTree } from './view.ts'
import type { View } from './view.ts'

const SELF = 'cost-ledger'

let settings: Settings = cleanSettings(undefined)
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
type Drawn = ({ kind: 'ledger'; view: View } | { kind: 'help'; data: HelpData }) & { args: string }
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
  let plan: Plan | null = null
  let limSince: number | null = null
  const cutoff = now - settings.keepDays * DAY
  await honorReset($) // Reset aus einem anderen Chat auch ohne neue Buchung beachten
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    bytes += key.length + (JSON.stringify(value ?? null)?.length ?? 0)
    if (key === 'meta:plan') plan = cleanPlan(value)
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
  const info: HelpInfo = { plan: null, storeBytes: 0, since: null, syncDevice: null }
  try {
    let on = false
    let device: Device | null = null
    for (const key of await $.store.keys()) {
      const value = await $.store.get(key)
      info.storeBytes += key.length + (JSON.stringify(value ?? null)?.length ?? 0)
      if (key === 'meta:plan') info.plan = cleanPlan(value)
      if (key === 'meta:since' && typeof value === 'number') info.since = value
      if (key === 'meta:sync') on = cleanSync(value) !== null
      if (key === 'meta:device') device = cleanDevice(value, deviceDefault)
    }
    info.syncDevice = on && device ? device.name : null
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
    const p = cleanPlan(await $.store.get('meta:plan'))
    return `${p ? t.planCurrent(planLabel(p.plan), p.day, price(p), dateTime(p.at, lang)) : t.planNone}\n${t.planHelp}`
  }
  if (OFF_WORDS.includes(first)) {
    await $.store.delete('meta:plan')
    return t.planDeleted
  }
  const p = parsePlan(args, now)
  if (!p) return `${t.planInvalid(args.join(' '))}\n${t.planHelp}`
  await $.store.set('meta:plan', p)
  const m = planMonth(p.day, now)
  return t.planSaved(planLabel(p.plan), p.day, price(p), shortDate(m.start, lang), shortDate(m.next, lang))
}

// ---------- Geräte-Sync (SPEC Nachtrag 0.7.0) ----------
// `$.fs` nur im per `/ledger sync` gesetzten, absoluten Ordner: gelesen werden nur `cost-ledger-<id>.json`, geschrieben nur
// die eigene Datei. Die Rechte-Zeile kennt keine Pfade (en/reference.md:181), deshalb setzt das der Code durch.

const deviceDefault = (id: string) => T[settings.lang].deviceDefault(id)

/** Sync-Einstellung dieses Geräts aus `$.store`; `null` = Sync aus. */
async function syncConfig($: EngineInterface): Promise<SyncCfg | null> {
  const s = cleanSync(await $.store.get('meta:sync'))
  if (!s) return null
  const device = cleanDevice(await $.store.get('meta:device'), deviceDefault)
  return device ? { dir: s.dir, device } : null
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
  const text = buildFile(cfg.device, since, recs, at)
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
  const info: SyncInfo = { on: true, devices: 1, unreadable: 0, error: '', dupId: false }
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
      await $.store.set('meta:device', cfg.device)
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
  info.unreadable = p.unreadable
  info.devices = 1 + p.peers.length
  const starts = [since, ...p.peers.map((f) => f.since)].filter((x): x is number => typeof x === 'number')
  return { recs: mergeRecs(own, p.peers, now - settings.keepDays * DAY), since: starts.length ? Math.min(...starts) : null, info }
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
    if (!cfg) return t.syncOffState
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
    await $.store.delete('meta:sync')
    return t.syncOffDone
  }
  const now = await $.clock.now()
  if (first === NAME_WORD) {
    const raw = rest.slice(rest.indexOf(words[0]!) + words[0]!.length).trim()
    if (!raw) return t.syncNameMissing
    const old = cleanDevice(await $.store.get('meta:device'), deviceDefault)
    const id = old?.id ?? newDeviceId()
    const device = { id, name: cleanDeviceName(raw, id, deviceDefault) }
    await $.store.set('meta:device', device)
    const cfg = await syncConfig($)
    if (cfg)
      try {
        await $.fs.list(cfg.dir)
        const own = await ownRecs($)
        await writeOwn($, cfg, own.recs, own.since)
      } catch (err) {
        return `${t.syncNamed(device.name)}\n\n${t.syncFailed(msg(err))}`
      }
    return t.syncNamed(device.name)
  }
  const dir = validDir(rest, /^[A-Za-z]:/.test(await $.session.root()))
  if (!dir) return t.syncInvalid(rest.trim())
  let device = cleanDevice(await $.store.get('meta:device'), deviceDefault) ?? { id: newDeviceId(), name: '' }
  if (!device.name) device = { id: device.id, name: deviceDefault(device.id) }
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
  await $.store.set('meta:device', device)
  await $.store.set('meta:sync', { v: 1, dir, at: now })
  let n = 0
  try {
    n = (await readPeers($, { dir, device }, await $.fs.list(dir))).peers.length
  } catch (err) {
    log($, `Sync lesen: ${msg(err)}`)
  }
  return `${t.syncOn(dir, device.name, n, renewed)}\n\n${t.syncPrivacy}`
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
    carry = {}
    carryAt = 0
    pendingGap = 0
    gapAt = undefined
    limSinceChecked = false
    reports.clear()
  })
  // Löschen außerhalb der Kette: Mod-Aufrufe warten nur auf das eigene Schreiben (SPEC Verhalten 5).
  // `meta:plan` bleibt: eine Einstellung, keine Buchung (SPEC Nachtrag 0.5.0, Verhalten 5); ebenso Sync und Gerät (0.7.0)
  const keep = ['meta:resetAt', 'meta:plan', 'meta:sync', 'meta:device', 'meta:syncAt']
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

  on('session.start', async ($, e, next) => {
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
        argumentHint: '[weeks|chats|projects|models|limits|plan|sync|reset|help]',
      })
    } catch (err) {
      log($, `/ledger nicht registriert: ${msg(err)}`)
    }
    return next(e)
  })

  // Session-ID und Titel; /clear, /resume und /branch wechseln die Session ohne neues session.start (interface.md:786)
  on('classic.SessionStart', async ($, e, next) => {
    try {
      await serial(async () => {
        if (e.session_id && e.session_id !== sessionId) await bind($, e.session_id, e.source, e.session_title)
        else if (e.session_title && e.session_title !== title) {
          title = e.session_title
          titleDirty = true
          titleFromSession = true
        }
      })
    } catch (err) {
      log($, `SessionStart: ${msg(err)}`)
    }
    return next(e)
  })

  // Titel nur merken; geschrieben wird beim nächsten Buchen. Nach einem Modul-Reload feuert nur session.start, nicht
  // classic.SessionStart (types:4173-4178, interface.md:789): dann bindet die Session-ID von hier (BaseHookInput)
  on('classic.UserPromptSubmit', async ($, e, next) => {
    try {
      await serial(async () => {
        if (e.session_id && e.session_id !== sessionId) await bind($, e.session_id, undefined, e.session_title)
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
      if ('value' in r) await serial(() => bookCall($, next.origin?.plugin, e.model, r.value.usage, false, true))
    } catch (err) {
      log($, `Mod-Aufruf: ${msg(err)}`)
    }
    return r
  })

  on('model.fork', async ($, e, next) => {
    const r = await next(e)
    try {
      // Der Fork läuft auf dem Modell der Hauptschleife; „nothing-to-fork“ hat keine Usage und kostet nichts
      if ('value' in r && 'usage' in r.value) await serial(() => bookCall($, next.origin?.plugin, lastModel, r.value.usage, false))
    } catch (err) {
      log($, `Mod-Aufruf: ${msg(err)}`)
    }
    return r
  })

  // classify liefert nur einen String ohne Usage: nur die Anzahl zählt (types:6539-6546, :6871)
  on('model.classify', async ($, e, next) => {
    const r = await next(e)
    try {
      if ('value' in r) await serial(() => bookCall($, next.origin?.plugin, '', undefined, true))
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
    // Hilfe: nur das erste Wort, ohne weitere Wörter (docs/HELP-SPEC.md §2)
    if (HELP_WORDS.includes(what)) return { text: rest.length ? t.unknownArg(e.args.trim()) : await helpCommand($, e.args) }
    // Speicher voll o. Ä.: ein lesbarer Hinweis statt einer Fehlerzeile (Review 0.5.0 K1)
    if (what === 'reset' || what === 'plan' || what === SYNC_WORD) {
      try {
        if (what === SYNC_WORD) return { text: await syncCommand($, e.args.trim().slice(sub.length).trim()) }
        return { text: what === 'reset' ? await reset($) : await planCommand($, rest) }
      } catch (err) {
        log($, `/ledger ${what}: ${msg(err)}`)
        return { text: t.writeFailed(msg(err)) }
      }
    }
    if (what && !VIEW_WORDS.includes(what)) return { text: t.unknownArg(sub) }
    try {
      await serial(() => measure($)) // den laufenden Chat mitzählen
    } catch (err) {
      log($, `Buchen vor /ledger: ${msg(err)}`)
    }
    const views: Record<string, View['view']> = { chats: 'chats', projects: 'projects', models: 'models', weeks: 'weeks', limits: 'limits' }
    const view = views[what] ?? 'overview'
    const range = view === 'overview' || view === 'weeks' || view === 'limits' ? 30 : parseRange(arg)
    const now = await $.clock.now()
    const data = await collect($, now)
    // Andere Geräte dazu; ohne Sync oder bei Fehlern bleibt es beim lokalen Kostenbuch
    let recs = data.recs
    let since = data.since
    let sync: SyncInfo | undefined
    try {
      const cfg = await syncConfig($)
      if (cfg) ({ recs, since, info: sync } = await syncRound($, cfg, data.recs, data.since, now))
    } catch (err) {
      log($, `Sync: ${msg(err)}`)
    }
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
    const tag = remember(now, { kind: 'ledger', view: { report, view, range }, args: normArgs(e.args) })
    return { text: summaryText(report, view, range, tag, settings.lang) }
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
    return d.kind === 'help' ? helpTree(d.data, columns, e.surface, ACCENT) : ledgerTree(d.view, settings, columns, e.surface)
  })
}
