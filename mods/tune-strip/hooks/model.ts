// tune-strip: reine Logik ohne `$`: Position, Zeitformat, Befehle von `/tune`, Wahl der Stufe, Takt.
import { REPEAT_MODES } from './ps.ts'
import type { ControlCmd, RepeatMode, Track } from './ps.ts'

/** Sprung der Tasten −15 s / +15 s (Fynn, 2026-11-03). */
export const SEEK_STEP = 15

export const SIZES = ['auto', 'full', 'compact', 'mini'] as const
export type Size = (typeof SIZES)[number]
/** Stufen von groß nach klein; `off` ist „nichts zeichnen“. */
export const STAGES = ['full', 'compact', 'mini', 'off'] as const
export type Stage = (typeof STAGES)[number]

export const HELP_WORDS: readonly string[] = ['help', '?']

/** Position jetzt: die gemeldete Position plus die Zeit seit der Abfrage, solange gespielt wird; nie über die Länge hinaus. */
export function positionNow(t: Pick<Track, 'pos' | 'end' | 'status'>, queryAt: number, now: number): number {
  const run = t.status === 'Playing' ? Math.max(0, now - queryAt) / 1000 : 0
  const p = t.pos + run
  return t.end > 0 ? Math.min(p, t.end) : p
}

/** `3:05`, ab einer Stunde `1:02:03`. */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}

/** Anteil 0–1 für den Positionsbalken; ohne Länge 0. */
export function ratio(pos: number, end: number): number {
  return end > 0 ? Math.max(0, Math.min(1, pos / end)) : 0
}

/** Repeat reihum: aus → Liste → Titel → aus (so wie Spotify es durchschaltet). */
export function nextRepeat(m: RepeatMode): RepeatMode {
  const order: RepeatMode[] = ['None', 'List', 'Track']
  return order[(order.indexOf(m) + 1) % order.length]!
}

export type Parsed =
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'control'; word: ControlWord; arg?: string }
  | { kind: 'size'; size: Size }
  | { kind: 'enabled'; value: boolean }
  | { kind: 'unknown'; word: string }
  | { kind: 'badArg'; word: string; arg: string }

/** Wörter, die zu einem Steuerbefehl führen; `back`/`forward` sind ±15 s, `prev` der vorige Titel. */
export const CONTROL_WORDS = ['play', 'pause', 'toggle', 'next', 'prev', 'back', 'forward', 'shuffle', 'repeat'] as const
export type ControlWord = (typeof CONTROL_WORDS)[number]

const ON_OFF: Record<string, boolean> = { on: true, off: false }
const REPEAT_ARG: Record<string, RepeatMode> = { off: 'None', none: 'None', all: 'List', list: 'List', track: 'Track', one: 'Track' }

/** `/tune <args>` lesen. Leere Eingabe zeigt den Stand; unbekanntes erstes Wort ist `unknown`. */
export function parseTune(args: string): Parsed {
  const w = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const [first, second] = w
  if (!first || first === 'status') return w.length > 1 ? { kind: 'unknown', word: w.join(' ') } : { kind: 'status' }
  if (HELP_WORDS.includes(first)) return w.length === 1 ? { kind: 'help' } : { kind: 'unknown', word: w.join(' ') }
  if (first === 'on' || first === 'off') return w.length === 1 ? { kind: 'enabled', value: ON_OFF[first]! } : { kind: 'unknown', word: w.join(' ') }
  if (first === 'size') {
    const size = SIZES.find((s) => s === second)
    if (second === 'off') return { kind: 'enabled', value: false }
    return size && w.length === 2 ? { kind: 'size', size } : { kind: 'badArg', word: first, arg: w.slice(1).join(' ') }
  }
  const word = CONTROL_WORDS.find((c) => c === first)
  if (!word) return { kind: 'unknown', word: first }
  if (word === 'shuffle') {
    if (second === undefined) return { kind: 'control', word }
    return w.length === 2 && second in ON_OFF ? { kind: 'control', word, arg: second } : { kind: 'badArg', word, arg: w.slice(1).join(' ') }
  }
  if (word === 'repeat') {
    if (second === undefined) return { kind: 'control', word }
    return w.length === 2 && second in REPEAT_ARG ? { kind: 'control', word, arg: REPEAT_ARG[second]! } : { kind: 'badArg', word, arg: w.slice(1).join(' ') }
  }
  return w.length === 1 ? { kind: 'control', word } : { kind: 'unknown', word: w.join(' ') }
}

export type Action = { cmd: ControlCmd; arg?: string }

/**
 * Aus einem Wort den Aufruf des Steuer-Skripts machen. Braucht den letzten Stand (für Umschalter und Spulen); ohne ihn
 * `undefined`. `pos` ist die Position zu diesem Zeitpunkt.
 */
export function actionFor(word: ControlWord, arg: string | undefined, t: Track | null, pos: number): Action | undefined {
  switch (word) {
    case 'play':
    case 'pause':
    case 'toggle':
    case 'next':
      return { cmd: word }
    case 'prev':
      return { cmd: 'prev' }
    case 'back':
    case 'forward': {
      if (!t) return undefined
      const target = word === 'back' ? pos - SEEK_STEP : pos + SEEK_STEP
      const max = t.end > 1 ? t.end - 1 : target
      return { cmd: 'seek', arg: String(Math.max(0, Math.min(max, Math.round(target)))) }
    }
    case 'shuffle':
      if (arg) return { cmd: 'shuffle', arg: String(arg === 'on') }
      return t ? { cmd: 'shuffle', arg: String(!t.shuffle) } : undefined
    case 'repeat':
      if (arg) return { cmd: 'repeat', arg: REPEAT_MODES.find((m) => m === arg) ?? 'None' }
      return t ? { cmd: 'repeat', arg: nextRepeat(t.repeat) } : undefined
  }
}

/** Breiten der Stufen in der Einheit der Oberfläche (Pixel im Desktop, Spalten im Terminal). */
export type StageWidths = { full: number; compact: number; mini: number }

/**
 * Welche Stufe passt in `room`? Fest gewählte Größe gilt, solange sie passt; passt sie nicht, weicht sie nach unten bis `off`.
 * `auto` nimmt die größte, die passt. Spotify weicht als Erster, deshalb sinkt nur seine Stufe (SPEC „Platz im Band“).
 * Ohne bekannte Breite (`room` undefined) gilt die gewünschte Stufe.
 */
export function pickStage(room: number | undefined, size: Size, widths: StageWidths): Stage {
  const want: Stage = size === 'auto' ? 'full' : size
  if (room === undefined) return want
  for (let i = STAGES.indexOf(want); i < STAGES.length - 1; i++) {
    const st = STAGES[i]!
    if (st !== 'off' && widths[st] <= room) return st
  }
  return 'off'
}

/**
 * Stufe im Desktop. `full` ist die eigene Leiste über allen Mods und braucht keinen Platz in der Zeile; `compact` und `mini` stehen
 * als Platz in der Zeile. `auto` nimmt `compact` nur, wenn der Platz bekannt ist und reicht, sonst die Leiste (Fynn, 2026-11-03).
 */
export function desktopStage(room: number | undefined, size: Size, widths: StageWidths): Stage {
  if (size === 'full') return 'full'
  if (size === 'auto') return room !== undefined && room >= widths.compact ? 'compact' : 'full'
  return pickStage(room, size, widths)
}

/** Abstand zwischen den Plätzen im Desktop in Pixeln (Fynn, 2026-11-03). */
export const SLOT_GAP_PX = 12

/**
 * Platz für Spotify im Desktop in Pixeln: Breite des Bands minus die Plätze der anderen und der Abstand zu jedem. `others` sind die
 * gemeldeten Breiten (`null`/`undefined` = der Mod zeichnet nichts); `total` ist die Breite des Bands in Pixeln.
 */
export function desktopRoom(total: number, others: readonly (number | null | undefined)[]): number {
  const w = others.filter((x): x is number => typeof x === 'number' && x > 0)
  return total - w.reduce((a, b) => a + b, 0) - SLOT_GAP_PX * w.length
}

/** Taktlänge in ms nach dem Zustand (SPEC „Fehlerverhalten“): nach drei Fehlern in Folge und ohne Sitzung länger. */
export function pollInterval(o: { pollSeconds: number; failures: number; hasSession: boolean }): number {
  const base = Math.max(3, Math.min(10, o.pollSeconds)) * 1000
  if (o.failures >= 3) return 30000
  if (!o.hasSession) return Math.max(base, 15000)
  return base
}
