// buttons.ts: die Fußzeilen-Knöpfe der Desktop-App (SPEC „Ausbau 0.27.0“). Eine gemeinsame Liste der Knopfarten (`FOOTER_BUTTONS`):
// Kennung, Titel en/de, das userConfig-Feld, das sie schaltet, und der Zustandstext. `/sidekick buttons`, die Hilfe und die Fußzeile
// lesen nur diese Liste; eine neue Knopfart braucht hier eine Zeile, ein Feld in hooks/fields.ts und plugin.json und einen Titel in
// `help.settings` (i18n.ts). Darunter stehen in `/sidekick buttons` die gespeicherten Prompts (`prompts:saved`), jeder mit seinem
// eigenen Schalter `button`. Rein, ohne `$`.
import { lang, t } from './i18n.js'
import type { Lang } from './i18n.js'
import { BUTTONS_MAX, PREFIX, buttonNames, normName } from './prompts.js'
import type { Saved } from './prompts.js'

/** Was Zustand und Sichtbarkeit brauchen: die userConfig-Werte, die Stufe und die gespeicherten Prompts. */
export type ButtonFacts = { cfg: Readonly<Record<string, unknown>>; level: 'off' | 'cache' | 'guide'; saved: readonly Saved[] }

/** Eine Knopfart der Fußzeile. `field`: boolean in userConfig, Standard an. `state`: Zustandstext, wenn der Schalter an ist. */
export type ButtonKind = { id: string; field: string; title: Readonly<Record<Lang, string>>; state: (f: ButtonFacts) => string }

/** Ein Schalter ist an, solange er nicht ausdrücklich false ist (Standard an, heutiges Verhalten). */
export const switchOn = (f: ButtonFacts, field: string) => f.cfg[field] !== false

export const FOOTER_BUTTONS: readonly ButtonKind[] = [
  {
    // Ausbau 0.24.0: nur während eines Zugs, nur auf Begleiter und mit `queue` an
    id: 'later',
    field: 'laterButton',
    title: { en: 'Later', de: 'Danach' },
    state: (f) => {
      const x = t().bt
      if (f.cfg.queue === false) return x.laterNoQueue
      if (f.level !== 'guide') return x.laterNotGuide
      return x.laterOn
    },
  },
  {
    // Nachtrag 0.21.0: höchstens 4 Knöpfe gespeicherter Prompts
    id: 'prompts',
    field: 'promptButtons',
    title: { en: 'Prompt buttons', de: 'Prompt-Knöpfe' },
    state: (f) => t().bt.promptsOn(buttonNames(f.saved).length, BUTTONS_MAX),
  },
]

/** Titel einer Knopfart in der eingestellten Sprache. */
export const kindTitle = (k: ButtonKind) => k.title[lang()]

/** Eine Zeile von `/sidekick buttons`. `on`: der Schalter dieser Zeile; bei Prompts ist `id` der Name. */
export type ButtonRow = { id: string; kind: 'switch' | 'prompt'; title: string; on: boolean; state: string }

/**
 * Die Prompt-Knöpfe nach dem Schalter: keine bei `promptButtons` aus, sonst die ersten 4 mit `button`. Die Stufe zählt hier
 * nicht (Review 0.27.0 S1): Bei Stufe Aus zeichnet die Fußzeile ohnehin keine Knöpfe, und `/sidekick guide` schreibt
 * `sidekick.prompts` nicht neu. Ein leerer Wert aus der Zeit der Stufe Aus ließe die Knöpfe sonst bis zur nächsten Runde fehlen.
 */
export function shownPrompts(f: ButtonFacts): string[] {
  if (!switchOn(f, 'promptButtons')) return []
  return buttonNames(f.saved)
}

/** Darf der Knopf „Danach“ stehen (ohne die Frage, ob gerade ein Zug läuft): Begleiter, `queue` an, `laterButton` an. */
export function laterAllowed(f: ButtonFacts): boolean {
  return f.level === 'guide' && f.cfg.queue !== false && switchOn(f, 'laterButton')
}

/** Alle Zeilen: oben die Knopfarten, darunter jeder gespeicherte Prompt in der Reihenfolge des Speicherns. */
export function buttonRows(f: ButtonFacts): ButtonRow[] {
  const x = t().bt
  const kinds: ButtonRow[] = FOOTER_BUTTONS.map((k) => {
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

/** Was `/sidekick buttons …` will: die Liste, einen Schalter umlegen oder die Kurzhilfe. */
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
  const k = FOOTER_BUTTONS.find((y) => y.id === id)
  if (k) return { kind: 'switch', k }
  const name = normName(raw)
  return saved.some((s) => s.name === name) ? { kind: 'prompt', name } : null
}

const cell = (s: string) => s.replace(/\|/g, '¦').replace(/\s*\n\s*/g, ' ')

/** Markdown von `/sidekick buttons` (auch die Fassung für `-p` und VS Code): Tabelle, Hinweis ohne Prompts, Textbefehle. */
export function buttonsMarkdown(f: ButtonFacts, tag: string): string {
  const x = t().bt
  const rows = buttonRows(f).map((r) => `| ${r.kind === 'prompt' ? `\`${r.title}\`` : r.title} | ${r.on ? x.on : x.off} | ${cell(r.state)} |`)
  return [
    `${x.head}${tag ? ` · ${tag}` : ''}`,
    ...(f.level === 'off' ? ['', x.levelOff] : []),
    '',
    x.cols,
    '|---|---|---|',
    ...rows,
    ...(f.saved.length ? [] : ['', x.noPrompts]),
    '',
    x.foot,
  ].join('\n')
}
