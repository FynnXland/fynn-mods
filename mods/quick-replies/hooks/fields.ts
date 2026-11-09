// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4). Ein Feld je Zeile.
import type { FieldDefs } from './settings.ts'

export const SETTINGS: FieldDefs = {
  enabled: { type: 'boolean', default: true },
  more: { type: 'boolean', default: false },
  layout: { type: 'string', default: 'auto', options: ['auto', 'grid', 'list'] },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}
