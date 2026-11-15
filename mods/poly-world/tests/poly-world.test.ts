// Tests für poly-world nach SPEC.md → Tests. Die Szene zeichnet hier nicht (das macht der Desktop); geprüft werden Aufrufe,
// SVG-Text, Grenzen und die Befehle. Sprachbefehl: tests/language.test.ts (Vorlage).
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COLORS_WORD, HELP_WORDS, NOW_WORD, STATUS_WORDS, TIME_WORD, TOGGLE_WORDS, windowLit } from '../hooks/register.js'
import { palette, unpainted } from '../hooks/look.js'
import { scene, SCENE_LIMIT } from '../hooks/scene.js'
import { arcAt, formatTime, KEYS, lateEvening, localMinute, MOON, parseTime, phaseAt, skyAt, SUN } from '../hooks/sky.js'
import { LANGUAGE_WORD, LANGUAGES } from '../hooks/language.js'

// Ab 2.1.325 verlangt CommandRunInput origin und presentation (docs/BAND-PROBE-2.1.325.md §1)
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const DE = { options: { language: 'de' } } as const

/** Lokale Zeit als Unix-ms (Date folgt der Zeitzone des Rechners, wie im Mod). */
const at = (h: number, m = 0) => new Date(2026, 10, 14, h, m).getTime()

type World = {
  sets: any[]
  clears: number
  registered: string[]
  invalidations: number
  logs: string[]
  drawnResult: { isDrawn: true; requestId: string } | { isDrawn: false; reason: string }
  playing: unknown
  mood: unknown
}

/** Stubs für alle Aufrufe der Mod: Theme, Befehl, Log, Neuzeichnen, fremder Zustand, Einstellungen (Weg 2 nicht verfügbar). */
function world(on: On, now = at(13)) {
  const clock = mock.clock(on, { now })
  const w: World = {
    sets: [],
    clears: 0,
    registered: [],
    invalidations: 0,
    logs: [],
    drawnResult: { isDrawn: false, reason: 'no attached desktop or mobile client draws themes yet' },
    playing: undefined,
    mood: undefined,
  }
  on('theme.set', ($, e) => {
    w.sets.push(JSON.parse(JSON.stringify(e)))
    return { value: w.drawnResult }
  })
  on('theme.clear', () => {
    w.clears++
    return { value: { isDrawn: false, reason: 'the theme is cleared' } }
  })
  on('command.register', ($, e) => {
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => {
    w.invalidations++
    return { value: undefined }
  })
  on('state.get', ($: unknown, e: any) => {
    const value = e.plugin === 'tune-strip' && e.key === 'playing' ? w.playing : e.plugin === 'clawd-buddy' && e.key === 'mood' ? w.mood : undefined
    return { value: { value, version: value === undefined ? 0 : 1 } }
  })
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ deny: 'spawn claude ENOENT' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return { w, clock }
}

const start = ($: any, surface: 'terminal' | 'desktop' = 'desktop') => $.session.start({ surface, isInteractive: true, cwd: '/work' })
const run = async ($: any, args: string) => (await $.command.run({ command: 'world', args, ...CMD })).text as string

const BACKDROP = (surface: 'desktop' | 'mobile' | 'terminal' | 'vscode', props: Record<string, unknown> = {}) => ({
  plugin: 'poly-world',
  component: 'Backdrop' as const,
  requestId: 'backdrop-1',
  surface,
  props: { scene: 'island', plugin: 'poly-world', glass: { blur: 16, opacity: 0.6 }, ...props },
})

async function svgOf($: any, surface: 'desktop' | 'mobile' = 'desktop') {
  const ui = await $.ui.mount(BACKDROP(surface))
  const el = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return el?.props as { source: string; alt: string; isInteractive?: boolean } | undefined
}

// ---- session.start und Theme ----

test('session.start: $.theme.set genau einmal mit Szene island und Farben; /world registriert', async ($, on) => {
  const { w } = world(on)
  await start($)
  expect(w.sets).toHaveLength(1)
  expect(w.sets[0].backdrop.scene).toBe('island')
  expect(w.sets[0].colors).toBeDefined()
  expect(w.clears).toBe(0)
  expect(w.registered).toEqual(['world'])
})

test('session.start mit colors: false setzt nur die Szene', { options: { colors: false } }, async ($, on) => {
  const { w } = world(on)
  await start($)
  expect(w.sets).toHaveLength(1)
  expect(w.sets[0].backdrop.scene).toBe('island')
  expect(w.sets[0].colors).toBeUndefined()
})

test('session.start mit enabled: false setzt nichts und löscht nichts (fremdes Theme bleibt)', { options: { enabled: false } }, async ($, on) => {
  const { w } = world(on)
  await start($)
  expect(w.sets).toHaveLength(0)
  expect(w.clears).toBe(0)
  expect(await run($, '')).toContain('Island: off')
})

test('isDrawn: false (Terminal) ist kein Fehler, /world nennt den Grund', async ($, on) => {
  const { w } = world(on)
  await start($, 'terminal')
  const text = await run($, '')
  expect(text).toContain('**poly-world**')
  expect(text).toContain('no look drawn here (no attached desktop or mobile client draws themes yet)')
  expect(w.logs).toEqual([])
})

test('theme.set wirft → session.start läuft weiter, /world nennt den Fehler', async ($, on) => {
  mock.clock(on, { now: at(13) })
  on('theme.set', () => ({ deny: 'refused: unknown attribute' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('session.start', () => ({ cwd: '/work' }))
  expect(await start($)).toBeDefined()
  expect(await run($, 'status')).toMatch(/no look drawn here \(.*unknown attribute.*\)/)
})

test('isDrawn: true → /world sagt „yes“; deutsch „ja“', DE, async ($, on) => {
  const { w } = world(on)
  w.drawnResult = { isDrawn: true, requestId: 'r' }
  await start($)
  expect(await run($, '')).toContain('- Gezeichnet: ja')
})

test('belegter Befehlsname: session.start läuft trotzdem weiter, Theme steht', async ($, on) => {
  mock.clock(on, { now: at(13) })
  const sets: unknown[] = []
  on('theme.set', ($, e) => {
    sets.push(e)
    return { value: { isDrawn: false, reason: 'x' } }
  })
  on('command.register', () => ({ deny: '"/world" refused: taken' }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  expect(await start($)).toBeDefined()
  expect(sets).toHaveLength(1)
})

// ---- Backdrop ----

test('Backdrop eines fremden Mods oder einer fremden Szene → next(e) unverändert', async ($, on) => {
  world(on)
  await start($)
  for (const props of [{ plugin: 'other-mod' }, { scene: 'lagoon' }, { plugin: 'other-mod', scene: 'island' }]) {
    const ui = await $.ui.mount(BACKDROP('desktop', props))
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect(await ui.keepsBeneath()).toBe(true)
    await ui.unmount()
  }
})

test('Backdrop: Desktop und mobil zeichnen ein interaktives Svg mit alt; andere Surfaces → next(e)', async ($, on) => {
  world(on)
  await start($)
  for (const surface of ['desktop', 'mobile'] as const) {
    const svg = await svgOf($, surface)
    expect(svg?.source.startsWith('<svg')).toBe(true)
    expect(svg?.isInteractive).toBe(true)
    expect(svg?.alt).toMatch(/in the day sky(:|$)/)
  }
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount(BACKDROP(surface))
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('Backdrop: kein Script, nichts geladen, nur eigener <style>', async ($, on) => {
  world(on)
  await start($)
  const src = (await svgOf($))!.source
  expect(src).not.toMatch(/<script|onload=|onclick=|href="http|url\(http|@import/i)
})

test('Backdrop: state.get scheitert → Szene steht trotzdem, ohne Reaktionen', async ($, on) => {
  mock.clock(on, { now: at(13) })
  const logs: string[] = []
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'r' } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('state.get', () => ({ deny: 'kaputt' }))
  on('session.start', () => ({ cwd: '/work' }))
  await start($)
  // state.get scheitert: Reaktionen fallen weg, Szene steht trotzdem
  const svg = await svgOf($)
  expect(svg?.source).toContain('<svg')
  expect(logs).toEqual([])
})

test('Backdrop: ein Zeichenfehler → next(e) und Debug-Log (Review S3)', async ($, on) => {
  // Eigene Uhr statt mock.clock: clock.now scheitert erst nach dem Start, also im Backdrop-Hook
  let failing = false
  const logs: string[] = []
  on('clock.now', () => (failing ? { deny: 'clock kaputt' } : { value: at(13) }))
  on('clock.every', () => ({ value: undefined }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'r' } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('session.start', () => ({ cwd: '/work' }))
  await start($)
  failing = true
  const ui = await $.ui.mount(BACKDROP('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
  expect(logs.some((l) => l.includes('backdrop not drawn') && l.includes('clock kaputt'))).toBe(true)
})

test('/world off: $.theme.clear scheitert → Antwort trotzdem, Debug-Log, Szene aus (Review K4)', async ($, on) => {
  mock.clock(on, { now: at(13) })
  const logs: string[] = []
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'r' } }))
  on('theme.clear', () => ({ deny: 'clear kaputt' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({ deny: 'spawn claude ENOENT' }))
  on('session.start', () => ({ cwd: '/work' }))
  await start($)
  expect((await run($, 'off')).startsWith('poly-world off: scene and colors removed.')).toBe(true)
  expect(logs.some((l) => l.includes('theme.clear failed') && l.includes('clear kaputt'))).toBe(true)
  const ui = await $.ui.mount(BACKDROP('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// ---- Tageszeit ----

test('Phase aus Uhrzeit: Grenzen 04:59/05:00, 09:59/10:00, 17:59/18:00, 21:59/22:00', () => {
  expect(phaseAt(4 * 60 + 59)).toBe('night')
  expect(phaseAt(5 * 60)).toBe('morning')
  expect(phaseAt(9 * 60 + 59)).toBe('morning')
  expect(phaseAt(10 * 60)).toBe('day')
  expect(phaseAt(17 * 60 + 59)).toBe('day')
  expect(phaseAt(18 * 60)).toBe('evening')
  expect(phaseAt(21 * 60 + 59)).toBe('evening')
  expect(phaseAt(22 * 60)).toBe('night')
  expect(phaseAt(0)).toBe('night')
  expect(phaseAt(1439)).toBe('night')
})

test('Übergänge weich: an den Phasengrenzen fast gleiche Farben, dazwischen Mischfarben', () => {
  const dist = (a: string, b: string) => {
    const x = parseInt(a.slice(1), 16)
    const y = parseInt(b.slice(1), 16)
    return Math.max(Math.abs((x >> 16) - (y >> 16)), Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)), Math.abs((x & 255) - (y & 255)))
  }
  for (const m of [299, 599, 1079, 1319]) {
    const a = skyAt(m)
    const b = skyAt(m + 1)
    expect(dist(a.top, b.top)).toBeLessThanOrEqual(3)
    expect(dist(a.low, b.low)).toBeLessThanOrEqual(3)
  }
  // Mitte zwischen zwei Stützstellen: weder die eine noch die andere Farbe
  const k = KEYS[1]!
  const l = KEYS[2]!
  const mid = skyAt((k.at + l.at) / 2)
  expect(mid.mid).not.toBe(k.sky.mid)
  expect(mid.mid).not.toBe(l.sky.mid)
  expect(skyAt(k.at).mid).toBe(k.sky.mid)
  // Nacht: Sterne an; Mittag: aus
  expect(skyAt(0).stars).toBe(1)
  expect(skyAt(780).stars).toBe(0)
})

test('Sonne und Mond: Sonne mittags oben, nachts weg; Mond umgekehrt', () => {
  expect(arcAt(780, SUN).opacity).toBe(1)
  expect(arcAt(0, SUN).opacity).toBe(0)
  expect(arcAt(0, MOON).opacity).toBe(1)
  expect(arcAt(780, MOON).opacity).toBe(0)
  expect(arcAt(SUN.rise, SUN).opacity).toBe(0)
})

test('Uhrzeit lesen und schreiben', () => {
  expect(parseTime('22:00')).toBe(1320)
  expect(parseTime('7:05')).toBe(425)
  expect(parseTime('7.05')).toBe(425)
  expect(parseTime('24:00')).toBeUndefined()
  expect(parseTime('12:60')).toBeUndefined()
  expect(parseTime('abend')).toBeUndefined()
  expect(formatTime(1320)).toBe('22:00')
  expect(formatTime(1440 + 65)).toBe('01:05')
  expect(localMinute(at(19, 30))).toBe(1170)
})

test('Szene: 24-h-CSS-Zyklus mit negativem Versatz = Sekunden seit Mitternacht; Vorschau angehalten', () => {
  const live = scene({ minute: 600, paused: false, now: at(10), working: false, music: false, window: false, laptop: false })
  expect(live).toContain('animation-duration:86400s')
  expect(live).toContain('animation-delay:-36000s')
  expect(live).not.toContain('animation-play-state:paused')
  const held = scene({ minute: 1320, paused: true, now: at(10), working: false, music: false, window: false, laptop: false })
  expect(held).toContain('animation-delay:-79200s;animation-play-state:paused')
})

test('/world time 22:00 zeigt Nacht (angehalten), /world time now zurück zur Uhr', async ($, on) => {
  world(on, at(13))
  await start($)
  expect(await run($, 'time 22:00')).toBe('Preview: 22:00 (night). Back to the clock: `/world time now`.')
  let svg = await svgOf($)
  expect(svg?.alt).toContain('night sky (22:00)')
  expect(svg?.source).toContain('animation-play-state:paused')
  expect(await run($, '')).toContain('night preview 22:00')
  expect(await run($, 'time now')).toBe('Back to the clock: 13:00 (day).')
  svg = await svgOf($)
  expect(svg?.alt).toMatch(/in the day sky(:|$)/)
  expect(svg?.source).not.toContain('animation-play-state:paused')
  expect(await run($, 'time 25:00')).toContain('Unknown time “25:00”')
})

test('Vorschau gilt bis zum nächsten Chat: session.start setzt sie zurück', async ($, on) => {
  world(on, at(13))
  await start($)
  await run($, 'time 03:00')
  await start($)
  expect((await svgOf($))?.alt).toMatch(/in the day sky(:|$)/)
})

test('Uhr: neu gezeichnet nur, wenn Phase oder Licht nach Uhrzeit wechselt', async ($, on) => {
  const { w, clock } = world(on, at(17, 50))
  await start($)
  const before = w.invalidations
  await clock.advance(5 * 60000) // 17:55, gleiche Phase
  expect(w.invalidations).toBe(before)
  await clock.advance(6 * 60000) // 18:01, Abend
  expect(w.invalidations).toBe(before + 1)
  await clock.advance(5 * 60000)
  expect(w.invalidations).toBe(before + 1)
})

// ---- Reaktionen ----

test('turn.start → Rauch; turn.complete → kein Rauch; Subagent ändert nichts', async ($, on) => {
  const { w } = world(on, at(13))
  await start($)
  expect((await svgOf($))?.source).not.toContain('class="pf"')
  await $.turn.start({ text: 'los', turnId: 's1', agentId: 'sub-1' } as any)
  expect((await svgOf($))?.source).not.toContain('class="pf"')
  const n = w.invalidations
  await $.turn.start({ text: 'los', turnId: 't1' })
  expect(w.invalidations).toBe(n + 1)
  const busy = await svgOf($)
  expect(busy?.source).toContain('class="pf"')
  expect(busy?.alt).toContain('smoke from the chimney')
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', turnId: 's1', agentId: 'sub-1' } as any)
  expect((await svgOf($))?.source).toContain('class="pf"')
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', turnId: 't1' } as any)
  expect((await svgOf($))?.source).not.toContain('class="pf"')
})

test('nachts bei Arbeit: Laptop-Schein; tagsüber nicht', async ($, on) => {
  world(on, at(23))
  await start($)
  await $.turn.start({ text: 'los', turnId: 't1' })
  expect((await svgOf($))?.source).toContain('class="scr"')
  await run($, 'time 13:00')
  expect((await svgOf($))?.source).not.toContain('class="scr"')
})

test('tune-strip.playing an → Laternen; aus oder null → keine', async ($, on) => {
  const { w } = world(on, at(13))
  await start($)
  w.playing = { playing: true }
  const svg = await svgOf($)
  expect(svg?.source).toContain('class="fl"')
  expect(svg?.alt).toContain('lanterns lit')
  w.playing = { playing: false }
  expect((await svgOf($))?.source).not.toContain('class="fl"')
  w.playing = null
  expect((await svgOf($))?.source).not.toContain('class="fl"')
})

test('clawd-buddy.mood.tired ≥ 0.6 → Fensterlicht; darunter keins, auch spät abends', async ($, on) => {
  const { w } = world(on, at(13))
  await start($)
  w.mood = { tired: 0.7 }
  expect((await svgOf($))?.source).toContain('#ffd27a')
  w.mood = { tired: 0.6 }
  expect((await svgOf($))?.source).toContain('#ffd27a')
  w.mood = { tired: 0.3 }
  await run($, 'time 23:00')
  expect((await svgOf($))?.source).not.toContain('#ffd27a')
})

test('beide fremden Werte fehlen → kein Fehler, Fensterlicht nach Uhrzeit', async ($, on) => {
  const { w } = world(on, at(13))
  await start($)
  expect((await svgOf($))?.source).not.toContain('#ffd27a')
  await run($, 'time 21:30')
  expect((await svgOf($))?.source).toContain('#ffd27a')
  await run($, 'time 02:00')
  expect((await svgOf($))?.source).not.toContain('#ffd27a')
  expect(w.logs).toEqual([])
  // Unsinn gilt wie fehlend
  w.mood = { tired: 'sehr' }
  w.playing = { playing: 'ja' }
  await run($, 'time now')
  expect((await svgOf($))?.source).not.toContain('class="fl"')
})

test('windowLit und lateEvening', () => {
  expect(windowLit(undefined, 20 * 60)).toBe(true)
  expect(windowLit(undefined, 19 * 60 + 59)).toBe(false)
  expect(windowLit(undefined, 29)).toBe(true)
  expect(windowLit(undefined, 30)).toBe(false)
  expect(windowLit(0.59, 23 * 60)).toBe(false)
  expect(windowLit(0.6, 12 * 60)).toBe(true)
  expect(lateEvening(23 * 60)).toBe(true)
})

// ---- Befehle ----

test('/world off ruft $.theme.clear, /world on setzt neu; doppelt → „schon“', async ($, on) => {
  const { w } = world(on)
  await start($)
  expect(w.sets).toHaveLength(1)
  const off = await run($, 'off')
  expect(off.startsWith('poly-world off: scene and colors removed.')).toBe(true)
  // Weg 2 nicht verfügbar (kein claude): Hinweis, dass nicht gespeichert wurde; der Chat folgt trotzdem
  expect(off).toContain('Not saved:')
  expect(w.clears).toBe(1)
  expect(await run($, 'off')).toBe('poly-world is already off.')
  const ui = await $.ui.mount(BACKDROP('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
  expect((await run($, 'on')).startsWith('poly-world on: the island is back.')).toBe(true)
  expect(w.sets).toHaveLength(2)
  expect(w.clears).toBe(1)
  expect(await run($, 'ON')).toBe('poly-world is already on.')
})

test('/world colors off setzt das Theme ohne Farben, /world colors on mit', async ($, on) => {
  const { w } = world(on)
  await start($)
  expect((await run($, 'colors off')).startsWith('App colors off, only the scene stays.')).toBe(true)
  expect(w.sets.at(-1).colors).toBeUndefined()
  expect(w.sets.at(-1).backdrop.scene).toBe('island')
  expect(await run($, 'colors off')).toBe('App colors are already off.')
  await run($, 'colors on')
  expect(w.sets.at(-1).colors).toBeDefined()
  expect(w.clears).toBe(0)
})

test('/world colors off bei ausgeschalteter Insel: kein theme.set', { options: { enabled: false } }, async ($, on) => {
  const { w } = world(on)
  await start($)
  await run($, 'colors off')
  expect(w.sets).toHaveLength(0)
})

test('Umschalten über Weg 2 (claude plugin configure) speichert in der installierten Kopie', async ($, on) => {
  mock.clock(on, { now: at(13) })
  const runs: string[] = []
  const root = String((import.meta as { dir?: string }).dir ?? '').replace(/[\\/]tests$/, '')
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'r' } }))
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'the theme is cleared' } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('config.list', () => ({ value: [] }))
  const proc = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  let saved: Record<string, string> = {}
  on('process.run', ($, e) => {
    const cmd = e.argv.join(' ')
    runs.push(cmd)
    if (cmd === 'claude plugin list --json') return proc(JSON.stringify([{ id: 'poly-world@fynn-mods', enabled: true, installPath: root }]))
    if (cmd === 'claude plugin configure poly-world@fynn-mods --values-stdin --json') {
      saved = { ...saved, ...JSON.parse(e.init?.stdin ?? '{}') }
      return proc(JSON.stringify({ saved: Object.keys(saved) }))
    }
    if (cmd === 'claude plugin configure poly-world@fynn-mods --json') return proc(JSON.stringify({ inputs: saved }))
    return { deny: `unexpected ${cmd}` }
  })
  on('session.start', () => ({ cwd: '/work' }))
  await start($)
  const text = await run($, 'off')
  expect(text).toContain('Saved. Applies in this chat now')
  expect(saved).toEqual({ enabled: 'false' })
  expect(runs.every((r) => /^claude plugin (list --json|configure poly-world@fynn-mods (--json|--values-stdin --json))$/.test(r))).toBe(true)
})

test('Unbekanntes Argument → Verweis auf /world help; deutsch', DE, async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'fly')).toBe('Unbekannt: „fly“. Alle Befehle: `/world help`')
})

// ---- Grenzen und Farben ----

test('Svg-Länge in allen Phasen und Zuständen < 60.000 Zeichen', () => {
  let longest = 0
  for (let minute = 0; minute < 1440; minute += 30)
    for (let bits = 0; bits < 16; bits++) {
      const s = scene({ minute, paused: bits % 2 === 0, now: at(0) + minute * 60000, working: !!(bits & 1), music: !!(bits & 2), window: !!(bits & 4), laptop: !!(bits & 8) })
      longest = Math.max(longest, s.length)
    }
  expect(longest).toBeLessThan(SCENE_LIMIT)
})

test('makeColors: kein „Desktop won’t paint this theme“, kein Fehler', () => {
  const p = palette()
  expect(p.error).toBeUndefined()
  expect(p.theme).toBeDefined()
  expect(unpainted(p)).toEqual([])
})

// ---- Hilfe ----

const OUTPUT = (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', text: string, args = 'help', isErrored = false) => ({
  plugin: 'poly-world',
  component: 'CommandOutput' as const,
  requestId: 'out-1',
  surface,
  viewport: { columns: 100, rows: 30 },
  props: { command: 'world', args, text, isErrored },
})

test('Hilfe: Markdown mit Kennung, en und de; help <wort> ist unbekannt', async ($, on) => {
  world(on)
  await start($)
  const en = await run($, 'help')
  expect(en).toMatch(/^\*\*poly-world · Help\*\* · #[0-9a-z]{5,}/)
  expect(en).toContain('`/world colors on|off`')
  expect(en).toContain('`/world language de|en`: Switch the language of all fynn-mods')
  expect(await run($, '?')).toMatch(/^\*\*poly-world · Help\*\*/)
  expect(await run($, 'help me')).toContain('Unknown: “help me”')
})

test('Hilfe deutsch', DE, async ($, on) => {
  world(on)
  await start($)
  const de = await run($, 'help')
  expect(de).toMatch(/^\*\*poly-world · Hilfe\*\*/)
  expect(de).toContain('Sprache aller fynn-mods umstellen')
})

test('Hilfe gezeichnet: Terminal und Desktop mit Rahmen-key; VS Code, mobil, isErrored, fremde Argumente → Markdown', async ($, on) => {
  world(on)
  await start($)
  const text = `poly-world: ${await run($, 'help')}`
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(OUTPUT(surface, text))
    expect(await ui.find({ key: 'poly-world-help' })).toBeDefined()
    await ui.unmount()
  }
  for (const out of [OUTPUT('vscode', text), OUTPUT('mobile', text), OUTPUT('desktop', text, 'help', true), OUTPUT('desktop', text, 'status')]) {
    const ui = await $.ui.mount(out)
    expect(await ui.find({ key: 'poly-world-help' })).toBeUndefined()
    await ui.unmount()
  }
})

test('Hilfe vollständig: jedes Wort des Parsers steht als ganzes Wort in der Hilfe', async ($, on) => {
  world(on)
  await start($)
  const words = new Set((await run($, 'help')).split(/[^A-Za-z?]+/).filter(Boolean))
  for (const w of [...HELP_WORDS, ...TOGGLE_WORDS, COLORS_WORD, TIME_WORD, NOW_WORD, LANGUAGE_WORD, ...LANGUAGES]) expect(words.has(w)).toBe(true)
  // „status“ ist ein Alias von /world ohne Argument; es steht in der Beschreibung
  for (const w of STATUS_WORDS) expect((await run($, 'help')).toLowerCase()).toContain(w)
})

test('Hilfe: Zustand nach dem Umschalten (● / ○)', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'help')).toContain('App colors ● on (/world colors off)')
  await run($, 'colors off')
  expect(await run($, 'help')).toContain('App colors ○ off (/world colors on)')
})

test('language steht im argumentHint', async ($, on) => {
  mock.clock(on, { now: at(13) })
  const hints: string[] = []
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'r' } }))
  on('command.register', ($, e) => {
    hints.push(e.argumentHint ?? '')
    return { value: { command: e.name } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  await start($)
  expect(hints[0]).toContain('language')
})
