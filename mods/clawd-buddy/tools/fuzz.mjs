// Zufallstest der Engine über lange Läufe:
//   node tools/fuzz.mjs [--seeds 20] [--ticks 3000] [--lint]
// Mischt Stimmungswechsel, Klicks, Armziehen, Hochheben, Tag/Nacht und prüft: kein Wurf, gültige Posen, jeder Clip-Übergang
// endet in einer kanonischen Pose. Mit --lint läuft zusätzlich die "nichts taucht auf"-Prüfung über den ganzen Lauf.
import { ALL_CLIPS } from '../hooks/library.ts'
import { POSES, W, H } from '../hooks/stage.ts'
import { newEngine } from './lib/capture.mjs'
import { lintFrames } from './lib/lint.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d)
const seeds = opt('--seeds', 20)
const ticks = opt('--ticks', 3000)
const MOODS = ['idle', 'watching', 'work_think', 'work_read', 'work_write', 'work_shell', 'work_web', 'work_agent', 'wait10', 'wait60', 'waitUser', 'done', 'oops']
let failures = 0
let lintTotal = 0
const seenIssues = new Map()

for (let seed = 1; seed <= seeds; seed++) {
  const e = newEngine(seed, { idleSeconds: 6 })
  const rnd = (n) => Math.floor(((seed * 9301 + 49297) % 233280) / 233280 * n) // nur Platzhalter, echte Zufallsfolge unten
  let r = seed * 7919
  const rand = () => {
    r = (r * 1103515245 + 12345) & 0x7fffffff
    return r / 0x7fffffff
  }
  const frames = []
  try {
    e.start()
    for (let t = 0; t < ticks; t++) {
      const roll = rand()
      if (roll < 0.012) e.setMood(MOODS[Math.floor(rand() * MOODS.length)])
      else if (roll < 0.016) {
        const c = e.render()
        // Zeiger irgendwo über der Figur: klicken oder ziehen
        const x = 34 + Math.floor(rand() * 17)
        const y = 4 + Math.floor(rand() * 10)
        e.pointer('move', x, y)
        e.pointer('down', x, y)
        const drag = rand() < 0.6
        for (let k = 0; k < (drag ? 6 : 0); k++) {
          e.pointer('move', x + (rand() * 20 - 10), y + (rand() * 8 - 6))
          e.tick()
          frames.push(snap(e))
        }
        e.pointer('up', x + 2, y)
      } else if (roll < 0.018) e.set({ hour: rand() < 0.5 ? 23.5 : 7.25 })
      else if (roll < 0.019) e.set({ hour: 12 })
      e.tick()
      frames.push(snap(e))
      const p = e.pose()
      for (const k of ['fx', 'fy', 'by', 'squash']) if (!Number.isFinite(p[k])) throw new Error(`Pose ${k} ist ${p[k]}`)
      if (!POSES[e.S.landing]) throw new Error(`unbekannte Landepose ${e.S.landing}`)
    }
  } catch (err) {
    failures++
    console.log(`✗ Seed ${seed}: ${err.stack.split('\n').slice(0, 4).join(' | ')}`)
    continue
  }
  if (args.includes('--lint')) {
    for (const i of lintFrames(frames)) {
      const key = `${i.kind}|${i.name}`
      lintTotal++
      if (!seenIssues.has(key)) seenIssues.set(key, { ...i, seed, n: 1 })
      else seenIssues.get(key).n++
    }
  }
}
function snap(e) {
  const c = e.render()
  const pl = e.S.play
  return { buf: c.buf, hit: c.hit, pose: e.pose(), clip: pl?.clip.name ?? '', phase: pl?.phase ?? '' }
}
console.log(failures ? `✗ ${failures} von ${seeds} Läufen mit Fehler` : `✓ ${seeds} Läufe à ${ticks} Ticks ohne Fehler (${ALL_CLIPS.length} Clips, Bühne ${W}×${H})`)
if (args.includes('--lint')) {
  console.log(`Prüfung "nichts taucht auf": ${lintTotal} Treffer in ${seenIssues.size} Arten`)
  for (const i of [...seenIssues.values()].slice(0, 40)) console.log(`    ${i.kind} "${i.name}" ×${i.n} (erstmals Seed ${i.seed}, Bild ${i.frame + 1})`)
}
process.exit(failures ? 1 : 0)
