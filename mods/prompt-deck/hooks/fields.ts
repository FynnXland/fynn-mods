// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4). Ein Feld je Zeile. Aus sidekick 0.27.0 übernommen (SPEC „Konfiguration“).
import type { FieldDefs } from './settings.js'

export const SETTINGS: FieldDefs = {
  laterButton: { type: 'boolean', default: true },
  promptButtons: { type: 'boolean', default: true },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}
