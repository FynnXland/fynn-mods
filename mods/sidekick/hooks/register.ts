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
import { CATALOG as CATALOG_SPEC, CHECK, HANDOFF, QUEUE, RATE, TIP_TARGETS, modelLabel, modelName } from './models.ts'
import {
  CATALOG,
  byId,
  catalogFromCheck,
  catalogKind,
  catalogPick,
  catalogPrompt,
  catalogSystem,
  checkCatalogPrompt,
  checkCatalogSystem,
  findCandidates,
  gapOk,
  isInstalled,
  parseCatalog,
  skillContext,
} from './catalog.ts'
import type { CatalogEntry, CatalogVerdict } from './catalog.ts'
import { QUEUE_TAIL, isHostNote, laterByVerdict, laterPrefix, parseQueue, queuePrompt, queueRule, queueSystem, stripLeadReminders } from './queue.ts'
import type { CacheMem, CompleteUsage, StepUsage } from './cache.ts'
import { joinBand, layer, nameOf, splitBand } from './band.ts'
import { changed, migrateSettings, readSettings, writeNote, writeSettings } from './settings.ts'
import { storeOffDefaults } from './offdefaults.ts'
import type { Values, WriteResult } from './settings.ts'
import { SETTINGS } from './fields.ts'
import {
  DEFAULT_RUNTIME,
  MIN_OF,
  cfgPatch,
  cleanRuntime,
  legacyOf,
  settingsOf,
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
  LOOP_AT,
  applyLoop,
  isKorrektur,
  loopChoices,
  whyOf,
  bookPrompts,
  bookQueue,
  bookCatalog,
  countPrompt,
  countQueue,
  countCatalog,
  HANDOFF_KEEP,
  chooseMethod,
  cleanHandoffs,
  countWay,
  forkCost,
  forkPrompt,
  handoffBody,
  nextOf,
  suggestDue,
  withFacts,
} from './logic.ts'
import type { Art, Booking, BuddyWhy, Choice, Day, HandoffHow, HandoffRec, Ignored, Ledger, Level, Loop, LoopChoice, MethodOut, NoteField, Period, Rate, Runtime, Settings, Skill, TipWay, Tips, Trigger, Verdict } from './logic.ts'
import { savingsTree } from './view.ts'
import {
  SAVED_MAX,
  TEXT_MAX,
  buttonLabel,
  buttonNames,
  checkName,
  cleanSaved,
  normName,
  preview,
  upsert,
  cmdOf,
  P_CMD,
  pHint,
  addSeen,
  cleanSeen,
  HAIKU_PER_DAY,
  addRecent as addPromptRecent,
  candidates,
  cleanBudget,
  cleanRecent,
  intentGroup,
  intentPrompt,
  intentSystem,
  knownIntents,
  nearSaved,
  parseIntent,
  parseProposal,
  proposePrompt,
  proposeSystem,
  recentOf,
  remembers,
  seenSet,
  useBudget,
} from './prompts.ts'
import type { NameCheck, Recent as PromptRecent, Saved } from './prompts.ts'
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
import type { Hint, HintSettings, Measure, MemFile, RuleId, Wartung } from './wartung.ts'

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
// `cat` (Ausbau 0.25.0): Hinweiszeile des Skill-Katalogs; `cmd` ist dann die Installationszeile (auch ohne `/`, z. B. `uv tool install …`)
type HintRow = { id: string; line: string; sent?: string; cmd?: string; ran?: boolean; wid?: RuleId; why?: string; filled?: boolean; offer?: Offer; offerDone?: 'saved' | 'no'; cat?: string }
/** Angebot „Als Befehl speichern“ (Nachtrag 0.21.0): Haikus Name und Fassung, dazu die Einträge der Gruppe (`prompts:seen`). */
type Offer = { name: string; text: string; ids: string[] }
function cleanOffer(v: unknown): Offer | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  if (!o || typeof o.name !== 'string' || typeof o.text !== 'string' || !Array.isArray(o.ids)) return null
  return { name: o.name, text: o.text, ids: o.ids.filter((x): x is string => typeof x === 'string') }
}

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
  // Korrektur-Schleife (Ausbau 0.19.0, Verhalten 2): Korrekturen in Folge, Commits beim Start der Serie, Frage in dieser Serie schon
  // gestellt, letzte Nachricht ging mit Denkanstoß raus (Gegenprobe bei der nächsten)
  korr: number
  korrCommits: number
  korrAsked: boolean
  nudged: boolean
  // Zusammenfassungs-Zähler (Verhalten 3): Compactions dieses Chats (nur `session.compact`), Marke bei der 2. und 4. (0 = keine),
  // B2: die nächste Anfrage folgt auf eine Compaction (kein Kaltstart, keine Kalt-Rückfrage)
  compacts: number
  compactMark: number
  afterCompact: boolean
  // Skill-Katalog (Ausbau 0.25.0): in diesem Chat schon angebotene Einträge; `catAsk` = `own` bei der letzten Katalog-Rückfrage (0 = nie)
  catOffered: string[]
  catAsk: number
}

/** Offener Wartungs-Hinweis; `at`: seit wann er wartet (Review 0.12.0 K5: in einer anderen Session gezeigt oder erledigt → verfällt). */
type Offen = WHint & { at?: number }
const offenOf = (h: WHint, now: number): Offen => ({ ...h, at: (h as Offen).at ?? now })

function emptySitzung(): Sitzung {
  return { summary: '', recent: [], own: 0, ignored: {}, hints: [], last: null, open: null, commits: 0, commit: null, wartung: false, wartungOffen: null, wartung2: false, wartungCommits: 0, ownAt: 0, note: null, leitsatz: false, korr: 0, korrCommits: 0, korrAsked: false, nudged: false, compacts: 0, compactMark: 0, afterCompact: false, catOffered: [], catAsk: 0 }
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
        ...(typeof h.cmd === 'string' && (h.cmd.startsWith('/') || (typeof h.cat === 'string' && byId(h.cat))) ? { cmd: h.cmd } : {}),
        ...(typeof h.cat === 'string' && byId(h.cat) ? { cat: h.cat } : {}),
        // `queued` (bis 0.14: als To-do eingereiht) gilt als schon erledigt: kein zweiter Klick auf denselben Befehl
        ...(h.ran === true || h.queued === true ? { ran: true } : {}),
        ...((RULE_IDS as readonly unknown[]).includes(h.wid) ? { wid: h.wid as RuleId } : {}),
        ...(typeof h.why === 'string' && h.why ? { why: h.why } : {}),
        ...(h.filled === true ? { filled: true } : {}),
        ...(cleanOffer(h.offer) ? { offer: cleanOffer(h.offer)! } : {}),
        ...(h.offerDone === 'saved' || h.offerDone === 'no' ? { offerDone: h.offerDone } : {}),
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
  const nat = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0)
  s.korr = nat(o.korr)
  s.korrCommits = nat(o.korrCommits)
  if (o.korrAsked === true) s.korrAsked = true
  if (o.nudged === true) s.nudged = true
  s.compacts = nat(o.compacts)
  s.compactMark = o.compactMark === 2 || o.compactMark === 4 ? o.compactMark : 0
  if (o.afterCompact === true) s.afterCompact = true
  if (Array.isArray(o.catOffered)) s.catOffered = o.catOffered.filter((x: unknown): x is string => typeof x === 'string' && !!byId(x))
  s.catAsk = nat(o.catAsk)
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
// Einstellungen (0.23.0, docs/SETTINGS-SPEC.md §4, §5): einzige Quelle ist userConfig. Befehle schreiben die Felder über
// hooks/settings.ts (Terminal: $.config.set, die Mod lädt neu; Desktop/-p: claude plugin configure, hier sofort nachgezogen).
// Im Store `runtime` bleiben nur die zuletzt aktive Stufe und Zähler/Ruhe von Modell-Tipp und Schleife. Die Store-Werte `settings`
// und `hints.on`/`hints.auditMin` (bis 0.22.0) werden einmal umgezogen.
const SELF = 'sidekick'
let cfg: Values = readSettings(SETTINGS, undefined)
let rt: Runtime = { ...DEFAULT_RUNTIME }
let settings: Settings = settingsOf(cfg, rt)

/** Werte übernehmen (aus `options`, nach einem Schreiben oder dem Umzug). */
function applyCfg(values: Values) {
  cfg = { ...cfg, ...values }
  settings = settingsOf(cfg, rt)
}

/**
 * Einstellungen mit frischen Laufzeitwerten: Zähler und Ruhe teilen sich alle Chats. Ist eine Stufe an, wird sie als zuletzt aktive
 * gemerkt, auch wenn sie auf der Einstellungsseite gewählt wurde (dann holt `/sidekick on` nach `off` sie zurück).
 */
async function loadSettings($: EngineInterface): Promise<Settings> {
  rt = cleanRuntime(await $.store.get('runtime'))
  settings = settingsOf(cfg, rt)
  if (settings.level !== 'off' && rt.lastOn !== settings.level) {
    rt = { ...rt, lastOn: settings.level }
    $.store.set('runtime', rt).catch(() => {})
  }
  return settings
}

/** Laufzeitwerte ändern, auf frisch gelesenen (eine andere Session kann sie inzwischen geändert haben). */
async function updateRuntime($: EngineInterface, fn: (r: Runtime) => Runtime) {
  rt = fn(cleanRuntime(await $.store.get('runtime')))
  settings = settingsOf(cfg, rt)
  await $.store.set('runtime', rt)
}

// Läuft der Umzug beim Start noch, warten Schreibvorgänge auf ihn: Sonst überschriebe er einen frühen Befehl mit dem Altwert (Review K2)
let migrating: Promise<unknown> = Promise.resolve()

/** Felder in userConfig schreiben; gelungen: hier sofort übernehmen (nach Weg 1 läuft daneben schon die neu geladene Instanz). */
async function writeCfg($: EngineInterface, patch: Values): Promise<WriteResult> {
  if (!Object.keys(patch).length) return { ok: true, way: 'config' }
  await migrating
  const r = await writeSettings($, SELF, SETTINGS, patch, lang())
  if (r.ok) applyCfg(patch)
  return r
}

/** Wartungs-Hinweise: Schalter und Schwelle aus userConfig, abgeschaltete Regeln aus dem Store `hints` (bleiben Befehl). */
async function loadHints($: EngineInterface): Promise<HintSettings> {
  const off = cleanHints(await $.store.get('hints')).off
  return { on: cfg.maintenanceHints !== false, off, auditMin: typeof cfg.auditMin === 'number' ? cfg.auditMin : SETTINGS.auditMin!.default as number }
}

/**
 * Einmal je Start (SETTINGS-SPEC §4): alte Store-Werte nach userConfig, Laufzeitwerte nach `runtime`. Die alten Werte gelten hier
 * sofort (sonst prüfte z. B. ein abgeschaltetes sidekick bis zum Ende des Schreibens wieder); zurück kommt das Schreiben, das
 * `session.start` im Hintergrund laufen lässt, oder null, wenn nichts umzuziehen ist.
 */
async function migrate($: EngineInterface): Promise<(() => Promise<void>) | null> {
  const old = await $.store.get('settings')
  const hints = await $.store.get('hints')
  const legacy = legacyOf(old, hints)
  if (!legacy) return null
  if (legacy.runtime) {
    const had = await $.store.get('runtime')
    if (had === undefined || had === null) await $.store.set('runtime', legacy.runtime)
  }
  const base = cfg
  applyCfg(changed(SETTINGS, base, legacy.values))
  // Markieren statt leeren (Review 0.23.0 S1): Chats, die nach dem Update noch mit 0.22.0 laufen (bis `/reload-plugins`), lesen
  // `settings` und `hints` vor jeder Prüfung neu. Geleert arbeiteten sie mit Standardwerten (z. B. wieder an statt aus), und ihr
  // nächstes Schreiben brächte diese Standards beim nächsten Start als Altwerte zurück. 0.22.0 übergeht das unbekannte Feld.
  // 0.24.0 (SETTINGS-SPEC §4, K1): nur markieren, wenn den Schlüssel seit dem Lesen niemand geändert hat (z. B. ein offener 0.22.0-Chat);
  // sonst zieht der nächste Start die Änderung um. Wie limit-bars 0.16.2 `markIfSame`
  const markIfSame = async (key: string, raw: unknown) => {
    const now = await $.store.get(key)
    if (JSON.stringify(now) !== JSON.stringify(raw)) return
    await $.store.set(key, { ...(raw as object), migrated: true })
  }
  const clear = async () => {
    if (legacy.settings) await markIfSame('settings', old)
    if (legacy.hints) await markIfSame('hints', hints)
  }
  return async () => {
    const { apply } = await migrateSettings($, SELF, SETTINGS, base, legacy.values, clear, lang())
    if (Object.keys(apply).length) applyCfg(apply)
  }
}
// Hinweis, der an die nächste eigene Zeile mit diesem Text gebunden wird (UserMessage kennt die Message-ID, prompt.submit nicht)
// `alt`: die gesendete Fassung; der Desktop zeigt in der Sprechblase das Original, daher passen beide Texte
let pending: { text: string; alt?: string; line: string; sent?: string; cmd?: string; wid?: RuleId; why?: string; cat?: string } | null = null
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

/**
 * Als Nachricht des Nutzers senden, ohne Plugin-Rahmen (types@2.1.319:9699-9711); sendet, sobald die Session ruht. Ein Weg für die
 * Übergabe, gespeicherte Prompts und die Warteschlange (Ausbau 0.24.0).
 */
function asUser($: EngineInterface, text: string) {
  return $.prompt.submit({ text, asUser: true })
}

const msg = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 140)

/**
 * Der einzige Aufruf von `$.clock.every` (0.23.0): `validate` nennt je Call die Funktionen, die ihn enthalten, und schneidet die
 * `calls:`-Zeile ab einer Länge ab; dann fände check-mods die letzten Calls nicht (wie Ausbau 0.22.0).
 */
function tick($: EngineInterface, ms: number, fn: () => void): Timer {
  return $.clock.every(ms, fn)
}

/**
 * Die einzigen Aufrufe von `$.prompt.fill` und `$.prompt.read` (Ausbau 0.25.0, wie `tick`): `validate` listet sonst je Call alle
 * Funktionen, die ihn enthalten, und die `calls:`-Zeile stößt an ihre 1000 Zeichen.
 */
function fillBox($: EngineInterface, text: string, mode: 'insert' | 'append') {
  return $.prompt.fill({ text, mode })
}
function readBox($: EngineInterface) {
  return $.prompt.read()
}

/**
 * Einmal `fn` nach `ms`, außerhalb des aufrufenden Hooks. Aus prompt.submit lehnt der Host `$.command.run` und
 * `$.prompt.submit` ab (limit-bars SPEC, Bau v0.2.0); Muster wie limit-bars register.ts:89-94.
 */
function later($: EngineInterface, ms: number, fn: () => void) {
  const timer = tick($, ms, () => {
    timer.cancel()
    fn()
  })
}

// ---- Schnittstelle zu clawd-buddy (types/index.d.ts): was sidekick gerade tut, als `$.state`-Wert, den Clawd beim Zeichnen liest.
// Beiwerk: nie warten, ein Fehler ändert nichts an Prüfung oder Nachricht.
// Ausbau 0.20.0: `hint` (Hinweiszeile der Prüfung gesetzt), `upkeep` (Wartungshinweis gesetzt), `why` = Grund eines `stop` (logic.ts whyOf)
type BuddyKind = 'check' | 'stop' | 'handoff' | 'fresh' | 'hint' | 'upkeep'
// `undefined` = unbekannt (nach einem Neuladen): der nächste Aufruf schreibt sicher, auch `null` (Review S1)
let buddyKind: BuddyKind | null | undefined = undefined
let buddyWhy: BuddyWhy | undefined = undefined
// Zählt jede Änderung: Die Rücksetzung von `hint`/`upkeep` greift nur, wenn seitdem nichts anderes geschrieben wurde
let buddySeq = 0
// Schreibvorgänge nacheinander, damit ein schnelles `handoff` → `null` nicht vertauscht ankommt (Review K1)
let buddyChain: Promise<unknown> = Promise.resolve()
function buddy($: EngineInterface, kind: BuddyKind | null, why?: BuddyWhy) {
  const w = kind === 'stop' ? why : undefined
  if (kind !== buddyKind || w !== buddyWhy) {
    buddyKind = kind
    buddyWhy = w
    buddySeq += 1
    try {
      buddyChain = buddyChain
        .then(() => $.clock.now())
        .then((at) => $.state.set({ plugin: 'sidekick', key: 'buddy' }, kind ? { kind, at, ...(w ? { why: w } : {}) } : null))
        .catch(() => {})
    } catch {
      // Beiwerk: nie die Prüfung oder Nachricht stören
    }
  }
  pushStatus($)
}

/**
 * Einmalige Momente für Clawd (Ausbau 0.20.0): `hint` 4 s, `upkeep` 5 s, danach `null`. Über `later` (ein `$.clock.every`, das sich
 * selbst beendet), kein `$.clock.after` (wäre ein neues Recht, Review 0.19.0 K4). Ein `stop`, `check` oder `handoff` dazwischen
 * überschreibt den Wert; dann bleibt er stehen.
 */
const MOMENT_MS = { hint: 4000, upkeep: 5000 } as const
function moment($: EngineInterface, kind: 'hint' | 'upkeep') {
  // Derselbe Moment noch einmal: neu schreiben (neues `at`), damit die ältere Rücksetzung ihn nicht vorzeitig nimmt
  if (buddyKind === kind) buddyKind = undefined
  buddy($, kind)
  const seq = buddySeq
  try {
    later($, MOMENT_MS[kind], () => {
      if (buddySeq === seq && buddyKind === kind) buddy($, null)
    })
  } catch {
    // Beiwerk: Clawd nimmt den Wert nach seinem Sicherheitsnetz (SK_MAX_MS) ohnehin zurück
  }
}

// ---- Cache kalt (Ausbau 0.20.0): `status.cold` für den Eisklumpen von clawd-buddy. Dieselbe Rechnung wie Auslöser (c) (letzte Aktivität
// + TTL, nach einer Compaction warm), ohne die Größenschwelle `big`. Ein neuer Chat ohne Anfrage ist `unknown`, also nicht kalt.
// `stepAt`: Start der laufenden Hauptanfrage. Sie setzt das Feld sofort zurück, nicht erst nach ihrer Auswertung in `afterStep`.
let coldNow = false
let stepAt = 0
let coldTimer: Timer | null = null
// Unabhängig von der Stufe gerechnet; auf `off` lässt pushStatus das Feld weg (ein Wechsel zurück stimmt so sofort)
function coldOf(now: number): boolean {
  if (!sessionId || ses.afterCompact) return false
  return cacheState(Math.max(mem.lastActivity, stepAt), ttlOf(mem, settings.ttl), now).kind === 'cold'
}
/** Neu rechnen und nur bei einer Änderung schreiben (pushStatus vergleicht mit dem zuletzt geschriebenen Wert). */
async function refreshCold($: EngineInterface) {
  await bindSession($)
  coldNow = coldOf(await $.clock.now())
  pushStatus($)
}
/** Der Takt: höchstens einmal pro Minute (SPEC 0.20.0, Aufgabe 3). Einmal je geladenem Modul. */
function startColdTimer($: EngineInterface) {
  if (coldTimer) return
  coldTimer = tick($, 60000, () => {
    refreshCold($).catch(() => {})
    // Vorschlag kurz vor Ablauf (Ausbau 0.22.0): derselbe Minutentakt, zeichnet nur beim Ein- und Ausblenden
    checkSuggest($).catch(() => {})
  })
}

// ---- Anzeige in der Fußzeile (Nachtrag 0.10.0): `sidekick.status` = Stufe und ob sidekick gerade arbeitet. Der SessionMode-Hook
// liest den Wert und abonniert ihn so; ein Schreiben zeichnet nur diese Stelle neu, kein $.ui.invalidate (types:3310-3313).
// Regeln wie bei `buddy`: nie warten, Fehler verschlucken, nacheinander.
// `tip`: Name des Zielmodells, solange sidekick in diesem Chat umstellt (Ausbau 0.18.0: „→ Sonnet“ im Label)
// `cold` (Ausbau 0.20.0): nur `true` oder fehlend; auf `off` fehlt es immer (coldOf)
type Status = { level: Level; busy: boolean; tip?: string; cold?: true }
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
  const cold = coldNow && settings.level !== 'off'
  const value: Status = { level: settings.level, busy: settings.level !== 'off' && busyNow(), ...(tipName ? { tip: tipName } : {}), ...(cold ? { cold: true as const } : {}) }
  const key = JSON.stringify(value)
  if (key === statusLast) return
  statusLast = key
  try {
    // Abgelehnt (z. B. aus einem `ui.render`-Hook heraus, types:3551-3552): als ungeschrieben merken, der nächste Aufruf schreibt erneut (Review 0.19.0 S1)
    statusChain = statusChain
      .then(() => $.state.set({ plugin: 'sidekick', key: 'status' }, value))
      .catch(() => {
        if (statusLast === key) statusLast = undefined
      })
  } catch {
    // Beiwerk
  }
}

/**
 * Nach /clear oder /resume gibt es eine neue Session-ID (Probe: sofort nach `/clear`); dann deren Stand laden. Aufrufe laufen
 * nacheinander (Review 0.20.0 K2): Seit dem Minutentakt kann ein zweiter Aufrufer kommen, während der erste noch aus dem Store lädt;
 * er kehrte sonst früh zurück und arbeitete kurz auf dem leeren Stand. Nicht geteilt: Jeder Aufruf fragt die ID selbst, damit ein
 * Takt kurz vor `/clear` der Übergabe nicht die alte Session liefert.
 */
let bindChain: Promise<unknown> = Promise.resolve()
function bindSession($: EngineInterface): Promise<void> {
  const p = bindChain.then(() => bindNow($))
  bindChain = p.catch(() => {})
  return p
}
async function bindNow($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if (!id || id === sessionId) return
  sessionId = id
  baseCache = null // /clear, /resume oder Projektwechsel: frisch messen
  mem = emptyMem()
  ses = emptySitzung()
  pending = null
  askedCold = false
  chain = Promise.resolve()
  // Cache kalt (0.20.0): der neue Chat ist bis zur nächsten Rechnung (Takt, session.start) nicht kalt
  const wasCold = coldNow
  stepAt = 0
  coldNow = false
  const saved = cleanMem(await $.store.get(`cache:${id}`))
  if (saved) mem = { lastActivity: saved.lastActivity, ttl: saved.ttl, ttlSource: saved.ttlSource, ctx: saved.ctx, model: saved.model }
  ses = cleanSitzung(await $.store.get(`sitzung:${id}`))
  const had = !!tip
  tip = cleanChatTip(await $.store.get(`tip:${id}`))
  // Nach /clear gehört „→ Sonnet“ nicht mehr ins Label (der neue Chat hat keinen Tipp), ebenso kein `cold` des alten Chats
  if (had || tip || wasCold) pushStatus($)
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
        const r = await fillBox($, cmd, 'insert')
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
    // Skill-Katalog (0.25.0): eine Zeile ohne `/` ist ein Shell-Befehl, im Eingabefeld wäre sie eine Nachricht an Claude: nur kopieren
    if (!h.cat || cmd.startsWith('/')) {
      const box = await readBox($).catch(() => null)
      if (box && box.text.trim()) {
        $.ui.toast(x.insBoxFull(cmd), { timeoutMs: 10000 })
        return
      }
      const next = fillOutcome(await fillBox($, cmd, 'append').catch(() => null), cmd)
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
    }
    // Die Oberfläche des Drucks (ButtonProps.onPress, types:1150-1160)
    const c = await $.ui.copy({ text: cmd, ...(surface ? { surface } : {}) }).catch(() => null)
    // Review 0.25.0 S2: ein kopierter Shell-Befehl des Katalogs gehört in ein Terminal, nicht „ins Eingabefeld einfügen und abschicken“
    const shell = !!h.cat && !cmd.startsWith('/')
    $.ui.toast(c?.isCopied ? (shell ? x.cat.shellCopied(cmd) : x.insCopied(cmd)) : x.insFailed(cmd), { timeoutMs: 15000 })
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
  const hs = await loadHints($)
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
  const hs = await loadHints($)
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
    pending = { text: stripLeadReminders(e.text), line: h.line, wid: h.id, ...(h.why ? { why: h.why } : {}), ...(h.cmd ? { cmd: h.cmd } : {}) }
    ses.last = { line: h.line, art: 'sonstiges', at: now }
    ses.wartungOffen = null
    saveSes($, now)
    bookDay($, now, (d) => countWartung(d, h.id, 'gezeigt'))
    moment($, 'upkeep')
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
    // Review 0.24.0 K1: ohne den Vorspann der Desktop-App, wie `prompt.submit` den Text sieht
    .map((m) => ({ role: m.role, text: typeof m.text === 'string' ? stripLeadReminders(m.text) : '' }))
    .filter((m) => m.role === 'user' && m.text.trim() && !isHostNote(m.text))
    .slice(-3)
    .map((m) => cut(m.text, 400))
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
// `grund` (Ausbau 0.19.0): Frage kam aus der Korrektur-Schleife oder dem Zusammenfassungs-Zähler; bei `schleife` bekommt die Übergabe den
// Abschnitt „Was nicht funktioniert hat“
type Check = { trigger: Trigger; ctx: number; model: string; main: string; brief: boolean; ttl: 5 | 60; cold: boolean; unknown: boolean; coldFor: number; verdict: Verdict | null; before: { recent: string[]; summary: string }; grund?: 'schleife' | 'verdichtet' }

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

/**
 * Ergebnis des Torwächters: die Prüfung (null = ohne Prüfung durchlassen) und ein Wartungs-Hinweis für genau diese Nachricht.
 * Ausbau 0.19.0: `loop` die Korrektur-Schleife fragt, `compact` die Neuer-Chat-Frage nach der 2./4. Zusammenfassung ist fällig; `mini`
 * die Fakten dieser Nachricht ohne Prüfung, für beide Fragen, wenn kein Auslöser die Prüfung gestartet hat.
 */
// `kat` (Ausbau 0.25.0): Urteil über die Katalog-Kandidaten, wenn die Prüfung sie mitgenommen hat; fehlt = nicht mitgeprüft
type Gate = { c: Check | null; w: WHint | null; loop?: boolean; compact?: number; mini?: Check; kat?: CatalogVerdict | null }
const PASS: Gate = { c: null, w: null }

/** Korrektur-Serie fortschreiben (Verhalten 2): Ende bei einer Nachricht, die keine Korrektur ist, und bei einem neuen Commit. */
function trackKorrektur($: EngineInterface, text: string, now: number) {
  const k = isKorrektur(text)
  // Gegenprobe des Denkanstoßes: War die Nachricht danach wieder eine Korrektur?
  if (ses.nudged) {
    ses.nudged = false
    if (k) bookDay($, now, (d) => (d.schleife.wieder += 1))
  }
  if (!k) {
    ses.korr = 0
    ses.korrAsked = false
    return
  }
  if (ses.korr > 0 && ses.commits !== ses.korrCommits) {
    ses.korr = 0
    ses.korrAsked = false
  }
  if (ses.korr === 0) ses.korrCommits = ses.commits
  ses.korr += 1
}

/** Serie beenden: `/clear` (neue Session), `/rewind`, `/compact` und jede Compaction (Verhalten 2). */
function endSeries() {
  ses.korr = 0
  ses.korrAsked = false
  ses.nudged = false
}

/** Schritt 1 bis 3 der SPEC (Verhalten 3): Filter, Auslöser, Modell-Prüfung. */
async function gate($: EngineInterface, text: string, kind: string, running: boolean, signal: AbortSignal, cands: readonly CatalogEntry[] = []): Promise<Gate> {
  await loadSettings($)
  pushStatus($)
  // Ausbau 0.24.0: Die Desktop-App setzt einen `<system-reminder>`-Block vor getippte Prompts (Probe P1, z. B. „Linked sessions now“);
  // bisher fiel die Prüfung dann ganz weg. Erst den Vorspann entfernen, dann wie bisher
  text = stripLeadReminders(text)
  if (settings.level === 'off' || running || text.trim().startsWith('/')) return PASS
  // Vom Host eingefügte Nachrichten wie ein reiner `<system-reminder>` (Desktop, Worktree-Chat) sind nicht vom Nutzer: keine Prüfung, und
  // sie verbrauchen nicht die Wartungs-Prüfung des Chats (Desktop-Test 2026-10-06). Seit 0.24.0 auch Tags mit Attributen und `[… notice]`
  if (!text.trim() || isHostNote(text)) return PASS
  if (!(await isOwn($, kind))) return PASS
  await bindSession($)
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const ctx = typeof usage.context.tokens === 'number' ? usage.context.tokens : mem.ctx
  const ttl = ttlOf(mem, settings.ttl)
  // B2 (Ausbau 0.19.0): Nach einer Compaction, auch der im Leerlauf kurz vor Ablauf des Caches, schreibt die nächste Anfrage nur die
  // Zusammenfassung; der alte Verlauf wird nie neu geschrieben. Kalt ist sie also nicht, und die Kalt-Rückfrage mit der alten Größe
  // wäre falsch (S3: `context.tokens` fehlte vor der ersten Anfrage, sidekick nahm die alte Größe aus `mem`)
  const st = ses.afterCompact ? { kind: 'warm' as const, left: ttl * 60000 } : cacheState(mem.lastActivity, ttl, now)
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
  // Korrektur-Schleife (Ausbau 0.19.0): nur Regeln (Probe P3, Entscheidung Fynn); die erste Nachricht eines Chats korrigiert nichts
  if (!first) trackKorrektur($, text, now)
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
  // Ausbau 0.19.0, E7: Korrektur-Schleife und Zusammenfassungs-Zähler nur auf Guide. Die Schleife höchstens einmal je Serie, mit Ruhe
  // nach dreimal „Unverändert senden“; die Zusammenfassungs-Frage bei der nächsten eigenen Nachricht ab 4 Wörtern
  const guide = settings.level === 'guide'
  const loop = guide && settings.loop.on && now >= settings.loop.restUntil && ses.korr >= LOOP_AT && !ses.korrAsked
  const compact = guide && !first && ses.compactMark > 0 && text.trim().split(/\s+/).length >= 4 ? ses.compactMark : 0
  const mini: Check = { trigger: trigger ?? 'b', ctx, model: mem.model, main: mem.model, brief, ttl, cold: st.kind === 'cold', unknown: st.kind === 'unknown', coldFor: -st.left, verdict: null, before }
  if (!trigger) {
    saveSes($, now)
    return { c: null, w: await wp, loop, compact, mini }
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
  // Skill-Katalog (Ausbau 0.25.0, Verhalten 2): Kandidaten des Vorfilters in diesem Aufruf statt eines zweiten; Antwort im Feld `katalog`
  const system = checkSystem(skills, trigger === 'a') + (cands.length ? `\n\n${checkCatalogSystem()}` : '')
  const r = await $.model.complete({ ...CHECK, system, prompt: cands.length ? `${prompt}\n\n${checkCatalogPrompt(cands)}` : prompt }, { signal })
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
  const kat = cands.length ? (r.isAnswered ? catalogFromCheck(r.text, cands.map((x) => x.id)) : null) : undefined
  return { c: { ...base, verdict }, w: await wp, loop, compact, mini, ...(kat !== undefined ? { kat } : {}) }
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
 * „Neuer Chat mit Übergabe“: die Übergabe nach der gewählten Methode (Ausbau 0.22.0: Fork oder Text), dann /clear und die Nachricht
 * (SPEC Verhalten 4). Läuft im Timer. `plain`: „ohne Übergabe“, nur /clear und die Nachricht, kein Modellaufruf.
 */
async function runHandoff($: EngineInterface, text: string, c: Check, plain = false) {
  try {
    if (plain) {
      // Sichtbar machen, dass gearbeitet wird: blaue Box über dem Prompt
      await showBusy($, 'plain')
      return await freshChat($, text, c, '')
    }
    return await writeHandoff($, text, c)
  } finally {
    hideBusy($)
  }
}

type Step = HandoffHow | 'plain' | 'clear'
let busy: { step: Step; since: number } | null = null
let busyTimer: Timer | null = null

async function showBusy($: EngineInterface, step: Step) {
  buddy($, 'handoff')
  busy = { step, since: busy?.since ?? (await $.clock.now()) }
  pushStatus($)
  // Sekunden mitzählen: alle 1 s neu zeichnen, nur solange die Box steht
  if (!busyTimer) busyTimer = tick($, 1000, () => $.ui.invalidate('ui.render'))
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

// ---------- Übergabe nach Methode (Ausbau 0.22.0) ----------

type Made = { text: string; how: HandoffHow; usd: number; warm: boolean } | { error: string }
type Picked = MethodOut & { ctx: number; model: string; ttl: 5 | 60 }

/** So lange wartet sidekick auf den Fork, dann Rückfall auf Text (der Fork hat kein eigenes Zeitlimit, types@2.1.319:2734-2758). */
const FORK_TIMEOUT_MS = 60000

/** Methode für diese Session (chooseMethod): Cache-Zustand, Kontext, Hauptmodell, Länge des Textauszugs, ob es einen Verlauf gibt. */
async function pickMethod($: EngineInterface, msgs: readonly { role: string }[], histChars: number, force?: HandoffHow): Promise<Picked> {
  await bindSession($)
  const now = await $.clock.now()
  const ttl = ttlOf(mem, settings.ttl)
  const st = cacheState(mem.lastActivity, ttl, now)
  let ctx = mem.ctx
  try {
    const u = await $.session.usage()
    if (typeof u.context.tokens === 'number') ctx = u.context.tokens
  } catch {
    // die zuletzt gemessene Größe
  }
  // Der Fork wiederholt die letzte Anfrage der Hauptschleife „with its model“ (types@2.1.319:2737-2739). Hat der Modell-Tipp die
  // Anfragen dieses Chats umgestellt, ist das das Ziel des Tipps, sonst das Hauptmodell (Review 0.22.0 [UNKLAR], belegt nur so weit)
  const tipTo = tip && !tip.ended && tip.way === 'chat' ? tip.to : ''
  const model = tipTo || (await mainModel($)) || mem.model
  // Nach /clear und vor der ersten Antwort gibt es nichts zu forken (types@2.1.319:2744-2748)
  const canFork = msgs.some((m) => m.role === 'assistant')
  return { ...chooseMethod({ state: st.kind, left: st.left, ctx, model, ttl, histChars, canFork, ...(force ? { force } : {}) }), ctx, model, ttl }
}

type ForkResult = Awaited<ReturnType<EngineInterface['model']['fork']>>

/** Der Fork mit Zeitlimit über den einmaligen Timer `later`; `null` bei Zeitüberschreitung oder Fehler. */
function within($: EngineInterface, run: Promise<ForkResult>, ms: number): Promise<ForkResult | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: ForkResult | null) => {
      if (done) return
      done = true
      resolve(v)
    }
    // Der Timer läuft nach einer früheren Antwort einmal leer ab (`later` endet selbst)
    later($, ms, () => finish(null))
    run.then(finish, () => finish(null))
  })
}

/**
 * Übergabe schreiben: Fork, wenn gewählt, sonst oder bei einem Fehlschlag Text (SPEC 0.22.0, „Rückfall“). Bucht Kosten unter der Rolle
 * `uebergabe` und den Weg. `message`: die zurückgehaltene Nachricht einer Rückfrage, leer bei `/handoff`.
 */
async function makeHandoff($: EngineInterface, o: { message: string; failed: boolean; force?: HandoffHow }): Promise<Made> {
  const msgs = await $.session.messages()
  // Anfang und Ende des Verlaufs (Nachtrag 0.12.0, H3); seine Länge bestimmt die Kosten des Text-Wegs
  const parts = historyParts(msgs, 100000)
  const m = await pickMethod($, msgs, parts.start.length + parts.tail.length, o.force)
  // Projektwurzel über projectOf (fängt Fehler selbst ab); der Rückfall über Anweisungsdateien zählt hier nicht. Ein Aufrufer von
  // `$.session.root` weniger hält die `calls:`-Zeile von validate kurz (0.23.0, siehe tick)
  const p = await projectOf($, [])
  const root = p.viaRoot ? p.root : ''
  const commit = ses.commit?.sha ?? ''
  if (m.method === 'fork') {
    await showBusy($, 'fork')
    const r = await forkHandoff($, o, m, root, commit)
    if (r) return r
  }
  await showBusy($, 'text')
  return textHandoff($, o, parts, m, root, commit)
}

async function forkHandoff($: EngineInterface, o: { message: string; failed: boolean }, m: Picked, root: string, commit: string): Promise<Made | null> {
  const start = await $.clock.now()
  const run = $.model.fork({ prompt: forkPrompt(root, o.message, o.failed) })
  const r = await within($, run, FORK_TIMEOUT_MS)
  // Zeit überschritten: Rückfall auf Text. Der Fork lässt sich nicht abbrechen (kein `signal`, types@2.1.319:6643-6695) und kostet
  // weiter: kommt er doch noch, wird er gebucht, aber nicht verwendet (Review 0.22.0 K1)
  if (!r) {
    run.then((late) => $.clock.now().then((end) => bookFork($, late, m, start, end)), () => {})
    return null
  }
  const usage = bookFork($, r, m, start, await $.clock.now())
  if (!usage) return null
  const body = r.isAnswered ? handoffBody(r.text) : ''
  if (body.length < 100) return null
  return { text: withFacts(body, root, commit), how: 'fork', usd: completeCost(usage, m.model), warm: m.warm }
}

/** Kosten und Weg eines Forks buchen, die Cache-Messung lernt daraus; `undefined` ohne Anfrage (`nothing-to-fork`). */
function bookFork($: EngineInterface, r: ForkResult, m: Picked, start: number, end: number): CompleteUsage | undefined {
  // Keine Anfrage gelaufen: nichts zu buchen (wie „Gut zu wissen“, Bau 0.13.0)
  if (!r.isAnswered && r.reason === 'nothing-to-fork') return undefined
  const usage = 'usage' in r ? (r.usage as CompleteUsage | undefined) : undefined
  // Gemessen statt geschätzt: die echten Kosten auf dem Hauptmodell
  const usd = completeCost(usage, m.model)
  const read = usage?.cache_read_input_tokens ?? 0
  const noCache = !!usage && m.warm && read < 0.5 * m.ctx
  bookDay($, start, (d) => {
    d.kosten += usd
    bookModel(d, m.model, 'uebergabe', usd, end - start, usage)
    countWay(d, 'fork', usd, noCache)
  })
  // Ein Fork liest bzw. schreibt den Cache des Hauptchats und erscheint nicht als `turn.step` (Probe 2026-11-07): die Messung lernt
  // daraus wie aus einer Anfrage, ein Neuschreiben nach einer Pause wie aus einem Kaltstart
  if (usage && totalInput(usage) > 0) {
    // Die Größe bleibt die des Hauptchats: der Fork zählt seinen eigenen Prompt (≈ 1,5k) mit
    mem = { ...observeStep(mem, { ...usage, model: m.model }, start, false).mem, ctx: mem.ctx || m.ctx }
    saveMem($, start)
  }
  return usage ?? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
}

async function textHandoff($: EngineInterface, o: { message: string; failed: boolean }, parts: { start: string; tail: string }, m: Picked, root: string, commit: string): Promise<Made> {
  const start = await $.clock.now()
  const prompt = handoffPrompt(ses.summary, parts.start, parts.tail, o.message, { root, commit, model: m.model ? modelLabel(m.model) : '' })
  // Aus der Korrektur-Schleife: „Verworfen“ wird Pflicht (Ausbau 0.19.0, Verhalten 2; 0.22.0)
  const r = await $.model.complete({ ...HANDOFF, system: handoffSystem(o.failed, 'text', !!o.message.trim()), prompt })
  const end = await $.clock.now()
  const usd = completeCost(r.usage as CompleteUsage, HANDOFF.model)
  bookDay($, start, (d) => {
    d.kosten += usd
    bookModel(d, HANDOFF.model, 'uebergabe', usd, end - start, r.usage as CompleteUsage)
    countWay(d, 'text', usd)
  })
  const raw = r.isAnswered ? r.text.trim() : ''
  const body = handoffBody(raw) || raw
  if (body.length < 100) return { error: r.isAnswered ? t().tooShort : r.reason }
  return { text: withFacts(body, root, commit), how: 'text', usd, warm: m.warm }
}

/**
 * Gespeicherte Übergaben; das alte `handoff:last` (bis 0.21.3) wird beim Lesen eingereiht (ohne Doppel) und von `housekeeping` beim
 * nächsten Start übernommen und gelöscht.
 */
async function loadHandoffs($: EngineInterface): Promise<HandoffRec[]> {
  return cleanHandoffs(await $.store.get('handoffs'), await $.store.get('handoff:last'))
}

async function saveHandoff($: EngineInterface, rec: HandoffRec) {
  const list = await loadHandoffs($)
  await $.store.set('handoffs', [rec, ...list].slice(0, HANDOFF_KEEP))
}

async function writeHandoff($: EngineInterface, text: string, c: Check) {
  const oldSession = sessionId
  const start = await $.clock.now()
  const made = await makeHandoff($, { message: text, failed: c.grund === 'schleife' })
  if ('error' in made) {
    // Nie stillschweigend kalt senden: erneut fragen (SPEC Fehlerverhalten)
    const why = made.error
    hideBusy($)
    let answer = t().abort
    try {
      answer = await $.ui.ask(t().handoffFailed(why), { options: [t().send, t().abort], header: HEADER })
    } catch {
      // Dialog geschlossen: nicht senden
    }
    if (answer === t().send) await asUser($, text)
    else $.ui.toast(t().notSent(cut(text, 300)), { timeoutMs: 30000 })
    return
  }
  await saveHandoff($, { at: start, session: oldSession, text: made.text, method: made.how, usd: made.usd, msg: cut(text, 20000) })
  bookDay($, start, (d) => {
    d.uebergaben += 1
  })
  return freshChat($, text, c, made.text)
}

/** /clear, offene Ersparnis-Buchung in der neuen Session, dann (Übergabe +) Nachricht senden. */
async function freshChat($: EngineInterface, text: string, c: Check, handoff: string) {
  await showBusy($, 'clear')
  try {
    await $.command.run({ command: 'clear' })
  } catch (err) {
    $.ui.toast(handoff ? (text ? t().clearFailedSaved(msg(err)) : t().ho.clearFailed(msg(err))) : t().clearFailedNothing(msg(err), cut(text, 300)), { timeoutMs: 20000 })
    return
  }
  // Neue Session: Buchung offen in deren Eintrag (SPEC Zustand), die erste eigene Nachricht ist gesendet
  await bindSession($)
  const now = await $.clock.now()
  // Nach „falscher Chat“ keine Ersparnis: Ohne sidekick wäre die Nachricht nicht in den großen Chat gegangen, sondern in einen
  // anderen (Review K1)
  if (c.verdict?.art !== 'falscher_chat') {
    const booking: Booking = { kind: c.cold ? 'kalt' : 'warm', oldCtx: c.ctx, model: c.model, ttl: c.ttl, first: 0, steps: 0, at: now, ...(c.grund ? { grund: c.grund } : {}) }
    bookNow($, now, (l) => ({ ...l, offen: booking }))
  }
  ses.own = 1
  saveSes($, now)
  try {
    // Ohne Nachricht (`/handoff`): Wortlaut wie limit-bars `handoffPrefix` (SPEC 0.22.0 Verhalten 1)
    await asUser($, handoff ? (text ? handoff + t().handoffSep + text : `${t().ho.prefix}\n\n${handoff}`) : text)
    // /clear hat den Wert zurückgesetzt; neu schreiben, auch wenn das Modul noch „handoff“ meint
    buddyKind = null
    buddy($, 'fresh')
    $.ui.toast(t().newChatStarted(!!handoff), { timeoutMs: 8000 })
  } catch (err) {
    if (handoff && !text) $.ui.toast(t().ho.sendFailed(msg(err)), { timeoutMs: 20000 })
    else $.ui.toast(t().sendAfterClearFailed(msg(err), handoff ? t().statusShowsHandoff : t().yourText(cut(text, 300))), { timeoutMs: 20000 })
  }
}

// ---------- /handoff, Skill, Vorschlag (Ausbau 0.22.0) ----------

/** `running`: eine Übergabe läuft; `queued`: kommt nach dem laufenden Turn; `skill`: der Skill lief in diesem Turn. */
const HO: { running: boolean; queued: { force?: HandoffHow } | null; skill: boolean } = { running: false, queued: null, skill: false }

const HO_SHOW = ['show', 'zeigen']
const HO_CONTINUE = ['continue', 'weiter']
const HO_FORCE = ['fork', 'text']

function howLabel(method: HandoffRec['method'], warm?: boolean): string {
  const x = t().ho.how
  return method === 'skill' ? x.skill : method === 'fork' ? (warm === undefined ? x.fork : warm ? x.forkWarm : x.forkCold) : x.text
}

/** Ein Check für die Buchung des neuen Chats (Verhalten 8): alter Kontext, Modell, TTL, warm oder kalt. */
async function handoffCheck($: EngineInterface, warm?: boolean): Promise<Check> {
  await bindSession($)
  const now = await $.clock.now()
  const ttl = ttlOf(mem, settings.ttl)
  const st = cacheState(mem.lastActivity, ttl, now)
  const cold = warm === undefined ? st.kind !== 'warm' && st.kind !== 'cooling' : !warm
  return { trigger: 'b', ctx: mem.ctx, model: mem.model, main: mem.model, brief: false, ttl, cold, unknown: st.kind === 'unknown', coldFor: -st.left, verdict: null, before: { recent: ses.recent, summary: ses.summary } }
}

/** Die Rückfrage nach dem Schreiben (E4): neuer Chat mit Übergabe (empfohlen) oder hier weiter; geschlossen: gespeichert. */
async function offerNewChat($: EngineInterface, rec: HandoffRec, warm: boolean) {
  const x = t()
  let answer = ''
  try {
    answer = await $.ui.ask(x.ho.question(howLabel(rec.method, warm), rec.method === 'skill' ? '' : usdText(rec.usd), nextOf(rec.text)), {
      options: [x.newChat + x.recommended, x.ho.keep],
      header: x.ho.header,
    })
  } catch {
    $.ui.toast(x.ho.savedLater, { timeoutMs: 12000 })
    return
  }
  if (answer !== x.newChat + x.recommended && answer !== x.newChat) return
  const c = await handoffCheck($, warm)
  try {
    await freshChat($, '', c, rec.text)
  } finally {
    hideBusy($)
  }
}

/** `/handoff` (fork|text): Methode wählen, schreiben, speichern, fragen. Läuft im Timer (aus command.run lehnt der Host Aufrufe ab). */
async function cmdHandoff($: EngineInterface, force?: HandoffHow) {
  if (HO.running) return
  HO.running = true
  try {
    await bindSession($)
    const oldSession = sessionId
    const start = await $.clock.now()
    const made = await makeHandoff($, { message: '', failed: false, ...(force ? { force } : {}) })
    hideBusy($)
    if ('error' in made) {
      $.ui.toast(t().ho.failed(made.error), { timeoutMs: 15000 })
      return
    }
    const rec: HandoffRec = { at: start, session: oldSession, text: made.text, method: made.how, usd: made.usd }
    await saveHandoff($, rec)
    bookDay($, start, (d) => {
      d.uebergaben += 1
    })
    await offerNewChat($, rec, made.warm)
  } finally {
    HO.running = false
    hideBusy($)
  }
}

/** `/handoff continue`: neuer Chat mit der zuletzt gespeicherten Übergabe. */
async function continueLast($: EngineInterface) {
  if (HO.running) return $.ui.toast(t().ho.running, { timeoutMs: 8000 })
  const list = await loadHandoffs($)
  if (!list[0]) return $.ui.toast(t().ho.none, { timeoutMs: 8000 })
  HO.running = true
  try {
    await freshChat($, '', await handoffCheck($), list[0].text)
  } finally {
    HO.running = false
    hideBusy($)
  }
}

/** Antwort des Skills `sidekick:write-handoff` abfangen (E2): ab der Überschrift speichern, dieselbe Frage wie `/handoff`. */
async function captureSkill($: EngineInterface, answer: string) {
  const body = handoffBody(answer)
  if (body.length < 100) {
    $.ui.toast(t().ho.skillEmpty, { timeoutMs: 8000 })
    return
  }
  await bindSession($)
  const now = await $.clock.now()
  const rec: HandoffRec = { at: now, session: sessionId, text: body, method: 'skill', usd: 0 }
  await saveHandoff($, rec)
  bookDay($, now, (d) => {
    d.uebergaben += 1
    countWay(d, 'skill')
  })
  const ttl = ttlOf(mem, settings.ttl)
  const k = cacheState(mem.lastActivity, ttl, now).kind
  await offerNewChat($, rec, k === 'warm' || k === 'cooling')
}

/**
 * Skill `write-handoff` dieses Plugins (types@2.1.319 SkillPromptInput: `skill`, `pluginName`). Er heißt nicht `handoff`: ein Skill mit
 * dem Namen des Befehls verdeckt `/handoff` („This skill can only be invoked by Claude“, Smoke-Test 2026-11-07).
 */
function isOwnSkill(e: { skill: string; pluginName?: string }): boolean {
  if (e.skill === 'sidekick:write-handoff') return true
  return e.skill === 'write-handoff' && (!e.pluginName || /^sidekick(@|$)/.test(e.pluginName))
}

// Vorschlag kurz vor Ablauf (E3, Verhalten 3): eine Zeile im Band. `shownFor`: `lastActivity`, für die er kam (einmal je Fenster).
type Sug = { until: number; ctx: string; now: string; later: string; keepwarm: boolean }
let sug: Sug | null = null
let sugFor = 0
let sugPressing = false

/** Im Minutentakt: zeigen, wenn alle Bedingungen gelten; ausblenden, wenn der Cache kalt wurde. Zeichnet nur beim Wechsel neu. */
async function checkSuggest($: EngineInterface) {
  await bindSession($)
  const now = await $.clock.now()
  const ttl = ttlOf(mem, settings.ttl)
  const st = cacheState(mem.lastActivity, ttl, now)
  if (sug) {
    if (st.kind !== 'cooling' || mem.lastActivity !== sugFor) hideSuggest($, 'ignoriert', now)
    return
  }
  const surfaces = await $.session.surfaces()
  const idle = !turnRunning && busy === null && buddyKind !== 'stop' && !HO.running
  if (!suggestDue({ level: settings.level, interactive: surfaces.some((s) => s === 'terminal' || s === 'desktop'), idle, ctx: mem.ctx, big: settings.big, state: st.kind, lastActivity: mem.lastActivity, shownFor: sugFor })) return
  const model = mem.model
  // /keepwarm von limit-bars nur, wenn die Befehlsliste es zeigt (über den Zwischenspeicher der Prüfung, höchstens 30 min alt)
  const keepwarm = (await loadBase($, now).catch(() => null))?.cmds.some((c) => c.name === 'keepwarm' && c.source === 'plugin') ?? false
  sugFor = mem.lastActivity
  sug = { until: mem.lastActivity + ttl * 60000, ctx: tokensText(mem.ctx), now: usdText(forkCost(mem.ctx, model, ttl, true)), later: usdText(rewriteCost(mem.ctx, model, ttl)), keepwarm }
  bookDay($, now, (d) => (d.vorschlag.gezeigt += 1))
  $.ui.invalidate('ui.render')
}

function hideSuggest($: EngineInterface, why: 'geklickt' | 'ignoriert' | null, now: number) {
  if (!sug) return
  sug = null
  if (why) bookDay($, now, (d) => (d.vorschlag[why] += 1))
  $.ui.invalidate('ui.render')
}

async function pressSuggest($: EngineInterface, a: 'handoff' | 'keepwarm' | 'later') {
  if (sugPressing) return
  sugPressing = true
  try {
    const now = await $.clock.now()
    hideSuggest($, a === 'handoff' ? 'geklickt' : a === 'later' ? 'ignoriert' : null, now)
    // Aus einem Knopf, nicht aus einem command.run-Hook: direkt erlaubt (wie die Knöpfe seit 0.8.1)
    if (a !== 'later') await $.command.run({ command: a })
  } catch (err) {
    $.ui.toast(t().runFailed(`/${a}`, msg(err)), { timeoutMs: 10000 })
  } finally {
    sugPressing = false
  }
}

/** Die Zeile im Band: Text und Knöpfe /handoff, /keepwarm (nur wenn vorhanden), Später, alle mit festem `key`. */
function suggestView(s: Sug, cols: number, surface: string, button: NoteButton, press: (a: 'handoff' | 'keepwarm' | 'later') => void): RenderElement {
  const x = t().ho
  const line = `${x.sugLine(hhmm(s.until), s.ctx, s.now, s.later)}${s.keepwarm ? ` ${x.sugKeep}` : ''}`
  const kids: RenderNode[] = [button({ key: 'sidekick-sug-handoff', label: '/handoff', plain: true, onPress: () => press('handoff') })]
  if (s.keepwarm) kids.push(button({ key: 'sidekick-sug-keepwarm', label: '/keepwarm', plain: true, onPress: () => press('keepwarm') }))
  kids.push(button({ key: 'sidekick-sug-later', label: x.sugLater, plain: true, onPress: () => press('later') }))
  const frame = { key: 'sidekick-sug', flexDirection: 'column', width: Math.max(20, cols), ...(surface === 'desktop' ? {} : { marginBottom: 1 }) }
  return el('Box', frame, [
    el('Text', {}, [el('Text', { color: ACCENT }, ['✦ ']), el('Text', {}, [line])]),
    el('Box', { key: 'sidekick-sug-buttons', flexDirection: 'row', flexWrap: 'wrap', columnGap: 3 }, kids),
  ])
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
    const before = await loadSettings($)
    const next = fn(before.tips)
    const patch = cfgPatch(before, { ...before, tips: next })
    // „Nicht mehr fragen“ (0.23.0): gilt hier sofort; geschrieben wird erst nach dem Senden, außerhalb von prompt.submit (`later`),
    // weil Weg 1 die Mod neu lädt (Review K3). Scheitert es, sagt ein Toast warum.
    if (Object.keys(patch).length) {
      applyCfg(patch)
      later($, SUBMIT_DELAY_MS, () => {
        void migrating
          .then(() => writeSettings($, SELF, SETTINGS, patch, lang()))
          .then((r) => {
            if (!r.ok) $.ui.toast(writeNote(r, lang()), { timeoutMs: 10000 })
          })
          .catch(() => {})
      })
    }
    await updateRuntime($, (r) => ({ ...r, tips: { declined: next.declined, restUntil: next.restUntil } }))
  } catch {
    // Beiwerk
  }
}

/** Wie `updateTips`, nur die Zähler von `loop` (Korrektur-Schleife, Ausbau 0.19.0). */
async function updateLoop($: EngineInterface, fn: (l: Loop) => Loop) {
  try {
    const before = await loadSettings($)
    const next = fn(before.loop)
    await updateRuntime($, (r) => ({ ...r, loop: { declined: next.declined, restUntil: next.restUntil } }))
  } catch {
    // Beiwerk
  }
}

/**
 * Frage der Korrektur-Schleife (Ausbau 0.19.0, Verhalten 2) vor dem Senden. Gibt zurück, was mit der Nachricht geschieht: `send`
 * unverändert, `nudge` mit Denkanstoß als `context`, `new` neuer Chat mit Übergabe (der Aufrufer startet ihn). Geschlossen: `send`.
 */
async function askLoop($: EngineInterface, c: Check, resendable: boolean, base: number, now: number): Promise<LoopChoice> {
  const x = t()
  ses.korrAsked = true
  saveSes($, now)
  const big = c.ctx >= settings.threshold || c.cold
  const list = loopChoices({ big, resendable })
  const lbl = (ch: LoopChoice) => (ch === 'new' ? x.newChat : ch === 'nudge' ? x.loopNudge : x.loopSend)
  const options = list.map((ch, i) => lbl(ch) + (i === 0 ? x.recommended : ''))
  const parts = [x.loopQuestion]
  // Im großen Chat mit Kosten wie bei der Neuer-Chat-Frage
  if (big && resendable) parts.push(x.optNew(x.newChat, usdText(handoffEstimate(c.ctx * 4, base, c.model, c.ttl))))
  // /rewind öffnet eine Auswahl und hat keinen Knopf (logic.ts NO_BUTTON): nur als Hinweis
  parts.push(x.loopRewind, x.howNext)
  bookDay($, now, (d) => countHint(d, 'schleife', 'gezeigt'))
  buddy($, 'stop')
  let answer = ''
  try {
    answer = await $.ui.ask(parts.join('\n\n'), { options, header: HEADER })
  } catch {
    buddy($, null)
    bookDay($, now, (d) => countHint(d, 'schleife', 'abgebrochen'))
    return 'send'
  }
  buddy($, null)
  const plain = answer.endsWith(x.recommended) ? answer.slice(0, -x.recommended.length) : answer
  // Frei getippter Text (Feld „Other“): unverändert senden, ignoriert, aber nicht als „Unverändert senden“ gezählt (wie 0.18.0 K5)
  const ch = list.find((y) => lbl(y) === plain) ?? null
  if (ch === 'new' || ch === 'nudge') {
    bookDay($, now, (d) => {
      countHint(d, 'schleife', 'angenommen')
      if (ch === 'nudge') d.schleife.denkanstoss += 1
    })
    await updateLoop($, (l) => ({ ...l, declined: 0 }))
    return ch
  }
  bookDay($, now, (d) => countHint(d, 'schleife', 'ignoriert'))
  if (ch !== 'send') return 'send'
  // Dreimal hintereinander „Unverändert senden“: 7 Tage Ruhe, ein Toast sagt es einmal (Nicht nerven)
  let rest = false
  await updateLoop($, (l) => {
    const declined = l.declined + 1
    rest = declined >= 3
    return { ...l, declined: rest ? 0 : declined, restUntil: rest ? now + 7 * DAY_MS : l.restUntil }
  })
  if (rest) $.ui.toast(x.loopRests, { timeoutMs: 10000 })
  return 'send'
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
  buddy($, 'stop', 'model')
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
  await loadSettings($)
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
  await loadSettings($)
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
  await loadSettings($)
  if (settings.level !== 'guide' || !settings.tips.auto) return ''
  await bindSession($)
  if (ses.leitsatz || !isPricey(await mainModel($))) return ''
  ses.leitsatz = true
  saveSes($, await $.clock.now())
  return t().leitsatz
}

/** `/sidekick tips …` (Konfiguration): Schalter, `stop` beendet den Tipp dieses Chats, sonst der Stand. */
async function tipsCommand($: EngineInterface, rest: string): Promise<string> {
  await loadSettings($)
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
    // Schalter nach userConfig, Zähler und Ruhe (`tips on` beendet sie) nach `runtime`
    const before = settings
    if (r.tips.declined !== before.tips.declined || r.tips.restUntil !== before.tips.restUntil) {
      await updateRuntime($, (y) => ({ ...y, tips: { declined: r.tips.declined, restUntil: r.tips.restUntil } }))
    }
    const patch = cfgPatch(before, { ...before, tips: r.tips })
    if (Object.keys(patch).length) {
      const w = await writeCfg($, patch)
      if (!w.ok) return writeNote(w, lang())
      said = [said, writeNote(w, lang())].filter(Boolean).join('\n')
    }
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

/** `/sidekick loop [status|on|off]` (Ausbau 0.19.0): Rückmeldung wie bei `tips` (0.18.1), Stand und Serie dieses Chats. */
async function loopCommand($: EngineInterface, rest: string): Promise<string> {
  await loadSettings($)
  const x = t()
  const now = await $.clock.now()
  const r = applyLoop(settings.loop, rest, now)
  if (!r) return x.loopUnknown(rest.trim())
  await bindSession($)
  let said = r.form === 'on' || r.form === 'off' ? (r.changed ? x.loopNow(r.form === 'on') : x.loopAlready(r.form === 'on')) : ''
  if (r.changed) {
    // Schalter nach userConfig, Zähler und Ruhe (`loop on` beendet sie) nach `runtime`
    const before = settings
    if (r.loop.declined !== before.loop.declined || r.loop.restUntil !== before.loop.restUntil) {
      await updateRuntime($, (y) => ({ ...y, loop: { declined: r.loop.declined, restUntil: r.loop.restUntil } }))
    }
    const patch = cfgPatch(before, { ...before, loop: r.loop })
    if (Object.keys(patch).length) {
      const w = await writeCfg($, patch)
      if (!w.ok) return writeNote(w, lang())
      said = [said, writeNote(w, lang())].filter(Boolean).join('\n')
    }
  }
  const l = settings.loop
  const out = [...(said ? [said, ''] : []), x.loopTitle, '', x.loopState(l.on, now < l.restUntil ? x.tipsResting(shortDate(l.restUntil)) : ''), '', x.loopSeries(ses.korr)]
  if (settings.level !== 'guide') out.push('', x.loopLevel(x.level[settings.level]))
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
  if (text.trim().startsWith('/') || isHostNote(text)) return
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
  const box = await readBox($).catch(() => null)
  if (box && box.text.trim()) {
    $.ui.toast(x.noteBoxFull, { timeoutMs: 8000 })
    return false
  }
  // `append`: tippt der Nutzer zwischen read und fill, bleibt sein Text stehen; bei leerem Feld dasselbe wie `replace` (Review K2)
  const next = afterFill(await fillBox($, `${x.noteChatText(n.titel, n.thema)}\n\n`, 'append'))
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
  await loadSettings($)
  await bindSession($)
  const now = await $.clock.now()
  const hs = await loadHints($)
  const known = cleanTopics(await $.store.get('notes:known')).length
  const source = settings.ttl ? 'set' : mem.ttlSource === 'gemessen' ? 'measured' : 'default'
  const list = await loadSaved($).catch(() => saved)
  const data = sidekickHelp({ settings, ttl: { min: ttlOf(mem, settings.ttl), source }, hints: { on: hs.on, off: hs.off }, known, now, prompts: { n: list.length, buttons: buttonNames(list).length }, cfg })
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
  await loadSettings($)
  let note = ''
  if (a === 'on' || a === 'off') {
    const patch = cfgPatch(settings, { ...settings, notes: a === 'on' })
    if (Object.keys(patch).length) {
      const w = await writeCfg($, patch)
      note = writeNote(w, lang())
      if (!w.ok) return note
    }
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
  const status = t().notesStatus(settings.notes, known, settings.level === 'off')
  return note ? `${note}\n\n${status}` : status
}

/** Eine Anfrage der Hauptschleife: Cache-Messung wie limit-bars, Kaltstarts ohne Rückfrage, offene Ersparnis-Buchung. */
async function afterStep($: EngineInterface, u: StepUsage, startedAt: number) {
  await bindSession($)
  const total = totalInput(u)
  // Deutlich geschrumpfter Kontext gilt als Kompaktierung, nicht als Kaltstart (auch nach `/rewind`). Seit 0.19.0 meldet zusätzlich
  // `session.compact` die Compaction (B2): Die erste Anfrage danach lag in S2 bei 0,57 der alten Größe, knapp unter der Grenze
  const shrunk = ses.afterCompact || (mem.ctx > 0 && total < 0.6 * mem.ctx)
  if (ses.afterCompact) {
    ses.afterCompact = false
    saveSes($, startedAt)
  }
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
  // Die letzte Übergabe bis 0.21.3 (`handoff:last`) zieht einmal in die Liste `handoffs` (Ausbau 0.22.0)
  if (keys.includes('handoff:last')) {
    await $.store.set('handoffs', await loadHandoffs($))
    await $.store.delete('handoff:last')
  }
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
  out.push(x.rowLoop(onOff(settings.loop.on)))
  if (mem.ctx) out.push(x.rowCtx(tokensText(mem.ctx), cacheText(st.kind, st.left)))
  out.push('', x.summary(ses.summary), '')
  out.push(x.lastHint(ses.last ? `${hhmm(ses.last.at)} · ${ses.last.line}` : ''), '')
  const h = (await loadHandoffs($))[0]
  if (h) {
    out.push(x.lastHandoff(`${hhmm(h.at)}, ${howLabel(h.method)}`), '', h.text, '')
    if (h.msg) out.push(x.handoffMsg(h.msg), '')
  } else out.push(x.noHandoff, '')
  // Anzeige in der Fußzeile (0.10.1): ob die Engine sie aufruft, wo, und ob das Lesen des Werts scheitert
  const md = (await $.store.get('diag:sessionMode')) as Partial<ModeDiag> | undefined
  out.push(md && typeof md.at === 'number' && typeof md.surface === 'string' ? x.modeSeen(hhmm(md.at), md.surface, typeof md.err === 'string' ? md.err : '') : x.modeNever, '')
  const hs = await loadHints($)
  out.push(x.hintsLine(onOff(hs.on), hs.off.join(', ')), '')
  out.push(x.change(USAGE))
  return out.join('\n')
}

/** `/sidekick hints [on|off|status|<regel> on|off|done <regel>|audit-min <k>]` (SPEC Nachtrag 0.2.0, Verhalten 7). */
async function hintsCommand($: EngineInterface, rest: string): Promise<string> {
  let hs = await loadHints($)
  const r = applyHints(hs, rest, parseTokens)
  if (r?.error) return `${r.error}. ${t().possible(hintsUsage())} · ${t().allCommands}`
  let note = ''
  if (r?.settings) {
    const next = r.settings
    if (next.auditMin < MIN_OF.auditMin) return t().tooSmall(rest.trim(), tokensText(MIN_OF.auditMin))
    // Schalter und Schwelle nach userConfig (0.23.0), die abgeschalteten Regeln bleiben im Store `hints`
    const patch: Values = {}
    if (next.on !== hs.on) patch.maintenanceHints = next.on
    if (next.auditMin !== hs.auditMin) patch.auditMin = next.auditMin
    if (Object.keys(patch).length) {
      const w = await writeCfg($, patch)
      note = writeNote(w, lang())
      if (!w.ok) return note
    }
    // Übrige Felder (Markierung, Werte für Chats mit 0.22.0) bleiben stehen, nur `off` ändert sich
    if (next.off.join() !== hs.off.join()) {
      const raw = await $.store.get('hints')
      await $.store.set('hints', { ...(raw && typeof raw === 'object' ? raw : {}), off: next.off })
    }
    hs = next
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
  const out = m ? hintsStatus(m.m, m.w, hs, m.key, now) : t().hintsNoMeasure(hs.on ? t().on : t().off, hintsUsage())
  return note ? `${note}\n\n${out}` : out
}

// ---------- Gespeicherte Prompts (Nachtrag 0.21.0) ----------

/** Gespeicherte Prompts (`prompts:saved`), frisch gelesen bei session.start, Befehlen und Senden: eine andere Session kann sie geändert haben. */
let saved: Saved[] = []
/** Gesendet, aber noch nicht als Nachricht angekommen: ein zweiter Klick sendet nicht doppelt. */
const sendingNames = new Set<string>()
/** Läuft gerade eine Antwort im Hauptchat? `turn.step` setzt, `turn.complete` (ohne `agentId`) löscht. */
let turnRunning = false
let pChain: Promise<unknown> = Promise.resolve() // `prompts:*` lesen, ändern, schreiben nacheinander
let promptsLast: string | undefined = undefined // zuletzt geschriebene Knopfliste (`sidekick.prompts`)
/** Abstand zwischen dem Befehl `/p <name>` und dem Senden (nach dem Hook, siehe runPrompt). */
const SUBMIT_DELAY_MS = 100

async function loadSaved($: EngineInterface): Promise<Saved[]> {
  saved = cleanSaved(await $.store.get('prompts:saved'))
  return saved
}

/** `prompts:saved` frisch lesen, ändern, schreiben; nacheinander mit allen anderen Änderungen. */
function updateSaved<R>($: EngineInterface, fn: (list: Saved[]) => { list: Saved[]; r: R }): Promise<R> {
  const run = pChain.then(async () => {
    const { list, r } = fn(cleanSaved(await $.store.get('prompts:saved')))
    await $.store.set('prompts:saved', list)
    saved = list
    return r
  })
  pChain = run.catch(() => {})
  return run
}

/**
 * Knopfliste nach `$.state` (nur bei Änderung): der Knopf-Baum liest sie und zeichnet nur dann neu (kein $.ui.invalidate). `later`
 * ist seit 0.25.1 nur noch Anlass zum Neuzeichnen über das Abo; den Zustand nimmt die Zeichnung aus dem Speicher (`laterNow`).
 */
function pushBtns($: EngineInterface) {
  const laterBtn = laterNow()
  const value = { buttons: buttonNames(saved), ...(laterBtn ? { later: laterBtn } : {}) }
  const key = JSON.stringify(value)
  if (key === promptsLast) return
  promptsLast = key
  try {
    $.state.set({ plugin: 'sidekick', key: 'prompts' }, value).catch(() => {
      if (promptsLast === key) promptsLast = undefined
    })
  } catch {
    if (promptsLast === key) promptsLast = undefined
  }
}

/**
 * Den festen Befehl `/p` anmelden; der Hinweis dahinter nennt die gespeicherten Namen. „Registering a name again replaces it“
 * (types@2.1.319:3250-3257): nach Speichern und Löschen neu, damit das Menü die aktuellen Namen zeigt.
 */
async function registerPrompts($: EngineInterface) {
  try {
    await $.command.register({ name: P_CMD, description: t().pr.cmdP, argumentHint: pHint(saved) })
  } catch {
    // ohne /p; die Knöpfe senden trotzdem
  }
}

/**
 * Einen gespeicherten Prompt senden: `$.prompt.submit({ text, asUser: true })`, als Nachricht des Nutzers ohne Plugin-Rahmen
 * (types@2.1.319:9699-9711). Ein Plugin-Prompt läuft, sobald die Session frei ist (types@2.1.319:9694-9697), also während einer
 * Antwort danach. Nicht abgewartet (Review 0.13.0 S1).
 * Rückgabe: der Text für die Befehlsausgabe; ein Knopf zeigt ihn als Toast.
 */
async function runPrompt($: EngineInterface, name: string, via: 'cmd' | 'button'): Promise<string> {
  const x = t().pr
  await loadSettings($)
  if (settings.level === 'off') return x.offLevel
  // In `-p` ist keine Session gebunden: „$.prompt.submit is not available in this mode“ (Smoke-Test 2026-11-06); dort ist `surfaces()` leer
  if (!(await $.session.surfaces()).length) return x.noSession(name)
  const p = (await loadSaved($)).find((s) => s.name === name)
  if (!p) return x.unknownName(name)
  if (sendingNames.has(name)) return x.already(name)
  sendingNames.add(name)
  const busyNowTurn = turnRunning
  const done = () => sendingNames.delete(name)
  const fire = () => {
    try {
      asUser($, p.text)
        .then((r) => {
          done()
          if (r && 'drop' in r && typeof r.drop === 'string') $.ui.toast(x.submitFailed(name, cut(r.drop, 140)), { timeoutMs: 10000 })
        })
        .catch((err) => {
          done()
          $.ui.toast(x.submitFailed(name, msg(err)), { timeoutMs: 10000 })
        })
    } catch (err) {
      done()
      $.ui.toast(x.submitFailed(name, msg(err)), { timeoutMs: 10000 })
    }
  }
  try {
    await bindSession($)
    bookDay($, await $.clock.now(), (d) => countPrompt(d, 'gesendet'))
  } catch {
    // Beiwerk
  }
  // Aus einem `command.run`-Hook lehnt die Engine den Aufruf ab („it would wait on the turn this hook is holding; submit from a later
  // event“, Test 2026-11-06): erst nach dem Befehl über einen einmaligen Timer, als letzter Schritt des Hooks (Review 0.21.0 K3).
  // Ein Knopf ist kein Hook und sendet sofort.
  try {
    if (via === 'cmd') later($, SUBMIT_DELAY_MS, fire)
    else fire()
  } catch (err) {
    done()
    return x.submitFailed(name, msg(err))
  }
  // Ein Befehl läuft ohnehin erst nach der Antwort (ohne `immediate`, types@2.1.319:1944-1952); ein Knopf sagt es per Toast
  if (busyNowTurn && via === 'button') return x.queued(name)
  return x.sent(name)
}

/** Letzte eigene Nachricht dieses Chats, ohne Befehle und Host-Texte; leer, wenn es keine gibt. */
function lastOwnText(msgs: readonly { role: string; text?: string }[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!
    const text = typeof m.text === 'string' ? stripLeadReminders(m.text).trim() : ''
    if (m.role !== 'user' || !text || isHostNote(text) || text.startsWith('/') || text.startsWith('<command-')) continue
    return text
  }
  return ''
}

/** Text zur Ablehnung eines Namens. */
function nameRefusal(c: Extract<NameCheck, { ok: false }>): string {
  const x = t().pr
  return c.why === 'invalid' ? x.nameInvalid(c.name, c.suggest) : x.nameOwn(c.name, c.suggest)
}

/**
 * Einen Prompt speichern (manuell oder aus dem Angebot), anmelden und die Knöpfe neu schreiben. `overwrite`: ein eigener Name wird
 * ersetzt (manuell); beim Angebot nicht.
 */
async function savePrompt($: EngineInterface, raw: string, text: string, from: 'auto' | 'manual'): Promise<{ ok: true; name: string; replaced: boolean; button: boolean } | { ok: false; text: string }> {
  const x = t().pr
  await loadSaved($)
  const c = checkName(raw, saved.map((s) => s.name), from === 'manual')
  if (!c.ok) return { ok: false, text: nameRefusal(c) }
  const now = await $.clock.now()
  const u = await updateSaved($, (list) => {
    const r = upsert(list, { name: c.name, text: text.trim().slice(0, TEXT_MAX * 4), button: true, at: now, from })
    return { list: r.list, r }
  })
  if (u.kind === 'full') return { ok: false, text: x.full(SAVED_MAX) }
  await registerPrompts($)
  pushBtns($)
  try {
    await bindSession($)
    bookDay($, now, (d) => countPrompt(d, 'gespeichert'))
  } catch {
    // Beiwerk
  }
  return { ok: true, name: c.name, replaced: u.kind === 'replaced', button: buttonNames(saved).includes(c.name) }
}

// Die letzten `/sidekick prompts`-Listen (höchstens 10), über die Kennung gefunden wie bei /savings
const promptLists = new Map<string, Saved[]>()
let promptListNo = 0

/** Markdown von `/sidekick prompts`: Tabelle ohne `|` in den Zellen (Fix 0.18.1), dazu die Befehle. */
function promptsMarkdown(list: readonly Saved[], tag: string): string {
  const x = t().pr
  if (!list.length) return x.listEmpty
  const shown = new Set(buttonNames(list))
  const rows = list.map((s) => `| \`/${cmdOf(s.name)}\` | ${mdCell(preview(s.text, 60))} | ${s.button ? (shown.has(s.name) ? x.on : `${x.on} (5+)`) : x.off} |`)
  return [`${x.listHead(list.length, SAVED_MAX)}${tag ? ` · ${tag}` : ''}`, '', x.listCols, '|---|---|---|', ...rows, '', x.listFoot].join('\n')
}

/** `/sidekick save …`, `/sidekick prompts …`, `/sidekick forget …`. */
async function promptsCommand($: EngineInterface, args: string, messages?: () => Promise<readonly { role: string; text?: string }[]>): Promise<string> {
  const x = t().pr
  const [verb = '', name = '', ...rest] = args.trim().split(/\s+/)
  const v = verb.toLowerCase()
  if (v === 'save') {
    if (!name) return x.saveUsage
    // Der Text nach dem Namen unverändert (Zeilenumbrüche bleiben)
    const after = args.trim().replace(/^\S+\s+\S+\s*/, '')
    const text = after || (messages ? lastOwnText(await messages()) : '')
    if (!text) return x.noLast
    const r = await savePrompt($, name, text, 'manual')
    return r.ok ? x.savedCmd(r.name, r.replaced, r.button) : r.text
  }
  if (v === 'forget') {
    if (!name) return x.unknownName('')
    const n = normName(name)
    const had = await updateSaved($, (list) => ({ list: list.filter((s) => s.name !== n), r: list.some((s) => s.name === n) }))
    if (!had) return x.unknownName(n)
    pushBtns($)
    await registerPrompts($)
    return x.forgotten(n)
  }
  // prompts [name [on|off]]
  const list = await loadSaved($)
  pushBtns($)
  if (!name) {
    const now = await $.clock.now()
    const tag = list.length ? `#${(++promptListNo).toString(36)}${now.toString(36).slice(-5)}` : ''
    if (tag) {
      promptLists.set(tag, list)
      while (promptLists.size > 10) promptLists.delete(promptLists.keys().next().value as string)
    }
    return promptsMarkdown(list, tag)
  }
  const n = normName(name)
  const p = list.find((s) => s.name === n)
  if (!p) return x.unknownName(n)
  const sw = (rest[0] ?? '').toLowerCase()
  if (sw === 'on' || sw === 'off') {
    await setButton($, n, sw === 'on')
    return x.buttonSet(n, sw === 'on', buttonNames(saved).includes(n))
  }
  return [x.detail(p.name, p.button, p.from), '', '```text', p.text, '```'].join('\n')
}

/** Eigene Nachrichten mit ihrer ID aus `UserMessage` (das Angebot kommt erst nach dem Senden und sucht dann seine Nachricht). */
let ownRendered: { id: string; text: string }[] = []
/** Ein Angebot, das auf die nächste eigene Nachricht wartet (die eigene hatte schon eine Zeile oder wurde nicht gezeichnet). */
let offerWait: (Offer & { forText?: string }) | null = null

/**
 * Wie die Erkennung Gruppen bildet (SPEC „Bau 0.21.0“, Probe): `words` über die Wortmenge (Vorfilter der SPEC), `intent` über eine
 * Absicht je Nachricht, die Haiku vergibt (Variante B).
 */
const DETECT: 'words' | 'intent' = 'intent'
/** Absicht-Aufrufe je Tag (Variante B); die Vorschlags-Aufrufe begrenzt `HAIKU_PER_DAY` aus prompts.ts. */
const INTENT_PER_DAY = 80
/** Haiku für Absicht und Vorschlag: das `CHECK`-Modell, effort low (Probe), kurze Ausgabe, 8 s. */
const PROPOSE = { model: CHECK.model, effort: 'low', maxTokens: 1200, timeoutMs: 8000 } as const
const INTENT = { model: CHECK.model, effort: 'low', maxTokens: 600, timeoutMs: 8000 } as const

/** Ein Haiku-Aufruf der Erkennung, gebucht unter der Rolle `prompts`; ohne Antwort ''. */
// Auch das Urteil der Warteschlange (Ausbau 0.24.0, `QUEUE`, eigene Buchung über `book`, Abbruch über `signal`)
async function haiku(
  $: EngineInterface,
  spec: typeof PROPOSE | typeof INTENT | typeof QUEUE | typeof CATALOG_SPEC,
  system: string,
  prompt: string,
  o: { signal?: AbortSignal; book?: typeof bookPrompts } = {},
): Promise<string> {
  const t0 = await $.clock.now()
  const r = await $.model.complete({ ...spec, system, prompt }, o.signal ? { signal: o.signal } : undefined)
  const ms = (await $.clock.now()) - t0
  // `usage` kommt auf jedem Arm, auch bei Abbruch (types:6131): immer buchen
  const usd = completeCost(r.usage as CompleteUsage, spec.model)
  const book = o.book ?? bookPrompts
  bookDay($, t0, (d) => book(d, spec.model, usd, ms, r.usage as CompleteUsage))
  return r.isAnswered ? r.text : ''
}

/** Tagesgrenze `prompts:budget` (bzw. `prompts:budget-intent`) prüfen und einen Aufruf verbuchen; false: heute keiner mehr. */
async function takeBudget($: EngineInterface, key: string, max: number, now: number): Promise<boolean> {
  const day = dayKey(now)
  // Nacheinander mit den anderen `prompts:*`-Änderungen dieser Session (Review 0.21.0 K5); zwischen Sessions bleibt der Store nicht atomar
  const run = pChain.then(async () => {
    const b = cleanBudget(await $.store.get(key))
    if ((b.day === day ? b.n : 0) >= max) return false
    await $.store.set(key, useBudget(b, day))
    return true
  })
  pChain = run.catch(() => {})
  return run
}

/**
 * Merken und Erkennen (Nachtrag 0.21.0), ganz im Hintergrund: prompt.submit wartet nicht darauf, Fehler werden verschluckt.
 * Nur eigene getippte Nachrichten in der Stufe Begleiter, nicht in `-p` (dort ist `surfaces()` leer, isOwn).
 */
async function rememberPrompt($: EngineInterface, text: string, kind: string) {
  if (!remembers(text, kind) || isHostNote(text)) return
  const st = await loadSettings($)
  if (st.level !== 'guide') return
  // In `-p` tragen Nachrichten `sdk` ohne Desktop-Oberfläche: isOwn ist dann false
  if (!(await isOwn($, kind))) return
  await bindSession($)
  const sid = sessionId
  if (!sid) return
  const now = await $.clock.now()
  const entry = recentOf(text, sid, now)
  const de = lang()
  // Variante B: erst die Absicht (mit den bekannten), dann merken
  if (DETECT === 'intent') {
    const list = cleanRecent(await $.store.get('prompts:recent'), now)
    if (!(await takeBudget($, 'prompts:budget-intent', INTENT_PER_DAY, now))) return
    const intent = parseIntent(await haiku($, INTENT, intentSystem(de), intentPrompt(text, knownIntents(list), de)))
    if (!intent) return // einmalig: nicht gemerkt
    entry.intent = intent
  }
  const list = await new Promise<PromptRecent[]>((resolve, reject) => {
    pChain = pChain
      .then(async () => {
        const l = cleanRecent(await $.store.get('prompts:recent'), now)
        // Im Modus `intent` liest niemand die gespeicherte Wortmenge (Review 0.21.0 K5): Platz im Store sparen
        const kept = DETECT === 'intent' ? { ...entry, words: [] } : entry
        await $.store.set('prompts:recent', addPromptRecent(l, kept, now))
        resolve(l)
      })
      .catch(reject)
  })
  const seen = seenSet(cleanSeen(await $.store.get('prompts:seen')))
  const group = DETECT === 'intent' ? intentGroup(list, entry, seen) : candidates(list, entry, seen)
  if (!group) return
  const own = await loadSaved($)
  if (nearSaved(own, entry.words)) return
  if (!(await takeBudget($, 'prompts:budget', HAIKU_PER_DAY, now))) return
  const p = parseProposal(await haiku($, PROPOSE, proposeSystem(de), proposePrompt(group, de)))
  const ids = group.map((g) => g.id)
  if (!p) {
    markSeen($, ids)
    return
  }
  // Den Namen prüfen wie beim Speichern; belegt: der freie Vorschlag
  const c = checkName(p.name, own.map((s) => s.name), false)
  const name = c.ok ? c.name : c.suggest
  if (!name) return
  await bindSession($)
  bookDay($, now, (d) => countPrompt(d, 'angeboten'))
  deliverOffer($, { name, text: p.text, ids }, text)
}

/**
 * Das Angebot unter die Nachricht, aus der es kam: nur wenn sie schon gezeichnet ist und noch keine eigene Zeile hat. Sonst wartet es
 * auf die nächste eigene Nachricht (Prüf-Zeile darunter, offene Rückfrage, nicht gesendet).
 */
function deliverOffer($: EngineInterface, offer: Offer, srcText: string) {
  const r = ownRendered.find((x) => x.text === srcText.trim())
  if (r && !ses.hints.some((h) => h.id === r.id)) {
    ses.hints = [...ses.hints, { id: r.id, line: t().pr.offerLine(offer.name), offer }].slice(-30)
    $.clock
      .now()
      .then((now) => saveSes($, now))
      .catch(() => {})
    $.ui.invalidate('ui.render')
    return
  }
  offerWait = { ...offer }
}

/** Gruppe in `prompts:seen` merken: verneint, abgelehnt oder gespeichert löst sie keinen Aufruf mehr aus. */
function markSeen($: EngineInterface, ids: readonly string[]) {
  if (!ids.length) return
  pChain = pChain
    .then(async () => $.store.set('prompts:seen', addSeen(cleanSeen(await $.store.get('prompts:seen')), ids)))
    .catch(() => {})
}

/** Knopf am Angebot: Speichern legt Prompt und Befehl an (Toast), Nein merkt die Gruppe als abgelehnt. */
async function answerOffer($: EngineInterface, id: string, yes: boolean) {
  const h = ses.hints.find((x) => x.id === id)
  if (!h?.offer || h.offerDone || pressing.has(id)) return
  const of = h.offer
  pressing.add(id)
  $.ui.invalidate('ui.render')
  try {
    const now = await $.clock.now()
    if (yes) {
      const r = await savePrompt($, of.name, of.text, 'auto')
      if (!r.ok) {
        $.ui.toast(r.text, { timeoutMs: 15000 })
        return
      }
      $.ui.toast(t().pr.savedToast(r.name, r.replaced), { timeoutMs: 10000 })
      if (r.name !== of.name) h.offer = { ...of, name: r.name }
    } else bookDay($, now, (d) => countPrompt(d, 'abgelehnt'))
    markSeen($, of.ids)
    h.offerDone = yes ? 'saved' : 'no'
    saveSes($, now)
  } catch (err) {
    $.ui.toast(t().pr.submitFailed(of.name, msg(err)), { timeoutMs: 10000 })
  } finally {
    pressing.delete(id)
    $.ui.invalidate('ui.render')
  }
}

/**
 * Wo die Prompt-Knöpfe stehen (Phase-0-Probe, SPEC „Bau 0.21.0“, Lage 0.21.1): `footer` im eigenen SessionMode-Baum des
 * Desktops links vor dem ●-Label. Ein linker Rand der Fußzeile ließ sich über SessionMode nicht erreichen: der Desktop setzt den Baum
 * als festen Block rechts in die Fußzeile (Befund 0.21.1 und 0.21.2, Fynn 2026-11-07). `band` als Zeile unten in sidekicks AbovePrompt-Ebene.
 */
const BUTTON_PLACE: 'footer' | 'band' = 'footer'

/** Ein Knopf: senden; ein Toast nur, wenn es nicht gleich losgeht oder nicht geht (das Senden selbst sieht man im Chat). */
async function pressPrompt($: EngineInterface, name: string) {
  try {
    const r = await runPrompt($, name, 'button')
    if (r !== t().pr.sent(name)) $.ui.toast(r, { timeoutMs: 8000 })
  } catch (err) {
    $.ui.toast(t().pr.submitFailed(name, msg(err)), { timeoutMs: 10000 })
  }
}

/**
 * Die Knöpfe aus `sidekick.prompts`: Das Lesen abonniert den Wert, der Baum zeichnet also nur neu, wenn sich die Liste ändert
 * (kein $.ui.invalidate; tune-strip Nachtrag 0.10.0, mods/clawd-buddy/SPEC.md:278). Stufe Aus: keine. „Danach“ seit 0.25.1 aus dem Speicher.
 */
async function promptButtons($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]): Promise<RenderNode[]> {
  if (settings.level === 'off') return []
  let names = buttonNames(saved)
  try {
    const { value } = await $.state.get({ plugin: 'sidekick', key: 'prompts' })
    if (value && Array.isArray(value.buttons)) names = value.buttons
  } catch {
    // ohne Abo: die Liste im Speicher
  }
  // Patch 0.25.1: Zustand von „Danach“ aus dem Speicher, `get` oben nur fürs Abo. Im Desktop verschwand der Knopf nach dem zweiten
  // Klick (Fynns Sicht-Check 2026-11-09): las die Zeichnung nach `$.ui.invalidate` einen Stand ohne `later` (oder warf `get`), kam
  // er nicht zurück, weil danach nichts mehr geschrieben wurde
  const laterState = laterNow()
  if (!names.length && !laterState) return []
  const ui = $.ui.resolve(e)
  // Warteschlange (Ausbau 0.24.0): „Danach“ links vor den Prompt-Knöpfen, nur während einer Runde
  // Zustand als Text (0.24.2): „Danach“ → „Danach ✓“. Die Farbe der `Text`-Kinder (0.24.0) zeigte der native Knopf im Desktop nicht
  // (Fynns Sicht-Check 2026-11-09: „bleibt immer bei derselben Farbe“)
  const first = laterState ? [ui.Button({ key: 'sidekick-later', label: t().q.btn(laterState === 'armed'), onPress: () => void pressLater($) }) as RenderNode] : []
  return [...first, ...names.map((n) => ui.Button({ key: `sidekick-p-${n}`, label: buttonLabel(n), dimColor: true, onPress: () => void pressPrompt($, n) }) as RenderNode)]
}

/**
 * `/sidekick prompts` gezeichnet: je Prompt Name, Anfang des Texts und die Knöpfe Senden, Knopf an/aus, Löschen. Die Zeilen folgen
 * dem aktuellen Stand (`saved`); ein in dieser Ausgabe gelöschter Prompt steht als „gelöscht“ da. Nach einem Klick zeichnet ein
 * einmaliges $.ui.invalidate die Ausgabe neu (Klick des Nutzers, kein Takt).
 */
function promptsTree($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], snap: readonly Saved[]): RenderElement {
  const x = t().pr
  const ui = $.ui.resolve(e)
  const Button = (p: { key: string; label: string; onPress: () => void }) => ui.Button(p) as RenderNode
  const shown = new Set(buttonNames(saved))
  const after = (fn: () => Promise<unknown>) => () =>
    void fn()
      .catch((err) => $.ui.toast(msg(err), { timeoutMs: 8000 }))
      .then(() => $.ui.invalidate('ui.render'))
  const rows: RenderNode[] = snap.map((s0) => {
    const s = saved.find((y) => y.name === s0.name)
    // Breite nach dem Platz (Review 0.21.0 K3): ein Drittel der Spalten, höchstens 26
    const cols = typeof e.viewport?.columns === 'number' ? e.viewport.columns : 100
    const name = el('Box', { width: Math.max(10, Math.min(26, Math.floor(cols / 3))), flexShrink: 0 }, [el('Text', { color: ACCENT }, [`/${cmdOf(s0.name)}`])])
    if (!s) return el('Box', { key: `sidekick-pr-${s0.name}`, flexDirection: 'row' }, [name, el('Text', { dimColor: true }, [x.deleted(s0.name).split('.')[0] ?? ''])])
    const state = s.button ? (shown.has(s.name) ? x.on : `${x.on} (5+)`) : x.off
    return el('Box', { key: `sidekick-pr-${s.name}`, flexDirection: 'column' }, [
      el('Box', { flexDirection: 'row', columnGap: 1, flexWrap: 'wrap' }, [
        name,
        Button({ key: `sidekick-pr-send-${s.name}`, label: x.btnSend, onPress: () => void pressPrompt($, s.name) }),
        Button({ key: `sidekick-pr-btn-${s.name}`, label: s.button ? x.btnButtonOff : x.btnButtonOn, onPress: after(() => setButton($, s.name, !s.button)) }),
        Button({ key: `sidekick-pr-del-${s.name}`, label: x.btnDelete, onPress: after(() => promptsCommand($, `forget ${s.name}`)) }),
        el('Text', { dimColor: true }, [`${t().pr.listCols.split('|')[3]?.trim() ?? ''}: ${state}`]),
      ]),
      el('Box', { paddingLeft: 2 }, [el('Text', { dimColor: true }, [preview(s.text, 90)])]),
    ])
  })
  return el('Box', { key: 'sidekick-prompts-list', flexDirection: 'column', rowGap: 0 }, [
    el('Text', { bold: true }, [x.listHead(saved.length, SAVED_MAX).replace(/\*\*/g, '')]),
    ...rows,
    el('Box', { marginTop: 1 }, [el('Text', { dimColor: true }, [x.listFoot.replace(/`/g, '')])]),
  ])
}

async function setButton($: EngineInterface, name: string, on: boolean) {
  await updateSaved($, (list) => ({ list: list.map((s) => (s.name === name ? { ...s, button: on } : s)), r: null }))
  pushBtns($)
}

// ---- Warteschlange (Ausbau 0.24.0; Entscheidung Fynn 2026-11-08: Variante B „durchlassen mit Hinweis“). Schreibt der Nutzer, während
// Claude arbeitet, und ist die Nachricht klar ein eigener, späterer Punkt, geht sie wie bisher sofort in die laufende Runde, dazu bekommt
// Claude unsichtbar einen Hinweis (`context`, types@2.1.319:9800-9808) und unter der Blase steht sidekicks graue Zeile. Nichts wird
// zurückgehalten: kein `{ drop }`, keine rote Warnung der App, keine doppelte Blase (Probe P1, SPEC „Bau 0.24.0“). Reine Logik in queue.ts.

// ---- Skill-Katalog (Ausbau 0.25.0). Passt ein Eintrag aus hooks/catalog.ts zur Nachricht, schlägt sidekick ihn einmal je Chat vor:
// mitgeliefert → Rückfrage „Mit … senden“ (der Skill-Text geht als `context` mit, kein `{ drop }`, Probe P1 Weg B); Verweis → Rückfrage
// „Befehl kopieren, Nachricht zurückhalten“; schwer → nur eine Zeile unter der Nachricht. sidekick installiert nie selbst (E4).

/** Stumm geschaltete Einträge, für alle Chats (`catalog:muted`). */
async function loadMuted($: EngineInterface): Promise<string[]> {
  const v = await $.store.get('catalog:muted')
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!byId(x)) : []
}
async function setMuted($: EngineInterface, id: string, on: boolean) {
  const list = (await loadMuted($)).filter((x) => x !== id)
  await $.store.set('catalog:muted', on ? [...list, id] : list)
}

/**
 * Vorfilter (Verhalten 1): nur eigene getippte Nachrichten in Ruhe (keine laufende Runde, kein `wait`, nicht vom Plugin, nicht `-p`),
 * Stufe Begleiter, Einstellung `catalog` an. Ohne Stichwort-Treffer kein weiterer Aufruf. Nach einer Katalog-Rückfrage in den letzten
 * `CATALOG_GAP` eigenen Nachrichten bleiben nur Einträge, die bloß eine Zeile bekommen.
 */
async function catalogCands($: EngineInterface, e: { origin: { kind: string }; turnId?: string; wait: boolean }, typed: string): Promise<CatalogEntry[]> {
  if (e.origin.kind === 'plugin' || e.turnId || e.wait) return []
  await loadSettings($)
  if (settings.level !== 'guide' || cfg.catalog === false) return []
  if (!typed.trim() || isHostNote(typed)) return []
  // Erst ohne Befehlsliste: ohne Stichwort kein Lesen von Store und Befehlen
  if (!findCandidates(typed, { cmds: [], muted: [], offered: [] }).length) return []
  if (!(await isOwn($, e.origin.kind))) return []
  await bindSession($)
  const { cmds } = await loadBase($, await $.clock.now())
  const list = findCandidates(typed, { cmds, muted: await loadMuted($), offered: ses.catOffered })
  return gapOk(ses.own + 1, ses.catAsk) ? list : list.filter((c) => catalogKind(c) === 'line')
}

type CatAct = { act: 'skill' | 'copy' | 'send' | 'mute' | 'line'; c: CatalogEntry; grund: string }

/**
 * Urteil und Rückfrage (Verhalten 2 und 3). `kat`: Urteil der Prüfung, wenn sie die Kandidaten mitnahm; sonst ein eigener Haiku-Aufruf
 * (`CATALOG`). Fehler, Timeout, ungültig, unter der Schwelle → null (durch). Geschlossener Dialog → senden.
 */
async function catalogStep($: EngineInterface, typed: string, cands: readonly CatalogEntry[], kat: CatalogVerdict | null | undefined, signal: AbortSignal): Promise<CatAct | null> {
  if (!cands.length) return null
  const v = kat !== undefined ? kat : parseCatalog(await haiku($, CATALOG_SPEC, catalogSystem(), catalogPrompt({ text: typed, summary: ses.summary, cands }), { signal, book: bookCatalog }), cands.map((c) => c.id))
  const c = catalogPick(v, cands)
  if (!c || !v) return null
  const grund = v.grund
  const kind = catalogKind(c)
  const now = await $.clock.now()
  // Angeboten: in diesem Chat kein zweites Mal
  ses.catOffered = [...ses.catOffered, c.id]
  bookDay($, now, (d) => {
    countCatalog(d, 'angeboten')
    if (kind === 'line') countCatalog(d, 'zeile')
  })
  if (kind === 'line') {
    saveSes($, now)
    return { act: 'line', c, grund }
  }
  ses.catAsk = ses.own
  saveSes($, now)
  const x = t().cat
  const rec = t().recommended
  const first = kind === 'skill' ? x.optWith(c.name) : x.optCopy
  // Kontext, den der Skill kostet (Planungs-Chat 2026-11-09); bei Verweisen das Risiko (Review 0.25.0 S3)
  const question = kind === 'skill' ? x.askBundled(c.name, c.author, c.license, grund, tokensText(c.ctxTokens ?? 0)) : x.askRef(c.name, c.author, c.license, c.risk.note?.[lang()] ?? '', grund)
  let answer = ''
  try {
    answer = await $.ui.ask(question, { options: [first + rec, x.optSend, x.optMute], header: x.header })
  } catch {
    // Geschlossen oder niemand zu fragen: so senden, wie getippt
    return { act: 'send', c, grund }
  }
  const a = answer.endsWith(rec) ? answer.slice(0, -rec.length) : answer
  if (a === first) return { act: kind, c, grund }
  if (a === x.optMute) {
    await setMuted($, c.id, true)
    bookDay($, now, (d) => countCatalog(d, 'stumm'))
    return { act: 'mute', c, grund }
  }
  bookDay($, now, (d) => countCatalog(d, 'trotzdem'))
  return { act: 'send', c, grund }
}

const catLists = new Map<string, { on: boolean; guide: boolean; cmds: readonly { name: string; plugin?: string }[]; muted: string[] }>()
let catListNo = 0

/** Was der Knopf „Befehl kopieren“ kopiert: die Installationszeile bzw. bei mitgelieferten der Befehl, der den Skill startet. */
const copyLine = (c: CatalogEntry) => c.install?.line ?? (c.invoke ? `/${c.invoke}` : '')

function catalogState(c: CatalogEntry, cmds: readonly { name: string; plugin?: string }[], muted: readonly string[]): string {
  const x = t().cat
  if (c.way === 'reference' && isInstalled(c, cmds)) return x.installed
  return muted.includes(c.id) ? x.mutedState : x.active
}
/** Weg mit Risiko (Review 0.25.0 S3): mitgeliefert; Verweis mit der Notiz; schwer zusätzlich „nur Hinweis“. */
function catalogWay(c: CatalogEntry): string {
  const x = t().cat
  if (c.way === 'bundled') return x.bundled
  const note = c.risk.note?.[lang()]
  return [x.reference, ...(c.risk.heavy ? [x.heavy] : []), ...(note ? [note] : [])].join(', ')
}

function catalogMarkdown(snap: { on: boolean; guide: boolean; cmds: readonly { name: string; plugin?: string }[]; muted: string[] }, tag: string): string {
  const x = t().cat
  const rows = CATALOG.map((c) => `| \`${c.id}\` ${mdCell(c.name)} | ${mdCell(c.author)} | ${c.license} | ${catalogWay(c)} | ${catalogState(c, snap.cmds, snap.muted)} |`)
  const lines = CATALOG.filter((c) => copyLine(c)).map((c) => `- \`${c.id}\`: \`${copyLine(c)}\` · ${c.url}`)
  return [`${x.listHead(snap.on, snap.guide)}${tag ? ` · ${tag}` : ''}`, '', x.listIntro, '', x.cols, '|---|---|---|---|---|', ...rows, '', ...lines, '', x.listFoot].join('\n')
}

/** `/sidekick catalog [on|off|mute <id>|unmute <id>]`. */
async function catalogCommand($: EngineInterface, rest: string): Promise<string> {
  const x = t().cat
  await loadSettings($)
  const [a0 = '', id = ''] = rest.trim().split(/\s+/)
  const a = a0.toLowerCase()
  const on = cfg.catalog !== false
  if (a === 'on' || a === 'off') {
    const want = a === 'on'
    if (on === want) return x.already(want)
    const w = await writeCfg($, { catalog: want })
    if (!w.ok) return writeNote(w, lang())
    return [x.set(want), writeNote(w, lang())].filter(Boolean).join('\n')
  }
  if (a === 'mute' || a === 'unmute') {
    const c = byId(id)
    if (!c) return x.unknownId(id, CATALOG.map((y) => y.id).join(', '))
    await setMuted($, c.id, a === 'mute')
    return x.muteSet(c.name, a === 'mute')
  }
  if (a && a !== 'status') return x.usage
  const now = await $.clock.now()
  const cmds = await loadBase($, now).then((b) => b.cmds, () => [])
  const snap = { on, guide: settings.level === 'guide', cmds, muted: await loadMuted($) }
  const tag = `#${(++catListNo).toString(36)}${now.toString(36).slice(-5)}`
  catLists.set(tag, snap)
  while (catLists.size > 10) catLists.delete(catLists.keys().next().value as string)
  return catalogMarkdown(snap, tag)
}

/** `/sidekick catalog` gezeichnet: je Eintrag Name, Herkunft, Lizenz, Weg, Stand, dazu die Knöpfe „Befehl kopieren“ und „Stumm“. */
function catalogTree($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], snap: { on: boolean; guide: boolean; cmds: readonly { name: string; plugin?: string }[]; muted: string[] }): RenderElement {
  const x = t().cat
  const ui = $.ui.resolve(e)
  const Button = (p: { key: string; label: string; onPress: (press: UiPressArgument) => void }) => ui.Button(p) as RenderNode
  const cols = typeof e.viewport?.columns === 'number' ? e.viewport.columns : 100
  const rows: RenderNode[] = CATALOG.map((c) => {
    const isMuted = snap.muted.includes(c.id)
    const line = copyLine(c)
    const kids: RenderNode[] = [
      el('Box', { width: Math.max(12, Math.min(24, Math.floor(cols / 4))), flexShrink: 0 }, [el('Text', { color: ACCENT }, [c.name])]),
      el('Text', { dimColor: true }, [`${c.author} · ${c.license} · ${catalogWay(c)} · ${catalogState(c, snap.cmds, snap.muted)}`]),
    ]
    if (line)
      kids.push(
        Button({
          key: `sidekick-cat-copy-${c.id}`,
          label: x.btnCopy,
          onPress: (press) =>
            void $.ui.copy({ text: line, surface: press.surface }).then(
              (r) => $.ui.toast(r.isCopied ? (line.startsWith('/') ? x.copied(line) : x.shellCopied(line)) : x.copyFailed(line), { timeoutMs: 8000 }),
              () => $.ui.toast(x.copyFailed(line), { timeoutMs: 8000 }),
            ),
        }),
      )
    kids.push(
      Button({
        key: `sidekick-cat-mute-${c.id}`,
        label: isMuted ? x.btnUnmute : x.btnMute,
        onPress: () =>
          void setMuted($, c.id, !isMuted)
            .then(() => {
              snap.muted = isMuted ? snap.muted.filter((y) => y !== c.id) : [...snap.muted, c.id]
            })
            .catch((err) => $.ui.toast(msg(err), { timeoutMs: 8000 }))
            .then(() => $.ui.invalidate('ui.render')),
      }),
    )
    return el('Box', { key: `sidekick-cat-${c.id}`, flexDirection: 'row', columnGap: 1, flexWrap: 'wrap' }, kids)
  })
  return el('Box', { key: 'sidekick-catalog', flexDirection: 'column' }, [
    el('Text', { bold: true }, [x.listHead(snap.on, snap.guide).replace(/\*\*/g, '')]),
    el('Text', { dimColor: true }, [x.listIntro]),
    ...rows,
    el('Box', { marginTop: 1 }, [el('Text', { dimColor: true }, [x.listFoot.replace(/`/g, '')])]),
  ])
}

/** Knopf „Danach“ geklickt (Fynn 2026-11-08): die nächste eigene Nachricht dieser Runde gilt als „danach“; verfällt mit der Runde. */
let laterArmed = false

/** Knopf „Danach“ (Ausbau 0.24.0): nur während einer Runde, auf Begleiter, mit `queue` an; `armed` nach einem Klick. */
function laterNow(): 'on' | 'armed' | null {
  return turnRunning && settings.level === 'guide' && cfg.queue !== false ? (laterArmed ? 'armed' : 'on') : null
}

/** Klick auf „Danach“: an oder zurück; nur während einer Runde (der Knopf steht nur dann da). */
function pressLater($: EngineInterface) {
  if (!turnRunning) return
  laterArmed = !laterArmed
  pushBtns($)
  // 0.24.2: zusätzlich sofort neu zeichnen, wie die Desktop-Probe (`btn-probe`, 22 Klicks umgeschaltet); aus `onPress` erlaubt
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // das Abo von `sidekick.prompts` zeichnet ohnehin neu
  }
}

/**
 * Urteil in `prompt.submit` (Verhalten 1): `later` = die Nachricht ist ein späterer Punkt; `text` = die Nachricht ohne Präfix
 * „danach:“/„later:“, wenn sie eins hatte. Nur unter E1: vom Nutzer getippt, Stufe Begleiter, Einstellung `queue` an, nicht `-p`;
 * der Hinweis nur während einer Runde (`turnId`) und nicht bei `wait` (ctrl+x enter gehört Claude Codes eigener Warteschlange).
 * Vorrang: Knopf „Danach“, dann Präfix, dann Regeln und Haiku. Die graue Zeile hängt an der nächsten eigenen Zeile (`pending`).
 */
async function queueJudge($: EngineInterface, e: { text: string; turnId?: string; wait: boolean; origin: { kind: string }; attachments?: readonly unknown[] }, signal: AbortSignal): Promise<{ later: boolean; text?: string }> {
  if (e.origin.kind === 'plugin') return { later: false }
  await loadSettings($)
  if (settings.level !== 'guide' || cfg.queue === false) return { later: false }
  // `isOwn`: composer/bridge, oder sdk nur im Desktop; in `-p` ist `surfaces()` leer
  if (!(await isOwn($, e.origin.kind))) return { later: false }
  const pre = laterPrefix(e.text)
  const out = pre ? { text: pre.text } : {}
  if (!e.turnId || e.wait) return { later: false, ...out }
  const text = pre ? pre.rest : stripLeadReminders(e.text)
  let grund = t().q.ruleReason
  // Delta-Review K1: eine leere Nachricht oder ein Slash-Befehl verbraucht die Markierung nicht und bekommt keinen Hinweis
  if (!text.trim() || text.trim().startsWith('/')) return { later: false, ...out }
  if (laterArmed) {
    laterArmed = false
    pushBtns($)
    grund = t().q.buttonReason
  } else if (pre) {
    grund = t().q.prefixReason
  } else {
    const rule = queueRule(e.text, !!e.attachments?.length)
    if (rule === 'now') return { later: false }
    if (rule === null) {
      const msgs = await $.session.messages()
      // Rundenauftrag: die letzte eigene Nachricht im Verlauf; die neue ist noch nicht darin
      let turnPrompt = ''
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        const s = stripLeadReminders(String(m?.text ?? '')).trim()
        if (m?.role === 'user' && s && !isHostNote(s)) {
          turnPrompt = s
          break
        }
      }
      const tail = lastReply(msgs, '', QUEUE_TAIL)
      const v = parseQueue(await haiku($, QUEUE, queueSystem(), queuePrompt({ text, turnPrompt, tail }), { signal, book: bookQueue }))
      if (!laterByVerdict(v)) return { later: false }
      grund = v?.grund ?? ''
    }
  }
  await bindSession($)
  bookDay($, await $.clock.now(), (d) => countQueue(d, 'markiert'))
  // Delta-Review S1: Die Zeile hängt an der Zeile, wie sie getippt wurde (mit Präfix); `alt` ist der Text ohne Präfix
  pending = { text: stripLeadReminders(e.text), ...(pre ? { alt: pre.rest } : {}), line: t().q.line(grund) }
  // Review 0.24.0 K2: nach dem Senden einmal neu zeichnen, wie bei den anderen Zeilen (sendWithWartung)
  later($, 100, () => {
    try {
      $.ui.invalidate('ui.render')
    } catch {
      // ohne Neuzeichnen
    }
  })
  return { later: true, ...out }
}

/** `/sidekick queue [on|off]`: Zustand oder Schalter in userConfig (`queue`, docs/SETTINGS-SPEC.md §5). */
async function queueCommand($: EngineInterface, rest: string): Promise<string> {
  const x = t().q
  await loadSettings($)
  const a = rest.trim().toLowerCase()
  const on = cfg.queue !== false
  if (!a || a === 'status') return x.state(on, settings.level === 'guide')
  if (a !== 'on' && a !== 'off') return x.usage
  const want = a === 'on'
  if (on === want) return x.already(want)
  const w = await writeCfg($, { queue: want })
  if (!w.ok) return writeNote(w, lang())
  return [x.set(want), writeNote(w, lang())].filter(Boolean).join('\n')
}

export function register(on: On, options?: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  // userConfig `language` (en/de, Standard en); /config lädt das Modul neu (release/I18N.md §1)
  setLang(options?.language)
  // Einstellungen aus userConfig (0.23.0); ungültige oder fehlende Werte bekommen den Standard
  cfg = readSettings(SETTINGS, options)
  settings = settingsOf(cfg, rt)
  on('session.start', async ($, e, next) => {
    // Umzug der Store-Werte bis 0.22.0: lokal sofort, das Schreiben nach userConfig im Hintergrund
    try {
      const write = await migrate($)
      if (write) migrating = write().catch(() => {})
    } catch {
      // beim nächsten Start wieder
    }
    // Danach (nicht gleichzeitig, beide schreiben settings.json) die Aus-Standards einmal speichern (0.24.1, hooks/offdefaults.ts)
    void migrating.then(() => storeOffDefaults($, SELF, SETTINGS))
    // Ein Neuladen mitten in Prüfung, Rückfrage oder Übergabe ließe den Wert in $.state stehen (er überlebt den Reload,
    // en/interface.md:716): zurücksetzen, sonst hielte Clawd ihn bis zum Sicherheitsnetz fest (Review S1)
    try {
      await loadSettings($)
      await bindSession($)
    } catch {
      // Standard bis zur ersten Nachricht
    }
    // Die Anzeige in der Fußzeile überlebt ein Neuladen wie `buddy` (en/interface.md:716): nach dem Laden der Stufe neu schreiben
    // (Nachtrag 0.10.0); buddy() schreibt sie mit
    statusLast = undefined
    buddyKind = undefined
    // Cache kalt (Ausbau 0.20.0): nach /reload-plugins oder einem Neustart aus dem Store (`cache:<session>`) neu rechnen, dann der Takt
    try {
      coldNow = coldOf(await $.clock.now())
    } catch {
      coldNow = false
    }
    buddy($, null)
    try {
      coldTimer?.cancel()
    } catch {
      // ein Takt aus einem früheren Lauf
    }
    coldTimer = null
    try {
      startColdTimer($)
    } catch {
      // ohne Takt kippt `cold` erst mit dem nächsten Schreiben der Anzeige
    }
    housekeeping($).catch(() => {})
    // Befehle zuletzt, jeder für sich (CLAUDE.md, Registrieren in session.start); englisch
    for (const c of [
      { name: 'sidekick', description: t().cmdSidekick, argumentHint: '[off|cache|guide|on|status|threshold 80k|big 150k|skills on|off|ttl 5|60|auto|hints …|notes on|off|forget|tips …|loop on|off|save <name> [text]|prompts [name]|forget <name>|language|help]' },
      { name: 'savings', description: t().cmdSavings, argumentHint: '[detail] [today|week|all|help]' },
      // Ausbau 0.22.0 (von limit-bars übernommen). Hat noch ein anderes Plugin `/handoff`, lehnt die Engine das zweite ab (Probe 2026-11-07)
      { name: 'handoff', description: t().ho.cmd, argumentHint: '[show|continue|fork|text|help]' },
    ]) {
      try {
        await $.command.register(c)
      } catch {
        // ohne diesen Befehl
      }
    }
    // Gespeicherte Prompts (Nachtrag 0.21.0): der Befehl /p mit den Namen als Hinweis, danach die Knopfliste
    try {
      await loadSaved($)
      await registerPrompts($)
      promptsLast = undefined
      pushBtns($)
    } catch {
      // ohne gespeicherte Prompts
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
    // Gespeicherte Prompts: ein Knopf während einer Antwort sagt „kommt danach“ (Nachtrag 0.21.0)
    turnRunning = true
    // Warteschlange (Ausbau 0.24.0): Knopf „Danach“ während der Runde; `pushBtns` schreibt nur bei Änderung
    try {
      pushBtns($)
    } catch {
      // Beiwerk
    }
    try {
      startedAt = await $.clock.now()
      // Modell-Tipp angenommen: jede Hauptanfrage dieses Chats auf das Ziel (S1 (ii), types:14677-14700 `model` umschreibbar)
      await bindSession($)
      want = tipModel($, e.model, startedAt)
      // Cache kalt (Ausbau 0.20.0): die erste Hauptanfrage nach dem Senden wärmt ihn, das Feld fällt sofort weg
      stepAt = startedAt
      if (coldNow) {
        coldNow = false
        pushStatus($)
      }
      // Vorschlag kurz vor Ablauf: verschwindet beim nächsten Turn (Verhalten 3)
      if (sug) hideSuggest($, 'ignoriert', startedAt)
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
    if (!e.agentId) {
      turnRunning = false
      // Warteschlange (Ausbau 0.24.0): eine Markierung per Knopf verfällt mit der Runde, der Knopf verschwindet
      laterArmed = false
      try {
        pushBtns($)
      } catch {
        // Beiwerk
      }
    }
    // /handoff (Ausbau 0.22.0): eine während des Turns verlangte Übergabe startet jetzt; die Antwort des Skills wird abgefangen. Nie
    // im Hook selbst: der Turn endet gerade, ein Dialog hielte ihn offen (limit-bars 0.14 captureHandoff)
    try {
      if (!e.agentId && HO.queued) {
        const q = HO.queued
        HO.queued = null
        later($, 300, () => {
          cmdHandoff($, q.force).catch((err) => $.ui.toast(t().ho.failed(msg(err)), { timeoutMs: 15000 }))
        })
      }
      if (!e.agentId && HO.skill) {
        HO.skill = false
        const answer = e.reason === 'answer' ? e.answer : ''
        later($, 300, () => {
          captureSkill($, answer).catch(() => {})
        })
      }
    } catch {
      // Beiwerk
    }
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

  // Zusammenfassungs-Zähler (Ausbau 0.19.0, Verhalten 3) und B2. Nur Beobachter: `next(e)` unverändert, kein `skip`, keine anderen
  // `instructions` (SPEC Rechte). Gezählt wird, was im Hauptchat wirklich zusammenfasst: `manual` (S2: `/compact`) und `auto`, dazu
  // zählt die Compaction im Leerlauf (rel/hooks.md:3312, rel/llm-gateway-protocol.md:157). Nicht `precompute`, das nichts einsetzt
  // (types:11731), nicht `plugin` (heute kommt keine von sidekick), nicht die eines Subagenten (`agentId`), nicht ein `skip`
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    try {
      const skipped = typeof (r as { skip?: unknown }).skip === 'string'
      if (!e.agentId && (e.trigger === 'manual' || e.trigger === 'auto') && !skipped) {
        await bindSession($)
        const now = await $.clock.now()
        ses.compacts += 1
        if (ses.compacts === 2 || ses.compacts === 4) ses.compactMark = ses.compacts
        ses.afterCompact = true
        endSeries()
        saveSes($, now)
        // Cache kalt (0.20.0): nach einer Compaction schreibt die nächste Anfrage nur die Zusammenfassung, also nicht kalt (B2)
        if (coldNow) {
          coldNow = false
          pushStatus($)
        }
        // B2: Größe nach der Compaction für die nächste Prüfung; `context.tokens` fehlte in S2 bis zur ersten Anfrage
        const after = (r as { tokensAfter?: unknown }).tokensAfter
        if (typeof after === 'number' && after > 0) {
          mem = { ...mem, ctx: after }
          saveMem($, now)
        }
      }
    } catch {
      // Beiwerk: die Compaction selbst bleibt unberührt
    }
    return r
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
    // Warteschlange (Ausbau 0.24.0, Variante B): eine Nachricht während der Arbeit, die ein eigener späterer Punkt ist, geht wie
    // bisher sofort rein, mit einem Hinweis an Claude (`context`). Fail-open (E3): jeder Fehler lässt sie ohne Hinweis durch
    try {
      const q = await queueJudge($, e, next.signal)
      // Präfix „danach:“/„later:“ wird vor dem Senden entfernt (Rewrite, types@2.1.319:9845-9847)
      if (q.text !== undefined) e = { ...e, text: q.text }
      if (q.later) e = { ...e, context: [...(e.context ?? []), t().q.context] }
    } catch {
      // ohne Hinweis
    }
    // Ausbau 0.24.0: ohne den `<system-reminder>`-Vorspann der Desktop-App (Probe P1); gesendet wird weiter `e` unverändert
    const typed = stripLeadReminders(e.text)
    // Gespeicherte Prompts (Nachtrag 0.21.0): merken und erkennen im Hintergrund, die Nachricht wartet nie darauf. Ein wartendes
    // Angebot bindet sich an die nächste eigene Nachricht
    try {
      void rememberPrompt($, typed, e.origin.kind).catch(() => {})
      if (offerWait && !offerWait.forText && e.origin.kind !== 'plugin' && !typed.trim().startsWith('/')) offerWait.forText = typed
    } catch {
      // Beiwerk
    }
    // Ein getippter Wartungs-Befehl gilt als erledigt; im Hintergrund, die Nachricht geht unverändert weiter (SPEC Nachtrag 0.2.0)
    try {
      if (typed.trim().startsWith('/')) noteDone($, doneFromText(typed))
    } catch {
      // Beiwerk
    }
    // „Gut zu wissen“: eine eigene Nachricht lässt einen nicht erklärten Hinweis altern (Nachtrag 0.13.0, Verhalten 7)
    try {
      await noteAfterOwn($, typed, e.origin.kind)
    } catch {
      // Beiwerk
    }
    // Modell-Tipp (Ausbau 0.18.0, Gegenprobe): Nach einem getippten `/model` prüft der nächste Schritt, ob es zurück auf Opus/Fable ging
    try {
      // Korrektur-Schleife (Ausbau 0.19.0): `/rewind` beendet die Serie (`/clear` beginnt ohnehin eine neue Session). Für `/compact` kam
      // in S2 kein `prompt.submit`; dort beendet `session.compact` die Serie, der Zweig ist nur die Absicherung (Review 0.19.0 K6)
      if (/^\/(rewind|compact)(\s|$)/i.test(typed.trim())) {
        await bindSession($)
        if (ses.korr || ses.nudged) {
          endSeries()
          saveSes($, await $.clock.now())
        }
      }
      if (/^\/model(\s|$)/i.test(typed.trim())) {
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
    const resendable = !e.attachments?.length && !/(^|\s)@\S/.test(typed)
    // Skill-Katalog (Ausbau 0.25.0): Vorfilter vor der Prüfung, damit sie die Kandidaten mitnehmen kann (Verhalten 2); Fehler → keine
    let cands: CatalogEntry[] = []
    try {
      cands = await catalogCands($, e, typed)
    } catch {
      cands = []
    }
    let g: Gate = PASS
    try {
      g = await gate($, typed, e.origin.kind, !!e.turnId || e.wait, next.signal, cands)
    } catch {
      buddy($, null)
      return go(e)
    }
    /**
     * Eingriff des Katalogs (Verhalten 3), nur wenn die Prüfung weder Rückfrage noch Zeile hat („höchstens eine Sache“). null: wie
     * bisher senden. `$.fs.read` und `$.ui.copy` stehen hier im Hook (validate kürzt die `calls:`-Zeile, Bau 0.24.0). Fail-open.
     */
    const viaCatalog = async (): Promise<Awaited<ReturnType<typeof go>> | { drop: string } | null> => {
      let k: CatAct | null = null
      try {
        k = await catalogStep($, typed, cands, g.kat, next.signal)
      } catch {
        k = null
      }
      if (!k || k.act === 'send') return null
      const x = t().cat
      const cat = k.c
      if (k.act === 'mute') {
        $.ui.toast(x.muted(cat.name), { timeoutMs: 8000 })
        return null
      }
      const now = await $.clock.now().catch(() => 0)
      const redraw = () =>
        later($, 100, () => {
          try {
            $.ui.invalidate('ui.render')
          } catch {
            // ohne Neuzeichnen
          }
        })
      if (k.act === 'line') {
        // Schwerer Verweis (E3): nur die Zeile mit Knopf „Befehl kopieren“; ein Wartungs-Hinweis wartet auf die nächste Nachricht
        const note = cat.risk.note ? cat.risk.note[lang()] : ''
        pending = { text: typed, line: x.line(cat.name, cat.author, cat.license, note, k.grund), cat: cat.id, ...(cat.install ? { cmd: cat.install.line } : {}) }
        keepWartung($, g.w, now)
        const r = await go(e)
        redraw()
        return r
      }
      if (k.act === 'skill' && cat.invoke) {
        // Probe P1, Weg B: der Text des mitgelieferten Skills als `context` (types@2.1.319:9800-9808), die Nachricht bleibt wie getippt,
        // Anhänge gehen mit. Datei unter `$.plugin.root` (types@2.1.319:3398-3400). Lässt sie sich nicht lesen: ohne Skill senden
        const dir = `${$.plugin.root}/skills/${cat.invoke.split(':').pop()}`
        let body = ''
        try {
          body = String(await $.fs.read(`${dir}/SKILL.md`))
        } catch (err) {
          $.ui.toast(x.readFailed(cat.name, msg(err)), { timeoutMs: 15000 })
          return null
        }
        bookDay($, now, (d) => countCatalog(d, 'mitSkill'))
        pending = { text: typed, line: x.sentWith(cat.name, cat.author, cat.license) }
        keepWartung($, g.w, now)
        const r = await go({ ...e, context: [...(e.context ?? []), skillContext(body, dir, cat, typed)] })
        redraw()
        return r
      }
      if (k.act === 'copy' && cat.install) {
        // E4: sidekick installiert nichts, er kopiert nur die Zeile aus der README; die Nachricht wartet (Text im Grund)
        const line = cat.install.line
        const r = await $.ui.copy({ text: line }).catch(() => null)
        bookDay($, now, (d) => countCatalog(d, 'kopiert'))
        keepWartung($, g.w, now)
        return { drop: (r?.isCopied ? x.dropCopied : x.dropNotCopied)(line, cat.url, cut(typed, 3000), !line.startsWith('/')) }
      }
      return null
    }
    // Korrektur-Schleife und Zusammenfassungs-Frage (Ausbau 0.19.0) brauchen keinen Auslöser der Prüfung: dann mit den Fakten ohne Urteil
    let c = g.c ?? (g.loop || g.compact ? (g.mini ?? null) : null)
    if (!c) {
      buddy($, null)
      const k = await viaCatalog()
      if (k) return k
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
    let d = dialog(c, resendable, base)
    // Vorrang (Verhalten 2): falscher Chat > Kalt-Cache-Frage > Korrektur-Schleife > übrige Hinweise. Bei der Kalt-Cache-Frage steht
    // der Satz zur Schleife darin, kein zweiter Dialog; ihre Übergabe bekommt dann „Was nicht funktioniert hat“
    if (g.loop && d?.art !== 'falscher_chat') {
      if (d && c.trigger === 'c') {
        const how = t().howNext
        d = { ...d, question: d.question.endsWith(how) ? `${d.question.slice(0, -how.length)}${t().loopCold}\n\n${how}` : `${d.question}\n\n${t().loopCold}` }
        c = { ...c, grund: 'schleife' }
        ses.korrAsked = true
        saveSes($, now)
      } else {
        keepWartung($, g.w, now)
        let ch: LoopChoice = 'send'
        try {
          ch = await askLoop($, c, resendable, base, now)
        } catch {
          ch = 'send'
        }
        if (ch === 'new' && resendable) {
          const check: Check = { ...c, grund: 'schleife' }
          const text = typed
          later($, 300, () => {
            runHandoff($, text, check, false).catch((err) => $.ui.toast(t().newChatFailed(msg(err), cut(text, 300)), { timeoutMs: 30000 }))
          })
          return { drop: t().dropStarting(false, cut(typed, 3000)) }
        }
        if (ch === 'nudge') {
          // Der Nutzer sieht den Denkanstoß nicht, Claude liest ihn (types:9771-9775); die Gegenprobe zählt die nächste Nachricht
          ses.nudged = true
          saveSes($, now)
          return go({ ...e, context: [...(e.context ?? []), t().nudge] })
        }
        return go(e)
      }
    }
    // Zusammenfassungs-Zähler (Verhalten 3): die vorhandene Neuer-Chat-Frage mit Grund „verdichtet“, nur ohne andere Rückfrage. Die
    // Kosten rechnen mit dem aktuellen Kontext (`c.ctx` nach der Compaction). Die Marke gilt bis zur Antwort
    if (!d && g.compact && resendable) {
      d = { question: `${t().compacted(ses.compacts)} ${t().howNext}`, options: labels(rankChoices({ cold: false, sendUsd: Infinity, resendable, fassung: false })), art: 'verdichtet' }
      c = { ...c, grund: 'verdichtet' }
      ses.compactMark = 0
      saveSes($, now)
    }
    // Grund der Frage für Clawd (Ausbau 0.20.0); „verdichtet“ bleibt ohne
    buddy($, d ? 'stop' : null, d ? whyOf(d.art, c.trigger) : undefined)
    // Modell-Tipp bei der ersten Nachricht (Verhalten 2): nur ohne andere Rückfrage dieser Prüfung („höchstens eine Sache“); die
    // Nachricht geht danach in jedem Fall unverändert weiter, nur die Schritte laufen bei Annahme auf dem Ziel
    let tipAsked = false
    if (!d && c.trigger === 'a' && v) {
      try {
        const why = tipBlock({ level: settings.level, tips: settings.tips, now, model: c.main, stufe: v.aufwand, text: typed, attachments: !!e.attachments?.length, otherDialog: false, brief: c.brief })
        if (!why) {
          tipAsked = true
          await askTip($, c, now)
        }
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
        pending = { text: typed, line, ...(hit ? { cmd: hit.cmd } : {}) }
        ses.open = { art: v.art, skill: v.skill, ctx: c.ctx }
        ses.last = { line, art: v.art, at: now }
        // Der Hinweis der Prüfung hat Vorrang; der Wartungs-Hinweis wartet auf die nächste Nachricht ohne Zeile (Nachtrag 0.12.0)
        if (g.w) ses.wartungOffen = offenOf(g.w, now)
        saveSes($, now)
        bookDay($, now, (x) => countHint(x, v.art, 'gezeigt'))
        moment($, 'hint')
        const r = await go(e)
        $.ui.invalidate('ui.render')
        return r
      }
      // Skill-Katalog (Ausbau 0.25.0): nur ohne Zeile, Rückfrage und Modell-Tipp dieser Prüfung
      if (!tipAsked) {
        const k = await viaCatalog()
        if (k) return k
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
      return { drop: t().dropWrongChat(cut(typed, 3000)) }
    }
    if (answer === 'fassung' && v?.fassung && showable(v.fassung)) {
      bookDay($, now, (x) => countHint(x, 'fassung', 'angenommen'))
      // Sichtbar machen, was gesendet wurde: Der Desktop zeigt in der Sprechblase das Original
      pending = { text: typed, alt: v.fassung, line: t().sentFassung(whoOf()), sent: v.fassung }
      // Review 0.24.0 S1: der Vorspann der Desktop-App bleibt vor der Fassung stehen (gesendet wird sonst `e` unverändert)
      const r = await go({ ...e, text: e.text.slice(0, e.text.length - typed.length) + v.fassung })
      $.ui.invalidate('ui.render')
      return r
    }
    if ((answer === 'new' || answer === 'plain') && resendable) {
      bookDay($, now, (x) => countHint(x, d.art, 'angenommen'))
      const check = c
      const text = typed
      const plain = answer === 'plain'
      later($, 300, () => {
        runHandoff($, text, check, plain).catch((err) => $.ui.toast(t().newChatFailed(msg(err), cut(text, 300)), { timeoutMs: 30000 }))
      })
      // Der Text steht im Grund: feuert der Timer nie (Reload), ist er nicht verloren
      return { drop: t().dropStarting(plain, cut(typed, 3000)) }
    }
    if (answer === 'abort') {
      // Beim falschen Chat ist Abbrechen die Empfehlung, also angenommen
      const wrong = d.art === 'falscher_chat'
      bookDay($, now, (x) => countHint(x, d.art, wrong ? 'angenommen' : 'abgebrochen'))
      // Nicht gesendet: aus dem Prüfkontext nehmen (falscher Chat)
      if (wrong) forget($, c, now)
      return { drop: (wrong ? t().dropWrongChat : t().dropAborted)(cut(typed, 3000)) }
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
    // Der eigene Skill `handoff` (E2): die Antwort dieses Turns abfangen
    if (isOwnSkill(e)) HO.skill = true
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
      // Ausbau 0.24.0: verglichen wird ohne den Vorspann der Desktop-App, wie `prompt.submit` den Text merkt
      const shown = stripLeadReminders(e.props.text).trim()
      if (!hit && own && pending && (shown === pending.text.trim() || shown === pending.alt?.trim())) {
        hit = {
          id: e.requestId,
          line: pending.line,
          ...(pending.sent ? { sent: cut(pending.sent, 2000) } : {}),
          ...(pending.cmd ? { cmd: pending.cmd } : {}),
          ...(pending.wid ? { wid: pending.wid } : {}),
          ...(pending.why ? { why: pending.why } : {}),
          ...(pending.cat ? { cat: pending.cat } : {}),
        }
        pending = null
        ses.hints = [...ses.hints, hit].slice(-30)
        saveSes($, await $.clock.now())
      }
      // Gespeicherte Prompts (Nachtrag 0.21.0): welche eigene Nachricht welche ID hat (das Angebot kommt erst nach dem Senden),
      // und ein wartendes Angebot unter der nächsten eigenen Nachricht ohne eigene Zeile
      if (own && shown) {
        if (!ownRendered.some((r) => r.id === e.requestId)) ownRendered = [...ownRendered, { id: e.requestId, text: shown }].slice(-12)
        // Hat diese Nachricht schon eine Zeile der Prüfung, wartet das Angebot auf die nächste
        if (hit && offerWait?.forText && offerWait.forText.trim() === shown && !hit.offer) offerWait.forText = undefined
        if (!hit && offerWait?.forText && offerWait.forText.trim() === shown) {
          hit = { id: e.requestId, line: t().pr.offerLine(offerWait.name), offer: { name: offerWait.name, text: offerWait.text, ids: offerWait.ids } }
          offerWait = null
          ses.hints = [...ses.hints, hit].slice(-30)
          saveSes($, await $.clock.now())
        }
      }
      called = true
      if (!hit) return next(e)
      // Andere Oberflächen: nur Text (Farbe und Rahmen sind dort nicht belegt)
      if (e.surface !== 'terminal' && e.surface !== 'desktop') {
        // Ohne Knöpfe: das Angebot mit dem Befehl, der dasselbe tut
        if (hit.offer && !hit.offerDone) return next({ ...e, props: { ...e.props, text: `${e.props.text}\n\n· sidekick: ${hit.line} /sidekick save ${hit.offer.name} ${hit.offer.text}` } })
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
      if (hit.offer) {
        // Angebot (Nachtrag 0.21.0): Speichern zuerst, dann Nein; danach nur noch, was daraus wurde
        const of = hit.offer
        if (hit.offerDone) line.push(el('Text', { dimColor: true }, [`  ${hit.offerDone === 'saved' ? x.pr.offerSaved(of.name) : x.pr.offerDeclined}`]))
        else if (pressing.has(id)) line.push(el('Text', { dimColor: true }, [`  ${x.btnBusy}`]))
        else {
          line.push(Button({ key: 'sidekick-offer-save', label: x.pr.offerSave, onPress: () => void answerOffer($, id, true) }))
          line.push(Button({ key: 'sidekick-offer-no', label: x.pr.offerNo, onPress: () => void answerOffer($, id, false) }))
        }
      } else if (hit.wid || hit.cat) {
        // Wartungszeile (Ausbau 0.16.0): Befehl ins Eingabefeld (Desktop: kopieren), „?“ klappt die Erklärung auf. Seit 0.25.0 auch die
        // Zeile des Skill-Katalogs; eine Zeile ohne `/` (z. B. `uv tool install …`) gehört in eine Shell und wird immer kopiert
        if (cmd && hit.filled) line.push(el('Text', { dimColor: true }, [`  ${x.btnFilled}`]))
        else if (cmd && pressing.has(id)) line.push(el('Text', { dimColor: true }, [`  ${x.btnBusy}`]))
        else if (cmd) {
          const label = e.surface === 'desktop' || (hit.cat && !cmd.startsWith('/')) ? x.btnCopy : x.btnInsert
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
      if (hit.offer && !hit.offerDone) kids.push(el('Box', { key: 'sidekick-offer-text', paddingLeft: 2 }, [el('Text', { dimColor: true }, [`„${preview(hit.offer.text, 80)}“`])]))
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
    // Gespeicherte Prompts, Rückfall (Nachtrag 0.21.0): eine Knopfzeile ganz unten in sidekicks Ebene, nur wenn es Knöpfe gibt
    let btns: RenderNode[] = []
    if (BUTTON_PLACE === 'band' && !step)
      try {
        btns = await promptButtons($, e)
      } catch {
        btns = []
      }
    // Vorschlag kurz vor Ablauf (Ausbau 0.22.0): steht, bis er ausgeblendet wird; kein eigenes Neuzeichnen im Takt
    const s = step ? null : sug
    if (!step && !note && !s && !btns.length) return next(e)
    const theirs = await next(e)
    const btnRow = btns.length ? el('Box', { key: 'sidekick-prompts', flexDirection: 'row', columnGap: 1, flexWrap: 'wrap' }, btns) : null
    if (!step) {
      try {
        const { layers, slots, base } = splitBand(theirs)
        const ui = $.ui.resolve(e)
        const views: RenderNode[] = []
        if (note) {
          const n = note
          // Ziffern nur, solange Claude arbeitet: Danach löst eine allein getippte Ziffer im leeren Eingabefeld den Knopf aus
          // (docs/raw/en/reference.md:244), etwa die Antwort „2“ auf „Variante 1 oder 2?“ (Review 0.13.0 K1). quick-replies belegt
          // 1 … n ebenfalls erst nach der Runde; liegt es doch im Band, ohne Ziffern
          const qr = layers.some((l) => nameOf(l) === 'quick-replies') || hasKey(base, 'quick-replies')
          const digits = e.props.isWorking && !qr
          views.push(noteView(n, e.props.bodyColumns, e.surface, digits, (p) => ui.Button(p) as RenderNode, (a) => void pressNote($, n.shownAt, a, e.surface)))
        }
        if (s) views.push(suggestView(s, e.props.bodyColumns, e.surface, (p) => ui.Button(p) as RenderNode, (a) => void pressSuggest($, a)))
        if (btnRow) views.push(btnRow)
        const content = views.length === 1 ? (views[0] as RenderElement) : el('Box', { flexDirection: 'column' }, views)
        return joinBand([...layers, sidekickLayer(content, e.surface)], base, slots)
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
        el('Text', { color: ACCENT }, [`sidekick ${{ fork: t().ho.busyFork, text: t().ho.busyText, plain: t().busyPlain, clear: t().busyClear }[step.step]} … ${secs} s`]),
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
    if (/^loop\b/i.test(args)) return { text: await loopCommand($, args.slice(4)) }
    // Gespeicherte Prompts (Nachtrag 0.21.0)
    if (/^(save|prompts|forget)(\s|$)/i.test(args)) return { text: await promptsCommand($, args, () => $.session.messages()) }
    // Warteschlange (Ausbau 0.24.0)
    if (/^queue(\s|$)/i.test(args)) return { text: await queueCommand($, args.slice(5)) }
    // Skill-Katalog (Ausbau 0.25.0)
    if (/^catalog(\s|$)/i.test(args)) return { text: await catalogCommand($, args.slice(7)) }
    // Laufzeitwerte frisch laden: eine andere Session kann sie geändert haben
    await loadSettings($)
    let note = ''
    if (args && args.toLowerCase() !== 'status') {
      const s = applySetting(settings, args)
      if (!s) return { text: t().unknownArg(args, USAGE) }
      // userConfig hat ein Minimum (bis 0.22.0 galt jede Zahl über 0); sagen statt „ungültiger Wert für threshold“ (Review K1)
      if (s.threshold < MIN_OF.threshold || s.big < MIN_OF.bigTokens) return { text: t().tooSmall(args, tokensText(MIN_OF.threshold)) }
      // `off` merkt sich die Stufe davor (`runtime`), die Felder gehen nach userConfig (0.23.0)
      // Direkt hier, nicht über updateRuntime: Ohne einen direkten Aufruf im Hook listet `validate` alle Aufrufer von
      // `$.store.set` und schneidet die `calls:`-Zeile ab (wie Ausbau 0.22.0), dann findet check-mods die letzten Calls nicht
      if (s.lastOn !== rt.lastOn) {
        rt = { ...cleanRuntime(await $.store.get('runtime')), lastOn: s.lastOn }
        await $.store.set('runtime', rt)
      }
      const patch = cfgPatch(settings, s)
      if (Object.keys(patch).length) {
        const w = await writeCfg($, patch)
        note = writeNote(w, lang())
        if (!w.ok) return { text: note }
      }
      pushStatus($)
    }
    const status = await statusText($)
    return { text: note ? `${note}\n\n${status}` : status }
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
    // Rückfall ohne gespeicherten Wert (nach /clear oder /resume leer, en/interface.md:762): mit dem Tipp dieses Chats (Review 0.19.0 S1)
    const tipName = tip && !tip.ended && tip.way === 'chat' ? modelName(tip.to) : ''
    let s: Status = { level: settings.level, busy: settings.level !== 'off' && busyNow(), ...(tipName ? { tip: tipName } : {}) }
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
      // Gespeicherte Prompts (Nachtrag 0.21.0, 0.21.3): Knöpfe links vor dem ●-Label; ein Fehler kostet nur die Knöpfe
      let btns: RenderNode[] = []
      if (BUTTON_PLACE === 'footer')
        try {
          btns = await promptButtons($, e)
        } catch {
          btns = []
        }
      const btnBox = btns.length ? [el('Box', { key: 'sidekick-prompts', flexDirection: 'row', columnGap: 1, flexShrink: 0 }, btns)] : []
      return el('Box', { flexDirection: 'row', columnGap: 2 }, theirs ? [...btnBox, mine, theirs] : [...btnBox, mine])
    }
    const tipText = s.level !== 'off' && typeof s.tip === 'string' && s.tip ? ` → ${s.tip}` : ''
    const label = s.level === 'off' ? x.modeOff : x.modeOn(s.busy ? '🟠' : '🟢', x.level[s.level]) + tipText
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })

  // /handoff (Ausbau 0.22.0, Verhalten 1), auf jeder Stufe. Aus command.run lehnt der Host `$.command.run` und `$.prompt.submit` ab
  // (Bau 0.21.0): Schreiben, /clear und Senden laufen im einmaligen Timer
  on('command.run', { command: 'handoff' }, async ($, e) => {
    const x = t().ho
    if (isHelp(e.args)) return { text: t().allCommands }
    const arg = e.args.trim().toLowerCase()
    if (arg && ![...HO_SHOW, ...HO_CONTINUE, ...HO_FORCE].includes(arg)) return { text: x.usage }
    if (HO_SHOW.includes(arg)) {
      const h = (await loadHandoffs($))[0]
      return { text: h ? x.last(hhmm(h.at), howLabel(h.method), h.text) : x.none }
    }
    // In `-p` ist die Liste leer (types:2700-2714): kein neuer Chat möglich
    const surfaces = await $.session.surfaces().catch(() => [] as string[])
    if (!surfaces.length) return { text: x.onlyInteractive }
    if (HO_CONTINUE.includes(arg)) {
      // Leert den Chat ohne weitere Frage: nur auf Fynns eigenen Befehl, nie über `$.command.run` eines Plugins (Review 0.22.0 S1,
      // wie `/p`; origin `{ kind: 'plugin', name }`, types@2.1.319:1840-1846). `/handoff` allein fragt vor `/clear` immer
      if (e.origin?.kind === 'plugin') return { text: x.notByPlugin }
      later($, 300, () => {
        continueLast($).catch(() => {})
      })
      return { text: x.continuing }
    }
    if (HO.running || HO.queued) return { text: x.running }
    const force = HO_FORCE.includes(arg) ? (arg as HandoffHow) : undefined
    // Der Fork sähe sonst einen halben Turn: erst nach turn.complete
    if (turnRunning) {
      HO.queued = force ? { force } : {}
      return { text: x.queued }
    }
    later($, 300, () => {
      cmdHandoff($, force).catch((err) => $.ui.toast(x.failed(msg(err)), { timeoutMs: 15000 }))
    })
    return { text: x.starting }
  })

  // Gespeicherte Prompts senden (Nachtrag 0.21.0): `/p <name>`, ein fester Befehl (Fynn 2026-11-06). Ein Hook ohne Filter oder mit Muster
  // stellte jede Ausgabe anderer Plugin-Befehle unter sidekicks Namen (Smoke-Tests 2026-11-06). Ohne Namen: die Liste der Namen.
  on('command.run', { command: 'p' }, async ($, e) => {
    // Nur auf Fynns eigenen Befehl: ruft ein anderes Plugin `/p` über $.command.run, sendet sidekick nicht als seine Worte (Review 0.21.0 K3;
    // origin `{ kind: 'plugin', name }`, types@2.1.319:1840-1846)
    if (e.origin.kind === 'plugin') return { text: t().pr.notByPlugin }
    const name = normName(e.args.trim().split(/\s+/)[0] ?? '')
    if (!name) return { text: t().pr.pUsage((await loadSaved($)).map((s) => s.name)) }
    return { text: await runPrompt($, name, 'cmd') }
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
    // `/sidekick prompts` ohne Namen (Nachtrag 0.21.0): Tabelle mit Knöpfen je Zeile; die Markdown-Fassung nennt dieselben Befehle
    if (/^prompts\s*$/i.test(String(e.props.args ?? '').trim())) {
      const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
      const snap = tag ? promptLists.get(tag) : undefined
      if (!snap) return next(e)
      try {
        return promptsTree($, e, snap)
      } catch {
        return next(e)
      }
    }
    // `/sidekick catalog` (Ausbau 0.25.0): Liste mit Knöpfen; die Markdown-Fassung nennt dieselben Befehle
    if (/^catalog\s*$/i.test(String(e.props.args ?? '').trim())) {
      const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
      const snap = tag ? catLists.get(tag) : undefined
      if (!snap) return next(e)
      try {
        return catalogTree($, e, snap)
      } catch {
        return next(e)
      }
    }
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
