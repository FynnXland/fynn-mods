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
  /** Nur am Wochenfenster bei `noFiveHour`: Strich bei gleichmäßigem Verbrauch, 0..1 (SPEC.md, Ausbau 0.10.0, 2.). */
  mark?: number
  /** Farbe des Strichs (0.10.2): orange, solange der Verbrauch darunter liegt; rot, sobald er ihn erreicht hat. */
  markColor?: string
  /** Nur die Tempo-Zeile (obere Zeile ohne 5h-Fenster): Kopf in Tempo-Farbe, darunter die Prognose, `alt`. */
  pace?: PaceText
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

/**
 * Stand, den sich alle Chats auf dem Rechner teilen (`$.store` unter `limits`): wann gemessen, welche Fenster. `miss` (seit 0.10.0):
 * wie viele Messungen in Folge `seven_day` ohne `five_hour` brachten; fehlt bei 0 und bei Einträgen von 0.9.0.
 */
export type Shared = { at: number; wins: Win[]; miss?: number }

/** `limits` aus dem Store prüfen: nur `five_hour`/`seven_day` mit Zahlen, sonst undefined (fremde oder alte Form). */
export function cleanShared(v: unknown): Shared | undefined {
  if (!v || typeof v !== 'object') return undefined
  const { at, wins } = v as { at?: unknown; wins?: unknown }
  if (typeof at !== 'number' || !Number.isFinite(at) || !Array.isArray(wins)) return undefined
  const out: Win[] = []
  for (const kind of KINDS) {
    const w = wins.find((x) => !!x && typeof x === 'object' && (x as { kind?: unknown }).kind === kind) as { percentUsed?: unknown; resetsAt?: unknown } | undefined
    if (!w || typeof w.percentUsed !== 'number' || !Number.isFinite(w.percentUsed)) continue
    out.push({ kind, percentUsed: w.percentUsed, resetsAt: typeof w.resetsAt === 'number' && Number.isFinite(w.resetsAt) ? w.resetsAt : undefined })
  }
  if (out.length === 0) return undefined
  const miss = (v as { miss?: unknown }).miss
  return typeof miss === 'number' && Number.isFinite(miss) && miss >= 1 ? { at, wins: out, miss: Math.floor(miss) } : { at, wins: out }
}

// ---------- Kein 5h-Limit (SPEC.md, Ausbau 0.10.0, 1.) ----------

/**
 * Ab so vielen Messungen in Folge ohne `five_hour` gilt `noFiveHour`. Eine reicht nicht: In cost-ledgers Aufzeichnung
 * (`rl`/`lim` je Chat) meldete am 2026-10-20 gegen 23 Uhr und am 2026-10-28 um 00:07 je ein Chat nur `seven_day`, während
 * andere Chats zur selben Zeit ein laufendes 5h-Fenster hatten (SPEC.md, Offene Punkte 0.10.0).
 */
export const NO_FIVE_AFTER = 2

/** Messung mit Wochenfenster, aber ohne 5h-Fenster. Ohne beide (vor der ersten Messung) gilt der bisherige Leerzustand. */
export function lacksFive(wins: readonly Win[]): boolean {
  return wins.some((w) => w.kind === 'seven_day') && !wins.some((w) => w.kind === 'five_hour')
}

/** Zähler nach einer neuen Messung: weiter hoch, solange `five_hour` fehlt; mit `five_hour` (oder leer) zurück auf 0. */
export function nextMiss(prev: number, wins: readonly Win[]): number {
  return lacksFive(wins) ? prev + 1 : 0
}

/** Zähler aus einem gemeinsamen Stand. Ein Eintrag ohne `miss` (0.9.0) zählt als eine Messung nach `prev`. */
export function sharedMiss(s: Shared, prev: number): number {
  return s.miss ?? nextMiss(prev, s.wins)
}

// ---------- Wochen-Tempo (SPEC.md, Ausbau 0.10.0, 2.) ----------

const HOUR = 3600000
const WEEK = 7 * 24 * HOUR
const EARLY = 6 * HOUR // vorher keine Prognose
const TOLERANCE = 5 // Prozentpunkte um den gleichmäßigen Verbrauch: grau, „im Plan“
const RED_BEFORE = 24 * HOUR // rot, wenn 100 % mehr als einen Tag vor dem Reset erreicht wären
const FULL_STEP = 15 * 60000 // „reicht bis“ auf 15 min abgerundet: sonst wandert die Uhrzeit alle paar Sekunden (Neuzeichnen)

export type Pace = {
  kind: 'none' | 'early' | 'plan' | 'over'
  /** gleichmäßiger Verbrauch jetzt, 0..100; fehlt ohne `resetsAt` */
  even?: number
  delta: number // Prozentpunkte über (+) oder unter (−) `even`
  forecast: number // Stand zum Reset bei gleichem Tempo
  full?: number // wann 100 % erreicht wären (ms), nur bei `over`
  color: string
}

/**
 * Tempo des Wochenfensters: `start = resetsAt − 7 d`, `elapsed = (now − start) / 7 d`, `even = elapsed × 100`,
 * `delta = percentUsed − even`, `forecast = percentUsed / elapsed`, `full = start + (now − start) × 100 / percentUsed`.
 * Farbe: grau bis 5 Punkte über dem Plan (und darunter), orange darüber, rot, wenn `full` mehr als 24 h vor dem Reset liegt.
 */
export function paceOf(week: Win, now: number): Pace {
  const p = week.percentUsed
  if (week.resetsAt === undefined) return { kind: 'none', delta: 0, forecast: 0, color: GREY }
  const start = week.resetsAt - WEEK
  const ms = now - start
  const even = Math.max(0, Math.min(1, ms / WEEK)) * 100
  if (ms < EARLY || now >= week.resetsAt) return { kind: 'early', even, delta: 0, forecast: 0, color: GREY }
  const delta = p - even
  const forecast = p / (even / 100)
  if (!(forecast > 100)) return { kind: 'plan', even, delta, forecast, color: GREY } // unter Tempo grau, ohne Grün
  const full = start + (ms * 100) / p
  const color = delta <= TOLERANCE ? GREY : full < week.resetsAt - RED_BEFORE ? RED : ORANGE
  return { kind: 'over', even, delta, forecast, full, color }
}

export type PaceText = {
  head: string // `+12 % über Tempo`, `im Plan`, `12 % unter Tempo`, `Woche frisch`; leer ohne `resetsAt`
  sub?: string // `reicht bis Fr 14:00` bzw. `Prognose 78 %`
  color: string
  alt: string
}

/** Wann 100 % erreicht wären, abgerundet auf 15 min: lang wie der Wochen-Reset (`Fr 14:00`), kurz `Fr14h` bzw. `14h`. */
function fullText(full: number, now: number, lang: Lang): { long: string; short: string; alt: string } {
  const at = Math.floor(full / FULL_STEP) * FULL_STEP
  const c = clockText(at, now, lang)
  const d = new Date(at)
  const sameDay = c.long === c.short
  return {
    long: c.long,
    // `Fr4h` statt `Fr4` (Review 0.10.0 K4: die Zahl allein war schwer lesbar)
    short: `${sameDay ? '' : T[lang].weekdays[d.getDay()]}${d.getHours()}h`,
    alt: sameDay ? c.long : `${T[lang].weekdaysLong[d.getDay()]} ${hhmm(at)}`,
  }
}

/**
 * Die obere Zeile ohne 5h-Fenster: `5h ∞`, dahinter das Tempo (Terminal in einer Zeile: `5h ∞ · +12 % · reicht bis
 * Fr 14:00`, kurz `5h ∞ +12% Fr14h`, dann `5h ∞`). `mark` ist der Strich auf dem Wochenbalken (0..1), außer ohne Prognose.
 */
export function paceShown(week: Win, now: number, lang: Lang): { top: Shown; mark?: number } {
  const t = T[lang]
  const pc = paceOf(week, now)
  const n = (x: number) => String(Math.round(Math.abs(x)))
  let head = ''
  let sub: string | undefined
  let short = ''
  const alt: string[] = [t.paceAltNone]
  if (pc.kind === 'early') {
    head = t.paceFresh
    short = t.fresh
    alt.push(t.paceAltFresh)
  } else if (pc.kind === 'plan' || pc.kind === 'over') {
    const d = Math.round(pc.delta)
    head = Math.abs(pc.delta) <= TOLERANCE ? t.paceOnPlan : d > 0 ? t.paceOver(n(d)) : t.paceUnder(n(d))
    alt.push(Math.abs(pc.delta) <= TOLERANCE ? t.paceAltOnPlan : t.paceAltDelta(n(d), d > 0))
    if (pc.kind === 'over' && pc.full !== undefined) {
      const f = fullText(pc.full, now, lang)
      sub = t.paceLasts(f.long)
      short = `${d > 0 ? '+' : ''}${d}% ${f.short}`
      alt.push(t.paceAltLasts(f.alt))
    } else {
      const fc = n(Math.min(100, pc.forecast))
      sub = t.paceForecast(fc)
      short = `~${fc}%`
      alt.push(t.paceAltForecast(fc))
    }
  }
  // Terminal, eine Zeile: deutlich über dem Plan die kurze Form der Spec (`+12 % · reicht bis Fr 14:00`), sonst derselbe Kopf wie
  // im Desktop (`im Plan · reicht bis …`, Review 0.10.0 K4)
  const d = Math.round(pc.delta)
  const lead = pc.kind === 'over' && Math.abs(pc.delta) > TOLERANCE ? t.pct(`+${d}`) : head
  const long = [lead, sub].filter(Boolean).join(' · ')
  return {
    top: {
      tag: '5h',
      name: t.paceAltNone,
      color: pc.color,
      strong: false,
      fresh: false,
      ratio: 0,
      pct: { long: '∞', short: '∞', alt: '' },
      reset: long ? { long, short, alt: '' } : undefined,
      pace: { head, sub, color: pc.color, alt: alt.join(', ') },
    },
    mark: pc.kind === 'none' || pc.even === undefined || now >= (week.resetsAt ?? 0) ? undefined : pc.even / 100,
  }
}

/**
 * Was ohne 5h-Fenster gezeigt wird: oben die Tempo-Zeile (wenn der Schalter `5h` an ist), am Wochenbalken der Strich.
 * `shown` ist die Liste aus `shownWindows`, die ohne 5h-Fenster höchstens die Woche enthält.
 */
export function withPace(shown: readonly Shown[], wins: readonly Win[], now: number, lang: Lang, showTop: boolean): Shown[] {
  const week = wins.find((w) => w.kind === 'seven_day')
  if (!week) return [...shown]
  const p = paceShown(week, now, lang)
  // Orange, solange der Verbrauch unter dem Strich liegt; rot, sobald er ihn erreicht hat (Fynn, 0.10.2). Verglichen in ganzen
  // Prozent wie Anzeige und `keyOf`, damit die Farbe nicht bei jedem Tick hin und her springt.
  const reached = Math.round(week.percentUsed) >= Math.round((p.mark ?? 0) * 100)
  const rest = shown.map((s) =>
    s.tag === '7d' && !s.fresh && p.mark !== undefined ? { ...s, mark: p.mark, markColor: reached ? RED : ORANGE } : s,
  )
  return showTop ? [p.top, ...rest] : rest
}

/** Ein Balken der Breite `width` als Läufe: gefüllt, leer und an der Stelle `mark` ein Strich (Terminal). */
export function barRuns(ratio: number, width: number, color: string, mark?: number, markColor = ORANGE): { n: number; color: string; mark?: boolean }[] {
  const f = filled(ratio, width)
  const cells: { color: string; mark?: boolean }[] = []
  for (let i = 0; i < width; i++) cells.push({ color: i < f ? color : EMPTY })
  if (mark !== undefined && width >= MIN_BLOCK) cells[Math.max(0, Math.min(width - 1, Math.floor(mark * width)))] = { color: markColor, mark: true }
  const out: { n: number; color: string; mark?: boolean }[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last && last.color === c.color && !last.mark && !c.mark) last.n += 1
    else out.push({ n: 1, ...c })
  }
  return out
}

// Resets, die näher beieinander liegen, gelten als dasselbe Fenster (zwei 5-h-Fenster liegen mindestens 5 h auseinander)
const SAME_WINDOW = 10 * 60000

/**
 * Je Fenster das neuere aus `a` und `b`, ohne Zeitstempel: ein späteres Reset (also ein neueres Fenster) gewinnt, im selben
 * Fenster der höhere Verbrauch; bei Gleichstand `a`. Für eine Messung unbekannten Alters (SPEC.md, Ausbau 0.8.0, Review S1).
 */
export function mergeWins(a: readonly Win[], b: readonly Win[]): Win[] {
  const out: Win[] = []
  for (const kind of KINDS) {
    const x = a.find((w) => w.kind === kind)
    const y = b.find((w) => w.kind === kind)
    if (!x || !y) {
      const one = x ?? y
      if (one) out.push(one)
      continue
    }
    const rx = x.resetsAt
    const ry = y.resetsAt
    if (rx !== undefined && ry !== undefined && Math.abs(rx - ry) > SAME_WINDOW) out.push(ry > rx ? y : x)
    else out.push(y.percentUsed > x.percentUsed ? y : x)
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

/** `bare`: nur Kürzel und Wert (`5h ∞`), die letzte Stufe der Tempo-Zeile. */
function block(s: Shown, short: boolean, bare = false): Block {
  const pct = short ? s.pct.short : s.pct.long
  const rest = s.reset && !bare ? (short ? ` ${s.reset.short}` : ` · ${s.reset.long}`) : ''
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
  if (shown[0]?.pace) return layoutPace(shown, avail, extra)
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

/**
 * Terminal mit Tempo-Zeile (Ausbau 0.10.0, Review K1/S1): Hier ist die Woche das eigentliche Limit. Deshalb wird zuerst die
 * Tempo-Zeile kleiner (lang → `5h ∞ +12% Fr14h` → `5h ∞` → weg), erst dann fällt die Woche weg. Der Cache-Block steht in jeder
 * Stufe dabei, solange er passt; die Langform passt neben der Woche ohnehin nie in 44 Spalten.
 */
function layoutPace(shown: readonly Shown[], avail: number, extra?: string): TermLayout | null {
  const [top, ...rest] = shown
  const long = rest.map((s) => block(s, false))
  const short = rest.map((s) => block(s, true))
  const stages: Block[][] = [
    [block(top!, false), ...long],
    [block(top!, true), ...short],
    [block(top!, true, true), ...short],
    ...(short.length > 0 ? [short] : []),
  ]
  const width = (blocks: Block[], x?: string) => blocks.reduce((a, b) => a + b.width, 0) + GAP * (blocks.length - 1) + (x ? GAP + x.length : 0) + 1
  for (const blocks of stages) {
    if (extra && width(blocks, extra) <= avail) return { blocks, width: width(blocks, extra), extra }
    if (width(blocks) <= avail) return { blocks, width: width(blocks) }
  }
  return null
}

/** Gefüllte Zellen eines Balkens der Breite `width`. */
export function filled(ratio: number, width: number): number {
  return Math.max(0, Math.min(width, Math.round(ratio * width)))
}
