// Tests zum Ausbau 0.19.0 (SPEC „Tests (geplant)“ ohne den Effort-Tipp, den Fynn nach Probe P2 abgewählt hat): Korrektur-Schleife,
// Zusammenfassungs-Zähler und B2 (Kalt-Cache-Frage nach einer Compaction). Eigene, kleine Welt mit Stubs.
import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { MIN, dayKey } from '../hooks/cache.ts'
import { cliStubs, settingsNow } from './cli.ts'
import {
  DEFAULT_LOOP,
  DEFAULT_SETTINGS,
  LOOP_FORMS,
  addDay,
  applyLoop,
  cleanLedger,
  cleanSettings,
  emptyDay,
  handoffSystem,
  isKorrektur,
  loopChoices,
  parseVerdict,
  savingsReport,
} from '../hooks/logic.ts'
import type { Ledger } from '../hooks/logic.ts'
import { setLang } from '../hooks/i18n.ts'
import { savingsTree } from '../hooks/view.ts'
import { sidekickHelp } from '../hooks/helpdata.ts'

const NOW = new Date(2026, 10, 6, 10, 0, 0).getTime()
const DAY = 24 * 60 * MIN
const DE = { options: { language: 'de' } }
/** Deutscher Test; `cfg`: weitere userConfig-Felder (seit 0.23.0 die einzige Quelle der Einstellungen). */
function deTest(name: string, a: Record<string, string | number | boolean> | (($: Engine, on: On) => unknown), b?: ($: Engine, on: On) => unknown) {
  const cfg = typeof a === 'function' ? {} : a
  const body = typeof a === 'function' ? a : b!
  test(name, { options: { ...DE.options, ...cfg } }, async ($, on) => {
    setLang('de')
    return body($, on)
  })
}
const USAGE = { input_tokens: 3000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const verdict = (o: Record<string, string> = {}) => JSON.stringify({ urteil: 'durch', art: 'sonstiges', zeile: '', fassung: '', skill: '', kurzfassung: 'Kurz.', ...o })
const HANDOFF = '# Übergabe: Test\n\n> **Stand:** drei Versuche\n> **Weiter mit:** neu ansetzen\n\n## Was nicht funktioniert hat\n- Versuch 1 bis 3 am Balken.'
// Eine Compaction lässt mindestens eine Nachricht stehen (das Test-Kit lehnt eine leere Liste ab)
const SUMMARY = [{ role: 'user', text: 'Zusammenfassung des bisherigen Chats', toolUses: [] }]
const K1 = 'Das flackert immer noch, der Balken springt'
const K2 = 'Geht immer noch nicht, gleiche Stelle'
const K3 = 'Funktioniert nicht, der Balken ist wieder weg'

// ---------- reine Logik ----------

deTest('Korrektur-Regeln de/en: Treffer und Nicht-Treffer (P3)', () => {
  for (const s of [
    'Geht immer noch nicht.',
    'Das funktioniert nicht so. Genau.',
    'Tatsächlich ist das immer noch zu hell.',
    'Es ist jetzt einmal nochmal aufgetreten, dass er nichts anzeigt.',
    'Wieder derselbe Fehler beim Start',
    'Das ist falsch, die Zahl stimmt nicht',
    'Das haben wir die ganze Zeit, es flackert',
    'leider falsch kommuniziert gewesen, es soll anders sein',
    'Hat nichts gebracht, der Test ist rot',
    'still broken after your change',
    'same error as before',
    "it doesn't work",
    "that didn't fix it",
  ])
    expect(isKorrektur(s), s).toBe(true)
  for (const s of [
    'noch nicht fertig?',
    'Ja, ich verstehe es immer noch nicht so ganz genau. Was heißt abgemeldet?',
    'Könnte man immer noch ein Stück nach oben packen',
    'Super, das klappt. Jetzt bitte das Menü umbauen.',
    'Kannst du den Fortschritt-Löschen-Button entfernen?',
    '/sidekick loop',
    'I still don\'t understand the second point',
    '',
  ])
    expect(isKorrektur(s), s).toBe(false)
  // Nur der Anfang zählt: In langen Diktaten steht „immer noch“ oft nebenbei
  expect(isKorrektur(`${'Neue Wünsche für das Menü. '.repeat(20)}Die Krone gefällt mir immer noch nicht.`)).toBe(false)
  // Eingefügter Text: die Marken zählen nicht mit
  expect(isKorrektur('<pasted_content id="1">\nDas Fliegen ist immer noch viel zu schwer.\n</pasted_content>')).toBe(true)
})

deTest('Antworten der Frage: groß oder kalt → neuer Chat zuerst, sonst Denkanstoß; mit Anhang ohne neuen Chat', () => {
  expect(loopChoices({ big: true, resendable: true })).toEqual(['new', 'nudge', 'send'])
  expect(loopChoices({ big: false, resendable: true })).toEqual(['nudge', 'new', 'send'])
  expect(loopChoices({ big: true, resendable: false })).toEqual(['nudge', 'send'])
})

deTest('Einstellungen: loop aus altem Store mit Standard an; /sidekick loop … alle Formen', () => {
  expect(cleanSettings({ level: 'guide' }).loop).toEqual(DEFAULT_LOOP)
  expect(DEFAULT_SETTINGS.loop.on).toBe(true)
  expect(cleanSettings({ loop: { on: false, declined: 2, restUntil: 5 } }).loop).toEqual({ on: false, declined: 2, restUntil: 5 })
  expect(cleanSettings({ loop: { on: 'ja', declined: -1 } }).loop).toEqual(DEFAULT_LOOP)
  expect(applyLoop(DEFAULT_LOOP, 'off', NOW)).toEqual({ loop: { ...DEFAULT_LOOP, on: false }, form: 'off', changed: true })
  expect(applyLoop(DEFAULT_LOOP, 'on', NOW)?.changed).toBe(false)
  // `on` beendet eine Ruhe und gilt dann als Änderung
  expect(applyLoop({ on: true, declined: 2, restUntil: NOW + 1 }, ' ON ', NOW)).toEqual({ loop: DEFAULT_LOOP, form: 'on', changed: true })
  expect(applyLoop(DEFAULT_LOOP, 'status', NOW)?.changed).toBe(false)
  expect(applyLoop(DEFAULT_LOOP, 'vielleicht', NOW)).toBe(null)
  expect(LOOP_FORMS.length).toBe(4)
})

deTest('Übergabe aus der Schleife: Abschnitt „Was nicht funktioniert hat“ vor „Offen“, ohne neue Vermutungen (de, en)', () => {
  const plain = handoffSystem()
  const failed = handoffSystem(true)
  expect(plain).not.toContain('Was nicht funktioniert hat')
  expect(failed).toContain('## Was nicht funktioniert hat')
  expect(failed.indexOf('## Was nicht funktioniert hat')).toBeLessThan(failed.indexOf('## Offen'))
  expect(failed).toContain('keine neuen Vermutungen')
  setLang('en')
  const en = handoffSystem(true)
  expect(en).toContain("## What didn't work")
  expect(en.indexOf("## What didn't work")).toBeLessThan(en.indexOf('## Open'))
  setLang('de')
})

deTest('Die Prüfung vergibt die neuen Arten nicht; alte Tage ohne die neuen Felder', () => {
  // `schleife`/`verdichtet` setzt nur sidekick; von der Prüfung gelten sie als „sonstiges“
  expect(parseVerdict(verdict({ urteil: 'hinweis', art: 'schleife', zeile: 'Dritte Korrektur in Folge erkannt' }), 'b', [], 'geht immer noch nicht hier')?.art).toBe('sonstiges')
  const old = cleanLedger({ tage: { [dayKey(NOW)]: { kosten: 1 } }, upd: NOW }).tage[dayKey(NOW)]!
  expect(old.schleife).toEqual({ denkanstoss: 0, wieder: 0 })
  const d = emptyDay()
  d.schleife = { denkanstoss: 2, wieder: 1 }
  expect(addDay(d, old).schleife).toEqual({ denkanstoss: 2, wieder: 1 })
})

deTest('/savings detail: Schleife und Zusammenfassung in den Hinweisen, Denkanstöße mit Gegenprobe; ohne Denkanstoß keine Zeile', () => {
  const d = emptyDay()
  d.kosten = 0.01
  d.hinweise.schleife = { gezeigt: 3, angenommen: 2, ignoriert: 1, abgebrochen: 0 }
  d.hinweise.verdichtet = { gezeigt: 2, angenommen: 1, ignoriert: 1, abgebrochen: 0 }
  d.schleife = { denkanstoss: 1, wieder: 1 }
  const md = savingsReport(d, 'all', NOW, '', { [dayKey(NOW)]: d })
  expect(md).toContain('| Korrektur-Schleife | 3 | 2 | 1 | 0 |')
  expect(md).toContain('| Zusammengefasst | 2 | 1 | 1 | 0 |')
  expect(md).toContain('Denkanstöße: **1** · danach wieder eine Korrektur: **1**')
  expect(savingsReport(emptyDay(), 'all', NOW, '', {})).not.toContain('Denkanstöße')
  const tree = JSON.stringify(savingsTree(d, 'all', NOW, 100, 'terminal', { [dayKey(NOW)]: d }))
  expect(tree).toContain('Korrektur-Schleife')
  expect(tree).toContain('Denkanstöße: 1')
})

deTest('Hilfe: /sidekick loop als Befehl und Funktion mit Zustand', () => {
  const h = sidekickHelp({ settings: { ...DEFAULT_SETTINGS }, ttl: { min: 60, source: 'default' }, hints: { on: true, off: [] }, known: 0, now: NOW })
  expect(h.commands.some((c) => c.cmd === '/sidekick loop on|off')).toBe(true)
  expect(h.commands.some((c) => c.cmd === '/sidekick loop [status]')).toBe(true)
  const f = h.features.find((x) => x.name === 'Korrektur-Schleife')
  expect(f?.state.kind).toBe('on')
  expect(f?.toggle).toBe('/sidekick loop off')
  const rest = sidekickHelp({ settings: { ...DEFAULT_SETTINGS, loop: { on: true, declined: 0, restUntil: NOW + DAY } }, ttl: { min: 60, source: 'default' }, hints: { on: true, off: [] }, known: 0, now: NOW })
  expect(rest.features.find((x) => x.name === 'Korrektur-Schleife')?.state.text).toContain('ruht bis')
})

// ---------- Hooks ----------

type StepU = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string }
const stepUsage = (read: number, written: number): StepU => ({ input_tokens: 2, output_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: written, model: 'claude-opus-5-5' })

// Schalter kommen seit 0.23.0 als userConfig (Test-Optionen); Befehle schreiben über den CLI-Stub (tests/cli.ts)
function world(on: On, o: { compactAfter?: number; handoffFails?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = new Map<string, unknown>()
  const cli = cliStubs(on)
  const asks: { question: string; options: string[] }[] = []
  const sent: { text: string; context?: readonly string[] }[] = []
  const toasts: string[] = []
  const checks: string[] = []
  const handoffSystems: string[] = []
  const commands: string[] = []
  let answer: string | null = 'Unverändert senden'
  let reply: unknown = { isAnswered: true, text: verdict(), usage: USAGE }
  let id = 'sess-1'
  let ctx: number | undefined = 20000
  let compactSkip = false
  on('session.id', () => ({ value: id }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: ctx, window: 1000000 }, rateLimits: [] } as never }))
  on('session.root', () => ({ value: 'C:\\Proj' }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'vorher', toolUses: [] }] as never }))
  on('command.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.complete', async ($, e) => {
    if (e.system?.includes('Schreibe eine Übergabe')) {
      handoffSystems.push(e.system)
      if (o.handoffFails) return { value: { isAnswered: false, text: '', reason: 'timeout', usage: USAGE } as never }
      return { value: { isAnswered: true, text: HANDOFF, usage: USAGE } as never }
    }
    checks.push(e.system ?? '')
    return { value: reply as never }
  })
  on('command.run', ($, e) => {
    commands.push(e.command)
    if (e.command === 'clear') id = 'sess-2'
    return { text: '' }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') return { result: { stdout: '', stderr: '', interrupted: false, isImage: false, gitOperation: { commit: { sha: 'abc1234', kind: 'committed', branch: 'main' } } } }
    if (e.tool !== 'AskUserQuestion') return { result: '' }
    const q = (e as unknown as { questions: { question: string; options: { label: string }[] }[] }).questions[0]!
    asks.push({ question: q.question, options: q.options.map((x) => x.label) })
    if (answer === null) return { deny: 'Dialog geschlossen' }
    return { result: { answers: { [q.question]: answer } } }
  })
  on('prompt.submit', ($, e) => {
    sent.push({ text: e.text, ...(e.context ? { context: e.context } : {}) })
    return { text: e.text }
  })
  on('session.compact', () => (compactSkip ? { skip: 'nein' } : { messages: SUMMARY, tokensBefore: 300000, tokensAfter: o.compactAfter ?? 25000 }))
  let next: StepU = stepUsage(0, 0)
  let turn = 0
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: next }
  })
  async function step($: Engine, u: StepU) {
    next = u
    turn += 1
    const s = $.turn.step({ turnId: `t${turn}`, index: 0, model: u.model, messageCount: 3 })
    let r = await s.next()
    while (r.done !== true) r = await s.next()
    await flush()
  }
  return {
    clock,
    saved,
    asks,
    sent,
    toasts,
    checks,
    handoffSystems,
    commands,
    step,
    setAnswer: (a: string | null) => (answer = a),
    setReply: (r: unknown) => (reply = r),
    setCtx: (n: number | undefined) => (ctx = n),
    setCompactSkip: (b: boolean) => (compactSkip = b),
    ledger: (sid = 'sess-1') => cleanLedger(saved.get(`bilanz:${sid}`)),
    cli,
    settings: () => settingsNow(cli, saved),
  }
}

async function flush(rounds = 300) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
const userPrompt = (text: string, extra: Record<string, unknown> = {}) => ({ text, wait: false, origin: { kind: 'composer' as const }, ...extra })
const today = (l: Ledger) => l.tage[dayKey(NOW)] ?? emptyDay()
/** Erste Nachricht, dann drei Korrekturen; gibt das Ergebnis der dritten zurück. */
async function threeCorrections($: Engine, extra: Record<string, unknown> = {}) {
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  return $.prompt.submit(userPrompt(K3, extra))
}

deTest('Schleife: Frage erst bei der dritten Korrektur in Folge; kleiner Chat → Denkanstoß empfohlen, /rewind im Text', async ($, on) => {
  const w = world(on)
  const r = await threeCorrections($)
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain('Das ist der dritte Korrekturversuch in Folge.')
  expect(w.asks[0]!.question).toContain('/rewind')
  // Kleiner Chat: ohne Kostenzeile
  expect(w.asks[0]!.question).not.toContain('Neuer Chat mit Übergabe:')
  expect(w.asks[0]!.options).toEqual(['Mit Denkanstoß senden (empfohlen)', 'Neuer Chat mit Übergabe', 'Unverändert senden'])
  // „Unverändert senden“: wie getippt, ohne Denkanstoß
  expect(r).toMatchObject({ text: K3 })
  expect(w.sent.at(-1)!.context ?? []).toEqual([])
  await flush()
  expect(today(w.ledger()).hinweise.schleife).toEqual({ gezeigt: 1, angenommen: 0, ignoriert: 1, abgebrochen: 0 })
  // Höchstens einmal je Serie: die vierte Korrektur fragt nicht mehr
  await $.prompt.submit(userPrompt('Immer noch kaputt, es geht immer noch nicht'))
  expect(w.asks.length).toBe(1)
})

deTest('Schleife: Denkanstoß geht als context an Claude (de), der Nutzer sieht ihn nicht; Gegenprobe zählt die nächste Korrektur', async ($, on) => {
  const w = world(on)
  w.setAnswer('Mit Denkanstoß senden (empfohlen)')
  const r = await threeCorrections($)
  expect(r).toMatchObject({ text: K3 })
  const ctx = w.sent.at(-1)!.context ?? []
  expect(ctx.length).toBe(1)
  expect(ctx[0]).toContain('sidekick: Der Nutzer meldet den dritten gescheiterten Versuch in Folge.')
  expect(ctx[0]!.length).toBeLessThan(400)
  await $.prompt.submit(userPrompt('Geht leider immer noch nicht'))
  await flush()
  const d = today(w.ledger())
  expect(d.schleife).toEqual({ denkanstoss: 1, wieder: 1 })
  expect(d.hinweise.schleife?.angenommen).toBe(1)
})

test('Schleife: Denkanstoß englisch mit language en', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  const w = world(on)
  w.setAnswer('Send with a nudge (recommended)')
  await threeCorrections($)
  expect(w.asks[0]!.question).toContain('This is the third correction in a row.')
  expect(w.sent.at(-1)!.context?.[0]).toBe(
    'sidekick: The user reports the third failed attempt in a row. Before editing again, step back: restate the goal, list what was tried and why it failed, check the root cause, then choose an approach.',
  )
})

deTest('Schleife: großer Chat → neuer Chat empfohlen, mit Kosten; Übergabe mit „Was nicht funktioniert hat“, Buchung mit Grund', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setAnswer('Neuer Chat mit Übergabe (empfohlen)')
  const r = await threeCorrections($)
  expect(w.asks[0]!.options).toEqual(['Neuer Chat mit Übergabe (empfohlen)', 'Mit Denkanstoß senden', 'Unverändert senden'])
  expect(w.asks[0]!.question).toContain('Neuer Chat mit Übergabe: ≈')
  expect(r.drop).toContain('neuer Chat')
  await w.clock.advance(400)
  await flush()
  expect(w.handoffSystems.length).toBe(1)
  expect(w.handoffSystems[0]).toContain('## Was nicht funktioniert hat')
  expect(w.commands).toEqual(['clear'])
  expect(w.sent.at(-1)!.text).toContain('# Übergabe: Test')
  expect(w.sent.at(-1)!.text).toContain(K3)
  expect(w.ledger('sess-2').offen).toMatchObject({ kind: 'warm', oldCtx: 90000, grund: 'schleife' })
})

deTest('Schleife: Übergabe scheitert → zweite Frage, ohne Zustimmung nichts gesendet und kein /clear (Review 0.19.0 K5)', async ($, on) => {
  const w = world(on, { handoffFails: true })
  w.setCtx(90000)
  w.setAnswer('Neuer Chat mit Übergabe (empfohlen)')
  const r = await threeCorrections($)
  expect(r.drop).toContain('neuer Chat')
  w.setAnswer('Abbrechen')
  const before = w.sent.length
  await w.clock.advance(400)
  await flush()
  expect(w.handoffSystems[0]).toContain('## Was nicht funktioniert hat')
  expect(w.asks.length).toBe(2)
  expect(w.commands).not.toContain('clear')
  expect(w.sent.length).toBe(before)
  expect(w.toasts.some((x) => x.includes(K3))).toBe(true)
})

deTest('Zähler: mit Anhang oder @datei wartet die Marke auf die nächste Nachricht ohne (Review 0.19.0 K5)', async ($, on) => {
  const w = world(on)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.prompt.submit(userPrompt('Schau dir bitte @hooks/view.ts genau an'))
  await $.prompt.submit(userPrompt('Und hier der Screenshot vom Balken', { attachments: [{ kind: 'image' }] }))
  expect(w.asks.length).toBe(0)
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt('Weiter mit der Liste unten bitte'))
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain('2× zusammengefasst')
})

deTest('Schleife: mit Anhang oder @datei kein neuer Chat in der Frage', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  await threeCorrections($, { attachments: [{ kind: 'image' }] })
  expect(w.asks[0]!.options).toEqual(['Mit Denkanstoß senden (empfohlen)', 'Unverändert senden'])
})

deTest('Schleife: Serie endet bei einer Nicht-Korrektur, einem Commit, /rewind und einer Compaction', async ($, on) => {
  const w = world(on)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  await $.prompt.submit(userPrompt('Danke, jetzt bitte das Menü'))
  await $.prompt.submit(userPrompt(K3))
  expect(w.asks.length).toBe(0)
  // Commit mitten in der Serie
  await $.prompt.submit(userPrompt(K1))
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
  await $.prompt.submit(userPrompt(K2))
  expect(w.asks.length).toBe(0)
  // /rewind
  await $.prompt.submit(userPrompt('/rewind'))
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  expect(w.asks.length).toBe(0)
  // Compaction
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.prompt.submit(userPrompt(K3))
  expect(w.asks.length).toBe(0)
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  expect(w.asks.length).toBe(1)
})

deTest('Schleife: /clear beginnt neu (neue Session)', async ($, on) => {
  const w = world(on)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  await $.command.run({ command: 'clear' } as never)
  await $.prompt.submit(userPrompt('Wieder da: bitte den Balken'))
  await $.prompt.submit(userPrompt(K3))
  expect(w.asks.length).toBe(0)
})

deTest('Schleife: geschlossener Dialog → unverändert senden, als abgebrochen gezählt', async ($, on) => {
  const w = world(on)
  w.setAnswer(null)
  const r = await threeCorrections($)
  expect(r).toMatchObject({ text: K3 })
  await flush()
  expect(today(w.ledger()).hinweise.schleife?.abgebrochen).toBe(1)
})

deTest('Schleife: dreimal „Unverändert senden“ → 7 Tage Ruhe mit Toast; /sidekick loop on beendet sie', async ($, on) => {
  const w = world(on)
  for (let i = 0; i < 3; i++) {
    await threeCorrections($)
    await $.prompt.submit(userPrompt('Danke, das passt jetzt'))
  }
  expect(w.asks.length).toBe(3)
  expect(w.toasts).toContain('Korrektur-Frage ruht 7 Tage · /sidekick loop on')
  expect(w.settings().loop.restUntil).toBe(NOW + 7 * DAY)
  await threeCorrections($)
  expect(w.asks.length).toBe(3)
  const t = await $.command.run({ command: 'sidekick', args: 'loop on' } as never)
  expect(t.text).toContain('✓ Die Korrektur-Frage ist jetzt an.')
  expect(w.settings().loop).toEqual(DEFAULT_LOOP)
})

deTest('Schleife: frei getippter Text sendet unverändert, ohne Ruhe zu zählen', async ($, on) => {
  const w = world(on)
  w.setAnswer('mach einfach weiter')
  await threeCorrections($)
  expect(w.settings().loop.declined).toBe(0)
})

deTest('Schleife: aus, Stufe Cache oder Off → keine Frage', { retryLoop: false }, async ($, on) => {
  const w = world(on)
  await threeCorrections($)
  expect(w.asks.length).toBe(0)
  await $.command.run({ command: 'sidekick', args: 'loop on' } as never)
  await $.command.run({ command: 'sidekick', args: 'cache' } as never)
  await $.command.run({ command: 'clear' } as never)
  await threeCorrections($)
  expect(w.asks.length).toBe(0)
})

deTest('Vorrang: falscher Chat vor der Schleife; die Kalt-Cache-Frage bekommt den Satz zur Schleife, kein zweiter Dialog', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'falscher_chat', zeile: 'Dieser Chat: Spiel. Deine Nachricht: Steuer.' }), usage: USAGE })
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt(K3))
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain('Dieser Chat: Spiel.')
  expect(w.asks[0]!.question).not.toContain('dritte Korrekturversuch')
})

deTest('Vorrang: Kalt-Cache-Frage mit Satz zur Schleife; „Neuer Chat“ schreibt die Übergabe mit „Was nicht funktioniert hat“', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await w.step($, stepUsage(0, 300000))
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  await w.clock.advance(70 * MIN)
  w.setAnswer('Neuer Chat mit Übergabe (empfohlen)')
  await $.prompt.submit(userPrompt(K3))
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain('Cache seit')
  expect(w.asks[0]!.question).toContain('Außerdem ist das der dritte Korrekturversuch in Folge')
  expect(w.asks[0]!.question.endsWith('Wie weiter?')).toBe(true)
  await w.clock.advance(400)
  await flush()
  expect(w.handoffSystems[0]).toContain('## Was nicht funktioniert hat')
})

deTest('Zähler: precompute, plugin, Subagent und skip zählen nicht; Frage bei der 2. und 4. Compaction, nicht bei der 3.', async ($, on) => {
  const w = world(on, { compactAfter: 30000 })
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await $.session.compact({ trigger: 'precompute', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'plugin', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'manual', agentId: 'ag1', messages: SUMMARY } as never)
  w.setCompactSkip(true)
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  w.setCompactSkip(false)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.prompt.submit(userPrompt('Weiter mit der Liste unten bitte'))
  expect(w.asks.length).toBe(0)
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  // Unter 4 Wörtern: Marke wartet
  await $.prompt.submit(userPrompt('ok weiter'))
  expect(w.asks.length).toBe(0)
  w.setAnswer('Trotzdem senden')
  const r = await $.prompt.submit(userPrompt('Weiter mit der Liste unten bitte'))
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toBe('Dieser Chat wurde schon 2× zusammengefasst; dabei gehen jedes Mal Details verloren. Wie weiter?')
  expect(w.asks[0]!.options[0]).toBe('Neuer Chat mit Übergabe (empfohlen)')
  expect(r).toMatchObject({ text: 'Weiter mit der Liste unten bitte' })
  // Senden löscht die Marke
  await $.prompt.submit(userPrompt('Und noch die zweite Liste bitte'))
  expect(w.asks.length).toBe(1)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.prompt.submit(userPrompt('Und noch die dritte Liste bitte'))
  expect(w.asks.length).toBe(1)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.prompt.submit(userPrompt('Und noch die vierte Liste bitte'))
  expect(w.asks.length).toBe(2)
  expect(w.asks[1]!.question).toContain('4× zusammengefasst')
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.prompt.submit(userPrompt('Und noch die fünfte Liste bitte'))
  expect(w.asks.length).toBe(2)
  await flush()
  expect(today(w.ledger()).hinweise.verdichtet).toEqual({ gezeigt: 2, angenommen: 0, ignoriert: 2, abgebrochen: 0 })
})

deTest('Zähler: neuer Chat bucht mit dem aktuellen, kleinen Kontext und Grund verdichtet; /clear setzt zurück', async ($, on) => {
  const w = world(on, { compactAfter: 30000 })
  w.setCtx(undefined)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await w.step($, stepUsage(0, 300000))
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  w.setAnswer('Neuer Chat mit Übergabe (empfohlen)')
  const r = await $.prompt.submit(userPrompt('Weiter mit der Liste unten bitte'))
  expect(r.drop).toContain('neuer Chat')
  await w.clock.advance(400)
  await flush()
  // Die Übergabe nach einer Zusammenfassung bekommt keinen Schleifen-Abschnitt
  expect(w.handoffSystems[0]).not.toContain('Was nicht funktioniert hat')
  expect(w.ledger('sess-2').offen).toMatchObject({ kind: 'warm', oldCtx: 30000, grund: 'verdichtet' })
  // Neue Session: Zähler bei 0, eine Compaction fragt nicht
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.prompt.submit(userPrompt('Und jetzt die nächste Liste bitte'))
  expect(w.asks.length).toBe(1)
})

/** Ausbau 0.20.0: jede von sidekick geschriebene `sidekick.buddy`-Änderung. */
function buddyLog(on: On): unknown[] {
  const vals: unknown[] = []
  on('state.set', ($: unknown, e: any) => {
    if (e.plugin === 'sidekick' && e.key === 'buddy') vals.push(e.value)
    return { value: { isSet: true, version: vals.length } }
  })
  return vals
}
const stopsOf = (vals: unknown[]) => vals.filter((v) => (v as { kind?: string } | null)?.kind === 'stop')

deTest('0.20.0: Korrektur-Schleife und Frage „verdichtet“ melden stop ohne Grund', async ($, on) => {
  const w = world(on)
  const vals = buddyLog(on)
  await threeCorrections($)
  expect(w.asks.length).toBe(1)
  expect(stopsOf(vals)).toEqual([{ kind: 'stop', at: NOW }])
  // Zusammenfassungs-Frage nach der 2. Compaction
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt('Weiter mit der Liste unten bitte'))
  expect(w.asks.length).toBe(2)
  expect(w.asks[1]!.question).toContain('2× zusammengefasst')
  expect(stopsOf(vals)).toEqual([{ kind: 'stop', at: NOW }, { kind: 'stop', at: NOW }])
})

deTest('0.20.0: Kalt-Cache-Frage mit Satz zur Schleife meldet cold (Kälte vor Schleife)', async ($, on) => {
  const w = world(on)
  const vals = buddyLog(on)
  w.setCtx(undefined)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await w.step($, stepUsage(0, 300000))
  await $.prompt.submit(userPrompt(K1))
  await $.prompt.submit(userPrompt(K2))
  await w.clock.advance(70 * MIN)
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt(K3))
  expect(w.asks[0]!.question).toContain('Außerdem ist das der dritte Korrekturversuch in Folge')
  expect(stopsOf(vals).map((v) => (v as { why?: string }).why)).toEqual(['cold'])
})

deTest('Zähler: geschrumpfter Kontext ohne Hook (/rewind) zählt nicht', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await w.step($, stepUsage(0, 300000))
  await w.step($, stepUsage(20000, 0))
  await w.step($, stepUsage(300000, 0))
  await w.step($, stepUsage(20000, 0))
  await $.prompt.submit(userPrompt('Weiter mit der Liste unten bitte'))
  expect(w.asks.length).toBe(0)
})

deTest('B2: nach einer Compaction (auch im Leerlauf, trigger auto) keine Kalt-Cache-Frage mit der alten Größe, kein Kaltstart gebucht', async ($, on) => {
  const w = world(on, { compactAfter: 25000 })
  w.setCtx(undefined)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await w.step($, stepUsage(0, 300000))
  // ~1 h Leerlauf, dann fasst Claude Code zusammen; der Nutzer schreibt später
  await w.clock.advance(58 * MIN)
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  await w.clock.advance(30 * MIN)
  const r = await $.prompt.submit(userPrompt('Weiter mit dem Balken, bitte'))
  expect(w.asks.length).toBe(0)
  expect(r).toMatchObject({ text: 'Weiter mit dem Balken, bitte' })
  // Die erste Anfrage danach schreibt die Zusammenfassung (0,7 der alten Größe wäre über der Schrumpf-Grenze): kein Kaltstart
  await w.step($, stepUsage(10000, 200000))
  expect(today(w.ledger()).kaltOhne.n).toBe(0)
  // Danach gilt wieder die normale Erkennung
  await w.clock.advance(70 * MIN)
  await w.step($, stepUsage(0, 210000))
  expect(today(w.ledger()).kaltOhne.n).toBe(1)
})

deTest('B2: ohne Compaction kommt die Kalt-Cache-Frage weiter', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(88 * MIN)
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt('Weiter mit dem Balken, bitte'))
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain('300k Kontext')
})

deTest('Review 0.19.0 S1: ein abgelehnter Wert für das Label wird beim nächsten Mal erneut geschrieben', async ($, on) => {
  world(on)
  let refuse = true
  const written: string[] = []
  on('state.set', ($: unknown, e: any) => {
    if (e.plugin !== 'sidekick' || e.key !== 'status') return { value: { isSet: true, version: 1 } }
    // `deny` lässt genau diesen Aufruf scheitern (docs/raw/en/test.md:182), wie ein Schreiben aus einem `ui.render` heraus
    if (refuse) return { deny: 'refused while drawing' }
    written.push(e.value.level)
    return { value: { isSet: true, version: 2 } }
  })
  await $.command.run({ command: 'sidekick', args: 'cache' } as never)
  await flush()
  expect(written).toEqual([])
  refuse = false
  // Gleicher Wert wie eben: bis 0.18.1 galt er als geschrieben und blieb aus
  await $.prompt.submit(userPrompt('weiter so'))
  await flush()
  expect(written).toEqual(['cache'])
})

for (const lang of ['de', 'en'] as const) {
  test(`/sidekick loop: Rückmeldung, Stand, Serie, Unbekanntes (${lang})`, { options: { language: lang } }, async ($, on) => {
    setLang(lang)
    const w = world(on)
    const run = async (args: string) => String((await $.command.run({ command: 'sidekick', args } as never)).text)
    await $.prompt.submit(userPrompt('Baue den Balken unten rechts ein'))
    await $.prompt.submit(userPrompt(K1))
    const st = await run('loop')
    expect(st).not.toContain('✓')
    expect(st).toContain(lang === 'de' ? 'Korrekturen in Folge in diesem Chat: 1' : 'Corrections in a row in this chat: 1')
    expect(await run('loop off')).toContain(lang === 'de' ? '✓ Die Korrektur-Frage ist jetzt aus.' : '✓ The correction question is now off.')
    expect(await run('loop off')).toContain(lang === 'de' ? 'Die Korrektur-Frage war schon aus.' : 'The correction question was already off.')
    expect(w.settings().loop.on).toBe(false)
    expect(await run('loop on')).toContain(lang === 'de' ? 'ist jetzt an' : 'is now on')
    expect(await run('loop vielleicht')).toContain('/sidekick loop [status]')
    // /sidekick status nennt die Schleife
    expect(await run('')).toContain(lang === 'de' ? '| **Korrektur-Schleife** |' : '| **Retry loop** |')
  })
}
