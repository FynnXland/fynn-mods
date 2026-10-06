// limit-bars: Hooks-Modul. Im Band über dem Prompt (AbovePrompt, docs/raw/en/interface.md:207-213) zwei schmale Balken für das
// 5-Stunden- und das Wochenlimit und rechts daneben ein Ring, wie lange der Prompt-Cache dieser Session noch warm ist.
// Limits: `$.session.usage()` beim Start und bei jedem Tick, dazu `session.measure` (types@2.1.288:10410-10436).
// Cache: `turn.step` der Hauptschleife (usage mit cache_read/cache_creation, types@2.1.289:12837-12869), gespeichert in `$.store`.
// Dazu die Cache-Wache nach Nate Herks Cache Keeper (docs/vorlagen/nateherk-cache-keeper, MIT): Rückfrage vor kaltem Senden,
// Hinweis kurz vor Ablauf, /cache, /handoff mit Skill „uebergabe“, /keepwarm (Standard aus).
// Texte en/de nach `userConfig.language` (i18n.ts); Argumente englisch, die deutschen gelten weiter als Alias.
// Fail-open: Ein Fehler heißt nur „keine Anzeige“ bzw. „Nachricht geht unverändert durch“; was andere Mods zeichnen, bleibt erhalten.
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { joinBand, splitBand } from './band.ts'
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
import { PARTS, cleanOverrides, displayFromOptions, effectiveDisplay, parseBars } from './display.ts'
import type { Display, Overrides } from './display.ts'
import type { Lang } from './i18n.ts'
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
import { EMPTY, ORANGE, filled, layoutTerminal, pickWindows, placeholderWindows, shownWindows } from './view.ts'
import type { Opts, ResetStyle, Shown, Win } from './view.ts'

// Optionen aus userConfig, in register() gesetzt
let lang: Lang = 'en'
let opts: Opts = { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang }
// Welche Teile zu sehen sind (display.ts): userConfig, darüber die `/bars`-Werte aus `$.store` (`display`), die jeder Takt
// neu liest, damit ein `/bars` in einem anderen Chat hier binnen 10 s wirkt
let baseDisplay: Display = displayFromOptions({})
let overrides: Overrides = {}
const shownParts = () => effectiveDisplay(baseDisplay, overrides)
let displayPinned = false // /bars konnte nicht speichern: der lokale Wert gilt, der Takt liest ihn nicht neu

// Limits: flüchtig (Kontingent gehört zum Konto und kommt mit jeder Messung neu)
let wins: Win[] = []
let usageAsked = false
// 10-s-Takt, nur solange das Band gezeichnet wird (Timer mit cancel(), types@2.1.288:11912-11917; eine abgelehnte Periode beendet ihn,
// types@2.1.288:3251). Jeder Tick holt `$.session.usage()`: Das sind die Werte der letzten API-Antwort (types@2.1.288:11033-11034), also
// auch mitten in einem langen Turn, während `session.measure` erst am Turn-Ende kommt (Fynn, 2026-10-05: "aktualisiert viel zu selten").
// Der Takt läuft auch ohne Daten. Neu gezeichnet wird nur, wenn sich etwas Sichtbares ändert (Fynn, 2026-10-05: Jedes
// Invalidate zeichnet das ganze Band neu, auch die Knöpfe anderer Mods, die dann beim Darüberfahren flackerten).
const TICK = 10000
let timer: Timer | null = null
let drawnKey = '' // was zuletzt gezeichnet wurde (Texte, Farben, Füllstufen)
let awaitingRender = false // ein Neuzeichnen ist angefordert, aber noch nicht gekommen
let timerSince = 0 // Uhrzeit beim Start des Takts
let ticks = 0 // Ticks seit dem Start
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
const PROBE_EVERY = 60 // Ticks: alle 10 min
const SCAN_MAX_AGE = 60 * 60000 // /disk scannt neu, wenn der letzte Scan älter ist
const SCAN_LOCK = 5 * 60000 // ein Scan, der in einer anderen Sitzung gerade läuft, gilt so lange als laufend
const SCAN_PAUSE = 24 * 60 * 60000 // nach einem gescheiterten Scan keine automatischen Scans (/disk refresh geht immer)
// Daten der /disk-Ansichten für das Zeichnen der Befehlszeile (Kennung im Text, wie cost-ledger /ledger)
const reports = new Map<string, StorageReport>()
let reportNo = 0

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
    wins = pickWindows((await $.session.usage()).rateLimits)
  } catch {
    // kein Anfangsstand
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
  }
  try {
    const saved = cleanMem(await $.store.get(`cache:${id}`))
    if (saved) mem = { lastActivity: saved.lastActivity, ttl: saved.ttl, ttlSource: saved.ttlSource, ctx: saved.ctx, model: saved.model }
  } catch {
    // ohne gespeicherten Stand: unbekannt bis zur ersten Anfrage
  }
}

function persist($: EngineInterface, now: number) {
  if (!sessionId) return
  $.store.set(`cache:${sessionId}`, { ...mem, savedAt: now }).catch(() => {})
}

/** Einträge älter als 7 Tage aufräumen (SPEC, Persistenz). */
async function cleanup($: EngineInterface, now: number) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith('cache:')).slice(0, 200)
  for (const k of keys) {
    const m = cleanMem(await $.store.get(k))
    if (!m || now - m.savedAt > 7 * 24 * 60 * MIN) await $.store.delete(k)
  }
}

function stopKeep($: EngineInterface, why: string) {
  if (!keep) return
  const k = keep
  keep = null
  keepTimer?.cancel()
  keepTimer = null
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
  const shown = wins.length > 0 ? only(shownWindows(wins, now, o)) : []
  const ttl = ttlOf(mem, settings)
  const st = cacheState(mem.lastActivity, ttl, now, !!keep)
  const big = mem.ctx >= settings.bigTokens
  const drive = driveOf(storagePath)
  const dv = sh.storage && drive && disk.d ? diskView(drive, disk.d, disk.scan, lang) : undefined
  return {
    shown,
    // Desktop: ohne Limits Platzhalter (5h –, 7d –), damit die Balken sofort sichtbar sind; nur die eingeschalteten
    bars: wins.length > 0 ? shown : only(placeholderWindows(o)),
    ring: sh.cache ? ringFor(st, ttl, mem.ctx, big, lang) : undefined,
    block: sh.cache ? terminalBlock(st, big, lang) : null,
    disk: dv,
    diskBlock: dv ? `${dv.label} ${dv.main}${dv.sub}` : undefined,
  }
}

/** Alles, was im Band sichtbar ist, als Schlüssel: ändert er sich, muss neu gezeichnet werden, sonst nicht. */
function keyOf(v: ReturnType<typeof snapshot>): string {
  const r = v.ring
  return JSON.stringify([
    v.bars.map((x) => [x.tag, x.pct.long, x.reset?.long ?? '', x.color, x.strong, x.fresh, Math.round(x.ratio * 44)]),
    r ? [r.main, r.sub ?? '', r.subColor ?? '', r.color, r.mainColor, ringFilled(r.fill), r.kept] : null,
    v.block?.text ?? '',
    v.disk ? [v.disk.main, v.disk.sub, v.disk.arcs.map((a) => [a.color, Math.round(a.to * 360)])] : null,
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
    overrides = cleanOverrides(await $.store.get('display'))
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

/** Neu zeichnen nur bei sichtbarer Änderung (Minute, Prozent, Kontext, Zustand). */
function refresh($: EngineInterface, now: number) {
  if (keyOf(snapshot(now)) === drawnKey) return
  awaitingRender = true
  $.ui.invalidate('ui.render')
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  const hl = typeof options.highlightAt === 'number' && Number.isFinite(options.highlightAt) ? options.highlightAt : 90
  lang = langOf(options.language)
  opts = {
    resetStyle: STYLES.find((s) => s === options.resetStyle) ?? 'mixed',
    highlightAt: Math.max(50, Math.min(100, hl)),
    onlyFiveHour: options.onlyFiveHour === true,
    lang,
  }
  storagePath = typeof options.storagePath === 'string' ? options.storagePath.trim() : ''
  baseDisplay = displayFromOptions(options)

  on('session.start', async ($, e, next) => {
    // Nur wo das Band gezeichnet wird (types@2.1.288:9576); `-p`/SDK liefern null, VS Code und mobil zeichnen kein Band
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      await readDisplay($)
      await loadWindows($)
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
          cold.usd += rewriteCost(res.coldWritten, res.mem.model, ttlOf(res.mem, settings))
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
    const text = cacheReport({ now, mem, settings, keep, cold, last, limits, sessionUsd, handoffAt: list[0]?.at ?? null, lang })
    return { text: note + text }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const t = T[lang]
    const arg = e.args.trim().toLowerCase()
    if (arg === 'show' || arg === 'zeigen') {
      const list = await loadHandoffs($)
      return { text: list[0] ? t.handoffLast(hhmm(list[0].at), list[0].text) : t.handoffNoneSaved }
    }
    if (arg === 'continue' || arg === 'weiter') {
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
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'aus' || (arg === '' && keep)) {
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
    const t = T[lang]
    const c = parseBars(e.args)
    if (c.kind === 'bad') return { text: t.unknownArg(e.args.trim(), BARS_HINT) }
    await readDisplay($)
    let note = ''
    if (c.kind === 'reset') {
      overrides = {}
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
      overrides = { ...overrides, [c.part]: c.on }
      try {
        await $.store.set('display', overrides)
        displayPinned = false
      } catch (err) {
        displayPinned = true
        note = t.barsSaveFailed(msg(err))
      }
    }
    try {
      refresh($, await $.clock.now())
      maybeStartDisk($)
    } catch {
      // Anzeige folgt mit dem nächsten Zeichnen
    }
    const sh = shownParts()
    const rows = PARTS.map((p) => {
      const state = !sh[p] ? t.barsOff : p !== 'storage' || driveOf(storagePath) ? t.barsOn : storagePath ? t.barsNotWindows : t.barsNoPath
      return `| ${t.barsPart[p]} | ${state} | ${overrides[p] !== undefined ? t.barsByCommand : t.barsBySetting} |`
    })
    const lines: string[] = []
    if (c.kind === 'set') lines.push(t.barsSet(t.barsPart[c.part], c.on ? t.barsOn : t.barsOff), '')
    if (c.kind === 'reset') lines.push(t.barsReset, '')
    lines.push(t.barsTitle, '', t.barsHead, '|---|---|---|', ...rows, '', t.barsUsage)
    // Cache-Ring aus heißt nur: Anzeige weg (Fynn); Rückfrage und Hinweise bleiben
    if (c.kind === 'set' && c.part === 'cache' && !c.on) lines.push(t.barsCacheNote)
    if (note) lines.push('', note)
    return { text: lines.join('\n') }
  })

  // /disk: Belegung nach Dateiart. Antwortet mit Markdown; auf Terminal und Desktop zeichnet der CommandOutput-Hook darunter
  // stattdessen den großen Ring mit Legende (types@2.1.290:9695-9725, Vorbild cost-ledger /ledger).
  on('command.run', { command: 'disk' }, async ($, e) => {
    const t = T[lang]
    const arg = e.args.trim().toLowerCase()
    if (arg && arg !== 'refresh') return { text: t.unknownArg(e.args.trim(), 'refresh') }
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
      wins = pickWindows(e.rateLimits)
      refresh($, await $.clock.now())
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
      // Nennt `session.start` die Oberfläche nicht (z. B. eine App, die als SDK startet), holt das erste Zeichnen den Anfangsstand
      // Ersatzweg, wenn session.start die Oberfläche nicht nannte: auch die /bars-Werte holen (Review 0.6.0, S1)
      if (!usageAsked) {
        await readDisplay($)
        await loadWindows($)
      }
      maybeStartDisk($)
      const now = await $.clock.now()
      awaitingRender = false
      // Eine abgelehnte Periode beendet das Intervall still: bleiben zwei Ticks aus, wird der Takt neu gestartet
      if (timer && now - timerSince >= (ticks + 2) * TICK) {
        timer.cancel()
        timer = null
      }
      if (!timer) {
        timerSince = now
        ticks = 0
        timer = $.clock.every(TICK, () => {
          ticks += 1
          // Neuzeichnen angefordert, aber keins gekommen (Band eingeklappt, Sitzung verdeckt): Takt beenden; das nächste Zeichnen
          // startet ihn neu. Ohne Änderung wird nichts angefordert, dann läuft er still weiter (usage() ist kostenlos).
          if (awaitingRender) {
            timer?.cancel()
            timer = null
            return
          }
          // Kostenlos ohne `breakdown`; leer heißt "noch keine Antwort", dann bleibt der bisherige Stand
          bindSession($)
            .then(() => readDisplay($))
            .then(() => maybeStartDisk($))
            .then(() => $.session.usage())
            .then((u) => {
              const fresh = pickWindows(u.rateLimits)
              if (fresh.length > 0) wins = fresh
              // Kontext zwischen den Turns (types@2.1.289:10406-10411); fehlt nach /clear und /compact bis zur nächsten Antwort
              if (mem.lastActivity && typeof u.context.tokens === 'number') mem = { ...mem, ctx: u.context.tokens }
              if (u.cost) sessionUsd = u.cost.usd
              return $.clock.now()
            })
            .then((t) => {
              alertStep($, t)
              refresh($, t)
            })
            .catch(() => {
              // abgelehnt: es bleibt beim letzten Stand
            })
          // Speicher-Ring: Gesamt/frei alle 10 min (nur solange gezeichnet wird, wie der ganze Takt)
          if (ticks % PROBE_EVERY === 0 && driveOf(storagePath) && shownParts().storage) probeDisk($).catch(() => {})
        })
      }
      // Eine Umfrage hält das Band; ein Hook weicht ihr (types@2.1.288:9580)
      if (e.props.hasSurvey) return await pass(e)
      const view = snapshot(now)
      drawnKey = keyOf(view)
      // Alles ausgeblendet: nichts Eigenes und kein freigehaltener Platz (bodyColumns unverändert); der Takt läuft weiter,
      // damit ein `/bars` aus einem anderen Chat und die Hinweise vor Ablauf hier ankommen
      if (view.bars.length === 0 && !view.ring && !view.disk) return await pass(e)
      const { Box, Text } = $.ui.resolve(e)
      let mine: RenderNode
      let stack = false
      if (e.surface === 'desktop') {
        // Desktop: was eingeschaltet ist (Cache-Ring vor der ersten Anfrage grau mit „–“), Balken mit Werten, sobald es Limits gibt; kein Umschreiben von
        // bodyColumns, weil Clawds Svg eine feste Größe hat
        theirs = await pass(e)
        const { Svg } = $.ui.resolve(e)
        // Ohne Limits stehen Platzhalter da (5h –, 7d –), damit die Balken wie der Ring sofort sichtbar sind
        const pic = desktopSvg(view.bars, view.ring, view.disk)
        // Unten bündig mit Clawds Füßen, auch wenn die Desktop-App alignItems der äußeren Zeile nicht umsetzt (Spalte + flex-end)
        mine = Box({ key: 'limit-bars', flexShrink: 0, flexDirection: 'column', justifyContent: 'flex-end', children: [Svg({ source: pic.source, alt: pic.alt, width: pic.width, height: pic.height })] })
      } else {
        // Hinter den Balken: Cache-Block, dahinter der Speicher-Block; wird es eng, fällt der Speicher-Block zuerst weg
        const cacheP = view.block ? [{ text: view.block.text, color: view.block.color, dim: false }] : []
        const diskP = view.diskBlock ? [{ text: view.diskBlock, color: undefined, dim: true }] : []
        let parts = [...cacheP, ...diskP]
        const joined = (p: typeof parts) => (p.length > 0 ? p.map((x) => x.text).join('  ') : undefined)
        let lay = layoutTerminal(view.shown, e.props.bodyColumns, joined(parts))
        if (diskP.length > 0 && !lay?.extra) {
          parts = cacheP
          lay = layoutTerminal(view.shown, e.props.bodyColumns, joined(parts))
        }
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
          const f = filled(s.ratio, b.width)
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
                children: [
                  ...(f > 0 ? [Text({ color: s.color, children: ['▄'.repeat(f)] })] : []),
                  ...(f < b.width ? [Text({ color: EMPTY, children: ['▄'.repeat(b.width - f)] })] : []),
                ],
              }),
            ],
          })
        })
        // Cache- und Speicher-Block hinter den Balken, auf der Zeile der Beschriftungen
        if (lay.extra && parts.length > 0) {
          const line = parts.flatMap((p, i) => [
            ...(i > 0 ? [Text({ children: ['  '] })] : []),
            p.dim ? Text({ dimColor: true, children: [p.text] }) : Text({ color: p.color, children: [p.text] }),
          ])
          children.push(Box({ key: 'cache', flexDirection: 'column', flexShrink: 0, children: [Box({ flexDirection: 'row', children: line }), Text({ children: [' '] })] }))
        }
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
      const { layers, base } = splitBand(theirs)
      if (!base) return joinBand(layers, mine)
      // Ohne weitere Mods antwortet der Kern mit seinem eigenen Knoten `{type:'engine'}` (types@2.1.288:9033-9041), der im Band
      // nichts zeichnet (types@2.1.288:9570). Dann ist limit-bars innen bzw. allein, der Knoten bleibt erhalten. Er steht NEBEN den
      // Balken, nicht darunter: Die Desktop-App gibt ihm Höhe, übereinander rutschten die Balken über Clawds Füße (Fynn, 2026-10-03).
      if (typeof base === 'object' && base.type === 'engine' && !stack) {
        return joinBand(layers, Box({ flexDirection: 'row', alignItems: 'flex-end', children: [mine, Box({ flexGrow: 1, children: [base] })] }))
      }
      if (stack) return joinBand(layers, Box({ flexDirection: 'column', children: [mine, base] }))
      // limit-bars weiter außen: Balken links, der Rest rechts, unten bündig (wie clawd-buddy, gespiegelt gebaut)
      return joinBand(
        layers,
        Box({
          flexDirection: 'row',
          alignItems: 'flex-end',
          // Rechte Seite: Inhalt nach rechts (alignItems) und nach unten (justifyContent) als Spalte, unabhängig von alignItems der Zeile
          children: [mine, Box({ flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-end', children: [base] })],
        }),
      )
    } catch (err) {
      // Fehler aus der Kette: weiterwerfen, die Engine behandelt den Hook dann als gescheitert (docs/raw/en/events.md:313-316)
      if (nextFailed) throw err
      // Eigener Fehler (fail-open): ohne Anzeige; der Inhalt der anderen bleibt, `next` läuft höchstens einmal
      return called ? theirs : next(e)
    }
  })
}
