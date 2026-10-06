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

/** Ein Subagent ohne Aktivität so lange gilt als beendet (falls sein Ende nicht gemeldet wurde). */
export const AGENT_STALE_MS = 600_000 // 10 min: Subagenten denken im Hintergrund auch mal länger ohne Tool-Aufruf
/** Ab so vielen gleichzeitig laufenden Subagenten: Schwarm (Fynn: "ganz, ganz viele, ein bisschen übertrieben"). */
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
  // Limit ausgeschöpft: Claude kann nicht arbeiten, das hat Vorrang vor allem außer einer offenen Rückfrage
  const lim = limitState(f, now)
  if (lim === 'week') return 'limit_week'
  if (lim === 'five') return 'limit_5h'
  if (lim === 'back' && !f.turnActive) return 'limit_back'
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
  // Erfolgsserie erreicht eine Marke: einmal Pokal/Medaille (statt des normalen „fertig“)
  if (!f.turnActive && f.streakAt && now - f.streakAt < ENDED_MS) return 'streak'
  if (!f.turnActive && f.endedKind && now - f.endedAt < ENDED_MS) return f.endedKind
  if (agents > 0) return 'work_agent'
  if (f.turnActive) return WORK[f.tool?.kind ?? 'think']
  if (f.typingAt && now - f.typingAt < TYPING_MS) return 'watching'
  return 'idle'
}
