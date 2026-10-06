// limit-bars: Cache-Ring als Svg-Baustein, reine Funktionen ohne `$`. Stil wie die Balken: Segmente mit Fuge, hier 28 Bögen
// auf einem glatten Kreis (Mittellinie r = 18, 4 px stark, je Segment etwa 3 px Bogen und 1 px Fuge) in einem Feld von 40 × 40 px.
// Gefüllt ist der verbleibende Anteil; der Ring leert sich im Uhrzeigersinn ab 12 Uhr (SPEC.md, Ausbau v0.2.0, Anzeige).
// Fynn (2026-10-05) zum ersten Prototyp aus Pixel-Kacheln: „zu verpixelt, nicht annähernd rund“ – darum Bögen statt Raster.
import { EMPTY, GREY, ORANGE } from './view.ts'

/** Was der Ring zeigt: Füllung 0..1, Farbe der gefüllten Segmente, Text in der Mitte, Markierung fürs Warmhalten, `alt`. */
export type RingView = {
  fill: number
  color: string
  main: string // Restzeit (`42m`, `<1m`), `cold`/`kalt` oder `–`
  mainColor: string
  sub?: string // Kontext (`412k`)
  subColor?: string // Farbe der Kontextzahl nach Kontextgröße (cache.ts `contextColor`); fehlt = grau
  kept: boolean // Warmhalten aktiv: kleiner Punkt über der Restzeit
  alt: string
}

export const RING_SEGMENTS = 28
export const RING_SIZE = 40
const RING_LABEL_H = 16 // Kürzel "Cache" (0–12) und 4 px Fuge, wie Text und Balken
export const RING_H = RING_LABEL_H + RING_SIZE // 56, so hoch wie Clawds Bild
const R = 18 // Mittellinie; außen 20, innen 16
const STROKE = 4
const GAP_PX = 1 // Fuge auf der Mittellinie, wie zwischen den Balken-Segmenten
export const FONT = "ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace"

/** Anzahl gefüllter Segmente für eine Füllung 0..1; ab einem Rest > 0 mindestens eins. */
export function ringFilled(fill: number): number {
  if (!(fill > 0)) return 0
  return Math.max(1, Math.min(RING_SEGMENTS, Math.round(fill * RING_SEGMENTS)))
}

const f2 = (n: number) => String(Math.round(n * 100) / 100)
/** Text für `<text>` im Svg: Sonderzeichen als Entitäten, `·` als `&#183;`. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/·/g, '&#183;')

/** Bogen des Segments i (0 = ab 12 Uhr, im Uhrzeigersinn) als Pfad um den Mittelpunkt (cx, cy). */
function segmentPath(i: number, cx: number, cy: number): string {
  const step = (2 * Math.PI) / RING_SEGMENTS
  const half = GAP_PX / 2 / R
  const a0 = i * step + half
  const a1 = (i + 1) * step - half
  // Winkel ab 12 Uhr im Uhrzeigersinn: x = sin, y = −cos
  const p = (a: number) => `${f2(cx + R * Math.sin(a))} ${f2(cy - R * Math.cos(a))}`
  return `M${p(a0)}A${R} ${R} 0 0 1 ${p(a1)}`
}

/** Der Ring samt Kürzel als Svg-Fragment, links oben bei (x, y); belegt RING_SIZE × RING_H. */
export function ringSvg(r: RingView, x: number, y: number): string {
  const on = ringFilled(r.fill)
  const cx = x + RING_SIZE / 2
  const cy = y + RING_LABEL_H + RING_SIZE / 2
  let out = `<text x="${cx}" y="${y + 11}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${ORANGE}">Cache</text>`
  // Geleert wird ab 12 Uhr: die ersten (n − on) Segmente im Uhrzeigersinn sind leer
  for (let i = 0; i < RING_SEGMENTS; i++) {
    out += `<path d="${segmentPath(i, cx, cy)}" fill="none" stroke-width="${STROKE}" stroke="${i >= RING_SEGMENTS - on ? r.color : EMPTY}"/>`
  }
  if (r.kept) out += `<rect x="${cx - 1}" y="${cy - 11}" width="2" height="2" fill="${r.color}"/>`
  out += `<text x="${cx}" y="${cy + 1}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${r.mainColor}">${esc(r.main)}</text>`
  if (r.sub) out += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-family="${FONT}" font-size="8" fill="${r.subColor ?? GREY}">${esc(r.sub)}</text>`
  return out
}
