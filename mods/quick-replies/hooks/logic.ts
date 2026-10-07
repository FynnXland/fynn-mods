// quick-replies: reine Logik (ohne `$`): Bereinigen, Zusammenführen auf höchstens 4 Plätze, Fork-Frage und -Antwort.
// Die Idee, die Session zu forken und nach den nächsten Nachrichten zu fragen, stammt vom Community-Plugin next-steps
// (anthropics/claude-plugins-community). Umsetzung, Frage und Bereinigung sind eigene; aus dem Plugin ist kein Code übernommen.

import type { Lang } from './i18n.ts'
import { T } from './i18n.ts'

export type Source = 'engine' | 'fork'
export type Reply = { text: string; source: Source }

const SLOTS = 4
/** Vorschläge aus dem Fork. Kommt einer von der Engine, steht er vorn und der letzte aus dem Fork fällt weg (merge). */
const FORK_MAX = 4
/** Längster Fork-Vorschlag. Längere werden verworfen, nicht gekürzt: Der Knopf zeigt höchstens so viel (view.ts MAX_LABEL), und
 *  gesendet werden darf nur, was auf dem Knopf steht. */
const FORK_TEXT_MAX = 40
/** Kürzere Antworten lohnen keinen Fork. */
export const MIN_ANSWER = 40
/** Längster Vorschlag von Claude Code; er steht ohnehin vollständig grau im Prompt (types@2.1.289:3996-4002). */
const TEXT_MAX = 300

// Modell-Ausgabe kann fremden Text aus dem Chat nachplappern (Dateien, Tool-Ergebnisse, Webseiten). Bevor sie gezeigt oder gesendet
// wird: Terminal-Steuersequenzen weg, alles Unsichtbare weg (Steuer-, Format-, private und nicht belegte Zeichen sowie alles, was
// Unicode als „standardmäßig ignorierbar“ führt), Leerraum falten, Häufungen von Kombinationszeichen kappen. Text mit Unicode-Tag-
// Zeichen (U+E0000 bis U+E007F) wird ganz verworfen; sie dienen in einem Prompt nur zum Verstecken.
const ANSI = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-_])/g
const TAGS = /[\u{E0000}-\u{E007F}]/u
const INVISIBLE = /[\p{C}\p{Default_Ignorable_Code_Point}]/gu
const MARK_PILES = /\p{M}{4,}/gu

export function clean(text: string, max = TEXT_MAX): string {
  if (TAGS.test(text)) return ''
  const visible = text
    .replace(ANSI, '')
    .replace(/\s+/g, ' ')
    .replace(INVISIBLE, '')
    .replace(MARK_PILES, (pile) => [...pile].slice(0, 3).join(''))
    .replace(/ +/g, ' ')
    .trim()
  const chars = [...visible]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : visible
}

/** Schlüssel für „doppelt“: ohne Groß-/Kleinschreibung, Satzzeichen und Leerraum. */
export function keyOf(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Die Nummer eines Platzes, wenn der Text nur aus einer Ziffer `1`–`4` besteht, auch mehrfach dieselbe: eine gehaltene Taste
 *  wiederholt sie, und der Editor fasst solche Tasten zu einer Eingabe zusammen (types@2.1.291:8228-8233). Sonst 0. */
export function heldDigit(text: string): number {
  const m = /^([1-4])\1*$/.exec(text)
  return m ? Number(m[1]) : 0
}

/** Höchstens 4 Plätze: zuerst der Vorschlag der Engine, dann die aus dem Fork, die nachrücken; Doppelte fliegen raus.
 *  Ohne Quellen: leer. */
export function merge(engine: string, fork: readonly string[]): Reply[] {
  const out: Reply[] = []
  const seen = new Set<string>()
  const add = (text: string, source: Source) => {
    const t = clean(text)
    const k = keyOf(t)
    if (!t || !k || seen.has(k) || out.length >= SLOTS) return
    seen.add(k)
    out.push({ text: t, source })
  }
  add(engine, 'engine')
  for (const f of fork.slice(0, FORK_MAX)) add(f, 'fork')
  return out
}

/** Die Frage an den Fork der Session: Er kennt den ganzen Chat, soll aber nicht weitermachen. Die Frage ist englisch, die
 *  Vorschläge kommen in der eingestellten Sprache. Eine Nachricht, die mit `/` beginnt, führt Claude Code als Befehl aus; nur
 *  gewollte Aufrufe dürfen so beginnen, sonst steht der Befehl in typografischen Anführungszeichen (kein Escaping im JSON). */
export function forkPrompt(lang: Lang): string {
  const [open, close] = T[lang].forkQuotes
  return [
    'Do not continue the task. Instead, predict what the user is most likely to write to you next:',
    `up to ${FORK_MAX} concrete messages in the user's voice, written in ${T[lang].forkLanguage}, terse like a developer giving`,
    `instructions, each at most ${FORK_TEXT_MAX} characters and specific to this chat (name the file, test or next step).`,
    'Prefer the obvious next step (run the tests, commit, fix what was reported) over generic sentences.',
    'A message that starts with "/" is executed as a slash command when sent. Start a message with "/" only if it is exactly',
    'the command the user wants to run (/<command> <args>), and only name commands that appear in this chat. Whenever a',
    `message only mentions or asks about a command, wrap the command in ${open}${close}, even at the start (${open}/<command>${close} fails).`,
    'If the chat is clearly finished or nothing useful comes to mind, return an empty list.',
    'Reply ONLY with a JSON array of strings, without any text around it and without a code block.',
  ].join(' ')
}

/** Fork-Antwort → bis zu 4 Vorschläge; nicht auswertbar → []. Nimmt Strings oder Objekte mit `prompt`; zu lange fliegen raus. */
export function parseFork(reply: string): string[] {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let data: unknown
  try {
    data = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: string[] = []
  for (const entry of data) {
    const raw = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? (entry as { prompt?: unknown }).prompt : undefined
    if (typeof raw !== 'string') continue
    // Zu lang: verwerfen statt kürzen, damit nie mehr gesendet wird, als auf dem Knopf steht
    const t = clean(raw, Number.MAX_SAFE_INTEGER)
    if (t && [...t].length <= FORK_TEXT_MAX) out.push(t)
    if (out.length === FORK_MAX) break
  }
  return out
}
