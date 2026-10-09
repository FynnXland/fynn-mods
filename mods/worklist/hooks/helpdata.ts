// helpdata.ts: Inhalt von /todos help (0.7.0, docs/HELP-SPEC.md §5 „worklist“). Die Zeichnung macht help.ts (Kopie aus
// templates/help/), hier stehen nur die Wortliste des Parsers und der Schnappschuss HelpData. Ohne `$`, ohne Engine testbar.
import { helpLabels } from './help.ts'
import type { HelpData } from './help.ts'
import { T } from './i18n.ts'
import { DEFAULT_SETTINGS } from './model.ts'
import type { Settings } from './model.ts'

/** Alle Wörter, die /todos annimmt (außer leer = Seitenleiste). Der Parser lehnt alles andere ab; ein Test prüft jedes gegen die Hilfe. */
export const TODOS_WORDS = ['status', 'pause', 'resume', 'done', 'skip', 'retry', 'clear', 'history', 'close', 'help', '?'] as const
export const HELP_WORDS = ['help', '?']

/** Was der Schnappschuss vom Laufzustand braucht: Pause der Liste, Schleifenschutz hält an (zweiter Halt am selben To-do). */
export type HelpRuntime = { paused: boolean; hold: boolean }

/** Schnappschuss beim Aufruf von /todos help; die Zeichnung schreibt sich danach nicht um (HELP-SPEC §3 Punkt 3). */
export function worklistHelp(s: Settings, st: HelpRuntime): HelpData {
  const L = T[s.lang]
  const H = L.hlp
  const on = helpLabels(s.lang)
  const flag = (v: boolean) => (v ? on.on : on.off)
  const D = DEFAULT_SETTINGS
  return {
    mod: 'worklist',
    lang: s.lang,
    intro: H.intro,
    commands: [
      { cmd: `/todo ${H.task}`, does: H.todoAdd },
      { cmd: '/todo', does: H.todoPane },
      { cmd: '/todos', does: H.todosPane },
      { cmd: '/todos status', does: H.status },
      { cmd: '/todos pause', does: H.pause },
      { cmd: '/todos resume', does: H.resume },
      { cmd: '/todos done', does: H.done },
      { cmd: '/todos skip', does: H.skip },
      { cmd: '/todos retry', does: H.retry },
      { cmd: '/todos clear', does: H.clear },
      { cmd: '/todos history', does: H.history },
      { cmd: '/todos close', does: H.close },
      { cmd: '/todos help', does: H.help },
    ],
    notes: [H.note],
    // Knöpfe der Seitenleiste mit ihren echten Beschriftungen (view.ts)
    controls: [
      { cmd: `${L.resume} · ${L.markDone} · ${L.skip}`, does: H.ctlNotice },
      { cmd: `${L.stopWaiting} · ${L.keepWaiting}`, does: H.ctlWait },
      { cmd: `${L.pause} · ${L.start} · ${L.go}`, does: H.ctlControl },
      { cmd: '↑ ↓ ✕', does: H.ctlRow },
      { cmd: L.placeholder, does: H.ctlInput },
      { cmd: `${L.history} · ${H.show}`, does: H.ctlHistory },
    ],
    features: [
      { name: H.fPaused, state: { kind: st.paused ? 'on' : 'off' }, toggle: st.paused ? '/todos resume' : '/todos pause' },
      { name: H.fHaiku, state: { kind: s.haiku ? 'on' : 'off' }, toggle: H.setting },
      { name: H.fHints, state: { kind: s.doneLine ? 'on' : 'off' }, toggle: H.setting },
      { name: H.fSettle, state: { kind: 'value', text: H.seconds(s.settleSeconds), isDefault: s.settleSeconds === D.settleSeconds }, toggle: H.setting },
      { name: H.fRow, state: { kind: 'value', text: String(s.maxAutoRun), isDefault: s.maxAutoRun === D.maxAutoRun }, toggle: H.setting },
      { name: H.fGuard, state: st.hold ? { kind: 'on', text: H.guardOn } : { kind: 'off', text: H.guardOff }, toggle: H.info },
    ],
    settings: [
      { title: H.sLanguage, value: s.lang, isDefault: s.lang === D.lang },
      { title: H.sHaiku, value: flag(s.haiku), isDefault: s.haiku === D.haiku },
      { title: H.sHints, value: flag(s.doneLine), isDefault: s.doneLine === D.doneLine },
      { title: H.sSettle, value: String(s.settleSeconds), isDefault: s.settleSeconds === D.settleSeconds },
      { title: H.sRow, value: String(s.maxAutoRun), isDefault: s.maxAutoRun === D.maxAutoRun },
    ],
    footer: { terminal: H.footerTerminal, desktop: H.footerDesktop },
  }
}
