// Tests für tint nach SPEC.md → Tests. Gemalt wird hier nichts (das macht der Desktop); geprüft werden Aufrufe, Kontraste der
// Farbsätze, die Befehle und die Zeichnungen von Hilfe und Status. Sprachbefehl: tests/language.test.ts (Vorlage).
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CUSTOM_WORDS, HELP_WORDS, PALETTE_WORDS, REMOVE_WORDS, STATUS_WORDS, TOGGLE_WORDS } from '../hooks/register.js'
import { blocked, build, isPalette, paletteIn, PALETTES, SETS, unpainted } from '../hooks/palettes.js'
import { statusTree } from '../hooks/status.js'
import { LANGUAGE_WORD, LANGUAGES } from '../hooks/language.js'

// Ab 2.1.325 verlangt CommandRunInput origin und presentation (docs/BAND-PROBE-2.1.325.md §1)
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const DE = { options: { language: 'de' } } as const
const TERMINAL_REASON = 'no attached desktop or mobile client draws themes yet'

type World = {
  sets: any[]
  clears: number
  registered: string[]
  hints: string[]
  logs: string[]
  runs: string[]
  saved: Record<string, string>
  drawnResult: { isDrawn: true; requestId: string } | { isDrawn: false; reason: string }
  failSet: boolean
  notInstalled: boolean
  failClear: boolean
  store: Record<string, unknown>
  failStore: boolean
}

/**
 * Stubs für alle Aufrufe der Mod. Einstellungen über Weg 2 (`config.list` leer): `claude plugin list` meldet tint@fynn-mods mit
 * `installPath` = Ordner der Mod, `configure` speichert in `w.saved`.
 */
function world(on: On) {
  const root = String((import.meta as { dir?: string }).dir ?? '').replace(/[\\/]tests$/, '')
  const w: World = { sets: [], clears: 0, registered: [], hints: [], logs: [], runs: [], saved: {}, drawnResult: { isDrawn: true, requestId: 'r1' }, failSet: false, notInstalled: false, failClear: false, store: {}, failStore: false }
  on('theme.set', ($, e) => {
    if (w.failSet) return { deny: 'theme refused' }
    w.sets.push(JSON.parse(JSON.stringify(e)))
    return { value: w.drawnResult }
  })
  on('theme.clear', () => {
    if (w.failClear) return { deny: 'clear refused' }
    w.clears++
    return { value: { isDrawn: false, reason: 'the theme is cleared' } }
  })
  on('command.register', ($, e) => {
    w.registered.push(e.name)
    w.hints.push(e.argumentHint ?? '')
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('config.list', () => ({ value: [] }))
  // $.store als Objekt in w.store (JSON-Kopie wie die echte Engine, types@2.1.325:3611-3616)
  on('store.get', ($, e) => (w.failStore ? { deny: 'store refused' } : { value: w.store[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(w.store[e.key])) }))
  on('store.set', ($, e) => {
    if (w.failStore) return { deny: 'store refused' }
    w.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete w.store[e.key]
    return { value: undefined }
  })
  const proc = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', ($, e) => {
    const cmd = e.argv.join(' ')
    w.runs.push(cmd)
    if (cmd === 'claude plugin list --json') return proc(JSON.stringify(w.notInstalled ? [] : [{ id: 'tint@fynn-mods', enabled: true, installPath: root }]))
    if (cmd === 'claude plugin configure tint@fynn-mods --values-stdin --json') {
      w.saved = { ...w.saved, ...JSON.parse(e.init?.stdin ?? '{}') }
      return proc(JSON.stringify({ saved: Object.keys(w.saved) }))
    }
    if (cmd === 'claude plugin configure tint@fynn-mods --json') return proc(JSON.stringify({ inputs: w.saved }))
    return { deny: `unexpected ${cmd}` }
  })
  on('session.start', () => ({ cwd: '/work' }))
  return w
}

const start = ($: any, surface: 'terminal' | 'desktop' = 'desktop') => $.session.start({ surface, isInteractive: true, cwd: '/work' })
const run = async ($: any, args: string) => (await $.command.run({ command: 'tint', args, ...CMD })).text as string

/** WCAG-Kontrast zweier Hex-Farben. */
const lum = (h: string) => {
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

// ---- session.start und Theme ----

test('session.start: $.theme.set genau einmal, nur mit colors (ohne backdrop); /tint registriert', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.sets).toHaveLength(1)
  expect(Object.keys(w.sets[0])).toEqual(['colors'])
  expect(w.sets[0].colors.label).toBe('Herbstglut')
  expect(w.clears).toBe(0)
  expect(w.registered).toEqual(['tint'])
})

test('session.start mit enabled: false setzt nichts und löscht nichts (fremdes Theme bleibt)', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.sets).toHaveLength(0)
  expect(w.clears).toBe(0)
  expect(await run($, '')).toContain('**tint** · Herbstglut · off')
})

test('session.start mit palette nord setzt Nord; ein fremder Wert gilt als herbstglut', { options: { palette: 'nord' } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.sets[0].colors.label).toBe('Nord')
})

test('ungültiger Farbsatz in den Einstellungen → Standard herbstglut', { options: { palette: 'solarized' } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.sets[0].colors.label).toBe('Herbstglut')
})

test('isDrawn: false (Terminal) ist kein Fehler, /tint nennt den Grund', async ($, on) => {
  const w = world(on)
  w.drawnResult = { isDrawn: false, reason: TERMINAL_REASON }
  await start($, 'terminal')
  const text = await run($, '')
  expect(text).toContain('- Drawn: no, ' + TERMINAL_REASON)
  expect(await run($, 'status')).toBe(text)
})

test('theme.set scheitert: kein Fehler nach außen, /tint nennt den Grund, Debug-Log', async ($, on) => {
  const w = world(on)
  w.failSet = true
  await start($)
  expect(w.registered).toEqual(['tint'])
  expect(await run($, '')).toMatch(/- Drawn: no, .*theme refused/)
  expect(w.logs.some((l) => l.startsWith('tint: theme.set failed'))).toBe(true)
})

test('gemalt: /tint zeigt ja', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, '')).toContain('- Drawn: a client that draws themes is attached')
})

test('/tint nord bei aus und schon gewählt: nichts geschrieben, Hinweis auf /tint on', { options: { enabled: false, palette: 'nord' } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(await run($, 'nord')).toBe('Nord is already the color set. tint is off; `/tint on` applies it.')
  expect(w.runs).toEqual([])
  expect(w.sets).toHaveLength(0)
})

test('$.theme.clear scheitert: /tint off antwortet trotzdem, Debug-Log', async ($, on) => {
  const w = world(on)
  w.failClear = true
  await start($)
  expect(await run($, 'off')).toContain("tint off: the app's own colors are back.")
  expect(w.logs.some((l) => l.startsWith('tint: theme.clear failed'))).toBe(true)
})

// ---- Farbsätze ----

for (const name of PALETTES) {
  test(`${name}: makeColors ohne „Desktop won't paint“, wirft nicht`, () => {
    const b = build(name)
    expect(b.error).toBeUndefined()
    expect(b.theme).toBeDefined()
    expect(unpainted(b)).toEqual([])
    expect(blocked(b)).toBeUndefined()
  })

  for (const mode of ['light', 'dark'] as const) {
    test(`${name} ${mode}: text-primary ≥ 7:1 und text-muted ≥ 4.5:1 auf jeder Fläche`, () => {
      const a = (SETS[name].definition[mode] as any).gray.anchors as Record<string, string>
      const surfaces = Object.keys(a).filter((k) => k.startsWith('surface-'))
      expect(surfaces.length).toBeGreaterThan(0)
      for (const s of surfaces) {
        expect(contrast(a['text-primary']!, a[s]!)).toBeGreaterThanOrEqual(7)
        expect(contrast(a['text-muted']!, a[s]!)).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
}

test('Rosé Pine und Nord dunkel: Diff-Schrift auf den Flächen ohne Kontrastzeile (eigene git-Farben)', () => {
  for (const name of ['rose-pine', 'nord'] as const) {
    const lines = build(name).problems.filter((l) => /^text-git-\S+ on surface-\d .* in dark mode/.test(l))
    expect(lines).toEqual([])
  }
})

test('Herbstglut: Werte wie poly-world look.ts 0.2.0', () => {
  const d = SETS.herbstglut.definition as any
  expect(d.roles).toEqual({ accent: '#b8501f', danger: '#b93a2b', success: '#4b8a3a', warning: '#b07a12', pro: '#7a4f9a' })
  expect(d.light.gray.anchors['surface-0']).toBe('#f1e8da')
  expect(d.dark.gray.anchors['surface-3']).toBe('#182340')
  expect(d.dark.gray.anchors['text-primary']).toBe('#f7ecda')
})

test('blocked: makeColors-Fehler oder „Desktop won’t paint“ verhindern das Setzen', () => {
  expect(blocked({ theme: undefined, problems: [], error: 'bad color' })).toBe('bad color')
  expect(blocked({ theme: undefined, problems: ["Desktop won't paint this theme, because x"] })).toBe("Desktop won't paint this theme, because x")
  expect(blocked({ theme: undefined, problems: ['border on surface-0 is 1.4:1'] })).toBeUndefined()
})

test('isPalette und paletteIn', () => {
  expect(isPalette('rose-pine')).toBe(true)
  expect(isPalette('Rose-Pine')).toBe(false)
  expect(paletteIn('tint: **tint** · Rosé Pine · on')).toBe('rose-pine')
  expect(paletteIn('nichts')).toBeUndefined()
})

// ---- Befehle ----

test('/tint nord schreibt palette und setzt sofort', async ($, on) => {
  const w = world(on)
  await start($)
  const text = await run($, 'nord')
  expect(text).toContain('Color set: Nord.')
  expect(text).toContain('Saved. Applies in this chat now')
  expect(w.saved).toEqual({ palette: 'nord' })
  expect(w.sets).toHaveLength(2)
  expect(Object.keys(w.sets[1])).toEqual(['colors'])
  expect(w.sets[1].colors.label).toBe('Nord')
  expect(await run($, '')).toContain('**tint** · Nord · on')
  expect(w.runs.every((r) => /^claude plugin (list --json|configure tint@fynn-mods (--json|--values-stdin --json))$/.test(r))).toBe(true)
})

test('/tint ROSE-PINE (Großschreibung) wählt Rosé Pine', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'ROSE-PINE')
  expect(w.sets[1].colors.label).toBe('Rosé Pine')
})

test('/tint xyz → Fehlermeldung mit Liste, nichts geändert', async ($, on) => {
  const w = world(on)
  await start($)
  const text = await run($, 'xyz')
  expect(text).toBe('Unknown color set “xyz”. Choose one of: `herbstglut`, `rose-pine`, `nord`. Nothing changed.')
  expect(w.sets).toHaveLength(1)
  expect(w.runs).toEqual([])
})

test('/tint herbstglut, wenn schon gewählt: setzt erneut, speichert nichts', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await run($, 'herbstglut')).toBe('Herbstglut is already the color set.')
  expect(w.sets).toHaveLength(2)
  expect(w.runs).toEqual([])
})

test('/tint off ruft $.theme.clear, /tint on setzt neu', async ($, on) => {
  const w = world(on)
  await start($)
  const off = await run($, 'off')
  expect(off).toContain("tint off: the app's own colors are back.")
  expect(w.clears).toBe(1)
  expect(w.saved).toEqual({ enabled: 'false' })
  expect(await run($, 'off')).toBe('tint is already off.')
  expect(await run($, '')).toContain('- Drawn: off')
  const on2 = await run($, 'on')
  expect(on2).toContain('tint on: colors applied.')
  expect(w.sets).toHaveLength(2)
  expect(w.saved).toEqual({ enabled: 'true' })
  expect(w.clears).toBe(1)
})

test('/tint nord bei aus: speichert, setzt nicht, verweist auf /tint on', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  const text = await run($, 'nord')
  expect(text).toContain('Color set: Nord. tint is off; `/tint on` applies it.')
  expect(w.sets).toHaveLength(0)
  expect(w.saved).toEqual({ palette: 'nord' })
})

test('Speichern scheitert (nicht installiert): Farben gelten trotzdem in diesem Chat, Grund genannt', async ($, on) => {
  const w = world(on)
  w.notInstalled = true
  await start($)
  const text = await run($, 'rose-pine')
  expect(text).toContain('Not saved: tint@fynn-mods is not installed and on.')
  expect(w.sets.at(-1).colors.label).toBe('Rosé Pine')
})

test('Unbekanntes Argument → Verweis auf /tint help; deutsch', DE, async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'nord bitte')).toBe('Unbekannt: „nord bitte“. Alle Befehle: `/tint help`')
  expect(await run($, 'xyz')).toBe('Unbekannter Farbsatz „xyz“. Zur Wahl: `herbstglut`, `rose-pine`, `nord`. Nichts geändert.')
})

test('Status: Farbsatz, an/aus, gemalt, Farbmuster hell und dunkel; deutsch', DE, async ($, on) => {
  world(on)
  await start($)
  await run($, 'rose-pine')
  const text = await run($, '')
  expect(text.split('\n')[0]).toBe('**tint** · Rosé Pine · an')
  expect(text).toContain('- Hell: Fläche #faf4ed · Schrift #464261 · Akzent #907aa9 · Gefahr #b4637a · Erfolg #286983 · Warnung #ea9d34 · Pro #d7827e')
  expect(text).toContain('- Dunkel: Fläche #232136 · Schrift #e0def4 · Akzent #c4a7e7')
  expect(text).toContain('- Farbsätze: `herbstglut`, `rose-pine`, `nord`')
})

// ---- Zeichnungen ----

const OUTPUT = (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', text: string, args = 'help', isErrored = false) => ({
  plugin: 'tint',
  component: 'CommandOutput' as const,
  requestId: 'out-1',
  surface,
  viewport: { columns: 100, rows: 30 },
  props: { command: 'tint', args, text, isErrored },
})

test('Status gezeichnet: Terminal und Desktop mit Farbmustern; VS Code, mobil, isErrored → Markdown', async ($, on) => {
  world(on)
  await start($)
  const text = `tint: ${await run($, '')}`
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const args of ['', 'status']) {
      const ui = await $.ui.mount(OUTPUT(surface, text, args))
      expect(await ui.find({ key: 'tint-status' })).toBeDefined()
      const swatches = await ui.findAll({ type: 'Text', text: /^■$/ })
      expect(swatches.map((s) => (s.props as { color?: string }).color)).toContain('#b8501f')
      expect(swatches).toHaveLength(14)
      expect(await ui.find({ type: 'Text', text: /^tint · Herbstglut · on$/ })).toBeDefined()
      await ui.unmount()
    }
  }
  for (const out of [OUTPUT('vscode', text, ''), OUTPUT('mobile', text, ''), OUTPUT('desktop', text, '', true), OUTPUT('desktop', 'tint: Unknown: “x”', '')]) {
    const ui = await $.ui.mount(out)
    expect(await ui.find({ key: 'tint-status' })).toBeUndefined()
    await ui.unmount()
  }
})

test('statusTree ohne Farbmuster-Zeile → undefined', () => {
  expect(statusTree('tint is already on.', 'tint', 'permission')).toBeUndefined()
})

test('Hilfe: Markdown mit Kennung, en und de; help <wort> ist unbekannt', async ($, on) => {
  world(on)
  await start($)
  const en = await run($, 'help')
  expect(en).toMatch(/^\*\*tint · Help\*\* · #[0-9a-z]{5,}/)
  expect(en).toContain('`/tint herbstglut|rose-pine|nord`')
  expect(en).toContain('`/tint language de|en`: Switch the language of all fynn-mods')
  expect(await run($, '?')).toMatch(/^\*\*tint · Help\*\*/)
  expect(await run($, 'help me')).toContain('Unknown: “help me”')
})

test('Hilfe deutsch', DE, async ($, on) => {
  world(on)
  await start($)
  const de = await run($, 'help')
  expect(de).toMatch(/^\*\*tint · Hilfe\*\*/)
  expect(de).toContain('Sprache aller fynn-mods umstellen')
})

test('Hilfe gezeichnet: Terminal und Desktop mit Rahmen-key; VS Code, mobil, isErrored, fremde Argumente → Markdown', async ($, on) => {
  world(on)
  await start($)
  const text = `tint: ${await run($, 'help')}`
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(OUTPUT(surface, text))
    expect(await ui.find({ key: 'tint-help' })).toBeDefined()
    await ui.unmount()
  }
  const tag = /#[0-9a-z]{5,}/.exec(text)![0]
  for (const out of [OUTPUT('vscode', text), OUTPUT('mobile', text), OUTPUT('desktop', text, 'help', true), OUTPUT('desktop', text, 'nord'), OUTPUT('desktop', `tint: Unknown: “${tag}”`, tag)]) {
    const ui = await $.ui.mount(out)
    expect(await ui.find({ key: 'tint-help' })).toBeUndefined()
    await ui.unmount()
  }
})

test('Hilfe vollständig: jedes Wort des Parsers steht als ganzes Wort in der Hilfe', async ($, on) => {
  world(on)
  await start($)
  const help = await run($, 'help')
  const words = new Set(help.split(/[^A-Za-z?-]+/).flatMap((w) => [w, ...w.split('|')]).filter(Boolean))
  for (const w of [...HELP_WORDS, ...TOGGLE_WORDS, ...PALETTE_WORDS, ...CUSTOM_WORDS, ...REMOVE_WORDS, LANGUAGE_WORD, ...LANGUAGES]) expect(words.has(w)).toBe(true)
  // „status“ ist ein Alias von /tint ohne Argument; es steht in den Notizen
  for (const w of STATUS_WORDS) expect(help.toLowerCase()).toContain(`/tint ${w}`)
})

test('Hilfe: Zustand nach dem Umschalten (● / ○) und Farbsatz', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'help')).toContain('Colors ● on (/tint off)')
  await run($, 'off')
  await run($, 'nord')
  const help = await run($, 'help')
  expect(help).toContain('Colors ○ off (/tint on)')
  expect(help).toContain('Color set Nord (/tint <name>)')
})

test('language steht im argumentHint', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.hints[0]).toContain('language')
  expect(w.hints[0]).toContain('herbstglut|rose-pine|nord|<name>')
  expect(w.hints[0]).toContain('remove <name>')
})

// ---- 0.2.0: eigene Farbsätze (SPEC „Ausbau 0.2.0“) ----

const TOOL = 'mcp__tint__save_colors'
/** Ein gültiger Satz nach Tailwind slate/indigo (wie tests/fixtures/acme.css, dort ohne Dunkel-Modus). */
const ACME = {
  name: 'acme',
  source: 'tests/fixtures/acme.css',
  light: { 'surface-0': '#f1f5f9', 'surface-1': '#f8fafc', 'surface-2': '#ffffff', 'text-primary': '#0f172a', 'text-secondary': '#334155', 'text-muted': '#475569' },
  dark: { 'surface-0': '#0f172a', 'surface-1': '#1e293b', 'surface-2': '#1e293b', 'text-primary': '#f8fafc', 'text-secondary': '#cbd5e1', 'text-muted': '#94a3b8' },
  roles: { accent: '#4f46e5', danger: '#dc2626', success: '#16a34a', warning: '#d97706' },
}
const save = async ($: any, input: Record<string, unknown>) => (await $.tool.call({ tool: TOOL, ...input })) as { result: string; isError?: true }

test('session.start registriert save_colors hinter ToolSearch, vor /tint', async ($, on) => {
  const specs: any[] = []
  const commandsBefore: number[] = []
  const w = world(on)
  on('tool.register', ($, e) => {
    specs.push(e)
    commandsBefore.push(w.registered.length)
    return { value: { tool: TOOL } }
  })
  await start($)
  expect(specs).toHaveLength(1)
  expect(specs[0]).toMatchObject({ name: 'save_colors', isDeferred: true, inputSchema: { required: ['name', 'source', 'light', 'dark', 'roles'] } })
  expect(specs[0].description).toContain('tint:import')
  expect(commandsBefore).toEqual([0])
  expect(w.registered).toEqual(['tint'])
})

test('save_colors gültig: gespeichert, gesetzt, palette = custom, active = Name', async ($, on) => {
  const w = world(on)
  await start($)
  const out = await save($, ACME)
  expect(out.isError).toBeUndefined()
  expect(out.result).toContain('Saved the color set "acme"')
  expect(out.result).toMatch(/light: text-primary ≥ \d+\.\d\d:1/)
  expect(w.store.active).toBe('acme')
  expect((w.store.sets as any).acme.light['surface-0']).toBe('#f1f5f9')
  expect(w.sets.at(-1).colors.label).toBe('acme')
  expect(w.saved).toEqual({ palette: 'custom' })
  const text = await run($, '')
  expect(text.split('\n')[0]).toBe('**tint** · acme · on')
  expect(text).toContain('- Own sets: `acme` (tests/fixtures/acme.css)')
  expect(text).toContain('- Light: surface #f1f5f9 · text #0f172a · accent #4f46e5 · danger #dc2626 · success #16a34a · warning #d97706 · pro #7a4f9a')
})

test('save_colors mit apply: false nur gespeichert; vorhandener Name wird ersetzt', async ($, on) => {
  const w = world(on)
  await start($)
  const n = w.sets.length
  const out = await save($, { ...ACME, apply: false })
  expect(out.result).toContain('Not applied (apply: false)')
  expect(w.sets).toHaveLength(n)
  expect(w.store.active).toBeUndefined()
  expect(w.saved).toEqual({})
  const again = await save($, { ...ACME, roles: { accent: '#4338ca' }, apply: false })
  expect(again.result).toContain('Replaced the color set "acme"')
  expect((w.store.sets as any).acme.roles).toEqual({ accent: '#4338ca' })
})

test('save_colors ungültig: kein Hex, reservierter Name, Kontrast, Desktop won’t paint → nichts gespeichert, Werte in der Liste', async ($, on) => {
  const w = world(on)
  await start($)
  const bad = await save($, { ...ACME, name: 'nord', light: { ...ACME.light, 'text-primary': 'navy' }, roles: { accent: 'rgb(1,2,3)', glow: '#ffffff' } })
  expect(bad.isError).toBe(true)
  expect(bad.result).toContain('Nothing saved')
  expect(bad.result).toContain('name "nord" is taken by tint')
  expect(bad.result).toContain('light.text-primary is "navy"')
  expect(bad.result).toContain('roles.accent is "rgb(1,2,3)"')
  expect(bad.result).toContain('roles.glow is not a role')
  const weak = await save($, { ...ACME, light: { ...ACME.light, 'text-muted': '#94a3b8' } })
  expect(weak.isError).toBe(true)
  expect(weak.result).toMatch(/light: text-muted #94a3b8 on surface-0 #f1f5f9 is 2\.\d\d:1, needs 4\.5:1/)
  // Akzent-Schrift auf zu heller surface-3 unter 3:1 → der Desktop malt das ganze Theme nicht
  const unpaintable = await save($, { ...ACME, dark: { ...ACME.dark, 'surface-3': '#94a3b8' } })
  expect(unpaintable.isError).toBe(true)
  expect(unpaintable.result).toContain("Desktop won't paint this theme")
  // makeColors wirft (Secondary heller als Muted) → als Problem zurück, kein Wurf aus dem Hook
  const thrown = await save($, { ...ACME, light: { ...ACME.light, 'text-secondary': '#eef2f6' } })
  expect(thrown.isError).toBe(true)
  expect(thrown.result).toContain('The color builder refused it')
  expect(w.store).toEqual({})
  expect(w.saved).toEqual({})
})

test('save_colors ohne dark: Fehler mit Hinweis, den Dunkel-Modus abzuleiten', async ($, on) => {
  const w = world(on)
  await start($)
  const { dark: _d, ...noDark } = ACME
  const out = await save($, noDark)
  expect(out.isError).toBe(true)
  expect(out.result).toContain('dark is missing')
  expect(out.result).toContain('derive one')
  expect(w.store).toEqual({})
})

test('save_colors wirft nie: Eingabe leer, Store scheitert', async ($, on) => {
  const w = world(on)
  await start($)
  const empty = await save($, {})
  expect(empty.isError).toBe(true)
  expect(empty.result).toContain('name is missing')
  w.failStore = true
  const out = await save($, ACME)
  expect(out.isError).toBe(true)
  expect(out.result).toContain('store refused')
})

test('/tint <eigener>, /tint custom, /tint remove (aktiv und nicht aktiv), /tint remove nord', async ($, on) => {
  const w = world(on)
  await start($)
  await save($, ACME)
  await save($, { ...ACME, name: 'beta', apply: false })
  await run($, 'nord')
  expect(w.saved.palette).toBe('nord')
  expect(await run($, 'beta')).toContain('Color set: beta.')
  expect(w.store.active).toBe('beta')
  expect(w.saved.palette).toBe('custom')
  expect(w.sets.at(-1).colors.label).toBe('beta')
  expect(await run($, 'custom')).toBe('beta is already the color set.')
  // nicht aktiv: nur gelöscht
  expect(await run($, 'remove acme')).toBe('Removed the own set “acme”.')
  expect(Object.keys(w.store.sets as object)).toEqual(['beta'])
  // aktiv: gelöscht, active weg, Herbstglut gilt und wird gespeichert
  expect(await run($, 'remove beta')).toContain('Removed the own set “beta”; Herbstglut applies now.')
  expect(w.store.active).toBeUndefined()
  expect(w.saved.palette).toBe('herbstglut')
  expect(w.sets.at(-1).colors.label).toBe('Herbstglut')
  expect(await run($, 'remove nord')).toContain('“nord” is built in and cannot be removed')
  expect(await run($, 'remove beta')).toBe('No own set “beta”. Own sets: none. Nothing changed.')
  expect(await run($, 'remove')).toBe('Usage: `/tint remove <name>` (an own set).')
  expect(await run($, 'custom')).toContain('No own set chosen yet')
})

test('session.start mit palette custom und vorhandenem active setzt den eigenen Satz', { options: { palette: 'custom' } }, async ($, on) => {
  const w = world(on)
  w.store = { sets: { acme: { source: 'x', light: ACME.light, dark: ACME.dark, roles: ACME.roles } }, active: 'acme' }
  await start($)
  expect(w.sets).toHaveLength(1)
  expect(w.sets[0].colors.label).toBe('acme')
})

test('session.start mit palette custom und fehlendem active: Herbstglut, /tint sagt es', { options: { palette: 'custom' } }, async ($, on) => {
  const w = world(on)
  w.store = { sets: {}, active: 'gone' }
  await start($)
  expect(w.sets[0].colors.label).toBe('Herbstglut')
  expect(await run($, '')).toContain('- The own set “gone” is gone, so Herbstglut applies.')
})

test('kaputter Store-Eintrag wird übergangen; Store nicht lesbar → Status nennt es', async ($, on) => {
  const w = world(on)
  w.store = { sets: { ok: { source: 's*`x', light: { ...ACME.light, 'surface-2': '#FFF' }, dark: ACME.dark, roles: ACME.roles }, Bad: {}, broken: { source: 's', light: {} } } }
  await start($)
  // von Hand geänderter Eintrag wird wie eine Werkzeug-Eingabe normalisiert
  expect(await run($, '')).toContain('- Own sets: `ok` (s x)')
  w.failStore = true
  expect(await run($, '')).toContain('Own sets could not be read or saved')
  // remove schreibt ohne frischen Stand nichts
  expect(await run($, 'remove ok')).toContain('Own sets could not be read or saved')
  expect(Object.keys(w.store.sets as object)).toEqual(['ok', 'Bad', 'broken'])
})

test('Status: isDrawn false mit requestId = steht für später (K1); deutsch kennzeichnet den Grund der App (K5)', DE, async ($, on) => {
  const w = world(on)
  w.drawnResult = { isDrawn: false, requestId: 'r9', reason: 'the theme stands and draws when one attaches' } as any
  await start($)
  expect(await run($, '')).toContain('- Gemalt: noch nicht, gemalt wird, sobald ein Desktop- oder Mobil-Client andockt (Meldung der App: the theme stands')
})

test('Hilfe nennt den Satz für Claude und die eigenen Sätze', async ($, on) => {
  world(on)
  await start($)
  await save($, ACME)
  const help = await run($, 'help')
  expect(help).toContain('take the colors from my design system')
  expect(help).toContain('Own sets acme')
})
