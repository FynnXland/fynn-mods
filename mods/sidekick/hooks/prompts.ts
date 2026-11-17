// sidekick: Erkennung wiederholter Prompts (SPEC Nachtrag 0.21.0) und die Absprachen mit prompt-deck (Ausbau 0.29.0). Reine Logik
// ohne `$`: Verlauf eigener Nachrichten, Wortmenge, Vorfilter, Namensprüfung, Haiku-Prompt und Parser, dazu das Lesen von
// `prompt-deck.saved`/`prompt-deck.later` und der Antwort von `/deck save`. register.ts liest und schreibt Store und `$.state`,
// ruft das Modell und `/deck`. Seit 0.29.0 speichert und sendet prompt-deck; sidekick erkennt nur und bietet an (prompt-deck SPEC E6).
import type { Lang } from './i18n.js'

/** Ein gemerkter eigener Prompt für die Erkennung (`$.store` `prompts:recent`). `id` = `<session>:<zeit>`. */
export type Recent = { id: string; sid: string; at: number; text: string; words: string[]; intent?: string }
/** Ein bis 0.28.1 in sidekick gespeicherter Prompt (`$.store` `prompts:saved`); seit 0.29.0 nur noch Sicherung und Quelle des Umzugs. */
export type Saved = { name: string; text: string; button: boolean; at: number; from: 'auto' | 'manual' }
/** Ein Eintrag von `prompt-deck.saved` (mods/prompt-deck/SPEC.md „Absprachen“): Name und Wortmenge, kein Text. */
export type DeckItem = { name: string; words: string[] }
/** Haiku-Aufrufe je Tag (`$.store` `prompts:budget`). */
export type Budget = { day: string; n: number }
/** Was Haiku vorschlägt: Name und eigenständige Fassung. */
export type Proposal = { name: string; text: string }

/** Kürzer als das wird nicht gemerkt („ja“, „weiter“, „mach“). */
export const MIN_CHARS = 60
export const MIN_WORDS = 8
/** Je Eintrag gemerkte Zeichen; zugleich das, was je Nachricht an Haiku geht (Fynn 2026-11-06: ≤ 1 000). */
export const KEEP_CHARS = 1000
export const RECENT_MAX = 300
export const RECENT_DAYS = 30
/** Vorfilter: Jaccard der Wortmengen; Probe im Bau 0.21.0 (SPEC „Bau 0.21.0“). */
export const JACCARD = 0.25
/** Ähnliche frühere Einträge aus anderen Sessions, ohne die neue Nachricht. */
export const MIN_OTHERS = 2
/** Sessions mit der neuen Nachricht zusammen. */
export const MIN_SESSIONS = 3
/** An Haiku gehen höchstens so viele Nachrichten einer Gruppe (mit der neuen). */
export const GROUP_MAX = 4
/** Vorschlags-Aufrufe (Name und Fassung) je Tag (Fynn 2026-11-06, Variante B). */
export const HAIKU_PER_DAY = 5
/** Höchstens so viele Einträge liest der Umzug aus `prompts:saved` (so viele konnte sidekick bis 0.28.1 speichern). */
export const SAVED_MAX = 12
export const SEEN_MAX = 100
export const NAME_MAX = 24
export const TEXT_MAX = 1200
/**
 * Gesendet wird seit 0.29.0 von prompt-deck mit `/p <name>` (mods/prompt-deck/SPEC.md E2); sidekick nennt den Befehl nur in Texten
 * („Als /p tidy-chats speichern?“). `/deck` ist prompt-decks Verwaltungsbefehl, über den sidekick speichert.
 */
export const P_CMD = 'p'
export const DECK_CMD = 'deck'
/** So steht ein Prompt in Texten: `p tidy-chats` (mit `/` davor). */
export const PREFIX = `${P_CMD} `
const NAME_RE = /^[a-z0-9-]{1,24}$/

const DAY_MS = 24 * 60 * 60000

/** Wird diese Nachricht für die Erkennung gemerkt? Nicht: Slash-Befehle, Plugin-Nachrichten, kurze Nachrichten. */
export function remembers(text: string, originKind: string): boolean {
  if (originKind === 'plugin') return false
  const s = String(text ?? '').trim()
  if (!s || s.startsWith('/')) return false
  if (s.length < MIN_CHARS) return false
  return s.split(/\s+/).filter(Boolean).length >= MIN_WORDS
}

/** Wortmenge: klein geschrieben, ohne Satzzeichen, ohne Wörter unter 3 Buchstaben, jedes Wort einmal, sortiert. */
export function wordSet(text: string): string[] {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 3)
  return [...new Set(words)].sort()
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0
  const sa = new Set(a)
  let both = 0
  for (const w of new Set(b)) if (sa.has(w)) both += 1
  return both / (sa.size + new Set(b).size - both)
}

/** Ein neuer Eintrag aus einer eigenen Nachricht. */
export function recentOf(text: string, sid: string, at: number): Recent {
  const t = String(text ?? '').trim().slice(0, KEEP_CHARS)
  return { id: `${sid}:${at}`, sid, at, text: t, words: wordSet(t) }
}

/** Verlauf aus dem Store, tolerant gelesen; älter als 30 Tage fällt heraus, höchstens 300. */
export function cleanRecent(v: unknown, now: number): Recent[] {
  if (!Array.isArray(v)) return []
  const out: Recent[] = []
  for (const x of v) {
    const o = (x && typeof x === 'object' ? x : null) as Record<string, unknown> | null
    if (!o || typeof o.sid !== 'string' || typeof o.at !== 'number' || typeof o.text !== 'string') continue
    if (now - o.at > RECENT_DAYS * DAY_MS) continue
    const words = Array.isArray(o.words) ? o.words.filter((w): w is string => typeof w === 'string') : wordSet(o.text)
    const intent = typeof o.intent === 'string' && o.intent ? { intent: o.intent.slice(0, 60) } : {}
    out.push({ id: typeof o.id === 'string' ? o.id : `${o.sid}:${o.at}`, sid: o.sid, at: o.at, text: o.text.slice(0, KEEP_CHARS), words, ...intent })
  }
  return out.slice(-RECENT_MAX)
}

export function addRecent(list: readonly Recent[], r: Recent, now: number): Recent[] {
  return cleanRecent([...list, r], now)
}

/**
 * Vorfilter, lokal: frühere Einträge aus anderen Sessions mit Jaccard ≥ Schwelle. Kandidat, wenn mindestens 2 solche da sind und mit der
 * neuen Nachricht mindestens 3 Sessions zusammenkommen. Schon gesehene Einträge (verneint, abgelehnt, gespeichert) zählen nicht.
 * Rückgabe: die neue Nachricht zuerst, dann die ähnlichsten (höchstens `GROUP_MAX` zusammen), sonst null.
 */
export function candidates(list: readonly Recent[], r: Recent, seen: ReadonlySet<string> = new Set(), threshold = JACCARD): Recent[] | null {
  const hits = list
    .filter((x) => x.sid !== r.sid && x.id !== r.id && !seen.has(x.id))
    .map((x) => ({ x, j: jaccard(x.words, r.words) }))
    .filter((h) => h.j >= threshold)
    .sort((a, b) => b.j - a.j)
  if (hits.length < MIN_OTHERS) return null
  // Je Session der ähnlichste, damit die Gruppe so viele Chats wie möglich zeigt
  const bySession = new Map<string, Recent>()
  for (const h of hits) if (!bySession.has(h.x.sid)) bySession.set(h.x.sid, h.x)
  if (bySession.size + 1 < MIN_SESSIONS) return null
  return [r, ...[...bySession.values()].slice(0, GROUP_MAX - 1)]
}

/** Ähnelt die Nachricht einem schon gespeicherten Prompt (Wortmengen aus `prompt-deck.saved`)? Dann kein Angebot. */
export function nearSaved(items: readonly DeckItem[], words: readonly string[], threshold = JACCARD): boolean {
  return items.some((s) => jaccard(s.words, words) >= threshold)
}

// ---------- gesehene Gruppen ----------

/** Verneinte, abgelehnte oder gespeicherte Gruppen (`prompts:seen`), je Gruppe die IDs ihrer Einträge; höchstens 100. */
export function cleanSeen(v: unknown): string[][] {
  if (!Array.isArray(v)) return []
  return v
    .filter((g): g is unknown[] => Array.isArray(g))
    .map((g) => g.filter((id): id is string => typeof id === 'string'))
    .filter((g) => g.length > 0)
    .slice(-SEEN_MAX)
}
export const seenSet = (groups: readonly (readonly string[])[]) => new Set(groups.flat())
export const addSeen = (groups: readonly string[][], ids: readonly string[]) => cleanSeen([...groups, [...ids]])

// ---------- Tagesgrenze ----------

export function cleanBudget(v: unknown): Budget {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { day: typeof o.day === 'string' ? o.day : '', n: typeof o.n === 'number' && o.n > 0 ? Math.floor(o.n) : 0 }
}
export const budgetLeft = (b: Budget, day: string) => (b.day === day ? Math.max(0, HAIKU_PER_DAY - b.n) : HAIKU_PER_DAY)
export const useBudget = (b: Budget, day: string): Budget => ({ day, n: (b.day === day ? b.n : 0) + 1 })

// ---------- bis 0.28.1 gespeicherte Prompts (Quelle des Umzugs) ----------

export function cleanSaved(v: unknown): Saved[] {
  if (!Array.isArray(v)) return []
  const out: Saved[] = []
  for (const x of v) {
    const o = (x && typeof x === 'object' ? x : null) as Record<string, unknown> | null
    if (!o || typeof o.name !== 'string' || !NAME_RE.test(o.name) || typeof o.text !== 'string' || !o.text.trim()) continue
    if (out.some((s) => s.name === o.name)) continue
    out.push({ name: o.name, text: o.text, button: o.button !== false, at: typeof o.at === 'number' ? o.at : 0, from: o.from === 'auto' ? 'auto' : 'manual' })
  }
  return out.slice(0, SAVED_MAX)
}

/**
 * Argumente von `/deck save` für einen Eintrag des Umzugs (SPEC 0.29.0 Verhalten 6): Schalter vor dem Namen (prompt-deck `saveArgs`),
 * `--off` bei `button: false`, `--manual` bei selbst gespeicherten (sonst führte prompt-deck sie als „von sidekick vorgeschlagen“).
 */
export function migrateArgs(s: Saved): string {
  return [s.button ? '' : '--off', s.from === 'manual' ? '--manual' : '', s.name, s.text].filter(Boolean).join(' ')
}

// ---------- Absprachen mit prompt-deck (Ausbau 0.29.0, mods/prompt-deck/types/index.d.ts) ----------

/** `prompt-deck.saved` tolerant gelesen; null = kein Wert (prompt-deck fehlt, nach /clear noch nicht geschrieben) oder unlesbar. */
export function cleanDeckSaved(v: unknown): DeckItem[] | null {
  const items = (v && typeof v === 'object' ? (v as { items?: unknown }).items : undefined) as unknown
  if (!Array.isArray(items)) return null
  const out: DeckItem[] = []
  for (const x of items) {
    const o = (x && typeof x === 'object' ? x : null) as Record<string, unknown> | null
    if (!o || typeof o.name !== 'string' || !o.name) continue
    out.push({ name: o.name, words: Array.isArray(o.words) ? o.words.filter((w): w is string => typeof w === 'string') : [] })
  }
  return out
}

/** Zeitpunkt der Markierung „Danach“ aus `prompt-deck.later` (`{ armed: true, at }`); sonst null. */
export function deckLaterAt(v: unknown): number | null {
  const o = (v && typeof v === 'object' ? v : null) as { armed?: unknown; at?: unknown } | null
  return o?.armed === true && typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null
}

/** Antwort von `/deck save` für sidekick: erste Zeile maschinenlesbar, ab Zeile 2 ein Satz für Menschen (prompt-deck Verhalten 5). */
export type DeckAnswer = { kind: 'saved'; name: string; human: string } | { kind: 'full' | 'refused' | 'other'; why: string; human: string }

export function deckAnswer(text: string | undefined): DeckAnswer {
  const [first = '', ...rest] = String(text ?? '').split('\n')
  const line = first.trim()
  const human = rest.join('\n').trim()
  const m = /^saved\s+(\S+)$/.exec(line)
  if (m) return { kind: 'saved', name: m[1]!, human }
  if (line === 'full') return { kind: 'full', why: 'full', human }
  const r = /^refused(?:\s+(.*))?$/.exec(line)
  if (r) return { kind: 'refused', why: (r[1] ?? '').trim(), human }
  return { kind: 'other', why: line.slice(0, 140), human }
}

/** Die vier umgezogenen Unterbefehle (SPEC 0.29.0 Verhalten 2) und ihr Gegenstück in prompt-deck. */
export const MOVED: Readonly<Record<string, string>> = { save: '/deck save', prompts: '/deck list', forget: '/deck forget', buttons: '/deck buttons' }
export function movedTarget(verb: string): string | null {
  return MOVED[verb.toLowerCase()] ?? null
}

/** Anfang des Texts in einer Zeile, für das Angebot. */
export function preview(text: string, n = 80): string {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

// ---------- Namen ----------

/** Name aus einer Eingabe: klein, Leerzeichen und `_` zu `-`, ohne führenden Schrägstrich. */
export function normName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^p\s+(?=.)/i, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

export type NameCheck = { ok: true; name: string } | { ok: false; name: string; why: 'invalid' | 'own'; suggest: string }

/** Erster freier Vorschlag `<name>-2`, `-3`, … innerhalb von 24 Zeichen; leer, wenn keiner frei ist. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  const base = name.replace(/-\d+$/, '').replace(/[^a-z0-9-]/g, '').slice(0, NAME_MAX) || 'prompt'
  for (let i = 2; i < 100; i++) {
    const suffix = `-${i}`
    const n = `${base.slice(0, NAME_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(n)) return n
  }
  return ''
}

/**
 * Darf `name` ein gespeicherter Prompt heißen (`/p <name>`)? Andere Befehle stören nicht, nur schon gespeicherte Namen (seit 0.29.0
 * die aus `prompt-deck.saved`): erlaubt, wenn `overwrite`, sonst ein freier Vorschlag. Das Angebot überschreibt nie.
 */
export function checkName(raw: string, ownSaved: readonly string[], overwrite: boolean): NameCheck {
  const name = normName(raw)
  const busy = new Set<string>(ownSaved)
  if (!NAME_RE.test(name) || /^-|-$/.test(name)) return { ok: false, name, why: 'invalid', suggest: freeName(name || 'prompt', busy) }
  if (ownSaved.includes(name) && !overwrite) return { ok: false, name, why: 'own', suggest: freeName(name, busy) }
  return { ok: true, name }
}


// ---------- Absicht je Nachricht (Variante B, Probe Bau 0.21.0) ----------

/** Absichten der letzten Einträge (neueste zuerst, jede einmal), für den Abgleich im Prompt; höchstens `n`. */
export function knownIntents(list: readonly Recent[], n = 40): string[] {
  const out: string[] = []
  for (let i = list.length - 1; i >= 0 && out.length < n; i--) {
    const a = list[i]!.intent
    if (a && !out.includes(a)) out.push(a)
  }
  return out
}

/** Anweisung an Haiku: eine kurze Absicht je Nachricht, eine bekannte wiederverwenden (Prompt v2 der Probe). */
export function intentSystem(lang: Lang): string {
  if (lang === 'de')
    return [
      'Du bekommst eine neue Nachricht, die ein Nutzer an seinen Coding-Assistenten geschickt hat (oft diktiert, mit Füllwörtern), und eine Liste von Absichten aus früheren Nachrichten in anderen Chats.',
      'Schritt 1: Prüfe die Liste. Gibt eine frühere Absicht dieselbe Art Auftrag, auch wenn Wortlaut, Projekt und Einzelheiten anders sind, gib genau ihren Wortlaut zurück. Beispiel: "Tests ausführen und Fehler beheben" passt auch zu "lass mal die Tests laufen und repariere, was rot ist".',
      'Schritt 2: Passt keine, benenne die Absicht neu in allgemeiner Form: Verb und Gegenstand, 2 bis 5 Wörter, Deutsch, ohne Projekt- oder Dateinamen.',
      'Ist die Nachricht nur eine Antwort auf eine Rückfrage, eine Rückmeldung zu einem Ergebnis oder ein Auftrag zu einem bestimmten Fehler oder einer bestimmten Funktion, gib "einmalig".',
      'Antworte nur mit JSON: {"absicht": "…"}',
    ].join('\n')
  return [
    'You get a new message a user sent to their coding assistant (often dictated, with filler words) and a list of intents from earlier messages in other chats.',
    'Step 1: Check the list. If an earlier intent is the same kind of request, even with other wording, project and details, return exactly its wording. Example: "run tests and fix failures" also fits "let the tests run and repair whatever is red".',
    'Step 2: If none fits, name the intent in general form: verb and object, 2 to 5 words, English, no project or file names.',
    'If the message is only an answer to a question, feedback on a result, or a request about one specific bug or feature, return "one-off".',
    'Answer with JSON only: {"intent": "…"}',
  ].join('\n')
}

export function intentPrompt(text: string, known: readonly string[], lang: Lang): string {
  const head = lang === 'de' ? 'Frühere Absichten:' : 'Earlier intents:'
  const none = lang === 'de' ? '(keine)' : '(none)'
  const msg = lang === 'de' ? 'Neue Nachricht:' : 'New message:'
  return `${head}\n${known.length ? known.map((k) => `- ${k}`).join('\n') : none}\n\n${msg}\n<message>\n${String(text ?? '').slice(0, KEEP_CHARS)}\n</message>`
}

/** Absicht aus der Antwort; „einmalig“/„one-off“, ungültig oder leer: ''. Höchstens 60 Zeichen, eine Zeile. */
export function parseIntent(raw: string): string {
  const s = String(raw ?? '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return ''
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>
    const v = typeof o.absicht === 'string' ? o.absicht : typeof o.intent === 'string' ? o.intent : ''
    const one = v.replace(/\s+/g, ' ').trim()
    if (!one || /^(einmalig|one-off|none|keine?)\.?$/i.test(one) || one.length > 60) return ''
    return one
  } catch {
    return ''
  }
}

/** Gleiche Absicht wie `intent` aus anderen Sessions, nicht gesehen: wie `candidates`, nur über die Absicht statt die Wortmenge. */
export function intentGroup(list: readonly Recent[], r: Recent, seen: ReadonlySet<string> = new Set()): Recent[] | null {
  if (!r.intent) return null
  const key = r.intent.toLowerCase()
  const bySession = new Map<string, Recent>()
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i]!
    if (x.sid === r.sid || x.id === r.id || seen.has(x.id) || x.intent?.toLowerCase() !== key) continue
    if (!bySession.has(x.sid)) bySession.set(x.sid, x)
  }
  if (bySession.size < MIN_OTHERS || bySession.size + 1 < MIN_SESSIONS) return null
  return [r, ...[...bySession.values()].slice(0, GROUP_MAX - 1)]
}

// ---------- Haiku ----------

/** Anweisung an Haiku (`CHECK`-Modell): dieselbe wiederkehrende Anweisung? Dann Name und eigenständige Fassung als JSON. */
export function proposeSystem(lang: Lang): string {
  if (lang === 'de')
    return [
      'Du bist der Sidekick in Claude Code. Du bekommst einige Nachrichten, die ein Nutzer in verschiedenen Chats an seinen Coding-Assistenten geschickt hat. Sie sind oft diktiert und unterschiedlich formuliert.',
      'Prüfe, ob sie dieselbe wiederkehrende Anweisung geben: dieselbe Aufgabe, die man als festen Befehl immer wieder schicken kann. Ähnliches Thema oder ähnliche Wörter genügen nicht. Einmalige Aufträge zu einem bestimmten Fehler, einer bestimmten Datei oder einem bestimmten Projekt sind keine wiederkehrende Anweisung.',
      'Wenn ja, schreibe:',
      '- "name": ein englischer Befehlsname in kebab-case, 2 bis 3 Wörter, höchstens 24 Zeichen, nur a-z, 0-9 und -, z. B. "tidy-chats".',
      '- "text": die Anweisung als eigenständigen Prompt in der Sprache und im Ton des Nutzers (Du-Form an den Assistenten, wie er schreibt). Verallgemeinert: keine einmaligen Details der einzelnen Nachrichten (Namen einzelner Chats, Daten, Zahlen, Füllwörter des Diktats). Höchstens 1200 Zeichen. Nur die Anweisung, ohne Einleitung.',
      'Antworte nur mit JSON, ohne Text davor oder danach:',
      '{"same": true, "name": "…", "text": "…"} oder {"same": false}',
    ].join('\n')
  return [
    'You are the sidekick in Claude Code. You get a few messages a user sent to their coding assistant in different chats. They are often dictated and worded differently.',
    'Check whether they give the same recurring instruction: the same task that could be sent again and again as a fixed command. A similar topic or similar words are not enough. One-off requests about a specific bug, file or project are not a recurring instruction.',
    'If yes, write:',
    '- "name": an English command name in kebab-case, 2 to 3 words, at most 24 characters, only a-z, 0-9 and -, e.g. "tidy-chats".',
    '- "text": the instruction as a self-contained prompt in the user\'s language and tone (addressed to the assistant the way the user writes). Generalized: no one-off details of the single messages (names of single chats, dates, numbers, dictation filler). At most 1200 characters. Only the instruction, no preamble.',
    'Answer with JSON only, no text before or after:',
    '{"same": true, "name": "…", "text": "…"} or {"same": false}',
  ].join('\n')
}

export function proposePrompt(group: readonly Recent[], lang: Lang): string {
  const head = lang === 'de' ? 'Nachrichten (je aus einem anderen Chat):' : 'Messages (each from a different chat):'
  return [head, '', ...group.map((r, i) => `<message ${i + 1}>\n${r.text.slice(0, KEEP_CHARS)}\n</message ${i + 1}>`)].join('\n')
}

/**
 * Antwort von Haiku lesen. `same: false`, ungültiges JSON, fehlender oder ungültiger Name, leerer Text: null (kein Angebot).
 * Ein zu langer Text wird an einer Satz- oder Wortgrenze auf 1200 Zeichen gekürzt.
 */
export function parseProposal(raw: string): Proposal | null {
  const s = String(raw ?? '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  let o: unknown
  try {
    o = JSON.parse(s.slice(a, b + 1))
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  if (r.same !== true || typeof r.name !== 'string' || typeof r.text !== 'string') return null
  const name = normName(r.name).replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!name || name.length > NAME_MAX) return null
  let text = r.text.trim()
  if (!text) return null
  if (text.length > TEXT_MAX) {
    const cutAt = Math.max(text.lastIndexOf('. ', TEXT_MAX), text.lastIndexOf(' ', TEXT_MAX))
    text = `${text.slice(0, cutAt > TEXT_MAX / 2 ? cutAt + 1 : TEXT_MAX).trim()}`
  }
  return { name, text }
}
