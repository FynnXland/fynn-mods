// clawd-buddy 0.16.0 (SPEC „Ausbau 0.16.0“): neue Szenen, Rückfrage geteilt in Freigabe und Frage, Begrüßung bei neuem Chat.
import { expect, mock, test } from 'claude-code/testing'
import { ALL_CLIPS, ALL_PROPS } from '../hooks/library.js'
import { isSafe, resolveClip } from '../hooks/clipdef.js'
import { captureClip, newEngine } from '../hooks/capture.js'
import { lintFrames } from '../hooks/lint.js'
import { HELLO_MS, NO_FACTS, WAIT_ASK_LONG_MS, deriveMood } from '../hooks/mood.js'
import { CLIP_EN } from '../hooks/i18n.js'

const LIB = { clips: ALL_CLIPS, props: ALL_PROPS }
const byName = (n: string) => ALL_CLIPS.find((c) => c.name === n)!
const NEW = ['think_gears', 'ring_bell', 'ring_bell_long', 'wave_flags', 'party_hat', 'trophy_lift', 'forge_hammer', 'hammock_sleep', 'campfire_sleep', 'hello_peek', 'hello_hat']
const MOD_ROOT = String((import.meta as { dir?: string }).dir ?? '').replace(/[\\/]tests$/, '')
const BAND = {
  plugin: 'clawd-buddy', component: 'AbovePrompt', requestId: 'above-prompt',
  viewport: { columns: 120, rows: 30, isFullscreen: true },
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 7, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 }, view: {} },
} as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

function stubs(on: any, initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  on('process.run', ($: unknown, e: any) => {
    if (e.argv.join(' ') === 'claude plugin list --json') return { value: { exitCode: 0, stdout: JSON.stringify([{ id: 'clawd-buddy@fynn-mods', enabled: true, installPath: MOD_ROOT }]), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: JSON.stringify({ saved: [] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('store.get', ($: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: { command: 'clawd' } }))
  on('ui.render', { plugin: 'clawd-buddy' }, () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  return { store }
}
async function facts(ui: any): Promise<any> {
  await ui.redraw()
  return (await ui.find({ type: 'Client', key: 'buddy' }))?.props.props.facts
}
const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as any

// ---- Clips ---------------------------------------------------------------------------------------------------------------------
test('0.16.0 Clips: alle da, in der richtigen Gruppe, mit englischem Namen; nichts taucht auf (Lint, beide Seiten)', { timeoutMs: 120000 }, () => {
  const cats: Record<string, string> = {
    think_gears: 'work_think', forge_hammer: 'work_shell', ring_bell: 'waitPermission', wave_flags: 'waitPermission', ring_bell_long: 'waitPermissionLong',
    party_hat: 'done_long', trophy_lift: 'done_long', hammock_sleep: 'night', campfire_sleep: 'night', hello_peek: 'hello', hello_hat: 'hello',
  }
  for (const n of NEW) {
    expect(byName(n)?.cat, n).toBe(cats[n])
    expect(CLIP_EN[n], `${n}: englischer Name`).toBeTruthy()
    for (const seed of [1, 2, 3, 4]) expect(lintFrames(captureClip(LIB, n, { seed }), ALL_PROPS).map((i) => `${i.kind} ${i.name}`).join(', '), `${n} Seed ${seed}`).toBe('')
  }
})

test('0.16.0 Clips: think_gears, ring_bell, wave_flags haben Ruhestellen und verlassen ihre Schleife bei einer Rückfrage nach höchstens ~4 s', { timeoutMs: 60000 }, () => {
  for (const n of ['think_gears', 'ring_bell', 'wave_flags']) {
    const c = byName(n)
    expect(resolveClip(c).body.some((f) => isSafe(c, f.p)), `${n}: Ruhestelle`).toBe(true)
    for (const off of [0, 7, 19, 31]) {
      const e = newEngine(LIB, 5, { hour: 12 })
      e.start()
      for (let i = 0; i < 5; i++) e.tick()
      e.setMood(c.cat)
      e.play(n)
      let g = 0
      while ((e.S.play?.clip.name !== n || e.S.play.phase !== 'body') && g++ < 300) e.tick()
      e.S.gallery = null
      for (let i = 0; i < off; i++) e.tick()
      e.setMood(n === 'think_gears' ? 'waitPermission' : 'waitUser')
      let k = 0
      const want = n === 'think_gears' ? new Set(['ring_bell', 'wave_flags', 'look_prompt', 'point_prompt']) : new Set(ALL_CLIPS.filter((x) => x.cat === 'waitUser').map((x) => x.name))
      while (k < 400 && !want.has(e.S.play?.clip.name ?? '')) {
        e.tick()
        k++
      }
      expect(k, `${n} ab Takt ${off}`).toBeLessThanOrEqual(53)
    }
  }
})

// ---- B: Freigabe und Frage -----------------------------------------------------------------------------------------------------
test('0.16.0 B: Stimmung je Art der Rückfrage, Steigerung je Art nach WAIT_ASK_LONG_MS', () => {
  const t = 1_000_000
  expect(deriveMood({ ...NO_FACTS, ask: 'question', askSince: t }, t + 1000)).toBe('waitUser')
  expect(deriveMood({ ...NO_FACTS, ask: 'question', askSince: t }, t + WAIT_ASK_LONG_MS)).toBe('waitUserLong')
  expect(deriveMood({ ...NO_FACTS, ask: 'permission', askSince: t }, t + 1000)).toBe('waitPermission')
  expect(deriveMood({ ...NO_FACTS, ask: 'permission', askSince: t }, t + WAIT_ASK_LONG_MS)).toBe('waitPermissionLong')
  // Vorrang wie die Frage: vor Limit, Arbeit und Begrüßung
  expect(deriveMood({ ...NO_FACTS, ask: 'permission', turnActive: true, tool: { kind: 'shell', since: t }, limits: { five: 100 } }, t)).toBe('waitPermission')
  expect(deriveMood({ ...NO_FACTS, ask: 'permission', helloAt: t }, t + 10)).toBe('waitPermission')
})

test('0.16.0 B: Frage und Freigabe zugleich → Freigabe; das Ende eines Tools löscht genau seine Art; neue Art = neue Wartezeit', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  let ask = false
  on('tool.check', () => (ask ? { decision: 'ask', reason: 'test' } : { decision: 'allow' }))
  on('tool.call', async ($: unknown, e: any) => {
    await clock.sleep(e.tool === 'AskUserQuestion' ? 20_000 : 6_000)
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'x', turnId: 't' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const q = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q', questions: [] } as any)
  await clock.advance(500)
  const f1 = await facts(ui)
  expect(f1.ask).toBe('question')
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'c', command: 'rm x' } as any)
  await clock.advance(1000)
  ask = true
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'c' })
  ask = false
  const f2 = await facts(ui)
  expect(f2.ask).toBe('permission')
  expect(f2.askSince, 'Freigabe beginnt ihre eigene Wartezeit').toBeGreaterThan(f1.askSince)
  // Die Freigabe endet mit ihrem Tool: die Frage ist noch offen
  await clock.advance(7000)
  await call
  expect((await facts(ui)).ask).toBe('question')
  await clock.advance(15_000)
  await q
  expect((await facts(ui)).ask).toBe('')
  await ui.unmount()
})

test('0.16.0 B: meldet die Kette `ask` für AskUserQuestion selbst, bleibt es eine Frage', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  let ask = false
  on('tool.check', () => (ask ? { decision: 'ask', reason: 'test' } : { decision: 'allow' }))
  on('tool.call', async () => {
    await clock.sleep(4000)
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'x', turnId: 't' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const q = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q', questions: [] } as any)
  await clock.advance(200)
  ask = true
  await $.tool.check({ tool: 'AskUserQuestion', input: {}, tool_use_id: 'q' })
  expect((await facts(ui)).ask).toBe('question')
  await clock.advance(5000)
  await q
  expect((await facts(ui)).ask).toBe('')
  await ui.unmount()
})

test('0.16.0 B: Freigabe-Stimmung spielt Glocke, Flaggen, Blick oder Zeigen; lang auch die zwei Glocken; weniger Bewegung nimmt den ruhigen Blick', () => {
  const seen = new Set<string>()
  const seenLong = new Set<string>()
  for (let seed = 1; seed <= 24; seed++) {
    for (const [mood, set] of [['waitPermission', seen], ['waitPermissionLong', seenLong]] as const) {
      const e = newEngine(LIB, seed, { hour: 12 })
      e.start()
      for (let i = 0; i < 5; i++) e.tick()
      e.setMood(mood)
      for (let i = 0; i < 80; i++) e.tick()
      set.add(e.S.play?.clip.name ?? '')
    }
  }
  for (const n of seen) expect(['ring_bell', 'wave_flags', 'look_prompt', 'point_prompt'], `waitPermission: ${n}`).toContain(n)
  expect(seen.has('ring_bell') && seen.has('wave_flags')).toBe(true)
  expect(seenLong.has('ring_bell_long')).toBe(true)
  const r = newEngine(LIB, 1, { hour: 12 })
  r.set({ reduced: true })
  r.start()
  r.setMood('waitPermission')
  for (let i = 0; i < 40; i++) r.tick()
  expect(r.S.play?.clip.name).toBe('look_prompt')
})

test('0.16.0 B: /clawd status nennt die Art der Rückfrage', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('tool.call', async () => {
    await clock.sleep(4000)
    return { result: 'ok' }
  })
  const status = async () => {
    const r: any = await $.command.run({ command: 'clawd', args: 'status', ...RUN } as any)
    return String(r?.text ?? '')
  }
  expect(await status()).toContain('Waiting for: nothing.')
  await $.turn.start({ text: 'x', turnId: 't' })
  const q = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q', questions: [] } as any)
  await clock.advance(200)
  expect(await status()).toContain('Waiting for: your answer to a question.')
  await clock.advance(5000)
  await q
})

// ---- Schlaf-Varianten ----------------------------------------------------------------------------------------------------------
/** Engine bis zum Schlaf (nachts, kurzer Leerlauf), liefert den Schlafclip. */
function sleepOf(seed: number, reduced = false) {
  const e = newEngine(LIB, seed, { hour: 1, idleSeconds: 1 })
  if (reduced) e.set({ reduced: true })
  e.start()
  for (let t = 0; t < 6000 && e.S.sleepStage < 3; t++) e.tick()
  for (let t = 0; t < 400 && e.S.play?.clip.cat !== 'night'; t++) e.tick()
  for (let t = 0; t < 400 && !['sleep', 'hammock_sleep', 'campfire_sleep'].includes(e.S.play?.clip.name ?? ''); t++) e.tick()
  return e
}
test('0.16.0 Schlaf: er schläft mit Mütze, in der Hängematte oder am Lagerfeuer; weniger Bewegung ohne Hängematte, Feuer steht still', { timeoutMs: 60000 }, () => {
  const seen = new Set<string>()
  for (let seed = 1; seed <= 16; seed++) seen.add(sleepOf(seed).S.play?.clip.name ?? '')
  expect([...seen].sort()).toEqual(['campfire_sleep', 'hammock_sleep', 'sleep'])
  const reduced = new Set<string>()
  for (let seed = 1; seed <= 16; seed++) {
    const e = sleepOf(seed, true)
    reduced.add(e.S.play?.clip.name ?? '')
    for (let t = 0; t < 200; t++) {
      e.tick()
      expect(e.pose().props.some((p) => p[0] === 'sc_fire1' || p[0] === 'sc_fire2'), 'Feuer flackert nicht').toBe(false)
    }
  }
  expect(reduced.has('hammock_sleep')).toBe(false)
  expect(reduced.has('campfire_sleep')).toBe(true)
})

test('0.16.0 Schlaf: aus Hängematte und Lagerfeuer weckt ihn ihr eigener Ausklang (kein startled), danach Augen reiben; nichts taucht auf', { timeoutMs: 60000 }, () => {
  for (const want of ['hammock_sleep', 'campfire_sleep']) {
    let e = sleepOf(1)
    for (let seed = 2; seed < 40 && e.S.play?.clip.name !== want; seed++) e = sleepOf(seed)
    expect(e.S.play?.clip.name).toBe(want)
    for (let t = 0; t < 30; t++) e.tick()
    const frames: any[] = []
    const names: string[] = []
    e.setMood('work_think')
    for (let t = 0; t < 400; t++) {
      e.tick()
      const c = e.render()
      frames.push({ buf: c.buf, hit: c.hit, pose: e.pose() })
      const n = e.S.play?.clip.name ?? ''
      if (names[names.length - 1] !== n) names.push(n)
      if (n === 'rub_eyes') break
    }
    expect(names, `${want}: ${names.join(' > ')}`).not.toContain('startled')
    expect(names[0], 'erst der eigene Ausklang').toBe(want)
    expect(names).toContain('rub_eyes')
    expect(lintFrames(frames, ALL_PROPS).filter((i) => i.kind !== 'liegt am Ende noch herum').map((i) => `${i.kind} ${i.name}`).join(', ')).toBe('')
  }
})

// ---- C: Begrüßung --------------------------------------------------------------------------------------------------------------
test('0.16.0 C: hello nur im Fenster nach dem Start, nicht im Turn, Rückfrage und Eis gehen vor', () => {
  const t = 2_000_000
  expect(deriveMood({ ...NO_FACTS, helloAt: t }, t + 100)).toBe('hello')
  expect(deriveMood({ ...NO_FACTS, helloAt: t }, t + HELLO_MS)).toBe('idle')
  expect(deriveMood({ ...NO_FACTS, helloAt: t, turnActive: true }, t + 100)).toBe('work_think')
  expect(deriveMood({ ...NO_FACTS, helloAt: t, ask: 'question' }, t + 100)).toBe('waitUser')
  expect(deriveMood({ ...NO_FACTS, helloAt: t, frost: { at: t - 10, cracks: 0 } } as any, t + 100)).not.toBe('hello')
})

test('0.16.0 C: neuer Chat → helloAt; /clear → neu; /resume und /branch → keins; ein späteres session.start nach resume auch nicht', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const a = (await facts(ui)).helloAt
  expect(typeof a).toBe('number')
  await clock.advance(30_000)
  await $.classic.SessionStart({ source: 'clear' } as any)
  const b = (await facts(ui)).helloAt
  expect(b).toBeGreaterThan(a)
  await $.classic.SessionStart({ source: 'resume' } as any)
  expect((await facts(ui)).helloAt).toBeUndefined()
  await $.session.start(START)
  expect((await facts(ui)).helloAt).toBeUndefined()
  await ui.unmount()
})

test('0.16.0 C: /branch nimmt eine eben gesetzte Begrüßung zurück', async ($, on) => {
  mock.clock(on)
  stubs(on)
  await $.session.start(START)
  await $.classic.SessionStart({ source: 'fork' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await facts(ui)).helloAt).toBeUndefined()
  await ui.unmount()
})

test('0.16.0 C: war Fynn lange weg, kommt der Morgen-Clip statt hello', async ($, on) => {
  const clock = mock.clock(on)
  // zuletzt gesehen ganz am Anfang der Uhr, jetzt drei Stunden später
  stubs(on, { buddy: { seenAt: 1 } })
  await clock.advance(3 * 3_600_000)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await facts(ui)).helloAt).toBeUndefined()
  await ui.unmount()
})

test('0.16.0 C: Clawd aus → keine Begrüßung', { options: { enabled: false } }, async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  await $.session.start(START)
  // Einschalten danach (für die Sitzung, wie demo/nap) holt die Begrüßung nicht nach
  await $.command.run({ ...RUN, command: 'clawd', args: 'nap' } as any)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const f = await facts(ui)
  expect(f, 'nach nap gezeichnet').toBeDefined()
  expect(f.helloAt).toBeUndefined()
  await ui.unmount()
})

test('0.16.0 C: die Begrüßung beginnt ganz hinter der Linie und läuft genau einmal', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const e = newEngine(LIB, seed, { hour: 12 })
    e.start()
    e.begin('hello')
    e.tick()
    const first = e.render().hit
    expect(first.some((t) => t === 'body'), `Seed ${seed}: erstes Bild ohne Figur`).toBe(false)
    const played: string[] = []
    for (let t = 0; t < 400; t++) {
      e.tick()
      const n = e.S.play?.clip.name ?? ''
      if (played[played.length - 1] !== n) played.push(n)
    }
    expect(played.filter((n) => byName(n)?.cat === 'hello').length, played.join(' > ')).toBeLessThanOrEqual(1)
    expect(e.S.mood).toBe('idle')
  }
  // Steht er schon (nach dem ersten Takt), läuft hello normal über die Stimmung
  const e = newEngine(LIB, 2, { hour: 12 })
  e.start()
  e.tick()
  e.begin('hello')
  expect(e.S.mood === 'hello' || e.S.moodWant?.m === 'hello').toBe(true)
})

// ---- Nach dem Review (K2, S3) ----------------------------------------------------------------------------------------------------
test('0.16.0: /clawd list nennt jeden neuen Clip, /clawd demo spielt ihn', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  const run = async (args: string) => String(((await $.command.run({ ...RUN, command: 'clawd', args } as any)) as any)?.text ?? '')
  const list = await run('list')
  for (const n of NEW) {
    expect(list, `list: ${n}`).toContain(n)
    expect(await run(`demo ${n}`), `demo ${n}`).toContain(n)
    await clock.advance(10)
  }
  expect(list).toMatch(/^waitPermission: .*ring_bell/m)
  expect(list).toMatch(/^hello: hello_peek, hello_hat$/m)
})

test('0.16.0 C: ein ausgeschöpftes Limit verdrängt hello', () => {
  const t = 3_000_000
  expect(deriveMood({ ...NO_FACTS, helloAt: t, limits: { five: 100 } }, t + 100)).toBe('limit_5h')
})

// Ohne Eis: der Eis-Würfel eines neuen Chats könnte sonst „gefroren“ ergeben, und Eis verdrängt die Begrüßung (gewollt)
const NO_ICE = { options: { iceWhenCold: false } }

/** Sichtbare Teile eines Desk-Svg zur Zeit `ms` (wie frameAt in clawd-buddy.test.ts). */
function frameAt(svg: string, ms: number): string {
  const dur = Number(/dur="([\d.]+)s"/.exec(svg)?.[1] ?? 1) * 1000
  const lag = Number(/begin="-([\d.]+)s"/.exec(svg)?.[1] ?? 0) * 1000
  const at = Math.min(1, (ms + lag) / dur)
  let out = ''
  for (const g of svg.match(/<g visibility="\w+">.*?<\/g>/g) ?? []) {
    const body = g.replace(/<g[^>]*>|<animate[^>]*\/>|<\/g>/g, '')
    const m = /values="([^"]+)" keyTimes="([^"]+)"/.exec(g)
    if (!m) {
      out += body
      continue
    }
    const vals = m[1]!.split(';')
    const keys = m[2]!.split(';').map(Number)
    let v = vals[0]
    keys.forEach((k, i) => {
      if (k <= at + 1e-9) v = vals[i]
    })
    if (v === 'visible') out += body
  }
  return out
}

test('0.16.0 C (Desktop): nach dem Start eines neuen Chats beginnt das erste Bild ohne Figur, sie kommt danach hervor', NO_ICE, async ($, on) => {
  mock.clock(on)
  stubs(on)
  on('ui.invalidate', () => ({ value: undefined }))
  await $.session.start({ ...START, surface: 'desktop' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = (await ui.findAll({ type: 'Svg' })).filter((s: any) => s.props.alt !== '')
  expect(svgs.length).toBe(1)
  const svg = String(svgs[0]!.props.source)
  expect(frameAt(svg, 0), 'erstes Bild ohne Figur').not.toMatch(/#D77757/i)
  expect(frameAt(svg, 4000), 'nach ~4 s ist er da').toMatch(/#D77757/i)
  await ui.unmount()
})

test('0.16.0 C (Terminal): nach dem Start eines neuen Chats ist zuerst nichts zu sehen, dann späht er hervor', NO_ICE, async ($, on) => {
  mock.clock(on)
  stubs(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.advance(150)
  expect(await ui.find({ type: 'Text', text: /[▀▄█]/, in: 'buddy' }), 'erstes Bild leer').toBeUndefined()
  await ui.advance(4000)
  expect(await ui.find({ type: 'Text', text: /[▀▄█]/, in: 'buddy' }), 'nach ~4 s ist er da').toBeDefined()
  await ui.unmount()
})

// ---- 0.16.1: keine Begrüßung nach einem Neuladen ---------------------------------------------------------------------------------
test('0.16.1 C: ein zweites session.start in derselben Sitzung (Neuladen des Mods) setzt keine neue Begrüßung', NO_ICE, async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  await $.session.start(START)
  await clock.advance(10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const a = (await facts(ui)).helloAt
  expect(typeof a, 'erster Start grüßt').toBe('number')
  await clock.advance(30_000)
  // Neuladen: der eigene $.state-Wert steht noch (session.start feuert erneut, docs/raw/en/reference.md:153)
  await $.session.start(START)
  expect((await facts(ui)).helloAt, 'keine neue Begrüßung').toBe(a)
  // /clear ist dagegen ein neuer Chat
  await $.classic.SessionStart({ source: 'clear' } as any)
  expect((await facts(ui)).helloAt).toBeGreaterThan(a)
  await ui.unmount()
})
