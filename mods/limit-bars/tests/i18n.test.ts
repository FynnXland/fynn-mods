import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { spanText, tokensText } from '../hooks/cache.ts'
import { T, dec, langOf, usd } from '../hooks/i18n.ts'
import { clockText, countdownText } from '../hooks/view.ts'

// Sprachumschaltung (release/I18N.md): Standard en, `language: de` für Deutsch. Die übrigen Tests laufen mit `de`.
const NOW = new Date(2026, 9, 2, 10, 0, 0).getTime()
const MIN = 60000
const iso = (ms: number) => new Date(ms).toISOString()
const FIVE_RESET = NOW + (2 * 60 + 14) * MIN + 30000
const WEEK_RESET = new Date(2026, 9, 5, 9, 0, 0).getTime() // Montag 09:00
const limits = (five: number, week: number) => [
  { kind: 'five_hour', percentUsed: five, resetsAt: iso(FIVE_RESET) },
  { kind: 'seven_day', percentUsed: week, resetsAt: iso(WEEK_RESET) },
]
const props = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} }) as const
const band = (surface: 'terminal' | 'desktop', bodyColumns = 120) =>
  ({ plugin: 'limit-bars', component: 'AbovePrompt', requestId: 'above-prompt', props: props(bodyColumns), surface }) as const
const usage = (read: number, written: number) => ({ input_tokens: 2, output_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: written, model: 'claude-opus-5-5' })
const DE = { options: { language: 'de' } } as const

// ---------- Tabellen und Formatierer ----------

test('Tabellen en/de: dieselben Schlüssel, gleiche Art, keine leeren Texte', async () => {
  const sample = ['a', 'b', 'c', 'd', 'e', 'f']
  function same(a: unknown, b: unknown, path: string) {
    expect(`${path}: ${typeof b}`).toBe(`${path}: ${typeof a}`)
    if (typeof a === 'string') {
      expect(`${path}: ${(a as string).trim().length > 0}`).toBe(`${path}: true`)
      expect(`${path}: ${(b as string).trim().length > 0}`).toBe(`${path}: true`)
    } else if (typeof a === 'function') {
      const fa = a as (...x: string[]) => unknown
      const fb = b as (...x: string[]) => unknown
      expect(`${path}: ${fb.length}`).toBe(`${path}: ${fa.length}`)
      for (const f of [fa, fb]) {
        const out = f(...sample)
        expect(`${path}: ${typeof out === 'string' && out.trim().length > 0}`).toBe(`${path}: true`)
      }
    } else if (Array.isArray(a)) {
      expect(`${path}: ${(b as unknown[]).length}`).toBe(`${path}: ${a.length}`)
      for (let i = 0; i < a.length; i++) same(a[i], (b as unknown[])[i], `${path}[${i}]`)
    } else if (a && typeof a === 'object') {
      expect(Object.keys(b as object).sort()).toEqual(Object.keys(a as object).sort())
      for (const k of Object.keys(a as object)) same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
    }
  }
  expect(Object.keys(T.de).sort()).toEqual(Object.keys(T.en).sort())
  same(T.en, T.de, 'T')
  expect(T.en.weekdays.length).toBe(7)
})

test('Formatierer: Beträge, Dezimalzahlen, Tokens, Dauer, Reset-Zeiten je Sprache', async () => {
  expect(langOf('de')).toBe('de')
  expect(langOf(undefined)).toBe('en')
  expect(langOf('fr')).toBe('en')
  expect(usd(3.2, 'en')).toBe('≈ $3.20')
  expect(usd(3.2, 'de')).toBe('≈ 3,20 $')
  expect(usd(0.004, 'en')).toBe('< $0.01')
  expect(usd(0.004, 'de')).toBe('< 0,01 $')
  expect(usd(0, 'en')).toBe('≈ $0')
  expect(usd(0, 'de')).toBe('≈ 0 $')
  expect(dec(1.5, 1, 'en')).toBe('1.5')
  expect(dec(1.5, 1, 'de')).toBe('1,5')
  expect(tokensText(1_200_000, 'en')).toBe('1.2M')
  expect(tokensText(1_200_000, 'de')).toBe('1,2M')
  expect(tokensText(5000, 'en')).toBe('5.0k')
  expect(tokensText(412000, 'de')).toBe('412k')
  expect(spanText(30000, 'en')).toBe('under 1 min')
  expect(spanText(30000, 'de')).toBe('unter 1 min')
  expect(spanText(30000, 'en', true)).toBe('less than a minute')
  expect(spanText(125 * MIN, 'en')).toBe('2 h 5 min')
  expect(clockText(WEEK_RESET, NOW, 'en')).toEqual({ long: 'Mon 09:00', short: 'Mon9:00' })
  expect(clockText(WEEK_RESET, NOW, 'de')).toEqual({ long: 'Mo 09:00', short: 'Mo9:00' })
  expect(countdownText((2 * 1440 + 23 * 60) * MIN, 'en')).toEqual({ long: 'in 2 d 23 h', short: '2d23h' })
  expect(countdownText((2 * 1440 + 23 * 60) * MIN, 'de')).toEqual({ long: 'in 2 T 23 h', short: '2T23h' })
  expect(countdownText(134 * MIN, 'en').long).toBe('in 2 h 14 min')
})

// ---------- Hooks mit Stubs ----------

function world(on: On) {
  const clock = mock.clock(on, { now: NOW })
  const saved = new Map<string, unknown>()
  const toasts: string[] = []
  const asks: { question: string; options: string[] }[] = []
  const runs: { command: string; args: string }[] = []
  const registered: { name: string; description: string; argumentHint?: string }[] = []
  const sent: string[] = []
  let answer: string | null = null
  let rateLimits: unknown[] = []
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: undefined, window: 1000000 }, rateLimits } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
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
  on('command.register', ($, e) => {
    registered.push(e as never)
    return { value: undefined }
  })
  on('command.list', () => ({ value: [{ name: 'limit-bars:uebergabe', description: 'Handoff', source: 'plugin' }] }))
  on('command.run', ($, e) => {
    runs.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: '' }
    const q = (e as unknown as { questions: { question: string; options: { label: string }[] }[] }).questions[0]
    asks.push({ question: q.question, options: q.options.map((o) => o.label) })
    if (answer === null) return { deny: 'closed' }
    return { result: { answers: { [q.question]: answer } } }
  })
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage: usage(400000, 0) } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  let next = usage(0, 0)
  let turn = 0
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: next }
  })
  async function step($: Engine, u: ReturnType<typeof usage>, complete = true) {
    next = u
    turn += 1
    const s = $.turn.step({ turnId: `t${turn}`, index: 0, model: u.model, messageCount: 3 })
    let r = await s.next()
    while (r.done !== true) r = await s.next()
    if (complete) await $.turn.complete({ turnId: `t${turn}`, answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
    return `t${turn}`
  }
  return {
    clock,
    saved,
    toasts,
    asks,
    runs,
    registered,
    sent,
    step,
    setAnswer: (a: string | null) => (answer = a),
    setLimits: (l: unknown[]) => (rateLimits = l),
  }
}

async function measure($: Engine, rateLimits: unknown[]) {
  await $.session.measure({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits, changed: ['rateLimits'] } as never)
}
const userPrompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const cache = ($: Engine, args: string) => $.command.run({ command: 'cache', args } as never)

test('en (Standard): Terminal-Balken mit 71%, Countdown und Mon 09:00; voll heißt full, nach dem Reset 0% · fresh', async ($, on) => {
  const w = world(on)
  w.setLimits(limits(71, 18))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: '71%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · in 2 h 14 min' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · Mon 09:00' })).toBeDefined()
  await ui.unmount()
  w.setLimits(limits(100, 18))
  await measure($, limits(100, 18))
  const full = await $.ui.mount(band('terminal'))
  expect(await full.find({ type: 'Text', text: 'full' })).toBeDefined()
  await w.clock.advance(2 * 60 * MIN + 15 * MIN)
  await full.redraw()
  expect(await full.find({ type: 'Text', text: '0%' })).toBeDefined()
  expect(await full.find({ type: 'Text', text: ' · fresh' })).toBeDefined()
})

test('de: Terminal-Balken wie bisher (71 %, Mo 09:00, voll)', DE, async ($, on) => {
  world(on).setLimits(limits(71, 100))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: '71 %' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'voll' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · Mo 09:00' })).toBeDefined()
})

test('en: Desktop-Bild mit englischem alt-Text, Platzhalter und Ring', async ($, on) => {
  const w = world(on)
  const ui = await $.ui.mount(band('desktop'))
  let alt = String((await ui.find({ type: 'Svg' }))?.props.alt)
  expect(alt).toBe('5-hour limit not known yet; Weekly limit not known yet; Cache not known yet (no request yet)')
  await ui.unmount()
  await measure($, limits(71, 18))
  await w.step($, usage(300000, 5000))
  const pic = await $.ui.mount(band('desktop'))
  const svg = await pic.find({ type: 'Svg' })
  alt = String(svg?.props.alt)
  expect(alt).toBe('5-hour limit 71%, resets in 2 h 14 min; Weekly limit 18%, resets Mon 09:00; Cache warm, 60 min left, context 305k tokens')
  expect(String(svg?.props.source)).toContain('Mon 09:00')
  expect(String(svg?.props.source)).toContain('>305k<')
})

test('en: Ring kalt und Terminal-Block cold; alt mit „less than a minute“', async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000))
  await w.clock.advance(59 * MIN + 30000)
  const ui = await $.ui.mount(band('desktop'))
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Cache cooling down, less than a minute left')
  await ui.unmount()
  await w.clock.advance(10 * MIN)
  const term = await $.ui.mount(band('terminal'))
  expect(await term.find({ type: 'Text', text: '○ cold' })).toBeDefined()
})

test('Befehle werden in der eingestellten Sprache registriert, Argumente englisch', async ($, on) => {
  const w = world(on)
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const cacheCmd = w.registered.find((c) => c.name === 'cache')
  expect(cacheCmd?.description).toBe('Prompt cache: state, cost, settings')
  expect(cacheCmd?.argumentHint).toBe('[ttl 5|60|auto] [warn on|off] [big 150k] [hints on|off]')
  expect(w.registered.find((c) => c.name === 'handoff')?.argumentHint).toBe('[continue|show]')
  expect(w.registered.find((c) => c.name === 'keepwarm')?.argumentHint).toBe('[hours|off]')
})

test('de: Befehle mit deutscher Beschreibung, Argumente englisch', DE, async ($, on) => {
  const w = world(on)
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const cacheCmd = w.registered.find((c) => c.name === 'cache')
  expect(cacheCmd?.description).toBe('Prompt-Cache: Zustand, Kosten, Einstellungen')
  expect(cacheCmd?.argumentHint).toBe('[ttl 5|60|auto] [warn on|off] [big 150k] [hints on|off]')
})

test('en: /cache-Karte auf Englisch mit $-Beträgen und englischen Argumenten', async ($, on) => {
  const w = world(on)
  await w.step($, usage(395000, 5000))
  const r = await cache($, '')
  expect(r.text).toContain('### Prompt cache · warm')
  expect(r.text).toContain('**60 min left** · until 11:00')
  expect(r.text).toContain('| **Cache duration** | 60 min (default) |')
  expect(r.text).toContain('| **Context** | 400k tokens · big |')
  expect(r.text).toContain('| **Next message** | warm ≈ $0.08 · cold (rewrite) ≈ $3.20 |')
  expect(r.text).toContain('395k read from the cache, 5.0k written')
  expect(r.text).toContain('| **Keep-warm** | off |')
  expect(r.text).toContain('- Question before a cold send: **on** from 150k')
  expect(r.text).toContain('`/cache warn on|off` · `/cache big 150k` · `/cache hints on|off`')
  expect(r.text).toContain('`/keepwarm [hours]` keeps the cache warm (at most 4 h, one ping every ~52 min)')
  expect(r.text).not.toMatch(/[äöüß]|Kontext|Einstellungen/)
})

test('Aliase: englische und deutsche Argumente wirken in beiden Sprachen (en)', async ($, on) => {
  const w = world(on)
  expect((await cache($, 'warnung aus')).text).toContain('Question before a cold send: **off**')
  expect((await cache($, 'warn on')).text).toContain('Question before a cold send: **on**')
  expect((await cache($, 'guard off')).text).toContain('Question before a cold send: **off**')
  expect((await cache($, 'hinweise aus')).text).toContain('Notice shortly before expiry: **off**')
  expect((await cache($, 'hints on')).text).toContain('Notice shortly before expiry: **on**')
  expect((await cache($, 'gross 200k')).text).toContain('from 200k')
  expect((await cache($, 'groß 250k')).text).toContain('from 250k')
  expect((await cache($, 'big 300k')).text).toContain('from 300k')
  expect(w.saved.get('settings')).toMatchObject({ guard: false, alerts: true, bigTokens: 300000 })
  const bad = await cache($, 'quatsch')
  expect(bad.text).toBe('Unknown: "quatsch". Possible: ttl 5|60|auto · warn on|off · big 150k · hints on|off → `/bars help`')
})

test('Aliase in de: warn, hints, big wirken auch bei deutscher Sprache', DE, async ($, on) => {
  const w = world(on)
  expect((await cache($, 'warn off')).text).toContain('Rückfrage vor kaltem Senden: **aus**')
  expect((await cache($, 'hints off')).text).toContain('Hinweis kurz vor Ablauf: **aus**')
  expect((await cache($, 'big 300k')).text).toContain('ab 300k')
  expect(w.saved.get('settings')).toMatchObject({ guard: false, alerts: false, bigTokens: 300000 })
})

test('en: Rückfrage vor kaltem Senden auf Englisch; Cancel verwirft mit englischem Hinweis', async ($, on) => {
  const w = world(on)
  await w.step($, usage(400000, 5000))
  await w.clock.advance(75 * MIN)
  w.setAnswer('Cancel')
  const r = await $.prompt.submit(userPrompt('go on'))
  expect(r.drop).toContain('cancelled')
  expect(w.asks[0].question).toBe(
    'The cache has been cold for 15 min. Sending rewrites 405k tokens (≈ $3.24 API value; warm it would be ≈ $0.08). Compacting also reads everything once and saves little now. How to continue?',
  )
  expect(w.asks[0].options).toEqual(['Send anyway', 'Compact first', 'Cancel'])
  expect(w.toasts.some((t) => t.startsWith('Not sent.'))).toBe(true)
  w.setAnswer('Send anyway')
  expect(await $.prompt.submit(userPrompt('again'))).toMatchObject({ text: 'again' })
})

test('en: Hinweis kurz vor Ablauf auf Englisch', async ($, on) => {
  const w = world(on)
  await w.step($, usage(300000, 5000))
  const ui = await $.ui.mount(band('desktop'))
  await w.clock.advance(56 * MIN)
  await w.clock.advance(30000)
  const hint = w.toasts.find((t) => t.startsWith('Cache expires in'))
  expect(hint).toContain('305k context, rewrite ≈ $2.44')
  expect(hint).toContain('/keepwarm')
  await ui.unmount()
})

const HANDOFF_EN = `# Handoff: Test\n\n## Task\n${'One sentence with content. '.repeat(15)}\n\n## Next\nGo on.`
const HANDOFF_DE = `# Übergabe: Test\n\n## Auftrag\n${'Ein Satz mit Inhalt. '.repeat(15)}\n\n## Weiter mit\nWeiter.`

test('en: /handoff startet den Skill mit Sprache en, fängt die englische Übergabe ab und startet den neuen Chat', async ($, on) => {
  const w = world(on)
  w.setAnswer('New chat with handoff')
  expect((await $.command.run({ command: 'handoff', args: '' } as never)).text).toContain('Writing the handoff')
  await w.clock.advance(1000)
  expect(w.runs).toContainEqual({ command: 'limit-bars:uebergabe', args: 'en' })
  const t = await w.step($, usage(400000, 5000), false)
  await $.turn.complete({ turnId: t, answer: `Here it is.\n\n${HANDOFF_EN}`, durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  await w.clock.advance(1000)
  expect(w.asks[0].question.startsWith('Handoff ready.')).toBe(true)
  expect(w.asks[0].options).toEqual(['New chat with handoff', 'Keep working here'])
  expect(w.runs.some((r) => r.command === 'clear')).toBe(true)
  expect(w.sent[0].startsWith('Handoff from my previous chat:\n\n# Handoff: Test')).toBe(true)
  expect(w.toasts).toContain('New chat started with the handoff. The old chat stays reachable via /resume.')
  // show und das deutsche Alias zeigen
  expect((await $.command.run({ command: 'handoff', args: 'show' } as never)).text).toContain('Last handoff (10:00):\n\n# Handoff: Test')
  expect((await $.command.run({ command: 'handoff', args: 'zeigen' } as never)).text).toContain('# Handoff: Test')
})

test('de: /handoff gibt dem Skill die Sprache de mit; eine ältere englische Übergabe wird ebenso erkannt', DE, async ($, on) => {
  const w = world(on)
  w.setAnswer(null)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await w.clock.advance(1000)
  expect(w.runs).toContainEqual({ command: 'limit-bars:uebergabe', args: 'de' })
  let t = await w.step($, usage(400000, 5000), false)
  await $.turn.complete({ turnId: t, answer: `Bitte:\n\n${HANDOFF_DE}`, durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  await w.clock.advance(1000)
  expect(w.toasts).toContain('Übergabe gespeichert. Später: /handoff continue (leert den Chat) oder /handoff show.')
  expect((w.saved.get('handoffs') as { text: string }[])[0].text.startsWith('# Übergabe: Test')).toBe(true)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await w.clock.advance(1000)
  t = await w.step($, usage(400000, 5000), false)
  await $.turn.complete({ turnId: t, answer: `Vorrede.\n\n${HANDOFF_EN}`, durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  await w.clock.advance(1000)
  expect((w.saved.get('handoffs') as { text: string }[])[0].text.startsWith('# Handoff: Test')).toBe(true)
})

test('en: /handoff continue und das Alias weiter setzen die gespeicherte Übergabe ein', async ($, on) => {
  const w = world(on)
  w.saved.set('handoffs', [{ at: NOW, session: 'alt', text: HANDOFF_EN }])
  expect((await $.command.run({ command: 'handoff', args: 'continue' } as never)).text).toBe('Clearing the chat and continuing with the handoff.')
  await w.clock.advance(1000)
  expect(w.sent.length).toBe(1)
  expect((await $.command.run({ command: 'handoff', args: 'weiter' } as never)).text).toBe('Clearing the chat and continuing with the handoff.')
  await w.clock.advance(1000)
  expect(w.sent.length).toBe(2)
})

test('en: /keepwarm auf Englisch; off und das Alias aus schalten ab', async ($, on) => {
  const w = world(on)
  expect((await $.command.run({ command: 'keepwarm', args: '' } as never)).text).toBe('No request in this chat yet, so nothing to keep warm.')
  await w.step($, usage(400000, 5000))
  const r = await $.command.run({ command: 'keepwarm', args: '9' } as never)
  expect(r.text).toContain('Keep-warm on until 14:00 (at most 4 h)')
  expect(r.text).toContain('≈ $0.08 API value per ping at 405k context')
  expect(r.text).toContain('Off: /keepwarm off')
  expect((await $.command.run({ command: 'keepwarm', args: 'off' } as never)).text).toBe('Keep-warm off.')
  expect(w.toasts.some((t) => t.startsWith('Keep-warm off (turned off). 0 ping(s), ≈ $0 API value.'))).toBe(true)
  await $.command.run({ command: 'keepwarm', args: '1' } as never)
  expect((await $.command.run({ command: 'keepwarm', args: 'aus' } as never)).text).toBe('Keep-warm off.')
  expect((await $.command.run({ command: 'keepwarm', args: 'x' } as never)).text).toBe('Usage: /keepwarm [hours|off], at most 4 h. → `/bars help`')
})
