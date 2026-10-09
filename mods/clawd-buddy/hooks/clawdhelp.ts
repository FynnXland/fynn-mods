// clawd-buddy: Inhalt von `/clawd help` (docs/HELP-SPEC.md §5 „clawd-buddy 0.7.0“). Rein, kein `$`: Wortlisten des Parsers und der
// Schnappschuss `HelpData`; die Zeichnung macht help.ts (Kopie von templates/help/help.ts).
import { helpLabels } from './help.ts'
import type { HelpData } from './help.ts'
import { T } from './i18n.ts'
import type { Lang } from './i18n.ts'

/** Akzent der Hilfe: Theme-Key claude (Orange), passt sich hell und dunkel an (HELP-SPEC §4, geändert 2026-10-09; vorher #D77757). */
export const ACCENT = 'claude'

/** Unterbefehle, die `/clawd` versteht (register.ts nutzt die Liste; ein Test prüft jeden gegen die Hilfe). */
export const SUBCOMMANDS = ['status', 'on', 'off', 'list', 'demo', 'nap', 'boop', 'flicker'] as const
/** Wörter für die Hilfe, nur als einziges Wort, Groß-/Kleinschreibung egal (HELP-SPEC §2). */
export const HELP_WORDS = ['help', '?'] as const

/** Ist `args` ein Aufruf der Hilfe? Erstes Wort `help` oder `?`, sonst nichts. */
export function isHelp(args: string): boolean {
  const words = args.trim().split(/\s+/).filter(Boolean)
  return words.length === 1 && (HELP_WORDS as readonly string[]).includes(words[0]!.toLowerCase())
}

/** Werte aus `options` (userConfig) und Zustand beim Aufruf; Standardwerte wie in plugin.json. */
export type HelpInput = {
  lang: Lang
  enabled: boolean
  nightStart: number
  nightEnd: number
  idleSeconds: number
  reduced: boolean
  side: 'right' | 'left'
  birthday: string
}

export const DEFAULTS = { nightStart: 23, nightEnd: 6, idleSeconds: 45, reduced: false, side: 'right', birthday: '05.01.', lang: 'en' } as const

export function clawdHelp(o: HelpInput): HelpData {
  const t = T[o.lang]
  const x = t.hx
  const L = helpLabels(o.lang)
  const onOff = (v: boolean) => (v ? L.on : L.off)
  return {
    mod: 'clawd-buddy',
    lang: o.lang,
    intro: x.intro,
    commands: [
      { cmd: '/clawd [status]', does: x.status },
      { cmd: '/clawd on', does: x.on },
      { cmd: '/clawd off', does: x.off },
      { cmd: '/clawd list', does: x.list },
      { cmd: '/clawd demo <animation>', does: x.demo },
      { cmd: '/clawd nap', does: x.nap },
      { cmd: '/clawd boop', does: x.boop },
      { cmd: '/clawd flicker', does: x.flicker },
      { cmd: '/clawd help', does: x.help },
    ],
    controls: [
      { cmd: x.click, does: x.mouse.click },
      { cmd: x.arm, does: x.mouse.arm },
      { cmd: x.hold, does: x.mouse.hold },
    ],
    features: [
      { name: x.buddy, state: { kind: o.enabled ? 'on' : 'off' }, toggle: o.enabled ? '/clawd off' : '/clawd on' },
      { name: x.reduced, state: { kind: o.reduced ? 'on' : 'off' }, toggle: x.setting },
    ],
    settings: [
      { title: x.titles.nightStart, value: String(o.nightStart), isDefault: o.nightStart === DEFAULTS.nightStart },
      { title: x.titles.nightEnd, value: String(o.nightEnd), isDefault: o.nightEnd === DEFAULTS.nightEnd },
      { title: x.titles.idleSeconds, value: String(o.idleSeconds), isDefault: o.idleSeconds === DEFAULTS.idleSeconds },
      { title: x.titles.reducedMotion, value: onOff(o.reduced), isDefault: o.reduced === DEFAULTS.reduced },
      { title: x.titles.side, value: x.sides[o.side], isDefault: o.side === DEFAULTS.side },
      { title: x.titles.birthday, value: o.birthday || x.birthdayOff, isDefault: o.birthday === DEFAULTS.birthday },
      { title: x.titles.language, value: o.lang, isDefault: o.lang === DEFAULTS.lang },
    ],
    footer: { terminal: x.footerTerminal, desktop: x.footerDesktop },
  }
}
