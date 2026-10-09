// quick-replies: geschätzter API-Wert der Fork-Aufrufe (ohne `$`). Nur Anzeige in /replies status; im Abo zählt der Fork gegen die
// Nutzungslimits, nicht in Dollar. Preistabelle und Rechnung wie mods/cost-ledger/hooks/logic.ts (priceFor, callCost); Imports
// zwischen Mods gibt es nicht, deshalb eine Kopie.

import type { ModelUsage } from 'claude-code'

// Dollar je Million Tokens. haiku-5-5 und sonnet-5-5: Stand 2026-10-07 (platform.claude.com/docs/en/about-claude/pricing,
// SPEC Nachtrag 0.4.3); übrige Zeilen aus mods/sidekick/hooks/cache.ts, Stand 2026-09-25. Kopie von cost-ledger 0.4.3, mit zwei
// Abweichungen: `bareId` steht in `priceFor`, und `callCost` nimmt `ModelUsage` mit Pflichtfeldern (types@2.1.291:6214-6236;
// gebucht wird nur, wenn der Fork `usage` liefert).
// Längere IDs zuerst: 'opus-5' darf 'opus-5-5' nicht schlucken. `long`: ab `above` Prompt-Tokens gilt das `factor`-Fache für
// den ganzen Aufruf (Haiku 5.5: zweite Preiszeile „for prompts over 100,000 tokens“, alle Spalten ×5).
type Price = { input: number; output: number; read: number; long?: { above: number; factor: number } }
const TABLE: readonly [string, Price][] = [
  ['fable-5-1', { input: 10, output: 50, read: 0.25 }],
  ['mythos-5-1', { input: 10, output: 50, read: 0.25 }],
  ['fable-5', { input: 10, output: 50, read: 1 }],
  ['opus-5-5', { input: 4, output: 20, read: 0.2 }],
  ['opus-5', { input: 5, output: 25, read: 0.5 }],
  ['opus-4-8', { input: 5, output: 25, read: 0.5 }],
  ['opus-4-7', { input: 5, output: 25, read: 0.5 }],
  ['opus-4-6', { input: 5, output: 25, read: 0.5 }],
  ['sonnet-5-5', { input: 2, output: 10, read: 0.1 }],
  ['sonnet-5', { input: 2, output: 10, read: 0.2 }],
  ['sonnet-4-6', { input: 3, output: 15, read: 0.3 }],
  ['haiku-5-5', { input: 0.1, output: 0.5, read: 0.01, long: { above: 100_000, factor: 5 } }],
  ['haiku-4-5', { input: 1, output: 5, read: 0.1 }],
]
// Alias → Eintrag, wie cost-ledger (a57f8d4): `haiku` ist Haiku 5.5 (Probe 2.1.295; Haiku 5.5 als Hauptmodell ab 2.1.293,
// rel/advisor.md:110), bis 2.1.291 war es Haiku 4.5. Der Fork läuft auf dem Modell der Hauptschleife (types@2.1.295:2620-2624);
// quick-replies kennt es als API-ID aus turn.complete (types@2.1.295:13654, :13658-13660), die die TABLE direkt trifft.
const FAMILY: readonly [string, string][] = [
  ['fable', 'fable-5-1'],
  ['mythos', 'mythos-5-1'],
  ['opus', 'opus-5-5'],
  ['sonnet', 'sonnet-5-5'],
  ['haiku', 'haiku-5-5'],
]

/** Preis je Million Tokens für eine Modell-ID oder einen Alias (`claude-opus-5-5-20260101`, `opus[1m]` …); unbekannt → Opus 5.5. */
export function priceFor(model: string): { id: string } & Price {
  const id = String(model || '')
    .toLowerCase()
    .replace(/^claude-/, '')
    .replace(/\[.*?\]/g, '')
    .replace(/-\d{8}$/, '')
    .trim()
  for (const [key, p] of TABLE) if (id === key || id.startsWith(key)) return { id: key, ...p }
  for (const [fam, key] of FAMILY) {
    const hit = TABLE.find(([k]) => k === key)
    if (id.includes(fam) && hit) return { id: key, ...hit[1] }
  }
  return { id: 'opus-5-5', input: 4, output: 20, read: 0.2 }
}

/**
 * API-Wert in $; Cache-Schreiben wie 5-min-TTL (1,25 × Input).
 * Preisstufe (`long`) nur bei `single`, also wenn `u` genau eine Anfrage ist. Die Usage eines Forks ist eine Summe über mehrere
 * Antworten (types@2.1.291:6079); dort wäre die Summe kein Prompt, also Faktor 1. quick-replies bucht nur Forks und übergibt
 * `single` deshalb nie; der Parameter bleibt, damit die Rechnung eine Kopie von cost-ledger bleibt.
 * Prompt = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Dass Cache-Tokens mitzählen, ist ein Schluss
 * aus zwei Seiten, wörtlich steht es nirgends: die Preisseite (…/about-claude/pricing) nennt nur „prompt“, die Seite
 * …/build-with-claude/context-windows sagt „all three count toward the window“.
 */
export function callCost(u: ModelUsage, model: string, single = false): number {
  const p = priceFor(model)
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const factor = single && p.long && prompt > p.long.above ? p.long.factor : 1
  return (
    (factor *
      (u.input_tokens * p.input + u.cache_read_input_tokens * p.read + u.cache_creation_input_tokens * p.input * 1.25 + u.output_tokens * p.output)) /
    1e6
  )
}

/** Summe der Fork-Aufrufe eines Chats. */
export type ForkCost = { calls: number; usd: number; tokens: number; cached: number }

export const NO_COST: ForkCost = { calls: 0, usd: 0, tokens: 0, cached: 0 }

export function addCall(sum: ForkCost, u: ModelUsage, model: string): ForkCost {
  return {
    calls: sum.calls + 1,
    usd: sum.usd + callCost(u, model),
    tokens: sum.tokens + u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    cached: sum.cached + u.cache_read_input_tokens,
  }
}
