// limit-bars: Cache-Logik ohne `$`. Wie warm ist der Prompt-Cache dieser Session, welche Cache-Dauer (TTL) gilt, was kostet ein
// Neuschreiben, und was zeigen Ring, Terminal-Block und `/cache`. Nachgebaut nach Nate Herks Cache Keeper
// (docs/vorlagen/nateherk-cache-keeper, MIT, Copyright (c) 2026 Nate Herk): Zustände und TTL-Messung nach register.mjs:232-244 und
// :537-568, Preistabelle und Schreibfaktoren nach hooks/pricing.mjs.
import { CACHE_ARGS, T, dec, hhmm, usd } from './i18n.ts'
import type { Lang } from './i18n.ts'
import type { RingView } from './ring.ts'
import { EMPTY, GREEN, GREY, ORANGE, RED, YELLOW } from './view.ts'

export const MIN = 60000

/** Was über den Cache dieser Session bekannt ist; persistiert in `$.store` unter `cache:<sessionId>`. */
export type CacheMem = {
  lastActivity: number // Start der letzten Anfrage, die den Cache gelesen oder geschrieben hat (die TTL läuft ab dem Start)
  ttl: 5 | 60 // gemessen oder Standard
  ttlSource: 'Standard' | 'gemessen' // gespeicherte Werte, nicht übersetzen (Anzeige: cacheReport)
  ctx: number // Eingabe gesamt der letzten Anfrage bzw. `$.session.usage().context.tokens`
  model: string
}

export type Settings = {
  ttl: 0 | 5 | 60 // 0 = auto
  guard: boolean // Rückfrage vor kaltem Senden
  bigTokens: number
  alerts: boolean // Vorwarnung in der gelben Phase
}

export const DEFAULT_SETTINGS: Settings = { ttl: 0, guard: true, bigTokens: 150000, alerts: true }

export function emptyMem(): CacheMem {
  return { lastActivity: 0, ttl: 60, ttlSource: 'Standard', ctx: 0, model: '' }
}

/** Gilt die gesetzte oder die gemessene/Standard-TTL, in Minuten. */
export function ttlOf(mem: CacheMem, s: Settings): 5 | 60 {
  return s.ttl || mem.ttl
}

export type StateKind = 'unknown' | 'warm' | 'cooling' | 'cold' | 'kept'
export type CacheState = { kind: StateKind; left: number } // left: Restzeit in ms, negativ = seit so langem kalt

/** Zustand aus letzter Aktivität, TTL und Uhrzeit. Gelb: die letzten 5 min (bei 5-min-TTL die letzte Minute). */
export function cacheState(lastActivity: number, ttlMin: number, now: number, kept: boolean): CacheState {
  if (!lastActivity) return { kind: 'unknown', left: 0 }
  const left = ttlMin * MIN - (now - lastActivity)
  if (left <= 0) return { kind: 'cold', left }
  if (kept) return { kind: 'kept', left }
  if (left <= (ttlMin >= 60 ? 5 : 1) * MIN) return { kind: 'cooling', left }
  return { kind: 'warm', left }
}

export type StepUsage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string }

function totalInput(u: StepUsage): number {
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

// Dollar je Million Tokens (Claude-API-Preistabelle, Stand 2026-10-07, docs „Pricing“). Schreiben kostet 1,25 × Input
// (5-min-TTL) bzw. 2 × (1 h). Längere IDs zuerst: 'opus-5' darf 'opus-5-5' nicht schlucken.
// `long`: Haiku 5.5 kostet bei einem Prompt über 100 000 Tokens das Fünffache (0,50/0,05 statt 0,10/0,01; 1-h-Schreiben
// 1,00 statt 0,20, docs „Pricing“). Annahme (Schluss, die Preisseite zählt den Prompt nicht wörtlich aus): Prompt sind alle
// Eingabe-Tokens einer Anfrage, gecachte eingeschlossen, denn input_tokens, cache_read_input_tokens und
// cache_creation_input_tokens zählen alle zum Kontext und Caching ändert nur den Preis (docs „Context windows“). Bei
// limit-bars ist das die Kontextgröße der letzten Anfrage; die nächste ist etwas größer, knapp unter 100k ist die Stufe also
// eine Schätzung (SPEC, Bau 0.6.1).
type Price = { input: number; read: number; long?: { above: number; factor: number } }
const TABLE: readonly [string, Price][] = [
  ['fable-5-1', { input: 10, read: 0.25 }],
  ['mythos-5-1', { input: 10, read: 0.25 }],
  ['fable-5', { input: 10, read: 1 }],
  ['opus-5-5', { input: 4, read: 0.2 }],
  ['opus-5', { input: 5, read: 0.5 }],
  ['opus-4-8', { input: 5, read: 0.5 }],
  ['opus-4-7', { input: 5, read: 0.5 }],
  ['opus-4-6', { input: 5, read: 0.5 }],
  ['sonnet-5-5', { input: 2, read: 0.1 }],
  ['sonnet-5', { input: 2, read: 0.2 }],
  ['sonnet-4-6', { input: 3, read: 0.3 }],
  ['haiku-5-5', { input: 0.1, read: 0.01, long: { above: 100_000, factor: 5 } }],
  ['haiku-4-5', { input: 1, read: 0.1 }],
]
// Der Alias `haiku` ist seit Claude Code 2.1.293 Haiku 5.5 (Probe unter 2.1.295: modelUsage nur claude-haiku-5-5, Kosten zu
// den Listenpreisen von Haiku 5.5; Befund cost-ledger a57f8d4, SPEC Nachtrag 0.7.2). Volle IDs wie claude-haiku-4-5-… treffen
// weiter die Tabelle oben.
const FAMILY: readonly [string, string][] = [
  ['fable', 'fable-5-1'],
  ['mythos', 'mythos-5-1'],
  ['opus', 'opus-5-5'],
  ['sonnet', 'sonnet-5-5'],
  ['haiku', 'haiku-5-5'],
]

/**
 * Preis je Million Tokens für eine Modell-ID (`claude-opus-5-5`, `claude-haiku-4-5-20251001`, `opus[1m]` …). Mit
 * `promptTokens` gilt bei Modellen mit Stufe (Haiku 5.5) über der Grenze der höhere Preis; genau an der Grenze der normale.
 */
export function priceFor(model: string, promptTokens?: number): { id: string; input: number; read: number } {
  const id = String(model || '')
    .toLowerCase()
    .replace(/^claude-/, '')
    .replace(/\[.*?\]/g, '')
    .replace(/-\d{8}$/, '')
    .trim()
  const out = (key: string, p: Price) => {
    const f = p.long && (promptTokens ?? 0) > p.long.above ? p.long.factor : 1
    return { id: key, input: p.input * f, read: p.read * f }
  }
  for (const [key, p] of TABLE) if (id === key || id.startsWith(key)) return out(key, p)
  for (const [fam, key] of FAMILY) {
    const hit = TABLE.find(([k]) => k === key)
    if (id.includes(fam) && hit) return out(key, hit[1])
  }
  return { id: 'opus-5-5', input: 4, read: 0.2 }
}

/** Neuschreiben von `tokens` (API-Wert in $); `promptTokens` für die Preisstufe, ohne Angabe `tokens` (die Kontextgröße). */
export function rewriteCost(tokens: number, model: string, ttlMin: number, promptTokens = tokens): number {
  return ((tokens || 0) * priceFor(model, promptTokens).input * (ttlMin >= 60 ? 2 : 1.25)) / 1e6
}

/** Lesen von `tokens` aus dem Cache (API-Wert in $); `promptTokens` wie bei `rewriteCost`. */
export function readCost(tokens: number, model: string, promptTokens = tokens): number {
  return ((tokens || 0) * priceFor(model, promptTokens).read) / 1e6
}

/** Kosten einer Anfrage ohne Ausgabe (Warmhalte-Ping), API-Wert in $; die Preisstufe nach dem ganzen Prompt dieser Anfrage. */
export function inputCost(u: StepUsage, model: string, ttlMin: number): number {
  const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  const p = priceFor(u.model || model, prompt)
  return ((u.input_tokens || 0) * p.input + (u.cache_read_input_tokens || 0) * p.read + (u.cache_creation_input_tokens || 0) * p.input * (ttlMin >= 60 ? 2 : 1.25)) / 1e6
}

/** `412k`, en `1.2M` / de `1,2M`, `950` */
export function tokensText(n: number, lang: Lang): string {
  const v = Math.max(0, Math.round(n || 0))
  if (v >= 1e6) return `${dec(v / 1e6, 1, lang)}M`
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`
  if (v >= 1e3) return `${dec(v / 1e3, 1, lang)}k`
  return String(v)
}

/** Restzeit für den Ring: `42m`, `<1m` (abgerundet). */
function leftText(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / MIN)
  return m < 1 ? '<1m' : `${m}m`
}

/** Dauer in Worten: `12 min`, `2 h 5 min`, `under 1 min` (de `unter 1 min`); `long` für alt-Texte (`less than a minute`). */
export function spanText(ms: number, lang: Lang, long = false): string {
  const m = Math.floor(Math.max(0, ms) / MIN)
  if (m < 1) return long ? T[lang].underMinuteLong : T[lang].underMinute
  if (m <= 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/** Ab hier steht die Kontextzahl unter dem Ring orange (Fynn, 0.2.1); feste Grenze, keine Einstellung. */
const CTX_WARN = 80000

/** Farbe der Kontextzahl: grau unter 80k, orange ab 80k, rot ab `bigTokens` (`big`). Der Ring selbst zeigt nur den Cache. */
function contextColor(ctx: number, big: boolean): string {
  if (big) return RED
  return ctx >= CTX_WARN ? ORANGE : GREY
}

/**
 * Was der Ring zeigt; gefüllt ist der verbleibende Anteil der TTL. Kalt: ganzer Ring rot ab `bigTokens` (`big`), sonst grau
 * und leer. Vorher grau mit `–`.
 */
export function ringFor(st: CacheState, ttlMin: number, ctx: number, big: boolean, lang: Lang): RingView {
  const t = T[lang]
  const sub = ctx > 0 ? tokensText(ctx, lang) : undefined
  const subColor = contextColor(ctx, big)
  const context = ctx > 0 ? t.ringCtxAlt(tokensText(ctx, lang)) : ''
  switch (st.kind) {
    case 'unknown':
      return { fill: 0, color: EMPTY, main: '–', mainColor: GREY, kept: false, alt: t.ringUnknownAlt }
    case 'cold':
      return big
        ? { fill: 1, color: RED, main: t.cold, mainColor: RED, sub, subColor, kept: false, alt: `${t.ringColdAlt}${context}` }
        : { fill: 0, color: EMPTY, main: t.cold, mainColor: GREY, sub, subColor, kept: false, alt: `${t.ringColdAlt}${context}` }
    default: {
      const color = st.kind === 'cooling' ? YELLOW : GREEN
      return {
        fill: Math.max(0, Math.min(1, st.left / (ttlMin * MIN))),
        color,
        main: leftText(st.left),
        mainColor: color,
        sub,
        subColor,
        kept: st.kind === 'kept',
        alt: `${t.ringLeftAlt(t.state[st.kind], spanText(st.left, lang, true))}${context}`,
      }
    }
  }
}

/** Terminal: Block hinter den Balken (`◔ 42m`, `○ cold`); vor der ersten Anfrage nichts. */
export function terminalBlock(st: CacheState, big: boolean, lang: Lang): { text: string; color: string } | null {
  switch (st.kind) {
    case 'unknown':
      return null
    case 'cold':
      return { text: `○ ${T[lang].cold}`, color: big ? RED : GREY }
    case 'cooling':
      return { text: `◔ ${leftText(st.left)}`, color: YELLOW }
    default:
      return { text: `${st.kind === 'kept' ? '◆' : '◔'} ${leftText(st.left)}`, color: GREEN }
  }
}

/** `150k`, `1.5m`, `200000` → Tokens; sonst null. */
export function parseTokens(text: string): number | null {
  const m = String(text || '').trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*([km]?)$/)
  if (!m) return null
  const n = Math.round(Number(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1))
  return n > 0 ? n : null
}

/**
 * Einstellungen aus `/cache <schlüssel> <wert>`; null, wenn nichts davon passt. Englisch (`warn`, `hints`, `big`, `on`/`off`),
 * dazu die älteren Formen `guard`, `alerts` und die deutschen Aliase `warnung`, `hinweise`, `gross`/`groß`, `an`/`aus`.
 */
/** Schlüssel und feste Werte von `/cache` (exportiert für den Vollständigkeitstest der Hilfe). */
export const CACHE_WORDS = {
  ttl: ['ttl'],
  ttlValues: ['5', '60', 'auto'],
  warn: ['warn', 'guard', 'warnung'],
  hints: ['hints', 'alerts', 'hinweise'],
  big: ['big', 'gross', 'groß'],
} as const

export function applySetting(s: Settings, key: string, value: string): Settings | null {
  const onOff = value === 'on' || value === 'an' ? true : value === 'off' || value === 'aus' ? false : null
  const is = (list: readonly string[]) => list.includes(key)
  if (is(CACHE_WORDS.ttl)) {
    if (value === '5') return { ...s, ttl: 5 }
    if (value === '60') return { ...s, ttl: 60 }
    if (value === 'auto') return { ...s, ttl: 0 }
    return null
  }
  if (is(CACHE_WORDS.warn) && onOff !== null) return { ...s, guard: onOff }
  if (is(CACHE_WORDS.hints) && onOff !== null) return { ...s, alerts: onOff }
  if (is(CACHE_WORDS.big)) {
    const n = parseTokens(value)
    return n ? { ...s, bigTokens: n } : null
  }
  return null
}

/** Settings aus `$.store` absichern (fremde oder alte Werte fallen auf den Standard). */
export function cleanSettings(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    ttl: o.ttl === 5 || o.ttl === 60 ? o.ttl : 0,
    guard: typeof o.guard === 'boolean' ? o.guard : DEFAULT_SETTINGS.guard,
    bigTokens: typeof o.bigTokens === 'number' && o.bigTokens > 0 ? o.bigTokens : DEFAULT_SETTINGS.bigTokens,
    alerts: typeof o.alerts === 'boolean' ? o.alerts : DEFAULT_SETTINGS.alerts,
  }
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

export type KeepWarm = { until: number; pings: number; usd: number }

/** Wann der nächste Warmhalte-Ping fällig ist: bei 60-min-TTL 8 min vor Ablauf, bei 5-min-TTL 90 s vorher. */
export function pingDue(lastActivity: number, ttlMin: number, now: number): boolean {
  if (!lastActivity) return false
  const margin = ttlMin >= 60 ? 8 * MIN : 90000
  return now - lastActivity >= ttlMin * MIN - margin
}

/** Ein Ping, der schreibt statt zu lesen, hat den Cache verfehlt (Vorlage register.mjs:378-381). */
export function pingMissed(u: StepUsage): boolean {
  return (u.cache_creation_input_tokens || 0) > 0.1 * Math.max(1, u.cache_read_input_tokens || 0)
}

export type ReportLimit = { tag: string; pct: string; ratio: number; reset?: string }

export type Report = {
  now: number
  mem: CacheMem
  settings: Settings
  keep: KeepWarm | null
  cold: { count: number; usd: number }
  last: { read: number; written: number; at: number } | null
  limits: ReportLimit[]
  sessionUsd: number | null
  handoffAt: number | null
  lang: Lang
}

/** Balken aus Linienzeichen gleicher Höhe (━ gefüllt, ─ leer), als Inline-Code in fester Breite. Blockzeichen █/░ standen in der Desktop-Schrift verschieden hoch (Fynn, Screenshot 2026-10-05). */
export function textBar(ratio: number, width = 20): string {
  const n = Math.max(0, Math.min(width, Math.round((Number.isFinite(ratio) ? ratio : 0) * width)))
  return `\`${'━'.repeat(n)}${'─'.repeat(width - n)}\``
}

/**
 * Der Text von `/cache` als Markdown-Karte: Die Engine zeichnet Befehlsausgaben als Markdown (types@2.1.289:9512-9514).
 * Oben Zustand und Restzeit mit Balken, dann eine Tabelle mit Kosten und Messwerten, die Limits als Balken,
 * zuletzt Einstellungen und Befehle (Argumente englisch, i18n.ts `CACHE_ARGS`). Beträge sind API-Wert.
 */
export function cacheReport(r: Report): string {
  const L = r.lang
  const t = T[L]
  const ttl = ttlOf(r.mem, r.settings)
  const st = cacheState(r.mem.lastActivity, ttl, r.now, !!r.keep)
  const source = r.settings.ttl ? t.srcSet : r.mem.ttlSource === 'gemessen' ? t.srcMeasured : t.srcDefault
  const onOff = (v: boolean) => (v ? t.on : t.off)
  const perPing = usd(readCost(r.mem.ctx, r.mem.model), L)
  const out: string[] = [t.repTitle(t.state[st.kind]), '']
  if (st.kind === 'unknown') out.push(t.repUnknown)
  else if (st.kind === 'cold') out.push(`${textBar(0)}  ${t.repColdSince(spanText(-st.left, L))}`)
  else out.push(`${textBar(st.left / (ttl * MIN))}  ${t.repLeft(spanText(st.left, L), hhmm(r.mem.lastActivity + ttl * MIN))}`)
  out.push('', '| | |', '|---|---|')
  out.push(`| **${t.repTtl}** | ${ttl} min (${source}) |`)
  if (r.mem.model) out.push(`| **${t.repModel}** | ${priceFor(r.mem.model).id} |`)
  if (r.mem.ctx > 0) {
    out.push(`| **${t.repContext}** | ${t.repTokens(tokensText(r.mem.ctx, L))}${r.mem.ctx >= r.settings.bigTokens ? t.repBig : ''} |`)
    out.push(`| **${t.repNext}** | ${t.repNextValue(perPing, usd(rewriteCost(r.mem.ctx, r.mem.model, ttl), L))} |`)
  }
  if (r.last) out.push(`| **${t.repLast}** | ${t.repLastValue(hhmm(r.last.at), tokensText(r.last.read, L), tokensText(r.last.written, L))} |`)
  out.push(`| **${t.repCold}** | ${t.repColdValue(String(r.cold.count), r.cold.count ? ` · ${usd(r.cold.usd, L)}` : '')} |`)
  if (r.sessionUsd !== null) out.push(`| **${t.repSession}** | ${t.repSessionValue(usd(r.sessionUsd, L))} |`)
  out.push(
    r.keep
      ? `| **${t.repKeep}** | ${t.repKeepOn(hhmm(r.keep.until), String(r.keep.pings), usd(r.keep.usd, L), perPing)} |`
      : `| **${t.repKeep}** | ${t.off} |`,
  )
  if (r.limits.length) {
    out.push('', '**Limits**', '')
    for (const l of r.limits) out.push(`${textBar(l.ratio, 14)}  **${l.tag}** ${l.pct}${l.reset ? ` · ${l.reset}` : ''}  `)
  }
  out.push('', t.repSettings, '')
  out.push(t.repGuard(onOff(r.settings.guard), tokensText(r.settings.bigTokens, L)))
  out.push(t.repAlerts(onOff(r.settings.alerts)))
  out.push(`- ${t.repChange}: ${CACHE_ARGS.split(' · ').map((a) => `\`/cache ${a}\``).join(' · ')}`)
  out.push('', t.repCommands, '')
  out.push(r.keep ? `- \`/keepwarm off\` ${t.repKeepStop}` : `- \`/keepwarm ${t.hoursArg}\` ${t.repKeepStart(ttl >= 60 ? '52 min' : `${dec(3.5, 1, L)} min`)}`)
  out.push(`- \`/handoff\` ${t.repHandoff}${r.handoffAt ? ` · ${t.repHandoffLast(hhmm(r.handoffAt))}, \`/handoff show\`` : ''}`)
  out.push('', t.repFooter)
  return out.join('\n')
}
