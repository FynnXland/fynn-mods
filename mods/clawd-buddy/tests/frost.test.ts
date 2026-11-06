// clawd-buddy 0.13.0: Eisklumpen und sidekick nach Grund (SPEC „Ausbau 0.13.0“ → Tests).
import { expect, mock, test } from 'claude-code/testing'
import {
  FROST_BREAK_P, FROST_ESTIMATE_MS, FROST_P, FROST_THAW_MS, NO_FACTS, NO_STRAIN, SK_MAX_MS, deriveMood, frostActive, frostDecide, frostMood, frostRoll,
  sidekickStatus, sidekickValue,
} from '../hooks/mood.ts'
import type { Facts, Frost } from '../hooks/mood.ts'
import { createDesk } from '../hooks/desk.ts'
import { ALL_CLIPS, ALL_PROPS } from '../hooks/library.ts'
import { FY, H, POSES } from '../hooks/stage.ts'
import { CLIP_EN, T } from '../hooks/i18n.ts'

const T0 = new Date('2026-11-06T15:00:00').getTime()
const frost = (o: Partial<Frost> = {}): Frost => ({ at: T0, src: 'new', cracks: 0, ...o })
const iced = (o: Partial<Frost> = {}, extra: Partial<Facts> = {}): Facts => ({ ...NO_FACTS, frost: frost(o), ...extra })

// ---- reine Funktionen ------------------------------------------------------------------------------------------------------------

test('Würfel: fester Wurf → bei < 1/3 gefroren, sonst nicht; nie im Turn, höchstens einmal pro Chat, nicht bei Musik', () => {
  const base = { turnActive: false, chatFrozen: false, frozenNow: false, music: false }
  expect(frostDecide(base, 0.2)).toBe('frozen')
  expect(frostDecide(base, FROST_P - 1e-9)).toBe('frozen')
  expect(frostDecide(base, FROST_P)).toBe('no')
  expect(frostDecide(base, 0.9)).toBe('no')
  expect(frostDecide({ ...base, turnActive: true }, 0)).toBe('turn')
  expect(frostDecide({ ...base, chatFrozen: true }, 0)).toBe('already')
  expect(frostDecide({ ...base, frozenNow: true }, 0)).toBe('already')
  expect(frostDecide({ ...base, music: true }, 0)).toBe('music')
  // Der Würfel ist deterministisch (gleiche Uhrzeit, gleicher Wurf) und streut: etwa jedes 3. Mal, beim Senden etwa 3 von 4 zerbrechen
  expect(frostRoll(123456)).toBe(frostRoll(123456))
  let hit = 0
  let brk = 0
  const n = 6000
  for (let i = 0; i < n; i++) {
    const r = frostRoll(T0 + i * 977)
    expect(r >= 0 && r < 1).toBe(true)
    if (r < FROST_P) hit++
    if (frostRoll(T0 + i * 977 + 1) < FROST_BREAK_P) brk++
  }
  expect(Math.abs(hit / n - 1 / 3)).toBeLessThan(0.03)
  expect(Math.abs(brk / n - 3 / 4)).toBeLessThan(0.03)
})

test('Ablauf in der Stimmung: frozen → Risse (Stufen) → gesendet: frost_break/frost_melt mit Riss-Stufe → danach normal', () => {
  expect(deriveMood(iced(), T0 + 100)).toBe('frozen')
  expect(deriveMood(iced({ at: T0 + 5000 }), T0 + 100)).toBe('idle') // Schätzung: noch nicht begonnen
  expect(deriveMood(iced({ cracks: 1 }), T0 + 100)).toBe('frost_crack1')
  expect(deriveMood(iced({ cracks: 3 }), T0 + 100)).toBe('frost_crack3')
  expect(deriveMood(iced({ cracks: 7 }), T0 + 100)).toBe('frost_crack3')
  // Senden: Auftau-Clip vor der Arbeit des Turns, dann Arbeit
  const sent = iced({ cracks: 2, sentAt: T0 + 9000, how: 'break', level: 2 }, { turnActive: true })
  expect(deriveMood(sent, T0 + 9500)).toBe('frost_break2')
  expect(deriveMood(sent, T0 + 9000 + FROST_THAW_MS)).toBe('work_think')
  expect(deriveMood(iced({ sentAt: T0 + 9000, how: 'melt', level: 0 }, { turnActive: true }), T0 + 9500)).toBe('frost_melt')
  expect(deriveMood(iced({ sentAt: T0 + 9000, how: 'melt', level: 3 }), T0 + 9500)).toBe('frost_melt3')
  // Gesendet über sidekick: das Auftauen geht vor der Prüfung bzw. Rückfrage, danach die Prüfung
  const viaSk = iced({ sentAt: T0 + 9000, how: 'break', level: 0 }, { sidekick: { kind: 'check', at: T0 + 9000 } })
  expect(deriveMood(viaSk, T0 + 9500)).toBe('frost_break')
  expect(deriveMood(viaSk, T0 + 14_500)).toBe('sk_check')
  expect(frostMood(iced(), T0 - 1)).toBeNull()
})

test('Vorrang: Rückfrage, Limits und Komprimieren gehen vor dem Eis; im Turn friert er nie ein; Begrüßung entfällt im Eis', () => {
  expect(deriveMood(iced({}, { ask: true }), T0 + 100)).toBe('waitUser')
  expect(deriveMood(iced({}, { limits: { five: 100, fiveReset: T0 + 3_600_000 } }), T0 + 100)).toBe('limit_5h')
  expect(deriveMood(iced({}, { compactSince: T0 }), T0 + 100)).toBe('compact')
  expect(deriveMood(iced({}, { turnActive: true }), T0 + 100)).toBe('work_think')
  // vor dem Fertig-Jubel, dem Tippen und dem Leerlauf
  expect(deriveMood(iced({}, { typingAt: T0 + 50 }), T0 + 100)).toBe('frozen')
  expect(frostActive(iced(), T0 + 100)).toBe(true)
  expect(frostActive(iced({ sentAt: T0 + 50 }), T0 + 100)).toBe(false)
  expect(frostActive(iced({}, { turnActive: true }), T0 + 100)).toBe(false)
  expect(frostActive(iced({ at: T0 + 500 }), T0 + 100)).toBe(false)
  expect(frostActive(NO_FACTS, T0)).toBe(false)
})

test('sidekick nach Grund: jede why-Stimmung, unbekanntes why → sk_stop, hint/upkeep kurz mit Sicherheitsnetz, alte Werte wie bisher', () => {
  for (const why of ['cold', 'wrong', 'model', 'rewrite', 'topic'] as const) {
    const v = sidekickValue({ kind: 'stop', at: T0, why })
    expect(v).toEqual({ kind: 'stop', at: T0, why })
    expect(deriveMood({ ...NO_FACTS, sidekick: v }, T0 + 1000)).toBe(`sk_stop_${why}`)
    expect(ALL_CLIPS.some((c) => c.cat === `sk_stop_${why}`), why).toBe(true)
  }
  expect(sidekickValue({ kind: 'stop', at: T0, why: 'huh' })).toEqual({ kind: 'stop', at: T0 })
  expect(sidekickValue({ kind: 'check', at: T0, why: 'cold' })).toEqual({ kind: 'check', at: T0 }) // Grund nur bei stop
  expect(deriveMood({ ...NO_FACTS, sidekick: sidekickValue({ kind: 'stop', at: T0, why: 42 }) }, T0 + 1000)).toBe('sk_stop')
  expect(deriveMood({ ...NO_FACTS, sidekick: { kind: 'stop', at: T0 } }, T0 + 1000)).toBe('sk_stop')
  expect(sidekickValue({ kind: 'nope', at: T0 })).toBeNull()
  for (const kind of ['hint', 'upkeep'] as const) {
    const f = { ...NO_FACTS, turnActive: true, sidekick: sidekickValue({ kind, at: T0 }) }
    expect(deriveMood(f, T0 + 1000)).toBe(`sk_${kind}`)
    expect(deriveMood(f, T0 + SK_MAX_MS[kind])).toBe('work_think')
  }
  expect(SK_MAX_MS.hint).toBe(4000)
  expect(SK_MAX_MS.upkeep).toBe(5000)
  expect(SK_MAX_MS.stop).toBe(600_000)
  // sidekick.status: nur level und cold, streng
  expect(sidekickStatus({ level: 'cache', busy: false, cold: true, tip: 'x' })).toEqual({ level: 'cache', cold: true })
  expect(sidekickStatus({ level: 'guide', busy: true })).toEqual({ level: 'guide', cold: false })
  expect(sidekickStatus({ level: 'off', busy: false })).toEqual({ level: 'off', cold: false })
  expect(sidekickStatus({ level: 'max', busy: false })).toBeNull()
  expect(sidekickStatus({ level: 'cache', cold: 'yes' })).toEqual({ level: 'cache', cold: false })
  expect(sidekickStatus(null)).toBeNull()
  expect(sidekickStatus('cache')).toBeNull()
})

test('Clips: Gruppe frost und die neuen sidekick-Gruppen vollständig, Pose ice mit Block, englische Bezeichnungen, Block passt in 14 Zeilen', () => {
  const cat = (c: string) => ALL_CLIPS.filter((x) => x.cat === c).map((x) => x.name)
  expect(cat('frost_in').length).toBeGreaterThanOrEqual(2)
  expect(cat('frozen').sort()).toEqual(['frozen', 'frozen_sleep'])
  expect(cat('frost_crack').sort()).toEqual(['frost_crack1', 'frost_crack2', 'frost_crack3'])
  expect(cat('frost_break').sort()).toEqual(['frost_break', 'frost_break1', 'frost_break2', 'frost_break3'])
  expect(cat('frost_melt').sort()).toEqual(['frost_melt', 'frost_melt1', 'frost_melt2', 'frost_melt3'])
  expect(cat('sk_stop_cold').length).toBeGreaterThanOrEqual(2)
  expect(cat('sk_upkeep').length).toBeGreaterThanOrEqual(2)
  for (const c of ['sk_stop_wrong', 'sk_stop_model', 'sk_stop_rewrite', 'sk_stop_topic', 'sk_hint']) expect(cat(c).length, c).toBeGreaterThanOrEqual(1)
  expect(POSES.ice.props.map((p) => p[0])).toEqual(['frost_ice0', 'frost_fx0'])
  for (const c of ALL_CLIPS.filter((x) => x.name.startsWith('frost') || x.cat.startsWith('sk_'))) expect(CLIP_EN[c.name], c.name).toBeTruthy()
  // frozen nur tags, frozen_sleep nur nachts; der Block (Ursprung y −2, 13 Zeilen inkl. der verdeckten) endet auf der Linie
  expect(ALL_CLIPS.find((c) => c.name === 'frozen')?.when).toBe('day')
  expect(ALL_CLIPS.find((c) => c.name === 'frozen_sleep')?.when).toBe('night')
  const ice = POSES.ice.props[0]
  const rows = ALL_PROPS[ice[0]].rows.length
  expect(FY + ice[2] + rows - 1, 'unterste Zeile des Blocks liegt eine Zeile unter der Linie (verdeckt)').toBe(H)
  expect(FY + ice[2], 'Oberkante auf der Bühne (kein Rand oben)').toBeGreaterThan(0)
})

// ---- Ablauf über die Engine (Desktop-Antrieb: deriveMood + Engine, wie im Mod) ----------------------------------------------

function run(facts: (t: number) => Facts, ms: number, o: { reduced?: boolean; hour?: number; seed?: number } = {}) {
  const t0 = new Date(`2026-11-06T${String(o.hour ?? 15).padStart(2, '0')}:00:00`).getTime()
  const d = createDesk({ seed: o.seed ?? 5, nightStart: 23, nightEnd: 6, idleSeconds: 45, reduced: o.reduced ?? false, flip: false })
  d.advance(t0, facts(0), NO_STRAIN) // setzt nur die Uhr
  const seen: string[] = []
  for (let t = 75; t <= ms; t += 75) {
    d.advance(t0 + t, facts(t), NO_STRAIN)
    const n = d.engine.S.play?.clip.name
    if (n && seen[seen.length - 1] !== n) seen.push(n)
  }
  return { seen, d, t0 }
}
const at = (t0: number, o: Partial<Frost> = {}) => ({ at: t0 + 1000, src: 'new' as const, cracks: 0, ...o })

test('Engine: Einfrieren über frost_in (zittern) in die Pose ice, Schleife frozen; Risse; Senden zerbricht bzw. schmilzt zur Riss-Stufe', { timeoutMs: 60000 }, () => {
  const T = new Date('2026-11-06T15:00:00').getTime()
  const facts = (t: number): Facts => {
    const fr: Frost = at(T, { cracks: t >= 16_000 ? 2 : t >= 12_000 ? 1 : 0, ...(t >= 22_000 ? { sentAt: T + 22_000, how: 'break' as const, level: 2 } : {}) })
    return { ...NO_FACTS, frost: fr, turnActive: t >= 22_000 }
  }
  const { seen } = run(facts, 30_000)
  const i = seen.findIndex((n) => ALL_CLIPS.find((c) => c.name === n)?.cat === 'frost_in')
  expect(i, seen.join(' → ')).toBeGreaterThanOrEqual(0)
  expect(seen.indexOf('freeze'), 'kein ruhiger Übergang ohne weniger Bewegung').toBe(-1)
  const rest = seen.slice(i + 1)
  expect(rest[0], seen.join(' → ')).toBe('frozen')
  expect(rest.indexOf('frost_crack1'), seen.join(' → ')).toBeGreaterThan(0)
  expect(rest.indexOf('frost_crack2'), seen.join(' → ')).toBeGreaterThan(rest.indexOf('frost_crack1'))
  expect(rest.indexOf('frost_break2'), seen.join(' → ')).toBeGreaterThan(rest.indexOf('frost_crack2'))
  // zwischen Einfrieren und Auftauen nie aufgetaut
  expect(rest.slice(0, rest.indexOf('frost_break2')).includes('thaw'), seen.join(' → ')).toBe(false)
  // danach Arbeit
  expect(rest.slice(rest.indexOf('frost_break2') + 1).some((n) => n.startsWith('think') || ALL_CLIPS.find((c) => c.name === n)?.cat === 'work_think'), seen.join(' → ')).toBe(true)
  // Schmelzen ohne Risse
  const melt = run((t) => ({ ...NO_FACTS, frost: at(T, t >= 9000 ? { sentAt: T + 9000, how: 'melt', level: 0 } : {}), turnActive: t >= 9000 }), 16_000)
  expect(melt.seen.includes('frost_melt'), melt.seen.join(' → ')).toBe(true)
})

test('Engine: weniger Bewegung friert ruhig ein und taut ruhig auf (ohne Splitter, ohne Schütteln); nachts schläft er im Eis', { timeoutMs: 60000 }, () => {
  const T = new Date('2026-11-06T15:00:00').getTime()
  const facts = (t: number): Facts => ({ ...NO_FACTS, frost: at(T, t >= 10_000 ? { sentAt: T + 10_000, how: 'break', level: 0 } : {}), turnActive: t >= 10_000 })
  const calm = run(facts, 16_000, { reduced: true })
  expect(calm.seen.includes('frost_creep'), calm.seen.join(' → ')).toBe(true)
  expect(calm.seen.includes('thaw'), calm.seen.join(' → ')).toBe(true)
  expect(calm.seen.some((n) => n.startsWith('frost_break') || n === 'frost_shiver'), calm.seen.join(' → ')).toBe(false)
  const Tn = new Date('2026-11-06T01:00:00').getTime()
  const night = run(() => ({ ...NO_FACTS, frost: at(Tn) }), 12_000, { hour: 1 })
  expect(night.seen.includes('frozen_sleep'), night.seen.join(' → ')).toBe(true)
  expect(night.seen.includes('frozen'), night.seen.join(' → ')).toBe(false)
})

test('Engine: Begrüßung nach langer Pause entfällt im Eis; ohne Eis kommt sie', () => {
  const T = new Date('2026-11-06T15:00:00').getTime()
  const welcomed = (withIce: boolean) => {
    const d = createDesk({ seed: 5, nightStart: 23, nightEnd: 6, idleSeconds: 45, reduced: false, flip: false })
    const f: Facts = { ...NO_FACTS, backAt: T + 500, ...(withIce ? { frost: { at: T, src: 'new', cracks: 0 } } : {}) }
    d.advance(T, f, NO_STRAIN)
    d.advance(T + 1000, f, NO_STRAIN)
    return d.engine.S.welcome || d.engine.S.queue.some((x) => x.name === 'rub_eyes') || d.engine.S.play?.clip.name === 'rub_eyes'
  }
  expect(welcomed(false)).toBe(true)
  expect(welcomed(true)).toBe(false)
})

test('Desktop: frozen als Schleife ohne Sprung (gleiche Fakten weichen nicht ab); Auftauen nach fremder Neuzeichnung vom gezeigten Bild aus', () => {
  const T = new Date('2026-11-06T15:00:00').getTime()
  const f: Facts = { ...NO_FACTS, frost: { at: T, src: 'new', cracks: 0 } }
  const d = createDesk({ seed: 5, nightStart: 23, nightEnd: 6, idleSeconds: 45, reduced: false, flip: false })
  d.draw(T, f, NO_STRAIN, 4)
  // im Eis angekommen (frost_in fertig), dann zeichnet ein fremder Mod mehrfach neu: die Animation rechnet vom gezeigten Bild weiter
  for (let t = 6000; t <= 12_000; t += 1500) {
    expect(d.divergence(T + t, f, NO_STRAIN), `t=${t}`).toBeGreaterThan(1000)
    d.draw(T + t, f, NO_STRAIN, 4)
    expect(d.engine.S.landing === 'ice' || d.engine.S.play?.clip.from === 'ice', `t=${t}`).toBe(true)
  }
  // Senden: weicht sofort ab, und der Auftau-Clip beginnt aus dem Eis
  const sent: Facts = { ...f, turnActive: true, frost: { at: T, src: 'new', cracks: 0, sentAt: T + 12_750, how: 'break', level: 0 } }
  expect(d.divergence(T + 12_750, sent, NO_STRAIN)).toBe(0)
  d.draw(T + 12_750, sent, NO_STRAIN, 4)
  let seenBreak = false
  for (let t = 12_825; t <= 16_000 && !seenBreak; t += 75) {
    d.catchUp(T + t)
    if (d.engine.S.play?.clip.name === 'frost_break') seenBreak = true
  }
  expect(seenBreak).toBe(true)
})

// ---- im Mod ---------------------------------------------------------------------------------------------------------------------

const BAND = {
  plugin: 'clawd-buddy',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 30, isFullscreen: true },
  props: { hasSurvey: false, isWorking: false, maxRows: 7, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 }, view: {} },
} as const

function base(on: any, state: () => Record<string, unknown> = () => ({})) {
  const store = new Map<string, unknown>()
  on('store.get', ($: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('state.set', () => ({ value: undefined }) as never)
  on('state.get', ($: unknown, e: any) => {
    const v = state()[`${e.plugin}.${e.key}`]
    return { value: { value: v, version: v === undefined ? 0 : 1 } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.edit', ($: unknown, e: any) => ({ text: e.text, cursor: e.cursor }))
}
const clientFacts = async (ui: any): Promise<Facts> => (await ui.find({ type: 'Client', key: 'buddy' }))?.props.props.facts
const status = async ($: any): Promise<string> => (await $.command.run({ command: 'clawd', args: 'status' })).text
const edit = ($: any, text: string) => $.prompt.edit({ text, inputText: text.slice(-1), cursor: text.length, start: text.length - 1, end: text.length - 1 } as any)
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Feste Würfe (frostRoll hängt an der Uhrzeit): um T0 bleibt ein neuer Chat warm (0,88), um T0 + 1 s friert er ein (0,29), um T0 + 2 s
// ebenso (0,15), um T0 + 4 s nicht (0,56). Die Schätzung würfelt mit Beginn + 60 min: nach einem Turn-Ende um T0 + 1 s trifft sie (0,18),
// um T0 + 4 s nicht (0,99). Der Test „Würfel-Zeiten“ unten sichert diese Annahmen.
const HIT = T0 + 1000
const HIT2 = T0 + 2000
const MISS = T0
const MISS2 = T0 + 4000

test('Würfel-Zeiten der Mod-Tests (feste Uhr)', () => {
  expect(frostRoll(MISS)).toBeGreaterThanOrEqual(FROST_P)
  expect(frostRoll(HIT)).toBeLessThan(FROST_P)
  expect(frostRoll(HIT2)).toBeLessThan(FROST_P)
  expect(frostRoll(MISS2)).toBeGreaterThanOrEqual(FROST_P)
  expect(frostRoll(HIT + FROST_ESTIMATE_MS)).toBeLessThan(FROST_P)
  expect(frostRoll(MISS2 + FROST_ESTIMATE_MS)).toBeGreaterThanOrEqual(FROST_P)
})

const done = (id: string) => ({ answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', turnId: id }) as any

test('Im Mod (fester Wurf): Treffer friert ein und zählt für den Chat; danach weder eigene Schätzung noch sidekick-Moment', async ($, on) => {
  const clock = mock.clock(on, { now: HIT })
  let st: Record<string, unknown> = {}
  base(on, () => st)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await status($)).toMatch(/Ice: new chat, rolled: yes, frozen; frozen in this chat: yes\./)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await clientFacts(ui)).frost).toEqual({ at: HIT, src: 'new', cracks: 0 })
  expect(deriveMood(await clientFacts(ui), HIT + 100)).toBe('frozen')
  // Senden nach der Schonfrist: taut auf
  await clock.advance(3000)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await ui.redraw()
  expect(typeof (await clientFacts(ui)).frost?.sentAt).toBe('number')
  // Turn-Ende: keine eigene Schätzung mehr in diesem Chat
  await $.turn.complete(done('t1'))
  expect(await status($)).toMatch(/Ice: new chat, rolled: yes, frozen; frozen in this chat: yes\./)
  // sidekick meldet kalt (um T0 + 2 s wäre das ein Treffer): in diesem Chat schon gefroren
  st = { 'sidekick.status': { level: 'cache', busy: false, cold: true } }
  await ui.redraw()
  expect(await status($)).toMatch(/Ice: sidekick says cold, rolled: no, already frozen in this chat; frozen in this chat: yes\./)
  await ui.unmount()
})

test('Im Mod (fester Wurf): Niete; die eigene Schätzung trifft und friert nach 60 min ein; ein Turn davor hebt sie auf', async ($, on) => {
  const clock = mock.clock(on, { now: MISS })
  base(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await status($)).toMatch(/Ice: new chat, rolled: yes, stays warm; frozen in this chat: no\./)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await clientFacts(ui)).frost).toBeUndefined()
  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(1000)
  await $.turn.complete(done('t1'))
  expect(await status($)).toMatch(/Ice: own estimate \(60 min\), rolled: yes, freezes at 16:00; frozen in this chat: no\./)
  await ui.redraw()
  let f = await clientFacts(ui)
  expect(f.frost).toEqual({ at: HIT + FROST_ESTIMATE_MS, src: 'estimate', cracks: 0 })
  expect(deriveMood(f, HIT + FROST_ESTIMATE_MS - 1)).not.toBe('frozen')
  expect(deriveMood(f, HIT + FROST_ESTIMATE_MS)).toBe('frozen')
  // Ein neuer Turn vor Ablauf: der kalte Moment kommt nicht
  await $.turn.start({ text: 'b', turnId: 't2' })
  await ui.redraw()
  expect((await clientFacts(ui)).frost).toBeUndefined()
  // Wieder geplant (gleiche Uhrzeit, gleicher Wurf), dann vergehen 60 min: er steht im Eis, das zählt für den Chat
  await $.turn.complete(done('t2'))
  await clock.advance(FROST_ESTIMATE_MS)
  await ui.redraw()
  f = await clientFacts(ui)
  expect(deriveMood(f, clock.now())).toBe('frozen')
  expect(await status($)).toMatch(/Ice: own estimate \(60 min\), rolled: yes, frozen; frozen in this chat: yes\./)
  await ui.unmount()
})

test('Im Mod: /clawd freeze friert sofort ein (ohne Würfel, zählt nicht für den Chat), Tippen macht Risse je Schub, Senden zerbricht/schmilzt', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: MISS })
  base(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const res = await $.command.run({ command: 'clawd', args: 'freeze' })
  expect(res.text).toMatch(/frozen/)
  await ui.redraw()
  let f = await clientFacts(ui)
  expect(f.frost).toEqual({ at: MISS, src: 'manual', cracks: 0 })
  expect(await status($)).toMatch(/Ice: \/clawd freeze, rolled: no, frozen; frozen in this chat: no\./)
  // Tippen: der erste Schub macht eine Stufe, schnelles Weitertippen nicht, nach einer Pause die nächste
  await edit($, 'h')
  await edit($, 'ha')
  await ui.redraw()
  expect((await clientFacts(ui)).frost?.cracks).toBe(1)
  await pause(1300)
  await edit($, 'hal')
  await ui.redraw()
  expect((await clientFacts(ui)).frost?.cracks).toBe(2)
  // Senden (nach der Schonfrist von 1,5 s): gesendet mit Riss-Stufe 2, zerbricht oder schmilzt (fester Wurf)
  await clock.advance(3000)
  await $.turn.start({ text: 'hallo', turnId: 't1' })
  await ui.redraw()
  f = await clientFacts(ui)
  expect(f.frost?.sentAt).toBe(MISS + 3000)
  expect(f.frost?.how).toBe(frostRoll(MISS + 1) < FROST_BREAK_P ? 'break' : 'melt')
  expect(f.frost?.level).toBe(2)
  expect(deriveMood(f, MISS + 3100)).toBe(`frost_${f.frost?.how}2`)
  // /clawd freeze zählt nicht für „einmal pro Chat“
  expect(await status($)).toMatch(/frozen in this chat: no\./)
  await ui.unmount()
})

test('Im Mod: sidekick.status cold beginnt einen kalten Moment (nur der Wechsel auf true); ein brauchbarer Wert ersetzt die eigene Schätzung; sidekick stop zählt als gesendet', async ($, on) => {
  const clock = mock.clock(on, { now: MISS })
  let st: Record<string, unknown> = {}
  base(on, () => st)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Ohne sidekick: nach einem Turn plant er die eigene Schätzung (Treffer)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await clock.advance(1000)
  await $.turn.complete(done('t1'))
  await ui.redraw()
  expect((await clientFacts(ui)).frost?.src).toBe('estimate')
  // sidekick meldet sich (cache, nicht kalt): die geplante Schätzung entfällt, auch in der Status-Zeile
  st = { 'sidekick.status': { level: 'cache', busy: false } }
  await ui.redraw()
  expect((await clientFacts(ui)).frost).toBeUndefined()
  expect(await status($)).toMatch(/Ice: no cold moment yet; frozen in this chat: no\./)
  // Nach einem weiteren Turn keine eigene Schätzung
  await $.turn.start({ text: 'b', turnId: 't2' })
  await $.turn.complete(done('t2'))
  expect(await status($)).toMatch(/Ice: no cold moment yet;/)
  // sidekick meldet kalt (um T0 + 2 s: Treffer)
  await clock.advance(1000)
  st = { 'sidekick.status': { level: 'cache', busy: false, cold: true } }
  await ui.redraw()
  expect(await status($)).toMatch(/Ice: sidekick says cold, rolled: yes, frozen; frozen in this chat: yes\./)
  expect((await clientFacts(ui)).frost).toEqual({ at: HIT2, src: 'sidekick', cracks: 0 })
  // Bleibt cold stehen, beginnt kein weiterer Moment
  const before = await status($)
  await ui.redraw()
  expect(await status($)).toBe(before)
  // sidekick fragt nach dem Senden (Kalt-Cache-Frage): zählt als gesendet, danach die Rückfrage mit Grund
  await clock.advance(3000)
  st = { 'sidekick.status': { level: 'cache', busy: false, cold: true }, 'sidekick.buddy': { kind: 'stop', at: clock.now(), why: 'cold' } }
  await ui.redraw()
  const f = await clientFacts(ui)
  expect(f.frost?.sentAt).toBe(HIT2 + 3000)
  expect(f.sidekick).toEqual({ kind: 'stop', at: HIT2 + 3000, why: 'cold' })
  expect(deriveMood(f, HIT2 + 3100)).toMatch(/^frost_(break|melt)$/)
  expect(deriveMood(f, HIT2 + 3000 + FROST_THAW_MS)).toBe('sk_stop_cold')
  await ui.unmount()
})

test('Im Mod: Musik schon beim Start oder bei /clear verhindert ein neues Einfrieren; ohne Musik würfelt /clear neu; level off zählt wie kein sidekick; resume ist kein neuer Chat', async ($, on) => {
  const clock = mock.clock(on, { now: HIT })
  let st: Record<string, unknown> = { 'tune-strip.playing': { playing: true } }
  base(on, () => st)
  // Start mit Musik (um T0 + 1 s wäre es ein Treffer): kein Eis, auch ohne vorherige Zeichnung (Review S2)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await status($)).toMatch(/Ice: new chat, rolled: no, music is playing, no freezing; frozen in this chat: no\./)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await clientFacts(ui)).frost).toBeUndefined()
  await $.classic.SessionStart({ source: 'clear' })
  expect(await status($)).toMatch(/music is playing/)
  // Ohne Musik (sidekick auf off, kalt zählt nicht): /clear würfelt, Treffer
  st = { 'sidekick.status': { level: 'off', busy: false, cold: true } }
  await ui.redraw()
  await $.classic.SessionStart({ source: 'clear' })
  expect(await status($)).toMatch(/Ice: new chat, rolled: yes, frozen; frozen in this chat: yes\./)
  await clock.advance(3000)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.turn.complete(done('t1'))
  // Neuer Chat um T0 + 4 s: Niete; nach einem Turn plant er (level off = kein sidekick) die eigene Schätzung, die nicht trifft
  await $.classic.SessionStart({ source: 'clear' })
  expect(await status($)).toMatch(/Ice: new chat, rolled: yes, stays warm; frozen in this chat: no\./)
  await $.turn.start({ text: 'b', turnId: 't2' })
  await $.turn.complete(done('t2'))
  expect(await status($)).toMatch(/Ice: own estimate \(60 min\), rolled: yes, stays warm; frozen in this chat: no\./)
  // resume ohne Cache-Feld (0.13.1: wie 0.13.0): kein neuer Moment
  const before = await status($)
  await $.classic.SessionStart({ source: 'resume' })
  expect(await status($)).toBe(before)
  await ui.unmount()
})

// ---- 0.13.1: fortgesetzter Chat nach Cache-Stand (SPEC „Nachtrag 0.13.1“)
const resume = ($: { classic: { SessionStart: (i: { source: 'resume' | 'fork'; prompt_cache_likely_expired?: boolean }) => Promise<unknown> } }, source: 'resume' | 'fork', expired: boolean) =>
  $.classic.SessionStart({ source, prompt_cache_likely_expired: expired })

test('0.13.1: resume mit abgelaufenem Cache würfelt (Treffer friert ein, zählt für den Chat); ein Eis aus dem Chat davor zählt nicht', async ($, on) => {
  const clock = mock.clock(on, { now: MISS })
  let st: Record<string, unknown> = {}
  base(on, () => st)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Eis im ersten Chat (um T0 + 1 s per /clear ein Treffer)
  await clock.advance(1000)
  await $.classic.SessionStart({ source: 'clear' })
  expect(await status($)).toMatch(/frozen in this chat: yes\./)
  // /resume in der Sitzung um T0 + 2 s, Cache abgelaufen: ein anderer Chat, neuer Wurf (Treffer)
  await clock.advance(1000)
  await resume($, 'resume', true)
  expect(await status($)).toMatch(/Ice: resumed chat, rolled: yes, frozen; frozen in this chat: yes\./)
  await ui.redraw()
  const f = await clientFacts(ui)
  expect(f.frost).toEqual({ at: HIT2, src: 'resume', cracks: 0 })
  expect(deriveMood(f, HIT2 + 100)).toBe('frozen')
  // sidekick meldet danach kalt: im fortgesetzten Chat schon gefroren, kein zweites Eis
  st = { 'sidekick.status': { level: 'cache', busy: false, cold: true } }
  await ui.redraw()
  expect(await status($)).toMatch(/Ice: sidekick says cold, rolled: no, already frozen in this chat;/)
  await ui.unmount()
})

test('0.13.1: resume mit warmem Cache ist kein kalter Moment und hebt ein Eis aus session.start auf', async ($, on) => {
  mock.clock(on, { now: HIT })
  base(on)
  // session.start zuerst (Treffer als „neuer Chat“), dann die resume-Meldung: warm
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await status($)).toMatch(/Ice: new chat, rolled: yes, frozen;/)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await resume($, 'resume', false)
  expect(await status($)).toMatch(/Ice: resumed chat, rolled: no, cache still warm; frozen in this chat: no\./)
  await ui.redraw()
  expect((await clientFacts(ui)).frost).toBeUndefined()
  await ui.unmount()
})

test('0.13.1: resume vor session.start bleibt bestehen (Reihenfolge nicht dokumentiert), fork mit abgelaufenem Cache und Niete bleibt warm', async ($, on) => {
  const clock = mock.clock(on, { now: HIT })
  base(on)
  // Kalt, Treffer: session.start danach würfelt nicht neu und setzt nichts zurück
  await resume($, 'resume', true)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await status($)).toMatch(/Ice: resumed chat, rolled: yes, frozen; frozen in this chat: yes\./)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await clientFacts(ui)).frost).toEqual({ at: HIT, src: 'resume', cracks: 0 })
  // fork um T0 + 4 s, Cache abgelaufen: gewürfelt, Niete
  await clock.advance(3000)
  await resume($, 'fork', true)
  expect(await status($)).toMatch(/Ice: resumed chat, rolled: yes, stays warm; frozen in this chat: no\./)
  await ui.redraw()
  expect((await clientFacts(ui)).frost).toBeUndefined()
  await ui.unmount()
})

test('0.13.1: warm gemeldet vor session.start: auch danach kein Eis', async ($, on) => {
  mock.clock(on, { now: HIT })
  base(on)
  await resume($, 'resume', false)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(await status($)).toMatch(/Ice: resumed chat, rolled: no, cache still warm; frozen in this chat: no\./)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await clientFacts(ui)).frost).toBeUndefined()
  await ui.unmount()
})

test('0.13.1: Musik verhindert das Einfrieren auch beim resume (gelesen vor dem Wurf)', async ($, on) => {
  mock.clock(on, { now: HIT })
  base(on, () => ({ 'tune-strip.playing': { playing: true } }))
  await resume($, 'resume', true)
  expect(await status($)).toMatch(/Ice: resumed chat, rolled: no, music is playing, no freezing;/)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await clientFacts(ui)).frost).toBeUndefined()
  await ui.unmount()
})

test('0.13.1: deutsche Eis-Zeile für den fortgesetzten Chat', () => {
  const de = T.de.frost({ src: 'resume', rolled: false, result: 'warm', at: '', chat: false })
  expect(de).toBe('Eis: fortgesetzter Chat, gewürfelt: nein, Cache noch warm; in diesem Chat gefroren: nein.')
})

const deskSvg = async (ui: any): Promise<string> => {
  const els = (await ui.findAll({ type: 'Svg' })).filter((s: any) => s.props.alt !== '')
  expect(els.length).toBe(1)
  return els[0].props.source as string
}

test('Desktop: sidekick kalt, Risse beim Tippen, Senden über sidekick check und /clawd freeze zeichnen ein neues Svg', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: MISS })
  let st: Record<string, unknown> = {}
  base(on, () => st)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const s0 = await deskSvg(ui)
  // sidekick meldet kalt (Treffer um T0 + 2 s), gelesen im Desktop-Zweig
  await clock.advance(2000)
  st = { 'sidekick.status': { level: 'guide', busy: false, cold: true } }
  await ui.redraw()
  expect(await status($)).toMatch(/Ice: sidekick says cold, rolled: yes, frozen;/)
  const s1 = await deskSvg(ui)
  expect(s1).not.toBe(s0)
  // Zur selben Uhrzeit noch einmal gezeichnet: byte-gleich
  await ui.redraw()
  expect(await deskSvg(ui)).toBe(s1)
  // Tippen (erster Schub): Riss-Stufe 1, neue Animation
  await edit($, 'h')
  await ui.redraw()
  const s2 = await deskSvg(ui)
  expect(s2).not.toBe(s1)
  await pause(1300)
  await edit($, 'ha')
  await ui.redraw()
  const s3 = await deskSvg(ui)
  expect(s3).not.toBe(s2)
  // Senden über sidekick check
  await clock.advance(3000)
  st = { 'sidekick.status': { level: 'guide', busy: true }, 'sidekick.buddy': { kind: 'check', at: clock.now() } }
  await ui.redraw()
  const s4 = await deskSvg(ui)
  expect(s4).not.toBe(s3)
  // /clawd freeze im Desktop: neues Svg
  await clock.advance(5000)
  await ui.redraw()
  const s5 = await deskSvg(ui)
  expect((await $.command.run({ command: 'clawd', args: 'freeze' })).text).toMatch(/frozen/)
  await ui.redraw()
  expect(await deskSvg(ui)).not.toBe(s5)
  await ui.unmount()
})

test('Im Mod: /clawd freeze ohne Uhr antwortet mit eigener Meldung (Review K2)', async ($, on) => {
  let broken = false
  on('clock.now', () => {
    if (broken) throw new Error('keine Uhr')
    return { value: MISS }
  })
  base(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  broken = true
  expect((await $.command.run({ command: 'clawd', args: 'freeze' })).text).toMatch(/could not freeze/)
})

test('Im Mod: Hilfe und Liste kennen freeze und die Gruppe frost; deutsch mit Eis-Zeile', { options: { language: 'de' } }, async ($, on) => {
  mock.clock(on, { now: MISS })
  base(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const list = (await $.command.run({ command: 'clawd', args: 'list' })).text
  expect(list).toMatch(/^frost_in: /m)
  expect(list).toMatch(/^frozen: frozen, frozen_sleep$/m)
  expect(list).toMatch(/^sk_stop_wrong: sk_map_lost$/m)
  expect((await $.command.run({ command: 'clawd', args: 'demo frost_break' })).text).toMatch(/spielt: frost_break/)
  expect((await $.command.run({ command: 'clawd', args: 'help' })).text).toMatch(/\/clawd freeze/)
  expect(await status($)).toMatch(/Eis: neuer Chat, gewürfelt: ja, bleibt warm; in diesem Chat gefroren: nein\./)
  expect((await $.command.run({ command: 'clawd', args: 'freeze' })).text).toMatch(/eingefroren/)
})
