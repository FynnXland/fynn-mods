// worklist: To-do-Seitenleiste neben dem Chat (SPEC.md). Fynn reiht To-dos ein, auch während Claude arbeitet. Ist Claude nach
// der Prüfung „sicher frei“ (check.ts, Stufen 1–9, Stufe 10 hier) fertig, wird das laufende To-do abgehakt, wandert in den
// projektweiten Verlauf, und das nächste startet über den einmaligen Timer. Sonst hält die Liste an: Toast und Hinweisblock.
// Ab 0.4.0 läuft die Liste standardmäßig: worklist pausiert nie von sich aus, Einreihen bei freiem Claude startet, und nichts
// wird übersprungen („Fortsetzen“ behält die Reihenfolge, Antworten über andere Mods zählen als Fynns Antwort).
// Im Zweifel wird nie gesendet. Alle beobachtenden Hooks geben das Ergebnis von next(e) unverändert weiter. Kontext hängt
// worklist nur an seine eigenen To-dos und an Fynns Antwort auf die Rückfrage eines To-dos (unsichtbarer Hinweis). Beim Modell
// kommt genau der To-do-Text an; ein To-do, das mit `/name` beginnt, läuft als Befehl. Texte auf Englisch oder Deutsch (i18n.ts).
// Vorbild für Ideen und Abläufe: arbeitsliste (nikisge/niklas-mods, ohne Lizenz, kein Code übernommen).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { AGENT_TASKS, BUSY_STATUS, decideHaiku, decideRules, filterStop, haikuCost, haikuPrompt, haikuSystem, otherBackground, parseHaiku } from './check.ts'
import type { Decision, StopFacts } from './check.ts'
import { ANSWER_HINTS, CONTINUE_TEXTS, DONE_HINTS, T, cents, hhmm, shortDate } from './i18n.ts'
import type { Strings } from './i18n.ts'
import {
  add,
  cleanCost,
  cleanHistory,
  cleanQueue,
  cleanSent,
  cleanSettings,
  cleanText,
  commandOfTurn,
  findSent,
  firstSentence,
  freshRuntime,
  hideDoneMarker,
  isTodoPrompt,
  move,
  nextOpen,
  openItems,
  parseCommand,
  parseSent,
  pushHistory,
  pushSent,
  remove,
  reopen,
  running,
  setStatus,
  skipToEnd,
  textHash,
  toFront,
} from './model.ts'
import type { Cost, HistoryEntry, Queue, Runtime, Settings, Todo } from './model.ts'
import { ORANGE, clamp, clock, duration, renderPane } from './view.ts'
import type { Actions, Control, NoticeKind, NowView, StatusLine, View } from './view.ts'

const PANE = 'worklist'
const TITLE = 'To-dos'
// Fynns eigene Nachrichten: im Desktop `composer`, in -p/SDK `sdk`, vom Handy `bridge` (types: PromptOrigin)
const FYNN = ['composer', 'sdk', 'bridge']
// Herkünfte, bei denen eine To-do-Zeile im Chat am Text erkannt wird (der Desktop meldet worklists To-dos als `sdk`). Ohne
// `composer`: Das ist im Desktop Fynns eigene Eingabe; tippt er den Text eines To-dos nach, bleibt es seine Nachricht
const TEXT_ORIGINS = ['sdk', 'bridge', 'unclassified']
// Nach einem Knopfdruck kurz warten statt der vollen Beruhigungszeit: Fynn hat selbst entschieden
const PRESS_SETTLE_MS = 300
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']
// Nach der Rückkehr von $.command.run: so lange auf den Turn warten, den ein Skill-Befehl auslöst. Im Prototyp (CLI 2.1.290)
// kam dessen prompt.submit 6 ms, sein turn.start 100 ms nach der Rückkehr. Lokale Befehle (/cost) lösen keinen aus.
const CMD_TURN_WAIT_MS = 1500
// Befehle von worklist selbst: $.command.run überspringt den eigenen Hook (Debug-Log: „command.run skipped: re-entry“)
const OWN_COMMANDS = ['todo', 'todos']
// Ein /todo, das so kurz nach einem Turn-Ende kommt, hat Fynn während dieses Turns getippt: Der Desktop hält es bis zum
// Turn-Ende in seiner Warteschlange und führt es 20 ms danach aus (SPEC 0.4.3, Phase 0, Runde 3)
const LATE_MS = 3000
// Warten auf Hintergrundarbeit (SPEC 0.4.2): Helfer alle 10 s nachprüfen, bei Shells, Monitoren, Weckaufträgen nach 2 Minuten fragen
const WAIT_CHECK_MS = 10_000
const WAIT_LIMIT_MS = 120_000

// $.state: Laufzustand über einen Hot Reload hinweg (types/index.d.ts)
const rtAtom = atom({ plugin: 'worklist', key: 'rt' }, freshRuntime(''))
// Neuzeichnen nur der Seitenleiste: Sie liest diesen Zähler beim Zeichnen und abonniert ihn so; ein Schreiben zeichnet nur sie neu
// (docs/raw/en/interface.md:716). $.ui.invalidate('ui.render') zeichnete dagegen auch jede Nachricht im Chat neu, weil die
// UserMessage- und AssistantMessage-Matcher keine requestId nennen (types: $.ui.invalidate); im Desktop flackerte so die
// Hover-Leiste der Nachrichten (Kopieren, Neu senden, Forken), solange Claude arbeitete.
const paintAtom = atom({ plugin: 'worklist', key: 'paint' }, 0)

// ---------- Zustand (Modul) ----------

let settings: Settings = cleanSettings({})
let root = ''
let q: Queue = { items: [], paused: false }
let history: HistoryEntry[] = []
let cost: Cost = { usd: 0, calls: 0 }
let rt: Runtime = freshRuntime('')

// Pro Turn, flüchtig (nicht in $.state: reine Anzeige bzw. bis zum Turn-Ende)
let activity = ''
let stop: StopFacts | null = null
let stopFailure = false
let lastToolError = false
let filesChanged = false
// Kommt die nächste Nachricht von Fynn? null: noch keine gesehen (worklists eigene sieht prompt.submit nicht)
let pendingFynn: boolean | null = null
let settle: Timer | null = null
let waitTimer: Timer | null = null
let lastDecision = '–'
let lastHaiku = '–'
// Fakten des letzten Turn-Endes (nur im Speicher): für die Prüfung, wenn danach ein To-do eingereiht wird
let lastSnap: Snapshot | null = null
// Unsichtbarer Schluss-Hinweis: Prüfsumme des gerade gesendeten To-dos, bis classic.UserPromptSubmit ihn anhängt
let hintFor: string | null = null
let lastHint: '' | 'attached' | 'missing' = ''
// Unsichtbarer Hinweis an Fynns Antwort auf die Rückfrage eines To-dos (0.4.0): Prüfsumme der Antwort und To-do-Text
let answerHint: { h: string; todo: string } | null = null
let answerInFlight = false
// Befehls-To-do: dessen prompt.submit (Skill-Befehl, Herkunft worklist) ist schon durch, der Turn folgt gleich
let cmdPrompt = false
let storeWarned = false
let draft = ''
let historyOpen = false
let historyAll = false
let inputGen = 0
const inputKey = () => (inputGen === 0 ? 'new-todo' : `new-todo-${inputGen}`)

// Zeichnen
const cache = new Map<string, { sig: string; node: RenderNode }>()
let ticker: Timer | null = null
let rendered = false
let nowMs = 0

/** Texte in der eingestellten Sprache. */
function tx(): Strings {
  return T[settings.lang]
}

/**
 * Von Fynn: seine eigene Eingabe (`composer`, `sdk`, `bridge`) oder eine Nachricht, die ein anderer Mod auf seinen Klick als
 * seine eigene sendet (`plugin` mit `asUser`, z. B. sidekicks Fassung, quick-replies; types: PromptOrigin, PromptSubmitArgs.asUser).
 * Belegt im Desktop: quick-replies kommt als `plugin:quick-replies+asUser` (SPEC 0.4.3, Runde 2). Peers, Kanäle,
 * Benachrichtigungen und worklist selbst zählen nicht.
 */
function isFynn(o: { kind: string }): boolean {
  if (FYNN.includes(o.kind)) return true
  const p = o as { kind: string; name?: string; asUser?: boolean }
  return p.kind === 'plugin' && p.asUser === true && p.name !== 'worklist'
}

// ---------- Hilfen ----------

/** Einmaliger Timer: erster Tick, dann cancel. Nie aus einem Hook heraus senden (SPEC → Lehren, Punkt 5). */
function once($: EngineInterface, ms: number, fn: () => void): Timer {
  const t = $.clock.every(ms, () => {
    t.cancel()
    fn()
  })
  return t
}

function redraw($: EngineInterface) {
  update($, paintAtom, (n) => n + 1).catch((err: unknown) => $.ui.log(`worklist: redraw: ${String(err)}`, { to: 'debug' }))
}

async function persist($: EngineInterface) {
  try {
    await update($, rtAtom, () => rt)
  } catch (err) {
    $.ui.log(`worklist: state not saved: ${String(err)}`, { to: 'debug' })
  }
}

/** Gespeicherte Liste lesen; ohne Store (Fehler) eine leere, die nur im Speicher lebt. */
async function loadQueue($: EngineInterface, sid: string): Promise<Queue> {
  return cleanQueue(await loadSafe($, `queue:${sid}`))
}

async function loadSafe($: EngineInterface, key: string): Promise<unknown> {
  try {
    return await $.store.get(key)
  } catch (err) {
    $.ui.log(`worklist: ${key} not read: ${String(err)}`, { to: 'debug' })
    return undefined
  }
}

async function saveQueue($: EngineInterface) {
  try {
    // Leere Liste: Schlüssel löschen statt liegen lassen; der Store hat 4 MiB für alles
    if (q.items.length === 0) await $.store.delete(`queue:${rt.sid}`)
    else await $.store.set(`queue:${rt.sid}`, q)
  } catch (err) {
    $.ui.log(`worklist: list not saved: ${String(err)}`, { to: 'debug' })
    warnStore($)
  }
}

/** Gesendete To-dos dieses Chats sichern: Daran erkennt die Zeile im Chat sie auch nach Resume wieder. */
async function saveSent($: EngineInterface) {
  try {
    await $.store.set(`sent:${rt.sid}`, rt.sent)
  } catch (err) {
    $.ui.log(`worklist: sent list not saved: ${String(err)}`, { to: 'debug' })
    warnStore($)
  }
}

/** Speichern scheitert (z. B. 4 MiB voll): einmal pro Prozess Bescheid geben, die Liste lebt dann nur im Speicher. */
function warnStore($: EngineInterface) {
  if (storeWarned) return
  storeWarned = true
  $.ui.toast(tx().storeWarn, { timeoutMs: 8000 })
}

/** Nach jeder Änderung: speichern, Laufzustand sichern, neu zeichnen. */
async function commit($: EngineInterface) {
  redraw($)
  await saveQueue($)
  await persist($)
}

async function now($: EngineInterface): Promise<number> {
  nowMs = await $.clock.now()
  return nowMs
}

/** Fynn hat gehandelt (Nachricht, Knopf, Befehl, Eingabe): Zähler für maxAutoRun zurück. */
function fynnActed() {
  rt.autoRun = 0
}

function cancelSettle() {
  settle?.cancel()
  settle = null
  if (rt.state === 'checking') rt.state = 'idle'
}

async function busyAgents($: EngineInterface): Promise<string[]> {
  const list = await $.agent.list()
  return list.filter((a) => BUSY_STATUS.includes(a.status)).map((a) => a.description || a.type || a.id)
}

/** Nach dem Neustart bzw. Wechsel des Chats: Laufzustand neu; offene To-dos warten im Prüfstand `fresh` (0.4.0, nicht pausiert). */
function freshStart(sid: string) {
  rt = freshRuntime(sid)
  // Ein laufendes To-do zurück auf offen, an seinem Platz. Pausiert bleibt die Liste nur, wenn Fynn sie pausiert hatte
  const r = running(q)
  if (r) q = reopen(q, r.id)
  if (openItems(q).length > 0) rt.state = 'fresh'
}

/** Nach /clear gibt es eine neue Session-ID ohne session.start. Liefert true, wenn gewechselt wurde. */
async function syncSession($: EngineInterface): Promise<boolean> {
  const id = await $.session.id()
  if (id === rt.sid) return false
  cancelSettle()
  stopWaitTimer()
  hintFor = null
  answerHint = null
  q = await loadQueue($, id)
  freshStart(id)
  rt.sent = cleanSent(await loadSafe($, `sent:${id}`))
  activity = ''
  stop = null
  await commit($)
  return true
}

/** Hinweisblock setzen, Toast, Seitenleiste öffnen (SPEC → Benachrichtigung). */
function raise($: EngineInterface, reason: string, todoId: string | null, kind?: 'background') {
  rt.notice = { reason, todoId, ...(kind ? { kind } : {}) }
  rt.state = kind ? 'waiting' : 'ask'
  if (!kind) rt.stateReason = reason
  $.ui.toast(kind ? reason : tx().stopped(reason), { timeoutMs: 8000 })
  $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}

// ---------- Verlauf ----------

async function addHistory($: EngineInterface, todo: Todo, how: 'auto' | 'manual', result: string) {
  const t = await now($)
  const entry: HistoryEntry = {
    // Gekürzt: 300 Einträge × langer Text passen sonst kaum in die 4 MiB des Stores
    text: clamp(todo.text, 200, 1),
    doneAt: t,
    durationMs: Math.max(0, t - (todo.startedAt ?? t)),
    sessionId: rt.sid,
    result,
    how,
  }
  try {
    // Vor dem Schreiben neu lesen: alle Chats des Projekts teilen den Verlauf (docs/raw/en/interface.md:818-823)
    history = pushHistory(cleanHistory(await $.store.get(`history:${root}`)), entry)
    await $.store.set(`history:${root}`, history)
  } catch (err) {
    history = pushHistory(history, entry)
    $.ui.log(`worklist: history not saved: ${String(err)}`, { to: 'debug' })
    warnStore($)
  }
}

/** To-do abhaken: aus der Liste in den Verlauf. Das Kurz-Ergebnis gehört nur dazu, wenn die letzte Antwort diesem To-do galt. */
async function finish($: EngineInterface, todo: Todo, how: 'auto' | 'manual') {
  q = remove(q, todo.id)
  rt.sessionDone += 1
  if (rt.strikes.id === todo.id) rt.strikes = { id: '', n: 0 }
  await addHistory($, todo, how, !rt.busy && rt.turn.todoId === todo.id ? rt.lastResult : '')
}

// ---------- Senden (Stufe 10 und danach) ----------

/** Startet das nächste To-do, wenn nichts dagegen spricht: über die Beruhigungszeit (Stufe 10). */
function tryStartNext($: EngineInterface, why: 'auto' | 'manual', settleMs: number) {
  if (q.paused || rt.notice || rt.hold || rt.busy) return
  if (!nextOpen(q)) {
    rt.state = 'idle'
    return
  }
  if (why === 'auto' && rt.autoRun >= settings.maxAutoRun) {
    raise($, tx().maxAutoRun(settings.maxAutoRun), null)
    return
  }
  cancelSettle()
  rt.state = 'checking'
  rt.stateReason = tx().nextStarting
  const seq = rt.turnSeq
  const sid = rt.sid
  const t = once($, settleMs, () => {
    if (settle !== t) return
    settle = null
    void afterSettle($, why, seq, sid, null)
  })
  settle = t
}

/**
 * Stufe 10: nach der Beruhigungszeit erneut prüfen, erst dann senden. Mit `cont` die Fortsetzung genau dieses laufenden
 * To-dos (Knopf „Fortsetzen“) statt des nächsten offenen.
 */
async function afterSettle($: EngineInterface, why: 'auto' | 'manual', seq: number, sid: string, cont: string | null) {
  try {
    // Neuer Turn, Pause oder Hinweis während der Wartezeit: nicht senden
    if (rt.turnSeq !== seq || rt.busy || q.paused || rt.notice || rt.hold) {
      if (rt.state === 'checking') rt.state = 'idle'
      return
    }
    // Session gewechselt (/clear): nie das To-do des alten Chats senden
    if ((await $.session.id()) !== sid || rt.sid !== sid) {
      await syncSession($)
      return
    }
    // Neue Hintergrundarbeit seit der Prüfung
    const agents = await busyAgents($)
    if (rt.turnSeq !== seq || rt.busy) return
    if (agents.length > 0) {
      startWaiting($, { outcome: 'WARTEN', stage: 4, reason: tx().waitingHelpers(agents), short: tx().helpers(agents.length) })
      return
    }
    if (cont) {
      const todo = running(q)
      if (todo && todo.id === cont) await sendContinue($, todo)
      else rt.state = 'idle'
      return
    }
    const todo = nextOpen(q)
    if (!todo) {
      rt.state = 'idle'
      return
    }
    await send($, todo, why)
  } catch (err) {
    rt.state = 'idle'
    $.ui.log(`worklist: sending stopped: ${String(err)}`, { to: 'debug' })
  } finally {
    redraw($)
    await persist($)
  }
}

async function send($: EngineInterface, todo: Todo, why: 'auto' | 'manual') {
  const command = parseCommand(todo.text)
  let name = ''
  let listed = false
  if (command) {
    // Befehl: erst nachschlagen. worklists eigene Befehle → Hinweis und Halt; ein unbekannter scheitert unten an $.command.run
    const found = await findCommand($, command.name)
    if (found.problem) {
      raise($, found.problem, todo.id)
      await commit($)
      return
    }
    name = found.name ?? command.name
    listed = found.listed ?? false
  }
  const t = await now($)
  const n = rt.sessionDone + 1
  const m = rt.sessionDone + q.items.length
  q = setStatus(q, todo.id, 'running', t)
  rt.expectOwn = todo.id
  rt.plan = []
  rt.state = 'idle'
  rt.stateReason = ''
  if (why === 'auto') rt.autoRun += 1
  // Merken, was gesendet wurde: turn.start und die Zeile im Chat erkennen das To-do am genauen Text (ohne Präfix)
  rt.sent = pushSent(rt.sent, { id: todo.id, h: textHash(command ? `/${name}${command.args ? ` ${command.args}` : ''}` : todo.text), n, m })
  await saveSent($)
  await commit($)
  if (command) {
    await runCommand($, todo, name, command.args, listed)
    return
  }
  await submit($, todo.id, todo.text)
}

/**
 * „Fortsetzen“ bei einem To-do, das mit einer Rückfrage anhält (SPEC 0.4.2): eine kurze Fortsetzung für **dasselbe** To-do,
 * mit dem unsichtbaren Schluss-Hinweis. Die Reihenfolge bleibt; der Schleifenschutz zählt weiter.
 */
async function sendContinue($: EngineInterface, todo: Todo) {
  const text = CONTINUE_TEXTS[settings.lang]
  const prev = rt.sent.filter((r) => r.id === todo.id).at(-1)
  const n = prev?.n ?? rt.sessionDone + 1
  const m = prev?.m ?? rt.sessionDone + q.items.length
  rt.expectOwn = todo.id
  rt.state = 'idle'
  rt.stateReason = ''
  rt.sent = pushSent(rt.sent, { id: todo.id, h: textHash(text), n, m, c: true })
  await saveSent($)
  await commit($)
  await submit($, todo.id, text)
}

/** Text als Fynns Nachricht senden; der Schluss-Hinweis geht unsichtbar mit (classic.UserPromptSubmit unten). */
async function submit($: EngineInterface, id: string, text: string) {
  hintFor = settings.doneLine ? textHash(text) : null
  lastHint = settings.doneLine ? 'missing' : ''
  try {
    // Mit asUser liest Claude das To-do als Fynns Nachricht (types: PromptSubmitArgs). worklists eigener prompt.submit-Hook
    // sieht es nicht: Das Debug-Log meldet „prompt.submit skipped: re-entry (the plugin's own code raised it)“
    const r = await $.prompt.submit({ text, asUser: true })
    if ('drop' in r && r.drop !== undefined) await sendFailed($, id, tx().sendRejected(r.drop))
  } catch (err) {
    await sendFailed($, id, tx().sendFailed(String(err)))
  }
}

async function sendFailed($: EngineInterface, id: string, reason: string) {
  q = reopen(q, id)
  rt.expectOwn = null
  rt.expectCmd = null
  hintFor = null
  raise($, reason, id)
  await commit($)
}

// ---------- Befehle in der Warteschlange ----------

/**
 * Den Befehl in dieser Session nachschlagen ($.command.list, types: CommandInfo): Liefert den Namen, wie die Liste ihn führt.
 * Die Liste ist nicht vollständig: `/cost` fehlte darin, lief aber über $.command.run (Smoke 0.3.0, CLI 2.1.290). Fehlt ein
 * Name, entscheidet deshalb $.command.run selbst; es lehnt unbekannte Namen ab („no command named /x“, types: $.command.run).
 */
async function findCommand(
  $: EngineInterface,
  name: string,
): Promise<{ name: string; listed: boolean; problem?: undefined } | { name?: undefined; listed?: undefined; problem: string }> {
  if (OWN_COMMANDS.includes(name.toLowerCase())) return { problem: tx().cmdOwn(name) }
  try {
    const list = await $.command.list()
    const hit = list.find((c) => c.name === name) ?? list.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (hit) return { name: hit.name, listed: true }
  } catch (err) {
    $.ui.log(`worklist: command list: ${String(err)}`, { to: 'debug' })
  }
  return { name, listed: false }
}

/**
 * Befehl ausführen statt ihn als Text zu senden (types: `$.command.run`, „queued and run once the session is idle“; ein
 * unbekannter Name wirft). Wann er als erledigt gilt (Prototyp, CLI 2.1.290): Ein Skill-Befehl kehrt sofort zurück und
 * löst danach einen Turn aus; dann entscheidet dessen Ende über die Prüfung. Ein lokaler Befehl (/cost) löst keinen aus;
 * dann ist er mit der Rückkehr erledigt.
 */
async function runCommand($: EngineInterface, todo: Todo, name: string, args: string, listed: boolean) {
  rt.expectCmd = name
  cmdPrompt = false
  const seq = rt.turnSeq
  let text = ''
  try {
    const r = await $.command.run({ command: name, args })
    text = r.text ?? ''
  } catch (err) {
    // Nicht in der Liste und abgelehnt, oder „no command named“: unbekannt. Sonst der Fehler selbst. Nie still
    const msg = String(err)
    await sendFailed($, todo.id, !listed || /no command named/i.test(msg) ? tx().cmdUnknown(name) : tx().cmdFailed(msg))
    return
  }
  once($, CMD_TURN_WAIT_MS, () => void afterCommand($, todo.id, seq, text, false))
}

/** Nach der Rückkehr eines Befehls: Kam kein Turn, gilt er als erledigt (WEITER ohne Prüfung des Texts). */
async function afterCommand($: EngineInterface, id: string, seq: number, text: string, again: boolean) {
  try {
    // Ein Turn hat begonnen: dessen Ende prüft
    if (rt.turnSeq !== seq || rt.busy || rt.expectCmd === null) return
    const todo = running(q)
    if (!todo || todo.id !== id) return
    // Sein prompt.submit ist schon durch, der Turn kommt gleich: noch einmal länger warten
    if (cmdPrompt && !again) {
      once($, CMD_TURN_WAIT_MS * 3, () => void afterCommand($, id, seq, text, true))
      return
    }
    const L = tx()
    rt.expectCmd = null
    rt.expectOwn = null
    rt.turn = { startedAt: todo.startedAt ?? 0, todoId: id, text: clamp(todo.text, 200, 1), fromFynn: false }
    rt.lastResult = firstSentence(text)
    const d: Decision = { outcome: 'WEITER', stage: 0, reason: L.cmdRan }
    lastDecision = describeDecision(await now($), d, L.ofTodo(clamp(todo.text, 40, 1)))
    await apply($, d, todo)
  } catch (err) {
    $.ui.log(`worklist: command: ${String(err)}`, { to: 'debug' })
  } finally {
    await commit($)
  }
}

// ---------- Die Prüfung am Turn-Ende ----------

type Snapshot = {
  seq: number
  reason: 'answer' | 'aborted' | 'error' | 'refusal'
  answer: string
  stop: StopFacts | null
  stopFailure: boolean
  lastToolError: boolean
  filesChanged: boolean
  todoId: string | null
  // Prüfstand fresh und der Turn kam nicht von Fynn: Er gibt die Liste nicht frei (0.4.1, Review 0.4.0 S1)
  holdFresh: boolean
}

/** Zeile „Letzte Entscheidung“ für /todos status. */
function describeDecision(t: number, d: Decision | null, what: string): string {
  const L = tx()
  return `${hhmm(t)} · ${d ? `${L.step(d.stage)} · ${L.outcome[d.outcome]} · ${d.reason}` : L.rulesUnclear} · ${what}`
}

/**
 * Stufen 1–8 mit der Hintergrundarbeit, auf die noch gewartet wird: Helfer fallen weg, sobald `$.agent.list()` keinen
 * beschäftigten mehr kennt; Aufgaben nach „Nicht mehr warten“ ebenso (0.4.0).
 */
async function rulesFor($: EngineInterface, s: Snapshot): Promise<Decision | null> {
  const agents = await busyAgents($)
  return decideRules({ ...s, stop: filterStop(s.stop, agents.length === 0, rt.ignoreBg), busyAgents: agents, plan: rt.plan }, tx())
}

/** Läuft über den einmaligen Timer nach turn.complete, nie im Hook selbst (Haiku, Senden). */
async function evaluate($: EngineInterface, s: Snapshot) {
  const L = tx()
  try {
    if (await syncSession($)) return
    // Inzwischen läuft ein neuer Turn: dessen Ende prüft neu
    if (rt.turnSeq !== s.seq || rt.busy) return
    // Hinweis offen: die Liste wartet auf Fynn (sein Chat-Turn hätte den Hinweis zurückgenommen)
    if (rt.notice) return
    const todo = s.todoId ? q.items.find((t) => t.id === s.todoId && t.status === 'running') : undefined
    // Ohne laufendes To-do und ohne etwas, das starten dürfte: nur die Regeln, ohne Haiku. Gemerkt wird, ob Claude sicher frei
    // ist; ein später eingereihtes To-do startet bei einer Rückfrage nur, wenn Fynn es nicht während dieses Turns getippt hat
    if (!todo && (openItems(q).length === 0 || q.paused)) {
      let d: Decision | null
      try {
        d = await rulesFor($, s)
      } catch (err) {
        d = { outcome: 'FRAGEN', stage: 0, reason: L.checkFailed(String(err)) }
      }
      if (rt.turnSeq !== s.seq || rt.busy || rt.notice) return
      setFree($, d)
      if (s.holdFresh && rt.state === 'idle') rt.state = 'fresh'
      // Inzwischen eingereiht bzw. Start gedrückt: jetzt mit dem Ergebnis entscheiden (eingereiht im Turn bzw. kurz danach)
      maybeStart($, true)
      lastDecision = describeDecision(await now($), d, L.listIdle)
      return
    }
    rt.state = 'checking'
    rt.stateReason = L.checking
    redraw($)
    let d: Decision
    try {
      const rules = await rulesFor($, s)
      // Ein Befehls-To-do heißt für Haiku „führe /x aus“: der Text allein wäre nur der Befehlsname
      const task = todo ? (parseCommand(todo.text) ? `Run the slash command ${todo.text}` : todo.text) : ''
      d = rules ?? (settings.haiku ? await askHaiku($, task, s) : { outcome: 'FRAGEN', stage: 9, reason: L.haikuOff })
    } catch (err) {
      // Im Zweifel nie senden (SPEC → Fehlerverhalten)
      d = { outcome: 'FRAGEN', stage: 0, reason: L.checkFailed(String(err)) }
    }
    if (rt.turnSeq !== s.seq || rt.busy || rt.notice) return
    lastDecision = describeDecision(await now($), d, todo ? L.ofTodo(clamp(todo.text, 40, 1)) : L.fromChatShort)
    $.ui.log(`worklist: ${lastDecision}`, { to: 'debug' })
    // Nach Neustart oder Chatwechsel startet nur ein Turn von Fynn die Liste, kein fremder (Benachrichtigung, Peer, Weckauftrag)
    if (!todo && s.holdFresh && d.outcome === 'WEITER') {
      rt.state = 'fresh'
      rt.stateReason = ''
      return
    }
    await apply($, d, todo)
  } catch (err) {
    $.ui.log(`worklist: check: ${String(err)}`, { to: 'debug' })
    rt.state = 'blocked'
    rt.stateReason = L.checkFailedShort
  } finally {
    await commit($)
  }
}

/** Zustand nach einem Turn-Ende ohne To-do, das starten dürfte. */
function setFree($: EngineInterface, d: Decision | null) {
  if (d?.outcome !== 'WEITER') cancelSettle()
  if (!d) {
    rt.state = 'unclear'
    rt.stateReason = ''
  } else if (d.outcome === 'WEITER') {
    rt.state = 'idle'
    rt.stateReason = ''
  } else if (d.outcome === 'WARTEN') startWaiting($, d)
  else {
    rt.state = 'blocked'
    rt.stateReason = d.reason
  }
}

/**
 * Ein To-do ist neu startbar (eingereiht, Start). Einreihen bei freiem Claude zählt als Fynns Antwort (SPEC 0.4.2): Es startet
 * auch nach einer Rückfrage (`blocked`), nach einem unklaren Turn-Ende (`unclear`, ohne Haiku) und nach dem Neustart (`fresh`).
 * Sperren bleiben: Claude arbeitet, ein Hinweis ist offen, die Liste ist pausiert, Hintergrundarbeit läuft (`waiting`) oder die
 * Prüfung des letzten Turns läuft noch (`checking`). `late`: Fynn hat während des letzten Turns eingereiht; dann gilt dessen
 * Prüfung (nach einer Rückfrage startet nichts, nach einem unklaren Ende prüft erst Haiku).
 */
function maybeStart($: EngineInterface, late: boolean, settleMs = settings.settleSeconds * 1000) {
  // Nichts offen: nichts zu starten. Ohne diese Sperre rief sich die Prüfung nach einem unklaren Turn-Ende bei leerer Liste
  // alle 10 ms selbst wieder auf (unclear → evaluate → unclear …; gefunden mit den Tests zu 0.4.0)
  if (rt.busy || rt.notice || q.paused || !nextOpen(q)) return
  if (rt.state === 'idle' || rt.state === 'fresh') tryStartNext($, 'manual', settleMs)
  else if (rt.state === 'blocked') {
    if (!late) tryStartNext($, 'manual', settleMs)
  } else if (rt.state === 'unclear') {
    if (!late) {
      tryStartNext($, 'manual', settleMs)
      return
    }
    const s = lastSnap
    if (s && s.seq === rt.turnSeq) {
      // Ab jetzt „prüft“: ein zweites Einreihen stößt keine zweite Haiku-Prüfung an
      rt.state = 'checking'
      rt.stateReason = tx().checking
      once($, 10, () => void evaluate($, s))
    } else {
      rt.state = 'blocked'
      rt.stateReason = tx().unclearFree
    }
  }
}

async function apply($: EngineInterface, d: Decision, todo: Todo | undefined) {
  if (d.outcome === 'WARTEN') {
    startWaiting($, d)
    return
  }
  if (d.outcome === 'WEITER') {
    if (todo) {
      await finish($, todo, 'auto')
      if (rt.hold) {
        // Schleifenschutz: nur Fynn setzt fort
        raise($, tx().holdTwice, null)
        return
      }
    }
    rt.state = 'idle'
    rt.stateReason = ''
    tryStartNext($, 'auto', settings.settleSeconds * 1000)
    return
  }
  // FRAGEN oder STOPP
  cancelSettle()
  if (!todo) {
    // Fynns eigener Chat-Turn: nichts startet, still (kein Toast); Einreihen, „Jetzt starten“ oder ein sauberes Turn-Ende setzt fort
    rt.state = 'blocked'
    rt.stateReason = d.reason
    return
  }
  if (d.outcome === 'STOPP') q = reopen(q, todo.id)
  rt.strikes = rt.strikes.id === todo.id ? { id: todo.id, n: rt.strikes.n + 1 } : { id: todo.id, n: 1 }
  let reason = d.reason
  if (rt.strikes.n >= 2) {
    rt.hold = true
    reason = `${reason} ${tx().secondTime}`
  }
  raise($, reason, todo.id)
}

/** Stufe 9: Haiku liest nur das Ende der Antwort und das To-do. Fehler, Timeout, Unsinn → FRAGEN. */
async function askHaiku($: EngineInterface, todoText: string, s: Snapshot): Promise<Decision> {
  const L = tx()
  const r = await $.model.complete({
    model: 'haiku',
    system: haikuSystem(L),
    prompt: haikuPrompt(todoText, s.answer, { filesChanged: s.filesChanged, toolError: s.lastToolError }),
    maxTokens: 120,
    timeoutMs: 8000,
  })
  await addCost($, haikuCost(r.usage))
  if (!r.isAnswered) {
    lastHaiku = L.noAnswer(r.reason)
    return { ...decideHaiku(null, L), reason: L.haikuFailed(r.reason) }
  }
  const v = parseHaiku(r.text)
  lastHaiku = v ? `${v.verdict} ${v.confidence.toFixed(2)} · ${v.why}` : L.unreadable(clamp(r.text, 60, 1))
  return decideHaiku(v, L)
}

async function addCost($: EngineInterface, usd: number) {
  try {
    const c = cleanCost(await $.store.get(`cost:${root}`))
    cost = { usd: c.usd + usd, calls: c.calls + 1 }
    await $.store.set(`cost:${root}`, cost)
  } catch {
    cost = { usd: cost.usd + usd, calls: cost.calls + 1 }
  }
}

// ---------- Warten auf Hintergrundarbeit, mit Grenze (SPEC 0.4.2) ----------

/** Prüfstand WARTEN: Grund merken, Wartephase beginnen (einmal), Nachprüfen alle 10 s. */
function startWaiting($: EngineInterface, d: Decision) {
  rt.state = 'waiting'
  rt.stateReason = d.reason
  rt.stateShort = d.short ?? ''
  if (!rt.waitSince) rt.waitSince = nowMs
  ensureWaitTimer($)
}

/** Nachprüfen beim Warten (alle 10 s), nur wenn die Fakten des Turn-Endes da sind und etwas auf das Ende wartet. */
function ensureWaitTimer($: EngineInterface) {
  if (waitTimer || rt.busy || rt.state !== 'waiting' || !lastSnap) return
  if (!running(q) && openItems(q).length === 0) return
  waitTimer = $.clock.every(WAIT_CHECK_MS, () => void waitTick($))
}

function stopWaitTimer() {
  waitTimer?.cancel()
  waitTimer = null
}

/**
 * Nachprüfen, solange WARTEN gilt und kein Turn läuft: Sind keine Helfer mehr beschäftigt und ist sonst nichts mehr da,
 * läuft die Prüfung erneut auf dem letzten Turn-Ende. Laufen nur noch Shells, Monitore oder Weckaufträge, kommt nach
 * 2 Minuten einmal je Wartephase der Hinweis „Nicht mehr warten?“.
 */
async function waitTick($: EngineInterface) {
  const s = lastSnap
  if (rt.busy || rt.state !== 'waiting' || !s || s.seq !== rt.turnSeq) {
    stopWaitTimer()
    return
  }
  // Der Hinweis „Nicht mehr warten?“ steht: Fynn entscheidet
  if (rt.notice) return
  // Nichts wartet auf das Ende (Liste leer): nicht weiter nachprüfen; Einreihen startet es wieder (Review 0.4.0 K4)
  if (!running(q) && openItems(q).length === 0) {
    stopWaitTimer()
    return
  }
  try {
    if (await syncSession($)) return
    const agents = await busyAgents($)
    const t = await now($)
    if (rt.busy || rt.state !== 'waiting' || rt.notice || rt.turnSeq !== s.seq) return
    const left = filterStop(s.stop, agents.length === 0, rt.ignoreBg)
    const helpers = agents.length > 0 || (left?.background.some((x) => AGENT_TASKS.includes(x.type)) ?? false)
    const other = otherBackground(left)
    if (!helpers && other.tasks.length === 0 && other.crons === 0) {
      stopWaitTimer()
      rt.state = 'checking'
      await evaluate($, s)
      return
    }
    if (helpers || rt.waitNoticed || t - rt.waitSince < WAIT_LIMIT_MS) return
    // Nur fragen, wenn etwas auf das Ende wartet (laufendes oder offenes To-do, Liste nicht pausiert)
    if (q.paused || (!running(q) && openItems(q).length === 0)) return
    rt.waitNoticed = true
    const what = [...other.tasks.map((x) => x.description || x.type), ...(other.crons > 0 ? [tx().crons(other.crons)] : [])].join(', ')
    raise($, tx().bgNotice(clamp(what, 80, 1)), running(q)?.id ?? null, 'background')
    await commit($)
  } catch (err) {
    $.ui.log(`worklist: wait: ${String(err)}`, { to: 'debug' })
  }
}

/** „Nicht mehr warten“: Die Prüfung läuft erneut, ohne Stufe 3 für genau diese Aufgaben (sie bleiben für diesen Chat ausgenommen). */
async function stopWaiting($: EngineInterface) {
  if (rt.notice?.kind !== 'background') return
  fynnActed()
  const other = otherBackground(lastSnap?.stop ?? null)
  rt.ignoreBg = [...new Set([...rt.ignoreBg, ...other.tasks.map((x) => x.id), ...(other.crons > 0 ? ['cron'] : [])])]
  rt.notice = null
  stopWaitTimer()
  const s = lastSnap
  if (s && s.seq === rt.turnSeq && !rt.busy) {
    rt.state = 'checking'
    rt.stateReason = tx().checking
    once($, 10, () => void evaluate($, s))
  } else rt.state = 'idle'
  await commit($)
}

/** „Weiter warten“: Hinweis weg, das Warten geht weiter; in dieser Wartephase fragt worklist nicht noch einmal. */
async function keepWaiting($: EngineInterface) {
  if (rt.notice?.kind !== 'background') return
  rt.notice = null
  if (lastSnap) {
    rt.state = 'waiting'
    ensureWaitTimer($)
  } else {
    // Nach einem Reload fehlen die Fakten des Turn-Endes: Fynn entscheidet per „Jetzt starten“ (Review 0.4.0 S2)
    rt.state = 'blocked'
    rt.stateReason = tx().reloadWaiting
  }
  await commit($)
}

// ---------- Fynns Aktionen ----------

async function addTodo($: EngineInterface, raw: string): Promise<Todo | null> {
  const text = cleanText(raw)
  if (!text) return null
  await syncSession($)
  fynnActed()
  const t = await now($)
  const todo: Todo = { id: `t${t.toString(36)}${q.items.length}`, text, status: 'open', createdAt: t }
  q = add(q, todo)
  // Bei freiem Claude startet es nach der Beruhigungszeit; kurz nach einem Turn-Ende gilt die Prüfung dieses Turns
  maybeStart($, !rt.busy && rt.turnEndAt > 0 && t - rt.turnEndAt < LATE_MS)
  ensureWaitTimer($)
  await commit($)
  return todo
}

function noticeTodo(): Todo | undefined {
  const id = rt.notice?.todoId ?? null
  return id ? q.items.find((t) => t.id === id) : running(q)
}

function release() {
  fynnActed()
  rt.notice = null
  rt.hold = false
  rt.state = 'idle'
  rt.stateReason = ''
  q = { ...q, paused: false }
}

type ResumeResult = 'continued' | 'resent' | 'released' | 'hold' | 'waiting' | 'none'

/**
 * „Fortsetzen“ bzw. /todos resume mit Hinweis (SPEC 0.4.2). Die Reihenfolge bleibt:
 * - To-do läuft noch (Rückfrage): kurze Fortsetzung für dasselbe To-do
 * - To-do wieder offen (STOPP): bleibt vorn und wird erneut gesendet
 * - ohne To-do (Schleifenschutz, maxAutoRun): die Sperre fällt, das nächste startet
 * Nach dem zweiten Halt am selben To-do helfen nur Fynns Antwort, Abhaken oder Überspringen. Pausiert nie.
 */
async function resume($: EngineInterface): Promise<ResumeResult> {
  const n = rt.notice
  if (!n) return 'none'
  if (n.kind === 'background') {
    await stopWaiting($)
    return 'waiting'
  }
  const t = n.todoId ? q.items.find((x) => x.id === n.todoId) : undefined
  if (rt.hold && t) {
    $.ui.toast(tx().holdNoResume, { timeoutMs: 8000 })
    return 'hold'
  }
  const strikes = rt.strikes
  release()
  // Fortsetzen zählt beim Schleifenschutz weiter (hebt nur maxAutoRun auf)
  rt.strikes = strikes
  let result: ResumeResult = 'released'
  if (t && t.status === 'running') {
    cancelSettle()
    rt.state = 'checking'
    rt.stateReason = tx().nextStarting
    const seq = rt.turnSeq
    const sid = rt.sid
    const timer = once($, PRESS_SETTLE_MS, () => {
      if (settle !== timer) return
      settle = null
      void afterSettle($, 'manual', seq, sid, t.id)
    })
    settle = timer
    result = 'continued'
  } else {
    if (t) {
      q = toFront(q, t.id)
      result = 'resent'
    }
    tryStartNext($, 'manual', PRESS_SETTLE_MS)
  }
  await commit($)
  return result
}

/** „Abhaken“ bzw. /todos done. Ohne To-do nichts tun: kein Aufheben der Pause, kein Start. */
async function markDone($: EngineInterface): Promise<Todo | undefined> {
  const t = noticeTodo()
  if (!t) return undefined
  await finish($, t, 'manual')
  release()
  tryStartNext($, 'manual', PRESS_SETTLE_MS)
  await commit($)
  return t
}

/**
 * „Überspringen“ bzw. /todos skip: ans Ende, mit der Marke „übersprungen“; das nächste startet, nichts pausiert. Ist es das
 * einzige offene, wird nichts gesendet; es wartet im Prüfstand `fresh` (startet nach Fynns nächster Nachricht oder „Start“).
 */
async function skip($: EngineInterface): Promise<Todo | undefined> {
  const t = noticeTodo()
  if (!t) return undefined
  q = skipToEnd(q, t.id)
  release()
  rt.strikes = { id: '', n: 0 }
  if (openItems(q).some((x) => x.id !== t.id)) tryStartNext($, 'manual', PRESS_SETTLE_MS)
  else rt.state = 'fresh'
  await commit($)
  return t
}

/** /todos retry: das angehaltene To-do vorn noch einmal ganz senden. Zählt beim Schleifenschutz weiter. */
async function retry($: EngineInterface): Promise<Todo | undefined> {
  const t = noticeTodo()
  if (!t) return undefined
  const strikes = rt.strikes
  q = toFront(q, t.id)
  release()
  rt.strikes = strikes
  tryStartNext($, 'manual', PRESS_SETTLE_MS)
  await commit($)
  return t
}

function control(): Control {
  if (q.paused) return 'start'
  const waits = rt.state === 'blocked' || rt.state === 'waiting' || rt.state === 'fresh' || rt.state === 'unclear'
  if (!rt.busy && !rt.notice && waits && openItems(q).length > 0) return 'go'
  return 'pause'
}

async function pressControl($: EngineInterface) {
  const c = control()
  fynnActed()
  if (c === 'pause') {
    q = { ...q, paused: true }
    cancelSettle()
  } else {
    q = { ...q, paused: false }
    if (!rt.notice) {
      rt.hold = false
      if (c === 'go') {
        // „Jetzt starten“: Fynn setzt sich bewusst über die Rückfrage bzw. die Hintergrundarbeit hinweg
        stopWaitTimer()
        rt.state = 'idle'
        rt.stateReason = ''
        tryStartNext($, 'manual', PRESS_SETTLE_MS)
      } else maybeStart($, false, PRESS_SETTLE_MS) // „Start“ nach einer Pause: wie beim Einreihen, Fynn hat entschieden
    }
  }
  await commit($)
}

/**
 * Knopf-Aktion erst nach dem Session-Abgleich: Nach /clear zeigt die Seitenleiste bis zum Neuzeichnen noch die alte Liste;
 * ein Druck darauf darf die Liste des alten Chats nicht ändern. Nach einem Wechsel wird nur neu gezeichnet.
 */
function guarded($: EngineInterface, fn: () => unknown): () => void {
  return () => {
    void syncSession($)
      .then(async (changed) => {
        if (changed) redraw($)
        else await fn()
      })
      .catch((err: unknown) => $.ui.log(`worklist: button: ${String(err)}`, { to: 'debug' }))
  }
}

function actions($: EngineInterface): Actions {
  const edit = (change: () => void) =>
    guarded($, async () => {
      fynnActed()
      change()
      await commit($)
    })
  return {
    resume: guarded($, () => resume($)),
    markDone: guarded($, () => markDone($)),
    skip: guarded($, () => skip($)),
    stopWaiting: guarded($, () => stopWaiting($)),
    keepWaiting: guarded($, () => keepWaiting($)),
    up: (id) => edit(() => (q = move(q, id, -1)))(),
    down: (id) => edit(() => (q = move(q, id, 1)))(),
    remove: (id) => edit(() => (q = remove(q, id)))(),
    add: (value) => {
      draft = ''
      // Neuer Schlüssel = neues, leeres Feld; sonst blieb der Text nach „einreihen“ stehen
      if (value.trim()) inputGen += 1
      // addTodo gleicht die Session selbst ab: Eingetipptes landet im aktuellen Chat
      void addTodo($, value)
        .then((t) => {
          if (!t) redraw($)
        })
        .catch((err: unknown) => $.ui.log(`worklist: queue: ${String(err)}`, { to: 'debug' }))
    },
    draft: (value) => {
      draft = value
    },
    control: guarded($, () => pressControl($)),
    toggleHistory: () => {
      historyOpen = !historyOpen
      redraw($)
    },
    toggleAll: () => {
      historyAll = !historyAll
      redraw($)
    },
  }
}

// ---------- Anzeige ----------

function todayStart(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** JETZT: nur, solange Claude arbeitet oder ein To-do läuft; sonst sagt die Statuszeile alles. */
function nowView(): NowView | null {
  const r = running(q)
  if (!rt.busy && !r) return null
  const isTodo = rt.busy ? rt.turn.todoId !== null : true
  const todo = isTodo ? (q.items.find((t) => t.id === (rt.turn.todoId ?? r?.id)) ?? r) : undefined
  const started = todo?.startedAt ?? rt.turn.startedAt
  return {
    kind: todo ? 'todo' : 'chat',
    index: rt.sessionDone + 1,
    total: Math.max(rt.sessionDone + q.items.length, 1),
    text: todo ? todo.text : rt.turn.text,
    // Sekunden genügen; so bleibt der Baum zwischen zwei Ticks gleich
    elapsedMs: rt.busy ? Math.floor(Math.max(0, nowMs - started) / 1000) * 1000 : 0,
    activity: rt.busy ? activity : '',
    plan: rt.plan,
    waiting: !rt.busy && rt.state === 'waiting' ? rt.stateReason : '',
    checking: !rt.busy && rt.state === 'checking',
  }
}

/** Art des Hinweises: Hintergrund, ohne To-do (Schleifenschutz, maxAutoRun), To-do läuft noch (Rückfrage) oder offen (STOPP). */
function noticeKind(): NoticeKind {
  if (rt.notice?.kind === 'background') return 'background'
  const id = rt.notice?.todoId ?? null
  if (!id) return 'hold'
  return q.items.find((t) => t.id === id)?.status === 'running' ? 'question' : 'stop'
}

/** Das To-do, dessen Rückfrage gerade offen ist (Hinweis mit laufendem To-do): Fynns Antwort gehört zu ihm. */
function questionTodo(): Todo | undefined {
  if (!rt.notice || rt.notice.kind === 'background' || !rt.notice.todoId) return undefined
  const t = q.items.find((x) => x.id === rt.notice?.todoId)
  return t?.status === 'running' ? t : undefined
}

/** Statuszeile: ein Symbol und ein Satz dazu, was gilt und was als Nächstes passiert (SPEC 0.4.4). */
function statusLine(): StatusLine {
  const L = tx()
  if (q.paused) return { icon: '⏸', text: L.stPaused, tone: 'dim' }
  if (rt.busy) {
    const elapsed = clock(Math.floor(Math.max(0, nowMs - rt.turn.startedAt) / 1000) * 1000)
    if (rt.turn.todoId) return { icon: '●', text: L.stRunning(rt.sessionDone + 1, Math.max(rt.sessionDone + q.items.length, 1), elapsed), tone: 'accent' }
    return { icon: '●', text: L.stChat(elapsed), tone: 'accent' }
  }
  if (rt.notice) {
    const kind = noticeKind()
    if (kind === 'background') return { icon: '◐', text: L.stWaiting(rt.stateShort || '…'), tone: 'strong' }
    return { icon: '◐', text: kind === 'question' ? L.stAsk : L.stStopped, tone: 'strong' }
  }
  if (rt.state === 'waiting') return { icon: '◌', text: L.stWaiting(rt.stateShort || '…'), tone: 'dim' }
  if (rt.state === 'checking') return { icon: '◌', text: L.stChecking, tone: 'dim' }
  // Gesendet, sein Turn hat noch nicht begonnen
  if (running(q)) return { icon: '●', text: L.stRunning(rt.sessionDone + 1, Math.max(rt.sessionDone + q.items.length, 1), clock(0)), tone: 'accent' }
  if (openItems(q).length === 0) return { icon: '◇', text: L.stEmpty, tone: 'dim' }
  if (rt.state === 'blocked') return { icon: '◐', text: L.stAsk, tone: 'strong' }
  if (rt.state === 'fresh') return { icon: '◇', text: L.stFresh, tone: 'dim' }
  return { icon: '◇', text: L.stNext, tone: 'dim' }
}

function view(): View {
  const total = rt.sessionDone + q.items.length
  return {
    lang: settings.lang,
    status: statusLine(),
    progress: total > 0 ? { done: rt.sessionDone, total } : null,
    now: nowView(),
    notice: rt.notice ? { kind: noticeKind(), reason: rt.notice.reason, noResume: rt.hold && rt.notice.todoId !== null } : null,
    queue: openItems(q).map((t) => ({ id: t.id, text: t.text, skipped: t.skipped === true })),
    control: control(),
    draft,
    history,
    historyOpen,
    historyAll,
    inputKey: inputKey(),
    todayStart: todayStart(nowMs),
  }
}

/** Kurz nach einem Session-Wechsel, bis die Liste des neuen Chats geladen ist. */
function switchingView(): View {
  return { ...view(), status: { icon: '◇', text: tx().stSwitching, tone: 'dim' }, progress: null, now: null, notice: null, queue: [], control: 'pause' }
}

/** Laufzeit-Uhr: höchstens jede Sekunde, nur solange gezeichnet wird und Claude arbeitet (SPEC → Flackern vermeiden). */
function ensureTicker($: EngineInterface) {
  if (ticker || !rt.busy) return
  ticker = $.clock.every(1000, () => {
    if (!rendered || !rt.busy) {
      ticker?.cancel()
      ticker = null
      return
    }
    rendered = false
    redraw($)
  })
}

// ---------- /todo und /todos ----------

function statusText(): string {
  const L = tx()
  const state = rt.busy ? L.stateWorking : L.state[rt.state]
  return [
    L.statusList(openItems(q).length, !!running(q), q.paused, rt.sessionDone),
    L.statusState(state, rt.stateReason, rt.hold),
    L.statusDecision(lastDecision),
    L.statusHaiku(settings.haiku, lastHaiku, cost.calls, cents(settings.lang, cost.usd)),
    L.statusRun(rt.autoRun, settings.maxAutoRun, settings.settleSeconds, settings.doneLine, lastHint === 'attached' ? L.hintAttached : lastHint === 'missing' ? L.hintMissing : ''),
    L.statusHistory(history.length),
  ].join('\n')
}

function historyText(): string {
  const L = tx()
  if (history.length === 0) return L.historyNone
  const lines = history.slice(0, 30).map((h) => {
    const when = `${shortDate(settings.lang, h.doneAt)} ${hhmm(h.doneAt)}`
    return `✓ ${when} · ${clamp(h.text, 70, 1)} · ${duration(h.durationMs)}${h.how === 'manual' ? ` · ${L.byHand}` : ''}${h.result ? ` · ${clamp(h.result, 60, 1)}` : ''}`
  })
  return [L.historyHead(history.length, history.length > 30), ...lines].join('\n')
}

/** Seitenleiste öffnen, Cursor ins Eingabefeld (/todo und /todos ohne Argument). */
async function openPane($: EngineInterface): Promise<{ text?: string }> {
  // Vom Nutzer ausgelöst: erscheint bei jeder Breite (docs/raw/en/interface.md:340-342)
  const r = await $.ui.open({ id: PANE, title: TITLE, focus: true })
  if (!r.isPlaced) return { text: tx().paneWaiting(r.reason) }
  // autoFocus allein setzte im Desktop den Cursor nicht: kurz nach dem Zeichnen ausdrücklich ins Feld (types: $.ui.focus).
  // Der Desktop 2.1.286 zeigt den Cursor trotzdem nicht (README → Known limits).
  once($, 50, () => {
    $.ui.focus({ requestId: PANE, key: inputKey() }).catch(() => undefined)
  })
  return {}
}

/**
 * /todo: alles hinter dem Befehl ist die Aufgabe; ohne Text öffnet es die Seitenleiste. Die Bestätigung kommt nur als Toast:
 * zurückgegebenen Befehlstext liest Claude (docs/raw/en/api.md:43), ein eingereihtes To-do soll Claude nicht sehen.
 * Während Claude arbeitet, hält der Desktop ein normal abgeschicktes /todo bis zum Turn-Ende zurück; Claude arbeitet dabei
 * weiter (SPEC 0.4.3, Phase 0, Runde 3).
 */
async function runTodo($: EngineInterface, args: string): Promise<{ text?: string }> {
  await syncSession($)
  if (args.trim() === '') return openPane($)
  const todo = await addTodo($, args)
  if (!todo) return { text: tx().help }
  $.ui.toast(tx().queued(openItems(q).length, clamp(todo.text, 80, 1)))
  return {}
}

/** /todos: Seitenleiste und alle übrigen Befehle. */
async function runTodos($: EngineInterface, args: string): Promise<{ text?: string }> {
  const L = tx()
  await syncSession($)
  const word = args.trim().toLowerCase()
  if (word === '') return openPane($)
  if (word === 'help' || word === '?') return { text: L.help }
  if (word === 'status') return { text: statusText() }
  if (word === 'history') {
    historyOpen = true
    historyAll = true
    redraw($)
    return { text: historyText() }
  }
  if (word === 'close') {
    await $.ui.close({ id: PANE })
    return {}
  }
  if (word === 'pause') {
    fynnActed()
    q = { ...q, paused: true }
    cancelSettle()
    await commit($)
    return { text: L.pausedMsg }
  }
  if (word === 'resume') {
    if (rt.notice) {
      const t = noticeTodo()
      const r = await resume($)
      if (r === 'hold') return { text: L.holdNoResume }
      if (r === 'continued' && t) return { text: L.continued(clamp(t.text, 80, 1)) }
      if (r === 'resent' && t) return { text: L.retried(clamp(t.text, 80, 1)) }
    } else {
      q = { ...q, paused: true }
      await pressControl($)
    }
    return { text: openItems(q).length > 0 || running(q) ? L.resumed : L.resumedEmpty }
  }
  if (word === 'done') {
    const t = await markDone($)
    return { text: t ? L.doneMsg(clamp(t.text, 80, 1)) : L.noRunning }
  }
  if (word === 'skip') {
    const t = await skip($)
    return { text: t ? L.skipped(clamp(t.text, 80, 1)) : L.noRunning }
  }
  if (word === 'retry') {
    const t = await retry($)
    return { text: t ? L.retried(clamp(t.text, 80, 1)) : L.noRunning }
  }
  if (word === 'clear') {
    fynnActed()
    const n = openItems(q).length
    q = { ...q, items: q.items.filter((t) => t.status !== 'open') }
    cancelSettle()
    await commit($)
    return { text: L.cleared(n) }
  }
  return { text: `${L.unknown(args.trim())}\n\n${L.help}` }
}

// ---------- Hooks ----------

/** Werkzeugaufruf in wenigen Worten für „JETZT“ (Idee aus dem Vorbild, eigene Umsetzung). */
function describe(tool: string, input: Record<string, unknown>): string {
  const a = tx().act
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const file = str('file_path') || str('notebook_path')
  const name = file ? (file.split(/[\\/]/).pop() ?? file) : ''
  switch (tool) {
    case 'Read':
      return a.read(name)
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return a.edit(name)
    case 'Write':
      return a.write(name)
    case 'Bash':
    case 'PowerShell':
      return a.shell(str('description') || str('command'))
    case 'Grep':
    case 'Glob':
      return a.search(str('pattern'))
    case 'WebFetch':
      return a.fetch(str('url'))
    case 'WebSearch':
      return a.web(str('query'))
    case 'Agent':
      return a.agent(str('description'))
    case 'TaskCreate':
    case 'TodoWrite':
      return a.plan
    case 'TaskUpdate':
      return a.tick
    default:
      return tool.startsWith('mcp__') ? a.mcp(tool.split('__').pop() ?? tool) : tool
  }
}

/** Beginnt mit diesem Text der Turn des gesendeten To-dos? Genauer Vergleich mit dem gemerkten Text bzw. Befehl; Fallback: Präfix bis 0.2.2. */
function isOwnTurn(id: string, text: string): boolean {
  const rec = rt.sent.filter((r) => r.id === id).at(-1)
  if (rec) {
    if (textHash(text) === rec.h) return true
    const c = commandOfTurn(text)
    if (c !== null && textHash(c) === rec.h) return true
  }
  return isTodoPrompt(text)
}

/** Ein gesendetes To-do in einer Nachricht im Chat: Nummer, Gesamtzahl, Fortsetzung, angezeigter Text. Ab 0.3.0 über die gemerkten Sendungen, sonst Präfix bis 0.2.2. */
function sentOf(text: string, o: { kind: string; name?: string }): { n: number; m: number; text: string; cont: boolean } | null {
  const own = o.kind === 'plugin' && o.name === 'worklist'
  const shown = commandOfTurn(text) ?? text.trim()
  const rec = findSent(rt.sent, shown)
  // Fremde Herkünfte (Peers, Kanäle, Benachrichtigungen) nie; der Desktop meldet worklists To-dos als `sdk`
  if (rec && (own || TEXT_ORIGINS.includes(o.kind))) return { n: rec.n, m: rec.m, text: shown, cont: rec.c === true }
  const old = parseSent(text)
  if (old && (own || (old.withLine && TEXT_ORIGINS.includes(o.kind)))) return { ...old, cont: false }
  return null
}

const isError = (r: unknown) => !!r && typeof r === 'object' && (('isError' in r && (r as { isError?: unknown }).isError === true) || 'deny' in r)

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  settings = cleanSettings(options)

  on('session.start', async ($, e, next) => {
    const L = tx()
    try {
      const sid = await $.session.id()
      root = await $.session.root()
      q = await loadQueue($, sid)
      history = cleanHistory(await loadSafe($, `history:${root}`))
      cost = cleanCost(await loadSafe($, `cost:${root}`))
      nowMs = await $.clock.now()
      const saved = await read($, rtAtom)
      if (saved && saved.sid === sid) {
        // Hot Reload (/reload-plugins): Laufzustand übernehmen. Der Reload bricht offene Timer ab (types: $.clock), also eine
        // laufende Prüfung, Haiku, Beruhigungszeit oder das Nachprüfen beim Warten: aufräumen statt hängen zu bleiben
        rt = { ...freshRuntime(sid), ...saved }
        // Ein Laufzustand von 0.2.2 hat keine gesendeten To-dos: aus dem Store nehmen
        rt.sent = Array.isArray(saved.sent) ? cleanSent(saved.sent) : cleanSent(await loadSafe($, `sent:${sid}`))
        // Ein Befehl, auf dessen Turn gewartet wurde: Der Reload hat den Timer abgebrochen, der Hinweis unten fängt es auf
        rt.expectCmd = null
        if (rt.state === 'checking') rt.state = 'idle'
        if (rt.state === 'unclear') {
          rt.state = 'blocked'
          rt.stateReason = L.reloadUnclear
        }
        const r = running(q)
        if (r && !rt.busy && !rt.notice && rt.state !== 'waiting') {
          rt.notice = { reason: L.reloadInterrupted, todoId: r.id }
          rt.state = 'ask'
          rt.stateReason = rt.notice.reason
        }
        // Die Fakten des letzten Turn-Endes lebten im Modul und sind weg: nicht still weiterwarten, Fynn entscheidet (Review 0.4.0 S2)
        if (rt.state === 'waiting' && !rt.busy && !rt.notice) {
          rt.state = 'blocked'
          rt.stateReason = L.reloadWaiting
        }
        await persist($)
      } else {
        // Neuer Prozess (Start, --resume): Liste läuft, nichts pausiert (0.4.0); gesendet wird erst nach Fynns Zutun (fresh)
        freshStart(sid)
        rt.sent = cleanSent(await loadSafe($, `sent:${sid}`))
        // Eine leere Liste nicht anlegen
        if (q.items.length > 0) await saveQueue($)
        await persist($)
      }
    } catch (err) {
      $.ui.log(`worklist: start: ${String(err)}`, { to: 'debug' })
    }
    // Commands zuletzt und in try/catch: ein belegter Name wirft (docs/raw/en/api.md:45)
    try {
      await $.command.register({ name: 'todo', description: L.cmdTodo, argumentHint: L.cmdTodoHint, immediate: true })
    } catch (err) {
      $.ui.log(`/todo not registered: ${String(err)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: 'todos',
        description: L.cmdTodos,
        argumentHint: '[status | pause | resume | done | skip | retry | clear | history | close]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log(`/todos not registered: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    try {
      return await runTodo($, e.args)
    } catch (err) {
      $.ui.log(`worklist /todo: ${String(err)}`, { to: 'debug' })
      return { text: tx().failed(String(err)) }
    }
  })

  on('command.run', { command: 'todos' }, async ($, e) => {
    try {
      return await runTodos($, e.args)
    } catch (err) {
      $.ui.log(`worklist /todos: ${String(err)}`, { to: 'debug' })
      return { text: tx().failed(String(err)) }
    }
  })

  // Beobachten (SPEC → Rechte): Herkunft der nächsten Nachricht merken; das Ergebnis von next(e) geht unverändert zurück.
  // Antwortet Fynn auf die offene Rückfrage eines To-dos, merkt sich worklist das für den unsichtbaren Hinweis, den
  // classic.UserPromptSubmit an genau diese Nachricht hängt (0.4.0). prompt.submit selbst hängt keinen Kontext an.
  on('prompt.submit', async ($, e, next) => {
    const fynn = isFynn(e.origin)
    // In einen laufenden Turn eingespeist (turnId gesetzt): beginnt keinen eigenen Turn, die Herkunft gilt nicht für den nächsten
    if (!e.turnId) pendingFynn = fynn
    if (fynn) fynnActed()
    // Ein Skill-Befehl aus $.command.run kommt hier als `/name` mit Herkunft worklist an (Prototyp, CLI 2.1.290): Sein Turn folgt
    const o = e.origin as { kind: string; name?: string }
    if (rt.expectCmd && o.kind === 'plugin' && o.name === 'worklist') cmdPrompt = true
    const t = fynn && !e.turnId && settings.doneLine ? questionTodo() : undefined
    if (t) answerHint = { h: textHash(e.text), todo: clamp(t.text, 80, 1) }
    // classic.UserPromptSubmit läuft innerhalb von next(e) (types: prompt.submit, „runs … the UserPromptSubmit settings hooks“)
    answerInFlight = !!t
    try {
      const r = await next(e)
      // Ein Hook darunter hat sie verworfen (z. B. sidekick beim Aufteilen): Es beginnt kein Turn mit dieser Herkunft (Review 0.4.0 K2)
      if ('drop' in r && r.drop !== undefined) {
        if (!e.turnId) pendingFynn = null
        if (t) answerHint = null
      }
      return r
    } finally {
      answerInFlight = false
    }
  })

  // Unsichtbare Hinweise als `additionalContext` (types: ClassicResultFields UserPromptSubmit; „text handed to the model with
  // the event“). Fynn sieht sie nicht im Chat, das Modell liest sie als System-Hinweis. Nur zwei Fälle, sonst unverändert:
  // - worklists eigenes, gerade gesendetes To-do bzw. seine Fortsetzung (Prüfsumme des Texts): der Schluss-Hinweis
  // - Fynns Antwort auf die offene Rückfrage eines To-dos (0.4.0): der Antwort-Hinweis mit dem To-do
  // Feuert auch bei worklists eigener Sendung (Prototyp, CLI 2.1.290), anders als prompt.submit.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const r = await next(e)
    if (hintFor && textHash(e.prompt) === hintFor) {
      hintFor = null
      lastHint = 'attached'
      return { ...r, additionalContext: [...(r.additionalContext ?? []), DONE_HINTS[settings.lang]] }
    }
    if (answerHint && (answerInFlight || textHash(e.prompt) === answerHint.h)) {
      const todo = answerHint.todo
      answerHint = null
      return { ...r, additionalContext: [...(r.additionalContext ?? []), ANSWER_HINTS[settings.lang](todo)] }
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    try {
      await syncSession($)
      const t = await now($)
      const fromFynn = pendingFynn === true
      pendingFynn = null
      cancelSettle()
      stopWaitTimer()
      rt.turnSeq += 1
      rt.busy = true
      // Eine neue Wartephase beginnt erst am nächsten Turn-Ende
      rt.waitSince = 0
      rt.waitNoticed = false
      // Die Hinweise gelten nur für diese eine Nachricht
      hintFor = null
      answerHint = null
      let todoId: string | null = null
      if (rt.expectOwn && isOwnTurn(rt.expectOwn, e.text)) {
        todoId = rt.expectOwn
        rt.expectOwn = null
        rt.expectCmd = null
      } else {
        todoId = running(q)?.id ?? null
      }
      // „Nicht mehr warten?“ erledigt sich mit jedem neuen Turn
      if (rt.notice?.kind === 'background') rt.notice = null
      if (fromFynn) {
        // Fynn antwortet bzw. schreibt selbst: Der Hinweis ist damit erledigt, auch nach dem zweiten Halt (SPEC 0.4.2);
        // der Schleifenschutz zählt neu (ein Gespräch ist keine Schleife)
        rt.notice = null
        rt.hold = false
        rt.strikes = { id: '', n: 0 }
        // Neue Aufgabe aus dem Chat: Claudes Plan beginnt neu
        if (!todoId) rt.plan = []
      }
      if (rt.turn.todoId !== todoId || todoId === null) filesChanged = false
      rt.turn = { startedAt: t, todoId, text: clamp(e.text.split('\n')[0] ?? '', 200, 1), fromFynn }
      if (!rt.notice && !(rt.state === 'fresh' && !fromFynn && !todoId)) {
        rt.state = 'idle'
        rt.stateReason = ''
      }
      activity = tx().thinking
      stop = null
      stopFailure = false
      lastToolError = false
      await persist($)
      redraw($)
    } catch (err) {
      $.ui.log(`worklist turn.start: ${String(err)}`, { to: 'debug' })
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      activity = clamp(describe(e.tool, e as unknown as Record<string, unknown>), 200, 1)
      if (EDIT_TOOLS.includes(e.tool)) filesChanged = true
      redraw($)
    }
    const r = await next(e)
    if (!e.agentId) lastToolError = isError(r)
    return r
  })

  // Claudes eigener Plan (nur Hauptsession): TaskCreate/TaskUpdate (Task-System) und TodoWrite; nur gelungene Aufrufe zählen
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      const res = 'result' in r ? (r.result as { task?: { id?: unknown } } | undefined) : undefined
      const id = typeof res?.task?.id === 'string' ? res.task.id : ''
      const subject = String((e as unknown as Record<string, unknown>).subject ?? '')
      if (id) {
        rt.plan = [...rt.plan.filter((s) => s.id !== id), { id, text: subject, status: 'pending' }]
        redraw($)
      }
    }
    return r
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    const ok = !isError(r) && 'result' in r && (r.result as { success?: unknown } | undefined)?.success !== false
    if (!e.agentId && ok) {
      const a = e as unknown as Record<string, unknown>
      const id = String(a.taskId ?? '')
      const status = a.status
      if (status === 'deleted') rt.plan = rt.plan.filter((s) => s.id !== id)
      else {
        rt.plan = rt.plan.map((s) =>
          s.id === id
            ? {
                ...s,
                text: typeof a.subject === 'string' ? a.subject : s.text,
                status: status === 'pending' || status === 'in_progress' || status === 'completed' ? status : s.status,
              }
            : s,
        )
      }
      redraw($)
    }
    return r
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && !isError(r)) {
      const todos = (e as unknown as Record<string, unknown>).todos
      if (Array.isArray(todos)) {
        rt.plan = todos
          .filter((t): t is { content: string; status: string } => !!t && typeof t === 'object' && typeof (t as { content?: unknown }).content === 'string')
          .map((t, i) => ({
            id: `w${i}`,
            text: t.content,
            status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
          }))
        redraw($)
      }
    }
    return r
  })

  // classic.Stop kommt vor turn.complete; bei einem Abbruch kommt keins (SPEC → Offene Punkte)
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    if (!e.agent_id) {
      stop = {
        background: (e.background_tasks ?? []).map((t) => ({ id: t.id, type: t.type, status: t.status, description: t.description })),
        crons: e.session_crons?.length ?? 0,
      }
    }
    return r
  })

  on('classic.StopFailure', async ($, e, next) => {
    const r = await next(e)
    if (!e.agent_id) stopFailure = true
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // Subagent-Turns lösen keine Prüfung aus
    if (e.agentId) return r
    try {
      rt.busy = false
      rt.lastResult = firstSentence(e.answer)
      activity = ''
      const snap: Snapshot = {
        seq: rt.turnSeq,
        reason: e.reason,
        answer: e.answer,
        stop,
        stopFailure,
        lastToolError,
        filesChanged,
        todoId: rt.turn.todoId,
        holdFresh: rt.state === 'fresh' && !rt.turn.fromFynn && !rt.turn.todoId,
      }
      lastSnap = snap
      // Bis die Prüfung entschieden hat, startet nichts: Ein To-do, das Fynn in diesem Moment einreiht, wartet darauf.
      // Ein offener Hinweis bleibt, wie er ist.
      cancelSettle()
      if (!rt.notice) {
        rt.state = 'checking'
        rt.stateReason = tx().checking
      }
      rt.turnEndAt = await now($)
      // Sichern: ein Reload vor der Prüfung soll „Turn zu Ende“ sehen, nicht „arbeitet“
      await persist($)
      redraw($)
      // Prüfen und senden über den einmaligen Timer, nicht im Hook (SPEC → Lehren, Punkt 5)
      once($, 10, () => void evaluate($, snap))
    } catch (err) {
      $.ui.log(`worklist turn.complete: ${String(err)}`, { to: 'debug' })
    }
    return r
  })

  // Gesendetes To-do im Chat: statt der Sprechblase eine orange Zeile und ein oranger Rahmen, wie sidekick eine gesendete
  // Fassung zeigt (mods/sidekick/hooks/register.ts). Nur die Anzeige ändert sich, gespeicherte Nachricht und Modell bleiben
  // (types: RenderPropsOf UserMessage). Erkannt am genauen Text einer gemerkten Sendung dieses Chats (ab 0.3.0), bei älteren
  // Nachrichten am Präfix samt Schlusszeile; Nachrichten von Peers, Kanälen oder Benachrichtigungen bleiben, wie sie sind.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const sent = sentOf(e.props.text, e.props.origin)
    if (!sent) return next(e)
    try {
      const L = tx()
      const line = sent.cont ? L.sentLineCont(sent.n, sent.m) : L.sentLine(sent.n, sent.m)
      // Andere Oberflächen: nur Text (Farbe und Rahmen dort nicht belegt)
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return next({ ...e, props: { ...e.props, text: `${line}\n\n${sent.text}` } })
      const { Box, Text } = $.ui.resolve(e)
      const head = Box({ key: 'worklist-line', children: [Text({ color: ORANGE, children: [line] })] })
      // Kompakte Ansicht im Terminal (ohne ctrl+o): nur die Zeile
      if (e.surface === 'terminal' && !e.props.isExpanded) return Box({ flexDirection: 'column', children: [head] })
      const frame = Box({
        key: 'worklist-sent',
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: ORANGE,
        paddingX: 1,
        children: [Text({ dimColor: true, children: [L.sentLabel] }), Text({ wrap: 'wrap', children: [sent.text] })],
      })
      // Eine Leerzeile Abstand zur Antwort darunter, wie bei sidekick
      return Box({ flexDirection: 'column', marginBottom: 1, children: [head, frame] })
    } catch (err) {
      $.ui.log(`worklist UserMessage: ${String(err)}`, { to: 'debug' })
      return next(e)
    }
  })

  // Die Fertig-Marke („Fertig.“ bzw. „Done.“) als letzte, alleinstehende Zeile einer Antwort wird nur in der Anzeige ausgeblendet.
  // Gespeicherte Antwort und Prüfung bleiben unverändert (types: AssistantMessage, „a rewrite changes the drawing and leaves
  // the stored message alone“).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const shown = hideDoneMarker(e.props.text)
    if (shown === e.props.text) return next(e)
    if (shown === '') {
      // Der Block bestand nur aus der Marke: nichts zeichnen
      const { Box } = $.ui.resolve(e)
      return Box({})
    }
    return next({ ...e, props: { ...e.props, text: shown } })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    try {
      // Abonnieren: redraw() zeichnet über diesen Wert neu
      await read($, paintAtom)
      rendered = true
      nowMs = await $.clock.now()
      // Nach /clear, /resume, /branch: neue Session-ID ohne session.start. Abgleich über den Timer, nicht im Zeichnen
      // (dort darf kein $.state geschrieben werden, docs/raw/en/interface.md:769); bis dahin eine leere Liste zeigen.
      if ((await $.session.id()) !== rt.sid) {
        once($, 1, () => {
          void syncSession($)
            .then(() => redraw($))
            .catch((err: unknown) => $.ui.log(`worklist: session sync: ${String(err)}`, { to: 'debug' }))
        })
        return renderPane($.ui.resolve(e), switchingView(), tx(), actions($), e.props.bodyColumns, e.surface, cache)
      }
      ensureTicker($)
      return renderPane($.ui.resolve(e), view(), tx(), actions($), e.props.bodyColumns, e.surface, cache)
    } catch (err) {
      $.ui.log(`worklist ui.render: ${String(err)}`, { to: 'debug' })
      const { Text } = $.ui.resolve(e)
      return Text({ children: [tx().renderError] })
    }
  })
}
