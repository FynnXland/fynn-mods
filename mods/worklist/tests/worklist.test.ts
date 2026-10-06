import type { Engine, On, RenderNode } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { decideHaiku, decideRules, haikuSystem, isDone, isProblem, isQuestion, parseHaiku } from '../hooks/check.ts'
import type { Facts } from '../hooks/check.ts'
import { DONE_HINTS, DONE_LINES, T, cents, cleanLang, dayDate, hhmm, shortDate } from '../hooks/i18n.ts'
import { commandOfTurn, findSent, firstSentence, hideDoneMarker, move, parseCommand, parseSent, pushSent, textHash } from '../hooks/model.ts'
import type { Queue } from '../hooks/model.ts'
import { renderPane } from '../hooks/view.ts'
import type { Actions, View } from '../hooks/view.ts'

const NOW = new Date(2026, 9, 5, 12, 0, 0).getTime()
const USAGE = { input_tokens: 800, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// ---------- reine Prüfung: Stufen 1–9 ----------

const base: Facts = { reason: 'answer', stopFailure: false, stop: { background: [], crons: 0 }, busyAgents: [], plan: [], answer: 'Alles umgesetzt.\n\nFertig.', lastToolError: false }
const decide = (f: Partial<Facts>) => decideRules({ ...base, ...f }, T.de)
// Die bisherigen Hook-Tests prüfen Fynns deutsche Fassung; die englische hat eigene Tests weiter unten
const DE = { options: { language: 'de' } }

test('Stufe 1–2: Abbruch, Fehler, Ablehnung, StopFailure → STOPP', async () => {
  expect(decide({ reason: 'aborted' })).toMatchObject({ outcome: 'STOPP', stage: 1, reason: 'Abgebrochen.' })
  expect(decide({ reason: 'error' })).toMatchObject({ outcome: 'STOPP', stage: 2 })
  expect(decide({ reason: 'refusal' })).toMatchObject({ outcome: 'STOPP', stage: 2 })
  expect(decide({ stopFailure: true })).toMatchObject({ outcome: 'STOPP', stage: 2 })
  // Abbruch geht vor allem anderen, auch vor Hintergrundarbeit
  expect(decide({ reason: 'aborted', stop: { background: [{ type: 'shell', status: 'running', description: 'x' }], crons: 0 } })?.stage).toBe(1)
})

test('Stufe 3: Hintergrundarbeit (Shell, Subagent, Workflow, Monitor) und Weckaufträge → WARTEN', async () => {
  for (const type of ['shell', 'subagent', 'workflow', 'monitor']) {
    const d = decide({ stop: { background: [{ type, status: 'running', description: 'läuft' }], crons: 0 } })
    expect(d).toMatchObject({ outcome: 'WARTEN', stage: 3 })
    expect(d?.reason).toContain(type)
  }
  expect(decide({ stop: { background: [], crons: 1 } })).toMatchObject({ outcome: 'WARTEN', stage: 3 })
  expect(decide({ stop: { background: [], crons: 0 } })?.outcome).toBe('WEITER')
  // Ohne classic.Stop ist Stufe 3 ungeprüft: kein Fertig nach Regel, Stufe 9 entscheidet (Review 3, K1)
  expect(decide({ stop: null })).toBe(null)
  expect(decide({ stop: null, busyAgents: ['x'] })?.outcome).toBe('WARTEN')
})

test('Stufe 4: laufende Subagents → WARTEN', async () => {
  expect(decide({ busyAgents: ['Tests schreiben'] })).toMatchObject({ outcome: 'WARTEN', stage: 4 })
  expect(decide({ busyAgents: [] })?.outcome).toBe('WEITER')
})

test('Stufe 5: Claudes Plan mit offenen Schritten → FRAGEN', async () => {
  const plan = [
    { id: '1', text: 'a', status: 'completed' as const },
    { id: '2', text: 'b', status: 'in_progress' as const },
    { id: '3', text: 'c', status: 'pending' as const },
  ]
  expect(decide({ plan })).toMatchObject({ outcome: 'FRAGEN', stage: 5, reason: 'Claudes Plan ist noch nicht durch (1/3).' })
  expect(decide({ plan: plan.map((s) => ({ ...s, status: 'completed' as const })) })?.outcome).toBe('WEITER')
})

test('Stufe 6: Rückfragen deutsch und englisch, ? am Ende, nummerierte Optionen → FRAGEN', async () => {
  const asks = [
    'Ich habe zwei Wege gefunden.\n\nWelchen soll ich nehmen?',
    'Das ist vorbereitet.\n\nSoll ich die alte Datei löschen.',
    'Möchtest du, dass ich auch die Tests anpasse',
    'Bitte bestätige, dass ich pushen darf.',
    'Ich brauche noch den API-Namen von dir.',
    'Welche Variante passt dir besser: A oder B',
    'I prepared the change.\n\nShall I commit it',
    'Do you want me to deploy as well',
    'Ist das so richtig?**',
    'Zwei Möglichkeiten:\n\n1. Schnell, aber hässlich\n2. Sauber, aber länger\n\nWas meinst du?',
  ]
  for (const a of asks) {
    expect(isQuestion(a), a).toBe(true)
    expect(decide({ answer: a })?.outcome, a).toBe('FRAGEN')
  }
})

test('Stufe 6: Rückfrage vor einem alleinstehenden „Fertig.“ hält trotzdem an (Fynn, Desktop 2026-10-06)', async () => {
  for (const a of ['Welche Farbe magst du am liebsten?\n\nFertig.', 'Soll ich auch die Tests anpassen?\n\n**Fertig.**', 'Do you want me to deploy?\n\nDone.']) {
    expect(isQuestion(a), a).toBe(true)
    expect(decide({ answer: a }), a).toMatchObject({ outcome: 'FRAGEN', stage: 6 })
  }
  // Gegenprobe: Frage mitten im Text, dann echte Arbeit und „Fertig.“
  expect(decide({ answer: 'Warum ging es kaputt? Der Pfad war falsch.\n\nKorrigiert.\n\nFertig.' })?.outcome).toBe('WEITER')
})

test('Stufe 6, Gegenproben: Frage mitten im Text und Code mit ? → keine Rückfrage', async () => {
  const mid = 'Warum ging der Test kaputt? Weil der Pfad falsch war.\n\nIch habe den Pfad korrigiert, alle Tests sind grün. Fertig.'
  expect(isQuestion(mid)).toBe(false)
  const code = 'Umgesetzt:\n\n```ts\nconst x = a ? b : c\nconst y = maybe?.value\n```\n\nFertig.'
  expect(isQuestion(code)).toBe(false)
  expect(isQuestion('Neu ist `a ?? b` im Code. Erledigt.')).toBe(false)
  // Code-Block am Ende, der mit ? endet
  expect(isQuestion('Hier die Zeile:\n\n```\nwhere x = ?\n```')).toBe(false)
  expect(decide({ answer: code })?.outcome).toBe('WEITER')
  expect(decide({ answer: mid })?.outcome).toBe('WEITER')
})

test('Stufe 7: Problem-Texte, letztes Tool mit Fehler, leere Antwort → FRAGEN', async () => {
  for (const a of ['Der Build ist fehlgeschlagen.', 'Ich konnte die Datei nicht finden.', 'The migration failed.', "I couldn't reach the server.", 'Unable to start the dev server.', 'Der Push ist blockiert.']) {
    expect(isProblem(a, false), a).toBe(true)
    expect(decide({ answer: a }), a).toMatchObject({ outcome: 'FRAGEN', stage: 7 })
  }
  expect(decide({ lastToolError: true })).toMatchObject({ outcome: 'FRAGEN', stage: 7 })
  expect(decide({ answer: '' })).toMatchObject({ outcome: 'FRAGEN', stage: 7 })
  expect(decide({ answer: '```\nnur code\n```' })).toMatchObject({ outcome: 'FRAGEN', stage: 7 })
})

test('Stufe 8: „Fertig.“ am Ende bzw. eindeutig erledigt → WEITER; Verneinung nicht', async () => {
  for (const a of ['Alles erledigt.\n\nFertig.', 'README ergänzt.\n\n**Fertig.**', 'Die Tests laufen. Erledigt.', 'Done, all tests pass.']) {
    expect(isDone(a), a).toBe(true)
    expect(decide({ answer: a }), a).toMatchObject({ outcome: 'WEITER', stage: 8 })
  }
  for (const a of ['Noch nicht fertig, es fehlt der Export.', 'Fast erledigt, morgen der Rest.', 'Not done yet.']) expect(isDone(a), a).toBe(false)
  // Unklar: keine Regel greift → Stufe 9
  expect(decide({ answer: 'Ich habe die Datei angepasst und die Tests ausgeführt.' })).toBe(null)
})

test('Stufe 8, Gegenproben (Review B1): „erledigt/fertig/done“ mitten im Satz ist kein Fertig → Stufe 9', async () => {
  for (const a of [
    'Teil 1 ist erledigt, Teil 2 mache ich als Nächstes.',
    "Here is what I've done so far. Next I will update the docs.",
    'Der erste Schritt ist fertig; jetzt kommt der Export.',
    'Fertig ist nur die Hälfte, der Rest folgt.',
    'Done with the parser. Starting on the tests now.',
    // Marke am Satzanfang, aber eingeschränkt (Review 3, S2)
    'Fertig, bis auf den Export.',
    'Done, except for the migration.',
    'Erledigt, nur die Doku ist noch offen.',
  ]) {
    expect(isDone(a), a).toBe(false)
    expect(decide({ answer: a }), a).toBe(null)
  }
})

test('Stufe 9: Haiku-Antworten auswerten', async () => {
  const j = (o: unknown) => JSON.stringify(o)
  expect(decideHaiku(parseHaiku(j({ verdict: 'done', confidence: 0.9, why: 'Aufgabe umgesetzt' })), T.de)).toMatchObject({ outcome: 'WEITER', stage: 9 })
  expect(decideHaiku(parseHaiku('```json\n' + j({ verdict: 'done', confidence: 0.95, why: 'ok' }) + '\n```'), T.de)).toMatchObject({ outcome: 'WEITER' })
  for (const v of [{ verdict: 'done', confidence: 0.6 }, { verdict: 'question', confidence: 0.9 }, { verdict: 'blocked', confidence: 0.9 }, { verdict: 'unsure', confidence: 0.99 }]) {
    expect(decideHaiku(parseHaiku(j({ ...v, why: 'x' })), T.de).outcome, j(v)).toBe('FRAGEN')
  }
  for (const junk of ['kein json', '{kaputt', j({ verdict: 'vielleicht', confidence: 0.9 }), j({ verdict: 'done', confidence: 2 }), j({ verdict: 'done' })]) {
    expect(parseHaiku(junk), junk).toBe(null)
    expect(decideHaiku(parseHaiku(junk), T.de).outcome).toBe('FRAGEN')
  }
})

test('Modell: Kurz-Ergebnis, Verschieben', async () => {
  expect(firstSentence('**Fertig:** README ergänzt. Danach noch Tests.')).toBe('Fertig: README ergänzt.')
  expect(firstSentence('x'.repeat(300)).length).toBe(120)
  expect(firstSentence('1. **Blau** – Komplementärfarbe. 2. Grau.')).toBe('Blau – Komplementärfarbe.')
  const q: Queue = {
    paused: false,
    items: [
      { id: 'r', text: 'läuft', status: 'running', createdAt: 0 },
      { id: 'a', text: 'a', status: 'open', createdAt: 0 },
      { id: 'b', text: 'b', status: 'open', createdAt: 0 },
    ],
  }
  expect(move(q, 'b', -1).items.map((t) => t.id)).toEqual(['r', 'b', 'a'])
  expect(move(q, 'a', -1).items.map((t) => t.id)).toEqual(['r', 'a', 'b'])
})

test('Modell 0.3.0: Prüfsumme, gemerkte Sendungen, Befehle erkennen', async () => {
  expect(textHash('Tu was')).toBe(textHash('  Tu was \n'))
  expect(textHash('Tu was')).not.toBe(textHash('Tu was.'))
  expect(textHash('a'.repeat(5000))).not.toBe(textHash('a'.repeat(4999)))
  let sent = pushSent([], { id: 'a', h: textHash('Eins'), n: 1, m: 2 })
  sent = pushSent(sent, { id: 'b', h: textHash('Zwei'), n: 2, m: 2 })
  sent = pushSent(sent, { id: 'c', h: textHash('Eins'), n: 3, m: 3 })
  // Gleicher Text zweimal gesendet: der jüngste zählt
  expect(findSent(sent, 'Eins')).toMatchObject({ id: 'c', n: 3 })
  expect(findSent(sent, 'Drei')).toBeUndefined()
  for (let i = 0; i < 80; i++) sent = pushSent(sent, { id: `x${i}`, h: textHash(`t${i}`), n: i, m: i })
  expect(sent).toHaveLength(50)
  expect(parseCommand('/review')).toEqual({ name: 'review', args: '' })
  expect(parseCommand('  /my-plugin:skill  mach das \n gründlich')).toEqual({ name: 'my-plugin:skill', args: 'mach das \n gründlich' })
  for (const t of ['/etc/hosts prüfen', 'README /review', '/ leer', 'nur Text']) expect(parseCommand(t), t).toBe(null)
  expect(commandOfTurn('<command-message>wlproto:echo-skill</command-message>\n<command-name>/wlproto:echo-skill</command-name>')).toBe('/wlproto:echo-skill')
  expect(commandOfTurn('<command-name>/review</command-name>\n<command-args>PR 12</command-args>')).toBe('/review PR 12')
  expect(commandOfTurn('Normale Nachricht')).toBe(null)
  expect(DONE_HINTS.en).toContain('"Done."')
  expect(DONE_HINTS.de).toContain('„Fertig.“')
})

// ---------- Welt für die Hook-Tests ----------

type Agent = { id: string; description: string; type: string; status: string }
type BgTask = { id: string; type: string; status: string; description: string }

function world(
  on: On,
  o: {
    idThrows?: { on: boolean }
    haikuFails?: boolean
    submitDrop?: boolean
    submitThrows?: boolean
    agentsThrow?: { on: boolean }
    registerThrows?: boolean
    storeFail?: { get: boolean; set: boolean }
    // Befehle in der Warteschlange (0.3.0): welche es gibt, was ein Lauf ausgibt, Fehler
    commands?: string[]
    // laufen, stehen aber nicht in $.command.list (wie /cost im Smoke-Test, CLI 2.1.290)
    unlisted?: string[]
    cmdText?: string
    cmdListFails?: boolean
    cmdRunFails?: boolean
  } = {},
) {
  const clock = mock.clock(on, { now: NOW })
  const saved = new Map<string, unknown>()
  const toasts: string[] = []
  const opened: unknown[] = []
  const sent: string[] = []
  const cmdRuns: string[] = []
  const hints: (readonly string[] | undefined)[] = []
  const haikuCalls: string[] = []
  const haikuSystems: string[] = []
  let sid = 's1'
  let agents: Agent[] = []
  let reply: unknown = { isAnswered: true, text: JSON.stringify({ verdict: 'done', confidence: 0.95, why: 'umgesetzt' }), usage: USAGE }
  on('session.start', () => ({ cwd: '/proj' }))
  on('session.id', () => {
    if (o.idThrows?.on) throw new Error('weg')
    return { value: sid }
  })
  on('session.root', () => ({ value: '/proj' }))
  on('store.get', ($, e) => {
    if (o.storeFail?.get) throw new Error('Store kaputt')
    return { value: saved.get(e.key) }
  })
  on('store.set', ($, e) => {
    if (o.storeFail?.set) throw new Error('voll')
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => {
    if (o.registerThrows) throw new Error('Name belegt')
    return { value: undefined }
  })
  on('agent.list', () => {
    if (o.agentsThrow?.on) throw new Error('keine Liste')
    return { value: agents as never }
  })
  on('model.complete', ($, e) => {
    haikuCalls.push(e.prompt)
    haikuSystems.push(e.system ?? '')
    if (o.haikuFails) throw new Error('Netz weg')
    return { value: reply as never }
  })
  const listed = o.commands ?? ['review', 'cost', 'my-plugin:skill']
  on('command.list', () => {
    if (o.cmdListFails) return { deny: 'keine Liste' }
    return { value: listed.map((name) => ({ name, description: name, source: 'plugin' })) as never }
  })
  on('command.run', ($, e) => {
    cmdRuns.push(`/${e.command}${e.args ? ` ${e.args}` : ''}`)
    // Wie die Engine: ein unbekannter Name wird abgelehnt (types: $.command.run). Der werfende Stub wird übersprungen
    // (docs/raw/en/test.md:182), dann lehnt das Kit den Aufruf ab („no implementation for command.run“)
    if (![...listed, ...(o.unlisted ?? [])].includes(e.command)) throw new Error(`no command named /${e.command} in this session`)
    if (o.cmdRunFails) throw new Error('Befehl abgestürzt')
    return o.cmdText === undefined ? {} : { text: o.cmdText }
  })
  on('classic.UserPromptSubmit', () => ({}))
  on('prompt.submit', ($, e) => {
    // Nur was worklist selbst sendet (origin plugin); Fynns Nachrichten laufen hier ebenfalls durch. Ein `/name` mit Herkunft
    // worklist ist der Prompt eines Skill-Befehls aus $.command.run, kein gesendetes To-do
    if (e.origin.kind === 'plugin' && !e.text.startsWith('/')) sent.push(e.text)
    if (o.submitDrop && e.origin.kind === 'plugin') return { drop: 'nein' }
    if (o.submitThrows && e.origin.kind === 'plugin') throw new Error('nicht jetzt')
    return { text: e.text }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('classic.StopFailure', () => ({}))
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String((e as unknown as { subject: string }).subject), subject: 'x' } } } as never
    if (e.tool === 'Bash' && String((e as unknown as { command: string }).command).includes('fail')) return { isError: true, result: 'exit 1' } as never
    return { result: 'ok' } as never
  })
  let n = 0
  return {
    clock,
    saved,
    toasts,
    /** Toasts ohne die Bestätigungen von /todo (Anhalten, Store-Warnung). */
    stops: () => toasts.filter((t) => !/^(Eingereiht|Queued) \(/.test(t)),
    opened,
    sent,
    cmdRuns,
    hints,
    haikuCalls,
    haikuSystems,
    setSid: (s: string) => (sid = s),
    setAgents: (a: Agent[]) => (agents = a),
    setReply: (r: unknown) => (reply = r),
    queue: (s = sid) => (saved.get(`queue:${s}`) as Queue | undefined) ?? { items: [], paused: false },
    history: () => (saved.get('history:/proj') as { text: string; how: string; result: string }[] | undefined) ?? [],
    /** Session starten (lädt das Plugin). */
    start: async ($: Engine) => {
      await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/proj' })
      await flush()
    },
    /** Fynn tippt im Desktop (origin composer) und der Turn beginnt. */
    user: async ($: Engine, text: string) => {
      await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
      n += 1
      await $.turn.start({ turnId: `t${n}`, text })
      await flush()
    },
    /** Ein Turn, den die Engine selbst startet (Hintergrundarbeit fertig). */
    notification: async ($: Engine) => {
      await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } } as never)
      n += 1
      await $.turn.start({ turnId: `t${n}`, text: '<task-notification>' })
      await flush()
    },
    /**
     * Der Turn des zuletzt gesendeten To-dos beginnt (die eigene Nachricht sieht unser prompt.submit-Hook nicht). Davor
     * classic.UserPromptSubmit wie in der Engine (Prototyp, CLI 2.1.290); dessen `additionalContext` landet in `hints`.
     */
    todoTurn: async ($: Engine) => {
      const text = sent[sent.length - 1] ?? ''
      const r = await $.classic.UserPromptSubmit({ hook_event_name: 'UserPromptSubmit', prompt: text } as never)
      hints.push((r as { additionalContext?: readonly string[] }).additionalContext)
      n += 1
      await $.turn.start({ turnId: `t${n}`, text })
      await flush()
    },
    /** Der Turn, den ein Skill-Befehl nach $.command.run auslöst: erst sein `/name` mit Herkunft worklist, dann der Turn. */
    cmdTurn: async ($: Engine, name: string, args = '') => {
      await $.prompt.submit({ text: `/${name}${args ? ` ${args}` : ''}`, wait: false, origin: { kind: 'plugin', name: 'worklist' } } as never)
      n += 1
      const tagArgs = args ? `\n<command-args>${args}</command-args>` : ''
      await $.turn.start({ turnId: `t${n}`, text: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>${tagArgs}` })
      await flush()
    },
    /** Turn-Ende: erst classic.Stop (außer bei Abbruch, Phase 0), dann turn.complete, dann die Prüfung über den Timer. */
    end: async ($: Engine, answer: string, opt: { reason?: 'answer' | 'aborted' | 'error' | 'refusal'; bg?: BgTask[]; crons?: number; failure?: boolean } = {}) => {
      const reason = opt.reason ?? 'answer'
      if (opt.failure) await $.classic.StopFailure({ error: 'server_error', last_assistant_message: answer } as never)
      else if (reason !== 'aborted') {
        await $.classic.Stop({ stop_hook_active: false, last_assistant_message: answer, background_tasks: opt.bg ?? [], session_crons: Array.from({ length: opt.crons ?? 0 }, () => ({})) } as never)
      }
      await $.turn.complete({ turnId: `t${n}`, answer, durationMs: 1000, isAborted: reason === 'aborted', reason } as never)
      await tick(clock, 10)
    },
  }
}

/** Promise-Ketten (Store, Timer) auslaufen lassen. */
async function flush(rounds = 80) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

async function tick(clock: { advance(ms: number): Promise<void> }, ms: number) {
  await flush()
  await clock.advance(ms)
  await flush()
}

// /todo <Aufgabe> reiht ein; alles andere läuft über /todos (Fynn, 2026-10-06)
const ALL = ['', 'status', 'pause', 'resume', 'done', 'skip', 'clear', 'history', 'close', 'help']
const cmd = ($: Engine, args: string) => $.command.run({ command: ALL.includes(args) ? 'todos' : 'todo', args })
const DONE = 'Umgesetzt.\n\nFertig.'

const PANE = (surface: 'desktop' | 'terminal') =>
  ({
    plugin: 'worklist',
    component: 'Pane',
    requestId: 'worklist',
    surface,
    viewport: { columns: 140, rows: 50 },
    props: { title: 'To-dos', isFocused: true, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} },
  }) as const

async function press($: Engine, key: string) {
  const ui = await $.ui.mount(PANE('desktop'))
  const found = await ui.find({ key })
  if (found) await ui.press({ key })
  await ui.unmount()
  return !!found
}

// ---------- Ablauf ----------

test('Zwei To-dos laufen nacheinander durch: Beruhigungszeit, Senden, Abhaken, Verlauf', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'README ergänzen')
  await cmd($, 'Tests schreiben')
  // Beruhigungszeit 3 s: vorher wird nichts gesendet
  await tick(w.clock, 2900)
  expect(w.sent).toEqual([])
  await tick(w.clock, 200)
  expect(w.sent).toHaveLength(1)
  // Beim Modell kommt genau der To-do-Text an (0.3.0); der Schluss-Hinweis geht unsichtbar über classic.UserPromptSubmit mit
  expect(w.sent[0]).toBe('README ergänzen')
  await w.todoTurn($)
  expect(w.hints[0]).toEqual([DONE_HINTS.de])
  await w.end($, 'README ist ergänzt.\n\nFertig.')
  expect(w.history()[0]).toMatchObject({ text: 'README ergänzen', how: 'auto', result: 'README ist ergänzt.' })
  expect(w.haikuCalls).toEqual([]) // Stufe 8: ohne Haiku
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(2)
  expect(w.sent[1]).toBe('Tests schreiben')
  await w.todoTurn($)
  expect(w.hints[1]).toEqual([DONE_HINTS.de])
  await w.end($, DONE)
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(2)
  expect(w.history().map((h) => h.text)).toEqual(['Tests schreiben', 'README ergänzen'])
  expect(w.queue().items).toEqual([])
  // Leere Liste: Schlüssel gelöscht (Store-Platz, Review 3 S3)
  expect(w.saved.has('queue:s1')).toBe(false)
  expect(w.stops()).toEqual([])
})

test('Stufe 1–2 im Ablauf: Abbruch, Fehler, Ablehnung, StopFailure → To-do wieder offen, Hinweis, Toast, Seitenleiste', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  for (const opt of [{ reason: 'aborted' as const }, { reason: 'error' as const }, { reason: 'refusal' as const }, { failure: true }]) {
    const label = JSON.stringify(opt)
    const sentBefore = w.sent.length
    await w.todoTurn($)
    await w.end($, 'halb', opt)
    expect(w.sent.length, label).toBe(sentBefore)
    expect(w.queue().items[0], label).toMatchObject({ text: 'A', status: 'open' })
    expect(w.toasts.at(-1), label).toStartWith('To-do-Liste angehalten:')
    expect(w.opened.length, label).toBeGreaterThan(0)
    await tick(w.clock, 5000)
    expect(w.sent.length, label).toBe(sentBefore)
    // „Nochmal senden“ (der Schleifenschutz greift hier ab dem zweiten Mal; der Knopf setzt trotzdem fort)
    expect(await press($, 'resend'), label).toBe(true)
    await tick(w.clock, 300)
    expect(w.sent.length, label).toBe(sentBefore + 1)
  }
})

test('Stufe 3 im Ablauf: Hintergrundarbeit → WARTEN, danach leere Liste → weiter', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Ich warte auf den Build. Fertig.', { bg: [{ id: '1', type: 'shell', status: 'running', description: 'npm run build' }] })
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
  expect(w.stops()).toEqual([])
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ text: /wartet auf Hintergrundarbeit: 1 Aufgabe \(shell\)/ })).toBeDefined()
  await ui.unmount()
  // Die Engine startet nach der Hintergrundarbeit selbst einen Turn (task-notification)
  await w.notification($)
  await w.end($, 'Build ist grün. Fertig.')
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(2)
  expect(w.sent[1]).toBe('B')
  // Geplanter Weckauftrag → ebenfalls WARTEN
  await w.todoTurn($)
  await w.end($, DONE, { crons: 1 })
  await tick(w.clock, 5000)
  expect(w.queue().items).toHaveLength(1)
})

test('Stufe 4 im Ablauf: agent.list running/pending/waiting → WARTEN; completed/failed/idle → keine Sperre', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  for (const status of ['running', 'pending', 'waiting']) {
    w.setAgents([])
    await cmd($, `X-${status}`)
    await tick(w.clock, 3000)
    const before = w.sent.length
    expect(before, status).toBeGreaterThan(0)
    await w.todoTurn($)
    w.setAgents([{ id: 'a1', description: 'Helfer', type: 'general-purpose', status }])
    await w.end($, DONE)
    await tick(w.clock, 5000)
    expect(w.sent.length, status).toBe(before)
    expect(w.queue().items.find((t) => t.text === `X-${status}`)?.status, status).toBe('running')
    // Helfer fertig: das nächste Turn-Ende prüft neu
    w.setAgents([{ id: 'a1', description: 'Helfer', type: 'general-purpose', status: 'completed' }])
    await w.notification($)
    await w.end($, DONE)
    expect(w.queue().items.find((t) => t.text === `X-${status}`), status).toBeUndefined()
  }
  for (const status of ['completed', 'failed', 'idle']) {
    w.setAgents([{ id: 'a2', description: 'alt', type: 't', status }])
    await cmd($, `Y-${status}`)
    await tick(w.clock, 3000)
    await w.todoTurn($)
    await w.end($, DONE)
    expect(w.queue().items.find((t) => t.text === `Y-${status}`), status).toBeUndefined()
  }
})

test('Stufe 10 mit Helfer: neuer Subagent während der Beruhigungszeit → nicht senden', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 1000)
  w.setAgents([{ id: 'a', description: 'Hintergrund', type: 'x', status: 'running' }])
  await tick(w.clock, 2500)
  expect(w.sent).toEqual([])
  expect((await cmd($, 'status')).text).toContain('wartet')
})

test('Stufe 5 im Ablauf: offener Plan aus TaskCreate → FRAGEN mit Hinweis', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 'u1', subject: 'Schritt 1', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 'u2', subject: 'Schritt 2', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'u3', taskId: 'Schritt 1', status: 'completed' } as never)
  await w.end($, DONE)
  expect(w.toasts.at(-1)).toBe('To-do-Liste angehalten: Claudes Plan ist noch nicht durch (1/2).')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ text: /Claudes Plan ist noch nicht durch/ })).toBeDefined()
  expect(await ui.find({ key: 'mark-done' })).toBeDefined()
  await ui.unmount()
})

test('Stufe 6–7 im Ablauf: Rückfrage und Tool-Fehler halten an; nach Fynns Antwort geht es weiter', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Zwei Wege gibt es.\n\nSoll ich Variante 1 nehmen?')
  expect(w.toasts.at(-1)).toBe('To-do-Liste angehalten: Claude hat eine Rückfrage.')
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
  // Fynn antwortet im Chat; das letzte Tool scheitert → Problem
  await w.user($, 'Ja, Variante 1.')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'fail now' } as never)
  await w.end($, 'Umgesetzt mit Variante 1.')
  expect(w.toasts.at(-1)).toContain('Claude meldet ein Problem.')
  // Fynn bittet um einen neuen Versuch; diesmal klappt es → A abgehakt, B startet
  await w.user($, 'Probier es nochmal.')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'ok' } as never)
  await w.end($, 'Jetzt klappt es. Fertig.')
  await tick(w.clock, 3000)
  expect(w.history()[0]?.text).toBe('A')
  expect(w.sent).toHaveLength(2)
})

test('Stufe 9 im Ablauf: Haiku done 0,95 → weiter; question, done 0,6, Müll, isAnswered false → FRAGEN', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const unclear = 'Ich habe die Datei angepasst und die Tests ausgeführt.'
  await cmd($, 'A')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, unclear)
  expect(w.haikuCalls).toHaveLength(1)
  expect(w.haikuCalls[0]).toContain('Task: A')
  // Begründung auf Deutsch angefordert (language: de)
  expect(w.haikuSystems[0]).toContain('in German')
  expect(w.history()[0]?.text).toBe('A')
  const bad = [
    { isAnswered: true, text: JSON.stringify({ verdict: 'question', confidence: 0.9, why: 'fragt nach' }), usage: USAGE },
    { isAnswered: true, text: JSON.stringify({ verdict: 'done', confidence: 0.6, why: 'unsicher' }), usage: USAGE },
    { isAnswered: true, text: 'Müll', usage: USAGE },
    { isAnswered: false, reason: 'aborted', usage: USAGE },
    { isAnswered: false, reason: 'api-error', status: 529, error: { type: 'overloaded_error', message: 'x' }, usage: USAGE },
  ]
  let i = 0
  for (const r of bad) {
    w.setReply(r)
    i += 1
    // vorherigen Hinweis lösen: „Weiter“ legt das To-do zurück und pausiert (nichts anderes offen), dann aufräumen und fortsetzen
    await press($, 'proceed')
    await cmd($, 'clear')
    await cmd($, 'resume')
    await cmd($, `B${i}`)
    await tick(w.clock, 3000)
    await w.todoTurn($)
    const before = w.toasts.length
    await w.end($, unclear)
    expect(w.toasts.length, JSON.stringify(r)).toBe(before + 1)
  }
  const status = (await cmd($, 'status')).text ?? ''
  expect(status).toContain('Haiku: an')
  expect(status).toContain('6× im Projekt')
})

test('Stufe 9: Haiku wirft → FRAGEN, nichts gesendet', DE, async ($, on) => {
  const w = world(on, { haikuFails: true })
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Ich habe etwas geändert.')
  expect(w.toasts.at(-1)).toContain('Prüfung fehlgeschlagen')
  expect(w.queue().items[0]?.status).toBe('running')
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
})

test('Stufe 9: Haiku aus (userConfig) → FRAGEN ohne Aufruf', { options: { haiku: false, language: 'de' } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Ich habe etwas geändert.')
  expect(w.haikuCalls).toEqual([])
  expect(w.toasts.at(-1)).toContain('Haiku ist aus')
})

test('Stufe 10 (mock.clock): neuer Turn, Pause oder Session-Wechsel während der Beruhigungszeit → kein Senden', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  // neuer Turn
  await cmd($, 'A')
  await tick(w.clock, 1500)
  await w.user($, 'Zwischenfrage')
  await tick(w.clock, 3000)
  expect(w.sent).toEqual([])
  // Ende des Chat-Turns mit „erledigt“ → jetzt startet A
  await w.end($, 'Erledigt.')
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(1)
  await w.todoTurn($)
  await cmd($, 'B')
  await w.end($, DONE)
  // Pause während der Beruhigungszeit
  await tick(w.clock, 1000)
  await cmd($, 'pause')
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
  // Fortsetzen (kurze Wartezeit), dann Session-Wechsel (/clear) vor dem Senden
  await cmd($, 'resume')
  w.setSid('s2')
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
  // Die Liste des alten Chats bleibt, der neue Chat hat eine leere
  expect(w.queue('s1').items.map((t) => t.text)).toEqual(['B'])
  expect(w.queue('s2').items).toEqual([])
})

test('Nach Fynns eigener Nachricht: FRAGEN startet nichts (still), WEITER startet das nächste', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'pause')
  await cmd($, 'A')
  await w.user($, 'Erklär mir kurz X.')
  await cmd($, 'resume')
  await w.end($, 'X ist ein Ding.\n\nWillst du mehr dazu wissen?')
  await tick(w.clock, 5000)
  expect(w.sent).toEqual([])
  expect(w.stops()).toEqual([]) // Chat-Turn: still, kein Toast
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ key: 'pause', text: /Jetzt starten/ })).toBeDefined()
  await ui.unmount()
  await w.user($, 'Nein danke.')
  await w.end($, 'Alles klar, erledigt.')
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(1)
  expect(w.sent[0]).toBe('A')
})

test('Subagent-Turns lösen keine Prüfung aus', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await $.turn.complete({ turnId: 'sub', agentId: 'agent-1', answer: 'Fertig.', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
  expect(w.queue().items[0]?.status).toBe('running')
})

test('Senden scheitert → To-do offen, Hinweis mit Toast', DE, async ($, on) => {
  const w = world(on, { submitDrop: true })
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  expect(w.queue().items[0]?.status).toBe('open')
  expect(w.toasts.at(-1)).toContain('Senden abgelehnt')
})

test('Schleifenschutz: zweimal FRAGEN beim selben To-do → hält auch nach Fynns Chat, erst der Knopf setzt fort', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Soll ich das so machen?')
  await press($, 'resend')
  await tick(w.clock, 300)
  expect(w.sent).toHaveLength(2)
  await w.todoTurn($)
  await w.end($, 'Soll ich es wirklich so machen?')
  expect(w.toasts.at(-1)).toContain('Zum zweiten Mal')
  // Fynn antwortet im Chat, Claude wird fertig: trotzdem kein automatisches Weiter
  await w.user($, 'ja')
  await w.end($, DONE)
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(2)
  // Erst der Knopf setzt fort
  await press($, 'proceed')
  await tick(w.clock, 300)
  expect(w.sent).toHaveLength(3)
})

test('maxAutoRun: nach n To-dos in Folge ohne Eingriff Pause mit Hinweis', { options: { maxAutoRun: 2, language: 'de' } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  for (const t of ['A', 'B', 'C', 'D']) await cmd($, t)
  await tick(w.clock, 3000) // A: von Fynns Eingabe ausgelöst, zählt nicht
  for (let i = 0; i < 3; i++) {
    await w.todoTurn($)
    await w.end($, DONE)
    await tick(w.clock, 3000)
  }
  expect(w.sent).toHaveLength(3) // A, dann B und C automatisch
  expect(w.toasts.at(-1)).toContain('2 To-dos in Folge')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ key: 'mark-done' })).toBeUndefined()
  await ui.press({ key: 'proceed' })
  await ui.unmount()
  await tick(w.clock, 300)
  expect(w.sent).toHaveLength(4)
})

test('Liste pro Chat, Verlauf pro Projekt', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'pause')
  await cmd($, 'nur in s1')
  w.setSid('s2')
  await cmd($, 'pause')
  await cmd($, 'nur in s2')
  expect(w.queue('s1').items.map((t) => t.text)).toEqual(['nur in s1'])
  expect(w.queue('s2').items.map((t) => t.text)).toEqual(['nur in s2'])
  await cmd($, 'resume')
  await tick(w.clock, 3000)
  expect(w.sent.at(-1)).toContain('nur in s2')
  await w.todoTurn($)
  await w.end($, DONE)
  w.setSid('s1')
  await cmd($, 'resume')
  await tick(w.clock, 3000)
  expect(w.sent.at(-1)).toContain('nur in s1')
  await w.todoTurn($)
  await w.end($, DONE)
  expect(w.history().map((h) => h.text)).toEqual(['nur in s1', 'nur in s2'])
})

test('Neustart (--resume): laufendes To-do wieder offen, Liste pausiert, nichts gesendet', DE, async ($, on) => {
  const w = world(on)
  w.saved.set('queue:s1', { items: [{ id: 'x', text: 'halb fertig', status: 'running', createdAt: 0 }], paused: false })
  await w.start($)
  expect(w.queue().items[0]).toMatchObject({ status: 'open' })
  expect(w.queue().paused).toBe(true)
  await tick(w.clock, 5000)
  expect(w.sent).toEqual([])
})

test('Stufe 5 mit TodoWrite (offene Schritte → FRAGEN) und TaskUpdate „deleted“ (Schritt fällt weg)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 'w1',
    todos: [
      { content: 'Eins', status: 'completed', activeForm: 'x' },
      { content: 'Zwei', status: 'in_progress', activeForm: 'x' },
    ],
  } as never)
  await w.end($, DONE)
  expect(w.toasts.at(-1)).toBe('To-do-Liste angehalten: Claudes Plan ist noch nicht durch (1/2).')
  // Nochmal senden: neuer Plan per TaskCreate, offener Schritt wird gelöscht → Plan durch → WEITER
  await press($, 'resend')
  await tick(w.clock, 300)
  await w.todoTurn($)
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 'c1', subject: 'Fertig machen', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 'c2', subject: 'Unnötig', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'c3', taskId: 'Fertig machen', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'c4', taskId: 'Unnötig', status: 'deleted' } as never)
  await w.end($, DONE)
  expect(w.history()[0]?.text).toBe('A')
})

test('Nach /clear (neue Session-ID ohne session.start): alte Liste nicht zeigen, Knöpfe ändern sie nicht (Review S1)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'pause')
  await cmd($, 'Altes To-do')
  const id = w.queue().items[0]?.id ?? ''
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Altes To-do' })).toBeDefined()
  w.setSid('s2')
  // Druck auf den noch gezeichneten Knopf des alten Chats
  await ui.press({ key: `remove-${id}` })
  await tick(w.clock, 10)
  expect(w.queue('s1').items.map((t) => t.text)).toEqual(['Altes To-do'])
  await ui.unmount()
  const fresh = await $.ui.mount(PANE('desktop'))
  expect(await fresh.find({ type: 'Text', text: 'Altes To-do' })).toBeUndefined()
  await fresh.unmount()
  expect((await cmd($, 'status')).text).toContain('Liste: 0 offen')
})

test('Fehlerpfade: Store beim Start kaputt, Speichern scheitert → kein Absturz, Liste arbeitet im Speicher', DE, async ($, on) => {
  const fail = { get: true, set: true }
  const w = world(on, { storeFail: fail })
  await w.start($)
  expect(await cmd($, 'Trotzdem')).toEqual({})
  expect(w.toasts).toContain('Eingereiht (1 offen): Trotzdem')
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(1)
  await w.todoTurn($)
  fail.get = false
  fail.set = false
  await w.end($, DONE)
  expect(w.history()[0]?.text).toBe('Trotzdem')
})

test('Review 2, B1: Rückfrage bzw. Hintergrundarbeit im letzten Chat-Turn → ein neues To-do startet nicht von selbst', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.user($, 'Räum mal auf.')
  await w.end($, 'Zwei Dateien sind alt.\n\nSoll ich die alte Datei löschen?', { bg: [{ id: '1', type: 'shell', status: 'running', description: 'build' }] })
  await cmd($, 'README ergänzen')
  await tick(w.clock, 5000)
  expect(w.sent).toEqual([])
  // Nur „Jetzt starten“ setzt sich bewusst darüber hinweg
  expect(await press($, 'pause')).toBe(true)
  await tick(w.clock, 300)
  expect(w.sent).toHaveLength(1)
})

test('Review 2, B1: Rückfrage im Chat → eingereihtes To-do wartet; nach Fynns Antwort und Haiku „done“ startet es', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.user($, 'Was meinst du?')
  await w.end($, 'Soll ich das so lassen?')
  await cmd($, 'A')
  await tick(w.clock, 5000)
  expect(w.sent).toEqual([])
  await w.user($, 'Lass es so.')
  await w.end($, 'Ich habe es so gelassen und die Datei gespeichert.')
  // A wartet bereits: Das unklare Turn-Ende prüft Haiku sofort (done 0,95), danach startet A
  expect(w.haikuCalls).toHaveLength(1)
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(1)
})

test('Review 2, B1: unklares Turn-Ende bei leerer Liste → Haiku erst beim Einreihen, dann Start', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.user($, 'Mach X.')
  await w.end($, 'Ich habe X umgesetzt und die Datei gespeichert.')
  expect(w.haikuCalls).toEqual([])
  await cmd($, 'A')
  await tick(w.clock, 10)
  expect(w.haikuCalls).toHaveLength(1)
  await tick(w.clock, 3000)
  expect(w.sent).toHaveLength(1)
  // Haiku sagt „question“ → nichts startet
  w.setReply({ isAnswered: true, text: JSON.stringify({ verdict: 'question', confidence: 0.9, why: 'fragt' }), usage: USAGE })
  await w.todoTurn($)
  await w.end($, DONE)
  await w.user($, 'Und Y?')
  await w.end($, 'Y habe ich mir angeschaut, es gibt zwei Wege.')
  await cmd($, 'B')
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
})

test('Review 2, B2: pausiert + /todo done ohne laufendes To-do → Pause bleibt, nichts gesendet', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'pause')
  await cmd($, 'A')
  expect(await cmd($, 'done')).toMatchObject({ text: 'Kein laufendes To-do.' })
  await tick(w.clock, 5000)
  expect(w.sent).toEqual([])
  expect(w.queue().paused).toBe(true)
})

test('Hot Reload: Laufzustand bleibt, hängende Prüfung wird aufgeräumt (Review 2, S2)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, DONE, { bg: [{ id: '1', type: 'shell', status: 'running', description: 'x' }] })
  // Reload: session.start mit derselben Session-ID; WARTEN bleibt, kein Hinweis
  await w.start($)
  expect((await cmd($, 'status')).text).toContain('Prüfstand: wartet')
  await w.notification($)
  await w.end($, DONE)
  expect(w.history()[0]?.text).toBe('A')
})

test('Fehlerpfade: Senden wirft, Agentenliste wirft, Befehl nicht registrierbar', DE, async ($, on) => {
  const agents = { on: false }
  const w = world(on, { submitThrows: true, agentsThrow: agents, registerThrows: true })
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  expect(w.queue().items[0]?.status).toBe('open')
  expect(w.toasts.at(-1)).toContain('Senden ging nicht')
  // Agentenliste wirft während der Beruhigungszeit → nicht senden
  agents.on = true
  await press($, 'proceed')
  await tick(w.clock, 1000)
  expect(w.queue().items.every((t) => t.status === 'open')).toBe(true)
})

test('Review 3, S2: „Erledigt, aber die Tests schlagen noch fehl.“ → Problem (Stufe 7)', async () => {
  expect(decide({ answer: 'Erledigt, aber die Tests schlagen noch fehl.' })).toMatchObject({ outcome: 'FRAGEN', stage: 7 })
})

test('Review 3, S1: Einreihen im Fenster zwischen Turn-Ende und Prüfung → wartet auf das Ergebnis (Rückfrage → nicht senden)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.user($, 'Räum auf.')
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'x', background_tasks: [], session_crons: [] } as never)
  await $.turn.complete({ turnId: 't1', answer: 'Soll ich die alte Datei löschen?', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  // Noch vor dem 10-ms-Tick der Prüfung
  await cmd($, 'A')
  await tick(w.clock, 5000)
  expect(w.sent).toEqual([])
  // Gegenprobe: sauberes Turn-Ende, im Fenster eingereiht → startet nach der Prüfung
  await w.user($, 'Nein, lass sie.')
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'x', background_tasks: [], session_crons: [] } as never)
  await $.turn.complete({ turnId: 't2', answer: 'Alles klar. Fertig.', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await cmd($, 'B')
  await tick(w.clock, 3100)
  expect(w.sent).toHaveLength(1)
  expect(w.sent[0]).toBe('A')
})

test('Review 3, K7: zweimal schnell einreihen im Zustand „unklar“ → nur eine Haiku-Prüfung', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.user($, 'Mach X.')
  await w.end($, 'Ich habe X umgesetzt und gespeichert.')
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3100)
  expect(w.haikuCalls).toHaveLength(1)
  expect(w.sent).toHaveLength(1)
})

test('Hot Reload mit laufendem, ungeprüftem To-do → Hinweis statt Weiterlaufen (Review 3, K8)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  // Turn-Ende kommt an, die Prüfung (Timer) läuft aber nicht mehr, weil neu geladen wird
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'x', background_tasks: [], session_crons: [] } as never)
  await $.turn.complete({ turnId: 'tx', answer: DONE, durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await w.start($) // Reload vor dem 10-ms-Tick
  await tick(w.clock, 10)
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ text: /durch das Neuladen unterbrochen/ })).toBeDefined()
  await ui.unmount()
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
})

test('Zeichenfehler → einfacher Ersatzbaum statt leerem Pane', DE, async ($, on) => {
  const idThrows = { on: false }
  const w = world(on, { idThrows })
  await w.start($)
  idThrows.on = true
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ text: /Anzeige-Fehler, \/todos status/ })).toBeDefined()
  await ui.unmount()
})

// ---------- Zeichnung ----------

test('Seitenleiste auf Desktop und Terminal: Bereiche, Knöpfe, Eingabe, Verlauf durchgestrichen', DE, async ($, on) => {
  const w = world(on)
  w.saved.set('history:/proj', [{ text: 'Altes To-do', doneAt: NOW - 60_000, durationMs: 120_000, sessionId: 's0', result: 'Gemacht.', how: 'auto' }])
  await w.start($)
  await cmd($, 'pause')
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    const inputKey = async () => (await ui.find({ type: 'Input' }))?.key ?? ''
    const first = await inputKey()
    await ui.input({ key: first, text: 'Eins', kind: 'submit' })
    await flush()
    // Nach dem Einreihen ein neues, leeres Feld (anderer Schlüssel); Leerzeilen lassen es stehen
    const second = await inputKey()
    expect(second, surface).not.toBe(first)
    expect((await ui.find({ type: 'Input' }))?.props, surface).toMatchObject({ value: '' })
    await ui.input({ key: second, text: '   ', kind: 'submit' })
    await flush()
    expect(await inputKey(), surface).toBe(second)
    await ui.input({ key: second, text: 'Zwei', kind: 'submit' })
    await flush()
    expect(w.queue().items.map((t) => t.text), surface).toEqual(['Eins', 'Zwei'])
    for (const t of ['JETZT', 'DANACH', 'VERLAUF']) expect(await ui.find({ text: new RegExp(t) }), `${surface} ${t}`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Eins' }), surface).toBeDefined()
    const ids = w.queue().items.map((t) => t.id)
    await ui.press({ key: `down-${ids[0]}` })
    await flush()
    expect(w.queue().items.map((t) => t.text)).toEqual(['Zwei', 'Eins'])
    await ui.press({ key: `up-${ids[0]}` })
    await flush()
    expect(w.queue().items.map((t) => t.text)).toEqual(['Eins', 'Zwei'])
    await ui.press({ key: `remove-${ids[1]}` })
    await ui.press({ key: `remove-${ids[0]}` })
    await flush()
    expect(w.queue().items).toEqual([])
    await ui.press({ key: 'history' })
    const old = await ui.find({ type: 'Text', text: /✓ Altes To-do/ })
    expect(old?.props, surface).toMatchObject({ strikethrough: true, dimColor: true })
    await ui.press({ key: 'history' })
    expect(await ui.find({ key: 'pause', text: /Start/ })).toBeDefined()
    await ui.unmount()
  }
  // Start/Pause per Knopf
  // (Die Liste ist leer, ihr Schlüssel im Store gelöscht: der Zustand steht in /todos status)
  await press($, 'pause')
  await flush()
  expect((await cmd($, 'status')).text).not.toContain('pausiert')
  await press($, 'pause')
  await flush()
  expect((await cmd($, 'status')).text).toContain('pausiert')
})

test('Hinweisblock: Abhaken und Weiter per Knopf', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Soll ich?')
  const ui = await $.ui.mount(PANE('desktop'))
  for (const key of ['proceed', 'mark-done', 'resend']) expect(await ui.find({ key }), key).toBeDefined()
  await ui.unmount()
  // Abhaken: A in den Verlauf (von Hand), B startet
  await press($, 'mark-done')
  await tick(w.clock, 300)
  expect(w.history()[0]).toMatchObject({ text: 'A', how: 'manual' })
  expect(w.sent.at(-1)).toBe('B')
  // Weiter: B ans Ende, C startet
  await w.todoTurn($)
  await w.end($, 'Soll ich?')
  await cmd($, 'C')
  await press($, 'proceed')
  await tick(w.clock, 300)
  expect(w.sent.at(-1)).toBe('C')
  // C läuft (vorn), B wartet dahinter
  expect(w.queue().items.map((t) => `${t.text}:${t.status}`)).toEqual(['C:running', 'B:open'])
})

test('Zwischengespeicherter Baum: ohne Datenänderung dasselbe Objekt, mit Änderung neu', async () => {
  const mk = (type: string) => (p: Record<string, unknown>) => ({ type, props: p }) as unknown as RenderNode
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') }
  const noop = () => undefined
  const act: Actions = { proceed: noop, markDone: noop, resend: noop, up: noop, down: noop, remove: noop, add: noop, draft: noop, control: noop, toggleHistory: noop, toggleAll: noop }
  const v: View = {
    lang: 'de',
    now: { kind: 'free', note: 'frei' },
    notice: { reason: 'Rückfrage', hasTodo: true },
    queue: [{ id: 'a', text: 'A' }],
    paused: false,
    control: 'pause',
    draft: '',
    history: [],
    historyOpen: false,
    historyAll: false,
    todayStart: NOW,
    inputKey: 'new-todo',
  }
  const cache = new Map<string, { sig: string; node: RenderNode }>()
  const kids = (n: RenderNode) => (n as unknown as { props: { children: RenderNode[] } }).props.children
  const a = kids(renderPane(el as never, v, T.de, act, 48, 'desktop', cache))
  const b = kids(renderPane(el as never, v, T.de, act, 48, 'desktop', cache))
  expect(b.length).toBe(4)
  for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i])
  const c = kids(renderPane(el as never, { ...v, queue: [{ id: 'b', text: 'B' }] }, T.de, act, 48, 'desktop', cache))
  expect(c[0]).toBe(a[0]) // JETZT unverändert
  expect(c[1]).toBe(a[1]) // HINWEIS unverändert
  expect(c[2]).not.toBe(a[2]) // DANACH neu
  const d = kids(renderPane(el as never, v, T.de, act, 60, 'desktop', cache))
  expect(d[0]).not.toBe(a[0]) // andere Breite → neu
})

test('Gesendetes To-do im Chat: orange Zeile und Rahmen am genauen Text (0.3.0), alte Nachrichten mit Präfix weiter; fremde unverändert', DE, async ($, on) => {
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`engine:${String((e.props as { text?: string }).text ?? '')}`] }))
  const w = world(on)
  await w.start($)
  await cmd($, 'Erstes')
  await cmd($, 'Nenne drei Farben, die zu Orange passen.')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, DONE)
  await tick(w.clock, 3000)
  expect(w.sent).toEqual(['Erstes', 'Nenne drei Farben, die zu Orange passen.'])
  const text = w.sent[1] ?? ''
  const row = (surface: 'desktop' | 'terminal' | 'vscode', origin: unknown, isExpanded = true, body = text) =>
    $.ui.mount({ plugin: 'worklist', component: 'UserMessage', requestId: 'm1', surface, props: { text: body, origin, isExpanded } } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await row(surface, { kind: 'plugin', name: 'worklist', asUser: true })
    expect(JSON.stringify(await ui.find({ key: 'worklist-line' })), surface).toContain('· worklist: To-do 2/2 gesendet')
    const frame = await ui.find({ key: 'worklist-sent' })
    expect(frame?.props, surface).toMatchObject({ borderStyle: 'round', borderColor: '#D77757' })
    expect(JSON.stringify(frame), surface).toContain('Nenne drei Farben, die zu Orange passen.')
    expect(await ui.find({ text: /^engine:/ }), surface).toBeUndefined()
    await ui.unmount()
  }
  // Andere Herkunft (der Desktop meldet worklists To-dos als sdk), aber genau der gesendete Text → unser Rahmen
  for (const origin of [{ kind: 'sdk' }, { kind: 'unclassified' }]) {
    const ui = await row('desktop', origin)
    expect(await ui.find({ key: 'worklist-sent' }), origin.kind).toBeDefined()
    await ui.unmount()
  }
  // Fynn tippt im Desktop (composer) genau denselben Text: seine Nachricht bleibt seine (Review 0.3.0, K1)
  const typed = await row('desktop', { kind: 'composer' })
  expect(await typed.find({ key: 'worklist-sent' })).toBeUndefined()
  await typed.unmount()
  // Terminal kompakt: nur die Zeile
  const compact = await row('terminal', { kind: 'plugin', name: 'worklist' }, false)
  expect(await compact.find({ key: 'worklist-line' })).toBeDefined()
  expect(await compact.find({ key: 'worklist-sent' })).toBeUndefined()
  await compact.unmount()
  // VS Code: nur Text
  const vs = await row('vscode', { kind: 'plugin', name: 'worklist' })
  expect(JSON.stringify(await vs.drawn())).toContain('engine:· worklist: To-do 2/2 gesendet')
  await vs.unmount()
  // Alte Nachricht (bis 0.2.2) mit Präfix und Schlusszeile: weiter erkannt, ohne Schlusszeile gezeigt
  const old = await row('desktop', { kind: 'sdk' }, true, `[To-do 3/7] Alt\n\n${DONE_LINES.de}`)
  expect(JSON.stringify(await old.find({ key: 'worklist-line' }))).toContain('To-do 3/7 gesendet')
  expect(JSON.stringify(await old.find({ key: 'worklist-sent' }))).not.toContain('Arbeitsliste')
  await old.unmount()
  // Fynns eigene Nachricht, ein anderer Text, ein Peer mit genau dem To-do-Text: unverändert
  for (const [origin, body] of [
    [{ kind: 'composer' }, '[To-do 1/1] Selbst getippt, ohne Schlusszeile'],
    [{ kind: 'composer' }, 'Nenne drei Farben, die zu Orange passen. Bitte.'],
    [{ kind: 'plugin', name: 'worklist' }, 'kein To-do'],
    [{ kind: 'peer' }, text],
  ] as const) {
    const ui = await row('desktop', origin, true, body)
    expect(await ui.find({ key: 'worklist-line' }), body).toBeUndefined()
    expect(await ui.find({ text: /^engine:/ }), body).toBeDefined()
    await ui.unmount()
  }
})

test('Rahmen im Chat nach Neustart bzw. Resume: gemerkte Sendungen kommen aus dem Store', DE, async ($, on) => {
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`engine:${String((e.props as { text?: string }).text ?? '')}`] }))
  const w = world(on)
  w.saved.set('sent:s1', [{ id: 'x', h: textHash('Von gestern'), n: 4, m: 6 }, { kaputt: true }])
  await w.start($)
  const ui = await $.ui.mount({ plugin: 'worklist', component: 'UserMessage', requestId: 'm1', surface: 'desktop', props: { text: 'Von gestern', origin: { kind: 'sdk' }, isExpanded: true } } as never)
  expect(JSON.stringify(await ui.find({ key: 'worklist-line' }))).toContain('To-do 4/6 gesendet')
  await ui.unmount()
  // Ein anderer Chat (/resume, neue Session-ID): dessen Sendungen, nicht die alten
  w.saved.set('sent:s2', [{ id: 'y', h: textHash('Aus Chat zwei'), n: 1, m: 1 }])
  w.setSid('s2')
  await cmd($, 'status')
  const two = await $.ui.mount({ plugin: 'worklist', component: 'UserMessage', requestId: 'm2', surface: 'desktop', props: { text: 'Aus Chat zwei', origin: { kind: 'sdk' }, isExpanded: true } } as never)
  expect(await two.find({ key: 'worklist-sent' })).toBeDefined()
  await two.unmount()
  const one = await $.ui.mount({ plugin: 'worklist', component: 'UserMessage', requestId: 'm3', surface: 'desktop', props: { text: 'Von gestern', origin: { kind: 'sdk' }, isExpanded: true } } as never)
  expect(await one.find({ key: 'worklist-sent' })).toBeUndefined()
  await one.unmount()
})

test('„Fertig.“ am Ende einer Antwort nur in der Anzeige ausgeblendet; mitten im Satz oder „Erledigt.“ bleiben', DE, async ($, on) => {
  expect(hideDoneMarker('Welche Farbe magst du?\n\nFertig.')).toBe('Welche Farbe magst du?')
  expect(hideDoneMarker('OK\nFertig.')).toBe('OK')
  expect(hideDoneMarker('Erledigt.\n\n**Fertig.**  ')).toBe('Erledigt.')
  expect(hideDoneMarker('Fertig.')).toBe('')
  // „Done.“ ist die englische Marke und wird ebenso ausgeblendet
  expect(hideDoneMarker('All set up.\n\nDone.')).toBe('All set up.')
  for (const t of ['Ich bin fertig.', 'Fertig ist nur Teil 1.', 'Alles erledigt.', 'Done with the parser.']) expect(hideDoneMarker(t), t).toBe(t)
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`engine:${String((e.props as { text?: string }).text ?? '')}`] }))
  const w = world(on)
  await w.start($)
  const block = (text: string) =>
    $.ui.mount({ plugin: 'worklist', component: 'AssistantMessage', requestId: 'a1', surface: 'desktop', props: { text, isFirstOfReply: true } } as never)
  let ui = await block('OK\n\nFertig.')
  expect(JSON.stringify(await ui.drawn())).toContain('engine:OK')
  expect(JSON.stringify(await ui.drawn())).not.toContain('Fertig')
  await ui.unmount()
  ui = await block('Fertig.')
  expect(JSON.stringify(await ui.drawn())).not.toContain('Fertig')
  await ui.unmount()
  ui = await block('Normale Antwort.')
  expect(JSON.stringify(await ui.drawn())).toContain('engine:Normale Antwort.')
  await ui.unmount()
})

test('„Weiter“ ohne weitere To-dos: nicht dasselbe nochmal senden, Liste pausiert (Fynn, Desktop 2026-10-06)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'Frag mich, welche Farbe ich will.')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Welche Farbe magst du am liebsten?\n\nFertig.')
  expect(w.toasts.at(-1)).toContain('Rückfrage')
  await press($, 'proceed')
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
  expect(w.queue().paused).toBe(true)
  expect(w.queue().items.map((t) => `${t.text}:${t.status}`)).toEqual(['Frag mich, welche Farbe ich will.:open'])
})

test('Review 4, S1: /todos resume und skip bei Hinweis mit nur einem To-do melden die Pause ehrlich', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'Frag mich was.')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'Was genau?')
  expect((await cmd($, 'resume')).text).toContain('Liste pausiert, nichts gesendet')
  await tick(w.clock, 5000)
  expect(w.sent).toHaveLength(1)
  // Nochmal anhalten lassen, dann skip
  await cmd($, 'resume')
  await tick(w.clock, 300)
  expect(w.sent).toHaveLength(2)
  await w.todoTurn($)
  await w.end($, 'Was genau?')
  expect((await cmd($, 'skip')).text).toContain('sonst nichts offen, Liste pausiert')
})

test('Review 4: Peer-Nachricht im To-do-Format bleibt unverändert; „Fertig.“ auch im Terminal ausgeblendet', DE, async ($, on) => {
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`engine:${String((e.props as { text?: string }).text ?? '')}`] }))
  const w = world(on)
  await w.start($)
  const text = `[To-do 1/1] Etwas\n\n${DONE_LINES.de}`
  const peer = await $.ui.mount({ plugin: 'worklist', component: 'UserMessage', requestId: 'p1', surface: 'desktop', props: { text, origin: { kind: 'peer' }, isExpanded: true } } as never)
  expect(await peer.find({ key: 'worklist-sent' })).toBeUndefined()
  await peer.unmount()
  const ui = await $.ui.mount({ plugin: 'worklist', component: 'AssistantMessage', requestId: 'a2', surface: 'terminal', props: { text: 'OK\n\nFertig.', isFirstOfReply: true } } as never)
  expect(JSON.stringify(await ui.drawn())).not.toContain('Fertig')
  await ui.unmount()
})

// ---------- Sprache (release/I18N.md) ----------

test('i18n: beide Tabellen haben dieselben Schlüssel, keine leeren Texte', async () => {
  const shape = (o: unknown, path = ''): string[] =>
    o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => [`${path}${k}`, ...shape(v, `${path}${k}.`)]) : []
  expect(shape(T.de).sort()).toEqual(shape(T.en).sort())
  const leaves = (o: unknown): unknown[] => (o && typeof o === 'object' ? Object.values(o).flatMap(leaves) : [o])
  for (const lang of ['en', 'de'] as const) {
    for (const v of leaves(T[lang])) {
      if (typeof v === 'string') expect(v.trim().length, lang).toBeGreaterThan(0)
      else expect(typeof v, lang).toBe('function')
    }
  }
})

test('i18n: Formatierer für Datum und Kosten', async () => {
  const t = new Date(2026, 9, 6, 9, 5).getTime()
  expect(shortDate('en', t)).toBe('Oct 6')
  expect(shortDate('de', t)).toBe('06.10.')
  expect(dayDate('en', t)).toBe('Tue Oct 6')
  expect(dayDate('de', t)).toBe('Di 06.10.')
  expect(hhmm(t)).toBe('09:05')
  expect(cents('en', 0.0005)).toBe('0.05 ¢')
  expect(cents('de', 0.0005)).toBe('0,05 ct')
  expect(cleanLang('de')).toBe('de')
  expect(cleanLang('fr')).toBe('en')
  expect(cleanLang(undefined)).toBe('en')
})

test('i18n: Gründe in der eingestellten Sprache, Erkennung immer zweisprachig', async () => {
  const en = (f: Partial<Facts>) => decideRules({ ...base, ...f }, T.en)
  expect(en({ answer: 'Soll ich die Datei löschen?' })).toMatchObject({ outcome: 'FRAGEN', reason: 'Claude has a question.' })
  expect(en({ answer: 'Shall I delete the file' })?.reason).toBe('Claude has a question.')
  expect(en({ answer: 'Der Build ist fehlgeschlagen.' })?.reason).toBe('Claude reports a problem.')
  expect(en({ answer: 'Alles umgesetzt.\n\nFertig.' })?.outcome).toBe('WEITER')
  expect(en({ answer: 'All implemented.\n\nDone.' })?.outcome).toBe('WEITER')
  expect(en({ answer: 'Welche Farbe magst du?\n\nDone.' })?.outcome).toBe('FRAGEN')
  expect(en({ stop: { background: [{ type: 'shell', status: 'running', description: 'x' }], crons: 1 } })?.reason).toBe(
    'waiting for background work: 1 task (shell), 1 scheduled wake-up',
  )
  expect(decideHaiku(parseHaiku(JSON.stringify({ verdict: 'question', confidence: 0.9, why: 'asks the user' })), T.en).reason).toBe(
    'Claude is waiting for you. Haiku: asks the user',
  )
})

test('i18n: Haiku antwortet in der eingestellten Sprache', async () => {
  expect(haikuSystem(T.en)).toContain('in English')
  expect(haikuSystem(T.de)).toContain('in German')
})

test('i18n: Schlusszeilen bis 0.2.2 je Sprache; alle Fassungen werden im Chat weiter erkannt', async () => {
  for (const lang of ['en', 'de'] as const) expect(parseSent(`[To-do 1/2] Do it\n\n${DONE_LINES[lang]}`)).toMatchObject({ text: 'Do it', withLine: true, n: 1, m: 2 })
  expect(parseSent('[To-do 1/2] Do it')).toMatchObject({ text: 'Do it', withLine: false })
  const old = '[To-do 1/1] Alt\n\n(Arbeitsliste: Ist etwas unklar, stell am Ende eine klare Rückfrage. Sonst erledige die Aufgabe vollständig und schließe mit „Fertig.“)'
  expect(parseSent(old)).toMatchObject({ text: 'Alt', withLine: true })
})

test('Englisch (Standard): Haiku wird im echten Ablauf um eine englische Begründung gebeten', async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  await w.end($, 'I changed the file and ran the tests.')
  expect(w.haikuSystems).toHaveLength(1)
  expect(w.haikuSystems[0]).toContain('in English')
  expect(w.history()[0]?.text).toBe('A')
})

test('Englisch (Standard): Ablauf, Toast, Seitenleiste, Chat-Zeile, Status', async ($, on) => {
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`engine:${String((e.props as { text?: string }).text ?? '')}`] }))
  const w = world(on)
  await w.start($)
  expect(await cmd($, 'Write the README')).toEqual({})
  expect(w.toasts.at(-1)).toBe('Queued (1 open): Write the README')
  await cmd($, 'Add tests')
  await tick(w.clock, 3000)
  expect(w.sent[0]).toBe('Write the README')
  await w.todoTurn($)
  expect(w.hints[0]).toEqual([DONE_HINTS.en])
  await w.end($, 'README written.\n\nDone.')
  expect(w.history()[0]).toMatchObject({ text: 'Write the README', result: 'README written.' })
  await tick(w.clock, 3000)
  await w.todoTurn($)
  // Deutsche Rückfrage wird auch im englischen Modus erkannt
  await w.end($, 'Soll ich auch Snapshots anlegen?')
  expect(w.toasts.at(-1)).toBe('To-do list stopped: Claude has a question.')
  const pane = await $.ui.mount(PANE('desktop'))
  for (const t of ['NOW', 'NOTICE · list stopped', 'NEXT', 'HISTORY']) expect(await pane.find({ text: new RegExp(t) }), t).toBeDefined()
  expect(JSON.stringify(await pane.find({ key: 'proceed' }))).toContain('Continue')
  expect(JSON.stringify(await pane.find({ key: 'mark-done' }))).toContain('Mark as done')
  await pane.press({ key: 'history' })
  expect(await pane.find({ text: 'Today' })).toBeDefined()
  await pane.unmount()
  const row = await $.ui.mount({
    plugin: 'worklist',
    component: 'UserMessage',
    requestId: 'm1',
    surface: 'desktop',
    props: { text: w.sent[1], origin: { kind: 'sdk' }, isExpanded: true },
  } as never)
  expect(JSON.stringify(await row.find({ key: 'worklist-line' }))).toContain('· worklist: to-do 2/2 sent')
  expect(JSON.stringify(await row.find({ key: 'worklist-sent' }))).toContain('sent:')
  await row.unmount()
  const status = (await cmd($, 'status')).text ?? ''
  expect(status).toContain('List: 0 open, 1 running · done in this chat: 1')
  expect(status).toContain('Check state: stopped (Claude has a question.)')
  expect(status).toContain('0.00 ¢')
  expect((await cmd($, 'help')).text).toContain('Usage:')
  expect((await cmd($, 'history')).text).toContain('History (1, newest first)')
})

// ---------- 0.3.0: unsichtbarer Schluss-Hinweis ----------

test('Schluss-Hinweis nur zum eigenen To-do und nur einmal; Fynns Nachrichten bleiben ohne; Status zeigt, ob er ankam', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  // Fynns eigene Nachricht: kein Kontext
  const mine = await $.classic.UserPromptSubmit({ hook_event_name: 'UserPromptSubmit', prompt: 'Hallo' } as never)
  expect((mine as { additionalContext?: unknown }).additionalContext).toBeUndefined()
  await w.user($, 'Hallo')
  await w.end($, DONE)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  expect(w.sent).toEqual(['A'])
  // Eine andere Nachricht vor dem To-do (gleicher Moment, anderer Text) bekommt ihn nicht
  const other = await $.classic.UserPromptSubmit({ hook_event_name: 'UserPromptSubmit', prompt: 'B' } as never)
  expect((other as { additionalContext?: unknown }).additionalContext).toBeUndefined()
  await w.todoTurn($)
  expect(w.hints).toEqual([[DONE_HINTS.de]])
  // Nach dem Turn-Start nicht mehr: derselbe Text später im Chat bekommt ihn nicht erneut
  const again = await $.classic.UserPromptSubmit({ hook_event_name: 'UserPromptSubmit', prompt: 'A' } as never)
  expect((again as { additionalContext?: unknown }).additionalContext).toBeUndefined()
  expect((await cmd($, 'status')).text).toContain('unsichtbarer Schluss-Hinweis an (letztes To-do: angehängt)')
})

test('Schluss-Hinweis: kommt classic.UserPromptSubmit nicht, meldet der Status „nicht angehängt“; der Turn wird trotzdem erkannt', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  await $.turn.start({ turnId: 'tx', text: 'A' })
  await flush()
  expect((await cmd($, 'status')).text).toContain('(letztes To-do: nicht angehängt)')
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: DONE, background_tasks: [], session_crons: [] } as never)
  await $.turn.complete({ turnId: 'tx', answer: DONE, durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await tick(w.clock, 10)
  expect(w.history()[0]).toMatchObject({ text: 'A', how: 'auto' })
})

test('Schluss-Hinweis aus (doneLine: false): kein Kontext, Status „aus“', { options: { doneLine: false, language: 'de' } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  expect(w.hints).toEqual([undefined])
  expect((await cmd($, 'status')).text).toContain('unsichtbarer Schluss-Hinweis aus')
})

test('Turn eines eigenen To-dos am genauen Text erkannt; ein anderer Turn dazwischen zählt zum laufenden To-do, nicht als „von Fynn“', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, 'A')
  await cmd($, 'B')
  await tick(w.clock, 3000)
  await w.todoTurn($)
  // Antwort ohne Marke: Haiku entscheidet (Stufe 9) und bekommt den To-do-Text ohne Präfix
  await w.end($, 'Ich habe die Datei angepasst.')
  expect(w.haikuCalls[0]).toContain('Task: A\n')
  expect(w.history()[0]).toMatchObject({ text: 'A', how: 'auto' })
  await tick(w.clock, 3000)
  expect(w.sent).toEqual(['A', 'B'])
})

// ---------- 0.3.0: Befehle in der Warteschlange ----------

test('Befehl als To-do: Skill-Befehl läuft per $.command.run, sein Turn zählt zum To-do, Haiku prüft „führe /x aus“', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, '/my-plugin:skill mach das')
  await cmd($, 'Danach')
  await tick(w.clock, 3000)
  expect(w.cmdRuns).toEqual(['/my-plugin:skill mach das'])
  // Nichts als Text gesendet, kein Hinweis
  expect(w.sent).toEqual([])
  expect(w.queue().items[0]).toMatchObject({ text: '/my-plugin:skill mach das', status: 'running' })
  await w.cmdTurn($, 'my-plugin:skill', 'mach das')
  // Erst nach der Wartezeit: der Turn läuft, nichts wird ohne Turn abgehakt
  await tick(w.clock, 6000)
  expect(w.history()).toEqual([])
  await w.end($, 'KIWI')
  expect(w.haikuCalls[0]).toContain('Task: Run the slash command /my-plugin:skill mach das')
  expect(w.history()[0]).toMatchObject({ text: '/my-plugin:skill mach das', how: 'auto', result: 'KIWI' })
  await tick(w.clock, 3000)
  expect(w.sent).toEqual(['Danach'])
})

test('Befehl als To-do: lokaler Befehl ohne Turn gilt mit der Rückkehr als erledigt; Großschreibung egal', DE, async ($, on) => {
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`engine:${String((e.props as { text?: string }).text ?? '')}`] }))
  const w = world(on, { cmdText: 'Kosten bisher: 1,20 $. Mehr unter /usage.' })
  await w.start($)
  await cmd($, '/Cost')
  await cmd($, 'Danach')
  await tick(w.clock, 3000)
  expect(w.cmdRuns).toEqual(['/cost'])
  await tick(w.clock, 1400)
  expect(w.history()).toEqual([])
  await tick(w.clock, 200)
  expect(w.history()[0]).toMatchObject({ text: '/Cost', how: 'auto', result: 'Kosten bisher: 1,20 $.' })
  expect(w.haikuCalls).toEqual([])
  expect((await cmd($, 'status')).text).toContain('Befehl ausgeführt (ohne Turn)')
  await tick(w.clock, 3000)
  expect(w.sent).toEqual(['Danach'])
})

test('Befehl als To-do: sein prompt.submit kam, der Turn kommt spät → länger warten statt abhaken', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, '/review')
  await tick(w.clock, 3000)
  await $.prompt.submit({ text: '/review', wait: false, origin: { kind: 'plugin', name: 'worklist' } } as never)
  await tick(w.clock, 1600)
  expect(w.queue().items[0]).toMatchObject({ status: 'running' })
  expect(w.history()).toEqual([])
  await $.turn.start({ turnId: 'late', text: '<command-message>review</command-message>\n<command-name>/review</command-name>' })
  await flush()
  await tick(w.clock, 5000)
  expect(w.history()).toEqual([])
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: DONE, background_tasks: [], session_crons: [] } as never)
  await $.turn.complete({ turnId: 'late', answer: DONE, durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await tick(w.clock, 10)
  expect(w.history()[0]).toMatchObject({ text: '/review', how: 'auto' })
})

test('Befehl als To-do, Fehlerpfade: unbekannt, eigener Befehl → Hinweis und Halt, nichts gesendet', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await cmd($, '/gibtsnicht jetzt')
  await tick(w.clock, 3000)
  // Nicht in der Liste: $.command.run entscheidet und lehnt ab
  expect(w.cmdRuns).toEqual(['/gibtsnicht jetzt'])
  expect(w.sent).toEqual([])
  expect(w.stops().at(-1)).toBe('To-do-Liste angehalten: Unbekannter Befehl /gibtsnicht: Das To-do wurde nicht gesendet.')
  expect(w.queue().items[0]).toMatchObject({ text: '/gibtsnicht jetzt', status: 'open' })
  const pane = await $.ui.mount(PANE('desktop'))
  expect(JSON.stringify(await pane.drawn())).toContain('Unbekannter Befehl /gibtsnicht')
  await pane.unmount()
  // Abhaken per Knopf geht weiter
  await press($, 'mark-done')
  expect(w.history()[0]).toMatchObject({ text: '/gibtsnicht jetzt', how: 'manual' })
  await cmd($, '/todos pause')
  await tick(w.clock, 3000)
  expect(w.stops().at(-1)).toContain('/todos ist ein Befehl von worklist selbst')
  expect(w.cmdRuns).toEqual(['/gibtsnicht jetzt'])
})

test('Befehl als To-do: nicht in $.command.list, aber ausführbar (wie /cost) → läuft; Liste nicht lesbar → läuft trotzdem', DE, async ($, on) => {
  const w = world(on, { commands: ['review'], unlisted: ['cost'], cmdText: 'Kosten: 0 $.' })
  await w.start($)
  await cmd($, '/cost')
  await tick(w.clock, 3000)
  expect(w.cmdRuns).toEqual(['/cost'])
  await tick(w.clock, 1600)
  expect(w.history()[0]).toMatchObject({ text: '/cost', how: 'auto' })
  expect(w.stops()).toEqual([])
})

test('Befehl als To-do: Befehlsliste nicht lesbar → $.command.run entscheidet', DE, async ($, on) => {
  const w = world(on, { cmdListFails: true })
  await w.start($)
  await cmd($, '/review')
  await tick(w.clock, 3000)
  expect(w.cmdRuns).toEqual(['/review'])
  expect(w.stops()).toEqual([])
  expect(w.queue().items[0]).toMatchObject({ status: 'running' })
})

test('Befehl als To-do, Fehlerpfade: $.command.run wirft → To-do wieder offen, Hinweis', DE, async ($, on) => {
  const w = world(on, { cmdRunFails: true })
  await w.start($)
  await cmd($, '/review')
  await tick(w.clock, 3000)
  expect(w.cmdRuns).toEqual(['/review'])
  // In der Liste, aber das Ausführen scheitert: der Fehler selbst, nicht „unbekannt“
  expect(w.stops().at(-1)).toStartWith('To-do-Liste angehalten: Der Befehl lief nicht:')
  expect(w.queue().items[0]).toMatchObject({ text: '/review', status: 'open' })
  await tick(w.clock, 5000)
  expect(w.history()).toEqual([])
})

test('Befehls-To-do im Chat: der ausgelöste Skill-Prompt bekommt den orangen Rahmen', DE, async ($, on) => {
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`engine:${String((e.props as { text?: string }).text ?? '')}`] }))
  const w = world(on)
  await w.start($)
  await cmd($, '/review PR 12')
  await tick(w.clock, 3000)
  const ui = await $.ui.mount({
    plugin: 'worklist',
    component: 'UserMessage',
    requestId: 'c1',
    surface: 'desktop',
    props: { text: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>PR 12</command-args>', origin: { kind: 'plugin', name: 'worklist' }, isExpanded: true },
  } as never)
  expect(JSON.stringify(await ui.find({ key: 'worklist-line' }))).toContain('To-do 1/1 gesendet')
  expect(JSON.stringify(await ui.find({ key: 'worklist-sent' }))).toContain('/review PR 12')
  await ui.unmount()
})

// ---------- /todo ----------

test('/todo reiht alles ein, auch Wörter wie „pause“; /todo ohne Text öffnet die Seitenleiste; /todos kennt kein Einreihen', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.command.run({ command: 'todos', args: 'pause' })
  // Bestätigung nur als Toast: Befehlstext liest Claude (docs/raw/en/api.md:43)
  expect(await $.command.run({ command: 'todo', args: 'pause' })).toEqual({})
  expect(w.toasts.at(-1)).toBe('Eingereiht (1 offen): pause')
  expect(await $.command.run({ command: 'todo', args: 'status' })).toEqual({})
  expect(w.toasts.at(-1)).toBe('Eingereiht (2 offen): status')
  expect(await $.command.run({ command: 'todo', args: '' })).toEqual({})
  expect(w.opened.at(-1)).toMatchObject({ id: 'worklist', focus: true })
  expect((await $.command.run({ command: 'todos', args: 'mach was' })).text).toContain('Einreihen geht mit /todo <Aufgabe>')
  expect(w.queue().items.map((t) => t.text)).toEqual(['pause', 'status'])
})

test('/todos mit allen Argumenten', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  expect(await cmd($, '')).toEqual({})
  expect(w.opened.at(-1)).toMatchObject({ id: 'worklist', focus: true })
  // Danach versucht worklist $.ui.focus; im Test ohne gezeichnete Seitenleiste scheitert das still (types: UiFocusArgs)
  await tick(w.clock, 60)
  expect(await cmd($, 'pause')).toMatchObject({ text: expect.stringContaining('pausiert') })
  expect(await cmd($, 'Erstes To-do')).toEqual({})
  expect(await cmd($, 'Zweites')).toEqual({})
  expect(w.toasts.slice(-2)).toEqual(['Eingereiht (1 offen): Erstes To-do', 'Eingereiht (2 offen): Zweites'])
  expect((await cmd($, 'status')).text).toContain('2 offen, pausiert')
  expect(await cmd($, 'done')).toMatchObject({ text: 'Kein laufendes To-do.' })
  expect(await cmd($, 'skip')).toMatchObject({ text: 'Kein laufendes To-do.' })
  expect(await cmd($, 'resume')).toMatchObject({ text: 'Liste läuft weiter.' })
  await tick(w.clock, 300)
  expect(w.sent).toHaveLength(1)
  await w.todoTurn($)
  expect(await cmd($, 'skip')).toMatchObject({ text: 'Zurück in die Liste: Erstes To-do' })
  expect(w.queue().items.map((t) => t.text)).toEqual(['Zweites', 'Erstes To-do'])
  await w.end($, 'abgebrochen', { reason: 'aborted' })
  expect((await cmd($, 'history')).text).toContain('Verlauf')
  expect(await cmd($, 'clear')).toMatchObject({ text: expect.stringContaining('gelöscht') })
  expect(w.queue().items.filter((t) => t.status === 'open')).toEqual([])
  expect(await cmd($, 'close')).toEqual({})
  expect((await cmd($, 'help')).text).toContain('Nutzung')
  // Ausgaben ohne eigenes „worklist:“ davor (der Desktop setzt es selbst)
  expect((await cmd($, 'status')).text).not.toStartWith('worklist')
})
