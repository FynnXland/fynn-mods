import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { MIN, cacheState, emptyMem, observeStep, textBar, parseTokens, pingMissed, priceFor, readCost, rewriteCost, ringFor, terminalBlock } from '../hooks/cache.ts'
import { RING_H, RING_SEGMENTS, ringFilled } from '../hooks/ring.ts'
import { desktopSvg } from '../hooks/svg.ts'
import { layoutTerminal, shownWindows } from '../hooks/view.ts'

const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime()
const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({ plugin: 'limit-bars', component: 'AbovePrompt', requestId: 'above-prompt', props: props(bodyColumns), surface }) as const
const usage = (read: number, written: number, model = 'claude-opus-5-5') => ({ input_tokens: 2, output_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: written, model })
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

// Die bisherigen Tests prüfen die deutschen Texte (Fynns Einstellung); Englisch: tests/i18n.test.ts
const DE = { options: { language: 'de' } } as const

// ---------- reine Logik ----------

test('Zustand: unbekannt, warm, gelb (letzte 5 min bzw. letzte Minute), kalt, warmgehalten', async () => {
  expect(cacheState(0, 60, NOW, false).kind).toBe('unknown')
  expect(cacheState(NOW - 10 * MIN, 60, NOW, false)).toEqual({ kind: 'warm', left: 50 * MIN })
  expect(cacheState(NOW - 56 * MIN, 60, NOW, false).kind).toBe('cooling')
  expect(cacheState(NOW - 3 * MIN, 5, NOW, false).kind).toBe('warm')
  expect(cacheState(NOW - 4.5 * MIN, 5, NOW, false).kind).toBe('cooling')
  expect(cacheState(NOW - 61 * MIN, 60, NOW, false)).toEqual({ kind: 'cold', left: -MIN })
  expect(cacheState(NOW - 56 * MIN, 60, NOW, true).kind).toBe('kept')
  // Warmhalten rettet keinen schon kalten Cache
  expect(cacheState(NOW - 61 * MIN, 60, NOW, true).kind).toBe('cold')
})

test('TTL-Messung: Treffer nach 6 min → 60, Neuschreiben nach 10 min → 5, nach Kompaktierung nichts', async () => {
  const base = { ...emptyMem(), lastActivity: NOW, ctx: 300000, ttl: 5 as const, ttlSource: 'Standard' as const }
  const hit = observeStep(base, usage(300000, 2000), NOW + 6 * MIN, false)
  expect(hit.mem.ttl).toBe(60)
  expect(hit.mem.ttlSource).toBe('gemessen')
  expect(hit.coldWritten).toBe(0)
  const start60 = { ...base, ttl: 60 as const }
  const miss = observeStep(start60, usage(20000, 280000), NOW + 10 * MIN, false)
  expect(miss.mem.ttl).toBe(5)
  expect(miss.coldWritten).toBe(280000)
  // Nach /compact schreibt die erste Anfrage den kürzeren Kontext neu: erwartet
  const compacted = observeStep(start60, usage(20000, 80000), NOW + 10 * MIN, true)
  expect(compacted.mem.ttl).toBe(60)
  expect(compacted.coldWritten).toBe(0)
  // Neuschreiben nach mehr als 60 min ist ein kalter Neustart, sagt aber nichts über die TTL
  const late = observeStep(start60, usage(20000, 280000), NOW + 70 * MIN, false)
  expect(late.mem.ttl).toBe(60)
  expect(late.coldWritten).toBe(280000)
  expect(late.mem.lastActivity).toBe(NOW + 70 * MIN)
  expect(late.mem.ctx).toBe(300002)
})

test('Kosten je Modell und TTL: Opus 5.5 400k neu = 3,20 $ (1 h) bzw. 2,00 $ (5 min), Lesen 0,08 $', async () => {
  expect(near(rewriteCost(400000, 'claude-opus-5-5', 60), 3.2)).toBe(true)
  expect(near(rewriteCost(400000, 'claude-opus-5-5', 5), 2)).toBe(true)
  expect(near(readCost(400000, 'claude-opus-5-5'), 0.08)).toBe(true)
  expect(near(rewriteCost(100000, 'claude-sonnet-5-5', 60), 0.4)).toBe(true)
  expect(priceFor('claude-haiku-4-5-20251001').id).toBe('haiku-4-5')
  expect(priceFor('opus[1m]').id).toBe('opus-5-5')
  expect(priceFor('claude-opus-5').id).toBe('opus-5')
  expect(parseTokens('150k')).toBe(150000)
  expect(parseTokens('1,5m')).toBe(1500000)
  expect(parseTokens('abc')).toBe(null)
})

test('Ring: gefüllte Segmente, Farben, Svg-Maße ≤ 56', async () => {
  expect(RING_SEGMENTS).toBe(28)
  expect(ringFilled(0)).toBe(0)
  expect(ringFilled(0.001)).toBe(1)
  expect(ringFilled(1)).toBe(28)
  expect(ringFilled(42 / 60)).toBe(20)
  const warm = ringFor(cacheState(NOW - 18 * MIN, 60, NOW, false), 60, 412000, true, 'de')
  expect(near(warm.fill, 42 / 60)).toBe(true)
  expect(warm.main).toBe('42m')
  expect(warm.sub).toBe('412k')
  expect(warm.alt).toBe('Cache warm, noch 42 min, Kontext 412k Tokens')
  const coldBig = ringFor(cacheState(NOW - 70 * MIN, 60, NOW, false), 60, 412000, true, 'de')
  expect(coldBig.fill).toBe(1)
  expect(coldBig.color).toBe('#C9594B')
  const coldSmall = ringFor(cacheState(NOW - 70 * MIN, 60, NOW, false), 60, 38000, false, 'de')
  expect(coldSmall.fill).toBe(0)
  expect(coldSmall.main).toBe('kalt')
  const pic = desktopSvg([], warm)
  expect(pic.height).toBe(RING_H)
  expect(pic.height <= 56).toBe(true)
  expect((pic.source.match(/<path /g) ?? []).length).toBe(28)
  expect((pic.source.match(/stroke="#6CC070"/g) ?? []).length).toBe(20)
})

test('Terminal-Block und Kürzung: der Block fällt als erste Stufe weg', async () => {
  expect(terminalBlock(cacheState(0, 60, NOW, false), false, 'de')).toBe(null)
  expect(terminalBlock(cacheState(NOW - 18 * MIN, 60, NOW, false), false, 'de')?.text).toBe('◔ 42m')
  expect(terminalBlock(cacheState(NOW - 70 * MIN, 60, NOW, false), true, 'de')).toEqual({ text: '○ kalt', color: '#C9594B' })
  const one = shownWindows([{ kind: 'five_hour', percentUsed: 30 }], NOW, { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang: 'de' })
  // Breit genug: Balken und Block
  expect(layoutTerminal(one, 120, '◔ 42m')?.extra).toBe('◔ 42m')
  // Ohne Fenster steht der Block allein
  expect(layoutTerminal([], 120, '◔ 42m')).toEqual({ blocks: [], width: 6, extra: '◔ 42m' })
  const two = shownWindows(
    [
      { kind: 'five_hour', percentUsed: 71, resetsAt: NOW + 134 * MIN },
      { kind: 'seven_day', percentUsed: 18, resetsAt: NOW + 3 * 1440 * MIN },
    ],
    NOW,
    { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang: 'de' },
  )
  // Beide Balken füllen die 44 Spalten: der Block weicht, die Balken bleiben in Langform
  const lay = layoutTerminal(two, 120, '◔ 42m')
  expect(lay?.extra).toBeUndefined()
  expect(lay?.blocks.length).toBe(2)
  expect(lay?.blocks[0].rest).toBe(' · in 2 h 14 min')
})

test('Ping schreibt statt zu lesen → verfehlt', async () => {
  expect(pingMissed(usage(400000, 300))).toBe(false)
  expect(pingMissed(usage(1000, 380000))).toBe(true)
})

// ---------- Hooks mit Stubs ----------

type U = ReturnType<typeof usage>
function world(on: On, o: { saved?: Map<string, unknown>; id?: string; inner?: string; clearFails?: boolean; storeSetFails?: boolean; submitFails?: boolean; settingsGetFails?: boolean } = {}) {
  const seen = { cols: -1 }
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const toasts: string[] = []
  const asks: string[] = []
  let answer: string | null = 'Trotzdem senden'
  const sent: string[] = []
  const compacts: number[] = []
  const commands: string[] = []
  let forkUsage: U | null = usage(400000, 0)
  let forkValue: unknown = null // überschreibt die Antwort von model.fork
  let forks = 0
  let id = o.id ?? 'sess-1'
  let ctxTokens: number | undefined = undefined
  on('session.id', () => ({ value: id }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: ctxTokens, window: 1000000 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('store.get', ($, e) => (o.settingsGetFails && e.key === 'settings' ? { deny: 'kaputt' } : { value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    if (o.storeSetFails) return { deny: 'Speicher voll' }
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
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'limit-bars:uebergabe', description: 'Übergabe', source: 'plugin' }] }))
  on('command.run', ($, e) => {
    commands.push(e.command)
    // Ein werfender Stub wird übersprungen (docs/raw/en/test.md:182); ohne weitere Antwort scheitert der Aufruf
    if (o.clearFails && e.command === 'clear') throw new Error('nicht jetzt')
    return { text: '' }
  })
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: '' }
    const q = (e as { questions: { question: string }[] }).questions[0].question
    asks.push(q)
    if (answer === null) return { deny: 'Dialog geschlossen' }
    return { result: { answers: { [q]: answer } } }
  })
  on('prompt.submit', ($, e) => {
    // Ein werfender Stub wird übersprungen; ohne weitere Antwort scheitert der Aufruf
    if (o.submitFails && e.origin.kind === 'plugin') throw new Error('nicht jetzt')
    sent.push(e.text)
    return { text: e.text }
  })
  on('session.compact', () => {
    compacts.push(1)
    return { messages: [{ role: 'user', text: 'Zusammenfassung', toolUses: [] }] }
  })
  on('model.fork', () => {
    forks += 1
    if (forkValue === 'deny') return { deny: 'kein Kontingent' }
    if (forkValue) return { value: forkValue }
    return { value: forkUsage ? { isAnswered: true, text: 'ok', usage: forkUsage } : { isAnswered: false, reason: 'nothing-to-fork' } }
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    seen.cols = e.props.bodyColumns
    return o.inner ? { type: 'Text', props: {}, children: [o.inner] } : { type: 'engine', ref: 0 }
  })
  let next: U = usage(0, 0)
  let turn = 0
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: next }
  })
  async function step($: Engine, u: U, agentId?: string, complete = true) {
    next = u
    turn += 1
    const s = $.turn.step({ turnId: `t${turn}`, index: 0, model: u.model, messageCount: 3, ...(agentId ? { agentId } : {}) })
    let r = await s.next()
    while (r.done !== true) r = await s.next()
    // Turn-Ende der Hauptschleife (sonst gilt der Turn als laufend: kein Ping, kein /compact)
    if (!agentId && complete) await $.turn.complete({ turnId: `t${turn}`, answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
    return `t${turn}`
  }
  return {
    clock,
    seen,
    saved,
    toasts,
    asks,
    sent,
    compacts,
    commands,
    step,
    get forks() {
      return forks
    },
    setAnswer: (a: string | null) => (answer = a),
    setForkUsage: (u: U | null) => (forkUsage = u),
    setForkValue: (v: unknown) => (forkValue = v),
    setId: (v: string) => (id = v),
    setCtx: (n: number | undefined) => (ctxTokens = n),
  }
}

const ringAlt = async (ui: { find: (q: { type: string }) => Promise<{ props: { alt?: unknown } } | undefined> }) => String((await ui.find({ type: 'Svg' }))?.props.alt)
const userPrompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

test('turn.step: Hauptschleife zählt, Subagent wird ignoriert; Ring ohne Limits zeigt Restzeit und Kontext', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000), 'agent-7')
  const ui = await $.ui.mount(band('desktop'))
  expect(await ringAlt(ui)).toContain('Cache noch unbekannt')
  await w.step($, usage(300000, 5000))
  await ui.redraw()
  expect(await ringAlt(ui)).toContain('Cache warm, noch 60 min, Kontext 305k Tokens')
  expect(await ringAlt(ui)).toContain('5-Stunden-Limit noch unbekannt')
})

test('Restzeit läuft mit der Uhr ohne Turn weiter (10-s-Takt), wird gelb und kalt', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000))
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.advance(20 * MIN)
  expect(await ringAlt(ui)).toContain('noch 40 min')
  await w.clock.advance(36 * MIN)
  expect(await ringAlt(ui)).toContain('Cache kühlt ab, noch 4 min')
  await w.clock.advance(5 * MIN)
  expect(await ringAlt(ui)).toContain('Cache kalt')
  await ui.unmount()
})

test('Vorwarnung: großer Chat in der gelben Phase → ein Hinweis mit /handoff und /keepwarm, nur einmal', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000))
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.advance(56 * MIN)
  await w.clock.advance(30000)
  const hints = w.toasts.filter((t) => t.startsWith('Cache läuft in'))
  expect(hints.length).toBe(1)
  expect(hints[0]).toContain('/handoff')
  expect(hints[0]).toContain('/keepwarm')
  await ui.unmount()
})

test('Persistenz: Stand in $.store, nach Neustart lädt session.start ihn; alte Einträge (> 7 Tage) werden aufgeräumt', DE, async ($, on) => {
  const saved = new Map<string, unknown>([
    ['cache:sess-1', { lastActivity: NOW - 10 * MIN, ttl: 60, ttlSource: 'gemessen', ctx: 412000, model: 'claude-opus-5-5', savedAt: NOW - 10 * MIN }],
    ['cache:alt', { lastActivity: NOW - 8 * 1440 * MIN, ttl: 60, ttlSource: 'Standard', ctx: 1000, model: '', savedAt: NOW - 8 * 1440 * MIN }],
  ])
  const w = world(on, { saved })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await w.clock.settle()
  const ui = await $.ui.mount(band('desktop'))
  expect(await ringAlt(ui)).toContain('Cache warm, noch 50 min, Kontext 412k Tokens')
  expect(saved.has('cache:alt')).toBe(false)
  // Neue Anfrage speichert
  await w.step($, usage(412000, 1000))
  expect((saved.get('cache:sess-1') as { lastActivity: number }).lastActivity).toBe(NOW)
})

test('Neuer Chat (/clear → neue Session-ID): Ring wieder unbekannt', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000))
  const ui = await $.ui.mount(band('desktop'))
  expect(await ringAlt(ui)).toContain('Cache warm')
  w.setId('sess-2')
  await w.clock.advance(10000)
  expect(await ringAlt(ui)).toContain('Cache noch unbekannt')
  await ui.unmount()
})

test('Warnung vor kaltem Senden: alle drei Antworten', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(400000, 5000))
  await w.clock.advance(75 * MIN)
  // Trotzdem senden
  w.setAnswer('Trotzdem senden')
  expect(await $.prompt.submit(userPrompt('weiter bitte'))).toMatchObject({ text: 'weiter bitte' })
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]).toContain('seit 15 min kalt')
  expect(w.asks[0]).toContain('405k Tokens neu')
  expect(w.asks[0]).toContain('≈ 3,24 $')
  // Erst komprimieren
  w.setAnswer('Erst komprimieren')
  // außerhalb des Hooks: zurückhalten, komprimieren, dann selbst senden
  expect((await $.prompt.submit(userPrompt('zwei'))).drop).toContain('nach dem Komprimieren')
  await w.clock.advance(1000)
  // Ohne Kern fehlen im Test-Kit die messages der Kompaktierung (es meldet das beim Weiterreichen): der Versuch zählt,
  // danach geht die Nachricht trotzdem raus (fail-open)
  expect(w.compacts.length >= 1 || w.toasts.some((t) => t.startsWith('Komprimieren ging nicht (test:'))).toBe(true)
  expect(w.sent).toEqual(['weiter bitte', 'zwei'])
  // Abbrechen
  w.setAnswer('Abbrechen')
  const r = await $.prompt.submit(userPrompt('drei'))
  expect(r.drop).toContain('abgebrochen')
  expect(w.sent).toEqual(['weiter bitte', 'zwei'])
  expect(w.toasts.some((t) => t.includes('/handoff'))).toBe(true)
})

test('Warnung fail-open: abgelehnter Dialog lässt durch; kleiner Kontext, Slash-Befehl, laufender Turn, Plugin-Prompt fragen nicht', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(400000, 5000))
  await w.clock.advance(75 * MIN)
  w.setAnswer(null)
  expect(await $.prompt.submit(userPrompt('eins'))).toMatchObject({ text: 'eins' })
  expect(w.asks.length).toBe(1)
  w.setAnswer('Abbrechen')
  await $.prompt.submit(userPrompt('/cache'))
  await $.prompt.submit({ ...userPrompt('mitten im Turn'), turnId: 't9' })
  await $.prompt.submit({ text: 'vom Plugin', wait: false, origin: { kind: 'plugin', name: 'x' } } as never)
  expect(w.asks.length).toBe(1)
  // Kleiner Kontext
  await w.step($, usage(30000, 5000))
  await w.clock.advance(75 * MIN)
  await $.prompt.submit(userPrompt('klein'))
  expect(w.asks.length).toBe(1)
  expect(w.sent).toEqual(['eins', '/cache', 'mitten im Turn', 'vom Plugin', 'klein'])
})

test('Warnung aus per /cache warnung aus; Einstellungen werden gespeichert und erscheinen im Bericht', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(400000, 5000))
  const r1 = await $.command.run({ command: 'cache', args: 'warnung aus' } as never)
  expect(r1.text).toContain('Gespeichert.')
  expect(r1.text).toContain('Rückfrage vor kaltem Senden: **aus**')
  expect(w.saved.get('settings')).toMatchObject({ guard: false })
  const r2 = await $.command.run({ command: 'cache', args: 'gross 300k' } as never)
  expect(r2.text).toContain('ab 300k')
  const r3 = await $.command.run({ command: 'cache', args: 'ttl 5' } as never)
  expect(r3.text).toContain('| **Cache-Dauer** | 5 min (von dir gesetzt) |')
  const r4 = await $.command.run({ command: 'cache', args: 'quatsch' } as never)
  expect(r4.text).toContain('Unbekannt')
  await w.clock.advance(75 * MIN)
  await $.prompt.submit(userPrompt('ohne Frage'))
  expect(w.asks.length).toBe(0)
})

test('/cache Bericht: Zustand, Kosten in $, letzte Anfrage, Warmhalten, Einstellungen', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(395000, 5000))
  const r = await $.command.run({ command: 'cache', args: '' } as never)
  expect(r.text).toContain('### Prompt-Cache · warm')
  expect(r.text).toContain('| **Cache-Dauer** | 60 min (Standard) |')
  expect(r.text).toContain('400k Tokens · groß')
  expect(r.text).toContain('kalt (Neuschreiben) ≈ 3,20 $')
  expect(r.text).toContain('warm ≈ 0,08 $')
  expect(r.text).toContain('395k aus dem Cache gelesen, 5,0k neu geschrieben')
  expect(r.text).toContain('| **Warmhalten** | aus |')
  expect(r.text).toContain('/cache ttl 5|60|auto')
})

test('/keepwarm: Standard aus; Ping kurz vor Ablauf hält warm; Selbstabschaltung, wenn der Ping neu schreibt', DE, async ($, on) => {
  const w = world(on)
  // ohne Anfrage nichts warmzuhalten
  expect((await $.command.run({ command: 'keepwarm', args: '' } as never)).text).toContain('Noch keine Anfrage')
  await w.step($, usage(400000, 5000))
  // Standard aus: ohne Befehl kein Ping
  await w.clock.advance(55 * MIN)
  expect(w.forks).toBe(0)
  const on1 = await $.command.run({ command: 'keepwarm', args: '2' } as never)
  expect(on1.text).toContain('Warmhalten an bis 12:55')
  expect(on1.text).toContain('≈ 0,08 $ API-Wert je Ping')
  await w.clock.advance(60000)
  expect(w.forks).toBe(1)
  const after = await $.command.run({ command: 'cache', args: '' } as never)
  expect(after.text).toContain('| **Warmhalten** | an bis 12:55 · 1 Ping(s)')
  expect(after.text).toContain('noch 59 min')
  // Der nächste Ping verfehlt den Cache: abschalten
  w.setForkUsage(usage(1000, 399000))
  await w.clock.advance(53 * MIN)
  expect(w.forks).toBe(2)
  expect(w.toasts.some((t) => t.startsWith('Warmhalten aus (der Ping schrieb'))).toBe(true)
  await w.clock.advance(60 * MIN)
  expect(w.forks).toBe(2)
})

test('/keepwarm aus und Höchstdauer 4 h', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(400000, 5000))
  expect((await $.command.run({ command: 'keepwarm', args: '9' } as never)).text).toContain('höchstens 4 h')
  expect((await $.command.run({ command: 'keepwarm', args: 'aus' } as never)).text).toBe('Warmhalten aus.')
  expect((await $.command.run({ command: 'keepwarm', args: 'aus' } as never)).text).toBe('Warmhalten ist schon aus.')
  await w.clock.advance(120 * MIN)
  expect(w.forks).toBe(0)
})

const HANDOFF = `# Übergabe: Test\n\n## Auftrag\n${'Ein Satz mit Inhalt. '.repeat(15)}\n\n## Weiter mit\nWeiter.`

test('/handoff: startet den Skill, fängt die Antwort ab, fragt und leert dann den Chat mit der Übergabe', DE, async ($, on) => {
  const w = world(on)
  w.setAnswer('Neuer Chat mit Übergabe')
  const r = await $.command.run({ command: 'handoff', args: '' } as never)
  expect(r.text).toContain('Erstelle die Übergabe')
  await w.clock.advance(1000)
  expect(w.commands).toContain('limit-bars:uebergabe')
  const t = await w.step($, usage(400000, 5000), undefined, false)
  await $.turn.complete({ turnId: t, answer: `Hier ist sie.\n\n${HANDOFF}`, durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  await w.clock.advance(1000)
  expect(w.asks.some((q) => q.startsWith('Übergabe fertig'))).toBe(true)
  expect(w.commands).toContain('clear')
  expect(w.sent.length).toBe(1)
  expect(w.sent[0].startsWith('Übergabe aus meinem vorigen Chat:\n\n# Übergabe: Test')).toBe(true)
  const list = w.saved.get('handoffs') as { text: string }[]
  expect(list.length).toBe(1)
  expect((await $.command.run({ command: 'handoff', args: 'zeigen' } as never)).text).toContain('# Übergabe: Test')
})

test('/handoff mit gescheitertem /clear: Hinweis, wo die Übergabe liegt; nichts gesendet', DE, async ($, on) => {
  const w = world(on, { clearFails: true })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.command.run({ command: 'handoff', args: '' } as never)
  await w.clock.advance(1000)
  const t = await w.step($, usage(400000, 5000), undefined, false)
  await $.turn.complete({ turnId: t, answer: HANDOFF, durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  await w.clock.advance(1000)
  expect(w.toasts.some((x) => x.startsWith('/clear ging nicht') && x.includes('/handoff show'))).toBe(true)
  expect(w.sent.length).toBe(0)
})

test('Reihenfolge außen und innen neben clawd-buddy auf beiden Oberflächen, mit Ring', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000))
  // innen (Kern-Knoten) auf dem Desktop: Zeile, Ring im eigenen Bild, Kern-Knoten daneben
  const d = await $.ui.mount(band('desktop'))
  const tree = await d.drawn()
  expect(tree).toMatchObject({ type: 'Box', props: { flexDirection: 'row', alignItems: 'flex-end' } })
  expect(await ringAlt(d)).toContain('Cache warm')
  await d.unmount()
})

test('Reihenfolge außen im Terminal: Balkenbox mit Cache-Block links, innen sieht bodyColumns − B', DE, async ($, on) => {
  const w = world(on, { inner: 'clawd' })
  await w.step($, usage(300000, 5000))
  const t = await $.ui.mount(band('terminal', 120))
  const kids = (await t.drawn()).children as { props: { key?: string; width?: number } }[]
  expect(kids[0].props.key).toBe('limit-bars')
  expect(await t.find({ type: 'Text', text: '◔ 60m' })).toBeDefined()
  expect(w.seen.cols).toBe(120 - (kids[0].props.width as number))
  expect(await t.find({ type: 'Text', text: 'clawd' })).toBeDefined()
})

const MSG = [{ role: 'user', text: 'alles', toolUses: [] }]

test('session.compact: die erste Anfrage danach zählt nicht als kalter Neustart, die nächste schon; precompute zählt nicht', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000))
  await w.clock.advance(2 * MIN)
  await $.session.compact({ trigger: 'manual', messages: MSG } as never)
  await w.step($, usage(20000, 80000))
  expect((await $.command.run({ command: 'cache', args: '' } as never)).text).toContain('| **Kalte Neustarts** | 0 in dieser Sitzung |')
  await w.step($, usage(20000, 280000))
  expect((await $.command.run({ command: 'cache', args: '' } as never)).text).toContain('| **Kalte Neustarts** | 1 · ≈ 2,24 $ in dieser Sitzung |')
  // precompute installiert nichts: kein Freibrief für die nächste Anfrage
  await $.session.compact({ trigger: 'precompute', messages: MSG } as never)
  await w.step($, usage(20000, 280000))
  expect((await $.command.run({ command: 'cache', args: '' } as never)).text).toContain('| **Kalte Neustarts** | 2 ·')
})

test('/cache: Speichern abgelehnt → gilt bis zum Neustart', DE, async ($, on) => {
  world(on, { storeSetFails: true })
  const r = await $.command.run({ command: 'cache', args: 'hinweise aus' } as never)
  expect(r.text).toContain('Gilt bis zum Neustart')
  expect(r.text).toContain('Hinweis kurz vor Ablauf: **aus**')
})

test('/cache liest die Einstellungen vor dem Schreiben neu (eine andere Session hat geändert)', DE, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'cache', args: 'gross 300k' } as never)
  w.saved.set('settings', { ...(w.saved.get('settings') as object), guard: false })
  const r = await $.command.run({ command: 'cache', args: 'hinweise aus' } as never)
  expect(w.saved.get('settings')).toMatchObject({ guard: false, alerts: false, bigTokens: 300000 })
  expect(r.text).toContain('Rückfrage vor kaltem Senden: **aus** ab 300k')
})

const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
for (const [name, value, why] of [
  ['nothing-to-fork', { isAnswered: false, reason: 'nothing-to-fork' }, 'bekam keine Antwort (nothing-to-fork)'],
  ['api-error mit Null-usage', { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: ZERO }, 'bekam keine Antwort (api-error)'],
  ['Antwort ohne Cache-Lesen', { isAnswered: true, text: 'ok', usage: ZERO }, 'las nichts aus dem Cache'],
] as const) {
  test(`/keepwarm: Ping ${name} → Warmhalten aus, der Ring bleibt bei der alten Restzeit`, DE, async ($, on) => {
    const w = world(on)
    await w.step($, usage(400000, 5000))
    await w.clock.advance(53 * MIN)
    await $.command.run({ command: 'keepwarm', args: '1' } as never)
    w.setForkValue(value)
    await w.clock.advance(60000)
    expect(w.forks).toBe(1)
    expect(w.toasts.some((t) => t.startsWith(`Warmhalten aus (der Ping ${why}`))).toBe(true)
    const r = await $.command.run({ command: 'cache', args: '' } as never)
    expect(r.text).toContain('noch 6 min')
    expect(r.text).toContain('| **Warmhalten** | aus |')
  })
}

test('/keepwarm: abgelehnter Fork → Warmhalten aus mit Grund', DE, async ($, on) => {
  const w = world(on)
  w.setForkValue('deny')
  await w.step($, usage(400000, 5000))
  await w.clock.advance(53 * MIN)
  await $.command.run({ command: 'keepwarm', args: '1' } as never)
  await w.clock.advance(60000)
  expect(w.toasts.some((t) => t.startsWith('Warmhalten aus (') && !t.includes('abgelaufen'))).toBe(true)
})

test('/handoff: Dialog geschlossen → Hinweis auf /handoff continue; das Alias /handoff weiter setzt die gespeicherte Übergabe ein', DE, async ($, on) => {
  const w = world(on)
  w.setAnswer(null)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await w.clock.advance(1000)
  const t = await w.step($, usage(400000, 5000), undefined, false)
  await $.turn.complete({ turnId: t, answer: HANDOFF, durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  await w.clock.advance(1000)
  expect(w.toasts.some((x) => x.includes('/handoff continue'))).toBe(true)
  expect(w.commands).not.toContain('clear')
  await $.command.run({ command: 'handoff', args: 'weiter' } as never)
  await w.clock.advance(1000)
  expect(w.commands).toContain('clear')
  expect(w.sent[0].startsWith('Übergabe aus meinem vorigen Chat:')).toBe(true)
})

test('/handoff: Senden nach /clear scheitert → Hinweis auf /handoff zeigen; ein Turn ohne Übergabe speichert nichts', DE, async ($, on) => {
  const w = world(on, { submitFails: true })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.command.run({ command: 'handoff', args: '' } as never)
  await w.clock.advance(1000)
  let t = await w.step($, usage(400000, 5000), undefined, false)
  await $.turn.complete({ turnId: t, answer: HANDOFF, durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  await w.clock.advance(1000)
  expect(w.commands).toContain('clear')
  expect(w.toasts.some((x) => x.startsWith('Chat geleert, aber') && x.includes('/handoff show'))).toBe(true)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await w.clock.advance(1000)
  t = await w.step($, usage(400000, 5000), undefined, false)
  await $.turn.complete({ turnId: t, answer: 'Mache ich gleich.', durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  expect(w.toasts.some((x) => x.startsWith('Der Übergabe-Turn endete ohne Übergabe'))).toBe(true)
  expect((w.saved.get('handoffs') as unknown[]).length).toBe(1)
})

test('Erst komprimieren fehlt bei @datei im Text', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(400000, 5000))
  await w.clock.advance(75 * MIN)
  w.setAnswer('Erst komprimieren')
  // Die Antwort ist keine der angebotenen Optionen mehr: so behandelt wie freier Text → senden
  expect(await $.prompt.submit(userPrompt('schau in @src/app.ts'))).toMatchObject({ text: 'schau in @src/app.ts' })
  await w.clock.advance(1000)
  expect(w.compacts.length).toBe(0)
})

test('/cache-Balken: gleich hohe Linienzeichen, Breite fest', async () => {
  expect(textBar(0.25, 8)).toBe('`━━──────`')
  expect(textBar(0, 4)).toBe('`────`')
  expect(textBar(1, 4)).toBe('`━━━━`')
})

test('0.2.1 Kontextzahl unter dem Ring: grau unter 80k, orange ab 80k, rot ab „groß“; der Ring bleibt beim Cache-Zustand', async () => {
  const warm = cacheState(NOW - 10 * MIN, 60, NOW, false)
  const small = ringFor(warm, 60, 50000, false, 'de')
  const mid = ringFor(warm, 60, 100000, false, 'de')
  const big = ringFor(warm, 60, 200000, true, 'de')
  expect(small.subColor).toBe('#9A9A9A')
  expect(mid.subColor).toBe('#D77757')
  expect(big.subColor).toBe('#C9594B')
  // Der Ring selbst ändert sich nicht mit dem Kontext
  expect([small.color, mid.color, big.color]).toEqual(['#6CC070', '#6CC070', '#6CC070'])
  // Grenze 80k genau, und „groß“ hängt an bigTokens (hier 300k gesetzt: 200k ist dann orange)
  expect(ringFor(warm, 60, 80000, false, 'de').subColor).toBe('#D77757')
  expect(ringFor(warm, 60, 79999, false, 'de').subColor).toBe('#9A9A9A')
  expect(ringFor(warm, 60, 200000, 200000 >= 300000, 'de').subColor).toBe('#D77757')
  // Im Bild trägt die Kontextzahl die Farbe
  expect(desktopSvg([], mid).source).toMatch(/font-size="8" fill="#D77757">100k</)
})

test('0.2.1 /cache warnung aus aus einer anderen Session gilt sofort, ohne neue Session', DE, async ($, on) => {
  const w = world(on)
  await w.step($, usage(400000, 5000))
  await w.clock.advance(75 * MIN)
  // Rückfrage ist an: einmal fragen
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt('eins'))
  expect(w.asks.length).toBe(1)
  // Eine andere Session schaltet die Warnung aus (nur der gemeinsame Store ändert sich)
  w.saved.set('settings', { ttl: 0, guard: false, bigTokens: 150000, alerts: true })
  await $.prompt.submit(userPrompt('zwei'))
  expect(w.asks.length).toBe(1)
  expect(w.sent).toEqual(['eins', 'zwei'])
})

test('0.2.1 Einstellungen nicht lesbar → Stand dieser Session, Nachricht geht durch (fail-open)', DE, async ($, on) => {
  const w = world(on, { settingsGetFails: true })
  await w.step($, usage(400000, 5000))
  await w.clock.advance(75 * MIN)
  w.setAnswer(null)
  expect(await $.prompt.submit(userPrompt('drei'))).toMatchObject({ text: 'drei' })
})
