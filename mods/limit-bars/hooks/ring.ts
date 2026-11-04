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

/** Feiner Strich für den gleichmäßigen Verbrauch (Ausbau 0.10.0), auf Balken und Ring gleich. */
// Orange wie die Kürzel 5h/7d (Fynn, 2026-11-03: der helle Strich war schwer zu sehen; Rot fiele ab 85 % in der roten Füllung weg)
export const MARK = ORANGE

/** Dunklere Fassung einer Farbe `#RRGGBB` (je Kanal × 0,65): Rand um den Strich in seiner eigenen Farbe (0.10.4). */
export function darker(hex: string, f = 0.65): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * f).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase()
}

/**
 * Ein Limit als Ring (Ausbau 0.10.0, `style: ring`), im Stil des Cache-Rings: Kürzel `5h`/`7d` oben in Orange, 28 Bögen,
 * gefüllt der verbrauchte Anteil im Uhrzeigersinn ab 12 Uhr, in der Mitte Prozent, darunter klein der Reset.
 * `mark` (0..1): Kerbe beim gleichmäßigen Verbrauch. Belegt RING_SIZE × RING_H.
 */
export function limitRingSvg(
  s: { tag: string; color: string; strong: boolean; fresh: boolean; ratio: number; pct: { short: string }; reset?: { short: string }; mark?: number; markColor?: string },
  x: number,
  y: number,
): string {
  const on = s.ratio > 0 ? Math.max(1, Math.min(RING_SEGMENTS, Math.round(s.ratio * RING_SEGMENTS))) : 0
  const cx = x + RING_SIZE / 2
  const cy = y + RING_LABEL_H + RING_SIZE / 2
  const w = s.strong ? ' font-weight="700"' : ''
  let out = `<g${s.fresh ? ' opacity="0.55"' : ''}>`
  out += `<text x="${cx}" y="${y + 11}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${ORANGE}"${w}>${esc(s.tag)}</text>`
  for (let i = 0; i < RING_SEGMENTS; i++) {
    out += `<path d="${segmentPath(i, cx, cy)}" fill="none" stroke-width="${STROKE}" stroke="${i < on ? s.color : EMPTY}"/>`
  }
  if (s.mark !== undefined) {
    const a = 2 * Math.PI * Math.max(0, Math.min(1, s.mark))
    const p = (r: number) => `${f2(cx + r * Math.sin(a))} ${f2(cy - r * Math.cos(a))}`
    const c = s.markColor ?? MARK
    const d = `M${p(R - STROKE / 2 - 3)}L${p(R + STROKE / 2 + 2)}`
    // Rand in einer dunkleren Fassung derselben Farbe, wie am Balken (0.10.4)
    out += `<path d="${d}" stroke="${darker(c)}" stroke-width="4"/><path d="${d}" stroke="${c}" stroke-width="2"/>`
  }
  out += `<text x="${cx}" y="${cy + (s.reset ? 1 : 4)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${s.fresh ? GREY : s.color}"${w}>${esc(s.pct.short)}</text>`
  if (s.reset) out += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-family="${FONT}" font-size="7" fill="${GREY}">${esc(s.reset.short)}</text>`
  return out + '</g>'
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
