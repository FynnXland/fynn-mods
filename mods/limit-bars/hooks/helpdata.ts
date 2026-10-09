// limit-bars: Inhalt von `/bars help` (docs/HELP-SPEC.md §5 „limit-bars 0.7.0“), reine Funktion ohne `$`. Gezeichnet wird er
// von help.ts (Kopie von templates/help/help.ts). Stand beim Aufruf: Was register.ts übergibt, wird nicht live umgeschrieben.
import type { KeepWarm, Settings } from './cache.ts'
import { DEFAULT_SETTINGS, tokensText } from './cache.ts'
import { PART_ARG } from './display.ts'
import type { Display, Overrides, Part } from './display.ts'
import type { HelpData, HelpFeature, HelpSetting } from './help.ts'
import { T, hhmm } from './i18n.ts'
import type { Lang } from './i18n.ts'

/**
 * Akzent der Hilfe: Theme-Key `warning` (Gelb), folgt dem Theme hell und dunkel (HELP-SPEC §4, geändert 2026-10-09;
 * vorher `#F2C94C`, im hellen Theme nur etwa 1,5:1). ThemeKey: types@2.1.295:12590.
 */
export const HELP_ACCENT = 'warning'

export type HelpInput = {
  lang: Lang
  /** userConfig, wie register() sie bekommt */
  options: Readonly<Record<string, unknown>>
  /** Was gerade gilt (Einstellung, darüber `/bars`) und welche Teile per `/bars` gesetzt sind */
  shown: Display
  overrides: Overrides
  /** `storagePath` gesetzt bzw. mit Laufwerksbuchstaben */
  storagePath: string
  hasDrive: boolean
  settings: Settings
  /** Cache-Dauer dieser Sitzung ohne gesetzten Wert: gemessen oder Standard (cache.ts `CacheMem`) */
  memTtl: 5 | 60
  memTtlSource: 'Standard' | 'gemessen'
  keep: KeepWarm | null
}

// Standards aus plugin.json (userConfig `default`)
const DEFAULTS: Readonly<Record<string, string | number | boolean>> = {
  language: 'en',
  resetStyle: 'mixed',
  highlightAt: 90,
  showFiveHour: true,
  showWeekly: true,
  showCache: true,
  showStorage: true,
  onlyFiveHour: false,
}
const SETTING_KEYS = ['language', 'resetStyle', 'highlightAt', 'showFiveHour', 'showWeekly', 'showCache', 'showStorage', 'onlyFiveHour', 'storagePath'] as const


export function barsHelpData(i: HelpInput): HelpData {
  const t = T[i.lang]
  const h = t.help
  const onOff = (on: boolean) => (on ? t.on : t.off)

  // Schalter: der Befehl, der den Zustand ändert (HELP-SPEC §4)
  const part = (p: Part, name: string): HelpFeature => {
    const by = i.overrides[p] !== undefined ? h.byCommand : h.bySetting
    const on = i.shown[p]
    // Ohne Laufwerk hilft kein /bars: dann ist storagePath der Schalter, auch wenn der Ring per /bars aus ist
    if (p === 'storage' && !i.hasDrive) {
      if (!on) return { name, state: { kind: 'off', text: `${onOff(false)} · ${by}` }, toggle: h.setPath }
      return { name, state: { kind: 'off', text: i.storagePath ? h.noDrive : h.noPath }, toggle: h.setPath }
    }
    return { name, state: { kind: on ? 'on' : 'off', text: `${onOff(on)} · ${by}` }, toggle: `/bars ${PART_ARG[p]} ${on ? 'off' : 'on'}` }
  }

  const s = i.settings
  // auto: die gemessene Dauer mit Quelle; ohne Messung reicht „(Standard)“ hinter dem Wert
  const ttlText = s.ttl ? h.ttlSet(String(s.ttl)) : h.ttlAuto(String(i.memTtl), i.memTtlSource === 'gemessen' ? t.srcMeasured : '')

  const settingValue = (k: (typeof SETTING_KEYS)[number]): HelpSetting => {
    const title = h.settings[k]
    if (k === 'storagePath') return i.storagePath ? { title, value: i.storagePath } : { title, value: h.empty, isDefault: true }
    if (k === 'language') return { title, value: i.lang, isDefault: i.lang === DEFAULTS.language }
    const raw = i.options[k]
    const v = raw === undefined ? DEFAULTS[k]! : raw
    const value = typeof v === 'boolean' ? onOff(v) : String(v)
    return { title, value, isDefault: v === DEFAULTS[k] }
  }

  return {
    mod: 'limit-bars',
    lang: i.lang,
    intro: h.intro,
    commands: [
      { cmd: '/bars', does: h.bars },
      { cmd: '/bars show 5h|week|cache|storage on|off', does: h.barsShow },
      { cmd: '/bars reset', does: h.barsReset },
      { cmd: '/bars help', does: h.barsHelp },
      { cmd: '/cache', does: h.cache },
      { cmd: '/cache ttl 5|60|auto', does: h.cacheTtl },
      { cmd: '/cache warn on|off', does: h.cacheWarn },
      { cmd: '/cache hints on|off', does: h.cacheHints },
      { cmd: '/cache big <n>', does: h.cacheBig },
      { cmd: '/handoff', does: h.handoff },
      { cmd: '/handoff show', does: h.handoffShow },
      { cmd: '/handoff continue', does: h.handoffContinue },
      { cmd: i.lang === 'de' ? '/keepwarm [stunden]' : '/keepwarm [hours]', does: h.keepwarm },
      { cmd: '/keepwarm off', does: h.keepwarmOff },
      { cmd: '/disk [refresh]', does: h.disk },
      { cmd: h.skillCmd, does: h.skill },
    ],
    notes: [h.aliases],
    features: [
      part('fiveHour', h.fiveHour),
      part('weekly', h.weekly),
      part('cache', h.cacheRing),
      part('storage', h.storageRing),
      { name: h.guard, state: { kind: s.guard ? 'on' : 'off' }, toggle: `/cache warn ${s.guard ? 'off' : 'on'}` },
      { name: h.alerts, state: { kind: s.alerts ? 'on' : 'off' }, toggle: `/cache hints ${s.alerts ? 'off' : 'on'}` },
      { name: h.big, state: { kind: 'value', text: tokensText(s.bigTokens, i.lang), isDefault: s.bigTokens === DEFAULT_SETTINGS.bigTokens }, toggle: '/cache big <n>' },
      { name: h.ttl, state: { kind: 'value', text: ttlText, isDefault: s.ttl === DEFAULT_SETTINGS.ttl && i.memTtlSource !== 'gemessen' }, toggle: '/cache ttl 5|60|auto' },
      i.keep
        ? { name: h.keep, state: { kind: 'on', text: h.keepUntil(hhmm(i.keep.until)) }, toggle: '/keepwarm off' }
        : { name: h.keep, state: { kind: 'off' }, toggle: h.keepToggle },
    ],
    settings: SETTING_KEYS.map(settingValue),
    footer: { terminal: h.footerTerminal, desktop: h.footerDesktop },
  }
}
