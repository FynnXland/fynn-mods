// Tests zum Nachtrag 0.21.0: gespeicherte Prompts als Befehl und Knopf (SPEC „Tests“). Eigene, kleine Welt mit Stubs.
import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { MIN, dayKey } from '../hooks/cache.ts'
import { cliStubs } from './cli.ts'
import { DEFAULT_SETTINGS, addDay, bookPrompts, cleanLedger, countPrompt, emptyDay, savingsReport } from '../hooks/logic.ts'
import type { Ledger } from '../hooks/logic.ts'
import { setLang } from '../hooks/i18n.ts'
import { savingsTree } from '../hooks/view.ts'
import { sidekickHelp } from '../hooks/helpdata.ts'
import {
  BUTTONS_MAX,
  JACCARD,
  MIN_CHARS,
  RECENT_DAYS,
  RECENT_MAX,
  SAVED_MAX,
  addRecent,
  addSeen,
  budgetLeft,
  buttonLabel,
  buttonNames,
  candidates,
  checkName,
  cleanBudget,
  cleanRecent,
  cleanSaved,
  cleanSeen,
  commandDescription,
  freeName,
  jaccard,
  nearSaved,
  parseProposal,
  proposePrompt,
  proposeSystem,
  recentOf,
  remembers,
  seenSet,
  pHint,
  upsert,
  useBudget,
  wordSet,
} from '../hooks/prompts.ts'
import type { Saved } from '../hooks/prompts.ts'

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
const TIDY = 'Sortiere die Chats unter dir nach ihrem tatsächlichen Zweck und archiviere die, die wir nicht mehr brauchen.'

// ---------- reine Logik ----------

deTest('Verlauf: kurze Nachrichten, Slash-Befehle und Plugin-Nachrichten werden nicht gemerkt', () => {
  expect(remembers(TIDY, 'composer')).toBe(true)
  expect(remembers(TIDY, 'sdk')).toBe(true)
  expect(remembers(TIDY, 'plugin')).toBe(false)
  expect(remembers(`/sidekick save x ${TIDY}`, 'composer')).toBe(false)
  expect(remembers('ja, weiter so, mach das bitte', 'composer')).toBe(false)
  // 60 Zeichen, aber unter 8 Wörtern
  expect(remembers('Donaudampfschifffahrtsgesellschaftskapitänsmützenhalterung prüfen', 'composer')).toBe(false)
  expect(MIN_CHARS).toBe(60)
})

deTest('Wortmenge: klein, ohne Satzzeichen, ohne Wörter unter 3 Buchstaben, je einmal', () => {
  expect(wordSet('Die Chats, die CHATS! ab zu')).toEqual(['chats', 'die'])
  expect(new Set(wordSet('Über-Größe: ÄRGER'))).toEqual(new Set(['ärger', 'größe', 'über']))
  expect(jaccard(['a1', 'b1'], ['a1', 'b1'])).toBe(1)
  expect(jaccard(['a1'], [])).toBe(0)
  expect(jaccard(['aaa', 'bbb', 'ccc'], ['aaa', 'ddd'])).toBe(0.25)
})

deTest('Verlauf: Grenzen 300 Einträge und 30 Tage, kaputte Einträge fallen weg, Text höchstens 1000 Zeichen', () => {
  const many = Array.from({ length: RECENT_MAX + 20 }, (_, i) => recentOf(`${TIDY} ${i}`, `s${i}`, NOW - 1000 + i))
  expect(cleanRecent(many, NOW).length).toBe(RECENT_MAX)
  expect(cleanRecent(many, NOW)[0]!.sid).toBe('s20')
  const old = recentOf(TIDY, 'alt', NOW - (RECENT_DAYS + 1) * DAY)
  expect(addRecent([old], recentOf(TIDY, 'neu', NOW), NOW).map((r) => r.sid)).toEqual(['neu'])
  expect(cleanRecent([null, { sid: 1 }, 'x', { sid: 's', at: NOW, text: TIDY }], NOW).length).toBe(1)
  expect(recentOf('x'.repeat(4000), 's', NOW).text.length).toBe(1000)
})

deTest('Vorfilter: 3 ähnliche aus 3 Sessions → Kandidat; 3 aus derselben Session → keiner; unähnliche → keiner', () => {
  const a = recentOf(TIDY, 's1', NOW - 3 * DAY)
  const b = recentOf(`Bitte ${TIDY}`, 's2', NOW - 2 * DAY)
  const c = recentOf(`${TIDY} Danke dir.`, 's3', NOW)
  const g = candidates([a, b], c)
  expect(g?.map((r) => r.sid)).toEqual(['s3', 's1', 's2'])
  // dieselbe Session
  const same = [recentOf(TIDY, 's3', NOW - 2), recentOf(`Bitte ${TIDY}`, 's3', NOW - 1)]
  expect(candidates(same, c)).toBe(null)
  // nur zwei Sessions zusammen
  expect(candidates([a, recentOf(`Bitte ${TIDY}`, 's1', NOW - 1)], c)).toBe(null)
  // unähnlich
  const other = [recentOf('Baue im Spiel eine neue Waffe mit Rückstoß und Nachladezeit ein, bitte mit Test.', 's1', NOW - 1), recentOf('Prüfe die Rechnung vom Oktober und trage die Beträge in die Tabelle ein, danke.', 's2', NOW - 1)]
  expect(candidates(other, c)).toBe(null)
  // gesehene Einträge zählen nicht
  expect(candidates([a, b], c, new Set([a.id]))).toBe(null)
  // höchstens 4 Nachrichten an Haiku, je Session eine
  const more = Array.from({ length: 6 }, (_, i) => recentOf(TIDY, `x${i}`, NOW - 10 - i))
  expect(candidates(more, c)?.length).toBe(4)
  expect(JACCARD).toBe(0.25)
})

deTest('Gesehene Gruppen, Tagesgrenze 5, Nähe zu gespeicherten', () => {
  const s = addSeen(cleanSeen([['a', 'b']]), ['c'])
  expect(seenSet(s)).toEqual(new Set(['a', 'b', 'c']))
  expect(cleanSeen(Array.from({ length: 120 }, (_, i) => [`g${i}`])).length).toBe(100)
  const day = dayKey(NOW)
  let b = cleanBudget(undefined)
  expect(budgetLeft(b, day)).toBe(5)
  for (let i = 0; i < 5; i++) b = useBudget(b, day)
  expect(budgetLeft(b, day)).toBe(0)
  expect(budgetLeft(b, dayKey(NOW + DAY))).toBe(5)
  expect(nearSaved([{ name: 'tidy-chats', text: TIDY, button: true, at: 0, from: 'auto' }], wordSet(`Bitte ${TIDY}`))).toBe(true)
  expect(nearSaved([], wordSet(TIDY))).toBe(false)
})

deTest('Namen: gültig, ungültig, eigener gespeicherter, Vorschlag -2; andere Befehle stören nicht (/p <name>)', () => {
  expect(checkName('tidy-chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('/Tidy Chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  // Gesendet wird mit `/p <name>`: eingebaute und fremde Befehlsnamen sind frei (Fynn 2026-11-06)
  expect(checkName('clear', [], false)).toEqual({ ok: true, name: 'clear' })
  expect(checkName('sidekick', [], true)).toEqual({ ok: true, name: 'sidekick' })
  // „/p tidy-chats“ als Eingabe speichert „tidy-chats“
  expect(checkName('/p tidy-chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('tidy-chats', ['tidy-chats'], false)).toMatchObject({ ok: false, why: 'own', suggest: 'tidy-chats-2' })
  expect(checkName('tidy-chats', ['tidy-chats'], true)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('a'.repeat(25), [], false)).toMatchObject({ ok: false, why: 'invalid' })
  expect(checkName('ä-ö', [], false)).toMatchObject({ ok: false, why: 'invalid' })
  expect(checkName('-x', [], false)).toMatchObject({ ok: false, why: 'invalid' })
  expect(freeName('clear', new Set(['clear', 'clear-2']))).toBe('clear-3')
  expect(freeName('a'.repeat(24), new Set()).length).toBeLessThanOrEqual(24)
  // Hinweis hinter /p im Menü
  const sv = (name: string) => ({ name, text: 'x', button: true, at: 0, from: 'manual' as const })
  expect(pHint([])).toBe('<name>')
  expect(pHint([sv('tidy-chats'), sv('review-pr')])).toBe('<tidy-chats|review-pr>')
  expect(pHint(Array.from({ length: 12 }, (_, i) => sv(`ein-langer-name-${i}`))).endsWith('|…>')).toBe(true)
})

deTest('Gespeicherte: tolerant gelesen, höchstens 12, Überschreiben behält Knopf, der 13. passt nicht, 4 Knöpfe', () => {
  expect(cleanSaved([{ name: 'ok-1', text: 'x' }, { name: 'Bad Name', text: 'x' }, { name: 'ok-1', text: 'doppelt' }, { name: 'leer', text: ' ' }])).toEqual([{ name: 'ok-1', text: 'x', button: true, at: 0, from: 'manual' }])
  let list: Saved[] = []
  for (let i = 0; i < SAVED_MAX; i++) list = upsert(list, { name: `p${i}`, text: `t${i}`, button: true, at: i, from: 'manual' }).list
  expect(list.length).toBe(12)
  expect(upsert(list, { name: 'p12', text: 'x', button: true, at: 99, from: 'manual' }).kind).toBe('full')
  list[1] = { ...list[1]!, button: false }
  const r = upsert(list, { name: 'p1', text: 'neu', button: true, at: 99, from: 'auto' })
  expect(r.kind).toBe('replaced')
  expect(r.list[1]).toEqual({ name: 'p1', text: 'neu', button: false, at: 1, from: 'auto' })
  expect(buttonNames(r.list)).toEqual(['p0', 'p2', 'p3', 'p4'])
  expect(BUTTONS_MAX).toBe(4)
  expect(buttonLabel('ein-sehr-langer-name-x')).toBe('ein-sehr-lang…')
  expect(buttonLabel('tidy-chats')).toBe('tidy-chats')
  expect(commandDescription(`  ${'Sortiere die Chats '.repeat(5)}`)).toMatch(/^sidekick: Sortiere die Chats .*…$/)
})

deTest('Haiku: Prompt mit Nachrichten, Antwort gültig, same false, ungültiges JSON, Name falsch, Text zu lang', () => {
  expect(proposeSystem('de')).toContain('{"same": true, "name": "…", "text": "…"}')
  expect(proposeSystem('en')).toContain('kebab-case')
  const p = proposePrompt([recentOf(TIDY, 's1', NOW), recentOf(TIDY, 's2', NOW)], 'de')
  expect(p).toContain('<message 2>')
  expect(parseProposal('```json\n{"same": true, "name": "tidy-chats", "text": "Sortiere die Chats."}\n```')).toEqual({ name: 'tidy-chats', text: 'Sortiere die Chats.' })
  expect(parseProposal('{"same": true, "name": "Tidy Chats", "text": "x"}')?.name).toBe('tidy-chats')
  expect(parseProposal('{"same": false}')).toBe(null)
  expect(parseProposal('kein json')).toBe(null)
  expect(parseProposal('{"same": true, "name": "", "text": "x"}')).toBe(null)
  expect(parseProposal('{"same": true, "name": "x", "text": "  "}')).toBe(null)
  expect(parseProposal(`{"same": true, "name": "${'a'.repeat(30)}", "text": "x"}`)).toBe(null)
  const long = parseProposal(JSON.stringify({ same: true, name: 'lang', text: 'Satz eins ist da. '.repeat(100) }))
  expect((long?.text.length ?? 0) <= 1200).toBe(true)
})

deTest('/savings: Rolle Prompts, Zeilen knapp und detail; alte Tage ohne Feld', () => {
  const old = cleanLedger({ tage: { [dayKey(NOW)]: { kosten: 1 } }, upd: NOW }).tage[dayKey(NOW)]!
  expect(old.prompts).toEqual({ n: 0, usd: 0, ms: 0, angeboten: 0, gespeichert: 0, abgelehnt: 0, gesendet: 0 })
  const d = emptyDay()
  const u = { input_tokens: 1500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  for (let i = 0; i < 3; i++) bookPrompts(d, 'claude-haiku-5-5', 0.002 / 3, 1500, u)
  for (const f of ['angeboten', 'gespeichert', 'gesendet', 'gesendet'] as const) countPrompt(d, f)
  expect(Math.abs(d.kosten - 0.002) < 1e-9).toBe(true)
  expect(d.modelle['claude-haiku-5-5']?.prompts.n).toBe(3)
  expect(addDay(d, old).prompts.gesendet).toBe(2)
  const short = savingsReport(d, 'all', NOW)
  expect(short).toContain('*Prompts: 3 Prüfungen')
  expect(short).toContain('1 angeboten · 1 gespeichert*')
  const md = savingsReport(d, 'all', NOW, '', { [dayKey(NOW)]: d })
  expect(md).toContain('| Haiku 5.5 | Prompts | 3 |')
  expect(md).toContain('Prompts: 3 Prüfungen (')
  expect(md).toContain('2× gesendet')
  expect(JSON.stringify(savingsTree(d, 'all', NOW, 100, 'terminal'))).toContain('Prompts: 3 Prüfungen')
  expect(JSON.stringify(savingsTree(d, 'all', NOW, 100, 'terminal', { [dayKey(NOW)]: d }))).toContain('2× gesendet')
  expect(savingsReport(emptyDay(), 'all', NOW)).not.toContain('Prompts')
})

deTest('Hilfe: Befehle und Funktion „Gespeicherte Prompts“', () => {
  const h = sidekickHelp({ settings: { ...DEFAULT_SETTINGS }, ttl: { min: 60, source: 'default' }, hints: { on: true, off: [] }, known: 0, now: NOW, prompts: { n: 2, buttons: 1 } })
  for (const c of ['/sidekick save <name> [text]', '/sidekick prompts [name]', '/sidekick prompts <name> on|off', '/sidekick forget <name>', '/p <name>']) expect(h.commands.some((x) => x.cmd === c), c).toBe(true)
  expect(h.features.find((f) => f.name === 'Gespeicherte Prompts')?.state.text).toBe('2 gespeichert · 1 mit Knopf')
})

// ---------- Hooks ----------

// Stufe und Schalter kommen seit 0.23.0 als userConfig (Test-Optionen); Befehle schreiben über den CLI-Stub (tests/cli.ts)
function world(on: On, o: { submitDrop?: string; cmds?: { name: string; source: string; plugin?: string }[]; surfaces?: string[] } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  cliStubs(on)
  const toasts: string[] = []
  const submitted: { text: string; asUser?: boolean; origin?: unknown }[] = []
  const registered: string[] = []
  const passed: string[] = []
  const stateVals = new Map<string, unknown>()
  const stateSets: { key: string; value: unknown }[] = []
  let msgs: unknown[] = [{ role: 'assistant', text: 'vorher', toolUses: [] }]
  let release: (() => void) | null = null
  let hold = false
  on('session.start', () => ({ cwd: '/work' }) as never)
  let sid = 'sess-1'
  // Erkennung: Antworten je Anweisung (Absicht, Vorschlag), sonst ein Urteil der Prüfung „durch“
  let intentOf: (text: string) => string = () => 'einmalig'
  let proposal: string = '{"same": false}'
  const calls: { kind: 'intent' | 'propose' | 'check'; prompt: string }[] = []
  on('session.id', () => ({ value: sid }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 20000, window: 1000000 }, rateLimits: [] } as never }))
  on('session.root', () => ({ value: 'C:\\Proj' }))
  on('session.messages', () => ({ value: msgs as never }))
  on('command.list', () => ({ value: [{ name: 'clear', description: '', source: 'builtin' }, ...(o.cmds ?? []), ...registered.map((n) => ({ name: n, description: '', source: 'plugin', plugin: 'sidekick' }))] as never }))
  const hints = new Map<string, string>()
  on('command.register', ($, e) => {
    if (!registered.includes(e.name)) registered.push(e.name)
    hints.set(e.name, e.argumentHint ?? '')
    return { value: { command: e.name } as never }
  })
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
  on('state.get', ($: unknown, e: any) => ({ value: { value: e.plugin === 'sidekick' ? stateVals.get(e.key) : undefined, version: 1 } }))
  on('state.set', ($: unknown, e: any) => {
    if (e.plugin === 'sidekick') {
      stateVals.set(e.key, e.value)
      stateSets.push({ key: e.key, value: e.value })
    }
    return { value: { isSet: true, version: 1 } }
  })
  const U = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', ($, e) => {
    const sys = e.system ?? ''
    if (sys.includes('Liste von Absichten') || sys.includes('list of intents')) {
      calls.push({ kind: 'intent', prompt: e.prompt })
      const m = /<message>\n([\s\S]*)\n<\/message>/.exec(e.prompt)
      return { value: { isAnswered: true, text: JSON.stringify({ absicht: intentOf(m?.[1] ?? '') }), usage: U } as never }
    }
    if (sys.includes('"same"')) {
      calls.push({ kind: 'propose', prompt: e.prompt })
      return { value: { isAnswered: true, text: proposal, usage: U } as never }
    }
    calls.push({ kind: 'check', prompt: e.prompt })
    return { value: { isAnswered: true, text: '{"urteil":"durch","art":"sonstiges","zeile":"","fassung":"","skill":"","kurzfassung":"k"}', usage: U } as never }
  })
  // Fremde Befehle: kommt der Lauf hier an, hat sidekick ihn durchgereicht
  on('command.run', ($, e) => {
    passed.push(e.command)
    return { text: `core ${e.command}` }
  })
  on('prompt.submit', async ($, e) => {
    if (hold) await new Promise<void>((r) => (release = r))
    if (o.submitDrop) return { drop: o.submitDrop }
    submitted.push({ text: e.text, ...((e as { asUser?: boolean }).asUser ? { asUser: true } : {}), origin: e.origin })
    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    if (e.component === 'SessionMode') return { type: 'Text', props: {}, children: [((e.props as { modes?: string[] }).modes ?? []).join(' & ')] }
    return { type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })
  return {
    clock,
    store,
    toasts,
    submitted,
    registered,
    hints,
    passed,
    stateVals,
    stateSets,
    setMessages: (m: unknown[]) => (msgs = m),
    holdSubmit: () => (hold = true),
    releaseSubmit: () => {
      hold = false
      release?.()
    },
    ledger: (id = 'sess-1') => cleanLedger(store.get(`bilanz:${id}`)),
    calls,
    setSid: (x: string) => (sid = x),
    setIntent: (f: (text: string) => string) => (intentOf = f),
    setProposal: (x: string) => (proposal = x),
    saved: () => cleanSaved(store.get('prompts:saved')),
  }
}

async function flush(rounds = 300) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
const today = (l: Ledger) => l.tage[dayKey(NOW)] ?? emptyDay()
const run = async ($: Engine, command: string, args = '', origin: { kind: string; name?: string } = { kind: 'composer' }) => (await $.command.run({ command, args, origin } as never)).text ?? ''
async function start($: Engine) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as never)
  await flush()
}

deTest('/sidekick save mit Text: gespeichert, als Befehl angemeldet, Knopf in sidekick.prompts', async ($, on) => {
  const w = world(on)
  await start($)
  const out = await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  expect(out).toContain('✓ Gespeichert als /p tidy-chats.')
  expect(out).toContain('Mit Knopf.')
  expect(w.saved()).toEqual([{ name: 'tidy-chats', text: TIDY, button: true, at: NOW, from: 'manual' }])
  expect(w.registered).toContain('p')
  expect(w.stateVals.get('prompts')).toEqual({ buttons: ['tidy-chats'] })
  await flush()
  expect(today(w.ledger()).prompts.gespeichert).toBe(1)
})

deTest('/sidekick save ohne Text: letzte eigene Nachricht dieses Chats, Befehle und Host-Texte zählen nicht', async ($, on) => {
  const w = world(on)
  await start($)
  w.setMessages([
    { role: 'user', text: TIDY, toolUses: [] },
    { role: 'assistant', text: 'erledigt', toolUses: [] },
    { role: 'user', text: '<system-reminder>x</system-reminder>', toolUses: [] },
    { role: 'user', text: '/sidekick save tidy', toolUses: [] },
  ])
  expect(await run($, 'sidekick', 'save tidy')).toContain('✓ Gespeichert als /p tidy.')
  expect(w.saved()[0]!.text).toBe(TIDY)
  w.setMessages([{ role: 'assistant', text: 'nur ich', toolUses: [] }])
  expect(await run($, 'sidekick', 'save leer')).toContain('keine eigene Nachricht')
  expect(await run($, 'sidekick', 'save')).toContain('So geht es')
})

deTest('/sidekick save: eingebauter Name frei, ungültig, 13. Prompt, Überschreiben', async ($, on) => {
  const w = world(on, { cmds: [{ name: 'review', source: 'plugin', plugin: 'other' }] })
  await start($)
  // Namen anderer Befehle sind frei: gesendet wird mit /p <name>
  expect(await run($, 'sidekick', 'save clear x y z')).toContain('✓ Gespeichert als /p clear.')
  expect(await run($, 'sidekick', 'save review x y z')).toContain('✓ Gespeichert als /p review.')
  await run($, 'sidekick', 'forget clear')
  await run($, 'sidekick', 'forget review')
  expect(await run($, 'sidekick', 'save Böse! x')).toContain('geht nicht als Name')
  for (let i = 0; i < 12; i++) await run($, 'sidekick', `save p${i} Text ${i}`)
  expect(w.saved().length).toBe(12)
  expect(await run($, 'sidekick', 'save p12 zu viel')).toContain('Schon 12 gespeicherte Prompts')
  // Überschreiben eines eigenen Namens
  const over = await run($, 'sidekick', 'save p0 Neuer Text')
  expect(over).toContain('✓ /p p0 überschrieben.')
  expect(w.saved()[0]!.text).toBe('Neuer Text')
  // Knöpfe: nur die ersten 4
  expect(w.stateVals.get('prompts')).toEqual({ buttons: ['p0', 'p1', 'p2', 'p3'] })
  expect(over).toContain('Mit Knopf.')
  expect(await run($, 'sidekick', 'save p11 anders')).toContain('Nur als Befehl')
})

deTest('/sidekick prompts, prompts <name>, prompts <name> on|off, forget', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await run($, 'sidekick', 'prompts')).toContain('Noch keine gespeicherten Prompts')
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  const list = await run($, 'sidekick', 'prompts')
  expect(list).toContain('**Gespeicherte Prompts** · 1 von 12 · #')
  expect(list).toContain('| `/p tidy-chats` | Sortiere die Chats')
  expect(list).toContain('| an |')
  // jede Tabellenzeile hat 3 Spalten (kein | in den Zellen)
  for (const l of list.split('\n').filter((x) => x.startsWith('|'))) expect(l.split('|').length - 2).toBe(3)
  const one = await run($, 'sidekick', 'prompts tidy-chats')
  expect(one).toContain('**/p tidy-chats** · Knopf an · selbst gespeichert')
  expect(one).toContain(TIDY)
  expect(await run($, 'sidekick', 'prompts tidy-chats off')).toContain('ohne Knopf')
  expect(w.stateVals.get('prompts')).toEqual({ buttons: [] })
  expect(await run($, 'sidekick', 'prompts tidy-chats on')).toContain('hat jetzt einen Knopf')
  expect(await run($, 'sidekick', 'prompts gibtsnicht')).toContain('Keinen gespeicherten Prompt „gibtsnicht“')
  expect(await run($, 'sidekick', 'forget tidy-chats')).toContain('✓ /p tidy-chats gelöscht.')
  expect(w.saved()).toEqual([])
  expect(await run($, 'sidekick', 'forget tidy-chats')).toContain('Keinen gespeicherten Prompt')
  // gelöscht: /p sagt es, sendet nichts
  expect(await run($, 'p', 'tidy-chats')).toContain('Keinen gespeicherten Prompt „tidy-chats“')
  // /p ohne Namen: die Namen
  expect(await run($, 'p')).toContain('Noch keine gespeicherten Prompts')
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  expect(await run($, 'p')).toContain('gespeichert: `tidy-chats`')
  await run($, 'sidekick', 'forget tidy-chats')
  await flush()
  expect(w.submitted).toEqual([])
})

deTest('/<name>: $.prompt.submit mit asUser, Bestätigung; Stufe Aus → nichts; abgelehnt → Toast', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  expect(await run($, 'p', 'tidy-chats')).toBe('/p tidy-chats gesendet')
  await w.clock.advance(200)
  await flush()
  expect(w.submitted).toEqual([{ text: TIDY, origin: { kind: 'plugin', name: 'sidekick', asUser: true } }])
  expect(today(w.ledger()).prompts.gesendet).toBe(1)
  // Stufe Aus
  await run($, 'sidekick', 'off')
  expect(await run($, 'p', 'tidy-chats')).toContain('sidekick ist aus')
  await flush()
  expect(w.submitted.length).toBe(1)
})

deTest('/<name>: abgelehnter Submit → Toast mit Grund', async ($, on) => {
  const w = world(on, { submitDrop: 'Grenze erreicht' })
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  await run($, 'p', 'tidy-chats')
  await w.clock.advance(200)
  await flush()
  expect(w.toasts.some((x) => x.includes('/p tidy-chats nicht gesendet: Grenze erreicht'))).toBe(true)
})

deTest('Fremde Befehle bleiben unberührt; /p meldet sich mit den Namen im Hinweis an', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  expect(await run($, 'review', 'x')).toBe('core review')
  expect(w.passed).toEqual(['review'])
  expect(await run($, 'savings')).toContain('Kosten')
  expect(await run($, 'sidekick', 'status')).toContain('Stufe')
  expect(w.passed).toEqual(['review'])
  expect(w.registered).toEqual(expect.arrayContaining(['sidekick', 'savings', 'p']))
  expect(w.hints.get('p')).toBe('<tidy-chats>')
  await run($, 'sidekick', 'forget tidy-chats')
  expect(w.hints.get('p')).toBe('<name>')
})

deTest('session.start: gespeicherte Prompts aus dem Store werden angemeldet, Knöpfe geschrieben', async ($, on) => {
  const w = world(on)
  w.store.set('prompts:saved', [
    { name: 'tidy-chats', text: TIDY, button: true, at: 1, from: 'auto' },
    { name: 'nur-befehl', text: 'Mach etwas Bestimmtes mit allen offenen Punkten.', button: false, at: 2, from: 'manual' },
  ])
  await start($)
  expect(w.registered).toEqual(expect.arrayContaining(['sidekick', 'savings', 'p']))
  expect(w.stateVals.get('prompts')).toEqual({ buttons: ['tidy-chats'] })
  expect(await run($, 'p', 'nur-befehl')).toBe('/p nur-befehl gesendet')
})

async function footer($: Engine, surface: 'desktop' | 'terminal') {
  return $.ui.mount({ plugin: 'sidekick', component: 'SessionMode', requestId: `mode-${surface}`, surface, props: { modes: [] } } as never)
}

deTest('Knöpfe: im Desktop links vor dem ●-Label, key je Knopf, höchstens 4; im Terminal keine', async ($, on) => {
  const w = world(on)
  await start($)
  for (let i = 0; i < 6; i++) await run($, 'sidekick', `save p${i} Text ${i} für den Knopf`)
  const ui = await footer($, 'desktop')
  const row = await ui.find({ key: 'sidekick-prompts' })
  const json = JSON.stringify(row)
  for (let i = 0; i < 4; i++) expect(json).toContain(`sidekick-p-p${i}`)
  expect(json).not.toContain('sidekick-p-p4')
  // Reihenfolge: die Knöpfe links, dann das Label (Stand 0.21.3)
  const all = JSON.stringify(await ui.find({ type: 'Box' }))
  expect(all.indexOf('sidekick-prompts')).toBeLessThan(all.indexOf('sidekick-mode'))
  await ui.unmount()
  const term = await footer($, 'terminal')
  expect(await term.find({ key: 'sidekick-prompts' })).toBeUndefined()
  await term.unmount()
  // Stufe Aus: keine Knöpfe
  await run($, 'sidekick', 'off')
  await run($, 'sidekick', 'status')
  const off = await footer($, 'desktop')
  expect(await off.find({ key: 'sidekick-prompts' })).toBeUndefined()
  await off.unmount()
})

deTest('Knopf: Klick sendet mit asUser; zwei Klicks vor dem Senden senden einmal; während einer Antwort Toast „danach“', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  const ui = await footer($, 'desktop')
  w.holdSubmit()
  await ui.press({ key: 'sidekick-p-tidy-chats' })
  await ui.press({ key: 'sidekick-p-tidy-chats' })
  await flush()
  expect(w.toasts.some((x) => x.includes('/p tidy-chats ist schon unterwegs'))).toBe(true)
  w.releaseSubmit()
  await flush()
  expect(w.submitted.map((s) => s.text)).toEqual([TIDY])
  // während einer Antwort: der Toast sagt „danach“, gesendet wird trotzdem (die Engine reiht ein)
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 } as never)
  let r = await s.next()
  while (r.done !== true) r = await s.next()
  await ui.press({ key: 'sidekick-p-tidy-chats' })
  await flush()
  expect(w.toasts.some((x) => x.includes('/p tidy-chats kommt nach der aktuellen Antwort'))).toBe(true)
  expect(w.submitted.length).toBe(2)
  await ui.unmount()
})

deTest('Knöpfe zeichnen nur bei Änderung der Liste neu: sidekick.prompts wird nur bei Änderung geschrieben', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  const n = w.stateSets.filter((x) => x.key === 'prompts').length
  // Liste, Detail und Senden ändern nichts an den Knöpfen
  await run($, 'sidekick', 'prompts')
  await run($, 'sidekick', 'prompts tidy-chats')
  await run($, 'p', 'tidy-chats')
  await flush()
  expect(w.stateSets.filter((x) => x.key === 'prompts').length).toBe(n)
  await run($, 'sidekick', 'prompts tidy-chats off')
  expect(w.stateSets.filter((x) => x.key === 'prompts').length).toBe(n + 1)
})

test('Englisch: /sidekick save und Senden', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  world(on)
  await start($)
  expect(await run($, 'sidekick', `save tidy-chats ${TIDY}`)).toContain('✓ Saved as /p tidy-chats. With a button.')
  expect(await run($, 'p', 'tidy-chats')).toBe('/p tidy-chats sent')
  expect(await run($, 'sidekick', 'prompts')).toContain('**Saved prompts** · 1 of 12')
})

deTest('/sidekick prompts gezeichnet: je Zeile Senden, Knopf an/aus, Löschen; andere Oberflächen Markdown', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  const text = await run($, 'sidekick', 'prompts')
  const mount = (surface: string) => $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', requestId: `out-${surface}`, surface, props: { command: 'sidekick', args: 'prompts', text, isErrored: false } } as never)
  const ui = await mount('desktop')
  expect(await ui.find({ key: 'sidekick-pr-send-tidy-chats' })).toBeDefined()
  expect(await ui.find({ key: 'sidekick-pr-del-tidy-chats' })).toBeDefined()
  await ui.press({ key: 'sidekick-pr-btn-tidy-chats' })
  await flush()
  expect(w.saved()[0]!.button).toBe(false)
  await ui.press({ key: 'sidekick-pr-send-tidy-chats' })
  await flush()
  expect(w.submitted.map((s) => s.text)).toEqual([TIDY])
  await ui.press({ key: 'sidekick-pr-del-tidy-chats' })
  await flush()
  expect(w.saved()).toEqual([])
  await ui.unmount()
  const plain = await mount('vscode')
  expect(JSON.stringify(await plain.find({ type: 'Text' }))).toContain('Gespeicherte Prompts')
  expect(await plain.find({ key: 'sidekick-pr-send-tidy-chats' })).toBeUndefined()
  await plain.unmount()
})

deTest('/<name> zweimal vor dem Senden: nur einmal gesendet', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  expect(await run($, 'p', 'tidy-chats')).toBe('/p tidy-chats gesendet')
  expect(await run($, 'p', 'tidy-chats')).toBe('/p tidy-chats ist schon unterwegs')
  await w.clock.advance(200)
  await flush()
  expect(w.submitted.length).toBe(1)
})

// ---------- Erkennung (Variante B: Absicht je Nachricht) ----------

const Z1 = 'Du sollst mir einmal sagen, welche Chats ich hier entfernen kann, es sind einfach viel zu viele geworden.'
const Z2 = 'Und eine klare Auflistung einmal: Welche Chats behalten wir, welche archivieren wir, welche benennen wir um?'
const Z3 = 'Kannst du die Chats unter dir nach Zweck sortieren und die archivieren, die du nicht mehr brauchst? Sofort.'
const PROPOSAL = JSON.stringify({ same: true, name: 'tidy-chats', text: 'Sortiere die Chats unter dir nach ihrem Zweck, benenne sie klar und archiviere die, die nicht mehr gebraucht werden.' })
const userPrompt = (text: string, kind: 'composer' | 'sdk' | 'plugin' = 'composer') => ({ text, wait: false, origin: kind === 'plugin' ? { kind, name: 'x' } : { kind } }) as never
async function mountMsg($: Engine, text: string, requestId: string) {
  return $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId, surface: 'desktop', props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)
}
/** Drei Chats, je eine Fassung; die dritte wird gezeichnet, bevor die Erkennung fertig ist. */
async function threeChats($: Engine, w: ReturnType<typeof world>) {
  w.setIntent(() => 'Chats aufräumen')
  w.setProposal(PROPOSAL)
  await start($)
  for (const [i, z] of [Z1, Z2].entries()) {
    w.setSid(`s${i + 1}`)
    await $.prompt.submit(userPrompt(z))
    await flush()
  }
  w.setSid('s3')
  await $.prompt.submit(userPrompt(Z3))
  const ui = await mountMsg($, Z3, 'm3')
  await flush()
  return ui
}

deTest('Erkennung: gleiche Absicht in 3 Chats → ein Vorschlag, Angebot unter der dritten Nachricht; Speichern legt Prompt und Befehl an', async ($, on) => {
  const w = world(on)
  const ui = await threeChats($, w)
  expect(w.calls.filter((c) => c.kind === 'intent').length).toBe(3)
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
  const p = w.calls.find((c) => c.kind === 'propose')!.prompt
  for (const z of [Z1, Z2, Z3]) expect(p).toContain(z)
  // Die zweite Absicht-Anfrage kennt die erste
  expect(w.calls.filter((c) => c.kind === 'intent')[1]!.prompt).toContain('- Chats aufräumen')
  const line = JSON.stringify(await ui.find({ key: 'sidekick-line' }))
  expect(line).toContain('Das schickst du öfter. Als /p tidy-chats speichern?')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-offer-text' }))).toContain('Sortiere die Chats unter dir')
  await ui.press({ key: 'sidekick-offer-save' })
  await flush()
  expect(w.saved()).toEqual([expect.objectContaining({ name: 'tidy-chats', from: 'auto', button: true })])
  expect(w.registered).toContain('p')
  expect(w.toasts).toContain('Gespeichert als /p tidy-chats. Ansehen und ändern: /sidekick prompts')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('gespeichert als /p tidy-chats')
  await ui.unmount()
  // gesehen: dieselbe Gruppe löst keinen Vorschlag mehr aus
  expect(cleanSeen(w.store.get('prompts:seen')).flat().length).toBe(3)
  w.setSid('s4')
  await $.prompt.submit(userPrompt(`${Z3} Danke dir.`))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
  const d = today(w.ledger('s3'))
  expect(d.prompts.angeboten).toBe(1)
  expect(d.prompts.gespeichert).toBe(1)
  expect((d.modelle['claude-haiku-5-5']?.prompts.n ?? 0) > 0).toBe(true)
})

deTest('Erkennung: Nein merkt die Gruppe als abgelehnt; kein neuer Vorschlag', async ($, on) => {
  const w = world(on)
  const ui = await threeChats($, w)
  await ui.press({ key: 'sidekick-offer-no' })
  await flush()
  expect(w.saved()).toEqual([])
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('nicht gespeichert')
  await ui.unmount()
  expect(today(w.ledger('s3')).prompts.abgelehnt).toBe(1)
  w.setSid('s5')
  await $.prompt.submit(userPrompt(Z1))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
})

deTest('Erkennung: dieselbe Session → kein Vorschlag; same false → kein Angebot, Gruppe gesehen; einmalig → nicht gemerkt', async ($, on) => {
  const w = world(on)
  w.setIntent(() => 'Chats aufräumen')
  await start($)
  for (const z of [Z1, Z2, Z3]) await $.prompt.submit(userPrompt(z))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(0)
  for (const [i, z] of [Z1, Z2].entries()) {
    w.setSid(`t${i}`)
    await $.prompt.submit(userPrompt(z))
    await flush()
  }
  // jetzt 3 Sessions: Vorschlag, aber same false
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
  expect(cleanSeen(w.store.get('prompts:seen')).length).toBe(1)
  // einmalig: kein Eintrag
  w.setIntent(() => 'einmalig')
  const before = (w.store.get('prompts:recent') as unknown[]).length
  await $.prompt.submit(userPrompt('Die Seite Themen im Leitstand lädt gerade nicht, bitte behebe den Fehler dort.'))
  await flush()
  expect((w.store.get('prompts:recent') as unknown[]).length).toBe(before)
})

deTest('Erkennung: Tagesgrenze 5 Vorschläge; Grenze der Absicht-Aufrufe; ungültiges JSON → kein Angebot', async ($, on) => {
  const w = world(on)
  w.store.set('prompts:budget', { day: dayKey(NOW), n: 5 })
  await threeChats($, w)
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(0)
  // am nächsten Tag wieder, aber kaputte Antwort
  await w.clock.advance(DAY)
  w.setProposal('kein json')
  w.setSid('s9')
  await $.prompt.submit(userPrompt(Z1))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
  expect(w.toasts).toEqual([])
  w.store.set('prompts:budget-intent', { day: dayKey(NOW + DAY), n: 80 })
  const n = w.calls.filter((c) => c.kind === 'intent').length
  w.setSid('s10')
  await $.prompt.submit(userPrompt(Z2))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'intent').length).toBe(n)
})

deTest('Erkennung läuft nicht: Stufe Cache, Plugin-Nachricht, Slash-Befehl, kurze Nachricht, sdk ohne Desktop', { level: 'cache' }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(userPrompt(Z1))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'intent').length).toBe(0)
  await run($, 'sidekick', 'guide')
  await $.prompt.submit(userPrompt(Z1, 'plugin'))
  await $.prompt.submit(userPrompt(`/sidekick save x ${Z1}`))
  await $.prompt.submit(userPrompt('ja, mach weiter'))
  await $.prompt.submit(userPrompt(Z1, 'sdk'))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'intent').length).toBe(0)
})

deTest('Erkennung in -p: keine Oberfläche, nichts', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await start($)
  await $.prompt.submit(userPrompt(Z1, 'sdk'))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'intent').length).toBe(0)
})

deTest('Erkennung hält das Senden nie auf: ein Fehler im Modell wird verschluckt', async ($, on) => {
  const w = world(on)
  w.setIntent(() => {
    throw new Error('kaputt')
  })
  await start($)
  const r = await $.prompt.submit(userPrompt(Z1))
  expect((r as { text?: string }).text).toBe(Z1)
  await flush()
  expect(w.submitted.map((s) => s.text)).toContain(Z1)
})

deTest('Angebot wartet auf die nächste eigene Nachricht, wenn die eigene nicht gezeichnet ist; belegter Name → -2', async ($, on) => {
  const w = world(on)
  w.setIntent(() => 'Chats aufräumen')
  w.setProposal(PROPOSAL)
  await start($)
  // ein eigener Prompt heißt schon so (anderer Text): Vorschlag -2
  await run($, 'sidekick', 'save tidy-chats Prüfe alle offenen Pull Requests und fasse den Stand kurz zusammen.')
  for (const [i, z] of [Z1, Z2, Z3].entries()) {
    w.setSid(`s${i + 1}`)
    await $.prompt.submit(userPrompt(z))
    await flush()
  }
  // Z3 nie gezeichnet (z. B. Rückfrage, nicht gesendet): unter der nächsten eigenen Nachricht
  const NEXT = 'Und danach bitte noch die offenen Punkte aus der Liste von gestern abarbeiten, ja?'
  await $.prompt.submit(userPrompt(NEXT))
  const ui = await mountMsg($, NEXT, 'm4')
  await flush()
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('Als /p tidy-chats-2 speichern?')
  await ui.unmount()
})

deTest('/<name> in -p (keine Oberfläche): sagt es, sendet nichts', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  expect(await run($, 'p', 'tidy-chats')).toContain('geht nur in einer laufenden Session')
  await w.clock.advance(200)
  await flush()
  expect(w.submitted).toEqual([])
})

deTest('/clear leert sidekick.prompts (en/interface.md:841): die Fußzeile zeigt die Knöpfe aus dem Speicher; Terminal-Baum der Liste', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  w.stateVals.delete('prompts')
  const ui = await footer($, 'desktop')
  expect(await ui.find({ key: 'sidekick-p-tidy-chats' })).toBeDefined()
  await ui.unmount()
  const text = await run($, 'sidekick', 'prompts')
  const term = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', requestId: 'out-t', surface: 'terminal', viewport: { columns: 60, rows: 30 }, props: { command: 'sidekick', args: 'prompts', text, isErrored: false } } as never)
  expect(await term.find({ key: 'sidekick-pr-send-tidy-chats' })).toBeDefined()
  await term.unmount()
})

for (const surface of ['terminal', 'vscode'] as const)
  deTest(`Angebot auf ${surface}: ${surface === 'terminal' ? 'Knöpfe Speichern und Nein' : 'als Text mit /sidekick save'} (Review 0.21.0 S1)`, async ($, on) => {
    const w = world(on)
    w.setIntent(() => 'Chats aufräumen')
    w.setProposal(PROPOSAL)
    await start($)
    for (const [i, z] of [Z1, Z2].entries()) {
      w.setSid(`s${i + 1}`)
      await $.prompt.submit(userPrompt(z))
      await flush()
    }
    w.setSid('s3')
    await $.prompt.submit(userPrompt(Z3))
    const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'm3', surface, props: { text: Z3, origin: { kind: 'composer' }, isExpanded: true } } as never)
    await flush()
    if (surface === 'terminal') {
      expect(await ui.find({ key: 'sidekick-offer-save' })).toBeDefined()
      expect(await ui.find({ key: 'sidekick-offer-no' })).toBeDefined()
      await ui.press({ key: 'sidekick-offer-save' })
      await flush()
      expect(w.saved().map((s) => s.name)).toEqual(['tidy-chats'])
    } else {
      const all = JSON.stringify(await ui.find({ type: 'Text' }))
      expect(all).toContain('Das schickst du öfter. Als /p tidy-chats speichern?')
      expect(all).toContain('/sidekick save tidy-chats Sortiere die Chats unter dir')
      expect(await ui.find({ key: 'sidekick-offer-save' })).toBeUndefined()
    }
    await ui.unmount()
  })

deTest('/p von einem anderen Plugin ($.command.run): sendet nicht als Fynns Worte (Review 0.21.0 K3)', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'sidekick', `save tidy-chats ${TIDY}`)
  expect(await run($, 'p', 'tidy-chats', { kind: 'plugin', name: 'other' })).toContain('nur, wenn du es selbst tippst')
  await w.clock.advance(200)
  await flush()
  expect(w.submitted).toEqual([])
})

deTest('Hilfe: kein Text nennt noch einen eigenen Befehl /<name> (Review 0.21.0 S1)', () => {
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    const h = sidekickHelp({ settings: { ...DEFAULT_SETTINGS }, ttl: { min: 60, source: 'default' }, hints: { on: true, off: [] }, known: 0, now: NOW, prompts: { n: 0, buttons: 0 } })
    const all = JSON.stringify(h)
    expect(all.replace(/\/p <name>/g, '').includes('/<name>'), lang).toBe(false)
    expect(all).toContain('/p <name>')
  }
  setLang('de')
})
