import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Feste lokale Zeit: Freitag, 2. Oktober 2026, 10:00 (lokal, damit Uhrzeit-Texte nicht von der Zeitzone abhängen)
const NOW = new Date(2026, 9, 2, 10, 0, 0).getTime()
const MIN = 60000
const FIVE_RESET = NOW + (2 * 60 + 14) * MIN + 30000 // "in 2 h 14 min"
const WEEK_RESET = new Date(2026, 9, 5, 9, 0, 0).getTime() // Montag 09:00
const iso = (ms: number) => new Date(ms).toISOString()

// Die bisherigen Tests prüfen die deutschen Texte (Fynns Einstellung); Englisch: tests/i18n.test.ts
const DE = { options: { language: 'de' } } as const

const GREEN = '#6CC070'
const YELLOW = '#F2C94C'
const RED = '#C9594B'

const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({ plugin: 'limit-bars', component: 'AbovePrompt', requestId: 'above-prompt', props: props(bodyColumns), surface }) as const

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
const limits = (five: number, week: number): Limit[] => [
  { kind: 'five_hour', percentUsed: five, resetsAt: iso(FIVE_RESET) },
  { kind: 'seven_day', percentUsed: week, resetsAt: iso(WEEK_RESET) },
]

// Grundausstattung: Uhr, Messung als Stub, ein Mod weiter innen, der Text zeichnet und die Breite meldet
function world(on: On, opts: { inner?: boolean; layered?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const seen = { bodyColumns: -1, renders: 0 }
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ deny: 'kein Anfangsstand im Test' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    seen.bodyColumns = e.props.bodyColumns
    seen.renders += 1
    // inner: false spielt den Kern ohne weitere Mods: sein eigener Knoten, der im Band nichts zeichnet (types@2.1.288:9033-9041)
    if (opts.inner === false) return { type: 'engine', ref: 0 }
    const text = { type: 'Text', props: {}, children: ['von anderen'] }
    // layered: weiter innen liegt quick-replies und hat seine Pille als Ebene über den Grund gesetzt (band.ts, docs/BAND.md)
    if (opts.layered) return LAYERED(text)
    return text
  })
  return { clock, seen }
}

const LAYERED = (ground: unknown) => ({
  type: 'Box',
  props: { key: 'band', flexDirection: 'column', justifyContent: 'flex-end' },
  children: [
    { type: 'Box', props: { key: 'layer:20:quick-replies', flexDirection: 'column', flexShrink: 0 }, children: [{ type: 'Box', props: { key: 'quick-replies' }, children: ['Pille'] }] },
    { type: 'Box', props: { key: 'band-base', flexDirection: 'row', alignItems: 'flex-end' }, children: [{ type: 'Box', props: { flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end' }, children: [ground] }] },
  ],
}) as never

async function measure($: Engine, rateLimits: Limit[]) {
  await $.session.measure({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits, changed: ['rateLimits'] })
}

test('ohne Messung: keine Balken, fremder Text bleibt, bodyColumns unverändert; Desktop zeigt nur den Ring (unbekannt)', DE, async ($, on) => {
  const { seen } = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
    expect(seen.bodyColumns).toBe(120)
    if (surface === 'terminal') expect(await ui.find({ key: 'limit-bars' })).toBeUndefined()
    else {
      // Seit 0.2.0: Ring und Balken zeichnen unabhängig; vor der ersten Anfrage steht der Ring grau mit „–“ (SPEC, Ausbau v0.2.0)
      const alt = String((await ui.find({ type: 'Svg' }))?.props.alt)
      expect(alt).toContain('Cache noch unbekannt')
      // Platzhalter statt Werten: die Balken stehen sofort da (Fynn, 2026-10-05)
      expect(alt).toContain('5-Stunden-Limit noch unbekannt; Wochenlimit noch unbekannt')
    }
    await ui.unmount()
  }
})

test('rateLimits leer (kein Abo): nichts Eigenes', DE, async ($, on) => {
  world(on)
  await measure($, [])
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ key: 'limit-bars' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
})

test('Stufen 0 / 50 / 95 / 100 % im Terminal: Text, Farbe, fett, voll', DE, async ($, on) => {
  world(on)
  const cases = [
    { p: 0, text: /^0 ?%$/, color: GREEN, bold: false },
    { p: 50, text: /^50 ?%$/, color: GREEN, bold: false },
    { p: 72, text: /^72 ?%$/, color: YELLOW, bold: false },
    { p: 95, text: /^95 ?%$/, color: RED, bold: true },
    { p: 100, text: 'voll', color: RED, bold: true },
  ]
  for (const c of cases) {
    await measure($, limits(c.p, c.p))
    const ui = await $.ui.mount(band('terminal'))
    const all = await ui.findAll({ type: 'Text', text: c.text })
    expect(all.length).toBe(2) // 5h und 7d
    for (const t of all) {
      expect(t.props.color).toBe(c.color)
      expect(t.props.bold === true).toBe(c.bold)
    }
    const box = await ui.find({ key: 'limit-bars' })
    expect((box?.props.width as number) <= 44).toBe(true)
    await ui.unmount()
  }
})

test('Stufen auf dem Desktop: ein Svg mit alt, Höhe ≤ 56, Farben im Bild', DE, async ($, on) => {
  world(on)
  for (const [p, label, color] of [[0, '0 %', GREEN], [50, '50 %', GREEN], [95, '95 %', RED], [100, 'voll', RED]] as const) {
    await measure($, limits(p, 18))
    const ui = await $.ui.mount(band('desktop'))
    const svg = await ui.find({ type: 'Svg' })
    expect(svg).toBeDefined()
    expect(String(svg?.props.alt)).toContain(`5-Stunden-Limit ${label}`)
    expect(String(svg?.props.alt)).toContain('Wochenlimit 18 %, Reset Mo 09:00')
    expect((svg?.props.height as number) <= 56).toBe(true)
    expect(String(svg?.props.source)).toContain(`fill="${color}"`)
    expect(String(svg?.props.source)).toContain('>5h<')
    // Fremder Inhalt bleibt, rechts neben den Balken
    expect(await ui.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
    await ui.unmount()
  }
})

test('Rundung wie die Usage-Anzeige: 58,6 % zeigt 59 %, 7,2 % zeigt 7 %', DE, async ($, on) => {
  world(on)
  await measure($, limits(58.6, 7.2))
  const ui = await $.ui.mount(band('desktop'))
  const alt = String((await ui.find({ type: 'Svg' }))?.props.alt)
  expect(alt).toContain('5-Stunden-Limit 59 %')
  expect(alt).toContain('Wochenlimit 7 %')
  await ui.unmount()
})

test('99,6 % zeigt 99 % (nie 100 vor dem Ende), nicht voll', DE, async ($, on) => {
  world(on)
  await measure($, limits(99.6, 10))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /^99 ?%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'voll' })).toBeUndefined()
})

test('spend_limit und unbekannte kind werden ignoriert', DE, async ($, on) => {
  world(on)
  await measure($, [
    { kind: 'spend_limit', percentUsed: 140 },
    { kind: 'irgendwas', percentUsed: 20 },
    { kind: 'five_hour', percentUsed: 30, resetsAt: iso(FIVE_RESET) },
  ])
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /^30 ?%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'voll' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^20 ?%$/ })).toBeUndefined()
})

test('onlyFiveHour: nur das 5h-Fenster', { options: { language: 'de', onlyFiveHour: true } }, async ($, on) => {
  world(on)
  await measure($, limits(40, 60))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: '5h' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '7d' })).toBeUndefined()
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.alt)).not.toContain('Wochenlimit')
      // Seit 0.2.0 sitzt der Cache-Ring im selben Bild: 56 hoch, das eine Fenster unten bündig
      expect(svg?.props.height).toBe(56)
    }
    await ui.unmount()
  }
})

test('Anfangsstand aus $.session.usage: Balken ohne session.measure', DE, async ($, on) => {
  mock.clock(on, { now: NOW })
  let asked = 0
  on('session.usage', () => {
    asked += 1
    return { value: { startedAt: NOW, context: { tokens: 0, window: 200000 }, rateLimits: limits(42, 7) } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(asked).toBe(1)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /^42 ?%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7 ?%$/ })).toBeDefined()
  expect(asked).toBe(1)
})

test('Anfangsstand beim ersten Zeichnen, wenn session.start die Oberfläche nicht nennt; nur ein Aufruf', DE, async ($, on) => {
  mock.clock(on, { now: NOW })
  let asked = 0
  on('session.usage', () => {
    asked += 1
    return { value: { startedAt: NOW, context: { tokens: 0, window: 200000 }, rateLimits: limits(33, 5) } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  const ui = await $.ui.mount(band('desktop'))
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('5-Stunden-Limit 33 %')
  await ui.redraw()
  expect(asked).toBe(1)
})

test('Fehlerpfad: usage abgelehnt → kein Wurf, nichts Eigenes; die nächste Messung zeichnet', DE, async ($, on) => {
  world(on)
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ key: 'limit-bars' })).toBeUndefined()
  await measure($, limits(12, 3))
  expect(await ui.find({ type: 'Text', text: /^12 ?%$/ })).toBeDefined()
})

test('Fehlerpfad: Uhr fällt aus → nichts Eigenes, fremder Text bleibt', DE, async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ deny: 'nein' }))
  on('clock.now', () => ({ deny: 'keine Uhr' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  await measure($, limits(50, 50))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ key: 'limit-bars' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
})

test('Countdown läuft mit der Uhr: in 2 h 14 min → in 1 h 14 min', DE, async ($, on) => {
  const { clock } = world(on)
  await measure($, limits(71, 18))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: ' · in 2 h 14 min' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · Mo 09:00' })).toBeDefined()
  await clock.advance(60 * MIN)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: ' · in 1 h 14 min' })).toBeDefined()
})

test('Reset vergeht ohne neue Messung: 0 % gedimmt, frisch; aus voll wird nicht mehr voll', DE, async ($, on) => {
  const { clock } = world(on)
  await measure($, limits(100, 30))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: 'voll' })).toBeDefined()
  await clock.advance(2 * 60 * MIN + 15 * MIN)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'voll' })).toBeUndefined()
  const zero = await ui.find({ type: 'Text', text: '0 %' })
  expect(zero?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: ' · frisch' })).toBeDefined()
  // Die Woche läuft weiter
  expect(await ui.find({ type: 'Text', text: /^30 ?%$/ })).toBeDefined()
})

test('Reset-Texte: gleicher Tag 14:30, anderer Tag Mo 09:00, Countdown ab 1 Tag', { options: { language: 'de', resetStyle: 'clock' } }, async ($, on) => {
  world(on)
  const sameDay = new Date(2026, 9, 2, 14, 30, 0).getTime()
  await measure($, [
    { kind: 'five_hour', percentUsed: 10, resetsAt: iso(sameDay) },
    { kind: 'seven_day', percentUsed: 10, resetsAt: iso(WEEK_RESET) },
  ])
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: ' · 14:30' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · Mo 09:00' })).toBeDefined()
})

test('resetStyle countdown: beide als Countdown', { options: { language: 'de', resetStyle: 'countdown' } }, async ($, on) => {
  world(on)
  await measure($, limits(10, 10))
  // Beide Langformen brauchen 46 Spalten: das Terminal nimmt die Kurzformen, der Desktop zeigt die Langformen
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: ' 2h14' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 2T23h' })).toBeDefined()
  await ui.unmount()
  const desk = await $.ui.mount(band('desktop'))
  const alt = String((await desk.find({ type: 'Svg' }))?.props.alt)
  expect(alt).toContain('Reset in 2 h 14 min')
  expect(alt).toContain('Reset in 2 T 23 h')
})

test('resetStyle mixed (Standard): 5h Countdown, Woche Uhrzeit; Kurzform unter einer Minute', DE, async ($, on) => {
  const { clock } = world(on)
  await measure($, limits(10, 10))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: ' · in 2 h 14 min' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · Mo 09:00' })).toBeDefined()
  await clock.advance(2 * 60 * MIN + 14 * MIN)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: ' · in < 1 min' })).toBeDefined()
})

test('Hervorhebung ab highlightAt', { options: { language: 'de', highlightAt: 70 } }, async ($, on) => {
  world(on)
  await measure($, limits(75, 65))
  const ui = await $.ui.mount(band('terminal'))
  expect((await ui.find({ type: 'Text', text: /^75 ?%$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^65 ?%$/ }))?.props.bold).toBe(false)
  expect((await ui.find({ type: 'Text', text: '5h' }))?.props.bold).toBe(true)
})

test('Takt (10 s): fragt ab, zeichnet aber nur bei sichtbarer Änderung neu; ohne Zeichnen Ende, neues Zeichnen startet ihn', DE, async ($, on) => {
  // Fynn, 2026-10-05: jedes Invalidate zeichnet das ganze Band neu und ließ Knöpfe anderer Mods flackern
  const clock = mock.clock(on, { now: NOW })
  let invalidates = 0
  let polls = 0
  let rateLimits: Limit[] = limits(20, 20)
  on('ui.invalidate', async ($, e, next) => {
    invalidates += 1
    return next(e)
  })
  on('session.usage', () => {
    polls += 1
    return { value: { startedAt: NOW, context: { tokens: 0, window: 200000 }, rateLimits } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  const ui = await $.ui.mount(band('terminal'))
  const p0 = polls
  const i0 = invalidates
  // Zwei Ticks ohne Änderung (Countdown bleibt „in 2 h 14 min“): abgefragt, nicht neu gezeichnet
  await clock.advance(10000)
  await clock.advance(10000)
  expect(polls - p0).toBe(2)
  expect(invalidates - i0).toBe(0)
  // Die Minute springt um: ein Neuzeichnen
  await clock.advance(20000)
  expect(invalidates - i0).toBe(1)
  expect(await ui.find({ type: 'Text', text: ' · in 2 h 13 min' })).toBeDefined()
  // Neuer Prozentwert: ein Neuzeichnen
  rateLimits = limits(25, 20)
  await clock.advance(10000)
  expect(invalidates - i0).toBe(2)
  expect(await ui.find({ type: 'Text', text: /^25 ?%$/ })).toBeDefined()
  await ui.unmount()

  // Nicht mehr gezeichnet: Die nächste Änderung fordert ein Neuzeichnen an, es kommt keins, der folgende Tick beendet den Takt
  rateLimits = limits(30, 20)
  await clock.advance(20000)
  const stopped = polls
  await clock.advance(5 * 10000)
  expect(polls).toBe(stopped)

  // Erneutes Zeichnen startet ihn wieder
  const again = await $.ui.mount(band('terminal'))
  await clock.advance(10000)
  expect(polls).toBe(stopped + 1)
  await again.unmount()
})

test('Takt holt $.session.usage ab: Werte erscheinen und ändern sich ohne session.measure (langer Turn)', DE, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let rateLimits: Limit[] = []
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 0, window: 200000 }, rateLimits } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  // Noch keine API-Antwort: keine Balken (nur der Ring), aber der Takt läuft
  const ui = await $.ui.mount(band('desktop'))
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('5-Stunden-Limit noch unbekannt')
  // Die erste Antwort kommt (z. B. mitten im ersten Turn): der nächste Tick zeigt sie
  rateLimits = limits(41, 7)
  await clock.advance(10000)
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('5-Stunden-Limit 41 %')
  // Der Verbrauch steigt weiter, ohne dass eine Messung kommt
  rateLimits = limits(44, 7)
  await clock.advance(10000)
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('5-Stunden-Limit 44 %')
  // Eine leere Antwort löscht den Stand nicht
  rateLimits = []
  await clock.advance(10000)
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('5-Stunden-Limit 44 %')
  await ui.unmount()
})

test('Takt: eine abgelehnte Periode beendet ihn still; zwei ausgebliebene Ticks später startet das Zeichnen ihn neu', DE, async ($, on) => {
  // Ohne mock.clock: eigene Uhr, und jede Periode von clock.every wird abgelehnt (types@2.1.288:3250-3251)
  let now = NOW
  let periods = 0
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => {
    periods += 1
    return { deny: 'abgelehnt' }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ deny: 'nein' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  await measure($, limits(20, 20))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /^20 ?%$/ })).toBeDefined()
  const first = periods
  expect(first >= 1).toBe(true)
  // Weniger als zwei Takte: kein Neustart
  now += 10000
  await ui.redraw()
  expect(periods).toBe(first)
  // Zwei Takte ohne Tick: neuer Takt
  now += 10000
  await ui.redraw()
  expect(periods).toBe(first + 1)
})
test('Reihenfolge außen: Balken links, Inhalt weiter innen rechts in einer Zeile; innen sieht bodyColumns − B', DE, async ($, on) => {
  const { seen } = world(on)
  await measure($, limits(71, 18))
  const ui = await $.ui.mount(band('terminal', 120))
  const tree = await ui.drawn()
  expect(tree).toMatchObject({ type: 'Box', props: { flexDirection: 'row', alignItems: 'flex-end' } })
  const kids = tree.children as { props: { key?: string; flexGrow?: number; width?: number } }[]
  expect(kids[0].props.key).toBe('limit-bars')
  // Läuft das Band über, schrumpft die Beschriftung nicht (im Sicht-Check sonst abgeschnitten)
  expect((kids[0].props as { flexShrink?: number }).flexShrink).toBe(0)
  expect(kids[1].props.flexGrow).toBe(1)
  const b = kids[0].props.width as number
  expect(b <= 44).toBe(true)
  expect(seen.bodyColumns).toBe(120 - b)
  expect(await ui.find({ type: 'Text', text: ' · in 2 h 14 min' })).toBeDefined()
})

test('Reihenfolge innen bzw. allein: Kern-Knoten NEBEN den Balken (nicht darunter), Breite ≤ min(44, bodyColumns − 40)', DE, async ($, on) => {
  world(on, { inner: false })
  await measure($, limits(71, 18))
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [120, 80]) {
      const ui = await $.ui.mount(band(surface, bodyColumns))
      const tree = await ui.drawn()
      // Übereinander gab die Desktop-App dem Kern-Knoten Höhe, die Balken rutschten über Clawds Füße (Fynn, 2026-10-03)
      expect(tree).toMatchObject({ type: 'Box', props: { flexDirection: 'row', alignItems: 'flex-end' } })
      const kids = tree.children as { props: { key?: string; flexGrow?: number }; children?: unknown[] }[]
      expect(kids[0].props.key).toBe('limit-bars')
      expect(kids[1].props.flexGrow).toBe(1)
      expect(kids[1].children?.[0]).toMatchObject({ type: 'engine' })
      if (surface === 'terminal') {
        const box = await ui.find({ key: 'limit-bars' })
        expect((box?.props.width as number) <= Math.min(44, bodyColumns - 40)).toBe(true)
      }
      await ui.unmount()
    }
  }
})

test('schmal: 70 → Kurzformen, 60 → nur 5h, 50 → nichts (bodyColumns dann unverändert)', DE, async ($, on) => {
  const { seen } = world(on)
  await measure($, limits(71, 18))
  let ui = await $.ui.mount(band('terminal', 70))
  expect(await ui.find({ type: 'Text', text: /^71 ?%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^18 ?%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 2h14' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' Mo9:00' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(band('terminal', 60))
  expect(await ui.find({ type: 'Text', text: '5h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d' })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount(band('terminal', 50))
  expect(await ui.find({ key: 'limit-bars' })).toBeUndefined()
  expect(seen.bodyColumns).toBe(50)
  expect(await ui.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
  await ui.unmount()
})

test('Umfrage im Band: limit-bars weicht', DE, async ($, on) => {
  world(on)
  await measure($, limits(71, 18))
  const ui = await $.ui.mount({ ...band('terminal'), props: { ...props(120), hasSurvey: true } })
  expect(await ui.find({ key: 'limit-bars' })).toBeUndefined()
})

test('VS Code und -p: kein usage(), kein Takt, kein Fehler', DE, async ($, on) => {
  let asked = 0
  let invalidates = 0
  const clock = mock.clock(on, { now: NOW })
  on('ui.invalidate', async ($, e, next) => {
    invalidates += 1
    return next(e)
  })
  on('session.usage', () => {
    asked += 1
    return { value: { startedAt: NOW, context: { tokens: 0, window: 200000 }, rateLimits: limits(1, 1) } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await $.session.start({ cwd: '/work', surface: 'vscode', isInteractive: true })
  expect(asked).toBe(0)
  const ui = await $.ui.mount({ plugin: 'limit-bars', component: 'AbovePrompt', props: props(120), surface: 'vscode' })
  await clock.advance(120000)
  expect(asked).toBe(0)
  expect(invalidates).toBe(0)
  expect(await ui.find({ key: 'limit-bars' })).toBeUndefined()
})

test('Reihenfolge: liegt quick-replies weiter innen, bleibt seine Pille über dem Band, die Balken kommen nur neben den Grund', DE, async ($, on) => {
  world(on, { layered: true })
  await measure($, limits(71, 18))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface, 120))
    type N = { props: { key?: string }; children: N[] }
    const tree = (await ui.drawn()) as N
    expect(tree.props.key).toBe('band')
    expect(tree.children.map((c) => c.props.key)).toEqual(['layer:20:quick-replies', 'band-base'])
    // Im Grund: Balken links, der fremde Text rechts, keine Pille
    const row = tree.children[1].children[0].children[0]
    expect(row.children[0].props.key).toBe('limit-bars')
    expect(JSON.stringify(row)).toContain('von anderen')
    expect(JSON.stringify(row)).not.toContain('quick-replies')
    await ui.unmount()
  }
})
