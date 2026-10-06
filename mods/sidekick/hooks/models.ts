// sidekick: welches Modell welche Rolle übernimmt (SPEC Nachtrag 0.4.0). Eine Konstante je Rolle; Aufruf, Kostenbuchung,
// Kostenschätzung und die sichtbaren Namen („Sonnets Fassung“) folgen ihr.
import { priceFor } from './cache.ts'

/**
 * Prüfung vor dem Senden. Sonnet 5.5 mit effort `low` statt Haiku nach der Probe 2026-10-06 (20 Aufrufe, Claude Code 2.1.290):
 * alle in ≤ 6 s (Median 1,8 s, höchstens 2,0 s), JSON immer vollständig, höchstens 236 Ausgabe-Tokens, ≈ 0,01 $ je Prüfung.
 */
export const CHECK = { model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 400, timeoutMs: 6000 } as const

/** Übergabe für „Neuer Chat mit Übergabe“ (Probe 2026-10-06: 8 s, 781 Ausgabe-Tokens). */
export const HANDOFF = { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 3000, timeoutMs: 45000 } as const

const NAMES: readonly [string, string][] = [
  ['fable', 'Fable'],
  ['mythos', 'Mythos'],
  ['opus', 'Opus'],
  ['sonnet', 'Sonnet'],
  ['haiku', 'Haiku'],
]

/** Kurzer Name für Texte: `claude-sonnet-5-5` → `Sonnet`. */
export function modelName(model: string): string {
  const id = priceFor(model).id
  return NAMES.find(([k]) => id.startsWith(k))?.[1] ?? id
}

/** Name mit Version für /savings: `claude-sonnet-5-5` → `Sonnet 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`. */
// Aus der ID selbst, nicht aus der Preistabelle: Ein neues Modell (z. B. `claude-haiku-5`) soll nicht als „Haiku 4.5“ erscheinen.
export function modelLabel(model: string): string {
  const id = String(model || '').toLowerCase().trim().replace(/^claude-/, '').replace(/\[.*?\]/g, '').replace(/-\d{8}$/, '')
  const [fam = '', ...ver] = id.split('-')
  const name = NAMES.find(([k]) => k === fam)?.[1] ?? (fam ? fam[0]!.toUpperCase() + fam.slice(1) : '?')
  return ver.length && ver.every((x) => /^\d+$/.test(x)) ? `${name} ${ver.join('.')}` : [name, ...ver].join(' ')
}

/** Deutscher Genitiv: „Sonnets“, aber „Opus’“. */
export const genitiveDe = (name: string) => (/[sßxz]$/i.test(name) ? `${name}’` : `${name}s`)

export const CHECK_NAME = modelName(CHECK.model)
export const CHECK_GEN_DE = genitiveDe(CHECK_NAME)
export const HANDOFF_NAME = modelName(HANDOFF.model)
