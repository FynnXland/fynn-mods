// tune-strip 0.6.0/0.7.0: Auswertung des Takt-Helfers (beat-cs.ts), ohne `$`. Zeilen streng lesen, Tempo und Schlag über die letzten
// Messungen glätten, die Gruppe (ruhig / Groove / hart / traurig) aus den Klangmerkmalen bestimmen und entscheiden, wann `tune-strip.beat`
// neu geschrieben wird (SPEC Nachtrag 0.6.0 „Verhalten“). Nichts davon kennt den Titel: der Mod meldet nur Wechsel (`reset`).

export const GROUPS = ['calm', 'groove', 'hard', 'sad'] as const
export type Group = (typeof GROUPS)[number]

/** Wert von `tune-strip.beat` (types/index.d.ts): `at` ist ein Schlag, wie er zu hören ist (Versatz eingerechnet). */
export type Beat = { bpm: number; at: number; sure: boolean; group: Group | null }

/** Eine Messung des Helfers über ein Fenster von `win` Sekunden, das um `end` (Unix-ms) endet. */
export type Measure = {
  win: number
  end: number
  /** Tempo, wie gemessen (55–210 bpm, noch nicht gefaltet) */
  bpm: number
  /** Klarheit des Tempos: bester Wert durch zweitbesten (≥ 1) */
  tclar: number
  /** letzter Schlag im Fenster (Unix-ms, ohne Geräteverzögerung) */
  at: number
  /** Klarheit des Schlags: bester Kammwert durch den mittleren */
  pclar: number
  bass: number
  high: number
  cent: number
  flat: number
  dens: number
  rms: number
}

export type HelperLine = { kind: 'ready' } | { kind: 'quiet'; end: number } | { kind: 'fail'; why: string } | { kind: 'beat'; m: Measure }

// Zulässige Bereiche; was draußen liegt, wird verworfen (SPEC: „Zahlenbereiche, sonst verwerfen“)
const TIME_MIN = 1.5e12 // 2017
const TIME_MAX = 5e12
const num = (s: string | undefined, lo: number, hi: number): number | undefined => {
  if (s === undefined || !/^-?\d+(\.\d+)?$/.test(s)) return undefined
  const v = Number(s)
  return Number.isFinite(v) && v >= lo && v <= hi ? v : undefined
}

/** Eine Zeile des Helfers lesen; alles, was nicht genau passt, ist `undefined` (nie ein Wurf). */
export function parseLine(line: string): HelperLine | undefined {
  const w = line.trim().split(' ')
  if (w.length === 1 && w[0] === 'ready') return { kind: 'ready' }
  if (w[0] === 'fail' && w.length === 2 && /^[A-Za-z0-9]{1,16}$/.test(w[1]!)) return { kind: 'fail', why: w[1]! }
  if (w[0] === 'q' && w.length === 2) {
    const end = num(w[1], TIME_MIN, TIME_MAX)
    return end === undefined ? undefined : { kind: 'quiet', end }
  }
  if (w[0] !== 'b' || w.length !== 13) return undefined
  const v = [
    num(w[1], 1, 30),
    num(w[2], TIME_MIN, TIME_MAX),
    num(w[3], 40, 260),
    num(w[4], 0, 10),
    num(w[5], TIME_MIN, TIME_MAX),
    num(w[6], 0, 1000),
    num(w[7], 0, 1),
    num(w[8], 0, 1),
    num(w[9], 0, 22050),
    num(w[10], 0, 1),
    num(w[11], 0, 100),
    num(w[12], 0, 10),
  ]
  if (v.some((x) => x === undefined)) return undefined
  const [win, end, bpm, tclar, at, pclar, bass, high, cent, flat, dens, rms] = v as number[]
  // Der Schlag liegt im Fenster
  if (at! > end! + 50 || at! < end! - win! * 1000 - 50) return undefined
  return { kind: 'beat', m: { win: win!, end: end!, bpm: bpm!, tclar: tclar!, at: at!, pclar: pclar!, bass: bass!, high: high!, cent: cent!, flat: flat!, dens: dens!, rms: rms! } }
}

/** Stücke von stdout in Zeilen zerlegen; `rest` ist der angefangene Teil. Überlange Reste werden abgeschnitten. */
export function splitLines(rest: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (rest + chunk).split(/\r?\n/)
  const tail = parts.pop() ?? ''
  return { lines: parts, rest: tail.length > 4000 ? '' : tail }
}

/** Über 150 bpm zählt das halbe Tempo, unter 60 das doppelte (SPEC). Unsinn (≤ 0, nicht endlich) wird 60. */
export function foldBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 60
  let b = bpm
  while (b > 150) b /= 2
  while (b < 60) b *= 2
  return b
}

// ---- Gruppe aus dem Klang

/** Merkmale je Messung (alle pegelunabhängig, Kalibrierung: Spektrum exakt, Klarheiten ±15 % bei 1/50 Lautstärke). */
export const FEATURES = ['bpm', 'tclar', 'pclar', 'bass', 'high', 'cent', 'flat', 'dens'] as const
export type FeatureVec = Record<(typeof FEATURES)[number], number>
/**
 * Merkmale, die die Gruppe entscheiden. Tempo und Anschlagdichte trennen die Gruppen nicht (Kalibrierung: mit ihnen 27, ohne sie 28
 * von 33 Songs richtig) und bleiben nur Messwerte.
 */
export const GROUP_FEATURES = ['tclar', 'pclar', 'bass', 'high', 'cent', 'flat'] as const
/** Stufe 2 (0.7.0): ruhig gegen traurig. Traurige Songs haben einen schwächeren Schlag und weniger Bass (Kalibrierung 0.7.0). */
export const SOFT_FEATURES = ['pclar', 'bass'] as const
type GroupVec = Record<(typeof GROUP_FEATURES)[number], number>
type SoftVec = Record<(typeof SOFT_FEATURES)[number], number>

/** Stufe 1 trennt ruhig (samt traurig), Groove und hart; ergibt sie ruhig, entscheidet Stufe 2 ruhig gegen traurig. */
export type GroupModel = {
  center: Record<'calm' | 'groove' | 'hard', GroupVec>
  scale: GroupVec
  soft: { center: Record<'calm' | 'sad', SoftVec>; scale: SoftVec; maxFlat: number }
}

/**
 * Mittelpunkte (Median je Gruppe) und Streuung je Merkmal (MAD × 1,4826 um den Gruppen-Mittelpunkt) aus 57 Songs, je 30-s-Hörprobe
 * mit dem C#-Text des Helfers gemessen (SPEC Nachtrag 0.7.0 „Kalibrierung“ und Korrektur 0.7.2, Zahlen in tests/calib-data.ts). Groove hat den klarsten
 * Schlag, hart das flachste Spektrum (verzerrte Gitarren) und die meisten Höhen, ruhig wenig von allem; traurig ist der Teil von ruhig
 * mit dem schwächsten Schlag und dem wenigsten Bass. Ein Moll-Merkmal brachte nur einen Song mehr und blieb draußen (SPEC).
 * 0.7.2: Traurig nur bei weichem Klang (Flachheit unter `maxFlat`, 9 von 10 traurigen Fenstern liegen darunter); Rap mit schwachem
 * Schlag landete sonst über ruhig bei traurig (Fynn: Ski Aggu – Theater).
 */
export const MODEL: GroupModel = {
  center: {
    calm: { tclar: 1.13, pclar: 2.61, bass: 0.096, high: 0.164, cent: 1887, flat: 0.237 },
    groove: { tclar: 1.31, pclar: 5.08, bass: 0.178, high: 0.299, cent: 2853, flat: 0.45 },
    hard: { tclar: 1.37, pclar: 3.45, bass: 0.127, high: 0.35, cent: 3227, flat: 0.617 },
  },
  scale: { tclar: 0.163, pclar: 0.771, bass: 0.047, high: 0.07, cent: 434, flat: 0.065 },
  soft: {
    center: { calm: { pclar: 3.39, bass: 0.142 }, sad: { pclar: 2.55, bass: 0.084 } },
    scale: { pclar: 0.519, bass: 0.059 },
    maxFlat: 0.33,
  },
}

export function featuresOf(m: Measure): FeatureVec {
  return { bpm: foldBpm(m.bpm), tclar: m.tclar, pclar: m.pclar, bass: m.bass, high: m.high, cent: m.cent, flat: m.flat, dens: m.dens }
}

/** Nächster Mittelpunkt unter `groups` über `keys` (Abstand in Streuungen je Merkmal). */
function nearest<G extends string, K extends string>(f: Record<K, number>, center: Record<G, Record<K, number>>, scale: Record<K, number>, groups: readonly G[], keys: readonly K[]): G {
  let best = groups[0]!
  let bestD = Infinity
  for (const g of groups) {
    let d = 0
    for (const k of keys) {
      const z = (f[k] - center[g][k]) / scale[k]
      d += z * z
    }
    if (d < bestD) {
      bestD = d
      best = g
    }
  }
  return best
}

/** Gruppe einer Messung: Stufe 1 (ruhig, Groove, hart), bei ruhig Stufe 2 (ruhig oder traurig); traurig nur bei weichem Klang. */
export function classify(f: Pick<FeatureVec, (typeof GROUP_FEATURES)[number]>, model: GroupModel = MODEL): Group {
  const g = nearest(f, model.center, model.scale, ['calm', 'groove', 'hard'] as const, GROUP_FEATURES)
  if (g !== 'calm') return g
  const s = nearest(f, model.soft.center, model.soft.scale, ['calm', 'sad'] as const, SOFT_FEATURES)
  return s === 'sad' && f.flat >= model.soft.maxFlat ? 'calm' : s
}

// ---- Glätten

export const TUNING = {
  /** zwei Tempi gelten als gleich, wenn sie so nah beieinander liegen (relativ) */
  agree: 0.03,
  /** so viele Messungen (je Fenster eine je 2,5 s) gehen in die Glättung */
  history: 8,
  /** ein Schlag weiter weg als dieser Anteil der Periode ist ein Sprung (nur nach zwei Messungen in Folge) */
  jump: 0.2,
  /** ab diesen Klarheiten gilt der Takt als sicher (Kalibrierung) */
  sureTclar: 1.05,
  surePclar: 2.5,
  /** ohne neue Messung so lange gilt der Takt noch */
  staleMs: 8000,
  /** Gruppe frühestens nach so viel Titel, Wechsel erst nach so langer anderer Gruppe (SPEC) */
  groupAfterMs: 15000,
  groupSwitchMs: 30000,
  /** Mehrheit der Gruppe über dieses Zeitfenster */
  groupVoteMs: 15000,
}

type Entry = { end: number; win: number; bpm: number; at: number; tclar: number; pclar: number }

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n === 0 ? NaN : n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2
}
const agrees = (a: number, b: number): boolean => Math.abs(a / b - 1) < TUNING.agree
/** Abstand eines Schlags `at` zum Raster (`anchor`, `period`), in (−P/2, P/2]. */
export function phaseOff(at: number, anchor: number, period: number): number {
  let d = (at - anchor) % period
  if (d > period / 2) d -= period
  if (d <= -period / 2) d += period
  return d
}

/**
 * Die zuletzt bestätigte Gruppe von Einträgen: die jüngsten zwei aufeinanderfolgenden, die zueinander passen, legen fest, was gilt;
 * dazu kommen alle anderen, die zu diesen beiden passen. Ein einzelner Ausreißer ändert nichts (SPEC: „erst, wenn zwei Messungen in
 * Folge ihn zeigen“). Ohne passendes Paar: nur der jüngste Eintrag.
 */
function confirmed<T>(xs: readonly T[], same: (a: T, b: T) => boolean): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const a = xs[i - 1]!
    const b = xs[i]!
    if (same(a, b)) return xs.filter((x) => same(x, a) && same(x, b))
  }
  return xs.length ? [xs[xs.length - 1]!] : []
}

export class Tracker {
  /** Titelbeginn: Fenster, die davor beginnen, zählen nicht (alter Titel) */
  songStart = 0
  /** Beginn des gültigen Takts (Titelbeginn, Sprung im Titel, Ende einer Stille) */
  timingStart = 0
  private hist: Entry[] = []
  private lastEnd = 0
  private votes: { end: number; g: Group }[] = []
  group: Group | null = null
  private cand: { g: Group; since: number } | null = null
  // Ergebnis der letzten Rechnung
  bpm: number | null = null
  anchor: number | null = null
  sure = false
  last: Measure | null = null

  /** Neuer Titel: alles zurück auf „unsicher“. */
  reset(start: number): void {
    this.songStart = start
    this.group = null
    this.cand = null
    this.votes = []
    this.resetTiming(start)
  }

  /** Sprung im Titel, Pause oder Stille: Tempo und Schlag neu, Gruppe bleibt. */
  resetTiming(start: number): void {
    this.timingStart = Math.max(start, this.songStart)
    this.hist = []
    this.bpm = null
    this.anchor = null
    this.sure = false
  }

  quiet(end: number): void {
    this.resetTiming(end)
  }

  feed(m: Measure): void {
    this.last = m
    const start = m.end - m.win * 1000
    // Gruppe: nur die kurzen Fenster (eins je 2,5 s), Mehrheit über 15 s
    if (m.win <= 10 && start >= this.songStart - 250) this.vote(m.end, classify(featuresOf(m)))
    if (start < this.timingStart - 250) return
    // An der Faltgrenze (um 150 bzw. 60) bleibt eine Messung beim laufenden Tempo: 150,3 neben 149,6 zählt als 150,3, nicht als 75,15
    // (Review 0.6.0 S2). Sonst gälte jede zweite Messung als anderes Tempo.
    let bpm = foldBpm(m.bpm)
    const cur = this.bpm
    if (cur !== null && !agrees(bpm, cur)) bpm = [bpm * 2, bpm / 2].find((c) => c >= 55 && c <= 165 && agrees(c, cur)) ?? bpm
    const e: Entry = { end: m.end, win: m.win, bpm, at: m.at, tclar: m.tclar, pclar: m.pclar }
    // Je Ausgabe ein Eintrag: das lange Fenster ersetzt das kurze mit demselben Ende
    const prev = this.hist[this.hist.length - 1]
    if (prev && Math.abs(prev.end - e.end) < 100) {
      if (e.win > prev.win) this.hist[this.hist.length - 1] = e
    } else this.hist.push(e)
    while (this.hist.length > TUNING.history) this.hist.shift()
    this.lastEnd = Math.max(this.lastEnd, m.end)
    this.compute()
  }

  private compute(): void {
    const tempo = confirmed(this.hist, (a, b) => agrees(a.bpm, b.bpm))
    if (!tempo.length) return
    let bpm = median(tempo.map((x) => x.bpm))
    let period = 60000 / bpm
    // Schlag: dieselbe Regel auf die Lage im Raster; Bezug ist der jüngste Eintrag des Tempos
    const ref = tempo[tempo.length - 1]!
    const phase = confirmed(tempo, (a, b) => Math.abs(phaseOff(a.at, b.at, period)) < period * TUNING.jump)
    // Feiner: Periode als Steigung der Schläge über die Zeit (genauer als jede einzelne Messung)
    if (phase.length >= 3) {
      const ns = phase.map((x) => Math.round((x.at - ref.at) / period))
      const span = Math.max(...ns) - Math.min(...ns)
      if (span >= 8) {
        const mx = ns.reduce((a, b) => a + b, 0) / ns.length
        const my = phase.reduce((a, x) => a + x.at, 0) / phase.length
        let sxy = 0
        let sxx = 0
        phase.forEach((x, i) => {
          sxy += (ns[i]! - mx) * (x.at - my)
          sxx += (ns[i]! - mx) ** 2
        })
        const p = sxx > 0 ? sxy / sxx : period
        // Höchstens 0,6 % neben dem Median (die Messungen streuen ±0,3 %); bei 2 % sprang „Summer's Back“ live kurz von 126,0 auf 124,4
        if (Math.abs(p / period - 1) < 0.006) {
          period = p
          bpm = 60000 / p
        }
      }
    }
    const newest = phase[phase.length - 1]!
    const off = phase.reduce((a, x) => a + phaseOff(x.at, newest.at, period), 0) / phase.length
    this.bpm = bpm
    this.anchor = newest.at + off
    this.sure =
      tempo.length >= 2 && phase.length >= 2 && median(tempo.map((x) => x.tclar)) >= TUNING.sureTclar && median(phase.map((x) => x.pclar)) >= TUNING.surePclar
  }

  private vote(end: number, g: Group): void {
    this.votes.push({ end, g })
    this.votes = this.votes.filter((v) => v.end > end - TUNING.groupVoteMs)
    if (this.votes.length < 3) return
    const count: Record<Group, number> = { calm: 0, groove: 0, hard: 0, sad: 0 }
    for (const v of this.votes) count[v.g] += 1
    const top = GROUPS.reduce((a, b) => (count[b] > count[a] ? b : a))
    if (count[top] * 2 <= this.votes.length) return // keine Mehrheit
    if (this.group === null) {
      if (end - this.songStart >= TUNING.groupAfterMs) this.group = top
      return
    }
    if (top === this.group) {
      this.cand = null
      return
    }
    if (!this.cand || this.cand.g !== top) this.cand = { g: top, since: end }
    else if (end - this.cand.since >= TUNING.groupSwitchMs) {
      this.group = top
      this.cand = null
    }
  }

  /** Der Wert für `tune-strip.beat` jetzt: der jüngste Schlag ≤ `now`, Versatz eingerechnet; `null` ohne tragende Messung. */
  value(now: number, offsetMs: number): Beat | null {
    if (this.bpm === null || this.anchor === null || now - this.lastEnd > TUNING.staleMs) return null
    const period = 60000 / this.bpm
    let at = this.anchor + offsetMs
    at += Math.floor((now - at) / period) * period
    // Vertrag 60–150 (types/index.d.ts; clawd-buddy verwirft alles darüber): Glätten und Grenz-Hysterese dürfen knapp darüber liegen
    const bpm = Math.min(150, Math.max(60, Math.round(this.bpm * 100) / 100))
    return { bpm, at: Math.round(at), sure: this.sure, group: this.group }
  }
}

/**
 * Muss `tune-strip.beat` neu geschrieben werden? Bei deutlicher Änderung sofort (Tempo > 1 %, Schlag > 40 ms neben dem alten
 * Raster, `sure` oder `group` anders, von oder zu `null`), kleine Änderungen höchstens alle 15 s (SPEC).
 */
export function needsWrite(prev: Beat | null, next: Beat | null, now: number, lastWriteAt: number): boolean {
  if (prev === null || next === null) return prev !== next
  if (prev.sure !== next.sure || prev.group !== next.group) return true
  const db = Math.abs(next.bpm / prev.bpm - 1)
  if (db > 0.01) return true
  const drift = Math.abs(phaseOff(next.at, prev.at, 60000 / prev.bpm))
  if (drift > 40) return true
  return now - lastWriteAt >= 15000 && (db > 0.0005 || drift > 5)
}

/** Wert eines anderen Schreibers prüfen (nach `/clear` lesen wir den eigenen Wert zurück). */
export function sameBeat(a: unknown, b: Beat | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b)
}
