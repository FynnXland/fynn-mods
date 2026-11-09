// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4). Ein Feld je Zeile.
import type { FieldDefs } from './settings.ts'

export const SETTINGS: FieldDefs = {
  plan: { type: 'string', default: 'none', options: ['none', 'pro', 'max', 'ultra', 'team', 'enterprise', 'max5', 'max20'] },
  billingDay: { type: 'number', default: 1, min: 1, max: 31 },
  planPrice: { type: 'number', default: 0, min: 0 },
  dayYellow: { type: 'number', default: 3, min: 0 },
  dayRed: { type: 'number', default: 8, min: 0 },
  keepDays: { type: 'number', default: 365, min: 1, max: 3650 },
  syncFolder: { type: 'string', default: '' },
  deviceName: { type: 'string', default: '' },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}
