// worklist: Texte auf Englisch (Standard) und Deutsch, ohne `$` (release/I18N.md). Die Sprache kommt aus userConfig `language`.
// Eingaben und die Erkennung in check.ts verstehen immer beide Sprachen; diese Tabellen betreffen nur, was worklist ausgibt.

export type Lang = 'en' | 'de'

export function cleanLang(v: unknown): Lang {
  return v === 'de' ? 'de' : 'en'
}

const two = (n: number) => String(n).padStart(2, '0')
const WD = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Uhrzeit `14:30` (beide Sprachen). */
export function hhmm(t: number): string {
  const d = new Date(t)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Datum ohne Jahr: en `Oct 6`, de `06.10.` */
export function shortDate(lang: Lang, t: number): string {
  const d = new Date(t)
  return lang === 'de' ? `${two(d.getDate())}.${two(d.getMonth() + 1)}.` : `${MON[d.getMonth()]} ${d.getDate()}`
}

/** Wochentag und Datum für die Tagesgruppen im Verlauf: en `Mon Oct 6`, de `Mo 06.10.` */
export function dayDate(lang: Lang, t: number): string {
  return `${WD[lang][new Date(t).getDay()]} ${shortDate(lang, t)}`
}

/** US-Dollar als Cent: en `0.05 ¢`, de `0,05 ct` */
export function cents(lang: Lang, usd: number): string {
  const v = (usd * 100).toFixed(2)
  return lang === 'de' ? `${v.replace('.', ',')} ct` : `${v} ¢`
}

/**
 * Ab 0.3.0: unsichtbarer Hinweis zu jedem gesendeten To-do (classic.UserPromptSubmit, `additionalContext`). Fynn sieht ihn
 * im Chat nicht, das Modell liest ihn als System-Hinweis neben dem To-do. Die Marke darin ist „Done.“ bzw. „Fertig.“
 */
export const DONE_HINTS: Record<Lang, string> = {
  en: 'This message is a task from the user\'s to-do list (worklist). If anything is unclear, end your answer with a clear question and don\'t write "Done.". Otherwise finish the task completely and end your answer with "Done." on a line of its own.',
  de: 'Diese Nachricht ist eine Aufgabe aus der To-do-Liste des Nutzers (worklist). Ist etwas unklar, schließ deine Antwort mit einer klaren Rückfrage und schreib kein „Fertig.“. Sonst erledige die Aufgabe vollständig und schließ deine Antwort mit „Fertig.“ in einer eigenen Zeile.',
}

/** Bis 0.2.2 sichtbare Schlusszeile an jedem gesendeten To-do; bleibt, damit alte Nachrichten im Chat erkannt werden. */
export const DONE_LINES: Record<Lang, string> = {
  en: '(Worklist: If anything is unclear, end with a clear question and don\'t write "Done.". Otherwise finish the task completely and end with "Done.")',
  de: '(Arbeitsliste: Ist etwas unklar, stell am Ende eine klare Rückfrage und schreib dann kein „Fertig.“. Sonst erledige die Aufgabe vollständig und schließe mit „Fertig.“)',
}

const en = {
  // Prüfung (check.ts)
  aborted: 'Interrupted.',
  refused: 'Refused.',
  turnError: 'Error in the turn.',
  waitingHelpers: (names: readonly string[]) => `waiting for ${names.length === 1 ? 'a helper' : `${names.length} helpers`}: ${names.join(', ')}`,
  planOpen: (done: number, total: number) => `Claude's plan isn't finished yet (${done}/${total}).`,
  question: 'Claude has a question.',
  problem: 'Claude reports a problem.',
  done: 'Claude reports "done".',
  task: 'task',
  tasks: (n: number, kinds: string) => `${n === 1 ? '1 task' : `${n} tasks`} (${kinds})`,
  crons: (n: number) => (n === 1 ? '1 scheduled wake-up' : `${n} scheduled wake-ups`),
  waitingBackground: (parts: string) => `waiting for background work: ${parts}`,
  haikuNoResult: 'Unclear whether Claude is done (the check gave no result).',
  haikuDone: (why: string) => `Haiku: done.${why ? ` ${why}` : ''}`,
  haikuQuestion: 'Claude is waiting for you.',
  haikuBlocked: 'Claude is stuck.',
  haikuUnsure: 'Unclear whether Claude is done.',
  haikuOff: 'Unclear whether Claude is done (Haiku is off).',
  haikuFailed: (reason: string) => `Unclear whether Claude is done (Haiku: ${reason}).`,
  haikuLanguage: 'English',
  checkFailed: (err: string) => `Check failed: ${err}`,
  checkFailedShort: 'Check failed.',

  // Ablauf (register.ts)
  stopped: (reason: string) => `To-do list stopped: ${reason}`,
  storeWarn: "To-do list: saving failed, the list only lasts until restart. /todos status shows more.",
  maxAutoRun: (n: number) => `${n} to-dos in a row without your input. Take a quick look, then "Continue".`,
  nextStarting: 'Next to-do starts shortly …',
  checking: 'checking whether Claude is clearly done …',
  sendRejected: (why: string) => `Sending was refused: ${why}`,
  sendFailed: (err: string) => `Sending failed: ${err}`,
  cmdUnknown: (name: string) => `Unknown command /${name}: the to-do was not sent.`,
  cmdOwn: (name: string) => `/${name} is worklist's own command and can't run as a to-do.`,
  cmdFailed: (err: string) => `The command didn't run: ${err}`,
  cmdRan: 'Command ran (without a turn).',
  holdTwice: 'Stopped twice on this to-do. Please decide yourself.',
  secondTime: 'Second time on this to-do: the list waits for you.',
  unclearFree: 'Unclear whether Claude is free.',
  reloadUnclear: 'After the reload it is unclear whether Claude is free.',
  reloadInterrupted: 'The check was interrupted by the reload.',
  thinking: 'thinking',
  noAnswer: (reason: string) => `no answer (${reason})`,
  unreadable: (text: string) => `unreadable: ${text}`,

  // Letzte Entscheidung (/todos status)
  outcome: { WEITER: 'CONTINUE', WARTEN: 'WAIT', FRAGEN: 'ASK', STOPP: 'STOP' },
  step: (n: number) => `step ${n}`,
  ofTodo: (text: string) => `to-do "${text}"`,
  fromChatShort: 'from the chat',
  rulesUnclear: 'rules unclear, Haiku only at the next to-do',
  listIdle: 'list empty or paused',

  // Seitenleiste: JETZT (view.ts, nowView)
  now: 'NOW',
  free: '◇ free',
  fromChat: '◆ from the chat',
  checkingLine: '… checking whether Claude is clearly done',
  plan: "Claude's plan",
  notePaused: 'List paused. "Start" resumes it.',
  noteBlocked: (reason: string) => `Waiting for you: ${reason} "Start now" resumes the list.`,
  noteChecking: 'checking …',
  noteUnclear: 'The next to-do starts after a short check.',
  noteEmpty: 'Nothing in the list. Type a to-do below.',
  noteNext: 'The next to-do starts as soon as Claude is clearly free.',
  noteSwitching: 'New chat, loading its list …',

  // Seitenleiste: HINWEIS, DANACH, VERLAUF
  noticeTitle: 'NOTICE · list stopped',
  proceed: 'Continue',
  markDone: 'Mark as done',
  resend: 'Send again',
  next: 'NEXT',
  nothingOpen: 'nothing open',
  nOpen: (n: number) => `${n} open`,
  paused: '⏸ paused',
  placeholder: 'new to-do, Enter',
  submit: 'queue',
  pause: '⏸ Pause',
  start: '▶ Start',
  go: '▶ Start now',
  history: 'HISTORY',
  historyEmpty: 'empty',
  nDone: (n: number) => `${n} done`,
  byHand: 'by hand',
  today: 'Today',
  yesterday: 'Yesterday',
  showLess: 'show less',
  showAll: (n: number) => `show all ${n}`,
  renderError: 'Display error, /todos status',

  // Zeile im Chat
  sentLine: (n: number, m: number) => `· worklist: to-do ${n}/${m} sent`,
  sentLabel: 'sent:',

  // Live-Aktivität
  act: {
    read: (f: string) => `reads ${f}`,
    edit: (f: string) => `edits ${f}`,
    write: (f: string) => `writes ${f}`,
    shell: (c: string) => `command: ${c}`,
    search: (p: string) => `searches ${p}`,
    fetch: (u: string) => `opens ${u}`,
    web: (q: string) => `researches ${q}`,
    agent: (d: string) => `helper: ${d}`,
    plan: 'plans',
    tick: 'checks off',
    mcp: (t: string) => `uses ${t}`,
  },

  // Befehle
  cmdTodo: 'Queue a to-do: /todo <task> (without text: open the sidebar)',
  cmdTodoHint: '<task>',
  cmdTodos: 'To-do list: sidebar, status, pause, resume, done, skip, clear, history, close',
  help: [
    'Usage:',
    '  /todo <task>            queue a task (everything after /todo is the task)',
    '  /todo                   open the sidebar',
    '  /todos                  open the sidebar',
    '  /todos pause | resume   pause or resume the list',
    '  /todos done             mark the running to-do as done',
    '  /todos skip             move the running to-do back to the list',
    '  /todos clear            delete open to-dos (the history stays)',
    '  /todos history          show the history',
    '  /todos status           check state, last decision, Haiku cost',
    '  /todos close            close the sidebar',
  ].join('\n'),
  paneWaiting: (reason: string) => `Sidebar is waiting: ${reason}`,
  queued: (n: number, text: string) => `Queued (${n} open): ${text}`,
  pausedMsg: 'List paused. /todos resume resumes it.',
  resumePaused: 'Nothing else is open: list paused, nothing sent. "Start" or /todos resume sends the to-do again.',
  resumed: 'List continues.',
  resumedEmpty: 'List continues; nothing is open right now.',
  doneMsg: (text: string) => `Marked as done: ${text}`,
  noRunning: 'No running to-do.',
  skipped: (text: string, paused: boolean) => `Back in the list: ${text}${paused ? ' · nothing else open, list paused' : ''}`,
  cleared: (n: number) => `${n} open to-dos deleted. The history stays.`,
  unknown: (args: string) => `Unknown: ${args}. To queue a to-do use /todo <task>.`,
  failed: (err: string) => `That didn't work: ${err}`,

  // /todos status
  stateWorking: 'Claude is working',
  state: { idle: 'free', waiting: 'waiting', checking: 'checking', ask: 'stopped', blocked: 'waiting for you', unclear: 'free, check before the next start' },
  statusList: (open: number, running: boolean, paused: boolean, done: number) =>
    `List: ${open} open${running ? ', 1 running' : ''}${paused ? ', paused' : ''} · done in this chat: ${done}`,
  statusState: (state: string, reason: string, hold: boolean) => `Check state: ${state}${reason ? ` (${reason})` : ''}${hold ? ' · loop guard active' : ''}`,
  statusDecision: (d: string) => `Last decision: ${d}`,
  statusHaiku: (on: boolean, last: string, calls: number, cost: string) => `Haiku: ${on ? 'on' : 'off'} · last ${last} · so far ${calls}× in this project, ${cost}`,
  statusRun: (auto: number, max: number, settle: number, hint: boolean, last: string) =>
    `In a row without your input: ${auto}/${max} · settle time ${settle} s · hidden closing hint ${hint ? 'on' : 'off'}${last ? ` (last to-do: ${last})` : ''}`,
  hintAttached: 'attached',
  hintMissing: 'not attached',
  statusHistory: (n: number) => `History in this project: ${n} entries`,

  // /todos history
  historyNone: 'History: nothing done in this project yet.',
  historyHead: (n: number, cut: boolean) => `History (${n}, newest first${cut ? ', the last 30' : ''}):`,
}

export type Strings = typeof en

const de: Strings = {
  aborted: 'Abgebrochen.',
  refused: 'Abgelehnt.',
  turnError: 'Fehler beim Turn.',
  waitingHelpers: (names) => `wartet auf ${names.length === 1 ? 'einen Helfer' : `${names.length} Helfer`}: ${names.join(', ')}`,
  planOpen: (done, total) => `Claudes Plan ist noch nicht durch (${done}/${total}).`,
  question: 'Claude hat eine Rückfrage.',
  problem: 'Claude meldet ein Problem.',
  done: 'Claude meldet „fertig“.',
  task: 'Aufgabe',
  tasks: (n, kinds) => `${n === 1 ? '1 Aufgabe' : `${n} Aufgaben`} (${kinds})`,
  crons: (n) => (n === 1 ? '1 geplanter Weckauftrag' : `${n} geplante Weckaufträge`),
  waitingBackground: (parts) => `wartet auf Hintergrundarbeit: ${parts}`,
  haikuNoResult: 'Unklar, ob Claude fertig ist (Prüfung ohne Ergebnis).',
  haikuDone: (why) => `Haiku: fertig.${why ? ` ${why}` : ''}`,
  haikuQuestion: 'Claude wartet auf dich.',
  haikuBlocked: 'Claude kommt nicht weiter.',
  haikuUnsure: 'Unklar, ob Claude fertig ist.',
  haikuOff: 'Unklar, ob Claude fertig ist (Haiku ist aus).',
  haikuFailed: (reason) => `Unklar, ob Claude fertig ist (Haiku: ${reason}).`,
  haikuLanguage: 'German',
  checkFailed: (err) => `Prüfung fehlgeschlagen: ${err}`,
  checkFailedShort: 'Prüfung fehlgeschlagen.',

  stopped: (reason) => `To-do-Liste angehalten: ${reason}`,
  storeWarn: 'To-do-Liste: Speichern ging nicht, die Liste gilt nur bis zum Neustart. /todos status zeigt mehr.',
  maxAutoRun: (n) => `${n} To-dos in Folge ohne deinen Eingriff. Kurz drüberschauen, dann „Weiter“.`,
  nextStarting: 'Nächstes To-do startet gleich …',
  checking: 'prüft, ob Claude sicher fertig ist …',
  sendRejected: (why) => `Senden abgelehnt: ${why}`,
  sendFailed: (err) => `Senden ging nicht: ${err}`,
  cmdUnknown: (name) => `Unbekannter Befehl /${name}: Das To-do wurde nicht gesendet.`,
  cmdOwn: (name) => `/${name} ist ein Befehl von worklist selbst und kann nicht als To-do laufen.`,
  cmdFailed: (err) => `Der Befehl lief nicht: ${err}`,
  cmdRan: 'Befehl ausgeführt (ohne Turn).',
  holdTwice: 'Zweimal angehalten bei diesem To-do. Bitte selbst entscheiden.',
  secondTime: 'Zum zweiten Mal bei diesem To-do: Die Liste wartet auf dich.',
  unclearFree: 'Unklar, ob Claude frei ist.',
  reloadUnclear: 'Nach dem Neuladen unklar, ob Claude frei ist.',
  reloadInterrupted: 'Die Prüfung wurde durch das Neuladen unterbrochen.',
  thinking: 'denkt nach',
  noAnswer: (reason) => `keine Antwort (${reason})`,
  unreadable: (text) => `unlesbar: ${text}`,

  outcome: { WEITER: 'WEITER', WARTEN: 'WARTEN', FRAGEN: 'FRAGEN', STOPP: 'STOPP' },
  step: (n) => `Stufe ${n}`,
  ofTodo: (text) => `To-do „${text}“`,
  fromChatShort: 'aus dem Chat',
  rulesUnclear: 'Regeln unklar, Haiku erst beim nächsten To-do',
  listIdle: 'Liste leer oder pausiert',

  now: 'JETZT',
  free: '◇ frei',
  fromChat: '◆ aus dem Chat',
  checkingLine: '… prüft, ob Claude sicher fertig ist',
  plan: 'Claudes Plan',
  notePaused: 'Liste pausiert. „Start“ setzt sie fort.',
  noteBlocked: (reason) => `Wartet auf dich: ${reason} „Jetzt starten“ setzt die Liste fort.`,
  noteChecking: 'prüft …',
  noteUnclear: 'Das nächste To-do startet nach einer kurzen Prüfung.',
  noteEmpty: 'Nichts in der Liste. Unten ein To-do eintippen.',
  noteNext: 'Das nächste To-do startet, sobald Claude sicher frei ist.',
  noteSwitching: 'Neuer Chat, Liste wird geladen …',

  noticeTitle: 'HINWEIS · Liste angehalten',
  proceed: 'Weiter',
  markDone: 'Als erledigt abhaken',
  resend: 'Nochmal senden',
  next: 'DANACH',
  nothingOpen: 'nichts offen',
  nOpen: (n) => `${n} offen`,
  paused: '⏸ pausiert',
  placeholder: 'neues To-do, Enter',
  submit: 'einreihen',
  pause: '⏸ Pause',
  start: '▶ Start',
  go: '▶ Jetzt starten',
  history: 'VERLAUF',
  historyEmpty: 'leer',
  nDone: (n) => `${n} erledigt`,
  byHand: 'von Hand',
  today: 'Heute',
  yesterday: 'Gestern',
  showLess: 'weniger zeigen',
  showAll: (n) => `alle ${n} zeigen`,
  renderError: 'Anzeige-Fehler, /todos status',

  sentLine: (n, m) => `· worklist: To-do ${n}/${m} gesendet`,
  sentLabel: 'gesendet:',

  act: {
    read: (f) => `liest ${f}`,
    edit: (f) => `ändert ${f}`,
    write: (f) => `schreibt ${f}`,
    shell: (c) => `Befehl: ${c}`,
    search: (p) => `sucht ${p}`,
    fetch: (u) => `öffnet ${u}`,
    web: (q) => `recherchiert ${q}`,
    agent: (d) => `Helfer: ${d}`,
    plan: 'plant',
    tick: 'hakt ab',
    mcp: (t) => `nutzt ${t}`,
  },

  cmdTodo: 'To-do einreihen: /todo <Aufgabe> (ohne Text: Seitenleiste)',
  cmdTodoHint: '<Aufgabe>',
  cmdTodos: 'To-do-Liste: Seitenleiste, status, pause, resume, done, skip, clear, history, close',
  help: [
    'Nutzung:',
    '  /todo <Aufgabe>         einreihen (alles hinter /todo ist die Aufgabe)',
    '  /todo                   Seitenleiste öffnen',
    '  /todos                  Seitenleiste öffnen',
    '  /todos pause | resume   anhalten bzw. fortsetzen',
    '  /todos done             laufendes abhaken',
    '  /todos skip             laufendes zurück in die Liste',
    '  /todos clear            offene löschen (der Verlauf bleibt)',
    '  /todos history          Verlauf zeigen',
    '  /todos status           Prüfstand, letzte Entscheidung, Haiku-Kosten',
    '  /todos close            Seitenleiste schließen',
  ].join('\n'),
  paneWaiting: (reason) => `Seitenleiste wartet: ${reason}`,
  queued: (n, text) => `Eingereiht (${n} offen): ${text}`,
  pausedMsg: 'Liste pausiert. /todos resume setzt sie fort.',
  resumePaused: 'Nichts anderes offen: Liste pausiert, nichts gesendet. „Start“ bzw. /todos resume schickt das To-do erneut.',
  resumed: 'Liste läuft weiter.',
  resumedEmpty: 'Liste läuft weiter; gerade ist nichts offen.',
  doneMsg: (text) => `Abgehakt: ${text}`,
  noRunning: 'Kein laufendes To-do.',
  skipped: (text, paused) => `Zurück in die Liste: ${text}${paused ? ' · sonst nichts offen, Liste pausiert' : ''}`,
  cleared: (n) => `${n} offene To-dos gelöscht. Der Verlauf bleibt.`,
  unknown: (args) => `Unbekannt: ${args}. Einreihen geht mit /todo <Aufgabe>.`,
  failed: (err) => `Das ging nicht: ${err}`,

  stateWorking: 'Claude arbeitet',
  state: { idle: 'frei', waiting: 'wartet', checking: 'prüft', ask: 'angehalten', blocked: 'wartet auf dich', unclear: 'frei, Prüfung vor dem nächsten Start' },
  statusList: (open, running, paused, done) => `Liste: ${open} offen${running ? ', 1 läuft' : ''}${paused ? ', pausiert' : ''} · in diesem Chat erledigt: ${done}`,
  statusState: (state, reason, hold) => `Prüfstand: ${state}${reason ? ` (${reason})` : ''}${hold ? ' · Schleifenschutz aktiv' : ''}`,
  statusDecision: (d) => `Letzte Entscheidung: ${d}`,
  statusHaiku: (on, last, calls, cost) => `Haiku: ${on ? 'an' : 'aus'} · zuletzt ${last} · bisher ${calls}× im Projekt, ${cost}`,
  statusRun: (auto, max, settle, hint, last) =>
    `In Folge ohne Eingriff: ${auto}/${max} · Beruhigungszeit ${settle} s · unsichtbarer Schluss-Hinweis ${hint ? 'an' : 'aus'}${last ? ` (letztes To-do: ${last})` : ''}`,
  hintAttached: 'angehängt',
  hintMissing: 'nicht angehängt',
  statusHistory: (n) => `Verlauf im Projekt: ${n} Einträge`,

  historyNone: 'Verlauf: noch nichts erledigt in diesem Projekt.',
  historyHead: (n, cut) => `Verlauf (${n}, neueste zuerst${cut ? ', die letzten 30' : ''}):`,
}

export const T: Record<Lang, Strings> = { en, de }
