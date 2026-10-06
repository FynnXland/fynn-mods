// cost-ledger: Kostenbuch über alle Chats. Reiner Beobachter: bucht nach jedem Turn die Differenz von `usage().cost.usd`,
// dazu die Modellaufrufe anderer Mods, und zeigt per /ledger eine Übersicht (Sprache aus userConfig `language`).
// Fail-open: Jeder Erfassungs-Hook gibt das Ergebnis von `next` unverändert zurück, Fehler gehen nur ins Debug-Log; kein `.catch`.
// Ein $.store-Schlüssel pro Session (`s:<sessionId>`), den nur diese Session schreibt: $.store ist nicht atomar (CHEATSHEET).
import type { EngineInterface, On } from 'claude-code'
import { T } from './i18n.ts'
import {
  NO_FOLDER,
  aggregate,
  baselineFor,
  bookChat,
  bookMod,
  bookModel,
  bookRate,
  bookTurn,
  cleanRemote,
  callCost,
  cleanRec,
  cleanSettings,
  dayKey,
  DAY,
  deltaOf,
  newRec,
  parseRange,
  pluginName,
  projectOf,
  summaryText,
  titleFromPrompt,
  tokensOf,
} from './logic.ts'
import type { Kind, Rec, Settings, TurnInfo, Usage } from './logic.ts'
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
const reports = new Map<string, View>() // Kennung im Text → Daten der Zeichnung, höchstens 10
let reportNo = 0
let chain: Promise<unknown> = Promise.resolve() // Messen und Schreiben dieser Session nacheinander
let writeError = '' // letzter Schreibfehler (z. B. Speicher voll), /ledger zeigt ihn

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
  if (!rec) return
  const at = await $.store.get('meta:resetAt')
  if (typeof at === 'number' && rec.lastAt < at) {
    rec.days = {}
    rec.mods = {}
    rec.models = {}
    rec.modModels = {}
    rec.act = {}
    rec.hours = {}
    rec.rl = {}
  }
}

/**
 * An eine Session binden. Mitten im Prozess (`started`): bei /clear beginnt der Zähler bei 0 (types:11148-11151), sonst
 * (Resume, Branch, Reload) wird die Baseline beim nächsten Messen aus dem Datensatz gesetzt.
 */
async function bind($: EngineInterface, id: string, source: string | undefined, newTitle: string | undefined) {
  sessionId = id
  rec = await load($, id)
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
  if (turn || delta > 0) bookRate(r, dayKey(now), u.rateLimits)
  rec = r
  titleDirty = false
  await save($)
}

/** Modellaufruf eines anderen Mods buchen (SPEC Verhalten 5). `usage` steht auf jedem Zweig des Ergebnisses (types ModelCompleteResult). */
async function bookCall($: EngineInterface, origin: string | undefined, model: string, usage: unknown, countOnly: boolean) {
  const name = pluginName(origin ?? '')
  if (!name || name === 'engine' || name === SELF || !sessionId) return
  const now = await $.clock.now()
  const amount = countOnly ? 0 : callCost(usage as Parameters<typeof callCost>[0], model)
  await honorReset($)
  rec ??= newRec({ ...meta, title }, now, seen)
  bookMod(rec, name, dayKey(now), amount, now, countOnly ? undefined : (usage as Usage | undefined))
  if (!countOnly) bookModel(rec, model, dayKey(now), usage as Usage | undefined, now, 'modModels')
  await save($)
}

/**
 * Alle Datensätze lesen; dabei alte löschen (älter als `keepDays` seit der letzten Buchung). Das Aufräumen liegt hier und
 * nicht im awaiteten session.start, weil `/ledger` ohnehin jeden Datensatz liest. `bytes` schätzt die Größe des Speichers
 * (4 MiB JSON insgesamt, docs/raw/en/reference.md:259).
 */
async function collect($: EngineInterface, now: number) {
  const recs: { id: string; rec: Rec }[] = []
  let unreadable = 0
  let bytes = 0
  const cutoff = now - settings.keepDays * DAY
  await honorReset($) // Reset aus einem anderen Chat auch ohne neue Buchung beachten
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    bytes += key.length + (JSON.stringify(value ?? null)?.length ?? 0)
    if (!key.startsWith('s:')) continue
    const id = key.slice(2)
    // Eigener Datensatz aus dem Speicher: der ist mindestens so frisch wie der gespeicherte
    const r = id === sessionId && rec ? rec : cleanRec(value)
    if (!r) unreadable++
    else if (id !== sessionId && r.lastAt < cutoff) await $.store.delete(key)
    else recs.push({ id, rec: r })
  }
  const hasData = (r: Rec) => [r.days, r.mods, r.models, r.modModels, r.act].some((x) => Object.keys(x).length > 0)
  if (rec && sessionId && hasData(rec) && !recs.some((x) => x.id === sessionId)) recs.push({ id: sessionId, rec })
  const since = await $.store.get('meta:since')
  return { recs, unreadable, bytes, since: typeof since === 'number' ? since : null }
}

async function reset($: EngineInterface): Promise<string> {
  const t = T[settings.lang]
  let answer: string
  try {
    // Empfohlene Antwort auf Platz 1 (Fynns Regel für Rückfragen); in -p wird ask abgelehnt (API-DETAILS.md:149-154)
    answer = await $.ui.ask(t.askQuestion, [t.askCancel, t.askDelete])
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
    reports.clear()
  })
  // Löschen außerhalb der Kette: Mod-Aufrufe warten nur auf das eigene Schreiben (SPEC Verhalten 5)
  let n = 0
  for (const key of await $.store.keys()) {
    if (key === 'meta:resetAt' || (!key.startsWith('s:') && !key.startsWith('meta:'))) continue
    await $.store.delete(key)
    if (key.startsWith('s:')) n++
  }
  await $.store.set('meta:since', now)
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
        rebase = false
        started = true
        if ((await $.store.get('meta:since')) === undefined) await $.store.set('meta:since', await $.clock.now())
      })
    } catch (err) {
      log($, `Start: ${msg(err)}`)
    }
    try {
      await $.command.register({ name: 'ledger', description: T[settings.lang].commandDescription, argumentHint: '[days|weeks|chats|projects|models|reset|help]' })
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
    return r
  })

  // Modellaufrufe anderer Mods: `next(e)` liefert `{ value }` oder `{ deny }` (types OpEventResult). Nie ändern, nie verzögern
  // außer um das eigene Schreiben; den eigenen Hook überspringt die Engine ohnehin (types OpEventOf).
  on('model.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if ('value' in r) await serial(() => bookCall($, next.origin?.plugin, e.model, r.value.usage, false))
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
    const [sub = '', arg] = e.args.trim().split(/\s+/)
    const what = sub.toLowerCase()
    if (what === 'help' || what === 'hilfe') return { text: t.help }
    if (what === 'reset') return { text: await reset($) }
    if (what && !['chats', 'projects', 'models', 'weeks', 'days'].includes(what)) return { text: `${t.unknownArg(sub)}\n${t.help}` }
    try {
      await serial(() => measure($)) // den laufenden Chat mitzählen
    } catch (err) {
      log($, `Buchen vor /ledger: ${msg(err)}`)
    }
    const view: View['view'] = what === 'chats' ? 'chats' : what === 'projects' ? 'projects' : what === 'models' ? 'models' : what === 'weeks' ? 'weeks' : 'overview'
    const range = view === 'overview' || view === 'weeks' ? 30 : parseRange(arg)
    const now = await $.clock.now()
    const data = await collect($, now)
    const report = aggregate(data.recs, now, { range, unreadable: data.unreadable, hasCost, since: data.since, storeBytes: data.bytes, writeError })
    // Eindeutige Kennung im Text: ui.render findet darüber die Daten der Zeichnung (SPEC Verhalten 7)
    const tag = `#${(++reportNo).toString(36)}${now.toString(36).slice(-5)}`
    reports.set(tag, { report, view, range })
    while (reports.size > 10) reports.delete(reports.keys().next().value as string)
    return { text: summaryText(report, view, range, tag, settings.lang) }
  })

  // Die Übersicht: ein eigener Baum statt der Markdown-Zeile; „a hook's own tree draws in the row's place“ (types
  // CommandOutput). `command` gehört zu den Props, daher `props: { command }` im Matcher (oben auf `e` feuert er nie).
  on('ui.render', { component: 'CommandOutput', props: { command: 'ledger' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const v = tag ? reports.get(tag) : undefined
    // Unbekannt (nach Neustart, alte Zeile, help, reset): die Engine zeichnet den Markdown-Text
    if (!v) return next(e)
    return ledgerTree(v, settings, e.viewport?.columns ?? 100, e.surface)
  })
}
