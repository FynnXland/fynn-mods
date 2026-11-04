// spotify: Skripte, Antworten, Befehle, Stufen, Band-Reihenfolge, Zeichnung und Fehlerpfade (SPEC.md → Tests).
// PowerShell läuft nie echt: `process.run` ist gestubbt (die echten Skripte prüft scripts/smoke.ps1 und der Sicht-Check).
import type { On, RenderNode } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { joinBand, layer, slot, splitBand } from '../hooks/band.ts'
import { actionFor, desktopRoom, desktopStage, fmtTime, nextRepeat, parseSpotify, pickStage, pollInterval, positionNow, ratio } from '../hooks/model.ts'
import { CONTROL_SCRIPT, PS_ABS, QUERY_SCRIPT, parseQuery, trackKey } from '../hooks/ps.ts'
import type { Track } from '../hooks/ps.ts'
import { DESKTOP_WIDTHS, TERMINAL_WIDTHS, clip, coverSvg, infoSvg, sepSvg } from '../hooks/view.ts'

// Was die Zeichnung sagt: der Text der Knoten und die Beschreibungen der Svg-Bilder (die Leiste zeichnet Titel und Zeit als Bild)
const seen = (tree: Node): string => {
  let out = textOf(tree)
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const x = n as Node
    if (x.type === 'Svg') out += ` ${String(x.props.alt)} ${String(x.props.source)}`
    for (const c of x.children ?? []) walk(c)
  }
  walk(tree)
  return out
}

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime()
const DE = { options: { language: 'de' } } as const
const DE_EXTRA = { options: { language: 'de', extraButtons: true } } as const
const COVER = 'AAAA'.repeat(50)

const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', bodyColumns = 120, extra: Record<string, unknown> = {}) =>
  ({ plugin: 'spotify', component: 'AbovePrompt', requestId: 'above-prompt', props: { ...props(bodyColumns), ...extra }, surface }) as never

const q = (o: Partial<Record<string, unknown>> = {}, cover = false) =>
  JSON.stringify({
    ok: true,
    title: 'Hey Jude',
    artist: 'The Beatles',
    album: '1',
    status: 'Playing',
    pos: 10,
    end: 200,
    shuffle: false,
    repeat: 'None',
    can: { seek: true, shuffle: true, repeat: true },
    ...o,
  }) + (cover ? `\r\ncover ${COVER}` : '')
const NO_SESSION = JSON.stringify({ ok: false })

type Run = { kind: 'query' | 'control' | '?'; argv: readonly string[]; env: Record<string, string> | undefined }

function world(on: On, o: { out?: string; deny?: boolean; ctl?: string; saved?: Map<string, unknown>; inner?: 'engine' | 'text'; cwd?: string } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const runs: Run[] = []
  const state = { out: o.out ?? q({}, true), ctl: o.ctl ?? 'ok', deny: !!o.deny, renders: 0 }
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  const cwd = o.cwd ?? 'C:\\work'
  on('session.start', () => ({ cwd }))
  on('process.run', ($, e) => {
    const script = e.argv[e.argv.length - 1]
    const kind = script === QUERY_SCRIPT ? 'query' : script === CONTROL_SCRIPT ? 'control' : '?'
    runs.push({ kind, argv: e.argv, env: e.init?.env as Record<string, string> | undefined })
    if (state.deny) return { deny: 'kaputt' }
    // Das Steuer-Skript liest danach im selben Prozess: erste Zeile das Ergebnis, dann die Zeilen der Abfrage
    const reads = kind === 'control' && (state.ctl === 'ok' || state.ctl === 'fail')
    const stdout = kind === 'query' ? state.out : reads ? `${state.ctl}\r\n${state.out}` : state.ctl
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    if (e.component === 'AbovePrompt') state.renders += 1 // jedes Zeichnen des Bands läuft durch den inneren Hook
    return e.component === 'CommandOutput'
      ? { type: 'Text', props: {}, children: [`ENGINE:${String((e.props as { text?: string }).text ?? '')}`] }
      : o.inner === 'text'
        ? { type: 'Text', props: {}, children: ['von anderen'] }
        : { type: 'engine', ref: 0 }
  })
  const count = (k: Run['kind']) => runs.filter((r) => r.kind === k).length
  return {
    clock,
    saved,
    runs,
    state,
    count,
    async start($: any, surface: 'desktop' | 'terminal' = 'desktop') {
      await $.session.start({ cwd, surface, isInteractive: true })
      await clock.advance(10)
      await clock.settle()
    },
  }
}

// Alle Schlüssel und Texte eines gezeichneten Baums
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined
const walk = (n: Node, out: Node[] = []): Node[] => {
  out.push(n)
  if (n && typeof n === 'object') for (const c of n.children ?? []) walk(c as Node, out)
  return out
}
const keysOf = (n: Node) => walk(n).flatMap((x) => (x && typeof x === 'object' && typeof x.props?.key === 'string' ? [x.props.key] : []))
const textOf = (n: Node) => walk(n).filter((x): x is string => typeof x === 'string').join(' ')

// ---------- Skripte ----------

test('Skripte: absolute powershell.exe, keine doppelten Anführungszeichen, nur die Spotify-Sitzung, Eingaben nur aus der Umgebung', async () => {
  expect(PS_ABS).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  for (const s of [QUERY_SCRIPT, CONTROL_SCRIPT]) {
    expect(s.includes('"')).toBe(false)
    expect(s).toContain("-like 'Spotify*'")
    // Nur lesen oder steuern: keine Dateien, kein Netzwerk
    expect(/Set-Content|Out-File|WriteAllBytes|Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient|New-Item|Remove-Item|Start-Process|Invoke-Expression|iex /i.test(s)).toBe(false)
  }
  expect(QUERY_SCRIPT).toContain('$env:SP_KEY')
  expect(CONTROL_SCRIPT).toContain('$env:SP_CMD')
  expect(CONTROL_SCRIPT).toContain('$env:SP_ARG')
  // Nie ein Wert im Skripttext: weder Befehl noch Sekunden noch Schlüssel stehen darin außer als Umgebungsvariable
  expect(CONTROL_SCRIPT).toContain("default { 'badcmd'; exit 0 }")
})

test('parseQuery: läuft, pausiert, keine Sitzung, kaputt', async () => {
  const run = parseQuery(q({}, true) + '\r\n')
  expect(run?.track?.title).toBe('Hey Jude')
  expect(run?.track?.status).toBe('Playing')
  expect(run?.track?.canSeek).toBe(true)
  expect(run?.cover).toBe(COVER)
  expect(parseQuery(q({}, false))?.cover).toBeUndefined()
  expect(parseQuery(q({ status: 'Paused', repeat: 'List', shuffle: true }))?.track).toMatchObject({ status: 'Paused', repeat: 'List', shuffle: true })
  expect(parseQuery(NO_SESSION)).toEqual({ track: null })
  for (const bad of ['', 'nur Text', '{kaputt', '[]', '{"ok":"ja"}', 'null']) expect(parseQuery(bad)).toBeUndefined()
})

test('parseQuery: Unsinn wird entschärft (Texte gekürzt, Zahlen geprüft, Cover nur als Base64)', async () => {
  const t = parseQuery(q({ title: 'x'.repeat(500), pos: -3, end: 'viel', repeat: 'Boom', shuffle: 'ja' }))!.track!
  expect(t.title.length).toBe(200)
  expect(t.pos).toBe(0)
  expect(t.end).toBe(0)
  expect(t.repeat).toBe('None')
  expect(t.shuffle).toBe(false)
  expect(parseQuery(q({}, false) + '\r\ncover <script>alert(1)</script>')?.cover).toBeUndefined()
  expect(parseQuery(q({}, false) + `\r\ncover ${'A'.repeat(50000)}`)?.cover).toBeUndefined()
})

test('trackKey trennt Titel, Interpret und Album', async () => {
  expect(trackKey({ title: 'a', artist: 'b', album: 'c' })).not.toBe(trackKey({ title: 'a', artist: 'bc', album: '' }))
})

// ---------- Modell ----------

const T0: Track = { title: 't', artist: 'a', album: 'b', status: 'Playing', pos: 100, end: 200, shuffle: false, repeat: 'None', canSeek: true, canShuffle: true, canRepeat: true }

test('Position rechnet weiter, bleibt bei Pause stehen und springt nicht über die Länge', async () => {
  expect(positionNow(T0, 1000, 4000)).toBe(103)
  expect(positionNow({ ...T0, status: 'Paused' }, 1000, 4000)).toBe(100)
  expect(positionNow(T0, 1000, 1000 + 500_000)).toBe(200)
  expect(positionNow({ ...T0, end: 0 }, 1000, 3000)).toBe(102)
  expect(positionNow(T0, 5000, 1000)).toBe(100) // Uhr springt zurück: kein Rückwärtslaufen
})

test('Zeitformat und Anteil', async () => {
  expect(fmtTime(0)).toBe('0:00')
  expect(fmtTime(65.9)).toBe('1:05')
  expect(fmtTime(3725)).toBe('1:02:05')
  expect(fmtTime(NaN)).toBe('0:00')
  expect(ratio(50, 200)).toBe(0.25)
  expect(ratio(500, 200)).toBe(1)
  expect(ratio(5, 0)).toBe(0)
})

test('/spotify: Wörter, Argumente und Fehlformen', async () => {
  expect(parseSpotify('')).toEqual({ kind: 'status' })
  expect(parseSpotify('STATUS')).toEqual({ kind: 'status' })
  expect(parseSpotify('help')).toEqual({ kind: 'help' })
  expect(parseSpotify('?')).toEqual({ kind: 'help' })
  expect(parseSpotify('help me')).toEqual({ kind: 'unknown', word: 'help me' })
  for (const w of ['play', 'pause', 'toggle', 'next', 'prev', 'back', 'forward']) expect(parseSpotify(w)).toEqual({ kind: 'control', word: w })
  expect(parseSpotify('next now')).toEqual({ kind: 'unknown', word: 'next now' })
  expect(parseSpotify('shuffle')).toEqual({ kind: 'control', word: 'shuffle' })
  expect(parseSpotify('shuffle on')).toEqual({ kind: 'control', word: 'shuffle', arg: 'on' })
  expect(parseSpotify('shuffle maybe')).toEqual({ kind: 'badArg', word: 'shuffle', arg: 'maybe' })
  expect(parseSpotify('repeat all')).toEqual({ kind: 'control', word: 'repeat', arg: 'List' })
  expect(parseSpotify('repeat track')).toEqual({ kind: 'control', word: 'repeat', arg: 'Track' })
  expect(parseSpotify('repeat off')).toEqual({ kind: 'control', word: 'repeat', arg: 'None' })
  expect(parseSpotify('repeat 5; calc')).toEqual({ kind: 'badArg', word: 'repeat', arg: '5; calc' })
  expect(parseSpotify('size mini')).toEqual({ kind: 'size', size: 'mini' })
  expect(parseSpotify('size auto')).toEqual({ kind: 'size', size: 'auto' })
  expect(parseSpotify('size off')).toEqual({ kind: 'enabled', value: false })
  expect(parseSpotify('size huge')).toEqual({ kind: 'badArg', word: 'size', arg: 'huge' })
  expect(parseSpotify('off')).toEqual({ kind: 'enabled', value: false })
  expect(parseSpotify('on')).toEqual({ kind: 'enabled', value: true })
  expect(parseSpotify('volume 5')).toEqual({ kind: 'unknown', word: 'volume' })
})

test('Wort → Steuer-Aufruf: Argumente nur als Zahl oder fester Wert', async () => {
  expect(actionFor('toggle', undefined, T0, 0)).toEqual({ cmd: 'toggle' })
  expect(actionFor('prev', undefined, null, 0)).toEqual({ cmd: 'prev' })
  expect(actionFor('back', undefined, T0, 100.6)).toEqual({ cmd: 'seek', arg: '86' })
  expect(actionFor('forward', undefined, T0, 100)).toEqual({ cmd: 'seek', arg: '115' })
  expect(actionFor('back', undefined, T0, 5)).toEqual({ cmd: 'seek', arg: '0' })
  expect(actionFor('forward', undefined, T0, 195)).toEqual({ cmd: 'seek', arg: '199' }) // nie über das Ende
  expect(actionFor('back', undefined, null, 0)).toBeUndefined()
  expect(actionFor('shuffle', undefined, T0, 0)).toEqual({ cmd: 'shuffle', arg: 'true' })
  expect(actionFor('shuffle', undefined, { ...T0, shuffle: true }, 0)).toEqual({ cmd: 'shuffle', arg: 'false' })
  expect(actionFor('shuffle', 'off', null, 0)).toEqual({ cmd: 'shuffle', arg: 'false' })
  expect(actionFor('repeat', undefined, T0, 0)).toEqual({ cmd: 'repeat', arg: 'List' })
  expect(actionFor('repeat', 'Track', null, 0)).toEqual({ cmd: 'repeat', arg: 'Track' })
  expect(nextRepeat('None')).toBe('List')
  expect(nextRepeat('List')).toBe('Track')
  expect(nextRepeat('Track')).toBe('None')
})

test('Stufen: größte, die passt; fest gewählte weicht nach unten; auto nimmt die größte; ohne Breite gilt die Wahl', async () => {
  const w = { full: 300, compact: 200, mini: 80 }
  expect(pickStage(400, 'auto', w)).toBe('full')
  expect(pickStage(250, 'auto', w)).toBe('compact')
  expect(pickStage(100, 'auto', w)).toBe('mini')
  expect(pickStage(79, 'auto', w)).toBe('off')
  // fest: kleiner gewählt bleibt klein, größer gewählt weicht
  expect(pickStage(400, 'mini', w)).toBe('mini')
  expect(pickStage(400, 'compact', w)).toBe('compact')
  expect(pickStage(250, 'full', w)).toBe('compact')
  expect(pickStage(79, 'full', w)).toBe('off')
  expect(pickStage(undefined, 'compact', w)).toBe('compact')
  expect(pickStage(undefined, 'auto', w)).toBe('full')
})

test('Takt: Standard, länger ohne Sitzung und nach drei Fehlern, begrenzt auf 3–10 s', async () => {
  expect(pollInterval({ pollSeconds: 4, failures: 0, hasSession: true })).toBe(4000)
  expect(pollInterval({ pollSeconds: 1, failures: 0, hasSession: true })).toBe(3000)
  expect(pollInterval({ pollSeconds: 99, failures: 0, hasSession: true })).toBe(10000)
  expect(pollInterval({ pollSeconds: 4, failures: 0, hasSession: false })).toBe(15000)
  expect(pollInterval({ pollSeconds: 4, failures: 2, hasSession: true })).toBe(4000)
  expect(pollInterval({ pollSeconds: 4, failures: 3, hasSession: true })).toBe(30000)
})

test('Cover-Svg: Bild eingebettet, ohne Cover Platzhalter, weit unter dem Limit (131 072)', async () => {
  const svg = coverSvg(COVER)
  expect(svg).toContain(`data:image/jpeg;base64,${COVER}`)
  expect(svg.length).toBeLessThan(131072)
  expect(coverSvg(undefined)).not.toContain('<image')
  expect(coverSvg(undefined)).toContain('♪')
  expect(coverSvg('A'.repeat(40000)).length).toBeLessThan(131072)
})

// ---------- Band-Protokoll (Plätze) ----------

const key = (s: string): RenderNode => ({ type: 'Box', props: { key: s }, children: [s] }) as RenderNode
const mk = (no: number, name: string, side: 'left' | 'right' = 'left') => (inner: RenderNode | null): RenderNode | null => {
  const s = splitBand(inner)
  return joinBand(s.layers, s.base, [...s.slots, slot(no, name, key(name), side)])
}
const order = (n: RenderNode | null) => keysOf(n as Node).filter((k) => k.startsWith('slot:')).map((k) => k.split(':')[2])

test('Plätze: in jeder Reihenfolge der Kette steht limit-bars vor spotify vor clawd-buddy', async () => {
  const mods = {
    bars: mk(10, 'limit-bars'),
    spotify: mk(20, 'spotify'),
    clawd: mk(30, 'clawd-buddy', 'right'),
  }
  const perms = [
    ['bars', 'spotify', 'clawd'],
    ['bars', 'clawd', 'spotify'],
    ['spotify', 'bars', 'clawd'],
    ['spotify', 'clawd', 'bars'],
    ['clawd', 'bars', 'spotify'],
    ['clawd', 'spotify', 'bars'],
  ] as const
  for (const p of perms) {
    // p[0] liegt innen (zeichnet zuerst), p[2] außen
    let tree: RenderNode | null = { type: 'engine', ref: 0 } as never
    for (const name of p) tree = mods[name](tree)
    expect(order(tree)).toEqual(['limit-bars', 'spotify', 'clawd-buddy'])
    // Der Kern-Knoten geht nicht verloren und steht in der Mitte
    expect(JSON.stringify(tree)).toContain('"engine"')
  }
})

test('Plätze: allein steht nur Spotify in der Zeile; ohne Plätze und Ebenen bleibt der Grund unverändert', async () => {
  const alone = mk(20, 'spotify')(null)
  expect(order(alone)).toEqual(['spotify'])
  const base = { type: 'Text', props: {}, children: ['x'] } as never
  expect(joinBand([], base, [])).toBe(base)
  expect(joinBand([], null, [])).toBeNull()
})

test('Plätze und Ebenen: Ebenen anderer Mods gehen nie verloren, auch nicht aus fremden Hüllen', async () => {
  const lay = (n: number, name: string) => layer(n, name, key(name))
  // quick-replies innen (Ebene + Grund), spotify außen, dann sidekick außen
  const inner = joinBand([lay(20, 'quick-replies')], key('ground'), [])
  const withSpotify = mk(20, 'spotify')(inner)
  const s = splitBand(withSpotify)
  expect(s.layers.length).toBe(1)
  expect(s.slots.length).toBe(1)
  const all = joinBand([...s.layers, lay(30, 'sidekick')], s.base, s.slots)
  const k = keysOf(all as Node)
  expect(k.indexOf('layer:30:sidekick')).toBeLessThan(k.indexOf('layer:20:quick-replies'))
  expect(k.indexOf('layer:20:quick-replies')).toBeLessThan(k.indexOf('slot:20:spotify'))
  expect(k).toContain('ground')
})

test('Plätze: zweimal zusammenbauen verschachtelt nichts (Zeile wird beim Herausholen aufgelöst)', async () => {
  let t: RenderNode | null = mk(10, 'limit-bars')(null)
  for (let i = 0; i < 3; i++) t = mk(20, 'spotify')(t)
  const rows = keysOf(t as Node).filter((x) => x === 'band-row')
  expect(rows.length).toBe(1)
  expect(order(t).filter((x) => x === 'spotify').length).toBe(3) // drei gleiche Plätze bleiben drei; die Mods zeichnen je Aufruf nur einen
})

// ---------- Zeichnung ----------

test('Desktop: Cover als Svg und Knöpfe mit Schlüsseln, fremder Inhalt bleibt', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  const tree = (await ui.drawn()) as Node
  expect(textOf(tree)).toContain('von anderen')
  expect(seen(tree)).toContain('Hey Jude')
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('data:image/jpeg;base64,')
  expect(String(svg?.props.alt)).toContain('Hey Jude')
  const k = keysOf(tree)
  for (const b of ['prev', 'toggle', 'next']) expect(k).toContain(b)
  for (const b of ['back', 'forward', 'shuffle', 'repeat']) expect(k).not.toContain(b) // nur mit extraButtons
  // Volle Stufe = eigene Leiste über allen Mods, kein Platz in der Zeile
  expect(k).toContain('layer:40:spotify')
  expect(k).not.toContain('slot:20:spotify')
  await ui.unmount()
})

test('Desktop: Knöpfe zeigen nur Symbole (kein ausgeschriebener label, den der Desktop als Text zeichnet); die Leiste steht über quick-replies und sidekick', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  const tree = (await ui.drawn()) as Node
  const buttons: Node[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const x = n as Node
    if (x.type === 'Button') buttons.push(x)
    for (const c of x.children ?? []) walk(c)
  }
  walk(tree)
  expect(buttons.length).toBe(3)
  for (const b of buttons) {
    expect(String(b.props.label)).toMatch(/^[ ⏮⏸▶⏭⇄↻−+0-9]+$/u) // die Engine setzt label aus dem Kindtext
    expect(textOf(b)).toMatch(/^[ ⏮⏸▶⏭⇄↻−+0-9]+$/u)
  }
  await ui.unmount()
  // Ebenen: spotify (40) steht vor quick-replies (20) und sidekick (30) in der Wurzel
  const lay = (n: number, name: string) => layer(n, name, key(name))
  const joined = joinBand([lay(20, 'quick-replies'), lay(30, 'sidekick'), layer(40, 'spotify', key('s'))], key('ground'), [])
  const k = keysOf(joined as Node)
  expect(k.indexOf('layer:40:spotify')).toBeLessThan(k.indexOf('layer:30:sidekick'))
  expect(k.indexOf('layer:30:sidekick')).toBeLessThan(k.indexOf('layer:20:quick-replies'))
})

test('Terminal: eine Zeile mit Titel, Zeit und Knöpfen', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($, 'terminal')
  const ui = await $.ui.mount(band('terminal', 120))
  const tree = (await ui.drawn()) as Node
  expect(textOf(tree)).toContain('Hey Jude – The Beatles')
  expect(textOf(tree)).toContain('0:10/3:20')
  expect(keysOf(tree)).toEqual(expect.arrayContaining(['prev', 'toggle', 'next']))
  expect(keysOf(tree)).not.toContain('back') // −15/+15 nur im Desktop
  await ui.unmount()
})

test('VS Code, mobil, Umfrage und fremde Oberflächen: nichts Eigenes, der Inhalt der anderen bleibt', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($)
  for (const [surface, extra] of [['vscode', {}], ['mobile', {}], ['desktop', { hasSurvey: true }]] as const) {
    const ui = await $.ui.mount(band(surface, 120, extra))
    const tree = (await ui.drawn()) as Node
    expect(textOf(tree)).toBe('von anderen')
    await ui.unmount()
  }
})

test('Keine Spotify-Sitzung: nichts gezeichnet, kein Fehler; das Band erscheint, sobald Spotify startet', DE, async ($, on) => {
  const w = world(on, { out: NO_SESSION, inner: 'text' })
  await w.start($)
  let ui = await $.ui.mount(band('desktop', 120))
  expect(textOf((await ui.drawn()) as Node)).toBe('von anderen')
  await ui.unmount()
  w.state.out = q({}, true)
  await w.clock.advance(20000)
  await w.clock.settle()
  ui = await $.ui.mount(band('desktop', 120))
  expect(seen((await ui.drawn()) as Node)).toContain('Hey Jude')
  await ui.unmount()
})

test('Stufen im Desktop: fest gewählt per /spotify size; auto ohne bekannte Breite = voll', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const k = async () => {
    const ui = await $.ui.mount(band('desktop', 120))
    const out = keysOf((await ui.drawn()) as Node)
    await ui.unmount()
    return out
  }
  expect(await k()).toContain('layer:40:spotify')
  await $.command.run({ command: 'spotify', args: 'size compact' } as never)
  expect(w.saved.get('settings')).toEqual({ size: 'compact', enabled: true })
  let keys = await k()
  expect(keys).toContain('toggle')
  expect(keys).not.toContain('back')
  expect(keys).toContain('slot:20:spotify') // kompakt = Platz in der Zeile, keine Leiste
  expect(keys).not.toContain('layer:40:spotify')
  await $.command.run({ command: 'spotify', args: 'size mini' } as never)
  keys = await k()
  expect(keys).toContain('toggle')
  expect(keys).not.toContain('prev')
  await $.command.run({ command: 'spotify', args: 'size auto' } as never)
  expect(await k()).toContain('layer:40:spotify')
})

test('Terminal: schmal wird die Zeile erst mini, dann weg', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($, 'terminal')
  const widths = TERMINAL_WIDTHS
  const at = async (cols: number) => {
    const ui = await $.ui.mount(band('terminal', cols))
    const tree = (await ui.drawn()) as Node
    await ui.unmount()
    return tree
  }
  expect(keysOf(await at(widths.full + 10))).toContain('prev')
  const compact = keysOf(await at(widths.compact + 2))
  expect(compact).toContain('prev')
  expect(textOf(await at(widths.compact + 2))).not.toContain('0:10/')
  const mini = keysOf(await at(widths.mini + 2))
  expect(mini).toContain('toggle')
  expect(mini).not.toContain('prev')
  expect(textOf(await at(widths.mini - 1))).toBe('von anderen')
})

test('Breiten der Stufen sind geordnet; der Rest im Desktop zieht die Plätze der anderen und die Abstände ab', async () => {
  expect(TERMINAL_WIDTHS.full).toBeGreaterThan(TERMINAL_WIDTHS.compact)
  expect(TERMINAL_WIDTHS.compact).toBeGreaterThan(TERMINAL_WIDTHS.mini)
  expect(desktopRoom(1000, [300, 400])).toBe(1000 - 700 - 24)
  expect(desktopRoom(1000, [null, 400])).toBe(1000 - 400 - 12) // limit-bars zeichnet nichts: kein Abstand dafür
  expect(desktopRoom(1000, [undefined, null])).toBe(1000)
  expect(desktopRoom(500, [300, 400])).toBeLessThan(0)
  expect(DESKTOP_WIDTHS.full).toBe(0) // die Leiste belegt keinen Platz in der Zeile
  expect(DESKTOP_WIDTHS.compact).toBeGreaterThan(DESKTOP_WIDTHS.mini)
  // auto: ohne bekannten Platz die Leiste, mit Platz kompakt in der Zeile, sonst wieder die Leiste; fest gewählt bleibt es
  expect(desktopStage(undefined, 'auto', DESKTOP_WIDTHS)).toBe('full')
  expect(desktopStage(DESKTOP_WIDTHS.compact, 'auto', DESKTOP_WIDTHS)).toBe('compact')
  expect(desktopStage(DESKTOP_WIDTHS.compact - 1, 'auto', DESKTOP_WIDTHS)).toBe('full')
  expect(desktopStage(10, 'full', DESKTOP_WIDTHS)).toBe('full')
  expect(desktopStage(DESKTOP_WIDTHS.compact - 1, 'compact', DESKTOP_WIDTHS)).toBe('mini')
  expect(desktopStage(10, 'compact', DESKTOP_WIDTHS)).toBe('off')
})

// ---------- Befehle und Knöpfe ----------

test('Jeder Knopf löst genau einen Steuer-Aufruf aus; der Befehl geht nur über die Umgebung; das Ergebnis kommt im selben Aufruf zurück', DE_EXTRA, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  // „Zurück“ bei 10 s springt an den Anfang des Titels (seek 0), nicht zum vorigen Titel
  const cases: [string, string, string | undefined][] = [
    ['toggle', 'toggle', undefined],
    ['next', 'next', undefined],
    ['prev', 'seek', '0'],
    ['forward', 'seek', '25'],
    ['back', 'seek', '0'],
    ['shuffle', 'shuffle', 'true'],
    ['repeat', 'repeat', 'List'],
  ]
  for (const [btn, cmd, arg] of cases) {
    const before = w.count('control')
    const queries = w.count('query')
    await ui.press({ key: btn })
    await w.clock.settle()
    const ctl = w.runs.filter((r) => r.kind === 'control')
    expect(ctl.length).toBe(before + 1)
    const last = ctl[ctl.length - 1]!
    expect(last.env?.SP_CMD).toBe(cmd)
    if (arg !== undefined) expect(last.env?.SP_ARG).toBe(arg)
    expect(last.env?.SP_WAIT).toBe(cmd === 'next' ? '1500' : '200')
    // Der Befehl steht nirgends in den Argumenten außer im festen Skript
    expect(last.argv.filter((a) => a === CONTROL_SCRIPT).length).toBe(1)
    expect(last.argv[0]).toBe(PS_ABS)
    // Gelesen wird im selben Aufruf: kein zweiter PowerShell-Start
    expect(w.count('query')).toBe(queries)
  }
  await ui.unmount()
})

test('Zurück: über 3 s an den Anfang, dann zum vorigen Titel; `/spotify prev` geht immer zum vorigen', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  const ctl = () => w.runs.filter((r) => r.kind === 'control')
  w.state.out = q({ pos: 100 }, true)
  await w.clock.advance(10000)
  await w.clock.settle()
  await ui.press({ key: 'prev' })
  await w.clock.settle()
  expect(ctl().map((r) => r.env?.SP_CMD)).toEqual(['seek'])
  expect(ctl()[0]?.env?.SP_ARG).toBe('0')
  // Spotify meldet nach dem Sprung Position 0: der nächste Klick geht zum vorigen Titel
  w.state.out = q({ pos: 0 }, true)
  await w.clock.advance(10000)
  await w.clock.settle()
  await ui.press({ key: 'prev' })
  await w.clock.settle()
  expect(ctl().map((r) => r.env?.SP_CMD)).toEqual(['seek', 'prev'])
  await ui.unmount()
  await $.command.run({ command: 'spotify', args: 'prev' } as never)
  expect(ctl().at(-1)?.env?.SP_CMD).toBe('prev')
})

test('Zeichnen: Zeit und Balken höchstens alle 5 s neu, nicht jede Sekunde', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  await w.clock.advance(1000)
  await w.clock.settle()
  const early = w.state.renders
  await w.clock.advance(3000)
  await w.clock.settle()
  expect(w.state.renders - early).toBeLessThanOrEqual(1) // in 3 s kein sekündliches Neuzeichnen (höchstens eins durch die Abfrage)
  await w.clock.advance(12000)
  await w.clock.settle()
  expect(w.state.renders - early).toBeGreaterThan(1) // die Zeit läuft aber weiter
  await ui.unmount()
})

test('/spotify: Antworten, Spulen aus dem letzten Stand, Fehler', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const run = async (args = '') => (await $.command.run({ command: 'spotify', args } as never)).text as string
  expect(await run('')).toContain('Hey Jude – The Beatles')
  expect(await run('pause')).toBe('pausiert')
  expect(w.runs.filter((r) => r.kind === 'control').at(-1)?.env?.SP_CMD).toBe('pause')
  expect(await run('forward')).toBe('+15 s')
  expect(w.runs.filter((r) => r.kind === 'control').at(-1)?.env).toMatchObject({ SP_CMD: 'seek', SP_ARG: '25' })
  w.state.ctl = 'fail'
  expect(await run('next')).toContain('nicht reagiert')
  w.state.ctl = 'nosession'
  expect(await run('next')).toContain('keine Spotify-Sitzung')
  expect(await run('volume 5')).toContain('unbekannt')
  expect(await run('volume 5')).toContain('/spotify help')
  expect(await run('size gigantisch')).toContain('passt nicht')
  // Steuern geht auch bei ausgeblendetem Band
  w.state.ctl = 'ok'
  await run('off')
  expect(w.saved.get('settings')).toMatchObject({ enabled: false })
  const before = w.count('control')
  await run('toggle')
  expect(w.count('control')).toBe(before + 1)
})

test('/spotify off blendet das Band aus und stoppt den Takt; on bringt es zurück', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($)
  let ui = await $.ui.mount(band('desktop', 120))
  expect(seen((await ui.drawn()) as Node)).toContain('Hey Jude')
  await ui.unmount()
  await $.command.run({ command: 'spotify', args: 'off' } as never)
  ui = await $.ui.mount(band('desktop', 120))
  expect(textOf((await ui.drawn()) as Node)).toBe('von anderen')
  await ui.unmount()
  const runs = w.count('query')
  await w.clock.advance(60000)
  await w.clock.settle()
  expect(w.count('query')).toBe(runs) // aus: kein PowerShell mehr im Takt
  await $.command.run({ command: 'spotify', args: 'on' } as never)
  ui = await $.ui.mount(band('desktop', 120))
  expect(seen((await ui.drawn()) as Node)).toContain('Hey Jude')
  await ui.unmount()
})

test('/spotify help: Tabelle mit Kennung, Markdown als Fallback, Nebenwörter zeichnen sie nicht', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = (await $.command.run({ command: 'spotify', args: 'help' } as never)).text as string
  expect(text).toMatch(/#[0-9a-z]{5,}/)
  expect(text).toContain('/spotify size')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'spotify', component: 'CommandOutput', requestId: 'c1', surface, viewport: { columns: 100, rows: 30 }, props: { command: 'spotify', args: 'help', text, isErrored: false } } as never)
    expect(await ui.find({ key: 'spotify-help' })).toBeDefined()
    await ui.unmount()
  }
  // Fremde Argumente zeichnen keine Tabelle
  const ui = await $.ui.mount({ plugin: 'spotify', component: 'CommandOutput', requestId: 'c2', surface: 'desktop', viewport: { columns: 100, rows: 30 }, props: { command: 'spotify', args: 'volume #1', text, isErrored: false } } as never)
  expect(await ui.find({ key: 'spotify-help' })).toBeUndefined()
  await ui.unmount()
})

// ---------- Takt und Fehler ----------

test('Takt: fragt alle pollSeconds, nicht öfter; ohne Zeichnung beendet er sich selbst', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  await ui.drawn()
  const first = w.count('query')
  await w.clock.advance(3000)
  await w.clock.settle()
  expect(w.count('query')).toBe(first) // 4 s sind noch nicht um
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(w.count('query')).toBeGreaterThan(first)
  await ui.unmount()
})

for (const bad of ['deny', 'empty', 'broken', 'text']) {
  const out = { deny: q(), empty: '', broken: '{kaputt', text: 'Fehler: x' }[bad]!
  test(`Fehlerpfad ${bad}: nichts gezeichnet, kein Wurf; nach drei Fehlern fragt der Takt seltener`, DE, async ($, on) => {
    const w = world(on, { out, deny: bad === 'deny', inner: 'text' })
    await w.start($)
    const ui = await $.ui.mount(band('desktop', 120))
    expect(textOf((await ui.drawn()) as Node)).toBe('von anderen')
    await ui.unmount()
    expect(typeof ((await $.command.run({ command: 'spotify', args: '' } as never)).text as string)).toBe('string')
    for (let i = 0; i < 12; i++) await w.clock.advance(4000)
    await w.clock.settle()
    const n = w.count('query')
    await w.clock.advance(10000)
    await w.clock.settle()
    expect(w.count('query')).toBe(n)
  })
}

test('Kaputtes Cover: der Titel wird trotzdem gezeigt, das Cover bleibt der Platzhalter', DE, async ($, on) => {
  const w = world(on, { out: q({}, false) + '\r\ncover <evil/>' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).not.toContain('<evil')
  expect(String(svg?.props.source)).not.toContain('<image')
  await ui.unmount()
})

test('Nicht Windows: nichts gezeichnet, kein PowerShell, /spotify sagt es', DE, async ($, on) => {
  const w = world(on, { inner: 'text', cwd: '/home/x' })
  await w.start($)
  await w.clock.advance(20000)
  await w.clock.settle()
  const ui = await $.ui.mount(band('desktop', 120))
  expect(textOf((await ui.drawn()) as Node)).toBe('von anderen')
  await ui.unmount()
  expect(w.count('query')).toBe(0)
  expect(((await $.command.run({ command: 'spotify', args: 'play' } as never)).text as string)).toContain('Windows')
  expect(w.count('control')).toBe(0)
})

test('Englisch ist der Standard', async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = (await $.command.run({ command: 'spotify', args: 'volume 5' } as never)).text as string
  expect(text).toContain('unknown')
})

test('/spotify beim ersten Zeichnen: wartet auf die laufende Abfrage statt „keine Sitzung“ zu melden', DE, async ($, on) => {
  const w = world(on)
  await w.start($, 'terminal')
  const ui = await $.ui.mount(band('terminal', 120)) // startet die erste Abfrage
  const text = (await $.command.run({ command: 'spotify', args: '' } as never)).text as string
  expect(text).toContain('Hey Jude')
  await ui.unmount()
})

// ---------- Leiste im Stil der limit-bars ----------

test('Leiste: Segmentbalken wie bei limit-bars (44 × 3 px mit 1 px Fuge), Titel orange, Zeit grün und grau, Text maskiert und gekürzt', async () => {
  const svg = infoSvg('Waves <Radio> & Edit', 'Mr. Probz', 50, 200)
  expect((svg.match(/<rect /g) ?? []).length).toBe(44)
  expect((svg.match(/fill="#6CC070"/g) ?? []).length).toBe(11 + 1) // 11 Segmente bei 25 % plus der verstrichene Teil der Zeit
  expect(svg).toContain('fill="#D77757"')
  expect(svg).toContain('Waves &lt;Radio&gt; &amp; Edit')
  expect(svg).toContain('0:50')
  expect(svg).toContain('3:20')
  expect(svg).not.toContain('<Radio>')
  const long = infoSvg('T'.repeat(300), 'A'.repeat(300), 0, 0)
  expect(long.length).toBeLessThan(20000)
  expect(long).toContain('…')
  expect(clip('abc', 5)).toBe('abc')
  expect(clip('abcdef', 4)).toBe('abc…')
  expect(sepSvg()).toContain('#D77757')
  expect(sepSvg().length).toBeLessThan(1000)
})

test('Leiste: Hinweis je Knopf beim Überfahren (Hover-Gruppe), Absatz vor Zufall/Wiederholen, orange Trennlinie unten', DE_EXTRA, async ($, on) => {
  const w = world(on, { inner: 'text' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  const tree = (await ui.drawn()) as Node
  const json = JSON.stringify(tree)
  for (const k of ['prev', 'back', 'toggle', 'forward', 'next', 'shuffle', 'repeat']) {
    expect(json).toContain(`"scope":"sp-${k}"`)
  }
  expect(json).toContain('Titel neu starten · zweimal: voriger Titel')
  expect(json).toContain('15 Sekunden zurück')
  expect(json).toContain('Pause') // läuft gerade: der Hinweis des mittleren Knopfs heißt Pause
  expect(json).toContain('"display":"none"')
  expect(json).toContain('"marginLeft":2') // der Absatz vor den Zustandsknöpfen
  expect(seen(tree)).toContain('Trennlinie')
  expect(json).toContain('height=\\"2\\" fill=\\"#D77757\\"') // die Linie im Bild, JSON-maskiert
  await ui.unmount()
})

// ---------- 0.3.0: spotify.playing für clawd-buddy ----------

test('0.3.0: spotify.playing meldet nur „spielt ja/nein“, außerhalb des Zeichnens; Pause, aus und nach /clear stimmt er wieder; Ablehnung wird wiederholt', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  const writes: unknown[] = []
  let stored: unknown = undefined
  let refuse = 0
  on('state.get', ($: unknown, e: any) => ({ value: { value: e.key === 'playing' ? stored : undefined, version: 1 } }) as never)
  on('state.set', ($: unknown, e: any) => {
    if (refuse > 0) {
      refuse -= 1
      return { deny: 'beim Zeichnen abgelehnt' } as never
    }
    stored = e.value
    writes.push(e.value)
    return { value: { isSet: true, version: writes.length } } as never
  })
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  await ui.drawn()
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(writes.at(-1)).toEqual({ playing: true })
  // Nur das Flag, kein Titel
  expect(JSON.stringify(writes)).not.toContain('Hey Jude')
  // Ohne Änderung kein weiteres Schreiben
  const n = writes.length
  await w.clock.advance(3000)
  await w.clock.settle()
  expect(writes.length).toBe(n)
  // Pause: beim nächsten Abfragen
  w.state.out = q({ status: 'Paused' })
  await w.clock.advance(6000)
  await w.clock.settle()
  expect(writes.at(-1)).toEqual({ playing: false })
  // /clear setzt $.state zurück: spätestens nach PLAYING_RECHECK steht der Wert wieder da
  stored = undefined
  await w.clock.advance(31000)
  await w.clock.settle()
  expect(stored).toEqual({ playing: false })
  // Abgelehnt (z. B. während eines Zeichnens): der nächste Takt versucht es wieder
  w.state.out = q({ status: 'Playing' })
  refuse = 1
  await w.clock.advance(6000)
  await w.clock.settle()
  expect(stored).toEqual({ playing: true })
  // /spotify off: null
  await $.command.run({ command: 'spotify', args: 'off' } as never)
  expect(writes.at(-1)).toBeNull()
  await ui.unmount()
})

test('0.3.1: nach /clear, /resume und /branch steht spotify.playing sofort wieder da (classic.SessionStart), nicht nach Start oder Komprimieren', DE, async ($, on) => {
  const w = world(on, { inner: 'text' })
  let stored: unknown = undefined
  let sets = 0
  on('state.get', ($: unknown, e: any) => ({ value: { value: e.key === 'playing' ? stored : undefined, version: 1 } }) as never)
  on('state.set', ($: unknown, e: any) => {
    stored = e.value
    sets += 1
    return { value: { isSet: true, version: sets } } as never
  })
  on('classic.SessionStart', () => ({}) as never)
  await w.start($)
  const ui = await $.ui.mount(band('desktop', 120))
  await ui.drawn()
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(stored).toEqual({ playing: true })
  for (const source of ['clear', 'resume', 'fork'] as const) {
    stored = undefined // so hinterlässt Claude Code $.state nach dem Befehl
    await ($ as any).classic.SessionStart({ source })
    expect(stored, source).toEqual({ playing: true })
  }
  const n = sets
  for (const source of ['startup', 'compact'] as const) await ($ as any).classic.SessionStart({ source })
  expect(sets).toBe(n)
  await ui.unmount()
})

test('0.3.1: classic.SessionStart vor session.start (z. B. --resume) schreibt nichts', DE, async ($, on) => {
  world(on, { inner: 'text' })
  let sets = 0
  on('state.get', () => ({ value: { value: undefined, version: 0 } }) as never)
  on('state.set', () => {
    sets += 1
    return { value: { isSet: true, version: sets } } as never
  })
  on('classic.SessionStart', () => ({}) as never)
  await ($ as any).classic.SessionStart({ source: 'resume' })
  expect(sets).toBe(0)
})
