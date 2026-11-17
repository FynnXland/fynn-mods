// sidekick: Inhalt von `/sidekick help` (SPEC Nachtrag 0.14.0, docs/HELP-SPEC.md §5 „sidekick 0.14.0“). Aus Einstellungen und
// Zustand beim Aufruf ein Schnappschuss `HelpData`; gezeichnet wird er von help.ts (Kopie von templates/help/help.ts). Rein, ohne `$`.
import type { HelpCommand, HelpData, HelpFeature, HelpSetting } from './help.js'
import { SETTINGS } from './fields.js'
import { lang, shortDate, t, tokensText } from './i18n.js'
import { languageHelp } from './language.js'
import { DEFAULT_SETTINGS, LEVELS } from './logic.js'
import type { Settings } from './logic.js'
import { RULE_IDS } from './wartung.js'

/** Was die Hilfe über den Zustand wissen muss; `register.ts` sammelt es beim Aufruf. */
export type HelpFacts = {
  settings: Settings
  /** Cache-Dauer in Minuten und woher sie kommt: gesetzt (`/sidekick ttl`), gemessen oder Standard */
  ttl: { min: number; source: 'set' | 'measured' | 'default' }
  /** Wartungs-Hinweise an, abgeschaltete Regeln */
  hints: { on: boolean; off: readonly string[] }
  /** Zahl der Themen in `notes:known` */
  known: number
  /** Jetzt (ms), für „Modell-Tipp ruht bis …“ (Ausbau 0.18.0) */
  now: number
  /** Ist prompt-deck da (`/deck` angemeldet)? Die Verweis-Zeile sagt dann `/deck help`, sonst wie man es installiert (Ausbau 0.29.0) */
  deck?: boolean
  /** userConfig-Werte (0.23.0) für EINSTELLUNGEN; fehlt ein Feld, gilt sein Standard */
  cfg?: Readonly<Record<string, unknown>>
}

const onOffWord = (b: boolean) => (b ? t().on : t().off)

/** EINSTELLUNGEN: alle userConfig-Felder mit Wert, in der Reihenfolge von plugin.json (hooks/fields.ts). */
function settingRows(f: HelpFacts): HelpSetting[] {
  const h = t().help
  const l = lang()
  return (Object.keys(SETTINGS) as (keyof typeof h.settings)[]).map((k) => {
    const def = SETTINGS[k]!
    const v = k === 'language' ? l : (f.cfg?.[k] ?? def.default)
    const value = typeof v === 'boolean' ? onOffWord(v) : typeof v === 'number' ? tokensText(v) : String(v)
    return { title: h.settings[k], value, isDefault: v === def.default }
  })
}

/** Die Zeilen unter BEFEHLE. `cmd` englisch und so, wie die Parser es annehmen (Test „Vollständigkeit“). */
function commands(): HelpCommand[] {
  const x = t()
  const h = x.help
  return [
    { cmd: '/sidekick [status]', does: h.status },
    // Die Stufen mit ihrer Beschreibung aus /sidekick status
    // Nachtrag 0.32.0: dazu der Buchstabe in der Desktop-Fußzeile (Aus ohne Buchstaben)
    ...LEVELS.map((l) => ({ cmd: `/sidekick ${l}`, does: `${x.level[l]}${l === 'off' ? x.footerNoLetter : x.footerLetter(x.levelShort[l])}: ${x.levelDesc[l]}` })),
    { cmd: '/sidekick on', does: h.on },
    { cmd: '/sidekick threshold 80k', does: h.threshold },
    { cmd: '/sidekick big 150k', does: h.big },
    { cmd: '/sidekick skills on|off', does: h.skills },
    { cmd: '/sidekick ttl 5|60|auto', does: h.ttl },
    { cmd: '/sidekick hints [status]', does: h.hints },
    { cmd: '/sidekick hints on|off', does: h.hintsOnOff },
    { cmd: '/sidekick hints <rule> on|off', does: h.hintsRule },
    { cmd: '/sidekick hints done <rule>', does: h.hintsDone },
    { cmd: '/sidekick hints audit-min 3k', does: h.hintsAuditMin },
    { cmd: '/sidekick notes [status]', does: h.notes },
    { cmd: '/sidekick notes on|off', does: h.notesOnOff },
    { cmd: '/sidekick notes forget', does: h.notesForget },
    { cmd: '/sidekick tips [status]', does: h.tips },
    { cmd: '/sidekick tips on|off', does: h.tipsOnOff },
    { cmd: '/sidekick tips auto on|off', does: h.tipsAuto },
    { cmd: '/sidekick tips haiku on|off', does: h.tipsHaiku },
    { cmd: '/sidekick tips stop', does: h.tipsStop },
    { cmd: '/sidekick loop [status]', does: h.loop },
    { cmd: '/sidekick loop on|off', does: h.loopOnOff },
    // Ausbau 0.24.0
    { cmd: '/sidekick queue', does: h.qList },
    { cmd: '/sidekick queue on|off', does: h.qOnOff },
    { cmd: lang() === 'de' ? 'danach: <text>' : 'later: <text>', does: h.qPrefix },
    // Ausbau 0.25.0
    { cmd: '/sidekick catalog', does: h.catList },
    { cmd: '/sidekick catalog on|off', does: h.catOnOff },
    { cmd: '/sidekick catalog mute|unmute <id>', does: h.catMute },
    // Ausbau 0.30.0
    { cmd: lang() === 'de' ? '/sidekick chat [<frage>]' : '/sidekick chat [<question>]', does: h.chat },
    // Ausbau 0.22.0 (von limit-bars übernommen)
    { cmd: '/handoff', does: h.handoff },
    { cmd: '/handoff fork|text', does: h.handoffForce },
    { cmd: '/handoff show', does: h.handoffShow },
    { cmd: '/handoff continue', does: h.handoffContinue },
    { cmd: h.skillCmd, does: h.skill },
    // Ausbau 0.31.0: Einstellungs-Ansicht
    { cmd: '/sidekick settings', does: h.settingsView },
    languageHelp('sidekick', lang()), // docs/LANGUAGE-SPEC.md §6 Punkt 4
    { cmd: '/sidekick help', does: h.help },
    { cmd: '/savings [today|week|all]', does: h.savings },
    { cmd: '/savings detail [today|week|all]', does: h.savingsDetail },
  ]
}

/**
 * BEDIENUNG: die Knöpfe der „Gut zu wissen“-Zeile (Nachtrag 0.13.0, seit 0.27.1 drei in einer Zeile, Ziffern nur während der Arbeit) und der Knopf neben einer
 * blauen Zeile (Nachtrag 0.7.0/0.8.1), an der Wartungszeile Einfügen und „?“ (Ausbau 0.16.0). Beschriftungen wie auf den Knöpfen.
 */
function controls(): HelpCommand[] {
  const x = t()
  const h = x.help
  return [
    { cmd: `1 ${x.noteClaude}`, does: h.cClaude },
    { cmd: `2 ${x.noteExplain}`, does: h.cExplain },
    { cmd: `0 ${x.noteIgnore}`, does: h.cIgnore },
    { cmd: h.cLine, does: h.cLineDoes },
    { cmd: h.cInsert, does: h.cInsertDoes },
    { cmd: h.cWhy, does: h.cWhyDoes },
    { cmd: h.cOffer, does: h.cOfferDoes },
    { cmd: h.cLater, does: h.cLaterDoes },
    { cmd: h.cSug, does: h.cSugDoes },
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
  const tp = s.tips
  const tips: HelpFeature = !tp.first
    ? { name: h.fTips, state: { kind: 'off' }, toggle: '/sidekick tips on' }
    : { name: h.fTips, state: { kind: 'on', ...(f.now < tp.restUntil ? { text: h.tipsRestState(shortDate(tp.restUntil)) } : {}) }, toggle: '/sidekick tips off' }
  const auto: HelpFeature = tp.auto ? { name: h.fTipsAuto, state: { kind: 'on' }, toggle: '/sidekick tips auto off' } : { name: h.fTipsAuto, state: { kind: 'off' }, toggle: '/sidekick tips auto on' }
  // Korrektur-Schleife (Ausbau 0.19.0), Standard an
  const lp = s.loop
  const loop: HelpFeature = !lp.on
    ? { name: h.fLoop, state: { kind: 'off' }, toggle: '/sidekick loop on' }
    : { name: h.fLoop, state: { kind: 'on', ...(f.now < lp.restUntil ? { text: h.tipsRestState(shortDate(lp.restUntil)) } : {}) }, toggle: '/sidekick loop off' }
  return [
    { name: h.fLevel, state: { kind: 'value', text: x.level[s.level], isDefault: s.level === D.level }, toggle: '/sidekick off|cache|guide' },
    { name: h.fThreshold, state: { kind: 'value', text: tokensText(s.threshold), isDefault: s.threshold === D.threshold }, toggle: '/sidekick threshold <n>' },
    { name: h.fBig, state: { kind: 'value', text: tokensText(s.big), isDefault: s.big === D.big }, toggle: '/sidekick big <n>' },
    { name: h.fSkills, state: { kind: s.skills ? 'on' : 'off' }, toggle: s.skills ? '/sidekick skills off' : '/sidekick skills on' },
    { name: h.fTtl, state: { kind: 'value', text: h.ttlState(f.ttl.min, f.ttl.source) }, toggle: '/sidekick ttl 5|60|auto' },
    f.hints.on
      ? { name: h.fHints, state: { kind: 'on', ...(f.hints.off.length ? { text: h.hintsSomeOff(f.hints.off.join(', ')) } : {}) }, toggle: '/sidekick hints off' }
      : { name: h.fHints, state: { kind: 'off' }, toggle: '/sidekick hints on' },
    notes,
    tips,
    auto,
    loop,
    f.cfg?.queue === false ? { name: h.settings.queue, state: { kind: 'off' }, toggle: '/sidekick queue on' } : { name: h.settings.queue, state: { kind: 'on' }, toggle: '/sidekick queue off' },
    f.cfg?.catalog === false ? { name: h.settings.catalog, state: { kind: 'off' }, toggle: '/sidekick catalog on' } : { name: h.settings.catalog, state: { kind: 'on' }, toggle: '/sidekick catalog off' },
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
    notes: [h.rules(RULE_IDS.join(' · ')), h.aliases, h.deckNote(f.deck === true)],
    controls: controls(),
    features: features(f),
    settings: settingRows(f),
    footer: { terminal: h.footerTerminal, desktop: h.footerDesktop },
  }
}
