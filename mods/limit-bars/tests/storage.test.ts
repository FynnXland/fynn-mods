// limit-bars: Speicher-Ring und /disk (SPEC.md, Ausbau v0.4.0). PowerShell läuft nie echt: `process.run` ist gestubbt.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import {
  BIG_SEGMENTS,
  DISK_SEGMENTS,
  GROUP_COLOR,
  PROBE_SCRIPT,
  PS_ABS,
  SCAN_SCRIPT,
  diskArcs,
  diskRingSvg,
  diskView,
  segmentColors,
  driveOf,
  groupOf,
  parseProbe,
  parseScan,
  shownGroups,
  sizeShort,
  storageReport,
  storageTerminal,
} from '../hooks/storage.ts'
import { T } from '../hooks/i18n.ts'
import { EMPTY, GREY } from '../hooks/view.ts'

const NOW = new Date(2026, 9, 6, 10, 0, 0).getTime()
const G = 1024 ** 3
const TOTAL = 800 * G
const FREE = 700 * G // belegt 100G
const probeOut = `total\t${TOTAL}\r\nfree\t${FREE}\r\n`
// gescannt 96G: programs 50, media 20, models 10, code 5, archives 5, unbekannt 5 + ohne Endung 1 → other 6 + Rest 4 = 10
const scanOut = [
  'files\t1234',
  `scanned\t${96 * G}`,
  `ext\t.dll\t${40 * G}`,
  `ext\t.EXE\t${10 * G}`,
  `ext\t.mp4\t${20 * G}`,
  `ext\t.gguf\t${10 * G}`,
  `ext\t.py\t${5 * G}`,
  `ext\t.zip\t${5 * G}`,
  `ext\t.xyz\t${5 * G}`,
  `ext\t\t${1 * G}`,
].join('\r\n')

const DE = { options: { language: 'de', storagePath: 'E:\\' } } as const
const EN = { options: { language: 'en', storagePath: 'E:\\' } } as const
const OFF = { options: { language: 'de' } } as const

const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({ plugin: 'limit-bars', component: 'AbovePrompt', requestId: 'above-prompt', props: props(bodyColumns), surface }) as const
const output = (text: string, surface: string, isErrored = false) =>
  ({
    plugin: 'limit-bars',
    component: 'CommandOutput',
    requestId: `out-${surface}-${isErrored}`,
    surface,
    viewport: { columns: 80, rows: 30 },
    props: { command: 'disk', args: '', text, isErrored },
  }) as never

type Ps = { exitCode?: number; stdout?: string; truncated?: boolean; deny?: string }

function world(on: On, o: { saved?: Map<string, unknown>; scan?: Ps; probe?: Ps; absDenied?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const attempts: string[] = [] // jedes gestartete Programm, auch abgelehnte
  const runs: { kind: 'probe' | 'scan' | '?'; argv: readonly string[]; env?: Record<string, string>; cwd?: string }[] = []
  let scan: Ps = o.scan ?? { stdout: scanOut }
  let probe: Ps = o.probe ?? { stdout: probeOut }
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: undefined, window: 1000000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: new Date(NOW + 7.9e6).toISOString() }] } }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    const kind = e.argv[4] === PROBE_SCRIPT ? 'probe' : e.argv[4] === SCAN_SCRIPT ? 'scan' : '?'
    attempts.push(e.argv[0]!)
    if (o.absDenied) return { deny: 'Richtlinie' }
    runs.push({ kind, argv: e.argv, env: e.init?.env, cwd: e.init?.cwd })
    const p = kind === 'scan' ? scan : probe
    if (p.deny) return { deny: p.deny }
    return { value: { exitCode: p.exitCode ?? 0, stdout: p.stdout ?? '', stderr: p.exitCode ? 'Fehler' : '', isStdoutTruncated: !!p.truncated, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) =>
    e.component === 'CommandOutput'
      ? { type: 'Text', props: {}, children: [`ENGINE:${String((e.props as { text?: string }).text ?? '')}`] }
      : { type: 'engine', ref: 0 },
  )
  on('session.start', () => ({ cwd: '/work' }))
  const count = (k: 'probe' | 'scan') => runs.filter((r) => r.kind === k).length
  return {
    clock,
    saved,
    runs,
    attempts,
    count,
    setScan: (p: Ps) => (scan = p),
    setProbe: (p: Ps) => (probe = p),
    async start($: any, surface: 'desktop' | 'terminal' = 'desktop') {
      await $.session.start({ cwd: '/work', surface, isInteractive: true })
      await clock.advance(2000)
      await clock.settle()
    },
  }
}

const svgAlt = async (ui: any) => String((await ui.find({ type: 'Svg' }))?.props.alt)
const storage = async ($: any, args = '') => (await $.command.run({ command: 'disk', args } as never)).text as string

// ---------- reine Logik ----------

test('Endungen → Gruppen: Groß/Kleinschreibung egal, unbekannt und ohne Endung sind Sonstiges', async () => {
  expect(groupOf('.DLL')).toBe('programs')
  expect(groupOf('.mp4')).toBe('media')
  expect(groupOf('.safetensors')).toBe('models')
  expect(groupOf('.ts')).toBe('code')
  expect(groupOf('.pack')).toBe('archives')
  expect(groupOf('.xyz')).toBe('other')
  expect(groupOf('')).toBe('other')
})

test('Laufwerk aus dem Pfad: nur Windows-Pfade mit Buchstabe', async () => {
  expect(driveOf('E:\\')).toBe('E:')
  expect(driveOf(' e:\\Entwicklung')).toBe('E:')
  expect(driveOf('/home/fynn')).toBeUndefined()
  expect(driveOf('')).toBeUndefined()
})

test('Probe und Scan lesen: Tab-Zeilen, unplausibel → nichts; Sonstiges bekommt belegt − gescannt', async () => {
  expect(parseProbe(probeOut)).toEqual({ total: TOTAL, free: FREE })
  expect(parseProbe('total\t10\r\nfree\t20')).toBeUndefined()
  expect(parseProbe('free\t20')).toBeUndefined()
  expect(parseProbe('total\tabc\nfree\t1')).toBeUndefined()
  const s = parseScan(scanOut, NOW)!
  expect(s.files).toBe(1234)
  expect(s.groups.programs).toBe(50 * G)
  expect(s.groups.other).toBe(6 * G)
  expect(parseScan('ext\t.dll\t5', NOW)).toBeUndefined()
  const g = shownGroups({ total: TOTAL, free: FREE }, s)
  expect(g.other).toBe(10 * G)
  expect(g.media).toBe(20 * G)
})

test('Größen: binär wie im Explorer, ab 1000G in T; en/de', async () => {
  expect(sizeShort(512 * 1024 ** 2, 'de')).toBe('512M')
  expect(sizeShort(114.4 * G, 'en')).toBe('114G')
  expect(sizeShort(801 * G, 'de')).toBe('801G')
  expect(sizeShort(1.2 * 1024 * G, 'en')).toBe('1.2T')
  expect(sizeShort(1.2 * 1024 * G, 'de')).toBe('1,2T')
})

test('Bögen (Variante B): ganzer Ring = belegt, Gruppen in fester Reihenfolge; ohne Scan grau, ohne Belegung leer', async () => {
  const d = { total: TOTAL, free: FREE }
  const arcs = diskArcs(d, parseScan(scanOut, NOW))
  expect(arcs.map((a) => a.color)).toEqual([GROUP_COLOR.programs, GROUP_COLOR.media, GROUP_COLOR.models, GROUP_COLOR.code, GROUP_COLOR.archives, GROUP_COLOR.other])
  expect(arcs[0]!.from).toBe(0)
  expect(Math.abs(arcs[0]!.to - 0.5) < 1e-9).toBe(true)
  expect(Math.abs(arcs[arcs.length - 1]!.to - 1) < 1e-9).toBe(true)
  expect(diskArcs(d, undefined)).toEqual([{ from: 0, to: 1, color: GREY }])
  expect(diskArcs({ total: TOTAL, free: TOTAL }, undefined)).toEqual([{ from: 0, to: 1, color: EMPTY }])
  // 0.5.1: Segmente wie der Cache-Ring; eine winzige Gruppe bekommt trotzdem ein Segment
  const one = diskView('E:', d, { at: NOW, files: 1, scanned: 100 * G, groups: { programs: 100 * G, media: 0, models: 0, code: 0, archives: 0, other: 0 } }, 'de')
  expect((diskRingSvg(one, 0, 0).match(/<path /g) ?? []).length).toBe(DISK_SEGMENTS)
  const tiny = diskView('E:', d, { at: NOW, files: 1, scanned: 100 * G, groups: { programs: 100 * G - 1000, media: 1000, models: 0, code: 0, archives: 0, other: 0 } }, 'de')
  expect((diskRingSvg(tiny, 0, 0).match(new RegExp(GROUP_COLOR.media, 'g')) ?? []).length).toBe(1)
})

test('0.5.1: Segmente verteilen (größter Rest, jede sichtbare Gruppe ≥ 1, Summe = n)', async () => {
  const arcs = [
    { from: 0, to: 0.5, color: 'a' },
    { from: 0.5, to: 0.51, color: 'b' },
    { from: 0.51, to: 1, color: 'c' },
  ]
  const s = segmentColors(arcs, 28)
  expect(s.length).toBe(28)
  expect(s.filter((c) => c === 'b').length).toBe(1)
  expect(s.filter((c) => c === 'a').length + s.filter((c) => c === 'c').length).toBe(27)
  // Reihenfolge bleibt: erst a, dann b, dann c
  expect(s.indexOf('b')).toBeGreaterThan(s.lastIndexOf('a'))
  expect(s.indexOf('c')).toBeGreaterThan(s.indexOf('b'))
  // /disk: 56 Segmente, der freie Teil grau; Fynns Laufwerk (14 % belegt) zeigt alle sechs Gruppen
  const d = { total: TOTAL, free: FREE }
  const big = segmentColors(diskArcs(d, parseScan(scanOut, NOW), true), BIG_SEGMENTS)
  expect(big.length).toBe(56)
  expect(new Set(big.filter((c) => c !== EMPTY)).size).toBe(6)
  expect(big.filter((c) => c === EMPTY).length).toBeGreaterThan(44)
})

test('0.5.1: Farben im Stil von limit-bars, verschieden von den Balkenfarben', async () => {
  const bars = ['#D77757', '#6CC070', '#F2C94C', '#C9594B', '#4A4A4A', '#9A9A9A']
  for (const c of Object.values(GROUP_COLOR)) expect(bars.includes(c)).toBe(false)
  expect(new Set(Object.values(GROUP_COLOR)).size).toBe(6)
})

test('0.5.0: große Ansicht (/disk) mit freiem Teil: Gruppen anteilig am Laufwerk, Rest grau; Band ohne', async () => {
  const d = { total: TOTAL, free: FREE } // belegt 100 von 800
  const scan = parseScan(scanOut, NOW)
  const big = diskArcs(d, scan, true)
  expect(big[big.length - 1]).toEqual({ from: big[big.length - 2]!.to, to: 1, color: EMPTY })
  expect(Math.abs(big[0]!.to - 50 / 800) < 1e-9).toBe(true)
  expect(Math.abs(big[big.length - 2]!.to - 100 / 800) < 1e-9).toBe(true)
  // Vor dem Scan: belegt grau, frei leer
  expect(diskArcs(d, undefined, true)).toEqual([
    { from: 0, to: 100 / 800, color: GREY },
    { from: 100 / 800, to: 1, color: EMPTY },
  ])
  // Band unverändert ohne freien Teil
  expect(diskArcs(d, scan).some((a) => a.color === EMPTY)).toBe(false)
  const r = storageReport('E:', d, scan, NOW, 'de')
  expect(r.view.arcs.some((a) => a.color === EMPTY)).toBe(true)
  expect(r.view.label).toBe('Storage')
  // Terminal-Balken: Anteil frei = 7/8 der Breite
  const bar = storageTerminal(r, 42, 'de').bar
  expect(bar[bar.length - 1]).toEqual({ color: EMPTY, n: 35 })
})

test('Skripte: keine doppelten Anführungszeichen, Pfad nur über LB_PATH', async () => {
  for (const s of [PROBE_SCRIPT, SCAN_SCRIPT]) {
    expect(s).not.toContain('"')
    expect(s).toContain('$env:LB_PATH')
    expect(/[A-Za-z]:\\/.test(s)).toBe(false)
  }
})

test('Terminal-Ansicht von /disk: Balken so breit wie verfügbar, Legende nach Größe, frei zuletzt', async () => {
  const r = storageReport('E:', { total: TOTAL, free: FREE }, parseScan(scanOut, NOW), NOW, 'de')
  const v = storageTerminal(r, 42, 'de')
  expect(v.bar.reduce((n, b) => n + b.n, 0)).toBe(40)
  expect(v.lines[0]!.text).toMatch(/^Programme & Bibliotheken +50 GB +50,0 %$/)
  expect(v.lines[v.lines.length - 1]!.text).toContain('87,5 % des Laufwerks')
  expect(v.footer).toBe('Gescannt 10:00 · 1.234 Dateien')
})

// ---------- Hooks ----------

test('Start (Desktop): Probe und Scan außerhalb des Hooks, Ring rechts neben dem Cache-Ring, Stand im Store', DE, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect(w.runs.length).toBe(0) // der Sitzungsstart wartet nicht auf PowerShell
  await w.clock.advance(2000)
  await w.clock.settle()
  expect([w.count('probe'), w.count('scan')]).toEqual([1, 1])
  for (const r of w.runs) {
    expect(r.argv.slice(0, 4)).toEqual([PS_ABS, '-NoProfile', '-NonInteractive', '-Command'])
    expect(r.env).toEqual({ LB_PATH: 'E:\\' })
  }
  const ui = await $.ui.mount(band('desktop'))
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.alt)).toContain('Laufwerk E: 100 GB von 800 GB belegt')
  expect(svg?.props.width).toBe(302)
  expect(svg?.props.height).toBe(56)
  expect(String(svg?.props.source)).toContain(GROUP_COLOR.programs)
  expect(String(svg?.props.source)).toContain('>100G<')
  expect(String(svg?.props.source)).toContain('>/800G<')
  expect(String(svg?.props.source)).toContain('>Storage<')
  expect(String(svg?.props.source)).not.toContain('>E:<')
  const st = w.saved.get('storage') as { path: string; scan?: { files: number }; scanStartedAt?: number }
  expect(st.path).toBe('E:\\')
  expect(st.scan?.files).toBe(1234)
  expect(st.scanStartedAt).toBeUndefined()
  await ui.unmount()
})

test('Ohne storagePath: kein PowerShell, kein Speicher-Ring, Bild wie in 0.3.0', OFF, async ($, on) => {
  const w = world(on)
  await w.start($)
  expect(w.runs.length).toBe(0)
  const ui = await $.ui.mount(band('desktop'))
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.width).toBe(242)
  expect(String(svg?.props.alt)).not.toContain('Laufwerk')
  expect(await storage($)).toBe(T.de.storageOff)
  await ui.unmount()
})

test('Täglicher Scan: Scan von heute → nur Probe', DE, async ($, on) => {
  const today = { path: 'E:\\', total: TOTAL, free: FREE, probedAt: NOW - 3600000, scan: { ...parseScan(scanOut, NOW - 3600000)! } }
  const w1 = world(on, { saved: new Map([['storage', today]]) })
  await w1.start($)
  expect([w1.count('probe'), w1.count('scan')]).toEqual([1, 0])
})

test('Täglicher Scan: Scan von gestern → neu scannen', DE, async ($, on) => {
  const old = { path: 'E:\\', total: TOTAL, free: FREE, probedAt: NOW - 86400000, scan: { ...parseScan(scanOut, NOW - 86400000)! } }
  const w = world(on, { saved: new Map([['storage', old]]) })
  await w.start($)
  expect(w.count('scan')).toBe(1)
})

test('Täglicher Scan: Sperre einer anderen Sitzung (< 5 min) verhindert den zweiten Scan', DE, async ($, on) => {
  const old = { path: 'E:\\', total: TOTAL, free: FREE, probedAt: NOW - 60000, scan: { ...parseScan(scanOut, NOW - 86400000)! }, scanStartedAt: NOW - 60000 }
  const w = world(on, { saved: new Map([['storage', old]]) })
  await w.start($)
  expect([w.count('probe'), w.count('scan')]).toEqual([1, 0])
})

test('Gespeicherter Stand eines anderen Pfads wird ignoriert', DE, async ($, on) => {
  const other = { path: 'D:\\', total: 5 * G, free: 1 * G, probedAt: NOW, scan: { ...parseScan(scanOut, NOW)! } }
  const w = world(on, { saved: new Map([['storage', other]]) })
  w.setProbe({ deny: 'aus' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  expect(await svgAlt(ui)).not.toContain('Laufwerk')
  await ui.unmount()
})

test('Takt: alle 60 Ticks (10 min) eine Probe, solange gezeichnet wird', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  const before = w.count('probe')
  for (let i = 0; i < 60; i++) {
    await w.clock.advance(10000)
    await ui.redraw()
  }
  expect(w.count('probe')).toBe(before + 1)
  expect(w.count('scan')).toBe(1)
  await ui.unmount()
})

test('Terminal-Band: Block „Storage 100G/800G“ hinter den Balken; wird es eng, fällt er zuerst weg', DE, async ($, on) => {
  const w = world(on)
  await w.start($, 'terminal')
  const wide = await $.ui.mount(band('terminal', 120))
  expect(await wide.find({ type: 'Text', text: 'Storage 100G/800G' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
  await wide.unmount()
  const narrow = await $.ui.mount(band('terminal', 70))
  expect(await narrow.find({ type: 'Text', text: 'Storage 100G/800G' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
  await narrow.unmount()
})

test('/disk: Markdown mit Kennung, Tabelle nach Größe, frei und Scan-Zeit; frischer Scan wird nicht wiederholt', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await storage($)
  const first = text.split('\n')[0]!
  expect(first).toMatch(/^### Laufwerk E: · 100 GB von 800 GB belegt \(12,5 %\) #[0-9a-z]{5,}$/)
  expect(text).toContain('| Programme & Bibliotheken | 50 GB | 50,0 % |')
  expect(text.indexOf('Medien')).toBeLessThan(text.indexOf('Sonstiges'))
  expect(text).toContain('Frei: 700 GB · 87,5 % des Laufwerks')
  expect(text).toContain('Gescannt 10:00 · 1.234 Dateien')
  expect(w.count('scan')).toBe(1) // Scan jünger als 1 h
  await w.clock.advance(61 * 60000)
  await storage($)
  expect(w.count('scan')).toBe(2)
  await storage($, 'refresh')
  expect(w.count('scan')).toBe(3)
  expect(await storage($, 'quatsch')).toBe(T.de.unknownArg('quatsch', 'refresh'))
})

test('/disk: Scan scheitert → alter Stand mit Fehlerzeile; abgeschnittene Ausgabe zählt als Fehler; Sperre wird gelöst', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.setScan({ exitCode: 1 })
  const t1 = await storage($, 'refresh')
  expect(t1).toContain('Scan fehlgeschlagen (exit 1: Fehler)')
  expect(t1).toContain('| Programme & Bibliotheken | 50 GB |')
  expect((w.saved.get('storage') as { scanStartedAt?: number }).scanStartedAt).toBeUndefined()
  w.setScan({ stdout: scanOut, truncated: true })
  expect(await storage($, 'refresh')).toContain('Scan fehlgeschlagen (Ausgabe abgeschnitten)')
})

test('Falscher Pfad (exit 2): Fehler statt „0 Dateien“, automatische Scans pausieren 24 h, refresh versucht es trotzdem', DE, async ($, on) => {
  const w = world(on, { scan: { exitCode: 2 } })
  await w.start($)
  expect(w.count('scan')).toBe(1)
  const st = w.saved.get('storage') as { scan?: unknown; scanFailedAt?: number; scanStartedAt?: number }
  expect(st.scan).toBeUndefined()
  expect(st.scanFailedAt).toBe(NOW + 2000)
  expect(st.scanStartedAt).toBeUndefined()
  // /disk ohne refresh: kein neuer Scan, Hinweis auf die Pause
  const text = await storage($)
  expect(w.count('scan')).toBe(1)
  expect(text).toContain('Der letzte Scan ist um 10:00 gescheitert')
  expect(text).toContain(T.de.storageNoScan)
  expect(await storage($, 'refresh')).toContain('Scan fehlgeschlagen (Pfad nicht gefunden)')
  expect(w.count('scan')).toBe(2)
  // Klappt der Scan wieder, ist die Pause vorbei
  w.setScan({ stdout: scanOut })
  await storage($, 'refresh')
  expect((w.saved.get('storage') as { scanFailedAt?: number }).scanFailedAt).toBeUndefined()
})

test('Pause nach Fehlschlag gilt auch für den nächsten Sitzungsstart', DE, async ($, on) => {
  const failed = { path: 'E:\\', total: TOTAL, free: FREE, probedAt: NOW - 3600000, scanFailedAt: NOW - 3600000 }
  const w = world(on, { saved: new Map([['storage', failed]]) })
  await w.start($)
  expect([w.count('probe'), w.count('scan')]).toEqual([1, 0])
})

test('Start ohne Oberfläche (S1): das erste Zeichnen stößt den Start an, der gespeicherte Scan bleibt erhalten', DE, async ($, on) => {
  const today = { path: 'E:\\', total: TOTAL, free: FREE, probedAt: NOW - 60000, scan: { ...parseScan(scanOut, NOW - 3600000)! } }
  const w = world(on, { saved: new Map([['storage', today]]) })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: true } as never)
  await w.clock.advance(2000)
  expect(w.runs.length).toBe(0)
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.advance(2000)
  await w.clock.settle()
  expect([w.count('probe'), w.count('scan')]).toEqual([1, 0])
  expect((w.saved.get('storage') as { scan?: { files: number } }).scan?.files).toBe(1234)
  await ui.redraw()
  expect(await svgAlt(ui)).toContain('Laufwerk E: 100 GB von 800 GB belegt')
  await ui.unmount()
})

test('Mehrere Sitzungen (S2): Probe übernimmt einen neueren Scan und lässt die Sperre der anderen Sitzung stehen', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  // Eine andere Sitzung hat inzwischen neu gescannt und scannt gerade wieder
  const other = { ...(w.saved.get('storage') as object), scan: { ...parseScan(scanOut, NOW + 5000)!, files: 999 }, scanStartedAt: NOW + 6000 }
  w.saved.set('storage', other)
  for (let i = 0; i < 60; i++) {
    await w.clock.advance(10000)
    await ui.redraw()
  }
  const st = w.saved.get('storage') as { scan?: { files: number }; scanStartedAt?: number }
  expect(st.scan?.files).toBe(999)
  expect(st.scanStartedAt).toBe(NOW + 6000)
  expect((await storage($)).includes('999 Dateien')).toBe(true)
  await ui.unmount()
})

test('0.4.1: /disk während eine andere Sitzung scannt → Hinweis statt nur „noch nicht gescannt“, kein zweiter Scan', DE, async ($, on) => {
  const locked = { path: 'E:\\', total: TOTAL, free: FREE, probedAt: NOW - 60000, scanStartedAt: NOW - 60000 }
  const w = world(on, { saved: new Map([['storage', locked]]) })
  const text = await storage($)
  expect(w.count('scan')).toBe(0)
  expect(text).toContain(T.de.storageNoScan)
  expect(text).toContain('Eine andere Sitzung scannt das Laufwerk seit 09:59.')
  // Nach Ablauf der Sperre (5 min) scannt /disk selbst
  await w.clock.advance(5 * 60000)
  expect(await storage($)).not.toContain('Eine andere Sitzung')
  expect(w.count('scan')).toBe(1)
})

test('0.4.1: /disk während des eigenen Start-Scans wartet auf ihn (kein Hinweis, kein zweiter Scan)', DE, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await w.clock.advance(2000)
  const text = await storage($)
  await w.clock.settle()
  expect(w.count('scan')).toBe(1)
  expect(text).not.toContain('Eine andere Sitzung')
  expect(text).toContain('| Programme & Bibliotheken | 50 GB |')
})

test('Zwei /disk refresh gleichzeitig: ein Scan', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await Promise.all([storage($, 'refresh'), storage($, 'refresh')])
  expect(w.count('scan')).toBe(2) // Start + ein gemeinsamer
})

test('Probe scheitert beim Start: kein Speicher-Ring, Balken und Cache-Ring bleiben', DE, async ($, on) => {
  const w = world(on, { probe: { exitCode: 1 } })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.width).toBe(242)
  expect(String(svg?.props.alt)).toContain('5-Stunden-Limit')
  await ui.unmount()
})

test('Abgelehnt (S5): kein zweiter Versuch mit anderem Programm; kein Ring, /disk meldet den Fehler', DE, async ($, on) => {
  const w = world(on, { absDenied: true })
  await w.start($)
  expect(w.attempts.length).toBe(1)
  expect(w.attempts.every((a) => a === PS_ABS)).toBe(true)
  const ui = await $.ui.mount(band('desktop'))
  expect(await svgAlt(ui)).not.toContain('Laufwerk')
  await ui.unmount()
  expect(await storage($)).toMatch(/^Laufwerk E: nicht lesbar: /)
  expect(w.attempts.every((a) => a === PS_ABS)).toBe(true)
})

test('Startordner nicht lesbar (exit 3): Fehlermeldung', DE, async ($, on) => {
  const w = world(on, { scan: { exitCode: 3 } })
  await w.start($)
  expect(await storage($, 'refresh')).toContain('Scan fehlgeschlagen (Ordner nicht lesbar)')
})

test('Gescannt größer als belegt: Anteile bleiben ≤ 100 %, Balken nicht breiter als verfügbar', async () => {
  const d = { total: TOTAL, free: 750 * G } // belegt 50G, gescannt 96G
  const r = storageReport('E:', d, parseScan(scanOut, NOW), NOW, 'de')
  expect(r.rows.reduce((n, x) => n + x.share, 0) <= 1 + 1e-9).toBe(true)
  expect(storageTerminal(r, 42, 'de').bar.reduce((n, b) => n + b.n, 0)).toBe(40)
})

test('/disk: Probe abgelehnt und kein Stand → Fehlermeldung; kein Windows-Pfad → Hinweis', DE, async ($, on) => {
  const w = world(on)
  w.setProbe({ deny: 'Richtlinie' })
  const text = await storage($)
  expect(text).toMatch(/^Laufwerk E: nicht lesbar: /)
  expect(w.count('scan')).toBe(0)
})

test('/disk ohne Windows-Pfad: Hinweis, kein PowerShell', { options: { language: 'de', storagePath: '/home/fynn' } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  expect(await storage($)).toBe(T.de.storageWindowsOnly)
  expect(w.runs.length).toBe(0)
})

for (const surface of ['desktop', 'terminal'] as const)
  test(`/disk-Zeile (${surface}): eigener Baum statt Markdown`, DE, async ($, on) => {
    const w = world(on)
    await w.start($)
    const ui = await $.ui.mount(output(await storage($), surface))
    expect(await ui.find({ text: /^ENGINE:/ })).toBeUndefined()
    if (surface === 'desktop') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.alt)).toContain('Programme & Bibliotheken 50 GB')
      expect(String(svg?.props.alt)).toContain('Frei 700 GB')
      expect(String(svg?.props.source)).toContain('Gescannt 10:00 &#183; 1.234 Dateien')
      expect(String(svg?.props.source)).not.toMatch(/="\d+\.\d{3,}/) // keine krummen Koordinaten
    } else {
      const cells = await ui.findAll({ type: 'Text', text: /^█+$/ })
      // ganzes Laufwerk: zuletzt der freie Teil (60 − round(60 · 1/8) = 52 Zellen); winzige Gruppen können ohne Zelle bleiben
      expect(cells[cells.length - 1]?.props.color).toBe(EMPTY)
      expect(String(cells[cells.length - 1]?.children?.[0] ?? '').length).toBe(52)
      expect(await ui.find({ type: 'Text', text: /^Programme & Bibliotheken +50 GB/ })).toBeDefined()
    }
    await ui.unmount()
  })

test('/disk-Zeile: unbekannte Kennung, Fehlerzeile und VS Code → Markdown der Engine', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await storage($)
  for (const m of [output('### Laufwerk E: #zzzzzzz', 'desktop'), output(text, 'desktop', true), output(text, 'vscode')]) {
    const ui = await $.ui.mount(m)
    expect(await ui.find({ text: /^ENGINE:/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Englisch: Ring-alt, /disk-Text und Gruppennamen', EN, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  expect(await svgAlt(ui)).toContain('Drive E: 100 GB of 800 GB used')
  await ui.unmount()
  const text = await storage($)
  expect(text.split('\n')[0]).toMatch(/^### Drive E: · 100 GB of 800 GB used \(12\.5%\) #/)
  expect(text).toContain('| Programs & libraries | 50 GB | 50.0% |')
  expect(text).toContain('Scanned 10:00 · 1,234 files')
})
