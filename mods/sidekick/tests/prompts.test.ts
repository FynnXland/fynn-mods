// Tests zur Erkennung wiederholter Prompts (Nachtrag 0.21.0) und zur Abgabe an prompt-deck (Ausbau 0.29.0): Angebot nur mit
// `prompt-deck.saved`, Speichern über `/deck save`, Umzug von `prompts:saved`, Verweise der alten Unterbefehle. Eigene Welt mit Stubs.
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { MIN, dayKey } from '../hooks/cache.js'
import { cliStubs } from './cli.js'
import { SETTINGS } from '../hooks/fields.js'
import { DEFAULT_SETTINGS, addDay, bookPrompts, cleanLedger, countPrompt, emptyDay, savingsReport } from '../hooks/logic.js'
import type { Ledger } from '../hooks/logic.js'
import { T, setLang } from '../hooks/i18n.js'
import { savingsTree } from '../hooks/view.js'
import { sidekickHelp } from '../hooks/helpdata.js'
import {
  JACCARD,
  MIN_CHARS,
  RECENT_DAYS,
  RECENT_MAX,
  addRecent,
  addSeen,
  budgetLeft,
  candidates,
  checkName,
  cleanBudget,
  cleanDeckSaved,
  cleanRecent,
  cleanSaved,
  cleanSeen,
  deckAnswer,
  deckLaterAt,
  freeName,
  jaccard,
  migrateArgs,
  movedTarget,
  nearSaved,
  parseProposal,
  proposePrompt,
  proposeSystem,
  recentOf,
  remembers,
  seenSet,
  useBudget,
  wordSet,
} from '../hooks/prompts.js'
import type { DeckItem, Saved } from '../hooks/prompts.js'

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
  expect(remembers(`/deck save x ${TIDY}`, 'composer')).toBe(false)
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
  const same = [recentOf(TIDY, 's3', NOW - 2), recentOf(`Bitte ${TIDY}`, 's3', NOW - 1)]
  expect(candidates(same, c)).toBe(null)
  expect(candidates([a, recentOf(`Bitte ${TIDY}`, 's1', NOW - 1)], c)).toBe(null)
  const other = [recentOf('Baue im Spiel eine neue Waffe mit Rückstoß und Nachladezeit ein, bitte mit Test.', 's1', NOW - 1), recentOf('Prüfe die Rechnung vom Oktober und trage die Beträge in die Tabelle ein, danke.', 's2', NOW - 1)]
  expect(candidates(other, c)).toBe(null)
  expect(candidates([a, b], c, new Set([a.id]))).toBe(null)
  const more = Array.from({ length: 6 }, (_, i) => recentOf(TIDY, `x${i}`, NOW - 10 - i))
  expect(candidates(more, c)?.length).toBe(4)
  expect(JACCARD).toBe(0.25)
})

deTest('Gesehene Gruppen, Tagesgrenze 5, Nähe zu gespeicherten (Wortmengen aus prompt-deck.saved)', () => {
  const s = addSeen(cleanSeen([['a', 'b']]), ['c'])
  expect(seenSet(s)).toEqual(new Set(['a', 'b', 'c']))
  expect(cleanSeen(Array.from({ length: 120 }, (_, i) => [`g${i}`])).length).toBe(100)
  const day = dayKey(NOW)
  let b = cleanBudget(undefined)
  expect(budgetLeft(b, day)).toBe(5)
  for (let i = 0; i < 5; i++) b = useBudget(b, day)
  expect(budgetLeft(b, day)).toBe(0)
  expect(budgetLeft(b, dayKey(NOW + DAY))).toBe(5)
  expect(nearSaved([{ name: 'tidy-chats', words: wordSet(TIDY) }], wordSet(`Bitte ${TIDY}`))).toBe(true)
  expect(nearSaved([{ name: 'x', words: ['ganz', 'anders'] }], wordSet(TIDY))).toBe(false)
  expect(nearSaved([], wordSet(TIDY))).toBe(false)
})

deTest('Namen: gültig, ungültig, schon gespeichert → Vorschlag -2; andere Befehle stören nicht (/p <name>)', () => {
  expect(checkName('tidy-chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('/Tidy Chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('clear', [], false)).toEqual({ ok: true, name: 'clear' })
  expect(checkName('/p tidy-chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('tidy-chats', ['tidy-chats'], false)).toMatchObject({ ok: false, why: 'own', suggest: 'tidy-chats-2' })
  expect(checkName('a'.repeat(25), [], false)).toMatchObject({ ok: false, why: 'invalid' })
  expect(checkName('ä-ö', [], false)).toMatchObject({ ok: false, why: 'invalid' })
  expect(freeName('clear', new Set(['clear', 'clear-2']))).toBe('clear-3')
  expect(freeName('a'.repeat(24), new Set()).length).toBeLessThanOrEqual(24)
})

deTest('0.29.0 Absprachen: prompt-deck.saved und .later tolerant gelesen, Antwort von /deck save, Umzugs-Argumente, Verweise', () => {
  expect(cleanDeckSaved(undefined)).toBe(null)
  expect(cleanDeckSaved(null)).toBe(null)
  expect(cleanDeckSaved({ items: 'x' })).toBe(null)
  expect(cleanDeckSaved({ items: [] })).toEqual([])
  expect(cleanDeckSaved({ items: [{ name: 'a', words: ['eins', 3] }, { name: '' }, null, { name: 'b' }] })).toEqual([
    { name: 'a', words: ['eins'] },
    { name: 'b', words: [] },
  ])
  expect(deckLaterAt({ armed: true, at: 5 })).toBe(5)
  for (const v of [null, undefined, { at: 5 }, { armed: true }, { armed: 'ja', at: 5 }]) expect(deckLaterAt(v)).toBe(null)
  expect(deckAnswer('saved tidy-chats\nGespeichert.')).toEqual({ kind: 'saved', name: 'tidy-chats', human: 'Gespeichert.' })
  expect(deckAnswer('saved x-2')).toEqual({ kind: 'saved', name: 'x-2', human: '' })
  expect(deckAnswer('full\nSchon 12.')).toEqual({ kind: 'full', why: 'full', human: 'Schon 12.' })
  expect(deckAnswer('refused invalid-name\nGeht nicht.')).toEqual({ kind: 'refused', why: 'invalid-name', human: 'Geht nicht.' })
  expect(deckAnswer(undefined)).toEqual({ kind: 'other', why: '', human: '' })
  expect(deckAnswer('core deck')).toMatchObject({ kind: 'other', why: 'core deck' })
  const sv = (name: string, button: boolean, from: 'auto' | 'manual'): Saved => ({ name, text: 'Zeile eins\nZeile zwei', button, at: 1, from })
  expect(migrateArgs(sv('a', true, 'auto'))).toBe('a Zeile eins\nZeile zwei')
  expect(migrateArgs(sv('b', false, 'auto'))).toBe('--off b Zeile eins\nZeile zwei')
  expect(migrateArgs(sv('c', true, 'manual'))).toBe('--manual c Zeile eins\nZeile zwei')
  expect(migrateArgs(sv('d', false, 'manual'))).toBe('--off --manual d Zeile eins\nZeile zwei')
  expect(cleanSaved([{ name: 'ok-1', text: 'x' }, { name: 'Bad Name', text: 'x' }])).toEqual([{ name: 'ok-1', text: 'x', button: true, at: 0, from: 'manual' }])
  expect(['save', 'prompts', 'forget', 'buttons', 'PROMPTS'].map(movedTarget)).toEqual(['/deck save', '/deck list', '/deck forget', '/deck buttons', '/deck list'])
  expect(movedTarget('tips')).toBe(null)
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
  expect(md).toContain('2× gesendet')
  expect(JSON.stringify(savingsTree(d, 'all', NOW, 100, 'terminal'))).toContain('Prompts: 3 Prüfungen')
  expect(savingsReport(emptyDay(), 'all', NOW)).not.toContain('Prompts')
})

deTest('0.29.0 Hilfe: keine Befehle der Knöpfe mehr (save, prompts, forget, buttons, /p), Verweis-Zeile auf prompt-deck; Felder weg', () => {
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    for (const deck of [true, false]) {
      const h = sidekickHelp({ settings: { ...DEFAULT_SETTINGS }, ttl: { min: 60, source: 'default' }, hints: { on: true, off: [] }, known: 0, now: NOW, deck })
      const cmds = h.commands.map((c) => c.cmd)
      for (const c of cmds) expect(/^\/sidekick (save|prompts|forget|buttons)\b|^\/p\b/.test(c), c).toBe(false)
      const note = h.notes?.find((n) => n.includes('prompt-deck')) ?? ''
      expect(note).toContain(deck ? '/deck help' : 'claude plugin install prompt-deck@fynn-mods')
      expect(JSON.stringify(h.settings)).not.toMatch(/Danach-Knopf|Later button|Prompt-Knöpfe|Prompt buttons/)
    }
  }
  setLang('de')
  expect(Object.keys(SETTINGS)).not.toContain('laterButton')
  expect(Object.keys(SETTINGS)).not.toContain('promptButtons')
  expect(Object.keys(T.en.pr).sort()).toEqual(Object.keys(T.de.pr).sort())
})

// ---------- Hooks ----------

type DeckCall = { args: string; origin: unknown }

/**
 * Stufe und Schalter kommen seit 0.23.0 als userConfig (Test-Optionen). prompt-deck ist ein Stub: `deck` meldet `/deck` in
 * `command.list` an, `deckSaved` ist `prompt-deck.saved` (null = kein Wert), `/deck save` speichert Namen in diesen Wert und antwortet
 * wie prompt-deck (`saved <name>`, belegter Name → `-2`); `setDeckReply` ersetzt die Antwort.
 */
function world(on: On, o: { deck?: boolean; deckSaved?: DeckItem[] | null; cmds?: { name: string; source: string; plugin?: string }[]; surfaces?: string[] } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  const cli = cliStubs(on)
  const toasts: string[] = []
  const registered: string[] = []
  const passed: string[] = []
  const stateVals = new Map<string, unknown>()
  const deck = { on: o.deck !== false, saved: o.deckSaved === undefined ? ([] as DeckItem[]) : o.deckSaved }
  const deckCalls: DeckCall[] = []
  let deckReply: ((args: string) => string | undefined) | null = null
  let msgs: unknown[] = [{ role: 'assistant', text: 'vorher', toolUses: [] }]
  on('session.start', () => ({ cwd: '/work' }) as never)
  let sid = 'sess-1'
  let intentOf: (text: string) => string = () => 'einmalig'
  let proposal: string = '{"same": false}'
  const calls: { kind: 'intent' | 'propose' | 'check'; prompt: string }[] = []
  on('session.id', () => ({ value: sid }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 20000, window: 1000000 }, rateLimits: [] } as never }))
  on('session.root', () => ({ value: 'C:\\Proj' }))
  on('session.messages', () => ({ value: msgs as never }))
  on('command.list', () => ({
    value: [
      { name: 'clear', description: '', source: 'builtin' },
      ...(deck.on ? [{ name: 'deck', description: '', source: 'plugin', plugin: 'prompt-deck' }] : []),
      ...(o.cmds ?? []),
      ...registered.map((n) => ({ name: n, description: '', source: 'plugin', plugin: 'sidekick' })),
    ] as never,
  }))
  on('command.register', ($, e) => {
    if (!registered.includes(e.name)) registered.push(e.name)
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
  on('state.get', ($: unknown, e: any) => {
    if (e.plugin === 'prompt-deck') return { value: { value: e.key === 'saved' && deck.saved ? { items: deck.saved } : undefined, version: 1 } }
    return { value: { value: e.plugin === 'sidekick' ? stateVals.get(e.key) : undefined, version: 1 } }
  })
  on('state.set', ($: unknown, e: any) => {
    if (e.plugin === 'sidekick') stateVals.set(e.key, e.value)
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
  // Fremde Befehle: kommt der Lauf hier an, hat sidekick ihn durchgereicht. `deck` antwortet wie prompt-deck (Verhalten 5)
  on('command.run', ($, e) => {
    if (e.command === 'deck' && deck.on) {
      deckCalls.push({ args: e.args, origin: e.origin })
      const own = deckReply?.(e.args)
      if (own !== undefined) return { text: own }
      const m = /^save\s+((?:--off\s+|--manual\s+)*)(\S+)\s+([\s\S]+)$/.exec(e.args)
      if (!m) return { text: 'refused no-text\nKein Text.' }
      const list = deck.saved ?? []
      const name = list.some((s) => s.name === m[2]) ? `${m[2]}-2` : m[2]!
      deck.saved = [...list, { name, words: wordSet(m[3]!) }]
      return { text: `saved ${name}\nGespeichert als /p ${name}.` }
    }
    passed.push(e.command)
    return { text: `core ${e.command}` }
  })
  on('prompt.submit', async ($, e) => ({ text: e.text }))
  on('ui.render', ($, e) => {
    if (e.component === 'SessionMode') return { type: 'Text', props: {}, children: [((e.props as { modes?: string[] }).modes ?? []).join(' & ')] }
    return { type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model } }
  })
  return {
    clock,
    store,
    toasts,
    registered,
    passed,
    stateVals,
    deck,
    deckCalls,
    setDeckReply: (f: ((args: string) => string | undefined) | null) => (deckReply = f),
    setMessages: (m: unknown[]) => (msgs = m),
    ledger: (id = 'sess-1') => cleanLedger(store.get(`bilanz:${id}`)),
    calls,
    setSid: (x: string) => (sid = x),
    setIntent: (f: (text: string) => string) => (intentOf = f),
    setProposal: (x: string) => (proposal = x),
    cli,
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
/** Start und der Timer des Umzugs (MOVE_DELAY_MS = 1500) samt allen `/deck save` nacheinander. */
async function startAndMove($: Engine, w: ReturnType<typeof world>) {
  await start($)
  await w.clock.advance(1600)
  await flush(2000)
}
/** Nach einem Klick: der Timer vor `/deck save` (`later`, 100 ms) und die Antwort. */
async function afterPress(w: ReturnType<typeof world>) {
  await flush()
  await w.clock.advance(200)
  await flush()
}

deTest('0.29.0 /p und die Knöpfe gehören prompt-deck: sidekick meldet /p nicht an, /p läuft durch, keine Knopfzeile im Band', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(expect.arrayContaining(['sidekick', 'savings', 'handoff']))
  expect(w.registered).not.toContain('p')
  expect(await run($, 'p', 'tidy-chats')).toBe('core p')
  expect(w.passed).toEqual(['p'])
  expect(w.stateVals.has('prompts')).toBe(false)
  const band = await $.ui.mount({ plugin: 'sidekick', component: 'AbovePrompt', requestId: 'b', surface: 'desktop', props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as never)
  const json = JSON.stringify(await band.drawn())
  expect(json).not.toContain('sidekick-prompts')
  expect(json).not.toContain('sidekick-p-')
  await band.unmount()
})

for (const verb of ['save', 'prompts', 'forget', 'buttons'] as const)
  deTest(`0.29.0 /sidekick ${verb}: Verweis auf prompt-deck; ohne prompt-deck die Installation`, async ($, on) => {
    const target = { save: '/deck save', prompts: '/deck list', forget: '/deck forget', buttons: '/deck buttons' }[verb]
    const w = world(on)
    await start($)
    for (const args of [verb, `${verb} tidy-chats Sortiere die Chats`]) expect(await run($, 'sidekick', args)).toBe(`\`/sidekick ${verb}\` ist in prompt-deck umgezogen: \`${target}\`.`)
    w.deck.on = false
    const out = await run($, 'sidekick', verb)
    expect(out).toContain(`\`${target}\``)
    expect(out).toContain('`claude plugin install prompt-deck@fynn-mods`')
    expect(w.deckCalls).toEqual([])
    expect(w.store.has('prompts:saved')).toBe(false)
  })

test('0.29.0 English: /sidekick save and buttons point to prompt-deck', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  const w = world(on)
  await start($)
  expect(await run($, 'sidekick', 'save x')).toBe('`/sidekick save` moved to `/deck save` in prompt-deck.')
  expect(await run($, 'sidekick', 'buttons')).toBe('`/sidekick buttons` moved to `/deck buttons` in prompt-deck.')
  w.deck.on = false
  expect(await run($, 'sidekick', 'prompts')).toContain('Install it: `claude plugin install prompt-deck@fynn-mods`')
})

// ---------- Umzug (Verhalten 6) ----------

const OLD: Saved[] = [
  { name: 'tidy-chats', text: TIDY, button: true, at: 1, from: 'auto' },
  { name: 'nur-befehl', text: 'Mach etwas Bestimmtes mit allen offenen Punkten.', button: false, at: 2, from: 'auto' },
  { name: 'review', text: 'Prüfe alle offenen Pull Requests\nund fasse den Stand zusammen.', button: true, at: 3, from: 'manual' },
]

deTest('0.29.0 Umzug: leer → nichts abgegeben, prompts:moved bleibt ungesetzt', async ($, on) => {
  const w = world(on)
  await startAndMove($, w)
  expect(w.deckCalls).toEqual([])
  expect(w.store.has('prompts:moved')).toBe(false)
})

deTest('0.29.0 Umzug: drei Einträge nacheinander (einer ohne Knopf, einer selbst gespeichert), origin sidekick; zweiter Start gibt nichts ab', async ($, on) => {
  const w = world(on)
  w.store.set('prompts:saved', OLD)
  await start($)
  // nicht im Hook selbst: erst der Timer gibt ab
  expect(w.deckCalls).toEqual([])
  await w.clock.advance(1600)
  await flush(2000)
  expect(w.deckCalls.map((c) => c.args)).toEqual([`save tidy-chats ${TIDY}`, 'save --off nur-befehl Mach etwas Bestimmtes mit allen offenen Punkten.', 'save --manual review Prüfe alle offenen Pull Requests\nund fasse den Stand zusammen.'])
  for (const c of w.deckCalls) expect(c.origin).toEqual({ kind: 'plugin', name: 'sidekick' })
  expect(w.store.get('prompts:moved')).toEqual({ at: NOW + 1500, n: 3 })
  // Sicherung bleibt
  expect(cleanSaved(w.store.get('prompts:saved')).length).toBe(3)
  expect(await run($, 'sidekick', 'status')).toContain('**Gespeicherte Prompts:** 3 nach prompt-deck umgezogen (')
  await startAndMove($, w)
  expect(w.deckCalls.length).toBe(3)
})

deTest('0.29.0 Umzug: einer scheitert → prompts:moved ungesetzt; der nächste Start gibt nur den fehlenden ab, dann gesetzt', async ($, on) => {
  const w = world(on)
  w.store.set('prompts:saved', OLD)
  w.setDeckReply((args) => (args.includes('nur-befehl') ? 'refused invalid-name\nGeht nicht.' : undefined))
  await startAndMove($, w)
  expect(w.deckCalls.length).toBe(3)
  expect(w.store.has('prompts:moved')).toBe(false)
  expect(w.deck.saved?.map((s) => s.name)).toEqual(['tidy-chats', 'review'])
  expect(await run($, 'sidekick', 'status')).toContain('**Gespeicherte Prompts:** 3 noch nicht nach prompt-deck umgezogen')
  w.setDeckReply(null)
  await startAndMove($, w)
  expect(w.deckCalls.slice(3).map((c) => c.args)).toEqual(['save --off nur-befehl Mach etwas Bestimmtes mit allen offenen Punkten.'])
  expect(w.store.get('prompts:moved')).toMatchObject({ n: 3 })
})

deTest('0.29.0 Umzug: vorhandene Namen in prompt-deck.saved werden übersprungen; Fehler beim Aufruf zählt als gescheitert', async ($, on) => {
  const w = world(on, { deckSaved: [{ name: 'tidy-chats', words: [] }] })
  w.store.set('prompts:saved', OLD)
  w.setDeckReply((args) => {
    if (args.includes('review')) throw new Error('weg')
    return undefined
  })
  await startAndMove($, w)
  expect(w.deckCalls.map((c) => c.args.split(' ')[1])).toEqual(['--off', '--manual'])
  expect(w.store.has('prompts:moved')).toBe(false)
})

deTest('0.29.0 Review K2: prompt-deck voll → Umzug endet, prompts:moved mit full; /sidekick status nennt es; nächster Start gibt nichts ab', async ($, on) => {
  const w = world(on)
  w.store.set('prompts:saved', OLD)
  w.setDeckReply((args) => (args.includes('nur-befehl') ? 'full\nSchon 12 gespeicherte Prompts.' : undefined))
  await startAndMove($, w)
  // nach full keine weiteren Aufrufe
  expect(w.deckCalls.map((c) => c.args.split(' ').slice(1, 3).join(' '))).toEqual([`tidy-chats ${TIDY.split(' ')[0]}`, '--off nur-befehl'])
  expect(w.store.get('prompts:moved')).toEqual({ at: NOW + 1500, n: 1, full: true })
  expect(await run($, 'sidekick', 'status')).toContain('**Gespeicherte Prompts:** 1 von 3 nach prompt-deck umgezogen (')
  expect(await run($, 'sidekick', 'status')).toContain('dann war prompt-deck voll')
  w.setDeckReply(null)
  await startAndMove($, w)
  expect(w.deckCalls.length).toBe(2)
})

deTest('0.29.0 Review K4: in -p (keine Oberfläche) kein Umzug', async ($, on) => {
  const w = world(on, { surfaces: [] })
  w.store.set('prompts:saved', OLD)
  await startAndMove($, w)
  expect(w.deckCalls).toEqual([])
  expect(w.store.has('prompts:moved')).toBe(false)
})

deTest('0.29.0 Umzug: ohne /deck oder ohne prompt-deck.saved kein Umzug', async ($, on) => {
  const w = world(on, { deck: false })
  w.store.set('prompts:saved', OLD)
  await startAndMove($, w)
  expect(w.deckCalls).toEqual([])
  expect(w.store.has('prompts:moved')).toBe(false)
  w.deck.on = true
  w.deck.saved = null
  await startAndMove($, w)
  expect(w.deckCalls).toEqual([])
  expect(w.store.has('prompts:moved')).toBe(false)
  w.deck.saved = []
  await startAndMove($, w)
  expect(w.deckCalls.length).toBe(3)
  expect(w.store.has('prompts:moved')).toBe(true)
})

// ---------- Erkennung (Variante B: Absicht je Nachricht) ----------

const Z1 = 'Du sollst mir einmal sagen, welche Chats ich hier entfernen kann, es sind einfach viel zu viele geworden.'
const Z2 = 'Und eine klare Auflistung einmal: Welche Chats behalten wir, welche archivieren wir, welche benennen wir um?'
const Z3 = 'Kannst du die Chats unter dir nach Zweck sortieren und die archivieren, die du nicht mehr brauchst? Sofort.'
const FASSUNG = 'Sortiere die Chats unter dir nach ihrem Zweck, benenne sie klar und archiviere die, die nicht mehr gebraucht werden.'
const PROPOSAL = JSON.stringify({ same: true, name: 'tidy-chats', text: FASSUNG })
const userPrompt = (text: string, kind: 'composer' | 'sdk' | 'plugin' = 'composer') => ({ text, wait: false, origin: kind === 'plugin' ? { kind, name: 'x' } : { kind } }) as never
async function mountMsg($: Engine, text: string, requestId: string, surface = 'desktop') {
  return $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId, surface, props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)
}
/** Drei Chats, je eine Fassung; die dritte wird gezeichnet, bevor die Erkennung fertig ist. */
async function threeChats($: Engine, w: ReturnType<typeof world>, surface = 'desktop') {
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
  const ui = await mountMsg($, Z3, 'm3', surface)
  await flush()
  return ui
}

deTest('Erkennung: gleiche Absicht in 3 Chats → Angebot; Speichern ruft /deck save <name> <text> (nach dem Klick, über den Timer), Zeile und Toast', async ($, on) => {
  const w = world(on)
  const ui = await threeChats($, w)
  expect(w.calls.filter((c) => c.kind === 'intent').length).toBe(3)
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
  const p = w.calls.find((c) => c.kind === 'propose')!.prompt
  for (const z of [Z1, Z2, Z3]) expect(p).toContain(z)
  expect(w.calls.filter((c) => c.kind === 'intent')[1]!.prompt).toContain('- Chats aufräumen')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('Das schickst du öfter. Als /p tidy-chats speichern?')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-offer-text' }))).toContain('Sortiere die Chats unter dir')
  await ui.press({ key: 'sidekick-offer-save' })
  await flush()
  // noch nichts abgegeben: erst der Timer
  expect(w.deckCalls).toEqual([])
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('…')
  await afterPress(w)
  expect(w.deckCalls).toEqual([{ args: `save tidy-chats ${FASSUNG}`, origin: { kind: 'plugin', name: 'sidekick' } }])
  expect(w.toasts).toContain('Gespeichert als /p tidy-chats in prompt-deck. Ansehen und ändern: /deck list')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('gespeichert als /p tidy-chats')
  expect(await ui.find({ key: 'sidekick-offer-save' })).toBeUndefined()
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

deTest('Speichern: prompt-deck vergibt einen anderen Namen (saved tidy-chats-2) → Zeile mit diesem Namen', async ($, on) => {
  const w = world(on)
  const ui = await threeChats($, w)
  w.setDeckReply(() => 'saved tidy-chats-2\nGespeichert als /p tidy-chats-2.')
  await ui.press({ key: 'sidekick-offer-save' })
  await afterPress(w)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('gespeichert als /p tidy-chats-2')
  expect(w.toasts).toContain('Gespeichert als /p tidy-chats-2 in prompt-deck. Ansehen und ändern: /deck list')
  await ui.unmount()
})

for (const [kind, reply, toast] of [
  ['full', 'full\nSchon 12 gespeicherte Prompts. Erst einen löschen: `/deck forget <name>`', 'Schon 12 gespeicherte Prompts. Erst einen löschen: `/deck forget <name>`'],
  ['refused', 'refused not-allowed\nprompt-deck nimmt das nicht an.', 'prompt-deck nimmt das nicht an.'],
  ['refused ohne Satz', 'refused invalid-name', 'Nicht gespeichert (prompt-deck: refused invalid-name). Das Angebot bleibt stehen.'],
  ['Fehler', 'THROW', 'Nicht gespeichert (prompt-deck: '],
] as const)
  deTest(`Speichern: ${kind} → Toast mit dem Satz von prompt-deck, Angebot bleibt offen, nichts gebucht, Gruppe nicht gesehen`, async ($, on) => {
    const w = world(on)
    const ui = await threeChats($, w)
    w.setDeckReply(() => {
      if (reply === 'THROW') throw new Error('kaputt')
      return reply
    })
    await ui.press({ key: 'sidekick-offer-save' })
    await afterPress(w)
    expect(w.toasts.some((x) => x.includes(toast)), w.toasts.join(' | ')).toBe(true)
    expect(await ui.find({ key: 'sidekick-offer-save' })).toBeDefined()
    expect(today(w.ledger('s3')).prompts.gespeichert).toBe(0)
    expect(cleanSeen(w.store.get('prompts:seen')).length).toBe(0)
    // zweiter Versuch gelingt
    w.setDeckReply(null)
    await ui.press({ key: 'sidekick-offer-save' })
    await afterPress(w)
    expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('gespeichert als /p tidy-chats')
    await ui.unmount()
  })

deTest('Erkennung ohne prompt-deck.saved (prompt-deck fehlt oder nach /clear): kein Vorschlags-Aufruf, kein Angebot, Gruppe nicht gesehen; später angeboten', async ($, on) => {
  const w = world(on, { deck: false, deckSaved: null })
  const ui = await threeChats($, w)
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(0)
  expect(await ui.find({ key: 'sidekick-offer-save' })).toBeUndefined()
  expect(cleanSeen(w.store.get('prompts:seen')).length).toBe(0)
  expect(today(w.ledger('s3')).prompts.angeboten).toBe(0)
  await ui.unmount()
  // prompt-deck kommt dazu: dieselbe Gruppe wird jetzt angeboten
  w.deck.on = true
  w.deck.saved = []
  w.setSid('s4')
  await $.prompt.submit(userPrompt(Z1))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
})

deTest('Erkennung: ähnelt einem Prompt in prompt-deck.saved → kein Vorschlag; belegter Name → Angebot mit -2', async ($, on) => {
  const w = world(on, { deckSaved: [{ name: 'tidy-chats', words: wordSet('Prüfe alle offenen Pull Requests und fasse den Stand kurz zusammen.') }] })
  w.setIntent(() => 'Chats aufräumen')
  w.setProposal(PROPOSAL)
  await start($)
  for (const [i, z] of [Z1, Z2, Z3].entries()) {
    w.setSid(`s${i + 1}`)
    await $.prompt.submit(userPrompt(z))
    await flush()
  }
  // Z3 nie gezeichnet: unter der nächsten eigenen Nachricht
  const NEXT = 'Und danach bitte noch die offenen Punkte aus der Liste von gestern abarbeiten, ja?'
  await $.prompt.submit(userPrompt(NEXT))
  const ui = await mountMsg($, NEXT, 'm4')
  await flush()
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('Als /p tidy-chats-2 speichern?')
  await ui.unmount()
  // jetzt ähnelt die Nachricht einem gespeicherten: kein weiterer Vorschlag
  const n = w.calls.filter((c) => c.kind === 'propose').length
  w.deck.saved = [{ name: 'x', words: wordSet(Z1) }]
  w.setSid('s9')
  await $.prompt.submit(userPrompt(Z1))
  await flush()
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(n)
})

deTest('Erkennung: Nein merkt die Gruppe als abgelehnt; kein neuer Vorschlag, kein /deck', async ($, on) => {
  const w = world(on)
  const ui = await threeChats($, w)
  await ui.press({ key: 'sidekick-offer-no' })
  await afterPress(w)
  expect(w.deckCalls).toEqual([])
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
  expect(w.calls.filter((c) => c.kind === 'propose').length).toBe(1)
  expect(cleanSeen(w.store.get('prompts:seen')).length).toBe(1)
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
  await $.prompt.submit(userPrompt(`/deck save x ${Z1}`))
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
  expect(w.toasts).toEqual([])
})

for (const surface of ['terminal', 'vscode'] as const)
  deTest(`Angebot auf ${surface}: ${surface === 'terminal' ? 'Knöpfe Speichern und Nein' : 'als Text mit /deck save'} (Review 0.21.0 S1)`, async ($, on) => {
    const w = world(on)
    const ui = await threeChats($, w, surface)
    if (surface === 'terminal') {
      expect(await ui.find({ key: 'sidekick-offer-save' })).toBeDefined()
      expect(await ui.find({ key: 'sidekick-offer-no' })).toBeDefined()
      await ui.press({ key: 'sidekick-offer-save' })
      await afterPress(w)
      expect(w.deck.saved?.map((s) => s.name)).toEqual(['tidy-chats'])
    } else {
      const all = JSON.stringify(await ui.find({ type: 'Text' }))
      expect(all).toContain('Das schickst du öfter. Als /p tidy-chats speichern?')
      expect(all).toContain('/deck save tidy-chats Sortiere die Chats unter dir')
      expect(await ui.find({ key: 'sidekick-offer-save' })).toBeUndefined()
    }
    await ui.unmount()
  })
