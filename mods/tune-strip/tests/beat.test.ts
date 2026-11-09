// tune-strip 0.6.0: Takt und Gruppe (SPEC Nachtrag 0.6.0 → Tests). Der Helfer läuft nie echt: `process.spawn` ist ein Generator-Stub,
// der Zeilen liefert, wenn der Test sie schickt. Die echte Analyse prüfen scripts/smoke.ps1, die Kalibrierung und Fynns Sicht-Check.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { BEAT_BOOT, BEAT_CS } from '../hooks/beat-cs.ts'
import { GROUPS, MODEL, TUNING, Tracker, classify, foldBpm, needsWrite, parseLine, phaseOff, splitLines } from '../hooks/beat.ts'
import type { Beat, FeatureVec, Group, Measure } from '../hooks/beat.ts'
import { parseTune } from '../hooks/model.ts'
import { CALIB } from './calib-data.ts'
import { PS_ABS, QUERY_SCRIPT, parseQuery } from '../hooks/ps.ts'
// Ordner der Mod, wie `$.plugin.root` ihn im Test meldet: Weg 2 schreibt nur für die installierte Kopie (hooks/settings.ts)
const MOD_ROOT = String((import.meta as { dir?: string }).dir ?? '').replace(/[\\/]tests$/, '')

const NOW = new Date(2026, 10, 4, 20, 0, 0).getTime()
const DE = { options: { language: 'de' } } as const
/** `a` liegt höchstens `tol` neben `b` */
const near = (a: number | undefined, b: number, tol: number) => {
  expect(typeof a).toBe('number')
  if (Math.abs(a! - b) > tol) throw new Error(`${a} liegt nicht innerhalb ${tol} von ${b}`)
}

// ---------- Messungen bauen ----------

// Merkmale je Gruppe: die Mittelpunkte der Kalibrierung, dazu Tempo und Anschlagdichte (entscheiden die Gruppe nicht)
const FEAT: Record<Group, FeatureVec> = {
  // ruhig und traurig teilen sich den Mittelpunkt der Stufe 1; Stufe 2 trennt sie über Klarheit des Schlags und Bass
  calm: { ...MODEL.center.calm, ...MODEL.soft.center.calm, bpm: 100, dens: 4.3 },
  sad: { ...MODEL.center.calm, ...MODEL.soft.center.sad, bpm: 80, dens: 3.5 },
  groove: { ...MODEL.center.groove, bpm: 95, dens: 4.8 },
  hard: { ...MODEL.center.hard, bpm: 125, dens: 4.5 },
}
type M = Partial<Measure> & { end: number }
type Song = Omit<M, 'end'> & { origin?: number; g?: Group }
/** Eine Messung eines Songs mit `bpm`, dessen Schläge bei `origin + k·P` liegen; Merkmale der Gruppe `g`. */
function meas(o: M & { origin?: number; g?: Group }): Measure {
  const bpm = o.bpm ?? 123.4
  const P = 60000 / bpm
  const origin = o.origin ?? 0
  const f = FEAT[o.g ?? 'groove']
  const at = o.at ?? origin + Math.floor((o.end - 20 - origin) / P) * P
  const { origin: _o, g: _g, ...rest } = o
  return { win: 6, tclar: 1.3, pclar: 5, rms: 0.01, ...f, ...rest, bpm, at } as Measure
}
const line = (m: Measure) =>
  `b ${m.win} ${Math.round(m.end)} ${m.bpm.toFixed(2)} ${m.tclar.toFixed(2)} ${Math.round(m.at)} ${m.pclar.toFixed(2)} ${m.bass.toFixed(4)} ${m.high.toFixed(4)} ${m.cent.toFixed(0)} ${m.flat.toFixed(4)} ${m.dens.toFixed(2)} ${m.rms.toFixed(5)}`

/** Messungen alle 2,5 s von `from` bis `to` in einen Tracker. */
function run(t: Tracker, from: number, to: number, o: Song = {}) {
  for (let end = from; end <= to; end += 2500) t.feed(meas({ ...o, end }))
}

// ---------- Zeilen ----------

test('Zeilen: gültig, Stille, Bereit, Fehler; Müll und Zahlen außerhalb der Bereiche werden verworfen, nie ein Wurf', async () => {
  const m = meas({ end: NOW, win: 20 })
  expect(parseLine(line(m))).toMatchObject({ kind: 'beat', m: { win: 20, end: NOW } })
  expect(parseLine('ready')).toEqual({ kind: 'ready' })
  expect(parseLine(`q ${NOW}`)).toEqual({ kind: 'quiet', end: NOW })
  expect(parseLine('fail 0x80070005')).toEqual({ kind: 'fail', why: '0x80070005' })
  const bad = [
    '',
    'b',
    'q',
    'q abc',
    'q 12',
    'fail <script>',
    'fail',
    line({ ...m, bpm: 300 }),
    line({ ...m, bpm: 20 }),
    line({ ...m, bass: 1.5 }),
    line(m).replace(String(Math.round(m.at)), String(NOW + 60_000)), // Schlag nach dem Fenster
    line(m).replace(String(Math.round(m.at)), String(NOW - 30_000)), // Schlag vor dem Fenster
    line(m).replace('b 20 ', 'b 99 '),
    line(m) + ' 7',
    line(m).replace('0.01000', '1e-2'),
    line(m).replace('0.01000', 'NaN'),
    line(m).replace(String(NOW), 'Infinity'),
    'ready now',
    'b 6 Hey Jude',
  ]
  for (const s of bad) expect(parseLine(s)).toBeUndefined()
  // Zufallsmüll wirft nie
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 300; i++) {
    const s = Array.from({ length: Math.floor(rnd() * 80) }, () => String.fromCharCode(32 + Math.floor(rnd() * 95))).join('')
    expect(() => parseLine(s)).not.toThrow()
  }
})

test('Zeilen: Stücke werden zu Zeilen zusammengesetzt (auch CRLF und halbe Zeilen), überlange Reste verfallen', async () => {
  let r = splitLines('', 'rea')
  expect(r).toEqual({ lines: [], rest: 'rea' })
  r = splitLines(r.rest, 'dy\r\nq 1793796909172\nb 6')
  expect(r.lines).toEqual(['ready', 'q 1793796909172'])
  expect(r.rest).toBe('b 6')
  expect(splitLines('', 'x'.repeat(5000)).rest).toBe('')
})

test('Tempo: über 150 zählt das halbe, unter 60 das doppelte; 60 und 150 bleiben', async () => {
  near(foldBpm(151), 75.5, 0.001)
  expect(foldBpm(150)).toBe(150)
  expect(foldBpm(210)).toBe(105)
  expect(foldBpm(59)).toBe(118)
  expect(foldBpm(60)).toBe(60)
  expect(foldBpm(55)).toBe(110)
})

// ---------- Glätten ----------

test('Glätten: gleichmäßiger Song → sicher, Tempo genau, Schlag auf dem Raster; ohne neue Messung nach 8 s kein Takt', async () => {
  for (const bpm of [97, 123.4, 149]) {
    const t = new Tracker()
    t.reset(NOW - 1000)
    // Messfehler wie gemessen: Tempo ±0,4 bpm, Schlag ±12 ms
    let k = 0
    for (let end = NOW + 6000; end <= NOW + 40_000; end += 2500, k++) {
      const P = 60000 / bpm
      const jitter = [-12, 7, 3, -5, 11, -2][k % 6]!
      const at = Math.floor((end - 20) / P) * P + jitter
      t.feed(meas({ end, bpm: bpm + [0.4, -0.3, 0.1, -0.4, 0.2][k % 5]!, at, win: end - NOW > 21_000 ? 20 : 6 }))
    }
    const v = t.value(NOW + 41_000, 0)!
    expect(v.sure).toBe(true)
    near(v.bpm, bpm, 0.3)
    near(phaseOff(v.at, 0, 60000 / bpm), 0, 10)
    expect(v.at).toBeLessThanOrEqual(NOW + 41_000)
    expect(t.value(NOW + 40_000 + TUNING.staleMs + 1, 0)).toBeNull()
  }
})

test('Glätten: ein Sprung um einen halben Schlag zählt erst, wenn zwei Messungen in Folge ihn zeigen', async () => {
  const bpm = 120
  const P = 500
  const t = new Tracker()
  t.reset(NOW - 1000)
  run(t, NOW + 6000, NOW + 16_000, { bpm })
  near(phaseOff(t.value(NOW + 16_100, 0)!.at, 0, P), 0, 5)
  // Ein Ausreißer auf dem Offbeat: Raster bleibt
  t.feed(meas({ end: NOW + 18_500, bpm, origin: P / 2 }))
  near(phaseOff(t.value(NOW + 18_600, 0)!.at, 0, P), 0, 5)
  // Ein zweiter in Folge: jetzt gilt der neue Schlag
  t.feed(meas({ end: NOW + 21_000, bpm, origin: P / 2 }))
  near(phaseOff(t.value(NOW + 21_100, 0)!.at, P / 2, P), 0, 5)
  // Ein einzelnes falsches Tempo (4/3, wie in der Aufnahme 141 statt 106) ändert nichts
  const t2 = new Tracker()
  t2.reset(NOW - 1000)
  run(t2, NOW + 6000, NOW + 16_000, { bpm: 106 })
  t2.feed(meas({ end: NOW + 18_500, bpm: 141.3, tclar: 1.01 }))
  near(t2.value(NOW + 18_600, 0)!.bpm, 106, 0.5)
})

test('Versatz: verschiebt den Schlag um genau die eingestellten ms (positiv: später), Tempo bleibt', async () => {
  const t = new Tracker()
  t.reset(NOW - 1000)
  run(t, NOW + 6000, NOW + 16_000, { bpm: 120 })
  const a = t.value(NOW + 16_100, 0)!
  for (const off of [120, -80, 400, -400]) {
    const b = t.value(NOW + 16_100, off)!
    near(phaseOff(b.at, a.at, 500), phaseOff(off, 0, 500), 1)
    expect(b.bpm).toBe(a.bpm)
    expect(b.at).toBeLessThanOrEqual(NOW + 16_100)
  }
})

test('Titelwechsel: zurück auf „ohne Takt“, Fenster aus dem alten Titel zählen nicht, nach ≤ 8,5 s trägt der neue Takt', async () => {
  const t = new Tracker()
  t.reset(NOW - 60_000)
  run(t, NOW - 50_000, NOW, { bpm: 128, g: 'hard' })
  near(t.value(NOW + 100, 0)!.bpm, 128, 0.5)
  const start = NOW + 1000
  t.reset(start)
  expect(t.value(NOW + 1100, 0)).toBeNull()
  // Fenster, die vor dem Titelbeginn anfangen (6 s und 20 s), zählen nicht
  t.feed(meas({ end: start + 2500, bpm: 128, win: 6 }))
  t.feed(meas({ end: start + 5000, bpm: 128, win: 20 }))
  expect(t.value(start + 5100, 0)).toBeNull()
  // Der erste saubere 6-s-Messwert kommt spätestens 8,5 s nach dem Wechsel
  t.feed(meas({ end: start + 6000, bpm: 92, origin: start }))
  t.feed(meas({ end: start + 8500, bpm: 92, origin: start }))
  const v = t.value(start + 8500, 0)!
  near(v.bpm, 92, 0.5)
  expect(v.group).toBeNull()
})

test('Stille und Pause: Takt neu, Gruppe bleibt', async () => {
  const t = new Tracker()
  t.reset(NOW - 60_000)
  run(t, NOW - 50_000, NOW, { bpm: 100, g: 'calm' })
  expect(t.group).toBe('calm')
  t.quiet(NOW + 2500)
  expect(t.value(NOW + 2600, 0)).toBeNull()
  expect(t.group).toBe('calm')
  // Danach zählen nur Fenster, die nach der Stille beginnen
  t.feed(meas({ end: NOW + 5000, bpm: 100 }))
  expect(t.value(NOW + 5100, 0)).toBeNull()
})

// ---------- Gruppe ----------

test('Gruppe: die Mittelpunkte der Kalibrierung landen in ihrer Gruppe, auch mit etwas Streuung', async () => {
  for (const g of GROUPS) {
    expect(classify(FEAT[g])).toBe(g)
    const f = { ...FEAT[g] }
    f.bpm += 30 // Tempo und Dichte zählen nicht
    f.dens += 5
    f.cent += MODEL.scale.cent * 0.4
    f.flat -= MODEL.scale.flat * 0.3
    expect(classify(f)).toBe(g)
  }
})

test('Gruppe: traurig nur bei weichem Klang; dieselbe Messung mit flachem Spektrum (Rap mit schwachem Schlag) bleibt ruhig', async () => {
  const f = { ...FEAT.sad }
  expect(classify(f)).toBe('sad')
  f.flat = MODEL.soft.maxFlat - 0.01
  expect(classify(f)).toBe('sad')
  f.flat = MODEL.soft.maxFlat
  expect(classify(f)).toBe('calm') // Stufe 1 bleibt ruhig, Stufe 2 sagt traurig; erst die Regel macht ruhig daraus
})

test('Kalibrierung (0.7.2, vier Gruppen): mindestens 47 von 57 Songs, traurig mindestens 12 von 16, nie hart ↔ traurig, ruhig → hart oder Groove → traurig; Tempo wie bei Deezer', async () => {
  const core = CALIB.filter((s) => s.group !== 'edge')
  expect(core.length).toBe(57)
  const right = core.filter((s) => classify(s) === s.group)
  expect(right.length, core.filter((s) => classify(s) !== s.group).map((s) => s.song).join(', ')).toBeGreaterThanOrEqual(47)
  expect(core.filter((s) => s.group === 'sad' && classify(s) === 'sad').length).toBeGreaterThanOrEqual(12)
  // Die teuren Verwechslungen (Luftgitarre zur Ballade, Feuerzeug zum Metal oder zum Rap) kommen nicht vor
  for (const s of core) {
    const v = classify(s)
    if (s.group === 'calm' || s.group === 'sad') expect(v, s.song).not.toBe('hard')
    if (s.group === 'hard' || s.group === 'groove') expect(v, s.song).not.toBe('sad')
  }
  // Fynns Meldung (0.7.0): Ski Aggu – Theater bekam live die traurigen Clips. Nur zur Dokumentation: am Median der Hörprobe war es auch
  // vorher nicht traurig; die Regel selbst sichern der Test „traurig nur bei weichem Klang“ und „Groove → nie traurig“ (Lose Yourself) ab
  expect(classify(CALIB.find((s) => s.song === 'Ski Aggu – Theater')!)).not.toBe('sad')
  // Grenzfälle haben kein Soll, aber eine Gruppe
  for (const s of CALIB.filter((x) => x.group === 'edge')) expect(GROUPS).toContain(classify(s))
  // Tempo gegen Deezer (Planungs-Chat): HUMBLE. ~75 (Deezer verdoppelt 149,8), Roller 64 (128), Thunderstruck, Du hast, Get Lucky, In the End
  const want: Record<string, number> = { 'Kendrick Lamar – HUMBLE.': 75, 'Apache 207 – Roller': 64, 'AC/DC – Thunderstruck': 133.4, 'Rammstein – Du hast': 124.9, 'Daft Punk – Get Lucky': 116.1, 'Linkin Park – In the End': 105.2 }
  for (const [song, bpm] of Object.entries(want)) near(CALIB.find((s) => s.song === song)?.bpm, bpm, bpm * 0.01)
})

test('Gruppe: frühestens 15 s nach Titelbeginn; ruhiges Intro, dann Drop: Wechsel erst nach 30 s; Titelwechsel setzt zurück', async () => {
  const t = new Tracker()
  const start = NOW
  t.reset(start)
  run(t, start + 6000, start + 12_500, { g: 'calm', bpm: 90 })
  expect(t.group).toBeNull()
  run(t, start + 15_000, start + 40_000, { g: 'calm', bpm: 90 })
  expect(t.group).toBe('calm')
  // Drop: 25 s hart reichen nicht
  run(t, start + 42_500, start + 67_500, { g: 'hard', bpm: 90 })
  expect(t.group).toBe('calm')
  // nach weiteren Sekunden (Mehrheit hart seit > 30 s) wechselt sie
  run(t, start + 70_000, start + 85_000, { g: 'hard', bpm: 90 })
  expect(t.group).toBe('hard')
  // Kurz zurück ins Ruhige (10 s) ändert nichts
  run(t, start + 87_500, start + 97_500, { g: 'calm', bpm: 90 })
  expect(t.group).toBe('hard')
  t.reset(start + 100_000)
  expect(t.group).toBeNull()
})

test('Gruppe traurig (0.7.0): ein trauriger Song landet nach 15 s bei sad und steht so im Wert, auch wenn der Takt unsicher ist', async () => {
  const t = new Tracker()
  t.reset(NOW)
  run(t, NOW + 6000, NOW + 30_000, { g: 'sad', bpm: 78, pclar: 2.3, tclar: 1.02 })
  expect(t.group).toBe('sad')
  const v = t.value(NOW + 30_100, 0)!
  expect(v.group).toBe('sad')
  expect(v.sure).toBe(false) // schwacher Schlag: Takt unsicher, die Gruppe steht trotzdem
})

// ---------- Schreiben ----------

test('Schreiben: nur bei deutlicher Änderung, kleine Änderungen höchstens alle 15 s', async () => {
  const a: Beat = { bpm: 120, at: NOW, sure: true, group: 'groove' }
  expect(needsWrite(null, null, NOW, 0)).toBe(false)
  expect(needsWrite(null, a, NOW, 0)).toBe(true)
  expect(needsWrite(a, null, NOW, 0)).toBe(true)
  expect(needsWrite(a, { ...a, at: NOW + 500 * 7 }, NOW + 1000, NOW)).toBe(false) // derselbe Schlag, sieben weiter
  expect(needsWrite(a, { ...a, sure: false }, NOW + 1000, NOW)).toBe(true)
  expect(needsWrite(a, { ...a, group: 'hard' }, NOW + 1000, NOW)).toBe(true)
  expect(needsWrite(a, { ...a, bpm: 121.3 }, NOW + 1000, NOW)).toBe(true) // > 1 %
  expect(needsWrite(a, { ...a, bpm: 120.5 }, NOW + 1000, NOW)).toBe(false)
  expect(needsWrite(a, { ...a, at: NOW + 45 }, NOW + 1000, NOW)).toBe(true) // > 40 ms
  expect(needsWrite(a, { ...a, at: NOW + 30 }, NOW + 1000, NOW)).toBe(false)
  // nach 15 s wird auch eine kleine Änderung nachgestellt, ganz ohne Änderung nie
  expect(needsWrite(a, { ...a, at: NOW + 30 }, NOW + 15_000, NOW)).toBe(true)
  expect(needsWrite(a, { ...a, at: NOW + 500 * 40 }, NOW + 60_000, NOW)).toBe(false)
})

// ---------- Helfer im Mod ----------

test('Helfer-Text: C# per stdin, Startzeile ohne doppelte Anführungszeichen, Prozess-ID nur über SP_PID, kein Netz, keine Datei', async () => {
  expect(BEAT_BOOT).not.toContain('"')
  expect(BEAT_BOOT).toContain('$env:SP_PID')
  expect(BEAT_BOOT).toContain("-notmatch '^[0-9]{1,7}$'")
  expect(BEAT_BOOT).toContain('[Console]::In.ReadToEnd()')
  expect(BEAT_BOOT.length).toBeLessThan(1000)
  expect(BEAT_CS).toContain('"VAD\\\\Process_Loopback"') // im C#-Text als "VAD\\Process_Loopback"
  // Nur Process-Loopback, nie der ganze Systemton (kein GetDefaultAudioEndpoint, kein MMDeviceEnumerator)
  for (const no of ['GetDefaultAudioEndpoint', 'MMDeviceEnumerator', 'WebClient', 'HttpClient', 'Socket', 'File.', 'FileStream', 'Registry', 'GetEnvironmentVariable'])
    expect(BEAT_CS).not.toContain(no)
  // Die Abfrage meldet die Prozess-ID als Zahl
  expect(QUERY_SCRIPT).toContain('Get-Process -Name Spotify')
  expect(parseQuery(JSON.stringify({ ok: true, title: 't', pid: 4242 }))?.pid).toBe(4242)
  for (const pid of [0, -1, 1.5, '4242', 1e9]) expect(parseQuery(JSON.stringify({ ok: true, title: 't', pid }))?.pid).toBeUndefined()
})

test('/tune beat: Befehle lesen, Versatz in Grenzen', async () => {
  expect(parseTune('beat')).toEqual({ kind: 'beat' })
  expect(parseTune('beat on')).toEqual({ kind: 'beatOn', value: true })
  expect(parseTune('BEAT OFF')).toEqual({ kind: 'beatOn', value: false })
  expect(parseTune('beat offset 120')).toEqual({ kind: 'beatOffset', ms: 120 })
  expect(parseTune('beat offset -400')).toEqual({ kind: 'beatOffset', ms: -400 })
  expect(parseTune('beat offset +400')).toEqual({ kind: 'beatOffset', ms: 400 })
  for (const bad of ['beat offset 401', 'beat offset -401', 'beat offset', 'beat offset 1.5', 'beat offset abc', 'beat x', 'beat on off'])
    expect(parseTune(bad).kind).toBe('badArg')
})

// ---------- Welt: Abfrage mit laufender Position, steuerbarer Helfer ----------

const q = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ ok: true, title: 'Hey Jude', artist: 'The Beatles', album: '1', status: 'Playing', pos: 10, end: 400, shuffle: false, repeat: 'None', pid: 4242, can: { seek: true, shuffle: true, repeat: true }, ...o })

type Spawn = { argv: readonly string[]; env?: Record<string, string>; input?: string }
function world(on: On, o: { cwd?: string; denySpawn?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = new Map<string, unknown>()
  // Die Position läuft beim Spielen mit der Uhr weiter (sonst sähe der Mod einen Sprung im Titel)
  const song = { over: {} as Record<string, unknown>, pos0: 10, t0: NOW, paused: false }
  const st = { stored: undefined as unknown, beatWrites: [] as unknown[] }
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  const cwd = o.cwd ?? 'C:\\work'
  on('session.start', () => ({ cwd }))
  on('process.run', ($: unknown, e: any) => {
    if (e.argv.join(' ') === 'claude plugin list --json') return { value: { exitCode: 0, stdout: JSON.stringify([{ id: 'tune-strip@fynn-mods', enabled: true, installPath: MOD_ROOT }]), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'claude') return { value: { exitCode: 0, stdout: JSON.stringify({ saved: Object.keys(JSON.parse(e.init?.stdin ?? '{}')) }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const pos = song.paused ? song.pos0 : song.pos0 + (clock.now() - song.t0) / 1000
    const stdout = q({ pos: Math.round(pos * 10) / 10, status: song.paused ? 'Paused' : 'Playing', ...song.over })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) =>
    e.component === 'CommandOutput' ? { type: 'Text', props: {}, children: ['x'] } : { type: 'Text', props: {}, children: ['von anderen'] },
  )
  on('state.get', ($: unknown, e: any) => ({ value: { value: e.key === 'beat' ? st.stored : undefined, version: 1 } }) as never)
  on('state.set', ($: unknown, e: any) => {
    if (e.key === 'beat') {
      st.stored = e.value
      st.beatWrites.push(e.value)
    }
    return { value: { isSet: true, version: 1 } } as never
  })
  // Der Helfer: liefert, was der Test schickt; `abort()` lässt ihn abbrechen (Exit 1)
  const h = { spawns: [] as Spawn[], open: 0, queue: [] as string[], wake: [] as (() => void)[], ending: false }
  on('process.spawn', async function* ($: unknown, e: any) {
    h.spawns.push(e)
    if (o.denySpawn) return { deny: 'abgelehnt (Richtlinie)' }
    h.open += 1
    try {
      while (true) {
        while (!h.queue.length && !h.ending) await new Promise<void>((r) => h.wake.push(r))
        if (!h.queue.length) {
          h.ending = false
          return { value: { code: 1, signal: null } }
        }
        yield { stream: 'stdout' as const, text: h.queue.shift()! }
      }
    } finally {
      h.open -= 1
    }
  } as never)
  const wake = () => h.wake.splice(0).forEach((r) => r())
  return {
    clock,
    saved,
    st,
    h,
    song,
    /** Pause, Weiterspielen oder neuer Titel ab jetzt */
    setSong(o: { paused?: boolean; over?: Record<string, unknown>; pos?: number }) {
      const now = clock.now()
      song.pos0 = o.pos ?? (song.paused ? song.pos0 : song.pos0 + (now - song.t0) / 1000)
      song.t0 = now
      if (o.paused !== undefined) song.paused = o.paused
      if (o.over) song.over = o.over
    },
    say(text: string) {
      h.queue.push(text)
      wake()
    },
    abort() {
      h.ending = true
      wake()
    },
    /** Messungen wie der echte Helfer: alle 2,5 s eine Zeile, die Uhr läuft mit */
    async beats(n: number, o: Song = {}) {
      for (let i = 0; i < n; i++) {
        await clock.advance(2500)
        h.queue.push(line(meas({ ...o, end: clock.now() - 10 })) + '\n')
        wake()
        await clock.settle()
      }
    },
    async start($: any, surface: string = 'desktop') {
      await $.session.start({ cwd, surface, isInteractive: true })
      await clock.advance(10)
      await clock.settle()
    },
  }
}
const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const band = (surface: string, bodyColumns = 120) =>
  ({ plugin: 'tune-strip', component: 'AbovePrompt', requestId: 'above-prompt', props: { ...props, bodyColumns }, surface }) as never

async function playing($: any, w: ReturnType<typeof world>, surface = 'desktop', cols = 120) {
  await w.start($, surface)
  const ui = await $.ui.mount(band(surface, cols))
  await ui.drawn()
  await w.clock.advance(1000)
  await w.clock.settle()
  return ui
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Helfer (${surface}): startet bei Spiel + Zeichnen + Takt an, mit -MTA, C# über stdin und der Prozess-ID nur in SP_PID`, async ($, on) => {
    const w = world(on)
    await playing($, w, surface)
    expect(w.h.spawns.length).toBe(1)
    const s = w.h.spawns[0]!
    expect(s.argv[0]).toBe(PS_ABS)
    expect(s.argv).toContain('-MTA')
    expect(s.argv[s.argv.length - 1]).toBe(BEAT_BOOT)
    expect(s.env).toEqual({ SP_PID: '4242' })
    expect(s.input).toBe(BEAT_CS)
    // Weitere Takte starten keinen zweiten
    await w.clock.advance(5000)
    expect(w.h.spawns.length).toBe(1)
  })
}

test('tune-strip.beat: erst null, nach tragenden Messungen der Takt; selten geschrieben; nie ein Titel; nie beim Zeichnen', DE, async ($, on) => {
  const w = world(on)
  const ui = await playing($, w)
  expect(w.st.stored ?? null).toBeNull()
  w.say('ready\n')
  await w.beats(5, { bpm: 123.4 })
  await w.clock.advance(1000)
  const v = w.st.stored as Beat
  // Der Titel lief schon 10 s vor dem Start (Position 10): nach > 15 s Titel steht auch die Gruppe
  expect(v).toMatchObject({ sure: true, group: 'groove' })
  near(v.bpm, 123.4, 0.5)
  expect(JSON.stringify(w.st.beatWrites)).not.toMatch(/Hey Jude|Beatles/)
  // Zeichnen schreibt nie (die Uhr steht dabei)
  const n = w.st.beatWrites.length
  await ui.drawn()
  await ui.unmount()
  const ui2 = await $.ui.mount(band('desktop'))
  await ui2.drawn()
  expect(w.st.beatWrites.length).toBe(n)
  // Weiter gleichmäßig: in 20 s höchstens zwei Nachstellungen
  await w.beats(8, { bpm: 123.4 })
  expect(w.st.beatWrites.length - n).toBeLessThanOrEqual(2)
  // /tune beat zeigt Tempo und Sicherheit
  const r = (await $.command.run({ command: 'tune', args: 'beat' } as never)) as { text: string }
  expect(r.text).toMatch(/Takt: hört zu · 123,\d bpm · sicher · Gruppe Groove\/Hip-Hop/)
  expect(r.text).toContain('Versatz 0 ms')
})

test('Versatz per /tune beat offset wirkt sofort auf tune-strip.beat und gilt in allen Sitzungen ($.store)', DE, async ($, on) => {
  const w = world(on)
  await playing($, w)
  await w.beats(5, { bpm: 120 })
  await w.clock.advance(1000)
  const a = w.st.stored as Beat
  const r = (await $.command.run({ command: 'tune', args: 'beat offset 150' } as never)) as { text: string }
  expect(r.text).toContain('+150 ms')
  const b = w.st.stored as Beat
  near(phaseOff(b.at, a.at, 500), 150, 3)
  expect(r.text).toContain('Gespeichert')
  const bad = (await $.command.run({ command: 'tune', args: 'beat offset 999' } as never)) as { text: string }
  expect(bad.text).toContain('/tune help')
})

test('Helfer endet 15 s nach Pause, der Wert sofort null; Weiterspielen startet ihn neu', DE, async ($, on) => {
  const w = world(on)
  await playing($, w)
  await w.beats(4)
  await w.clock.advance(1000)
  expect(w.h.open).toBe(1)
  expect(w.st.stored).not.toBeNull()
  w.setSong({ paused: true })
  await w.clock.advance(5000)
  expect(w.st.stored).toBeNull()
  expect(w.h.open).toBe(1)
  await w.beats(6) // Zeilen laufen weiter (Stille), nach 15 s ohne Bedarf endet der Kreislauf
  expect(w.h.open).toBe(0)
  w.setSong({ paused: false })
  await w.clock.advance(6000)
  expect(w.h.open).toBe(1)
  expect(w.h.spawns.length).toBe(2)
})

test('/tune beat off und /tune off: Wert sofort null, Helfer weg mit der nächsten Zeile (≤ 2,5 s); beat on startet ihn wieder, mit der Zusicherung', DE, async ($, on) => {
  const w = world(on)
  await playing($, w)
  await w.beats(4)
  expect(w.h.open).toBe(1)
  const r = (await $.command.run({ command: 'tune', args: 'beat off' } as never)) as { text: string }
  expect(r.text).toContain('Takterkennung aus')
  w.say(`q ${w.clock.now()}\n`)
  await w.clock.settle()
  expect(w.h.open).toBe(0)
  expect(w.st.stored).toBeNull()
  await w.clock.advance(10_000)
  expect(w.h.open).toBe(0)
  const on2 = (await $.command.run({ command: 'tune', args: 'beat on' } as never)) as { text: string }
  expect(on2.text).toContain('nichts wird aufgenommen, gespeichert oder gesendet')
  await w.clock.advance(1000)
  expect(w.h.open).toBe(1)
  await $.command.run({ command: 'tune', args: 'off' } as never)
  expect(w.st.stored).toBeNull()
  w.say(`q ${w.clock.now()}\n`)
  await w.clock.settle()
  expect(w.h.open).toBe(0)
})

test('Ohne Zeichnung (Sitzung verdeckt): der Abfragetakt hält an, der Helfer endet nach 15 s', DE, async ($, on) => {
  const w = world(on)
  const ui = await playing($, w)
  await w.beats(2)
  expect(w.h.open).toBe(1)
  // Ein Neuzeichnen wird angefordert, kommt aber nicht (nichts mehr gezeichnet): der Takt beendet sich
  await ui.unmount()
  await $.command.run({ command: 'tune', args: 'size compact' } as never)
  await w.beats(8)
  expect(w.h.open).toBe(0)
  expect(w.h.spawns.length).toBe(1)
})

test('Abbruch: höchstens drei Neustarts mit wachsendem Abstand, danach erst beim nächsten Titel; nie ein Wurf', DE, async ($, on) => {
  const w = world(on)
  await playing($, w)
  expect(w.h.spawns.length).toBe(1)
  const waits: number[] = []
  for (let i = 0; i < 4; i++) {
    w.abort()
    await w.clock.settle()
    const before = w.h.spawns.length
    let waited = 0
    while (w.h.spawns.length === before && waited < 120_000) {
      await w.clock.advance(1000)
      waited += 1000
    }
    waits.push(waited)
  }
  // drei Neustarts (5 s, 20 s, 60 s), der vierte Abbruch wartet auf den nächsten Titel
  expect(w.h.spawns.length).toBe(4)
  expect(waits[0]!).toBeLessThan(waits[1]!)
  expect(waits[1]!).toBeLessThan(waits[2]!)
  expect(waits[3]).toBe(120_000)
  const r = (await $.command.run({ command: 'tune', args: 'beat' } as never)) as { text: string }
  expect(r.text).toContain('neuer Versuch beim nächsten Titel')
  // Nächster Titel: wieder ein Versuch
  w.setSong({ over: { title: 'Help!' }, pos: 1 })
  await w.clock.advance(6000)
  expect(w.h.spawns.length).toBe(5)
})

test('Fehlerzeile `fail` (kein Zugriff, altes Windows): kein Takt, kein Rückfall, zählt wie ein Abbruch', DE, async ($, on) => {
  const w = world(on)
  await playing($, w)
  w.say('fail 0x80070005\n')
  w.abort()
  await w.clock.settle()
  await w.clock.advance(1000)
  expect(w.st.stored ?? null).toBeNull()
  const r = (await $.command.run({ command: 'tune', args: 'beat' } as never)) as { text: string }
  expect(r.text).toContain('kein Zugriff auf den Ton von Spotify')
  expect(w.h.spawns.length).toBe(1)
})

test('Titelwechsel im Mod: der alte Takt verschwindet, der neue kommt aus neuen Messungen', DE, async ($, on) => {
  const w = world(on)
  await playing($, w)
  await w.beats(5, { bpm: 128 })
  await w.clock.advance(1000)
  near((w.st.stored as Beat).bpm, 128, 0.5)
  w.setSong({ over: { title: 'Help!' }, pos: 0 })
  const changed = w.clock.now()
  await w.clock.advance(4500)
  expect(w.st.stored).toBeNull()
  await w.beats(4, { bpm: 92, origin: changed })
  await w.clock.advance(1000)
  near((w.st.stored as Beat).bpm, 92, 0.5)
  expect(w.clock.now() - changed).toBeLessThanOrEqual(16_000)
})

test('Nach /clear, /resume und /branch steht tune-strip.beat sofort wieder da', DE, async ($, on) => {
  const w = world(on)
  on('classic.SessionStart', () => ({}) as never)
  await playing($, w)
  await w.beats(5, { bpm: 120 })
  await w.clock.advance(1000)
  expect(w.st.stored).not.toBeNull()
  for (const source of ['clear', 'resume', 'fork'] as const) {
    w.st.stored = undefined
    await ($ as any).classic.SessionStart({ source })
    near((w.st.stored as Beat | undefined)?.bpm, 120, 0.5)
  }
})

test('Nicht Windows: kein Helfer, kein Schreiben', async ($, on) => {
  const w = world(on, { cwd: '/home/fynn' })
  await playing($, w)
  await w.clock.advance(10_000)
  expect(w.h.spawns.length).toBe(0)
  expect(w.st.beatWrites.length).toBe(0)
})

for (const surface of ['vscode', 'mobile'] as const) {
  test(`${surface}: kein Helfer`, async ($, on) => {
    const w = world(on)
    await playing($, w, surface)
    await w.clock.advance(10_000)
    expect(w.h.spawns.length).toBe(0)
  })
}

test('/tune help nennt die drei Takt-Befehle', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const r = (await $.command.run({ command: 'tune', args: 'help' } as never)) as { text: string }
  for (const c of ['/tune beat', '/tune beat on|off', '/tune beat offset <ms>']) expect(r.text).toContain(c)
})

// ---------- Review 0.6.0 ----------

test('spawn abgelehnt (z. B. Richtlinie): kein Wurf, kein Takt, höchstens drei Neustarts, dann erst beim nächsten Titel (S4)', DE, async ($, on) => {
  const w = world(on, { denySpawn: true })
  await playing($, w)
  for (let i = 0; i < 120; i++) await w.clock.advance(1000)
  expect(w.h.spawns.length, 'erster Versuch und drei Neustarts').toBe(4)
  expect(w.st.stored ?? null).toBeNull()
  const r = (await $.command.run({ command: 'tune', args: 'beat' } as never)) as { text: string }
  expect(r.text).toContain('neuer Versuch beim nächsten Titel')
  w.setSong({ over: { title: 'Help!' }, pos: 1 })
  await w.clock.advance(6000)
  expect(w.h.spawns.length).toBe(5)
})

test('Tempo an der Faltgrenze: Messungen um 150 springen nicht zwischen 150 und 75; gemeldet nie über 150 (S1, S2)', async () => {
  for (const around of [149.6, 150, 150.4]) {
    const t = new Tracker()
    t.reset(NOW - 1000)
    const seen: Beat[] = []
    let k = 0
    for (let end = NOW + 6000; end <= NOW + 60_000; end += 2500, k++) {
      const bpm = around + (k % 2 ? 0.5 : -0.5) // 149,1 / 150,1 usw.: mal unter, mal über der Grenze
      const P = 60000 / around // die echten Schläge liegen im wahren Tempo, nur die Tempo-Messung streut
      t.feed(meas({ end, bpm, at: Math.floor((end - 20) / P) * P, tclar: 1.4, pclar: 5 }))
      const v = t.value(end + 100, 0)
      if (v) seen.push(v)
    }
    const late = seen.slice(4)
    expect(late.every((v) => v.sure), `sicher bei ${around}`).toBe(true)
    expect(Math.max(...seen.map((v) => v.bpm)), `nie über 150 bei ${around}`).toBeLessThanOrEqual(150)
    expect(Math.min(...late.map((v) => v.bpm)), `kein Sprung auf das halbe Tempo bei ${around}`).toBeGreaterThan(140)
    // Geschrieben würde selten: höchstens alle 15 s eine Nachstellung
    let writes = 0
    let prev: Beat | null = null
    let at = 0
    seen.forEach((v, i) => {
      const now = NOW + 6000 + i * 2500
      if (needsWrite(prev, v, now, at)) {
        writes++
        prev = v
        at = now
      }
    })
    expect(writes, `Schreibvorgänge bei ${around}`).toBeLessThanOrEqual(6)
  }
  expect(foldBpm(0)).toBe(60)
  expect(foldBpm(Infinity)).toBe(60)
  expect(foldBpm(NaN)).toBe(60)
})

test('Desktop-App (SDK): session.start meldet keine Oberfläche, erst das Zeichnen sagt desktop: der Helfer startet trotzdem', DE, async ($, on) => {
  const w = world(on)
  on('classic.SessionStart', () => ({}) as never)
  // So startet die Desktop-App: stream-json, `surface: null`, nicht interaktiv (types@2.1.318:12620-12629)
  await $.session.start({ cwd: 'C:\\work', surface: null, isInteractive: false })
  await w.clock.advance(10)
  await w.clock.settle()
  const ui = await $.ui.mount(band('desktop'))
  await ui.drawn()
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(w.h.spawns.length).toBe(1)
  w.say('ready\n')
  await w.beats(5, { bpm: 120 })
  await w.clock.advance(1000)
  near((w.st.stored as Beat).bpm, 120, 0.5)
  // Nach /clear meldet er den Takt auch hier sofort wieder (die Oberfläche kommt aus dem Zeichnen)
  w.st.stored = undefined
  await ($ as any).classic.SessionStart({ source: 'clear' })
  near((w.st.stored as Beat | undefined)?.bpm, 120, 0.5)
})

test('claude -p (keine Oberfläche, nie gezeichnet): kein Helfer, nichts geschrieben außer null', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: 'C:\\work', surface: null, isInteractive: false })
  await w.clock.advance(20_000)
  expect(w.h.spawns.length).toBe(0)
  expect(w.st.beatWrites.every((v) => v === null)).toBe(true)
})

test('/tune beat sagt, worauf er wartet: Pause, Band nicht sichtbar (0.6.3)', DE, async ($, on) => {
  const w = world(on)
  const ui = await playing($, w)
  w.setSong({ paused: true })
  await w.clock.advance(5000)
  await w.beats(7) // 15 s ohne Bedarf: Helfer endet
  expect(w.h.open).toBe(0)
  const paused = (await $.command.run({ command: 'tune', args: 'beat' } as never)) as { text: string }
  expect(paused.text).toContain('wartet: es läuft nichts')
  // Band verdeckt: kein Zeichnen mehr, der Abfragetakt hält nach einigen Sekunden an
  await ui.unmount()
  w.setSong({ paused: false })
  await $.command.run({ command: 'tune', args: 'size full' } as never)
  await w.clock.advance(6000)
  await w.beats(8) // der Helfer darf 15 s nachlaufen, dann endet er
  expect(w.h.open).toBe(0)
  const hidden = (await $.command.run({ command: 'tune', args: 'beat' } as never)) as { text: string }
  expect(hidden.text).toContain('wartet: Band gerade nicht sichtbar')
})

test('Terminal zu schmal (Stufe aus): kein Helfer, obwohl der Abfragetakt läuft (K3)', async ($, on) => {
  const w = world(on)
  await playing($, w, 'terminal', 12)
  await w.clock.advance(10_000)
  expect(w.h.spawns.length).toBe(0)
})

test('Spotify beendet: ohne Prozess-ID kein Neustart gegen die alte (K1)', DE, async ($, on) => {
  const w = world(on)
  await playing($, w)
  expect(w.h.spawns.length).toBe(1)
  w.setSong({ over: { pid: 0 } })
  w.abort() // „fail gone“: Spotify ist weg
  for (let i = 0; i < 30; i++) await w.clock.advance(1000)
  expect(w.h.spawns.length).toBe(1)
})
