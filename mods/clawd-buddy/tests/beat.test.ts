// clawd-buddy 0.11.0: Im Takt des Songs (SPEC Nachtrag 0.11.0 → Tests). Engine und Raster ohne `$`; der Mod-Teil liest tune-strip.beat.
import { expect, mock, test } from 'claude-code/testing'
import { ALL_CLIPS, ALL_PROPS } from '../hooks/library.ts'
import { mulberry32 } from '../hooks/capture.ts'
import { createEngine } from '../hooks/engine.ts'
import type { BeatGrid, Engine, MusicGroup } from '../hooks/engine.ts'
import { createDesk } from '../hooks/desk.ts'
import { NO_FACTS, NO_STRAIN, beatGrid, beatValue } from '../hooks/mood.ts'
import type { BeatValue } from '../hooks/mood.ts'
import { TICK } from '../hooks/stage.ts'
import { lintFrames } from '../hooks/lint.ts'
import { captureClip } from '../hooks/capture.ts'

const LIB = { clips: ALL_CLIPS, props: ALL_PROPS }
const engine = (seed: number, hour = 15, temper = 0) => {
  const e = createEngine({ clips: LIB.clips, props: LIB.props, rng: mulberry32(seed), hour, idleSeconds: 6 })
  e.start()
  e.set({ music: true, temper })
  return e
}
const gridOf = (bpm: number, offsetTicks = 0.37): BeatGrid => ({ t0: offsetTicks, per: 60000 / bpm / TICK })

/** Laufendes Bild der Engine: Schlaglänge und Lage, oder nichts. */
function frameNow(e: Engine) {
  const pl = e.S.play
  if (!pl || pl.phase === 'end') return null
  const f = pl[pl.phase][pl.fi]
  return f ? { key: `${pl.clip.name}:${pl.phase}:${pl.fi}`, b: f.b, bf: f.bf, by: f.p.by, clip: pl.clip.name } : null
}

/**
 * Ticks, an denen ein Schlag-Bild auf dem Schlag beginnt (`tick === 0`: das Bild ist in diesem Takt neu), über `ticks` Takte.
 * `downOnly`: nur Abschläge (Körper tiefer); nachts dauern Ab- und Aufschlag je einen ganzen Schlag und beginnen beide auf einem.
 */
function downStarts(e: Engine, ticks: number, downOnly = false): { at: number; clip: string }[] {
  const out: { at: number; clip: string }[] = []
  for (let t = 0; t < ticks; t++) {
    e.tick()
    const f = frameNow(e)
    if (f && f.b && f.bf === 0 && e.S.play!.tick === 0 && (!downOnly || f.by === 1)) out.push({ at: e.S.ticks, clip: f.clip })
  }
  return out
}
const offGrid = (tick: number, g: BeatGrid): number => {
  const x = (tick - g.t0) / g.per
  return Math.abs(x - Math.round(x)) * g.per
}

// ---------- beatValue ----------

// 0.12.1: Svgs der Figur; der durchsichtige Höhen-Halter (alt leer) zählt nicht
const figures = async (u: any): Promise<any[]> => (await u.findAll({ type: 'Svg' })).filter((s: any) => s.props.alt !== '')

test('beatValue: gültig, Grenzen; Müll oder ein fremder Mod mit Unsinn → ohne Takt', () => {
  const ok: BeatValue = { bpm: 123.4, at: 1_793_800_000_000, sure: true, group: 'groove' }
  expect(beatValue(ok)).toEqual(ok)
  expect(beatValue({ ...ok, bpm: 60 })).toBeDefined()
  expect(beatValue({ ...ok, bpm: 150 })).toBeDefined()
  expect(beatValue({ ...ok, group: null })).toEqual({ ...ok, group: null })
  expect(beatValue({ ...ok, group: 'sad' })).toEqual({ ...ok, group: 'sad' })
  const bad: unknown[] = [
    null, undefined, 0, 'beat', [], {}, { ...ok, bpm: 59.9 }, { ...ok, bpm: 150.1 }, { ...ok, bpm: '120' }, { ...ok, bpm: NaN },
    { ...ok, at: Infinity }, { ...ok, at: '1' }, { ...ok, sure: 'yes' }, { ...ok, sure: 1 }, { ...ok, group: 'rock' }, { ...ok, group: undefined },
  ]
  for (const v of bad) expect(beatValue(v), JSON.stringify(v)).toBeUndefined()
  // Titel o. Ä., den ein fremder Mod dazuschreibt, fällt heraus
  expect(beatValue({ ...ok, title: 'Hey Jude' })).toEqual(ok)
})

test('beatGrid: nur mit sicherem Takt; der Schlag `at` landet auf dem Tick, der zu dieser Uhrzeit gezeigt wird', () => {
  const b: BeatValue = { bpm: 120, at: 10_000, sure: true, group: null }
  expect(beatGrid({ ...b, sure: false }, 10_000, 5, TICK)).toBeNull()
  expect(beatGrid(undefined, 10_000, 5, TICK)).toBeNull()
  const g = beatGrid(b, 10_000 + 3 * TICK, 50, TICK)!
  expect(Math.abs(g.t0 - 47)).toBeLessThan(1e-9)
  expect(Math.abs(g.per - 500 / TICK)).toBeLessThan(1e-9)
})

// ---------- Raster ----------

for (const bpm of [97, 123.4, 149]) {
  test(`Raster bei ${bpm} bpm: über 64 Schläge liegt jede Schlaggrenze höchstens ½ Tick neben dem echten Schlag, keine Drift; mit festen Takten (0.9.x) nicht`, { timeoutMs: 60000 }, () => {
    const g = gridOf(bpm)
    const e = engine(4)
    e.set({ beat: g, group: 'calm' })
    e.play('music_bob')
    e.S.gallery = null // wie nach /clawd demo: ab jetzt wählt die Engine selbst (die Demo läuft im festen Tempo)
    // Zwischendurch wechselt er den Clip (Intro ohne Schlag, ab und zu Atmen statt Musik): so lange messen, bis 64 Schläge überspannt sind
    const starts: { at: number; clip: string }[] = []
    let per64 = 0
    while (per64 < 400 * g.per && (starts.length < 2 || (starts[starts.length - 1]!.at - starts[0]!.at) / g.per < 64)) {
      starts.push(...downStarts(e, Math.ceil(8 * g.per)))
      per64 += Math.ceil(8 * g.per)
    }
    expect(starts.length, 'Abschläge gezählt').toBeGreaterThanOrEqual(40)
    expect((starts[starts.length - 1]!.at - starts[0]!.at) / g.per, 'Spanne in Schlägen').toBeGreaterThanOrEqual(64)
    for (const s of starts) expect(offGrid(s.at, g), `Tick ${s.at} (${s.clip})`).toBeLessThanOrEqual(0.5 + 1e-9)
    // Gegenprobe: dieselben Clips ohne Raster laufen im festen Tempo und liegen bald daneben
    const f = engine(4)
    f.play('music_bob')
    f.S.gallery = null
    const fixed = downStarts(f, per64)
    expect(Math.max(...fixed.map((s) => offGrid(s.at, g))), 'feste Takte driften').toBeGreaterThan(0.5)
  })
}

test('Einsetzen auf dem Schlag (höchstens ein Schlag Warten); neues Tempo und neue Phase: Angleich ohne Ruck (kein Halbschlag unter 75 % oder über 125 %)', { timeoutMs: 60000 }, () => {
  const g = gridOf(120, 3.2)
  const e = engine(2)
  e.set({ beat: g, group: 'calm' })
  e.play('music_bob')
  e.S.gallery = null
  const before = e.S.ticks
  const first = downStarts(e, 40)[0]!
  expect(offGrid(first.at, g)).toBeLessThanOrEqual(0.5)
  expect(first.at - before, 'höchstens Intro + ein Schlag').toBeLessThanOrEqual(1 + Math.ceil(g.per) + 1)
  // Neues Tempo (+6 %) und verschobene Phase: Halbschläge bleiben im Rahmen, danach sitzt er auf dem neuen Raster
  const g2: BeatGrid = { t0: e.S.ticks + 0.4 * g.per, per: g.per / 1.06 }
  e.set({ beat: g2 })
  const lens: number[] = []
  let cur = ''
  let since = e.S.ticks
  for (let t = 0; t < 120; t++) {
    e.tick()
    const f = frameNow(e)
    const k = f && e.S.play!.tick === 0 ? `${f.key}@${e.S.ticks}` : cur
    if (k !== cur && f?.b) {
      lens.push(e.S.ticks - since)
      since = e.S.ticks
    }
    cur = k
  }
  const half = g2.per / 2
  for (const l of lens.slice(1)) {
    expect(l, `Halbschlag ${l} Ticks`).toBeGreaterThanOrEqual(Math.min(Math.floor(half), half * 0.75))
    expect(l).toBeLessThanOrEqual(Math.max(Math.ceil(half), half * 1.25))
  }
  const later = downStarts(e, 80)
  expect(later.length).toBeGreaterThan(3)
  for (const s of later) expect(offGrid(s.at, g2), `nach dem Angleich Tick ${s.at}`).toBeLessThanOrEqual(0.5 + 1e-9)
})

test('Nacht: nur leises Nicken, mit Takt auf jedem zweiten Schlag', { timeoutMs: 60000 }, () => {
  const g = gridOf(110)
  const e = engine(5, 1)
  e.set({ beat: g, group: 'hard' })
  e.play('music_nod_night')
  e.S.gallery = null
  const s = downStarts(e, Math.ceil(24 * g.per), true)
  expect(s.every((x) => x.clip === 'music_nod_night')).toBe(true)
  expect(s.length).toBeGreaterThan(4)
  for (let i = 1; i < s.length; i++) expect(Math.round((s[i]!.at - s[i - 1]!.at) / g.per), 'Abstand in Schlägen').toBe(2)
})

test('/clawd demo spielt die neuen Clips im festen Tempo (Raster wird nicht benutzt)', () => {
  for (const name of ['music_sway', 'music_vibe', 'music_headbang', 'music_lighter', 'music_chin', 'music_hug']) {
    const e = engine(1)
    e.set({ beat: gridOf(140), group: 'hard' })
    e.play(name)
    const seen = new Set<string>()
    for (let t = 0; t < 400; t++) {
      e.tick()
      const pl = e.S.play
      // Nur während der Demo (danach wählt die Engine selbst, bei „hart“ auch denselben Clip im Takt)
      if (e.S.gallery === name && pl?.clip.name === name && pl.phase !== 'end' && pl.dur !== undefined) {
        const f = pl[pl.phase][pl.fi]
        expect(pl.dur, `${name} ${pl.phase}:${pl.fi}`).toBe(f!.t)
        seen.add(name)
      }
    }
    expect(seen.has(name)).toBe(true)
  }
})

// ---------- Gruppen ----------

/** Welche Musik-Clips beginnen über viele Takte im Leerlauf (Musik an), nach Gruppe und Laune. */
function picks(group: MusicGroup | null, sure: boolean, temper = 0, seeds = [1, 2, 3, 4]): Map<string, number> {
  const count = new Map<string, number>()
  for (const seed of seeds) {
    const e = engine(seed, 15, temper)
    e.set({ beat: sure ? gridOf(118) : null, group })
    let last = ''
    for (let t = 0; t < 60_000; t++) {
      e.tick()
      const n = e.S.play?.clip.name ?? ''
      if (n !== last && n.startsWith('music_')) count.set(n, (count.get(n) ?? 0) + 1)
      last = n
    }
  }
  return count
}

test('Gruppen: nie Luftgitarre oder Headbangen bei ruhig, Groove oder ohne Takt; bei hart beide; schlechte Laune nie; Vibe bei Groove am häufigsten', { timeoutMs: 180000 }, () => {
  const wild = ['music_airguitar', 'music_headbang']
  for (const [group, sure] of [['calm', true], ['groove', true], [null, true], [null, false], ['sad', false]] as const) {
    const c = picks(group, sure)
    expect([...c.values()].reduce((a, b) => a + b, 0), `${group}/${sure}: genug Auswahlen`).toBeGreaterThan(40)
    for (const w of wild) expect(c.get(w) ?? 0, `${w} bei ${group}, sicher ${sure}`).toBe(0)
  }
  const hard = picks('hard', true)
  for (const w of wild) expect(hard.get(w) ?? 0, `${w} bei hart`).toBeGreaterThan(0)
  const grumpy = picks('hard', true, -0.9)
  for (const w of wild) expect(grumpy.get(w) ?? 0, `${w} bei schlechter Laune`).toBe(0)
  const groove = picks('groove', true)
  const top = [...groove.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  expect(top, JSON.stringify([...groove])).toBe('music_vibe')
  // Schunkeln nur bei ruhig und ohne Takt
  expect(groove.get('music_sway') ?? 0).toBe(0)
  expect(picks('calm', true).get('music_sway') ?? 0).toBeGreaterThan(0)
  // 0.12.0: die Gruppe zählt auch ohne sicheren Takt (hart, unsicher: Luftgitarre möglich)
  const hardUnsure = picks('hard', false)
  expect((hardUnsure.get('music_airguitar') ?? 0) + (hardUnsure.get('music_headbang') ?? 0)).toBeGreaterThan(0)
})

test('0.12.0 traurig: nur bob, phones, sway, Feuerzeug, Kinn, Umarmen; die drei traurigen Clips nie bei anderen Gruppen; auch ohne sicheren Takt', { timeoutMs: 180000 }, () => {
  const sadClips = ['music_lighter', 'music_chin', 'music_hug']
  const allowed = new Set(['music_bob', 'music_phones', 'music_sway', ...sadClips])
  for (const sure of [true, false]) {
    const c = picks('sad', sure)
    for (const n of c.keys()) expect(allowed.has(n), `${n} bei traurig`).toBe(true)
    for (const n of sadClips) expect(c.get(n) ?? 0, `${n} bei traurig, sicher ${sure}`).toBeGreaterThan(0)
  }
  for (const g of ['calm', 'groove', 'hard', null] as const) {
    const c = picks(g, true)
    for (const n of sadClips) expect(c.get(n) ?? 0, `${n} bei ${g}`).toBe(0)
  }
})

test('0.12.0 traurig in der Nacht: nur leises Nicken, keine der traurigen Clips (Review K7)', { timeoutMs: 60000 }, () => {
  const e = engine(3, 1)
  e.set({ beat: gridOf(78), group: 'sad' })
  const seen = new Set<string>()
  for (let t = 0; t < 20_000; t++) {
    e.tick()
    const n = e.S.play?.clip.name ?? ''
    if (n.startsWith('music_')) seen.add(n)
  }
  expect([...seen]).toEqual(['music_nod_night'])
})

test('Lint der neuen Clips ohne Befund; Schlag-Bilder ohne eingeschobene Zwischenbilder', { timeoutMs: 60000 }, () => {
  for (const name of ['music_sway', 'music_vibe', 'music_headbang', 'music_lighter', 'music_chin', 'music_hug']) {
    for (const seed of [1, 2, 3]) expect(lintFrames(captureClip(LIB, name, { seed, hour: 15 }), ALL_PROPS), `${name} Seed ${seed}`).toEqual([])
  }
  // Zwischen zwei Schlag-Bildern darf kein geglättetes Zwischenbild (ohne Schlaglänge) entstehen: es verschöbe den Takt
  for (const c of ALL_CLIPS.filter((x) => x.cat === 'music')) {
    const e = engine(1)
    e.play(c.name)
    for (let t = 0; t < 3; t++) e.tick()
    const body = e.S.play?.body ?? []
    for (let i = 1; i < body.length - 1; i++) {
      if (!body[i]!.b) expect(!!body[i - 1]!.b && !!body[i + 1]!.b, `${c.name}: Bild ${i} ohne Schlag zwischen zwei Schlag-Bildern`).toBe(false)
    }
  }
})

// ---------- Desktop ----------

test('Desktop: ein neuer Takt zählt sofort als Abweichung; die Abschläge der Animation liegen auf dem Raster der Uhr', { timeoutMs: 60000 }, () => {
  const t0 = new Date('2026-11-04T15:00:00').getTime()
  const beat: BeatValue = { bpm: 123.4, at: t0 + 137, sure: true, group: 'groove' }
  const facts = { ...NO_FACTS, music: true }
  const d = createDesk({ seed: 3, nightStart: 23, nightEnd: 6, idleSeconds: 6, reduced: false, flip: false })
  d.draw(t0, facts, NO_STRAIN, 4)
  expect(d.divergence(t0 + 750, facts, NO_STRAIN), 'gleiche Fakten').toBeGreaterThan(1000)
  expect(d.divergence(t0 + 750, { ...facts, beat }, NO_STRAIN), 'neuer Takt').toBe(0)
  d.draw(t0 + 750, { ...facts, beat }, NO_STRAIN, 4)
  expect(d.divergence(t0 + 1500, { ...facts, beat: { ...beat, at: beat.at + 60 } }, NO_STRAIN), 'verschobener Schlag').toBe(0)
  // Nachziehen wie gezeigt: jeder Abschlag beginnt höchstens einen halben Tick neben einem echten Schlag
  const P = 60000 / beat.bpm
  const off: number[] = []
  let cur = ''
  for (let t = t0 + 750; t <= t0 + 28_000; t += TICK) {
    d.catchUp(t)
    const pl = d.engine.S.play
    if (!pl || pl.phase === 'end') continue
    const f = pl[pl.phase][pl.fi]
    const k = `${pl.clip.name}:${pl.phase}:${pl.fi}:${d.engine.S.ticks - pl.tick}`
    if (f?.b && f.bf === 0 && k !== cur && pl.tick === 0) {
      const x = (t - beat.at) / P
      off.push(Math.abs(x - Math.round(x)) * P)
    }
    cur = k
  }
  expect(off.length, 'Abschläge im Desktop gesehen').toBeGreaterThan(10)
  expect(Math.max(...off), JSON.stringify(off.slice(0, 8))).toBeLessThanOrEqual(TICK / 2 + 1)
})

// ---------- Mod: tune-strip.beat lesen ----------

const BAND = {
  plugin: 'clawd-buddy',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 30, isFullscreen: true },
  props: { hasSurvey: false, isWorking: false, maxRows: 7, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 }, view: {} },
} as const

test('Mod: tune-strip.beat beim Zeichnen gelesen (abonniert); Unsinn heißt ohne Takt; /clawd status nennt Tempo, Gruppe, Sicherheit', { options: { language: 'de' } }, async ($, on) => {
  mock.clock(on)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  let beat: unknown = { bpm: 128, at: 1_793_800_000_000, sure: true, group: 'hard' }
  on('state.get', ($: unknown, e: any) => {
    if (e.plugin !== 'tune-strip') return { value: { value: undefined, version: 0 } }
    return { value: { value: e.key === 'playing' ? { playing: true } : e.key === 'beat' ? beat : undefined, version: 1 } }
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const props = async () => (await ui.find({ type: 'Client', key: 'buddy' }))?.props.props
  expect((await props()).facts.beat).toEqual(beat)
  const st = (await $.command.run({ command: 'clawd', args: 'status' })).text
  expect(st).toContain('Takt 128,0 bpm, hart, sicher')
  beat = { bpm: 300, at: 1, sure: true, group: 'hard' }
  await ui.redraw()
  expect((await props()).facts.beat).toBeUndefined()
  beat = null
  await ui.redraw()
  expect((await props()).facts.beat).toBeUndefined()
  await ui.unmount()
})

test('Mod, Desktop: ein neuer tune-strip.beat ergibt beim nächsten Zeichnen ein neues Svg; Unsinn zeichnet wie ohne Takt', async ($, on) => {
  const clock = mock.clock(on, { now: new Date('2026-11-04T15:40:00').getTime() })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  let beat: unknown = { bpm: 120, at: clock.now() - 200, sure: true, group: 'calm' }
  on('state.get', ($: unknown, e: any) => {
    if (e.plugin !== 'tune-strip') return { value: { value: undefined, version: 0 } }
    return { value: { value: e.key === 'playing' ? { playing: true } : e.key === 'beat' ? beat : undefined, version: 1 } }
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = async () => ((await figures(ui))[0]?.props.source as string) ?? ''
  const a = await svg()
  expect(a.length).toBeGreaterThan(100)
  await clock.advance(750)
  beat = { bpm: 96.4, at: clock.now() - 150, sure: true, group: 'hard' }
  await ui.redraw()
  const b = await svg()
  expect(b, 'neuer Takt → neue Animation').not.toBe(a)
  // Unsinn (fremder Mod): gilt als ohne Takt, die Zeichnung bleibt
  await clock.advance(750)
  beat = { bpm: 'schnell', at: 1, sure: true, group: 'hard' }
  await ui.redraw()
  expect((await figures(ui)).length).toBe(1)
  await ui.unmount()
})

test('Mod: Terminal-Client zeichnet mit Takt weiter (20 s, Takt kommt nach 5 s dazu)', async ($, on) => {
  const clock = mock.clock(on, { now: new Date('2026-11-04T15:40:00').getTime() })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  let beat: unknown = null
  on('state.get', ($: unknown, e: any) => {
    if (e.plugin !== 'tune-strip') return { value: { value: undefined, version: 0 } }
    return { value: { value: e.key === 'playing' ? { playing: true } : e.key === 'beat' ? beat : undefined, version: 1 } }
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.advance(5000)
  expect(await ui.find({ type: 'Text', text: /[▀▄█]/, in: 'buddy' }), 'vor dem Takt').toBeDefined()
  beat = { bpm: 122.1, at: clock.now() - 300, sure: true, group: 'groove' }
  await ui.redraw()
  const missing: number[] = []
  for (let s = 0; s < 90; s++) {
    // Titelwechsel nach 40 s: Takt 6 s weg, dann ein neuer (anderes Tempo, andere Gruppe)
    if (s === 40) beat = null
    if (s === 46) beat = { bpm: 96.4, at: clock.now() - 120, sure: true, group: 'hard' }
    if (s === 40 || s === 46) await ui.redraw()
    await ui.advance(1000)
    if (!(await ui.find({ type: 'Text', text: /[▀▄█]/, in: 'buddy' }))) missing.push(s)
  }
  expect(missing, 'Sekunden ohne Figur').toEqual([])
  await ui.unmount()
})
