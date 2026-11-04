// limit-bars 0.10.0: Wochen-Tempo ohne 5h-Limit und Stil Balken oder Ringe (SPEC.md, Ausbau 0.10.0).
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { cleanStyle, parseBars, styleFromOptions } from '../hooks/display.ts'
import { barsHelpData } from '../hooks/helpdata.ts'
import { DEFAULT_SETTINGS } from '../hooks/cache.ts'
import { MARK, darker } from '../hooks/ring.ts'
import { desktopSvg } from '../hooks/svg.ts'
import { cleanShared, lacksFive, layoutTerminal, nextMiss, paceOf, paceShown, sharedMiss, shownWindows, withPace } from '../hooks/view.ts'
import type { Win } from '../hooks/view.ts'

const H = 3600000
const MIN = 60000
const TICK = 2000
// Wochenfenster: Reset Montag, 9. November 2026, 03:00 lokal; Beginn eine Woche davor
const WEEK_RESET = new Date(2026, 10, 9, 3, 0, 0).getTime()
const START = WEEK_RESET - 7 * 24 * H
// Dienstag, 3. November 2026, 12:00: 33 h nach Beginn, gleichmäßig wären 19,6 %
const NOW = START + 33 * H
const FIVE_RESET = NOW + 2 * H
const iso = (ms: number) => new Date(ms).toISOString()
const DE = { options: { language: 'de' } } as const
const GREY = '#9A9A9A'
const ORANGE = '#D77757'
const RED = '#C9594B'

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
const week = (p: number, reset: number | null = WEEK_RESET): Limit[] => [{ kind: 'seven_day', percentUsed: p, ...(reset === null ? {} : { resetsAt: iso(reset) }) }]
const both = (five: number, p: number): Limit[] => [{ kind: 'five_hour', percentUsed: five, resetsAt: iso(FIVE_RESET) }, ...week(p)]
const win = (p: number, resetsAt: number | null = WEEK_RESET): Win => ({ kind: 'seven_day', percentUsed: p, resetsAt: resetsAt ?? undefined })

const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({ plugin: 'limit-bars', component: 'AbovePrompt', requestId: `above-${surface}-${bodyColumns}`, props: props(bodyColumns), surface }) as never

// Ein Chat: eigene Messung (`usage()`), der gemeinsame Store (Map), gemeldete Breiten, Neuzeichnen
function world(on: On, o: { own?: Limit[]; saved?: Map<string, unknown>; now?: number; denyDisplay?: boolean } = {}) {
  const clock = mock.clock(on, { now: o.now ?? NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const st = { own: o.own ?? [], invalidates: 0, widths: [] as unknown[] }
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: undefined, window: 200000 }, rateLimits: st.own } }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    if (o.denyDisplay && e.key === 'display') return { deny: 'Speicher voll' }
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('state.set', ($, e) => {
    st.widths.push(e.value)
    return { value: undefined } as never
  })
  on('ui.invalidate', async ($, e, next) => {
    st.invalidates += 1
    return next(e)
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  return { clock, saved, st }
}

const bars = async ($: any, args = '') => (await $.command.run({ command: 'bars', args } as never)).text as string
const svg = async (ui: any) => (await ui.find({ type: 'Svg' })) as { props: { alt: string; source: string; width: number; height: number } }

/** Zweite Messung ohne 5h-Fenster (eine neue Antwort dieses Chats), dann neu zeichnen. */
async function next(w: ReturnType<typeof world>, ui: any, own: Limit[]) {
  w.st.own = own
  await w.clock.advance(TICK)
  await w.clock.settle()
  await ui.redraw()
}

// ---------- Erkennung ----------

test('0.10.0 Erkennung: lacksFive, Zähler, gemeinsamer Zähler (0.9.0-Einträge zählen als eine Messung), cleanShared mit miss', () => {
  expect(lacksFive([win(5)])).toBe(true)
  expect(lacksFive([])).toBe(false)
  expect(lacksFive([{ kind: 'five_hour', percentUsed: 1 }, win(5)])).toBe(false)
  expect(nextMiss(0, [win(5)])).toBe(1)
  expect(nextMiss(1, [win(6)])).toBe(2)
  expect(nextMiss(5, [{ kind: 'five_hour', percentUsed: 1 }, win(5)])).toBe(0)
  expect(nextMiss(3, [])).toBe(0)
  expect(sharedMiss({ at: 1, wins: [win(5)], miss: 4 }, 0)).toBe(4)
  expect(sharedMiss({ at: 1, wins: [win(5)] }, 1)).toBe(2)
  expect(sharedMiss({ at: 1, wins: [{ kind: 'five_hour', percentUsed: 1 }] }, 3)).toBe(0)
  expect(cleanShared({ at: 1, wins: [win(5)], miss: 3 })).toEqual({ at: 1, wins: [win(5)], miss: 3 })
  expect(cleanShared({ at: 1, wins: [win(5)], miss: 0 })).toEqual({ at: 1, wins: [win(5)] })
  expect(cleanShared({ at: 1, wins: [win(5)], miss: 'viel' })).toEqual({ at: 1, wins: [win(5)] })
})

test('0.10.0 Erkennung: eine Messung ohne 5h reicht nicht, ab der zweiten Tempo; five_hour taucht auf → normal; Zähler im Store', DE, async ($, on) => {
  const w = world(on, { own: week(30) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await ui.redraw()
  // Erste Messung ohne 5h: wie bisher nur die Woche (Fynns Daten: ein einzelnes Fehlen kam auch mit laufendem 5h-Fenster vor)
  expect((await svg(ui)).props.alt).not.toContain('Kein 5-Stunden-Limit')
  expect((await svg(ui)).props.alt).toContain('Wochenlimit 30 %')
  expect(w.saved.get('limits')).toEqual({ at: NOW, wins: [win(30)], miss: 1 })
  await next(w, ui, week(34))
  expect((await svg(ui)).props.alt).toContain('Kein 5-Stunden-Limit, 14 Prozentpunkte über gleichmäßigem Verbrauch, reicht bis Freitag 04:00; Wochenlimit 34 %')
  expect((w.saved.get('limits') as { miss: number }).miss).toBe(2)
  // 5h-Fenster wieder da: sofort die normale Anzeige, Zähler zurück
  await next(w, ui, both(12, 35))
  const alt = (await svg(ui)).props.alt
  expect(alt).toContain('5-Stunden-Limit 12 %')
  expect(alt).not.toContain('Kein 5-Stunden-Limit')
  expect((w.saved.get('limits') as { miss?: number }).miss).toBeUndefined()
  await ui.unmount()
})

test('0.10.0 Erkennung: vor der ersten Messung Platzhalter wie bisher (kein Tempo)', DE, async ($, on) => {
  const w = world(on)
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  const alt = (await svg(ui)).props.alt
  expect(alt).toContain('5-Stunden-Limit noch unbekannt; Wochenlimit noch unbekannt')
  expect(alt).not.toContain('Kein 5-Stunden-Limit')
  await ui.unmount()
})

test('0.10.0 Erkennung: gemeinsamer Stand ohne 5h aus einem anderen Chat (miss 2) → sofort Tempo', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['limits', { at: NOW - 5 * MIN, wins: [win(34)], miss: 2 }]])
  const w = world(on, { saved })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await ui.redraw()
  expect((await svg(ui)).props.alt).toContain('Kein 5-Stunden-Limit')
  await ui.unmount()
})

test('0.10.0 Erkennung: Eintrag eines 0.9.0-Chats ohne miss zählt als eine Messung, die nächste eigene macht zwei', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['limits', { at: NOW - 5 * MIN, wins: [win(33)] }]])
  const w = world(on, { saved })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await ui.redraw()
  expect((await svg(ui)).props.alt).not.toContain('Kein 5-Stunden-Limit')
  await next(w, ui, week(34))
  expect((await svg(ui)).props.alt).toContain('Kein 5-Stunden-Limit')
  await ui.unmount()
})

// ---------- Tempo-Rechnung ----------

test('0.10.0 Tempo: < 6 h frisch, im Plan mit Prognose, über Tempo (rot, reicht bis), knapp drüber grau, orange spät in der Woche, ohne resetsAt', () => {
  const early = paceOf(win(3), START + 3 * H)
  expect(early.kind).toBe('early')
  const plan = paceOf(win(10), NOW)
  expect(plan.kind).toBe('plan')
  expect(Math.round(plan.even!)).toBe(20)
  expect(Math.round(plan.delta)).toBe(-10)
  expect(Math.round(plan.forecast)).toBe(51)
  expect(plan.color).toBe(GREY)
  const over = paceOf(win(34), NOW)
  expect(over.kind).toBe('over')
  expect(Math.round(over.delta)).toBe(14)
  // 33 h × 100 / 34 = 97,06 h nach Beginn → Freitag 04:03, mehr als 24 h vor dem Reset → rot
  expect(over.full).toBe(START + (33 * H * 100) / 34)
  expect(over.color).toBe(RED)
  // 2 Punkte über dem Plan: grau, aber mit „reicht bis“
  const slight = paceOf(win(22), NOW)
  expect(slight.kind).toBe('over')
  expect(slight.color).toBe(GREY)
  // 150 h nach Beginn mit 95 %: 5,7 Punkte drüber, 100 % erst 6 h vor dem Reset → orange
  const late = paceOf(win(95), START + 150 * H)
  expect(late.color).toBe(ORANGE)
  expect(paceOf(win(34, null), NOW).kind).toBe('none')
})

test('0.10.0 Tempo-Texte de/en: lang, kurz, alt; Uhrzeit auf 15 min abgerundet; ohne resetsAt nur 5h ∞', () => {
  const de = paceShown(win(34), NOW, 'de')
  expect(de.top.reset).toEqual({ long: '+14 % · reicht bis Fr 04:00', short: '+14% Fr4h', alt: '' })
  expect(de.top.pace?.alt).toBe('Kein 5-Stunden-Limit, 14 Prozentpunkte über gleichmäßigem Verbrauch, reicht bis Freitag 04:00')
  expect(Math.round(de.mark! * 100)).toBe(20)
  const en = paceShown(win(10), NOW, 'en')
  expect(en.top.reset?.long).toBe('10% under pace · forecast 51%')
  expect(en.top.reset?.short).toBe('~51%')
  expect(en.top.pace?.alt).toBe('No 5-hour limit, 10 points below even use, about 51% at the reset')
  expect(paceShown(win(19), NOW, 'de').top.reset?.long).toBe('im Plan · Prognose 97 %')
  expect(paceShown(win(3), START + 3 * H, 'de').top.reset?.long).toBe('Woche frisch')
  const none = paceShown(win(34, null), NOW, 'de')
  expect(none.top.reset).toBeUndefined()
  expect(none.mark).toBeUndefined()
  expect(none.top.pct.long).toBe('∞')
})

// ---------- Neuzeichnen ----------

test('0.10.0 Neuzeichnen: zwei Ticks mit gleichem gerundeten Tempo zeichnen nicht neu', DE, async ($, on) => {
  const w = world(on, { own: week(9) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await next(w, ui, week(10))
  expect((await svg(ui)).props.alt).toContain('Kein 5-Stunden-Limit')
  const i0 = w.st.invalidates
  await w.clock.advance(10 * TICK)
  await w.clock.settle()
  expect(w.st.invalidates - i0).toBe(0)
  await ui.unmount()
})

// ---------- Anzeige Balken ----------

test('0.10.0 Balken (Desktop): Tempo-Zeile statt 5h-Balken, Strich auf dem Wochenbalken; 5h off blendet die Tempo-Zeile aus', DE, async ($, on) => {
  const w = world(on, { own: week(33) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await next(w, ui, week(34))
  const s = (await svg(ui)).props
  expect(s.source).toContain('<tspan fill="#9A9A9A" opacity="0.7"> ∞</tspan>')
  expect(s.source).toContain(`<tspan fill="${RED}"> &#183; +14 % über Tempo</tspan>`)
  expect(s.source).toContain('font-size="10" fill="#9A9A9A">reicht bis Fr 04:00</text>')
  // Strich bei 19,6 % von 174 px
  expect(s.source).toContain(`<rect x="33" y="42" width="4" height="14" fill="#833A31"/><rect x="34" y="42" width="2" height="14" fill="${RED}"/>`)
  // Textzeile der Woche 2 px über dem Strich (0.10.4: er stieß an die Zeile)
  expect(s.source).toContain(`<text x="0" y="40" font-family`)
  expect(s.height).toBe(56)
  // 5h aus: obere Zeile weg, die Woche behält den Strich
  await bars($, '5h off')
  await ui.redraw()
  const off = (await svg(ui)).props
  expect(off.alt).not.toContain('Kein 5-Stunden-Limit')
  expect(off.source).toContain(`fill="${RED}"/>`)
  expect(off.height).toBe(56) // Cache-Ring hält die Höhe
  await ui.unmount()
})

test('0.10.0 Balken (Terminal): Kurzformen bei 70/60/50 Spalten, Strich ┆ im Wochenbalken; /bars nennt den Zustand', DE, async ($, on) => {
  const w = world(on, { own: week(33) })
  const ui = await $.ui.mount(band('terminal', 70))
  await w.clock.settle()
  await next(w, ui, week(34))
  expect(await ui.find({ type: 'Text', text: ' ∞' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' +14% Fr4h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '┆' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d' })).toBeDefined()
  await ui.unmount()
  // 60 Spalten: Die Woche ist das eigentliche Limit; zuerst fällt die Tempo-Zeile weg, die Woche bleibt (Review K1/S1)
  const u60 = await $.ui.mount(band('terminal', 60))
  expect(await u60.find({ type: 'Text', text: ' +14% Fr4h' })).toBeUndefined()
  expect(await u60.find({ type: 'Text', text: '7d' })).toBeDefined()
  expect(await u60.find({ type: 'Text', text: '34%' })).toBeDefined()
  await u60.unmount()
  const u50 = await $.ui.mount(band('terminal', 50))
  expect(await u50.find({ key: 'limit-bars' })).toBeUndefined()
  await u50.unmount()
  expect(await bars($)).toContain('| 5-Stunden-Balken | an · kein Limit (Tempo-Anzeige) | Einstellung |')
})

test('0.10.0 layoutTerminal: Langform → kurz → 5h ∞ → nichts', () => {
  const shown = withPace([], [win(34)], NOW, 'de', true)
  expect(layoutTerminal(shown, 90)?.blocks.map((b) => b.pct + b.rest)).toEqual(['∞ · +14 % · reicht bis Fr 04:00'])
  expect(layoutTerminal(shown, 60)?.blocks.map((b) => b.pct + b.rest)).toEqual(['∞ +14% Fr4h'])
  expect(layoutTerminal(shown, 53)?.blocks.map((b) => b.pct + b.rest)).toEqual(['∞'])
  expect(layoutTerminal(shown, 52)).toBeNull()
})

test('0.10.0 layoutTerminal mit Woche und Cache-Block: Cache bleibt bei 120, die Woche bleibt bis zuletzt (Review S1)', () => {
  const opts = { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang: 'de' } as const
  const wk = [win(34)]
  const shown = withPace(shownWindows(wk, NOW, opts), wk, NOW, 'de', true)
  const text = (l: ReturnType<typeof layoutTerminal>) => l?.blocks.map((b) => `${b.shown.tag} ${b.pct}${b.rest}`)
  const l120 = layoutTerminal(shown, 120, '◔ 42m')
  expect(text(l120)).toEqual(['5h ∞ +14% Fr4h', '7d 34% Mo3:00'])
  expect(l120?.extra).toBe('◔ 42m')
  // 70: ohne Cache-Block, beide kurz
  expect(text(layoutTerminal(shown, 70, '◔ 42m'))).toEqual(['5h ∞ +14% Fr4h', '7d 34% Mo3:00'])
  // 68: Tempo nur noch `5h ∞`
  expect(text(layoutTerminal(shown, 68, '◔ 42m'))).toEqual(['5h ∞', '7d 34% Mo3:00'])
  // 60 und 54: nur die Woche
  expect(text(layoutTerminal(shown, 60, '◔ 42m'))).toEqual(['7d 34% Mo3:00'])
  expect(text(layoutTerminal(shown, 54))).toEqual(['7d 34% Mo3:00'])
  expect(layoutTerminal(shown, 52)).toBeNull()
})

// ---------- Stil ----------

test('0.10.0 Stil: Parser, Einstellung, gespeicherter Wert', () => {
  expect(parseBars('style ring')).toEqual({ kind: 'style', style: 'ring' })
  expect(parseBars('style Kreis')).toEqual({ kind: 'style', style: 'ring' })
  expect(parseBars('style balken')).toEqual({ kind: 'style', style: 'bar' })
  expect(parseBars('style')).toEqual({ kind: 'bad' })
  expect(parseBars('style rund')).toEqual({ kind: 'bad' })
  expect(styleFromOptions({})).toBe('bar')
  expect(styleFromOptions({ style: 'ring' })).toBe('ring')
  expect(cleanStyle({ fiveHour: false, style: 'ring' })).toBe('ring')
  expect(cleanStyle({ style: 'kreis' })).toBeUndefined()
})

test('0.10.0 Ring mit 5h (Einstellung style ring): je Fenster ein Ring, Prozent in der Mitte, Reset darunter, schmaler als die Balken', { options: { language: 'de', style: 'ring' } }, async ($, on) => {
  const w = world(on, { own: both(71, 34) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await ui.redraw()
  const s = (await svg(ui)).props
  expect(s.source).toContain('font-size="12" fill="#D77757">5h</text>')
  expect(s.source).toContain('font-size="12" fill="#D77757">7d</text>')
  expect(s.source).toContain('font-size="11" fill="#F2C94C">71%</text>')
  expect(s.source).toContain('font-size="7" fill="#9A9A9A">2h00</text>')
  expect(s.source).toContain('font-size="7" fill="#9A9A9A">Mo3:00</text>')
  expect(s.height).toBe(56)
  // 5h-Ring 40 + 8 + Woche 40 + 8 + Cache 40, dazu Rand 10 und 8
  expect(s.width).toBe(10 + 40 + 8 + 40 + 8 + 40 + 8)
  expect(s.alt).toContain('5-Stunden-Limit 71 %')
  // Terminal bleibt Balken
  const t = await $.ui.mount(band('terminal'))
  expect(await t.find({ type: 'Text', text: '5h' })).toBeDefined()
  expect(await t.find({ type: 'Svg' })).toBeUndefined()
  await t.unmount()
  await ui.unmount()
})

test('0.10.0 Ring ohne 5h: Tempo als Text links, Wochen-Ring mit Kerbe; Breite wird bei Wechsel gemeldet', DE, async ($, on) => {
  const w = world(on, { own: week(33) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await next(w, ui, week(34))
  const barW = (await svg(ui)).props.width
  const n0 = w.st.widths.length
  expect(await bars($, 'style ring')).toContain('Stil: Ringe.')
  await w.clock.settle()
  await ui.redraw()
  const s = (await svg(ui)).props
  expect(s.source).toContain('font-size="11" fill="#C9594B">+14 % über Tempo</text>')
  expect(s.source).toContain('font-size="10" fill="#9A9A9A">reicht bis Fr 04:00</text>')
  expect(s.source).toContain(`stroke="${RED}" stroke-width="2"/>`)
  expect(s.source).toContain('font-size="11" fill="#6CC070">34%</text>')
  expect(s.width).not.toBe(barW)
  // Neue Breite für spotify gemeldet (nicht beim Zeichnen, sondern beim Befehl)
  expect(w.st.widths.length).toBe(n0 + 1)
  expect(w.st.widths.at(-1)).toEqual({ width: s.width })
  expect(w.saved.get('display')).toEqual({ style: 'ring' })
  await ui.unmount()
})

test('0.10.0 Stil: /bars schlägt die Einstellung, Wert aus einem anderen Chat binnen 2 s, reset zurück, Teile-Schalter behalten den Stil', { options: { language: 'de', style: 'ring' } }, async ($, on) => {
  const w = world(on, { own: both(20, 30) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await ui.redraw()
  expect((await svg(ui)).props.source).toContain('>7d</text>')
  // Ein anderer Chat setzt Balken
  w.saved.set('display', { style: 'bar' })
  await w.clock.advance(TICK)
  await ui.redraw()
  expect((await svg(ui)).props.source).not.toContain('>7d</text>')
  expect(await bars($)).toContain('| Stil | Balken | /bars |')
  // Ein Teile-Schalter behält den Stil
  await bars($, 'cache off')
  expect(w.saved.get('display')).toEqual({ cache: false, style: 'bar' })
  // reset: wieder die Einstellung (Ringe)
  expect(await bars($, 'reset')).toContain('| Stil | Ringe | Einstellung |')
  await ui.redraw()
  expect((await svg(ui)).props.source).toContain('>7d</text>')
  await ui.unmount()
})

test('0.10.0 Stil im Terminal: /bars style ring speichert und sagt, dass Ringe nur im Desktop erscheinen', DE, async ($, on) => {
  const w = world(on, { own: both(20, 30) })
  const ui = await $.ui.mount(band('terminal'))
  await w.clock.settle()
  const text = await bars($, 'style ring')
  expect(text).toContain('Ringe zeichnet nur die Desktop-App')
  expect(w.saved.get('display')).toEqual({ style: 'ring' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '5h' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('0.10.0 Englisch: Tempo-Zeile, Ring-Stil und /bars style', async ($, on) => {
  const w = world(on, { own: week(9) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  await next(w, ui, week(10))
  expect((await svg(ui)).props.alt).toContain('No 5-hour limit, 10 points below even use, about 51% at the reset; Weekly limit 10%')
  expect(await bars($, 'style ring')).toContain('Style: rings.')
  await ui.redraw()
  expect((await svg(ui)).props.source).toContain('>10% under pace</text>')
  expect(await bars($)).toContain('| 5-hour bar | on · no limit (pace display) | settings |')
  await ui.unmount()
})

test('0.10.0 Hilfe: Stil und Tempo stehen in den Funktionen', () => {
  const input = {
    options: {},
    shown: { fiveHour: true, weekly: true, cache: true, storage: true },
    overrides: {},
    storagePath: '',
    hasDrive: false,
    settings: { ...DEFAULT_SETTINGS },
    memTtl: 60 as const,
    memTtlSource: 'Standard' as const,
    keep: null,
    style: 'ring' as const,
    styleByCommand: true,
    noFive: true,
  }
  const de = barsHelpData({ ...input, lang: 'de' })
  expect(de.features[0]!.state).toEqual({ kind: 'on', text: 'an · kein Limit, Tempo-Anzeige · per Einstellung' })
  expect(de.features[4]).toEqual({ name: 'Stil', state: { kind: 'value', text: 'Ringe · per Befehl', isDefault: false }, toggle: '/bars style bar' })
  expect(de.commands.some((c) => c.cmd === '/bars style bar|ring')).toBe(true)
  const en = barsHelpData({ ...input, lang: 'en', style: 'bar', styleByCommand: false, noFive: false })
  expect(en.features[0]!.state).toEqual({ kind: 'on', text: 'on · by setting' })
  expect(en.features[4]).toEqual({ name: 'Style', state: { kind: 'value', text: 'bars · by setting', isDefault: true }, toggle: '/bars style ring' })
  expect(en.settings.find((s) => s.title === 'Style')).toEqual({ title: 'Style', value: 'bar', isDefault: true })
})

// ---------- Review 0.10.0: Wettlauf, Laden, Fehlerpfad ----------

test('0.10.0 Zähler (Review K1): schreibt ein anderer Chat dazwischen eine Messung mit 5h, zählt die eigene Lücke von dort, nicht vom alten Stand', DE, async ($, on) => {
  const w = world(on, { own: week(30) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  // Ein anderer Chat legt eine Messung mit 5h-Fenster ab, die dieser Chat noch nicht übernommen hat (älteres at als die neue eigene)
  w.saved.set('limits', { at: NOW + 1000, wins: [{ kind: 'five_hour', percentUsed: 3, resetsAt: FIVE_RESET }, win(31)] })
  w.st.own = week(34)
  await w.clock.advance(TICK)
  await w.clock.settle()
  // Nur eine Lücke seit der 5h-Messung: miss 1, kein Tempo
  expect((w.saved.get('limits') as { miss?: number }).miss).toBe(1)
  await ui.redraw()
  expect((await svg(ui)).props.alt).not.toContain('Kein 5-Stunden-Limit')
  await ui.unmount()
})

test('0.10.0 Nach dem Laden: eigene neuere Messung ohne 5h zählt vom gemeinsamen miss weiter und legt miss + 1 ab', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['limits', { at: NOW - 5 * MIN, wins: [win(30)], miss: 3 }]])
  const w = world(on, { saved, own: week(34) })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  expect(w.saved.get('limits')).toEqual({ at: NOW, wins: [win(34)], miss: 4 })
  await ui.redraw()
  expect((await svg(ui)).props.alt).toContain('Kein 5-Stunden-Limit')
  await ui.unmount()
})

test('0.10.0 /bars style bei abgelehntem Speichern: gilt in diesem Chat, Hinweis, der Takt überschreibt ihn nicht', DE, async ($, on) => {
  const w = world(on, { own: both(20, 30), denyDisplay: true })
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.settle()
  const text = await bars($, 'style ring')
  expect(text).toContain('Nicht gespeichert (')
  await w.clock.advance(3 * TICK)
  await ui.redraw()
  expect((await svg(ui)).props.source).toContain('>7d</text>')
  expect(w.saved.get('display')).toBeUndefined()
  await ui.unmount()
})

test('0.10.2 Strichfarbe: orange unter dem gleichmäßigen Verbrauch, rot ab Erreichen (ganze Prozent)', () => {
  const opts = { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang: 'de' } as const
  const color = (p: number) => {
    const wk = [win(p)]
    return withPace(shownWindows(wk, NOW, opts), wk, NOW, 'de', true).find((s) => s.tag === '7d')?.markColor
  }
  // gleichmäßig wären 19,6 % → 20 %
  expect(color(10)).toBe(MARK)
  expect(color(19)).toBe(MARK)
  expect(color(20)).toBe(RED)
  expect(color(34)).toBe(RED)
  expect(MARK).toBe(ORANGE)
})

test('0.10.3 Strich ragt oben 5 px und unten 2 px über den Balken hinaus und wird nie abgeschnitten (ein und zwei Balken)', () => {
  const opts = { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang: 'de' } as const
  const wk = [win(34)]
  const bottom = (src: string) => {
    const m = /<rect x="\d+" y="(\d+)" width="2" height="(\d+)"/.exec(src)!
    return Number(m[1]) + Number(m[2])
  }
  const two = desktopSvg(withPace(shownWindows(wk, NOW, opts), wk, NOW, 'de', true))
  expect(two.height).toBe(56)
  expect(bottom(two.source)).toBe(56)
  // nur die Woche, ohne Ring: das Bild wird 2 px höher
  const one = desktopSvg(withPace(shownWindows(wk, NOW, opts), wk, NOW, 'de', false))
  expect(one.height).toBe(26)
  expect(bottom(one.source)).toBe(26)
  expect(two.source).not.toContain('#1A1A1A')
})

test('0.10.4 Rand des Strichs: dunklere Fassung der Strichfarbe', () => {
  expect(darker('#D77757')).toBe('#8C4D39')
  expect(darker('#C9594B')).toBe('#833A31')
  expect(darker('kein')).toBe('kein')
})
