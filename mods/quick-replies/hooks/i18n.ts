// quick-replies: Texte in beiden Sprachen (ohne `$`). Die Sprache kommt aus userConfig `language` (Standard en).

import type { ForkCost } from './cost.ts'

export type Lang = 'en' | 'de'

/** Kleine Beträge mit drei Nachkommastellen, sonst zwei. */
function money(v: number): string {
  const n = Number(v) || 0
  return n.toFixed(n < 0.1 ? 3 : 2)
}

/** Tokens: unter 1000 genau, sonst in Tausend. */
function count(v: number): string {
  const n = Number(v) || 0
  return n < 1000 ? String(n) : `${Math.round(n / 1000)}k`
}

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
    description: 'Reply suggestions above Clawd: status, on/off, more suggestions via fork, help',
    usage: 'Usage: /replies [status|on|off|more on|more off|help] · All commands: /replies help',
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
    forkQuotes: ['“', '”'],
    forkInChat: 'Fork in this chat',
    usd: (v: number) => (Number(v) < 0.001 ? '<$0.001' : `~$${money(v)}`),
    costNote: 'API price, estimated; on a subscription it counts toward the usage limits',
    tokens: (n: number) => `${count(n)} tokens`,
    fromCache: (pct: number) => `${pct} % from cache`,
    // /replies help (0.5.0, docs/HELP-SPEC.md)
    helpIntro: "Shows Claude Code's own suggestion for your next message as a button above Clawd and sends it on click or key; on request a fork of the session adds more.",
    helpStatus: 'Status: suggestions, sources, fork state and cost in this chat (also without an argument)',
    helpOn: 'Turn the suggestions on',
    helpOff: 'Turn the suggestions off (no pill, no fork)',
    helpMoreOn: 'More suggestions via fork, up to four in total, in all sessions',
    helpMoreOff: "Only Claude Code's own suggestion, in all sessions",
    helpHelp: 'This help (also: ?)',
    helpForkCost: "Fork: costs about one short answer per answer, mostly from the cache; this chat's cost is in /replies status.",
    helpMoreOverrides: '/replies more on|off overrides the setting “More suggestions via fork” for all sessions.',
    ctlClick: 'Click a suggestion',
    ctlClickDoes: 'Sends it right away as your message',
    ctlKey: '1–4 in the empty prompt',
    ctlKeyDoes: 'Sends that suggestion right away; the digit does not stay in the prompt',
    ctlSend: 'Send just 1–4',
    ctlSendDoes: 'Sends the suggestion shown under that number instead of the digit',
    featReplies: 'Suggestions',
    featMore: 'More via fork',
    featLayout: 'Layout',
    paused: 'on (paused)',
    setting: 'setting',
    setLanguage: 'Language',
    setMore: 'More suggestions via fork',
    setLayout: 'Layout',
    helpFooterTerminal: 'Change settings: /plugin configure quick-replies · Turn the mod off: /plugin disable quick-replies',
    helpFooterDesktop: 'Turn the mod off: + → Plugins → Manage plugins · Change settings: /plugin configure quick-replies in a terminal',
  },
  de: {
    description: 'Antwort-Vorschläge über Clawd: Status, an/aus, weitere Vorschläge per Fork, Hilfe',
    usage: 'Nutzung: /replies [status|on|off|more on|more off|help] · Alle Befehle: /replies help',
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
    forkQuotes: ['„', '“'],
    forkInChat: 'Fork in diesem Chat',
    usd: (v: number) => (Number(v) < 0.001 ? '<0,001 $' : `~${money(v).replace('.', ',')} $`),
    costNote: 'API-Preis, geschätzt; im Abo zählt es gegen die Nutzungslimits',
    tokens: (n: number) => `${count(n)} Tokens`,
    fromCache: (pct: number) => `${pct} % aus dem Cache`,
    helpIntro: 'Zeigt den Vorschlag von Claude Code für deine nächste Nachricht als Knopf über Clawd und sendet ihn per Klick oder Taste; auf Wunsch ergänzt ein Fork der Session weitere.',
    helpStatus: 'Status: Vorschläge, Quellen, Fork-Zustand und Kosten in diesem Chat (auch ohne Argument)',
    helpOn: 'Vorschläge einschalten',
    helpOff: 'Vorschläge ausschalten (keine Pille, kein Fork)',
    helpMoreOn: 'Weitere Vorschläge per Fork, bis zu vier insgesamt, in allen Sessions',
    helpMoreOff: 'Nur der Vorschlag von Claude Code, in allen Sessions',
    helpHelp: 'Diese Hilfe (auch: ?)',
    helpForkCost: 'Fork: kostet pro Antwort etwa eine kurze Antwort, großteils aus dem Cache; die Kosten dieses Chats stehen in /replies status.',
    helpMoreOverrides: '/replies more on|off überschreibt die Einstellung „Mehr Vorschläge per Fork“ für alle Sessions.',
    ctlClick: 'Klick auf einen Vorschlag',
    ctlClickDoes: 'Sendet ihn sofort als deine Nachricht',
    ctlKey: '1–4 im leeren Prompt',
    ctlKeyDoes: 'Sendet diesen Vorschlag sofort; die Ziffer bleibt nicht im Prompt',
    ctlSend: 'Nur 1–4 abschicken',
    ctlSendDoes: 'Sendet statt der Ziffer den Vorschlag mit dieser Nummer',
    featReplies: 'Vorschläge',
    featMore: 'Mehr per Fork',
    featLayout: 'Anordnung',
    paused: 'an (pausiert)',
    setting: 'Einstellung',
    setLanguage: 'Sprache',
    setMore: 'Mehr Vorschläge per Fork',
    setLayout: 'Anordnung',
    helpFooterTerminal: 'Einstellungen ändern: /plugin configure quick-replies · Mod abschalten: /plugin disable quick-replies',
    helpFooterDesktop: 'Mod abschalten: + → Plugins → Manage plugins · Einstellungen ändern: im Terminal /plugin configure quick-replies',
  },
} as const

export type Texts = (typeof T)[Lang]

/** Zeile für /replies status: Fork-Aufrufe dieses Chats mit geschätztem API-Wert. */
export function forkCostText(t: Texts, c: ForkCost): string {
  if (c.calls === 0) return `${t.forkInChat}: –`
  const pct = c.tokens > 0 ? Math.round((c.cached / c.tokens) * 100) : 0
  return `${t.forkInChat}: ${c.calls}× · ${t.usd(c.usd)} (${t.costNote}) · ${t.tokens(c.tokens)}, ${t.fromCache(pct)}`
}

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
