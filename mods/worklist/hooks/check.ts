// worklist: die Prüfung „sicher frei“ ohne `$` (SPEC → Verhalten, Stufen 1–9). Die Stufen laufen der Reihe nach, die erste
// Entscheidung gilt. Im Zweifel wird nie gesendet: Alles, was keine Regel sicher als „fertig“ erkennt, geht an Haiku (Stufe 9)
// oder wird zu FRAGEN. Stufe 10 (Beruhigungszeit) braucht die Uhr und liegt in register.ts.
// Die Erkennung versteht immer Deutsch und Englisch, unabhängig von der Spracheinstellung; nur die Gründe folgen ihr.
import type { Strings } from './i18n.ts'
import type { PlanItem } from './model.ts'

export type Outcome = 'WEITER' | 'WARTEN' | 'FRAGEN' | 'STOPP'
// short: Kurzform bei WARTEN für die Statuszeile („2 Helfer“, „npm run dev“)
export type Decision = { outcome: Outcome; stage: number; reason: string; short?: string }

/** Hintergrundarbeit aus `classic.Stop` (types: StopHookInput.background_tasks, session_crons). */
export type BgTask = { id: string; type: string; status: string; description: string }
export type StopFacts = { background: readonly BgTask[]; crons: number }

/** Hintergrundarbeit, die Helfer sind (types: BackgroundTaskSummary.type): `$.agent.list()` sagt, ob sie noch laufen. */
export const AGENT_TASKS: readonly string[] = ['subagent', 'workflow']

/**
 * Stufe 3 ohne die Aufgaben, auf die nicht mehr gewartet wird (0.4.0): Helfer, wenn `$.agent.list()` keinen beschäftigten
 * mehr kennt (`agentsIdle`), und Aufgaben, die Fynn per „Nicht mehr warten“ ausgenommen hat (`ignore`, IDs; 'cron').
 */
export function filterStop(stop: StopFacts | null, agentsIdle: boolean, ignore: readonly string[]): StopFacts | null {
  if (!stop) return null
  const background = stop.background.filter((t) => !(agentsIdle && AGENT_TASKS.includes(t.type)) && !ignore.includes(t.id))
  return { background, crons: ignore.includes('cron') ? 0 : stop.crons }
}

/** Andere Hintergrundarbeit als Helfer (Shells, Monitore, Weckaufträge): Für sie gilt die Wartegrenze (0.4.0). */
export function otherBackground(stop: StopFacts | null): { tasks: BgTask[]; crons: number } {
  if (!stop) return { tasks: [], crons: 0 }
  return { tasks: stop.background.filter((t) => !AGENT_TASKS.includes(t.type)), crons: stop.crons }
}

export type Facts = {
  reason: 'answer' | 'aborted' | 'error' | 'refusal'
  stopFailure: boolean
  stop: StopFacts | null // null: kein classic.Stop zu diesem Turn (bei einem Abbruch feuert keins)
  busyAgents: readonly string[] // Agenten mit pending/running/waiting (Stufe 4)
  plan: readonly PlanItem[]
  answer: string
  lastToolError: boolean
}

/** Agenten-Status, der als „läuft noch“ gilt (types: AgentStatus). */
export const BUSY_STATUS: readonly string[] = ['pending', 'running', 'waiting']

// ---------- Text-Hilfen ----------

/** Entfernt Code: Blöcke in ``` bzw. ~~~ (auch ein offener am Ende) und Inline-Code. Ein „?“ in Code ist keine Rückfrage. */
function stripCode(text: string): string {
  return text.replace(/(```|~~~)[\s\S]*?(\1|$)/g, '\n').replace(/`[^`\n]*`/g, ' ')
}

/** Absätze ohne Code, leere entfernt. */
function paragraphs(text: string): string[] {
  return stripCode(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function lastParagraph(text: string): string {
  const ps = paragraphs(text)
  return ps[ps.length - 1] ?? ''
}

/** Die letzten beiden Absätze ohne Code (Stufen 6 und 7): Schlussfolgerungen stehen oft vor einer Abschlusszeile. */
function tail(text: string): string {
  return paragraphs(text).slice(-2).join('\n\n')
}

/** Markdown-Zierrat am Ende (`**`, `_`, Anführungszeichen, Klammern), damit „…?**“ und „Fertig.**“ erkannt werden. */
function trimEnd(s: string): string {
  return s.replace(/[\s*_~"'»«“”„)\]]+$/u, '')
}

/** Letzter Satz eines Absatzes, ohne Markdown-Zierrat am Anfang (`**`, `-`, `>`). */
function lastSentence(paragraph: string): string {
  const parts = paragraph
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((x) => x.replace(/^[\s*_>#-]+/u, '').trim())
    .filter((x) => x.length > 0)
  return parts[parts.length - 1] ?? ''
}

/** Ein Absatz, der nur die Fertig-Marke ist („Fertig.“, „**Done.**“). */
function isMarkerOnly(paragraph: string): boolean {
  return /^(fertig|erledigt|done)[.!]?$/iu.test(trimEnd(paragraph.replace(/^[\s*_>#-]+/u, '')))
}

// ---------- Stufe 6: Rückfrage ----------

const QUESTION_PHRASES = [
  'soll ich',
  'sollen wir',
  'möchtest du',
  'willst du',
  'bitte bestätige',
  'welche variante',
  'ich brauche',
  'shall i',
  'should i',
  'do you want',
  'would you like',
]

/** Nummerierte oder benannte Optionen: mindestens zwei Zeilen `1.`/`1)`/`- Option A` bzw. `**A**`. */
function hasOptions(text: string): boolean {
  const opts = text.split('\n').filter((l) => /^\s*(\d+[.)]|[-*]\s+(\*\*)?(option|variante)\b|[-*]?\s*\*\*[A-D][.):]?\*\*)/i.test(l))
  return opts.length >= 2
}

/** Rückfrage im letzten Absatz (ohne Code). Eine Frage mitten im Text zählt nicht; ein alleinstehendes „Fertig.“ danach verdeckt sie nicht. */
export function isQuestion(answer: string): boolean {
  const ps = paragraphs(answer)
  while (ps.length > 1 && isMarkerOnly(ps[ps.length - 1] ?? '')) ps.pop()
  const last = ps[ps.length - 1] ?? ''
  if (!last) return false
  if (trimEnd(last).endsWith('?')) return true
  const low = last.toLowerCase()
  if (QUESTION_PHRASES.some((p) => low.includes(p))) return true
  const end = tail(answer)
  return hasOptions(end) && end.includes('?')
}

// ---------- Stufe 7: Problem ----------

const PROBLEM_PHRASES = [
  'konnte nicht',
  'konnte ich nicht',
  'fehlgeschlagen',
  'schlägt fehl',
  'schlug fehl',
  'blockiert',
  'failed',
  "couldn't",
  'could not',
  'unable to',
]

/** Problem im Schluss der Antwort, Tool-Fehler zuletzt oder leere Antwort. */
export function isProblem(answer: string, lastToolError: boolean): boolean {
  if (lastToolError) return true
  if (stripCode(answer).trim() === '') return true
  const low = tail(answer).toLowerCase()
  if (PROBLEM_PHRASES.some((p) => low.includes(p))) return true
  // „konnte die Datei nicht finden“, „die Tests schlagen noch fehl“: Wörter dazwischen erlaubt
  return (
    /(^|[^\p{L}])konnte\s+(\p{L}+\s+){0,4}nicht([^\p{L}]|$)/u.test(low) ||
    /(^|[^\p{L}])(schlagen|schlägt|schlug|schlugen)\s+(\p{L}+\s+){0,4}fehl([^\p{L}]|$)/u.test(low)
  )
}

// ---------- Stufe 8: fertig ----------

/**
 * Nur wenn der **letzte Satz** selbst die Fertig-Marke ist: „Fertig.“ bzw. „Done.“ (Schlusszeile), „Erledigt.“,
 * „Alles erledigt.“, „Done, all tests pass.“. Ein „erledigt“ mitten im Satz und eine Einschränkung hinter der Marke
 * („Fertig, bis auf den Export.“, „Done, except …“) gehen an Stufe 9.
 */
export function isDone(answer: string): boolean {
  const last = trimEnd(lastSentence(lastParagraph(answer))).toLowerCase()
  if (!last) return false
  if (!(/^(alles\s+|all\s+)?(fertig|erledigt|done)([.!:,;]|\s*$)/u.test(last) || /^all set([.!,]|$)/u.test(last))) return false
  return !/(^|[^\p{L}])(bis auf|außer|aber|noch|fehlt|fehlen|offen|except|but|still|yet|remaining|todo)([^\p{L}]|$)/u.test(last)
}

// ---------- Die Stufen ----------

/**
 * Stufen 1–8. Liefert `null`, wenn keine Regel entscheidet: dann Stufe 9 (Haiku) bzw. FRAGEN.
 * Wirft nie; ein Fehler beim Aufrufer führt dort zu FRAGEN.
 */
export function decideRules(f: Facts, tx: Strings): Decision | null {
  if (f.reason === 'aborted') return { outcome: 'STOPP', stage: 1, reason: tx.aborted }
  if (f.reason === 'error' || f.reason === 'refusal' || f.stopFailure) {
    return { outcome: 'STOPP', stage: 2, reason: f.reason === 'refusal' ? tx.refused : tx.turnError }
  }
  if (f.stop && (f.stop.background.length > 0 || f.stop.crons > 0)) {
    return { outcome: 'WARTEN', stage: 3, reason: waitingText(f.stop, tx), short: waitingShort(f.stop, tx) }
  }
  if (f.busyAgents.length > 0) return { outcome: 'WARTEN', stage: 4, reason: tx.waitingHelpers(f.busyAgents), short: tx.helpers(f.busyAgents.length) }
  if (f.plan.length > 0) {
    const done = f.plan.filter((s) => s.status === 'completed').length
    if (done < f.plan.length) return { outcome: 'FRAGEN', stage: 5, reason: tx.planOpen(done, f.plan.length) }
  }
  if (isQuestion(f.answer)) return { outcome: 'FRAGEN', stage: 6, reason: tx.question }
  if (isProblem(f.answer, f.lastToolError)) return { outcome: 'FRAGEN', stage: 7, reason: tx.problem }
  // Nur mit classic.Stop zu diesem Turn: ohne ihn ist Stufe 3 (Hintergrundarbeit) ungeprüft, dann entscheidet Stufe 9
  if (f.stop && isDone(f.answer)) return { outcome: 'WEITER', stage: 8, reason: tx.done }
  return null
}

/** Anzeige bei WARTEN (Stufe 3). */
function waitingText(stop: StopFacts, tx: Strings): string {
  const parts: string[] = []
  if (stop.background.length > 0) {
    const kinds = [...new Set(stop.background.map((t) => t.type || tx.task))].join(', ')
    parts.push(tx.tasks(stop.background.length, kinds))
  }
  if (stop.crons > 0) parts.push(tx.crons(stop.crons))
  return tx.waitingBackground(parts.join(', '))
}

/** Kurzform für die Statuszeile: Helfer als Anzahl, sonst die erste Beschreibung (bzw. die Weckaufträge). */
function waitingShort(stop: StopFacts, tx: Strings): string {
  const agents = stop.background.filter((t) => AGENT_TASKS.includes(t.type)).length
  const other = stop.background.filter((t) => !AGENT_TASKS.includes(t.type))
  const parts: string[] = []
  if (agents > 0) parts.push(tx.helpers(agents))
  if (other.length > 0) parts.push(other.length === 1 ? (other[0]?.description || other[0]?.type || tx.task) : tx.tasks(other.length, [...new Set(other.map((t) => t.type))].join(', ')))
  if (stop.crons > 0) parts.push(tx.crons(stop.crons))
  return parts.join(', ')
}

// ---------- Stufe 9: Haiku ----------

const HAIKU_MIN_CONFIDENCE = 0.85
const HAIKU_TAIL = 1500

/** System-Prompt (englisch); nur die kurze Begründung kommt in der eingestellten Sprache. */
export function haikuSystem(tx: Strings): string {
  return [
    'You check whether an AI coding assistant has finished a task from a to-do list.',
    "You get the task, the end of the assistant's last answer and a few facts.",
    'Classify: "done" (the task is completed, nothing is asked of the user), "question" (the assistant asks the user something or waits for a decision),',
    '"blocked" (something failed or could not be done), "unsure" (you cannot tell).',
    'When in doubt, do not answer "done".',
    `Reply with JSON only: {"verdict": "done|question|blocked|unsure", "confidence": 0..1, "why": "<at most 12 words, in ${tx.haikuLanguage}>"}`,
  ].join(' ')
}

export function haikuPrompt(todo: string, answer: string, facts: { filesChanged: boolean; toolError: boolean }): string {
  const end = answer.length > HAIKU_TAIL ? `…${answer.slice(-HAIKU_TAIL)}` : answer
  return [
    `Task: ${todo || '(a chat message, no to-do)'}`,
    `Files changed in this task: ${facts.filesChanged ? 'yes' : 'no'}`,
    `A tool failed: ${facts.toolError ? 'yes' : 'no'}`,
    'End of the last answer:',
    '"""',
    end,
    '"""',
  ].join('\n')
}

export type HaikuVerdict = { verdict: 'done' | 'question' | 'blocked' | 'unsure'; confidence: number; why: string }

/** Liest Haikus JSON (auch in Code-Zäunen oder mit Text drumherum). Alles Ungültige: null. */
export function parseHaiku(text: string): HaikuVerdict | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  let o: unknown
  try {
    o = JSON.parse(m[0])
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  const verdict = r.verdict
  if (verdict !== 'done' && verdict !== 'question' && verdict !== 'blocked' && verdict !== 'unsure') return null
  const confidence = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
  const why = typeof r.why === 'string' ? r.why.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  return { verdict, confidence, why }
}

/** Nur `done` mit genug Konfidenz ist WEITER, alles andere FRAGEN. */
export function decideHaiku(v: HaikuVerdict | null, tx: Strings): Decision {
  if (!v) return { outcome: 'FRAGEN', stage: 9, reason: tx.haikuNoResult }
  if (v.verdict === 'done' && v.confidence >= HAIKU_MIN_CONFIDENCE) return { outcome: 'WEITER', stage: 9, reason: tx.haikuDone(v.why) }
  const label = v.verdict === 'question' ? tx.haikuQuestion : v.verdict === 'blocked' ? tx.haikuBlocked : tx.haikuUnsure
  return { outcome: 'FRAGEN', stage: 9, reason: `${label}${v.why ? ` Haiku: ${v.why}` : ''}` }
}

/**
 * Stufe 9 auf Haiku 5.5 (SPEC Nachtrag 0.5.0). Feste ID statt Alias: Haiku 5.5 denkt, das zählt gegen `maxTokens`; stellte ein
 * Update den Alias `haiku` um, reichten die alten 120 Tokens nicht mehr (kein Urteil → stilles FRAGEN). CC 2.1.291 kennt die ID
 * noch nicht (Warnung `unrecognized_model`), ruft sie aber auf, und `effort` kommt an.
 * Probe 2026-10-07 (CLI 2.1.291, 12 Fälle × 2, Texte de):
 * - high: 24/24 richtig (halb erledigte nie WEITER), JSON 24/24; Ausgabe 57–439 Tokens (Ø 114); Dauer Ø 1,2 s, max 2,5 s;
 *   Ø 0,009 ct je Prüfung
 * - medium: 24/24, Ø 74 Tokens, max 1,8 s · Haiku 4.5 (Alias, 120 Tokens): 24/24, Ø 51 Tokens, Ø 0,05 ct
 * timeoutMs: höchste Dauer × 2 = 4,9 s, Untergrenze 10 s.
 */
export const HAIKU = { model: 'claude-haiku-5-5', effort: 'high', maxTokens: 1500, timeoutMs: 10_000 } as const

/** US-Dollar je Million Tokens, Stand 2026-10-07 (wie mods/sidekick/hooks/cache.ts nach dessen Nachtrag 0.11.0). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

/** Kosten eines Aufrufs mit den Preisen des Modells (Standard: das Modell von Stufe 9). */
export function haikuCost(
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
  model: string = HAIKU.model,
): number {
  const p = PRICES[model] ?? PRICES['claude-haiku-4-5'] ?? { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }
  return ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6
}
