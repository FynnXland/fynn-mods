// sky.ts: Tageszeit der Insel, ohne `$` (SPEC „Szene“, „Tageszeit“). Aus der Minute des Tages die Phase, die Himmelsfarben (weich
// gemischt), Sonne/Mond auf ihrem Bogen und die Lichter nach Uhrzeit. scene.ts baut daraus einen 24-h-CSS-Zyklus: Der Desktop zeichnet
// die Szene dann ohne Neuzeichnen weiter (Phase 0, SPEC „Tageszeit“ Alternative), ein Neuzeichnen setzt nur den Startpunkt neu.

export type Phase = 'night' | 'morning' | 'day' | 'evening'

/** Ein Farbstand des Himmels und des Lichts. `stars` 0–1 Sichtbarkeit, `light` 0–1 Helligkeit der Insel (Nacht dunkel). */
export type Sky = { top: string; mid: string; low: string; stars: number; light: number }

export const DAY_MINUTES = 1440

/** Grenzen der Phasen in Minuten: Nacht ab 22:00, Morgen ab 05:00, Tag ab 10:00, Abend ab 18:00 (SPEC Tests: 04:59/05:00, 21:59/22:00). */
export const PHASE_START: Readonly<Record<Phase, number>> = { night: 22 * 60, morning: 5 * 60, day: 10 * 60, evening: 18 * 60 }

/** Minute des Tages (0–1439) aus „HH:MM“; undefined, wenn es keine gültige Uhrzeit ist. */
export function parseTime(s: string): number | undefined {
  const m = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/.exec(s.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined
}

/** „HH:MM“ aus einer Minute des Tages. */
export function formatTime(minute: number): string {
  const m = ((Math.floor(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Lokale Minute des Tages (mit Sekundenbruch) aus Unix-ms; `Date` folgt der Zeitzone des Rechners (Phase 0, PROBE.md §3). */
export function localMinute(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000
}

export function phaseAt(minute: number): Phase {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  if (m >= PHASE_START.night || m < PHASE_START.morning) return 'night'
  if (m < PHASE_START.day) return 'morning'
  if (m < PHASE_START.evening) return 'day'
  return 'evening'
}

const NIGHT: Sky = { top: '#0a1130', mid: '#172552', low: '#2c3d73', stars: 1, light: 0.42 }
/** Stützstellen des Tages (Minute → Farbstand); dazwischen wird linear gemischt. Die Phasengrenzen liegen in den Übergängen. */
export const KEYS: readonly { at: number; sky: Sky }[] = [
  { at: 0, sky: NIGHT },
  { at: 290, sky: NIGHT },
  { at: 370, sky: { top: '#39407e', mid: '#c27a9c', low: '#f5c48d', stars: 0.25, light: 0.7 } },
  { at: 460, sky: { top: '#6aa5dc', mid: '#a8cdeb', low: '#f6dcb6', stars: 0, light: 0.92 } },
  { at: 600, sky: { top: '#4b93d6', mid: '#8bc1ec', low: '#d3eaf8', stars: 0, light: 1 } },
  { at: 1050, sky: { top: '#4b93d6', mid: '#8bc1ec', low: '#d3eaf8', stars: 0, light: 1 } },
  { at: 1140, sky: { top: '#4b4d91', mid: '#d97a7b', low: '#f4ae69', stars: 0.08, light: 0.82 } },
  { at: 1230, sky: { top: '#1f2358', mid: '#5c407c', low: '#b1617b', stars: 0.6, light: 0.6 } },
  { at: 1320, sky: NIGHT },
  { at: DAY_MINUTES, sky: NIGHT },
]

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Zwei Hex-Farben mischen, `t` 0 = a, 1 = b. */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a)
  const y = hex(b)
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const round = (v: number) => Math.round(v * 1000) / 1000

/** Der Farbstand zur Minute, aus den Stützstellen gemischt (weiche Übergänge, SPEC „Himmel“). */
export function skyAt(minute: number): Sky {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1]!.at <= m) i++
  const a = KEYS[i]!
  const b = KEYS[i + 1]!
  const t = b.at === a.at ? 0 : (m - a.at) / (b.at - a.at)
  return {
    top: mix(a.sky.top, b.sky.top, t),
    mid: mix(a.sky.mid, b.sky.mid, t),
    low: mix(a.sky.low, b.sky.low, t),
    stars: round(lerp(a.sky.stars, b.sky.stars, t)),
    light: round(lerp(a.sky.light, b.sky.light, t)),
  }
}

/** Sonne: Aufgang 06:00, Untergang 20:00. Mond: 20:30 bis 06:30 (über Mitternacht). */
export const SUN = { rise: 360, set: 1200 }
export const MOON = { rise: 1230, set: 390 }

/** Stand auf einem Bogen: `t` 0–1 vom Aufgang zum Untergang, `up` sichtbar (mit kurzem Ein- und Ausblenden). */
export function arcAt(minute: number, body: { rise: number; set: number }): { t: number; opacity: number } {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  const len = (body.set - body.rise + DAY_MINUTES) % DAY_MINUTES
  const since = (m - body.rise + DAY_MINUTES) % DAY_MINUTES
  if (since > len) return { t: since < len + (DAY_MINUTES - len) / 2 ? 1 : 0, opacity: 0 }
  const t = since / len
  const fade = 25 / len // 25 Minuten Ein- und Ausblenden
  const opacity = Math.min(1, t / fade, (1 - t) / fade)
  return { t: round(t), opacity: round(Math.max(0, opacity)) }
}

/** Position auf dem Bogen in Einheiten der Himmelsebene (viewBox 1600 × 1000): links unten → oben → rechts unten. */
export function arcPoint(t: number): { x: number; y: number } {
  return { x: Math.round(120 + 1360 * t), y: Math.round(300 - 230 * Math.sin(Math.PI * t)) }
}

/** Fenster nach Uhrzeit (ohne clawd-buddy-Wert): spät abends und in der ersten Nachthälfte an, 20:00–00:30 (SPEC „Müdigkeit“). */
export function lateEvening(minute: number): boolean {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return m >= 20 * 60 || m < 30
}
