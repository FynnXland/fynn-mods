// limit-bars: Desktop-Grafik. Ein Svg-Bild (ohne isInteractive, types@2.1.288:11578-11605), 4-px-Raster, unten bündig.
// Stil `bar` (Standard): je Fenster eine Textzeile (12 px) und darunter ein Segmentbalken (8 px); 5h oben, Woche unten.
// Stil `ring` (Ausbau 0.10.0): je Fenster ein Ring wie der Cache-Ring, 5h links, Woche rechts.
// Rechts daneben im selben Bild der Cache-Ring (ring.ts) und der Speicher-Ring (storage.ts), damit sie sicher zwischen
// Limits und Clawd sitzen.
import { FONT, MARK, RING_H, darker, RING_SIZE, esc, limitRingSvg, ringSvg } from './ring.ts'
import type { RingView } from './ring.ts'
import { DISK_W, diskRingSvg } from './storage.ts'
import type { DiskView } from './storage.ts'
import { EMPTY, GREY, ORANGE } from './view.ts'
import type { Shown } from './view.ts'

export type Style = 'bar' | 'ring'

const SEGMENTS = 44 // je 4 px: 3 px Segment, 1 px Fuge
const PITCH = 4
const SEG = 3
const BAR_H = 8
const GROUP = 24 // Text 0–12, Fuge 4, Balken 16–24
const GROUP_GAP = 8
const SPACE_RIGHT = 8 // Abstand zu Clawd
const BAR_W = SEGMENTS * PITCH // 176
// Breite eines Zeichens der Monospace-Schrift je px Schriftgröße (ui-monospace, Cascadia Mono, Consolas: 0,6 em)
const CHAR = 0.6
const MARK_ABOVE = 4 // Strich: so weit über den Balken hinaus (5 stieß an die Textzeile, 0.10.4)
const MARK_BELOW = 2 // und so weit darunter

/** Tempo-Zeile im Balken-Stil: oben `5h ∞ · +12 % über Tempo`, darunter klein, wo der Balken stünde, `reicht bis Fr 14:00`. */
function paceGroup(s: Shown, top: number): string {
  const p = s.pace!
  let out =
    `<text x="0" y="${top + 11}" font-family="${FONT}" font-size="12">` +
    `<tspan fill="${ORANGE}">5h</tspan><tspan fill="${GREY}" opacity="0.7"> ∞</tspan>` +
    (p.head ? `<tspan fill="${p.color}"> &#183; ${esc(p.head)}</tspan>` : '') +
    `</text>`
  if (p.sub) out += `<text x="0" y="${top + 23}" font-family="${FONT}" font-size="10" fill="${GREY}">${esc(p.sub)}</text>`
  return out
}

function group(s: Shown, top: number): string {
  if (s.pace) return paceGroup(s, top)
  const dim = s.fresh ? ' opacity="0.55"' : ''
  const w = s.strong ? ' font-weight="700"' : ''
  const rest = s.reset ? ` · ${s.reset.long}` : ''
  const text =
    // Mit Strich steht die Zeile 1 px höher, damit der Strich darunter Luft hat (0.10.4)
    `<text x="0" y="${top + 11 - (s.mark !== undefined ? 1 : 0)}" font-family="${FONT}" font-size="12"${dim}>` +
    `<tspan fill="${ORANGE}"${w}>${s.tag}</tspan>` +
    `<tspan fill="${s.fresh ? GREY : s.color}"${w}> ${esc(s.pct.long)}</tspan>` +
    (rest ? `<tspan fill="${GREY}">${esc(rest)}</tspan>` : '') +
    `</text>`
  const on = Math.max(0, Math.min(SEGMENTS, Math.round(s.ratio * SEGMENTS)))
  let segs = ''
  for (let i = 0; i < SEGMENTS; i++) {
    segs += `<rect x="${i * PITCH}" y="${top + 16}" width="${SEG}" height="${BAR_H}" rx="0.5" fill="${i < on ? s.color : EMPTY}"/>`
  }
  // Strich beim gleichmäßigen Verbrauch: 2 px, oben deutlich (MARK_ABOVE), unten knapp (MARK_BELOW) über den Balken hinaus,
  // orange bzw. rot ab Erreichen; darum 1 px Rand in einer dunkleren Fassung derselben Farbe (Fynn, 0.10.4)
  if (s.mark !== undefined) {
    const mx = Math.round(Math.max(0, Math.min(1, s.mark)) * (BAR_W - 2))
    const c = s.markColor ?? MARK
    const y = top + 16 - MARK_ABOVE
    const h = BAR_H + MARK_ABOVE + MARK_BELOW
    segs += `<rect x="${mx - 1}" y="${y}" width="4" height="${h}" fill="${darker(c)}"/>`
    segs += `<rect x="${mx}" y="${y}" width="2" height="${h}" fill="${c}"/>`
  }
  return text + segs
}

/** Breite der Tempo-Spalte im Ring-Stil: die längste ihrer drei Zeilen, auf 4 px aufgerundet. */
function paceColumnW(s: Shown): number {
  const p = s.pace!
  const w = Math.max(4 * 12 * CHAR, p.head.length * 11 * CHAR, (p.sub?.length ?? 0) * 10 * CHAR)
  return Math.ceil(w / 4) * 4
}

/** Tempo im Ring-Stil, links neben dem Wochen-Ring: `5h ∞` auf der Höhe der Ring-Kürzel, darunter Kopf und Prognose. */
function paceColumn(s: Shown, x: number, y: number): string {
  const p = s.pace!
  let out =
    `<text x="${x}" y="${y + 11}" font-family="${FONT}" font-size="12"><tspan fill="${ORANGE}">5h</tspan><tspan fill="${GREY}" opacity="0.7"> ∞</tspan></text>`
  if (p.head) out += `<text x="${x}" y="${y + 34}" font-family="${FONT}" font-size="11" fill="${p.color}">${esc(p.head)}</text>`
  if (p.sub) out += `<text x="${x}" y="${y + 48}" font-family="${FONT}" font-size="10" fill="${GREY}">${esc(p.sub)}</text>`
  return out
}

const PAD_LEFT = 10
const RING_GAP = 8 // Abstand zwischen Balken bzw. Ringen

/**
 * Das Bild für bis zu zwei Fenster, optional den Cache-Ring und den Speicher-Ring rechts daneben (zwischen Limits und
 * Clawd). Balken: Höhe ohne Ring 24 (ein Fenster) bzw. 56 (zwei); mit einem Ring immer 56, die Balken dann unten bündig.
 * Ringe: immer 56 hoch.
 */
export function desktopSvg(
  shown: readonly Shown[],
  ring?: RingView,
  disk?: DiskView,
  style: Style = 'bar',
): { source: string; width: number; height: number; alt: string } {
  const list = shown.slice(0, 2)
  const rings = style === 'ring'
  // Hat der untere Balken einen Strich, braucht dieser MARK_BELOW px unter dem Balken: bei zwei Fenstern rückt die Woche dafür
  // im Abstand nach oben (Höhe bleibt 56), bei einem Fenster wird das Bild entsprechend höher
  const lift = list.length > 0 && list[list.length - 1]!.mark !== undefined ? MARK_BELOW : 0
  const barsH = list.length > 0 ? list.length * GROUP + (list.length - 1) * GROUP_GAP + (list.length === 1 ? lift : 0) : 0
  const height = ring || disk || (rings && list.length > 0) ? Math.max(RING_H, rings ? 0 : barsH) : barsH
  let x = 0
  const place = (w: number) => {
    const at = x > 0 ? x + RING_GAP : 0
    x = at + w
    return at
  }
  let body = ''
  if (rings) {
    for (const s of list) body += s.pace ? paceColumn(s, place(paceColumnW(s)), height - RING_H) : limitRingSvg(s, place(RING_SIZE), height - RING_H)
  } else if (list.length > 0) {
    const dy = height - barsH
    body = list.map((s, i) => group(s, dy + i * (GROUP + GROUP_GAP) - (i === list.length - 1 && list.length > 1 ? lift : 0))).join('')
    x = BAR_W
  }
  if (ring) body += ringSvg(ring, place(RING_SIZE), height - RING_H)
  if (disk) body += diskRingSvg(disk, place(DISK_W), height - RING_H)
  // Etwas Luft zum linken Rand des Bands (Fynn): der Inhalt rückt im Bild um PAD_LEFT nach rechts
  const width = PAD_LEFT + x + SPACE_RIGHT
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="translate(${PAD_LEFT} 0)">${body}</g></svg>`
  const altOf = (s: Shown) => (s.pace ? s.pace.alt : `${s.name} ${s.pct.alt}${s.reset ? `, ${s.reset.alt}` : ''}`)
  const alt = [...list.map(altOf), ...(ring ? [ring.alt] : []), ...(disk ? [disk.alt] : [])].join('; ')
  return { source, width, height, alt }
}
