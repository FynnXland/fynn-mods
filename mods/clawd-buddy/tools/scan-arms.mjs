// Meldet Blockarme, die länger als MAX Pixel sind (lange 2-Pixel-Rechtecke lesen sich als dünne Linie statt als Stummel).
//   node tools/scan-arms.mjs [MAX=4]
import { ALL_CLIPS } from '../hooks/library.ts'
import { resolveClip } from '../hooks/clipdef.ts'

const MAX = Number(process.argv[2] ?? 4)
let total = 0
for (const c of ALL_CLIPS) {
  const r = resolveClip(c)
  const lens = new Map()
  for (const f of [...r.intro, ...r.body, ...r.outro]) {
    for (const a of [f.p.armL, f.p.armR]) {
      if (typeof a === 'object' && 'out' in a && a.out > MAX) lens.set(a.out, (lens.get(a.out) ?? 0) + 1)
    }
  }
  if (lens.size) {
    total++
    console.log(`${c.name.padEnd(22)} ${[...lens].map(([k, n]) => `out ${k} ×${n}`).join(', ')}`)
  }
}
console.log(`\n${total} Clips mit Blockarm länger als ${MAX} Pixel`)
