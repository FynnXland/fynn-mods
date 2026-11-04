// spotify: Hooks-Modul. Ein Spotify-Regler im Band über dem Prompt (AbovePrompt): Cover, Titel, Interpret, Position, klickbare Knöpfe.
// Quelle ist die Windows-Mediensteuerung per Windows PowerShell 5.1 (`$.process.run`, ps.ts): kein Login, keine Tokens, kein Netzwerk,
// keine Datei. Der Takt (`$.clock.every`) läuft nur, solange das Band gezeichnet wird; keine Zeichnung → er beendet sich selbst.
// Das Band ist ein Platz (Nr. 20) in der Grund-Zeile (band.ts, docs/BAND.md): zwischen limit-bars (10) und clawd-buddy (30).
// Texte en/de nach `userConfig.language` (i18n.ts); Befehle und Argumente englisch.
// Fail-open: Ein Fehler heißt nur „keine Anzeige“; was andere Mods ins Band zeichnen, bleibt erhalten.
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { joinBand, layer, slot, splitBand, SLOTS } from './band.ts'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { T, langOf } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { actionFor, desktopRoom, desktopStage, fmtTime, parseSpotify, pickStage, pollInterval, positionNow, SIZES } from './model.ts'
import type { Action, ControlWord, Size, Stage } from './model.ts'
import { CONTROL_SCRIPT, PS_ABS, PS_ARGS, QUERY_SCRIPT, REPEAT_MODES, parseQuery, trackKey } from './ps.ts'
import type { Query, Track } from './ps.ts'
import { BAR_LEVEL, DESKTOP_WIDTHS, TERMINAL_WIDTHS, desktopTree, terminalTree } from './view.ts'
import type { Els, Handlers } from './view.ts'

const ACCENT = 'success' // Akzent der Hilfe (Theme-Key, HELP-SPEC §4); Spotify-Grün
const TICK = 1000 // Takt in ms; gelesen wird alle pollSeconds
const POS_REDRAW = 5000 // Zeit und Balken der Leiste höchstens so oft neu zeichnen (öfter flackert es und verschluckt Klicks)
const BACK_RESTART = 3 // „Zurück“ springt über 3 s an den Anfang des Titels, darunter zum vorigen Titel (wie Spotify)
const WAIT_MS = { track: 1500, other: 200 } // Wartezeit im Steuer-Skript, bis die Mediensteuerung den neuen Stand meldet

// Optionen aus userConfig, in register() gesetzt
let lang: Lang = 'en'
let optSize: Size | 'off' = 'auto'
let pollSeconds = 4
let extraButtons = false
// Einstellungen aus `$.store` (`/spotify size|on|off`), gelten in allen offenen Chats
type Saved = { size?: Size; enabled?: boolean }
let saved: Saved = {}

// Sitzungsstand
let surface: string | null = null
let isWindows = true
let track: Track | null = null
let cover: string | undefined
let coverKey = ''
let queryAt = 0
let hasSession = false
let failures = 0
let inflight: Promise<void> | null = null
let timer: Timer | null = null
let awaitingRender = false
let drawsTime = false
let lastSig = ''
let lastDrawAt = 0
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

/** Stand aus einer Antwort der Abfrage übernehmen. */
async function adopt($: EngineInterface, q: Query): Promise<void> {
  failures = 0
  queryAt = await $.clock.now()
  hasSession = q.track !== null
  track = q.track
  if (q.cover) {
    cover = q.cover
    coverKey = q.track ? trackKey(q.track) : ''
  } else if (!q.track || trackKey(q.track) !== coverKey) {
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
      track = null
      hasSession = false
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
  expectState(a, await $.clock.now())
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
    // Neuzeichnen angefordert, aber keins gekommen (Band eingeklappt, Sitzung verdeckt): Takt beenden, das nächste Zeichnen startet ihn neu
    if (awaitingRender) {
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
 * Ob gerade Musik läuft, für clawd-buddy (0.3.0, `$.state` `spotify.playing`, types/index.d.ts): `{ playing }` aus dem Status der
 * Mediensteuerung, `null` ohne Spotify-Sitzung oder wenn spotify aus ist; außerhalb von Windows wird nie geschrieben (bleibt leer). Kein Titel.
 */
const playingNow = (): { playing: boolean } | null => (enabled() && isWindows && track ? { playing: track.status === 'Playing' } : null)
let publishedPlaying = '' // zuletzt geschriebener Wert als JSON ('' = noch keiner oder Schreiben gescheitert)
let playingCheckedAt = 0
const PLAYING_RECHECK = 30_000 // so oft den eigenen Wert lesen: /clear, /resume und /branch setzen `$.state` zurück

/**
 * `spotify.playing` schreiben, wenn sich der Wert geändert hat (nie beim Zeichnen, types@2.1.295:3405: dort abgelehnt). Ein Schreiben
 * zeichnet die Stellen neu, die den Wert lesen (Clawd). Scheitert es, versucht es der nächste Takt wieder.
 */
async function publishPlaying($: EngineInterface, now: number): Promise<void> {
  const want = JSON.stringify(playingNow())
  try {
    if (want === publishedPlaying && now - playingCheckedAt < PLAYING_RECHECK) return
    playingCheckedAt = now
    if (want === publishedPlaying) {
      const cur = await $.state.get({ plugin: 'spotify', key: 'playing' })
      if (JSON.stringify(cur.value ?? null) === want) return
    }
    publishedPlaying = ''
    await $.state.set({ plugin: 'spotify', key: 'playing' }, playingNow())
    publishedPlaying = want
  } catch {
    publishedPlaying = ''
  }
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
  // Position läuft zwischen den Abfragen weiter: nur neu zeichnen, wenn die Zeit sichtbar ist und gespielt wird, und nicht öfter als alle POS_REDRAW ms
  if (drawsTime && track?.status === 'Playing' && now - lastDrawAt >= POS_REDRAW) await redraw($)
}

/**
 * Pixel je Spalte von `bodyColumns` im Desktop. [UNKLAR] bis Phase 0 (3) gemessen ist, ob `bodyColumns` die Fensterbreite abbildet;
 * solange `undefined`, weicht Spotify im Desktop nicht von selbst (nur per `/spotify size`).
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
    mod: 'spotify',
    lang,
    intro: h.intro,
    commands: [
      { cmd: '/spotify', does: h.status },
      { cmd: '/spotify play|pause|toggle', does: h.toggle },
      { cmd: '/spotify next|prev', does: h.next },
      { cmd: '/spotify back|forward', does: h.back },
      { cmd: '/spotify shuffle [on|off]', does: h.shuffle },
      { cmd: '/spotify repeat [off|all|track]', does: h.repeat },
      { cmd: '/spotify size auto|full|compact|mini', does: h.size },
      { cmd: '/spotify on|off', does: h.onOff },
      { cmd: '/spotify help', does: h.help },
    ],
    controls: [{ cmd: h.ctlMain, does: h.ctlMainDoes }, ...(extraButtons ? [{ cmd: h.ctlSeek, does: h.ctlSeekDoes }, { cmd: h.ctlMode, does: h.ctlModeDoes }] : [])],
    features: [
      { name: h.featBand, state: { kind: enabled() ? 'on' : 'off' }, toggle: enabled() ? '/spotify off' : '/spotify on' },
      { name: h.featSize, state: { kind: 'value', text: sizeLabel, isDefault: sizeNow() === 'auto' }, toggle: '/spotify size auto|full|compact|mini' },
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
  isWindows = true
  track = null
  cover = undefined
  coverKey = ''
  queryAt = 0
  hasSession = false
  failures = 0
  inflight = null
  timer = null
  awaitingRender = false
  drawsTime = false
  lastSig = ''
  drawn.clear()
  lang = langOf(options?.language)
  const sz = options?.size
  optSize = sz === 'off' ? 'off' : (SIZES.find((s) => s === sz) ?? 'auto')
  const ps = Number(options?.pollSeconds)
  pollSeconds = Number.isFinite(ps) ? Math.max(3, Math.min(10, ps)) : 4
  extraButtons = options?.extraButtons === true

  // /clear, /resume und /branch setzen $.state zurück, ohne dass session.start erneut feuert (docs/raw/en/troubleshoot.md:260-264):
  // spotify.playing sofort wieder melden statt erst beim 30-s-Abgleich (docs/raw/en/interface.md:818-846; Review 0.3.0 S1, Fynn 2026-11-03)
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    // Nur nach session.start auf einer echten Oberfläche unter Windows (bei --resume ist die Reihenfolge der beiden Hooks nicht
    // dokumentiert; vorher stünde isWindows noch auf dem Startwert; Review 0.3.1 K2)
    if (isWindows && (surface === 'terminal' || surface === 'desktop')) {
      publishedPlaying = ''
      try {
        await publishPlaying($, await $.clock.now())
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
    try {
      const t = T[lang]
      await $.command.register({ name: 'spotify', description: t.help.intro, argumentHint: T[lang].hint })
    } catch {
      // Befehl nicht registriert: das Band läuft trotzdem
    }
    return next(e)
  })

  on('command.run', { command: 'spotify' }, async ($, e) => {
    const t = T[lang]
    const p = parseSpotify(e.args)
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
      await publishPlaying($, await $.clock.now())
      await redraw($)
      return { text: t.enabled(p.value) }
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

  // ---- /spotify help als Tabelle an der Stelle der Befehlsausgabe (HELP-SPEC §3)
  on('ui.render', { component: 'CommandOutput', props: { command: 'spotify' } }, async ($, e, next) => {
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
      // Eine Umfrage hält das Band; ein Hook weicht ihr (types@2.1.288:9580)
      if (e.props.hasSurvey || !isWindows) return theirs
      awaitingRender = false
      if (!enabled()) {
        // Aus: auch der Takt hält an (Review 0.3.0, K1); `/spotify off` hat `spotify.playing` schon auf null gesetzt, `on` zeichnet und startet ihn neu
        timer?.cancel()
        timer = null
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
      if (stage === 'off') return theirs
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const els = { Box, Text, Button, Svg } as unknown as Els
      const handlers: Handlers = {
        press: (word) => {
          pressButton($, word).catch(() => {})
        },
      }
      const input = { lang, stage, track, cover, pos: positionNow(track, queryAt, now), extraButtons }
      const mine = (e.surface === 'desktop' ? desktopTree(els, handlers, input) : terminalTree(els, handlers, input)) as unknown as RenderNode
      const { layers, slots, base } = splitBand(theirs)
      // Desktop, volle Stufe: eigene Leiste über allen Mods (kein Platz in der Zeile); sonst der Platz 20
      if (e.surface === 'desktop' && stage === 'full') return joinBand([...layers, layer(BAR_LEVEL, 'spotify', mine)], base, slots)
      return joinBand(layers, base, [...slots, slot(SLOTS.spotify, 'spotify', mine)])
    } catch {
      // Eigener Fehler (fail-open): ohne Anzeige, der Inhalt der anderen bleibt
      return theirs
    }
  })
}
