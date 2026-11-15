// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4). Ein Feld je Zeile. Kein Feld mit Standard false, darum kein offdefaults.ts (SPEC).
import type { FieldDefs } from './settings.js'

export const SETTINGS: FieldDefs = {
  enabled: { type: 'boolean', default: true },
  palette: { type: 'string', default: 'herbstglut', options: ['herbstglut', 'rose-pine', 'nord', 'custom'] },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}
