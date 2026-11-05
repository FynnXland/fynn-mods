// limit-bars: Kostenring (SPEC Ausbau 0.12.0, 1.), reine Funktionen ohne `$`. Quelle ist `$.state` `cost-ledger.here`
// (Vertrag in types/index.d.ts): was dieser Chat und das ganze Projekt an API-Wert gekostet haben. Gefüllt ist der Anteil
// des Chats am Projekt; in der Mitte der Chat-Betrag, darunter `/887$` für das Projekt, darüber `Cost`/`Kosten`.
import { FONT, RING_H, RING_SEGMENTS, RING_SIZE, esc } from './ring.ts'
import { T, dec } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { EMPTY, GREY, ORANGE } from './view.ts'

/** Der Wert von cost-ledger, geprüft. */
export type Here = { chatUsd: number; projectUsd: number | null; project: string | null; since: string; devices: number }

const amount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** Nur ein vollständiger, plausibler Wert zählt; alles andere (fehlt, `null`, fremde Form) heißt: kein Ring. */
export function cleanHere(v: unknown): Here | null {
  if (!v || typeof v !== 'object') return null
  const h = v as Record<string, unknown>
  if (!amount(h.chatUsd) || !(h.projectUsd === null || amount(h.projectUsd))) return null
  if (!(h.project === null || typeof h.project === 'string') || typeof h.since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(h.since)) return null
  const devices = typeof h.devices === 'number' && Number.isFinite(h.devices) ? Math.max(1, Math.round(h.devices)) : 1
  return { chatUsd: h.chatUsd as number, projectUsd: h.projectUsd as number | null, project: (h.project as string | null) || null, since: h.since, devices }
}

/**
 * Betrag kurz für den Ring: unter 10 mit Cent (`0,40$`), bis 999 ganz (`14$`, `887$`), ab 1000 in Tausend (`1,2k$`, ab
 * 10 000 `12k$`). en mit Dollarzeichen vorn (`$0.40`, `$1.2k`).
 */
export function shortUsd(v: number, lang: Lang): string {
  let s: string
  if (v < 9.995) s = dec(Math.max(0, v), 2, lang)
  else if (v < 999.5) s = String(Math.round(v))
  else if (v < 9950) s = `${dec(v / 1000, 1, lang)}k`
  else s = `${Math.round(v / 1000)}k`
  return lang === 'de' ? `${s}$` : `$${s}`
}

/** Tag `YYYY-MM-DD` als Datum: en `Oct 6, 2026`, de `06.10.2026`. */
export function sinceText(day: string, lang: Lang): string {
  const [y, m, d] = day.split('-')
  if (lang === 'de') return `${d}.${m}.${y}`
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}, ${y}`
}

/** Was der Kostenring zeigt. `grey`: Projekt unbekannt. */
export type CostView = { label: string; main: string; sub: string; fill: number; grey: boolean; alt: string }

/** Anteil des Chats am Projekt (0–1); ohne Projektbetrag 0. */
export function costShare(h: Here): number {
  if (h.projectUsd === null || !(h.projectUsd > 0)) return 0
  return Math.max(0, Math.min(1, h.chatUsd / h.projectUsd))
}

export function costView(h: Here, lang: Lang): CostView {
  const t = T[lang]
  const grey = h.projectUsd === null
  return {
    label: t.costLabel,
    main: shortUsd(h.chatUsd, lang),
    sub: grey ? '–' : `/${shortUsd(h.projectUsd!, lang)}`,
    fill: costShare(h),
    grey,
    alt: costText(h, lang),
  }
}

/**
 * Ehrlich beschriftet (SPEC 1., „Ehrlich beschriften“): API-Wert, seit wann, mit wie vielen Geräten; kein Rechnungsbetrag.
 * Für `alt` und `/bars`.
 */
export function costText(h: Here, lang: Lang): string {
  const t = T[lang]
  const usd = (v: number) => (lang === 'de' ? `${dec(v, 2, lang)} $` : `$${dec(v, 2, lang)}`)
  if (h.projectUsd === null) return t.costAltNoProject(usd(h.chatUsd))
  return t.costAlt(usd(h.chatUsd), usd(h.projectUsd), h.project ?? '', sinceText(h.since, lang), h.devices)
}

/** Gefüllte Segmente: Anteil × 28, ab einem Chat-Betrag > 0 mindestens eins (Mindestbogen unter 1 %, die Zahl bleibt genau). */
export function costFilled(v: CostView, chatUsd: number): number {
  if (v.grey) return 0
  const n = Math.round(v.fill * RING_SEGMENTS)
  return chatUsd > 0 && v.fill > 0 ? Math.max(1, Math.min(RING_SEGMENTS, n)) : Math.min(RING_SEGMENTS, n)
}

/** Breite des Felds: wie der Speicher-Ring, `Kosten` (6 Zeichen bei 12 px Monospace ≈ 43 px) passt hinein. */
export const COST_W = 52

const R = 18
const STROKE = 4
const GAP_PX = 1
const f2 = (n: number) => String(Math.round(n * 100) / 100)

function segmentPath(i: number, cx: number, cy: number): string {
  const step = (2 * Math.PI) / RING_SEGMENTS
  const half = GAP_PX / 2 / R
  const p = (a: number) => `${f2(cx + R * Math.sin(a))} ${f2(cy - R * Math.cos(a))}`
  return `M${p(i * step + half)}A${R} ${R} 0 0 1 ${p((i + 1) * step - half)}`
}

/** Schriftgröße der Mitte: so groß wie beim Cache-Ring (11), bei langen Beträgen kleiner, damit sie in den Ring passt (≈ 30 px). */
function mainSize(s: string): number {
  return Math.max(7, Math.min(11, Math.floor(30 / (s.length * 0.6))))
}

/** Der Kostenring samt Kürzel als Svg-Fragment, links oben bei (x, y); belegt COST_W × RING_H. */
export function costRingSvg(v: CostView, filled: number, x: number, y: number): string {
  const cx = x + COST_W / 2
  const cy = y + (RING_H - RING_SIZE) + RING_SIZE / 2
  let out = `<text x="${cx}" y="${y + 11}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${ORANGE}">${esc(v.label)}</text>`
  // Gefüllt ab 12 Uhr im Uhrzeigersinn, wie die Limit-Ringe
  for (let i = 0; i < RING_SEGMENTS; i++) out += `<path d="${segmentPath(i, cx, cy)}" fill="none" stroke-width="${STROKE}" stroke="${i < filled ? ORANGE : EMPTY}"/>`
  out += `<text x="${cx}" y="${cy + 1}" text-anchor="middle" font-family="${FONT}" font-size="${mainSize(v.main)}" fill="${GREY}">${esc(v.main)}</text>`
  out += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-family="${FONT}" font-size="8" fill="${GREY}">${esc(v.sub)}</text>`
  return out
}

/** Terminal: eine Zeile hinter dem Cache-Block, z. B. `Kosten 0,40$/887$`. */
export function costBlock(v: CostView): string {
  return `${v.label} ${v.main}${v.sub === '–' ? ' –' : v.sub}`
}
