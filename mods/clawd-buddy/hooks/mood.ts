// clawd-buddy: Stimmungsableitung (reine Funktionen, kein `$`, kein DOM).
//
// Das Hooks-Modul sammelt nur *Fakten* aus den Events (wann begann der Turn, welches Tool läuft seit wann, ob eine Frage offen ist,
// wann zuletzt getippt wurde, wie der letzte Turn endete) und reicht sie als `props` an den Client. Aus Fakten und der Zeit leitet
// `deriveMood` die Stimmung ab. Das passiert im Client, auf seiner eigenen Uhr: so werden Schwellen wie "Tool läuft > 10 s"
// auch ohne Timer im Hooks-Modul erkannt (ein Hooks-Modul darf nicht warten, nur Hooks-API-Aufrufe), und `$.ui.invalidate` ist nur bei
// echten Ereignissen nötig, nie im Bildtakt.
// Priorität (SPEC → Stimmungen): wartet auf dich > Tool läuft lange > arbeitet > fertig/Fehler > Nutzer tippt > Leerlauf.

export type ToolKind = 'read' | 'write' | 'shell' | 'web' | 'agent' | 'think' | 'git' | 'test'

/**
 * Shell-Befehl genauer einordnen (Fynn: Commits und Checks laufen oft): nur ein Mustervergleich auf dem Befehl, der Befehl selbst
 * wird weder gespeichert noch weitergegeben. `git` = commit/push/merge/rebase/tag, `test` = Tests, Lint, Typprüfung, Validierung.
 */
export function shellKind(command: unknown): ToolKind {
  if (typeof command !== 'string') return 'shell'
  const c = command.toLowerCase()
  if (/\bgit\s+(-c\s+\S+\s+)*(commit|push|merge|rebase|tag|cherry-pick)\b/.test(c)) return 'git'
  if (/\b(test|tests|pytest|vitest|jest|mocha|lint|eslint|tsc|typecheck|validate|check|check-mods)\b/.test(c)) return 'test'
  return 'shell'
}

export type Facts = {
  /** Läuft ein Turn des Hauptagenten? */
  turnActive: boolean
  /** Zuletzt gestartetes, noch laufendes Tool des Hauptagenten (nicht der Subagenten). */
  tool: { kind: ToolKind; since: number } | null
  /** Zuletzt beendetes Tool des Hauptagenten in diesem Turn und wann es endete (ms): Nachlauf, siehe TOOL_LINGER_MS. */
  lastTool?: { kind: ToolKind; endedAt: number }
  /** Eine Frage an den Nutzer ist offen (AskUserQuestion bzw. Berechtigung `ask`). */
  ask: boolean
  /** Zeitpunkt der letzten Eingabe im Prompt (ms, 0 = nie). */
  typingAt: number
  /** Ende des letzten Turns (ms) und wie er endete. */
  endedAt: number
  endedKind: '' | 'done' | 'oops'
  /**
   * Laufende Subagenten (auch im Hintergrund, in Worktrees, in Workflows, Teammates): je Agent der Zeitpunkt seiner letzten Aktivität
   * (ms). Ein Agent zählt, bis sein `turn.complete` kommt oder er AGENT_STALE_MS lang nichts mehr tut.
   */
  agents?: readonly number[]
  /** Seit wann die Rückfrage offen ist (ms); nach WAIT_ASK_LONG_MS wird er deutlicher (`waitUserLong`). */
  askSince?: number
  /** Zeitpunkt (ms), an dem eine Erfolgsserie eine Marke erreicht hat (5, 10, 15 … Turns in Folge): kurz `streak`. */
  streakAt?: number
  /** Zeitpunkt (ms), an dem zuletzt ein Subagent fertig wurde: kurz danach überreicht sein Helfer ein Geschenk (`agent_done`). */
  agentDoneAt?: number
  /**
   * Nutzungslimits aus `session.measure` (types:10379-10405, SessionRateLimit types:10566): Prozent verbraucht und Reset-Zeitpunkt
   * (ms) für das 5-Stunden- und das Wochenfenster. Fehlt ohne Abo oder vor der ersten Messung.
   */
  limits?: { five?: number; fiveReset?: number; week?: number; weekReset?: number }
  /** Zeitpunkt (ms), an dem Fynn nach mindestens AWAY_MS Pause zurückkam (erste Eingabe bzw. Sitzung wieder sichtbar): Begrüßung. */
  backAt?: number
  /**
   * Was der Mod sidekick gerade tut, aus dessen `$.state`-Wert `sidekick.buddy` (types/index.d.ts): prüft die Nachricht, hält sie an,
   * baut einen neuen Chat, neuer Chat eben gestartet. Ohne sidekick leer.
   */
  sidekick?: SidekickBuddy | null
  /**
   * Eisklumpen (0.13.0, SPEC „Ausbau 0.13.0“ Teil A): ein gewürfelter kalter Moment. `at` = Beginn (bei der eigenen 60-min-Schätzung in der
   * Zukunft: der Client sieht selbst, wann es so weit ist), `cracks` = Riss-Stufe 0–3 (je Tipp-Schub eine), `sentAt`/`how`/`level` = gesendet
   * (Senden zerbricht das Eis bzw. lässt es schmelzen, mit der Riss-Stufe beim Senden). Fehlt = kein Eis. Würfel und „einmal pro Chat“
   * führt das Hooks-Modul.
   */
  frost?: Frost
  /** Seit wann der Verlauf komprimiert wird (session.compact des Hauptgesprächs, ms; fehlt = gerade nicht). */
  compactSince?: number
  /** Zeitpunkt (ms), an dem zuletzt ein Skill startete (skill.prompt): kurz `skill`. */
  skillAt?: number
  /** Spielt tune-strip gerade Musik? Aus dessen `$.state`-Wert `tune-strip.playing` (types/index.d.ts, 0.9.0). Ohne tune-strip leer. */
  music?: boolean
  /** Takt und Gruppe des Songs aus `tune-strip.beat` (0.11.0, geprüft mit `beatValue`); fehlt = ohne Takt. Kein Titel. */
  beat?: BeatValue
  /**
   * Zeitpunkt (ms), an dem er zeigt, dass das Kontextfenster voll wird (eine Stufe aus CTX_WARN überschritten; gezeigt am Turn-Ende,
   * nie mitten in der Arbeit): kurz `ctx_full`. Nur die Prozentzahl aus `session.measure` zählt (types:10771), nie der Verlauf.
   */
  ctxAt?: number
  /** Dauer des zuletzt beendeten Turns (ms): ab LONG_TURN_MS heißt „fertig“ `done_long` (Puh, geschafft). */
  turnMs?: number
}

/** Ab so viel Prozent gilt ein Fenster als ausgeschöpft. */
export const LIMIT_FULL = 100
/** So lange nach dem Reset eines ausgeschöpften Fensters freut er sich (ms). */
export const LIMIT_BACK_MS = 6_000

/** Welches Limit ist gerade ausgeschöpft ('week' vor 'five'), oder 'back' kurz nach dem Reset, sonst ''. */
export function limitState(f: Facts, now: number): '' | 'five' | 'week' | 'back' {
  const l = f.limits
  if (!l) return ''
  const full = (p?: number, reset?: number) => (p ?? 0) >= LIMIT_FULL && (!reset || now < reset)
  if (full(l.week, l.weekReset)) return 'week'
  if (full(l.five, l.fiveReset)) return 'five'
  // Eben zurückgesetzt: Fenster war voll, der Reset-Zeitpunkt ist gerade vorbei
  const back = (p?: number, reset?: number) => (p ?? 0) >= LIMIT_FULL && !!reset && now >= reset && now - reset < LIMIT_BACK_MS
  if (back(l.week, l.weekReset) || back(l.five, l.fiveReset)) return 'back'
  return ''
}

export const WAIT_LONG_MS = 10_000
export const WAIT_STRONG_MS = 60_000
export const TYPING_MS = 6_000 // kurze Tipp-Pausen beenden das Mitlesen/Mitschreiben nicht
export const ENDED_MS = 4_000
/**
 * Nachlauf: So lange nach dem Ende eines Tools bleibt dessen Arbeit die Stimmung, bis das nächste Tool beginnt. Read und Edit dauern
 * meist unter 0,5 s und gingen sonst in der Entprellung unter (Laptop nie zu sehen); die Denkpausen zwischen zwei Tools ließen ihn
 * alle paar Sekunden zwischen Arbeit und Grübeln wechseln (Fynn, 2026-10-06: „wechselt so mittendrin“; tools/flow.mjs).
 */
export const TOOL_LINGER_MS = 8_000

export const NO_FACTS: Facts = { turnActive: false, tool: null, ask: false, typingAt: 0, endedAt: 0, endedKind: '' }

/** Tool-Name → Art (SPEC → Stimmungen). Unbekannte Tools (z. B. MCP) zählen als "denkt". */
export function toolKind(tool: string): ToolKind {
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
      return 'read'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'write'
    case 'Bash':
    case 'PowerShell':
      return 'shell'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    case 'Task':
    case 'Agent':
      return 'agent'
    default:
      return 'think'
  }
}

const WORK: Record<ToolKind, string> = {
  read: 'work_read', write: 'work_write', shell: 'work_shell', web: 'work_web', agent: 'work_agent', think: 'work_think',
  git: 'work_git', test: 'work_test',
}

// ---- Laune (Fynn: "dass sich das ein bisschen steigern kann")
//
// Neben der Stimmung (was er gerade tut) hat er eine Laune, die sich über die Sitzung aufbaut und langsam wieder abklingt:
//   - Frust: jeder Rückschlag (Tool meldet Fehler, Tool abgelehnt, Turn endet nicht mit einer Antwort) zählt, ältere weniger
//     (Halbwertszeit FRUST_HALF_MS). Ein erfolgreicher Turn ohne Fehler baut ihn wieder ab.
//   - Müdigkeit: wie lange am Stück gearbeitet wurde (Turn-Zeit), ohne längere Pause (BREAK_MS). Das ist der Näherungswert für
//     "schon länger an demselben Feature": den Inhalt der Arbeit sieht der Mod nicht und liest ihn auch nicht.
//   - Gute Laune: mehrere erfolgreiche Turns in Folge.
// Gelesen werden nur Ereignisse und die Markierung `isError` eines Tool-Ergebnisses (types:12028), nie Texte.

export const FRUST_HALF_MS = 20 * 60_000
export const BREAK_MS = 20 * 60_000
export const TIRED_FROM_MS = 45 * 60_000
export const TIRED_FULL_MS = 120 * 60_000

export const SETBACK = { toolError: 1, denied: 0.5, turnFailed: 2, success: -1.5 } as const

export type Strain = {
  /** Rückschläge und Erfolge: [Zeitpunkt ms, Gewicht] (Erfolge negativ), die letzten 24. */
  hits: readonly (readonly [number, number])[]
  /** Arbeitszeit am Stück (ms, abgeschlossene Turns) und Ende des letzten Turns. */
  workMs: number
  lastWorkAt: number
  /** Beginn des laufenden Turns (0 = keiner). */
  turnSince: number
  /** Erfolgreiche Turns in Folge (ohne Fehler). */
  streak: number
}

export const NO_STRAIN: Strain = { hits: [], workMs: 0, lastWorkAt: 0, turnSince: 0, streak: 0 }

export function addHit(s: Strain, now: number, w: number): Strain {
  return { ...s, hits: [...s.hits, [now, w] as const].slice(-24) }
}

/** Turn beginnt: nach einer langen Pause fängt die Arbeitszeit am Stück neu an. */
export function strainTurnStart(s: Strain, now: number): Strain {
  const fresh = s.lastWorkAt && now - s.lastWorkAt > BREAK_MS
  return { ...s, workMs: fresh ? 0 : s.workMs, turnSince: now }
}

/** Turn endet: Arbeitszeit aufaddieren, Erfolg oder Rückschlag verbuchen. `clean` = ohne Tool-Fehler im Turn. */
export function strainTurnEnd(s: Strain, now: number, ok: boolean, clean: boolean): Strain {
  const worked = s.turnSince ? Math.max(0, now - s.turnSince) : 0
  const base = { ...s, workMs: s.workMs + worked, lastWorkAt: now, turnSince: 0 }
  if (!ok) return { ...addHit(base, now, SETBACK.turnFailed), streak: 0 }
  if (!clean) return { ...base, streak: 0 }
  return { ...addHit(base, now, SETBACK.success), streak: base.streak + 1 }
}

export type Temper = {
  /** -1 (sehr gereizt) … 0 (normal) … +1 (bester Laune). */
  temper: number
  /** 0 … 1 */
  tired: number
}

/** Laune zur Zeit `now`. Rein und deterministisch (Client rechnet sie auf seiner Uhr). */
export function deriveTemper(s: Strain, now: number): Temper {
  let sum = 0
  // In zeitlicher Reihenfolge, nie unter 0: Erfolge bauen Frust ab, sammeln aber kein Guthaben gegen spätere Rückschläge an
  for (const [t, w] of s.hits) sum = Math.max(0, sum + w * Math.pow(0.5, Math.max(0, now - t) / FRUST_HALF_MS))
  const frust = 1 - Math.exp(-sum / 3)
  const good = Math.min(1, s.streak / 5) * (1 - frust)
  const running = s.turnSince ? Math.max(0, now - s.turnSince) : 0
  const pause = s.lastWorkAt && !s.turnSince ? now - s.lastWorkAt : 0
  const work = pause > BREAK_MS ? 0 : s.workMs + running
  const tired = Math.max(0, Math.min(1, (work - TIRED_FROM_MS) / (TIRED_FULL_MS - TIRED_FROM_MS)))
  return { temper: Math.max(-1, Math.min(1, good - frust)), tired }
}

/** Ab so langer offener Rückfrage wird er deutlicher (klopft an die Eingabe). */
export const WAIT_ASK_LONG_MS = 45_000
/** Jede so vielte erfolgreiche Antwort in Folge ist eine Marke für den Pokal. */
export const STREAK_STEP = 5

/**
 * Besonderer Tag aus Datum und Geburtstag ("TT.MM.", userConfig `birthday`): Geburtstag den ganzen Tag, Silvester vom 31.12.
 * 18 Uhr bis 1.1. 12 Uhr. Lokale Zeit der Hooks-Uhr.
 */
export function specialDay(now: number, birthday: string): '' | 'birthday' | 'newyear' {
  const d = new Date(now)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const h = d.getHours()
  const b = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(birthday.trim())
  if (b && Number(b[1]) === day && Number(b[2]) === m) return 'birthday'
  if ((m === 12 && day === 31 && h >= 18) || (m === 1 && day === 1 && h < 12)) return 'newyear'
  return ''
}

/** So lange nach dem Start eines Skills zeigt er ihn (ms). */
export const SKILL_MS = 4_000
/** So lange nach dem Start eines neuen Chats durch sidekick freut er sich darüber (ms). */
export const SK_FRESH_MS = 6_000
/**
 * Sicherheitsnetz, falls sidekick einen Zustand nicht mehr zurücksetzt (z. B. Neuladen mitten in der Prüfung): so lange gilt er
 * höchstens (ms). Die Prüfung dauert sonst 1–6 s, der Dialog wartet auf Fynn, die Übergabe braucht bis ~45 s.
 */
export const SK_MAX_MS = { check: 30_000, stop: 10 * 60_000, handoff: 3 * 60_000, fresh: SK_FRESH_MS, hint: 4_000, upkeep: 5_000 } as const
/** Wert `tune-strip.playing` prüfen (ein fremder Mod könnte ihn umschreiben): nur `{ playing: true }` heißt Musik. */
export function musicValue(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { playing?: unknown }).playing === true
}

export type BeatValue = { bpm: number; at: number; sure: boolean; group: 'calm' | 'groove' | 'hard' | 'sad' | null }
const BEAT_GROUPS = ['calm', 'groove', 'hard', 'sad'] as const

/**
 * Wert `tune-strip.beat` streng prüfen (0.11.0; ein fremder Mod könnte ihn umschreiben): `bpm` 60–150, `at` endliche Zahl, `sure`
 * boolesch, `group` eine der vier oder `null`. Alles andere heißt „ohne Takt“ (`undefined`).
 */
export function beatValue(v: unknown): BeatValue | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.bpm !== 'number' || !Number.isFinite(o.bpm) || o.bpm < 60 || o.bpm > 150) return undefined
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined
  if (typeof o.sure !== 'boolean') return undefined
  const group = o.group === null ? null : BEAT_GROUPS.find((g) => g === o.group)
  if (group === undefined) return undefined
  return { bpm: o.bpm, at: o.at, sure: o.sure, group }
}

/**
 * Schlagraster in Ticks der Engine (0.11.0): `nextTick` ist der Tick, dessen Bild zur Uhrzeit `now` zu sehen ist. Nur mit sicherem
 * Takt; sonst `null` (dann wippt er im festen Tempo wie 0.9.x).
 */
export function beatGrid(b: BeatValue | undefined, now: number, nextTick: number, tickMs: number): { t0: number; per: number } | null {
  if (!b || !b.sure) return null
  return { t0: nextTick + (b.at - now) / tickMs, per: 60000 / b.bpm / tickMs }
}

/** Gruppe für die Engine: sobald tune-strip sie entschieden hat, auch ohne sicheren Takt (0.12.0, Nachtrag „Gruppe auch ohne sicheren Takt“). */
export const beatGroup = (b: BeatValue | undefined): BeatValue['group'] => (b ? b.group : null)

export type SidekickWhy = 'cold' | 'wrong' | 'model' | 'rewrite' | 'topic'
/** `sidekick.buddy` (types/index.d.ts): was sidekick gerade tut; 0.13.0 dazu `hint`, `upkeep` und der Grund einer Rückfrage (`why`). */
export type SidekickBuddy = { kind: 'check' | 'stop' | 'handoff' | 'fresh' | 'hint' | 'upkeep'; at: number; why?: SidekickWhy }
const SK_KINDS = ['check', 'stop', 'handoff', 'fresh', 'hint', 'upkeep'] as const
const SK_WHYS = ['cold', 'wrong', 'model', 'rewrite', 'topic'] as const

/**
 * Nur gültige Werte von sidekick übernehmen (ein dritter Mod könnte ihn umschreiben, Review K2), sonst `null`. Ein Grund zählt nur bei
 * `stop` und nur, wenn er bekannt ist; sonst bleibt es die Rückfrage ohne Grund (0.13.0, SPEC Teil B).
 */
export function sidekickValue(v: unknown): Facts['sidekick'] {
  if (!v || typeof v !== 'object') return null
  const o = v as { kind?: unknown; at?: unknown; why?: unknown }
  const kind = SK_KINDS.find((k) => k === o.kind)
  if (!kind || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  const why = kind === 'stop' ? SK_WHYS.find((w) => w === o.why) : undefined
  return why ? { kind, at: o.at, why } : { kind, at: o.at }
}

/**
 * `sidekick.status` streng lesen (0.13.0, SPEC Teil C): nur `level` und `cold`, alles andere bleibt ungelesen. `null` = fehlt oder ungültig.
 * `cold` zählt nur als `true`.
 */
export function sidekickStatus(v: unknown): { level: 'off' | 'cache' | 'guide'; cold: boolean } | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { level?: unknown; cold?: unknown }
  const level = (['off', 'cache', 'guide'] as const).find((l) => l === o.level)
  return level ? { level, cold: o.cold === true } : null
}

// ---- Eisklumpen (0.13.0, SPEC „Ausbau 0.13.0“ Teil A)

export type Frost = { at: number; src: FrostSource; cracks: number; sentAt?: number; how?: 'break' | 'melt'; level?: number }
/**
 * Woher der kalte Moment kommt: neuer Chat, fortgesetzter Chat mit abgelaufenem Cache (0.13.1), sidekick meldet kalt, eigene Schätzung
 * (60 min nach dem letzten Turn), `/clawd freeze`.
 */
export type FrostSource = 'new' | 'resume' | 'sidekick' | 'estimate' | 'manual'
/** Wahrscheinlichkeit, dass ein kalter Moment ihn einfriert (Fynn: „nicht immer, sondern nur manchmal“, etwa jedes 3. Mal). */
export const FROST_P = 1 / 3
/** Anteil „Eis zerbricht“ beim Senden; sonst schmilzt es (3 zu 1). */
export const FROST_BREAK_P = 3 / 4
/** Eigene Schätzung ohne sidekick: so lange nach dem letzten Turn gilt der Cache als kalt (Fynn: 60 min). */
export const FROST_ESTIMATE_MS = 60 * 60_000
/** So lange nach dem Senden gilt die Auftau-Stimmung (der Clip ist einmalig und spielt zu Ende, ≤ ~4,5 s). */
export const FROST_THAW_MS = 5_000
/** Kommt das Senden so kurz nach dem Beginn, entfällt das Eis ganz (es hatte sich kaum gebildet). */
export const FROST_GRACE_MS = 1_500
/** Ein neuer Tipp-Schub (eine Riss-Stufe) beginnt nach so langer Tipp-Pause. */
export const FROST_BURST_MS = 1_200

/**
 * Würfel aus einem Schlüssel (deterministisch, ein Schritt mulberry32): gleiche Uhrzeit, gleicher Wurf. So sind Tests mit fester Uhr
 * wiederholbar, und die echte Uhr streut genug. Ergebnis in [0, 1).
 */
export function frostRoll(key: number): number {
  let a = (Math.floor(key) + 0x6d2b79f5) | 0
  a = Math.imul(a ^ (a >>> 15), 1 | a)
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296
}

/**
 * Entscheidung zu einem kalten Moment (SPEC Teil A), mit dem Wurf `roll` aus [0, 1): nie im Turn, höchstens einmal pro Chat (auch nicht,
 * solange er schon im Eis steht), kein neues Einfrieren bei Musik, sonst friert er bei `roll < FROST_P` ein.
 */
export function frostDecide(o: { turnActive: boolean; chatFrozen: boolean; frozenNow: boolean; music: boolean }, roll: number): 'frozen' | 'no' | 'music' | 'already' | 'turn' {
  if (o.turnActive) return 'turn'
  if (o.chatFrozen || o.frozenNow) return 'already'
  if (o.music) return 'music'
  return roll < FROST_P ? 'frozen' : 'no'
}

/** Steht er gerade im Eis (begonnen, nicht gesendet, kein Turn)? Dann entfällt z. B. die Begrüßung (das Auftauen ist die Begrüßung). */
export function frostActive(f: Facts, now: number): boolean {
  return !!f.frost && now >= f.frost.at && f.frost.sentAt === undefined && !f.turnActive
}

/**
 * Stimmung aus dem Eis, oder `null`. Eingefroren: `frozen`, nach Rissen `frost_crack1` … 3 (Schleife, bleibt gerissen). Gesendet:
 * `frost_break` bzw. `frost_melt` mit der Riss-Stufe (…1 … 3), damit der Riss beim Auftauen nicht zurückspringt. Das Einfrieren selbst
 * (frost_in) spielt die Engine auf dem Weg ins Eis.
 */
export function frostMood(f: Facts, now: number): string | null {
  const fr = f.frost
  if (!fr || now < fr.at) return null
  if (fr.sentAt !== undefined) {
    if (now - fr.sentAt >= FROST_THAW_MS) return null
    const lv = Math.max(0, Math.min(3, fr.level ?? 0))
    return `frost_${fr.how ?? 'break'}${lv || ''}`
  }
  if (f.turnActive) return null
  const c = Math.max(0, Math.min(3, fr.cracks))
  return c ? `frost_crack${c}` : 'frozen'
}

/**
 * Füllstände des Kontextfensters (Prozent), bei denen er einmal zeigt, dass es voll wird: Zeit für `/compact` oder einen neuen Chat.
 * Jede Stufe meldet er nur einmal; fällt der Füllstand darunter (Komprimieren, `/clear`), ist sie wieder scharf.
 */
export const CTX_WARN = [70, 85] as const
/** Höchste überschrittene Warnstufe zu `percent` (0 = keine). */
export function ctxLevel(percent: number): number {
  let lvl = 0
  for (const l of CTX_WARN) if (percent >= l) lvl = l
  return lvl
}
/** Ein Turn ab dieser Dauer gilt als lang: am Ende ein erleichtertes „Puh, geschafft“ statt des normalen Abschlusses. */
export const LONG_TURN_MS = 5 * 60_000

/** Ein Komprimieren ohne Ende (Hook-Fehler) gilt nach so langer Zeit als vorbei (ms). */
export const COMPACT_MAX_MS = 5 * 60_000

/** Ein Subagent ohne Aktivität so lange gilt als beendet (falls sein Ende nicht gemeldet wurde). */
export const AGENT_STALE_MS = 600_000 // 10 min: Subagenten denken im Hintergrund auch mal länger ohne Tool-Aufruf
/** So lange nach dem Ende eines Subagenten gilt `agent_done` (ms). */
export const AGENT_DONE_MS = 4_000
/** So lange ohne Eingabe in dieser Sitzung gilt als „weg“; danach begrüßt er dich mit einer Aufsteh-Animation (statt nach Uhrzeit). */
export const AWAY_MS = 2 * 3_600_000
/** Eine Rückkehr wird nur so lange nach ihrem Zeitpunkt noch begrüßt (z. B. wenn das Band erst kurz danach gezeichnet wird). */
export const WELCOME_WINDOW_MS = 60_000

/** Zahl der laufenden Subagenten zur Zeit `now`. */
export function activeAgents(f: Facts, now: number): number {
  return (f.agents ?? []).filter((t) => now - t < AGENT_STALE_MS).length
}

/** Engine-Stimmung zu den Fakten zur Zeit `now` (ms). */
export function deriveMood(f: Facts, now: number): string {
  if (f.ask) return f.askSince && now - f.askSince >= WAIT_ASK_LONG_MS ? 'waitUserLong' : 'waitUser'
  // Eis (0.13.0): nach dem Senden zuerst der Auftau-Clip (vor sidekicks Prüfung oder Rückfrage und vor der Arbeit)
  const frost = frostMood(f, now)
  if (frost && f.frost?.sentAt !== undefined) return frost
  const sk = f.sidekick && now - f.sidekick.at < SK_MAX_MS[f.sidekick.kind] ? f.sidekick.kind : null
  // sidekick fragt Fynn (Dialog offen): wie eine Rückfrage; mit Grund eigene Momente (0.13.0, SPEC Teil B)
  if (sk === 'stop') return f.sidekick?.why ? `sk_stop_${f.sidekick.why}` : 'sk_stop'
  // Limit ausgeschöpft: Claude kann nicht arbeiten, das hat Vorrang vor allem außer einer offenen Rückfrage
  const lim = limitState(f, now)
  if (lim === 'week') return 'limit_week'
  if (lim === 'five') return 'limit_5h'
  if (lim === 'back' && !f.turnActive) return 'limit_back'
  // Komprimieren hält alles an; danach geht es mit der Arbeit weiter
  if (f.compactSince && now - f.compactSince < COMPACT_MAX_MS) return 'compact'
  // Eingefroren (0.13.0): Rückfrage, Limits und Komprimieren gehen vor, im Turn nie (frostMood)
  if (frost) return frost
  // sidekick baut einen neuen Chat bzw. hat ihn eben gestartet (der Turn darin beginnt sofort: die Freude geht kurz vor)
  if (sk === 'handoff') return 'sk_handoff'
  if (sk === 'fresh') return 'sk_fresh'
  if (sk === 'check') return 'sk_check'
  // sidekick setzt eine Hinweiszeile bzw. einen Wartungshinweis (0.13.0): kurz, einmalig
  if (sk === 'hint') return 'sk_hint'
  if (sk === 'upkeep') return 'sk_upkeep'
  if (f.skillAt && now - f.skillAt < SKILL_MS) return 'skill'
  const ownTool = f.tool && f.turnActive && f.tool.kind !== 'agent' ? f.tool : null
  // Commits und Checks haben eigene Warte-Animationen: dort kein Wechsel ins allgemeine Warten
  if (ownTool && ownTool.kind !== 'git' && ownTool.kind !== 'test') {
    const age = now - ownTool.since
    if (age >= WAIT_STRONG_MS) return 'wait60'
    if (age >= WAIT_LONG_MS) return 'wait10'
  }
  const agents = activeAgents(f, now)
  // Ein Subagent ist eben fertig: sein Helfer bringt ein Geschenk (einmalig, vor eigener Arbeit und Schwarm)
  if (f.agentDoneAt && now - f.agentDoneAt < AGENT_DONE_MS) return 'agent_done'
  if (ownTool) return WORK[ownTool.kind]
  const linger = f.turnActive && !f.tool && f.lastTool && f.lastTool.kind !== 'agent' && now - f.lastTool.endedAt < TOOL_LINGER_MS
  if (linger) return WORK[f.lastTool!.kind]
  // Erfolgsserie erreicht eine Marke: einmal Pokal/Medaille (statt des normalen „fertig“)
  // Kontext wird voll: wichtiger als Pokal und Fertig (Fynn sieht, dass bald komprimiert werden sollte)
  if (!f.turnActive && f.ctxAt && now - f.ctxAt < ENDED_MS) return 'ctx_full'
  if (!f.turnActive && f.streakAt && now - f.streakAt < ENDED_MS) return 'streak'
  if (!f.turnActive && f.endedKind && now - f.endedAt < ENDED_MS) return f.endedKind === 'done' && (f.turnMs ?? 0) >= LONG_TURN_MS ? 'done_long' : f.endedKind
  if (agents > 0) return 'work_agent'
  if (f.turnActive) return WORK[f.tool?.kind ?? 'think']
  if (f.typingAt && now - f.typingAt < TYPING_MS) return 'watching'
  return 'idle'
}
