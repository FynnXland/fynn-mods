// limit-bars: reine Anzeige-Logik ohne `$`. Aus den Fenstern der letzten Messung und der Uhrzeit wird,
// was je Fenster zu sehen ist (Texte lang und kurz, Farbe, Füllung), und im Terminal die Aufteilung der Breite.
import { T, hhmm } from './i18n.ts'
import type { Lang } from './i18n.ts'

export type Kind = 'five_hour' | 'seven_day'
export type Win = { kind: Kind; percentUsed: number; resetsAt?: number }
export type ResetStyle = 'mixed' | 'clock' | 'countdown'
export type Opts = { resetStyle: ResetStyle; highlightAt: number; onlyFiveHour: boolean; lang: Lang }

// Farben aus der clawd-buddy-Palette (stage.ts PAL E/Y/M/D)
export const ORANGE = '#D77757'
export const GREEN = '#6CC070'
export const YELLOW = '#F2C94C'
export const RED = '#C9594B'
export const EMPTY = '#4A4A4A'
export const GREY = '#9A9A9A'

export type Shown = {
  tag: '5h' | '7d'
  name: string // für `alt`
  color: string // Füllung und Prozentwert
  strong: boolean // ab highlightAt bzw. voll: fett
  fresh: boolean // Reset vorbei, noch keine neue Messung: gedimmt
  ratio: number // 0..1, Anteil der Füllung
  /** Ganze Prozent: `long` (en `71%`, de `71 %`), `short` (`71%`), `alt` für den alt-Text. */
  pct: { long: string; short: string; alt: string }
  reset?: { long: string; short: string; alt: string }
}

const KINDS: readonly Kind[] = ['five_hour', 'seven_day']

/** Übernimmt aus `rateLimits` (types@2.1.288:10597-10614) nur `five_hour` und `seven_day`; ein unlesbares `resetsAt` gilt als fehlend. */
export function pickWindows(rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Win[] {
  const out: Win[] = []
  for (const kind of KINDS) {
    const r = rateLimits.find((x) => x.kind === kind)
    if (!r || typeof r.percentUsed !== 'number' || !Number.isFinite(r.percentUsed)) continue
    const t = typeof r.resetsAt === 'string' ? Date.parse(r.resetsAt) : NaN
    out.push({ kind, percentUsed: r.percentUsed, resetsAt: Number.isFinite(t) ? t : undefined })
  }
  return out
}

/** Uhrzeit des Resets in lokaler Zeit: am selben Tag `14:30`, sonst en `Mon 09:00` / de `Mo 09:00` (kurz `Mon9:00`). */
export function clockText(at: number, now: number, lang: Lang): { long: string; short: string } {
  const d = new Date(at)
  const n = new Date(now)
  const hm = hhmm(at)
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  if (sameDay) return { long: hm, short: hm }
  const wd = T[lang].weekdays[d.getDay()]
  return { long: `${wd} ${hm}`, short: `${wd}${d.getHours()}:${hm.slice(3)}` }
}

/** Restzeit bis zum Reset, abgerundet: `in 3 d 4 h` (de `in 3 T 4 h`), `in 2 h 14 min`, `in 14 min`, `in < 1 min`. */
export function countdownText(ms: number, lang: Lang): { long: string; short: string } {
  const min = Math.floor(Math.max(0, ms) / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const day = T[lang].dayUnit
  if (d >= 1) return { long: `in ${d} ${day} ${h} h`, short: `${d}${day}${h}h` }
  if (h >= 1) return { long: `in ${h} h ${m} min`, short: `${h}h${String(m).padStart(2, '0')}` }
  if (m >= 1) return { long: `in ${m} min`, short: `${m}m` }
  return { long: 'in < 1 min', short: '<1m' }
}

/**
 * Platzhalter, solange Claude Code noch keine Limits kennt (vor der ersten API-Antwort): `5h –` und `7d –`, leerer Balken,
 * grau. Nur auf dem Desktop, damit die Balken wie der Ring sofort dastehen (Fynn, 2026-10-05).
 */
export function placeholderWindows(opts: Opts): Shown[] {
  const t = T[opts.lang]
  const one = (tag: '5h' | '7d', name: string): Shown => ({
    tag,
    name,
    color: GREY,
    strong: false,
    fresh: true, // grau wie nach dem Reset
    ratio: 0,
    pct: { long: '–', short: '–', alt: t.unknown },
  })
  return opts.onlyFiveHour ? [one('5h', t.fiveName)] : [one('5h', t.fiveName), one('7d', t.weekName)]
}

/** Was je Fenster zu sehen ist, 5h zuerst. */
export function shownWindows(wins: readonly Win[], now: number, opts: Opts): Shown[] {
  const t = T[opts.lang]
  const out: Shown[] = []
  for (const w of wins) {
    const five = w.kind === 'five_hour'
    if (!five && opts.onlyFiveHour) continue
    const tag = five ? '5h' : '7d'
    const name = five ? t.fiveName : t.weekName
    if (w.resetsAt !== undefined && now >= w.resetsAt) {
      const zero = t.pct('0')
      out.push({
        tag,
        name,
        color: GREEN,
        strong: false,
        fresh: true,
        ratio: 0,
        pct: { long: zero, short: '0%', alt: zero },
        reset: { long: t.fresh, short: t.fresh, alt: t.freshAlt },
      })
      continue
    }
    const p = w.percentUsed
    const full = p >= 100
    const color = full || p >= 85 ? RED : p >= 60 ? YELLOW : GREEN
    // Ganze Prozent, kaufmännisch gerundet wie die Usage-Anzeige der App (Fynn: Balken zeigte 58, /usage 59);
    // "100" erst, wenn das Fenster wirklich voll ist, darunter höchstens 99.
    const n = String(Math.min(99, Math.max(0, Math.round(p))))
    const useClock = opts.resetStyle === 'clock' || (opts.resetStyle === 'mixed' && !five)
    let reset: Shown['reset']
    if (w.resetsAt !== undefined) {
      const r = useClock ? clockText(w.resetsAt, now, opts.lang) : countdownText(w.resetsAt - now, opts.lang)
      reset = { ...r, alt: t.resetAlt(r.long) }
    }
    out.push({
      tag,
      name,
      color,
      strong: full || p >= opts.highlightAt,
      fresh: false,
      ratio: full ? 1 : Math.max(0, Math.min(1, p / 100)),
      pct: full ? { long: t.full, short: t.full, alt: t.full } : { long: t.pct(n), short: `${n}%`, alt: t.pct(n) },
      reset,
    })
  }
  return out
}

export type Block = { shown: Shown; width: number; pct: string; rest: string }
export type TermLayout = { blocks: Block[]; width: number; extra?: string }

const MIN_BLOCK = 12
const GAP = 2

function block(s: Shown, short: boolean): Block {
  const pct = short ? s.pct.short : s.pct.long
  const rest = s.reset ? (short ? ` ${s.reset.short}` : ` · ${s.reset.long}`) : ''
  return { shown: s, pct, rest, width: Math.max(MIN_BLOCK, s.tag.length + 1 + pct.length + rest.length) }
}

/**
 * Terminal: verfügbar sind `min(44, bodyColumns − 40)` Spalten, dieselbe Regel wie clawd-buddy v0.1.4 (register.ts:322).
 * Blöcke nebeneinander, 2 Spalten Fuge, 1 Spalte Abstand zu Clawd; `width` ist die ganze Breite einschließlich dieses Abstands.
 * Stufen: lang mit Cache-Block (`extra`, z. B. `◔ 42m`) → lang → kurz → nur das erste Fenster (lang, dann kurz) → nichts.
 * Ohne Fenster steht der Cache-Block allein, sofern er passt.
 */
export function layoutTerminal(shown: readonly Shown[], bodyColumns: number, extra?: string): TermLayout | null {
  const avail = Math.min(44, bodyColumns - 40)
  if (avail < MIN_BLOCK + 1) return null
  if (shown.length === 0) return extra && extra.length + 1 <= avail ? { blocks: [], width: extra.length + 1, extra } : null
  if (extra) {
    const blocks = shown.map((s) => block(s, false))
    const used = blocks.reduce((a, b) => a + b.width, 0) + GAP * blocks.length + extra.length
    if (used + 1 <= avail) return { blocks, width: used + 1, extra }
  }
  // Langform zuerst, wird es eng die Kurzform
  const tries: Block[][] = [shown.map((s) => block(s, false)), shown.map((s) => block(s, true))]
  if (shown.length > 1) tries.push([block(shown[0], false)], [block(shown[0], true)])
  for (const blocks of tries) {
    const used = blocks.reduce((a, b) => a + b.width, 0) + GAP * (blocks.length - 1)
    if (used + 1 <= avail) return { blocks, width: used + 1 }
  }
  return null
}

/** Gefüllte Zellen eines Balkens der Breite `width`. */
export function filled(ratio: number, width: number): number {
  return Math.max(0, Math.min(width, Math.round(ratio * width)))
}
