// Prüfung "nichts taucht aus dem Nichts auf":
//   node tools/lint.mjs <clip>... | --all | --cat <kategorie>   [--seeds 3] [--json]
// Spielt jeden Clip mit der echten Engine ab (mehrere Zufallsstarts) und meldet Spawns/Vanishes, Ruckler und Liegengebliebenes.
// Exit-Code 1, sobald etwas gefunden wird.
import { ALL_CLIPS } from '../hooks/library.ts'
import { captureClip } from './lib/capture.mjs'
import { lintFrames } from './lib/lint.mjs'

const args = process.argv.slice(2)
const VALUE_OPTS = ['--seeds', '--cat']
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const seeds = Number(opt('--seeds', 2))
let names = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]))
if (args.includes('--all')) names = ALL_CLIPS.map((c) => c.name)
if (args.includes('--cat')) names = ALL_CLIPS.filter((c) => c.cat === opt('--cat')).map((c) => c.name)
if (!names.length) {
  console.error('Clip-Namen angeben, --all oder --cat <kategorie>')
  process.exit(2)
}
let bad = 0
const report = {}
for (const n of names) {
  const seen = new Map()
  for (let s = 1; s <= seeds; s++) {
    for (const i of lintFrames(captureClip(n, { seed: s }))) {
      const key = `${i.kind}|${i.name}|${i.x},${i.y}`
      if (!seen.has(key)) seen.set(key, { ...i, seed: s })
    }
  }
  report[n] = [...seen.values()]
  if (seen.size) bad++
  if (!args.includes('--json')) {
    console.log(seen.size ? `✗ ${n}: ${seen.size} Befund(e)` : `✓ ${n}`)
    for (const i of seen.values()) console.log(`    Bild ${i.frame + 1}: ${i.kind}${i.name ? ' "' + i.name + '"' : ''} bei (${i.x},${i.y})  [Seed ${i.seed}]`)
  }
}
if (args.includes('--json')) console.log(JSON.stringify(report, null, 1))
else console.log(`\n${names.length - bad} von ${names.length} Clips ohne Befund`)
process.exit(bad ? 1 : 0)
