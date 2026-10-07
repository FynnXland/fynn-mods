// sidekick: Wartungs-Hinweise (SPEC Nachtrag 0.2.0). Reine Logik ohne `$`: Messwerte aus dem breakdown, die Regel-Tabelle,
// die Auswahl eines fälligen Hinweises und die Erkennung „erledigt“. Neue Regeln kommen als Zeile in RULES dazu.
import { dayKey } from './cache.ts'
import { shortDate, t, tokensText } from './i18n.ts'

export const RULE_IDS = ['skills-cut', 'audit', 'memory', 'skills-heavy', 'init'] as const
export type RuleId = (typeof RULE_IDS)[number]

const DAY = 24 * 60 * 60000

/** Befehle, die in dieser Session vorhanden sind (`$.command.list()`), so geschrieben, wie man sie tippt; null = fehlt. */
export type Avail = { skillDoctor: string | null; audit: string | null; memory: string | null; init: string | null }

/** Was ein Aufruf `$.session.usage({breakdown:'summary'})` hergibt, auf die Regeln zugeschnitten (types:2131-2195). */
export type Measure = {
  project: number // Tokens aller `Project`- und `Local`-Anweisungsdateien
  hasOwn: boolean // eine `Project`/`Local`-Datei liegt in der Projektwurzel oder darunter (nicht nur in einem Elternordner)
  autoMem: number | null // `MEMORY.md` (nur der Index wird geladen, rel/memory.md:534); null = kein Auto-Memory
  model: string // normalisiert, ohne `[1m]`
  skillsTotal: number
  skillsIncluded: number
  skillsTokens: number
  unused: number | null // gelistete, abschaltbare Skills ohne Nutzung seit 30 Tagen; null = nicht berechnet
  countingDays: number // seit wann sidekick Skill-Nutzung zählt, in Tagen
  sessionDays: number // verschiedene Tage mit eigenen Chats in diesem Projekt (inkl. heute)
  avail: Avail
}

export type RuleState = { doneAt?: number; doneTokens?: number; doneModel?: string; hintAt?: number }
export type Wartung = { v: 1; regeln: Partial<Record<RuleId, RuleState>>; sessions: string[] }

export type HintSettings = { on: boolean; off: RuleId[]; auditMin: number }
export const DEFAULT_HINTS: HintSettings = { on: true, off: [], auditMin: 3000 }

// Schwellen (SPEC Nachtrag, Die Regeln). Einstellbar ist nur auditMin.
export const AUDIT_GROWTH = 1.3
export const MEMORY_MIN = 1000
export const MEMORY_GROWTH = 1.4
export const MEMORY_FULL = 5000 // nahe der Ladegrenze von MEMORY.md (200 Zeilen oder 25 KB, rel/memory.md:548)
export const HEAVY_TOKENS = 4000
export const HEAVY_UNUSED = 10
export const UNUSED_DAYS = 30
export const INIT_DAYS = 3

/** `cmd`: der Befehl der Zeile (`/claude-api prompt-audit`), für den Button unter der Nachricht (Nachtrag 0.7.0). */
export type Hint = { id: RuleId; line: string; cmd?: string }

/** Befehl je Regel, null wenn er in dieser Session fehlt: für den Button und für „fehlt“ in der Statustabelle. */
const CMD_OF: Record<RuleId, (a: Avail) => string | null> = {
  'skills-cut': (a) => a.skillDoctor,
  audit: (a) => a.audit,
  memory: (a) => a.memory,
  'skills-heavy': (a) => a.skillDoctor,
  init: (a) => a.init,
}

type Rule = {
  id: RuleId
  /** Ruhezeit in Tagen, nach einem gezeigten Hinweis und nach „erledigt“. */
  rest: (m: Measure) => number
  /** Zeile, wenn fällig; sonst null. */
  due: (m: Measure, st: RuleState, s: HintSettings) => string | null
}

const pct = (now: number, then: number) => Math.round((now / then - 1) * 100)

/** Die Regeln, nach Rang (SPEC Nachtrag): Wer weiter oben steht, gewinnt, wenn mehrere fällig sind. */
export const RULES: Rule[] = [
  {
    id: 'skills-cut',
    rest: () => 7,
    due: (m) => {
      if (!m.avail.skillDoctor || !(m.skillsTotal > 0) || m.skillsIncluded >= m.skillsTotal) return null
      return t().wSkillsCut(m.skillsIncluded, m.skillsTotal, m.avail.skillDoctor)
    },
  },
  {
    id: 'audit',
    rest: () => 30,
    due: (m, st, s) => {
      if (!m.avail.audit || m.project < s.auditMin) return null
      if (!st.doneAt) return t().wAuditNever(tokensText(m.project), m.avail.audit)
      if (st.doneTokens && m.project >= AUDIT_GROWTH * st.doneTokens) return t().wAuditGrown(shortDate(st.doneAt), pct(m.project, st.doneTokens), m.avail.audit)
      if (st.doneModel && m.model && st.doneModel !== m.model) return t().wAuditModel(m.model, m.avail.audit)
      return null
    },
  },
  {
    id: 'memory',
    rest: (m) => ((m.autoMem ?? 0) >= MEMORY_FULL ? 7 : 14),
    due: (m, st) => {
      if (!m.avail.memory || m.autoMem === null) return null
      if (m.autoMem >= MEMORY_FULL) return t().wMemoryFull(tokensText(m.autoMem), m.avail.memory)
      if (m.autoMem < MEMORY_MIN) return null
      if (!st.doneAt) return t().wMemoryNever(tokensText(m.autoMem), m.avail.memory)
      if (st.doneTokens && m.autoMem >= MEMORY_GROWTH * st.doneTokens) return t().wMemoryGrown(shortDate(st.doneAt), pct(m.autoMem, st.doneTokens), m.avail.memory)
      return null
    },
  },
  {
    id: 'skills-heavy',
    rest: () => 30,
    due: (m) => {
      if (!m.avail.skillDoctor || m.countingDays < UNUSED_DAYS || m.skillsTokens < HEAVY_TOKENS || m.unused === null || m.unused < HEAVY_UNUSED) return null
      return t().wSkillsHeavy(m.unused, UNUSED_DAYS, tokensText(m.skillsTokens), m.avail.skillDoctor)
    },
  },
  {
    id: 'init',
    rest: () => 30,
    due: (m) => {
      if (!m.avail.init || m.hasOwn || m.sessionDays < INIT_DAYS) return null
      return t().wInit(m.sessionDays, m.avail.init)
    },
  },
]

/** Den fälligen Hinweis mit dem kleinsten Rang, dessen Ruhezeit seit „gezeigt“ und „erledigt“ abgelaufen ist. */
export function pickHint(m: Measure, w: Wartung, s: HintSettings, now: number): Hint | null {
  if (!s.on) return null
  for (const r of RULES) {
    if (s.off.includes(r.id)) continue
    const st = w.regeln[r.id] ?? {}
    const rest = r.rest(m) * DAY
    if (st.hintAt && now - st.hintAt < rest) continue
    if (st.doneAt && now - st.doneAt < rest) continue
    const line = r.due(m, st, s)
    const cmd = CMD_OF[r.id](m.avail)
    if (line) return { id: r.id, line, ...(cmd ? { cmd } : {}) }
  }
  return null
}

/** Hat ein Audit oder Aufräumen die Dateien verkleinert, wird die Vergleichsgröße mitgenommen: Wachstum zählt ab dem kleineren Stand. */
export function rebase(w: Wartung, m: Measure): Wartung {
  const regeln = { ...w.regeln }
  const a = regeln.audit
  if (a?.doneTokens && m.project > 0 && m.project < a.doneTokens) regeln.audit = { ...a, doneTokens: m.project }
  const mm = regeln.memory
  if (mm?.doneTokens && m.autoMem !== null && m.autoMem > 0 && m.autoMem < mm.doneTokens) regeln.memory = { ...mm, doneTokens: m.autoMem }
  return { ...w, regeln }
}

/** Den heutigen Tag in die Liste der Chat-Tage aufnehmen (höchstens 10, für die Regel `init`). */
export function addSessionDay(w: Wartung, now: number): Wartung {
  const k = dayKey(now)
  if (w.sessions.includes(k)) return w
  return { ...w, sessions: [...w.sessions, k].slice(-10) }
}

/** Welche Regeln ein Befehl erledigt. `/skill-doctor` erledigt beide Skill-Regeln. */
export const DONE_BY: Record<string, RuleId[]> = {
  audit: ['audit'],
  'skill-doctor': ['skills-cut', 'skills-heavy'],
  memory: ['memory'],
  init: ['init'],
}

/**
 * Getippter Slash-Befehl → erledigte Regeln. Ein Plugin-Präfix ist nur bei `consolidate-memory` erlaubt (Desktop:
 * `anthropic-skills:consolidate-memory`); `claude-api`, `skill-doctor` und `init` sind eingebaut und gelten nur
 * mit genau diesem Namen, damit ein fremdes `/x:init` nichts erledigt.
 */
export function doneFromText(text: string): RuleId[] {
  const typed = text.trim().toLowerCase()
  const m = /^\/([\w:-]+)(?:\s+(\S+))?/.exec(typed)
  if (!m) return []
  const [, cmd, arg] = m
  if (cmd === 'claude-api') return arg === 'prompt-audit' ? DONE_BY.audit! : []
  if (cmd === 'skill-doctor') return DONE_BY['skill-doctor']!
  if (cmd === 'init') return DONE_BY.init!
  if (cmd === 'consolidate-memory' || cmd!.endsWith(':consolidate-memory')) return DONE_BY.memory!
  return []
}

/**
 * `skill.prompt` → erledigte Regeln. Bei `claude-api` steht die Unteranweisung am Ende des Prompts unter „## User Request“
 * (Probe: `…\n\n## User Request\n\nprompt-audit`).
 */
export function doneFromSkill(skill: string, text: string): RuleId[] {
  const name = skill.toLowerCase()
  if (name === 'claude-api') return /##\s*User Request\s+prompt-audit\b/i.test(text.slice(-2000)) ? DONE_BY.audit! : []
  if (name === 'init') return DONE_BY.init!
  if (name === 'skill-doctor') return DONE_BY['skill-doctor']!
  if (name === 'consolidate-memory' || name.endsWith(':consolidate-memory')) return DONE_BY.memory!
  return []
}

/** Modell-ID ohne Zusätze wie `[1m]`, klein (Probe: `claude-opus-5-5[1m]`). */
export function normModel(m: string): string {
  return String(m ?? '').replace(/\[[^\]]*\]/g, '').trim().toLowerCase()
}

/** Pfad vergleichbar machen: `/` statt `\`, klein, ohne Schrägstrich am Ende. */
export function normPath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Projektschlüssel: Worktrees (`/.claude/worktrees/<name>`) zählen zum Hauptprojekt. */
export function projectKey(root: string): string {
  return normPath(root).replace(/\/\.claude\/worktrees\/[^/]+(?=\/|$)/, '')
}

const dirOf = (p: string) => normPath(p).replace(/\/[^/]*$/, '')

export type MemFile = { path: string; type: string; tokens: number }

/** Ohne Projektwurzel: Ordner der tiefsten `Project`-Datei (SPEC Nachtrag, Rückfall ohne `$.session.root`); `.claude/CLAUDE.md` zählt zum Ordner darüber. */
export function rootFromFiles(files: MemFile[]): string {
  let best = ''
  for (const f of files) {
    if (f.type !== 'Project' && f.type !== 'Local') continue
    const d = dirOf(f.path).replace(/\/\.claude$/, '')
    if (d.length > best.length) best = d
  }
  return best
}

/** Die Werte aus `memoryFiles`: Summe der Projekt-Anweisungen, eigene Datei in der Wurzel, Auto-Memory-Index. */
export function memoryMeasure(files: MemFile[], root: string): { project: number; hasOwn: boolean; autoMem: number | null } {
  const r = normPath(root)
  let project = 0
  let hasOwn = false
  let autoMem: number | null = null
  for (const f of files) {
    const tokens = typeof f.tokens === 'number' && f.tokens > 0 ? f.tokens : 0
    if (f.type === 'Project' || f.type === 'Local') {
      project += tokens
      const d = dirOf(f.path)
      if (r && (d === r || d.startsWith(`${r}/`))) hasOwn = true
    } else if (f.type === 'AutoMem') {
      // Nur `MEMORY.md` wird geladen; Themen-Dateien kämen, falls gelistet, nicht in den Index (rel/memory.md:534)
      if (/(^|[\\/])memory\.md$/i.test(f.path)) autoMem = (autoMem ?? 0) + tokens
    }
  }
  return { project, hasOwn, autoMem }
}

/** Vorhandene Befehle aus `$.command.list()`; der Name so, wie man ihn tippt. Präfix nur bei `consolidate-memory`. */
export function availOf(cmds: { name: string }[]): Avail {
  const exact = (want: string) => cmds.find((c) => c.name === want)?.name ?? null
  const skillDoctor = exact('skill-doctor')
  const audit = exact('claude-api')
  const memory = exact('consolidate-memory') ?? cmds.find((c) => c.name.endsWith(':consolidate-memory'))?.name ?? null
  const init = exact('init')
  return {
    skillDoctor: skillDoctor ? `/${skillDoctor}` : null,
    audit: audit ? `/${audit} prompt-audit` : null,
    memory: memory ? `/${memory}` : null,
    init: init ? `/${init}` : null,
  }
}

/** Gelistete, abschaltbare Skills ohne Nutzung im Zeitraum. Eingebaute zählen nicht (skill-doctor nimmt sie aus, rel/skills.md:899). */
export function unusedSkills(listed: { name: string; source: string }[], used: Set<string>): number {
  const usedNames = [...used].map((u) => u.toLowerCase())
  const hit = (name: string) => {
    const n = name.toLowerCase()
    return usedNames.some((u) => u === n || u.endsWith(`:${n}`) || n.endsWith(`:${u}`))
  }
  return listed.filter((s) => s.source !== 'built-in' && !hit(s.name)).length
}

export function cleanWartung(v: unknown): Wartung {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>
  const regeln: Partial<Record<RuleId, RuleState>> = {}
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined)
  for (const id of RULE_IDS) {
    const r = o.regeln?.[id]
    if (!r || typeof r !== 'object') continue
    const st: RuleState = {}
    if (num(r.doneAt)) st.doneAt = r.doneAt
    if (num(r.doneTokens)) st.doneTokens = r.doneTokens
    if (typeof r.doneModel === 'string' && r.doneModel) st.doneModel = r.doneModel
    if (num(r.hintAt)) st.hintAt = r.hintAt
    regeln[id] = st
  }
  const sessions = Array.isArray(o.sessions) ? o.sessions.filter((x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(-10) : []
  return { v: 1, regeln, sessions }
}

export function cleanHints(v: unknown): HintSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    on: typeof o.on === 'boolean' ? o.on : DEFAULT_HINTS.on,
    off: Array.isArray(o.off) ? (o.off.filter((x) => (RULE_IDS as readonly unknown[]).includes(x)) as RuleId[]) : [],
    auditMin: typeof o.auditMin === 'number' && o.auditMin > 0 ? o.auditMin : DEFAULT_HINTS.auditMin,
  }
}

/** Erledigt setzen: Zeitpunkt und, wo die Regel vergleicht, die Größe und das Modell von jetzt. */
export function markDone(w: Wartung, ids: RuleId[], now: number, m: { project?: number; autoMem?: number | null; model?: string }): Wartung {
  const regeln = { ...w.regeln }
  for (const id of ids) {
    const st: RuleState = { ...(regeln[id] ?? {}), doneAt: now }
    if (id === 'audit') {
      if (m.project) st.doneTokens = m.project
      if (m.model) st.doneModel = m.model
    }
    if (id === 'memory' && m.autoMem) st.doneTokens = m.autoMem
    regeln[id] = st
  }
  return { ...w, regeln }
}

/** Wurde zu dieser Regel ein Hinweis gezeigt, und kam „erledigt“ danach, noch in der Ruhezeit? Dann gilt er als angenommen. */
export function accepted(st: RuleState | undefined, now: number, restDays: number): boolean {
  if (!st?.hintAt || now - st.hintAt >= restDays * DAY) return false
  return !st.doneAt || st.doneAt < st.hintAt
}

export const hintsUsage = (): string => t().hintsUsage(RULE_IDS.join(', '))

/** `/sidekick hints …`; `status` und leer liefern null für „nichts ändern“. Fehler: `{ error }`. */
export function applyHints(
  s: HintSettings,
  args: string,
  parseTokens: (t: string) => number | null,
): { settings?: HintSettings; done?: RuleId; error?: string } | null {
  const [a, b] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!a || a === 'status') return null
  if (a === 'on' || a === 'off') return { settings: { ...s, on: a === 'on' } }
  if (a === 'audit-min') {
    const n = parseTokens(b ?? '')
    return n ? { settings: { ...s, auditMin: n } } : { error: t().auditMinNeedsNumber }
  }
  if (a === 'done') {
    if ((RULE_IDS as readonly string[]).includes(b ?? '')) return { done: b as RuleId }
    return { error: t().unknownRule(b ?? '') }
  }
  if ((RULE_IDS as readonly string[]).includes(a) && (b === 'on' || b === 'off')) {
    const id = a as RuleId
    const off = s.off.filter((x) => x !== id)
    return { settings: { ...s, off: b === 'off' ? [...off, id] : off } }
  }
  return { error: t().unknownHints(args.trim()) }
}

/** Status-Tabelle für das aktuelle Projekt (`/sidekick hints status`). */
export function hintsStatus(m: Measure | null, w: Wartung, s: HintSettings, key: string, now: number): string {
  const x = t()
  const out = [x.hintsTitle(s.on ? x.on : x.off, key), '']
  out.push(x.hintsHeadRow, '|---|---|---|---|---|')
  for (const r of RULES) {
    const st = w.regeln[r.id] ?? {}
    const val = !m
      ? '–'
      : r.id === 'skills-cut'
        ? x.vSkillsCut(m.skillsIncluded, m.skillsTotal)
        : r.id === 'audit'
          ? x.vAudit(tokensText(m.project), tokensText(s.auditMin))
          : r.id === 'memory'
            ? m.autoMem === null
              ? x.vNoIndex
              : tokensText(m.autoMem)
            : r.id === 'skills-heavy'
              ? x.vHeavy(tokensText(m.skillsTokens), String(m.unused ?? '?'), m.countingDays)
              : m.hasOwn
                ? x.vHasClaudeMd
                : x.vNoClaudeMd(m.sessionDays)
    const rest = m ? r.rest(m) * DAY : 0
    const from = Math.max(st.hintAt ? st.hintAt + rest : 0, st.doneAt ? st.doneAt + rest : 0)
    const off = s.off.includes(r.id) ? x.ruleOff : ''
    const avail = m && !CMD_OF[r.id](m.avail) ? x.cmdMissing : ''
    out.push(`| ${x.rule[r.id]}${off}${avail} | ${val} | ${st.doneAt ? shortDate(st.doneAt) : '–'} | ${st.hintAt ? shortDate(st.hintAt) : '–'} | ${from > now ? shortDate(from) : x.now} |`)
  }
  out.push('', x.change(hintsUsage()))
  return out.join('\n')
}

/** Ruhezeit einer Regel in Tagen, für `accepted` außerhalb der Tabelle. */
export function restOf(id: RuleId, m: Measure | null): number {
  const r = RULES.find((x) => x.id === id)
  return r && m ? r.rest(m) : 30
}

