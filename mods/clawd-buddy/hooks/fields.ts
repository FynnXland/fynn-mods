// fields.ts: die userConfig-Felder dieser Mod, gleich .claude-plugin/plugin.json (scripts/check-mods.ps1 vergleicht Typ, Standard,
// Grenzen und Auswahl; docs/SETTINGS-SPEC.md §4). Ein Feld je Zeile.
import type { FieldDefs } from './settings.ts'

export const SETTINGS: FieldDefs = {
  enabled: { type: 'boolean', default: true },
  side: { type: 'string', default: 'right', options: ['right', 'left'] },
  reducedMotion: { type: 'boolean', default: false },
  idleSeconds: { type: 'number', default: 45, min: 10, max: 600 },
  nightStart: { type: 'number', default: 23, min: 0, max: 23 },
  nightEnd: { type: 'number', default: 6, min: 0, max: 23 },
  iceWhenCold: { type: 'boolean', default: true },
  birthday: { type: 'string', default: '' },
  language: { type: 'string', default: 'en', options: ['en', 'de'] },
}
