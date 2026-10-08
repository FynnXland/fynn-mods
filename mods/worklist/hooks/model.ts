// worklist: Datenmodell ohne `$` (SPEC → Datenmodell). Die Warteschlange gehört zum Chat (`queue:<sessionId>`), der Verlauf
// zum Projekt (`history:<root>`, höchstens 300 Einträge). Erledigte To-dos stehen nur im Verlauf.
import { DONE_LINES, cleanLang } from './i18n.ts'
import type { Lang } from './i18n.ts'

// skipped: per „Überspringen“ ans Ende gelegt; die Seitenleiste zeigt die Marke, bis es wieder startet (0.4.0)
export type Todo = { id: string; text: string; status: 'open' | 'running'; createdAt: number; startedAt?: number; skipped?: boolean }
export type Queue = { items: Todo[]; paused: boolean }
export type HistoryEntry = { text: string; doneAt: number; durationMs: number; sessionId: string; result: string; how: 'auto' | 'manual' }
export type Cost = { usd: number; calls: number }
export type Settings = { haiku: boolean; doneLine: boolean; settleSeconds: number; maxAutoRun: number; lang: Lang }

const HISTORY_MAX = 300
const TODO_MAX = 2000 // Zeichen pro To-do; der Store hat 4 MiB für alles
export const QUEUE_MAX = 200

const DEFAULT_SETTINGS: Settings = { haiku: true, doneLine: true, settleSeconds: 3, maxAutoRun: 15, lang: 'en' }

const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d
}

/** userConfig-Werte prüfen (plugin.json → userConfig). */
export function cleanSettings(o: Readonly<Record<string, unknown>>): Settings {
  return {
    haiku: typeof o.haiku === 'boolean' ? o.haiku : DEFAULT_SETTINGS.haiku,
    doneLine: typeof o.doneLine === 'boolean' ? o.doneLine : DEFAULT_SETTINGS.doneLine,
    settleSeconds: clampNum(o.settleSeconds, 1, 30, DEFAULT_SETTINGS.settleSeconds),
    maxAutoRun: clampNum(o.maxAutoRun, 1, 100, DEFAULT_SETTINGS.maxAutoRun),
    lang: cleanLang(o.language),
  }
}

/** Gespeicherte Warteschlange lesen; Unlesbares fällt weg. */
export function cleanQueue(v: unknown): Queue {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const raw = Array.isArray(o.items) ? o.items : []
  const items: Todo[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const t = x as Record<string, unknown>
    if (typeof t.id !== 'string' || typeof t.text !== 'string' || !t.text.trim()) continue
    items.push({
      id: t.id,
      text: t.text,
      status: t.status === 'running' ? 'running' : 'open',
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
      ...(typeof t.startedAt === 'number' ? { startedAt: t.startedAt } : {}),
      ...(t.skipped === true ? { skipped: true } : {}),
    })
  }
  return { items: items.slice(0, QUEUE_MAX), paused: o.paused === true }
}

export function cleanHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return []
  const out: HistoryEntry[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const h = x as Record<string, unknown>
    if (typeof h.text !== 'string' || typeof h.doneAt !== 'number') continue
    out.push({
      text: h.text,
      doneAt: h.doneAt,
      durationMs: typeof h.durationMs === 'number' ? h.durationMs : 0,
      sessionId: typeof h.sessionId === 'string' ? h.sessionId : '',
      result: typeof h.result === 'string' ? h.result : '',
      how: h.how === 'manual' ? 'manual' : 'auto',
    })
  }
  return out.slice(0, HISTORY_MAX)
}

export function cleanCost(v: unknown): Cost {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return { usd: typeof o.usd === 'number' && Number.isFinite(o.usd) ? o.usd : 0, calls: typeof o.calls === 'number' ? o.calls : 0 }
}

/** Neuer Eintrag vorn, die ältesten fallen weg. */
export function pushHistory(list: readonly HistoryEntry[], e: HistoryEntry): HistoryEntry[] {
  return [e, ...list].slice(0, HISTORY_MAX)
}

export function running(q: Queue): Todo | undefined {
  return q.items.find((t) => t.status === 'running')
}

export function openItems(q: Queue): Todo[] {
  return q.items.filter((t) => t.status === 'open')
}

export function nextOpen(q: Queue): Todo | undefined {
  return q.items.find((t) => t.status === 'open')
}

export function add(q: Queue, t: Todo): Queue {
  return { ...q, items: [...q.items, t].slice(0, QUEUE_MAX) }
}

export function remove(q: Queue, id: string): Queue {
  return { ...q, items: q.items.filter((t) => t.id !== id) }
}

/** Status setzen; ein To-do, das wieder läuft, verliert die Marke „übersprungen“. */
export function setStatus(q: Queue, id: string, status: Todo['status'], startedAt?: number): Queue {
  return {
    ...q,
    items: q.items.map((t) => {
      if (t.id !== id) return t
      const { skipped, ...rest } = t
      return { ...rest, status, ...(startedAt !== undefined ? { startedAt } : {}), ...(skipped && status !== 'running' ? { skipped } : {}) }
    }),
  }
}

/** Ein offenes To-do unter den offenen um eins nach oben (-1) oder unten (+1); das laufende bleibt, wo es ist. */
export function move(q: Queue, id: string, by: -1 | 1): Queue {
  const open = q.items.filter((t) => t.status === 'open')
  const i = open.findIndex((t) => t.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= open.length) return q
  const swapped = [...open]
  const a = swapped[i]
  const b = swapped[j]
  if (!a || !b) return q
  swapped[i] = b
  swapped[j] = a
  let k = 0
  return { ...q, items: q.items.map((t) => (t.status === 'open' ? (swapped[k++] ?? t) : t)) }
}

/** Überspringen (Knopf, `/todos skip`): offen, ans Ende, mit der Marke `skipped`. */
export function skipToEnd(q: Queue, id: string): Queue {
  const t = q.items.find((x) => x.id === id)
  if (!t) return q
  return { ...q, items: [...q.items.filter((x) => x.id !== id), { id: t.id, text: t.text, status: 'open', createdAt: t.createdAt, skipped: true }] }
}

/** Dasselbe To-do offen ganz nach vorn (Fortsetzen nach STOPP, `/todos retry`); die Marke `skipped` fällt weg. */
export function toFront(q: Queue, id: string): Queue {
  const t = q.items.find((x) => x.id === id)
  if (!t) return q
  return { ...q, items: [{ id: t.id, text: t.text, status: 'open', createdAt: t.createdAt }, ...q.items.filter((x) => x.id !== id)] }
}

/** Laufendes zurück auf offen, an seinem Platz vorn (Stufen 1–2: STOPP). */
export function reopen(q: Queue, id: string): Queue {
  return {
    ...q,
    items: q.items.map((t) => (t.id === id ? { id: t.id, text: t.text, status: 'open', createdAt: t.createdAt, ...(t.skipped ? { skipped: true } : {}) } : t)),
  }
}

/** Erster Satz der Antwort, höchstens 120 Zeichen, ohne Markdown-Zierrat: die Kurz-Ergebniszeile im Verlauf (kostenlos). */
export function firstSentence(answer: string, max = 120): string {
  const plain = answer
    .replace(/(```|~~~)[\s\S]*?(\1|$)/g, ' ')
    // Listen-Marken am Zeilenanfang („1.“, „-“): sonst wäre das Kurz-Ergebnis nur „1.“
    .replace(/^\s*(\d+[.)]|[-*+•])\s+/gm, '')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return ''
  const m = plain.match(/^(.+?[.!?])(\s|$)/u)
  const s = (m?.[1] ?? plain).trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${sp > max * 0.6 ? cut.slice(0, sp) : cut}…`
}

/**
 * Anzeige ohne die Fertig-Marke: entfernt eine letzte Zeile, die nur „Fertig.“ oder „Done.“ ist (auch fett). Das ist die
 * Marke aus der Schlusszeile (je nach Sprache). Nie mitten in einem Satz; sonst unverändert.
 */
export function hideDoneMarker(text: string): string {
  const m = text.match(/^([\s\S]*?)(?:^|\n)\s*(\*\*|__)?(Fertig|Done)\.(\*\*|__)?\s*$/u)
  if (!m) return text
  return (m[1] ?? '').replace(/\s+$/u, '')
}

/** Alle Fassungen der Schlusszeile, auch frühere: ältere Zeilen im Chat sollen weiter erkannt werden. */
const ALL_DONE_LINES = [
  DONE_LINES.en,
  DONE_LINES.de,
  '(Arbeitsliste: Ist etwas unklar, stell am Ende eine klare Rückfrage. Sonst erledige die Aufgabe vollständig und schließe mit „Fertig.“)',
]

/** Bis 0.2.2 gesendet: `[To-do n/m] <Text>` plus Schlusszeile. Erkennt solche Texte in `turn.start` wieder (Fallback). */
export function isTodoPrompt(text: string): boolean {
  return /^\[To-do \d+\/\d+\] /.test(text)
}

// ---------- Gesendete To-dos (ab 0.3.0 ohne Rahmen) ----------

/**
 * Ein gesendetes To-do, pro Chat gemerkt: Daran erkennen `turn.start` und die Zeile im Chat den Text wieder, denn beim
 * Modell kommt ab 0.3.0 genau Fynns Text an, ohne Präfix. Statt des Texts nur eine Prüfsumme (Store 4 MiB).
 */
// c: eine Fortsetzung („Mach mit diesem To-do weiter …“) statt des To-do-Texts (0.4.0, Knopf „Fortsetzen“)
export type SentRec = { id: string; h: string; n: number; m: number; c?: boolean }

const SENT_MAX = 50

/** Prüfsumme eines gesendeten Texts (FNV-1a, 32 Bit, mit Länge); Leerraum am Rand zählt nicht. */
export function textHash(text: string): string {
  const s = text.trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(36)}.${s.length.toString(36)}`
}

export function cleanSent(v: unknown): SentRec[] {
  if (!Array.isArray(v)) return []
  const out: SentRec[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.h !== 'string' || typeof r.n !== 'number' || typeof r.m !== 'number') continue
    out.push({ id: r.id, h: r.h, n: r.n, m: r.m, ...(r.c === true ? { c: true } : {}) })
  }
  return out.slice(-SENT_MAX)
}

/** Neuer Eintrag hinten, die ältesten fallen weg. */
export function pushSent(list: readonly SentRec[], r: SentRec): SentRec[] {
  return [...list, r].slice(-SENT_MAX)
}

/** Der zuletzt gesendete Eintrag mit genau diesem Text. */
export function findSent(list: readonly SentRec[], text: string): SentRec | undefined {
  const h = textHash(text)
  for (let i = list.length - 1; i >= 0; i--) if (list[i]?.h === h) return list[i]
  return undefined
}

/** Ein To-do, das mit `/name` beginnt, ist ein Befehl: Name ohne Schrägstrich (auch `plugin:skill`), Rest als Argumente. */
export function parseCommand(text: string): { name: string; args: string } | null {
  const m = text.trim().match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/u)
  if (!m || !m[1]) return null
  return { name: m[1], args: (m[2] ?? '').trim() }
}

/**
 * Der Turn, den ein Skill-Befehl auslöst, beginnt mit `<command-name>/name</command-name>` (CLI 2.1.290, Prototyp). Liefert
 * den Befehl als `/name args`, sonst null.
 */
export function commandOfTurn(text: string): string | null {
  const name = text.match(/<command-name>\/?([^<\s]+)<\/command-name>/u)?.[1]
  if (!name) return null
  const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/u)?.[1] ?? '').trim()
  return `/${name}${args ? ` ${args}` : ''}`
}

/** Zerlegt einen bis 0.2.2 gesendeten To-do-Text für die Anzeige im Verlauf: Nummer, Gesamtzahl, To-do ohne Schlusszeile. */
export function parseSent(text: string): { n: number; m: number; text: string; withLine: boolean } | null {
  const m = text.trim().match(/^\[To-do (\d+)\/(\d+)\] ([\s\S]*)$/)
  if (!m) return null
  let body = (m[3] ?? '').trim()
  const line = ALL_DONE_LINES.find((l) => body.endsWith(l))
  const withLine = line !== undefined
  if (line) body = body.slice(0, body.length - line.length).trim()
  return body ? { n: Number(m[1]), m: Number(m[2]), text: body, withLine } : null
}

/** Einreihen: Leerzeichen zusammenfassen, Länge begrenzen. */
export function cleanText(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim().slice(0, TODO_MAX)
}

// ---------- Laufzustand (in $.state, überlebt einen Hot Reload) ----------

// unclear: Claudes letzte Antwort war nach den Regeln nicht eindeutig. fresh (0.4.0): nach Neustart, Resume oder Chatwechsel;
// gesendet wird erst nach einem sauberen Turn-Ende, nach „Start“ oder wenn Fynn einreiht
export type CheckState = 'idle' | 'waiting' | 'checking' | 'ask' | 'blocked' | 'unclear' | 'fresh'
export type PlanItem = { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }

export type Runtime = {
  sid: string
  busy: boolean
  turnSeq: number
  turn: { startedAt: number; todoId: string | null; text: string; fromFynn: boolean }
  state: CheckState
  stateReason: string
  // kind 'background': Hintergrundarbeit läuft länger als die Wartegrenze (0.4.0); 'cleared': To-do lief beim /clear (0.6.0, bleibt
  // über Fynns Nachricht hinweg stehen); sonst Rückfrage, STOPP oder Halt ohne To-do
  notice: { reason: string; todoId: string | null; kind?: 'background' | 'cleared' } | null
  autoRun: number
  strikes: { id: string; n: number }
  hold: boolean
  plan: PlanItem[]
  sessionDone: number
  expectOwn: string | null
  // Befehls-To-do gesendet (`$.command.run`): Name ohne Schrägstrich, bis sein Turn beginnt oder es ohne Turn abgehakt ist
  expectCmd: string | null
  // Gesendete To-dos dieses Chats (auch in `$.store` `sent:<sessionId>`, damit der Rahmen im Chat nach Resume bleibt)
  sent: SentRec[]
  lastResult: string // Kurz-Ergebnis (erster Satz) der letzten Antwort, nicht die ganze Antwort
  // Warten auf Hintergrundarbeit (0.4.0): Kurzform für die Statuszeile, Beginn der Wartephase, Hinweis schon gezeigt,
  // Aufgaben, auf die nach „Nicht mehr warten“ nicht mehr gewartet wird (IDs; 'cron' für geplante Weckaufträge)
  stateShort: string
  waitSince: number
  waitNoticed: boolean
  ignoreBg: string[]
  // Zeitpunkt des letzten Turn-Endes: Ein /todo kurz danach hat Fynn während dieses Turns getippt (Phase 0, Runde 3)
  turnEndAt: number
}

export function freshRuntime(sid: string): Runtime {
  return {
    sid,
    busy: false,
    turnSeq: 0,
    turn: { startedAt: 0, todoId: null, text: '', fromFynn: false },
    state: 'idle',
    stateReason: '',
    notice: null,
    autoRun: 0,
    strikes: { id: '', n: 0 },
    hold: false,
    plan: [],
    sessionDone: 0,
    expectOwn: null,
    expectCmd: null,
    sent: [],
    lastResult: '',
    stateShort: '',
    waitSince: 0,
    waitNoticed: false,
    ignoreBg: [],
    turnEndAt: 0,
  }
}
