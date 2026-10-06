// worklist: To-do-Seitenleiste neben dem Chat (SPEC.md). Fynn reiht To-dos ein, auch während Claude arbeitet. Ist Claude nach
// der Prüfung „sicher frei“ (check.ts, Stufen 1–9, Stufe 10 hier) fertig, wird das laufende To-do abgehakt, wandert in den
// projektweiten Verlauf, und das nächste startet über den einmaligen Timer. Sonst hält die Liste an: Toast und Hinweisblock.
// Im Zweifel wird nie gesendet. Alle beobachtenden Hooks geben das Ergebnis von next(e) unverändert weiter und hängen keinen
// Kontext an Fynns Nachrichten. Texte auf Englisch oder Deutsch (userConfig `language`, i18n.ts).
// Vorbild für Ideen und Abläufe: arbeitsliste (nikisge/niklas-mods, ohne Lizenz, kein Code übernommen).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { BUSY_STATUS, decideHaiku, decideRules, haikuCost, haikuPrompt, haikuSystem, parseHaiku } from './check.ts'
import type { Decision, StopFacts } from './check.ts'
import { T, cents, hhmm, shortDate } from './i18n.ts'
import type { Strings } from './i18n.ts'
import {
  add,
  cleanCost,
  cleanHistory,
  cleanQueue,
  cleanSettings,
  cleanText,
  firstSentence,
  freshRuntime,
  hideDoneMarker,
  isTodoPrompt,
  move,
  nextOpen,
  openItems,
  parseSent,
  promptFor,
  pushHistory,
  remove,
  reopen,
  requeue,
  running,
  setStatus,
} from './model.ts'
import type { Cost, HistoryEntry, Queue, Runtime, Settings, Todo } from './model.ts'
import { ORANGE, clamp, duration, renderPane } from './view.ts'
import type { Actions, Control, NowView, View } from './view.ts'

const PANE = 'worklist'
const TITLE = 'To-dos'
// Fynns eigene Nachrichten: im Desktop `composer`, in -p/SDK `sdk`, vom Handy `bridge` (types: PromptOrigin)
const FYNN = ['composer', 'sdk', 'bridge']
// Herkünfte, bei denen eine To-do-Zeile im Chat am Text erkannt wird (der Desktop meldet worklists To-dos als `sdk`)
const TEXT_ORIGINS = ['composer', 'sdk', 'bridge', 'unclassified']
// Nach einem Knopfdruck kurz warten statt der vollen Beruhigungszeit: Fynn hat selbst entschieden
const PRESS_SETTLE_MS = 300
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']

// $.state: Laufzustand über einen Hot Reload hinweg (types/index.d.ts)
const rtAtom = atom({ plugin: 'worklist', key: 'rt' }, freshRuntime(''))

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
let pendingOrigin = ''
let settle: Timer | null = null
let lastDecision = '–'
let lastHaiku = '–'
// Fakten des letzten Turn-Endes (nur im Speicher): für die Prüfung, wenn danach ein To-do eingereiht wird
let lastSnap: Snapshot | null = null
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
  $.ui.invalidate('ui.render')
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

/** Nach /clear gibt es eine neue Session-ID ohne session.start. Liefert true, wenn gewechselt wurde. */
async function syncSession($: EngineInterface): Promise<boolean> {
  const id = await $.session.id()
  if (id === rt.sid) return false
  cancelSettle()
  rt = freshRuntime(id)
  q = await loadQueue($, id)
  // Liste eines anderen Chats (z. B. per /resume): laufendes To-do zurück auf offen, pausiert übernehmen
  const r = running(q)
  if (r) q = reopen(q, r.id)
  if (openItems(q).length > 0) q = { ...q, paused: true }
  activity = ''
  stop = null
  await commit($)
  return true
}

/** Hinweisblock setzen, Toast, Seitenleiste öffnen (SPEC → Benachrichtigung). */
function raise($: EngineInterface, reason: string, todoId: string | null) {
  rt.notice = { reason, todoId }
  rt.state = 'ask'
  rt.stateReason = reason
  $.ui.toast(tx().stopped(reason), { timeoutMs: 8000 })
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
    void afterSettle($, why, seq, sid)
  })
  settle = t
}

/** Stufe 10: nach der Beruhigungszeit erneut prüfen, erst dann senden. */
async function afterSettle($: EngineInterface, why: 'auto' | 'manual', seq: number, sid: string) {
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
      rt.state = 'waiting'
      rt.stateReason = tx().waitingHelpers(agents)
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
  const t = await now($)
  const n = rt.sessionDone + 1
  const m = rt.sessionDone + q.items.length
  q = setStatus(q, todo.id, 'running', t)
  rt.expectOwn = todo.id
  rt.plan = []
  rt.state = 'idle'
  rt.stateReason = ''
  if (why === 'auto') rt.autoRun += 1
  await commit($)
  try {
    // Mit asUser liest Claude das To-do als Fynns Nachricht (types: PromptSubmitArgs). worklists eigener prompt.submit-Hook
    // sieht es nicht: Das Debug-Log meldet „prompt.submit skipped: re-entry (the plugin's own code raised it)“
    const r = await $.prompt.submit({ text: promptFor(todo, n, m, settings.doneLine, settings.lang), asUser: true })
    if ('drop' in r && r.drop !== undefined) await sendFailed($, todo.id, tx().sendRejected(r.drop))
  } catch (err) {
    await sendFailed($, todo.id, tx().sendFailed(String(err)))
  }
}

async function sendFailed($: EngineInterface, id: string, reason: string) {
  q = reopen(q, id)
  rt.expectOwn = null
  raise($, reason, id)
  await commit($)
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
}

/** Zeile „Letzte Entscheidung“ für /todos status. */
function describeDecision(t: number, d: Decision | null, what: string): string {
  const L = tx()
  return `${hhmm(t)} · ${d ? `${L.step(d.stage)} · ${L.outcome[d.outcome]} · ${d.reason}` : L.rulesUnclear} · ${what}`
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
    // ist; ein später eingereihtes To-do startet nur dann sofort (nie als Antwort auf eine offene Rückfrage)
    if (!todo && (openItems(q).length === 0 || q.paused)) {
      let d: Decision | null
      try {
        d = decideRules({ ...s, busyAgents: await busyAgents($), plan: rt.plan }, L)
      } catch (err) {
        d = { outcome: 'FRAGEN', stage: 0, reason: L.checkFailed(String(err)) }
      }
      if (rt.turnSeq !== s.seq || rt.busy || rt.notice) return
      setFree(d)
      // Inzwischen eingereiht bzw. Start gedrückt: jetzt mit dem Ergebnis entscheiden
      maybeStart($, 'manual', settings.settleSeconds * 1000)
      lastDecision = describeDecision(await now($), d, L.listIdle)
      return
    }
    rt.state = 'checking'
    rt.stateReason = L.checking
    redraw($)
    let d: Decision
    try {
      const rules = decideRules({ ...s, busyAgents: await busyAgents($), plan: rt.plan }, L)
      d = rules ?? (settings.haiku ? await askHaiku($, todo?.text ?? '', s) : { outcome: 'FRAGEN', stage: 9, reason: L.haikuOff })
    } catch (err) {
      // Im Zweifel nie senden (SPEC → Fehlerverhalten)
      d = { outcome: 'FRAGEN', stage: 0, reason: L.checkFailed(String(err)) }
    }
    if (rt.turnSeq !== s.seq || rt.busy || rt.notice) return
    lastDecision = describeDecision(await now($), d, todo ? L.ofTodo(clamp(todo.text, 40, 1)) : L.fromChatShort)
    $.ui.log(`worklist: ${lastDecision}`, { to: 'debug' })
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
function setFree(d: Decision | null) {
  if (d?.outcome !== 'WEITER') cancelSettle()
  if (!d) {
    rt.state = 'unclear'
    rt.stateReason = ''
  } else if (d.outcome === 'WEITER') {
    rt.state = 'idle'
    rt.stateReason = ''
  } else {
    rt.state = d.outcome === 'WARTEN' ? 'waiting' : 'blocked'
    rt.stateReason = d.reason
  }
}

/** Ein To-do ist neu startbar (eingereiht, Start): je nach letztem Prüfstand sofort, nach Haiku oder gar nicht. */
function maybeStart($: EngineInterface, why: 'auto' | 'manual', settleMs: number) {
  if (rt.busy || rt.notice || q.paused) return
  if (rt.state === 'idle') tryStartNext($, why, settleMs)
  else if (rt.state === 'unclear') {
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
  // blocked / waiting: erst „Jetzt starten“ bzw. das nächste Turn-Ende
}

async function apply($: EngineInterface, d: Decision, todo: Todo | undefined) {
  if (d.outcome === 'WARTEN') {
    rt.state = 'waiting'
    rt.stateReason = d.reason
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
    // Fynns eigener Chat-Turn: nichts startet, still (kein Toast); „Jetzt starten“ setzt fort
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

// ---------- Fynns Aktionen ----------

async function addTodo($: EngineInterface, raw: string): Promise<Todo | null> {
  const text = cleanText(raw)
  if (!text) return null
  await syncSession($)
  fynnActed()
  const t = await now($)
  const todo: Todo = { id: `t${t.toString(36)}${q.items.length}`, text, status: 'open', createdAt: t }
  q = add(q, todo)
  // Bei freiem Claude startet es nach derselben Prüfung (Beruhigungszeit), sonst wartet es
  maybeStart($, 'manual', settings.settleSeconds * 1000)
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

/** „Weiter“: das angehaltene To-do ans Ende, das nächste starten. Ist sonst nichts offen: pausieren statt dasselbe erneut senden. */
async function proceed($: EngineInterface) {
  const t = noticeTodo()
  if (t) q = requeue(q, t.id)
  release()
  rt.strikes = { id: '', n: 0 }
  if (t && !openItems(q).some((x) => x.id !== t.id)) {
    q = { ...q, paused: true }
    rt.state = 'idle'
  } else tryStartNext($, 'manual', PRESS_SETTLE_MS)
  await commit($)
}

/** „Als erledigt abhaken“ bzw. /todos done. Ohne To-do nichts tun: kein Aufheben der Pause, kein Start. */
async function markDone($: EngineInterface): Promise<Todo | undefined> {
  const t = noticeTodo()
  if (!t) return undefined
  await finish($, t, 'manual')
  release()
  tryStartNext($, 'manual', PRESS_SETTLE_MS)
  await commit($)
  return t
}

/** „Nochmal senden“: dasselbe To-do vorn erneut. Zählt für den Schleifenschutz weiter. */
async function resend($: EngineInterface) {
  const t = noticeTodo()
  const strikes = rt.strikes
  if (t) {
    const rest = q.items.filter((x) => x.id !== t.id)
    q = { ...q, items: [{ id: t.id, text: t.text, status: 'open', createdAt: t.createdAt }, ...rest] }
  }
  release()
  rt.strikes = strikes
  tryStartNext($, 'manual', PRESS_SETTLE_MS)
  await commit($)
}

function control(): Control {
  if (q.paused) return 'start'
  if (!rt.busy && !rt.notice && (rt.state === 'blocked' || rt.state === 'waiting') && openItems(q).length > 0) return 'go'
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
        rt.state = 'idle'
        rt.stateReason = ''
        tryStartNext($, 'manual', PRESS_SETTLE_MS)
      } else maybeStart($, 'manual', PRESS_SETTLE_MS) // „Start“ nach einer Pause: dieselbe Prüfung wie beim Einreihen
    }
  }
  await commit($)
}

/**
 * Knopf-Aktion erst nach dem Session-Abgleich: Nach /clear zeigt die Seitenleiste bis zum Neuzeichnen noch die alte Liste;
 * ein Druck darauf darf die Liste des alten Chats nicht ändern. Nach einem Wechsel wird nur neu gezeichnet.
 */
function guarded($: EngineInterface, fn: () => void | Promise<void>): () => void {
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
    proceed: guarded($, () => proceed($)),
    markDone: guarded($, async () => {
      await markDone($)
    }),
    resend: guarded($, () => resend($)),
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

function nowView(): NowView {
  const L = tx()
  const r = running(q)
  if (rt.busy || r) {
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
  let note: string
  if (q.paused) note = L.notePaused
  else if (rt.state === 'blocked') note = L.noteBlocked(rt.stateReason)
  else if (rt.state === 'waiting') note = rt.stateReason
  else if (rt.state === 'checking') note = rt.stateReason || L.noteChecking
  else if (rt.state === 'unclear' && openItems(q).length > 0) note = L.noteUnclear
  else if (openItems(q).length === 0) note = L.noteEmpty
  else note = L.noteNext
  return { kind: 'free', note }
}

function view(): View {
  return {
    lang: settings.lang,
    now: nowView(),
    notice: rt.notice ? { reason: rt.notice.reason, hasTodo: rt.notice.todoId !== null } : null,
    queue: openItems(q).map((t) => ({ id: t.id, text: t.text })),
    paused: q.paused,
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
  return { ...view(), now: { kind: 'free', note: tx().noteSwitching }, notice: null, queue: [], control: 'pause' }
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
    L.statusRun(rt.autoRun, settings.maxAutoRun, settings.settleSeconds, settings.doneLine),
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
    if (rt.notice) await proceed($)
    else {
      q = { ...q, paused: true }
      await pressControl($)
    }
    // Rückmeldung aus dem echten Zustand: „Weiter“ pausiert, wenn nur das angehaltene To-do übrig ist
    if (q.paused) return { text: L.resumePaused }
    return { text: openItems(q).length > 0 ? L.resumed : L.resumedEmpty }
  }
  if (word === 'done') {
    const t = await markDone($)
    return { text: t ? L.doneMsg(clamp(t.text, 80, 1)) : L.noRunning }
  }
  if (word === 'skip') {
    const t = noticeTodo()
    if (!t) return { text: L.noRunning }
    await proceed($)
    return { text: L.skipped(clamp(t.text, 80, 1), q.paused) }
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
      const saved = await read($, rtAtom)
      if (saved && saved.sid === sid) {
        // Hot Reload (/reload-plugins): Laufzustand übernehmen. Der Reload bricht offene Timer ab (types: $.clock), also eine
        // laufende Prüfung, Haiku oder Beruhigungszeit: aufräumen statt hängen zu bleiben
        rt = { ...freshRuntime(sid), ...saved }
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
        await persist($)
      } else {
        // Neuer Prozess (Start, --resume): ein laufendes To-do zurück auf offen, Liste pausiert
        rt = freshRuntime(sid)
        const r = running(q)
        if (r) q = reopen(q, r.id)
        if (openItems(q).length > 0) q = { ...q, paused: true }
        // Eine leere Liste nicht anlegen
        if (q.items.length > 0) await saveQueue($)
        await persist($)
      }
      nowMs = await $.clock.now()
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
        argumentHint: '[status | pause | resume | done | skip | clear | history | close]',
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

  // Nur beobachten: Herkunft der nächsten Nachricht merken, kein Kontext anhängen (SPEC → Rechte)
  on('prompt.submit', async ($, e, next) => {
    // In einen laufenden Turn eingespeist (turnId gesetzt): beginnt keinen eigenen Turn, die Herkunft gilt nicht für den nächsten
    if (!e.turnId) pendingOrigin = e.origin.kind
    if (FYNN.includes(e.origin.kind)) fynnActed()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    try {
      await syncSession($)
      const t = await now($)
      const fromFynn = FYNN.includes(pendingOrigin)
      pendingOrigin = ''
      cancelSettle()
      rt.turnSeq += 1
      rt.busy = true
      let todoId: string | null = null
      if (rt.expectOwn && isTodoPrompt(e.text)) {
        todoId = rt.expectOwn
        rt.expectOwn = null
      } else {
        todoId = running(q)?.id ?? null
      }
      if (fromFynn) {
        // Fynn antwortet bzw. schreibt selbst: der Hinweis ist damit erledigt, der Schleifenschutz zählt neu
        // (ein Gespräch ist keine Schleife). Hat der Schleifenschutz schon gegriffen, setzt nur ein Knopf oder Befehl fort.
        if (!rt.hold) {
          rt.notice = null
          rt.strikes = { id: '', n: 0 }
        }
        // Neue Aufgabe aus dem Chat: Claudes Plan beginnt neu
        if (!todoId) rt.plan = []
      }
      if (rt.turn.todoId !== todoId || todoId === null) filesChanged = false
      rt.turn = { startedAt: t, todoId, text: clamp(e.text.split('\n')[0] ?? '', 200, 1), fromFynn }
      if (!rt.notice) {
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
      activity = describe(e.tool, e as unknown as Record<string, unknown>)
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
        background: (e.background_tasks ?? []).map((t) => ({ type: t.type, status: t.status, description: t.description })),
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
      }
      lastSnap = snap
      // Bis die Prüfung entschieden hat, startet nichts: Ein To-do, das Fynn in diesem Moment einreiht, wartet darauf.
      // Ein offener Hinweis bleibt, wie er ist.
      cancelSettle()
      if (!rt.notice) {
        rt.state = 'checking'
        rt.stateReason = tx().checking
      }
      // Sichern: ein Reload vor der Prüfung soll „Turn zu Ende“ sehen, nicht „arbeitet“
      await persist($)
      await now($)
      redraw($)
      // Prüfen und senden über den einmaligen Timer, nicht im Hook (SPEC → Lehren, Punkt 5)
      once($, 10, () => void evaluate($, snap))
    } catch (err) {
      $.ui.log(`worklist turn.complete: ${String(err)}`, { to: 'debug' })
    }
    return r
  })

  // Gesendetes To-do im Chat: statt der Sprechblase (mit Schlusszeile) eine orange Zeile und ein oranger Rahmen, wie sidekick
  // eine gesendete Fassung zeigt (mods/sidekick/hooks/register.ts). Nur die Anzeige ändert sich, gespeicherte Nachricht und
  // Modell bleiben (types: RenderPropsOf UserMessage). Erkannt an der Herkunft oder am unverwechselbaren Text samt Schlusszeile;
  // Nachrichten von Peers, Kanälen oder Benachrichtigungen bleiben, wie sie sind.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const o = e.props.origin
    const sent = parseSent(e.props.text)
    if (!sent) return next(e)
    const ours = (o.kind === 'plugin' && o.name === 'worklist') || (sent.withLine && TEXT_ORIGINS.includes(o.kind))
    if (!ours) return next(e)
    try {
      const L = tx()
      const line = L.sentLine(sent.n, sent.m)
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
