// sidekick: Hooks-Modul. Prüft die Nachricht des Nutzers vor dem Senden: erst Regeln, dann, wo es sich lohnt, kurz ein Modell (SPEC Verhalten 3).
// Ergebnis: durchlassen, graue Zeile unter der eigenen Nachricht (UserMessage, Verhalten 5) oder Rückfrage mit besserer Aktion,
// z. B. neuer Chat mit Übergabe, die ein Modell aus Kurzfassung und Verlaufsende schreibt (Verhalten 4). /savings zeigt die Bilanz.
// Fail-open: Jeder Fehler lässt die Nachricht unverändert durch; es gibt kein `.catch` (SPEC Fehlerverhalten). Ausnahme: nach
// „Neuer Chat mit Übergabe“ wird bei einem Fehler nie stillschweigend in den kalten Chat gesendet, es wird erneut gefragt.
// Eine Fassung geht nur nach der Antwort im Dialog raus (seit 0.15.0 gibt es keine Stufe, die ohne Rückfrage sendet).
import type { EngineInterface, On, RenderElement, RenderNode, Timer, UiPressArgument } from 'claude-code'
import { cacheState, cleanMem, completeCost, dayKey, emptyMem, hhmm, observeStep, parseTokens, rewriteCost, totalInput, ttlOf } from './cache.ts'
import { lang, setLang, shortDate, spanText, t, tokensText, usdText } from './i18n.ts'
import { isLanguage, languageCommand } from './language.ts'
import { NOTES_WORDS, addTopic, afterFill, afterOwnMessage, cleanNote, cleanTopics, nonNeg, notesPrompt, parseNote, shouldCheck, skipAfter } from './notes.ts'
import type { Note } from './notes.ts'
import { CHECK, HANDOFF, RATE, TIP_TARGETS, modelLabel, modelName } from './models.ts'
import type { CacheMem, CompleteUsage, StepUsage } from './cache.ts'
import { joinBand, layer, nameOf, splitBand } from './band.ts'
import {
  DEFAULT_SETTINGS,
  KEEP_DAYS,
  USAGE,
  applySetting,
  book,
  bookModel,
  bookNote,
  bookingStep,
  countNote,
  cacheText,
  checkPrompt,
  isHostText,
  lastReply,
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
  isHelp,
  lineCommand,
  handoffSystem,
  historyParts,
  isSuppressed,
  parseVerdict,
  rankChoices,
  planCompaction,
  savingsArgs,
  savingsReport,
  shownLine,
  sumPeriod,
  triggerOf,
  wrongChatChoices,
  applyTips,
  mdCell,
  tipsSwitch,
  bookRate,
  bookTip,
  briefMatches,
  BRIEF_PREFIX,
  cleanBrief,
  familyOf,
  hashText,
  isPricey,
  parseRate,
  priceShare,
  rateSystem,
  ratePrompt,
  spawnEligible,
  stepSaving,
  strikeTip,
  targetOf,
  tipBlock,
  tipRuns,
  tipSaved,
  TIP_WAYS,
} from './logic.ts'
import type { Art, Booking, Choice, Day, Ignored, Ledger, Level, NoteField, Period, Rate, Settings, Skill, TipWay, Tips, Trigger, Verdict } from './logic.ts'
import { savingsTree } from './view.ts'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { sidekickHelp } from './helpdata.ts'
import {
  HEAVY_TOKENS,
  REST,
  RULE_IDS,
  SECOND_PAUSE_MIN,
  UNUSED_DAYS,
  accepted,
  addSessionDay,
  applyHints,
  availOf,
  cleanHints,
  cleanWartung,
  doneFromSkill,
  doneFromText,
  fillOutcome,
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
// Akzent der Hilfe-Tabelle als Theme-Key (docs/HELP-SPEC.md §4, Fynn 2026-10-09; Nachtrag 0.14.1): Ein Hex folgt dem Theme nicht und
// lag auf hellem Grund bei 2,2:1. `ide` ist in den eingebauten RGB-Themes von 2.1.295 (hell, dunkel, je daltonisiert) rgb(71,130,200),
// auf Weiß ≈ 4,2:1, auf Schwarz ≈ 5:1; ANSI- und eigene Themes nehmen ihre eigene Farbe
const HELP_ACCENT = 'ide'
// Kreis der Anzeige im Desktop (0.10.2): bereit, arbeitet oder fragt, aus
const MODE_GREEN = '#3FB950'
const MODE_ORANGE = '#F0883E'
const MODE_RED = '#F85149'

/**
 * Eine Zeile unter einer eigenen Nachricht; `cmd`: Befehl für den Button, `ran`: schon ausgeführt (Nachtrag 0.8.1).
 * Wartungszeile (Ausbau 0.16.0): `wid` die Regel, `why` die Erklärung hinter „?“, `filled`: der Befehl steht schon im Eingabefeld.
 */
type HintRow = { id: string; line: string; sent?: string; cmd?: string; ran?: boolean; wid?: RuleId; why?: string; filled?: boolean }

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
  // Gewählter Wartungs-Hinweis, der noch nicht gezeigt wurde, weil die Prüfung eine eigene Zeile oder Rückfrage hatte; er kommt bei
  // der nächsten eigenen Nachricht ohne beides (Nachtrag 0.12.0)
  wartungOffen: Offen | null
  // Zweite Messung (Ausbau 0.16.0, E5): schon gelaufen; Commits bei der ersten Messung; Zeit der letzten eigenen Nachricht
  wartung2: boolean
  wartungCommits: number
  ownAt: number
  note: Note | null // „Gut zu wissen“ über dem Prompt (Nachtrag 0.13.0)
  leitsatz: boolean // Modell-Tipp (Ausbau 0.18.0): Leitsatz in dieser Session schon angehängt
}

/** Offener Wartungs-Hinweis; `at`: seit wann er wartet (Review 0.12.0 K5: in einer anderen Session gezeigt oder erledigt → verfällt). */
type Offen = WHint & { at?: number }
const offenOf = (h: WHint, now: number): Offen => ({ ...h, at: (h as Offen).at ?? now })

function emptySitzung(): Sitzung {
  return { summary: '', recent: [], own: 0, ignored: {}, hints: [], last: null, open: null, commits: 0, commit: null, wartung: false, wartungOffen: null, wartung2: false, wartungCommits: 0, ownAt: 0, note: null, leitsatz: false }
}

/** Offener Wartungs-Hinweis aus dem Store, tolerant gelesen (fehlt oder kaputt → null). */
function cleanOffen(v: unknown): Offen | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  if (!o || !(RULE_IDS as readonly unknown[]).includes(o.id) || typeof o.line !== 'string' || !o.line || typeof o.key !== 'string' || !o.key) return null
  return {
    id: o.id as RuleId,
    line: o.line,
    key: o.key,
    why: typeof o.why === 'string' ? o.why : '',
    ...(typeof o.cmd === 'string' && o.cmd.startsWith('/') ? { cmd: o.cmd } : {}),
    ...(typeof o.at === 'number' ? { at: o.at } : {}),
  }
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
        // `queued` (bis 0.14: als To-do eingereiht) gilt als schon erledigt: kein zweiter Klick auf denselben Befehl
        ...(h.ran === true || h.queued === true ? { ran: true } : {}),
        ...((RULE_IDS as readonly unknown[]).includes(h.wid) ? { wid: h.wid as RuleId } : {}),
        ...(typeof h.why === 'string' && h.why ? { why: h.why } : {}),
        ...(h.filled === true ? { filled: true } : {}),
      }))
      .slice(-30)
  if (o.last && typeof o.last.line === 'string') s.last = o.last
  if (o.open && typeof o.open.art === 'string') s.open = o.open
  if (typeof o.commits === 'number') s.commits = o.commits
  if (o.commit && typeof o.commit.sha === 'string') s.commit = o.commit
  if (o.wartung === true) s.wartung = true
  s.wartungOffen = cleanOffen(o.wartungOffen)
  if (o.wartung2 === true) s.wartung2 = true
  if (typeof o.wartungCommits === 'number') s.wartungCommits = o.wartungCommits
  if (typeof o.ownAt === 'number') s.ownAt = o.ownAt
  s.note = cleanNote(o.note)
  if (o.leitsatz === true) s.leitsatz = true
  return s
}

// ---------- Modell-Tipp: Zustand (Ausbau 0.18.0, Zustand) ----------

/**
 * Tipp dieses Chats, `$.store` `tip:<sessionId>` (7 Tage). `way`: `chat` nach der Rückfrage (sidekick schreibt `turn.step` um, S1 (ii)),
 * `sitzung`/`selbst` ein Chat, den Claude gestartet hat (das Modell setzte die App, sidekick bucht nur). `seen`: das Modell, das die
 * Engine beim ersten umgeschriebenen Schritt nannte; ein anderes später heißt, Fynn hat selbst gewechselt. `checkBack`: nach einem
 * getippten `/model` prüft der nächste Schritt, ob es zurück auf Opus/Fable ging.
 */
type ChatTip = { from: string; to: string; at: number; grund: string; way: 'chat' | 'sitzung' | 'selbst'; usd: number; counted: boolean; seen: string; ended: boolean; checkBack: boolean }

function cleanChatTip(v: unknown): ChatTip | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  if (!o || typeof o.from !== 'string' || typeof o.to !== 'string' || typeof o.at !== 'number') return null
  const way = o.way === 'sitzung' || o.way === 'selbst' ? o.way : 'chat'
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return { from: o.from, to: o.to, at: o.at, grund: typeof o.grund === 'string' ? o.grund : '', way, usd: num(o.usd), counted: o.counted === true, seen: typeof o.seen === 'string' ? o.seen : '', ended: o.ended === true, checkBack: o.checkBack === true }
}

/**
 * Ein beobachteter Subagent (`$.store` `spawn:<agentId>`, 2 Tage, höchstens 200 im Speicher). `kind`: `agent` von sidekick umgestellt,
 * `selbst` Claude wählte nach dem Leitsatz selbst ein günstigeres Modell, `opus` nicht umgestellt auf Opus/Fable (Rückblick).
 * `usd`: geschätzte Ersparnis (bei `opus` die Kosten) bis jetzt, `booked`: davon schon in der Bilanz, `wayBooked`: wo.
 */
type Watch = { kind: 'agent' | 'selbst' | 'opus'; from: string; to: string; grund: string; description: string; at: number; usd: number; booked: number; counted: boolean; struck: boolean; wayBooked: '' | TipWay }
const watches = new Map<string, Watch>()
const WATCH_MAX = 200
const SPAWN_DAYS = 2
const TIP_DAYS = 7
/** Zweiter Subagent mit gleicher Beschreibung auf Opus binnen so vieler Minuten: der erste war daneben (Gegenprobe). */
const SAME_TASK_MIN = 30

/** Letzte Umstellungen für `/sidekick tips` (`$.store` `tips:recent`, höchstens 10). */
type Recent = { at: number; way: 'chat' | 'agent' | 'sitzung'; from: string; to: string; grund: string; description: string }

let tip: ChatTip | null = null

let sessionId = ''
let mem: CacheMem = emptyMem()
let ses: Sitzung = emptySitzung()
let settings: Settings = { ...DEFAULT_SETTINGS }
// Hinweis, der an die nächste eigene Zeile mit diesem Text gebunden wird (UserMessage kennt die Message-ID, prompt.submit nicht)
// `alt`: die gesendete Fassung; der Desktop zeigt in der Sprechblase das Original, daher passen beide Texte
let pending: { text: string; alt?: string; line: string; sent?: string; cmd?: string; wid?: RuleId; why?: string } | null = null
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
// Die letzten `/sidekick help`-Schnappschüsse (höchstens 10), über die Kennung `#…` gefunden wie bei /savings (Nachtrag 0.14.0)
const helps = new Map<string, HelpData>()
let helpNo = 0

/** Ein Zeichen-Element als reine Daten (StyledElement, types:8851): Box oder Text mit einfachen Props. */
function el(type: 'Box' | 'Text', props: Record<string, string | number | boolean>, children: RenderNode[]): RenderElement {
  return { type, props, children }
}

// Höhe der sidekick-Ebene im Band (Nachtrag 0.15.2): über der Spotify-Leiste (40, mods/spotify/hooks/view.ts BAR_LEVEL). Steht hier
// statt in band.ts, weil band.ts in allen Mods dieselbe Kopie ist; LEVEL folgt beim nächsten gemeinsamen Band-Update (docs/BAND.md)
const SIDEKICK_LEVEL = 50
// Streifen wie die orange Trennlinie der Spotify-Leiste (mods/spotify/hooks/view.ts sepSvg): breiter als jedes Fenster, die Box schneidet ab
const STRIPE_W = 2400
const STRIPE_H = 26

/** Blaue Linie (2 px) mit 8 px Luft darüber und 16 px darunter. */
function stripeSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIPE_W}" height="${STRIPE_H}" viewBox="0 0 ${STRIPE_W} ${STRIPE_H}"><rect y="8" width="${STRIPE_W}" height="2" fill="${ACCENT}" opacity="0.85"/></svg>`
}

/** Die sidekick-Ebene; im Desktop mit dem blauen Streifen darunter. Svg gibt es nur auf entfernten Oberflächen (types:3795-3800). */
function sidekickLayer(content: RenderElement, surface: string): RenderElement {
  if (surface !== 'desktop') return layer(SIDEKICK_LEVEL, 'sidekick', content)
  const svg = { type: 'Svg', props: { source: stripeSvg(), alt: t().stripeAlt, width: STRIPE_W, height: STRIPE_H } } as RenderElement
  const stripe = el('Box', { key: 'sidekick-stripe', width: '100%', overflow: 'hidden', flexShrink: 0 }, [svg])
  return layer(SIDEKICK_LEVEL, 'sidekick', el('Box', { flexDirection: 'column', flexShrink: 0 }, [content, stripe]))
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
  if (kind !== buddyKind) {
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
  pushStatus($)
}

// ---- Anzeige in der Fußzeile (Nachtrag 0.10.0): `sidekick.status` = Stufe und ob sidekick gerade arbeitet. Der SessionMode-Hook
// liest den Wert und abonniert ihn so; ein Schreiben zeichnet nur diese Stelle neu, kein $.ui.invalidate (types:3310-3313).
// Regeln wie bei `buddy`: nie warten, Fehler verschlucken, nacheinander.
// `tip`: Name des Zielmodells, solange sidekick in diesem Chat umstellt (Ausbau 0.18.0: „→ Sonnet“ im Label)
type Status = { level: Level; busy: boolean; tip?: string }
let statusLast: string | undefined = undefined // `undefined` = unbekannt (nach einem Neuladen): sicher schreiben
let statusChain: Promise<unknown> = Promise.resolve()
/**
 * Diagnose der Anzeige (0.10.1, wie `seen()` im Orchestrator): Ruft die Engine `SessionMode` auf, auf welcher Oberfläche, und
 * scheitert das Lesen von `sidekick.status`? `/sidekick status` zeigt es. Im Store nur bei einer Änderung, nicht je Zeichnung.
 */
type ModeDiag = { at: number; surface: string; err: string }
let modeDiag: ModeDiag | null = null
function noteMode($: EngineInterface, surface: string, err: string) {
  if (modeDiag && modeDiag.surface === surface && modeDiag.err === err) return
  modeDiag = { at: 0, surface, err }
  $.clock
    .now()
    .then((at) => {
      if (modeDiag) modeDiag.at = at
      return $.store.set('diag:sessionMode', modeDiag)
    })
    .catch(() => {})
}

/** Arbeitet sidekick gerade: Prüfung (`check`), offene Rückfrage (`stop`), Übergabe (`handoff`) oder eine Box (Übergabe). */
const busyNow = () => buddyKind === 'check' || buddyKind === 'stop' || buddyKind === 'handoff' || busy !== null
function pushStatus($: EngineInterface) {
  const tipName = tip && !tip.ended && tip.way === 'chat' ? modelName(tip.to) : ''
  const value: Status = { level: settings.level, busy: settings.level !== 'off' && busyNow(), ...(tipName ? { tip: tipName } : {}) }
  const key = JSON.stringify(value)
  if (key === statusLast) return
  statusLast = key
  try {
    statusChain = statusChain.then(() => $.state.set({ plugin: 'sidekick', key: 'status' }, value)).catch(() => {})
  } catch {
    // Beiwerk
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
  const had = !!tip
  tip = cleanChatTip(await $.store.get(`tip:${id}`))
  // Nach /clear gehört „→ Sonnet“ nicht mehr ins Label (der neue Chat hat keinen Tipp)
  if (had || tip) pushStatus($)
}

function saveTip($: EngineInterface) {
  if (!sessionId || !tip) return
  $.store.set(`tip:${sessionId}`, tip).catch(() => {})
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

// Laufende Klicks (Review 0.7.0 S1): die Sperre steht vor dem ersten `await`, ein Doppelklick legt nichts doppelt an
const pressing = new Set<string>()

/**
 * Klick auf den Button: der Befehl selbst über `$.command.run`, „as if the person typed“ und hinter einem laufenden Turn eingereiht
 * (types:2997-3003). Erledigt wird erst nach dem erfolgreichen Aufruf gespeichert (Review K1); bis dahin gilt es nur im Speicher.
 * Lehnt die Engine den Befehl ab, kommt er als Rückfall ins Eingabefeld (Stand 0.7.0). Ein Weg über To-dos entfiel mit 0.15.0.
 */
async function useHint($: EngineInterface, id: string) {
  const h = ses.hints.find((x) => x.id === id)
  if (!h?.cmd || h.ran || pressing.has(id)) return
  const cmd = h.cmd
  pressing.add(id)
  $.ui.invalidate('ui.render')
  try {
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

/**
 * Wartungszeile (Ausbau 0.16.0, E1-E3): den Befehl ins Eingabefeld schreiben, Fynn schickt ihn selbst ab. Nichts wird gesendet, nichts
 * als erledigt gebucht; erledigt wird er erst, wenn der Befehl wirklich läuft (prompt.submit, skill.prompt).
 * - Feld nicht leer: kein Einfügen. Ein Slash-Befehl wirkt nur am Anfang einer Nachricht, angehängt wäre er Text (E2).
 * - `append` statt `replace`: tippt Fynn zwischen read und fill, bleibt sein Text (wie Review 0.13.0 K2).
 * - `no_composer` (Desktop zeichnet ein eigenes Eingabefeld, headless) oder ohne Grund: in die Zwischenablage (E3, types:2559-2572),
 *   sonst der Befehl im Toast zum Abtippen. `dialog`: erst den Dialog beantworten.
 */
type Surface = NonNullable<Parameters<EngineInterface['ui']['copy']>[0]['surface']>

async function insertHint($: EngineInterface, id: string, surface: Surface | undefined) {
  const h = ses.hints.find((x) => x.id === id)
  if (!h?.cmd || h.filled || pressing.has(id)) return
  const cmd = h.cmd
  const x = t()
  pressing.add(id)
  try {
    const box = await $.prompt.read().catch(() => null)
    if (box && box.text.trim()) {
      $.ui.toast(x.insBoxFull(cmd), { timeoutMs: 10000 })
      return
    }
    const next = fillOutcome(await $.prompt.fill({ text: cmd, mode: 'append' }).catch(() => null), cmd)
    if (next === 'filled') {
      const row = ses.hints.find((y) => y.id === id)
      if (row) {
        row.filled = true
        saveSes($, await $.clock.now().catch(() => 0))
      }
      return
    }
    if (next === 'mixed' || next === 'dialog') {
      $.ui.toast(next === 'mixed' ? x.insBoxFull(cmd) : x.insDialog(cmd), { timeoutMs: 10000 })
      return
    }
    // Die Oberfläche des Drucks (ButtonProps.onPress, types:1150-1160)
    const c = await $.ui.copy({ text: cmd, ...(surface ? { surface } : {}) }).catch(() => null)
    $.ui.toast(c?.isCopied ? x.insCopied(cmd) : x.insFailed(cmd), { timeoutMs: 15000 })
  } catch {
    $.ui.toast(x.insFailed(cmd), { timeoutMs: 15000 })
  } finally {
    pressing.delete(id)
    $.ui.invalidate('ui.render')
  }
}

// „?“ an der Wartungszeile: aufgeklappt, nur im Speicher (Ausbau 0.16.0)
const whyOpen = new Set<string>()

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
  const resting = [heavy.hintAt, heavy.doneAt].some((t) => !!t && now - t < REST.skillsHeavy * DAY)
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
      // Der Befehl lief: ein noch offener Hinweis dazu kommt nicht mehr (Nachtrag 0.12.0)
      if (ses.wartungOffen && ids.includes(ses.wartungOffen.id)) {
        ses.wartungOffen = null
        saveSes($, now)
      }
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

/**
 * Offener Wartungs-Hinweis (Nachtrag 0.12.0): Er verfällt, wenn Wartungs-Hinweise oder diese Regel inzwischen aus sind, oder wenn eine
 * andere Session im selben Projekt ihn seitdem gezeigt oder erledigt hat (Review 0.12.0 K5). Dass der Befehl hier lief, räumt `noteDone`
 * ab.
 */
async function stillOpen($: EngineInterface, h: Offen): Promise<WHint | null> {
  const hs = cleanHints(await $.store.get('hints'))
  let open = hs.on && !hs.off.includes(h.id)
  if (open && h.at) {
    const r = cleanWartung(await $.store.get(`wartung:${h.key}`)).regeln[h.id]
    open = (r?.doneAt ?? 0) <= h.at && (r?.hintAt ?? 0) <= h.at
  }
  if (open) return h
  ses.wartungOffen = null
  saveSes($, await $.clock.now())
  return null
}

/** Die Prüfung belegt diese Nachricht mit eigener Zeile oder Rückfrage: der gewählte Wartungs-Hinweis wartet auf die nächste. */
function keepWartung($: EngineInterface, h: WHint | null, now: number) {
  if (!h) return
  ses.wartungOffen = offenOf(h, now)
  saveSes($, now)
}

/** Den Wartungs-Hinweis als Zeile unter dieser Nachricht zeigen (wie der Hinweis der Prüfung, Verhalten 5), dann senden. */
async function sendWithWartung<R>($: EngineInterface, e: { text: string }, h: WHint | null, send: () => Promise<R> | R): Promise<R> {
  if (!h) return send()
  try {
    const now = await $.clock.now()
    pending = { text: e.text, line: h.line, wid: h.id, ...(h.why ? { why: h.why } : {}), ...(h.cmd ? { cmd: h.cmd } : {}) }
    ses.last = { line: h.line, art: 'sonstiges', at: now }
    ses.wartungOffen = null
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
    .filter((m) => m.role === 'user' && typeof m.text === 'string' && m.text.trim() && !isHostText(m.text))
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
// `main`: Hauptmodell aus `$.session.model()` (Ausbau 0.18.0, Befund 1); `brief`: die erste Nachricht kommt aus einem Auftrag eines anderen Chats
type Check = { trigger: Trigger; ctx: number; model: string; main: string; brief: boolean; ttl: 5 | 60; cold: boolean; unknown: boolean; coldFor: number; verdict: Verdict | null; before: { recent: string[]; summary: string } }

/** Hauptmodell der Session (types:2889-2891); ohne Antwort das zuletzt gesehene aus `turn.step`. */
async function mainModel($: EngineInterface): Promise<string> {
  try {
    return (await $.session.model()) || mem.model
  } catch {
    return mem.model
  }
}

/**
 * Erste Nachricht eines Chats, den Claude über `start_session` gestartet hat (Verhalten 4): Steht ein gemerkter Auftrag darin, gilt
 * seine Entscheidung. Der Chat bucht seine Schritte mit dem gemerkten Ausgangsmodell; der Eintrag ist danach verbraucht.
 */
async function claimBrief($: EngineInterface, text: string, now: number): Promise<boolean> {
  const keys = (await $.store.keys()).filter((k) => k.startsWith('brief:')).slice(0, 100)
  for (const k of keys) {
    const b = cleanBrief(await $.store.get(k))
    if (!b || !briefMatches(b, text, now)) continue
    await $.store.delete(k)
    tip = { from: b.from, to: b.to, at: now, grund: '', way: b.selbst ? 'selbst' : 'sitzung', usd: 0, counted: false, seen: '', ended: false, checkBack: false }
    saveTip($)
    return true
  }
  return false
}

/** Ergebnis des Torwächters: die Prüfung (null = ohne Prüfung durchlassen) und ein Wartungs-Hinweis für genau diese Nachricht. */
type Gate = { c: Check | null; w: WHint | null }
const PASS: Gate = { c: null, w: null }

/** Schritt 1 bis 3 der SPEC (Verhalten 3): Filter, Auslöser, Modell-Prüfung. */
async function gate($: EngineInterface, text: string, kind: string, running: boolean, signal: AbortSignal): Promise<Gate> {
  settings = cleanSettings(await $.store.get('settings'))
  pushStatus($)
  if (settings.level === 'off' || running || text.trim().startsWith('/')) return PASS
  // Vom Host eingefügte Nachrichten wie `<system-reminder>…` (Desktop, Worktree-Chat) sind nicht vom Nutzer: keine Prüfung, und sie
  // verbrauchen nicht die Wartungs-Prüfung des Chats (Desktop-Test 2026-10-06)
  if (isHostText(text)) return PASS
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
  // Auftrag eines Eltern-Chats (Verhalten 4): Entscheidung ist gefallen, keine Rückfrage; Fehler: wie ohne Eintrag
  const brief = first ? await claimBrief($, text, now).catch(() => false) : false
  const before = { recent, summary: ses.summary }
  ses.recent = [...recent, cut(text, 400)].slice(-3)
  // Einmal pro Session, parallel zur Modell-Prüfung; ein Fehler kostet nur den Hinweis, nie die Nachricht (fail-open)
  let wp: Promise<WHint | null> = Promise.resolve(null)
  // Cache-Stufe: keine Wartungs-Hinweise (Nachtrag 0.10.0)
  const ownBefore = ses.ownAt
  ses.ownAt = now
  if (!ses.wartung && settings.level !== 'cache') {
    ses.wartung = true
    ses.wartungCommits = ses.commits
    wp = maintenance($, now).catch(() => null)
  } else if (ses.wartungOffen && settings.level !== 'cache') {
    // Bei der ersten Nachricht gewählt, aber nicht gezeigt: jetzt erneut anbieten (Nachtrag 0.12.0)
    wp = stillOpen($, ses.wartungOffen).catch(() => null)
  } else if (!ses.wartung2 && settings.level !== 'cache' && (ses.commits > ses.wartungCommits || (ownBefore > 0 && now - ownBefore >= SECOND_PAUSE_MIN * 60000))) {
    // Zweite Messung, höchstens einmal je Chat: nach einem Commit oder nach einer Pause (Ausbau 0.16.0, E5). Was in diesem Chat schon
    // gezeigt wurde, ruht ohnehin (hintAt)
    ses.wartung2 = true
    wp = maintenance($, now).catch(() => null)
  }
  const trigger = triggerOf({ first, ctx, cold: st.kind === 'cold', unknown: st.kind === 'unknown', settings })
  if (!trigger) {
    saveSes($, now)
    return { c: null, w: await wp }
  }
  const main = trigger === 'a' ? await mainModel($) : mem.model
  const base = { trigger, ctx, model: mem.model || main, main, brief, ttl, cold: st.kind === 'cold', unknown: st.kind === 'unknown', coldFor: -st.left, before }
  // Cache-Stufe: nur die Kalt-Rückfrage nach Regeln, kein Modellaufruf (sie kommt auch ohne Urteil, Verhalten 3.4)
  if (settings.level === 'cache') {
    saveSes($, now)
    return { c: { ...base, verdict: null }, w: null }
  }
  const skills = settings.skills ? await loadSkills($, now) : null
  // Ende der letzten Antwort: Ohne sie hielt die Prüfung Antworten auf Rückfragen („ja, B“) für unklar (0.10.4). Fehler: ohne (fail-open)
  const reply = await $.session.messages().then((m) => lastReply(m, text), () => '')
  const c = ses.commit
  const prompt = checkPrompt(ses.summary, recent, text, {
    trigger,
    ctx,
    cache: cacheText(st.kind, st.left),
    // Bis 0.17.1 stand hier `mem.model`, bei der ersten Nachricht also „unbekannt“ (Ausbau 0.18.0, Befund 1)
    model: main,
    commit: c ? `${c.sha} vor ${spanText(now - c.at)}` : 'keiner',
  }, reply)
  // Bricht der Nutzer ab, endet auch die Prüfung (types:2500-2501)
  buddy($, 'check')
  const names = (skills ?? []).map((s) => s.name)
  const t0 = await $.clock.now()
  // Feld `aufwand` nur bei der ersten Nachricht (Verhalten 2)
  const r = await $.model.complete({ ...CHECK, system: checkSystem(skills, trigger === 'a'), prompt }, { signal })
  const done = await $.clock.now()
  // `usage` kommt auf jedem Arm, auch bei Abbruch (types:6131): immer buchen
  const usd = completeCost(r.usage as CompleteUsage, CHECK.model)
  bookDay($, now, (d) => {
    d.kosten += usd
    d.pruefungen += 1
    d.warteMs += done - t0
    bookModel(d, CHECK.model, 'pruefung', usd, done - t0, r.usage as CompleteUsage)
  })
  let verdict = r.isAnswered ? parseVerdict(r.text, trigger, names, text) : null
  if (verdict?.kurzfassung) ses.summary = verdict.kurzfassung
  if (verdict && verdict.urteil !== 'durch' && isSuppressed(ses.ignored, verdict.art, ctx, ses.commits)) verdict = { ...verdict, urteil: 'durch' }
  saveSes($, now)
  return { c: { ...base, verdict }, w: await wp }
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
  return { new: x.newChat, plain: x.newPlain, fassung: x.fassung(whoOf()), send: x.send, abort: x.abort }[c]
}
/** Antworttexte, die erste mit „(empfohlen)“. */
const labels = (list: Choice[]) => list.map((c, i) => label(c) + (i === 0 ? t().recommended : ''))
/** Gewählte Antwort zurück zur Wahl; „(empfohlen)“ zählt nicht mit. Unbekannter Text (freie Eingabe) gilt als „senden“. */
function choiceOf(answer: string): Choice {
  const a = answer.endsWith(t().recommended) ? answer.slice(0, -t().recommended.length) : answer
  return (['new', 'plain', 'fassung', 'send', 'abort'] as const).find((c) => label(c) === a) ?? 'send'
}
/** Name des Modells hinter der Prüfung, für Texte wie „Haikus Fassung“. */
const whoOf = () => modelName(CHECK.model)

const FASSUNG_MAX = 600
const showable = (f: string) => !!f && f.length <= FASSUNG_MAX

/** Die Rückfrage: Frage und Antworten (2–4, Frage endet mit „?“, types:2332-2346). */
function dialog(c: Check, resendable: boolean, base: number): { question: string; options: string[]; art: Art } | null {
  const v = c.verdict
  const who = whoOf()
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
    if (v && v.urteil !== 'durch' && v.zeile) parts.push(`${who}: ${v.zeile}`)
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
  return { question: `${v.zeile || t().fassungDefault(who)}\n\n${t().fassungBlock(v.fassung)}\n\n${t().howNext}`, options: labels(['fassung', 'send', 'abort']), art: 'fassung' }
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
  pushStatus($)
  // Sekunden mitzählen: alle 1 s neu zeichnen, nur solange die Box steht
  if (!busyTimer) busyTimer = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  $.ui.invalidate('ui.render')
}

function hideBusy($: EngineInterface) {
  // Abgebrochen oder gescheitert: Clawd hört auf, den Brief zu schreiben; „neuer Chat da“ bleibt stehen
  if (buddyKind === 'handoff') buddy($, null)
  if (!busy) return
  busy = null
  pushStatus($)
  busyTimer?.cancel()
  busyTimer = null
  $.ui.invalidate('ui.render')
}

async function writeHandoff($: EngineInterface, text: string, c: Check) {
  const oldSession = sessionId
  const msgs = await $.session.messages()
  // Anfang und Ende des Verlaufs, die neue Nachricht und Fakten, die sidekick hat (Nachtrag 0.12.0, H1–H3)
  const parts = historyParts(msgs, 100000)
  const start = await $.clock.now()
  let root = ''
  try {
    root = await $.session.root()
  } catch {
    // ohne Projektwurzel: „unbekannt“
  }
  const cm = ses.commit
  const facts = { root, commit: cm ? `${cm.sha} vor ${spanText(start - cm.at)}` : 'keiner', model: mem.model ? modelLabel(mem.model) : '' }
  const prompt = handoffPrompt(ses.summary, parts.start, parts.tail, text, facts)
  const r = await $.model.complete({ ...HANDOFF, system: handoffSystem(), prompt })
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

// ---------- Modell-Tipp (Ausbau 0.18.0) ----------

const DAY_MS = 24 * 60 * 60000
type TipChoice = 'haiku' | 'sonnet' | 'main' | 'never'

/** Zielmodell als volle ID; ein `[1m]` des Hauptmodells geht auf Sonnet über (S1: `turn.step` nimmt `claude-sonnet-5-5[1m]` an). */
function targetId(target: 'haiku' | 'sonnet', main: string): string {
  const id = TIP_TARGETS[target].id
  return target === 'sonnet' && /\[1m\]/i.test(main) ? `${id}[1m]` : id
}

function addRecent($: EngineInterface, r: Recent) {
  $.store
    .get('tips:recent')
    .then((v) => $.store.set('tips:recent', [...(Array.isArray(v) ? v : []), r].slice(-10)))
    .catch(() => {})
}

/**
 * Nur `tips` ändern, auf frisch gelesenen Einstellungen (Review 0.18.0 S2): Der Dialog hat kein Zeitlimit, eine andere Session kann
 * inzwischen Stufe oder Schalter geändert haben. Fehler: nichts gespeichert, die Nachricht geht trotzdem weiter.
 */
async function updateTips($: EngineInterface, fn: (t: Tips) => Tips) {
  try {
    const cur = cleanSettings(await $.store.get('settings'))
    settings = { ...cur, tips: fn(cur.tips) }
    await $.store.set('settings', settings)
  } catch {
    // Beiwerk
  }
}

/**
 * Die Rückfrage vor dem Senden (Verhalten 2, E1). Die Nachricht geht danach in jedem Fall unverändert weiter; bei Annahme schreibt
 * `turn.step` das Modell jeder Hauptanfrage dieses Chats um (S1: `/model` über `$.command.run` speichert das Modell als Standard für neue
 * Sessions, darum Variante (ii)). Geschlossen oder abgelehnt (`-p`): unverändert senden, nur gezählt (fail-open).
 */
async function askTip($: EngineInterface, c: Check, now: number) {
  const v = c.verdict
  const target = targetOf(v?.aufwand, settings.tips.haiku)
  if (!v || !target) return
  const x = t()
  const list: TipChoice[] = target === 'haiku' ? ['haiku', 'sonnet', 'main', 'never'] : ['sonnet', 'main', 'never']
  const name = (ch: TipChoice) => (ch === 'main' ? modelLabel(c.main) : ch === 'never' ? '' : modelLabel(TIP_TARGETS[ch].id))
  const label = (ch: TipChoice) => (ch === 'never' ? x.tipNever : x.tipSend(name(ch)))
  const options = list.map((ch, i) => label(ch) + (i === 0 ? x.recommended : ''))
  const question = x.tipQuestion(v.grund ?? '', modelLabel(TIP_TARGETS[target].id), Math.round(priceShare(c.main, TIP_TARGETS[target].id) * 100))
  bookDay($, now, (d) => countHint(d, 'modell', 'gezeigt'))
  buddy($, 'stop')
  let answer = ''
  try {
    answer = await $.ui.ask(question, { options, header: HEADER })
  } catch {
    buddy($, null)
    bookDay($, now, (d) => countHint(d, 'modell', 'abgebrochen'))
    return
  }
  buddy($, null)
  const plain = answer.endsWith(x.recommended) ? answer.slice(0, -x.recommended.length) : answer
  // Frei getippter Text (Feld „Other“): wie das Hauptmodell senden, aber kein „abgelehnt“ (Review 0.18.0 K5)
  const ch = list.find((y) => label(y) === plain) ?? null
  if (ch === 'haiku' || ch === 'sonnet') {
    tip = { from: c.main, to: targetId(ch, c.main), at: now, grund: v.grund ?? '', way: 'chat', usd: 0, counted: false, seen: '', ended: false, checkBack: false }
    saveTip($)
    await updateTips($, (tp) => ({ ...tp, declined: 0 }))
    bookDay($, now, (d) => countHint(d, 'modell', 'angenommen'))
    addRecent($, { at: now, way: 'chat', from: c.main, to: tip.to, grund: tip.grund, description: '' })
    pushStatus($)
    return
  }
  bookDay($, now, (d) => countHint(d, 'modell', 'ignoriert'))
  if (ch === 'never') {
    await updateTips($, (tp) => ({ ...tp, first: false, declined: 0 }))
    return
  }
  if (ch !== 'main') return
  // Dreimal hintereinander das teure Modell: 7 Tage Ruhe, ein Toast sagt es einmal (Nicht nerven)
  let rest = false
  await updateTips($, (tp) => {
    const declined = tp.declined + 1
    rest = declined >= 3
    return { ...tp, declined: rest ? 0 : declined, restUntil: rest ? now + 7 * DAY_MS : tp.restUntil }
  })
  if (rest) $.ui.toast(x.tipRests, { timeoutMs: 10000 })
}

/** Das Umschreiben dieses Chats beenden; `back`: zurück auf Opus/Fable, dann wird die Ersparnis gestrichen (Gegenprobe). */
function endTip($: EngineInterface, back: boolean, now: number) {
  const tp = tip
  if (!tp || tp.ended) return
  tp.ended = true
  tp.checkBack = false
  const usd = tp.usd
  if (back && tp.way === 'chat') {
    const counted = tp.counted
    tp.usd = 0
    bookDay($, now, (d) => strikeTip(d, 'chat', 'zurueck', usd, counted))
  }
  saveTip($)
  pushStatus($)
}

/**
 * Welches Modell dieser Hauptschritt bekommt (S1 (ii)): das Ziel des Tipps, solange Fynn nicht selbst gewechselt hat. Ein anderes
 * `e.model` als beim ersten Schritt, oder nach einem getippten `/model` wieder Opus/Fable, beendet das Umschreiben.
 */
function tipModel($: EngineInterface, model: string, now: number): string {
  const tp = tip
  if (!tp || tp.ended || tp.way !== 'chat') return ''
  if (!tp.seen) {
    tp.seen = model
    saveTip($)
  } else if (model !== tp.seen) {
    endTip($, isPricey(model), now)
    return ''
  }
  if (tp.checkBack) {
    tp.checkBack = false
    if (isPricey(model)) {
      endTip($, true, now)
      return ''
    }
  }
  return tp.to
}

/** Ein Schritt im Hauptchat mit Tipp: Ersparnis buchen, wenn er wirklich auf dem Zielmodell lief (`result.model`). */
function tipStep($: EngineInterface, u: CompleteUsage & { model?: string }, at: number) {
  const tp = tip
  if (!tp || tp.ended || !u.model || familyOf(u.model) !== familyOf(tp.to)) return
  const usd = stepSaving(u, tp.from, tp.to)
  const first = !tp.counted
  tp.usd += usd
  tp.counted = true
  saveTip($)
  const way: TipWay = tp.way
  bookDay($, at, (d) => bookTip(d, way, usd, first))
}

/** `RATE` über einen Auftrag; gebucht wird jedes Urteil (Kosten in `kosten`, Rolle `tipp`). Fehler, Timeout, kein JSON: null. */
async function rate($: EngineInterface, input: Parameters<typeof ratePrompt>[0], signal?: AbortSignal): Promise<Rate | null> {
  const t0 = await $.clock.now()
  const r = await $.model.complete({ ...RATE, system: rateSystem(), prompt: ratePrompt(input) }, signal ? { signal } : undefined)
  const ms = (await $.clock.now()) - t0
  const v = r.isAnswered ? parseRate(r.text) : null
  const usd = completeCost(r.usage as CompleteUsage, RATE.model)
  bookDay($, t0, (d) => bookRate(d, RATE.model, usd, ms, v?.stufe ?? null, r.usage as CompleteUsage))
  return v
}

function keepWatch($: EngineInterface, id: string, w: Watch) {
  watches.set(id, w)
  while (watches.size > WATCH_MAX) watches.delete(watches.keys().next().value as string)
  $.store.set(`spawn:${id}`, w).catch(() => {})
}

/** Subagenten, die schon im Store nachgesehen wurden (je einmal je Modul). */
const looked = new Set<string>()

function cleanWatch(v: unknown): Watch | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  if (!o || (o.kind !== 'agent' && o.kind !== 'selbst' && o.kind !== 'opus') || typeof o.from !== 'string' || typeof o.to !== 'string' || typeof o.at !== 'number') return null
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  const way = (TIP_WAYS as readonly unknown[]).includes(o.wayBooked) ? (o.wayBooked as TipWay) : ''
  const str = (x: unknown) => (typeof x === 'string' ? x : '')
  return { kind: o.kind, from: o.from, to: o.to, grund: str(o.grund), description: str(o.description), at: o.at, usd: num(o.usd), booked: num(o.booked), counted: o.counted === true, struck: o.struck === true, wayBooked: way }
}

/**
 * Nach einem Neuladen (auch durch `/sidekick language`) einen beobachteten Subagenten aus `spawn:<agentId>` zurückholen (Review 0.18.0
 * K4). Schritte während des Neuladens fehlen; was schon gebucht war, bleibt.
 */
async function restoreWatch($: EngineInterface, agentId: string) {
  if (watches.has(agentId) || looked.has(agentId)) return
  looked.add(agentId)
  while (looked.size > WATCH_MAX * 5) looked.delete(looked.values().next().value as string)
  const w = cleanWatch(await $.store.get(`spawn:${agentId}`))
  if (w) watches.set(agentId, w)
}

/** Ein Schritt eines Subagenten (`turn.step` mit `agentId`): Ersparnis bzw. beim Rückblick die Kosten aufsummieren, gebucht am Ende. */
function watchStep(agentId: string, u: (CompleteUsage & { model?: string }) | undefined) {
  const w = watches.get(agentId)
  if (!w || !u?.model) return
  if (w.kind === 'opus') {
    if (isPricey(u.model)) w.usd += completeCost(u, u.model)
  } else if (familyOf(u.model) === familyOf(w.to)) w.usd += stepSaving(u, w.from, w.to)
}

/**
 * Ende eines Laufs (`turn.complete` mit `agentId`): das Aufsummierte buchen. Ein umgestellter Lauf, der mit `error` oder `aborted` endet
 * (types:14554-14560) oder schon als daneben markiert ist, wandert ganz nach `daneben` (Gegenprobe).
 */
function flushWatch($: EngineInterface, agentId: string, reason: string, at: number) {
  const w = watches.get(agentId)
  if (!w) return
  const bad = w.kind === 'agent' && (reason === 'error' || reason === 'aborted' || w.struck)
  const delta = w.usd - w.booked
  const prevWay = w.wayBooked
  const prevBooked = w.booked
  // Ein Lauf zählt einmal; ein Subagent mit mehreren Runden (SendMessage) bucht je Runde nur das Neue
  const way: TipWay = w.kind !== 'agent' ? w.kind : bad || prevWay === 'daneben' ? 'daneben' : 'agent'
  bookDay($, at, (d) => {
    if (way === 'daneben' && prevWay === 'agent') {
      strikeTip(d, 'agent', 'daneben', prevBooked, true)
      bookTip(d, 'daneben', delta, false)
    } else bookTip(d, way, delta, prevWay === '')
  })
  w.booked = w.usd
  w.counted = true
  w.wayBooked = way
  keepWatch($, agentId, w)
}

/** Gegenprobe: Ein neuer Subagent auf Opus/Fable mit derselben Beschreibung binnen 30 min heißt, der umgestellte Lauf war daneben. */
async function strikeSame($: EngineInterface, description: string, now: number) {
  const desc = description.trim()
  if (!desc) return
  for (const [id, w] of watches) {
    if (w.kind !== 'agent' || w.struck || w.description.trim() !== desc || now - w.at > SAME_TASK_MIN * 60000) continue
    w.struck = true
    if (w.counted && w.wayBooked === 'agent') {
      const usd = w.booked
      w.wayBooked = 'daneben'
      bookDay($, now, (d) => strikeTip(d, 'agent', 'daneben', usd, true))
    }
    keepWatch($, id, w)
  }
}

type SpawnIn = Parameters<typeof spawnEligible>[0] & { prompt: string; description: string; subagentType: string; tool_use_id: string }
type SpawnOut = { model?: string; agentId?: string; deny?: string }

/** Vorfilter und Urteil vor dem Start (Verhalten 3); null: nichts ändern. */
async function planSpawn($: EngineInterface, e: SpawnIn, signal?: AbortSignal): Promise<{ target: 'haiku' | 'sonnet'; v: Rate } | null> {
  settings = cleanSettings(await $.store.get('settings'))
  if (settings.level !== 'guide' || !settings.tips.auto || !spawnEligible(e)) return null
  // Ohne gebundene Session ginge die Buchung des Urteils verloren (erster Subagent nach dem Laden, Test 0.18.0)
  await bindSession($)
  const v = await rate($, { kind: 'agent', type: e.subagentType, description: e.description, prompt: e.prompt, parentModel: e.parentModel }, signal)
  const target = targetOf(v?.stufe, settings.tips.haiku)
  return v && target ? { target, v } : null
}

/** Nach dem Start: beobachten (umgestellt, selbst gewählt, Rückblick), Zeile im Agent-Fenster, Gegenprobe gegen frühere Läufe. */
async function afterSpawn($: EngineInterface, e: SpawnIn, r: SpawnOut, plan: { target: 'haiku' | 'sonnet'; v: Rate } | null) {
  if (r.deny || !r.agentId || !r.model || settings.level !== 'guide') return
  await bindSession($)
  const now = await $.clock.now()
  const base = { grund: plan?.v.grund ?? '', description: e.description, at: now, usd: 0, booked: 0, counted: false, struck: false, wayBooked: '' as const }
  if (plan && familyOf(r.model) === plan.target) {
    // Meldet `next` ein anderes Modell (in der Session erzwungen), bucht sidekick nichts
    keepWatch($, r.agentId, { ...base, kind: 'agent', from: e.parentModel, to: r.model })
    addRecent($, { at: now, way: 'agent', from: e.parentModel, to: r.model, grund: base.grund, description: e.description })
    try {
      $.ui.notice(e.tool_use_id, t().tipNotice(modelLabel(r.model), modelLabel(e.parentModel), base.grund))
    } catch {
      // Beiwerk: die Zeile fehlt, die Umstellung bleibt
    }
    return
  }
  if (!isPricey(e.parentModel)) return
  if (isPricey(r.model)) {
    await strikeSame($, e.description, now)
    if (!e.fork && !e.resume) keepWatch($, r.agentId, { ...base, kind: 'opus', from: r.model, to: r.model })
  } else if (e.model && settings.tips.auto && ses.leitsatz && !e.resume) keepWatch($, r.agentId, { ...base, kind: 'selbst', from: e.parentModel, to: r.model })
}

const START_TOOL = 'mcp__ccd_session__start_session'

/**
 * `start_session` der Desktop-App (Verhalten 4; Name aus der Werkzeugbeschreibung, nicht aus `docs/raw`): ohne `model` und nicht als
 * Fork urteilt `RATE` über `prompt` + `background`. Ein `model` gilt laut Werkzeugbeschreibung nur bei `context: "fresh"`; Transkripte
 * (2026-11-04) zeigen es auch ohne `context` meist wirksam. Gebucht wird darum erst im neuen Chat und nur, wenn er auf dem Ziel läuft.
 */
async function planStart($: EngineInterface, a: Record<string, unknown>, signal?: AbortSignal): Promise<{ to: string; from: string; selbst: boolean } | null> {
  settings = cleanSettings(await $.store.get('settings'))
  if (settings.level !== 'guide' || !settings.tips.auto || a.context === 'fork') return null
  const prompt = typeof a.prompt === 'string' ? a.prompt : ''
  if (prompt.length < 20) return null
  const from = await mainModel($)
  if (!isPricey(from)) return null
  await bindSession($)
  if (typeof a.model === 'string' && a.model) {
    // Claude hat selbst gewählt: nur mitzählen, wenn es günstiger ist und der Leitsatz kam (nicht zugerechnet)
    return ses.leitsatz && !isPricey(a.model) && familyOf(a.model) ? { to: a.model, from, selbst: true } : null
  }
  const background = typeof a.background === 'string' ? a.background : ''
  const v = await rate($, { kind: 'chat', type: '', description: typeof a.title === 'string' ? a.title : '', prompt: background ? `${background}\n\n${prompt}` : prompt, parentModel: from }, signal)
  const target = targetOf(v?.stufe, settings.tips.haiku)
  return target ? { to: TIP_TARGETS[target].id, from, selbst: false } : null
}

/** Den Auftrag merken (`brief:<hash>`), bevor der neue Chat startet; seine erste Nachricht enthält diese 200 Zeichen (S3). */
async function rememberBrief($: EngineInterface, prompt: string, p: { to: string; from: string; selbst: boolean }) {
  const prefix = prompt.trim().slice(0, BRIEF_PREFIX)
  const at = await $.clock.now()
  await $.store.set(`brief:${hashText(prefix)}`, { prefix, from: p.from, to: p.to, at, ...(p.selbst ? { selbst: true } : {}) })
  if (!p.selbst) addRecent($, { at, way: 'sitzung', from: p.from, to: p.to, grund: '', description: cut(prompt.replace(/\s+/g, ' '), 80) })
}

/** Leitsatz (Verhalten 5): einmal je Session bei der ersten Nachricht, nur mit `tips auto` und teurem Hauptmodell; sonst leer. */
async function leitsatzFor($: EngineInterface, e: { text: string; command?: unknown; isMeta?: true }): Promise<string> {
  if (e.command || e.isMeta || e.text.trim().startsWith('/')) return ''
  settings = cleanSettings(await $.store.get('settings'))
  if (settings.level !== 'guide' || !settings.tips.auto) return ''
  await bindSession($)
  if (ses.leitsatz || !isPricey(await mainModel($))) return ''
  ses.leitsatz = true
  saveSes($, await $.clock.now())
  return t().leitsatz
}

/** `/sidekick tips …` (Konfiguration): Schalter, `stop` beendet den Tipp dieses Chats, sonst der Stand. */
async function tipsCommand($: EngineInterface, rest: string): Promise<string> {
  settings = cleanSettings(await $.store.get('settings'))
  const r = applyTips(settings.tips, rest)
  const x = t()
  if (!r) return x.tipsUnknown(rest.trim())
  await bindSession($)
  const now = await $.clock.now()
  // Rückmeldung als erste Zeile (0.18.1): sonst sieht ein Schalter, der schon so stand, aus, als passiere nichts
  let said = ''
  const sw = tipsSwitch(settings.tips, r.form, now)
  if (sw) said = sw.changed ? x.tipsNow(x.tipsWhat[sw.what], sw.on) : x.tipsAlready(x.tipsWhat[sw.what], sw.on)
  if (r.form === 'stop') {
    said = tip && !tip.ended && tip.way === 'chat' ? x.tipsStopped(modelLabel(tip.from)) : x.tipsNoStop
    endTip($, true, now)
  } else if (r.tips !== settings.tips) {
    settings = { ...settings, tips: r.tips }
    await $.store.set('settings', settings)
    pushStatus($)
  }
  const recent = ((await $.store.get('tips:recent')) as Recent[] | undefined) ?? []
  const keys = (await $.store.keys()).filter((k) => k.startsWith('bilanz:'))
  const ledgers: Ledger[] = []
  for (const k of keys) ledgers.push(cleanLedger(await $.store.get(k)))
  const week = sumPeriod(ledgers, 'week', now)
  const s = settings.tips
  const onOff = (b: boolean) => (b ? x.on : x.off)
  const out = [...(said ? [said, ''] : []), x.tipsTitle, '', '| | |', '|---|---|']
  out.push(x.tipsRowFirst(s.first ? (now < s.restUntil ? x.tipsResting(shortDay(s.restUntil)) : x.on) : x.off))
  out.push(x.tipsRowAuto(onOff(s.auto)))
  out.push(x.tipsRowHaiku(onOff(s.haiku)))
  out.push(x.tipsRowChat(tip && !tip.ended && tip.way === 'chat' ? `${modelLabel(tip.from)} → ${modelLabel(tip.to)} · ${hhmm(tip.at)}` : '–'))
  if (settings.level !== 'guide') out.push(x.tipsRowLevel(x.level[settings.level]))
  out.push('', x.tipsWeek(usdText(tipSaved(week)), tipRuns(week)), '')
  const list = Array.isArray(recent) ? recent.filter((y) => y && typeof y.at === 'number').slice(-10).reverse() : []
  if (list.length) {
    out.push(x.tipsRecentHead, '|---|---|---|---|')
    for (const y of list) out.push(`| ${shortDay(y.at)} ${hhmm(y.at)} | ${x.tipWay[y.way] ?? y.way} | ${modelLabel(y.from)} → ${modelLabel(y.to)} | ${mdCell(cut([y.description, y.grund].filter(Boolean).join(' · '), 90)) || '–'} |`)
  } else out.push(x.tipsNone)
  out.push('', x.tipsChange)
  return out.join('\n')
}

const shortDay = (ms: number) => shortDate(ms)

// ---------- Gut zu wissen (SPEC Nachtrag 0.13.0) ----------

let noteRunning = false // eine Prüfung zur Zeit
let noteTurn = '' // Runde, in der zuletzt ein Hinweis erschien: höchstens einer je Runde
let curTurn = '' // laufende Runde; ein Ergebnis aus einer älteren ist veraltet
let notePressing = false // ein Knopf zur Zeit

type StepFacts = { index: number; turnId: string; model: string }

/**
 * Aus `turn.step` der Hauptschleife, ohne zu warten: an Schritt 6, 12, 18 … einmal `$.model.fork` (den ganzen Verlauf, aus dem Cache,
 * types:2551-2569). Der Schritt geht sofort weiter; ein Hinweis erscheint über dem Prompt. Fehler und Abbruch: nichts zeigen, nur zählen.
 */
function maybeNote($: EngineInterface, e: StepFacts) {
  curTurn = e.turnId
  const go = shouldCheck({
    on: settings.notes,
    off: settings.level === 'off',
    index: e.index,
    hasNote: !!ses.note,
    shownThisTurn: noteTurn === e.turnId,
    running: noteRunning,
    busy: busy !== null,
  })
  if (!go) return
  noteRunning = true
  runNote($, e)
    .catch(() => {})
    .finally(() => {
      noteRunning = false
    })
}

async function runNote($: EngineInterface, e: StepFacts) {
  await bindSession($)
  const sid = sessionId
  if (ses.note || noteTurn === e.turnId) return
  // Nur, wo jemand das Band sieht: AbovePrompt gibt es im Terminal und im Desktop (types:9922); in `-p` ist die Liste leer
  const surfaces = await $.session.surfaces()
  if (!surfaces.some((s) => s === 'terminal' || s === 'desktop')) return
  // Zurückhaltung nach ignorierten Hinweisen (Verhalten 7)
  const skip = nonNeg(await $.store.get('notes:skip'))
  if (skip > 0) {
    await $.store.set('notes:skip', skip - 1)
    return
  }
  const seen = cleanTopics(await $.store.get('notes:seen'))
  const known = cleanTopics(await $.store.get('notes:known'))
  const t0 = await $.clock.now()
  const r = await $.model.fork({ prompt: notesPrompt(seen, known, lang()) })
  // Vor der ersten Antwort und nach /clear gibt es nichts zu forken; dann lief keine Anfrage (types:6184-6197)
  if (!r.isAnswered && r.reason === 'nothing-to-fork') return
  const ms = (await $.clock.now()) - t0
  const usage = 'usage' in r ? (r.usage as CompleteUsage) : undefined
  const p = r.isAnswered ? parseNote(r.text, seen, known) : null
  // Veraltet: inzwischen /clear, eine neue Runde (der Nutzer hat weitergeschrieben) oder schon ein Hinweis
  await bindSession($)
  const stale = sessionId !== sid || curTurn !== e.turnId || !!ses.note
  const field: NoteField = !p ? 'fehler' : p.kind === 'none' ? 'keins' : p.kind === 'bad' ? (p.why === 'json' ? 'fehler' : 'verworfen') : stale ? 'verworfen' : 'gezeigt'
  bookDay($, t0, (d) => {
    // Auf dem Hauptmodell der Runde; eigene Rechnung, nicht in `kosten` (Nachtrag 0.13.0, Kosten)
    if (usage) bookNote(d, e.model, completeCost(usage, e.model), ms)
    countNote(d, field)
  })
  if (!p || p.kind !== 'note' || stale) return
  const now = await $.clock.now()
  ses.note = { thema: p.thema, art: p.art, titel: p.titel, text: p.text, shownAt: now, turnId: e.turnId, survived: 0, open: false }
  noteTurn = e.turnId
  saveSes($, now)
  // Frisch gelesen: eine andere Session kann inzwischen geschrieben haben
  await $.store.set('notes:seen', addTopic(cleanTopics(await $.store.get('notes:seen')), p.thema))
  $.ui.invalidate('ui.render')
}

/** Eine eigene Nachricht (kein Befehl): Ein nicht erklärter Hinweis verschwindet mit der zweiten als „ignoriert“ (Verhalten 7). */
async function noteAfterOwn($: EngineInterface, text: string, kind: string) {
  if (text.trim().startsWith('/') || isHostText(text)) return
  await bindSession($)
  if (!ses.note || !(await isOwn($, kind))) return
  const r = afterOwnMessage(ses.note)
  if (r.note === ses.note) return
  const now = await $.clock.now()
  ses.note = r.note
  saveSes($, now)
  if (!r.ignored) return
  const n = nonNeg(await $.store.get('notes:ignored')) + 1
  await $.store.set('notes:ignored', n)
  await $.store.set('notes:skip', skipAfter(n))
  bookDay($, now, (d) => countNote(d, 'ignoriert'))
  $.ui.invalidate('ui.render')
}

type NoteAction = 'explain' | 'known' | 'later' | 'gotit' | 'close' | 'chat'

/**
 * „Im Chat fragen“: senden, ohne zu warten. Der Aufruf löst sich erst, wenn die neue Runde beginnt, also nach Claudes laufender Arbeit
 * (docs/raw/en/api.md:138); der Knopf soll sofort fertig sein (Review 0.13.0 S1). Als Nachricht von sidekick, nicht `asUser`:
 * ein anderes Plugin kann `asUser` als Antwort des Nutzers werten (Review 0.13.0 S2). Fehler als Toast.
 */
function askInChat($: EngineInterface, n: Note) {
  const x = t()
  void $.prompt.submit({ text: x.noteAskText(n.titel, n.thema) }).catch((err) => $.ui.toast(x.noteAskFailed(msg(err)), { timeoutMs: 15000 }))
}

/**
 * „Im Chat besprechen“: ins leere Eingabefeld schreiben, nie selbst senden. Der Desktop zeichnet ein eigenes Eingabefeld, dort
 * verweigert `fill` mit `no_composer` (types:8440-8450): dann senden wie das Vorbild, der Knopf heißt dort „Im Chat fragen“.
 */
async function noteToChat($: EngineInterface, n: Note, surface: string): Promise<boolean> {
  const x = t()
  if (surface === 'desktop') {
    askInChat($, n)
    return true
  }
  const box = await $.prompt.read().catch(() => null)
  if (box && box.text.trim()) {
    $.ui.toast(x.noteBoxFull, { timeoutMs: 8000 })
    return false
  }
  // `append`: tippt der Nutzer zwischen read und fill, bleibt sein Text stehen; bei leerem Feld dasselbe wie `replace` (Review K2)
  const next = afterFill(await $.prompt.fill({ text: `${x.noteChatText(n.titel, n.thema)}\n\n`, mode: 'append' }))
  if (next === 'filled') return true
  if (next === 'submit') {
    askInChat($, n)
    return true
  }
  $.ui.toast(next === 'dialog' ? x.noteDialog : x.noteNotTaken, { timeoutMs: 8000 })
  return false
}

/** Ein Knopf am Hinweis. `shownAt` bindet den Druck an den Hinweis, der gezeichnet war; jede Wahl beendet die Zurückhaltung. */
async function pressNote($: EngineInterface, shownAt: number, action: NoteAction, surface: string) {
  if (notePressing) return
  notePressing = true
  try {
    await bindSession($)
    const n = ses.note
    if (!n || n.shownAt !== shownAt) return
    if (action === 'chat' && !(await noteToChat($, n, surface))) return
    const now = await $.clock.now()
    ses.note = action === 'explain' ? { ...n, open: true } : null
    saveSes($, now)
    // „Weiß ich schon“ und „Verstanden“: das Thema nie wieder anbieten
    if (action === 'known' || action === 'gotit') await $.store.set('notes:known', addTopic(cleanTopics(await $.store.get('notes:known')), n.thema))
    const field: NoteField | null = action === 'explain' ? 'erklaert' : action === 'known' ? 'bekannt' : action === 'later' ? 'spaeter' : action === 'chat' ? 'chat' : null
    if (field) bookDay($, now, (d) => countNote(d, field))
    await $.store.set('notes:ignored', 0)
    await $.store.set('notes:skip', 0)
  } catch {
    // Beiwerk: ein gescheiterter Druck ändert nichts
  } finally {
    notePressing = false
    $.ui.invalidate('ui.render')
  }
}

/** Steht irgendwo im Baum ein Element mit diesem `key` (z. B. die Pillen von quick-replies)? */
function hasKey(node: unknown, key: string): boolean {
  const n = node as { props?: Record<string, unknown>; children?: unknown[] } | null
  if (!n || typeof n !== 'object') return false
  if (n.props?.key === key) return true
  return Array.isArray(n.children) && n.children.some((c) => hasKey(c, key))
}

type NoteButton = (p: { key: string; label: string; hotkey?: string; plain?: true; onPress: () => void }) => RenderNode

/**
 * Der Hinweis über dem Prompt: `✦ Achtung · <thema>` mit 1 Erklären, 2 Weiß ich schon, 0 Später; aufgeklappt Titel und Erklärung mit
 * 1 Verstanden, 2 Im Chat besprechen, 0 Schließen. `digits`: Ziffern als hotkey; nicht, solange quick-replies 1 … n belegt (types:9073).
 */
function noteView(n: Note, cols: number, surface: string, digits: boolean, button: NoteButton, press: (a: NoteAction) => void): RenderElement {
  const x = t()
  const b = (key: string, label: string, hotkey: string, a: NoteAction) => button({ key, label, plain: true, ...(digits ? { hotkey } : {}), onPress: () => press(a) })
  const head = (label: string, rest: string) =>
    el('Text', {}, [el('Text', { color: ACCENT }, ['✦ ']), el('Text', { color: ACCENT, bold: true }, [label]), ...(rest ? [el('Text', { dimColor: true }, [' · ']), el('Text', {}, [rest])] : [])])
  const buttons = (kids: RenderNode[]) => el('Box', { key: 'sidekick-note-buttons', flexDirection: 'row', flexWrap: 'wrap', columnGap: 3 }, kids)
  // Leerzeile darunter nur im Terminal; im Desktop gibt der blaue Streifen den Abstand (Nachtrag 0.15.2, Sicht-Check)
  const frame = { key: 'sidekick-note', flexDirection: 'column', width: Math.max(20, cols), ...(surface === 'desktop' ? {} : { marginBottom: 1 }) }
  if (!n.open)
    return el('Box', frame, [
      head(x.noteTag[n.art], n.thema),
      buttons([b('sidekick-note-explain', x.noteExplain, '1', 'explain'), b('sidekick-note-known', x.noteKnown, '2', 'known'), b('sidekick-note-later', x.noteLater, '0', 'later')]),
    ])
  return el('Box', frame, [
    head(n.titel || x.noteTag[n.art], ''),
    el('Text', {}, [n.text || n.thema]),
    buttons([
      b('sidekick-note-gotit', x.noteGotIt, '1', 'gotit'),
      b('sidekick-note-chat', surface === 'desktop' ? x.noteAsk : x.noteChat, '2', 'chat'),
      b('sidekick-note-close', x.noteClose, '0', 'close'),
    ]),
  ])
}

/**
 * `/sidekick help` und `?` (Nachtrag 0.14.0, docs/HELP-SPEC.md §3): Schnappschuss des Zustands beim Aufruf unter einer Kennung `#…`,
 * zurück kommt die knappe Markdown-Fassung (Fallback für `-p` und VS Code, und was Claude mitliest). Gezeichnet wird über
 * `ui.render{CommandOutput, command=sidekick}`. Die Zeichnung schreibt sich nach einem Umschalten nicht um (HELP-SPEC §3.3).
 */
async function helpCommand($: EngineInterface): Promise<string> {
  settings = cleanSettings(await $.store.get('settings'))
  await bindSession($)
  const now = await $.clock.now()
  const hs = cleanHints(await $.store.get('hints'))
  const known = cleanTopics(await $.store.get('notes:known')).length
  const source = settings.ttl ? 'set' : mem.ttlSource === 'gemessen' ? 'measured' : 'default'
  const data = sidekickHelp({ settings, ttl: { min: ttlOf(mem, settings.ttl), source }, hints: { on: hs.on, off: hs.off }, known, now })
  const tag = `#${(++helpNo).toString(36)}${now.toString(36).slice(-5)}`
  helps.set(tag, data)
  while (helps.size > 10) helps.delete(helps.keys().next().value as string)
  return helpMarkdown(data, tag)
}

/** `/sidekick notes [on|off|forget|status]` (Nachtrag 0.13.0, Verhalten 8). */
async function notesCommand($: EngineInterface, rest: string): Promise<string> {
  const a = rest.trim().toLowerCase()
  // Nur die Wörter aus NOTES_WORDS (die Hilfe nennt jedes, Nachtrag 0.14.0)
  if (a && !(NOTES_WORDS as readonly string[]).includes(a)) return t().notesUnknown(a)
  settings = cleanSettings(await $.store.get('settings'))
  if (a === 'on' || a === 'off') {
    settings = { ...settings, notes: a === 'on' }
    await $.store.set('settings', settings)
    if (a === 'off') {
      await bindSession($)
      if (ses.note) {
        ses.note = null
        saveSes($, await $.clock.now())
      }
      $.ui.invalidate('ui.render')
    }
  } else if (a === 'forget') {
    const n = cleanTopics(await $.store.get('notes:known')).length
    await $.store.set('notes:known', [])
    return t().notesForgot(n)
  }
  const known = cleanTopics(await $.store.get('notes:known')).length
  return t().notesStatus(settings.notes, known, settings.level === 'off')
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
      const usd = rewriteCost(res.coldWritten, res.mem.model, ttl, total) // Preisstufe nach dem ganzen Prompt (Review 0.11.0 K4)
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
  // Reste der Aufteilung (0.9 bis 0.14), die nichts mehr liest
  for (const k of keys.filter((x) => x === 'split:last' || x === 'held:last')) await $.store.delete(k)
  // Modell-Tipp (Ausbau 0.18.0, Zustand): Tipp eines Chats 7 Tage, Subagenten und Aufträge an neue Chats 2 Tage
  const ttlOfKey = (k: string) => (k.startsWith('tip:') ? TIP_DAYS : SPAWN_DAYS)
  for (const k of keys.filter((x) => x.startsWith('tip:') || x.startsWith('spawn:') || x.startsWith('brief:')).slice(0, 400)) {
    const v = (await $.store.get(k)) as { at?: unknown } | undefined
    if (!v || typeof v.at !== 'number' || now - v.at > ttlOfKey(k) * DAY) await $.store.delete(k)
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
  const out = [x.statusTitle(x.level[settings.level]), '']
  out.push('| | |', '|---|---|')
  out.push(x.rowLevel(x.level[settings.level], x.levelDesc[settings.level]))
  out.push(x.rowThreshold(tokensText(settings.threshold)))
  out.push(x.rowBig(tokensText(settings.big)))
  out.push(x.rowSkills(onOff(settings.skills)))
  out.push(x.rowTtl(ttl, settings.ttl ? x.ttlSet : mem.ttlSource === 'gemessen' ? x.ttlMeasured : x.ttlDefault))
  out.push(x.rowNotes(onOff(settings.notes), cleanTopics(await $.store.get('notes:known')).length))
  out.push(x.rowTips(onOff(settings.tips.first), onOff(settings.tips.auto)))
  if (mem.ctx) out.push(x.rowCtx(tokensText(mem.ctx), cacheText(st.kind, st.left)))
  out.push('', x.summary(ses.summary), '')
  out.push(x.lastHint(ses.last ? `${hhmm(ses.last.at)} · ${ses.last.line}` : ''), '')
  const h = (await $.store.get('handoff:last')) as { text?: string; msg?: string; at?: number } | undefined
  if (h && typeof h.text === 'string' && typeof h.at === 'number') {
    out.push(x.lastHandoff(hhmm(h.at)), '', h.text, '')
    if (h.msg) out.push(x.handoffMsg(h.msg), '')
  } else out.push(x.noHandoff, '')
  // Anzeige in der Fußzeile (0.10.1): ob die Engine sie aufruft, wo, und ob das Lesen des Werts scheitert
  const md = (await $.store.get('diag:sessionMode')) as Partial<ModeDiag> | undefined
  out.push(md && typeof md.at === 'number' && typeof md.surface === 'string' ? x.modeSeen(hhmm(md.at), md.surface, typeof md.err === 'string' ? md.err : '') : x.modeNever, '')
  const hs = cleanHints(await $.store.get('hints'))
  out.push(x.hintsLine(onOff(hs.on), hs.off.join(', ')), '')
  out.push(x.change(USAGE))
  return out.join('\n')
}

/** `/sidekick hints [on|off|status|<regel> on|off|done <regel>|audit-min <k>]` (SPEC Nachtrag 0.2.0, Verhalten 7). */
async function hintsCommand($: EngineInterface, rest: string): Promise<string> {
  let hs = cleanHints(await $.store.get('hints'))
  const r = applyHints(hs, rest, parseTokens)
  if (r?.error) return `${r.error}. ${t().possible(hintsUsage())} · ${t().allCommands}`
  if (r?.settings) {
    hs = r.settings
    await $.store.set('hints', hs)
    // Geänderte Einstellung: in diesem Chat bei der nächsten eigenen Nachricht noch einmal prüfen
    await bindSession($)
    ses.wartung = false
    ses.wartungOffen = null
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
    try {
      settings = cleanSettings(await $.store.get('settings'))
      await bindSession($)
    } catch {
      // Standard bis zur ersten Nachricht
    }
    // Die Anzeige in der Fußzeile überlebt ein Neuladen wie `buddy` (en/interface.md:716): nach dem Laden der Stufe neu schreiben
    // (Nachtrag 0.10.0); buddy() schreibt sie mit
    statusLast = undefined
    buddyKind = undefined
    buddy($, null)
    housekeeping($).catch(() => {})
    // Befehle zuletzt, jeder für sich (CLAUDE.md, Registrieren in session.start); englisch
    for (const c of [
      { name: 'sidekick', description: t().cmdSidekick, argumentHint: '[off|cache|guide|on|status|threshold 80k|big 150k|skills on|off|ttl 5|60|auto|hints …|notes on|off|forget|tips …|language|help]' },
      { name: 'savings', description: t().cmdSavings, argumentHint: '[detail] [today|week|all|help]' },
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
    if (e.agentId) {
      // Modell-Tipp (Ausbau 0.18.0): Schritte beobachteter Subagenten aufsummieren; der Schritt selbst bleibt unberührt
      try {
        await restoreWatch($, e.agentId)
      } catch {
        // Beiwerk
      }
      const r = yield* next(e)
      try {
        watchStep(e.agentId, r.usage as (CompleteUsage & { model?: string }) | undefined)
      } catch {
        // Beiwerk
      }
      return r
    }
    // „Gut zu wissen“ (Nachtrag 0.13.0): an Schritt 6, 12, 18 … im Hintergrund, der Schritt wartet nicht
    try {
      maybeNote($, e)
    } catch {
      // Beiwerk
    }
    let startedAt = 0
    let want = ''
    try {
      startedAt = await $.clock.now()
      // Modell-Tipp angenommen: jede Hauptanfrage dieses Chats auf das Ziel (S1 (ii), types:14677-14700 `model` umschreibbar)
      await bindSession($)
      want = tipModel($, e.model, startedAt)
    } catch {
      // ohne Uhr keine Auswertung, ohne Tipp unverändert
    }
    const r = yield* next(want ? { ...e, model: want } : e)
    try {
      if (r.usage && startedAt) {
        await afterStep($, r.usage, startedAt)
        tipStep($, r.usage as CompleteUsage & { model?: string }, startedAt)
      }
    } catch {
      // Beiwerk: die Anfrage selbst bleibt unberührt
    }
    return r
  })

  // Modell-Tipp (Verhalten 3): Subagent-Modell wählen. Fail-open: jeder Fehler, Timeout oder kein Urteil startet unverändert. Der Hook
  // wartet nur in Mods-API-Aufrufen (10-s-Grenze, docs/raw/en/events.md:181), `RATE` hat 6 s.
  on('agent.spawn', async ($, e, next) => {
    let plan: Awaited<ReturnType<typeof planSpawn>> = null
    try {
      plan = await planSpawn($, e as SpawnIn, next.signal)
    } catch {
      plan = null
    }
    const r = await next(plan ? { ...e, model: TIP_TARGETS[plan.target].alias } : e)
    try {
      await afterSpawn($, e as SpawnIn, r as SpawnOut, plan)
    } catch {
      // Beiwerk
    }
    return r
  })

  // Ende eines Subagent-Laufs: Buchung und Gegenprobe (Verhalten 6, Buchung). Nur Beobachter, `next(e)` unverändert.
  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId) await restoreWatch($, e.agentId)
      if (e.agentId && watches.has(e.agentId)) {
        // Ohne gebundene Session ginge die Buchung verloren (nach einem Neuladen ohne neue Nachricht)
        await bindSession($)
        flushWatch($, e.agentId, e.reason, await $.clock.now())
      }
    } catch {
      // Beiwerk
    }
    return next(e)
  })

  // Commits merken (Kurzfassung, Wiederholungsregel). `gitOperation` steht im Ergebnis von Bash und PowerShell (tools:4251, :4728)
  // Seit 0.18.0 auch `start_session` der Desktop-App (Modell-Tipp, Verhalten 4): ein `on` je Event und Matcher (CLAUDE.md)
  on('tool.call', { tool: ['Bash', 'PowerShell', START_TOOL] }, async ($, e, next) => {
    if (e.tool === START_TOOL) {
      const a = e as unknown as Record<string, unknown>
      let plan: Awaited<ReturnType<typeof planStart>> = null
      try {
        plan = await planStart($, a, next.signal)
        if (plan) await rememberBrief($, String(a.prompt), plan)
      } catch {
        plan = null
      }
      // Die Zeile nur, solange der Aufruf offen ist (types:2370-2375), also vor `next`
      if (plan && !plan.selbst && typeof a.tool_use_id === 'string')
        try {
          $.ui.notice(a.tool_use_id, t().tipNoticeChat(modelLabel(plan.to), modelLabel(plan.from)))
        } catch {
          // Beiwerk
        }
      // `effort` bleibt (E3); ein höheres Modell als das eigene ignoriert die App (Werkzeugbeschreibung)
      return next(plan && !plan.selbst ? ({ ...a, model: plan.to } as unknown as typeof e) : e)
    }
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
    // „Gut zu wissen“: eine eigene Nachricht lässt einen nicht erklärten Hinweis altern (Nachtrag 0.13.0, Verhalten 7)
    try {
      await noteAfterOwn($, e.text, e.origin.kind)
    } catch {
      // Beiwerk
    }
    // Modell-Tipp (Ausbau 0.18.0, Gegenprobe): Nach einem getippten `/model` prüft der nächste Schritt, ob es zurück auf Opus/Fable ging
    try {
      if (/^\/model(\s|$)/i.test(e.text.trim())) {
        await bindSession($)
        if (tip && !tip.ended && tip.way === 'chat') {
          tip.checkBack = true
          saveTip($)
        }
      }
    } catch {
      // Beiwerk
    }
    // Leitsatz (Verhalten 5): einmal je Session als `context` (types:9771-9775); fehlt er, geht die Nachricht ohne ihn
    let leit = ''
    try {
      leit = await leitsatzFor($, e)
    } catch {
      leit = ''
    }
    const go = (x: typeof e) => next(leit ? { ...x, context: [...(x.context ?? []), leit] } : x)
    // Mit Anhängen oder `@datei` kein neuer Chat: neu gesendet fehlten sie (types:8558-8561, limit-bars)
    const resendable = !e.attachments?.length && !/(^|\s)@\S/.test(e.text)
    let g: Gate = PASS
    try {
      g = await gate($, e.text, e.origin.kind, !!e.turnId || e.wait, next.signal)
    } catch {
      buddy($, null)
      return go(e)
    }
    const c = g.c
    if (!c) {
      buddy($, null)
      return sendWithWartung($, e, g.w, () => go(e))
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
    const d = dialog(c, resendable, base)
    buddy($, d ? 'stop' : null)
    // Modell-Tipp bei der ersten Nachricht (Verhalten 2): nur ohne andere Rückfrage dieser Prüfung („höchstens eine Sache“); die
    // Nachricht geht danach in jedem Fall unverändert weiter, nur die Schritte laufen bei Annahme auf dem Ziel
    if (!d && c.trigger === 'a' && v) {
      try {
        const why = tipBlock({ level: settings.level, tips: settings.tips, now, model: c.main, stufe: v.aufwand, text: e.text, attachments: !!e.attachments?.length, otherDialog: false, brief: c.brief })
        if (!why) await askTip($, c, now)
      } catch {
        buddy($, null)
      }
    }
    if (!d) {
      // Neuer Chat ohne Dialog (Anhang oder @datei, Verhalten 4): auch keine Zeile, die Größe nennt (Nachtrag 0.12.0, Entscheidung 1).
      // Ein „anhalten“ ohne Dialog (Fassung über 600 Zeichen) geht durch denselben Filter wie ein Hinweis (Review 0.12.0 S2)
      const zeile = v && v.urteil !== 'durch' && v.art !== 'neuer_chat' ? shownLine(v) : ''
      if (v && zeile) {
        // Zeile unter dieser Nachricht (Verhalten 5); bei einem „anhalten“ ohne mögliche Aktion ebenso
        // Button für den Skill-Hinweis (Name gegen die Skill-Liste geprüft, Review 0.7.0 S3) und, seit 0.8.1, für jeden Befehl im
        // Satz, den die Befehlsliste dieser Session kennt (Sonnet schrieb „bald /uebergabe … erwägen“ als Art „sonstiges“)
        const hit = lineCommand(zeile, v.art === 'skill' ? v.skill : '', baseCache?.cmds ?? [])
        const line = hit?.line ?? (v.skill && zeile.includes(v.skill) ? hintLine(zeile, v.skill) : zeile)
        pending = { text: e.text, line, ...(hit ? { cmd: hit.cmd } : {}) }
        ses.open = { art: v.art, skill: v.skill, ctx: c.ctx }
        ses.last = { line, art: v.art, at: now }
        // Der Hinweis der Prüfung hat Vorrang; der Wartungs-Hinweis wartet auf die nächste Nachricht ohne Zeile (Nachtrag 0.12.0)
        if (g.w) ses.wartungOffen = offenOf(g.w, now)
        saveSes($, now)
        bookDay($, now, (x) => countHint(x, v.art, 'gezeigt'))
        const r = await go(e)
        $.ui.invalidate('ui.render')
        return r
      }
      return sendWithWartung($, e, g.w, () => go(e))
    }
    // Rückfrage: die Prüfung hat Vorrang, der Wartungs-Hinweis wartet auf die nächste Nachricht ohne Zeile (Nachtrag 0.12.0)
    bookDay($, now, (x) => countHint(x, d.art, 'gezeigt'))
    keepWartung($, g.w, now)
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
      if (d.art !== 'falscher_chat') return go(e)
      bookDay($, now, (x) => countHint(x, d.art, 'abgebrochen'))
      forget($, c, now)
      return { drop: t().dropWrongChat(cut(e.text, 3000)) }
    }
    if (answer === 'fassung' && v?.fassung && showable(v.fassung)) {
      bookDay($, now, (x) => countHint(x, 'fassung', 'angenommen'))
      // Sichtbar machen, was gesendet wurde: Der Desktop zeigt in der Sprechblase das Original
      pending = { text: e.text, alt: v.fassung, line: t().sentFassung(whoOf()), sent: v.fassung }
      const r = await go({ ...e, text: v.fassung })
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
      // Nicht gesendet: aus dem Prüfkontext nehmen (falscher Chat)
      if (wrong) forget($, c, now)
      return { drop: (wrong ? t().dropWrongChat : t().dropAborted)(cut(e.text, 3000)) }
    }
    // „Trotzdem senden“ (oder freier Text unter „Other“): ignoriert, so senden, wie getippt
    bookDay($, now, (x) => countHint(x, d.art, 'ignoriert'))
    if (c.trigger === 'c') askedCold = true
    // Trotzdem gesendet: diese Art ruht bis +50k oder zum nächsten Commit; beim falschen Chat auch im Kalt-Fall
    if (c.trigger !== 'c' || d.art === 'falscher_chat') ses.ignored = { ...ses.ignored, [d.art]: { ctx: c.ctx, commits: ses.commits } }
    saveSes($, now)
    return go(e)
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
        hit = {
          id: e.requestId,
          line: pending.line,
          ...(pending.sent ? { sent: cut(pending.sent, 2000) } : {}),
          ...(pending.cmd ? { cmd: pending.cmd } : {}),
          ...(pending.wid ? { wid: pending.wid } : {}),
          ...(pending.why ? { why: pending.why } : {}),
        }
        pending = null
        ses.hints = [...ses.hints, hit].slice(-30)
        saveSes($, await $.clock.now())
      }
      called = true
      if (!hit) return next(e)
      // Andere Oberflächen: nur Text (Farbe und Rahmen sind dort nicht belegt)
      if (e.surface !== 'terminal' && e.surface !== 'desktop') {
        const sent = hit.sent ? t().sentPlain(hit.sent) : ''
        const why = hit.wid && hit.why ? `\n\n${hit.why}` : ''
        return next({ ...e, props: { ...e.props, text: `${e.props.text}\n\n· sidekick: ${hit.line}${sent}${why}` } })
      }
      // Eigene Zeichnung unter der unveränderten Nachricht: die Zeile farbig, eine gesendete Fassung im Rahmen.
      // Ein Hook darf die Zeichnung der Engine einbetten (types:3864-3871); ein ungültiger Baum zeichnet die der Engine.
      theirs = await next(e)
      // Elemente als reine Daten {type, props, children} (types:9215-9218); nur der Button kommt aus $.ui.resolve (Nachtrag 0.7.0)
      const line: RenderNode[] = [el('Text', { color: ACCENT }, [`· sidekick: ${hit.line}`])]
      const id = hit.id
      const cmd = hit.cmd
      const x = t()
      // Ein Button trägt eine Funktion und ist darum keine reine Daten-Zeichnung: über $.ui.resolve (Test: „not plain data“)
      const Button = (p: { key: string; label: string; onPress: (press: UiPressArgument) => void }) => $.ui.resolve(e).Button(p) as RenderNode
      if (hit.wid) {
        // Wartungszeile (Ausbau 0.16.0): Befehl ins Eingabefeld (Desktop: kopieren), „?“ klappt die Erklärung auf
        if (cmd && hit.filled) line.push(el('Text', { dimColor: true }, [`  ${x.btnFilled}`]))
        else if (cmd && pressing.has(id)) line.push(el('Text', { dimColor: true }, [`  ${x.btnBusy}`]))
        else if (cmd) {
          const label = e.surface === 'desktop' ? x.btnCopy : x.btnInsert
          line.push(Button({ key: 'sidekick-use', label, onPress: (press) => void insertHint($, id, press.surface) }))
        }
        // Im Terminal steht die Erklärung immer da (ob ein Button im Verlauf erreichbar ist, ist seit 0.7.0 [UNKLAR]); dort kein „?“
        if (hit.why && e.surface === 'desktop') {
          const open = whyOpen.has(id)
          line.push(
            Button({
              key: 'sidekick-why',
              label: open ? x.btnWhyClose : x.btnWhy,
              onPress: () => {
                if (whyOpen.has(id)) whyOpen.delete(id)
                else whyOpen.add(id)
                $.ui.invalidate('ui.render')
              },
            }),
          )
        }
      } else if (cmd && hit.ran) line.push(el('Text', { dimColor: true }, [`  ${x.btnRan}`]))
      else if (cmd && pressing.has(id)) line.push(el('Text', { dimColor: true }, [`  ${x.btnBusy}`]))
      // Button für den Befehl der Zeile (Skill-Hinweis der Prüfung): führt ihn direkt aus (0.8.1)
      else if (cmd) line.push(Button({ key: 'sidekick-use', label: x.btnRun(cmd), onPress: () => void useHint($, id) }))
      const kids: RenderNode[] = [el('Box', { key: 'sidekick-line', flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 }, line)]
      if (hit.wid && hit.why) {
        if (e.surface === 'terminal') kids.push(el('Box', { key: 'sidekick-why-text', paddingLeft: 2 }, [el('Text', { dimColor: true }, [hit.why])]))
        else if (whyOpen.has(id)) {
          const frame = { key: 'sidekick-why-text', flexDirection: 'column', borderStyle: 'round', borderColor: ACCENT, paddingX: 1 }
          kids.push(el('Box', frame, [el('Text', {}, [hit.why])]))
        }
      }
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
  // Seit 0.13.0 außerdem „Gut zu wissen“: der Hinweis auf derselben Ebene; die Übergabe-Box hat Vorrang, der Hinweis wartet.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if ((e.surface !== 'terminal' && e.surface !== 'desktop') || e.props.hasSurvey) return next(e)
    const step = busy
    let note: Note | null = null
    // Nur mit eingeschaltetem „Gut zu wissen“ die Session binden (jede Zeichnung des Bands läuft hier durch)
    if (!step && settings.notes && settings.level !== 'off') {
      try {
        await bindSession($)
        note = ses.note
      } catch {
        note = null
      }
    }
    if (!step && !note) return next(e)
    const theirs = await next(e)
    if (!step && note) {
      const n = note
      try {
        const { layers, slots, base } = splitBand(theirs)
        // Ziffern nur, solange Claude arbeitet: Danach löst eine allein getippte Ziffer im leeren Eingabefeld den Knopf aus
        // (docs/raw/en/reference.md:244), etwa die Antwort „2“ auf „Variante 1 oder 2?“ (Review 0.13.0 K1). quick-replies belegt
        // 1 … n ebenfalls erst nach der Runde; liegt es doch im Band, ohne Ziffern
        const qr = layers.some((l) => nameOf(l) === 'quick-replies') || hasKey(base, 'quick-replies')
        const digits = e.props.isWorking && !qr
        const ui = $.ui.resolve(e)
        const view = noteView(n, e.props.bodyColumns, e.surface, digits, (p) => ui.Button(p) as RenderNode, (a) => void pressNote($, n.shownAt, a, e.surface))
        return joinBand([...layers, sidekickLayer(view, e.surface)], base, slots)
      } catch {
        return theirs
      }
    }
    if (!step) return theirs
    try {
      const secs = Math.max(0, Math.round(((await $.clock.now()) - step.since) / 1000))
      // Eine Leerzeile Abstand unter der Box (wirkt sauberer; marginBottom wie unter der Hinweis-Zeile). Im Desktop nicht: Dort steht
      // der blaue Streifen 8 px darunter wie die orange Linie unter der Spotify-Leiste; mit Leerzeile hinge er ab (Nachtrag 0.15.2)
      const gap = e.surface === 'desktop' ? {} : { marginBottom: 1 }
      const box = el('Box', { key: 'sidekick-busy', flexShrink: 0, borderStyle: 'round', borderColor: ACCENT, paddingX: 1, ...gap }, [
        el('Text', { color: ACCENT }, [`sidekick ${{ handoff: t().busyHandoff, plain: t().busyPlain, clear: t().busyClear }[step.step]} … ${secs} s`]),
      ])
      // Oberste Ebene über allen anderen Mods, in jeder Reihenfolge der Kette (band.ts, docs/BAND.md); Quick-Replies blenden
      // während der Übergabe aus, sidekick rückt dann auf ihre Höhe
      const { layers, slots, base } = splitBand(theirs)
      const rest = base ? withoutKey(base as RenderElement, 'quick-replies') : null
      return joinBand([...layers.filter((l) => nameOf(l) !== 'quick-replies'), sidekickLayer(box, e.surface)], rest, slots)
    } catch {
      return theirs
    }
  })

  on('command.run', { command: 'sidekick' }, async ($, e) => {
    // Sprache aller fynn-mods (docs/LANGUAGE-SPEC.md §6 Punkt 2) vor allem, was Store, Uhr oder Zustand liest; fängt Fehler selbst ab
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: 'sidekick', cmd: 'sidekick', lang: lang() }, e.args) }
    const args = e.args.trim()
    // `help` und `?` nur als einziges Wort (HELP-SPEC §2); `help foo` gilt als unbekannt
    if (isHelp(args)) return { text: await helpCommand($) }
    if (/^hints\b/i.test(args)) return { text: await hintsCommand($, args.slice(5)) }
    if (/^notes\b/i.test(args)) return { text: await notesCommand($, args.slice(5)) }
    if (/^tips\b/i.test(args)) return { text: await tipsCommand($, args.slice(4)) }
    // Immer frisch laden: eine andere Session kann die Stufe geändert haben
    settings = cleanSettings(await $.store.get('settings'))
    if (args && args.toLowerCase() !== 'status') {
      const s = applySetting(settings, args)
      if (!s) return { text: t().unknownArg(args, USAGE) }
      settings = s
      await $.store.set('settings', settings)
      pushStatus($)
    }
    return { text: await statusText($) }
  })

  // Anzeige in der Fußzeile neben der Modellauswahl (Nachtrag 0.10.0; Vorbild orchestrator register.ts:1371-1376): ein Label an
  // `modes` anhängen, fremde bleiben (types:9858-9872). Das Lesen von `sidekick.status` abonniert den Wert: ein Schreiben zeichnet
  // nur diese Stelle neu, ohne $.ui.invalidate (types:3310-3313). Andere Oberflächen: unverändert.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      noteMode($, String(e.surface), '')
      return next(e)
    }
    let err = ''
    let s: Status = { level: settings.level, busy: settings.level !== 'off' && busyNow() }
    try {
      const { value } = await $.state.get({ plugin: 'sidekick', key: 'status' })
      // Ein vor 0.15.0 geschriebener Wert mit Stufe plan oder auto (er überlebt ein Neuladen) zeigte sonst ein leeres Label
      if (value && value.level in t().level) s = value
    } catch (error) {
      // Ohne Abo zeigt das Label die eingestellte Stufe (0.10.1: vorher blieb es dann leer); der Fehler steht in /sidekick status
      err = msg(error)
    }
    noteMode($, String(e.surface), err)
    const x = t()
    if (e.surface === 'desktop') {
      // Desktop 2.1.288 fragt SessionMode an, übernimmt angehängte `modes` aber nicht in seine Fußzeile (Fynn, Screenshot 0.10.1).
      // Rückfall aus dem Nachtrag 0.10.0 (Befunde): ein eigener Baum mit farbigem ● neben der Zeichnung der Engine
      const theirs = await next(e)
      const dot = el('Text', { color: s.level === 'off' ? MODE_RED : s.busy ? MODE_ORANGE : MODE_GREEN }, ['●'])
      // Modell-Tipp (Ausbau 0.18.0): Die Auswahl der App zeigt weiter das Hauptmodell, das Label den Tipp („→ Sonnet“)
      const tipText = s.level !== 'off' && typeof s.tip === 'string' && s.tip ? ` → ${s.tip}` : ''
      const word = el('Text', { dimColor: true }, [s.level === 'off' ? x.modeOffWord : `sidekick · ${x.level[s.level]}${tipText}`])
      const mine = el('Box', { key: 'sidekick-mode', flexDirection: 'row', columnGap: 1, flexShrink: 0 }, [dot, word])
      return el('Box', { flexDirection: 'row', columnGap: 2 }, theirs ? [theirs, mine] : [mine])
    }
    const tipText = s.level !== 'off' && typeof s.tip === 'string' && s.tip ? ` → ${s.tip}` : ''
    const label = s.level === 'off' ? x.modeOff : x.modeOn(s.busy ? '🟠' : '🟢', x.level[s.level]) + tipText
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })

  on('command.run', { command: 'savings' }, async ($, e) => {
    // Nebenbefehl: keine eigene Tabelle, nur der Verweis (HELP-SPEC §2)
    if (isHelp(e.args)) return { text: t().allCommands }
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

  // /sidekick help gezeichnet (Nachtrag 0.14.0, docs/HELP-SPEC.md §3.2, Vorlage templates/help/): ein zweiter Matcher neben dem für
  // savings. Die Kennung steht in der ersten Zeile hinter „sidekick: “, darum ohne Anker gesucht (templates/help/README.md, Befunde).
  // Status, Fehlermeldungen und andere Oberflächen: Markdown der Engine.
  on('ui.render', { component: 'CommandOutput', props: { command: 'sidekick' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    // Nur die Zeile von `/sidekick help` bzw. `?`: `/sidekick #<gültige Kennung>` trägt die Kennung auch in Zeile 1
    // („Unbekannt: „#…““) und zeigte sonst die Tabelle (templates/help/README.md Punkt 4; Nachtrag 0.14.1)
    if (!isHelp(String(e.props.args ?? ''))) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const data = tag ? helps.get(tag) : undefined
    if (!data) return next(e)
    try {
      return helpTree(data, e.viewport?.columns ?? 100, e.surface, HELP_ACCENT)
    } catch {
      return next(e)
    }
  })
}
