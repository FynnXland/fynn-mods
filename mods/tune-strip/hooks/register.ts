// tune-strip: Hooks-Modul. Ein Spotify-Regler im Band über dem Prompt (AbovePrompt): Cover, Titel, Interpret, Position, klickbare Knöpfe.
// Quelle ist die Windows-Mediensteuerung per Windows PowerShell 5.1 (`$.process.run`, ps.ts): kein Login, keine Tokens, kein Netzwerk,
// keine Datei. Der Takt (`$.clock.every`) läuft nur, solange das Band gezeichnet wird; keine Zeichnung → er beendet sich selbst.
// Das Band ist ein Platz (Nr. 20) in der Grund-Zeile (band.ts, docs/BAND.md): zwischen limit-bars (10) und clawd-buddy (30).
// Texte en/de nach `userConfig.language` (i18n.ts); Befehle und Argumente englisch.
// Fail-open: Ein Fehler heißt nur „keine Anzeige“; was andere Mods ins Band zeichnen, bleibt erhalten.
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { joinBand, layer, levelOf, slot, splitBand, SLOTS } from './band.ts'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { T, langOf } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { BEAT_BOOT, BEAT_CS } from './beat-cs.ts'
import { Tracker, needsWrite, parseLine, sameBeat, splitLines } from './beat.ts'
import type { Beat } from './beat.ts'
import { actionFor, desktopRoom, desktopStage, fmtTime, OFFSET_MAX, parseTune, pickStage, pollInterval, positionNow, SIZES } from './model.ts'
import { isLanguage, languageCommand, languageHelp } from './language.ts'
import type { Action, ControlWord, Size, Stage } from './model.ts'
import { CONTROL_SCRIPT, PS_ABS, PS_ARGS, QUERY_SCRIPT, REPEAT_MODES, parseQuery, trackKey } from './ps.ts'
import type { Query, Track } from './ps.ts'
import { BAR_LEVEL, DESKTOP_WIDTHS, TERMINAL_WIDTHS, desktopTree, terminalTree } from './view.ts'
import type { Els, Handlers } from './view.ts'

const ACCENT = 'success' // Akzent der Hilfe (Theme-Key, HELP-SPEC §4); Spotify-Grün
const TICK = 1000 // Takt in ms; gelesen wird alle pollSeconds
const POS_REDRAW = 5000 // Zeit und Balken der Leiste höchstens so oft neu zeichnen (öfter flackert es und verschluckt Klicks)
const BACK_RESTART = 3 // „Zurück“ springt über 3 s an den Anfang des Titels, darunter zum vorigen Titel (wie Spotify)
const HOLD_MS = 10000 // so lange bleibt die Leiste stehen, wenn die Mediensteuerung keine Sitzung meldet (Titelwechsel)
const WAIT_MS = { track: 1500, other: 200 } // Wartezeit im Steuer-Skript, bis die Mediensteuerung den neuen Stand meldet

// Optionen aus userConfig, in register() gesetzt
let lang: Lang = 'en'
let optSize: Size | 'off' = 'auto'
let pollSeconds = 4
let extraButtons = false
// Einstellungen aus `$.store` (`/tune size|on|off|beat`), gelten in allen offenen Chats
type Saved = { size?: Size; enabled?: boolean; beat?: boolean; offset?: number }
let saved: Saved = {}

// Sitzungsstand
let surface: string | null = null
// Oberfläche aus dem Zeichnen: Im Desktop (SDK) meldet session.start `surface: null` (types@2.1.318:12620-12624), erst `ui.render`
// sagt `desktop`. Für den Takt-Helfer und das Nachmelden nach /clear zählen beide.
let drawSurface: string | null = null
let isWindows = true
let track: Track | null = null
let cover: string | undefined
let coverKey = ''
let queryAt = 0
let hasSession = false
let lostAt = 0 // seit wann keine Sitzung gemeldet wird (0 = Sitzung da)
let failures = 0
let inflight: Promise<void> | null = null
let timer: Timer | null = null
let awaitingRender = false
let renderMissed = 0 // Takte in Folge, in denen ein angefordertes Neuzeichnen ausblieb
// Erst nach so vielen Takten ohne Zeichnung gilt das Band als verdeckt (0.6.3): Der Desktop liefert ein Neuzeichnen nicht immer binnen
// 1 s; vorher hielt der Takt dann an, der Takt-Helfer endete 15 s später und musste neu einmessen („wartet“ trotz Musik, Fynn 2026-11-04)
const RENDER_GRACE = 4
let bandDrawn = false // zeichnet tune-strip gerade etwas ins Band (Stufe nicht „aus“)? Nur dann läuft der Takt-Helfer (Review 0.6.0 K3)
let drawsTime = false
let lastSig = ''
let lastDrawAt = 0
// Haltezeit der Trennlinie (0.9.0): „etwas darunter“ gilt sofort, „nichts darunter“ erst nach SEP_HOLD_MS. Beim Turnwechsel ist
// `quick-replies.band` kurz null, und ein abgelehntes `$.state.get` zählte wie „nichts“; beides ließ die Linie kurz verschwinden (Fynn, 2026-11-05)
const SEP_HOLD_MS = 3000
let sepOn = false // steht die Linie gerade?
let sepLostAt = 0 // erstes Zeichnen ohne etwas darunter, während die Linie stand (0 = nichts verloren); wie `lostAt` beim Titelwechsel
let sepHeld = false // die Linie steht nur noch wegen der Haltezeit; der Takt zeichnet nach deren Ende neu
// Jede Steuerung erhöht den Zählstand; eine Abfrage, die davor begann, wird verworfen (sie würde den Klick zurückdrehen)
let epoch = 0
let ctlChain: Promise<unknown> = Promise.resolve()

const enabled = () => saved.enabled ?? optSize !== 'off'
const sizeNow = (): Size => saved.size ?? (optSize === 'off' ? 'auto' : optSize)

function cleanSaved(v: unknown): Saved {
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  const out: Saved = {}
  const size = SIZES.find((s) => s === o.size)
  if (size) out.size = size
  if (typeof o.enabled === 'boolean') out.enabled = o.enabled
  if (typeof o.beat === 'boolean') out.beat = o.beat
  if (typeof o.offset === 'number' && Number.isInteger(o.offset) && Math.abs(o.offset) <= OFFSET_MAX) out.offset = o.offset
  return out
}

async function loadSaved($: EngineInterface): Promise<void> {
  try {
    saved = cleanSaved(await $.store.get('settings'))
  } catch {
    // Standard
  }
}

async function saveSaved($: EngineInterface, next: Saved): Promise<void> {
  // Vor dem Schreiben neu lesen: andere Sitzungen teilen den Store
  await loadSaved($)
  saved = { ...saved, ...next }
  await $.store.set('settings', saved)
}

/** Ein Stand, an dem man erkennt, ob sich für die Zeichnung etwas geändert hat. */
function sigOf(): string {
  return JSON.stringify([track?.title, track?.artist, track?.status, track?.shuffle, track?.repeat, Math.round(track?.end ?? 0), cover?.length ?? 0, hasSession])
}

/**
 * Abfragen. Läuft schon eine, wartet der Aufruf auf sie (ein zweiter PowerShell-Prozess startet nie gleichzeitig); mit `fresh`
 * (nach einem Steuerbefehl) folgt danach noch eine, weil die laufende vor dem Befehl begann.
 */
async function runQuery($: EngineInterface, fresh = false): Promise<void> {
  if (!isWindows) return
  if (inflight) {
    await inflight
    if (!fresh) return
  }
  const p = queryNow($)
  inflight = p
  try {
    await p
  } finally {
    inflight = null
  }
}

/**
 * Keine Sitzung gemeldet. Beim Titelwechsel fehlt sie für einen Moment; der letzte Stand bleibt dann HOLD_MS stehen (die Position läuft
 * weiter), erst danach verschwindet die Leiste. Sonst klappt sie bei jedem Wechsel zu und wieder auf.
 */
function lose(now: number): void {
  if (!track) return
  if (lostAt === 0) lostAt = now
  if (now - lostAt < HOLD_MS) return
  track = null
  hasSession = false
  cover = undefined
  coverKey = ''
  lostAt = 0
}

/** Stand aus einer Antwort der Abfrage übernehmen. */
async function adopt($: EngineInterface, q: Query): Promise<void> {
  failures = 0
  const now = await $.clock.now()
  if (!q.track) {
    lose(now)
    return
  }
  lostAt = 0
  noteTrack(track, queryAt, q.track, now)
  // Ohne lesbare Prozess-ID (Spotify beendet) kein Helfer gegen eine alte, tote ID (Review 0.6.0 K1)
  spotifyPid = q.pid ?? 0
  queryAt = now
  hasSession = true
  track = q.track
  if (q.cover) {
    cover = q.cover
    coverKey = q.track ? trackKey(q.track) : ''
  } else if (trackKey(q.track) !== coverKey) {
    cover = undefined
    coverKey = ''
  }
}

async function queryNow($: EngineInterface): Promise<void> {
  const mine = epoch
  try {
    const r = await $.process.run([PS_ABS, ...PS_ARGS, QUERY_SCRIPT], { env: { SP_KEY: track ? trackKey(track) : '' }, timeoutMs: 15000 })
    const q = parseQuery(r.stdout)
    if (!q) throw new Error('unreadable')
    if (mine !== epoch) return
    await adopt($, q)
  } catch {
    failures += 1
    if (failures >= 3) {
      track = null
      hasSession = false
    }
  }
}

/** Steuern und im selben Prozess neu lesen; die Antwort der Abfrage wird übernommen (nach einem Klick gilt sie als der neueste Stand). */
async function runControl($: EngineInterface, a: Action): Promise<'ok' | 'fail' | 'nosession'> {
  try {
    const wait = a.cmd === 'next' || a.cmd === 'prev' ? WAIT_MS.track : WAIT_MS.other
    const env = { SP_CMD: a.cmd, SP_ARG: a.arg ?? '', SP_WAIT: String(wait), SP_KEY: track ? trackKey(track) : '' }
    const r = await $.process.run([PS_ABS, ...PS_ARGS, CONTROL_SCRIPT], { env, timeoutMs: 15000 })
    const out = r.stdout.trim().split(/\r?\n/)[0]?.trim()
    if (out === 'nosession') {
      lose(await $.clock.now())
      return 'nosession'
    }
    const q = parseQuery(r.stdout)
    if (q) await adopt($, q)
    return out === 'ok' ? 'ok' : 'fail'
  } catch {
    return 'fail'
  }
}

/** Den erwarteten Stand sofort übernehmen, damit der Klick gleich zu sehen ist; die Antwort des Skripts bestätigt oder berichtigt ihn. */
function expectState(a: Action, now: number): void {
  if (!track) return
  const pos = positionNow(track, queryAt, now)
  let t: Track = { ...track, pos }
  if (a.cmd === 'toggle') t = { ...t, status: t.status === 'Playing' ? 'Paused' : 'Playing' }
  else if (a.cmd === 'play') t = { ...t, status: 'Playing' }
  else if (a.cmd === 'pause') t = { ...t, status: 'Paused' }
  else if (a.cmd === 'seek') t = { ...t, pos: Number(a.arg) || 0 }
  else if (a.cmd === 'next' || a.cmd === 'prev') t = { ...t, pos: 0 } // ein neuer Titel beginnt bei 0: der Balken springt sofort zurück
  else if (a.cmd === 'shuffle') t = { ...t, shuffle: a.arg === 'true' }
  else if (a.cmd === 'repeat') t = { ...t, repeat: REPEAT_MODES.find((m) => m === a.arg) ?? 'None' }
  track = t
  queryAt = now
}

/** Eine Steuerung der Reihe nach an Spotify geben (zwei schnelle Klicks bleiben in ihrer Reihenfolge) und danach neu zeichnen. */
function perform($: EngineInterface, a: Action): Promise<'ok' | 'fail' | 'nosession'> {
  const done = ctlChain.then(async () => {
    const res = await runControl($, a)
    await redraw($)
    return res
  })
  ctlChain = done.catch(() => {})
  return done
}

/** Sofort zeigen, was der Klick bewirken soll. */
async function show($: EngineInterface, a: Action): Promise<void> {
  epoch += 1
  const now = await $.clock.now()
  // Eigener Sprung im Titel: der Schlag davor gilt nicht mehr (die Abfrage danach sieht keinen Sprung, weil expectState ihn vorwegnimmt)
  if (a.cmd === 'seek') tracker.resetTiming(now)
  expectState(a, now)
  await redraw($)
}

/** Steuern per Befehl oder Klick. */
async function control($: EngineInterface, word: ControlWord, arg?: string): Promise<'ok' | 'fail' | 'nosession' | 'needTrack'> {
  if (!track) await runQuery($)
  const pos = track ? positionNow(track, queryAt, await $.clock.now()) : 0
  const action = actionFor(word, arg, track, pos)
  if (!action) return 'needTrack'
  await show($, action)
  return perform($, action)
}

/** Knopf im Band: „Zurück“ springt über 3 s an den Anfang, sonst zum vorigen Titel; alles andere wie der Befehl. */
async function pressButton($: EngineInterface, word: ControlWord): Promise<void> {
  if (word === 'prev' && track && positionNow(track, queryAt, await $.clock.now()) > BACK_RESTART) {
    const action: Action = { cmd: 'seek', arg: '0' }
    await show($, action)
    await perform($, action)
    return
  }
  await control($, word)
}

async function redraw($: EngineInterface): Promise<void> {
  lastSig = sigOf()
  awaitingRender = true
  $.ui.invalidate('ui.render')
}

/** Takt starten, wenn das Band gezeichnet wird; eine Periode, die die Engine ablehnt, beendet ihn still (limit-bars: gleiche Lehre). */
function ensureTimer($: EngineInterface, now: number): void {
  if (timer) return
  let last = now // das erste Lesen kam schon mit dem ersten Zeichnen
  timer = $.clock.every(TICK, () => {
    // Neuzeichnen angefordert, aber RENDER_GRACE Takte lang keins gekommen (Band eingeklappt, Sitzung verdeckt): Takt beenden, das
    // nächste Zeichnen startet ihn neu
    if (awaitingRender && ++renderMissed >= RENDER_GRACE) {
      timer?.cancel()
      timer = null
      return
    }
    tick($, () => last, (v) => (last = v)).catch(() => {
      // Uhr abgelehnt: es bleibt beim letzten Stand
    })
  })
}

/**
 * Ob gerade Musik läuft, für clawd-buddy (0.3.0, `$.state` `tune-strip.playing`, types/index.d.ts): `{ playing }` aus dem Status der
 * Mediensteuerung, `null` ohne Spotify-Sitzung oder wenn tune-strip aus ist; außerhalb von Windows wird nie geschrieben (bleibt leer). Kein Titel.
 */
const playingNow = (): { playing: boolean } | null => (enabled() && isWindows && track ? { playing: track.status === 'Playing' } : null)
let publishedPlaying = '' // zuletzt geschriebener Wert als JSON ('' = noch keiner oder Schreiben gescheitert)
let playingCheckedAt = 0
const PLAYING_RECHECK = 30_000 // so oft den eigenen Wert lesen: /clear, /resume und /branch setzen `$.state` zurück

/**
 * `tune-strip.playing` schreiben, wenn sich der Wert geändert hat (nie beim Zeichnen, types@2.1.295:3405: dort abgelehnt). Ein Schreiben
 * zeichnet die Stellen neu, die den Wert lesen (Clawd). Scheitert es, versucht es der nächste Takt wieder.
 */
async function publishPlaying($: EngineInterface, now: number): Promise<void> {
  const want = JSON.stringify(playingNow())
  try {
    if (want === publishedPlaying && now - playingCheckedAt < PLAYING_RECHECK) return
    playingCheckedAt = now
    if (want === publishedPlaying) {
      const cur = await $.state.get({ plugin: 'tune-strip', key: 'playing' })
      if (JSON.stringify(cur.value ?? null) === want) return
    }
    publishedPlaying = ''
    await $.state.set({ plugin: 'tune-strip', key: 'playing' }, playingNow())
    publishedPlaying = want
  } catch {
    publishedPlaying = ''
  }
}

// ---- Takt (0.6.0, SPEC Nachtrag 0.6.0): ein Helfer je sichtbarer Sitzung hört nur Spotify ab (beat-cs.ts), beat.ts wertet aus,
// `tune-strip.beat` geht an clawd-buddy. Kein Titel verlässt den Mod: `beatKey` wird nur hier verglichen.
const BEAT_GRACE = 15_000 // so lange läuft der Helfer nach Pause, ohne Zeichnung usw. weiter (SPEC: „spätestens 15 s“)
const RETRY_MS = [5_000, 20_000, 60_000] // höchstens drei Neustarts mit wachsendem Abstand, danach erst beim nächsten Titel
type HelperRun = { pid: number; stop: boolean; stream: ReturnType<EngineInterface['process']['spawn']> | null }
type HelperState = 'idle' | 'starting' | 'listening' | 'failed' | 'gaveUp'
let tracker = new Tracker()
let spotifyPid = 0
let helper: HelperRun | null = null
let helperState: HelperState = 'idle'
let helperFails = 0
let retryAt = 0
let beatKey: string | null = null
let unwantedSince = 0
let clockNow = 0 // letzte gelesene Uhrzeit, für das Ende des Helfers (dort gibt es kein await mehr)
let beatTimer: Timer | null = null
let publishedBeat: Beat | null | undefined = undefined // undefined = noch nichts geschrieben oder Schreiben gescheitert
let beatWrittenAt = 0
let beatCheckedAt = 0

const beatOn = () => saved.beat ?? true
const offsetMs = () => saved.offset ?? 0
const visibleSurface = () => [surface, drawSurface].some((s) => s === 'terminal' || s === 'desktop')

/** Soll gerade ein Helfer laufen? Nur unter Windows, Band an, Takt an, Spotify spielt, das Band wird gezeichnet (Takt läuft). */
function wantHelper(): boolean {
  return isWindows && visibleSurface() && enabled() && beatOn() && timer !== null && bandDrawn && track?.status === 'Playing' && spotifyPid > 0
}

/** Der Wert für `tune-strip.beat`: `null` ohne laufenden Helfer, bei Pause, aus oder ohne tragende Messung. */
function beatNow(now: number): Beat | null {
  if (!enabled() || !beatOn() || helper === null || track?.status !== 'Playing') return null
  return tracker.value(now, offsetMs())
}

/**
 * Titelwechsel, Sprung im Titel, Weiterspielen nach Pause: der Takt davor gilt nicht mehr. Beim neuen Titel auch die Gruppe und die
 * Zahl der Neustarts zurück. `start` ist der Titelbeginn laut Position.
 */
function noteTrack(prev: Track | null, prevAt: number, next: Track, now: number): void {
  const key = trackKey(next)
  if (key !== beatKey) {
    beatKey = key
    tracker.reset(now - next.pos * 1000)
    helperFails = 0
    retryAt = 0
    if (helperState === 'gaveUp' || helperState === 'failed') helperState = 'idle'
    return
  }
  if (!prev || next.status !== 'Playing') return
  if (prev.status !== 'Playing' || Math.abs(positionNow(prev, prevAt, now) - next.pos) > 2.5) tracker.resetTiming(now)
}

function stopHelper(): void {
  const run = helper
  helper = null
  if (helperState !== 'gaveUp') helperState = 'idle'
  unwantedSince = 0
  if (!run) return
  run.stop = true
  // Der Kreislauf endet spätestens mit der nächsten Zeile (≤ 2,5 s; in den ersten ~6 s schreibt der Helfer nur `ready`, dann so lange);
  // return() beendet den Prozess, sobald der Stream ihn annimmt (types:3666-3668)
  try {
    void run.stream?.return(undefined as never).catch(() => {})
  } catch {
    // schon zu Ende
  }
}

/** Ein Lauf ist zu Ende. Ohne eigenes Anhalten war es ein Abbruch: später neu starten, nach drei Neustarts erst beim nächsten Titel. */
function helperEnded(run: HelperRun, broken: boolean): void {
  if (helper !== run) return
  helper = null
  if (!broken) {
    helperState = 'idle'
    return
  }
  helperFails += 1
  if (helperFails > RETRY_MS.length) {
    helperState = 'gaveUp'
    return
  }
  helperState = 'failed'
  retryAt = clockNow + RETRY_MS[helperFails - 1]!
}

function onHelperLine(run: HelperRun, text: string): void {
  if (helper !== run) return
  const p = parseLine(text)
  if (!p) return
  if (p.kind === 'ready') helperState = 'listening'
  else if (p.kind === 'quiet') tracker.quiet(p.end)
  else if (p.kind === 'beat') {
    helperState = 'listening'
    tracker.feed(p.m)
  } else helperState = 'failed' // `fail …`: der Prozess endet gleich, das Ende zählt als Abbruch
}

/** Je Zeile prüfen, ob der Helfer noch gebraucht wird; 15 s ohne Bedarf beenden ihn (auch wenn der Takt schon steht). */
async function stillWanted($: EngineInterface): Promise<boolean> {
  try {
    clockNow = await $.clock.now()
  } catch {
    return true
  }
  if (wantHelper()) {
    unwantedSince = 0
    return true
  }
  if (!unwantedSince) unwantedSince = clockNow
  return clockNow - unwantedSince < BEAT_GRACE
}

/**
 * Helfer starten: `powershell.exe -MTA` (Process-Loopback braucht ein MTA, SPEC Machbarkeit) mit der festen Startzeile; der C#-Text
 * geht als `input` über stdin (keine Längengrenze der Befehlszeile), die Prozess-ID nur über `SP_PID`. Der Kreislauf ist das Leben
 * des Prozesses: Verlassen, return() oder Entladen des Moduls beenden ihn (types:3666-3668).
 */
function startHelper($: EngineInterface, now: number): void {
  const run: HelperRun = { pid: spotifyPid, stop: false, stream: null }
  helper = run
  helperState = 'starting'
  unwantedSince = 0
  tracker.resetTiming(now)
  void (async () => {
    let broken = true
    let rest = ''
    try {
      const s = $.process.spawn({ argv: [PS_ABS, '-MTA', ...PS_ARGS, BEAT_BOOT], env: { SP_PID: String(run.pid) }, input: BEAT_CS })
      run.stream = s
      for await (const ch of s) {
        if (run.stop) break
        if (ch.stream !== 'stdout') continue
        const r = splitLines(rest, ch.text)
        rest = r.rest
        for (const l of r.lines) onHelperLine(run, l)
        if (!(await stillWanted($))) {
          broken = false
          break
        }
      }
    } catch {
      // spawn abgelehnt oder Prozess nicht startbar: Abbruch
    }
    helperEnded(run, broken && !run.stop)
  })().catch(() => {})
}

/** Im Takt (1 s): Helfer nach Bedarf starten, wechseln oder nach 15 s ohne Bedarf beenden. */
function manageHelper($: EngineInterface, now: number): void {
  clockNow = now
  if (!wantHelper()) {
    if (helper) {
      if (!unwantedSince) unwantedSince = now
      if (now - unwantedSince >= BEAT_GRACE) stopHelper()
    }
    return
  }
  unwantedSince = 0
  if (helper) {
    if (helper.pid === spotifyPid) return
    stopHelper() // Spotify neu gestartet: neuer Prozessbaum
  }
  if (helperState === 'gaveUp' || now < retryAt) return
  startHelper($, now)
}

/**
 * Takt des Helfers (1 s), angelegt in session.start: sein `$` lebt so lange wie die Sitzung (types:3684-3693, Beispiel „a child for
 * the session's life“), der Helfer hängt also nicht am `$` eines einzelnen Zeichnens. Ob das Band gezeichnet wird, sagt der
 * Abfragetakt (`timer`); ohne ihn läuft nur diese billige Prüfung, kein Prozess.
 */
async function beatTick($: EngineInterface): Promise<void> {
  if (!isWindows) return
  const now = await $.clock.now()
  manageHelper($, now)
  await publishBeat($, now)
}

/**
 * `tune-strip.beat` schreiben, wenn es sich deutlich geändert hat (beat.ts `needsWrite`), nie beim Zeichnen (types@2.1.295:3405).
 * Alle 30 s den eigenen Wert nachlesen: `/clear`, `/resume` und `/branch` setzen `$.state` zurück (wie bei `playing`).
 */
async function publishBeat($: EngineInterface, now: number): Promise<void> {
  if (!isWindows) return
  const want = beatNow(now)
  try {
    if (publishedBeat !== undefined && !needsWrite(publishedBeat, want, now, beatWrittenAt)) {
      if (now - beatCheckedAt < PLAYING_RECHECK) return
      beatCheckedAt = now
      const cur = await $.state.get({ plugin: 'tune-strip', key: 'beat' })
      if (sameBeat(cur.value, publishedBeat)) return
    }
    publishedBeat = undefined
    await $.state.set({ plugin: 'tune-strip', key: 'beat' }, want)
    publishedBeat = want
    beatWrittenAt = now
    beatCheckedAt = now
  } catch {
    publishedBeat = undefined
  }
}

/** Eine Zeile für `/tune beat` (zum Kalibrieren): Zustand, Tempo, Sicherheit, Gruppe, Klarheit, Versatz. */
function beatLine(now: number): string {
  const b = T[lang].beat
  const n = (v: number, d: number) => (lang === 'de' ? v.toFixed(d).replace('.', ',') : v.toFixed(d))
  // Ohne Helfer: sagen, worauf er wartet (0.6.3)
  const waits = timer === null || !bandDrawn ? 'hidden' : track?.status !== 'Playing' ? 'paused' : spotifyPid <= 0 ? 'noSpotify' : 'idle'
  const state = !beatOn() ? 'off' : helperState === 'gaveUp' || helperState === 'failed' ? helperState : helper ? helperState : waits
  const v = helper ? tracker.value(now, offsetMs()) : null
  const m = tracker.last
  const values = v && m ? b.values(n(v.bpm, 1), v.sure, b.group[v.group ?? 'none'] ?? '', n(m.tclar, 2), n(m.pclar, 1)) : ''
  const off = offsetMs()
  return b.line(b.state[state] ?? state, values + b.offset(off > 0 ? `+${off}` : String(off)))
}

async function tick($: EngineInterface, getLast: () => number, setLast: (v: number) => void): Promise<void> {
  if (!isWindows) return
  const now = await $.clock.now()
  // Jeder Takt gleicht ab (ohne Änderung kostet das nichts): so kommt auch ein Klick auf Play/Pause binnen 1 s bei Clawd an
  await publishPlaying($, now)
  if (!enabled()) return
  const every = pollInterval({ pollSeconds, failures, hasSession })
  if (now - getLast() >= every) {
    setLast(now)
    await loadSaved($)
    await runQuery($)
    await publishPlaying($, now)
    if (sigOf() !== lastSig) {
      await redraw($)
      return
    }
  }
  // Haltezeit der Trennlinie vorbei: einmal neu zeichnen, damit die Linie geht, falls darunter weiter nichts steht
  if (sepHeld && now - sepLostAt >= SEP_HOLD_MS) {
    sepHeld = false
    await redraw($)
    return
  }
  // Position läuft zwischen den Abfragen weiter: nur neu zeichnen, wenn die Zeit sichtbar ist und gespielt wird, und nicht öfter als alle POS_REDRAW ms
  if (drawsTime && track?.status === 'Playing' && now - lastDrawAt >= POS_REDRAW) await redraw($)
}

/**
 * Pixel je Spalte von `bodyColumns` im Desktop. [UNKLAR] bis Phase 0 (3) gemessen ist, ob `bodyColumns` die Fensterbreite abbildet;
 * solange `undefined`, weicht Spotify im Desktop nicht von selbst (nur per `/tune size`).
 */
const PX_PER_COLUMN: number | undefined = undefined

/** Breite eines gemeldeten Platzes (Pixel); nie gemeldet oder nicht lesbar zählt als nichts. */
const widthIn = (v: { width: number } | null | undefined): number | null => (v && typeof v.width === 'number' && v.width > 0 ? v.width : null)

// `$.state.get` braucht Literale für plugin und key (validate); Lesen beim Zeichnen abonniert den Wert: schreibt der andere Mod ihn neu,
// zeichnet das Band neu (types:3308-3313)
async function limitBarsWidth($: EngineInterface): Promise<number | null> {
  try {
    return widthIn((await $.state.get({ plugin: 'limit-bars', key: 'band' })).value)
  } catch {
    return null
  }
}
async function clawdWidth($: EngineInterface): Promise<number | null> {
  try {
    return widthIn((await $.state.get({ plugin: 'clawd-buddy', key: 'band' })).value)
  } catch {
    return null
  }
}
/** Steht die Pille von quick-replies darunter? (`quick-replies.band`, 0.7.1: `{ shown: true }` oder `null`; sie liegt in der Kette oft außen) */
async function quickRepliesShown($: EngineInterface): Promise<true | null> {
  try {
    return (await $.state.get({ plugin: 'quick-replies', key: 'band' })).value?.shown === true ? true : null
  } catch {
    return null
  }
}

/** Platz, den Spotify hat; `undefined` = unbekannt (dann gilt die gewählte Stufe). */
async function roomFor($: EngineInterface, s: string | null, bodyColumns: number): Promise<{ room: number | undefined; widths: 'terminal' | 'desktop' }> {
  if (s === 'terminal') return { room: bodyColumns, widths: 'terminal' }
  if (PX_PER_COLUMN === undefined) return { room: undefined, widths: 'desktop' }
  const others = [await limitBarsWidth($), await clawdWidth($)]
  return { room: desktopRoom(bodyColumns * PX_PER_COLUMN, others), widths: 'desktop' }
}

// ---- Hilfe (docs/HELP-SPEC.md, Muster templates/help)
const HELP_WORDS = ['help', '?']
const drawn = new Map<string, HelpData>()
let helpNo = 0
function remember(now: number, data: HelpData): string {
  const tag = `#${(++helpNo).toString(36)}${now.toString(36).slice(-5)}`
  drawn.set(tag, data)
  while (drawn.size > 10) drawn.delete(drawn.keys().next().value as string)
  return tag
}

function helpData(): HelpData {
  const t = T[lang]
  const h = t.help
  const sizeLabel = sizeNow() === 'auto' ? t.auto : sizeNow()
  return {
    mod: 'tune-strip',
    lang,
    intro: h.intro,
    commands: [
      { cmd: '/tune', does: h.status },
      { cmd: '/tune play|pause|toggle', does: h.toggle },
      { cmd: '/tune next|prev', does: h.next },
      { cmd: '/tune back|forward', does: h.back },
      { cmd: '/tune shuffle [on|off]', does: h.shuffle },
      { cmd: '/tune repeat [off|all|track]', does: h.repeat },
      { cmd: '/tune size auto|full|compact|mini', does: h.size },
      { cmd: '/tune on|off', does: h.onOff },
      { cmd: '/tune beat', does: h.beat },
      { cmd: '/tune beat on|off', does: h.beatOnOff },
      { cmd: '/tune beat offset <ms>', does: h.beatOffset },
      languageHelp('tune', lang), // docs/LANGUAGE-SPEC.md §6 Punkt 4
      { cmd: '/tune help', does: h.help },
    ],
    controls: [{ cmd: h.ctlMain, does: h.ctlMainDoes }, ...(extraButtons ? [{ cmd: h.ctlSeek, does: h.ctlSeekDoes }, { cmd: h.ctlMode, does: h.ctlModeDoes }] : [])],
    features: [
      { name: h.featBand, state: { kind: enabled() ? 'on' : 'off' }, toggle: enabled() ? '/tune off' : '/tune on' },
      { name: h.featSize, state: { kind: 'value', text: sizeLabel, isDefault: sizeNow() === 'auto' }, toggle: '/tune size auto|full|compact|mini' },
      { name: h.featBeat, state: { kind: beatOn() ? 'on' : 'off' }, toggle: beatOn() ? '/tune beat off' : '/tune beat on' },
    ],
    settings: [
      { title: h.settings.language, value: lang, isDefault: lang === 'en' },
      { title: h.settings.size, value: optSize, isDefault: optSize === 'auto' },
      { title: h.settings.pollSeconds, value: String(pollSeconds), isDefault: pollSeconds === 4 },
      { title: h.settings.extraButtons, value: extraButtons ? t.on : t.off, isDefault: !extraButtons },
    ],
    footer: { terminal: h.footerTerminal, desktop: h.footerDesktop },
  }
}

export function register(on: On, options?: Readonly<Record<string, unknown>>) {
  // Frischer Stand je Laden des Moduls (Tests laden es mehrfach in einem Prozess)
  saved = {}
  surface = null
  drawSurface = null
  isWindows = true
  track = null
  cover = undefined
  coverKey = ''
  queryAt = 0
  hasSession = false
  lostAt = 0
  failures = 0
  inflight = null
  timer = null
  awaitingRender = false
  renderMissed = 0
  bandDrawn = false
  drawsTime = false
  lastSig = ''
  sepOn = false
  sepLostAt = 0
  sepHeld = false
  drawn.clear()
  tracker = new Tracker()
  spotifyPid = 0
  helper = null
  helperState = 'idle'
  helperFails = 0
  retryAt = 0
  beatKey = null
  unwantedSince = 0
  clockNow = 0
  beatTimer = null
  publishedBeat = undefined
  beatWrittenAt = 0
  beatCheckedAt = 0
  publishedPlaying = ''
  playingCheckedAt = 0
  lang = langOf(options?.language)
  const sz = options?.size
  optSize = sz === 'off' ? 'off' : (SIZES.find((s) => s === sz) ?? 'auto')
  const ps = Number(options?.pollSeconds)
  pollSeconds = Number.isFinite(ps) ? Math.max(3, Math.min(10, ps)) : 4
  extraButtons = options?.extraButtons === true

  // /clear, /resume und /branch setzen $.state zurück, ohne dass session.start erneut feuert (docs/raw/en/troubleshoot.md:260-264):
  // tune-strip.playing sofort wieder melden statt erst beim 30-s-Abgleich (docs/raw/en/interface.md:818-846; Review 0.3.0 S1, Fynn 2026-11-03)
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    // Nur nach session.start auf einer echten Oberfläche unter Windows (bei --resume ist die Reihenfolge der beiden Hooks nicht
    // dokumentiert; vorher stünde isWindows noch auf dem Startwert; Review 0.3.1 K2)
    if (isWindows && visibleSurface()) {
      publishedPlaying = ''
      publishedBeat = undefined
      try {
        const now = await $.clock.now()
        await publishPlaying($, now)
        await publishBeat($, now)
      } catch {
        // Uhr abgelehnt: der Takt gleicht spätestens nach 30 s ab
      }
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    surface = e.surface
    // Die Mediensteuerung gibt es nur unter Windows; ein Laufwerksbuchstabe im Arbeitsordner ist das Zeichen dafür
    isWindows = /^[A-Za-z]:[\\/]/.test(e.cwd)
    await loadSaved($)
    // Takt des Helfers (0.6.0): unter Windows immer; ob gezeichnet wird, sagt erst `ui.render`. Eine abgelehnte Uhr heißt nur „kein Takt“
    // Auch ohne Oberfläche beim Start (Desktop, SDK): billig (eine Uhrabfrage je Sekunde); einen Prozess startet er nur, wenn gezeichnet wird
    if (isWindows && !beatTimer) {
      try {
        beatTimer = $.clock.every(1000, () => {
          beatTick($).catch(() => {})
        })
      } catch {
        beatTimer = null
      }
    }
    try {
      const t = T[lang]
      await $.command.register({ name: 'tune', description: t.help.intro, argumentHint: T[lang].hint })
    } catch {
      // Befehl nicht registriert: das Band läuft trotzdem
    }
    return next(e)
  })

  on('command.run', { command: 'tune' }, async ($, e) => {
    // Sprache aller fynn-mods (docs/LANGUAGE-SPEC.md §6 Punkt 2), vor allem anderen und auch außerhalb von Windows; fängt Fehler selbst ab
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: 'tune-strip', cmd: 'tune', lang }, e.args) }
    const t = T[lang]
    const p = parseTune(e.args)
    if (!isWindows) return { text: t.windowsOnly }
    if (p.kind === 'help') {
      const data = helpData()
      return { text: helpMarkdown(data, remember(await $.clock.now(), data)) }
    }
    if (p.kind === 'unknown') return { text: `${t.unknown(p.word)} ${t.seeHelp}` }
    if (p.kind === 'badArg') return { text: `${t.badArg(p.word, p.arg)} ${t.seeHelp}` }
    if (p.kind === 'size') {
      await saveSaved($, { size: p.size, enabled: true })
      await redraw($)
      return { text: t.sizeSet(p.size === 'auto' ? t.auto : p.size) }
    }
    if (p.kind === 'enabled') {
      await saveSaved($, { enabled: p.value })
      if (p.value) await runQuery($)
      else stopHelper()
      const now = await $.clock.now()
      await publishPlaying($, now)
      await publishBeat($, now)
      await redraw($)
      return { text: t.enabled(p.value) }
    }
    if (p.kind === 'beat') return { text: beatLine(await $.clock.now()) }
    if (p.kind === 'beatOn' || p.kind === 'beatOffset') {
      await saveSaved($, p.kind === 'beatOn' ? { beat: p.value } : { offset: p.ms })
      if (p.kind === 'beatOn' && !p.value) stopHelper()
      await publishBeat($, await $.clock.now())
      if (p.kind === 'beatOn') return { text: t.beat.set(p.value) }
      return { text: t.beat.offsetSet(p.ms > 0 ? `+${p.ms}` : String(p.ms)) }
    }
    if (p.kind === 'status') {
      await runQuery($)
      await redraw($)
      if (!track) return { text: hasSession ? t.unreadable : t.noSession }
      const state = t.stateOf[track.status] ?? t.stateOther
      const time = `${fmtTime(positionNow(track, queryAt, await $.clock.now()))}/${fmtTime(track.end)}`
      return { text: t.statusLine(track.artist ? `${track.title} – ${track.artist}` : track.title, state, time) }
    }
    const res = await control($, p.word, p.arg)
    if (res === 'nosession') return { text: t.noSession }
    if (res === 'needTrack') return { text: t.needTrack }
    if (res === 'fail') return { text: t.failed }
    return { text: t.did[p.word] ?? p.word }
  })

  // ---- /tune help als Tabelle an der Stelle der Befehlsausgabe (HELP-SPEC §3)
  on('ui.render', { component: 'CommandOutput', props: { command: 'tune' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    if (!HELP_WORDS.includes(String(e.props.args ?? '').trim().toLowerCase())) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const data = tag ? drawn.get(tag) : undefined
    return data ? helpTree(data, e.viewport?.columns ?? 100, e.surface, ACCENT) : next(e)
  })

  // ---- Zeichnen
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    try {
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return theirs
      drawSurface = e.surface
      // Eine Umfrage hält das Band; ein Hook weicht ihr (types@2.1.288:9580)
      if (e.props.hasSurvey || !isWindows) return theirs
      awaitingRender = false
      renderMissed = 0
      bandDrawn = false
      if (!enabled()) {
        // Aus: auch der Takt hält an (Review 0.3.0, K1); `/tune off` hat `tune-strip.playing` schon auf null gesetzt, `on` zeichnet und startet ihn neu
        timer?.cancel()
        timer = null
        // Die Linie fängt nach `/tune on` frisch an (Review 0.9.0 K2): keine Haltezeit aus der Zeit vor `off`
        sepOn = false
        sepLostAt = 0
        sepHeld = false
        return theirs
      }
      const now = await $.clock.now()
      lastDrawAt = now
      ensureTimer($, now)
      if (!track || failures >= 3) {
        // Beim ersten Zeichnen steht noch nichts da: einmal lesen, dann kommt das Band per Neuzeichnen
        if (queryAt === 0) void runQuery($).then(() => redraw($)).catch(() => {})
        return theirs
      }
      const { room } = await roomFor($, e.surface, e.props.bodyColumns)
      const stage: Stage = e.surface === 'desktop' ? desktopStage(room, sizeNow(), DESKTOP_WIDTHS) : pickStage(room, sizeNow(), TERMINAL_WIDTHS)
      drawsTime = stage === 'full'
      bandDrawn = stage !== 'off'
      if (stage === 'off') return theirs
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const els = { Box, Text, Button, Svg } as unknown as Els
      const handlers: Handlers = {
        press: (word) => {
          pressButton($, word).catch(() => {})
        },
      }
      const { layers, slots, base } = splitBand(theirs)
      // Trennlinie unter der Leiste nur, wenn darunter etwas steht: Ebenen unter BAR_LEVEL (sidekick liegt darüber) und Plätze aus der
      // Kette, dazu die Zeichnung von limit-bars, clawd-buddy und quick-replies (ihr `$.state`-Wert; liegen sie in der Kette außen,
      // sehen wir sie nicht in `theirs`). Alle drei Werte werden bei jedem Zeichnen gelesen, nie übersprungen: Lesen abonniert sie,
      // ein Schreiben zeichnet das Band neu. Allein im Band gibt es nichts zu trennen.
      const others = await Promise.all([limitBarsWidth($), clawdWidth($), quickRepliesShown($)])
      const below = layers.some((l) => levelOf(l) < BAR_LEVEL) || slots.length > 0 || others.some((x) => x !== null)
      // Uhr noch einmal lesen: die Awaits oben haben Zeit gekostet, und die Voranimation des Bilds beginnt jetzt bei genau dieser Position
      const drawNow = await $.clock.now().catch(() => now)
      // 0.9.0: Linie mit Haltezeit (SEP_HOLD_MS); `sepHeld` lässt den Takt nach ihrem Ende neu zeichnen
      if (below) {
        sepOn = true
        sepLostAt = 0
      } else if (sepOn) {
        if (sepLostAt === 0) sepLostAt = drawNow
        if (drawNow - sepLostAt >= SEP_HOLD_MS) {
          sepOn = false
          sepLostAt = 0
        }
      }
      sepHeld = stage === 'full' && sepOn && !below
      const input = { lang, stage, track, cover, pos: positionNow(track, queryAt, drawNow), extraButtons, sep: sepOn }
      const mine = (e.surface === 'desktop' ? desktopTree(els, handlers, input) : terminalTree(els, handlers, input)) as unknown as RenderNode
      // Desktop, volle Stufe: eigene Leiste über allen Mods (kein Platz in der Zeile); sonst der Platz 20
      if (e.surface === 'desktop' && stage === 'full') return joinBand([...layers, layer(BAR_LEVEL, 'tune-strip', mine)], base, slots)
      // 0.8.1: im Desktop `position: relative`, damit Leiste und Buttons über Clawd liegen, der seit clawd-buddy 0.12.1 hinter der Zeile
      // liegt (docs/BAND.md „Platz hinter der Zeile“). Ohne Versatz verschiebt es nichts (types:946-958).
      const inRow = e.surface === 'desktop'
        ? ({ type: 'Box', props: { key: 'tune-strip-front', position: 'relative', flexDirection: 'column', justifyContent: 'flex-end' }, children: [mine] } as unknown as RenderNode)
        : mine
      return joinBand(layers, base, [...slots, slot(SLOTS.spotify, 'tune-strip', inRow)])
    } catch {
      // Eigener Fehler (fail-open): ohne Anzeige, der Inhalt der anderen bleibt
      return theirs
    }
  })
}
