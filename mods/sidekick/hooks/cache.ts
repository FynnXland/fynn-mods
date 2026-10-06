// sidekick: Cache-Logik ohne `$`. KOPIE aus mods/limit-bars/hooks/cache.ts (Stand limit-bars 0.2.0, 2026-10-05), weil ein
// Hooks-Modul nur relativ innerhalb des eigenen Plugins importieren darf (CLAUDE.md). Übernommen: CacheMem, cacheState,
// observeStep, Preistabelle und Kosten (Textformate in i18n.ts). Weggelassen: Ring, Terminal-Block, Warmhalten, /cache-Karte.
// Ergänzt: Output-Preise und `completeCost` für die eigenen Modellaufrufe. Ungenutztes (readCost) weggelassen. Die Vorlage dort ist Nate Herks Cache Keeper
// (docs/vorlagen/nateherk-cache-keeper, MIT, Copyright (c) 2026 Nate Herk), Preise nach hooks/pricing.mjs:6-19.
// Änderungen an der Logik in limit-bars hierher nachziehen.

export const MIN = 60000

/** Was über den Cache dieser Session bekannt ist; persistiert in `$.store` unter `cache:<sessionId>`. */
export type CacheMem = {
  lastActivity: number // Start der letzten Anfrage, die den Cache gelesen oder geschrieben hat (die TTL läuft ab dem Start)
  ttl: 5 | 60 // gemessen oder Standard
  ttlSource: 'Standard' | 'gemessen'
  ctx: number // Eingabe gesamt der letzten Anfrage bzw. `$.session.usage().context.tokens`
  model: string
}

export function emptyMem(): CacheMem {
  return { lastActivity: 0, ttl: 60, ttlSource: 'Standard', ctx: 0, model: '' }
}

/** Gilt die gesetzte (`/sidekick ttl`) oder die gemessene/Standard-TTL, in Minuten. */
export function ttlOf(mem: CacheMem, forced: 0 | 5 | 60): 5 | 60 {
  return forced || mem.ttl
}

export type StateKind = 'unknown' | 'warm' | 'cooling' | 'cold'
export type CacheState = { kind: StateKind; left: number } // left: Restzeit in ms, negativ = seit so langem kalt

/** Zustand aus letzter Aktivität, TTL und Uhrzeit. Gelb: die letzten 5 min (bei 5-min-TTL die letzte Minute). */
export function cacheState(lastActivity: number, ttlMin: number, now: number): CacheState {
  if (!lastActivity) return { kind: 'unknown', left: 0 }
  const left = ttlMin * MIN - (now - lastActivity)
  if (left <= 0) return { kind: 'cold', left }
  if (left <= (ttlMin >= 60 ? 5 : 1) * MIN) return { kind: 'cooling', left }
  return { kind: 'warm', left }
}

export type StepUsage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string }

export function totalInput(u: StepUsage): number {
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
}

/**
 * Wertet eine Anfrage der Hauptschleife aus (Start `startedAt`). Ein Neuschreiben nach 5,5 bis 60 min Pause zeigt 5-min-TTL,
 * ein Treffer nach mehr als 5,5 min beweist 60. Die erste Anfrage nach `/compact` schreibt den kürzeren Kontext neu: erwartet,
 * kein kalter Neustart. Rückgabe: neuer Stand und ob es ein kalter Neustart war (geschriebene Tokens).
 */
export function observeStep(mem: CacheMem, u: StepUsage, startedAt: number, afterCompact: boolean): { mem: CacheMem; coldWritten: number } {
  const total = totalInput(u)
  const written = u.cache_creation_input_tokens || 0
  const read = u.cache_read_input_tokens || 0
  const gap = mem.lastActivity ? startedAt - mem.lastActivity : 0
  const next: CacheMem = { ...mem, lastActivity: startedAt, ctx: total, model: u.model || mem.model }
  let coldWritten = 0
  if (!afterCompact && mem.lastActivity && total > 30000) {
    if (written / total > 0.5) {
      coldWritten = written
      if (gap > 5.5 * MIN && gap < 60 * MIN) {
        next.ttl = 5
        next.ttlSource = 'gemessen'
      }
    } else if (gap > 5.5 * MIN && read / total > 0.8) {
      next.ttl = 60
      next.ttlSource = 'gemessen'
    }
  }
  return { mem: next, coldWritten }
}

// Dollar je Million Tokens (Claude-API-Preistabelle, Stand 2026-09-25). Schreiben kostet 1,25 × Input (5-min-TTL) bzw. 2 × (1 h).
// Längere IDs zuerst: 'opus-5' darf 'opus-5-5' nicht schlucken. `output` ergänzt aus pricing.mjs:6-19.
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

/** Preis je Million Tokens für eine Modell-ID (`claude-opus-5-5`, `claude-haiku-4-5-20251001`, `opus[1m]` …). */
export function priceFor(model: string): { id: string; input: number; output: number; read: number } {
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

/** Neuschreiben von `tokens` (API-Wert in $). */
export function rewriteCost(tokens: number, model: string, ttlMin: number): number {
  return ((tokens || 0) * priceFor(model).input * (ttlMin >= 60 ? 2 : 1.25)) / 1e6
}

export type CompleteUsage = StepUsage & { output_tokens: number }

/** Kosten eines eigenen `$.model.complete` (API-Wert in $); Schreiben wie 5-min-TTL, das ist der Standard der API. */
export function completeCost(u: CompleteUsage | undefined, model: string): number {
  if (!u) return 0
  const p = priceFor(model)
  return (
    ((u.input_tokens || 0) * p.input +
      (u.cache_read_input_tokens || 0) * p.read +
      (u.cache_creation_input_tokens || 0) * p.input * 1.25 +
      (u.output_tokens || 0) * p.output) /
    1e6
  )
}

/** `150k`, `1.5m`, `200000` → Tokens; sonst null. */
export function parseTokens(text: string): number | null {
  const m = String(text || '').trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*([km]?)$/)
  if (!m) return null
  const n = Math.round(Number(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1))
  return n > 0 ? n : null
}

/** Gespeicherten Stand absichern; null bei Unbrauchbarem. */
export function cleanMem(v: unknown): (CacheMem & { savedAt: number }) | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  if (!o || typeof o.lastActivity !== 'number') return null
  return {
    lastActivity: o.lastActivity,
    ttl: o.ttl === 5 ? 5 : 60,
    ttlSource: o.ttlSource === 'gemessen' ? 'gemessen' : 'Standard',
    ctx: typeof o.ctx === 'number' ? o.ctx : 0,
    model: typeof o.model === 'string' ? o.model : '',
    savedAt: typeof o.savedAt === 'number' ? o.savedAt : o.lastActivity,
  }
}

const two = (n: number) => String(n).padStart(2, '0')
export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Lokales Datum `JJJJ-MM-TT`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
