// limit-bars: welche Teile der Anzeige zu sehen sind (SPEC.md, Ausbau v0.6.0), reine Funktionen ohne `$`.
// Zwei Quellen: userConfig (`showFiveHour`, `showWeekly`, `showCache`, `showStorage`, dazu das alte `onlyFiveHour`) und
// `/bars` (in `$.store` unter `display`, wirkt in allen offenen Chats). Vorrang: ein per Befehl gesetzter Wert, sonst die
// Einstellung. Abgeschaltet wird nur die Anzeige; Rückfrage, Hinweise und Befehle des Caches bleiben (Fynn, 2026-10-06).

export const PARTS = ['fiveHour', 'weekly', 'cache', 'storage'] as const
export type Part = (typeof PARTS)[number]
export type Display = Record<Part, boolean>
export type Overrides = Partial<Display>

/** Englischer Name je Teil, wie er in `/bars` steht. */
export const PART_ARG: Readonly<Record<Part, string>> = { fiveHour: '5h', weekly: 'week', cache: 'cache', storage: 'storage' }

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

/**
 * Stand aus userConfig. Standard wie bis 0.5.x: 5h, Woche und Cache an; Speicher an, zeigt aber nur mit `storagePath` etwas.
 * `onlyFiveHour: true` schaltet die Woche weiter aus (veraltet, bleibt gültig).
 */
export function displayFromOptions(options: Readonly<Record<string, unknown>>): Display {
  return {
    fiveHour: bool(options.showFiveHour, true),
    weekly: bool(options.showWeekly, true) && options.onlyFiveHour !== true,
    cache: bool(options.showCache, true),
    storage: bool(options.showStorage, true),
  }
}

/** Gespeicherte `/bars`-Werte; nur echte Booleans der vier Teile zählen. */
export function cleanOverrides(v: unknown): Overrides {
  const out: Overrides = {}
  if (!v || typeof v !== 'object') return out
  for (const p of PARTS) {
    const x = (v as Record<string, unknown>)[p]
    if (typeof x === 'boolean') out[p] = x
  }
  return out
}

/** Was gilt: der Befehl schlägt die Einstellung. */
export function effectiveDisplay(base: Display, ov: Overrides): Display {
  return { fiveHour: ov.fiveHour ?? base.fiveHour, weekly: ov.weekly ?? base.weekly, cache: ov.cache ?? base.cache, storage: ov.storage ?? base.storage }
}

const PART_ALIASES: ReadonlyArray<[Part, readonly string[]]> = [
  ['fiveHour', ['5h', 'five', 'fivehour', '5-hour', '5hour']],
  ['weekly', ['week', 'weekly', '7d', 'woche', 'wochenlimit']],
  ['cache', ['cache']],
  ['storage', ['storage', 'disk', 'speicher']],
]

/** Teil aus einem Argument, in beiden Sprachen (release/I18N.md §3). */
export function parsePart(s: string): Part | undefined {
  const x = s.trim().toLowerCase()
  return PART_ALIASES.find(([, names]) => names.includes(x))?.[0]
}

/** `on`/`off` und die deutschen Aliase `an`/`aus`. */
export function parseOnOff(s: string): boolean | undefined {
  const x = s.trim().toLowerCase()
  if (x === 'on' || x === 'an') return true
  if (x === 'off' || x === 'aus') return false
  return undefined
}

export type BarsCommand = { kind: 'status' } | { kind: 'reset' } | { kind: 'help' } | { kind: 'set'; part: Part; on: boolean } | { kind: 'bad' }

// Wortlisten des Parsers, exportiert für den Vollständigkeitstest der Hilfe (docs/HELP-SPEC.md §6 Punkt 5)
/** `help` und `?`, nur als einziges Wort (HELP-SPEC §2); gilt auch für die Nebenbefehle `/cache`, `/handoff`, `/keepwarm`, `/disk`. */
export const HELP_WORDS: readonly string[] = ['help', '?']
export const STATUS_WORDS: readonly string[] = ['status', 'show']
export const RESET_WORDS: readonly string[] = ['reset', 'zurücksetzen', 'zuruecksetzen']
export const SHOW_WORDS: readonly string[] = ['show', 'zeigen']
export const ON_OFF_WORDS: readonly string[] = ['on', 'off', 'an', 'aus']
export const PART_WORDS: readonly string[] = PART_ALIASES.flatMap(([, names]) => names)

// Wortlisten der Nebenbefehle (register.ts nutzt sie; Vollständigkeitstest der Hilfe)
export const HANDOFF_SHOW_WORDS: readonly string[] = ['show', 'zeigen']
export const HANDOFF_CONTINUE_WORDS: readonly string[] = ['continue', 'weiter']
export const KEEP_OFF_WORDS: readonly string[] = ['off', 'aus']
export const DISK_WORDS: readonly string[] = ['refresh']

/** Ist das ganze Argument `help` oder `?` (ein Wort, Groß-/Kleinschreibung egal)? */
export function isHelp(args: string): boolean {
  const w = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return w.length === 1 && HELP_WORDS.includes(w[0]!)
}

/** `/bars`, `/bars help`, `/bars reset`, `/bars show <teil> on|off` und kurz `/bars <teil> on|off`. */
export function parseBars(args: string): BarsCommand {
  const w = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (w.length === 0 || (w.length === 1 && STATUS_WORDS.includes(w[0]!))) return { kind: 'status' }
  if (isHelp(args)) return { kind: 'help' }
  if (w.length === 1 && RESET_WORDS.includes(w[0]!)) return { kind: 'reset' }
  const rest = SHOW_WORDS.includes(w[0]!) ? w.slice(1) : w
  if (rest.length !== 2) return { kind: 'bad' }
  const part = parsePart(rest[0]!)
  const on = parseOnOff(rest[1]!)
  return part && on !== undefined ? { kind: 'set', part, on } : { kind: 'bad' }
}
