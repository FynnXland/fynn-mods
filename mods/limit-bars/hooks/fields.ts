// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4). Ein Feld je Zeile.
import type { FieldDefs } from './settings.ts'

export const SETTINGS: FieldDefs = {
  style: { type: 'string', default: 'bar', options: ['bar', 'ring'] },
  showFiveHour: { type: 'boolean', default: true },
  showWeekly: { type: 'boolean', default: true },
  showCache: { type: 'boolean', default: true },
  showCost: { type: 'boolean', default: true },
  showSystem: { type: 'boolean', default: false },
  storagePath: { type: 'string', default: '' },
  showStorage: { type: 'boolean', default: true },
  askBeforeColdSend: { type: 'boolean', default: true },
  expiryNotice: { type: 'boolean', default: true },
  bigTokens: { type: 'number', default: 150000, min: 1000 },
  cacheTtl: { type: 'string', default: 'auto', options: ['auto', '5', '60'] },
  resetStyle: { type: 'string', default: 'mixed', options: ['mixed', 'clock', 'countdown'] },
  highlightAt: { type: 'number', default: 90, min: 50, max: 100 },
  onlyFiveHour: { type: 'boolean', default: false },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}

/** Feld in userConfig je Teil der Anzeige (`/bars show <teil>`). */
export const PART_FIELD = { fiveHour: 'showFiveHour', weekly: 'showWeekly', cache: 'showCache', storage: 'showStorage', cost: 'showCost', system: 'showSystem' } as const
