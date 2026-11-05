// limit-bars: Hooks-Modul. Im Band über dem Prompt (AbovePrompt, docs/raw/en/interface.md:207-213) zwei schmale Balken für das
// 5-Stunden- und das Wochenlimit und rechts daneben ein Ring, wie lange der Prompt-Cache dieser Session noch warm ist.
// Limits: `$.session.usage()` beim Start und bei jedem Tick, dazu `session.measure` (types@2.1.288:10410-10436); der neueste Stand
// aller Chats auf dem Rechner liegt in `$.store` unter `limits` (docs/raw/en/reference.md:221).
// Cache: `turn.step` der Hauptschleife (usage mit cache_read/cache_creation, types@2.1.289:12837-12869), gespeichert in `$.store`.
// Dazu die Cache-Wache nach Nate Herks Cache Keeper (docs/vorlagen/nateherk-cache-keeper, MIT): Rückfrage vor kaltem Senden,
// Hinweis kurz vor Ablauf, /cache, /handoff mit Skill „uebergabe“, /keepwarm (Standard aus).
// Texte en/de nach `userConfig.language` (i18n.ts); Argumente englisch, die deutschen gelten weiter als Alias.
// Fail-open: Ein Fehler heißt nur „keine Anzeige“ bzw. „Nachricht geht unverändert durch“; was andere Mods zeichnen, bleibt erhalten.
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { joinBand, slot, SLOTS, splitBand } from './band.ts'
import {
  DEFAULT_SETTINGS,
  MIN,
  applySetting,
  cacheReport,
  cacheState,
  cleanMem,
  cleanSettings,
  emptyMem,
  inputCost,
  observeStep,
  pingDue,
  pingMissed,
  readCost,
  rewriteCost,
  ringFor,
  spanText,
  terminalBlock,
  tokensText,
  ttlOf,
} from './cache.ts'
import type { CacheMem, KeepWarm, ReportLimit, Settings, StepUsage } from './cache.ts'
import { BARS_HINT, CACHE_ARGS, CACHE_HINT, HANDOFF_HINT, T, hhmm, langOf, usd } from './i18n.ts'
import {
  DISK_WORDS,
  HELP_WORDS,
  HANDOFF_CONTINUE_WORDS,
  HANDOFF_SHOW_WORDS,
  KEEP_OFF_WORDS,
  PARTS,
  cleanOverrides,
  cleanStyle,
  displayFromOptions,
  effectiveDisplay,
  isHelp,
  parseBars,
  styleFromOptions,
} from './display.ts'
import type { Display, Overrides, Style } from './display.ts'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { HELP_ACCENT, barsHelpData } from './helpdata.ts'
import type { Lang } from './i18n.ts'
import { isLanguage, languageCommand } from './language.ts'
import { ringFilled } from './ring.ts'
import {
  PROBE_SCRIPT,
  PS_ABS,
  SCAN_SCRIPT,
  diskView,
  driveOf,
  parseProbe,
  parseScan,
  storageMarkdown,
  storageReport,
  storageSvg,
  storageTerminal,
} from './storage.ts'
import type { Drive, Scan, StorageReport } from './storage.ts'
import { desktopSvg } from './svg.ts'
import { cleanHere, costBlock, costFilled, costText, costView } from './cost.ts'
import type { Here } from './cost.ts'
import { CELL_W, SYS_SCRIPT, cellText, levelColor, parseSample, sysTermWidth, sysView, takeLines, termColumns } from './system.ts'
import type { Sample } from './system.ts'
import {
  GREY,
  NO_FIVE_AFTER,
  ORANGE,
  barRuns,
  cleanShared,
  lacksFive,
  layoutTerminal,
  mergeWins,
  nextMiss,
  pickWindows,
  placeholderWindows,
  sharedMiss,
  shownWindows,
  withPace,
} from './view.ts'
import type { Opts, ResetStyle, Shared, Shown, Win } from './view.ts'

// Optionen aus userConfig, in register() gesetzt
let lang: Lang = 'en'
let opts: Opts = { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang }
// Welche Teile zu sehen sind (display.ts): userConfig, darüber die `/bars`-Werte aus `$.store` (`display`), die jeder Takt
// neu liest, damit ein `/bars` in einem anderen Chat hier binnen 2 s wirkt
let baseDisplay: Display = displayFromOptions({})
let overrides: Overrides = {}
const shownParts = () => effectiveDisplay(baseDisplay, overrides)
let displayPinned = false // /bars konnte nicht speichern: der lokale Wert gilt, der Takt liest ihn nicht neu
// Balken oder Ringe (Ausbau 0.10.0): userConfig `style`, darüber `/bars style` (`display.style` im Store); Ringe nur im Desktop
let baseStyle: Style = 'bar'
let styleOverride: Style | undefined
const styleNow = (): Style => styleOverride ?? baseStyle
// Zuletzt gezeichnete Oberfläche: `/bars style ring` sagt im Terminal, dass Ringe nur im Desktop erscheinen (command.run nennt
// keine Oberfläche, types@2.1.295 CommandRunInput)
let lastSurface: string | null = null
/** Was unter `display` gespeichert wird: die Schalter und, falls per Befehl gesetzt, der Stil. */
const displayValue = () => (styleOverride ? { ...overrides, style: styleOverride } : { ...overrides })

// Limits: flüchtig (Kontingent gehört zum Konto und kommt mit jeder Messung neu)
let wins: Win[] = []
let usageAsked = false
// Gemeinsamer Stand (Ausbau 0.8.0): `usage()` kennt nur die letzte API-Antwort DIESES Chats (types@2.1.295:11722). Ändert sich die
// eigene Messung, kam eine neue Antwort: dann `{at, wins}` nach `$.store` `limits`. Jeder Tick übernimmt von dort, was neuer ist.
let winsAt = 0 // wann der angezeigte Stand gemessen wurde (eigene Antwort oder ein anderer Chat)
let ownKey = '' // die zuletzt gesehene eigene Messung
// Kein 5h-Limit (Ausbau 0.10.0): Messungen in Folge mit `seven_day`, aber ohne `five_hour`; geteilt in `limits.miss`.
// Ab NO_FIVE_AFTER (zwei) zeigt die obere Zeile das Wochen-Tempo.
let fiveMiss = 0
const noFiveHour = () => fiveMiss >= NO_FIVE_AFTER && lacksFive(wins)
const sharedValue = (at: number, w: Win[], miss: number): Shared => (miss > 0 ? { at, wins: w, miss } : { at, wins: w })
// Takt, nur solange das Band gezeichnet wird (Timer mit cancel(), types@2.1.288:11912-11917; eine abgelehnte Periode beendet ihn,
// types@2.1.288:3251). Jeder Tick holt `$.session.usage()`: Das sind die Werte der letzten API-Antwort (types@2.1.288:11033-11034), also
// auch mitten in einem langen Turn, während `session.measure` erst am Turn-Ende kommt (Fynn, 2026-10-05: "aktualisiert viel zu selten").
// Der Takt läuft auch ohne Daten. Neu gezeichnet wird nur, wenn sich etwas Sichtbares ändert (Fynn, 2026-10-05: Jedes
// Invalidate zeichnet das ganze Band neu, auch die Knöpfe anderer Mods, die dann beim Darüberfahren flackerten).
// 2 s statt 10 s seit 0.8.0 (Fynn, 2026-10-19: Änderungen am Kontingent sofort sehen); gezeichnet wird weiter nur bei Änderung.
const TICK = 2000
let timer: Timer | null = null
let drawnKey = '' // was zuletzt gezeichnet wurde (Texte, Farben, Füllstufen)
let awaitingRender = false // ein Neuzeichnen ist angefordert, aber noch nicht gekommen
let lastTick = 0 // Uhrzeit des letzten Ticks (bzw. des Starts)
// Lehnt eine Claude-Code-Version das Umschreiben von bodyColumns ab, stapelt limit-bars danach über dem Rest (SPEC.md, Phase 0)
let noRewrite = false

// Cache dieser Session. `mem` liegt in `$.store` unter `cache:<sessionId>`, damit der Ring nach Neustart oder Reload weiß, wie warm er ist.
let sessionId = ''
let mem: CacheMem = emptyMem()
let settings: Settings = { ...DEFAULT_SETTINGS }
let justCompacted = false
let working = false // ein Turn der Hauptschleife läuft (turn.step … turn.complete)
let currentTurn = ''
let cold = { count: 0, usd: 0 } // kalte Neustarts dieser Sitzung
let last: { read: number; written: number; at: number } | null = null
let sessionUsd: number | null = null
let alerted = 0 // lastActivity, für die der Hinweis „läuft bald ab“ schon kam
// Warmhalten: Standard aus, eigener 30-s-Takt nur solange an (es muss auch laufen, wenn das Band nicht gezeichnet wird)
let keep: KeepWarm | null = null
let keepTimer: Timer | null = null
// Chat, zu dem `keep` gehört. `keep` liegt zusätzlich in `$.store` unter `keep:<sessionId>`: Ändert `/… language` (aus
// irgendeiner fynn-mod) die Einstellungen, lädt die Engine limit-bars neu, Modul-Variablen und Takt sind dann weg.
// `session.start` der neuen Instanz nimmt das Warmhalten wieder auf (SPEC Nachtrag 0.11.0).
let keepFor = ''
let pinging = false
let forking = false // ein Warmhalte-Ping ist unterwegs
// Übergabe: /handoff startet den Skill, turn.complete fängt dessen Antwort ab
const H = { pending: false, armed: false, notTurn: '', text: '', continuing: false }

// Speicher-Ring (SPEC.md, Ausbau v0.4.0): Laufwerk aus `userConfig.storagePath` (leer = aus, nur Windows). Gesamt/frei über
// `probe`, Bytes je Dateiart über `scan` (beides `powershell.exe` per `$.process.run`, Pfad nur über LB_PATH). Der Stand liegt
// in `$.store` unter `storage`, damit der Ring nach einem Neustart sofort da ist und der Scan nur einmal am Tag läuft.
let storagePath = ''
let disk: { d?: Drive; scan?: Scan } = {}
let diskLoaded = false
let diskStarted = false // startDisk angestoßen (von session.start oder, falls das die Oberfläche nicht nannte, vom ersten Zeichnen)
let scanRun: Promise<void> | null = null
// Gesamt/frei alle 10 min, nach Uhrzeit statt nach Tick-Zahl: ein Neustart des Takts setzt sie nicht zurück (Review 0.8.0, K3)
const PROBE_MS = 10 * 60000
let probedAt = 0 // Start der letzten Probe; 0 = der Start des Rings hat noch nicht geprobt
const SCAN_MAX_AGE = 60 * 60000 // /disk scannt neu, wenn der letzte Scan älter ist
const SCAN_LOCK = 5 * 60000 // ein Scan, der in einer anderen Sitzung gerade läuft, gilt so lange als laufend
const SCAN_PAUSE = 24 * 60 * 60000 // nach einem gescheiterten Scan keine automatischen Scans (/disk refresh geht immer)
// Daten der /disk-Ansichten für das Zeichnen der Befehlszeile (Kennung im Text, wie cost-ledger /ledger)
// Kostenring (Ausbau 0.12.0): zuletzt gelesener Wert von `cost-ledger.here`; null = keiner (cost-ledger fehlt oder schrieb nichts)
let costHere: Here | null = null
// CPU/RAM-Säulen (Ausbau 0.12.0): nur Windows (Laufwerksbuchstabe im Arbeitsordner der Sitzung oder in storagePath)
let isWindows = false
// Systemwerte (Ausbau 0.13.0): ein dauerhafter PowerShell-Prozess je Chat, solange das Band gezeichnet wird und die Liste an ist
let sysCur: Sample | undefined // letzte Messung
let sysPrev: Sample | undefined // die davor, für den Trendpfeil
let sysStream: { return: (v?: never) => Promise<unknown> } | null = null
let sysStartedAt = 0 // Start des laufenden Prozesses, für den Wächter
// Im Terminal passt die Liste neben langen Limits nicht in die 44 Spalten: dann kein Prozess und kein Neuzeichnen für sie
// (Review 0.13.0 S2). Gesetzt beim Zeichnen; `undefined` = noch nicht gezeichnet
let sysVisible: boolean | undefined
const SYS_STALL = 30_000 // so lange ohne neue Zeile: Prozess hängt, beenden (Review 0.13.0 S3)
let sysFails = 0 // Fehlstarts in Folge (Prozess endet ohne eine Messung)
let sysPausedUntil = 0
let sysErr = ''
let sysErrAt = 0
let lastRenderAt = 0 // letztes Zeichnen des Bands: ohne Zeichnen endet der Prozess
const SYS_FAILS = 3
const SYS_PAUSE = 60 * 60_000
const SYS_IDLE = 15_000 // so lange ohne Zeichnen, dann endet der Prozess

const reports = new Map<string, StorageReport>()
let reportNo = 0
// /bars help: Schnappschuss je Aufruf, höchstens 10 (docs/HELP-SPEC.md §3, templates/help/README.md)
const helps = new Map<string, HelpData>()
let helpNo = 0
// userConfig, wie register() sie bekommt: für die Spalte EINSTELLUNGEN der Hilfe
let rawOptions: Readonly<Record<string, unknown>> = {}

/** Schnappschuss unter einer neuen Kennung `#…` ablegen; die älteste fällt heraus. */
function rememberHelp(now: number, data: HelpData): string {
  const tag = `#${(++helpNo).toString(36)}${now.toString(36).slice(-5)}`
  helps.set(tag, data)
  while (helps.size > 10) helps.delete(helps.keys().next().value as string)
  return tag
}

const STYLES: readonly ResetStyle[] = ['mixed', 'clock', 'countdown']
const KEEP_MAX_H = 4
const SKILL = /(^|:)uebergabe$/
// Überschrift der Übergabe in beiden Sprachen (skills/uebergabe/SKILL.md); wie bisher auch als `##`/`###`
const HANDOFF_TITLE = /^#{1,3} (Handoff|Übergabe)\b/m

const msg = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 140)

/**
 * Einmal `fn` nach `ms`, außerhalb des aufrufenden Hooks. Aus einem command.run-Hook lehnt der Host `$.command.run` und
 * `$.prompt.submit` ab (SPEC, Bau v0.2.0); ein Timer über das schon genehmigte `$.clock.every` kommt heraus (statt `$.clock.after`).
 */
function later($: EngineInterface, ms: number, fn: () => void) {
  const t = $.clock.every(ms, () => {
    t.cancel()
    fn()
  })
}

/** Limits einmal abholen (ohne `breakdown` kostenlos, types@2.1.288:11048-11056); abgelehnt: die nächste Messung füllt sie. */
async function loadWindows($: EngineInterface): Promise<void> {
  usageAsked = true
  try {
    const now = await $.clock.now()
    const fresh = pickWindows((await $.session.usage()).rateLimits)
    if (fresh.length > 0 && !ownKey) await takeBaseline($, fresh, now)
  } catch {
    // kein eigener Anfangsstand
  }
  // Vor der ersten eigenen Antwort: der Stand eines anderen Chats
  await readShared($)
}

/**
 * Erste eigene Messung nach dem Laden des Moduls (Start oder `/reload-plugins`, das die Modulvariablen leert,
 * docs/raw/en/interface.md:736): Ihr Alter ist unbekannt, nach einem Reload kann die letzte Antwort Stunden alt sein
 * (Review 0.8.0, S1). Deshalb je Fenster mit dem gemeinsamen Stand abgleichen; abgelegt wird nur, was sie Neueres bringt.
 */
async function takeBaseline($: EngineInterface, fresh: Win[], now: number): Promise<void> {
  ownKey = JSON.stringify(fresh)
  let s: Shared | undefined
  try {
    s = cleanShared(await $.store.get('limits'))
  } catch {
    // ohne gemeinsamen Stand gilt die eigene Messung
  }
  const merged = s ? mergeWins(s.wins, fresh) : fresh
  if (s && JSON.stringify(merged) === JSON.stringify(s.wins)) {
    wins = s.wins
    winsAt = s.at
    // Beide Zweige zählen vom gemeinsamen Stand aus, nicht vom lokalen: sonst zählte ein schon gelesener 0.9.0-Eintrag doppelt (Review K2)
    fiveMiss = sharedMiss(s, 0)
  } else {
    wins = merged
    winsAt = now
    fiveMiss = nextMiss(s ? sharedMiss(s, 0) : fiveMiss, merged)
    $.store.set('limits', sharedValue(now, merged, fiveMiss)).catch(() => {})
  }
  refresh($, now)
}

/**
 * Eigene Messung übernehmen, wenn sie sich geändert hat (neue API-Antwort dieses Chats), und für die anderen Chats ablegen.
 * Unverändert bleibt der Stand, den ein anderer Chat inzwischen neuer gemeldet hat. Leer: Fenster verschwinden, nichts abgelegt;
 * leer vor der ersten eigenen Messung heißt nur „noch keine Antwort“, dann bleibt der Stand eines anderen Chats.
 */
function takeOwn($: EngineInterface, fresh: Win[], now: number): void {
  const k = JSON.stringify(fresh)
  if (k === ownKey || (fresh.length === 0 && !ownKey)) return
  // Erste eigene Messung, auch wenn der Anfangsstand abgelehnt wurde: Alter unbekannt, also abgleichen (Review 0.8.0, K6)
  if (!ownKey) {
    takeBaseline($, fresh, now).catch(() => {})
    return
  }
  const prevAt = winsAt
  const prevMiss = fiveMiss
  ownKey = k
  wins = fresh
  winsAt = now
  fiveMiss = nextMiss(prevMiss, fresh)
  if (fresh.length === 0) return
  // Erst neu lesen, dann schreiben: Hat ein anderer Chat gerade neuer geschrieben, bleibt das stehen
  // (get + set sind nicht atomar, docs/raw/en/interface.md:848-855)
  $.store
    .get('limits')
    .then((v) => {
      const s = cleanShared(v)
      if ((s?.at ?? 0) > now) return undefined
      // Hat seit dem letzten Übernehmen ein anderer Chat geschrieben (z. B. eine Messung mit 5h-Fenster), zählt der Zähler von dort
      // weiter, nicht vom lokalen Stand (Review 0.10.0 K1)
      if (s && s.at > prevAt) {
        const miss = nextMiss(sharedMiss(s, prevMiss), fresh)
        if (winsAt === now) fiveMiss = miss
        return $.store.set('limits', sharedValue(now, fresh, miss))
      }
      return $.store.set('limits', sharedValue(now, fresh, fiveMiss))
    })
    .catch(() => {})
}

/** Den gemeinsamen Stand übernehmen, wenn ein anderer Chat neuer gemessen hat; abgelehnt: es bleibt beim eigenen. */
async function readShared($: EngineInterface): Promise<void> {
  try {
    const s = cleanShared(await $.store.get('limits'))
    if (s && s.at > winsAt) {
      wins = s.wins
      winsAt = s.at
      fiveMiss = sharedMiss(s, fiveMiss)
    }
  } catch {
    // eigener Stand
  }
}

/** Ein Tick: Session, /bars-Werte, eigene Messung, gemeinsamer Stand; neu gezeichnet wird nur bei sichtbarer Änderung. */
async function pollStep($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  lastTick = now
  await bindSession($)
  await readDisplay($)
  maybeStartDisk($)
  try {
    // Kostenlos ohne `breakdown`; leer heißt "noch keine Antwort", dann bleibt der bisherige Stand
    const u = await $.session.usage()
    const fresh = pickWindows(u.rateLimits)
    if (fresh.length > 0) takeOwn($, fresh, now)
    // Kontext zwischen den Turns (types@2.1.289:10406-10411); fehlt nach /clear und /compact bis zur nächsten Antwort
    if (mem.lastActivity && typeof u.context.tokens === 'number') mem = { ...mem, ctx: u.context.tokens }
    if (u.cost) sessionUsd = u.cost.usd
  } catch {
    // abgelehnt: es bleibt beim letzten eigenen Stand
  }
  await readShared($)
  await readCostState($)
  alertStep($, now)
  refresh($, now)
  sysStep($, now)
  // Speicher-Ring: Gesamt/frei alle 10 min (nur solange gezeichnet wird, wie der ganze Takt)
  if (probedAt > 0 && now - probedAt >= PROBE_MS && driveOf(storagePath) && shownParts().storage) {
    probedAt = now
    probeDisk($).catch(() => {})
  }
}

/** Gehört der Stand noch zu diesem Chat? Nach /clear oder /resume gibt es eine neue Session-ID: dann deren Stand laden. */
async function bindSession($: EngineInterface): Promise<void> {
  let id = ''
  try {
    id = await $.session.id()
  } catch {
    return
  }
  if (!id || id === sessionId) return
  const switched = sessionId !== ''
  sessionId = id
  mem = emptyMem()
  last = null
  justCompacted = false
  alerted = 0
  if (switched) {
    cold = { count: 0, usd: 0 }
    stopKeep($, T[lang].whyNewChat)
    // /clear, /resume, /branch leeren $.state (interface.md:760): die Breite beim nächsten Takt neu melden (Review 0.12.0 S2)
    publishedWidth = undefined
    publishedKey = ''
  }
  try {
    const saved = cleanMem(await $.store.get(`cache:${id}`))
    if (saved) mem = { lastActivity: saved.lastActivity, ttl: saved.ttl, ttlSource: saved.ttlSource, ctx: saved.ctx, model: saved.model }
  } catch {
    // ohne gespeicherten Stand: unbekannt bis zur ersten Anfrage
  }
  // Warmhalten nach einem Reload wieder aufnehmen (z. B. nach `/… language`); abgelaufen oder ungültig: Eintrag löschen
  if (keep) return
  try {
    const raw = await $.store.get(`keep:${id}`)
    if (raw === undefined) return
    const k = cleanKeep(raw, await $.clock.now())
    if (!k) {
      await $.store.delete(`keep:${id}`)
      return
    }
    keep = k
    keepFor = id
    keepTimer?.cancel()
    keepTimer = $.clock.every(30000, () => keepStep($))
    $.ui.invalidate('ui.render')
  } catch {
    // ohne gespeicherten Stand bleibt Warmhalten aus
  }
}

function persist($: EngineInterface, now: number) {
  if (!sessionId) return
  $.store.set(`cache:${sessionId}`, { ...mem, savedAt: now }).catch(() => {})
}

/** Einträge älter als 7 Tage aufräumen (SPEC, Persistenz). */
async function cleanup($: EngineInterface, now: number) {
  const all = await $.store.keys()
  const keys = all.filter((k) => k.startsWith('cache:')).slice(0, 200)
  for (const k of keys) {
    const m = cleanMem(await $.store.get(k))
    if (!m || now - m.savedAt > 7 * 24 * 60 * MIN) await $.store.delete(k)
  }
  // Warmhalte-Stände abgelaufener Chats (Prozess beendet, bevor das Warmhalten endete); der eigene laufende bleibt
  for (const k of all.filter((x) => x.startsWith('keep:')).slice(0, 200)) {
    if (k === `keep:${keepFor}` && keep) continue
    if (!cleanKeep(await $.store.get(k), now)) await $.store.delete(k)
  }
}

/** Warmhalte-Stand des Chats speichern bzw. löschen; Fehler nur schlucken (ohne Eintrag endet es mit einem Reload). */
function saveKeep($: EngineInterface) {
  if (!keepFor) return
  const key = `keep:${keepFor}`
  const done = keep ? $.store.set(key, { ...keep }) : $.store.delete(key)
  done.catch(() => {})
}

/** Gespeicherter Warmhalte-Stand, nur wenn er gültig ist und noch läuft. */
export function cleanKeep(v: unknown, now: number): KeepWarm | null {
  const k = v as Partial<KeepWarm> | null | undefined
  if (!k || typeof k.until !== 'number' || typeof k.pings !== 'number' || typeof k.usd !== 'number') return null
  if (!(k.until > now) || k.until - now > KEEP_MAX_H * 60 * MIN || k.pings < 0 || k.usd < 0) return null
  return { until: k.until, pings: k.pings, usd: k.usd }
}

function stopKeep($: EngineInterface, why: string) {
  if (!keep) return
  const k = keep
  keep = null
  keepTimer?.cancel()
  keepTimer = null
  saveKeep($)
  keepFor = ''
  $.ui.toast(T[lang].keepOff(why, String(k.pings), usd(k.usd, lang)), { timeoutMs: 10000 })
  $.ui.invalidate('ui.render')
}

/** Ein Takt des Warmhaltens: Ping per `$.model.fork` kurz vor Ablauf; schreibt er statt zu lesen, schaltet es sich ab. */
function keepStep($: EngineInterface) {
  if (!keep || pinging) return
  const t = T[lang]
  pinging = true
  $.clock
    .now()
    .then(async (now) => {
      if (!keep) return
      if (now >= keep.until) return stopKeep($, t.whyTimeUp)
      const ttl = ttlOf(mem, settings)
      if (working || !pingDue(mem.lastActivity, ttl, now)) return
      if (now - mem.lastActivity >= ttl * MIN) return stopKeep($, t.whyWasCold)
      forking = true
      // Nur die Antwort „ok“ zählt nicht, nur das Lesen des Caches; der Prompt bleibt deshalb einsprachig
      const r = await $.model.fork({ prompt: 'limit-bars keep-warm ping. Reply only with: ok' }).finally(() => {
        forking = false
      })
      if (!keep) return
      const u = (r as { usage?: StepUsage }).usage
      if (u) {
        keep.pings += 1
        keep.usd += inputCost(u, mem.model, ttl)
        saveKeep($)
      }
      // `usage` kommt auch bei einem gescheiterten Fork (api-error, aborted), dann meist mit Nullen (types@2.1.289:5976-5977):
      // nur eine Antwort, die wirklich aus dem Cache las, zählt als Warmhalten (Review S1)
      if (!u || (!r.isAnswered && r.reason !== 'empty-reply') || !(u.cache_read_input_tokens > 0)) {
        return stopKeep($, r.isAnswered || r.reason === 'empty-reply' ? t.whyNoRead : t.whyNoReply(String(r.reason)))
      }
      if (pingMissed(u)) return stopKeep($, t.whyRewrote(tokensText(u.cache_creation_input_tokens, lang)))
      mem = { ...mem, lastActivity: now }
      persist($, now)
      $.ui.invalidate('ui.render')
    })
    .catch((err) => stopKeep($, t.whyFailed(msg(err))))
    .finally(() => {
      pinging = false
    })
}

/** Hinweis, sobald ein großer Chat in die gelbe Phase geht; einmal je Phase (SPEC, Vorwarnung). */
function alertStep($: EngineInterface, now: number) {
  if (!settings.alerts || keep || mem.ctx < settings.bigTokens || alerted === mem.lastActivity) return
  const ttl = ttlOf(mem, settings)
  const st = cacheState(mem.lastActivity, ttl, now, false)
  if (st.kind !== 'cooling') return
  alerted = mem.lastActivity
  $.ui.toast(T[lang].alert(spanText(st.left, lang), tokensText(mem.ctx, lang), usd(rewriteCost(mem.ctx, mem.model, ttl), lang)), { timeoutMs: 20000 })
}

/** Die Übergabe ohne Vorrede vor der Überschrift (`# Handoff` bzw. `# Übergabe`). */
function handoffBody(answer: string): string {
  const t = String(answer || '').trim()
  const i = t.search(HANDOFF_TITLE)
  return i > 0 ? t.slice(i) : t
}

async function loadHandoffs($: EngineInterface): Promise<{ at: number; session: string; text: string }[]> {
  try {
    const v = await $.store.get('handoffs')
    return Array.isArray(v) ? v.filter((h) => h && typeof h.text === 'string' && typeof h.at === 'number') : []
  } catch {
    return []
  }
}

function captureHandoff($: EngineInterface, answer: string, now: number) {
  const t = T[lang]
  H.armed = false
  const body = handoffBody(answer)
  if (body.length < 200) {
    $.ui.toast(t.handoffEmpty, { timeoutMs: 8000 })
    return
  }
  H.text = body
  // Die letzten 3 Übergaben in `$.store`; scheitert /clear, holt `/handoff show` sie zurück
  loadHandoffs($)
    .then((list) => $.store.set('handoffs', [{ at: now, session: sessionId, text: body }, ...list].slice(0, 3)))
    .catch(() => {})
  // Nicht im Hook fragen: der Turn endet gerade, ein Dialog hielte ihn offen
  later($, 300, () => {
    $.ui
      // Die Frage endet mit „?“ (types@2.1.289:2340); Optionen tragen keine Beschreibung, darum steht die Erklärung im Fragetext
      .ask(t.handoffQuestion, { options: [t.clearGo, t.keepChat], header: t.handoffHeader })
      .then((a) => (a === t.clearGo ? clearAndContinue($) : undefined))
      .catch(() => $.ui.toast(t.handoffSavedLater, { timeoutMs: 12000 }))
  })
}

async function clearAndContinue($: EngineInterface) {
  const t = T[lang]
  if (H.continuing) return
  if (!H.text) {
    const list = await loadHandoffs($)
    if (!list[0]) {
      $.ui.toast(t.handoffNone, { timeoutMs: 8000 })
      return
    }
    H.text = list[0].text
  }
  if (working) {
    $.ui.toast(t.handoffBusy, { timeoutMs: 8000 })
    return
  }
  H.continuing = true
  const text = `${t.handoffPrefix}\n\n${H.text}`
  try {
    try {
      await $.command.run({ command: 'clear' })
    } catch (err) {
      $.ui.toast(t.clearFailed(msg(err)), { timeoutMs: 15000 })
      return
    }
    H.text = ''
    try {
      await $.prompt.submit({ text, asUser: true })
      // /clear startet eine neue Session, die alte bleibt erhalten (docs/raw/related/interactive-mode.md:276)
      $.ui.toast(t.handoffStarted, { timeoutMs: 8000 })
    } catch {
      $.ui.toast(t.handoffSendFailed, { timeoutMs: 15000 })
    }
  } finally {
    H.continuing = false
  }
}

/** Was Balken, Ringe und Terminal-Blöcke jetzt zeigen; gemeinsam für das Zeichnen und den Änderungsschlüssel. */
function snapshot(now: number) {
  const sh = shownParts()
  // Woche aus: wie das alte onlyFiveHour; 5h aus: danach herausfiltern (Platzhalter ebenso)
  const o: Opts = { ...opts, onlyFiveHour: !sh.weekly }
  const only = (list: Shown[]) => list.filter((x) => (x.tag === '5h' ? sh.fiveHour : sh.weekly))
  let shown = wins.length > 0 ? only(shownWindows(wins, now, o)) : []
  // Ohne 5h-Fenster: oben das Wochen-Tempo (Schalter 5h), am Wochenbalken der Strich (Ausbau 0.10.0)
  if (noFiveHour()) shown = withPace(shown, wins, now, lang, sh.fiveHour)
  const ttl = ttlOf(mem, settings)
  const st = cacheState(mem.lastActivity, ttl, now, !!keep)
  const big = mem.ctx >= settings.bigTokens
  const drive = driveOf(storagePath)
  const dv = sh.storage && drive && disk.d ? diskView(drive, disk.d, disk.scan, lang) : undefined
  const cv = sh.cost && costHere ? costView(costHere, lang) : undefined
  return {
    style: styleNow(),
    shown,
    // Desktop: ohne Limits Platzhalter (5h –, 7d –), damit die Balken sofort sichtbar sind; nur die eingeschalteten
    bars: wins.length > 0 ? shown : only(placeholderWindows(o)),
    ring: sh.cache ? ringFor(st, ttl, mem.ctx, big, lang) : undefined,
    block: sh.cache ? terminalBlock(st, big, lang) : null,
    disk: dv,
    diskBlock: dv ? `${dv.label} ${dv.main}${dv.sub}` : undefined,
    cost: cv && costHere ? { view: cv, filled: costFilled(cv, costHere.chatUsd) } : undefined,
    costBlock: cv ? costBlock(cv) : undefined,
    // Säulen schon vor der ersten Messung (gedimmt, „–“), damit die Breite im Band nicht springt
    sys: sh.system && isWindows ? sysView(sysCur, sysPrev, now, lang) : undefined,
  }
}

/** Alles, was im Band sichtbar ist, als Schlüssel: ändert er sich, muss neu gezeichnet werden, sonst nicht. */
function keyOf(v: ReturnType<typeof snapshot>): string {
  const r = v.ring
  return JSON.stringify([
    v.style,
    // Tempo nur mit gerundeten Werten (ganze Prozent, Uhrzeit auf 15 min, Strich auf ganze Prozent): Der 2-s-Takt zeichnet so
    // nicht öfter neu als nötig (SPEC.md, Ausbau 0.10.0, 2.)
    v.bars.map((x) => [
      x.tag,
      x.pct.long,
      x.reset?.long ?? '',
      x.color,
      x.strong,
      x.fresh,
      Math.round(x.ratio * 44),
      x.mark === undefined ? -1 : Math.round(x.mark * 100),
      x.markColor ?? '',
    ]),
    r ? [r.main, r.sub ?? '', r.subColor ?? '', r.color, r.mainColor, ringFilled(r.fill), r.kept] : null,
    v.block?.text ?? '',
    v.disk ? [v.disk.main, v.disk.sub, v.disk.arcs.map((a) => [a.color, Math.round(a.to * 360)])] : null,
    // Kosten auf den Cent bzw. die Kurzform, Säulen auf ganze Prozent (SPEC Ausbau 0.12.0, Tests „keyOf“)
    v.cost ? [v.cost.view.main, v.cost.view.sub, v.cost.filled, v.cost.view.grey] : null,
    v.sys && sysVisible !== false ? v.sys.rows.map((r) => [r.tag, r.pct, r.trend]) : null,
  ])
}

// ---------- Speicher-Ring ----------

type StoredDisk = { path: string; total: number; free: number; probedAt: number; scan?: Scan; scanStartedAt?: number; scanFailedAt?: number }

function storedDisk(v: unknown): StoredDisk | undefined {
  const s = v as StoredDisk | undefined
  if (!s || typeof s !== 'object' || typeof s.path !== 'string' || !(s.total > 0) || !(s.free >= 0)) return undefined
  return s
}

/**
 * Stand aus dem Store übernehmen, wenn er zum eingestellten Pfad gehört. Mehrere Sitzungen schreiben denselben Eintrag:
 * ein neuerer Scan (aus einer anderen Sitzung) ersetzt den eigenen, Gesamt/frei nur, solange noch keine eigene Probe da ist.
 */
async function readDisk($: EngineInterface): Promise<StoredDisk | undefined> {
  diskLoaded = true
  let s: StoredDisk | undefined
  try {
    s = storedDisk(await $.store.get('storage'))
  } catch {
    return undefined
  }
  if (!s || s.path !== storagePath) return undefined
  if (!disk.d) disk = { ...disk, d: { total: s.total, free: s.free } }
  if (s.scan && (!disk.scan || s.scan.at > disk.scan.at)) disk = { ...disk, scan: s.scan }
  return s
}

type DiskPatch = { scanStartedAt?: number | null; scanFailedAt?: number | null }
let saving: Promise<void> = Promise.resolve()

/**
 * Schreiben nach erneutem Lesen: Sperre und Fehlerzeit anderer Sitzungen bleiben, außer `patch` setzt (Zahl) oder löscht
 * (null) sie. Innerhalb der Sitzung nacheinander, damit eine Probe nicht die gerade gelöste Sperre zurückschreibt.
 */
function saveDisk($: EngineInterface, now: number, patch: DiskPatch = {}): Promise<void> {
  saving = saving.then(() => writeDisk($, now, patch))
  return saving
}

async function writeDisk($: EngineInterface, now: number, patch: DiskPatch): Promise<void> {
  const prev = await readDisk($)
  if (!disk.d) return
  const pick = (v: number | null | undefined, old: number | undefined) => (v === null ? undefined : (v ?? old))
  const v: StoredDisk = {
    path: storagePath,
    total: disk.d.total,
    free: disk.d.free,
    probedAt: now,
    scan: disk.scan,
    scanStartedAt: pick(patch.scanStartedAt, prev?.scanStartedAt),
    scanFailedAt: pick(patch.scanFailedAt, prev?.scanFailedAt),
  }
  try {
    await $.store.set('storage', v)
  } catch {
    // ohne Gedächtnis: der nächste Start fragt neu ab
  }
}

/**
 * Eines der festen Skripte über den absoluten Pfad `PS_ABS` (storage.ts); der Pfad nur über die Umgebung (SPEC: Datenquelle
 * und Sicherheit). Kein zweiter Versuch mit anderem Programm: eine Ablehnung durch einen Hook bleibt eine Ablehnung
 * (Review 0.4.0, S5). Fehler kommen übersetzt.
 */
async function runPs($: EngineInterface, script: string, timeoutMs: number): Promise<string> {
  const t = T[lang]
  const r = await $.process.run([PS_ABS, '-NoProfile', '-NonInteractive', '-Command', script], { env: { LB_PATH: storagePath }, timeoutMs })
  if (r.exitCode === 2) throw new Error(t.errMissing)
  if (r.exitCode === 3) throw new Error(t.errUnreadable)
  if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}${r.stderr.trim() ? `: ${r.stderr.trim().slice(0, 120)}` : ''}`)
  if (r.isStdoutTruncated) throw new Error(t.errTruncated)
  return r.stdout
}

/** Gesamt und frei holen (0,2 s); scheitert es, bleibt der letzte Stand. */
async function probeDisk($: EngineInterface): Promise<void> {
  probedAt = await $.clock.now()
  // Auch wenn session.start die Oberfläche nicht nannte: erst den Store lesen, sonst ginge der gespeicherte Scan verloren
  if (!diskLoaded) await readDisk($)
  const d = parseProbe(await runPs($, PROBE_SCRIPT, 30000))
  if (!d) throw new Error(T[lang].errNoData)
  disk = { ...disk, d }
  const now = await $.clock.now()
  await saveDisk($, now)
  refresh($, now)
}

/** Bytes je Dateiart (etwa 10 s Festplattenlast). Läuft nie doppelt: ein zweiter Aufruf wartet auf denselben Scan. */
function scanDisk($: EngineInterface): Promise<void> {
  if (scanRun) return scanRun
  scanRun = (async () => {
    const started = await $.clock.now()
    await saveDisk($, started, { scanStartedAt: started })
    let failed = false
    try {
      const s = parseScan(await runPs($, SCAN_SCRIPT, 120000), await $.clock.now())
      if (!s) throw new Error(T[lang].errNoData)
      disk = { ...disk, scan: s }
    } catch (err) {
      failed = true
      throw err
    } finally {
      // Sperre in jedem Fall lösen; ein gescheiterter Scan lässt den alten Stand stehen und pausiert die automatischen Scans
      const now = await $.clock.now()
      await saveDisk($, now, { scanStartedAt: null, scanFailedAt: failed ? now : null })
      refresh($, now)
    }
  })().finally(() => {
    scanRun = null
  })
  return scanRun
}

const dayOf = (ms: number) => new Date(ms).toDateString()

/** Darf ein automatischer Scan laufen? Nicht, wenn eine andere Sitzung gerade scannt oder ein Scan in den letzten 24 h scheiterte. */
function scanAllowed(s: StoredDisk | undefined, now: number): boolean {
  if (s?.scanStartedAt !== undefined && now - s.scanStartedAt < SCAN_LOCK) return false
  return !(s?.scanFailedAt !== undefined && now - s.scanFailedAt < SCAN_PAUSE)
}

/** Nach dem Sitzungsstart oder dem ersten Zeichnen: Stand frisch holen, einmal am Tag nach Dateiart scannen. */
async function startDisk($: EngineInterface): Promise<void> {
  diskStarted = true
  // Inzwischen per /bars ausgeblendet: kein PowerShell; ein späteres Einschalten startet neu (Review 0.6.0, S1)
  if (!shownParts().storage) {
    diskStarted = false
    return
  }
  await readDisk($)
  refresh($, await $.clock.now())
  await probeDisk($)
  const now = await $.clock.now()
  const s = await readDisk($)
  if (shownParts().storage && scanAllowed(s, now) && (!disk.scan || dayOf(disk.scan.at) !== dayOf(now))) await scanDisk($)
}

/** `/bars`-Werte aus dem Store; abgelehnt: es bleibt beim bisherigen Stand. */
async function readDisplay($: EngineInterface): Promise<void> {
  // Ließ sich ein /bars-Wert nicht speichern, gilt er in diesem Chat bis zum nächsten erfolgreichen Schreiben (Review 0.6.0, S2)
  if (displayPinned) return
  try {
    const v = await $.store.get('display')
    overrides = cleanOverrides(v)
    styleOverride = cleanStyle(v)
  } catch {
    // bisheriger Stand
  }
}

/** Speicher-Ring starten, wenn er gezeigt werden soll und noch nicht läuft (Sitzungsstart, erstes Zeichnen, Takt). */
function maybeStartDisk($: EngineInterface): void {
  if (diskStarted || !driveOf(storagePath) || !shownParts().storage) return
  diskStarted = true
  later($, 2000, () => void startDisk($).catch(() => {}))
}

/**
 * `cost-ledger.here` lesen (Ausbau 0.12.0). Im Zeichnen abonniert das den Wert: Schreibt cost-ledger neu, zeichnet die Engine
 * neu (types:3525-3529). Im Takt gelesen, damit die Breitenmeldung den Ring mitzählt. Kostenring aus: kein Lesen.
 */
async function readCostState($: EngineInterface): Promise<void> {
  if (!shownParts().cost) {
    costHere = null
    return
  }
  try {
    // `plugin` und `key` als Literale (validate listet sie: state reads)
    costHere = cleanHere((await $.state.get({ plugin: 'cost-ledger', key: 'here' })).value)
  } catch {
    // bisheriger Stand
  }
}

/**
 * Ausbau 0.14.0: Stellt sidekick die Kalt-Cache-Frage gerade selbst? Ja, wenn `sidekick.status.level` `cache` oder `guide` ist UND
 * `/sidekick` in `$.command.list()` steht. Der Wert in `$.state` lebt bis zum Ende der Sitzung (interface.md:762) und bliebe nach
 * einem Deaktivieren von sidekick womöglich stehen; die Befehlsliste nennt nur, was man „jetzt“ ausführen kann (types
 * `$.command.list`). Kein Wert, `off`, ein Lesefehler oder kein `/sidekick` heißt: sidekick fragt nicht, limit-bars fragt selbst.
 * Nur eine Bedingung beim Senden: Die eigene Einstellung wird nie umgeschrieben, `/cache warn off` bleibt aus.
 */
async function sidekickAsks($: EngineInterface): Promise<boolean> {
  try {
    // `plugin` und `key` als Literale (validate: state reads)
    const st = (await $.state.get({ plugin: 'sidekick', key: 'status' })).value
    if (st?.level !== 'cache' && st?.level !== 'guide') return false
    return (await $.command.list()).some((c) => c.name === 'sidekick' && c.source === 'plugin')
  } catch {
    return false
  }
}

/** Den Messprozess beenden (`return()` auf den Strom beendet das Kind, types `$.process.spawn`). */
function stopSys(): void {
  const s = sysStream
  sysStream = null
  try {
    s?.return().catch(() => {}) // ein Reject wäre sonst unbehandelt (Review 0.13.0 K1)
  } catch {
    // schon zu Ende
  }
}

/** Im Takt: Prozess starten, wenn die Liste gezeigt wird, unter Windows, ohne Pause; sonst beenden. Wächter gegen Hänger. */
function sysStep($: EngineInterface, now: number): void {
  if (!isWindows || !shownParts().system || sysVisible === false) return stopSys()
  // Liefert der Prozess 30 s lang keine Zeile (WMI oder nvidia-smi hängt), beenden; der nächste Takt startet neu
  if (sysStream && now - Math.max(sysStartedAt, sysCur?.at ?? 0) > SYS_STALL) stopSys()
  if (sysStream || now < sysPausedUntil) return
  // Nach einem Fehlstart erst in einer Minute wieder (wie 0.12.0, Review K4)
  if (sysErrAt && now >= sysErrAt && now - sysErrAt < 60_000) return
  sysStartedAt = now
  startSys($)
}

/**
 * Den festen Messprozess starten und seine Zeilen lesen. Jede Zeile ist eine Messung; neu gezeichnet wird nur bei sichtbarer
 * Änderung (`refresh`). Endet der Prozess ohne eine Messung, zählt das als Fehlstart; nach drei in Folge 1 h Pause.
 */
function startSys($: EngineInterface): void {
  // Fest: absoluter Pfad und dasselbe Skript, keine Argumente oder Umgebung von außen (README „Rights“)
  const stream = $.process.spawn({ argv: [PS_ABS, '-NoProfile', '-NonInteractive', '-Command', SYS_SCRIPT] })
  sysStream = stream
  void (async () => {
    let buf = ''
    let got = false
    let err = ''
    try {
      for await (const c of stream) {
        if (c.stream === 'stderr') {
          err = c.text.trim().slice(0, 120) || err
          continue
        }
        const r = takeLines(buf, c.text)
        buf = r.rest
        for (const line of r.lines) {
          const now = await $.clock.now()
          const sample = parseSample(line, now)
          if (!sample) continue
          got = true
          sysFails = 0
          sysPrev = sysCur
          sysCur = sample
          refresh($, now)
          // Neuzeichnen angefordert, aber 15 s keins gekommen (Chat verdeckt, Band eingeklappt): beenden; das nächste Zeichnen
          // startet neu. Nur mit offener Anforderung: Bei gleichbleibenden Werten zeichnet ohnehin nichts neu (Review 0.13.0 S1)
          if (awaitingRender && now - lastRenderAt > SYS_IDLE) stopSys()
        }
        if (sysStream !== stream) break
      }
      if (sysStream === stream && !got) {
        const res = await stream.result
        throw new Error(`exit ${res.code}${err ? `: ${err}` : ''}`)
      }
    } catch (e) {
      // Nur ein Ende, das nicht von hier kam, ist ein Fehler
      if (sysStream === stream) {
        sysFails += 1
        sysErr = msg(e)
        sysErrAt = await $.clock.now().catch(() => lastTick)
        if (sysFails >= SYS_FAILS) {
          sysFails = 0
          sysPausedUntil = sysErrAt + SYS_PAUSE
        }
      }
    } finally {
      if (sysStream === stream) sysStream = null
    }
  })()
}

// Breite des Platzes im Desktop (Pixel) für spotify: `$.state` `limit-bars.band` (types/index.d.ts, docs/BAND.md „Platzbreite“).
// `undefined` = noch nie geschrieben (der nächste Aufruf schreibt sicher, auch `null`). Nie im Zeichnen: ui.render darf nicht schreiben.
let publishedWidth: number | null | undefined = undefined
let publishedKey = '' // Änderungsschlüssel der Anzeige beim letzten Prüfen: die Breite ändert sich nur mit ihr (und das Bild zu bauen kostet)
let publishChain: Promise<unknown> = Promise.resolve()
function publishBand($: EngineInterface, v: ReturnType<typeof snapshot>, key = keyOf(v)) {
  if (key === publishedKey) return
  publishedKey = key
  const width = v.bars.length > 0 || v.ring || v.disk || v.cost || v.sys ? desktopSvg(v.bars, v.ring, v.disk, v.style, v.cost, v.sys).width : null
  if (width === publishedWidth) return
  publishedWidth = width
  // Schreibvorgänge nacheinander; Beiwerk: ein Fehler ändert nichts an den Balken. Abgelehnt (etwa aus einem Zeichnen heraus,
  // types@2.1.295:3405) wird der Stand vergessen, damit die nächste Änderung oder der nächste Tick es erneut versucht (Review K6)
  publishChain = publishChain
    .then(() => $.state.set({ plugin: 'limit-bars', key: 'band' }, width === null ? null : { width }))
    .catch(() => {
      if (publishedWidth === width) {
        publishedWidth = undefined
        publishedKey = ''
      }
    })
}

/** Neu zeichnen nur bei sichtbarer Änderung (Minute, Prozent, Kontext, Zustand). */
function refresh($: EngineInterface, now: number) {
  const v = snapshot(now)
  const key = keyOf(v)
  publishBand($, v, key)
  if (key === drawnKey) return
  awaitingRender = true
  $.ui.invalidate('ui.render')
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  const hl = typeof options.highlightAt === 'number' && Number.isFinite(options.highlightAt) ? options.highlightAt : 90
  lang = langOf(options.language)
  publishedWidth = undefined
  publishedKey = ''
  publishChain = Promise.resolve()
  opts = {
    resetStyle: STYLES.find((s) => s === options.resetStyle) ?? 'mixed',
    highlightAt: Math.max(50, Math.min(100, hl)),
    onlyFiveHour: options.onlyFiveHour === true,
    lang,
  }
  storagePath = typeof options.storagePath === 'string' ? options.storagePath.trim() : ''
  isWindows = isWindows || !!driveOf(storagePath)
  baseDisplay = displayFromOptions(options)
  baseStyle = styleFromOptions(options)
  rawOptions = options

  on('session.start', async ($, e, next) => {
    // Windows: Laufwerksbuchstabe im Arbeitsordner (SessionStartInput.cwd, absolut) oder in storagePath; ohne neues Recht
    isWindows = /^[A-Za-z]:[\\/]/.test(e.cwd ?? '') || !!driveOf(storagePath)
    // Nur wo das Band gezeichnet wird (types@2.1.288:9576); `-p`/SDK liefern null, VS Code und mobil zeichnen kein Band
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      lastSurface = e.surface
      await readDisplay($)
      await loadWindows($)
      publishBand($, snapshot(await $.clock.now()))
      if (wins.length > 0) $.ui.invalidate('ui.render')
      // Speicher-Ring: außerhalb des Hooks, der Sitzungsstart wartet nicht auf PowerShell; ausgeblendet kein PowerShell
      maybeStartDisk($)
    }
    try {
      settings = cleanSettings(await $.store.get('settings'))
    } catch {
      // Standard
    }
    await bindSession($)
    $.clock
      .now()
      .then((now) => cleanup($, now))
      .catch(() => {})
    // Befehle zuletzt, jeder für sich (CLAUDE.md, Registrieren in session.start)
    const t = T[lang]
    for (const c of [
      { name: 'cache', description: t.cmdCache, argumentHint: CACHE_HINT },
      { name: 'handoff', description: t.cmdHandoff, argumentHint: HANDOFF_HINT },
      { name: 'keepwarm', description: t.cmdKeepwarm, argumentHint: t.hintKeepwarm },
      { name: 'disk', description: t.cmdStorage, argumentHint: '[refresh]' },
      { name: 'bars', description: t.cmdBars, argumentHint: BARS_HINT },
    ]) {
      try {
        await $.command.register(c)
      } catch {
        // ohne diesen Befehl
      }
    }
    return next(e)
  })

  // Jede Anfrage der Hauptschleife: Cache gelesen oder neu geschrieben? Nur beobachten (Vorlage register.mjs:537-568)
  on('turn.step', async function* ($, e, next) {
    // Subagenten nicht; ebenso nicht der eigene Warmhalte-Ping, falls `$.model.fork` als Schritt erscheint (nicht belegt, Review
    // [UNKLAR]): sonst bliebe `working` ohne turn.complete stehen und das Warmhalten pingte nie wieder
    if (e.agentId || forking) return yield* next(e)
    let startedAt = 0
    try {
      startedAt = await $.clock.now()
    } catch {
      // ohne Uhr keine Auswertung
    }
    working = true
    currentTurn = e.turnId
    const r = yield* next(e)
    try {
      const u = r.usage
      if (u && startedAt) {
        await bindSession($)
        const res = observeStep(mem, u, startedAt, justCompacted)
        justCompacted = false
        if (res.coldWritten) {
          cold.count += 1
          // Preisstufe nach dem ganzen Prompt der Anfrage (Kontext), nicht nur nach dem neu geschriebenen Teil
          cold.usd += rewriteCost(res.coldWritten, res.mem.model, ttlOf(res.mem, settings), res.mem.ctx)
        }
        mem = res.mem
        last = { read: u.cache_read_input_tokens, written: u.cache_creation_input_tokens, at: startedAt }
        persist($, startedAt)
        refresh($, await $.clock.now())
      }
    } catch {
      // Beiwerk: die Anfrage selbst bleibt unberührt
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    working = false
    try {
      if (H.armed && e.turnId !== H.notTurn) captureHandoff($, e.reason === 'answer' ? e.answer : '', await $.clock.now())
    } catch {
      H.armed = false
    }
    return r
  })

  // Die erste Anfrage nach einer Kompaktierung schreibt den kürzeren Kontext neu: kein kalter Neustart (Vorlage, justCompacted)
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && r && !('skip' in r && r.skip)) justCompacted = true
    return r
  })

  // Rückfrage vor kaltem Senden. Fail-open: lieber eine Nachricht durchlassen als eine verschlucken.
  on('prompt.submit', async ($, e, next) => {
    const t = T[lang]
    let question = ''
    // Einstellungen frisch lesen: `/cache warn off` in einer anderen Session soll sofort auch hier gelten (0.2.1).
    // Fail-open: geht das Lesen schief, bleibt der Stand dieser Session.
    try {
      settings = cleanSettings(await $.store.get('settings'))
    } catch {
      // Stand dieser Session
    }
    try {
      const fromUser = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
      if (settings.guard && fromUser && !e.turnId && !e.text.trim().startsWith('/')) {
        await bindSession($)
        if (mem.ctx >= settings.bigTokens) {
          const ttl = ttlOf(mem, settings)
          const st = cacheState(mem.lastActivity, ttl, await $.clock.now(), false)
          if (st.kind === 'cold') {
            question = t.guardQuestion(
              spanText(-st.left, lang),
              tokensText(mem.ctx, lang),
              usd(rewriteCost(mem.ctx, mem.model, ttl), lang),
              usd(readCost(mem.ctx, mem.model), lang),
            )
          }
        }
      }
    } catch {
      return next(e)
    }
    if (!question) return next(e)
    // sidekick fragt selbst: keine zweite Frage hintereinander (Ausbau 0.14.0)
    if (await sidekickAsks($)) return next(e)
    let answer = t.send
    // Mit Anhängen oder `@datei` kein „Erst komprimieren“: als Plugin-Prompt neu gesendet, fehlten sie (types@2.1.289:8521-8523, Review S3)
    const resendable = !e.attachments?.length && !/(^|\s)@\S/.test(e.text)
    try {
      answer = await $.ui.ask(question, { options: resendable ? [t.send, t.compact, t.abort] : [t.send, t.abort], header: 'Cache' })
    } catch {
      // niemand zu fragen (-p) oder Dialog geschlossen: so senden, wie getippt
      return next(e)
    }
    if (answer === t.abort) {
      try {
        $.ui.toast(t.abortToast, { timeoutMs: 12000 })
      } catch {
        // nur der Hinweis fehlt
      }
      return { drop: t.dropAbort }
    }
    if (answer === t.compact && resendable) {
      // Aus prompt.submit lehnt der Host `$.session.compact()` ab („would compact under the turn this hook is holding“, Test-Kit
      // 2.1.289). Darum: Nachricht zurückhalten, außerhalb des Hooks komprimieren, dann den Text als eigene Nachricht senden.
      const text = e.text
      later($, 300, () => {
        $.session
          .compact()
          .catch((err) => $.ui.toast(t.compactFailed(msg(err)), { timeoutMs: 10000 }))
          .then(() => $.prompt.submit({ text, asUser: true }))
          .catch((err) => $.ui.toast(t.resendFailed(msg(err), text.slice(0, 160)), { timeoutMs: 30000 }))
      })
      return { drop: t.dropCompact }
    }
    return next(e)
  })

  on('command.run', { command: 'cache' }, async ($, e) => {
    const t = T[lang]
    // Nebenbefehl: die Hilfe steht unter /bars help (HELP-SPEC §2)
    if (isHelp(e.args)) return { text: t.seeHelp }
    const [key, value] = e.args.trim().toLowerCase().split(/\s+/)
    let note = ''
    if (key) {
      // `$.store` teilen sich alle Sessions: vor dem Schreiben neu lesen, sonst überschreibt eine die andere (Review S2)
      try {
        settings = cleanSettings(await $.store.get('settings'))
      } catch {
        // bleibt beim Stand dieser Session
      }
      const s = applySetting(settings, key, value ?? '')
      if (!s) return { text: t.unknownArg(e.args.trim(), CACHE_ARGS) }
      settings = s
      try {
        await $.store.set('settings', settings)
        note = `${t.saved}\n`
      } catch {
        note = `${t.notSaved}\n`
      }
      $.ui.invalidate('ui.render')
    }
    const now = await $.clock.now()
    await bindSession($)
    let limits: ReportLimit[] = []
    try {
      limits = shownWindows(wins, now, opts).map((s) => ({ tag: s.tag, pct: s.pct.long, ratio: s.ratio, reset: s.reset?.long }))
    } catch {
      // ohne Limits
    }
    const list = await loadHandoffs($)
    const guardBySidekick = settings.guard && (await sidekickAsks($))
    const text = cacheReport({ now, mem, settings, keep, cold, last, limits, sessionUsd, handoffAt: list[0]?.at ?? null, lang, guardBySidekick })
    return { text: note + text }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const t = T[lang]
    // Vor allem anderen: bis 0.6.x startete jedes Argument eine Übergabe, also auch `help` (HELP-SPEC §2)
    if (isHelp(e.args)) return { text: t.seeHelp }
    const arg = e.args.trim().toLowerCase()
    if (HANDOFF_SHOW_WORDS.includes(arg)) {
      const list = await loadHandoffs($)
      return { text: list[0] ? t.handoffLast(hhmm(list[0].at), list[0].text) : t.handoffNoneSaved }
    }
    if (HANDOFF_CONTINUE_WORDS.includes(arg)) {
      later($, 300, () => {
        clearAndContinue($).catch(() => {})
      })
      return { text: t.handoffContinuing }
    }
    if (H.pending || H.armed) return { text: t.handoffRunning }
    H.pending = true
    // Außerhalb des Hooks: den Skill suchen und starten (die Engine stellt ihn hinter einen laufenden Turn). Die Sprache geht als
    // Argument mit, der Skill schreibt die Übergabe darin (skills/uebergabe/SKILL.md, `$ARGUMENTS`).
    later($, 300, () => {
      $.command
        .list()
        .then((cmds) => {
          const cmd = cmds.find((c) => c.name === 'limit-bars:uebergabe') ?? cmds.find((c) => SKILL.test(c.name))
          if (!cmd) throw new Error(t.skillMissing)
          H.armed = true
          H.notTurn = working ? currentTurn : ''
          return $.command.run({ command: cmd.name, args: lang })
        })
        .catch((err) => {
          H.armed = false
          $.ui.toast(t.handoffStartFailed(msg(err)), { timeoutMs: 10000 })
        })
        .finally(() => {
          H.pending = false
        })
    })
    return { text: t.handoffWriting }
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const t = T[lang]
    if (isHelp(e.args)) return { text: t.seeHelp }
    const arg = e.args.trim().toLowerCase()
    if (KEEP_OFF_WORDS.includes(arg) || (arg === '' && keep)) {
      if (!keep) return { text: t.keepAlreadyOff }
      stopKeep($, t.whyTurnedOff)
      return { text: t.keepTurnedOff }
    }
    const h = arg ? Number(arg.replace(',', '.')) : 2
    if (!(h > 0)) return { text: t.keepUsage(String(KEEP_MAX_H)) }
    const now = await $.clock.now()
    await bindSession($)
    const ttl = ttlOf(mem, settings)
    const st = cacheState(mem.lastActivity, ttl, now, false)
    if (st.kind === 'unknown') return { text: t.keepNothing }
    if (st.kind === 'cold') return { text: t.keepCold }
    const hours = Math.min(KEEP_MAX_H, h)
    keep = { until: now + hours * 60 * MIN, pings: 0, usd: 0 }
    keepFor = sessionId
    saveKeep($)
    keepTimer?.cancel()
    keepTimer = $.clock.every(30000, () => keepStep($))
    $.ui.invalidate('ui.render')
    return {
      text: t.keepOn(
        hhmm(keep.until),
        h > KEEP_MAX_H ? t.keepCapped(String(KEEP_MAX_H)) : '',
        ttl >= 60 ? '8 min' : '90 s',
        usd(readCost(mem.ctx, mem.model), lang),
        tokensText(mem.ctx, lang),
        String(Math.ceil((hours * 60) / (ttl >= 60 ? 52 : 3.5))),
      ),
    }
  })

  // /bars: Teile der Anzeige ein- und ausblenden (SPEC.md, Ausbau v0.6.0). Gespeichert in `$.store` unter `display`, damit es
  // in allen offenen Chats gilt (der Takt liest neu); vor dem Schreiben neu lesen, wie bei den /cache-Einstellungen.
  on('command.run', { command: 'bars' }, async ($, e) => {
    // Sprache aller fynn-mods (docs/LANGUAGE-SPEC.md §6 Punkt 2), vor allem, was Store, Uhr oder Zustand liest; fängt Fehler selbst ab
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: 'limit-bars', cmd: 'bars', lang }, e.args) }
    const t = T[lang]
    const c = parseBars(e.args)
    if (c.kind === 'bad') return { text: t.unknownArg(e.args.trim(), BARS_HINT) }
    await readDisplay($)
    if (c.kind === 'help') {
      await readCostState($)
      // Stand beim Aufruf (HELP-SPEC §3 Punkt 3): Einstellungen frisch aus dem Store, wie /cache
      try {
        settings = cleanSettings(await $.store.get('settings'))
      } catch {
        // Stand dieser Session
      }
      await bindSession($)
      const data = barsHelpData({
        lang,
        options: rawOptions,
        shown: shownParts(),
        overrides,
        storagePath,
        hasDrive: !!driveOf(storagePath),
        settings,
        memTtl: mem.ttl,
        memTtlSource: mem.ttlSource,
        keep,
        style: styleNow(),
        styleByCommand: styleOverride !== undefined,
        noFive: noFiveHour(),
        hasCost: !!costHere,
        guardBySidekick: settings.guard && (await sidekickAsks($)),
        isWindows,
      })
      return { text: helpMarkdown(data, rememberHelp(await $.clock.now(), data)) }
    }
    let note = ''
    if (c.kind === 'reset') {
      overrides = {}
      styleOverride = undefined
      try {
        await $.store.delete('display')
        displayPinned = false
      } catch (err) {
        displayPinned = true
        note = t.barsSaveFailed(msg(err))
      }
    } else if (c.kind === 'set') {
      // Speicher-Ring ohne Laufwerk: nichts speichern, sondern sagen, wo der Pfad hingehört
      if (c.part === 'storage' && c.on && !driveOf(storagePath)) return { text: storagePath ? t.storageWindowsOnly : t.storageOff }
      // Säulen nur unter Windows: nichts speichern, sondern es sagen (SPEC Ausbau 0.12.0, 2.)
      if (c.part === 'system' && c.on && !isWindows) return { text: t.sysWindowsOnly }
      if (c.part === 'system' && !c.on) stopSys()
      overrides = { ...overrides, [c.part]: c.on }
      try {
        await $.store.set('display', displayValue())
        displayPinned = false
      } catch (err) {
        displayPinned = true
        note = t.barsSaveFailed(msg(err))
      }
    } else if (c.kind === 'style') {
      styleOverride = c.style
      try {
        await $.store.set('display', displayValue())
        displayPinned = false
      } catch (err) {
        displayPinned = true
        note = t.barsSaveFailed(msg(err))
      }
    }
    await readCostState($)
    try {
      refresh($, await $.clock.now())
      maybeStartDisk($)
    } catch {
      // Anzeige folgt mit dem nächsten Zeichnen
    }
    const sh = shownParts()
    const rows = PARTS.map((p) => {
      let state = t.barsOff
      if (sh[p] && p === 'fiveHour' && noFiveHour()) state = t.barsNoFive
      else if (sh[p] && p === 'cost') state = costHere ? t.barsOn : t.costWaiting
      else if (sh[p] && p === 'system') state = isWindows ? t.barsOn : t.sysNotWindows
      else if (sh[p]) state = p !== 'storage' || driveOf(storagePath) ? t.barsOn : storagePath ? t.barsNotWindows : t.barsNoPath
      return `| ${t.barsPart[p]} | ${state} | ${overrides[p] !== undefined ? t.barsByCommand : t.barsBySetting} |`
    })
    rows.push(`| ${t.barsStyle} | ${t.styleName[styleNow()]} | ${styleOverride ? t.barsByCommand : t.barsBySetting} |`)
    const lines: string[] = []
    if (c.kind === 'set') lines.push(t.barsSet(t.barsPart[c.part], c.on ? t.barsOn : t.barsOff), '')
    if (c.kind === 'reset') lines.push(t.barsReset, '')
    if (c.kind === 'style') lines.push(t.styleSet(t.styleName[c.style]), ...(c.style === 'ring' && lastSurface === 'terminal' ? [t.styleDesktopOnly] : []), '')
    lines.push(t.barsTitle, '', t.barsHead, '|---|---|---|', ...rows, '', t.barsUsage)
    // Cache-Ring aus heißt nur: Anzeige weg (Fynn); Rückfrage und Hinweise bleiben
    if (c.kind === 'set' && c.part === 'cache' && !c.on) lines.push(t.barsCacheNote)
    // Kosten und CPU/RAM: Stand, letzte Messung, Fehler (SPEC Ausbau 0.12.0)
    const extra: string[] = []
    if (sh.cost) extra.push(costHere ? t.costLine(costText(costHere, lang)) : t.costNone)
    if (sh.system && isWindows) {
      const now = await $.clock.now()
      if (now < sysPausedUntil) extra.push(t.sysPaused(hhmm(sysPausedUntil)))
      const v = sysView(sysCur, sysPrev, now, lang)
      if (sysCur && v.rows[0]!.pct !== null) extra.push(t.sysLine(hhmm(sysCur.at), v.rows.map((r) => `${r.tag} ${r.pct}%`).join(' · ')))
      else extra.push(t.sysNone)
      if (sysErr && sysErrAt > (sysCur?.at ?? 0)) extra.push(t.sysFailed(hhmm(sysErrAt), sysErr))
    }
    if (extra.length) lines.push('', ...extra)
    if (note) lines.push('', note)
    return { text: lines.join('\n') }
  })

  // /disk: Belegung nach Dateiart. Antwortet mit Markdown; auf Terminal und Desktop zeichnet der CommandOutput-Hook darunter
  // stattdessen den großen Ring mit Legende (types@2.1.290:9695-9725, Vorbild cost-ledger /ledger).
  on('command.run', { command: 'disk' }, async ($, e) => {
    const t = T[lang]
    if (isHelp(e.args)) return { text: t.seeHelp }
    const arg = e.args.trim().toLowerCase()
    if (arg && !DISK_WORDS.includes(arg)) return { text: t.unknownArg(e.args.trim(), DISK_WORDS.join('|')) }
    if (!storagePath) return { text: t.storageOff }
    const drive = driveOf(storagePath)
    if (!drive) return { text: t.storageWindowsOnly }
    try {
      await probeDisk($)
    } catch (err) {
      if (!disk.d) return { text: t.storageFailed(drive, msg(err)) }
    }
    let note = ''
    const now = await $.clock.now()
    const s = await readDisk($)
    const wanted = !disk.scan || now - disk.scan.at > SCAN_MAX_AGE
    // Ein eigener laufender Scan (etwa vom Sitzungsstart): auf ihn warten statt ihn als fremde Sperre zu melden
    if (arg === 'refresh' || (wanted && (scanRun || scanAllowed(s, now)))) {
      try {
        await scanDisk($)
      } catch (err) {
        note = t.storageScanFailed(msg(err))
      }
    } else if (wanted && s?.scanStartedAt !== undefined && now - s.scanStartedAt < SCAN_LOCK) {
      // 0.4.1 (Fynn, 2026-10-06): sonst stand nur „noch nicht gescannt“ da, ohne Grund
      note = t.storageScanRunning(hhmm(s.scanStartedAt))
    } else if (s?.scanFailedAt !== undefined && now - s.scanFailedAt < SCAN_PAUSE) {
      note = t.storageScanPaused(hhmm(s.scanFailedAt))
    }
    const d = disk.d
    if (!d) return { text: t.storageFailed(drive, '–') }
    const r = storageReport(drive, d, disk.scan, await $.clock.now(), lang)
    const tag = `#${(++reportNo).toString(36)}${now.toString(36).slice(-5)}`
    reports.set(tag, r)
    while (reports.size > 10) reports.delete(reports.keys().next().value as string)
    return { text: storageMarkdown(r, tag, lang, note) }
  })

  // Die Zeile von /bars help: gezeichnete Tabelle (help.ts). Nur mit bekannter Kennung; die übrigen /bars-Antworten, Fehlerzeilen
  // und andere Oberflächen zeichnet die Engine als Text. Kennung ohne Anker suchen: der Text beginnt mit „limit-bars: “
  // (templates/help/README.md, Befunde).
  on('ui.render', { component: 'CommandOutput', props: { command: 'bars' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    // Nur die Zeile von `/bars help` bzw. `/bars ?`: sonst zeigte `/bars #<gültige Kennung>` die Tabelle (Review worklist, K2)
    if (!HELP_WORDS.includes(e.props.args.trim().toLowerCase())) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const data = tag ? helps.get(tag) : undefined
    return data ? helpTree(data, e.viewport?.columns ?? 100, e.surface, HELP_ACCENT) : next(e)
  })

  // Die Zeile von /disk: eigener Baum statt Markdown. Unbekannte Kennung (nach Neustart, Hinweise), Fehlerzeile oder eine
  // andere Oberfläche: die Engine zeichnet den Text.
  on('ui.render', { component: 'CommandOutput', props: { command: 'disk' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const r = tag ? reports.get(tag) : undefined
    if (!r) return next(e)
    try {
      const { Box, Text } = $.ui.resolve(e)
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)
        const pic = storageSvg(r, lang)
        return Box({ key: 'disk', flexDirection: 'column', children: [Svg({ source: pic.source, alt: pic.alt, width: pic.width, height: pic.height })] })
      }
      const v = storageTerminal(r, e.viewport?.columns ?? 80, lang)
      return Box({
        key: 'disk',
        flexDirection: 'column',
        children: [
          Text({ bold: true, children: [r.view.alt] }),
          Box({ flexDirection: 'row', children: v.bar.map((b) => Text({ color: b.color, children: ['█'.repeat(b.n)] })) }),
          ...v.lines.map((l) => Box({ flexDirection: 'row', children: [Text({ color: l.color, children: ['■ '] }), Text({ children: [l.text] })] })),
          Text({ dimColor: true, children: [v.footer] }),
        ],
      })
    } catch {
      return next(e)
    }
  })

  on('session.measure', async ($, e, next) => {
    // Bei jeder Messung übernehmen, nicht nur wenn `changed` `rateLimits` nennt; ein fehlendes Fenster verschwindet
    try {
      const now = await $.clock.now()
      takeOwn($, pickWindows(e.rateLimits), now)
      refresh($, now)
    } catch {
      // Beiwerk: die Messung selbst bleibt unberührt
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let called = false
    let nextFailed = false
    let theirs: RenderNode | null | undefined = null
    // Jeder Aufruf von `next` läuft hierüber: so ist klar, ob ein Fehler aus der Kette stammt oder aus diesem Hook
    const pass = async (arg: typeof e) => {
      called = true
      try {
        return await next(arg)
      } catch (err) {
        nextFailed = true
        throw err
      }
    }
    try {
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return await pass(e)
      lastSurface = e.surface
      // Nennt `session.start` die Oberfläche nicht (z. B. eine App, die als SDK startet), holt das erste Zeichnen den Anfangsstand
      // Ersatzweg, wenn session.start die Oberfläche nicht nannte: auch die /bars-Werte holen (Review 0.6.0, S1)
      if (!usageAsked) {
        await readDisplay($)
        await loadWindows($)
      }
      maybeStartDisk($)
      // Kostenring: im Zeichnen lesen, das abonniert den Wert (ein Schreiben von cost-ledger zeichnet neu)
      await readCostState($)
      const now = await $.clock.now()
      awaitingRender = false
      lastRenderAt = now
      // Eine abgelehnte Periode beendet das Intervall still: bleiben zwei Ticks aus, wird der Takt neu gestartet. Gemessen ab dem
      // letzten Tick, nicht ab dem Start: Jede Periode dauert etwas länger als TICK, über Stunden summierte sich das sonst auf.
      if (timer && now - lastTick >= 2 * TICK) {
        timer.cancel()
        timer = null
      }
      if (!timer) {
        lastTick = now
        timer = $.clock.every(TICK, () => {
          // Neuzeichnen angefordert, aber keins gekommen (Band eingeklappt, Sitzung verdeckt): Takt beenden; das nächste Zeichnen
          // startet ihn neu. Ohne Änderung wird nichts angefordert, dann läuft er still weiter (usage() ist kostenlos).
          if (awaitingRender) {
            timer?.cancel()
            timer = null
            stopSys() // ohne Zeichnen auch kein Messprozess
            return
          }
          pollStep($).catch(() => {
            // Uhr abgelehnt: es bleibt beim letzten Stand
          })
        })
      }
      // Eine Umfrage hält das Band; ein Hook weicht ihr (types@2.1.288:9580)
      if (e.props.hasSurvey) return await pass(e)
      const view = snapshot(now)
      drawnKey = keyOf(view)
      // Alles ausgeblendet: nichts Eigenes und kein freigehaltener Platz (bodyColumns unverändert); der Takt läuft weiter,
      // damit ein `/bars` aus einem anderen Chat und die Hinweise vor Ablauf hier ankommen
      if (view.bars.length === 0 && !view.ring && !view.disk && !view.cost && !view.sys) return await pass(e)
      const { Box, Text } = $.ui.resolve(e)
      let mine: RenderNode
      let stack = false
      if (e.surface === 'desktop') {
        // Desktop: was eingeschaltet ist (Cache-Ring vor der ersten Anfrage grau mit „–“), Balken mit Werten, sobald es Limits gibt; kein Umschreiben von
        // bodyColumns, weil Clawds Svg eine feste Größe hat
        theirs = await pass(e)
        const { Svg } = $.ui.resolve(e)
        // Ohne Limits stehen Platzhalter da (5h –, 7d –), damit die Balken wie der Ring sofort sichtbar sind
        const pic = desktopSvg(view.bars, view.ring, view.disk, view.style, view.cost, view.sys)
        if (view.sys) sysVisible = true
        // Unten bündig mit Clawds Füßen, auch wenn die Desktop-App alignItems der äußeren Zeile nicht umsetzt (Spalte + flex-end)
        // 0.13.1: `position: relative`, damit die Balken über Clawd gemalt werden, der seit clawd-buddy 0.12.1 hinter der Zeile liegt
        // (Platz 0, absolut; Fynn, 2026-11-04: „dahinter legen“). Ohne Versatz verschiebt es nichts (types:958).
        mine = Box({ key: 'limit-bars', position: 'relative', flexShrink: 0, flexDirection: 'column', justifyContent: 'flex-end', children: [Svg({ source: pic.source, alt: pic.alt, width: pic.width, height: pic.height })] })
      } else {
        // Hinter den Balken: Cache-Block, Speicher-Block, Kosten-Block, dahinter die CPU/RAM-Gruppen. Wird es eng, fallen zuerst
        // CPU/RAM weg, dann der Speicher, dann die Kosten, dann der Cache; die Limits werden erst danach kürzer (SPEC 0.12.0, 3.)
        type Part = { text: string; color: string | undefined; dim: boolean }
        const cacheP: Part[] = view.block ? [{ text: view.block.text, color: view.block.color, dim: false }] : []
        const diskP: Part[] = view.diskBlock ? [{ text: view.diskBlock, color: undefined, dim: true }] : []
        const costP: Part[] = view.costBlock ? [{ text: view.costBlock, color: undefined, dim: true }] : []
        const sysCols = view.sys ? termColumns(view.sys).filter((c) => c.length) : []
        const sysW = view.sys ? sysTermWidth(view.sys) : 0
        const combos: { parts: Part[]; sys: boolean }[] = []
        for (const c of [
          { parts: [...cacheP, ...diskP, ...costP], sys: sysCols.length > 0 },
          { parts: [...cacheP, ...diskP, ...costP], sys: false },
          { parts: [...cacheP, ...costP], sys: false },
          { parts: cacheP, sys: false },
        ])
          if ((c.parts.length || c.sys) && !combos.some((x) => x.sys === c.sys && x.parts.length === c.parts.length)) combos.push(c)
        let lay: ReturnType<typeof layoutTerminal> = null
        let parts: Part[] = []
        let withSys = false
        for (const c of combos) {
          const text = c.parts.map((x) => x.text).join('  ')
          const extraW = text.length + (c.sys ? (text ? 2 : 0) + sysW : 0)
          // Alles zusammen höchstens 44 Spalten wie bisher: clawd-buddy außen gibt dem Grund fest 44 (Fynn 2026-11-04, Review S1)
          const l = layoutTerminal(view.shown, e.props.bodyColumns, text || ' ', { extraW })
          if (l?.extra) {
            lay = l
            parts = c.parts
            withSys = c.sys
            break
          }
        }
        lay ??= layoutTerminal(view.shown, e.props.bodyColumns)
        if (view.sys) sysVisible = withSys
        if (!lay) return await pass(e)
        if (noRewrite) {
          theirs = await pass(e)
          stack = true
        } else {
          // Platz abgeben: Mods weiter innen (z. B. clawd-buddy) sehen die Breite ohne die Balken. Props-Rewrites sind erlaubt
          // (types@2.1.288:9103-9104), das Feld heißt aber "Read-only" (types@2.1.288:9598-9604). Phase 0 hat belegt, dass die
          // Engine es annimmt; lehnt eine spätere Version ab, scheitert dieses Zeichnen, und ab dann wird gestapelt.
          try {
            theirs = await pass({ ...e, props: { ...e.props, bodyColumns: e.props.bodyColumns - lay.width } })
          } catch (err) {
            noRewrite = true
            throw err
          }
        }
        const children: RenderNode[] = lay.blocks.map((b) => {
          const s = b.shown
          // Tempo-Zeile ohne 5h-Fenster: `5h ∞` gedimmt, das Tempo in seiner Farbe, darunter kein Balken (Ausbau 0.10.0)
          if (s.pace) {
            const grey = s.color === GREY
            return Box({
              flexDirection: 'column',
              width: b.width,
              flexShrink: 0,
              children: [
                Box({
                  flexDirection: 'row',
                  children: [
                    Text({ color: ORANGE, children: [s.tag] }),
                    Text({ dimColor: true, children: [` ${b.pct}`] }),
                    ...(b.rest ? [grey ? Text({ dimColor: true, wrap: 'truncate-end', children: [b.rest] }) : Text({ color: s.color, wrap: 'truncate-end', children: [b.rest] })] : []),
                  ],
                }),
                Text({ children: [' '] }),
              ],
            })
          }
          return Box({
            flexDirection: 'column',
            width: b.width,
            flexShrink: 0,
            children: [
              Box({
                flexDirection: 'row',
                children: [
                  Text({ color: ORANGE, bold: s.strong, children: [s.tag] }),
                  Text({ children: [' '] }),
                  s.fresh ? Text({ dimColor: true, children: [b.pct] }) : Text({ color: s.color, bold: s.strong, children: [b.pct] }),
                  ...(b.rest ? [Text({ dimColor: true, wrap: 'truncate-end', children: [b.rest] })] : []),
                ],
              }),
              Box({
                flexDirection: 'row',
                // Am Wochenbalken ohne 5h-Fenster ein Strich beim gleichmäßigen Verbrauch (`┆`), sonst nur gefüllt und leer
                children: barRuns(s.ratio, b.width, s.color, s.mark, s.markColor).map((r) => Text({ color: r.color, children: [r.mark ? '┆' : '▄'.repeat(r.n)] })),
              }),
            ],
          })
        })
        // Cache-, Speicher- und Kosten-Block hinter den Balken, auf der Zeile der Beschriftungen
        if (lay.extra && parts.length > 0) {
          const line = parts.flatMap((p, i) => [
            ...(i > 0 ? [Text({ children: ['  '] })] : []),
            p.dim ? Text({ dimColor: true, children: [p.text] }) : Text({ color: p.color, children: [p.text] }),
          ])
          children.push(Box({ key: 'cache', flexDirection: 'column', flexShrink: 0, children: [Box({ flexDirection: 'row', children: line }), Text({ children: [' '] })] }))
        }
        // Systemwerte: Spalten zu je zwei Zeilen (CPU über GPU, RAM über VRAM), Zahlen in jeder Zeile an derselben Stelle
        if (lay.extra && withSys)
          sysCols.forEach((col, i) =>
            children.push(
              Box({
                key: `sys-${i}`,
                flexDirection: 'column',
                width: CELL_W,
                flexShrink: 0,
                children: [0, 1].map((k) => {
                  const r = col[k]
                  if (!r) return Text({ children: [' '] })
                  const c = cellText(r)
                  return Box({
                    flexDirection: 'row',
                    children: [
                      Text({ color: ORANGE, children: [c.tag] }),
                      r.pct === null ? Text({ dimColor: true, children: [c.value] }) : Text({ color: levelColor(r.pct), children: [c.value] }),
                      Text({ dimColor: true, children: [c.arrow] }),
                    ],
                  })
                }),
              }),
            ),
          )
        mine = Box({
          key: 'limit-bars',
          width: lay.width,
          // Nie schrumpfen: läuft das Band über, gibt die dehnbare Seite nach, nicht die Beschriftung
          flexShrink: 0,
          flexDirection: 'row',
          columnGap: 2,
          children,
        })
      }
      // Ebenen anderer Mods (Quick-Replies, sidekick) bleiben über dem Grund, nie neben den Balken, egal wer in der Kette außen
      // liegt (band.ts, docs/BAND.md). Die Balken kommen nur neben den Grund.
      // Die Balken sind Platz 10 der Grund-Zeile: die Zeile sortiert die Plätze, egal wer in der Kette außen liegt (band.ts).
      // Der Kern-Knoten `{type:'engine'}` (types@2.1.288:9033-9041) bleibt als Rest in der Mitte erhalten.
      const { layers, slots, base } = splitBand(theirs)
      // Nur der Ausweichweg: lehnt die Engine das Umschreiben von bodyColumns ab, gilt der Rest gestapelt unter den Balken
      if (stack && base) return joinBand(layers, Box({ flexDirection: 'column', children: [mine, base] }), slots)
      return joinBand(layers, base, [...slots, slot(SLOTS.limitBars, 'limit-bars', mine)])
    } catch (err) {
      // Fehler aus der Kette: weiterwerfen, die Engine behandelt den Hook dann als gescheitert (docs/raw/en/events.md:313-316)
      if (nextFailed) throw err
      // Eigener Fehler (fail-open): ohne Anzeige; der Inhalt der anderen bleibt, `next` läuft höchstens einmal
      return called ? theirs : next(e)
    }
  })
}
