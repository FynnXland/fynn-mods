// quick-replies: geschätzter API-Wert der Fork-Aufrufe (ohne `$`). Nur Anzeige in /replies status; im Abo zählt der Fork gegen die
// Nutzungslimits, nicht in Dollar. Preistabelle und Rechnung wie mods/cost-ledger/hooks/logic.ts (priceFor, callCost); Imports
// zwischen Mods gibt es nicht, deshalb eine Kopie.

import type { ModelUsage } from 'claude-code'

// Dollar je Million Tokens (Stand cost-ledger 2026-09-25). Längere IDs zuerst: 'opus-5' darf 'opus-5-5' nicht schlucken.
const TABLE: readonly [string, { input: number; output: number; read: number }][] = [
  ['fable-5-1', { input: 10, output: 50, read: 0.25 }],
  ['mythos-5-1', { input: 10, output: 50, read: 0.25 }],
  ['fable-5', { input: 10, output: 50, read: 1 }],
  ['opus-5-5', { input: 4, output: 20, read: 0.2 }],
  ['opus-5', { input: 5, output: 25, read: 0.5 }],
  ['opus-4-8', { input: 5, output: 25, read: 0.5 }],
  ['opus-4-7', { input: 5, output: 25, read: 0.5 }],
  ['opus-4-6', { input: 5, output: 25, read: 0.5 }],
  ['sonnet-5-5', { input: 2, output: 10, read: 0.2 }],
  ['sonnet-5', { input: 2, output: 10, read: 0.2 }],
  ['sonnet-4-6', { input: 3, output: 15, read: 0.3 }],
  ['haiku-4-5', { input: 1, output: 5, read: 0.1 }],
]
const FAMILY: readonly [string, string][] = [
  ['fable', 'fable-5-1'],
  ['mythos', 'mythos-5-1'],
  ['opus', 'opus-5-5'],
  ['sonnet', 'sonnet-5-5'],
  ['haiku', 'haiku-4-5'],
]

/** Preis je Million Tokens für eine Modell-ID (`claude-opus-5-5-20260101`, `opus[1m]` …); unbekannt → Opus 5.5. */
export function priceFor(model: string): { input: number; output: number; read: number } {
  const id = String(model || '')
    .toLowerCase()
    .replace(/^claude-/, '')
    .replace(/\[.*?\]/g, '')
    .replace(/-\d{8}$/, '')
    .trim()
  for (const [key, p] of TABLE) if (id === key || id.startsWith(key)) return p
  for (const [fam, key] of FAMILY) {
    const hit = TABLE.find(([k]) => k === key)
    if (id.includes(fam) && hit) return hit[1]
  }
  return { input: 4, output: 20, read: 0.2 }
}

/** API-Wert eines Aufrufs in $; Cache-Schreiben wie 5-min-TTL (1,25 × Input). */
export function callCost(u: ModelUsage, model: string): number {
  const p = priceFor(model)
  return (
    (u.input_tokens * p.input + u.cache_read_input_tokens * p.read + u.cache_creation_input_tokens * p.input * 1.25 + u.output_tokens * p.output) /
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
