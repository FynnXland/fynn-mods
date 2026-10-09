// sidekick: Inhalt von `/sidekick help` (SPEC Nachtrag 0.14.0, docs/HELP-SPEC.md §5 „sidekick 0.14.0“). Aus Einstellungen und
// Zustand beim Aufruf ein Schnappschuss `HelpData`; gezeichnet wird er von help.ts (Kopie von templates/help/help.ts). Rein, ohne `$`.
import type { HelpCommand, HelpData, HelpFeature } from './help.ts'
import { lang, t, tokensText } from './i18n.ts'
import { DEFAULT_SETTINGS, LEVELS, splits } from './logic.ts'
import type { Settings } from './logic.ts'
import { RULE_IDS } from './wartung.ts'

/** Was die Hilfe über den Zustand wissen muss; `register.ts` sammelt es beim Aufruf. */
export type HelpFacts = {
  settings: Settings
  /** Cache-Dauer in Minuten und woher sie kommt: gesetzt (`/sidekick ttl`), gemessen oder Standard */
  ttl: { min: number; source: 'set' | 'measured' | 'default' }
  /** Wartungs-Hinweise an, abgeschaltete Regeln */
  hints: { on: boolean; off: readonly string[] }
  /** Zahl der Themen in `notes:known` */
  known: number
  /** worklist bietet `/todo` an (für `/later` und das Aufteilen) */
  worklist: boolean
}

/** Die Zeilen unter BEFEHLE. `cmd` englisch und so, wie die Parser es annehmen (Test „Vollständigkeit“). */
function commands(): HelpCommand[] {
  const x = t()
  const h = x.help
  return [
    { cmd: '/sidekick [status]', does: h.status },
    // Die Stufen mit ihrer Beschreibung aus /sidekick status
    ...LEVELS.map((l) => ({ cmd: `/sidekick ${l}`, does: `${x.level[l]}: ${x.levelDesc[l]}` })),
    { cmd: '/sidekick on', does: h.on },
    { cmd: '/sidekick threshold 80k', does: h.threshold },
    { cmd: '/sidekick big 150k', does: h.big },
    { cmd: '/sidekick skills on|off', does: h.skills },
    { cmd: '/sidekick ttl 5|60|auto', does: h.ttl },
    { cmd: '/sidekick long 800|off', does: h.long },
    { cmd: '/sidekick hints [status]', does: h.hints },
    { cmd: '/sidekick hints on|off', does: h.hintsOnOff },
    { cmd: '/sidekick hints <rule> on|off', does: h.hintsRule },
    { cmd: '/sidekick hints done <rule>', does: h.hintsDone },
    { cmd: '/sidekick hints audit-min 3k', does: h.hintsAuditMin },
    { cmd: '/sidekick notes [status]', does: h.notes },
    { cmd: '/sidekick notes on|off', does: h.notesOnOff },
    { cmd: '/sidekick notes forget', does: h.notesForget },
    { cmd: '/sidekick help', does: h.help },
    { cmd: '/savings [today|week|all]', does: h.savings },
    { cmd: '/savings detail [today|week|all]', does: h.savingsDetail },
    { cmd: '/later <text>', does: h.later },
  ]
}

/**
 * BEDIENUNG: die Knöpfe der „Gut zu wissen“-Karte (Nachtrag 0.13.0, Ziffern nur während der Arbeit) und der Knopf neben einer
 * blauen Zeile (Nachtrag 0.7.0/0.8.1). Beschriftungen wie auf den Knöpfen.
 */
function controls(): HelpCommand[] {
  const x = t()
  const h = x.help
  return [
    { cmd: `1 ${x.noteExplain}`, does: h.cExplain },
    { cmd: `2 ${x.noteKnown}`, does: h.cKnown },
    { cmd: `0 ${x.noteLater}`, does: h.cLater },
    { cmd: `1 ${x.noteGotIt}`, does: h.cGotIt },
    { cmd: `2 ${x.noteChat}`, does: h.cChat },
    { cmd: `0 ${x.noteClose}`, does: h.cClose },
    { cmd: h.cLine, does: h.cLineDoes },
  ]
}

/** FUNKTIONEN mit Zustand beim Aufruf; „Umschalten“ ist der Befehl, der den Zustand ändert (HELP-SPEC §4). */
function features(f: HelpFacts): HelpFeature[] {
  const x = t()
  const h = x.help
  const s = f.settings
  const D = DEFAULT_SETTINGS
  const notes: HelpFeature = s.notes
    ? { name: h.fNotes, state: { kind: 'on', text: s.level === 'off' ? h.notesRests : h.notesOn(f.known) }, toggle: '/sidekick notes off' }
    : { name: h.fNotes, state: { kind: 'off', text: h.notesOff }, toggle: '/sidekick notes on' }
  return [
    { name: h.fLevel, state: { kind: 'value', text: x.level[s.level], isDefault: s.level === D.level }, toggle: '/sidekick off|cache|guide|plan|auto' },
    { name: h.fThreshold, state: { kind: 'value', text: tokensText(s.threshold), isDefault: s.threshold === D.threshold }, toggle: '/sidekick threshold <n>' },
    { name: h.fBig, state: { kind: 'value', text: tokensText(s.big), isDefault: s.big === D.big }, toggle: '/sidekick big <n>' },
    { name: h.fSkills, state: { kind: s.skills ? 'on' : 'off' }, toggle: s.skills ? '/sidekick skills off' : '/sidekick skills on' },
    { name: h.fTtl, state: { kind: 'value', text: h.ttlState(f.ttl.min, f.ttl.source) }, toggle: '/sidekick ttl 5|60|auto' },
    s.long > 0
      ? { name: h.fLong, state: { kind: 'on', text: splits(s) ? h.longOn(s.long) : h.longRests(s.long) }, toggle: '/sidekick long off' }
      : { name: h.fLong, state: { kind: 'off' }, toggle: `/sidekick long ${D.long}` },
    f.hints.on
      ? { name: h.fHints, state: { kind: 'on', ...(f.hints.off.length ? { text: h.hintsSomeOff(f.hints.off.join(', ')) } : {}) }, toggle: '/sidekick hints off' }
      : { name: h.fHints, state: { kind: 'off' }, toggle: '/sidekick hints on' },
    notes,
    { name: h.fWorklist, state: { kind: f.worklist ? 'on' : 'off', text: f.worklist ? h.worklistYes : h.worklistNo }, toggle: h.worklistFor },
  ]
}

/** Der ganze Schnappschuss für `/sidekick help`. */
export function sidekickHelp(f: HelpFacts): HelpData {
  const h = t().help
  const l = lang()
  return {
    mod: 'sidekick',
    lang: l,
    intro: h.intro,
    commands: commands(),
    notes: [h.rules(RULE_IDS.join(' · ')), h.aliases],
    controls: controls(),
    features: features(f),
    settings: [{ title: h.setLanguage, value: l, isDefault: l === 'en' }],
    footer: { terminal: h.footerTerminal, desktop: h.footerDesktop },
  }
}
