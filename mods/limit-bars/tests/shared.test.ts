// limit-bars 0.8.0: Takt 2 s und gemeinsamer Stand aller Chats auf dem Rechner (`$.store` unter `limits`, SPEC.md, Ausbau 0.8.0).
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { cleanShared, mergeWins } from '../hooks/view.ts'

const NOW = new Date(2026, 9, 19, 10, 0, 0).getTime()
const MIN = 60000
const TICK = 2000
const FIVE_RESET = NOW + (2 * 60 + 14) * MIN + 30000
const WEEK_RESET = new Date(2026, 9, 22, 9, 0, 0).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const DE = { options: { language: 'de' } } as const

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
const limits = (five: number, week: number): Limit[] => [
  { kind: 'five_hour', percentUsed: five, resetsAt: iso(FIVE_RESET) },
  { kind: 'seven_day', percentUsed: week, resetsAt: iso(WEEK_RESET) },
]
// So legt ein Chat den Stand ab: Reset als Zahl (ms), wie `pickWindows` ihn liefert
const stored = (at: number, five: number, week: number) => ({
  at,
  wins: [
    { kind: 'five_hour', percentUsed: five, resetsAt: FIVE_RESET },
    { kind: 'seven_day', percentUsed: week, resetsAt: WEEK_RESET },
  ],
})

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } as const
const band = { plugin: 'limit-bars', component: 'AbovePrompt', requestId: 'above-prompt', props, surface: 'desktop' } as const

// Ein Chat: eigene Messung (`usage()`) und der Store, den alle Chats teilen (hier eine Map)
function world(on: On, o: { own?: Limit[]; saved?: Map<string, unknown>; denyStore?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const state = { own: o.own ?? [], sets: 0 }
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: undefined, window: 200000 }, rateLimits: state.own } }))
  on('store.get', ($, e) => (o.denyStore ? { deny: 'kein Store' } : { value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    if (o.denyStore) return { deny: 'kein Store' }
    if (e.key === 'limits') state.sets += 1
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  return { clock, saved, state }
}

async function alt(ui: { find: (q: object) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  return String((await ui.find({ type: 'Svg' }))?.props.alt)
}

test('Eigene neue Messung landet mit Zeitpunkt in limits; unveränderte Messung schreibt nicht erneut', DE, async ($, on) => {
  const w = world(on, { own: limits(20, 5) })
  const ui = await $.ui.mount(band)
  await w.clock.settle()
  expect(await alt(ui)).toContain('5-Stunden-Limit 20 %')
  expect(w.saved.get('limits')).toEqual(stored(NOW, 20, 5))
  expect(w.state.sets).toBe(1)
  // Fünf Ticks mit derselben Messung: kein weiteres Schreiben
  await w.clock.advance(5 * TICK)
  expect(w.state.sets).toBe(1)
  // Neue eigene Antwort: neuer Eintrag mit neuem Zeitpunkt
  w.state.own = limits(22, 5)
  await w.clock.advance(TICK)
  await w.clock.settle()
  expect(w.state.sets).toBe(2)
  expect((w.saved.get('limits') as { at: number }).at).toBe(NOW + 6 * TICK)
  await ui.unmount()
})

test('Neuerer Stand eines anderen Chats erscheint mit dem nächsten Tick; die eigene alte Messung überschreibt ihn nicht', DE, async ($, on) => {
  const w = world(on, { own: limits(20, 5) })
  const ui = await $.ui.mount(band)
  await w.clock.settle()
  // Ein anderer Chat bekommt eine Antwort mit 35 %
  w.saved.set('limits', stored(NOW + 1000, 35, 6))
  await w.clock.advance(TICK)
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 35 %')
  // Die eigene Messung bleibt bei 20 % (keine neue Antwort hier): Es bleibt bei 35 %
  await w.clock.advance(5 * TICK)
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 35 %')
  // Neue eigene Antwort: gilt hier und für die anderen
  w.state.own = limits(37, 6)
  await w.clock.advance(TICK)
  await w.clock.settle()
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 37 %')
  expect(w.saved.get('limits')).toEqual(stored(NOW + 7 * TICK, 37, 6))
  await ui.unmount()
})

test('Nur bei Änderung neu zeichnen: derselbe gemeinsame Stand löst kein weiteres Neuzeichnen aus', DE, async ($, on) => {
  const w = world(on, { own: limits(20, 5) })
  let invalidates = 0
  on('ui.invalidate', async ($, e, next) => {
    invalidates += 1
    return next(e)
  })
  const ui = await $.ui.mount(band)
  await w.clock.settle()
  const i0 = invalidates
  w.saved.set('limits', stored(NOW + 1000, 35, 6))
  await w.clock.advance(TICK)
  expect(invalidates - i0).toBe(1)
  await ui.redraw()
  await w.clock.advance(5 * TICK)
  expect(invalidates - i0).toBe(1)
  await ui.unmount()
})

test('Älterer Stand aus einem abgelaufenen Fenster wird ignoriert; die eigene Messung gilt und wird abgelegt', DE, async ($, on) => {
  const old = { at: NOW - 3 * 60 * MIN, wins: [{ kind: 'five_hour', percentUsed: 90, resetsAt: FIVE_RESET - 5 * 60 * MIN }, { kind: 'seven_day', percentUsed: 40, resetsAt: WEEK_RESET - 7 * 24 * 60 * MIN }] }
  const w = world(on, { own: limits(20, 5), saved: new Map<string, unknown>([['limits', old]]) })
  const ui = await $.ui.mount(band)
  await w.clock.advance(3 * TICK)
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 20 %')
  expect(w.saved.get('limits')).toEqual(stored(NOW, 20, 5))
  await ui.unmount()
})

test('Nach dem Laden ist die eigene Messung unbekannten Alters: ein höherer Stand im selben Fenster gewinnt, nichts wird geschrieben (Review S1)', DE, async ($, on) => {
  // /reload-plugins in einem ruhenden Chat: usage() nennt seine Antwort von vor Stunden (20 %), ein anderer Chat hat 35 % abgelegt
  const saved = new Map<string, unknown>([['limits', stored(NOW - 5 * MIN, 35, 6)]])
  const w = world(on, { own: limits(20, 5), saved })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(band)
  expect(await alt(ui)).toContain('5-Stunden-Limit 35 %')
  await w.clock.advance(5 * TICK)
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 35 %')
  expect(w.state.sets).toBe(0)
  expect(w.saved.get('limits')).toEqual(stored(NOW - 5 * MIN, 35, 6))
  // Die nächste eigene Antwort gilt wieder als neu
  w.state.own = limits(38, 7)
  await w.clock.advance(TICK)
  await w.clock.settle()
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 38 %')
  expect(w.state.sets).toBe(1)
  await ui.unmount()
})

test('Nach dem Laden: bringt die eigene Messung Neueres (höher bzw. neues Fenster), wird zusammengeführt abgelegt', DE, async ($, on) => {
  // 5h: im selben Fenster höher als der Store; Woche: der Store ist höher
  const saved = new Map<string, unknown>([['limits', stored(NOW - 5 * MIN, 30, 9)]])
  const w = world(on, { own: limits(33, 6), saved })
  const ui = await $.ui.mount(band)
  await w.clock.settle()
  expect(w.saved.get('limits')).toEqual(stored(NOW, 33, 9))
  const a = await alt(ui)
  expect(a).toContain('5-Stunden-Limit 33 %')
  expect(a).toContain('Wochenlimit 9 %')
  await ui.unmount()
})

test('Vor der ersten eigenen Antwort: Stand eines anderen Chats; eine leere Messung löscht ihn nicht', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['limits', stored(NOW - 30 * MIN, 50, 12)]])
  const w = world(on, { saved })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(band)
  expect(await alt(ui)).toContain('5-Stunden-Limit 50 %')
  await $.session.measure({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: [], changed: ['context'] })
  await w.clock.advance(TICK)
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 50 %')
  expect(w.state.sets).toBe(0)
  await ui.unmount()
})

test('Schreiben lässt einen neueren Eintrag stehen (zwei Chats fast gleichzeitig) und übernimmt ihn', DE, async ($, on) => {
  const w = world(on, { own: limits(20, 5) })
  const ui = await $.ui.mount(band)
  await w.clock.settle()
  expect(w.state.sets).toBe(1)
  // Ein anderer Chat legt einen Stand mit späterem Zeitpunkt ab, gleich danach kommt hier eine eigene Antwort
  w.saved.set('limits', stored(NOW + TICK + 500, 60, 20))
  w.state.own = limits(22, 5)
  await w.clock.advance(TICK)
  await w.clock.settle()
  await ui.redraw()
  expect(w.state.sets).toBe(1)
  expect(w.saved.get('limits')).toEqual(stored(NOW + TICK + 500, 60, 20))
  expect(await alt(ui)).toContain('5-Stunden-Limit 60 %')
  await ui.unmount()
})

test('Messung (session.measure) teilt ihren Stand ebenfalls', DE, async ($, on) => {
  const w = world(on)
  await $.session.measure({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: limits(44, 9), changed: ['rateLimits'] })
  await w.clock.settle()
  expect(w.saved.get('limits')).toEqual(stored(NOW, 44, 9))
})

test('Store abgelehnt: eigener Stand wie bisher, kein Wurf', DE, async ($, on) => {
  const w = world(on, { own: limits(20, 5), denyStore: true })
  const ui = await $.ui.mount(band)
  await w.clock.advance(2 * TICK)
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 20 %')
  await $.session.measure({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: limits(25, 5), changed: ['rateLimits'] })
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 25 %')
  await ui.unmount()
})

test('cleanShared: nur gültige Fenster, sonst nichts', () => {
  expect(cleanShared(stored(NOW, 20, 5))).toEqual(stored(NOW, 20, 5))
  expect(cleanShared(undefined)).toBeUndefined()
  expect(cleanShared('x')).toBeUndefined()
  expect(cleanShared({ at: 'gestern', wins: [] })).toBeUndefined()
  expect(cleanShared({ at: NOW, wins: 'x' })).toBeUndefined()
  expect(cleanShared({ at: NOW, wins: [] })).toBeUndefined()
  expect(cleanShared({ at: NOW, wins: [{ kind: 'spend_limit', percentUsed: 5 }] })).toBeUndefined()
  // Unlesbares Reset fällt weg, das Fenster bleibt; doppelte Einträge: der erste gilt
  expect(cleanShared({ at: NOW, wins: [{ kind: 'five_hour', percentUsed: 3, resetsAt: 'bald' }, { kind: 'five_hour', percentUsed: 9 }, null] })).toEqual({
    at: NOW,
    wins: [{ kind: 'five_hour', percentUsed: 3, resetsAt: undefined }],
  })
})

test('mergeWins: späteres Fenster gewinnt, im selben Fenster der höhere Wert, bei Gleichstand der erste; fehlende Fenster ergänzt', () => {
  const H = 60 * MIN
  const five = (p: number, r = FIVE_RESET) => ({ kind: 'five_hour' as const, percentUsed: p, resetsAt: r })
  const week = (p: number) => ({ kind: 'seven_day' as const, percentUsed: p, resetsAt: WEEK_RESET })
  // neues Fenster mit weniger Verbrauch schlägt das alte volle
  expect(mergeWins([five(95, FIVE_RESET - 5 * H)], [five(3)])).toEqual([five(3)])
  expect(mergeWins([five(3)], [five(95, FIVE_RESET - 5 * H)])).toEqual([five(3)])
  // selbes Fenster (Reset auf Sekunden verschieden): höherer Wert
  expect(mergeWins([five(20)], [five(25, FIVE_RESET + 1000)])).toEqual([five(25, FIVE_RESET + 1000)])
  expect(mergeWins([five(25)], [five(20)])).toEqual([five(25)])
  // Gleichstand: a bleibt (nichts Neues zum Ablegen)
  const a = [five(20)]
  expect(mergeWins(a, [five(20, FIVE_RESET + 1000)])[0]).toBe(a[0])
  // ohne Reset: höherer Wert; fehlendes Fenster aus dem anderen
  expect(mergeWins([{ kind: 'five_hour', percentUsed: 10 }], [five(12), week(4)])).toEqual([five(12), week(4)])
})

test('Anfangsstand abgelehnt: auch die erste Messung über session.measure wird abgeglichen statt blind abgelegt (Review K6)', DE, async ($, on) => {
  mock.clock(on, { now: NOW })
  const saved = new Map<string, unknown>([['limits', stored(NOW - 5 * MIN, 35, 6)]])
  let sets = 0
  on('session.usage', () => ({ deny: 'kein Anfangsstand' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    sets += 1
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  const ui = await $.ui.mount(band)
  expect(await alt(ui)).toContain('5-Stunden-Limit 35 %')
  await $.session.measure({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: limits(20, 5), changed: ['rateLimits'] })
  await ui.redraw()
  expect(await alt(ui)).toContain('5-Stunden-Limit 35 %')
  expect(sets).toBe(0)
  await ui.unmount()
})
