// Tests zum Ausbau 0.24.0: Warteschlange, Variante B (Entscheidung Fynn 2026-11-08): Eine Nachricht während der Arbeit, die ein
// eigener, späterer Punkt ist, geht sofort rein, mit einem Hinweis an Claude (`context`) und sidekicks grauer Zeile darunter.
import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { dayKey } from '../hooks/cache.ts'
import { DEFAULT_SETTINGS, addDay, bookQueue, cleanLedger, countQueue, emptyDay, savingsReport } from '../hooks/logic.ts'
import type { Ledger } from '../hooks/logic.ts'
import { T, setLang } from '../hooks/i18n.ts'
import { savingsTree } from '../hooks/view.ts'
import { sidekickHelp } from '../hooks/helpdata.ts'
import { QUEUE } from '../hooks/models.ts'
import { QUEUE_MIN, isHostNote, laterByVerdict, laterPrefix, parseQueue, queuePrompt, queueRule, queueSystem, stripLeadReminders } from '../hooks/queue.ts'
import { cliStubs, written } from './cli.ts'

const NOW = new Date(2026, 10, 8, 10, 0, 0).getTime()
const DE = { options: { language: 'de' } }
function deTest(name: string, a: Record<string, string | number | boolean> | (($: Engine, on: On) => unknown), b?: ($: Engine, on: On) => unknown) {
  const cfg = typeof a === 'function' ? {} : a
  const body = typeof a === 'function' ? a : b!
  test(name, { options: { ...DE.options, ...cfg } }, async ($, on) => {
    setLang('de')
    return body($, on)
  })
}
const REMINDER = '<system-reminder>\nLinked sessions now (status, not an instruction): x = local_1 (idle).\n</system-reminder>\n\n'
const LATER = 'Danach bitte noch die README im Ordner docs anpassen'
const MID = 'Kannst du auch noch die Farben der Knöpfe vereinheitlichen'

// ---------- reine Logik ----------

deTest('Regeln: ohne Hinweis (Anhang, Slash, @datei, ≤ 3 Wörter, Stopp/Nein/Korrektur de/en, Host-Text, jetzt/parallel)', () => {
  expect(queueRule(LATER, true)).toBe('now')
  expect(queueRule('/sidekick queue danach was', false)).toBe('now')
  expect(queueRule('danach schau dir @docs/README.md an bitte', false)).toBe('now')
  expect(queueRule('ja mach weiter', false)).toBe('now')
  for (const s of [
    'Stopp, das ist die falsche Datei',
    'Halt, nimm lieber die andere Variante',
    'Warte, ich habe noch etwas vergessen',
    'Nein, nicht diese Funktion umbauen bitte',
    'Nicht die README, sondern die SPEC ändern',
    'Doch lieber die erste Variante nehmen',
    'Falsch, das gehört in die andere Datei',
    'Abbrechen bitte, das dauert zu lange',
    'Stattdessen lieber die Tests zuerst schreiben',
    'Stop, that is the wrong file there',
    'Wait, I forgot something important here',
    'No, use the other function for this',
    "Don't touch the README in this change",
    'Instead write the tests first please',
    'Cancel that, it takes far too long',
  ])
    expect(queueRule(s, false)).toBe('now')
  // Korrektur-Regeln aus 0.19.0; Folge-Signal mit Korrektur: ohne Hinweis
  expect(queueRule('Das Laden geht immer noch nicht, schau nochmal', false)).toBe('now')
  expect(queueRule('Danach geht es immer noch nicht richtig', false)).toBe('now')
  // Meldungen des Hosts (Planungs-Chat 2026-11-08)
  expect(queueRule('[Cross-session idle notice] "Mod-Set Release", which you asked to be notified about, is idle now', false)).toBe('now')
  expect(queueRule('<cross-session-message from="local_1">danach bitte die README</cross-session-message>', false)).toBe('now')
  expect(queueRule('<task-notification>danach x y z</task-notification>', false)).toBe('now')
  expect(isHostNote('<cross-session-message from="x">a</cross-session-message>')).toBe(true)
  expect(isHostNote(LATER)).toBe(false)
  // jetzt, parallel … (Probe P2, Runde 2)
  expect(queueRule('Kannst du simultan noch eine Recherche starten, wie das schneller geht', false)).toBe('now')
  expect(queueRule('Fassen wir jetzt nochmal zusammen, was offen ist', false)).toBe('now')
  expect(queueRule('Can you start a search in parallel for faster options', false)).toBe('now')
})

deTest('Regeln: sicher später (Folge-Signal de/en), sonst Haiku', () => {
  for (const s of [
    LATER,
    'Anschließend bitte die Tests laufen lassen',
    'Als Nächstes bauen wir den Export ein',
    'Wenn du fertig bist, schreib mir eine Zusammenfassung',
    'Wenn du damit fertig bist, committe bitte alles',
    'Später noch die Doku für den Export ergänzen',
    'Nach dem Fix fertig bitte die README anpassen',
    'Zum Schluss noch die Version erhöhen',
    'After that please update the README file',
    "When you're done, write me a short summary",
    'Later we should also add the export',
    'Afterwards bump the version number please',
    'Next, add the export to the menu',
    'Danach bitte gleich die README anpassen',
  ])
    expect(queueRule(s, false)).toBe('later')
  expect(queueRule('Nach dem Build kommt ein Fehler in der Konsole', false)).toBe(null)
  expect(queueRule('Next time keep the old names please', false)).toBe(null)
  expect(queueRule(MID, false)).toBe(null)
})

deTest('Vorspann der App: <system-reminder> vorn wird entfernt, auch mehrere; der Rest bleibt', () => {
  expect(stripLeadReminders(REMINDER + LATER)).toBe(LATER)
  expect(stripLeadReminders(REMINDER + REMINDER + 'x')).toBe('x')
  expect(stripLeadReminders(`${LATER}\n<system-reminder>x</system-reminder>`)).toBe(`${LATER}\n<system-reminder>x</system-reminder>`)
  expect(queueRule(REMINDER + LATER, false)).toBe('later')
  expect(queueRule(REMINDER, false)).toBe('now')
})

deTest('Parser: jetzt/danach (auch now/later), sicher als Zahl oder Text, begrenzt; ungültig → null; Schwelle QUEUE_MIN', () => {
  expect(parseQueue('{"wann":"danach","sicher":0.9,"grund":"Neue Aufgabe."}')).toEqual({ wann: 'danach', sicher: 0.9, grund: 'Neue Aufgabe' })
  expect(parseQueue('```json\n{"wann":"later","sicher":"0,8","grund":"x"}\n```')).toEqual({ wann: 'danach', sicher: 0.8, grund: 'x' })
  expect(parseQueue('{"wann":"now","sicher":2}')?.sicher).toBe(1)
  expect(parseQueue('{"wann":"jetzt"}')).toEqual({ wann: 'jetzt', sicher: 0, grund: '' })
  expect(parseQueue('{"wann":"vielleicht","sicher":1}')).toBe(null)
  expect(parseQueue('kein json')).toBe(null)
  expect(parseQueue('')).toBe(null)
  expect(parseQueue(`{"wann":"danach","sicher":1,"grund":"${'x'.repeat(200)}"}`)?.grund.length).toBe(60)
  expect(QUEUE_MIN).toBe(0.7)
  expect(laterByVerdict({ wann: 'danach', sicher: 0.7, grund: '' })).toBe(true)
  expect(laterByVerdict({ wann: 'danach', sicher: 0.69, grund: '' })).toBe(false)
  expect(laterByVerdict({ wann: 'jetzt', sicher: 1, grund: '' })).toBe(false)
  expect(laterByVerdict(null)).toBe(false)
  expect(QUEUE).toEqual({ model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1000, timeoutMs: 4000 })
})

deTest('Prompt: drei Abschnitte mit Markern, Antwortende höchstens 1500 Zeichen; system de/en mit JSON-Form', () => {
  const p = queuePrompt({ text: LATER, turnPrompt: 'Bau den Export', tail: 'y'.repeat(4000) })
  expect(p).toContain('[LAUFENDE AUFGABE]\nBau den Export\n[/LAUFENDE AUFGABE]')
  expect(p).toContain(`[NEUE NACHRICHT]\n${LATER}\n[/NEUE NACHRICHT]`)
  const tail = /\[BISHER GESCHRIEBEN\]\n([\s\S]*)\n\[\/BISHER GESCHRIEBEN\]/.exec(p)?.[1] ?? ''
  expect(tail.length).toBe(1500)
  expect(queuePrompt({ text: 'x y z w', turnPrompt: '', tail: '' })).toContain('[LAUFENDE AUFGABE]\n(nichts)')
  expect(queueSystem()).toContain('{"wann":"jetzt|danach","sicher":0.0,')
  expect(queueSystem()).toContain('Im Zweifel „jetzt“')
  setLang('en')
  expect(queueSystem()).toContain('When in doubt, "jetzt"')
  expect(queuePrompt({ text: 'a b c d', turnPrompt: 't', tail: '' })).toContain('[NEW MESSAGE]\na b c d\n[/NEW MESSAGE]')
  setLang('de')
})

deTest('Hinweis an Claude: nimmt die Frage-Regel mit (Frage oder Fehler zuerst), de und en', () => {
  expect(T.de.q.context).toContain('erst vollständig fertig')
  expect(T.de.q.context).toContain('mit einer Frage an den Nutzer oder einem Fehler')
  expect(T.de.q.context).toContain('erst nach seiner Antwort')
  expect(T.en.q.context).toContain('only after their answer')
  expect(T.de.q.line('Neue Aufgabe')).toBe('kommt nach dieser Aufgabe · Neue Aufgabe')
  expect(T.de.q.line('')).toBe('kommt nach dieser Aufgabe')
})

deTest('Bilanz: Rolle queue in /savings detail, markiert; alte Tage ohne Feld → 0', () => {
  const old = cleanLedger({ tage: { [dayKey(NOW)]: { kosten: 1 } } }).tage[dayKey(NOW)]!
  expect(old.warteschlange).toEqual({ n: 0, usd: 0, ms: 0, markiert: 0 })
  const d = emptyDay()
  const u = { input_tokens: 1500, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  for (let i = 0; i < 2; i++) bookQueue(d, 'claude-haiku-5-5', 0.0005, 1600, u)
  for (let i = 0; i < 3; i++) countQueue(d, 'markiert')
  expect(Math.abs(d.kosten - 0.001) < 1e-9).toBe(true)
  expect(d.modelle['claude-haiku-5-5']?.queue.n).toBe(2)
  expect(addDay(d, old).warteschlange.markiert).toBe(3)
  const md = savingsReport(d, 'all', NOW, '', { [dayKey(NOW)]: d })
  expect(md).toContain('| Haiku 5.5 | Warteschlange | 2 |')
  expect(md).toContain('Warteschlange: 2 Urteile (')
  expect(md).toContain('3× als späterer Punkt an Claude')
  expect(JSON.stringify(savingsTree(d, 'all', NOW, 100, 'terminal', { [dayKey(NOW)]: d }))).toContain('3× als späterer Punkt')
  expect(savingsReport(emptyDay(), 'all', NOW, '', { [dayKey(NOW)]: emptyDay() })).not.toContain('Warteschlange:')
})

deTest('Hilfe: /sidekick queue und on|off, Funktion und Einstellung Warteschlange; Texte en/de mit gleichen Schlüsseln', () => {
  const f = { settings: DEFAULT_SETTINGS, ttl: { min: 5, source: 'default' as const }, hints: { on: true, off: [] }, known: 0, now: NOW, cfg: { queue: false } }
  const h = sidekickHelp(f)
  const cmds = h.commands.map((c) => c.cmd)
  for (const c of ['/sidekick queue', '/sidekick queue on|off']) expect(cmds).toContain(c)
  expect(h.features?.find((x) => x.name === 'Warteschlange')).toEqual({ name: 'Warteschlange', state: { kind: 'off' }, toggle: '/sidekick queue on' })
  expect(h.settings?.find((x) => x.title === 'Warteschlange')).toMatchObject({ value: 'aus', isDefault: false })
  expect(sidekickHelp({ ...f, cfg: {} }).features?.find((x) => x.name === 'Warteschlange')?.state).toEqual({ kind: 'on' })
  expect(Object.keys(T.en.q).sort()).toEqual(Object.keys(T.de.q).sort())
  expect(T.de.role.queue).toBe('Warteschlange')
  expect(T.en.role.queue).toBe('Queue')
})

// ---------- Hooks ----------

type Verdict = string | Error | 'timeout'

function world(on: On, o: { surfaces?: string[]; host?: boolean; read?: 'stale' | 'throw' } = {}) {
  const clock = mock.clock(on, { now: NOW })
  // Delta-Review 0.24.0 K4: Prüf-Prompts und Neuzeichnen mitschreiben
  const checks: string[] = []
  let invalidates = 0
  // `host` (Patch 0.25.1): `$.state` und `$.ui.invalidate` des Test-Hosts, damit eine offene Zeichnung wirklich neu zeichnet
  if (!o.host)
    on('ui.invalidate', () => {
      invalidates += 1
      return { value: undefined }
    })
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  const submitted: { text: string; context?: readonly string[]; origin?: unknown }[] = []
  let msgs: unknown[] = [
    { role: 'user', text: 'Bau bitte den Export in das Menü ein', toolUses: [] },
    { role: 'assistant', text: 'Ich baue den Export ein und schreibe die Tests.', toolUses: [] },
  ]
  let surfaces = o.surfaces ?? ['desktop']
  let verdict: Verdict = '{"wann":"jetzt","sicher":0.9,"grund":"Ergänzung"}'
  const queueCalls: string[] = []
  const cli = cliStubs(on)
  on('session.start', () => ({ cwd: '/work' }) as never)
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: surfaces as never }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 20000, window: 1000000 }, rateLimits: [] } as never }))
  on('session.root', () => ({ value: 'C:\\Proj' }))
  on('session.messages', () => ({ value: msgs as never }))
  on('command.list', () => ({ value: [] as never }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const stateVals = new Map<string, unknown>()
  const stateSets: { key: string; value: unknown }[] = []
  if (!o.host) {
    // `read` (Patch 0.25.1): das Lesen in der Zeichnung liefert einen Stand ohne „Danach“ oder wirft
    on('state.get', ($: unknown, e: any) => {
      if (o.read === 'throw') throw new Error('state.get')
      if (o.read === 'stale' && e.key === 'prompts') return { value: { value: { buttons: [] }, version: 1 } }
      return { value: { value: e.plugin === 'sidekick' ? stateVals.get(e.key) : undefined, version: 1 } }
    })
    on('state.set', ($: unknown, e: any) => {
      if (e.plugin === 'sidekick') {
        stateVals.set(e.key, e.value)
        stateSets.push({ key: e.key, value: e.value })
      }
      return { value: { isSet: true, version: 1 } }
    })
  }
  const U = { input_tokens: 1500, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', ($, e) => {
    const sys = e.system ?? ''
    if (sys.includes('"wann"')) {
      queueCalls.push(e.prompt)
      if (verdict instanceof Error) throw verdict
      if (verdict === 'timeout') return { value: { isAnswered: false, reason: 'timeout', usage: U } as never }
      return { value: { isAnswered: true, text: verdict, usage: U } as never }
    }
    checks.push(e.prompt)
    return { value: { isAnswered: true, text: '{"urteil":"durch","art":"sonstiges","zeile":"","fassung":"","skill":"","kurzfassung":"k"}', usage: U } as never }
  })
  on('prompt.submit', async ($, e) => {
    submitted.push({ text: e.text, ...(e.context ? { context: e.context } : {}), origin: e.origin })
    return { text: e.text, ...(e.context ? { context: e.context } : {}) }
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('ui.render', ($, e) => {
    if (e.component === 'SessionMode') return { type: 'Text', props: {}, children: [((e.props as { modes?: string[] }).modes ?? []).join(' & ')] }
    return { type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }
  })
  return {
    clock,
    checks,
    invalidates: () => invalidates,
    store,
    toasts,
    submitted,
    queueCalls,
    cli,
    stateVals,
    stateSets,
    setMessages: (m: unknown[]) => (msgs = m),
    setSurfaces: (s: string[]) => (surfaces = s),
    setVerdict: (v: Verdict) => (verdict = v),
    ledger: (id = 'sess-1') => cleanLedger(store.get(`bilanz:${id}`)),
  }
}

async function flush(rounds = 300) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
const today = (l: Ledger) => l.tage[dayKey(NOW)] ?? emptyDay()
const run = async ($: Engine, args: string) => (await $.command.run({ command: 'sidekick', args, origin: { kind: 'composer' } } as never)).text ?? ''
async function start($: Engine) {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never)
  await flush()
}
/** Eine Nachricht des Nutzers während der Runde `t1` (wie im Desktop: origin composer, Probe P1). */
const during = ($: Engine, text: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, wait: false, turnId: 't1', origin: { kind: 'composer' }, ...extra } as never) as Promise<{ text?: string; context?: readonly string[]; drop?: string }>
/** sidekicks graue Zeile unter einer Zeile (UserMessage, Desktop). */
async function lineUnder($: Engine, text: string, requestId: string): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId, surface: 'desktop', props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)
  const line = JSON.stringify((await ui.find({ key: 'sidekick-line' })) ?? '')
  await ui.unmount()
  return line
}
const hasNote = (r: { context?: readonly string[] }) => !!r.context?.includes(T.de.q.context)

deTest('Folge-Signal: Nachricht geht sofort und unverändert rein, mit Hinweis an Claude, ohne Haiku; graue Zeile; gebucht', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await during($, REMINDER + LATER)
  expect(r.drop).toBeUndefined()
  // unverändert, der Vorspann der App bleibt im gesendeten Text
  expect(r.text).toBe(REMINDER + LATER)
  expect(hasNote(r)).toBe(true)
  expect(w.queueCalls.length).toBe(0)
  expect(await lineUnder($, REMINDER + LATER, 'u1')).toContain('kommt nach dieser Aufgabe · als „danach“ geschrieben')
  await flush()
  expect(today(w.ledger()).warteschlange.markiert).toBe(1)
})

deTest('Haiku: jetzt → kein Hinweis; danach ≥ 0,7 → Hinweis mit Grund; 0,6, ungültig, Fehler, Timeout → kein Hinweis; Kosten gebucht', async ($, on) => {
  const w = world(on)
  await start($)
  const r0 = await during($, MID)
  expect(r0.text).toBe(MID)
  expect(hasNote(r0)).toBe(false)
  expect(w.queueCalls[0]).toContain('[LAUFENDE AUFGABE]\nBau bitte den Export in das Menü ein')
  expect(w.queueCalls[0]).toContain('[BISHER GESCHRIEBEN]\nIch baue den Export ein und schreibe die Tests.')
  for (const v of ['{"wann":"danach","sicher":0.6,"grund":"vielleicht"}', 'kaputt', new Error('api down'), 'timeout'] as Verdict[]) {
    w.setVerdict(v)
    const r = await during($, MID)
    expect(r.text).toBe(MID)
    expect(hasNote(r)).toBe(false)
  }
  w.setVerdict('{"wann":"danach","sicher":0.9,"grund":"Neue Aufgabe"}')
  const r1 = await during($, MID)
  expect(hasNote(r1)).toBe(true)
  expect(await lineUnder($, MID, 'u2')).toContain('kommt nach dieser Aufgabe · Neue Aufgabe')
  await flush()
  const d = today(w.ledger())
  // fünf Antworten mit usage (der Fehler hat keine)
  expect(d.warteschlange.n).toBe(5)
  expect(d.modelle['claude-haiku-5-5']?.queue.n).toBe(5)
  expect(d.warteschlange.markiert).toBe(1)
})

deTest('Ohne Hinweis: wait, ohne turnId, Herkunft Plugin/Peer, Host-Meldung, -p, Korrektur', async ($, on) => {
  const w = world(on)
  await start($)
  const plain = [
    await during($, LATER, { wait: true }),
    (await $.prompt.submit({ text: LATER, wait: false, origin: { kind: 'composer' } } as never)) as { context?: readonly string[] },
    await during($, LATER, { origin: { kind: 'plugin', name: 'x' } }),
    await during($, LATER, { origin: { kind: 'peer' } }),
    await during($, '[Cross-session idle notice] "X", which you asked to be notified about, is idle', { origin: { kind: 'sdk' } }),
    await during($, 'Nein, das geht immer noch nicht, nimm die andere Datei'),
  ]
  for (const r of plain) expect(hasNote(r)).toBe(false)
  // `-p`: sdk ohne Oberfläche
  w.setSurfaces([])
  expect(hasNote(await during($, LATER, { origin: { kind: 'sdk' } }))).toBe(false)
  // im Desktop zählt sdk als getippt
  w.setSurfaces(['desktop'])
  expect(hasNote(await during($, LATER, { origin: { kind: 'sdk' } }))).toBe(true)
  expect(w.queueCalls.length).toBe(0)
})

for (const level of ['cache', 'off'])
  deTest(`Stufe ${level}: kein Hinweis, kein Haiku`, { level }, async ($, on) => {
    const w = world(on)
    await start($)
    expect(hasNote(await during($, LATER))).toBe(false)
    expect(hasNote(await during($, MID))).toBe(false)
    expect(w.queueCalls.length).toBe(0)
  })

deTest('Einstellung queue aus (userConfig): kein Hinweis, kein Haiku; /sidekick queue zeigt aus', { queue: false }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(hasNote(await during($, LATER))).toBe(false)
  expect(hasNote(await during($, MID))).toBe(false)
  expect(w.queueCalls.length).toBe(0)
  expect(await run($, 'queue')).toContain('**Warteschlange** · aus')
})

deTest('/sidekick queue: Zustand, on/off schreibt userConfig über writeCfg, schon so, Aufruf; Stufe cache sagt es', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await run($, 'queue')).toContain('**Warteschlange** · an\n')
  expect(await run($, 'queue on')).toBe('Die Warteschlange ist schon an.')
  const off = await run($, 'queue off')
  expect(off).toContain('✓ Warteschlange aus')
  expect(written(w.cli)).toEqual({ queue: 'false' })
  // gilt sofort in dieser Session
  expect(hasNote(await during($, LATER))).toBe(false)
  expect(await run($, 'queue foo')).toBe('Aufruf: `/sidekick queue` · `on` · `off`')
  expect(await run($, 'queue on')).toContain('✓ Warteschlange an')
  expect(written(w.cli)).toEqual({ queue: 'true' })
})

deTest('/sidekick queue auf Stufe Cache: Hinweis, dass es nur auf Begleiter wirkt', { level: 'cache' }, async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'queue')).toContain('(wirkt nur auf der Stufe Begleiter)')
})

test('Englisch: Hinweis, Zeile und Zustand', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  world(on)
  await start($)
  const r = await during($, 'After that please update the README file')
  expect(r.context).toContain(T.en.q.context)
  expect(await lineUnder($, 'After that please update the README file', 'e1')).toContain('comes after this task · written as \\"after that\\"')
  expect(await run($, 'queue')).toContain('**Queue** · on')
})

// ---------- Knopf „Danach“ und Präfix (Fynn 2026-11-08) ----------

deTest('Präfix: „danach:“/„later:“ am Anfang (nach dem Vorspann) wird entfernt; ohne Text dahinter oder mitten im Satz nicht', () => {
  expect(laterPrefix('danach: README anpassen')).toEqual({ text: 'README anpassen', rest: 'README anpassen' })
  expect(laterPrefix('Later:   bump the version')).toEqual({ text: 'bump the version', rest: 'bump the version' })
  expect(laterPrefix(REMINDER + 'Danach: README anpassen')).toEqual({ text: REMINDER + 'README anpassen', rest: 'README anpassen' })
  expect(laterPrefix('danach:   ')).toBe(null)
  expect(laterPrefix('Danach bitte die README')).toBe(null)
  expect(laterPrefix('mach das danach: README')).toBe(null)
  expect(T.de.q.btn(false)).toBe('Danach')
  expect(T.de.q.btn(true)).toBe('Danach ✓')
  expect(T.en.q.btn(true)).toBe('Later ✓')
})

deTest('Präfix während der Runde: entfernt, Hinweis an Claude, Zeile „mit danach:“, kein Haiku, auch vor einer Korrektur', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await during($, 'danach: Nein, nimm später die andere Datei')
  expect(r.text).toBe('Nein, nimm später die andere Datei')
  expect(hasNote(r)).toBe(true)
  expect(w.queueCalls.length).toBe(0)
  // die Zeile hängt an der Zeile, wie sie getippt wurde (Delta-Review S1), und an der ohne Präfix
  expect(await lineUnder($, 'danach: Nein, nimm später die andere Datei', 'p1')).toContain('kommt nach dieser Aufgabe · mit „danach:“')
  // in Ruhe: nur entfernt, kein Hinweis (es läuft nichts)
  const idle = (await $.prompt.submit({ text: 'danach: README anpassen', wait: false, origin: { kind: 'composer' } } as never)) as { text?: string; context?: readonly string[] }
  expect(idle.text).toBe('README anpassen')
  expect(hasNote(idle)).toBe(false)
})

deTest('Präfix bei queue aus: bleibt stehen, kein Hinweis', { queue: false }, async ($, on) => {
  world(on)
  await start($)
  const r = await during($, 'danach: README anpassen')
  expect(r.text).toBe('danach: README anpassen')
  expect(hasNote(r)).toBe(false)
})

async function footer($: Engine, surface: 'desktop' | 'terminal') {
  return $.ui.mount({ plugin: 'sidekick', component: 'SessionMode', requestId: `mode-${surface}`, surface, props: { modes: [] } } as never)
}
async function stepOn($: Engine, turnId = 't1') {
  const s = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 3 } as never)
  let r = await s.next()
  while (r.done !== true) r = await s.next()
}
const endTurn = ($: Engine, turnId = 't1') => $.turn.complete({ turnId, answer: 'fertig', reason: 'answer', durationMs: 10, isAborted: false, usage: null } as never)

deTest('Knopf „Danach“: nur während der Runde im Desktop; Klick → „Danach ✓“, nächste Nachricht ohne Haiku mit Hinweis; einmal, dann wieder offen', async ($, on) => {
  const w = world(on)
  await start($)
  const idle = await footer($, 'desktop')
  expect(await idle.find({ key: 'sidekick-later' })).toBeUndefined()
  await idle.unmount()
  await stepOn($)
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [], later: 'on' })
  const ui = await footer($, 'desktop')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-later' }))).toContain('"Danach"')
  // links vor dem ●-Label
  const all = JSON.stringify(await ui.find({ type: 'Box' }))
  expect(all.indexOf('sidekick-later')).toBeLessThan(all.indexOf('sidekick-mode'))
  await ui.press({ key: 'sidekick-later' })
  await flush()
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [], later: 'armed' })
  await ui.unmount()
  const armed = await footer($, 'desktop')
  expect(JSON.stringify(await armed.find({ key: 'sidekick-later' }))).toContain('Danach ✓')
  await armed.unmount()
  // die nächste Nachricht: sicher „danach“, ohne Haiku (das Haiku-Urteil wäre „jetzt“)
  const r = await during($, MID)
  expect(hasNote(r)).toBe(true)
  expect(w.queueCalls.length).toBe(0)
  expect(await lineUnder($, MID, 'k1')).toContain('kommt nach dieser Aufgabe · per Knopf „Danach“')
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [], later: 'on' })
  // die übernächste urteilt wieder selbst
  expect(hasNote(await during($, MID))).toBe(false)
  expect(w.queueCalls.length).toBe(1)
  // Terminal: kein Knopf
  const term = await footer($, 'terminal')
  expect(await term.find({ key: 'sidekick-later' })).toBeUndefined()
  await term.unmount()
})

deTest('Knopf „Danach“: zweiter Klick nimmt zurück; Ende der Runde löscht Markierung und Knopf', async ($, on) => {
  const w = world(on)
  await start($)
  await stepOn($)
  const ui = await footer($, 'desktop')
  await ui.press({ key: 'sidekick-later' })
  await ui.press({ key: 'sidekick-later' })
  await flush()
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [], later: 'on' })
  expect(hasNote(await during($, MID))).toBe(false)
  await ui.press({ key: 'sidekick-later' })
  await flush()
  await ui.unmount()
  await endTurn($)
  await flush()
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [] })
  // neue Runde: die alte Markierung gilt nicht mehr
  await stepOn($, 't2')
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [], later: 'on' })
  expect(hasNote(await during($, MID, { turnId: 't2' }))).toBe(false)
})

// Absicherung des Normalfalls mit dem Test-Host (auch vor 0.25.1 grün, Delta-Review S1); den Desktop-Fehler stellen die Tests mit
// `read` darunter nach
deTest('Patch 0.25.1: offene Zeichnung, Klick → „Danach ✓“, Klick zurück → „Danach“, der Knopf bleibt bis zum Ende der Runde', async ($, on) => {
  world(on, { host: true })
  await start($)
  await stepOn($)
  const ui = await footer($, 'desktop')
  const label = async () => JSON.stringify((await ui.find({ key: 'sidekick-later' })) ?? null)
  expect(await label()).toContain('"Danach"')
  for (let i = 0; i < 3; i++) {
    await ui.press({ key: 'sidekick-later' })
    await flush()
    expect(await label()).toContain('Danach ✓')
    await ui.press({ key: 'sidekick-later' })
    await flush()
    const back = await label()
    expect(back).toContain('"Danach"')
    expect(back).not.toContain('✓')
  }
  // ein weiterer Schritt derselben Runde lässt ihn stehen
  await stepOn($)
  await flush()
  expect(await label()).toContain('"Danach"')
  await endTurn($)
  await flush()
  expect(await ui.find({ key: 'sidekick-later' })).toBeUndefined()
  await ui.unmount()
})

for (const read of ['stale', 'throw'] as const)
  deTest(`Patch 0.25.1: Lesen in der Zeichnung ${read === 'stale' ? 'ohne „Danach“' : 'wirft'} → Knopf steht trotzdem, Klick und Klick zurück`, async ($, on) => {
    const w = world(on, { read })
    await start($)
    await stepOn($)
    const label = async () => {
      const ui = await footer($, 'desktop')
      const s = JSON.stringify((await ui.find({ key: 'sidekick-later' })) ?? null)
      await ui.unmount()
      return s
    }
    expect(await label()).toContain('"Danach"')
    const ui = await footer($, 'desktop')
    await ui.press({ key: 'sidekick-later' })
    await flush()
    await ui.unmount()
    expect(await label()).toContain('Danach ✓')
    const ui2 = await footer($, 'desktop')
    await ui2.press({ key: 'sidekick-later' })
    await flush()
    await ui2.unmount()
    expect(w.stateVals.get('prompts')).toEqual({ buttons: [], later: 'on' })
    const back = await label()
    expect(back).toContain('"Danach"')
    expect(back).not.toContain('✓')
    await endTurn($)
    await flush()
    expect(await label()).toBe('null')
  })

deTest('Knopf „Danach“: nicht bei queue aus', { queue: false }, async ($, on) => {
  const w = world(on)
  await start($)
  await stepOn($)
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [] })
  const ui = await footer($, 'desktop')
  expect(await ui.find({ key: 'sidekick-later' })).toBeUndefined()
  await ui.unmount()
})

deTest('Hilfe: Präfix und Knopf „Danach“', () => {
  const h = sidekickHelp({ settings: DEFAULT_SETTINGS, ttl: { min: 5, source: 'default' as const }, hints: { on: true, off: [] }, known: 0, now: NOW })
  expect(h.commands.map((c) => c.cmd)).toContain('danach: <text>')
  expect(h.controls?.map((c) => c.cmd)).toContain('Danach')
  expect(T.de.q.state(true, true)).toContain('gilt erst in neuen Chats')
  expect(T.en.q.state(true, true)).toContain('applies in new chats only')
})

deTest('Knopf „Danach“: ein Slash-Befehl oder leerer Text verbraucht die Markierung nicht (Delta-Review K1)', async ($, on) => {
  const w = world(on)
  await start($)
  await stepOn($)
  const ui = await footer($, 'desktop')
  await ui.press({ key: 'sidekick-later' })
  await flush()
  await ui.unmount()
  expect(hasNote(await during($, '/sidekick queue'))).toBe(false)
  expect(hasNote(await during($, REMINDER))).toBe(false)
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [], later: 'armed' })
  expect(hasNote(await during($, MID))).toBe(true)
  expect(w.queueCalls.length).toBe(0)
})

// ---------- Delta-Review 0.24.0 K4 ----------

deTest('K4: fortgesetzter Chat, Verlauf mit Vorspann der App → die letzten eigenen Nachrichten gehen ohne Vorspann an die Prüfung', { threshold: 1000 }, async ($, on) => {
  const w = world(on)
  w.setMessages([
    { role: 'user', text: REMINDER + 'Bau bitte den Export in das Menü ein', toolUses: [] },
    { role: 'assistant', text: 'Ich baue den Export ein.', toolUses: [] },
  ])
  await start($)
  await $.prompt.submit({ text: 'Und jetzt bitte noch die Tests für den Export schreiben', wait: false, origin: { kind: 'composer' } } as never)
  await flush()
  const prompt = w.checks.find((c) => c.includes('Export in das Menü')) ?? ''
  expect(prompt).toContain('Bau bitte den Export in das Menü ein')
  expect(prompt).not.toContain('<system-reminder>')
})

deTest('K4: nach dem Hinweis an Claude zeichnet sidekick 100 ms später einmal neu (mock.clock)', async ($, on) => {
  const w = world(on)
  await start($)
  await during($, LATER)
  const before = w.invalidates()
  await w.clock.advance(150)
  await flush()
  expect(w.invalidates()).toBeGreaterThan(before)
})

deTest('K4: Präfix hinter dem Vorspann der App im Hook-Pfad: Präfix weg, Vorspann bleibt, Hinweis, kein Haiku, Zeile unter der getippten Zeile', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await during($, REMINDER + 'danach: README im Ordner docs anpassen')
  expect(r.text).toBe(REMINDER + 'README im Ordner docs anpassen')
  expect(hasNote(r)).toBe(true)
  expect(w.queueCalls.length).toBe(0)
  expect(await lineUnder($, REMINDER + 'danach: README im Ordner docs anpassen', 'k4')).toContain('mit „danach:“')
})
