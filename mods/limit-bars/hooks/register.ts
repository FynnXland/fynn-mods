// limit-bars: Hooks-Modul. Im Band über dem Prompt (AbovePrompt, docs/raw/en/interface.md:207-213) zwei schmale Balken für das
// 5-Stunden- und das Wochenlimit und rechts daneben ein Ring, wie lange der Prompt-Cache dieser Session noch warm ist.
// Limits: `$.session.usage()` beim Start und bei jedem Tick, dazu `session.measure` (types@2.1.288:10410-10436); der neueste Stand
// aller Chats auf dem Rechner liegt in `$.store` unter `limits` (docs/raw/en/reference.md:221).
// Cache: `turn.step` der Hauptschleife (usage mit cache_read/cache_creation, types@2.1.289:12837-12869), gespeichert in `$.store`.
// Dazu die Cache-Wache nach Nate Herks Cache Keeper (docs/vorlagen/nateherk-cache-keeper, MIT): Rückfrage vor kaltem Senden,
// Hinweis kurz vor Ablauf, /cache, /keepwarm (Standard aus).
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
import { BARS_HINT, CACHE_ARGS, CACHE_HINT, T, hhmm, langOf, usd } from './i18n.ts'
import {
  DISK_WORDS,
  HELP_WORDS,
  KEEP_OFF_WORDS,
  PARTS,
  cleanOverrides,
  cleanStyle,
  displayFromOptions,
  isHelp,
  parseBars,
  styleFromOptions,
} from './display.ts'
import type { Display, Style } from './display.ts'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { HELP_ACCENT, barsHelpData } from './helpdata.ts'
import type { Lang } from './i18n.ts'
import { isLanguage, languageCommand } from './language.ts'
import { migrateSettings, readSettings, writeNote, writeSettings } from './settings.ts'
import { storeOffDefaults } from './offdefaults.ts'
import type { Values } from './settings.ts'
import { PART_FIELD, SETTINGS } from './fields.ts'
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
import { CELL_W, SYS_SCRIPT, cellText, levelColor, parseSample, shownPrev, sysAdopt, sysTermWidth, sysView, sysViewOf, takeLines, termColumns } from './system.ts'
import type { Sample, SysRow } from './system.ts'
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
// Welche Teile zu sehen sind (display.ts): seit 0.16.0 nur userConfig; `/bars` schreibt dorthin (SETTINGS-SPEC §4)
let baseDisplay: Display = displayFromOptions({})
const shownParts = () => baseDisplay
// Balken oder Ringe (Ausbau 0.10.0): userConfig `style`; Ringe nur im Desktop
let baseStyle: Style = 'bar'
const styleNow = (): Style => baseStyle
// Zuletzt gezeichnete Oberfläche: `/bars style ring` sagt im Terminal, dass Ringe nur im Desktop erscheinen (command.run nennt
// keine Oberfläche, types@2.1.295 CommandRunInput)
let lastSurface: string | null = null

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
let awaitingSince = 0 // seit wann (erste offene Anforderung)
let lastTick = 0 // Uhrzeit des letzten Ticks (bzw. des Starts)
// Lehnt eine Claude-Code-Version das Umschreiben von bodyColumns ab, stapelt limit-bars danach über dem Rest (SPEC.md, Phase 0)
let noRewrite = false

// Cache dieser Session. `mem` liegt in `$.store` unter `cache:<sessionId>`, damit der Ring nach Neustart oder Reload weiß, wie warm er ist.
let sessionId = ''
let mem: CacheMem = emptyMem()
let settings: Settings = { ...DEFAULT_SETTINGS }
let justCompacted = false
let working = false // ein Turn der Hauptschleife läuft (turn.step … turn.complete)
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
// Nachtrag 0.14.1: Was das Band zeigt, getrennt von der Messung. Neu übernommen nur nach den Regeln in `sysAdopt` oder von
// einem Zeichnen aus anderem Grund; `keyOf`, Terminal-Text und `/bars` lesen nur diesen Stand.
let sysShown: SysRow[] | undefined
let sysShownAt = 0 // Zeitpunkt der letzten Übernahme (für SYS_REDRAW)
let sysShownFrom: number | null = null // `at` der übernommenen Messung, -1 = Zeilen ohne frische Messung („–“), null = noch nichts
let sysRedraws = 0 // Neuzeichnen wegen Systemwerten seit `sysRedrawsFrom` (Zeile in `/bars`)
let sysRedrawsFrom = 0
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
const SYS_FAILS = 3
const SYS_PAUSE = 60 * 60_000
// So lange ein angefordertes Neuzeichnen ausbleibt, dann endet der Prozess. Gemessen ab der Anforderung (`awaitingSince`), nicht
// ab dem letzten Zeichnen: seit 0.14.1 liegt das oft länger zurück, ohne dass etwas fehlt (Nachtrag 0.14.1, Regel 6)
const SYS_IDLE = 15_000

const reports = new Map<string, StorageReport>()
let reportNo = 0
// /bars help: Schnappschuss je Aufruf, höchstens 10 (docs/HELP-SPEC.md §3, templates/help/README.md)
const helps = new Map<string, HelpData>()
let helpNo = 0
// userConfig, wie register() sie bekommt: für die Spalte EINSTELLUNGEN der Hilfe
let rawOptions: Readonly<Record<string, unknown>> = {}

// Einstellungen (0.16.0, docs/SETTINGS-SPEC.md §4): einzige Quelle ist userConfig. /bars und /cache schreiben die Felder über
// hooks/settings.ts (Terminal: $.config.set, die Mod lädt neu; Desktop/-p: claude plugin configure, hier sofort nachgezogen).
// Die Store-Werte `display` und `settings` (bis 0.15.0) werden einmal umgezogen.
const SELF = 'limit-bars'
let cfg: Values = readSettings(SETTINGS, undefined)

/** Cache-Einstellungen aus userConfig. */
function cacheSettings(c: Values): Settings {
  const ttl = c.cacheTtl === '5' ? 5 : c.cacheTtl === '60' ? 60 : 0
  const big = Number(c.bigTokens)
  return { ttl, guard: c.askBeforeColdSend !== false, bigTokens: Number.isFinite(big) && big > 0 ? big : DEFAULT_SETTINGS.bigTokens, alerts: c.expiryNotice !== false }
}

/** Die Felder zu geänderten Cache-Einstellungen (`/cache warn|hints|big|ttl`). */
function cachePatch(n: Settings): Values {
  return { askBeforeColdSend: n.guard, expiryNotice: n.alerts, bigTokens: n.bigTokens, cacheTtl: n.ttl === 0 ? 'auto' : String(n.ttl) }
}

/** Werte übernehmen (aus `options`, nach einem Schreiben über Weg 2 oder dem Umzug). */
function applyCfg(values: Values) {
  cfg = { ...cfg, ...values }
  baseDisplay = displayFromOptions(cfg)
  baseStyle = styleFromOptions(cfg)
  settings = cacheSettings(cfg)
  rawOptions = cfg
  opts = { ...opts, onlyFiveHour: cfg.onlyFiveHour === true }
}

/**
 * Store bis 0.15.0: `display` (/bars, schlug userConfig) und `settings` (/cache). Was dort stand, galt. Ergibt die Felder;
 * `onlyFiveHour` (veraltet) geht dabei in `showWeekly` auf.
 */
export function legacyValues(display: unknown, cache: unknown, current: Values): Partial<Values> {
  const out: Partial<Values> = {}
  const ov = cleanOverrides(display)
  for (const p of PARTS) if (ov[p] !== undefined) out[PART_FIELD[p]] = ov[p]!
  const st = cleanStyle(display)
  if (st) out.style = st
  if (current.onlyFiveHour === true) {
    if (out.showWeekly === undefined) out.showWeekly = false
    out.onlyFiveHour = false
  }
  if (cache && typeof cache === 'object') Object.assign(out, cachePatch(cleanSettings(cache)))
  return out
}

/**
 * Alten Schlüssel markieren (0.16.2), nur wenn ihn seit dem Lesen niemand geändert hat; sonst zieht der nächste Start die Änderung um
 * (Review K1). Kein Objekt (kaputter Eintrag): leeren wie bis 0.16.1.
 */
async function markIfSame($: EngineInterface, key: string, raw: unknown) {
  const now = await $.store.get(key)
  if (JSON.stringify(now) !== JSON.stringify(raw)) return
  await $.store.set(key, raw && typeof raw === 'object' ? { ...raw, migrated: true } : null)
}

/** Einmal je Start (SETTINGS-SPEC §4), im Hintergrund. */
async function migrate($: EngineInterface) {
  let display: unknown, cache: unknown
  try {
    display = await $.store.get('display')
    cache = await $.store.get('settings')
  } catch {
    return
  }
  // Markiert statt geleert (0.16.2, wie sidekick 0.23.0 Review S1): Ein Chat, der nach dem Update bis `/reload-plugins` noch mit
  // 0.15.x läuft, liest `display` und `settings` im Takt bzw. vor jedem Senden neu; geleert arbeitete er mit Standards, und sein
  // nächstes Schreiben brächte diese als Altwerte zurück. 0.15.x übergeht das Feld `migrated` und schreibt ohne es.
  const had = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'object' && (v as { migrated?: unknown }).migrated === true)
  if (!had(display) && !had(cache) && cfg.onlyFiveHour !== true) return
  const clear = async () => {
    if (had(display)) await markIfSame($, 'display', display)
    if (had(cache)) await markIfSame($, 'settings', cache)
  }
  const { apply } = await migrateSettings($, SELF, SETTINGS, cfg, legacyValues(had(display) ? display : undefined, had(cache) ? cache : undefined, cfg), clear, lang)
  if (Object.keys(apply).length) {
    applyCfg(apply)
    maybeStartDisk($)
    $.ui.invalidate('ui.render')
  }
}

/** Schnappschuss unter einer neuen Kennung `#…` ablegen; die älteste fällt heraus. */
function rememberHelp(now: number, data: HelpData): string {
  const tag = `#${(++helpNo).toString(36)}${now.toString(36).slice(-5)}`
  helps.set(tag, data)
  while (helps.size > 10) helps.delete(helps.keys().next().value as string)
  return tag
}

const STYLES: readonly ResetStyle[] = ['mixed', 'clock', 'countdown']
const KEEP_MAX_H = 4
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

/** Ein Tick: Session, eigene Messung, gemeinsamer Stand; neu gezeichnet wird nur bei sichtbarer Änderung. */
async function pollStep($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  lastTick = now
  await bindSession($)
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
  await alertStep($, now).catch(() => {})
  // Systemwerte: eine veraltete Messung („–“) gilt sofort, eine wartende Abweichung ab 5 s (Nachtrag 0.14.1)
  const sysTook = takeSys(now, false)
  if (refresh($, now) && sysTook) sysRedraws += 1
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

/**
 * Hinweis, sobald ein großer Chat in die gelbe Phase geht; einmal je Phase (SPEC, Vorwarnung). Ausbau 0.15.0: Schlägt sidekick
 * selbst vor (`sidekickAsks`), kommt kein Toast. `alerted` wird vor dem Warten gesetzt, damit ein zweiter Tick nicht doppelt prüft.
 */
async function alertStep($: EngineInterface, now: number): Promise<void> {
  if (!settings.alerts || keep || mem.ctx < settings.bigTokens || alerted === mem.lastActivity) return
  const ttl = ttlOf(mem, settings)
  const st = cacheState(mem.lastActivity, ttl, now, false)
  if (st.kind !== 'cooling') return
  alerted = mem.lastActivity
  if (await sidekickAsks($)) return
  $.ui.toast(T[lang].alert(spanText(st.left, lang), tokensText(mem.ctx, lang), usd(rewriteCost(mem.ctx, mem.model, ttl), lang)), { timeoutMs: 20000 })
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
    // Liste schon vor der ersten Messung (gedimmt, „–“), damit die Breite im Band nicht springt. Gezeigt wird `sysShown`, nicht
    // die letzte Messung (Nachtrag 0.14.1, Regel 1)
    sys: sh.system && isWindows ? sysViewOf(sysShown ?? sysView(undefined, undefined, now, lang).rows, lang) : undefined,
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
    // Kosten auf den Cent bzw. die Kurzform; Systemwerte wie angezeigt (`sysShown`), eine Messung allein ändert den Schlüssel nicht
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

/**
 * Ausbau 0.15.0: Steht sidekicks `/handoff` in der Befehlsliste? Nur dann nennen `/cache` und die Abbrechen-Meldung ihn.
 * Der Plugin-Name ist `sidekick` oder `sidekick@<marketplace>`; ohne Liste oder bei einem Fehler: nein.
 */
async function sidekickHandoffListed($: EngineInterface): Promise<boolean> {
  try {
    return (await $.command.list()).some(
      (c) => c.name === 'handoff' && c.source === 'plugin' && (c.plugin === 'sidekick' || !!c.plugin?.startsWith('sidekick@')),
    )
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
          sysCur = sample
          if (!sysRedrawsFrom) sysRedrawsFrom = now
          // Neu gezeichnet wird nur, wenn die Messung übernommen wird (Nachtrag 0.14.1, Regel 2)
          if (takeSys(now, false) && refresh($, now)) sysRedraws += 1
          // Neuzeichnen angefordert, aber 15 s keins gekommen (Chat verdeckt, Band eingeklappt): beenden; das nächste Zeichnen
          // startet neu. Nur mit offener Anforderung: Bei gleichbleibenden Werten zeichnet ohnehin nichts neu (Review 0.13.0 S1)
          if (awaitingRender && now - awaitingSince > SYS_IDLE) stopSys()
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

/** Neu zeichnen nur bei sichtbarer Änderung (Minute, Prozent, Kontext, Zustand). `true`, wenn neu gezeichnet werden soll. */
function refresh($: EngineInterface, now: number): boolean {
  const v = snapshot(now)
  const key = keyOf(v)
  publishBand($, v, key)
  if (key === drawnKey) return false
  if (!awaitingRender) awaitingSince = now
  awaitingRender = true
  $.ui.invalidate('ui.render')
  return true
}

/**
 * Systemwerte in die Anzeige übernehmen (Nachtrag 0.14.1). Ohne `force` nur nach den Regeln in `sysAdopt` (Farbstufe, Zeile
 * dazu/weg, ≥ 2 Punkte nach ≥ 5 s); mit `force` (ein Zeichnen kommt ohnehin) immer die neueste Messung. Dieselbe Messung wird
 * nie zweimal übernommen, sonst verlöre der Pfeil seinen Vergleichswert. Der Pfeil vergleicht mit dem zuvor angezeigten Wert.
 */
function takeSys(now: number, force: boolean): boolean {
  if (!isWindows || !shownParts().system) return false
  const live = sysView(sysCur, shownPrev(sysShown), now, lang).rows
  const from = live[0]!.pct === null ? -1 : sysCur!.at
  if (from === sysShownFrom) return false
  if (!force && !sysAdopt(sysShown, live, now - sysShownAt)) return false
  sysShown = live
  sysShownAt = now
  sysShownFrom = from
  return true
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
  cfg = {}
  applyCfg(readSettings(SETTINGS, options))

  on('session.start', async ($, e, next) => {
    // Windows: Laufwerksbuchstabe im Arbeitsordner (SessionStartInput.cwd, absolut) oder in storagePath; ohne neues Recht
    isWindows = /^[A-Za-z]:[\\/]/.test(e.cwd ?? '') || !!driveOf(storagePath)
    // Nur wo das Band gezeichnet wird (types@2.1.288:9576); `-p`/SDK liefern null, VS Code und mobil zeichnen kein Band
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      lastSurface = e.surface
      await loadWindows($)
      publishBand($, snapshot(await $.clock.now()))
      if (wins.length > 0) $.ui.invalidate('ui.render')
      // Speicher-Ring: außerhalb des Hooks, der Sitzungsstart wartet nicht auf PowerShell; ausgeblendet kein PowerShell
      maybeStartDisk($)
    }
    // Danach (nicht gleichzeitig, beide schreiben settings.json) die Aus-Standards einmal speichern (hooks/offdefaults.ts)
    void migrate($).catch(() => {}).then(() => storeOffDefaults($, SELF, SETTINGS))
    // Ausbau 0.15.0: die Übergaben von /handoff (bis 0.14.x) sind weg, /handoff gehört sidekick; der Rest im Speicher wird einmal gelöscht
    $.store.delete('handoffs').catch(() => {})
    await bindSession($)
    $.clock
      .now()
      .then((now) => {
        // Zählung „Neuzeichnen wegen Systemwerten“ ab Sitzungsstart, damit `/bars` die Zeile von Anfang an zeigt
        if (!sysRedrawsFrom) sysRedrawsFrom = now
        return cleanup($, now)
      })
      .catch(() => {})
    // Befehle zuletzt, jeder für sich (CLAUDE.md, Registrieren in session.start)
    const t = T[lang]
    for (const c of [
      { name: 'cache', description: t.cmdCache, argumentHint: CACHE_HINT },
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
        $.ui.toast((await sidekickHandoffListed($)) ? t.abortToastHandoff : t.abortToast, { timeoutMs: 12000 })
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
      const s = applySetting(settings, key, value ?? '')
      if (!s) return { text: t.unknownArg(e.args.trim(), CACHE_ARGS) }
      // Nur das Feld, das der Befehl nennt: ein anderer Chat kann die übrigen inzwischen geändert haben (Review 0.16.0 S1)
      const before = cachePatch(settings)
      const patch: Values = {}
      for (const [k, v] of Object.entries(cachePatch(s))) if (v !== before[k]) patch[k] = v
      if (typeof patch.bigTokens === 'number' && patch.bigTokens < SETTINGS.bigTokens!.min!) return { text: t.unknownArg(e.args.trim(), CACHE_ARGS) }
      const r = await writeSettings($, SELF, SETTINGS, patch, lang)
      // Auch nach Weg 1: die Karte unten zeigt sonst den alten Stand dieser Instanz (Review 0.16.0 S2)
      if (r.ok) applyCfg(patch)
      note = `${writeNote(r, lang)}\n`
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
    const sidekickHandoff = await sidekickHandoffListed($)
    const guardBySidekick = settings.guard && (await sidekickAsks($))
    const text = cacheReport({ now, mem, settings, keep, cold, last, limits, sessionUsd, sidekickHandoff, lang, guardBySidekick })
    return { text: note + text }
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

  // /bars: Teile der Anzeige ein- und ausblenden (SPEC.md, Ausbau v0.6.0); seit 0.16.0 schreibt es die Felder in userConfig.
  on('command.run', { command: 'bars' }, async ($, e) => {
    // Sprache aller fynn-mods (docs/LANGUAGE-SPEC.md §6 Punkt 2), vor allem, was Store, Uhr oder Zustand liest; fängt Fehler selbst ab
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: 'limit-bars', cmd: 'bars', lang }, e.args) }
    const t = T[lang]
    const c = parseBars(e.args)
    if (c.kind === 'bad') return { text: t.unknownArg(e.args.trim(), BARS_HINT) }
    if (c.kind === 'help') {
      await readCostState($)
      await bindSession($)
      const data = barsHelpData({
        lang,
        options: rawOptions,
        shown: shownParts(),
        overrides: {},
        storagePath,
        hasDrive: !!driveOf(storagePath),
        settings,
        memTtl: mem.ttl,
        memTtlSource: mem.ttlSource,
        keep,
        style: styleNow(),
        styleByCommand: false,
        noFive: noFiveHour(),
        hasCost: !!costHere,
        guardBySidekick: settings.guard && (await sidekickAsks($)),
        isWindows,
      })
      return { text: helpMarkdown(data, rememberHelp(await $.clock.now(), data)) }
    }
    let note = ''
    // Schreibt die Felder in userConfig (SETTINGS-SPEC §4). Weg 1 lädt die Mod neu, Weg 2 zieht die Werte hier nach.
    const change = async (patch: Values): Promise<boolean> => {
      const r = await writeSettings($, SELF, SETTINGS, patch, lang)
      // Auch nach Weg 1: die Tabelle unten zeigt sonst den alten Stand dieser Instanz (Review 0.16.0 S2)
      if (r.ok) applyCfg(patch)
      note = writeNote(r, lang)
      return r.ok
    }
    if (c.kind === 'reset') {
      // Alle Anzeige-Felder auf den Standard aus plugin.json
      const patch: Values = { style: 'bar', onlyFiveHour: false }
      for (const p of PARTS) patch[PART_FIELD[p]] = SETTINGS[PART_FIELD[p]]!.default
      if (!(await change(patch))) return { text: note }
      if (!shownParts().system) stopSys()
    } else if (c.kind === 'set') {
      // Speicher-Ring ohne Laufwerk: nichts speichern, sondern sagen, wo der Pfad hingehört
      if (c.part === 'storage' && c.on && !driveOf(storagePath)) return { text: storagePath ? t.storageWindowsOnly : t.storageOff }
      // Säulen nur unter Windows: nichts speichern, sondern es sagen (SPEC Ausbau 0.12.0, 2.)
      if (c.part === 'system' && c.on && !isWindows) return { text: t.sysWindowsOnly }
      const patch: Values = { [PART_FIELD[c.part]]: c.on }
      // Woche an: das veraltete onlyFiveHour darf sie nicht weiter ausblenden
      // (immer: nach gescheitertem Umzug steht es lokal schon auf false, gespeichert aber noch auf true; Review K5)
      if (c.part === 'weekly' && c.on) patch.onlyFiveHour = false
      if (!(await change(patch))) return { text: note }
      if (c.part === 'system' && !c.on) stopSys()
    } else if (c.kind === 'style') {
      if (!(await change({ style: c.style }))) return { text: note }
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
      return `| ${t.barsPart[p]} | ${state} |`
    })
    rows.push(`| ${t.barsStyle} | ${t.styleName[styleNow()]} |`)
    const lines: string[] = []
    if (c.kind === 'set') lines.push(t.barsSet(t.barsPart[c.part], c.on ? t.barsOn : t.barsOff), '')
    if (c.kind === 'reset') lines.push(t.barsReset, '')
    if (c.kind === 'style') lines.push(t.styleSet(t.styleName[c.style]), ...(c.style === 'ring' && lastSurface === 'terminal' ? [t.styleDesktopOnly] : []), '')
    lines.push(t.barsTitle, '', t.barsHead, '|---|---|', ...rows, '', t.barsUsage)
    // Cache-Ring aus heißt nur: Anzeige weg (Fynn); Rückfrage und Hinweise bleiben
    if (c.kind === 'set' && c.part === 'cache' && !c.on) lines.push(t.barsCacheNote)
    // Kosten und CPU/RAM: Stand, letzte Messung, Fehler (SPEC Ausbau 0.12.0)
    const extra: string[] = []
    if (sh.cost) extra.push(costHere ? t.costLine(costText(costHere, lang)) : t.costNone)
    if (sh.system && isWindows) {
      const now = await $.clock.now()
      if (now < sysPausedUntil) extra.push(t.sysPaused(hhmm(sysPausedUntil)))
      // Die angezeigten Werte, nicht die letzte Messung (Nachtrag 0.14.1, Regel 5)
      const rowsNow = sysShown ?? []
      if (sysCur && rowsNow.length && rowsNow[0]!.pct !== null) extra.push(t.sysLine(hhmm(sysCur.at), rowsNow.map((r) => `${r.tag} ${r.pct}%`).join(' · ')))
      else extra.push(t.sysNone)
      if (sysErr && sysErrAt > (sysCur?.at ?? 0)) extra.push(t.sysFailed(hhmm(sysErrAt), sysErr))
      // Zum Abgleich vorher/nachher: Neuzeichnen wegen Systemwerten seit dem letzten Aufruf (wie `/clawd status`)
      if (sysRedrawsFrom) {
        const ms = now - sysRedrawsFrom
        if (ms > 0) extra.push(t.sysRedraws(String(Math.round((sysRedraws * 60_000) / ms)), String(sysRedraws), String(Math.round(ms / 1000))))
        sysRedraws = 0
        sysRedrawsFrom = now
      }
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
      if (!usageAsked) {
        await loadWindows($)
      }
      maybeStartDisk($)
      // Kostenring: im Zeichnen lesen, das abonniert den Wert (ein Schreiben von cost-ledger zeichnet neu)
      await readCostState($)
      const now = await $.clock.now()
      awaitingRender = false
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
      // Zeichnet das Band ohnehin (Limits, Cache, Kosten, ein anderer Mod, `/bars`): die neuesten Systemwerte gleich mit, die 5 s
      // beginnen neu (Nachtrag 0.14.1, Regel 3)
      takeSys(now, true)
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
