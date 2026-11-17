// sidekick: Einstellungs-Ansicht `/sidekick settings` (Ausbau 0.31.0, SPEC Teil 1). Reine Daten und Text ohne `$`: Gruppen, je Feld
// Name, ein Satz, Wert und Befehl in der eingestellten Sprache, dazu welche Funktionen bei der Stufe ruhen. register.ts zeichnet daraus
// die Ansicht mit Knöpfen (CommandOutput, Terminal und Desktop) und schreibt über `writeSettings` (hooks/settings.ts). Für `-p` und
// VS Code die Markdown-Liste mit Befehlen. Das App-Fenster (userConfig) kennt keine zweite Sprache (plugins-manifest-reference.md:430-444).

import { SETTINGS } from './fields.js'
import { t, tokensText } from './i18n.js'
import type { SettingValue, Values } from './settings.js'

export type SvKey =
  | 'level'
  | 'skills'
  | 'catalog'
  | 'modelTip'
  | 'modelTipHaiku'
  | 'modelTipAuto'
  | 'retryLoop'
  | 'maintenanceHints'
  | 'notes'
  | 'queue'
  | 'threshold'
  | 'bigTokens'
  | 'auditMin'
  | 'cacheTtl'
  | 'language'

export type SvGroup = 'base' | 'before' | 'during' | 'limits' | 'lang'

/** Gruppen und Felder in dieser Reihenfolge (SPEC Teil 1); `sub`: eingerückter Unterpunkt (Modell-Tipp). Gleiche Reihenfolge in plugin.json. */
export const SV_GROUPS: readonly { id: SvGroup; keys: readonly SvKey[] }[] = [
  { id: 'base', keys: ['level'] },
  { id: 'before', keys: ['skills', 'catalog', 'modelTip', 'modelTipHaiku', 'modelTipAuto', 'retryLoop', 'maintenanceHints'] },
  { id: 'during', keys: ['notes', 'queue'] },
  { id: 'limits', keys: ['threshold', 'bigTokens', 'auditMin', 'cacheTtl'] },
  { id: 'lang', keys: ['language'] },
]
export const SV_KEYS: readonly SvKey[] = SV_GROUPS.flatMap((g) => g.keys)
export const SV_SUB: ReadonlySet<SvKey> = new Set(['modelTipHaiku', 'modelTipAuto'])

/**
 * Was auf welcher Stufe wirkt: `cache` = nur die Kalt-Cache-Frage, ohne Modellaufrufe (Stufen-Beschreibung in plugin.json); `off` =
 * nichts. Stufe und Sprache gelten immer.
 */
const ON_CACHE: ReadonlySet<SvKey> = new Set(['level', 'language', 'bigTokens', 'cacheTtl'])
const ALWAYS: ReadonlySet<SvKey> = new Set(['level', 'language'])
export function restsAt(key: SvKey, level: string): boolean {
  if (level === 'guide') return false
  if (level === 'cache') return !ON_CACHE.has(key)
  return !ALWAYS.has(key)
}

/** Art des Feldes für die Knöpfe: Schalter, Auswahl (je Wert ein Knopf), Zahl (nur Befehl kopieren). */
export function kindOf(key: SvKey): 'bool' | 'choice' | 'number' {
  const d = SETTINGS[key]!
  if (d.type === 'boolean') return 'bool'
  if (d.type === 'number') return 'number'
  return 'choice'
}
/** Die Werte, die ein Knopf setzen kann (Schalter: an, aus; Auswahl: `options`). */
export function choicesOf(key: SvKey): SettingValue[] {
  const d = SETTINGS[key]!
  if (d.type === 'boolean') return [true, false]
  if (d.type === 'string' && 'options' in d && d.options) return [...d.options]
  return []
}

export const valueOf = (cfg: Values, key: SvKey): SettingValue => (cfg[key] ?? SETTINGS[key]!.default) as SettingValue

/** Zahl als Befehlsargument wie die Befehle sie lesen (80000 → 80k). */
const tok = (n: number) => (n % 1000 === 0 ? `${n / 1000}k` : String(n))

/** Der Befehl, der das Feld setzt; bei Zahlen mit dem aktuellen Wert (zum Kopieren und Anpassen). */
export function commandOf(key: SvKey, v: SettingValue): string {
  const n = typeof v === 'number' ? tok(v) : ''
  switch (key) {
    case 'level':
      return '/sidekick off|cache|guide'
    case 'skills':
      return '/sidekick skills on|off'
    case 'catalog':
      return '/sidekick catalog on|off'
    case 'modelTip':
      return '/sidekick tips on|off'
    case 'modelTipHaiku':
      return '/sidekick tips haiku on|off'
    case 'modelTipAuto':
      return '/sidekick tips auto on|off'
    case 'retryLoop':
      return '/sidekick loop on|off'
    case 'maintenanceHints':
      return '/sidekick hints on|off'
    case 'notes':
      return '/sidekick notes on|off'
    case 'queue':
      return '/sidekick queue on|off'
    case 'threshold':
      return `/sidekick threshold ${n}`
    case 'bigTokens':
      return `/sidekick big ${n}`
    case 'auditMin':
      return `/sidekick hints audit-min ${n}`
    case 'cacheTtl':
      return '/sidekick ttl 5|60|auto'
    case 'language':
      return '/sidekick language de|en'
  }
}

/** Ein Wert in Worten (an/aus, Stufe, Tokens, Minuten, Sprache). */
export function valueText(key: SvKey, v: SettingValue): string {
  const x = t()
  const s = x.sv
  if (typeof v === 'boolean') return v ? s.on : s.off
  if (key === 'level') return x.level[v as 'off' | 'cache' | 'guide'] ?? String(v)
  if (key === 'cacheTtl') return v === 'auto' ? s.ttlAuto : `${v} min`
  if (key === 'language') return v === 'de' ? 'Deutsch' : 'English'
  if (typeof v === 'number') return tokensText(v)
  return String(v)
}

/**
 * Ampel je Zeile (Wunsch Fynn 2026-11-17 nach dem Desktop-Blick): Schalter an = grün, aus = rot; Stufe Begleiter grün, Cache gelb,
 * Aus rot. Zahlen, Lebensdauer und Sprache haben keinen Zustand an/aus: ohne Punkt.
 */
export type SvDot = 'on' | 'off' | 'mid' | ''
export function dotOf(key: SvKey, v: SettingValue): SvDot {
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (key === 'level') return v === 'guide' ? 'on' : v === 'cache' ? 'mid' : 'off'
  return ''
}
/** Markdown (Desktop-Text, `-p`, VS Code): farbige Emoji-Punkte. */
export const DOT_MD: Record<SvDot, string> = { on: '🟢', off: '🔴', mid: '🟡', '': '' }
/** Zeichnung (Terminal, Desktop): ● in der Theme-Farbe (ThemeKey success, error, warning). */
export const DOT_COLOR: Record<Exclude<SvDot, ''>, 'success' | 'error' | 'warning'> = { on: 'success', off: 'error', mid: 'warning' }

export type SvRow = { key: SvKey; name: string; does: string; value: string; cmd: string; rests: boolean; sub: boolean; isDefault: boolean; dot: SvDot }

/** Alle Zeilen für die Ansicht, gruppiert. `level` ist die gültige Stufe (`settings.level`). */
export function svRows(cfg: Values, level: string): { id: SvGroup; title: string; rows: SvRow[] }[] {
  const s = t().sv
  return SV_GROUPS.map((g) => ({
    id: g.id,
    title: s.groups[g.id] ?? g.id,
    rows: g.keys.map((key) => {
      const v = valueOf(cfg, key)
      return {
        key,
        name: s.names[key] ?? key,
        does: s.does[key] ?? '',
        value: valueText(key, v),
        cmd: commandOf(key, v),
        rests: restsAt(key, level),
        sub: SV_SUB.has(key),
        isDefault: v === SETTINGS[key]!.default,
        dot: dotOf(key, v),
      }
    }),
  }))
}

/** Hinweis „ruht bei Stufe …“ in der eingestellten Sprache. */
export const restText = (level: string) => t().sv.rests(t().level[level as 'off' | 'cache' | 'guide'] ?? level)

/** Markdown für `-p`, VS Code und als Rohtext der Ansicht: Gruppen, je Feld Name, Wert, Befehl und Satz; nichts fehlt. */
export function svMarkdown(cfg: Values, level: string): string {
  const s = t().sv
  const out = [s.title(t().level[level as 'off' | 'cache' | 'guide'] ?? level), '', s.intro]
  for (const g of svRows(cfg, level)) {
    out.push('', `**${g.title}**`, '')
    for (const r of g.rows) {
      const rest = r.rests ? ` · _${restText(level)}_` : ''
      const dot = r.dot ? `${DOT_MD[r.dot]} ` : ''
      out.push(`${r.sub ? '  ' : ''}- ${dot}**${r.name}**: ${r.value}${rest} · \`${r.cmd}\`  \n${r.sub ? '  ' : ''}  ${r.does}`)
    }
  }
  out.push('', s.foot)
  return out.join('\n')
}
