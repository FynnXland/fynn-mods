// Spiegelprüfung: zeichnet jedes Bild jedes Clips gespiegelt und vergleicht es mit dem Spiegelbild des ungespiegelten Bilds (ohne noFlip-Zeichen).
// Meldet Clips mit abweichenden Pixeln (z. B. Augen unter einem Zeichen). Aufruf: node tools/mirror-check.mjs
import { ALL_CLIPS, ALL_PROPS } from '../hooks/library.ts'
import { resolveClip } from '../hooks/clipdef.ts'
import { compose, FX, W, H, propSprite } from '../hooks/stage.ts'
const bad = new Map()
for (const c of ALL_CLIPS) {
  const r = resolveClip(c)
  for (const [ph, list] of Object.entries(r)) list.forEach((f, i) => {
    const a = compose(f.p, ALL_PROPS), b = compose({ ...f.p, mirror: true }, ALL_PROPS)
    const ax = FX + Math.round(f.p.fx) + 8
    let diff = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = b.hit[y * W + x]
      const sp = t && t.startsWith('prop:') ? propSprite(ALL_PROPS, t.slice(5)) : undefined
      if (sp?.noFlip || sp?.mirrorRows) continue // Zeichen bleiben gewollt lesbar
      const mx = 2 * ax - x
      const va = mx >= 0 && mx < W ? a.buf[y * W + mx] : undefined
      if (va === undefined) continue
      if ((b.buf[y * W + x] ?? null) !== (va ?? null)) diff++
    }
    if (diff) { const k = c.name; const v = bad.get(k) ?? []; v.push(`${ph}${i}:${diff}`); bad.set(k, v) }
  })
}
for (const [k, v] of bad) console.log(k, v.slice(0, 6).join(' '), v.length)
console.log('Clips mit Abweichung:', bad.size)
