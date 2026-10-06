// limit-bars: Anzeige anpassbar (SPEC.md, Ausbau v0.6.0): userConfig show*, /bars, Vorrang, alles aus ohne Platz.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { cleanOverrides, displayFromOptions, effectiveDisplay, parseBars } from '../hooks/display.ts'
import { PROBE_SCRIPT, SCAN_SCRIPT } from '../hooks/storage.ts'
import { T } from '../hooks/i18n.ts'

const NOW = new Date(2026, 9, 6, 10, 0, 0).getTime()
const MIN = 60000
const G = 1024 ** 3
const probeOut = `total\t${800 * G}\r\nfree\t${700 * G}\r\n`
const scanOut = ['files\t10', `scanned\t${100 * G}`, `ext\t.dll\t${100 * G}`].join('\r\n')

const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop' | 'vscode', bodyColumns = 120) =>
  ({ plugin: 'limit-bars', component: 'AbovePrompt', requestId: 'above-prompt', props: props(bodyColumns), surface }) as never

const opt = (o: Record<string, unknown> = {}) => ({ options: { language: 'de', ...o } }) as const
const ALL_OFF = { showFiveHour: false, showWeekly: false, showCache: false, showStorage: false }

function world(on: On, o: { saved?: Map<string, unknown>; noLimits?: boolean; inner?: string; denyDisplayWrite?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>([
    // Warmer Cache, damit der Cache-Ring auch im Terminal einen Block hat
    ['cache:sess-1', { lastActivity: NOW - 10 * MIN, ttl: 60, ttlSource: 'gemessen', ctx: 212000, model: 'claude-opus-5-5', savedAt: NOW - 10 * MIN }],
  ])
  const seen = { cols: -1 }
  const runs: string[] = []
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: undefined, window: 1000000 },
      rateLimits: o.noLimits ? [] : [
        { kind: 'five_hour', percentUsed: 41, resetsAt: new Date(NOW + 2 * 3600000).toISOString() },
        { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(NOW + 3 * 86400000).toISOString() },
      ],
    },
  }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    if (o.denyDisplayWrite && e.key === 'display') return { deny: 'Speicher voll' }
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
    runs.push(e.argv[4] === PROBE_SCRIPT ? 'probe' : e.argv[4] === SCAN_SCRIPT ? 'scan' : '?')
    return { value: { exitCode: 0, stdout: e.argv[4] === PROBE_SCRIPT ? probeOut : scanOut, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    seen.cols = (e.props as { bodyColumns?: number }).bodyColumns ?? -1
    // inner: ein Mod weiter innen (wie clawd-buddy) mit eigenem Inhalt
    return o.inner ? { type: 'Text', props: {}, children: [o.inner] } : { type: 'engine', ref: 0 }
  })
  on('session.start', () => ({ cwd: '/work' }))
  return {
    clock,
    saved,
    seen,
    runs,
    async start($: any, surface: 'desktop' | 'terminal' = 'desktop') {
      await $.session.start({ cwd: '/work', surface, isInteractive: true })
      await clock.advance(2000)
      await clock.settle()
    },
  }
}

const bars = async ($: any, args = '') => (await $.command.run({ command: 'bars', args } as never)).text as string
const svg = async (ui: any) => (await ui.find({ type: 'Svg' })) as { props: { alt: string; width: number; height: number } } | undefined

// ---------- reine Logik ----------

test('Einstellungen: Standard wie bisher, onlyFiveHour schaltet die Woche weiter aus', async () => {
  expect(displayFromOptions({})).toEqual({ fiveHour: true, weekly: true, cache: true, storage: true })
  expect(displayFromOptions({ onlyFiveHour: true }).weekly).toBe(false)
  expect(displayFromOptions({ showWeekly: true, onlyFiveHour: true }).weekly).toBe(false)
  expect(displayFromOptions({ showCache: false, showFiveHour: false })).toEqual({ fiveHour: false, weekly: true, cache: false, storage: true })
})

test('Vorrang: ein per /bars gesetzter Wert schlägt die Einstellung; Unsinn im Store zählt nicht', async () => {
  const base = displayFromOptions({ showCache: false })
  expect(effectiveDisplay(base, { cache: true }).cache).toBe(true)
  expect(effectiveDisplay(base, {}).cache).toBe(false)
  expect(cleanOverrides({ cache: 'ja', weekly: false, x: true })).toEqual({ weekly: false })
  expect(cleanOverrides(null)).toEqual({})
})

test('/bars-Argumente: englisch und deutsch, Kurzform ohne show', async () => {
  expect(parseBars('')).toEqual({ kind: 'status' })
  expect(parseBars('reset')).toEqual({ kind: 'reset' })
  expect(parseBars('show 5h off')).toEqual({ kind: 'set', part: 'fiveHour', on: false })
  expect(parseBars('show week on')).toEqual({ kind: 'set', part: 'weekly', on: true })
  expect(parseBars('woche aus')).toEqual({ kind: 'set', part: 'weekly', on: false })
  expect(parseBars('show speicher an')).toEqual({ kind: 'set', part: 'storage', on: true })
  expect(parseBars('Cache OFF')).toEqual({ kind: 'set', part: 'cache', on: false })
  expect(parseBars('show clawd off')).toEqual({ kind: 'bad' })
  expect(parseBars('show cache')).toEqual({ kind: 'bad' })
})

// ---------- Kombinationen, beide Oberflächen ----------

test('Standard (unverändert): Desktop 5h, Woche, Cache-Ring', opt(), async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  const s = await svg(ui)
  expect(s?.props.alt).toContain('5-Stunden-Limit')
  expect(s?.props.alt).toContain('Wochenlimit')
  expect(s?.props.alt).toContain('Cache warm')
  expect(s?.props.width).toBe(242)
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const)
  test(`Alles aus (${surface}): nichts Eigenes, kein freigehaltener Platz, bodyColumns unverändert, kein PowerShell`, opt({ ...ALL_OFF, storagePath: 'E:\\' }), async ($, on) => {
    const w = world(on)
    await w.start($, surface)
    expect(w.runs.length).toBe(0)
    const ui = await $.ui.mount(band(surface, 120))
    expect(await svg(ui)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeUndefined()
    expect(w.seen.cols).toBe(120)
    // Der Takt läuft weiter: ein /bars aus einem anderen Chat kommt binnen 10 s an
    w.saved.set('display', { fiveHour: true })
    await w.clock.advance(10000)
    await ui.redraw()
    if (surface === 'desktop') expect((await svg(ui))?.props.alt).toContain('5-Stunden-Limit')
    else expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
    await ui.unmount()
  })

for (const surface of ['desktop', 'terminal'] as const)
  test(`Alles aus mit Mods weiter innen (${surface}): deren Inhalt kommt unverändert durch, volle Breite, keine Zeile drumherum`, opt(ALL_OFF), async ($, on) => {
    const w = world(on, { inner: 'CLAWD' })
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    const ui = await $.ui.mount(band(surface, 120))
    expect(w.seen.cols).toBe(120)
    expect(await ui.find({ type: 'Text', text: 'CLAWD' })).toBeDefined()
    expect(await ui.find({ type: 'Box' })).toBeUndefined()
    await ui.unmount()
  })

for (const surface of ['desktop', 'terminal'] as const)
  test(`Nur Cache (${surface})`, opt({ showFiveHour: false, showWeekly: false }), async ($, on) => {
    const w = world(on)
    await w.start($, surface)
    const ui = await $.ui.mount(band(surface))
    if (surface === 'desktop') {
      const s = await svg(ui)
      expect(s?.props.alt).toContain('Cache warm')
      expect(s?.props.alt).not.toContain('Limit')
      expect(s?.props.width).toBe(58)
    } else {
      expect(await ui.find({ type: 'Text', text: /^◔ \d+m$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeUndefined()
    }
    await ui.unmount()
  })

for (const surface of ['desktop', 'terminal'] as const)
  test(`Nur Speicher (${surface})`, opt({ showFiveHour: false, showWeekly: false, showCache: false, storagePath: 'E:\\' }), async ($, on) => {
    const w = world(on)
    await w.start($, surface)
    expect(w.runs).toContain('probe')
    const ui = await $.ui.mount(band(surface))
    if (surface === 'desktop') {
      const s = await svg(ui)
      expect(s?.props.alt).toContain('Laufwerk E: 100 GB von 800 GB belegt')
      expect(s?.props.alt).not.toContain('Cache')
      expect(s?.props.width).toBe(70)
    } else {
      expect(await ui.find({ type: 'Text', text: 'Storage 100G/800G' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^◔/ })).toBeUndefined()
    }
    await ui.unmount()
  })

for (const surface of ['desktop', 'terminal'] as const)
  test(`Nur 5h (${surface})`, opt({ showWeekly: false, showCache: false }), async ($, on) => {
    const w = world(on)
    await w.start($, surface)
    const ui = await $.ui.mount(band(surface))
    if (surface === 'desktop') {
      const s = await svg(ui)
      expect(s?.props.alt).toContain('5-Stunden-Limit')
      expect(s?.props.alt).not.toContain('Wochenlimit')
      expect(s?.props.alt).not.toContain('Cache')
      expect(s?.props.height).toBe(24)
    } else {
      expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^◔/ })).toBeUndefined()
    }
    await ui.unmount()
  })

for (const surface of ['desktop', 'terminal'] as const)
  test(`Woche ohne 5h (${surface})`, opt({ showFiveHour: false, showCache: false }), async ($, on) => {
    const w = world(on)
    await w.start($, surface)
    const ui = await $.ui.mount(band(surface))
    if (surface === 'desktop') {
      const s = await svg(ui)
      expect(s?.props.alt).toContain('Wochenlimit')
      expect(s?.props.alt).not.toContain('5-Stunden-Limit')
    } else {
      expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeUndefined()
    }
    await ui.unmount()
  })

test('Platzhalter vor den ersten Limits folgen den Schaltern (Desktop)', opt({ showWeekly: false, showCache: false }), async ($, on) => {
  const w = world(on, { noLimits: true })
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  const s = await svg(ui)
  expect(s?.props.alt).toContain('5-Stunden-Limit')
  expect(s?.props.alt).not.toContain('Wochenlimit')
  await ui.unmount()
})

test('VS Code: kein Band, unverändert', opt(), async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work', surface: 'vscode', isInteractive: true } as never)
  const ui = await $.ui.mount(band('vscode'))
  expect(await svg(ui)).toBeUndefined()
  expect(w.runs.length).toBe(0)
  await ui.unmount()
})

// ---------- /bars ----------

test('/bars: Befehl schlägt Einstellung, gilt sofort; Status zeigt Quelle; reset geht zurück', opt({ showCache: false }), async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  expect((await svg(ui))?.props.alt).not.toContain('Cache')
  const t1 = await bars($, 'show cache on')
  expect(t1).toContain('Cache-Ring: an.')
  expect(t1).toContain('| Cache-Ring | an | /bars |')
  expect(t1).toContain('| 5-Stunden-Balken | an | Einstellung |')
  expect(w.saved.get('display')).toEqual({ cache: true })
  await ui.redraw()
  expect((await svg(ui))?.props.alt).toContain('Cache warm')
  const t2 = await bars($, 'reset')
  expect(t2).toContain(T.de.barsReset)
  expect(t2).toContain('| Cache-Ring | aus | Einstellung |')
  expect(w.saved.has('display')).toBe(false)
  await ui.redraw()
  expect((await svg(ui))?.props.alt).not.toContain('Cache')
  await ui.unmount()
})

test('/bars: Wert aus einem anderen Chat (Store) kommt mit dem nächsten Takt an', opt(), async ($, on) => {
  const w = world(on)
  await w.start($, 'terminal')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeDefined()
  w.saved.set('display', { weekly: false })
  await w.clock.advance(10000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeUndefined()
  await ui.unmount()
})

test('/bars: Cache-Ring aus lässt Rückfrage und Hinweise; /cache antwortet weiter', opt(), async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await bars($, 'cache aus')
  expect(text).toContain(T.de.barsCacheNote)
  expect(w.saved.get('display')).toEqual({ cache: false })
  const cache = (await $.command.run({ command: 'cache', args: '' } as never)).text as string
  expect(cache.length).toBeGreaterThan(0)
  expect((w.saved.get('settings') as { guard?: boolean } | undefined)?.guard).not.toBe(false)
})

test('/bars: Speicher aus → kein PowerShell im Hintergrund; /disk scannt auf Aufruf; wieder an startet den Ring', opt({ showStorage: false, storagePath: 'E:\\' }), async ($, on) => {
  const w = world(on)
  await w.start($)
  const ui = await $.ui.mount(band('desktop'))
  for (let i = 0; i < 60; i++) {
    await w.clock.advance(10000)
    await ui.redraw()
  }
  expect(w.runs.length).toBe(0)
  expect((await svg(ui))?.props.alt).not.toContain('Laufwerk')
  const disk = (await $.command.run({ command: 'disk', args: '' } as never)).text as string
  expect(disk).toContain('100 GB von 800 GB')
  expect(w.runs).toContain('scan')
  await bars($, 'show storage on')
  await ui.redraw()
  await w.clock.advance(2000)
  await w.clock.settle()
  await ui.redraw()
  expect((await svg(ui))?.props.alt).toContain('Laufwerk E: 100 GB von 800 GB belegt')
  await ui.unmount()
})

test('/bars show storage on ohne storagePath: Hinweis, nichts gespeichert', opt(), async ($, on) => {
  const w = world(on)
  await w.start($)
  expect(await bars($, 'show storage on')).toBe(T.de.storageOff)
  expect(w.saved.has('display')).toBe(false)
  expect(await bars($)).toContain('| Speicher-Ring | an, aber ohne `storagePath` | Einstellung |')
})

test('/bars: unbekanntes Argument, Englisch, -p (ohne Oberfläche) antwortet mit Text', opt({ language: 'en' }), async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false } as never)
  expect(await bars($, 'show clawd off')).toContain('Unknown: "show clawd off"')
  const text = await bars($, 'show week off')
  expect(text).toContain('Weekly bar: off.')
  expect(text).toContain('| Weekly bar | off | /bars |')
  expect(w.saved.get('display')).toEqual({ weekly: false })
})

test('Review S1: Start ohne Oberfläche mit gespeichertem /bars-Wert „Speicher aus“ → kein PowerShell, nichts sichtbar', opt({ storagePath: 'E:\\' }), async ($, on) => {
  const w = world(on, { saved: new Map<string, unknown>([['display', { storage: false, fiveHour: false }]]) })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: true } as never)
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(w.runs.length).toBe(0)
  await ui.redraw()
  const s = await svg(ui)
  expect(s?.props.alt).not.toContain('Laufwerk')
  expect(s?.props.alt).not.toContain('5-Stunden-Limit')
  await ui.unmount()
})

test('Review S2: /bars kann nicht speichern → Hinweis, der Wert gilt in diesem Chat weiter (auch nach dem Takt)', opt(), async ($, on) => {
  const w = world(on, { denyDisplayWrite: true })
  await w.start($, 'terminal')
  const ui = await $.ui.mount(band('terminal'))
  const text = await bars($, 'show 7d off')
  expect(text).toContain('Nicht gespeichert')
  await w.clock.advance(10000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
  await ui.unmount()
})

test('Statuszeile: storagePath ohne Laufwerksbuchstaben', opt({ storagePath: '/home/x' }), async ($, on) => {
  world(on)
  expect(await bars($)).toContain('| Speicher-Ring | an, aber `storagePath` ohne Laufwerksbuchstaben | Einstellung |')
})
