// Bildstreifen eines Clips: jedes Bild als Zelle, gleiche Folgebilder zusammengefasst (×n), darunter Linie und "Kasten".
// Die Phasenleiste über jeder Zelle zeigt: blau = Intro, grün = Hauptteil, orange = Outro, grau = sonstiges.
import { Canvas, hex, text } from './png.mjs'
import { H, PAL, W } from '../../hooks/stage.ts'

const PHASE = { intro: [80, 140, 230], body: [90, 190, 110], outro: [235, 150, 60], end: [150, 150, 150] }

export function renderSheet(frames, { scale = 5, perRow = 8 } = {}) {
  const cells = []
  for (const f of frames) {
    const key = f.buf.join('|')
    const prev = cells[cells.length - 1]
    if (prev && prev.key === key) prev.n++
    else cells.push({ key, f, n: 1 })
  }
  // Ausschnitt: Vereinigung aller belegten Pixel plus ein Rand
  let x0 = W
  let x1 = -1
  let y0 = H
  for (const c of cells) {
    c.f.buf.forEach((v, i) => {
      if (!v) return
      const x = i % W
      const y = Math.floor(i / W)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
    })
  }
  x0 = Math.max(0, x0 - 1)
  x1 = Math.min(W - 1, x1 + 1)
  y0 = Math.max(0, y0 - 1)
  const y1 = H - 1
  const cw = (x1 - x0 + 1) * scale
  const ch = (y1 - y0 + 1) * scale
  const boxH = 3 * scale
  const labelH = 7 * scale
  const gap = 6
  const cellH = labelH + ch + boxH
  const rows = Math.ceil(cells.length / perRow)
  const cols = Math.min(perRow, cells.length)
  const cv = new Canvas(cols * (cw + gap) + gap, rows * (cellH + gap) + gap, [14, 14, 14])
  const fs = Math.max(1, Math.floor(scale / 3))
  cells.forEach((c, i) => {
    const cx = gap + (i % perRow) * (cw + gap)
    const cy = gap + Math.floor(i / perRow) * (cellH + gap)
    cv.rect(cx, cy + labelH, cw, ch, [26, 26, 25]) // Bühne (Hintergrundton der Desktop-App)
    cv.rect(cx, cy + labelH + ch, cw, boxH, [34, 34, 34]) // der Kasten der Eingabebox unter der Linie
    cv.rect(cx, cy + labelH + ch, cw, Math.max(1, Math.floor(scale / 3)), [90, 90, 90]) // die Linie
    cv.rect(cx, cy + labelH - 2 * scale, cw, scale, PHASE[c.f.phase] || [100, 100, 100])
    text(cv, cx, cy + labelH - 5 * scale, String(i + 1), fs, [200, 200, 200])
    if (c.n > 1) text(cv, cx + 12 * scale, cy + labelH - 5 * scale, 'x' + c.n, fs, [240, 200, 90])
    c.f.buf.forEach((v, j) => {
      if (!v) return
      const x = j % W
      const y = Math.floor(j / W)
      if (x < x0 || x > x1 || y < y0 || y > y1) return
      cv.rect(cx + (x - x0) * scale, cy + labelH + (y - y0) * scale, scale, scale, hex(PAL[v]))
    })
  })
  return { png: cv.png(), cells: cells.length, frames: frames.length }
}
