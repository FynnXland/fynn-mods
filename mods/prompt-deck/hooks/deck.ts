// deck.ts: reine Logik von prompt-deck ohne `$` (SPEC „Verhalten“). Übernommen „so wie sie sind“ aus sidekick 0.28.1
// (hooks/prompts.ts, Teil „gespeicherte Prompts“, und hooks/buttons.ts); die Erkennung wiederholter Prompts bleibt in sidekick (E6).
// register.ts liest und schreibt den Store und zeichnet.
import { lang, t } from './i18n.js'
import type { Lang } from './i18n.js'

/** Ein gespeicherter Prompt (`$.store` `saved`), Form wie sidekick `prompts:saved` (prompts.ts:8). */
export type Saved = { name: string; text: string; button: boolean; at: number; from: 'auto' | 'manual' }

export const SAVED_MAX = 12
export const BUTTONS_MAX = 4
export const NAME_MAX = 24
export const LABEL_MAX = 14
/** Höchstlänge eines gespeicherten Texts (sidekick: `TEXT_MAX * 4`, register.ts savePrompt). */
export const SAVE_MAX = 4800
/**
 * Gesendet wird mit dem festen Befehl `/p <name>` (sidekick Bau 0.21.0): Ein Hook ohne Filter oder mit Muster stellte die
 * Ausgabe aller anderen Plugin-Befehle unter den Namen der Mod; nur ein fester Name vermeidet das.
 */
export const P_CMD = 'p'
export const DECK_CMD = 'deck'
/** So steht ein Prompt in Texten: `p tidy-chats` (mit `/` davor). */
export const PREFIX = `${P_CMD} `
export const cmdOf = (name: string) => `${PREFIX}${name}`
/** Das einzige Plugin, dessen `save` prompt-deck annimmt (SPEC Verhalten 5). */
export const SIDEKICK = 'sidekick'
const NAME_RE = /^[a-z0-9-]{1,24}$/

/** Wortmenge: klein geschrieben, ohne Satzzeichen, ohne Wörter unter 3 Buchstaben, jedes Wort einmal, sortiert (sidekick prompts.ts:60). */
export function wordSet(text: string): string[] {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 3)
  return [...new Set(words)].sort()
}

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

/** Ergebnis von `upsert`: neu, überschrieben oder voll (13. Prompt). */
export type Upsert = { list: Saved[]; kind: 'new' | 'replaced' } | { list: Saved[]; kind: 'full' }

/** Einen Prompt anlegen oder einen eigenen gleichen Namens überschreiben (Knopf-Einstellung bleibt); beim 13. nichts. */
export function upsert(list: readonly Saved[], s: Saved): Upsert {
  const i = list.findIndex((x) => x.name === s.name)
  if (i >= 0) {
    const next = [...list]
    next[i] = { ...s, button: list[i]!.button, at: list[i]!.at }
    return { list: next, kind: 'replaced' }
  }
  if (list.length >= SAVED_MAX) return { list: [...list], kind: 'full' }
  return { list: [...list, s], kind: 'new' }
}

/** Knöpfe: höchstens 4, in der Reihenfolge des Speicherns. */
export function buttonNames(list: readonly Saved[]): string[] {
  return list
    .filter((s) => s.button)
    .slice(0, BUTTONS_MAX)
    .map((s) => s.name)
}

/** Beschriftung eines Knopfs: Name ohne Schrägstrich, höchstens 14 Zeichen. */
export const buttonLabel = (name: string) => (name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1)}…` : name)

/** Anfang des Texts in einer Zeile, für Tabelle und Detail. */
export function preview(text: string, n = 80): string {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** Name aus einer Eingabe: klein, Leerzeichen und `_` zu `-`, ohne führenden Schrägstrich und ohne `p `. */
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

/** Darf `name` ein gespeicherter Prompt heißen? Erlaubt, wenn `overwrite` (eigenes Speichern überschreibt), sonst ein freier Vorschlag. */
export function checkName(raw: string, ownSaved: readonly string[], overwrite: boolean): NameCheck {
  const name = normName(raw)
  const busy = new Set<string>(ownSaved)
  if (!NAME_RE.test(name) || /^-|-$/.test(name)) return { ok: false, name, why: 'invalid', suggest: freeName(name || 'prompt', busy) }
  if (ownSaved.includes(name) && !overwrite) return { ok: false, name, why: 'own', suggest: freeName(name, busy) }
  return { ok: true, name }
}

/** Hinweis hinter `/p` im Menü: die gespeicherten Namen, höchstens 80 Zeichen; ohne Prompts `<name>`. */
export function pHint(list: readonly Saved[]): string {
  if (!list.length) return '<name>'
  let out = ''
  for (const s of list) {
    const next = out ? `${out}|${s.name}` : s.name
    if (next.length > 76) return `<${out}|…>`
    out = next
  }
  return `<${out}>`
}

// ---------- letzte eigene Nachricht (sidekick register.ts lastOwnText, queue.ts) ----------

/** Vorspann der Desktop-App vorn entfernen (`<system-reminder>`-Blöcke, sidekick Bau 0.24.0 P1). */
export function stripLeadReminders(text: string): string {
  let s = String(text ?? '')
  for (let i = 0; i < 20; i++) {
    const m = /^\s*<system-reminder>[\s\S]*?<\/system-reminder>/.exec(s)
    if (!m) break
    s = s.slice(m[0].length)
  }
  return s.replace(/^\s+/, '')
}

/** Meldung des Hosts am Anfang (`[Cross-session idle notice]`, `<tag …>`): keine eigene Nachricht. */
const HOST_NOTICE = /^(\[[^\]\n]{0,60}\b(cross-session|notice|notification|message|reminder)\b[^\]\n]{0,60}\]|<[a-z][\w-]*[\s>])/i
export const isHostNote = (text: string) => {
  const s = String(text ?? '').trim()
  return /^<[a-z][\w-]*>/i.test(s) || HOST_NOTICE.test(s)
}

/** Letzte eigene Nachricht dieses Chats, ohne Befehle und Host-Texte; leer, wenn es keine gibt. */
export function lastOwnText(msgs: readonly { role: string; text?: string }[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!
    const text = typeof m.text === 'string' ? stripLeadReminders(m.text).trim() : ''
    if (m.role !== 'user' || !text || isHostNote(text) || text.startsWith('/') || text.startsWith('<command-')) continue
    return text
  }
  return ''
}

// ---------- `/deck save` ----------

/** Was `save …` will. `off`: ohne Knopf; `manual`: als selbst gespeichert merken (Umzug aus sidekick). */
export type SaveArgs = { name: string; text: string; off: boolean; manual: boolean }

/**
 * `save [--off] [--manual] <name> [text]`. Schalter stehen vor dem Namen, damit ein Text, der selbst `--off` enthält, unverändert
 * bleibt. Der Text nach dem Namen bleibt wie geschrieben (Zeilenumbrüche, Einrückung; P1: kommt über `$.command.run` unverändert an,
 * nur Leerraum am Ende fällt weg).
 */
export function saveArgs(rest: string): SaveArgs {
  let s = String(rest ?? '').replace(/^\s+/, '')
  let off = false
  let manual = false
  for (;;) {
    const m = /^(--off|--manual)(\s+|$)/.exec(s)
    if (!m) break
    if (m[1] === '--off') off = true
    else manual = true
    s = s.slice(m[0].length)
  }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(s)
  return { name: m?.[1] ?? '', text: (m?.[2] ?? '').trim(), off, manual }
}

// ---------- Absprache mit sidekick (`$.state`, SPEC „Absprachen“) ----------

/** `prompt-deck.saved`: Namen und Wortmengen, kein voller Text. */
export function savedState(list: readonly Saved[]): { items: { name: string; words: string[] }[] } {
  return { items: list.map((s) => ({ name: s.name, words: wordSet(s.text) })) }
}

// ---------- Knopfarten (sidekick hooks/buttons.ts) ----------

/** Was Zustand und Sichtbarkeit brauchen: die userConfig-Werte, sidekicks Status und die gespeicherten Prompts. */
export type ButtonFacts = {
  cfg: Readonly<Record<string, unknown>>
  /** `sidekick.status`, wie zuletzt gelesen; undefined: sidekick fehlt oder schrieb noch nichts. */
  sidekick: { level?: string; later?: boolean; laterUsed?: number } | null | undefined
  saved: readonly Saved[]
}

/** Eine Knopfart über dem Eingabefeld. `field`: boolean in userConfig, Standard an. `state`: Zustandstext, wenn der Schalter an ist. */
export type ButtonKind = { id: string; field: string; title: Readonly<Record<Lang, string>>; state: (f: ButtonFacts) => string }

/** Ein Schalter ist an, solange er nicht ausdrücklich false ist. */
export const switchOn = (f: ButtonFacts, field: string) => f.cfg[field] !== false

export const BUTTON_KINDS: readonly ButtonKind[] = [
  {
    // sidekick Ausbau 0.24.0: nur während eines Zugs; ob er gilt, sagt sidekick über `sidekick.status.later` (SPEC „Absprachen“)
    id: 'later',
    field: 'laterButton',
    title: { en: 'Later', de: 'Danach' },
    state: (f) => {
      const x = t().bt
      if (!f.sidekick) return x.laterNoSidekick
      if (f.sidekick.level !== 'guide') return x.laterNotGuide
      return x.laterOn
    },
  },
  {
    id: 'prompts',
    field: 'promptButtons',
    title: { en: 'Prompt buttons', de: 'Prompt-Knöpfe' },
    state: (f) => t().bt.promptsOn(buttonNames(f.saved).length, BUTTONS_MAX),
  },
]

/** Titel einer Knopfart in der eingestellten Sprache. */
export const kindTitle = (k: ButtonKind) => k.title[lang()]

/** Die Prompt-Knöpfe nach dem Schalter: keine bei `promptButtons` aus, sonst die ersten 4 mit `button`. */
export function shownPrompts(f: ButtonFacts): string[] {
  if (!switchOn(f, 'promptButtons')) return []
  return buttonNames(f.saved)
}

/** Darf „Danach“ jetzt stehen: sidekick meldet `later` (Zug läuft, Begleiter, `queue` an) und `laterButton` ist an. */
export function laterAllowed(f: ButtonFacts): boolean {
  return f.sidekick?.later === true && switchOn(f, 'laterButton')
}

/** Eine Zeile von `/deck buttons`. `on`: der Schalter dieser Zeile; bei Prompts ist `id` der Name. */
export type ButtonRow = { id: string; kind: 'switch' | 'prompt'; title: string; on: boolean; state: string }

/** Alle Zeilen: oben die Knopfarten, darunter jeder gespeicherte Prompt in der Reihenfolge des Speicherns. */
export function buttonRows(f: ButtonFacts): ButtonRow[] {
  const x = t().bt
  const kinds: ButtonRow[] = BUTTON_KINDS.map((k) => {
    const on = switchOn(f, k.field)
    return { id: k.id, kind: 'switch', title: kindTitle(k), on, state: on ? k.state(f) : x.off }
  })
  const promptsOn = switchOn(f, 'promptButtons')
  const shown = new Set(buttonNames(f.saved))
  const prompts: ButtonRow[] = f.saved.map((s) => {
    const state = !s.button ? x.off : !promptsOn ? x.hiddenAll : shown.has(s.name) ? x.visible : x.hiddenFull(BUTTONS_MAX)
    return { id: s.name, kind: 'prompt', title: `/${PREFIX}${s.name}`, on: s.button, state }
  })
  return [...kinds, ...prompts]
}

/** Was `/deck buttons …` will: die Liste, einen Schalter umlegen oder die Kurzhilfe. */
export type ButtonsArg = { kind: 'list' } | { kind: 'set'; target: string; on: boolean } | { kind: 'usage' }

export function buttonsArg(rest: string): ButtonsArg {
  const words = rest.trim().split(/\s+/).filter(Boolean)
  if (!words.length || (words.length === 1 && words[0]!.toLowerCase() === 'status')) return { kind: 'list' }
  const sw = (words[words.length - 1] ?? '').toLowerCase()
  if (words.length === 2 && (sw === 'on' || sw === 'off')) return { kind: 'set', target: words[0]!, on: sw === 'on' }
  return { kind: 'usage' }
}

/** Ziel eines Textbefehls: eine Knopfart (Vorrang) oder ein gespeicherter Prompt; sonst null. */
export function buttonTarget(raw: string, saved: readonly Saved[]): { kind: 'switch'; k: ButtonKind } | { kind: 'prompt'; name: string } | null {
  const id = raw.trim().toLowerCase()
  const k = BUTTON_KINDS.find((y) => y.id === id)
  if (k) return { kind: 'switch', k }
  const name = normName(raw)
  return saved.some((s) => s.name === name) ? { kind: 'prompt', name } : null
}

/** Eine Zelle einer Markdown-Tabelle: ohne `|` und Zeilenumbrüche (sidekick Fix 0.18.1). */
export const mdCell = (s: string) => s.replace(/\|/g, '¦').replace(/\s*\n\s*/g, ' ')

/** Markdown von `/deck buttons` (auch die Fassung für `-p` und VS Code): Tabelle, Hinweis ohne Prompts, Textbefehle. */
export function buttonsMarkdown(f: ButtonFacts, tag: string): string {
  const x = t().bt
  const rows = buttonRows(f).map((r) => `| ${r.kind === 'prompt' ? `\`${r.title}\`` : r.title} | ${r.on ? x.on : x.off} | ${mdCell(r.state)} |`)
  return [`${x.head}${tag ? ` · ${tag}` : ''}`, '', x.cols, '|---|---|---|', ...rows, ...(f.saved.length ? [] : ['', x.noPrompts]), '', x.foot].join('\n')
}

/** Markdown von `/deck list`: Tabelle ohne `|` in den Zellen, dazu die Befehle. */
export function listMarkdown(list: readonly Saved[], tag: string): string {
  const x = t().pr
  if (!list.length) return x.listEmpty
  const shown = new Set(buttonNames(list))
  const rows = list.map((s) => `| \`/${cmdOf(s.name)}\` | ${mdCell(preview(s.text, 60))} | ${s.button ? (shown.has(s.name) ? x.on : `${x.on} (5+)`) : x.off} |`)
  return [`${x.listHead(list.length, SAVED_MAX)}${tag ? ` · ${tag}` : ''}`, '', x.listCols, '|---|---|---|', ...rows, '', x.listFoot].join('\n')
}
