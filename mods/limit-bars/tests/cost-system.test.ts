// limit-bars: Kostenring (0.12.0, aus cost-ledger.here) und Systemwerte als Liste (0.13.0, löst die Säulen ab). SPEC → Tests.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { cleanHere, costFilled, costText, costView, shortUsd } from '../hooks/cost.ts'
import { PS_ABS } from '../hooks/storage.ts'
import { NVIDIA_SMI, SYS_SCRIPT, cellText, parseSample, sysTermWidth, sysView, takeLines, termColumns, trendOf } from '../hooks/system.ts'

const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime()
const MIN = 60000
const TICK = 2000
const DE = { options: { language: 'de' } } as const

const HERE = { chatUsd: 0.4, projectUsd: 887.2, project: 'ClaudeMods', since: '2026-10-06', devices: 2 }
const LINE = (cpu: number, ram: number, gpu?: number, vram?: number) =>
  `cpu\t${cpu * 10}\tram\t${ram * 10}${gpu === undefined ? '' : `\tgpu\t${gpu * 10}\tvram\t${vram! * 10}`}\r\n`

const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({ plugin: 'limit-bars', component: 'AbovePrompt', requestId: 'above-prompt', props: props(bodyColumns), surface }) as never

type W = { saved?: Map<string, unknown>; cwd?: string; here?: unknown; denyState?: boolean; denySpawn?: boolean }

/**
 * Welt mit Limits, warmem Cache, gestubbtem `cost-ledger.here` und einem Messprozess als Generator-Stub: `say` schickt eine Zeile,
 * `end(code)` beendet ihn. Der Stub nimmt nur die feste Befehlszeile an (SPEC Tests).
 */
function world(on: On, o: W = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>([
    ['cache:sess-1', { lastActivity: NOW - 10 * MIN, ttl: 60, ttlSource: 'gemessen', ctx: 212000, model: 'claude-opus-5-5', savedAt: NOW - 10 * MIN }],
  ])
  const st = { here: o.here, stateReads: 0, invalidates: 0, widths: [] as number[], sid: 'sess-1' }
  on('session.id', () => ({ value: st.sid }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: undefined, window: 1000000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 41, resetsAt: new Date(NOW + 2 * 3600000).toISOString() },
        { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(NOW + 3 * 86400000).toISOString() },
      ],
    },
  }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('state.get', ($, e) => {
    const x = e as unknown as { plugin: string; key: string }
    if (x.plugin === 'cost-ledger' && x.key === 'here') {
      st.stateReads++
      if (o.denyState) return { deny: 'nein' } as never
      return { value: { value: st.here, version: st.here === undefined ? 0 : 1 } } as never
    }
    return { value: { value: undefined, version: 0 } } as never
  })
  on('state.set', ($, e) => {
    const x = e as unknown as { plugin: string; value: { width: number } | null }
    if (x.plugin === 'limit-bars' && x.value) st.widths.push(x.value.width)
    return { value: { isSet: true, version: 1 } } as never
  })
  // Messprozess: liefert, was der Test schickt
  const h = { spawns: 0, refused: 0, open: 0, queue: [] as string[], wake: [] as (() => void)[], ending: null as number | null }
  on('process.spawn', async function* ($: unknown, e: any) {
    const argv = e.argv as readonly string[]
    const ok = argv.length === 5 && argv[0] === PS_ABS && argv[1] === '-NoProfile' && argv[2] === '-NonInteractive' && argv[3] === '-Command' && argv[4] === SYS_SCRIPT && !e.env
    if (!ok) {
      h.refused++
      return { deny: 'nicht erlaubt' }
    }
    h.spawns++
    if (o.denySpawn) return { deny: 'Richtlinie verbietet Prozesse' }
    h.open++
    try {
      while (true) {
        while (!h.queue.length && h.ending === null) await new Promise<void>((r) => h.wake.push(r))
        if (!h.queue.length) {
          const code = h.ending!
          h.ending = null
          return { value: { code, signal: null } }
        }
        yield { stream: 'stdout' as const, text: h.queue.shift()! }
      }
    } finally {
      h.open--
    }
  } as never)
  const wake = () => h.wake.splice(0).forEach((r) => r())
  on('ui.invalidate', async ($, e, next) => {
    st.invalidates++
    return next(e)
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
  on('session.start', () => ({ cwd: o.cwd ?? 'E:\\work' }))
  return {
    clock,
    saved,
    st,
    h,
    async say(text: string) {
      h.queue.push(text)
      wake()
      await settle(clock)
    },
    async end(code: number) {
      h.ending = code
      wake()
      await settle(clock)
    },
    async start($: any, surface: 'desktop' | 'terminal' = 'desktop') {
      await $.session.start({ cwd: o.cwd ?? 'E:\\work', surface, isInteractive: true })
      await clock.advance(TICK)
      await clock.settle()
    },
  }
}

async function settle(clock: { settle: () => Promise<void> }) {
  for (let i = 0; i < 50; i++) await Promise.resolve()
  await clock.settle()
}
async function clock2(w: { clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> } }) {
  await w.clock.advance(TICK)
  await settle(w.clock)
}

const bars = async ($: any, args = '') => (await $.command.run({ command: 'bars', args } as never)).text as string
const svgOf = async (ui: any) => (await ui.find({ type: 'Svg' })) as { props: { source: string; alt: string; width: number; height: number } } | undefined

// ---------- reine Logik: Kosten ----------

test('0.12.0 cost.ts: Wert prüfen, Kurzform der Beträge, Anteil mit Mindestbogen, ehrliche Beschriftung', () => {
  expect(cleanHere(HERE)).toEqual(HERE)
  expect(cleanHere(null)).toBeNull()
  expect(cleanHere(undefined)).toBeNull()
  expect(cleanHere({ ...HERE, chatUsd: -1 })).toBeNull()
  expect(cleanHere({ ...HERE, since: 'gestern' })).toBeNull()
  expect(cleanHere({ ...HERE, projectUsd: null, project: null })).toMatchObject({ projectUsd: null, project: null })
  expect(shortUsd(0.4, 'de')).toBe('0,40$')
  expect(shortUsd(0.4, 'en')).toBe('$0.40')
  expect(shortUsd(14.2, 'de')).toBe('14$')
  expect(shortUsd(887.2, 'de')).toBe('887$')
  expect(shortUsd(1204, 'de')).toBe('1,2k$')
  expect(shortUsd(1204, 'en')).toBe('$1.2k')
  expect(shortUsd(12345, 'de')).toBe('12k$')
  // Fünfstellig im schlimmsten Fall (Ausbau 0.13.0, 1.)
  expect(shortUsd(99_999, 'de')).toBe('100k$')
  const v = costView(HERE, 'de')
  expect(v).toMatchObject({ label: 'Kosten', main: '0,40$', sub: '/887$', grey: false })
  expect(costFilled(v, HERE.chatUsd)).toBe(1)
  expect(costFilled(costView({ ...HERE, chatUsd: 443.6 }, 'de'), 443.6)).toBe(14)
  expect(costFilled(costView({ ...HERE, chatUsd: 0 }, 'de'), 0)).toBe(0)
  const u = costView({ ...HERE, projectUsd: null, project: null }, 'de')
  expect(u).toMatchObject({ grey: true, sub: '–', main: '0,40$' })
  expect(costFilled(u, 0.4)).toBe(0)
  expect(costText(HERE, 'de')).toBe('API-Wert: dieser Chat 0,40 $ von 887,20 $ für Projekt ClaudeMods seit 06.10.2026 (2 Geräte)')
  expect(costText({ ...HERE, devices: 1 }, 'en')).toBe('API value: this chat $0.40 of $887.20 for project ClaudeMods since Oct 6, 2026')
  expect(costText({ ...HERE, projectUsd: null }, 'de')).toBe('API-Wert: dieser Chat 0,40 $, Projekt unbekannt')
})

// ---------- reine Logik: Systemwerte ----------

test('0.13.0 system.ts: festes Skript ohne doppelte Anführungszeichen und Umgebung; Promille-Zeilen, auch zerteilt oder zusammengeklebt', () => {
  expect(SYS_SCRIPT.includes('"')).toBe(false)
  expect(SYS_SCRIPT.includes('$env:')).toBe(false)
  expect(SYS_SCRIPT).toMatch(/Win32_PerfRawData_PerfOS_Processor/)
  expect(SYS_SCRIPT).toMatch(/Win32_PerfRawData_PerfOS_Memory/)
  expect(SYS_SCRIPT.includes(NVIDIA_SMI)).toBe(true)
  // Fix 0.13.2: GPU-Last aus den Rohzählern wie der Task-Manager, nvidia-smi nur noch für den Grafikspeicher
  expect(SYS_SCRIPT).toMatch(/Win32_PerfRawData_GPUPerformanceCounters_GPUEngine -Filter 'RunningTime > 0' -Property Name,RunningTime,Timestamp_Sys100NS/)
  // Summe je physischer Engine (ab `luid_`, ohne Prozess), Maximum darüber; nicht je Typ (Review 0.13.2 S1)
  expect(SYS_SCRIPT).toMatch(/-split '_luid_'/)
  expect(SYS_SCRIPT.includes("-split 'engtype_'")).toBe(false)
  // Ohne gepaarte Instanz keine GPU-Zeile statt dauerhaft 0 % (Review 0.13.2 K1)
  expect(SYS_SCRIPT.includes('if($s.Count -gt 0)')).toBe(true)
  expect(SYS_SCRIPT.includes('utilization.gpu')).toBe(false)
  expect(SYS_SCRIPT).toMatch(/--query-gpu=memory\.used,memory\.total/)
  // [math]::Min mit 1.0: mit einer ganzen 1 wählte PowerShell Min(Int32, Int32) und rundete 0,73 auf 1 (Gegenprobe 2026-11-05)
  expect(SYS_SCRIPT.includes('[math]::Min(1.0,$q)')).toBe(true)
  expect(SYS_SCRIPT.includes('[math]::Min(1,')).toBe(false)
  expect(SYS_SCRIPT.includes('Get-Counter')).toBe(false)
  expect(parseSample('cpu\t340\tram\t612\tgpu\t60\tvram\t569', NOW)).toEqual({ at: NOW, cpu: 34, ram: 61.2, gpu: 6, vram: 56.9 })
  expect(parseSample('cpu\t1100\tram\t-3', NOW)).toEqual({ at: NOW, cpu: 100, ram: 0 })
  // GPU-Last ohne nvidia-smi (AMD, Intel): Last ja, Grafikspeicher nein
  expect(parseSample('cpu\t340\tram\t612\tgpu\t745', NOW)).toEqual({ at: NOW, cpu: 34, ram: 61.2, gpu: 74.5 })
  expect(parseSample('cpu\t34,5\tram\t600', NOW)).toBeUndefined()
  expect(parseSample('ram\t600', NOW)).toBeUndefined()
  let r = takeLines('', 'cpu\t1\tram')
  expect(r).toEqual({ lines: [], rest: 'cpu\t1\tram' })
  r = takeLines(r.rest, '\t2\r\ncpu\t3\tram\t4\r\ncpu')
  expect(r).toEqual({ lines: ['cpu\t1\tram\t2', 'cpu\t3\tram\t4'], rest: 'cpu' })
})

test('0.13.0 system.ts: Trend ab 2 Punkten, ohne GPU zwei Zeilen, alte Messung „–“, Zahlen auf einer Höhe', () => {
  expect([trendOf(undefined, 50), trendOf(50, 51.9), trendOf(50, 52), trendOf(50, 48), trendOf(50, 48.5)]).toEqual(['', '', 'up', 'down', ''])
  const prev = parseSample('cpu\t300\tram\t620\tgpu\t60\tvram\t569', NOW - 1000)
  const cur = parseSample('cpu\t340\tram\t612\tgpu\t60\tvram\t600', NOW)!
  const v = sysView(cur, prev, NOW, 'de')
  expect(v.rows).toEqual([
    { tag: 'CPU', pct: 34, trend: 'up' },
    { tag: 'RAM', pct: 61, trend: '' },
    { tag: 'GPU', pct: 6, trend: '' },
    { tag: 'VRAM', pct: 60, trend: 'up' },
  ])
  expect(v.alt).toBe('CPU 34 %; RAM 61 %; GPU 6 %; VRAM 60 %')
  expect(sysView(parseSample('cpu\t50\tram\t20', NOW), undefined, NOW, 'en').rows.map((r) => r.tag)).toEqual(['CPU', 'RAM'])
  expect(sysView(parseSample('cpu\t50\tram\t20\tgpu\t745', NOW), undefined, NOW, 'en').rows.map((r) => r.tag)).toEqual(['CPU', 'RAM', 'GPU'])
  // VRAM ohne GPU-Last (Zählerklasse fehlt, nvidia-smi da): RAM über VRAM, CPU allein
  const vOnly = sysView(parseSample('cpu\t50\tram\t20\tvram\t690', NOW), undefined, NOW, 'en')
  expect(vOnly.rows.map((r) => r.tag)).toEqual(['CPU', 'RAM', 'VRAM'])
  expect(termColumns(vOnly).map((c) => c.map((x) => x.tag))).toEqual([['CPU'], ['RAM', 'VRAM']])
  expect(sysView(cur, prev, NOW + 11000, 'de').rows).toEqual([
    { tag: 'CPU', pct: null, trend: '' },
    { tag: 'RAM', pct: null, trend: '' },
  ])
  // Terminal: jede Zelle 10 Zeichen, die Zahl endet immer an derselben Stelle
  const cells = v.rows.map((x) => cellText(x))
  expect(cells.map((c) => (c.tag + c.value + c.arrow).length)).toEqual([10, 10, 10, 10])
  expect(cells.map((c) => (c.tag + c.value).length)).toEqual([9, 9, 9, 9])
  expect(cells.map((c) => c.tag + c.value + c.arrow)).toEqual(['CPU   34%▲', 'RAM   61% ', 'GPU    6% ', 'VRAM  60%▲'])
  expect(cellText({ tag: 'CPU', pct: 100, trend: 'down' }).value + '▼').toBe(' 100%▼')
  expect(termColumns(v).map((c) => c.map((x) => x.tag))).toEqual([['CPU', 'GPU'], ['RAM', 'VRAM']])
  expect(sysTermWidth(v)).toBe(22)
})

// ---------- Kostenring im Band ----------

test('0.12.0/0.13.0 Kostenring Desktop: Reihenfolge Limits · Cache · Kosten, Mitte grau wie Storage, unten Projekt, alt ehrlich, Breite gemeldet', DE, async ($, on) => {
  const w = world(on, { here: HERE })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  const pic = (await svgOf(ui))!
  const src = pic.props.source
  expect(src).toMatch(/>Kosten</)
  expect(src).toMatch(/fill="#9A9A9A">0,40\$</)
  expect(src).toMatch(/>\/887\$</)
  expect(src.indexOf('>Cache<') < src.indexOf('>Kosten<')).toBe(true)
  expect(pic.props.alt).toMatch(/API-Wert: dieser Chat 0,40 \$ von 887,20 \$ für Projekt ClaudeMods seit 06\.10\.2026 \(2 Geräte\)$/)
  expect(Number.isInteger(pic.props.width) && pic.props.height === 56).toBe(true)
  expect((src.match(/stroke="#D77757"/g) ?? []).length).toBe(1)
  expect(w.st.stateReads > 0).toBe(true)
  await clock2(w)
  expect(w.st.widths.at(-1)).toBe(pic.props.width)
  await ui.unmount()
})

test('0.12.0 Kostenring: ohne Wert (cost-ledger fehlt, null) kein Ring und kein freier Platz; Projekt unbekannt grau mit „–“', DE, async ($, on) => {
  const w = world(on, { here: undefined })
  await w.start($)
  let ui = await $.ui.mount(band('desktop'))
  const without = (await svgOf(ui))!.props
  expect(without.source.includes('Kosten')).toBe(false)
  await ui.unmount()
  w.st.here = null
  ui = await $.ui.mount(band('desktop'))
  expect((await svgOf(ui))!.props.width).toBe(without.width)
  await ui.unmount()
  w.st.here = { ...HERE, projectUsd: null, project: null }
  ui = await $.ui.mount(band('desktop'))
  const grey = (await svgOf(ui))!.props
  expect(grey.source).toMatch(/>Kosten</)
  expect(grey.source).toMatch(/>–</)
  expect(grey.source.includes('stroke="#D77757"')).toBe(false)
  expect(grey.width > without.width).toBe(true)
  await ui.unmount()
})

const costPartner = {
  name: 'cost-ledger',
  register(on: On) {
    on('command.run', { command: 'costset' }, async ($, e) => {
      await $.state.set({ plugin: 'cost-ledger', key: 'here' } as never, JSON.parse(e.args) as never)
      return { text: 'ok' }
    })
  },
}

test('0.12.0 Kostenring: ein Schreiben von cost-ledger zeichnet neu, ohne eigenen Takt', { plugins: [costPartner], ...DE }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: undefined, window: 1000000 }, rateLimits: [] } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
  const ui = await $.ui.mount(band('desktop'))
  expect((await svgOf(ui))!.props.source.includes('Kosten')).toBe(false)
  await $.command.run({ command: 'costset', args: JSON.stringify(HERE) } as never)
  await ui.drawn()
  expect((await svgOf(ui))!.props.source).toMatch(/>0,40\$</)
  // Projekt fünfstellig: passt kurz in den Ring
  await $.command.run({ command: 'costset', args: JSON.stringify({ ...HERE, chatUsd: 14.2, projectUsd: 54_321 }) } as never)
  await ui.drawn()
  const src = (await svgOf(ui))!.props.source
  expect(src).toMatch(/>14\$</)
  expect(src).toMatch(/>\/54k\$</)
  await ui.unmount()
})

test('0.12.0 Kostenring: /bars show cost off blendet ihn aus und liest nichts mehr; /bars nennt den Stand', DE, async ($, on) => {
  const w = world(on, { here: HERE })
  await w.start($)
  const text = await bars($)
  expect(text).toMatch(/\| Kosten-Ring \| an \| Einstellung \|/)
  expect(text).toMatch(/Kosten-Ring: API-Wert: dieser Chat 0,40 \$ von 887,20 \$ für Projekt ClaudeMods seit 06\.10\.2026 \(2 Geräte\)\. Im Abo/)
  expect(await bars($, 'kosten off')).toMatch(/Kosten-Ring: aus\./)
  const reads = w.st.stateReads
  const ui = await $.ui.mount(band('desktop'))
  expect((await svgOf(ui))!.props.source.includes('Kosten')).toBe(false)
  await clock2(w)
  expect(w.st.stateReads).toBe(reads)
  await ui.unmount()
  w.st.here = null
  await bars($, 'cost on')
  expect(await bars($)).toMatch(/\| Kosten-Ring \| an, wartet auf cost-ledger \| \/bars \|/)
})

test('0.12.0 Kostenring: ein Tick ohne Änderung (gleicher Cent-Betrag) zeichnet nicht neu', DE, async ($, on) => {
  const w = world(on, { here: HERE })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  const i0 = w.st.invalidates
  w.st.here = { ...HERE, chatUsd: 0.401 }
  await clock2(w)
  await clock2(w)
  expect(w.st.invalidates).toBe(i0)
  w.st.here = { ...HERE, chatUsd: 1.5 }
  await clock2(w)
  expect(w.st.invalidates).toBe(i0 + 1)
  await ui.unmount()
})

test('0.12.0 Fehlerpfad: $.state.get abgelehnt → kein Kostenring, kein Wurf, Balken bleiben', DE, async ($, on) => {
  const w = world(on, { here: HERE, denyState: true })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  const src = (await svgOf(ui))!.props.source
  expect(src.includes('Kosten')).toBe(false)
  expect(src).toMatch(/>5h</)
  expect(w.st.stateReads > 0).toBe(true)
  expect(await bars($)).toMatch(/\| Kosten-Ring \| an, wartet auf cost-ledger \|/)
  await ui.unmount()
})

// ---------- Systemwerte ----------

test('0.13.0 Systemwerte: Standard aus, kein Prozess; an unter Windows: ein Prozess, jede Zeile eine Messung, vier Zeilen untereinander', { options: { language: 'de' } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  let ui = await $.ui.mount(band('desktop'))
  for (let i = 0; i < 5; i++) await clock2(w)
  expect(w.h.spawns).toBe(0)
  await ui.unmount()
  expect(await bars($, 'show cpu on')).toMatch(/Systemwerte: an\./)
  ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  await clock2(w)
  expect([w.h.spawns, w.h.open, w.h.refused]).toEqual([1, 1, 0])
  await w.say(LINE(30, 62, 6, 56.9))
  await w.say(LINE(34, 61.2, 6, 60))
  await ui.drawn()
  const src = (await svgOf(ui))!.props.source
  // Kürzel orange untereinander, Prozent rechtsbündig an derselben x-Stelle, Pfeil grau dahinter
  const tags = [...src.matchAll(/fill="#D77757">(CPU|RAM|GPU|VRAM)<\/text>/g)].map((m) => m[1])
  expect(tags).toEqual(['CPU', 'RAM', 'GPU', 'VRAM'])
  const vals = [...src.matchAll(/<text x="([\d.]+)" y="(\d+)" text-anchor="end"[^>]*fill="(#[0-9A-F]{6})">(\d+%)<\/text>/g)]
  expect(vals.map((m) => m[4])).toEqual(['34%', '61%', '6%', '60%'])
  expect(new Set(vals.map((m) => m[1])).size).toBe(1)
  expect(vals.map((m) => Number(m[2]))).toEqual([11, 25, 39, 53]) // 4 × 14 px, unten bündig mit den Ringen (56)
  expect(vals.map((m) => m[3])).toEqual(['#6CC070', '#F2C94C', '#6CC070', '#F2C94C'])
  expect((src.match(/>▲</g) ?? []).length).toBe(2) // CPU 30 → 34, VRAM 56,9 → 60
  expect(src.indexOf('>Kosten<') < 0 && src.indexOf('>Cache<') < src.indexOf('>CPU<')).toBe(true)
  // Säulen gibt es nicht mehr
  expect(src.includes('opacity="0.4"')).toBe(false)
  await ui.unmount()
  expect(await bars($)).toMatch(/Systemwerte: CPU 34% · RAM 61% · GPU 6% · VRAM 60% \(jede Sekunde gemessen, zuletzt 10:0\d\)/)
})

test('0.13.0 Systemwerte: ohne NVIDIA nur CPU und RAM; jede Messung zeichnet sofort, gleiche Prozentzahl nicht', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  await w.say(LINE(20, 40))
  await ui.drawn()
  let src = (await svgOf(ui))!.props.source
  expect([...src.matchAll(/>(CPU|RAM|GPU|VRAM)<\/text>/g)].map((m) => m[1])).toEqual(['CPU', 'RAM'])
  expect(src).toMatch(/y="39"[^>]*>CPU</) // 2 Zeilen unten bündig
  const i0 = w.st.invalidates
  await w.say(LINE(20.3, 40.1)) // gerundet gleich
  expect(w.st.invalidates).toBe(i0)
  await w.say(LINE(25, 40))
  expect(w.st.invalidates).toBe(i0 + 1)
  await ui.drawn()
  src = (await svgOf(ui))!.props.source
  expect(src).toMatch(/>25%</)
  await ui.unmount()
})

test('0.13.0 Systemwerte: endet bei /bars show cpu off und wenn nicht mehr gezeichnet wird; das nächste Zeichnen startet neu', { timeoutMs: 20000, options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  let ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  expect(w.h.open).toBe(1)
  expect(await bars($, 'system off')).toMatch(/Systemwerte: aus\./)
  await settle(w.clock)
  await w.say(LINE(1, 1)) // weckt den Stub, damit die Schleife das Ende sieht
  expect(w.h.open).toBe(0)
  await bars($, 'ram on')
  await clock2(w)
  expect([w.h.spawns, w.h.open]).toEqual([2, 1])
  // Band nicht mehr gezeichnet: der Takt endet, und mit ihm der Prozess
  await ui.unmount()
  await w.say(LINE(50, 50)) // fordert ein Neuzeichnen an, das nicht kommt
  // Der Takt bemerkt es und beendet den Prozess (return() auf den Strom). Der Stub sieht das erst, wenn er wieder liefert;
  // bis dahin wartet die Uhr des Test-Kits, deshalb die nächste Zeile, während sie läuft
  const ticks = (async () => {
    for (let i = 0; i < 3; i++) await w.clock.advance(TICK)
  })()
  await new Promise((r) => setTimeout(r, 300)) // echte Zeit: die Ticks laufen bis zum wartenden Stub
  await w.say(LINE(51, 50))
  await ticks
  await settle(w.clock)
  expect(w.h.open).toBe(0)
  ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  expect([w.h.spawns, w.h.open]).toEqual([3, 1])
  await ui.unmount()
})

test('0.13.0 Systemwerte: Fehlstart (Ende ohne Messung) erst nach 60 s erneut, drei in Folge → 1 h Pause; /bars nennt beides', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  expect(w.h.spawns).toBe(1)
  await w.end(1)
  for (let i = 0; i < 20; i++) await clock2(w) // 40 s: noch kein neuer Start
  expect(w.h.spawns).toBe(1)
  for (let i = 0; i < 12; i++) await clock2(w)
  expect(w.h.spawns).toBe(2)
  await w.end(1)
  for (let i = 0; i < 32; i++) await clock2(w)
  expect(w.h.spawns).toBe(3)
  await w.end(1)
  for (let i = 0; i < 60; i++) await clock2(w)
  expect(w.h.spawns).toBe(3)
  const text = await bars($)
  expect(text).toMatch(/Systemwerte: pausiert bis \d\d:\d\d nach drei Fehlstarts in Folge\./)
  expect(text).toMatch(/Systemwerte: Messprozess um \d\d:\d\d gescheitert: exit 1/)
  await ui.unmount()
})

test('0.13.0 Systemwerte: abgelehntes $.process.spawn → kein Wurf, Band bleibt, Zeilen mit „–“, Fehler in /bars', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on, { denySpawn: true })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  expect(w.h.spawns).toBe(1)
  const src = (await svgOf(ui))!.props.source
  expect(src).toMatch(/>5h</)
  expect(src).toMatch(/text-anchor="end"[^>]*>–<\/text>/)
  expect(await bars($)).toMatch(/Systemwerte: Messprozess um \d\d:\d\d gescheitert: .*Richtlinie verbietet Prozesse/)
  await ui.unmount()
})

test('0.13.0 Systemwerte: außerhalb von Windows nie ein Prozess; /bars show cpu on sagt das und speichert nichts', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on, { cwd: '/home/fynn/work' })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  for (let i = 0; i < 10; i++) await clock2(w)
  expect(w.h.spawns + w.h.refused).toBe(0)
  expect((await svgOf(ui))!.props.source.includes('>CPU<')).toBe(false)
  await ui.unmount()
  expect(await bars($, 'cpu on')).toBe('Die Systemwerte (CPU, RAM, GPU) gehen vorerst nur unter Windows.')
  expect(await bars($)).toMatch(/\| Systemwerte \| an, nur unter Windows \| Einstellung \|/)
})

// ---------- Terminal ----------

// Alles zusammen höchstens 44 Spalten (Fynn 2026-11-04): Clawd außen gibt dem Grund fest 44
for (const [cols, want] of [
  [120, ['cache', 'cost']], // 44 frei: ◔ 52m (5) + Kosten (17) + Systemwerte (22) + Fugen = 50 → die Systemwerte fallen zuerst weg
  [76, ['cache', 'cost']], // 36 frei: die Systemwerte fallen zuerst weg
  [62, ['cache']], // 22 frei: dann die Kosten
  [50, []], // 10 frei: nichts
] as const)
  test(`0.13.0 Terminal bei ${cols} Spalten ohne Limits: Reihenfolge und Wegfallen (System, dann Kosten, dann Cache)`, { options: { language: 'de', showSystem: true, showFiveHour: false, showWeekly: false } }, async ($, on) => {
    const w = world(on, { here: HERE })
    await w.start($, 'terminal')
    const ui = await $.ui.mount(band('terminal', cols))
    await clock2(w)
    await w.say(LINE(34, 61))
    await ui.drawn()
    const has = async (re: RegExp) => !!(await ui.find({ type: 'Text', text: re }))
    const found: string[] = []
    if (await has(/^◔ /)) found.push('cache')
    if (await has(/^Kosten 0,40\$\/887\$$/)) found.push('cost')
    if (await has(/^CPU $/)) found.push('CPU')
    if (await has(/^RAM $/)) found.push('RAM')
    expect(found).toEqual([...want])
    if (want.includes('CPU')) {
      expect((await ui.find({ type: 'Text', text: '  34%' }))?.props.color).toBe('#6CC070')
      expect(((await ui.find({ key: 'limit-bars' })) as any).props.width <= 44).toBe(true)
    }
    await ui.unmount()
  })

test('0.13.0 Terminal mit GPU: zwei Spalten (CPU über GPU, RAM über VRAM), Zahlen an derselben Stelle', { options: { language: 'de', showSystem: true, showFiveHour: false, showWeekly: false, showCache: false, showCost: false } }, async ($, on) => {
  const w = world(on)
  await w.start($, 'terminal')
  const ui = await $.ui.mount(band('terminal', 120))
  await clock2(w)
  await w.say(LINE(34, 61, 6, 57))
  await ui.drawn()
  const col0 = (await ui.find({ key: 'sys-0' })) as any
  const col1 = (await ui.find({ key: 'sys-1' })) as any
  const flat = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(flat).join(''))
  expect(col0.children.map(flat)).toEqual(['CPU   34% ', 'GPU    6% '])
  expect(col1.children.map(flat)).toEqual(['RAM   61% ', 'VRAM  57% '])
  await ui.unmount()
})

test('0.12.0 Terminal bei 120 Spalten mit beiden Limits: kein Platz für Zusätze, die Box bleibt bei 44', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on, { here: HERE })
  await w.start($, 'terminal')
  const ui = await $.ui.mount(band('terminal', 120))
  await clock2(w)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^Kosten / })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^CPU $/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
  // Die Liste passt nicht: dann auch kein Messprozess (Review 0.13.0 S2)
  for (let i = 0; i < 3; i++) await clock2(w)
  expect(w.h.spawns).toBe(0)
  expect(((await ui.find({ key: 'limit-bars' })) as any).props.width <= 44).toBe(true)
  await ui.unmount()
})

test('0.13.0 Breitenmeldung: Systemwerte und Kosten an und aus ändern limit-bars.band; nach /clear neu gemeldet', { options: { language: 'de' } }, async ($, on) => {
  const w = world(on, { here: HERE })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  const withCost = w.st.widths.at(-1)!
  await bars($, 'cpu on')
  await clock2(w)
  const withSys = w.st.widths.at(-1)!
  expect(withSys > withCost && withSys - withCost < 90).toBe(true) // schmale Liste statt 124 px Säulen
  await bars($, 'cost off')
  await clock2(w)
  expect(w.st.widths.at(-1)).toBe(withSys - 8 - 52)
  const n = w.st.widths.length
  w.st.sid = 'sess-2'
  await clock2(w)
  expect(w.st.widths.length).toBe(n + 1)
  await ui.unmount()
})

test('0.13.0 Englisch: Kostenring „Cost“, Systemwerte „System values“, /bars help nennt beide Teile', { options: { language: 'en', showSystem: true } }, async ($, on) => {
  const w = world(on, { here: HERE })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  const src = (await svgOf(ui))!.props.source
  expect(src).toMatch(/>Cost</)
  expect(src).toMatch(/>\$0\.40</)
  expect(src).toMatch(/>\/\$887</)
  await ui.unmount()
  const help = await bars($, 'help')
  expect(help).toMatch(/Cost ring ● on · by setting \(\/bars cost off\)/)
  expect(help).toMatch(/System values ● on · by setting \(\/bars cpu off\)/)
  expect(help).toMatch(/`\/bars show 5h\|week\|cache\|storage\|cost\|cpu on\|off`/)
})

test('0.13.0 Systemwerte: gleichbleibende Werte zeichnen nicht neu, der Prozess läuft trotzdem weiter (Review S1)', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  await w.say(LINE(20, 40))
  await ui.drawn()
  for (let i = 0; i < 12; i++) {
    await w.clock.advance(TICK)
    await w.say(LINE(20, 40)) // jede Sekunde dieselben Werte, kein Neuzeichnen
  }
  expect([w.h.spawns, w.h.open]).toEqual([1, 1])
  await ui.unmount()
})

test('0.13.0 Systemwerte: reguläres Ende nach Messungen (30-Minuten-Deckel) → im nächsten Takt neu, kein Fehler, keine Sperre', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  await w.say(LINE(20, 40))
  await w.end(0)
  await clock2(w)
  expect(w.h.spawns).toBe(2)
  const text = await bars($)
  expect(text.includes('gescheitert')).toBe(false)
  expect(text.includes('pausiert')).toBe(false)
  await ui.unmount()
})

test('0.13.2 Systemwerte: ohne NVIDIA (nur GPU-Last aus den Windows-Zählern) drei Zeilen, VRAM fehlt; Terminal CPU über GPU', { options: { language: 'de', showSystem: true, showFiveHour: false, showWeekly: false, showCache: false, showCost: false } }, async ($, on) => {
  const w = world(on)
  await w.start($, 'terminal')
  const ui = await $.ui.mount(band('terminal', 120))
  await clock2(w)
  await w.say('cpu\t340\tram\t610\tgpu\t745\r\n')
  await ui.drawn()
  const flat = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(flat).join(''))
  expect(((await ui.find({ key: 'sys-0' })) as any).children.map(flat)).toEqual(['CPU   34% ', 'GPU   75% '])
  expect(((await ui.find({ key: 'sys-1' })) as any).children.map(flat)).toEqual(['RAM   61% ', ' '])
  await ui.unmount()
})

test('0.13.2 Systemwerte Desktop: drei Zeilen (GPU ohne VRAM) unten bündig, Zahlen an einer x-Stelle', { options: { language: 'de', showSystem: true } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  await clock2(w)
  await w.say('cpu\t340\tram\t610\tgpu\t745\r\n')
  await ui.drawn()
  const src = (await svgOf(ui))!.props.source
  expect([...src.matchAll(/fill="#D77757">(CPU|RAM|GPU|VRAM)<\/text>/g)].map((m) => m[1])).toEqual(['CPU', 'RAM', 'GPU'])
  const vals = [...src.matchAll(/<text x="([\d.]+)" y="(\d+)" text-anchor="end"[^>]*>(\d+%)<\/text>/g)]
  expect(vals.map((m) => m[3])).toEqual(['34%', '61%', '75%'])
  expect(new Set(vals.map((m) => m[1])).size).toBe(1)
  expect(vals.map((m) => Number(m[2]))).toEqual([25, 39, 53])
  await ui.unmount()
})
