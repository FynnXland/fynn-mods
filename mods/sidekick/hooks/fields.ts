// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4, §5 „sidekick 0.22.0 → 0.23.0“). Ein Feld je Zeile, Reihenfolge wie die Ansicht /sidekick settings (Ausbau 0.31.0).
import type { FieldDefs } from './settings.js'

export const SETTINGS: FieldDefs = {
  level: { type: 'string', default: 'guide', options: ['off', 'cache', 'guide'] },
  skills: { type: 'boolean', default: true },
  catalog: { type: 'boolean', default: true },
  modelTip: { type: 'boolean', default: true },
  modelTipHaiku: { type: 'boolean', default: true },
  modelTipAuto: { type: 'boolean', default: false },
  retryLoop: { type: 'boolean', default: true },
  maintenanceHints: { type: 'boolean', default: true },
  notes: { type: 'boolean', default: false },
  queue: { type: 'boolean', default: true },
  threshold: { type: 'number', default: 80000, min: 1000 },
  bigTokens: { type: 'number', default: 150000, min: 1000 },
  auditMin: { type: 'number', default: 2000, min: 100 },
  cacheTtl: { type: 'string', default: 'auto', options: ['auto', '5', '60'] },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}
