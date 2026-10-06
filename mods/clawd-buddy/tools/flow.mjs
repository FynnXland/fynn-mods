// Übergänge im Alltag messen: simulierte Sitzungen (tippen, Turn mit Tools und Denkpausen, lesen, Leerlauf) treiben die Engine wie
// der Desktop (deriveMood je Takt). Gezählt wird, wie lange Clips laufen und wie oft einer mitten im Ablauf verlassen wird.
//   node tools/flow.mjs [--seeds 6] [--minutes 60] [--log]
import { ALL_CLIPS, ALL_PROPS } from '../hooks/library.ts'
import { createEngine } from '../hooks/engine.ts'
import { mulberry32 } from '../hooks/capture.ts'
import { deriveMood, NO_FACTS } from '../hooks/mood.ts'
import { TICK } from '../hooks/stage.ts'

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d)
const SEEDS = opt('--seeds', 6)
const MINUTES = opt('--minutes', 60)
const LOG = args.includes('--log')

/** Zeitplan einer Sitzung: Liste [ms, Änderung der Fakten]. */
function schedule(rand, totalMs) {
  const ev = []
  const between = (a, b) => a + rand() * (b - a)
  const logU = (a, b) => Math.exp(between(Math.log(a), Math.log(b)))
  let t = 2000
  while (t < totalMs) {
    // Fynn tippt
    const typeFor = between(4000, 20000)
    for (let k = 0; k < typeFor; k += 400) ev.push([t + k, { typingAt: t + k }])
    t += typeFor + between(300, 1500)
    ev.push([t, { turnActive: true, endedKind: '', lastTool: undefined }])
    t += between(1500, 8000)
    const steps = Math.floor(between(3, 25))
    for (let s = 0; s < steps; s++) {
      const r = rand()
      const [kind, dur] =
        r < 0.35 ? ['read', between(100, 800)]
        : r < 0.55 ? ['write', between(100, 500)]
        : r < 0.8 ? ['shell', logU(400, 15000)]
        : r < 0.9 ? ['test', logU(3000, 40000)]
        : r < 0.95 ? ['git', between(800, 4000)]
        : ['think', between(200, 3000)]
      ev.push([t, { tool: { kind, since: t } }])
      t += dur
      ev.push([t, { tool: null, lastTool: kind === 'think' ? undefined : { kind, endedAt: t } }])
      t += logU(800, 12000)
    }
    ev.push([t, { turnActive: false, tool: null, endedAt: t, endedKind: rand() < 0.9 ? 'done' : 'oops' }])
    t += logU(5000, 180000)
  }
  return ev.sort((a, b) => a[0] - b[0])
}

const runs = [] // { name, cat, ticks, cut, cycles }
const moodRuns = []
let totalTicks = 0
for (let seed = 1; seed <= SEEDS; seed++) {
  const rand = mulberry32(seed * 7919)
  const engine = createEngine({ clips: ALL_CLIPS, props: ALL_PROPS, rng: mulberry32(seed), hour: 14, idleSeconds: 45 })
  engine.start()
  const total = MINUTES * 60_000
  const ev = schedule(rand, total)
  let facts = { ...NO_FACTS }
  let i = 0
  let mood = ''
  let cur = null
  let moodSince = 0
  const S = engine.S
  for (let n = 0; n * TICK < total; n++) {
    const now = n * TICK
    while (i < ev.length && ev[i][0] <= now) facts = { ...facts, ...ev[i++][1] }
    const m = deriveMood(facts, now)
    if (m !== mood) {
      if (mood) moodRuns.push({ mood, ms: now - moodSince })
      mood = m
      moodSince = now
      engine.setMood(m)
    }
    engine.tick()
    const pl = S.play
    const name = pl?.clip.name
    if (!cur || cur.name !== name || cur.play !== pl) {
      if (cur && !cur.cut && cur.lastPhase === 'body' && cur.play.interrupted && cur.lastFi < cur.play.body.length - 1 && !['dynamic', 'transition'].includes(cur.cat)) cur.cut = true
      if (cur) {
        runs.push(cur)
        if (LOG && seed === 1) console.log(`${(now / 1000).toFixed(1).padStart(7)}s  ${cur.cut ? '✂' : ' '} ${cur.name} (${cur.cat}, ${(cur.ticks * TICK / 1000).toFixed(1)} s, ${cur.cycles} Durchl.) → ${name}  [${S.mood}]`)
      }
      cur = { name, cat: pl?.clip.cat, ticks: 0, cut: false, cycles: 0, play: pl, lastFi: -1 }
    }
    cur.ticks++
    // Hauptteil mitten drin verlassen: zuletzt im Hauptteil gesehen, nicht am letzten Bild, und danach nicht mehr im Hauptteil
    if (cur.lastPhase === 'body' && pl.phase !== 'body' && pl.interrupted && cur.lastFi < pl.body.length - 1 && !['dynamic', 'transition'].includes(pl.clip.cat)) {
      cur.cut = true
      cur.cutAt = cur.lastFi / pl.body.length
    }
    if (pl.phase === 'body' && pl.fi < cur.lastFi) cur.cycles++
    if (pl.phase === 'outro' && cur.lastPhase === 'body' && !pl.interrupted) cur.cycles++
    cur.lastFi = pl.fi
    cur.lastPhase = pl.phase
    totalTicks++
  }
}

const real = runs.filter((r) => r.cat && r.cat !== 'dynamic' && r.cat !== 'transition')
const by = (f) => {
  const m = new Map()
  for (const r of real) {
    const k = f(r)
    const v = m.get(k) ?? { n: 0, ticks: 0, cut: 0 }
    v.n++
    v.ticks += r.ticks
    if (r.cut) v.cut++
    m.set(k, v)
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
}
const pct = (a, b) => `${Math.round((100 * a) / Math.max(1, b))} %`
console.log(`\n${SEEDS} Sitzungen à ${MINUTES} min: ${real.length} Clips, ${real.filter((r) => r.cut).length} mitten im Hauptteil verlassen (${pct(real.filter((r) => r.cut).length, real.length)})`)
console.log(`Clips pro Minute: ${(real.length / (SEEDS * MINUTES)).toFixed(1)}; Zwischenclips (Übergänge, Wegräumen): ${runs.length - real.length}`)
console.log('\nGruppe            Anzahl  Ø Dauer  abgebrochen')
for (const [k, v] of by((r) => r.cat)) console.log(`${k.padEnd(16)} ${String(v.n).padStart(6)}  ${(v.ticks * TICK / 1000 / v.n).toFixed(1).padStart(5)} s  ${pct(v.cut, v.n).padStart(6)}`)
const mm = new Map()
for (const r of moodRuns) {
  const v = mm.get(r.mood) ?? { n: 0, ms: 0, short: 0 }
  v.n++
  v.ms += r.ms
  if (r.ms < 3000) v.short++
  mm.set(r.mood, v)
}
console.log('\nStimmung         Wechsel  Ø Dauer  < 3 s')
for (const [k, v] of [...mm.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`${k.padEnd(16)} ${String(v.n).padStart(6)}  ${(v.ms / 1000 / v.n).toFixed(1).padStart(5)} s  ${pct(v.short, v.n).padStart(6)}`)
