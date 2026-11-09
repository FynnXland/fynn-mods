// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4). Ein Feld je Zeile.
import type { FieldDefs } from './settings.ts'

export const SETTINGS: FieldDefs = {
  size: { type: 'string', default: 'auto', options: ['auto', 'full', 'compact', 'mini', 'off'] },
  extraButtons: { type: 'boolean', default: false },
  beat: { type: 'boolean', default: true },
  beatOffset: { type: 'number', default: 0, min: -400, max: 400 },
  pollSeconds: { type: 'number', default: 4, min: 3, max: 10 },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}
