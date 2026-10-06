// limit-bars: Desktop-Grafik. Ein Svg-Bild (ohne isInteractive, types@2.1.288:11578-11605), 4-px-Raster, fest gestapelt:
// je Fenster eine Textzeile (12 px) und darunter ein Segmentbalken (8 px); 5h oben, Woche unten, unten bündig.
// Rechts daneben im selben Bild der Cache-Ring (ring.ts) und der Speicher-Ring (storage.ts), damit sie sicher zwischen
// Balken und Clawd sitzen.
import { FONT, RING_H, RING_SIZE, esc, ringSvg } from './ring.ts'
import type { RingView } from './ring.ts'
import { DISK_W, diskRingSvg } from './storage.ts'
import type { DiskView } from './storage.ts'
import { EMPTY, GREY, ORANGE } from './view.ts'
import type { Shown } from './view.ts'

const SEGMENTS = 44 // je 4 px: 3 px Segment, 1 px Fuge
const PITCH = 4
const SEG = 3
const BAR_H = 8
const GROUP = 24 // Text 0–12, Fuge 4, Balken 16–24
const GROUP_GAP = 8
const SPACE_RIGHT = 8 // Abstand zu Clawd
const BAR_W = SEGMENTS * PITCH // 176

function group(s: Shown, top: number): string {
  const dim = s.fresh ? ' opacity="0.55"' : ''
  const w = s.strong ? ' font-weight="700"' : ''
  const rest = s.reset ? ` · ${s.reset.long}` : ''
  const text =
    `<text x="0" y="${top + 11}" font-family="${FONT}" font-size="12"${dim}>` +
    `<tspan fill="${ORANGE}"${w}>${s.tag}</tspan>` +
    `<tspan fill="${s.fresh ? GREY : s.color}"${w}> ${esc(s.pct.long)}</tspan>` +
    (rest ? `<tspan fill="${GREY}">${esc(rest)}</tspan>` : '') +
    `</text>`
  const on = Math.max(0, Math.min(SEGMENTS, Math.round(s.ratio * SEGMENTS)))
  let segs = ''
  for (let i = 0; i < SEGMENTS; i++) {
    segs += `<rect x="${i * PITCH}" y="${top + 16}" width="${SEG}" height="${BAR_H}" rx="0.5" fill="${i < on ? s.color : EMPTY}"/>`
  }
  return text + segs
}

const PAD_LEFT = 10
const RING_GAP = 8 // Abstand Balken – Ring

/**
 * Das Bild für bis zu zwei Fenster, optional den Cache-Ring und den Speicher-Ring rechts daneben (zwischen Balken und
 * Clawd). Höhe ohne Ring 24 (ein Fenster) bzw. 56 (zwei); mit einem Ring immer 56, die Balken dann unten bündig.
 */
export function desktopSvg(
  shown: readonly Shown[],
  ring?: RingView,
  disk?: DiskView,
): { source: string; width: number; height: number; alt: string } {
  const list = shown.slice(0, 2)
  const barsH = list.length > 0 ? list.length * GROUP + (list.length - 1) * GROUP_GAP : 0
  const height = ring || disk ? Math.max(RING_H, barsH) : barsH
  // Etwas Luft zum linken Rand des Bands (Fynn): der Inhalt rückt im Bild um PAD_LEFT nach rechts
  let x = list.length > 0 ? BAR_W : 0
  const place = (w: number) => {
    const at = x > 0 ? x + RING_GAP : 0
    x = at + w
    return at
  }
  const dy = height - barsH
  let body = list.map((s, i) => group(s, dy + i * (GROUP + GROUP_GAP))).join('')
  if (ring) body += ringSvg(ring, place(RING_SIZE), height - RING_H)
  if (disk) body += diskRingSvg(disk, place(DISK_W), height - RING_H)
  const width = PAD_LEFT + x + SPACE_RIGHT
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="translate(${PAD_LEFT} 0)">${body}</g></svg>`
  const alt = [...list.map((s) => `${s.name} ${s.pct.alt}${s.reset ? `, ${s.reset.alt}` : ''}`), ...(ring ? [ring.alt] : []), ...(disk ? [disk.alt] : [])].join('; ')
  return { source, width, height, alt }
}
