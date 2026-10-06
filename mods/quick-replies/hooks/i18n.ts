// quick-replies: Texte in beiden Sprachen (ohne `$`). Die Sprache kommt aus userConfig `language` (Standard en).

export type Lang = 'en' | 'de'

export function langOf(v: unknown): Lang {
  return v === 'de' ? 'de' : 'en'
}

/** Was der Fork zuletzt geliefert hat; als Text erst in `/replies status`. */
export type ForkState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'unanswered'; reason: string }
  | { kind: 'found'; count: number }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

/** Wo quick-replies in der Kette des Bands sitzt. */
export type Position = 'alone' | 'inner' | 'outer'

export const T = {
  en: {
    description: 'Reply suggestions above Clawd: status, on/off, more suggestions via fork',
    usage: 'Usage: /replies [status|on|off|more on|more off]',
    on: 'on',
    off: 'off',
    yes: 'yes',
    no: 'no',
    moreViaFork: 'more suggestions via fork',
    moreOn:
      "quick-replies: more suggestions via fork on, in all sessions from the next answer. Claude Code's suggestion stays on 1. Costs roughly one short answer per answer, mostly from the cache.",
    moreOff: "quick-replies: more suggestions off; all sessions show only Claude Code's suggestion.",
    suggestions: 'Suggestions',
    hidden: ' (hidden until the next finished turn)',
    sourceEngine: 'Claude Code',
    sourceFork: 'Fork',
    lastSources: 'Last sources',
    engineSeen: 'Suggestions from Claude Code in this session',
    surface: 'Surface',
    notDrawn: 'not drawn yet',
    band: (columns: number) => `band ${columns} columns`,
    layout: 'layout',
    position: 'position',
    positions: { alone: 'alone', inner: 'inner (only the core after me)', outer: 'outer (other mods draw below)' },
    fork: {
      running: 'running',
      unanswered: (reason: string) => `no answer (${reason})`,
      found: (count: number) => (count === 1 ? '1 suggestion' : `${count} suggestions`),
      none: 'no suggestions',
      error: (message: string) => `error: ${message}`,
    },
    sendFailed: (text: string) => `Sending failed. Please send it yourself: ${text}`,
    /** Sprache, in der der Fork die Vorschläge schreiben soll */
    forkLanguage: 'English',
  },
  de: {
    description: 'Antwort-Vorschläge über Clawd: Status, an/aus, weitere Vorschläge per Fork',
    usage: 'Nutzung: /replies [status|on|off|more on|more off]',
    on: 'an',
    off: 'aus',
    yes: 'ja',
    no: 'nein',
    moreViaFork: 'weitere Vorschläge per Fork',
    moreOn:
      'quick-replies: weitere Vorschläge per Fork an, in allen Sessions ab der nächsten Antwort. Der Vorschlag von Claude Code bleibt auf 1. Kostet pro Antwort etwa eine kurze Antwort, großteils aus dem Cache.',
    moreOff: 'quick-replies: weitere Vorschläge aus, in allen Sessions nur noch der Vorschlag von Claude Code.',
    suggestions: 'Vorschläge',
    hidden: ' (ausgeblendet bis zum nächsten fertigen Turn)',
    sourceEngine: 'Claude Code',
    sourceFork: 'Fork',
    lastSources: 'Quellen zuletzt',
    engineSeen: 'Vorschlag von Claude Code in dieser Session',
    surface: 'Oberfläche',
    notDrawn: 'noch nicht gezeichnet',
    band: (columns: number) => `Band ${columns} Spalten`,
    layout: 'Anordnung',
    position: 'Position',
    positions: { alone: 'allein', inner: 'innen (nach mir nur der Kern)', outer: 'außen (andere Mods zeichnen darunter)' },
    fork: {
      running: 'läuft',
      unanswered: (reason: string) => `keine Antwort (${reason})`,
      found: (count: number) => (count === 1 ? '1 Vorschlag' : `${count} Vorschläge`),
      none: 'keine Vorschläge',
      error: (message: string) => `Fehler: ${message}`,
    },
    sendFailed: (text: string) => `Senden ging nicht. Bitte selbst senden: ${text}`,
    forkLanguage: 'German',
  },
} as const

export type Texts = (typeof T)[Lang]

export function forkStateText(t: Texts, s: ForkState): string {
  switch (s.kind) {
    case 'idle':
      return '–'
    case 'running':
      return t.fork.running
    case 'unanswered':
      return t.fork.unanswered(s.reason)
    case 'found':
      return t.fork.found(s.count)
    case 'none':
      return t.fork.none
    case 'error':
      return t.fork.error(s.message)
  }
}
