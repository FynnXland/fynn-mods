// sidekick: Hooks-Modul. Prüft die Nachricht des Nutzers vor dem Senden: erst Regeln, dann, wo es sich lohnt, kurz ein Modell (SPEC Verhalten 3).
// Ergebnis: durchlassen, graue Zeile unter der eigenen Nachricht (UserMessage, Verhalten 5) oder Rückfrage mit besserer Aktion,
// z. B. neuer Chat mit Übergabe, die ein Modell aus Kurzfassung und Verlaufsende schreibt (Verhalten 4). /savings zeigt die Bilanz.
// Fail-open: Jeder Fehler lässt die Nachricht unverändert durch; es gibt kein `.catch` (SPEC Fehlerverhalten). Ausnahme: nach
// „Neuer Chat mit Übergabe“ wird bei einem Fehler nie stillschweigend in den kalten Chat gesendet, es wird erneut gefragt.
import type { EngineInterface, On, RenderElement, RenderNode, Timer } from 'claude-code'
import { cacheState, cleanMem, completeCost, dayKey, emptyMem, hhmm, observeStep, parseTokens, rewriteCost, totalInput, ttlOf } from './cache.ts'
import { setLang, spanText, t, tokensText, usdText } from './i18n.ts'
import { CHECK, CHECK_NAME, HANDOFF } from './models.ts'
import type { CacheMem, CompleteUsage, StepUsage } from './cache.ts'
import { joinBand, layer, LEVEL, nameOf, splitBand } from './band.ts'
import {
  DEFAULT_SETTINGS,
  KEEP_DAYS,
  USAGE,
  applySetting,
  book,
  bookModel,
  bookingStep,
  cacheText,
  checkPrompt,
  checkSystem,
  cleanLedger,
  daysInPeriod,
  cleanSettings,
  countHint,
  countWartung,
  cut,
  handoffEstimate,
  handoffPrompt,
  hintLine,
  lineCommand,
  handoffSystem,
  historyTail,
  isSuppressed,
  parseVerdict,
  rankChoices,
  planCompaction,
  savingsArgs,
  savingsReport,
  sumPeriod,
  triggerOf,
  wrongChatChoices,
} from './logic.ts'
import type { Art, Booking, Choice, Day, Ignored, Ledger, Period, Settings, Skill, Trigger, Verdict } from './logic.ts'
import { savingsTree } from './view.ts'
import {
  HEAVY_TOKENS,
  UNUSED_DAYS,
  accepted,
  addSessionDay,
  applyHints,
  availOf,
  cleanHints,
  cleanWartung,
  doneFromSkill,
  doneFromText,
  hintsStatus,
  hintsUsage,
  markDone,
  memoryMeasure,
  normModel,
  pickHint,
  projectKey,
  rebase,
  restOf,
  rootFromFiles,
  unusedSkills,
} from './wartung.ts'
import type { Hint, Measure, MemFile, RuleId, Wartung } from './wartung.ts'

const DAY = 24 * 60 * 60000
const HEADER = 'Sidekick'
// Farbe der sidekick-Zeile und des Fassungs-Rahmens (andere Farbe als die Nachricht)
const ACCENT = '#6CB6FF'

/**
 * Eine Zeile unter einer eigenen Nachricht; `cmd`: Befehl für den Button, `queued`: schon als To-do eingereiht (Nachtrag 0.7.0),
 * `ran`: schon ausgeführt (Nachtrag 0.8.1).
 */
type HintRow = { id: string; line: string; sent?: string; cmd?: string; queued?: boolean; ran?: boolean }

/** Was der Sidekick je Session weiß; `$.store` `sitzung:<sessionId>` (SPEC Zustand). */
type Sitzung = {
  summary: string // laufende Kurzfassung, ≤ 600 Zeichen, schreibt die Prüfung fort
  recent: string[] // die letzten 3 eigenen Nachrichten, gekürzt
  own: number // eigene Nachrichten (ohne Befehle)
  ignored: Ignored
  hints: HintRow[] // Hinweis-Zeilen, an die Message-ID gebunden (höchstens 30)
  last: { line: string; art: Art; at: number } | null // letzter Hinweis
  open: { art: Art; skill: string; ctx: number } | null // gezeigte Zeile, noch nicht angenommen
  commits: number
  commit: { sha: string; at: number } | null
  wartung: boolean // Wartungs-Hinweis in dieser Session schon geprüft (einmal pro Session, SPEC Nachtrag 0.2.0)
}

function emptySitzung(): Sitzung {
  return { summary: '', recent: [], own: 0, ignored: {}, hints: [], last: null, open: null, commits: 0, commit: null, wartung: false }
}

function cleanSitzung(v: unknown): Sitzung {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>
  const s = emptySitzung()
  if (typeof o.summary === 'string') s.summary = o.summary.slice(0, 600)
  if (Array.isArray(o.recent)) s.recent = o.recent.filter((x: unknown) => typeof x === 'string').slice(-3)
  if (typeof o.own === 'number') s.own = o.own
  if (o.ignored && typeof o.ignored === 'object') s.ignored = o.ignored
  if (Array.isArray(o.hints))
    s.hints = o.hints
      .filter((h: any) => h && typeof h.id === 'string' && typeof h.line === 'string')
      .map((h: any) => ({
        id: h.id,
        line: h.line,
        ...(typeof h.sent === 'string' ? { sent: h.sent } : {}),
        ...(typeof h.cmd === 'string' && h.cmd.startsWith('/') ? { cmd: h.cmd } : {}),
        ...(h.queued === true ? { queued: true } : {}),
        ...(h.ran === true ? { ran: true } : {}),
      }))
      .slice(-30)
  if (o.last && typeof o.last.line === 'string') s.last = o.last
  if (o.open && typeof o.open.art === 'string') s.open = o.open
  if (typeof o.commits === 'number') s.commits = o.commits
  if (o.commit && typeof o.commit.sha === 'string') s.commit = o.commit
  if (o.wartung === true) s.wartung = true
  return s
}

let sessionId = ''
let mem: CacheMem = emptyMem()
let ses: Sitzung = emptySitzung()
let settings: Settings = { ...DEFAULT_SETTINGS }
// Hinweis, der an die nächste eigene Zeile mit diesem Text gebunden wird (UserMessage kennt die Message-ID, prompt.submit nicht)
// `alt`: die gesendete Fassung; der Desktop zeigt in der Sprechblase das Original, daher passen beide Texte
let pending: { text: string; alt?: string; line: string; sent?: string; cmd?: string } | null = null
let askedCold = false // „Trotzdem senden“ im Kalt-Dialog: der folgende Kaltstart war gefragt, zählt nicht als „ohne Rückfrage“
let skillCache: { at: number; list: Skill[] } | null = null
type Breakdown = Awaited<ReturnType<EngineInterface['session']['usage']>>['context']['breakdown']
type Cmd = Awaited<ReturnType<EngineInterface['command']['list']>>[number]
// Ein breakdown-Aufruf (lokale Schätzung, kostenlos) und die Befehlsliste, geteilt von Skill-Liste und Wartungs-Hinweisen
let baseCache: { at: number; b: Breakdown | undefined; cmds: Cmd[] } | null = null
let basePending: Promise<NonNullable<typeof baseCache>> | null = null // ein laufender Aufruf wird geteilt (Wartung parallel zur Prüfung)
type WHint = Hint & { key: string }
let wChain: Promise<unknown> = Promise.resolve() // Lesen, Ändern, Schreiben von `wartung:<schlüssel>` nacheinander
let chain: Promise<unknown> = Promise.resolve() // Buchungen dieser Session nacheinander (Lesen, Ändern, Schreiben)
// Die letzten /savings-Ausgaben: ui.render findet über die Kennung im Text die Daten der Zeichnung (wie cost-ledger)
const reports = new Map<string, { d: Day; p: Period; now: number; days?: Record<string, Day> }>()
let reportNo = 0

/** Ein Zeichen-Element als reine Daten (StyledElement, types:8851): Box oder Text mit einfachen Props. */
function el(type: 'Box' | 'Text', props: Record<string, string | number | boolean>, children: RenderNode[]): RenderElement {
  return { type, props, children }
}

/** Den Teilbaum mit `props.key === key` entfernen (z. B. die Pille von quick-replies); alles andere bleibt, wie es ist. */
function withoutKey(node: RenderElement, key: string): RenderElement | null {
  const n = node as { props?: Record<string, unknown>; children?: unknown[] }
  if (n.props?.key === key) return null
  if (!Array.isArray(n.children)) return node
  const kids = n.children.map((c) => (c && typeof c === 'object' ? withoutKey(c as RenderElement, key) : c)).filter((c) => c !== null)
  return { ...node, children: kids } as RenderElement
}

const msg = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 140)

/**
 * Einmal `fn` nach `ms`, außerhalb des aufrufenden Hooks. Aus prompt.submit lehnt der Host `$.command.run` und
 * `$.prompt.submit` ab (limit-bars SPEC, Bau v0.2.0); Muster wie limit-bars register.ts:89-94.
 */
function later($: EngineInterface, ms: number, fn: () => void) {
  const timer = $.clock.every(ms, () => {
    timer.cancel()
    fn()
  })
}

// ---- Schnittstelle zu clawd-buddy (types/index.d.ts): was sidekick gerade tut, als `$.state`-Wert, den Clawd beim Zeichnen liest.
// Beiwerk: nie warten, ein Fehler ändert nichts an Prüfung oder Nachricht.
type BuddyKind = 'check' | 'stop' | 'handoff' | 'fresh'
// `undefined` = unbekannt (nach einem Neuladen): der nächste Aufruf schreibt sicher, auch `null` (Review S1)
let buddyKind: BuddyKind | null | undefined = undefined
// Schreibvorgänge nacheinander, damit ein schnelles `handoff` → `null` nicht vertauscht ankommt (Review K1)
let buddyChain: Promise<unknown> = Promise.resolve()
function buddy($: EngineInterface, kind: BuddyKind | null) {
  if (kind === buddyKind) return
  buddyKind = kind
  try {
    buddyChain = buddyChain
      .then(() => $.clock.now())
      .then((at) => $.state.set({ plugin: 'sidekick', key: 'buddy' }, kind ? { kind, at } : null))
      .catch(() => {})
  } catch {
    // Beiwerk: nie die Prüfung oder Nachricht stören
  }
}

/** Nach /clear oder /resume gibt es eine neue Session-ID (Probe: sofort nach `/clear`); dann deren Stand laden. */
async function bindSession($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if (!id || id === sessionId) return
  sessionId = id
  baseCache = null // /clear, /resume oder Projektwechsel: frisch messen
  mem = emptyMem()
  ses = emptySitzung()
  pending = null
  askedCold = false
  chain = Promise.resolve()
  const saved = cleanMem(await $.store.get(`cache:${id}`))
  if (saved) mem = { lastActivity: saved.lastActivity, ttl: saved.ttl, ttlSource: saved.ttlSource, ctx: saved.ctx, model: saved.model }
  ses = cleanSitzung(await $.store.get(`sitzung:${id}`))
}

function saveSes($: EngineInterface, now: number) {
  if (!sessionId) return
  $.store.set(`sitzung:${sessionId}`, { ...ses, savedAt: now }).catch(() => {})
}

function saveMem($: EngineInterface, now: number) {
  if (!sessionId) return
  $.store.set(`cache:${sessionId}`, { ...mem, savedAt: now }).catch(() => {})
}

/**
 * Bilanz buchen: nur der eigene Schlüssel `bilanz:<sessionId>`, immer frisch gelesen (der Store ist nicht atomar).
 * `fn` gibt null zurück, wenn nichts zu buchen ist: dann wird nicht geschrieben (kein leerer Eintrag je `-p`-Lauf).
 */
function bookNow($: EngineInterface, at: number, fn: (l: Ledger) => Ledger | null): Promise<unknown> {
  const sid = sessionId
  if (!sid) return Promise.resolve()
  chain = chain
    .then(async () => {
      const l = cleanLedger(await $.store.get(`bilanz:${sid}`))
      const next = fn({ ...l, upd: at })
      if (next) await $.store.set(`bilanz:${sid}`, next)
    })
    .catch(() => {})
  return chain
}

function bookDay($: EngineInterface, at: number, fn: (d: Day) => void) {
  return bookNow($, at, (l) => book(l, at, fn))
}

/** Skill-Namen aus der lokalen Schätzung (kostenlos, types:2150-2168), die Beschreibung aus `$.command.list()` (types:1650-1668). */
async function loadBase($: EngineInterface, now: number) {
  if (baseCache && now - baseCache.at < 30 * 60000) return baseCache
  if (!basePending) {
    basePending = (async () => {
      const u = await $.session.usage({ breakdown: 'summary' })
      const cmds = await $.command.list()
      baseCache = { at: now, b: u.context.breakdown, cmds }
      return baseCache
    })().finally(() => {
      basePending = null
    })
  }
  return basePending
}

async function loadSkills($: EngineInterface, now: number): Promise<Skill[]> {
  if (skillCache && now - skillCache.at < 30 * 60000) return skillCache.list
  const { b, cmds } = await loadBase($, now)
  const names = new Set((b?.skills?.skillFrontmatter ?? []).map((s) => s.name))
  // Eingebaute Prüf-Skills, die als Befehl gelistet sind (Planung: /code-review, /security-review)
  for (const c of cmds) if (c.source === 'builtin' && (c.name === 'code-review' || c.name === 'security-review')) names.add(c.name)
  const list: Skill[] = []
  for (const c of cmds) if (names.has(c.name)) list.push({ name: c.name, description: cut(c.description.split('\n')[0] ?? '', 90) })
  skillCache = { at: now, list: list.slice(0, 60) }
  return skillCache.list
}

// ---------- Button unter der Zeile (Nachtrag 0.7.0) ----------

/**
 * Wohin ein Befehl geht: als To-do, wenn worklist `/todo` anbietet und der Befehl ein Skill ist, den Claude selbst aufrufen kann
 * (Name in der Skill-Liste der lokalen Schätzung); sonst direkt ausführen (Nachtrag 0.8.1, Fynn: „anklicken, und es wird gemacht“).
 * Eingebaute Befehle wie `/skill-doctor` oder `/init` kann Claude nicht ausführen, ein To-do dafür liefe ins Leere (rel/skills.md:899).
 */
function routeOf(base: typeof baseCache, cmd: string): 'todo' | 'run' {
  if (!base) return 'run'
  const todo = base.cmds.some((c) => c.name === 'todo' && c.source === 'plugin' && /^worklist(@|$)/.test(c.plugin ?? ''))
  const name = cmd.replace(/^\//, '').split(/\s+/)[0] ?? ''
  const skill = (base.b?.skills?.skillFrontmatter ?? []).some((s) => s.name === name)
  return todo && skill ? 'todo' : 'run'
}

// Laufende Klicks (Review 0.7.0 S1): die Sperre steht vor dem ersten `await`, ein Doppelklick legt nichts doppelt an
const pressing = new Set<string>()

/**
 * Klick auf den Button. `route` ist das Ziel, das beim Zeichnen auf dem Button stand (Review S2: Beschriftung und Aktion gleich):
 * `/todo Führe … aus.` über worklist, oder der Befehl selbst über `$.command.run`, „as if the person typed“ und hinter einem
 * laufenden Turn eingereiht (types:2997-3003). Erledigt wird erst nach dem erfolgreichen Aufruf gespeichert (Review K1); bis dahin
 * gilt es nur im Speicher. Lehnt die Engine den Befehl ab, kommt er als Rückfall ins Eingabefeld (Stand 0.7.0).
 */
async function useHint($: EngineInterface, id: string, route: 'todo' | 'run') {
  const h = ses.hints.find((x) => x.id === id)
  if (!h?.cmd || h.queued || h.ran || pressing.has(id)) return
  const cmd = h.cmd
  pressing.add(id)
  $.ui.invalidate('ui.render')
  try {
    if (route === 'todo') {
      try {
        await $.command.run({ command: 'todo', args: t().todoText(cmd) })
      } catch (err) {
        $.ui.toast(t().todoFailed(cmd, msg(err)), { timeoutMs: 15000 })
        return
      }
      const now = ses.hints.find((x) => x.id === id)
      if (now) {
        now.queued = true
        saveSes($, await $.clock.now().catch(() => 0))
      }
      return
    }
    const [name = '', ...rest] = cmd.replace(/^\//, '').split(/\s+/)
    try {
      await $.command.run({ command: name, ...(rest.length ? { args: rest.join(' ') } : {}) })
    } catch (err) {
      // An der Cursor-Position: getippter Text bleibt. Ohne eigenes $.prompt.read liefert fill den Feldinhalt nicht zurück
      // (types:8324-8355), darum kein Umstellen in eine eigene Zeile
      const why = msg(err)
      try {
        const r = await $.prompt.fill({ text: cmd, mode: 'insert' })
        $.ui.toast(r.isFilled ? t().runFailedFilled(cmd, why) : t().runFailed(cmd, why), { timeoutMs: 15000 })
      } catch {
        $.ui.toast(t().runFailed(cmd, why), { timeoutMs: 15000 })
      }
      return
    }
    // Ein Wartungs-Befehl gilt als erledigt; ob $.command.run auch prompt.submit oder skill.prompt auslöst, ist nicht belegt (Review
    // 0.8.1). Doppelt schadet nicht: nach doneAt zählt `accepted` nicht noch einmal (wartung.ts accepted)
    void noteDone($, doneFromText(cmd))
    const now = ses.hints.find((x) => x.id === id)
    if (now) {
      now.ran = true
      saveSes($, await $.clock.now().catch(() => 0))
    }
  } finally {
    pressing.delete(id)
    $.ui.invalidate('ui.render')
  }
}

// ---------- Wartungs-Hinweise (SPEC Nachtrag 0.2.0) ----------

/** Projektwurzel über `$.session.root()` (types:2675-2681); ohne sie der Ordner der tiefsten Projekt-Anweisungsdatei. */
async function projectOf($: EngineInterface, files: MemFile[]): Promise<{ root: string; key: string; viaRoot: boolean }> {
  try {
    const r = await $.session.root()
    if (r) return { root: r, key: projectKey(r), viaRoot: true }
  } catch {
    // Rückfall unten
  }
  const r = rootFromFiles(files)
  return { root: r, key: projectKey(r), viaRoot: false }
}

const dayMs = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime()
}

/** Messwerte für die Regeln. Die Bilanzen (Skill-Nutzung) werden nur geladen, wenn die Regel `skills-heavy` überhaupt infrage kommt. */
async function measureNow($: EngineInterface, now: number): Promise<{ m: Measure; key: string; w: Wartung } | null> {
  const { b, cmds } = await loadBase($, now)
  if (!b) return null
  const files = (b.memoryFiles ?? []) as MemFile[]
  const p = await projectOf($, files)
  if (!p.key) return null
  const w = cleanWartung(await $.store.get(`wartung:${p.key}`))
  const mem = memoryMeasure(files, p.root)
  const avail = availOf(cmds)
  if (!p.viaRoot) avail.init = null // ohne Projektwurzel kein verlässliches „keine CLAUDE.md“ (SPEC Nachtrag, Rechte)
  const sk = b.skills
  const m: Measure = {
    ...mem,
    model: normModel(b.model ?? ''),
    skillsTotal: sk?.totalSkills ?? 0,
    skillsIncluded: sk?.includedSkills ?? 0,
    skillsTokens: sk?.tokens ?? 0,
    unused: null,
    countingDays: 0,
    sessionDays: w.sessions.length,
    avail,
  }
  const heavy = w.regeln['skills-heavy'] ?? {}
  const resting = [heavy.hintAt, heavy.doneAt].some((t) => !!t && now - t < UNUSED_DAYS * DAY)
  if (avail.skillDoctor && m.skillsTokens >= HEAVY_TOKENS && !resting) {
    const u = await skillUsage($, now)
    m.countingDays = u.countingDays
    if (u.countingDays >= UNUSED_DAYS) m.unused = unusedSkills(sk?.skillFrontmatter ?? [], new Set(u.used))
  }
  return { m, key: p.key, w }
}

/**
 * Skill-Nutzung der letzten 30 Tage und seit wann gezählt wird, aus den Bilanzen. Höchstens einmal am Tag gelesen und unter
 * `wartung:nutzung` gemerkt; vor 30 Tagen Zählung reicht das gemerkte Startdatum (kein Scan je Nachricht).
 */
async function skillUsage($: EngineInterface, now: number): Promise<{ countingDays: number; used: string[] }> {
  const today = dayKey(now)
  const c = (await $.store.get('wartung:nutzung')) as { day?: unknown; since?: unknown; used?: unknown } | undefined
  const since = typeof c?.since === 'number' ? c.since : null
  if (since !== null && now - since < UNUSED_DAYS * DAY) return { countingDays: Math.floor((now - since) / DAY), used: [] }
  if (c?.day === today && since !== null && Array.isArray(c.used)) return { countingDays: Math.floor((now - since) / DAY), used: c.used.filter((x): x is string => typeof x === 'string') }
  const keys = (await $.store.keys()).filter((k) => k.startsWith('bilanz:')).slice(0, 400)
  const used = new Set<string>()
  let first = now
  for (const k of keys) {
    const l = cleanLedger(await $.store.get(k))
    for (const [day, d] of Object.entries(l.tage)) {
      const at = dayMs(day)
      if (at < first) first = at
      if (now - at <= UNUSED_DAYS * DAY) for (const name of Object.keys(d.skills)) used.add(name)
    }
  }
  const out = { countingDays: Math.floor((now - first) / DAY), used: [...used] }
  $.store.set('wartung:nutzung', { day: today, since: first, used: out.used }).catch(() => {})
  return out
}

/** Einmal pro Session bei der ersten eigenen Nachricht: Chat-Tag merken, Vergleichsgrößen nachziehen, fälligen Hinweis wählen. */
async function maintenance($: EngineInterface, now: number): Promise<WHint | null> {
  const hs = cleanHints(await $.store.get('hints'))
  const r = await measureNow($, now)
  if (!r) return null
  const w = rebase(addSessionDay(r.w, now), r.m)
  const m = { ...r.m, sessionDays: w.sessions.length }
  // Nur bei Änderung schreiben, in der Kette und ohne zu warten
  if (JSON.stringify(w) !== JSON.stringify(r.w)) {
    wChain = wChain
      .then(async () => {
        const cur = cleanWartung(await $.store.get(`wartung:${r.key}`))
        await $.store.set(`wartung:${r.key}`, rebase(addSessionDay(cur, now), r.m))
      })
      .catch(() => {})
  }
  if (!hs.on) return null
  const h = pickHint(m, w, hs, now)
  return h ? { ...h, key: r.key } : null
}

/** Ein Wartungs-Befehl lief: erledigt setzen; kam vorher ein Hinweis dazu, gilt er als angenommen. Nacheinander (wChain). */
function noteDone($: EngineInterface, ids: RuleId[]): Promise<unknown> {
  if (!ids.length) return Promise.resolve()
  wChain = wChain
    .then(async () => {
      await bindSession($)
      const now = await $.clock.now()
      const r = await measureNow($, now)
      if (!r) return
      const w = r.w
      const yes = ids.filter((id) => accepted(w.regeln[id], now, restOf(id, r.m)))
      if (yes.length) bookDay($, now, (d) => yes.forEach((id) => countWartung(d, id, 'angenommen')))
      await $.store.set(`wartung:${r.key}`, markDone(w, ids, now, r.m))
    })
    .catch(() => {})
  return wChain
}

/** Den Wartungs-Hinweis als Zeile unter dieser Nachricht zeigen (wie der Hinweis der Prüfung, Verhalten 5), dann senden. */
async function sendWithWartung<R>($: EngineInterface, e: { text: string }, h: WHint | null, send: () => Promise<R> | R): Promise<R> {
  if (!h) return send()
  try {
    const now = await $.clock.now()
    pending = { text: e.text, line: h.line, ...(h.cmd ? { cmd: h.cmd } : {}) }
    ses.last = { line: h.line, art: 'sonstiges', at: now }
    saveSes($, now)
    bookDay($, now, (d) => countWartung(d, h.id, 'gezeigt'))
    wChain = wChain
      .then(async () => {
        const w = cleanWartung(await $.store.get(`wartung:${h.key}`))
        await $.store.set(`wartung:${h.key}`, { ...w, regeln: { ...w.regeln, [h.id]: { ...(w.regeln[h.id] ?? {}), hintAt: now } } })
      })
      .catch(() => {})
  } catch {
    return send()
  }
  const r = await send()
  $.ui.invalidate('ui.render')
  return r
}

/** Die letzten 3 eigenen Nachrichten aus dem Verlauf, ohne Befehle und Tool-Ergebnisse, gekürzt. */
function lastOwn(msgs: readonly { role: string; text?: string }[]): string[] {
  return msgs
    .filter((m) => m.role === 'user' && typeof m.text === 'string' && m.text.trim() && !m.text.trim().startsWith('<'))
    .slice(-3)
    .map((m) => cut(String(m.text), 400))
}

/** Vom Nutzer getippt? Im Desktop (2.1.286) tragen getippte Nachrichten `sdk` wie `claude -p`; nur `surfaces()` trennt sie (SPEC). */
async function isOwn($: EngineInterface, kind: string): Promise<boolean> {
  if (kind === 'composer' || kind === 'bridge') return true
  if (kind !== 'sdk') return false
  return (await $.session.surfaces()).includes('desktop')
}

/** Eine ältere Zeile, die der Nutzer nicht angenommen hat, gilt mit der nächsten eigenen Nachricht als ignoriert. */
function closeOpen($: EngineInterface, now: number, ctx: number) {
  const o = ses.open
  if (!o) return
  ses.open = null
  ses.ignored = { ...ses.ignored, [o.art]: { ctx: o.ctx || ctx, commits: ses.commits } }
  bookDay($, now, (d) => countHint(d, o.art, 'ignoriert'))
}

// `before`: letzte Nachrichten und Kurzfassung vor dieser Nachricht; nach „Abbrechen“ beim falschen Chat zurück (Review S1)
type Check = { trigger: Trigger; ctx: number; model: string; ttl: 5 | 60; cold: boolean; unknown: boolean; coldFor: number; verdict: Verdict | null; before: { recent: string[]; summary: string } }

/** Ergebnis des Torwächters: die Prüfung (null = ohne Prüfung durchlassen) und ein Wartungs-Hinweis für genau diese Nachricht. */
type Gate = { c: Check | null; w: WHint | null }
const PASS: Gate = { c: null, w: null }

/** Schritt 1 bis 3 der SPEC (Verhalten 3): Filter, Auslöser, Modell-Prüfung. */
async function gate($: EngineInterface, text: string, kind: string, running: boolean, signal: AbortSignal): Promise<Gate> {
  settings = cleanSettings(await $.store.get('settings'))
  if (!settings.on || running || text.trim().startsWith('/')) return PASS
  // Vom Host eingefügte Nachrichten wie `<system-reminder>…` (Desktop, Worktree-Chat) sind nicht vom Nutzer: keine Prüfung, und sie
  // verbrauchen nicht die Wartungs-Prüfung des Chats (Desktop-Test 2026-10-06)
  if (/^<[a-z][\w-]*>/i.test(text.trim())) return PASS
  if (!(await isOwn($, kind))) return PASS
  await bindSession($)
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const ctx = typeof usage.context.tokens === 'number' ? usage.context.tokens : mem.ctx
  const ttl = ttlOf(mem, settings.ttl)
  const st = cacheState(mem.lastActivity, ttl, now)
  closeOpen($, now, ctx)
  let first = false
  let recent = ses.recent
  if (ses.own === 0) {
    const msgs = await $.session.messages()
    first = !msgs.some((m) => m.role === 'assistant')
    // Fortgesetzter Chat, den sidekick noch nicht kennt: die letzten eigenen Nachrichten aus dem Verlauf holen, damit die Prüfung
    // über das Thema urteilt und nicht nur über die Größe
    if (!first) recent = lastOwn(msgs)
  }
  ses.own += 1
  const before = { recent, summary: ses.summary }
  ses.recent = [...recent, cut(text, 400)].slice(-3)
  // Einmal pro Session, parallel zur Modell-Prüfung; ein Fehler kostet nur den Hinweis, nie die Nachricht (fail-open)
  let wp: Promise<WHint | null> = Promise.resolve(null)
  if (!ses.wartung) {
    ses.wartung = true
    wp = maintenance($, now).catch(() => null)
  }
  const trigger = triggerOf({ first, ctx, cold: st.kind === 'cold', unknown: st.kind === 'unknown', settings })
  if (!trigger) {
    saveSes($, now)
    return { c: null, w: await wp }
  }
  const skills = settings.skills ? await loadSkills($, now) : null
  const c = ses.commit
  const prompt = checkPrompt(ses.summary, recent, text, {
    trigger,
    ctx,
    cache: cacheText(st.kind, st.left),
    model: mem.model,
    commit: c ? `${c.sha} vor ${spanText(now - c.at)}` : 'keiner',
  })
  // Bricht der Nutzer ab, endet auch die Prüfung (types:2500-2501)
  buddy($, 'check')
  const r = await $.model.complete({ ...CHECK, system: checkSystem(skills), prompt }, { signal })
  const done = await $.clock.now()
  // `usage` kommt auf jedem Arm, auch bei Abbruch (types:6131): immer buchen
  const usd = completeCost(r.usage as CompleteUsage, CHECK.model)
  bookDay($, now, (d) => {
    d.kosten += usd
    d.pruefungen += 1
    d.warteMs += done - now
    bookModel(d, CHECK.model, 'pruefung', usd, done - now, r.usage as CompleteUsage)
  })
  let verdict = r.isAnswered ? parseVerdict(r.text, trigger, (skills ?? []).map((s) => s.name), text) : null
  if (verdict?.kurzfassung) ses.summary = verdict.kurzfassung
  if (verdict && verdict.urteil !== 'durch' && isSuppressed(ses.ignored, verdict.art, ctx, ses.commits)) verdict = { ...verdict, urteil: 'durch' }
  saveSes($, now)
  return { c: { trigger, ctx, model: mem.model, ttl, cold: st.kind === 'cold', unknown: st.kind === 'unknown', coldFor: -st.left, verdict, before }, w: await wp }
}

/** Die nicht gesendete Nachricht aus dem Prüfkontext nehmen: Sonst sähe die nächste Prüfung das fremde Gebiet als Teil des Chats. */
function forget($: EngineInterface, c: Check, now: number) {
  ses.recent = c.before.recent
  ses.summary = c.before.summary
  saveSes($, now)
}

/** Antworttexte der Rückfrage in der eingestellten Sprache. */
const label = (c: Choice): string => {
  const x = t()
  return { new: x.newChat, plain: x.newPlain, fassung: x.fassung, send: x.send, abort: x.abort }[c]
}
/** Antworttexte, die erste mit „(empfohlen)“. */
const labels = (list: Choice[]) => list.map((c, i) => label(c) + (i === 0 ? t().recommended : ''))
/** Gewählte Antwort zurück zur Wahl; „(empfohlen)“ zählt nicht mit. Unbekannter Text (freie Eingabe) gilt als „senden“. */
function choiceOf(answer: string): Choice {
  const a = answer.endsWith(t().recommended) ? answer.slice(0, -t().recommended.length) : answer
  return (['new', 'plain', 'fassung', 'send', 'abort'] as const).find((c) => label(c) === a) ?? 'send'
}

const FASSUNG_MAX = 600
const showable = (f: string) => !!f && f.length <= FASSUNG_MAX

/** Die Rückfrage: Frage und Antworten (2–4, Frage endet mit „?“, types:2332-2346). */
function dialog(c: Check, resendable: boolean, base: number): { question: string; options: string[]; art: Art } | null {
  const v = c.verdict
  // Falscher Chat vor allem anderen, auch vor der Kalt-Rückfrage: Abbrechen ist dann die bessere Aktion (Fynn 2026-10-06)
  if (v?.urteil === 'anhalten' && v.art === 'falscher_chat') {
    // Im Kalt-Fall dazu, was „Trotzdem senden“ kostet
    const ctx = tokensText(c.ctx)
    const send = usdText(rewriteCost(c.ctx, c.model, c.ttl))
    const cold = c.trigger !== 'c' ? '' : c.unknown ? t().coldUnknown(ctx, send) : t().coldSince(spanText(c.coldFor), ctx, send)
    return { question: t().wrongChat(v.zeile, cold), options: labels(wrongChatChoices(resendable, v.verlauf)), art: 'falscher_chat' }
  }
  if (c.trigger === 'c') {
    const send = rewriteCost(c.ctx, c.model, c.ttl)
    const est = handoffEstimate(c.ctx * 4, base, c.model, c.ttl)
    const parts = [
      c.unknown
        ? t().coldUnknown(tokensText(c.ctx), usdText(send))
        : t().coldSince(spanText(c.coldFor), tokensText(c.ctx), usdText(send)),
    ]
    if (v && v.urteil !== 'durch' && v.zeile) parts.push(`${CHECK_NAME}: ${v.zeile}`)
    if (resendable) {
      parts.push(t().optNew(t().newChat, usdText(est)))
      parts.push(t().optPlain(t().newPlain, usdText(rewriteCost(base, c.model, c.ttl))))
    }
    parts.push(t().howNext)
    // Die Fassung nur, wenn sie ganz im Dialog steht
    const fassung = v?.art === 'fassung' && showable(v.fassung)
    if (fassung) parts.splice(parts.length - 1, 0, t().fassungBlock(v!.fassung))
    // Die empfohlene Antwort steht auf 1; höchstens 4 Antworten
    const options = labels(rankChoices({ cold: true, sendUsd: send, verlauf: v?.verlauf, resendable, fassung }))
    // Absätze statt eines Blocks
    return { question: parts.join('\n\n'), options, art: 'neuer_chat' }
  }
  if (!v || v.urteil !== 'anhalten') return null
  if (v.art === 'neuer_chat') {
    if (!resendable) return null // mit Anhang oder @datei gibt es diese Antwort nicht (SPEC Verhalten 4)
    return { question: `${v.zeile || t().newTopicDefault} ${t().howNext}`, options: labels(rankChoices({ cold: false, sendUsd: Infinity, verlauf: v.verlauf, resendable, fassung: false })), art: 'neuer_chat' }
  }
  // fassung (parseVerdict lässt „anhalten“ nur mit neuer_chat oder einer Fassung zu). Gesendet wird nur, was der Nutzer ganz gesehen
  // hat: eine längere Fassung wird zur Zeile
  if (!showable(v.fassung)) return null
  return { question: `${v.zeile || t().fassungDefault}\n\n${t().fassungBlock(v.fassung)}\n\n${t().howNext}`, options: labels(['fassung', 'send', 'abort']), art: 'fassung' }
}

/**
 * „Neuer Chat mit Übergabe“: das Modell HANDOFF schreibt die Übergabe, dann /clear und die Nachricht (SPEC Verhalten 4). Läuft im Timer.
 * `plain`: „ohne Übergabe“, nur /clear und die Nachricht, kein Modellaufruf.
 */
async function runHandoff($: EngineInterface, text: string, c: Check, plain = false) {
  // Sichtbar machen, dass gearbeitet wird: blaue Box über dem Prompt
  await showBusy($, plain ? 'plain' : 'handoff')
  try {
    if (plain) return await freshChat($, text, c, '')
    return await writeHandoff($, text, c)
  } finally {
    hideBusy($)
  }
}

type Step = 'handoff' | 'plain' | 'clear'
let busy: { step: Step; since: number } | null = null
let busyTimer: Timer | null = null

async function showBusy($: EngineInterface, step: Step) {
  buddy($, 'handoff')
  busy = { step, since: busy?.since ?? (await $.clock.now()) }
  // Sekunden mitzählen: alle 1 s neu zeichnen, nur solange die Box steht
  if (!busyTimer) busyTimer = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  $.ui.invalidate('ui.render')
}

function hideBusy($: EngineInterface) {
  // Abgebrochen oder gescheitert: Clawd hört auf, den Brief zu schreiben; „neuer Chat da“ bleibt stehen
  if (buddyKind === 'handoff') buddy($, null)
  if (!busy) return
  busy = null
  busyTimer?.cancel()
  busyTimer = null
  $.ui.invalidate('ui.render')
}

async function writeHandoff($: EngineInterface, text: string, c: Check) {
  const oldSession = sessionId
  const msgs = await $.session.messages()
  const history = historyTail(msgs, 100000)
  const start = await $.clock.now()
  const r = await $.model.complete({ ...HANDOFF, system: handoffSystem(), prompt: handoffPrompt(ses.summary, history) })
  const end = await $.clock.now()
  const usd = completeCost(r.usage as CompleteUsage, HANDOFF.model)
  bookDay($, start, (d) => {
    d.kosten += usd
    bookModel(d, HANDOFF.model, 'uebergabe', usd, end - start, r.usage as CompleteUsage)
  })
  const handoff = r.isAnswered ? r.text.trim() : ''
  if (handoff.length < 100) {
    // Nie stillschweigend kalt senden: erneut fragen (SPEC Fehlerverhalten)
    const why = r.isAnswered ? t().tooShort : r.reason
    hideBusy($)
    let answer = t().abort
    try {
      answer = await $.ui.ask(t().handoffFailed(why), { options: [t().send, t().abort], header: HEADER })
    } catch {
      // Dialog geschlossen: nicht senden
    }
    if (answer === t().send) await $.prompt.submit({ text, asUser: true })
    else $.ui.toast(t().notSent(cut(text, 300)), { timeoutMs: 30000 })
    return
  }
  await $.store.set('handoff:last', { text: handoff, msg: cut(text, 20000), at: start, session: oldSession })
  bookDay($, start, (d) => {
    d.uebergaben += 1
  })
  return freshChat($, text, c, handoff)
}

/** /clear, offene Ersparnis-Buchung in der neuen Session, dann (Übergabe +) Nachricht senden. */
async function freshChat($: EngineInterface, text: string, c: Check, handoff: string) {
  await showBusy($, 'clear')
  try {
    await $.command.run({ command: 'clear' })
  } catch (err) {
    $.ui.toast(handoff ? t().clearFailedSaved(msg(err)) : t().clearFailedNothing(msg(err), cut(text, 300)), { timeoutMs: 20000 })
    return
  }
  // Neue Session: Buchung offen in deren Eintrag (SPEC Zustand), die erste eigene Nachricht ist gesendet
  await bindSession($)
  const now = await $.clock.now()
  // Nach „falscher Chat“ keine Ersparnis: Ohne sidekick wäre die Nachricht nicht in den großen Chat gegangen, sondern in einen
  // anderen (Review K1)
  if (c.verdict?.art !== 'falscher_chat') {
    const booking: Booking = { kind: c.cold ? 'kalt' : 'warm', oldCtx: c.ctx, model: c.model, ttl: c.ttl, first: 0, steps: 0, at: now }
    bookNow($, now, (l) => ({ ...l, offen: booking }))
  }
  ses.own = 1
  saveSes($, now)
  try {
    await $.prompt.submit({ text: handoff ? handoff + t().handoffSep + text : text, asUser: true })
    // /clear hat den Wert zurückgesetzt; neu schreiben, auch wenn das Modul noch „handoff“ meint
    buddyKind = null
    buddy($, 'fresh')
    $.ui.toast(t().newChatStarted(!!handoff), { timeoutMs: 8000 })
  } catch (err) {
    $.ui.toast(t().sendAfterClearFailed(msg(err), handoff ? t().statusShowsHandoff : t().yourText(cut(text, 300))), { timeoutMs: 20000 })
  }
}

/** Eine Anfrage der Hauptschleife: Cache-Messung wie limit-bars, Kaltstarts ohne Rückfrage, offene Ersparnis-Buchung. */
async function afterStep($: EngineInterface, u: StepUsage, startedAt: number) {
  await bindSession($)
  const total = totalInput(u)
  // Ohne session.compact-Recht: deutlich geschrumpfter Kontext gilt als Kompaktierung, nicht als Kaltstart
  const shrunk = mem.ctx > 0 && total < 0.6 * mem.ctx
  const res = observeStep(mem, u, startedAt, shrunk)
  const ttl = ttlOf(res.mem, settings.ttl)
  const asked = askedCold
  askedCold = false // gilt nur für die nächste Anfrage
  if (res.coldWritten) {
    if (!asked) {
      const usd = rewriteCost(res.coldWritten, res.mem.model, ttl)
      bookDay($, startedAt, (d) => {
        d.kaltOhne = { n: d.kaltOhne.n + 1, usd: d.kaltOhne.usd + usd }
      })
    }
  }
  mem = res.mem
  saveMem($, startedAt)
  const written = u.cache_creation_input_tokens || 0
  bookNow($, startedAt, (l) => {
    const b = l.offen
    if (!b) return null
    const s = bookingStep(b, { total, read: u.cache_read_input_tokens || 0, written })
    if (s.first) $.store.set('basis', written).catch(() => {})
    const field = b.kind === 'kalt' ? 'kaltVermieden' : 'neuWarm'
    const next = book(l, startedAt, (d) => {
      d[field] = { n: d[field].n + (s.first ? 1 : 0), usd: d[field].usd + s.usd }
    })
    return { ...next, offen: s.next }
  })
}

/** Aufräumen beim Start: Cache- und Sitzungs-Einträge älter als 7 Tage; alte Bilanzen verdichten (SPEC Zustand). */
async function housekeeping($: EngineInterface) {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  for (const k of keys.filter((x) => x.startsWith('cache:') || x.startsWith('sitzung:')).slice(0, 300)) {
    const v = (await $.store.get(k)) as { savedAt?: unknown } | undefined
    if (!v || typeof v.savedAt !== 'number' || now - v.savedAt > KEEP_DAYS * DAY) await $.store.delete(k)
  }
  const sids = keys.filter((k) => k.startsWith('bilanz:') && k !== 'bilanz:tage').map((k) => k.slice(7))
  const sources: { sid: string; ledger: Ledger }[] = []
  for (const sid of sids.slice(0, 300)) sources.push({ sid, ledger: cleanLedger(await $.store.get(`bilanz:${sid}`)) })
  const plan = planCompaction(cleanLedger(await $.store.get('bilanz:tage')), sources, now, sessionId)
  if (!plan.merged.length) return
  await $.store.set('bilanz:tage', plan.next)
  // Erst löschen, wenn ein erneutes Lesen die Verdichtung zeigt; sonst hat eine andere Session überschrieben (logic.ts)
  const check = cleanLedger(await $.store.get('bilanz:tage'))
  for (const sid of plan.merged) if (check.aus?.includes(sid)) await $.store.delete(`bilanz:${sid}`)
}

async function statusText($: EngineInterface): Promise<string> {
  await bindSession($)
  const now = await $.clock.now()
  const ttl = ttlOf(mem, settings.ttl)
  const st = cacheState(mem.lastActivity, ttl, now)
  // Die Engine setzt „sidekick: “ vor die Ausgabe, eine Überschrift (###) würde dahinter nicht gezeichnet
  const x = t()
  const onOff = (b: boolean) => (b ? x.on : x.off)
  const out = [x.statusTitle(onOff(settings.on)), '']
  out.push('| | |', '|---|---|')
  out.push(x.rowThreshold(tokensText(settings.threshold)))
  out.push(x.rowBig(tokensText(settings.big)))
  out.push(x.rowSkills(onOff(settings.skills)))
  out.push(x.rowTtl(ttl, settings.ttl ? x.ttlSet : mem.ttlSource === 'gemessen' ? x.ttlMeasured : x.ttlDefault))
  if (mem.ctx) out.push(x.rowCtx(tokensText(mem.ctx), cacheText(st.kind, st.left)))
  out.push('', x.summary(ses.summary), '')
  out.push(x.lastHint(ses.last ? `${hhmm(ses.last.at)} · ${ses.last.line}` : ''), '')
  const h = (await $.store.get('handoff:last')) as { text?: string; msg?: string; at?: number } | undefined
  if (h && typeof h.text === 'string' && typeof h.at === 'number') {
    out.push(x.lastHandoff(hhmm(h.at)), '', h.text, '')
    if (h.msg) out.push(x.handoffMsg(h.msg), '')
  } else out.push(x.noHandoff, '')
  const hs = cleanHints(await $.store.get('hints'))
  out.push(x.hintsLine(onOff(hs.on), hs.off.join(', ')), '')
  out.push(x.change(USAGE))
  return out.join('\n')
}

/** `/sidekick hints [on|off|status|<regel> on|off|done <regel>|audit-min <k>]` (SPEC Nachtrag 0.2.0, Verhalten 7). */
async function hintsCommand($: EngineInterface, rest: string): Promise<string> {
  let hs = cleanHints(await $.store.get('hints'))
  const r = applyHints(hs, rest, parseTokens)
  if (r?.error) return `${r.error}. ${t().possible(hintsUsage())}`
  if (r?.settings) {
    hs = r.settings
    await $.store.set('hints', hs)
    // Geänderte Einstellung: in diesem Chat bei der nächsten eigenen Nachricht noch einmal prüfen
    await bindSession($)
    ses.wartung = false
    saveSes($, await $.clock.now())
  }
  if (r?.done) await noteDone($, [r.done])
  const now = await $.clock.now()
  baseCache = null // Status mit frischen Messwerten
  const m = await measureNow($, now)
  if (!m) return t().hintsNoMeasure(hs.on ? t().on : t().off, hintsUsage())
  return hintsStatus(m.m, m.w, hs, m.key, now)
}

export function register(on: On, options?: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  // userConfig `language` (en/de, Standard en); /config lädt das Modul neu (release/I18N.md §1)
  setLang(options?.language)
  on('session.start', async ($, e, next) => {
    // Ein Neuladen mitten in Prüfung, Rückfrage oder Übergabe ließe den Wert in $.state stehen (er überlebt den Reload,
    // en/interface.md:716): zurücksetzen, sonst hielte Clawd ihn bis zum Sicherheitsnetz fest (Review S1)
    buddyKind = undefined
    buddy($, null)
    try {
      settings = cleanSettings(await $.store.get('settings'))
      await bindSession($)
    } catch {
      // Standard bis zur ersten Nachricht
    }
    housekeeping($).catch(() => {})
    // Befehle zuletzt, jeder für sich (CLAUDE.md, Registrieren in session.start); englisch
    for (const c of [
      { name: 'sidekick', description: t().cmdSidekick, argumentHint: '[on|off|status|threshold 80k|big 150k|skills on|off|ttl 5|60|auto|hints …]' },
      { name: 'savings', description: t().cmdSavings, argumentHint: '[detail] [today|week|all]' },
    ]) {
      try {
        await $.command.register(c)
      } catch {
        // ohne diesen Befehl
      }
    }
    return next(e)
  })

  // Jede Anfrage der Hauptschleife beobachten (Vorlage limit-bars register.ts:348-380); Subagenten nicht
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    let startedAt = 0
    try {
      startedAt = await $.clock.now()
    } catch {
      // ohne Uhr keine Auswertung
    }
    const r = yield* next(e)
    try {
      if (r.usage && startedAt) await afterStep($, r.usage, startedAt)
    } catch {
      // Beiwerk: die Anfrage selbst bleibt unberührt
    }
    return r
  })

  // Commits merken (Kurzfassung, Wiederholungsregel). `gitOperation` steht im Ergebnis von Bash und PowerShell (tools:4251, :4728)
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const r = await next(e)
    try {
      const res = 'result' in r ? (r.result as { gitOperation?: { commit?: { sha?: string } } } | undefined) : undefined
      const sha = res?.gitOperation?.commit?.sha
      if (typeof sha === 'string' && sha) {
        await bindSession($)
        const now = await $.clock.now()
        ses.commits += 1
        ses.commit = { sha, at: now }
        saveSes($, now)
      }
    } catch {
      // Beiwerk
    }
    return r
  })

  // Der Torwächter. Fail-open: Fehler, Timeout, ungültiges JSON, abgelehntes ask lassen die Nachricht durch.
  on('prompt.submit', async ($, e, next) => {
    // Ein getippter Wartungs-Befehl gilt als erledigt; im Hintergrund, die Nachricht geht unverändert weiter (SPEC Nachtrag 0.2.0)
    try {
      if (e.text.trim().startsWith('/')) noteDone($, doneFromText(e.text))
    } catch {
      // Beiwerk
    }
    let g: Gate = PASS
    try {
      g = await gate($, e.text, e.origin.kind, !!e.turnId || e.wait, next.signal)
    } catch {
      buddy($, null)
      return next(e)
    }
    const c = g.c
    if (!c) {
      buddy($, null)
      return sendWithWartung($, e, g.w, () => next(e))
    }
    const v = c.verdict
    let now = 0
    let base = 20000
    try {
      now = await $.clock.now()
      const b = await $.store.get('basis')
      if (typeof b === 'number' && b > 0) base = b
    } catch {
      // Schätzung mit Standard
    }
    // Mit Anhängen oder `@datei` kein neuer Chat: neu gesendet fehlten sie (types:8558-8561, limit-bars)
    const resendable = !e.attachments?.length && !/(^|\s)@\S/.test(e.text)
    const d = dialog(c, resendable, base)
    buddy($, d ? 'stop' : null)
    if (!d) {
      if (v && v.urteil !== 'durch' && v.zeile) {
        // Zeile unter dieser Nachricht (Verhalten 5); bei einem „anhalten“ ohne mögliche Aktion ebenso
        // Button für den Skill-Hinweis (Name gegen die Skill-Liste geprüft, Review 0.7.0 S3) und, seit 0.8.1, für jeden Befehl im
        // Satz, den die Befehlsliste dieser Session kennt (Sonnet schrieb „bald /uebergabe … erwägen“ als Art „sonstiges“)
        const hit = lineCommand(v.zeile, v.art === 'skill' ? v.skill : '', baseCache?.cmds ?? [])
        const line = hit?.line ?? (v.skill && v.zeile.includes(v.skill) ? hintLine(v.zeile, v.skill) : v.zeile)
        pending = { text: e.text, line, ...(hit ? { cmd: hit.cmd } : {}) }
        ses.open = { art: v.art, skill: v.skill, ctx: c.ctx }
        ses.last = { line, art: v.art, at: now }
        saveSes($, now)
        bookDay($, now, (x) => countHint(x, v.art, 'gezeigt'))
        // Der Hinweis der Prüfung hat Vorrang; der Wartungs-Hinweis gilt dann als nicht gezeigt
        const r = await next(e)
        $.ui.invalidate('ui.render')
        return r
      }
      return sendWithWartung($, e, g.w, () => next(e))
    }
    // Rückfrage: die Prüfung hat Vorrang, der Wartungs-Hinweis entfällt
    bookDay($, now, (x) => countHint(x, d.art, 'gezeigt'))
    // Auch die Zeile einer Rückfrage merken (/sidekick status, Fehlersuche)
    if (v?.zeile) {
      ses.last = { line: v.zeile, art: d.art, at: now }
      saveSes($, now)
    }
    let answer: Choice = 'send'
    try {
      answer = choiceOf(await $.ui.ask(d.question, { options: d.options, header: HEADER }))
      buddy($, null)
    } catch {
      buddy($, null)
      // Dialog geschlossen oder niemand zu fragen: so senden, wie getippt. Ausnahme falscher Chat (Fynn: verweigern, Review S2):
      // nicht in den falschen Chat senden, der Text bleibt zum Kopieren
      if (d.art !== 'falscher_chat') return next(e)
      bookDay($, now, (x) => countHint(x, d.art, 'abgebrochen'))
      forget($, c, now)
      return { drop: t().dropWrongChat(cut(e.text, 3000)) }
    }
    if (answer === 'fassung' && v?.fassung && showable(v.fassung)) {
      bookDay($, now, (x) => countHint(x, 'fassung', 'angenommen'))
      // Sichtbar machen, was gesendet wurde: Der Desktop zeigt in der Sprechblase das Original
      pending = { text: e.text, alt: v.fassung, line: t().sentFassung, sent: v.fassung }
      const r = await next({ ...e, text: v.fassung })
      $.ui.invalidate('ui.render')
      return r
    }
    if ((answer === 'new' || answer === 'plain') && resendable) {
      bookDay($, now, (x) => countHint(x, d.art, 'angenommen'))
      const check = c
      const text = e.text
      const plain = answer === 'plain'
      later($, 300, () => {
        runHandoff($, text, check, plain).catch((err) => $.ui.toast(t().newChatFailed(msg(err), cut(text, 300)), { timeoutMs: 30000 }))
      })
      // Der Text steht im Grund: feuert der Timer nie (Reload), ist er nicht verloren
      return { drop: t().dropStarting(plain, cut(e.text, 3000)) }
    }
    if (answer === 'abort') {
      // Beim falschen Chat ist Abbrechen die Empfehlung, also angenommen
      const wrong = d.art === 'falscher_chat'
      bookDay($, now, (x) => countHint(x, d.art, wrong ? 'angenommen' : 'abgebrochen'))
      if (wrong) forget($, c, now)
      return { drop: (wrong ? t().dropWrongChat : t().dropAborted)(cut(e.text, 3000)) }
    }
    // „Trotzdem senden“ (oder freier Text unter „Other“): ignoriert, so senden, wie getippt
    bookDay($, now, (x) => countHint(x, d.art, 'ignoriert'))
    if (c.trigger === 'c') askedCold = true
    // Trotzdem gesendet: diese Art ruht bis +50k oder zum nächsten Commit; beim falschen Chat auch im Kalt-Fall
    if (c.trigger !== 'c' || d.art === 'falscher_chat') ses.ignored = { ...ses.ignored, [d.art]: { ctx: c.ctx, commits: ses.commits } }
    saveSes($, now)
    return next(e)
  })

  // Skill-Nutzung zählen; ein vorgeschlagener Skill gilt dann als angenommen
  on('skill.prompt', async ($, e, next) => {
    try {
      noteDone($, doneFromSkill(e.skill, e.text))
    } catch {
      // Beiwerk
    }
    try {
      await bindSession($)
      const now = await $.clock.now()
      const o = ses.open
      const hit = o?.art === 'skill' && (o.skill === e.skill || e.skill.endsWith(`:${o.skill}`) || o.skill.endsWith(`:${e.skill}`))
      bookDay($, now, (d) => {
        d.skills[e.skill] = (d.skills[e.skill] ?? 0) + 1
        if (hit) countHint(d, 'skill', 'angenommen')
      })
      if (hit) {
        ses.open = null
        saveSes($, now)
      }
    } catch {
      // Beiwerk
    }
    return next(e)
  })

  // Hinweis unter der eigenen Nachricht, dauerhaft (Verhalten 5; PromptHint fehlt im Desktop 2.1.286)
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    let theirs: RenderElement | undefined
    let called = false
    try {
      let hit = ses.hints.find((h) => h.id === e.requestId)
      const own = ['composer', 'bridge', 'sdk'].includes(e.props.origin.kind)
      const shown = e.props.text.trim()
      if (!hit && own && pending && (shown === pending.text.trim() || shown === pending.alt?.trim())) {
        hit = { id: e.requestId, line: pending.line, ...(pending.sent ? { sent: cut(pending.sent, 2000) } : {}), ...(pending.cmd ? { cmd: pending.cmd } : {}) }
        pending = null
        ses.hints = [...ses.hints, hit].slice(-30)
        saveSes($, await $.clock.now())
      }
      called = true
      if (!hit) return next(e)
      // Andere Oberflächen: nur Text (Farbe und Rahmen sind dort nicht belegt)
      if (e.surface !== 'terminal' && e.surface !== 'desktop') {
        const sent = hit.sent ? t().sentPlain(hit.sent) : ''
        return next({ ...e, props: { ...e.props, text: `${e.props.text}\n\n· sidekick: ${hit.line}${sent}` } })
      }
      // Eigene Zeichnung unter der unveränderten Nachricht: die Zeile farbig, eine gesendete Fassung im Rahmen.
      // Ein Hook darf die Zeichnung der Engine einbetten (types:3864-3871); ein ungültiger Baum zeichnet die der Engine.
      theirs = await next(e)
      // Elemente als reine Daten {type, props, children} (types:9215-9218); nur der Button kommt aus $.ui.resolve (Nachtrag 0.7.0)
      const line: RenderNode[] = [el('Text', { color: ACCENT }, [`· sidekick: ${hit.line}`])]
      // Button für den Befehl der Zeile (Nachtrag 0.7.0): mit worklist und einem Skill als To-do, sonst ausführen (0.8.1)
      const id = hit.id
      const cmd = hit.cmd
      if (cmd && hit.queued) line.push(el('Text', { dimColor: true }, [`  ${t().btnQueued}`]))
      else if (cmd && hit.ran) line.push(el('Text', { dimColor: true }, [`  ${t().btnRan}`]))
      else if (cmd && pressing.has(id)) line.push(el('Text', { dimColor: true }, [`  ${t().btnBusy}`]))
      else if (cmd) {
        // Das Ziel steht beim Zeichnen fest und geht so in den Klick (Review S2); ohne geladene Befehlsliste: ausführen
        const route = routeOf(baseCache, cmd)
        const label = route === 'todo' ? t().btnTodo : t().btnRun(cmd)
        // Ein Button trägt eine Funktion und ist darum keine reine Daten-Zeichnung: über $.ui.resolve (Test: „not plain data“)
        line.push($.ui.resolve(e).Button({ key: 'sidekick-use', label, onPress: () => void useHint($, id, route) }) as RenderNode)
      }
      const kids: RenderNode[] = [el('Box', { key: 'sidekick-line', flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 }, line)]
      if (hit.sent) {
        const frame = { key: 'sidekick-sent', flexDirection: 'column', borderStyle: 'round', borderColor: ACCENT, paddingX: 1 }
        kids.push(el('Box', frame, [el('Text', { dimColor: true }, [t().sentLabel]), el('Text', {}, [hit.sent])]))
      }
      // Eine Leerzeile Abstand zur Antwort darunter (marginBottom, types:914)
      return el('Box', { flexDirection: 'column', marginBottom: 1 }, theirs ? [theirs, ...kids] : kids)
    } catch (err) {
      // Eigener Fehler nach `next`: die Zeichnung der Engine ohne Zeile; vor `next`: einfach durchreichen; ein Fehler aus der
      // Kette geht weiter (limit-bars register.ts:722-727)
      if (theirs !== undefined) return theirs
      if (!called) return next(e)
      throw err
    }
  })

  // Während „Neuer Chat“ läuft: kleine blaue Box über dem Prompt (sonst nichts Sichtbares, während das Modell
  // die Übergabe schreibt). Sonst unverändert durchreichen; das Band teilen sich limit-bars und clawd-buddy (types:9702-9713).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!busy || (e.surface !== 'terminal' && e.surface !== 'desktop') || e.props.hasSurvey) return next(e)
    const step = busy
    const theirs = await next(e)
    try {
      const secs = Math.max(0, Math.round(((await $.clock.now()) - step.since) / 1000))
      // Eine Leerzeile Abstand unter der Box (wirkt sauberer; marginBottom wie unter der Hinweis-Zeile)
      const box = el('Box', { key: 'sidekick-busy', flexShrink: 0, borderStyle: 'round', borderColor: ACCENT, paddingX: 1, marginBottom: 1 }, [
        el('Text', { color: ACCENT }, [`sidekick ${{ handoff: t().busyHandoff, plain: t().busyPlain, clear: t().busyClear }[step.step]} … ${secs} s`]),
      ])
      // Oberste Ebene über allen anderen Mods, in jeder Reihenfolge der Kette (band.ts, docs/BAND.md); Quick-Replies blenden
      // während der Übergabe aus, sidekick rückt dann auf ihre Höhe
      const { layers, base } = splitBand(theirs)
      const rest = base ? withoutKey(base as RenderElement, 'quick-replies') : null
      return joinBand([...layers.filter((l) => nameOf(l) !== 'quick-replies'), layer(LEVEL.sidekick, 'sidekick', box)], rest)
    } catch {
      return theirs
    }
  })

  on('command.run', { command: 'sidekick' }, async ($, e) => {
    const args = e.args.trim()
    if (/^hints\b/i.test(args)) return { text: await hintsCommand($, args.slice(5)) }
    if (args && args.toLowerCase() !== 'status') {
      settings = cleanSettings(await $.store.get('settings'))
      const s = applySetting(settings, args)
      if (!s) return { text: t().unknownArg(args, USAGE) }
      settings = s
      await $.store.set('settings', settings)
    }
    return { text: await statusText($) }
  })

  on('command.run', { command: 'savings' }, async ($, e) => {
    const v = savingsArgs(e.args)
    if (!v) return { text: t().savingsUsage }
    const { p } = v
    const now = await $.clock.now()
    const keys = (await $.store.keys()).filter((k) => k.startsWith('bilanz:'))
    const ledgers: Ledger[] = []
    for (const k of keys) ledgers.push(cleanLedger(await $.store.get(k)))
    const d = sumPeriod(ledgers, p, now)
    // Nur `/savings detail` braucht die Tage (Zeitraum je Modell, Verlauf je Tag)
    const days = v.detail ? daysInPeriod(ledgers, p, now) : undefined
    const tag = `#${(++reportNo).toString(36)}${now.toString(36).slice(-5)}`
    reports.set(tag, { d, p, now, days })
    while (reports.size > 10) reports.delete(reports.keys().next().value as string)
    return { text: savingsReport(d, p, now, tag, days) }
  })

  // /savings gezeichnet wie /ledger von cost-ledger: ein eigener Baum statt der Markdown-Zeile (types CommandOutput). `command`
  // gehört zu den Props, daher `props: { command }` im Matcher. Andere Oberflächen und unbekannte Zeilen: Markdown der Engine.
  on('ui.render', { component: 'CommandOutput', props: { command: 'savings' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const v = tag ? reports.get(tag) : undefined
    if (!v) return next(e)
    try {
      return savingsTree(v.d, v.p, v.now, e.viewport?.columns ?? 100, e.surface, v.days)
    } catch {
      return next(e)
    }
  })
}
