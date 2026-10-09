// cost-ledger: reine Logik ohne $ (Buchen, Aggregieren, Preise, Kurzfassung). Alles hier ist ohne Engine testbar.
import { T, clock, dateTime, duration, factor, fullDate, langOf, pct, rangeLabel, resetTime, shortDate, span, tokens, usd, weekLabel } from './i18n.ts'
import type { Lang } from './i18n.ts'
import type { HelpData } from './help.ts'

export const DAY = 24 * 60 * 60 * 1000

export type Kind = 'desktop' | 'terminal' | 'script'
/** Je Mod und Tag; ältere Einträge haben nur usd/calls, keine Tokens. */
export type ModDay = { usd: number; calls: number; in?: number; out?: number; cr?: number; cw?: number }
/**
 * Aktivität je Tag (vorsorglich gesammelt): Antworten der Hauptschleife, Subagent-Turns, Arbeitszeit in ms, Abbrüche,
 * Fehler/Ablehnungen, teuerste Antwort in $, höchste Kontext-Füllung in %.
 */
export type ActDay = { turns: number; sub: number; ms: number; abort: number; err: number; maxTurn: number; ctx: number }
/** Tokens und geschätzter API-Wert je Modell und Tag; `n` = Antworten bzw. Mod-Aufrufe. */
export type ModelDay = { in: number; out: number; cr: number; cw: number; usd: number; n: number }
/** Ein Datensatz pro Session unter `s:<sessionId>`; nur diese Session schreibt ihn (SPEC Zustand). */
export type Rec = {
  v: 1
  project: string
  root: string
  title: string
  kind: Kind
  firstAt: number
  lastAt: number
  /** Letzter gelesener Stand von `usage().cost.usd`; Baseline nach Resume (Resume zählt weiter). */
  c: number
  days: Record<string, number>
  mods: Record<string, { days: Record<string, ModDay> }>
  /** Je Modell (normalisierte ID, z. B. `opus-5-5`) die Antworten des Chats, auch Subagents. */
  models: Record<string, { days: Record<string, ModelDay> }>
  /** Je Modell die Modellaufrufe anderer Mods. */
  modModels: Record<string, { days: Record<string, ModelDay> }>
  /** Vorsorglich gesammelt: Aktivität je Tag, Chat-Kosten je Tag und Stunde (`HH`), Limit-Stände je Tag. */
  act: Record<string, ActDay>
  hours: Record<string, Record<string, number>>
  /** Höchster gesehener `percentUsed` je Limit-Fenster (`kind`, z. B. `five_hour`) und Tag. */
  rl: Record<string, Record<string, number>>
  /**
   * Je Limit-Fenster (`five_hour`, `seven_day`) und Reset-Zeitpunkt (ms, auf die Minute gerundet, als String) der API-Wert,
   * der in dieses Fenster fiel (SPEC Nachtrag 0.5.0).
   */
  lim: Record<string, Record<string, LimWin>>
  /** Git-Remote des Projekts als `host/owner/repo`, ohne Zugangsdaten. */
  remote: string
}
/** Ein Limit-Fenster im Datensatz: API-Wert aus Chat und Mods, höchster `percentUsed`, erste und letzte Buchung. */
export type LimWin = { chat: number; mod: number; pct: number; first: number; last: number }

export type Settings = { keepDays: number; dayYellow: number; dayRed: number; lang: Lang }
const DEFAULTS: Settings = { keepDays: 365, dayYellow: 3, dayRed: 8, lang: 'en' }

// Wörter, die `/ledger` annimmt. Parser, Hilfe und ein Test nutzen dieselben Listen: Was der Parser neu lernt, muss in
// der Hilfe stehen, sonst scheitert der Test (docs/HELP-SPEC.md §6 Punkt 5). Deutsche Wörter sind Aliase (release/I18N.md §3).
export const HELP_WORDS: readonly string[] = ['help', 'hilfe', '?']
export const VIEW_WORDS: readonly string[] = ['weeks', 'chats', 'projects', 'models', 'limits']
export const RANGE_WORDS: readonly string[] = ['all', 'alle']
export const TODAY_WORDS: readonly string[] = ['today', 'heute']
export const OFF_WORDS: readonly string[] = ['off', 'aus']

function num(v: unknown, def: number, min: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n >= min ? n : def
}

/** userConfig aus `register(on, options)`; unbrauchbare Werte fallen auf den Standard zurück. */
export function cleanSettings(o: Readonly<Record<string, unknown>> | undefined): Settings {
  const s = {
    keepDays: Math.round(num(o?.keepDays, DEFAULTS.keepDays, 1)),
    dayYellow: num(o?.dayYellow, DEFAULTS.dayYellow, 0),
    dayRed: num(o?.dayRed, DEFAULTS.dayRed, 0),
    lang: langOf(o?.language),
  }
  if (s.dayRed < s.dayYellow) s.dayRed = s.dayYellow
  return s
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Lokales Datum `YYYY-MM-DD` zu einem Zeitpunkt aus `$.clock.now()`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Tag `n` Tage vor `ms` (lokal, über Mittag gerechnet, damit Zeitumstellungen nicht verrutschen). */
export function dayBefore(ms: number, n: number): string {
  const d = new Date(ms)
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).getTime())
}

// Dollar je Million Tokens. haiku-5-5 und sonnet-5-5: Stand 2026-10-07 (platform.claude.com/docs/en/about-claude/pricing,
// SPEC Nachtrag 0.4.3); übrige Zeilen aus mods/sidekick/hooks/cache.ts, Stand 2026-09-25.
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
// Alias → Eintrag. `haiku` ist seit Claude Code 2.1.293 Haiku 5.5 (Probe 2.1.295: `claude -p --model haiku` →
// `claude-haiku-5-5`, SPEC Nachtrag 0.6.0); bis 2.1.291 war es Haiku 4.5. Das Ergebnis eines Mod-Aufrufs nennt das
// aufgelöste Modell nicht (types ModelUsage), deshalb gilt die Zuordnung der getesteten Version.
const FAMILY: readonly [string, string][] = [
  ['fable', 'fable-5-1'],
  ['mythos', 'mythos-5-1'],
  ['opus', 'opus-5-5'],
  ['sonnet', 'sonnet-5-5'],
  ['haiku', 'haiku-5-5'],
]

/** `claude-opus-5-5-20260101` → `opus-5-5` (ohne Präfix, Kontext-Zusatz und Datum). */
function bareId(model: string): string {
  return String(model || '')
    .toLowerCase()
    .replace(/^claude-/, '')
    .replace(/\[.*?\]/g, '')
    .replace(/-\d{8}$/, '')
    .trim()
}

/** Preis je Million Tokens für eine Modell-ID oder einen Alias (`haiku`, `claude-opus-5-5`, `opus[1m]` …). */
export function priceFor(model: string): { id: string } & Price {
  const id = bareId(model)
  for (const [key, p] of TABLE) if (id === key || id.startsWith(key)) return { id: key, ...p }
  for (const [fam, key] of FAMILY) {
    const hit = TABLE.find(([k]) => k === key)
    if (id.includes(fam) && hit) return { id: key, ...hit[1] }
  }
  return { id: 'opus-5-5', input: 4, output: 20, read: 0.2 }
}

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * API-Wert in $; Cache-Schreiben wie 5-min-TTL (1,25 × Input), wie sidekick completeCost.
 * Preisstufe (`long`) nur bei `single`, also wenn `u` genau eine Anfrage ist (`model.complete`, types:2525-2528). Turn- und
 * Fork-Usage sind Summen über mehrere Antworten (types:13262, :6079); dort wäre die Summe kein Prompt, also Faktor 1.
 * Prompt = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Dass Cache-Tokens mitzählen, ist ein Schluss
 * aus zwei Seiten, wörtlich steht es nirgends: die Preisseite (…/about-claude/pricing) nennt nur „prompt“, die Seite
 * …/build-with-claude/context-windows sagt „all three count toward the window“.
 */
export function callCost(u: Usage | undefined, model: string, single = false): number {
  if (!u) return 0
  const p = priceFor(model)
  const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  const factor = single && p.long && prompt > p.long.above ? p.long.factor : 1
  return (
    (factor *
      ((u.input_tokens || 0) * p.input +
        (u.cache_read_input_tokens || 0) * p.read +
        (u.cache_creation_input_tokens || 0) * p.input * 1.25 +
        (u.output_tokens || 0) * p.output)) /
    1e6
  )
}

export function tokensOf(u: Usage | undefined): number {
  return u ? (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0
}

/** Schlüssel für Beträge ohne Modell-Daten (alte Tage). */
export const UNKNOWN_MODEL = 'unbekannt'

/**
 * Modell-Schlüssel: `claude-opus-5-5-20260101` → `opus-5-5`. Ein Alias ohne Version (`haiku`, `opus[1m]`, wie ihn Mods
 * übergeben) wird über die Preistabelle zur aktuellen Version (`haiku-5-5`, `FAMILY`), damit Turns und Mod-Aufrufe in einer Zeile
 * landen; leer → `UNKNOWN_MODEL`.
 */
export function modelKey(model: string): string {
  const id = bareId(model)
  if (!id) return UNKNOWN_MODEL
  return /^[a-z]+$/.test(id) && FAMILY.some(([fam]) => fam === id) ? priceFor(id).id : id
}

/** `opus-5-5` → `Opus 5.5`, `haiku` → `Haiku`; `UNKNOWN_MODEL` in der eingestellten Sprache. */
export function modelName(key: string, lang: Lang): string {
  if (key === UNKNOWN_MODEL) return T[lang].unknownModel
  const [fam = '', ...ver] = key.split('-')
  const name = fam ? fam[0]!.toUpperCase() + fam.slice(1) : key
  return ver.length && ver.every((x) => /^\d+$/.test(x)) ? `${name} ${ver.join('.')}` : [name, ...ver].join(' ')
}

/** `sidekick@inline` → `sidekick` */
export function pluginName(p: string): string {
  return String(p || '').replace(/@.*$/, '')
}

/**
 * Git-Remote ohne Zugangsdaten: nur `host/owner/repo`. `https://user:token@github.com/a/b.git` und `git@github.com:a/b.git`
 * werden zu `github.com/a/b`; Query und Fragment fallen weg. Tokens werden nie gespeichert (CLAUDE.md Grundregel 3).
 */
export function cleanRemote(url: string | null | undefined): string {
  let s = String(url ?? '').trim()
  if (!s) return ''
  s = s.replace(/[?#].*$/, '')
  const scp = /^[^@\s/]+@([^:/\s]+):(.+)$/.exec(s)
  if (scp) s = `${scp[1]}/${scp[2]}`
  else s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '')
  return s.replace(/\.git$/, '').replace(/\/+$/, '').slice(0, 200)
}

/** Gespeicherter Projektname, wenn es weder Repo noch Ordner gibt (bleibt aus Kompatibilität deutsch, Anzeige übersetzt). */
export const NO_FOLDER = '(ohne Ordner)'

/** Projektname: Repo-Name, sonst letzter Ordner; Worktrees unter `.claude/worktrees/` zählen zum Hauptordner. */
export function projectOf(repoName: string | null | undefined, root: string): string {
  const parts = String(root || '').split(/[\\/]+/).filter(Boolean)
  const wt = parts.findIndex((p, i) => p === '.claude' && parts[i + 1] === 'worktrees')
  const folder = wt > 0 ? parts[wt - 1] : parts[parts.length - 1]
  return (repoName && repoName.trim()) || folder || NO_FOLDER
}

/**
 * Name eines Chats aus der ersten eigenen Nachricht (der Desktop meldet den Seitenleisten-Titel nicht). Keine Befehle
 * (`/…`), keine eingespielten Blöcke (`<…>`), Leerraum zusammengezogen, höchstens 50 Zeichen.
 */
export function titleFromPrompt(prompt: string | undefined): string {
  const t = String(prompt ?? '').replace(/\s+/g, ' ').trim()
  if (!t || /^[/<!]/.test(t)) return ''
  return t.length <= 50 ? t : `${t.slice(0, 49).trimEnd()}…`
}

export function newRec(meta: { project: string; root: string; title: string; kind: Kind; remote?: string }, now: number, c: number): Rec {
  return {
    v: 1,
    project: meta.project,
    root: meta.root,
    title: meta.title,
    kind: meta.kind,
    firstAt: now,
    lastAt: now,
    c,
    days: {},
    mods: {},
    models: {},
    modModels: {},
    act: {},
    hours: {},
    rl: {},
    lim: {},
    remote: meta.remote ?? '',
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function numMap(src: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (isObj(src)) for (const [k, x] of Object.entries(src)) if (isNum(x)) out[k] = x
  return out
}

function mapOfMaps(src: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  if (isObj(src)) for (const [k, x] of Object.entries(src)) if (isObj(x)) out[k] = numMap(x)
  return out
}

function cleanModels(src: unknown): Rec['models'] {
  const out: Rec['models'] = {}
  if (isObj(src))
    for (const [name, m] of Object.entries(src)) {
      if (!isObj(m) || !isObj(m.days)) continue
      const md: Record<string, ModelDay> = {}
      for (const [k, x] of Object.entries(m.days))
        if (isObj(x) && [x.in, x.out, x.cr, x.cw, x.usd, x.n].every(isNum))
          md[k] = { in: x.in as number, out: x.out as number, cr: x.cr as number, cw: x.cw as number, usd: x.usd as number, n: x.n as number }
      out[name] = { days: md }
    }
  return out
}

function cleanLim(src: unknown): Rec['lim'] {
  const out: Rec['lim'] = {}
  if (isObj(src))
    for (const [kind, m] of Object.entries(src)) {
      if (!LIMIT_KINDS.includes(kind) || !isObj(m)) continue
      const wins: Record<string, LimWin> = {}
      for (const [k, x] of Object.entries(m))
        if (/^\d+$/.test(k) && isObj(x) && [x.chat, x.mod, x.pct, x.first, x.last].every(isNum))
          wins[k] = { chat: Math.max(0, x.chat as number), mod: Math.max(0, x.mod as number), pct: x.pct as number, first: x.first as number, last: x.last as number }
      out[kind] = wins
    }
  return out
}

/** Gelesenen Datensatz prüfen; `null` bei unbekannter Version oder kaputter Form. Fehlende Felder älterer Fassungen sind leer. */
export function cleanRec(v: unknown): Rec | null {
  if (!isObj(v) || v.v !== 1 || !isObj(v.days) || !isNum(v.firstAt) || !isNum(v.lastAt)) return null
  const days: Record<string, number> = {}
  for (const [k, x] of Object.entries(v.days)) if (/^\d{4}-\d\d-\d\d$/.test(k) && isNum(x) && x >= 0) days[k] = x
  const mods: Rec['mods'] = {}
  if (isObj(v.mods))
    for (const [name, m] of Object.entries(v.mods)) {
      if (!isObj(m) || !isObj(m.days)) continue
      const md: Record<string, ModDay> = {}
      for (const [k, x] of Object.entries(m.days))
        if (isObj(x) && isNum(x.usd) && isNum(x.calls)) {
          const t = numMap(x)
          md[k] = { usd: Math.max(0, x.usd), calls: Math.max(0, x.calls), ...(isNum(t.in) ? { in: t.in, out: t.out ?? 0, cr: t.cr ?? 0, cw: t.cw ?? 0 } : {}) }
        }
      mods[name] = { days: md }
    }
  const act: Record<string, ActDay> = {}
  if (isObj(v.act))
    for (const [k, x] of Object.entries(v.act)) {
      const n = numMap(x)
      act[k] = { turns: n.turns ?? 0, sub: n.sub ?? 0, ms: n.ms ?? 0, abort: n.abort ?? 0, err: n.err ?? 0, maxTurn: n.maxTurn ?? 0, ctx: n.ctx ?? 0 }
    }
  return {
    v: 1,
    project: typeof v.project === 'string' && v.project ? v.project : NO_FOLDER,
    root: typeof v.root === 'string' ? v.root : '',
    title: typeof v.title === 'string' ? v.title : '',
    kind: v.kind === 'desktop' || v.kind === 'script' ? v.kind : 'terminal',
    firstAt: v.firstAt,
    lastAt: v.lastAt,
    c: isNum(v.c) ? v.c : 0,
    days,
    mods,
    models: cleanModels(v.models),
    modModels: cleanModels(v.modModels),
    act,
    hours: mapOfMaps(v.hours),
    rl: mapOfMaps(v.rl),
    lim: cleanLim(v.lim),
    remote: typeof v.remote === 'string' ? cleanRemote(v.remote) : '',
  }
}

// ---------- Buchen ----------

/** Neue Baseline nach Start oder Resume: der gespeicherte Stand, wenn er zum Zähler passt, sonst der Zähler selbst. */
export function baselineFor(rec: Rec | null, cost: number): number {
  return rec && rec.c > 0 && rec.c <= cost ? rec.c : cost
}

/** Differenz zum letzten Stand; fällt der Zähler, beginnt er neu bei 0. */
export function deltaOf(seen: number, cost: number): { delta: number; seen: number } {
  const base = cost < seen ? 0 : seen
  return { delta: Math.max(0, cost - base), seen: cost }
}

/** Auf 1e-8 $ runden: hält die Datensätze kurz (Gleitkomma-Reste wie 0.13945199999999998), ohne sichtbaren Fehler. */
const r8 = (v: number) => Math.round(v * 1e8) / 1e8

export function bookChat(rec: Rec, day: string, delta: number, now: number, cost: number): void {
  if (delta > 0) {
    rec.days[day] = r8((rec.days[day] ?? 0) + delta)
    const h = (rec.hours[day] ??= {})
    const hour = pad(new Date(now).getHours())
    h[hour] = r8((h[hour] ?? 0) + delta)
  }
  rec.c = cost
  rec.lastAt = now
}

export function bookMod(rec: Rec, name: string, day: string, amount: number, now: number, u?: Usage): void {
  const m = (rec.mods[name] ??= { days: {} })
  const d = (m.days[day] ??= { usd: 0, calls: 0 })
  d.usd = r8(d.usd + Math.max(0, amount))
  d.calls += 1
  if (u) {
    d.in = (d.in ?? 0) + (u.input_tokens || 0)
    d.out = (d.out ?? 0) + (u.output_tokens || 0)
    d.cr = (d.cr ?? 0) + (u.cache_read_input_tokens || 0)
    d.cw = (d.cw ?? 0) + (u.cache_creation_input_tokens || 0)
  }
  rec.lastAt = now
}

/** Eine Antwort (`models`) oder einen Mod-Aufruf (`modModels`) je Modell buchen; Betrag geschätzt nach Preistabelle. */
export function bookModel(rec: Rec, model: string, day: string, u: Usage | undefined, now: number, into: 'models' | 'modModels' = 'models', single = false): void {
  if (!u) return
  const m = (rec[into][modelKey(model)] ??= { days: {} })
  const d = (m.days[day] ??= { in: 0, out: 0, cr: 0, cw: 0, usd: 0, n: 0 })
  d.in += u.input_tokens || 0
  d.out += u.output_tokens || 0
  d.cr += u.cache_read_input_tokens || 0
  d.cw += u.cache_creation_input_tokens || 0
  d.usd = r8(d.usd + callCost(u, model, single))
  d.n += 1
  rec.lastAt = now
}

export type TurnInfo = { agentId?: string; durationMs?: number; reason?: string; isAborted?: boolean }

/** Aktivität eines Turns: Antwort oder Subagent, Dauer, Abbruch/Fehler, teuerste Antwort, Kontext-Spitze. */
export function bookTurn(rec: Rec, day: string, t: TurnInfo, delta: number, ctxPct: number | undefined): void {
  const a = (rec.act[day] ??= { turns: 0, sub: 0, ms: 0, abort: 0, err: 0, maxTurn: 0, ctx: 0 })
  if (t.agentId) a.sub += 1
  else {
    a.turns += 1
    a.ms += Math.max(0, Math.round(t.durationMs || 0))
    if (delta > a.maxTurn) a.maxTurn = r8(delta)
  }
  if (t.isAborted || t.reason === 'aborted') a.abort += 1
  if (t.reason === 'error' || t.reason === 'refusal') a.err += 1
  if (isNum(ctxPct) && ctxPct > a.ctx) a.ctx = Math.round(ctxPct)
}

/** Höchster Limit-Stand des Tages je Fenster (5 Stunden, Woche …), für spätere Auswertungen. */
export function bookRate(rec: Rec, day: string, limits: readonly { kind: string; percentUsed: number }[] | undefined): void {
  for (const l of limits ?? []) {
    if (!l || typeof l.kind !== 'string' || !isNum(l.percentUsed)) continue
    const d = (rec.rl[day] ??= {})
    const v = Math.round(l.percentUsed * 10) / 10
    if (!(d[l.kind]! >= v)) d[l.kind] = v
  }
}

// ---------- Limit-Fenster und Abo (SPEC Nachtrag 0.5.0) ----------

/** Fenster, die gebucht werden; `spend_limit` (Gateway) und Unbekanntes bleiben außen vor (types:10953). */
export const LIMIT_KINDS: readonly string[] = ['five_hour', 'seven_day']
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
/**
 * Je Fenster: Länge (aus dem Namen abgeleitet, nur für Beschriftung und „unvollständig“), Toleranz beim Zusammenlegen in
 * der Aggregation (Absicherung, Phase 0: `resetsAt` war über Antworten und parallele Sessions gleich) und wie viele
 * Einträge ein Datensatz höchstens behält.
 */
const LIM: Record<string, { span: number; tol: number; keep: number }> = {
  five_hour: { span: 5 * HOUR, tol: 10 * MINUTE, keep: 60 },
  seven_day: { span: 7 * DAY, tol: 60 * MINUTE, keep: 12 },
}

/** Ein Fenster, wie `usage().rateLimits` es zuletzt meldete; `resetsAt` in ms. */
export type Limit = { kind: string; pct: number; resetsAt: number }
/** Beträge, die auf das nächste gültige Fenster warten (Fenster abgelaufen oder noch unbekannt). */
export type Carry = Record<string, { chat: number; mod: number }>

/** `five_hour` und `seven_day` mit Zahl und parsebarem `resetsAt` (types:10948-10966); sonst nichts. */
export function limitsOf(rl: readonly { kind: string; percentUsed: number; resetsAt?: string }[] | undefined): Limit[] {
  const out: Limit[] = []
  for (const l of rl ?? []) {
    if (!l || !LIMIT_KINDS.includes(l.kind) || !isNum(l.percentUsed) || out.some((x) => x.kind === l.kind)) continue
    const at = typeof l.resetsAt === 'string' ? Date.parse(l.resetsAt) : NaN
    if (Number.isFinite(at)) out.push({ kind: l.kind, pct: l.percentUsed, resetsAt: at })
  }
  return out
}

/** Schlüssel eines Fensters: `resetsAt` auf die volle Minute gerundet, als String (ms). */
export function limKey(resetsAt: number): string {
  return String(Math.round(resetsAt / MINUTE) * MINUTE)
}

/**
 * Betrag (`chat`: Delta wie in `bookChat`, `mod`: Mod-Aufruf) dem laufenden Fenster je Art gutschreiben und dessen
 * `percentUsed` als Höchstwert merken. Ist das Fenster abgelaufen (`now ≥ resetsAt`) oder unbekannt, wartet der Betrag in
 * `carry` und kommt beim nächsten gültigen Fenster dazu. Je Datensatz bleiben die neuesten 60 bzw. 12 Fenster.
 * Gibt zurück, ob ein Fenster gebucht wurde.
 */
export function bookLim(rec: Rec, limits: readonly Limit[], now: number, part: 'chat' | 'mod', amount: number, carry: Carry): boolean {
  const v = Math.max(0, amount || 0)
  let booked = false
  for (const kind of LIMIT_KINDS) {
    const l = limits.find((x) => x.kind === kind)
    if (!l || now >= l.resetsAt) {
      if (v > 0) {
        const c = (carry[kind] ??= { chat: 0, mod: 0 })
        c[part] = r8(c[part] + v)
      }
      continue
    }
    const wins = (rec.lim[kind] ??= {})
    const e = (wins[limKey(l.resetsAt)] ??= { chat: 0, mod: 0, pct: 0, first: now, last: now })
    const c = carry[kind]
    if (c) {
      e.chat = r8(e.chat + c.chat)
      e.mod = r8(e.mod + c.mod)
      delete carry[kind]
    }
    e[part] = r8(e[part] + v)
    if (l.pct > e.pct) e.pct = l.pct
    e.last = now
    booked = true
    const keys = Object.keys(wins).sort((a, b) => Number(a) - Number(b))
    for (const k of keys.slice(0, Math.max(0, keys.length - LIM[kind]!.keep))) delete wins[k]
  }
  return booked
}

/**
 * Nachbuchung beim Start (Rest nach der letzten Buchung, z. B. nach hartem Ende und `--resume`): Sie gehört in das Fenster,
 * in das die letzte Buchung `at` fiel, nicht ins laufende. Gibt es dort keinen Eintrag (Buchung vor 0.5.0, ohne Abo),
 * bleibt der Betrag nur im Tag.
 */
export function bookLimAt(rec: Rec, at: number, amount: number): void {
  if (!(amount > 0)) return
  for (const kind of LIMIT_KINDS) {
    const wins = rec.lim[kind]
    if (!wins) continue
    let hit: string | null = null
    for (const [k, e] of Object.entries(wins)) if (Number(k) > at && e.first <= at && (hit === null || Number(k) < Number(hit))) hit = k
    if (hit !== null) wins[hit]!.chat = r8(wins[hit]!.chat + amount)
  }
}

/** Abo-Pläne mit Listenpreis in $ je Monat: Pro claude.com/pricing (monatlich), Max support.claude.com Artikel 11049741 (2026-10-08). */
export const PLANS: Record<string, { label: string; price?: number }> = {
  pro: { label: 'Pro', price: 20 },
  max5: { label: 'Max 5x', price: 100 },
  max20: { label: 'Max 20x', price: 200 },
  team: { label: 'Team' },
  enterprise: { label: 'Enterprise' },
}
const PLAN_ALIASES: Record<string, string> = { pro: 'pro', max5: 'max5', max5x: 'max5', '5x': 'max5', max20: 'max20', max20x: 'max20', '20x': 'max20', team: 'team', enterprise: 'enterprise' }
/** Nur eigene Schlüssel: `constructor` oder `__proto__` sind kein Plan. */
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Alle Schreibweisen eines Plans, die `/ledger plan` annimmt (für Hilfe und Vollständigkeitstest). */
export function planWords(): string[] {
  return Object.keys(PLAN_ALIASES)
}

/** `meta:plan`: Plan, Abrechnungstag, eigener Preis (ohne: Listenpreis), Zeitpunkt der Einstellung. */
export type Plan = { v: 1; plan: string; day: number; price?: number; at: number }

export function planLabel(plan: string): string {
  return own(PLANS, plan) ? PLANS[plan]!.label : plan
}

/** Gespeicherte Einstellung prüfen; `null` bei fehlender oder kaputter. */
export function cleanPlan(v: unknown): Plan | null {
  if (!isObj(v) || v.v !== 1 || typeof v.plan !== 'string' || !own(PLANS, v.plan) || !isNum(v.day) || !isNum(v.at)) return null
  if (!Number.isInteger(v.day) || v.day < 1 || v.day > 31) return null
  return { v: 1, plan: v.plan, day: v.day, ...(isNum(v.price) && v.price > 0 ? { price: v.price } : {}), at: v.at }
}

/**
 * `/ledger plan <plan> <tag|heute> [preis]` → Einstellung, sonst `null` (dann wird nichts gespeichert). Plan in beliebiger
 * Schreibweise samt Aliasen, Tag 1–31 oder `today`/`heute`, Preis mit Komma oder Punkt, optional mit `$`.
 */
export function parsePlan(args: readonly string[], now: number): Plan | null {
  const [p = '', d = '', price, ...rest] = args.map((a) => a.trim().toLowerCase())
  const plan = own(PLAN_ALIASES, p) ? PLAN_ALIASES[p] : undefined
  if (!plan || rest.length) return null
  const day = TODAY_WORDS.includes(d) ? new Date(now).getDate() : /^\d{1,2}$/.test(d) ? Number(d) : NaN
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  if (price === undefined) return { v: 1, plan, day, at: now }
  const s = price.replace(/^\$|\$$/g, '').replace(',', '.')
  const n = /^\d{1,6}(\.\d{1,2})?$/.test(s) ? Number(s) : NaN
  return n > 0 ? { v: 1, plan, day, price: n, at: now } : null
}

/** Tag `day` im Monat (Jahr, Monat 0–11), gekürzt auf die Länge des Monats (31. → 30.09.). */
function billingDay(y: number, m: number, day: number): Date {
  const len = new Date(y, m + 1, 0, 12).getDate()
  return new Date(y, m, Math.min(day, len), 12)
}

/**
 * Laufender Abo-Monat zum Abrechnungstag: Beginn = letzter Tag ≤ heute mit dem Tag `min(day, Länge des Monats)`,
 * nächste Erneuerung einen Monat später, Resttage bis dahin (lokal, über Mittag gerechnet).
 */
export function planMonth(day: number, now: number): { start: string; next: string; daysLeft: number } {
  const t = new Date(now)
  let s = billingDay(t.getFullYear(), t.getMonth(), day)
  if (t.getDate() < s.getDate()) s = billingDay(t.getFullYear(), t.getMonth() - 1, day)
  const n = billingDay(s.getFullYear(), s.getMonth() + 1, day)
  const noon = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12).getTime()
  return { start: dayKey(s.getTime()), next: dayKey(n.getTime()), daysLeft: Math.round((n.getTime() - noon) / DAY) }
}

/** Ein Fenster in der Auswertung, über alle Datensätze summiert und zusammengelegt. */
export type LimWindow = {
  kind: string
  resetsAt: number
  /** `resetsAt` minus Fensterlänge (aus dem Namen abgeleitet) */
  start: number
  usd: number
  pct: number
  running: boolean
  /** Begann vor der ersten Fenster-Buchung (`meta:limSince`): der Betrag ist unvollständig */
  partial: boolean
  /** Hochrechnung `usd ÷ pct × 100`, erst ab 5 % und nur für vollständige Fenster */
  proj: number | null
}
export type PlanReport = {
  plan: string
  day: number
  price: number | null
  /** Kein eigener Preis: Listenpreis des Plans */
  listPrice: boolean
  start: string
  next: string
  daysLeft: number
  /** API-Wert seit Beginn des Abo-Monats aus Datensätzen, die Abo-Limits gesehen haben */
  usd: number
  factor: number | null
  /** Beginn liegt vor `meta:since`: gezählt ab diesem Tag */
  from: string | null
}
export type LimitsReport = {
  five: LimWindow | null
  week: LimWindow | null
  seenFive: boolean
  seenWeek: boolean
  /** Letzte 10 Fünf-Stunden-Fenster, neueste zuerst */
  history: LimWindow[]
  /** Ø „100 % ≈ usd“ über abgeschlossene, vollständige Fünf-Stunden-Fenster ab 20 % */
  avg: { usd: number; n: number } | null
  plan: PlanReport | null
  limSince: number | null
}

/** Hat der Datensatz je Abo-Limits gesehen? Läufe mit API-Schlüssel (ohne Limits) zählen nicht zum Abo-Monat. */
function sawLimits(rec: Rec): boolean {
  return Object.values(rec.rl).some((d) => LIMIT_KINDS.some((k) => k in d)) || Object.values(rec.lim).some((w) => Object.keys(w).length > 0)
}

/**
 * Limits und Abo für `/ledger limits` und die Zeile in der Übersicht. Je Fenster werden `chat + mod` über alle Datensätze
 * summiert, `pct` ist das Maximum (innerhalb eines Fensters steigt der Wert nur). Schlüssel, die näher als die Toleranz
 * beieinanderliegen, werden zusammengelegt. `live`: die Fenster der letzten Messung dieses Prozesses (nur für `pct`).
 */
export function limitsReport(
  recs: { rec: Rec }[],
  now: number,
  o: { plan?: Plan | null; limSince?: number | null; since?: number | null; live?: readonly Limit[] } = {},
): LimitsReport {
  const byKind = new Map<string, Map<number, { usd: number; pct: number }>>(LIMIT_KINDS.map((k) => [k, new Map()]))
  let first = Infinity
  for (const { rec } of recs)
    for (const [kind, wins] of Object.entries(rec.lim)) {
      const m = byKind.get(kind)
      if (m)
        for (const [k, w] of Object.entries(wins)) {
          const x = m.get(Number(k)) ?? { usd: 0, pct: 0 }
          x.usd += w.chat + w.mod
          x.pct = Math.max(x.pct, w.pct)
          m.set(Number(k), x)
          first = Math.min(first, w.first)
        }
    }
  for (const l of o.live ?? []) {
    const m = byKind.get(l.kind)
    if (!m || l.resetsAt <= now) continue
    const at = Number(limKey(l.resetsAt))
    const x = m.get(at) ?? { usd: 0, pct: 0 }
    x.pct = Math.max(x.pct, l.pct)
    m.set(at, x)
  }
  // Beginn der Fenster-Daten: `meta:limSince`, aber nie später als die früheste vorhandene Fenster-Buchung (setzt ein
  // Prozess den Wert erst nach Buchungen anderer Chats, z. B. nach einem Reset, würden deren Fenster sonst rückwirkend
  // unvollständig; Review 0.5.0). Ohne `meta:limSince` gilt die früheste Buchung.
  const firstAt = Number.isFinite(first) ? first : null
  const limSince = typeof o.limSince === 'number' && firstAt !== null ? Math.min(o.limSince, firstAt) : (o.limSince ?? firstAt)
  const windows = (kind: string): LimWindow[] => {
    const spec = LIM[kind]!
    const merged: { resetsAt: number; usd: number; pct: number }[] = []
    for (const [at, x] of [...byKind.get(kind)!.entries()].sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1]
      if (last && at - last.resetsAt < spec.tol) {
        last.resetsAt = at
        last.usd += x.usd
        last.pct = Math.max(last.pct, x.pct)
      } else merged.push({ resetsAt: at, usd: x.usd, pct: x.pct })
    }
    // Hochrechnung nur für vollständige Fenster: Bei einem unvollständigen fehlt der API-Wert vor `limSince`, die Prozent
    // zählen aber das ganze Fenster; die Zahl wäre systematisch zu niedrig (Smoke-Test 2026-10-08: Woche „100 % ≈ 2,37 $“).
    // Ohne gebuchten Betrag (Host ohne Kostenbuch) gibt es ebenfalls keine.
    return merged.map((w) => {
      const start = w.resetsAt - spec.span
      const partial = limSince === null || start < limSince
      return { kind, ...w, start, running: w.resetsAt > now, partial, proj: w.pct >= 5 && w.usd > 0 && !partial ? (w.usd / w.pct) * 100 : null }
    })
  }
  const five = windows('five_hour')
  const week = windows('seven_day')
  // Ø nur über die neuesten 60 Fenster: Ein Datensatz behält höchstens 60 (`bookLim`); in älteren Fenstern fehlte sonst
  // der gekürzte Betrag eines langen Chats, während andere Chats das volle `pct` liefern (Review 0.5.0)
  // Fenster ohne gebuchten Betrag (Host ohne Kostenbuch) zählen nicht
  const done = five.slice(-LIM.five_hour!.keep).filter((w) => !w.running && !w.partial && w.pct >= 20 && w.usd > 0)
  const pctSum = done.reduce((a, w) => a + w.pct, 0)

  let plan: PlanReport | null = null
  if (o.plan) {
    const pm = planMonth(o.plan.day, now)
    const today = dayKey(now)
    const inMonth = (d: string) => d >= pm.start && d <= today
    let usd = 0
    for (const { rec } of recs) {
      if (!sawLimits(rec)) continue
      for (const [d, v] of Object.entries(rec.days)) if (inMonth(d)) usd += v
      for (const m of Object.values(rec.mods)) for (const [d, v] of Object.entries(m.days)) if (inMonth(d)) usd += v.usd
    }
    const price = o.plan.price ?? PLANS[o.plan.plan]?.price ?? null
    const sinceDay = typeof o.since === 'number' ? dayKey(o.since) : null
    plan = {
      plan: o.plan.plan,
      day: o.plan.day,
      price,
      listPrice: o.plan.price === undefined && price !== null,
      ...pm,
      usd,
      factor: price ? usd / price : null,
      from: sinceDay && pm.start < sinceDay ? sinceDay : null,
    }
  }
  return {
    five: five.find((w) => w.running) ?? null,
    week: week.find((w) => w.running) ?? null,
    seenFive: five.length > 0,
    seenWeek: week.length > 0,
    history: five.slice(-10).reverse(),
    avg: pctSum > 0 ? { usd: (done.reduce((a, w) => a + w.usd, 0) / pctSum) * 100, n: done.length } : null,
    plan,
    limSince,
  }
}

// ---------- Aggregation für /ledger ----------

/** Gruppen-Schlüssel der Skript-Läufe in Projekten (Anzeige übersetzt). */
export const SCRIPT_PROJECT = ':script'

export type Window = { usd: number; chats: number; mods: number }
/** `title` leer = kein Name bekannt; die Anzeige nimmt dann „Chat vom …“ mit `firstAt`. */
export type ChatRow = { id: string; title: string; firstAt: number; project: string; usd: number; lastDay: string; kind: Kind }
export type ProjectRow = { name: string; usd: number; chats: number }
export type ModRow = { name: string; usd: number; calls: number }
export type ModelRow = { key: string; in: number; out: number; cr: number; cw: number; usd: number; n: number }
/** Ein Balken im Verlauf: Tag oder Woche (Montag), Chat- und Mod-Kosten und ihre Aufteilung nach Modell (`MOD_PART`). */
export type Bucket = { key: string; usd: number; parts: { key: string; usd: number }[] }
export type Report = {
  now: number
  since: number | null
  windows: { today: Window; d7: Window; d30: Window; all: Window }
  projects: ProjectRow[]
  chats: ChatRow[]
  mods: ModRow[]
  models: ModelRow[]
  /** Verlauf: 14 Tage bzw. 14 Wochen, jeweils neueste zuerst */
  series: { days: Bucket[]; weeks: Bucket[] }
  unreadable: number
  hasCost: boolean
  total: number
  /** Geschätzte Größe des Plugin-Speichers in Byte (Grenze 4 MiB, docs/raw/en/reference.md:294) */
  storeBytes: number
  writeError: string
  limits: LimitsReport
}

export const STORE_LIMIT = 4 * 1024 * 1024

/** `range`: Anzahl Tage einschließlich heute, oder `0` = alles. */
export function aggregate(
  recs: { id: string; rec: Rec }[],
  now: number,
  opts: {
    range?: number
    unreadable?: number
    hasCost?: boolean
    since?: number | null
    storeBytes?: number
    writeError?: string
    plan?: Plan | null
    limSince?: number | null
    live?: readonly Limit[]
  },
): Report {
  const today = dayKey(now)
  const inRange = (d: string, n: number) => (n <= 0 ? true : d >= dayBefore(now, n - 1) && d <= today)
  const range = opts.range ?? 30
  const win = (n: number): Window => {
    let sum = 0
    let chats = 0
    let mods = 0
    for (const { rec } of recs) {
      let mine = 0
      for (const [d, v] of Object.entries(rec.days)) if (inRange(d, n)) mine += v
      for (const m of Object.values(rec.mods)) for (const [d, v] of Object.entries(m.days)) if (inRange(d, n)) mods += v.usd
      sum += mine
      if (mine > 0) chats++
    }
    return { usd: sum, chats, mods }
  }

  const proj = new Map<string, ProjectRow>()
  const chats: ChatRow[] = []
  const mods = new Map<string, ModRow>()
  const models = new Map<string, ModelRow>()
  for (const { id, rec } of recs) {
    for (const [key, m] of [...Object.entries(rec.models), ...Object.entries(rec.modModels)])
      for (const [d, v] of Object.entries(m.days))
        if (inRange(d, range)) {
          const row = models.get(key) ?? { key, in: 0, out: 0, cr: 0, cw: 0, usd: 0, n: 0 }
          row.in += v.in
          row.out += v.out
          row.cr += v.cr
          row.cw += v.cw
          row.usd += v.usd
          row.n += v.n
          models.set(key, row)
        }
    let mine = 0
    let lastDay = ''
    for (const [d, v] of Object.entries(rec.days))
      if (inRange(d, range) && v > 0) {
        mine += v
        if (d > lastDay) lastDay = d
      }
    if (mine > 0) {
      const name = rec.kind === 'script' ? SCRIPT_PROJECT : rec.project
      const p = proj.get(name) ?? { name, usd: 0, chats: 0 }
      p.usd += mine
      p.chats++
      proj.set(name, p)
      chats.push({ id, title: rec.title.trim(), firstAt: rec.firstAt, project: name, usd: mine, lastDay, kind: rec.kind })
    }
    for (const [name, m] of Object.entries(rec.mods))
      for (const [d, v] of Object.entries(m.days))
        if (inRange(d, range)) {
          const row = mods.get(name) ?? { name, usd: 0, calls: 0 }
          row.usd += v.usd
          row.calls += v.calls
          mods.set(name, row)
        }
  }
  return {
    now,
    since: opts.since ?? null,
    windows: { today: win(1), d7: win(7), d30: win(30), all: win(0) },
    projects: [...proj.values()].sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name)),
    chats: chats.sort((a, b) => b.usd - a.usd || b.lastDay.localeCompare(a.lastDay)),
    mods: [...mods.values()].sort((a, b) => b.usd - a.usd || b.calls - a.calls),
    models: [...models.values()].sort((a, b) => b.usd - a.usd || b.n - a.n),
    series: seriesOf(recs, now),
    unreadable: opts.unreadable ?? 0,
    hasCost: opts.hasCost ?? true,
    total: recs.length,
    storeBytes: opts.storeBytes ?? 0,
    writeError: opts.writeError ?? '',
    limits: limitsReport(recs, now, { plan: opts.plan, limSince: opts.limSince, since: opts.since, live: opts.live }),
  }
}

/** Montag der Woche zu `YYYY-MM-DD` (lokal). */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const dt = new Date(y, m - 1, d, 12)
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
  return dayKey(dt.getTime())
}

/** ISO-Kalenderwoche zu einem Montag `YYYY-MM-DD`. */
export function isoWeek(monday: string): number {
  const [y, m, d] = monday.split('-').map(Number) as [number, number, number]
  const thu = new Date(y, m - 1, d + 3, 12) // Donnerstag derselben Woche bestimmt das Jahr
  const week1 = new Date(thu.getFullYear(), 0, 4, 12) // 4. Januar liegt immer in KW 1
  return 1 + Math.round(((thu.getTime() - week1.getTime()) / DAY - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

/** Teil eines Verlaufsbalkens, der aus Mod-Aufrufen stammt: `mod:sonnet-5-5`, ohne Modell-Daten `mod:unbekannt`. */
export const MOD_PART = 'mod:'

/** Legendentext eines Verlaufsteils: `opus-5-5` → `Opus 5.5`, `mod:sonnet-5-5` → `Sonnet 5.5 · Mods`. */
export function partLabel(key: string, lang: Lang): string {
  const t = T[lang]
  if (!key.startsWith(MOD_PART)) return key === UNKNOWN_MODEL ? t.noData : modelName(key, lang)
  const model = key.slice(MOD_PART.length)
  return model === UNKNOWN_MODEL ? t.modsNoData : t.modsPart(modelName(model, lang))
}

/**
 * Verlauf je Tag und je Woche. Die echten Chat-Kosten eines Tages werden je Chat nach den geschätzten Modell-Anteilen
 * dieses Tages aufgeteilt; ohne Modell-Daten fällt der Betrag unter `UNKNOWN_MODEL`. Dazu kommen die Mod-Aufrufe je
 * Modell als eigene Teile (`MOD_PART`); was in `mods` steht, aber nicht in `modModels` (Daten vor 0.3.0), wird
 * `mod:unbekannt`. Der Balken zeigt damit Chat + Mods, wie die Kacheln zusammen.
 */
function seriesOf(recs: { rec: Rec }[], now: number): { days: Bucket[]; weeks: Bucket[] } {
  const days = new Map(Array.from({ length: 14 }, (_, i) => [dayBefore(now, i), new Map<string, number>()] as const))
  // Gleicher Wochentag i Wochen zurück → Montag jener Woche
  const weeks = new Map(Array.from({ length: 14 }, (_, i) => [weekStart(dayBefore(now, i * 7)), new Map<string, number>()] as const))
  const add = (bucket: Map<string, number> | undefined, key: string, v: number) => {
    if (bucket && v > 0) bucket.set(key, (bucket.get(key) ?? 0) + v)
  }
  for (const { rec } of recs)
    for (const [d, chat] of Object.entries(rec.days)) {
      if (!(chat > 0)) continue
      const shares: [string, number][] = []
      for (const [k, m] of Object.entries(rec.models)) {
        const v = m.days[d]?.usd ?? 0
        if (v > 0) shares.push([k, v])
      }
      const sum = shares.reduce((a, [, v]) => a + v, 0)
      const parts: [string, number][] = sum > 0 ? shares.map(([k, v]) => [k, (chat * v) / sum]) : [[UNKNOWN_MODEL, chat]]
      for (const [k, v] of parts) {
        add(days.get(d), k, v)
        add(weeks.get(weekStart(d)), k, v)
      }
    }
  for (const { rec } of recs) {
    const modDays = new Map<string, number>()
    for (const m of Object.values(rec.mods)) for (const [d, v] of Object.entries(m.days)) modDays.set(d, (modDays.get(d) ?? 0) + v.usd)
    for (const [k, m] of Object.entries(rec.modModels))
      for (const [d, v] of Object.entries(m.days)) {
        add(days.get(d), MOD_PART + k, v.usd)
        add(weeks.get(weekStart(d)), MOD_PART + k, v.usd)
        modDays.set(d, (modDays.get(d) ?? 0) - v.usd)
      }
    // Rest ohne Modell; Rundungsreste aus r8 nicht als eigenen Teil zeigen
    for (const [d, rest] of modDays)
      if (rest > 1e-6) {
        add(days.get(d), MOD_PART + UNKNOWN_MODEL, rest)
        add(weeks.get(weekStart(d)), MOD_PART + UNKNOWN_MODEL, rest)
      }
  }
  const toBuckets = (m: Map<string, Map<string, number>>): Bucket[] =>
    [...m.entries()].map(([key, parts]) => {
      const list = [...parts.entries()].map(([k, v]) => ({ key: k, usd: v })).sort((a, b) => b.usd - a.usd)
      return { key, usd: list.reduce((a, p) => a + p.usd, 0), parts: list }
    })
  return { days: toBuckets(days), weeks: toBuckets(weeks) }
}

/** Argument `7|30|all` → Tage (0 = alles); sonst Standard 30. `alle` bleibt als Alias gültig. */
export function parseRange(a: string | undefined): number {
  const s = (a ?? '').trim().toLowerCase()
  if (RANGE_WORDS.includes(s)) return 0
  const n = Number(s)
  return Number.isInteger(n) && n > 0 && n <= 3650 ? n : 30
}

// ---------- Anzeige-Bausteine, die Text und Zeichnung teilen ----------

/** Projektname zur Anzeige: Skript-Läufe und „ohne Ordner“ in der eingestellten Sprache. */
export function projectLabel(name: string, lang: Lang): string {
  if (name === SCRIPT_PROJECT) return T[lang].scriptRuns
  if (name === NO_FOLDER) return T[lang].noFolder
  return name
}

/** Name eines Chats zur Anzeige; ohne Titel „Chat vom …“ bzw. „Chat from …“. */
export function chatLabel(c: { title: string; firstAt: number }, lang: Lang): string {
  return c.title || T[lang].chatFrom(dateTime(c.firstAt, lang))
}

/** Hinweise für Text und Zeichnung: Host ohne Kosten, unlesbare Einträge, Speicher fast voll, Schreibfehler. */
export function notesOf(r: Report, lang: Lang): string[] {
  const t = T[lang]
  const out: string[] = []
  if (!r.hasCost) out.push(t.noCost)
  if (r.unreadable) out.push(t.unreadable(r.unreadable))
  if (r.storeBytes >= STORE_LIMIT * 0.75) out.push(t.storeFull(Math.round((r.storeBytes / STORE_LIMIT) * 100)))
  if (r.writeError) out.push(t.writeFailed(r.writeError))
  return out
}

export type ViewName = 'overview' | 'chats' | 'projects' | 'models' | 'weeks' | 'limits'

/** Seit wann ein unvollständiges Fenster zählt: 5 Stunden mit Uhrzeit, Woche mit Datum. */
export function partialLabel(w: LimWindow, limSince: number | null, lang: Lang): string {
  if (!w.partial || limSince === null) return ''
  return T[lang].partialFrom(w.kind === 'five_hour' ? clock(limSince) : shortDate(dayKey(limSince), lang))
}

/** Hochrechnung „100 % ≈ …“ (als Schätzung beschriftet), sonst warum es noch keine gibt. */
export function projectionText(w: LimWindow, lang: Lang): string {
  const t = T[lang]
  if (w.proj !== null) return t.projection(usd(w.proj, lang))
  if (w.partial) return t.projectionPartial
  return w.pct >= 5 ? t.projectionNone : t.projectionLater
}

/** Teile der kompakten Limit-Zeile (Übersicht); leer, wenn es weder ein Fenster noch einen Plan gibt. */
export function limitsLineParts(l: LimitsReport, now: number, lang: Lang): string[] {
  const t = T[lang]
  const out: string[] = []
  if (l.five) out.push(`${t.fiveShort} ${pct(l.five.pct)} · ${usd(l.five.usd, lang)} · ${t.resetAt(resetTime(l.five.resetsAt, now, lang))}`)
  else if (l.seenFive) out.push(`${t.fiveShort}: ${t.resetPassedShort}`)
  if (l.week) out.push(`${t.weekShort} ${pct(l.week.pct)} · ${usd(l.week.usd, lang)}`)
  if (l.plan) out.push(`${t.planShort} ${usd(l.plan.usd, lang)}${l.plan.factor !== null ? ` = ${factor(l.plan.factor, lang)}×` : ''}`)
  return out
}

/** Abo-Monat in einer Zeile: Plan, Beginn, Erneuerung, API-Wert gegen Preis (ohne Preis kein Faktor). */
export function planLine(p: PlanReport, lang: Lang): { head: string; value: string; note: string } {
  const t = T[lang]
  const money = (v: number) => usd(v, lang)
  const value = p.price !== null && p.factor !== null ? t.planValue(money(p.usd), money(p.price), factor(p.factor, lang)) : t.planValueNoPrice(money(p.usd))
  const note = [p.listPrice ? t.listPrice : '', p.from ? t.partialFrom(shortDate(p.from, lang)) : ''].filter(Boolean).join(' · ')
  return { head: `${planLabel(p.plan)} · ${t.since(shortDate(p.start, lang))} · ${t.renews(shortDate(p.next, lang), p.daysLeft)}`, value, note }
}

/** `/ledger limits` als Text: 5 Stunden, Woche, Abo-Monat, Verlauf, Ø (ohne Kopf- und Fußzeile). */
function limitsLines(l: LimitsReport, now: number, lang: Lang): string[] {
  const t = T[lang]
  const money = (v: number) => usd(v, lang)
  const out: string[] = []
  const hasLim = l.seenFive || l.seenWeek
  if (!hasLim) out.push(t.noLimitData)
  else
    for (const [w, seen, label] of [[l.five, l.seenFive, t.fiveHours], [l.week, l.seenWeek, t.week]] as const) {
      if (!w) {
        out.push(`${label}: ${seen ? t.resetPassed : t.noWindowYet}`)
        continue
      }
      const bits = [`${label}: ${pct(w.pct)}`, money(w.usd), `${t.resetAt(resetTime(w.resetsAt, now, lang))} (${t.inTime(duration(w.resetsAt - now, lang))})`]
      bits.push(projectionText(w, lang))
      const from = partialLabel(w, l.limSince, lang)
      if (from) bits.push(from)
      out.push(bits.join(' · '))
    }
  if (l.plan) {
    const p = planLine(l.plan, lang)
    out.push(`${t.subMonth}: ${p.head} · ${p.value}${p.note ? ` (${p.note})` : ''}`)
  } else out.push(t.planNotSet)
  if (hasLim) {
    const rows = l.history.slice(0, 4).map((w) => {
      const from = partialLabel(w, l.limSince, lang)
      return `${span(w.start, w.resetsAt, lang)} ${money(w.usd)} ${pct(w.pct)}${w.running ? ` ${t.running}` : ''}${from ? ` ${from}` : ''}`
    })
    if (rows.length) out.push(`${t.lastWindows}: ${rows.join(' · ')}${l.history.length > 4 ? ` · ${t.more(l.history.length - 4)}` : ''}`)
    out.push(l.avg ? t.avg(money(l.avg.usd), l.avg.n) : t.avgNone)
  }
  return out
}

/**
 * Kurze Markdown-Fassung für Claude und für `-p` (höchstens 10 Zeilen, SPEC Verhalten 7). `tag` macht den Text eindeutig,
 * damit `ui.render` die passende Zeichnung findet.
 */
export function summaryText(r: Report, view: ViewName, range: number, tag: string, lang: Lang): string {
  const t = T[lang]
  const money = (v: number) => usd(v, lang)
  const join = <X>(rows: X[], fmt: (x: X) => string, max: number) => {
    const shown = rows.slice(0, max).map(fmt).join(' · ')
    return rows.length > max ? `${shown} · ${t.more(rows.length - max)}` : shown
  }
  const notes = notesOf(r, lang)
  // Hinweise und Fußzeile immer am Ende, auch wenn Listen gekürzt werden müssen (höchstens 10 Zeilen)
  const capped = (lines: string[], foot: string) => {
    const tail = [...notes, foot]
    return [...lines.slice(0, 10 - tail.length), ...tail].slice(0, 10).join('\n')
  }
  // Limits gibt es auch ohne Buchung (Plan eingestellt, Messung dieses Prozesses)
  if (view === 'limits') return capped([t.sumLimitsTitle(dateTime(r.now, lang), tag), ...limitsLines(r.limits, r.now, lang)], t.sumLimitsFoot)
  const lines = [t.sumTitle(dateTime(r.now, lang), tag)]
  // Die Limit-Zeile auch im Leerzustand (z. B. direkt nach /ledger reset: Plan und Messung sind noch da)
  const lim = view === 'overview' || view === 'weeks' ? limitsLineParts(r.limits, r.now, lang) : []
  if (lim.length) lines.push(t.sumLimitsLine(lim.join(' | ')))
  if (r.total === 0) return [...lines, ...notes, t.empty].join('\n')
  const w = r.windows
  if (view === 'overview' || view === 'weeks') {
    lines.push(t.sumChats(money(w.today.usd), w.today.chats, money(w.d7.usd), money(w.d30.usd), money(w.all.usd)))
    lines.push(t.sumMods(money(w.today.mods), money(w.d30.mods), money(w.all.mods)))
    if (r.projects.length) lines.push(t.sumProjects(join(r.projects, (p) => `${projectLabel(p.name, lang)} ${money(p.usd)}`, 5)))
    if (r.chats.length) lines.push(t.sumTopChats(join(r.chats, (c) => `${chatLabel(c, lang)} ${money(c.usd)}`, 3)))
    if (r.mods.length) lines.push(t.sumModsList(join(r.mods, (m) => `${m.name} ${money(m.usd)} (${m.calls}×)`, 4)))
    if (view === 'weeks') lines.push(t.sumWeeks(r.series.weeks.slice(0, 6).map((b) => `${weekLabel(isoWeek(b.key), lang)} ${money(b.usd)}`).join(' · ')))
  } else if (view === 'chats') {
    const rows = r.chats.slice(0, 20)
    lines.push(t.sumChatsHead(rangeLabel(range, lang), rows.length, r.chats.length))
    for (let i = 0; i < rows.length; i += 5)
      lines.push(rows.slice(i, i + 5).map((c, j) => `${i + j + 1}. ${chatLabel(c, lang)} (${projectLabel(c.project, lang)}) ${money(c.usd)}`).join(' · '))
  } else if (view === 'models') {
    const sum = r.models.reduce((a, m) => a + m.usd, 0)
    lines.push(t.sumModelsHead(rangeLabel(range, lang)))
    if (!r.models.length) lines.push(t.noTokens)
    for (const m of r.models.slice(0, 6)) {
      const tok = t.tokenLine(tokens(m.in, lang), tokens(m.out, lang), tokens(m.cr, lang), tokens(m.cw, lang))
      lines.push(t.sumModelLine(modelName(m.key, lang), money(m.usd), sum > 0 ? Math.round((m.usd / sum) * 100) : 0, m.n, tok))
    }
    if (r.models.length > 6) lines.push(t.sumMoreModels(r.models.length - 6))
  } else {
    lines.push(t.sumProjectsHead(rangeLabel(range, lang)))
    // Höchstens 4 Zeilen à 6; der Rest als „+N weitere“
    const shown = r.projects.slice(0, 24)
    for (let i = 0; i < shown.length; i += 6)
      lines.push(shown.slice(i, i + 6).map((p) => t.sumProjectRow(projectLabel(p.name, lang), money(p.usd), p.chats)).join(' · '))
    if (r.projects.length > shown.length) lines[lines.length - 1] += ` · ${t.more(r.projects.length - shown.length)}`
  }
  return capped(lines, t.sumFoot)
}

// ---------- /ledger help (docs/HELP-SPEC.md §5 „cost-ledger 0.6.0“) ----------

/** Was die Hilfe außer den Einstellungen braucht: Plan, Belegung des Speichers, Beginn der Erfassung. */
export type HelpInfo = { plan: Plan | null; storeBytes: number; since: number | null }

/** Zahl einer Einstellung in der Sprache: en `2.5`, de `2,5`. */
const settingNum = (v: number, lang: Lang) => (lang === 'de' ? String(v).replace('.', ',') : String(v))

/**
 * Schnappschuss für `/ledger help`: Befehle genau so, wie der Parser sie annimmt (Wörter aus `HELP_WORDS` & Co.),
 * Funktionen mit Zustand beim Aufruf, Einstellungen mit ihrem wirksamen Wert (nach `cleanSettings`).
 */
export function ledgerHelp(s: Settings, info: HelpInfo): HelpData {
  const lang = s.lang
  const t = T[lang]
  const money = (v: number) => usd(v, lang)
  const p = info.plan
  const price = p ? (p.price ?? (own(PLANS, p.plan) ? PLANS[p.plan]!.price : undefined)) : undefined
  const priceText = p ? (price === undefined ? t.noPrice : `${t.perMonth(money(price))}${p.price === undefined ? ` (${t.listPrice})` : ''}`) : ''
  const pctUsed = Math.round((Math.max(0, info.storeBytes) / STORE_LIMIT) * 100)
  return {
    mod: 'cost-ledger',
    lang,
    intro: t.helpIntro,
    commands: [
      { cmd: '/ledger', does: t.helpOverview },
      { cmd: '/ledger weeks', does: t.helpWeeks },
      { cmd: '/ledger chats|projects|models [7|30|all]', does: t.helpLists },
      { cmd: '/ledger limits', does: t.helpLimits },
      { cmd: '/ledger plan', does: t.helpPlanShow },
      { cmd: '/ledger plan <plan> <day|today> [price]', does: t.helpPlanSet },
      { cmd: '/ledger plan off', does: t.helpPlanOff },
      { cmd: '/ledger reset', does: t.helpReset },
      { cmd: '/ledger help', does: t.helpHelp },
    ],
    notes: [t.helpAliases],
    features: [
      p
        ? { name: t.helpPlanName, state: { kind: 'on', text: `${planLabel(p.plan)} · ${t.helpDay(p.day)} · ${priceText}` }, toggle: '/ledger plan off' }
        : { name: t.helpPlanName, state: { kind: 'off', text: t.helpNoPlan }, toggle: '/ledger plan max20 14' },
      { name: t.helpStorageName, state: { kind: 'value', text: t.helpStorage(pctUsed) }, toggle: t.helpInfo },
      { name: t.helpSinceName, state: { kind: 'value', text: info.since === null ? '–' : fullDate(info.since, lang) }, toggle: t.helpInfo },
    ],
    settings: [
      { title: t.setLanguage, value: lang, isDefault: lang === DEFAULTS.lang },
      { title: t.setKeepDays, value: String(s.keepDays), isDefault: s.keepDays === DEFAULTS.keepDays },
      { title: t.setDayYellow, value: settingNum(s.dayYellow, lang), isDefault: s.dayYellow === DEFAULTS.dayYellow },
      { title: t.setDayRed, value: settingNum(s.dayRed, lang), isDefault: s.dayRed === DEFAULTS.dayRed },
    ],
    footer: { terminal: t.helpFooterTerminal, desktop: t.helpFooterDesktop },
  }
}
