import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import {
  aggregate,
  callCost,
  partLabel,
  cleanPlan,
  cleanRec,
  cleanRemote,
  dayBefore,
  dayKey,
  isoWeek,
  limKey,
  limitsOf,
  limitsReport,
  modelKey,
  modelName,
  newRec,
  parsePlan,
  planMonth,
  priceFor,
  projectOf,
  projectionText,
  summaryText,
  titleFromPrompt,
  weekStart,
  HELP_WORDS,
  OFF_WORDS,
  RANGE_WORDS,
  TODAY_WORDS,
  VIEW_WORDS,
  cleanSettings,
  ledgerHelp,
  planWords,
} from '../hooks/logic.ts'
import { T, clock, dateTime, duration, factor, fullDate, langOf, pct, rangeLabel, resetTime, shortDate, span, tokens, usd, weekLabel } from '../hooks/i18n.ts'
import { modelColors, stackedBar } from '../hooks/view.ts'
import { helpMarkdown, helpTree, stateText } from '../hooks/help.ts'
import type { Rec } from '../hooks/logic.ts'

const NOW = new Date(2026, 9, 6, 12, 0).getTime() // 06.10.2026 12:00 lokal
const DAY = 24 * 60 * 60 * 1000
const TODAY = dayKey(NOW)
const ROOT = 'D:\\Dev\\ClaudeMods'

type W = {
  saved?: Map<string, unknown>
  cost?: number | null // null: Host ohne Kostenbuch
  surfaces?: string[]
  root?: string
  repoName?: string | null
  remote?: string
  answer?: string | null // Antwort auf $.ui.ask; null: Dialog abgelehnt (wie in -p)
}

/** Argumente des letzten `/ledger`-Aufrufs; `mountLedger` gibt sie wie die echte Zeile als `props.args` mit. */
let lastArgs = ''

function world(on: On, o: W = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const st = {
    cost: o.cost === undefined ? 0 : o.cost,
    setFails: false,
    logs: [] as string[],
    asks: [] as string[][],
    turn: 0,
    ctx: undefined as number | undefined,
    rl: [] as { kind: string; percentUsed: number; resetsAt?: string }[],
    usageCalls: 0,
    sets: 0,
    keysFail: false,
  }
  on('session.usage', () => {
    st.usageCalls++
    return {
      value: { startedAt: NOW, context: { window: 1000000, ...(st.ctx === undefined ? {} : { percent: st.ctx }) }, rateLimits: st.rl, ...(st.cost === null ? {} : { cost: { usd: st.cost } }) } as never,
    }
  })
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  on('session.root', () => ({ value: o.root ?? ROOT }))
  on('session.repo', () => ({ value: (o.repoName || o.remote ? { root: ROOT, remote: o.remote ?? null, internal: false, name: o.repoName ?? null } : null) as never }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    // Ein werfender Stub wird übersprungen; ohne weitere Antwort scheitert der Aufruf (docs/raw/en/test.md:182)
    if (st.setFails) throw new Error('Speicher voll')
    st.sets++
    saved.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => {
    if (st.keysFail) throw new Error('kaputt')
    return { value: [...saved.keys()] }
  })
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    st.logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: '' }
    const q = (e as unknown as { questions: { question: string; options: { label: string }[] }[] }).questions[0]!
    st.asks.push(q.options.map((x) => x.label))
    if (o.answer === null) return { deny: 'abgelehnt' }
    return { result: { answers: { [q.question]: o.answer ?? 'Abbrechen (empfohlen)' } } }
  })
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('turn.complete', () => ({ text: 'ENGINE' }))
  on('session.end', ($, e) => ({ sessionId: 'x' }) as never)
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [`ENGINE:${String((e.props as { text?: string }).text ?? '')}`] }))

  return {
    clock,
    saved,
    st,
    rec: (id = 'S1') => saved.get(`s:${id}`) as Rec | undefined,
    sum: (id = 'S1') => Object.values((saved.get(`s:${id}`) as Rec | undefined)?.days ?? {}).reduce((a, b) => a + b, 0),
    /** Prozessstart: classic.SessionStart kommt vor session.start (Probe Phase 0). */
    async start($: any, id = 'S1', source = 'startup', title?: string) {
      await $.classic.SessionStart({ source, session_id: id, ...(title ? { session_title: title } : {}) })
      return $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    },
    async turn($: any, cost: number | null, extra: Record<string, unknown> = {}) {
      st.cost = cost
      st.turn++
      const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
      return $.turn.complete({ turnId: `t${st.turn}`, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage, ...extra })
    },
    async ledger($: any, args = '') {
      lastArgs = args // die Zeile trägt die Argumente des Aufrufs (CommandOutput props.args)
      return (await $.command.run({ command: 'ledger', args })).text as string
    },
  }
}

// Die bisherigen Tests prüfen Fynns Ansicht (Deutsch); eigene Tests decken Englisch (Standard) ab
const DE = { options: { language: 'de' } } as const

const near = (a: number, b: number) => expect(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`).toBe(true)

// ---------- Erfassung ----------

test('turn.complete bucht die Differenz: 0,10 → 0,25 → 0,40 ergibt 0,15 und dann 0,30', DE, async ($, on) => {
  const w = world(on, { cost: 0.1 })
  await w.start($)
  const r = await w.turn($, 0.25)
  expect(r).toEqual({ text: 'ENGINE' }) // Ergebnis der Engine unverändert
  near(w.rec()!.days[TODAY]!, 0.15)
  await w.turn($, 0.4)
  near(w.rec()!.days[TODAY]!, 0.3)
  expect(w.rec()).toMatchObject({ v: 1, project: 'ClaudeMods', kind: 'terminal', c: 0.4 })
})

test('Zähler fällt (0,40 → 0,05): Buchung 0,05, nie negativ', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 0.4)
  await w.turn($, 0.05)
  near(w.sum(), 0.45)
})

test('Resume: session.start mit usage 2,00 und vorhandenem Datensatz → keine Doppelbuchung', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['s:S1', { ...newRec({ project: 'ClaudeMods', root: ROOT, title: 'Alt', kind: 'terminal' }, NOW - DAY, 2), days: { [dayBefore(NOW, 1)]: 2 } }]])
  const w = world(on, { saved, cost: 2 })
  await w.start($, 'S1', 'resume')
  await w.turn($, 2.1)
  near(w.sum(), 2.1)
  near(w.rec()!.days[TODAY]!, 0.1)
  expect(w.rec()!.title).toBe('Alt')
})

test('Resume nach hartem Ende: fehlender Rest seit der letzten Buchung wird nachgebucht, nichts doppelt', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['s:S1', { ...newRec({ project: 'P', root: ROOT, title: '', kind: 'terminal' }, NOW - DAY, 1.8), days: { [TODAY]: 1.8 } }]])
  const w = world(on, { saved, cost: 2 })
  await w.start($, 'S1', 'resume')
  await w.turn($, 2)
  near(w.sum(), 2)
})

test('/clear: session.end bucht den alten Chat, danach neue Session ab 0', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 0.3)
  w.st.cost = 0.35 // Rest nach dem letzten Turn
  await $.session.end({ reason: 'clear' } as never)
  w.st.cost = 0 // Zähler beginnt nach /clear bei 0 (Probe Phase 0)
  await $.classic.SessionStart({ source: 'clear', session_id: 'S2' })
  await w.turn($, 0.05)
  near(w.sum('S1'), 0.35)
  near(w.sum('S2'), 0.05)
})

test('Resume mitten im Prozess: Baseline aus dem Datensatz der neuen Session', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['s:OLD', { ...newRec({ project: 'P', root: ROOT, title: 'Alter Chat', kind: 'terminal' }, NOW - DAY, 1), days: { [dayBefore(NOW, 1)]: 1 } }]])
  const w = world(on, { saved })
  await w.start($)
  await w.turn($, 0.2)
  await $.classic.SessionStart({ source: 'resume', session_id: 'OLD' })
  await w.turn($, 1.25) // Zähler des fortgesetzten Chats: 1,00 + 0,25
  near(w.sum('S1'), 0.2)
  near(w.sum('OLD'), 1.25)
})

test('Reload des Moduls: nur session.start, Session-ID kommt mit dem nächsten Prompt; Lücke wird nachgebucht (Review B1)', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['s:S1', { ...newRec({ project: 'P', root: ROOT, title: 'Lauf', kind: 'terminal' }, NOW, 1), days: { [TODAY]: 1 } }]])
  const w = world(on, { saved, cost: 1.3 })
  // Nach einem Reload feuert classic.SessionStart nicht (types:4173-4178)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await w.turn($, 1.4) // noch keine Session-ID: nichts gebucht, nichts kaputt
  near(w.sum(), 1)
  await $.classic.UserPromptSubmit({ prompt: 'weiter', session_id: 'S1' } as never)
  await w.turn($, 1.5)
  near(w.sum(), 1.5)
  expect(w.rec()!.title).toBe('Lauf')
})

test('compact (gleiche ID) und Branch (neue ID) mitten im Prozess', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 0.5)
  await $.classic.SessionStart({ source: 'compact', session_id: 'S1' })
  await w.turn($, 0.7)
  near(w.sum(), 0.7)
  await $.classic.SessionStart({ source: 'fork', session_id: 'S3' })
  await w.turn($, 0.9) // Branch ohne Datensatz: Baseline = aktueller Stand, nichts doppelt
  await w.turn($, 1)
  near(w.sum('S1'), 0.7)
  near(w.sum('S3'), 0.1)
})

test('Fehlerpfad: session.end mit werfendem store.set → Ende läuft weiter', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.setFails = true
  w.st.cost = 0.4
  expect(await $.session.end({ reason: 'other' } as never)).toEqual({ sessionId: 'x' })
})

test('Tageswechsel (mock.clock): Buchung landet auf dem neuen Datum', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 1)
  await w.clock.advance(DAY)
  await w.turn($, 1.5)
  near(w.rec()!.days[TODAY]!, 1)
  near(w.rec()!.days[dayKey(NOW + DAY)]!, 0.5)
})

test('Titel aus classic.SessionStart und UserPromptSubmit; Fallback „Chat vom …“', DE, async ($, on) => {
  const w = world(on)
  await w.start($, 'S1', 'startup', 'Erster Titel')
  await w.turn($, 0.1)
  expect(w.rec()!.title).toBe('Erster Titel')
  await $.classic.UserPromptSubmit({ prompt: 'x', session_id: 'S1', session_title: 'Neuer Titel' } as never)
  await w.turn($, 0.1) // nur Titel geändert → wird trotzdem geschrieben
  expect(w.rec()!.title).toBe('Neuer Titel')
  const untitled = aggregate([{ id: 'X', rec: newRec({ project: 'P', root: '', title: '', kind: 'terminal' }, NOW, 0) }], NOW, {})
  expect(untitled.total).toBe(1)
})

test('-p (keine Surface) wird als Skript-Lauf gebucht, ohne Namen aus dem Prompt', DE, async ($, on) => {
  const w = world(on, { surfaces: [] })
  await w.start($)
  await $.classic.UserPromptSubmit({ prompt: 'Skript-Auftrag mit fremdem Text', session_id: 'S1', source: 'sdk' } as never)
  await w.turn($, 0.02)
  expect(w.rec()!.kind).toBe('script')
  expect(w.rec()!.title).toBe('')
  expect(await w.ledger($)).toMatch(/Skript-Läufe/)
})

test('Projekt: Repo-Name, sonst Ordner; Worktree zählt zum Hauptordner', () => {
  expect(projectOf('fynn-mods', ROOT)).toBe('fynn-mods')
  expect(projectOf(null, `${ROOT}\\.claude\\worktrees\\untitled-session-3ebcf8`)).toBe('ClaudeMods')
  expect(projectOf(null, '/home/fynn/Handy')).toBe('Handy')
})

// ---------- Chat-Name aus der ersten Nachricht ----------

test('Chat-Name: erste eigene Nachricht, gekürzt; Befehle und System-Prompts zählen nicht; session_title gewinnt', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.classic.UserPromptSubmit({ prompt: '/ledger', session_id: 'S1', source: 'user' } as never)
  await $.classic.UserPromptSubmit({ prompt: '<task-notification>fertig</task-notification>', session_id: 'S1', source: 'system' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'Weckauftrag', session_id: 'S1', source: 'loop_wakeup' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'Baue mir bitte einen Mod,\n der alle Kosten über alle Chats und Projekte zählt', session_id: 'S1', source: 'sdk' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'Zweite Nachricht', session_id: 'S1', source: 'sdk' } as never)
  await w.turn($, 0.1)
  expect(w.rec()!.title).toBe('Baue mir bitte einen Mod, der alle Kosten über al…')
  await $.classic.UserPromptSubmit({ prompt: 'x', session_id: 'S1', session_title: 'Kostenbuch-Mod' } as never)
  await w.turn($, 0.2)
  expect(w.rec()!.title).toBe('Kostenbuch-Mod')
})

test('titleFromPrompt und Modellnamen', () => {
  expect(titleFromPrompt('  kurz  ')).toBe('kurz')
  expect(titleFromPrompt('/cost')).toBe('')
  expect(titleFromPrompt('<x>')).toBe('')
  expect(titleFromPrompt(undefined)).toBe('')
  expect(modelKey('claude-opus-5-5')).toBe('opus-5-5')
  expect(modelKey('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  expect(modelKey('opus[1m]')).toBe('opus-5-5')
  expect(modelKey('haiku')).toBe('haiku-5-5') // Alias seit CC 2.1.293 (Nachtrag 0.6.0)
  expect(modelKey('gpt-x')).toBe('gpt-x')
  expect(modelKey('')).toBe('unbekannt')
  expect(modelName('opus-5-5', 'de')).toBe('Opus 5.5')
  expect(modelName('haiku-4-5', 'de')).toBe('Haiku 4.5')
  expect(modelName('haiku', 'de')).toBe('Haiku')
  expect(modelName('unbekannt', 'de')).toBe('Unbekannt')
})

// ---------- Mod-Aufrufe ----------

const sidekick = {
  name: 'sidekick',
  register(on: On) {
    on('command.run', { command: 'probe' }, async ($, e) => {
      if (e.args === 'fork') {
        const r = await $.model.fork({ prompt: 'x' })
        return { text: `fork:${r.isAnswered}` }
      }
      if (e.args === 'classify') return { text: `classify:${await $.model.classify('x', ['a', 'b'])}` }
      try {
        const r = await $.model.complete({ model: e.args.startsWith('model:') ? e.args.slice(6) : 'haiku', prompt: 'x' })
        return { text: `complete:${r.isAnswered ? r.text : r.reason}` }
      } catch (err) {
        return { text: `denied:${String((err as Error).message ?? err)}` }
      }
    })
  },
}
const MILLION_IN = { input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const MILLION_OUT = { input_tokens: 0, output_tokens: 1000000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('model.complete von sidekick@inline: Mod sidekick, Betrag nach Preistabelle, Ergebnis unverändert', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: MILLION_IN } as never }))
  await w.start($)
  const out = await $.command.run({ command: 'probe', args: '' })
  expect(out.text).toBe('complete:OK')
  const m = w.rec()!.mods.sidekick!.days[TODAY]!
  expect(m.calls).toBe(1)
  near(m.usd, 0.5) // Alias haiku = Haiku 5.5; 1 Mio. Prompt-Tokens > 100k: fünffach, 0,50 $
  expect(w.sum()).toBe(0) // Mod-Kosten stecken nicht in den Chat-Kosten (Probe Phase 0)
})

test('model.complete abgelehnt ({deny}): nichts gebucht, Ablehnung kommt unverändert beim Aufrufer an', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.complete', () => ({ deny: 'kein Modell' }))
  await w.start($)
  expect((await $.command.run({ command: 'probe', args: '' })).text).toMatch(/^denied:.*kein Modell/)
  expect(w.rec()).toBeUndefined()
})

test('model.fork nutzt das Modell der Hauptschleife; model.classify zählt nur', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: 'F', usage: MILLION_OUT } as never }))
  on('model.classify', () => ({ value: 'a' }))
  await w.start($)
  await w.turn($, 0, { usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' } })
  // Ein Subagent-Turn ändert das Fork-Modell nicht
  await w.turn($, 0, { agentId: 'a1', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5-20251001' } })
  expect((await $.command.run({ command: 'probe', args: 'fork' })).text).toBe('fork:true')
  expect((await $.command.run({ command: 'probe', args: 'classify' })).text).toBe('classify:a')
  const m = w.rec()!.mods.sidekick!.days[TODAY]!
  expect(m.calls).toBe(2)
  near(m.usd, 10) // Sonnet 5.5: 10 $ je Million Output; classify ohne Betrag
})

test('model.fork „nothing-to-fork“ zählt nicht; model.complete ohne Antwort, aber mit usage, zählt mit Betrag', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } as never }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: MILLION_IN } as never }))
  await w.start($)
  expect((await $.command.run({ command: 'probe', args: 'fork' })).text).toBe('fork:false')
  expect(w.rec()).toBeUndefined()
  expect((await $.command.run({ command: 'probe', args: '' })).text).toBe('complete:empty-reply')
  near(w.rec()!.mods.sidekick!.days[TODAY]!.usd, 0.5) // „usage rides every arm“ (types ModelCompleteResult)
})

test('Preistabelle: Alias, volle ID, unbekannt → Opus 5.5', () => {
  expect(priceFor('haiku').id).toBe('haiku-5-5')
  expect(priceFor('claude-haiku-4-5-20251001').id).toBe('haiku-4-5')
  expect(priceFor('opus[1m]').id).toBe('opus-5-5')
  expect(priceFor('claude-opus-5').id).toBe('opus-5')
  expect(priceFor('???').id).toBe('opus-5-5')
  near(callCost({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }, 'haiku'), 0.01 + 0.125)
})

test('0.4.3: Preise Haiku 5.5 und Sonnet 5.5, Stufe über 100k Prompt-Tokens', () => {
  const h = priceFor('claude-haiku-5-5')
  expect([h.id, h.input, h.output, h.read]).toEqual(['haiku-5-5', 0.1, 0.5, 0.01])
  expect(priceFor('haiku').id).toBe('haiku-5-5') // seit CC 2.1.293 Haiku 5.5 (bis 2.1.291: 4.5)
  expect(priceFor('claude-sonnet-5-5').read).toBe(0.1)
  const h4 = priceFor('claude-haiku-4-5-20251001')
  expect([h4.id, h4.input, h4.output, h4.read, h4.long]).toEqual(['haiku-4-5', 1, 5, 0.1, undefined])
  // 120 000 Prompt-Tokens (davon Cache) → fünffach, auch die Ausgabe; genau 100 000 → normale Stufe
  const over = { input_tokens: 20_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 10_000, output_tokens: 1_000 }
  const base = (20_000 * 0.1 + 90_000 * 0.01 + 10_000 * 0.125 + 1_000 * 0.5) / 1e6
  near(callCost(over, 'claude-haiku-5-5', true), 5 * base)
  near(callCost(over, 'claude-haiku-5-5'), base) // Summe über mehrere Antworten (Turn, Fork): keine Stufe (Review B1)
  const at = { input_tokens: 100_000, output_tokens: 1_000 }
  near(callCost(at, 'claude-haiku-5-5', true), (100_000 * 0.1 + 1_000 * 0.5) / 1e6)
  near(callCost({ input_tokens: 100_001 }, 'claude-haiku-5-5', true), (5 * 100_001 * 0.1) / 1e6)
  // andere Modelle ohne Stufe
  near(callCost({ input_tokens: 500_000 }, 'claude-haiku-4-5'), 0.5)
  near(callCost({ cache_read_input_tokens: 1_000_000 }, 'claude-sonnet-5-5'), 0.1)
  expect(modelKey('claude-haiku-5-5')).toBe('haiku-5-5')
  expect(modelName(modelKey('claude-haiku-5-5'), 'de')).toBe('Haiku 5.5')
  expect(modelName(modelKey('haiku'), 'de')).toBe('Haiku 5.5')
})

test('0.4.3: Stufe nur bei Einzelaufrufen; Turn-Summe über 100k bleibt normal (Review B1)', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  const big = { input_tokens: 20_000, output_tokens: 0, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 }
  const usd = (20_000 * 0.1 + 100_000 * 0.01) / 1e6 // 0,003 $ normale Stufe
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: big } as never }))
  await w.start($)
  await w.turn($, 1, { usage: U('claude-haiku-5-5', 20_000, 0, 100_000) }) // Summe mehrerer Antworten
  near(w.rec()!.models['haiku-5-5']!.days[TODAY]!.usd, usd)
  await $.command.run({ command: 'probe', args: 'model:claude-haiku-5-5' }) // eine Anfrage mit 120k Prompt
  near(w.rec()!.modModels['haiku-5-5']!.days[TODAY]!.usd, 5 * usd)
  near(w.rec()!.mods.sidekick!.days[TODAY]!.usd, 5 * usd)
})

// ---------- Modelle ----------

const U = (model: string, inp: number, out: number, cr = 0, cw = 0) => ({ input_tokens: inp, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, model })

test('/ledger models: Tokens je Modell aus Turns, Subagents und Mod-Aufrufen; sortiert nach Betrag', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: MILLION_IN } as never }))
  await w.start($)
  await w.turn($, 1, { usage: U('claude-opus-5-5', 1000, 50000, 2000000, 100000) })
  await w.turn($, 1.2, { usage: U('claude-opus-5-5', 500, 10000) })
  await w.turn($, 1.3, { agentId: 'a1', usage: U('claude-haiku-5-5', 200, 3000) })
  await $.command.run({ command: 'probe', args: '' }) // sidekick: Alias haiku = Haiku 5.5, 1M Input
  const m = w.rec()!.models
  expect(m['opus-5-5']!.days[TODAY]).toMatchObject({ in: 1500, out: 60000, cr: 2000000, cw: 100000, n: 2 })
  expect(m['haiku-5-5']!.days[TODAY]!.n).toBe(1) // Subagent
  expect(w.rec()!.modModels['haiku-5-5']!.days[TODAY]!.n).toBe(1) // sidekick, getrennt (ab 0.3.0)
  expect(w.rec()!.mods.sidekick!.days[TODAY]).toMatchObject({ calls: 1, in: 1000000 })
  const text = await w.ledger($, 'models')
  expect(text).toMatch(/Opus 5\.5: .*2× · Input 1,5k · Output 60k · Cache 2,0M gelesen, 100k geschrieben/)
  expect(text).toMatch(/Haiku 5\.5: .*2×/) // Modellsicht zählt Chat und Mods zusammen
  expect(text.indexOf('Opus 5.5') < text.indexOf('Haiku 5.5')).toBe(true) // Opus ≈ 2,3 $, Haiku ≈ 0,50 $
  expect(text.split('\n').length <= 10).toBe(true)
})

test('/ledger models 7: ältere Tage zählen nicht; UI zeigt Modelle mit Anteil', DE, async ($, on) => {
  const old = recOf('P', { [dayBefore(NOW, 20)]: 1 }, { models: { 'sonnet-5-5': { days: { [dayBefore(NOW, 20)]: { in: 1, out: 1, cr: 0, cw: 0, usd: 5, n: 3 } } } } })
  const w = world(on, { saved: new Map<string, unknown>([['s:OLD', old]]) })
  await w.start($)
  await w.turn($, 0.5, { usage: U('claude-opus-5-5', 1000, 1000) })
  const text = await w.ledger($, 'models 7')
  expect(text).toMatch(/Opus 5\.5/)
  expect(text).not.toMatch(/Sonnet/)
  const ui = await mountLedger($, text, 'desktop')
  expect(await ui.find({ type: 'Text', text: 'Modelle · 7 Tage' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '100 %' })).toBeDefined()
  expect(await ui.find({ text: /^Input 1,0k · Output 1,0k/ })).toBeDefined()
  await ui.unmount()
})

// ---------- Vorsorglich gesammelte Daten (0.3.0) ----------

test('Aktivität, Stunden, Limits und Kontext werden je Tag gesammelt', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.ctx = 42
  w.st.rl = [{ kind: 'five_hour', percentUsed: 12.34 }, { kind: 'seven_day', percentUsed: 40 }]
  await w.turn($, 0.5, { durationMs: 2000 })
  w.st.ctx = 30
  w.st.rl = [{ kind: 'five_hour', percentUsed: 10 }]
  await w.turn($, 1.5, { durationMs: 3000 })
  await w.turn($, 1.6, { agentId: 'a1', durationMs: 999 })
  await w.turn($, 1.6, { reason: 'aborted', isAborted: true, durationMs: 100 })
  await w.turn($, 1.6, { reason: 'error', durationMs: 50 })
  const r = w.rec()!
  expect(r.act[TODAY]).toEqual({ turns: 4, sub: 1, ms: 5150, abort: 1, err: 1, maxTurn: 1, ctx: 42 })
  near(r.hours[TODAY]!['12']!, 1.6)
  expect(r.rl[TODAY]).toEqual({ five_hour: 12.3, seven_day: 40 })
  expect(r.remote).toBe('')
})

test('Git-Remote ohne Zugangsdaten (Review 4 S1)', DE, async ($, on) => {
  expect(cleanRemote('https://fynn:ghp_SECRET123@github.com/FynnXland/ClaudeMods.git')).toBe('github.com/FynnXland/ClaudeMods')
  expect(cleanRemote('git@github.com:FynnXland/ClaudeMods.git')).toBe('github.com/FynnXland/ClaudeMods')
  expect(cleanRemote('ssh://git@host:22/a/b.git?token=x#y')).toBe('host:22/a/b')
  expect(cleanRemote(null)).toBe('')
  // Auch im gespeicherten Datensatz und beim Lesen eines alten
  const w = world(on, { repoName: 'r', remote: 'https://u:tok@github.com/o/r.git' })
  await w.start($)
  await w.turn($, 0.1)
  expect(w.rec()!.remote).toBe('github.com/o/r')
  expect(JSON.stringify(w.saved.get('s:S1'))).not.toMatch(/tok/)
  expect(cleanRec({ ...w.rec()!, remote: 'https://a:b@h/x' })!.remote).toBe('h/x')
})

test('cleanRec: Hin- und Rückweg der 0.3.0-Felder', () => {
  const r = newRec({ project: 'P', root: '', title: 'T', kind: 'desktop', remote: 'github.com/o/r' }, NOW, 1)
  r.days[TODAY] = 1
  r.mods.sidekick = { days: { [TODAY]: { usd: 0.1, calls: 2, in: 10, out: 5, cr: 3, cw: 1 } } }
  r.models['opus-5-5'] = { days: { [TODAY]: { in: 1, out: 2, cr: 3, cw: 4, usd: 0.5, n: 1 } } }
  r.modModels['haiku-4-5'] = { days: { [TODAY]: { in: 5, out: 6, cr: 7, cw: 8, usd: 0.01, n: 2 } } }
  r.act[TODAY] = { turns: 3, sub: 1, ms: 900, abort: 1, err: 0, maxTurn: 0.4, ctx: 55 }
  r.hours[TODAY] = { '09': 0.6, '14': 0.4 }
  r.rl[TODAY] = { five_hour: 12.5, seven_day: 40 }
  r.lim = { five_hour: { [String(NOW + 3600000)]: { chat: 1.5, mod: 0.25, pct: 42.5, first: NOW - 60000, last: NOW } }, seven_day: {} }
  expect(cleanRec(JSON.parse(JSON.stringify(r)))).toEqual(r)
})

test('Kalenderwochen und Wochenanfang', () => {
  expect(weekStart('2026-10-08')).toBe('2026-10-05')
  expect(weekStart('2026-10-05')).toBe('2026-10-05')
  expect(weekStart('2026-10-04')).toBe('2026-09-28')
  expect(isoWeek('2026-10-05')).toBe(41)
  expect(isoWeek('2025-12-29')).toBe(1) // gehört zu 2026
  expect(isoWeek('2026-12-28')).toBe(53)
})

test('Verlauf: Chat-Kosten je Tag nach Modell-Anteilen geteilt; ohne Modell-Daten „unbekannt“; Wochen summiert', () => {
  const d0 = TODAY
  const d2 = dayBefore(NOW, 2)
  const a = recOf('P', { [d0]: 2, [d2]: 1 }, {
    models: { 'opus-5-5': { days: { [d0]: { in: 0, out: 0, cr: 0, cw: 0, usd: 0.3, n: 1 } } }, 'haiku-4-5': { days: { [d0]: { in: 0, out: 0, cr: 0, cw: 0, usd: 0.1, n: 1 } } } },
  })
  const r = aggregate([{ id: 'A', rec: a }], NOW, {})
  const today = r.series.days[0]!
  expect(today.key).toBe(d0)
  near(today.usd, 2)
  expect(today.parts.map((p) => p.key)).toEqual(['opus-5-5', 'haiku-4-5'])
  near(today.parts[0]!.usd, 1.5)
  expect(r.series.days[2]!.parts).toEqual([{ key: 'unbekannt', usd: 1 }])
  expect(r.series.weeks).toHaveLength(14)
  expect(weekLabel(isoWeek(r.series.weeks[0]!.key), 'de')).toBe('KW 41')
  near(r.series.weeks[0]!.usd, 2) // KW 41: nur der 06.10.
  near(r.series.weeks[1]!.usd, 1) // 04.10. ist Sonntag der KW 40
  expect(weekLabel(isoWeek(r.series.weeks[1]!.key), 'de')).toBe('KW 40')
})

test('Verlauf: Mod-Aufrufe je Modell als eigene Teile; Rest ohne Modell „mod:unbekannt“; auch an Tagen ohne Chat', () => {
  const d0 = TODAY
  const d1 = dayBefore(NOW, 1)
  const md = (usd: number, n = 1) => ({ in: 0, out: 0, cr: 0, cw: 0, usd, n })
  const a = recOf('P', { [d0]: 2 }, {
    models: { 'opus-5-5': { days: { [d0]: md(0.4) } } },
    // sidekick: 0,30 $ heute, davon 0,25 $ mit Modell; gestern nur Mods (alter Stand ohne Modell)
    mods: { sidekick: { days: { [d0]: { usd: 0.3, calls: 3 }, [d1]: { usd: 0.1, calls: 1 } } } },
    modModels: { 'sonnet-5-5': { days: { [d0]: md(0.25, 2) } } },
  })
  const r = aggregate([{ id: 'A', rec: a }], NOW, {})
  const today = r.series.days[0]!
  near(today.usd, 2.3) // Chat 2 + Mods 0,30
  expect(today.parts.map((p) => p.key)).toEqual(['opus-5-5', 'mod:sonnet-5-5', 'mod:unbekannt'])
  near(today.parts[1]!.usd, 0.25)
  near(today.parts[2]!.usd, 0.05)
  expect(r.series.days[1]!.parts).toEqual([{ key: 'mod:unbekannt', usd: 0.1 }])
  near(r.series.weeks[0]!.usd, 2.4)
  expect(summaryText(r, 'weeks', 30, '', 'de')).toMatch(/Wochen \(Chat \+ Mods\): KW 41 2,40 \$/)
  // Farben: Chat-Modelle zuerst, Mod-Teile dahinter, beide „ohne Angabe“ gedimmt
  const colors = modelColors([{ key: d0, usd: 9, parts: [{ key: 'mod:opus-5-5', usd: 5 }, { key: 'haiku-4-5', usd: 1 }, { key: 'mod:unbekannt', usd: 1 }, { key: 'unbekannt', usd: 2 }] }])
  expect([...colors.entries()]).toEqual([['haiku-4-5', 'claude'], ['mod:opus-5-5', 'suggestion'], ['unbekannt', 'inactive'], ['mod:unbekannt', 'inactive']])
  expect(partLabel('mod:sonnet-5-5', 'de')).toBe('Sonnet 5.5 · Mods')
  expect(partLabel('mod:sonnet-5-5', 'en')).toBe('Sonnet 5.5 · mods')
  expect(partLabel('mod:unbekannt', 'de')).toBe('Mods ohne Angabe')
  expect(partLabel('opus-5-5', 'de')).toBe('Opus 5.5')
  expect(partLabel('unbekannt', 'de')).toBe('ohne Angabe')
  // Rundungsrest aus r8 ergibt keinen eigenen Teil
  const b = recOf('P', {}, { mods: { x: { days: { [d0]: { usd: 0.1, calls: 1 } } } }, modModels: { 'haiku-4-5': { days: { [d0]: md(0.0999999995) } } } })
  expect(aggregate([{ id: 'B', rec: b }], NOW, {}).series.days[0]!.parts.map((p) => p.key)).toEqual(['mod:haiku-4-5'])
})

test('stackedBar Terminal: Zellen nach größtem Rest, Summe stimmt', () => {
  const b = stackedBar('terminal', 1, 10, [{ color: 'claude', share: 0.55 }, { color: 'success', share: 0.3 }, { color: 'suggestion', share: 0.15 }]) as any
  const segs = b.children[0].children as any[]
  expect(segs.map((t: any) => t.children[0].length)).toEqual([6, 3, 1])
  const half = stackedBar('terminal', 0.5, 10, [{ color: 'claude', share: 1 }]) as any
  expect(half.children[0].children[0].children[0]).toBe('▄▄▄▄▄')
})

test('/ledger weeks: Übersicht mit 14 Wochen und Legende', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 1, { usage: U('claude-opus-5-5', 100, 100) })
  const text = await w.ledger($, 'weeks')
  expect(text).toMatch(/Wochen \(Chat \+ Mods\): KW 41 1,00 \$/)
  const ui = await mountLedger($, text, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Letzte 14 Wochen' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^KW \d+$/ })).toHaveLength(14)
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ text: /neu laden: \/ledger weeks/ })).toBeDefined()
  await ui.unmount()
  // Desktop: gestapelte Prozent-Boxen, Summe 100 %
  const d = await mountLedger($, text, 'desktop')
  expect(await d.find({ type: 'Text', text: 'Letzte 14 Wochen' })).toBeDefined()
  const seg = (await d.findAll({ type: 'Box' })).filter((b: any) => b.props.backgroundColor === 'claude')
  expect(seg.length > 0 && seg.every((b: any) => b.props.width === '100%')).toBe(true) // ein Modell = ein voller Teil
  await d.unmount()
  // Hinweis mit Zeitraum
  const c7 = await mountLedger($, await w.ledger($, 'chats 7'), 'terminal')
  expect(await c7.find({ text: /neu laden: \/ledger chats 7/ })).toBeDefined()
  await c7.unmount()
})

// ---------- Fehlerpfade ----------

test('Fehlerpfad: $.store.set wirft → turn.complete gibt das Ergebnis unverändert zurück, Fehler im Debug-Log', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.setFails = true
  expect(await w.turn($, 0.5)).toEqual({ text: 'ENGINE' })
  expect(w.st.logs.some((l) => /Buchen/.test(l))).toBe(true)
  // Nichts verloren: Beim nächsten Schreiben steht der volle Betrag drin
  w.st.setFails = false
  await w.turn($, 0.6)
  near(w.sum(), 0.6)
})

test('Fehlerpfad: Mod-Aufruf und Store-Fehler → Ergebnis kommt unverändert an', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: MILLION_IN } as never }))
  await w.start($)
  w.st.setFails = true
  expect((await $.command.run({ command: 'probe', args: '' })).text).toBe('complete:OK')
})

test('Fehlerpfad: usage() ohne cost → keine Buchung, /ledger nennt den Grund', DE, async ($, on) => {
  const w = world(on, { cost: null })
  await w.start($)
  await w.turn($, null)
  expect(w.rec()!.days).toEqual({}) // keine Chat-Buchung; die Tokens je Modell zählen trotzdem
  expect(Object.keys(w.rec()!.models)).toEqual(['opus-5-5'])
  expect(await w.ledger($)).toMatch(/liefert keine Chat-Kosten/)
})

test('Fehlerpfad: unlesbarer Datensatz wird übersprungen und gemeldet', DE, async ($, on) => {
  const saved = new Map<string, unknown>([['s:BAD', { v: 99 }]])
  const w = world(on, { saved })
  await w.start($)
  await w.turn($, 1)
  const text = await w.ledger($)
  expect(text).toMatch(/1 Eintrag unlesbar/)
  expect(text).toMatch(/heute 1,00 \$/)
})

// ---------- Aggregation und Text ----------

function recOf(project: string, days: Record<string, number>, o: Partial<Rec> = {}): Rec {
  return { ...newRec({ project, root: '', title: o.title ?? '', kind: o.kind ?? 'terminal' }, NOW - 20 * DAY, 0), days, ...o }
}

test('Aggregation: 3 Sessions in 2 Projekten über 20 Tage', () => {
  const d = (n: number) => dayBefore(NOW, n)
  const recs = [
    { id: 'A', rec: recOf('ClaudeMods', { [d(0)]: 1, [d(5)]: 2, [d(19)]: 4 }, { title: 'Orchestrator' }) },
    { id: 'B', rec: recOf('ClaudeMods', { [d(1)]: 0.5 }, { title: 'Worklist', mods: { sidekick: { days: { [d(0)]: { usd: 0.2, calls: 3 }, [d(40)]: { usd: 1, calls: 1 } } } } }) },
    { id: 'C', rec: recOf('Handy', { [d(10)]: 3 }, { title: 'Handy-App' }) },
  ]
  const r = aggregate(recs, NOW, {})
  near(r.windows.today.usd, 1)
  expect(r.windows.today.chats).toBe(1)
  near(r.windows.today.mods, 0.2)
  near(r.windows.d7.usd, 3.5)
  near(r.windows.d30.usd, 10.5)
  near(r.windows.all.usd, 10.5)
  near(r.windows.all.mods, 1.2)
  expect(r.projects.map((p) => p.name)).toEqual(['ClaudeMods', 'Handy'])
  near(r.projects[0]!.usd, 7.5)
  expect(r.chats.map((c) => c.title)).toEqual(['Orchestrator', 'Handy-App', 'Worklist'])
  expect(r.series.days).toHaveLength(14)
  near(r.series.days[5]!.usd, 2)
  expect(r.mods).toEqual([{ name: 'sidekick', usd: 0.2, calls: 3 }])
  const text = summaryText(r, 'overview', 30, '#abc12', 'de')
  expect(text.split('\n').length <= 10).toBe(true)
  expect(text).toMatch(/30 Tage 10,50 \$/)
})

test('Text für Claude bleibt bei vielen Chats und Projekten bei höchstens 10 Zeilen', () => {
  const recs = Array.from({ length: 60 }, (_, i) => ({ id: `S${i}`, rec: recOf(`Projekt${i % 25}`, { [TODAY]: i + 1 }, { title: `Chat ${i}` }) }))
  const r = aggregate(recs, NOW, { range: 0 })
  for (const view of ['overview', 'chats', 'projects'] as const) expect(summaryText(r, view, 0, '#x0000', 'de').split('\n').length <= 10, view).toBe(true)
})

test('Beträge: Komma, 2 Stellen, < 0,01 $', () => {
  expect(usd(4.821, 'de')).toBe('4,82 $')
  expect(usd(0.004, 'de')).toBe('< 0,01 $')
  expect(usd(0, 'de')).toBe('0,00 $')
  expect(usd(1234.5, 'de')).toBe('1.234,50 $')
})

test('cleanRec: falsche Felder fliegen raus, Version muss 1 sein', () => {
  expect(cleanRec(null)).toBeNull()
  expect(cleanRec({ v: 2, days: {}, firstAt: 1, lastAt: 1 })).toBeNull()
  const r = cleanRec({ v: 1, days: { [TODAY]: 1, kaputt: 2, x: 'y' }, firstAt: 1, lastAt: 1, kind: '?', mods: { a: { days: { [TODAY]: { usd: 1, calls: 1 }, b: 3 } } } })!
  expect(r.days).toEqual({ [TODAY]: 1 })
  expect(r.kind).toBe('terminal')
  expect(Object.keys(r.mods.a!.days)).toEqual([TODAY])
})

// ---------- Aufräumen und Reset ----------

test('Aufräumen bei /ledger: älter als keepDays seit der letzten Buchung wird gelöscht, der Rest bleibt', { options: { keepDays: 30, language: 'de' } }, async ($, on) => {
  const old = recOf('P', { [dayBefore(NOW, 40)]: 1 }, { lastAt: NOW - 40 * DAY })
  const fresh = recOf('P', { [dayBefore(NOW, 3)]: 1 }, { lastAt: NOW - 3 * DAY })
  const saved = new Map<string, unknown>([['s:OLD', old], ['s:NEW', fresh]])
  const w = world(on, { saved })
  await w.start($)
  expect(saved.has('s:OLD')).toBe(true) // session.start räumt nicht auf (awaitet, Review S2)
  const text = await w.ledger($)
  expect(saved.has('s:OLD')).toBe(false)
  expect(saved.has('s:NEW')).toBe(true)
  expect(text).toMatch(/gesamt 1,00 \$/)
})

test('Speicher fast voll und Schreibfehler werden in /ledger genannt', DE, async ($, on) => {
  const big = 'x'.repeat(3.3 * 1024 * 1024)
  const w = world(on, { saved: new Map<string, unknown>([['ballast', big]]) })
  await w.start($)
  w.st.setFails = true
  await w.turn($, 0.5)
  const text = await w.ledger($)
  expect(text).toMatch(/Speicher zu \d+ % voll/)
  expect(text).toMatch(/Speichern scheiterte zuletzt: /)
  expect(text.split('\n').length <= 10).toBe(true)
})

test('/ledger reset: „Abbrechen“ löscht nicht, Empfehlung steht auf Platz 1', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 1)
  expect(await w.ledger($, 'reset')).toBe('Nicht gelöscht.')
  expect(w.st.asks[0]).toEqual(['Abbrechen (empfohlen)', 'Löschen'])
  expect(w.rec()).toBeDefined()
})

test('/ledger reset: „Löschen“ löscht alle s:* und meta:*, der laufende Chat bucht danach nur Neues', DE, async ($, on) => {
  const w = world(on, { answer: 'Löschen' })
  w.saved.set('fremd', 1)
  await w.start($)
  await w.turn($, 1)
  expect(await w.ledger($, 'reset')).toMatch(/geleert \(1 Eintrag\)/)
  expect([...w.saved.keys()].sort()).toEqual(['fremd', 'meta:resetAt', 'meta:since'])
  expect(w.saved.get('meta:since')).toBe(NOW)
  await w.turn($, 1.2)
  near(w.sum(), 0.2)
})

test('Reset aus einem anderen Chat: dieser Chat schreibt die gelöschten Beträge nicht zurück (Review S1)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 2)
  // Ein anderer Chat setzt zurück
  await w.clock.advance(1000)
  w.saved.delete('s:S1')
  w.saved.set('meta:resetAt', NOW + 1000)
  await w.clock.advance(1000)
  await w.turn($, 2.25)
  near(w.sum(), 0.25)
  // Auch die vorsorglich gesammelten Felder beginnen neu (Review 4 K2): nur die Antwort nach dem Reset zählt
  const r = w.rec()!
  expect(r.act[TODAY]!.turns).toBe(1)
  near(r.hours[TODAY]!['12']!, 0.25)
  expect(r.models['opus-5-5']!.days[TODAY]!.n).toBe(1)
})

test('Reset aus einem anderen Chat: /ledger ohne neue Buchung zeigt die alten Beträge nicht mehr (Review 2 S1)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 2)
  await w.clock.advance(1000)
  w.saved.delete('s:S1')
  w.saved.set('meta:resetAt', NOW + 1000)
  expect(await w.ledger($)).toMatch(/Noch keine Einträge/)
})

test('/ledger projects: mehr als 24 Projekte → „+N weitere“, höchstens 10 Zeilen', DE, async ($, on) => {
  const saved = new Map<string, unknown>(Array.from({ length: 30 }, (_, i) => [`s:P${i}`, recOf(`Projekt${i}`, { [TODAY]: i + 1 })] as [string, unknown]))
  const w = world(on, { saved })
  await w.start($)
  const text = await w.ledger($, 'projects')
  expect(text).toMatch(/\+6 weitere/)
  expect(text.split('\n').length <= 10).toBe(true)
})

test('/ledger reset in -p (ask abgelehnt): nichts gelöscht, Hinweis', DE, async ($, on) => {
  const w = world(on, { answer: null })
  await w.start($)
  await w.turn($, 1)
  expect(await w.ledger($, 'reset')).toMatch(/Nicht gelöscht: Die Rückfrage ist hier nicht möglich/)
  expect(w.rec()).toBeDefined()
})

test('/ledger help und unbekanntes Argument', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  expect(await w.ledger($, 'help')).toMatch(/^- `\/ledger chats\|projects\|models \[7\|30\|all\]`: Teuerste Chats/m)
  expect(await w.ledger($, 'quatsch')).toBe('Unbekannt: „quatsch“. Alle Befehle: /ledger help')
})

test('/ledger chats 7 und projects all', DE, async ($, on) => {
  const saved = new Map<string, unknown>([
    ['s:A', recOf('Alt', { [dayBefore(NOW, 20)]: 5 }, { title: 'Alter Chat' })],
    ['s:B', recOf('Neu', { [TODAY]: 1 }, { title: 'Neuer Chat' })],
  ])
  const w = world(on, { saved })
  await w.start($)
  const chats = await w.ledger($, 'chats 7')
  expect(chats).toMatch(/Neuer Chat/)
  expect(chats).not.toMatch(/Alter Chat/)
  expect(await w.ledger($, 'projects all')).toMatch(/Alt 5,00 \$.*Neu 1,00 \$/)
})

// ---------- Zeichnung ----------

async function mountLedger($: any, text: string, surface: string, columns = 120, args = lastArgs) {
  return $.ui.mount({
    plugin: 'cost-ledger',
    component: 'CommandOutput',
    requestId: `r-${surface}-${columns}`,
    surface,
    viewport: { columns, rows: 40 },
    props: { command: 'ledger', args, text, isErrored: false },
  })
}

for (const surface of ['terminal', 'desktop'] as const)
  test(`UI ${surface}: vier Kennzahlen, 14 Balken, Projekte und Chats, Farben nur am Balken`, DE, async ($, on) => {
    const saved = new Map<string, unknown>([
      ['s:A', recOf('Handy', { [dayBefore(NOW, 1)]: 9 }, {
        title: 'Handy-App',
        mods: { sidekick: { days: { [dayBefore(NOW, 3)]: { usd: 0.05, calls: 2 }, [dayBefore(NOW, 4)]: { usd: 0.02, calls: 1 } } } },
        modModels: { 'sonnet-5-5': { days: { [dayBefore(NOW, 3)]: { in: 0, out: 0, cr: 0, cw: 0, usd: 0.05, n: 2 } } } },
      })],
    ])
    const w = world(on, { saved })
    await w.start($, 'S1', 'startup', 'fynn-orchestrator v1.0')
    await w.turn($, 4.82)
    const ui = await mountLedger($, await w.ledger($), surface)
    for (const label of ['Heute', '7 Tage', '30 Tage', 'Gesamt']) expect(await ui.find({ type: 'Text', text: label }), label).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '4,82 $' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '13,82 $' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Letzte 14 Tage' })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^\d\d\.\d\d\.$/ })).toHaveLength(14)
    expect(await ui.find({ text: /← höchster/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Projekte · 30 Tage' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Teuerste Chats · 30 Tage' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fynn-orchestrator v1\.0/ })).toBeDefined()
    expect(await ui.find({ text: /^ENGINE:/ })).toBeUndefined()
    // Ampel färbt den Betrag: 9 $ ≥ 8 $ → rot. Balken nach Modell; der alte Tag ohne Modell-Daten ist „ohne Angabe“
    expect((await ui.find({ type: 'Text', text: '9,00 $' }))?.props.color).toBe('error')
    expect(await ui.find({ type: 'Text', text: 'ohne Angabe' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Sonnet 5.5 · Mods' })).toBeDefined() // Mod-Aufruf aus dem Verlauf, getrennt vom Chat
    expect(await ui.find({ type: 'Text', text: 'Mods ohne Angabe' })).toBeDefined() // Mod-Kosten vor 0.3.0 ohne Modell
    if (surface === 'terminal') {
      const bars = await ui.findAll({ type: 'Text', text: /▄/ })
      expect(bars.some((t: any) => t.props.color === 'inactive')).toBe(true)
      expect(bars.some((t: any) => t.props.color === 'claude')).toBe(true)
    } else {
      const segs = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.backgroundColor === 'inactive')
      expect(segs.length > 0).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^▄+$/ })).toBeUndefined() // keine Zeichen-Balken im Desktop
    }
    // Leere Balkenteile ohne eigene Farbe (Hintergrund des Themes, Fynn 2026-10-06)
    expect((await ui.findAll({ type: 'Box' })).some((b: any) => b.props.backgroundColor === 'subtle')).toBe(false)
    expect((await ui.findAll({ type: 'Text' })).some((t: any) => t.props.color === 'subtle')).toBe(false)
    // Zurückhaltend: Orange nur in Überschriften, keine bunten Rahmen
    const borders = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.borderStyle)
    expect(borders).toHaveLength(1)
    expect(borders[0].props.borderColor).toBeUndefined()
    await ui.unmount()
  })

for (const surface of ['terminal', 'desktop'] as const)
  test(`UI ${surface}: Ansichten chats, projects und models zeichnen ihren eigenen Baum (Review 3 K2)`, DE, async ($, on) => {
    const w = world(on)
    await w.start($, 'S1', 'startup', 'Kostenbuch-Chat')
    await w.turn($, 1.5, { usage: U('claude-opus-5-5', 1000, 20000, 50000, 5000) })
    for (const [args, heading] of [['chats', 'Teuerste Chats · 30 Tage'], ['projects 7', 'Projekte · 7 Tage'], ['models all', 'Modelle · gesamt']] as const) {
      const ui = await mountLedger($, await w.ledger($, args), surface)
      expect(await ui.find({ type: 'Text', text: heading }), args).toBeDefined()
      expect(await ui.find({ text: /^ENGINE:/ }), args).toBeUndefined()
      await ui.unmount()
    }
  })

test('Desktop: alle Breiten sind Zahlen oder ganzzahlige Prozente (Desktop-Validierung, Debug-Log 2026-10-06)', DE, async ($, on) => {
  // Der Desktop verwirft den Baum bei „33.3%“: Box prop "width" must be a number or a percentage → Markdown statt Zeichnung
  const w = world(on)
  await w.start($)
  await w.turn($, 1, { usage: U('claude-opus-5-5', 1000, 30000) })
  await w.turn($, 2, { usage: U('claude-sonnet-5-5', 1000, 30000) })
  await w.turn($, 3, { usage: U('claude-haiku-4-5', 1000, 30000) })
  for (const args of ['', 'weeks', 'models', 'projects', 'chats']) {
    const ui = await mountLedger($, await w.ledger($, args), 'desktop')
    const widths = (await ui.findAll({ type: 'Box' })).map((b: any) => b.props.width).filter((x: unknown) => x !== undefined)
    const bad = widths.filter((x: unknown) => !(typeof x === 'number' || (typeof x === 'string' && /^\d+%$/.test(x))))
    expect(bad, args).toEqual([])
    // Teilsegmente eines gestapelten Balkens ergeben zusammen genau 100 %
    const rows = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexDirection === 'row' && b.children?.every((c: any) => typeof c === 'object' && c.props?.backgroundColor))
    for (const r of rows) expect((r as any).children.reduce((a: number, c: any) => a + parseInt(c.props.width, 10), 0), args).toBe(100)
    await ui.unmount()
  }
})

test('UI: unbekannter Text, Fehlerzeile und andere Surface → Engine zeichnet den Markdown-Text', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const unknown = await mountLedger($, 'irgendwas', 'terminal')
  expect(await unknown.find({ text: 'ENGINE:irgendwas' })).toBeDefined()
  await unknown.unmount()
  const text = await w.ledger($)
  const errored = await $.ui.mount({
    plugin: 'cost-ledger', component: 'CommandOutput', requestId: 'err', surface: 'terminal', viewport: { columns: 100, rows: 30 },
    props: { command: 'ledger', args: '', text, isErrored: true },
  })
  expect(await errored.find({ text: /^ENGINE:/ })).toBeDefined()
  await errored.unmount()
  const vscode = await mountLedger($, text, 'vscode')
  expect(await vscode.find({ text: /^ENGINE:/ })).toBeDefined()
  await vscode.unmount()
})

test('UI: Leerzustand', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await w.ledger($)
  expect(text).toMatch(/Noch keine Einträge/)
  const ui = await mountLedger($, text, 'desktop')
  expect(await ui.find({ text: /Noch keine Einträge\. Gezählt wird ab jetzt, nach jeder Antwort\./ })).toBeDefined()
  await ui.unmount()
})

test('UI: schmale Breite (60 Spalten) → Kacheln umbrechen, nichts breiter als die Zeile', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 123.45)
  const ui = await mountLedger($, await w.ledger($), 'terminal', 60)
  const tree = await ui.drawn()
  expect(tree.props).toMatchObject({ width: '100%' }) // kein festes Außenmaß (Desktop schnitt rechts ab)
  const widths = (await ui.findAll({ type: 'Box' })).map((b: any) => b.props.width).filter((x: unknown) => typeof x === 'number')
  expect(widths.every((x: number) => x <= 56)).toBe(true)
  expect(await ui.find({ type: 'Text', text: '123,45 $' })).toBeDefined()
  // Eine Tageszeile passt in den Rahmen: Datum 7 + Balken + Betrag 10 + Marke 12 ≤ 56
  const day = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.flexDirection === 'row' && /^\d\d\.\d\d\./.test(b.text))
  const sum = (day as any).children.reduce((a: number, c: any) => a + (typeof c === 'object' && typeof c.props?.width === 'number' ? c.props.width : 0), 0)
  expect(sum <= 56).toBe(true)
  await ui.unmount()
})

// ---------- Sprache (release/I18N.md): Englisch ist Standard, Deutsch per userConfig `language` ----------

test('i18n: beide Tabellen haben dieselben Schlüssel und keine leeren Texte', () => {
  expect(Object.keys(T.de).sort()).toEqual(Object.keys(T.en).sort())
  for (const lang of ['en', 'de'] as const)
    for (const [k, v] of Object.entries(T[lang])) {
      const out = typeof v === 'function' ? (v as (...a: unknown[]) => unknown)('x', 2, 'y', 'z', 'w') : v
      expect(typeof out === 'string' && out.trim().length > 0, `${lang}.${k}`).toBe(true)
    }
  expect(langOf('de')).toBe('de')
  expect(langOf('en')).toBe('en')
  expect(langOf(undefined)).toBe('en')
  expect(langOf('fr')).toBe('en')
})

test('Formatierer: Beträge, Datum, Woche, Tokens, Zeitraum in beiden Sprachen', () => {
  expect(usd(14.444, 'en')).toBe('$14.44')
  expect(usd(1234.5, 'en')).toBe('$1,234.50')
  expect(usd(0.004, 'en')).toBe('< $0.01')
  expect(usd(0, 'en')).toBe('$0.00')
  expect(usd(14.444, 'de')).toBe('14,44 $')
  expect(shortDate('2026-10-06', 'en')).toBe('Oct 6')
  expect(shortDate('2026-10-06', 'de')).toBe('06.10.')
  expect(dateTime(NOW, 'en')).toBe('Oct 6 12:00')
  expect(dateTime(NOW, 'de')).toBe('06.10. 12:00')
  expect(fullDate(NOW, 'en')).toBe('Oct 6, 2026')
  expect(fullDate(NOW, 'de')).toBe('06.10.2026')
  expect(weekLabel(41, 'en')).toBe('W41')
  expect(weekLabel(41, 'de')).toBe('KW 41')
  expect(tokens(1234567, 'en')).toBe('1.2M')
  expect(tokens(1234567, 'de')).toBe('1,2M')
  expect(tokens(1500, 'en')).toBe('1.5k')
  expect(rangeLabel(7, 'en')).toBe('7 days')
  expect(rangeLabel(0, 'en')).toBe('all time')
  expect(rangeLabel(0, 'de')).toBe('gesamt')
  expect(modelName('unbekannt', 'en')).toBe('Unknown')
})

test('Englisch (Standard): Kurzfassung für Claude, Skript-Läufe, Chat-Name ohne Titel', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await w.start($)
  await w.turn($, 1.25)
  const text = await w.ledger($)
  expect(text).toMatch(/^\*\*Cost ledger\*\* · as of Oct 6 12:00 · #/)
  expect(text).toMatch(/Chats: today \$1\.25 \(1\) · 7 days \$1\.25 · 30 days \$1\.25 · all time \$1\.25/)
  expect(text).toMatch(/Projects \(30 days\): Script runs \$1\.25/)
  expect(text).toMatch(/Most expensive chats \(30 days\): Chat from Oct 6 12:00 \$1\.25/)
  expect(text).toMatch(/counts against your usage limits/)
  expect(text.split('\n').length <= 10).toBe(true)
  expect(await w.ledger($, 'weeks')).toMatch(/Weeks \(chat \+ mods\): W41 \$1\.25/)
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`Englisch (Standard) UI ${surface}: Überschriften, Beträge, Woche, Legende`, async ($, on) => {
    const w = world(on)
    await w.start($, 'S1', 'startup', 'Refactor payments')
    await w.turn($, 4.82, { usage: U('claude-opus-5-5', 1000, 20000) })
    const ui = await mountLedger($, await w.ledger($), surface)
    for (const label of ['Today', '7 days', '30 days', 'All time', 'Last 14 days', 'Projects · 30 days', 'Most expensive chats · 30 days', 'Mods · 30 days'])
      expect(await ui.find({ type: 'Text', text: label }), label).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '$4.82' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Oct 6' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ text: /reload: \/ledger/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Refactor payments' })).toBeDefined()
    expect(await ui.find({ text: /Heute|Letzte|Teuerste/ })).toBeUndefined()
    await ui.unmount()
    const wk = await mountLedger($, await w.ledger($, 'weeks'), surface)
    expect(await wk.find({ type: 'Text', text: 'Last 14 weeks' })).toBeDefined()
    expect(await wk.findAll({ type: 'Text', text: /^W\d+$/ })).toHaveLength(14)
    await wk.unmount()
    const md = await mountLedger($, await w.ledger($, 'models'), surface)
    expect(await md.find({ type: 'Text', text: 'Models · 30 days' })).toBeDefined()
    expect(await md.find({ text: /^Input 1\.0k · Output 20k · Cache 0 read, 0 written$/ })).toBeDefined()
    await md.unmount()
  })

test('Englisch (Standard): Hilfe, unbekanntes Argument, Aliase hilfe/alle, leerer Zustand, ohne Ordner', async ($, on) => {
  const saved = new Map<string, unknown>([['s:A', recOf('(ohne Ordner)', { [dayBefore(NOW, 20)]: 5 }, { title: 'Old chat' })]])
  const w = world(on, { saved })
  await w.start($)
  expect(await w.ledger($, 'help')).toMatch(/^- `\/ledger chats\|projects\|models \[7\|30\|all\]`: Most expensive chats/m)
  expect(await w.ledger($, 'hilfe')).toMatch(/^\*\*cost-ledger · Help\*\* · #[0-9a-z]{5,}\n/)
  expect(await w.ledger($, 'xyz')).toBe('Unknown: “xyz”. All commands: /ledger help')
  expect(await w.ledger($, 'projects alle')).toMatch(/Projects \(all time\):\n\(no folder\) \$5\.00 \(1 chat\)/)
})

test('Englisch (Standard): leerer Zustand', async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await w.ledger($)
  expect(text).toMatch(/No entries yet\. Counting starts now, after every answer\./)
  const ui = await mountLedger($, text, 'desktop')
  expect(await ui.find({ text: /No entries yet/ })).toBeDefined()
  await ui.unmount()
})

test('Englisch (Standard): Rückfrage beim Reset auf Englisch, Empfehlung oben; „Delete“ löscht', async ($, on) => {
  const w = world(on, { answer: 'Delete' })
  await w.start($)
  await w.turn($, 1)
  expect(await w.ledger($, 'reset')).toBe('Cost ledger cleared (1 entry).')
  expect(w.st.asks[0]).toEqual(['Cancel (recommended)', 'Delete'])
})

test('Englisch (Standard): Abbrechen löscht nicht', async ($, on) => {
  const w = world(on, { answer: 'Cancel (recommended)' })
  await w.start($)
  await w.turn($, 1)
  expect(await w.ledger($, 'reset')).toBe('Not deleted.')
  expect(w.rec()).toBeDefined()
})

test('Englisch (Standard): abgelehnte Rückfrage (-p) nennt den Grund; Hinweise auf Englisch', async ($, on) => {
  const w = world(on, { answer: null, cost: null, saved: new Map<string, unknown>([['s:BAD', { v: 99 }]]) })
  await w.start($)
  await w.turn($, null)
  expect(await w.ledger($, 'reset')).toBe('Not deleted: the question cannot be asked here (e.g. in `-p`).')
  const text = await w.ledger($)
  expect(text).toMatch(/This host reports no chat costs/)
  expect(text).toMatch(/1 entry unreadable\./)
})

test('Deutsche Antwort „Löschen“ gilt auch bei englischer Einstellung (Sprachwechsel zwischen Frage und Antwort)', async ($, on) => {
  const w = world(on, { answer: 'Löschen' })
  await w.start($)
  await w.turn($, 1)
  expect(await w.ledger($, 'reset')).toMatch(/^Cost ledger cleared/)
})

// ---------- 0.5.0: Limits und Abo (SPEC Nachtrag 0.5.0) ----------

const H = 60 * 60 * 1000
const iso = (ms: number) => new Date(ms).toISOString()
/** rateLimits wie in Phase 0 (`resetsAt` als ISO 8601); `weekAt` optional. */
const RL = (fiveAt: number, fivePct: number, weekAt?: number, weekPct = 10) => [
  { kind: 'five_hour', percentUsed: fivePct, resetsAt: iso(fiveAt) },
  ...(weekAt === undefined ? [] : [{ kind: 'seven_day', percentUsed: weekPct, resetsAt: iso(weekAt) }]),
]
const T5 = NOW + 3 * H // 06.10. 15:00
const TW = NOW + 4 * DAY // Sa 10.10. 12:00
const limW = (o: Partial<{ chat: number; mod: number; pct: number; first: number; last: number }>) => ({ chat: 0, mod: 0, pct: 0, first: NOW - 30 * DAY, last: NOW - 30 * DAY, ...o })

test('0.5.0: Turn bucht das Delta ins 5-Stunden- und ins Wochenfenster, pct ist der Höchstwert', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.rl = RL(T5, 30, TW, 50)
  await w.turn($, 0.5)
  w.st.rl = RL(T5, 25, TW, 55) // eine niedrigere Lesung senkt den Höchstwert nicht
  await w.clock.advance(60_000)
  await w.turn($, 0.75)
  const five = w.rec()!.lim.five_hour![String(T5)]!
  near(five.chat, 0.75)
  expect([five.mod, five.pct, five.first, five.last]).toEqual([0, 30, NOW, NOW + 60_000])
  const week = w.rec()!.lim.seven_day![String(TW)]!
  near(week.chat, 0.75)
  expect(week.pct).toBe(55)
  expect(w.saved.get('meta:limSince')).toBe(NOW) // Beginn der Fenster-Daten, einmal gesetzt
  near(w.sum(), 0.75) // die Tagesbuchung bleibt unverändert
  // Das 5-Stunden-Fenster begann 10:00, gezählt wird ab 12:00: unvollständig, deshalb keine Hochrechnung (sie wäre zu niedrig)
  expect(await w.ledger($, 'limits')).toMatch(/^5 Stunden: 30 % · 0,75 \$ · Reset 15:00 \(in 2 h 59 min\) · Hochrechnung ab dem nächsten Fenster · ab 12:00$/m)
})

test('0.5.0: resetsAt um 20 s verschieden → derselbe Schlüssel; um 40 s → in der Aggregation zusammengelegt', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.rl = RL(T5, 10)
  await w.turn($, 0.1)
  w.st.rl = RL(T5 + 20_000, 11)
  await w.turn($, 0.3)
  expect(Object.keys(w.rec()!.lim.five_hour!)).toEqual([String(T5)])
  expect(limKey(T5 + 20_000)).toBe(String(T5))
  w.st.rl = RL(T5 + 40_000, 12)
  await w.turn($, 0.6)
  expect(Object.keys(w.rec()!.lim.five_hour!)).toEqual([String(T5), String(T5 + 60_000)])
  const l = limitsReport([{ rec: w.rec()! }], NOW, {})
  expect(l.history).toHaveLength(1)
  near(l.five!.usd, 0.6)
  expect(l.five!.pct).toBe(12)
})

test('0.5.0: Fensterwechsel; abgelaufenes Fenster ohne neue Reset-Zeit → carry, beim nächsten Fenster gutgeschrieben', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.rl = RL(NOW + H, 40)
  await w.turn($, 0.2)
  await w.clock.advance(2 * H) // Reset vorbei, die letzte Lesung nennt noch das alte Fenster
  w.st.cost = 0.3 // Rest, gebucht vor /ledger
  await w.ledger($)
  const old = w.rec()!.lim.five_hour!
  expect(Object.keys(old)).toEqual([String(NOW + H)])
  near(old[String(NOW + H)]!.chat, 0.2) // nicht ins abgelaufene Fenster
  near(w.sum(), 0.3) // der Tag hat den Betrag trotzdem
  w.st.rl = RL(NOW + 7 * H, 3)
  await w.turn($, 0.5)
  near(w.rec()!.lim.five_hour![String(NOW + 7 * H)]!.chat, 0.3) // 0,20 Turn + 0,10 aus carry
})

test('0.5.0: model.complete von sidekick → lim.mod des aktuellen Fensters, ohne eigenes usage()', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: MILLION_IN } as never }))
  await w.start($)
  w.st.rl = RL(T5, 10, TW, 5)
  await w.turn($, 0.1)
  const calls = w.st.usageCalls
  expect((await $.command.run({ command: 'probe', args: '' })).text).toBe('complete:OK')
  expect(w.st.usageCalls).toBe(calls) // Mod-Pfad ohne zusätzlichen usage()-Aufruf
  const five = w.rec()!.lim.five_hour![String(T5)]!
  near(five.mod, 0.5) // Alias haiku = Haiku 5.5, 1 Mio. Prompt-Tokens: fünffach (0,50 $)
  near(five.chat, 0.1)
  near(w.rec()!.lim.seven_day![String(TW)]!.mod, 0.5)
})

test('0.5.0: Mod-Aufruf vor der ersten Messung → carry, mit dem ersten Fenster gebucht', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: MILLION_IN } as never }))
  await w.start($)
  await $.command.run({ command: 'probe', args: '' })
  expect(w.rec()!.lim).toEqual({})
  w.st.rl = RL(T5, 2)
  await w.turn($, 0.1)
  const five = w.rec()!.lim.five_hour![String(T5)]!
  near(five.mod, 0.5)
  near(five.chat, 0.1)
})

test('0.5.0: spend_limit, fehlendes oder ungültiges resetsAt werden ignoriert', DE, async ($, on) => {
  expect(limitsOf([
    { kind: 'spend_limit', percentUsed: 120, resetsAt: iso(T5) },
    { kind: 'five_hour', percentUsed: 10 },
    { kind: 'seven_day', percentUsed: 10, resetsAt: 'kaputt' },
  ])).toEqual([])
  expect(limitsOf(undefined)).toEqual([])
  expect(limitsOf([{ kind: 'five_hour', percentUsed: 21, resetsAt: '2026-10-08T19:10:00.000Z' }])).toEqual([{ kind: 'five_hour', pct: 21, resetsAt: Date.parse('2026-10-08T19:10:00.000Z') }])
  const w = world(on)
  await w.start($)
  w.st.rl = [{ kind: 'spend_limit', percentUsed: 120, resetsAt: iso(T5) }, { kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 10, resetsAt: 'kaputt' }]
  await w.turn($, 0.1)
  expect(w.rec()!.lim).toEqual({})
  expect(w.saved.has('meta:limSince')).toBe(false)
})

test('0.5.0: höchstens 60 Fünf-Stunden- und 12 Wochenfenster je Datensatz, die ältesten fallen heraus', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  for (let i = 0; i < 62; i++) {
    w.st.rl = RL(NOW + i * 5 * H + H, 50, NOW + i * 7 * DAY + H, 50)
    await w.turn($, 0.01 * (i + 1))
    await w.clock.advance(5 * H)
  }
  const five = Object.keys(w.rec()!.lim.five_hour!).map(Number).sort((a, b) => a - b)
  expect(five).toHaveLength(60)
  expect(five[0]).toBe(NOW + 2 * 5 * H + H)
  expect(Object.keys(w.rec()!.lim.seven_day!)).toHaveLength(12)
})

test('0.5.0: Aggregation über zwei Sessions: Beträge summiert, pct Maximum; Ø nur aus abgeschlossenen, vollständigen Fenstern ≥ 20 %', () => {
  const p1 = String(NOW - 6 * H)
  const p2 = String(NOW - H)
  const low = String(NOW - 11 * H)
  const old = String(NOW - 40 * H) // begann vor limSince (−42 h) → unvollständig, zählt nicht zum Ø
  const cur = String(NOW + 2 * H)
  const at = (k: string, o: Parameters<typeof limW>[0]) => limW({ first: Number(k) - H, last: Number(k) - H, ...o })
  const a = recOf('P', {}, { lim: { five_hour: { [p1]: at(p1, { chat: 10, pct: 50 }), [p2]: at(p2, { chat: 3, mod: 1, pct: 30 }), [cur]: at(cur, { chat: 2, pct: 20 }), [old]: at(old, { chat: 1, pct: 90 }) } } })
  const b = recOf('Q', {}, { lim: { five_hour: { [p2]: at(p2, { chat: 4, pct: 35 }), [cur]: at(cur, { chat: 1, mod: 0.5, pct: 25 }), [low]: at(low, { chat: 9, pct: 10 }) } } })
  const l = limitsReport([{ rec: a }, { rec: b }], NOW, { limSince: NOW - 42 * H })
  near(l.five!.usd, 3.5)
  expect(l.five!.pct).toBe(25)
  near(l.five!.proj!, 14) // 3,50 $ ÷ 25 × 100
  expect(l.history.map((w) => String(w.resetsAt))).toEqual([cur, p2, p1, low, old])
  near(l.history[1]!.usd, 8)
  expect(l.history[1]!.pct).toBe(35)
  expect(l.history[4]!.partial).toBe(true)
  near(l.avg!.usd, (18 / 85) * 100) // (10 + 8) ÷ (50 + 35) × 100
  expect(l.avg!.n).toBe(2)
  expect(l.week).toBeNull()
  expect([l.seenFive, l.seenWeek]).toEqual([true, false])
  // Ohne meta:limSince gilt die früheste Fenster-Buchung; ein später gesetztes meta:limSince zählt nie nach ihr
  expect(limitsReport([{ rec: a }], NOW, {}).limSince).toBe(NOW - 41 * H)
  expect(limitsReport([{ rec: a }], NOW, { limSince: NOW }).limSince).toBe(NOW - 41 * H)
})

test('0.5.0: Ø nur über die neuesten 60 Fenster; ältere Fenster eines gekürzten langen Chats verfälschen ihn nicht (Review)', () => {
  // Chat L war in 120 Fenstern aktiv (10 $ je Fenster) und behält nur die neuesten 60; kurze Chats je 0,50 $ in allen 120
  const long: Record<string, ReturnType<typeof limW>> = {}
  const recs: { rec: Rec }[] = []
  for (let i = 0; i < 120; i++) {
    const k = String(NOW - (i + 1) * 5 * H)
    if (i < 60) long[k] = limW({ chat: 10, pct: 50, first: NOW - 700 * H, last: NOW - 700 * H })
    recs.push({ rec: recOf('S', {}, { lim: { five_hour: { [k]: limW({ chat: 0.5, pct: 50, first: NOW - 700 * H, last: NOW - 700 * H }) } } }) })
  }
  recs.push({ rec: recOf('L', {}, { lim: { five_hour: long } }) })
  const l = limitsReport(recs, NOW, {})
  expect(l.avg!.n).toBe(60)
  near(l.avg!.usd, 21) // (10 + 0,50) ÷ 50 × 100
})

test('0.5.0: Hochrechnung erst ab 5 %; Messung dieses Prozesses (live) hebt pct', () => {
  const mk = (p: number) => limitsReport([{ rec: recOf('P', {}, { lim: { five_hour: { [String(T5)]: limW({ chat: 1, pct: p }) } } }) }], NOW, {}).five!.proj
  expect(mk(4.9)).toBeNull()
  near(mk(5)!, 20)
  const live = limitsReport([{ rec: recOf('P', {}, { lim: { five_hour: { [String(T5)]: limW({ chat: 1, pct: 4 }) } } }) }], NOW, { live: [{ kind: 'five_hour', pct: 10, resetsAt: T5 + 10_000 }] })
  expect(live.five!.pct).toBe(10)
  near(live.five!.proj!, 10)
  // Nur eine Messung, noch keine Buchung: Fenster mit 0 $
  const only = limitsReport([], NOW, { live: [{ kind: 'seven_day', pct: 6, resetsAt: TW }] })
  expect([only.week!.pct, only.week!.usd, only.seenWeek, only.seenFive]).toEqual([6, 0, true, false])
})

test('0.5.0: /ledger plan speichert meta:plan; heute, Komma-Preis, Aliase, off; Ungültiges speichert nichts', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  expect(await w.ledger($, 'plan max20 14')).toBe('Abo gespeichert: Max 20x, Abrechnungstag 14, 200,00 $ im Monat (Listenpreis). Abo-Monat seit 14.09., erneuert 14.10. · Details: /ledger limits')
  expect(w.saved.get('meta:plan')).toEqual({ v: 1, plan: 'max20', day: 14, at: NOW })
  expect(await w.ledger($, 'plan 20X heute 207,50')).toMatch(/Max 20x, Abrechnungstag 6, 207,50 \$ im Monat\. Abo-Monat seit 06\.10\., erneuert 06\.11\./)
  expect(w.saved.get('meta:plan')).toEqual({ v: 1, plan: 'max20', day: 6, price: 207.5, at: NOW })
  expect(await w.ledger($, 'plan')).toMatch(/^Abo: Max 20x, Abrechnungstag 6, 207,50 \$ im Monat \(eingestellt 06\.10\. 12:00\)\.\n\*\*\/ledger plan/)
  for (const bad of ['gold 3', 'max20', 'max20 32', 'max20 0', 'max20 14 abc', 'max20 14 0', 'max20 14 207 mehr', 'max20 1.5'])
    expect(await w.ledger($, `plan ${bad}`), bad).toMatch(/^Nicht gespeichert: „.*“ ist ungültig\.\n\*\*\/ledger plan/)
  expect((w.saved.get('meta:plan') as { day: number }).day).toBe(6) // unverändert
  expect(await w.ledger($, 'plan team 1')).toMatch(/Team, Abrechnungstag 1, ohne Preis\./)
  expect(await w.ledger($, 'plan off')).toBe('Abo-Einstellung gelöscht.')
  expect(w.saved.has('meta:plan')).toBe(false)
  expect(await w.ledger($, 'plan')).toMatch(/^Kein Abo eingestellt\./)
  expect(await w.ledger($, 'plan max5x 31 $99.99')).toMatch(/Max 5x, Abrechnungstag 31, 99,99 \$ im Monat\./)
  expect(await w.ledger($, 'plan aus')).toBe('Abo-Einstellung gelöscht.')
})

test('0.5.0: parsePlan und cleanPlan', () => {
  expect(parsePlan(['Pro', 'today'], NOW)).toEqual({ v: 1, plan: 'pro', day: 6, at: NOW })
  expect(parsePlan(['5x', '8', '100'], NOW)).toEqual({ v: 1, plan: 'max5', day: 8, price: 100, at: NOW })
  expect(parsePlan(['enterprise', '31', '1.234'], NOW)).toBeNull()
  expect(parsePlan([], NOW)).toBeNull()
  expect(cleanPlan({ v: 1, plan: 'max20', day: 8, price: 207, at: NOW })).toEqual({ v: 1, plan: 'max20', day: 8, price: 207, at: NOW })
  expect(cleanPlan({ v: 1, plan: 'max20', day: 8, price: -1, at: NOW })).toEqual({ v: 1, plan: 'max20', day: 8, at: NOW })
  for (const bad of [null, { v: 2, plan: 'pro', day: 1, at: 1 }, { v: 1, plan: 'gold', day: 1, at: 1 }, { v: 1, plan: 'pro', day: 32, at: 1 }, { v: 1, plan: 'pro', day: 1.5, at: 1 }])
    expect(cleanPlan(bad)).toBeNull()
})

test('0.5.0: Abo-Monat: 31. im 30-Tage-Monat, Jahreswechsel, Abrechnungstag heute (Fynns Fall am 08.10.)', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
  expect(planMonth(31, at(2026, 10, 8))).toEqual({ start: '2026-09-30', next: '2026-10-31', daysLeft: 23 })
  expect(planMonth(31, at(2026, 11, 30))).toEqual({ start: '2026-11-30', next: '2026-12-31', daysLeft: 31 })
  expect(planMonth(31, at(2027, 1, 31))).toEqual({ start: '2027-01-31', next: '2027-02-28', daysLeft: 28 })
  expect(planMonth(8, at(2027, 1, 5))).toEqual({ start: '2026-12-08', next: '2027-01-08', daysLeft: 3 })
  expect(planMonth(8, at(2026, 10, 8, 9))).toEqual({ start: '2026-10-08', next: '2026-11-08', daysLeft: 31 })
  expect(planMonth(8, at(2026, 10, 7, 23))).toEqual({ start: '2026-09-08', next: '2026-10-08', daysLeft: 1 })
})

test('0.5.0: Abo-Wert: nur Datensätze mit Abo-Limits, Chat + Mods seit Beginn; Faktor nur mit Preis; „ab“ vor meta:since', () => {
  const d = (n: number) => dayBefore(NOW, n)
  const sub = recOf('P', { [d(0)]: 3, [d(10)]: 2, [d(40)]: 50 }, { rl: { [d(10)]: { seven_day: 40 } }, mods: { sidekick: { days: { [d(1)]: { usd: 0.5, calls: 2 } } } } })
  const viaLim = recOf('Q', { [d(2)]: 1 }, { lim: { five_hour: { [String(NOW - H)]: limW({ chat: 1, pct: 5 }) } } })
  const apiKey = recOf('R', { [d(0)]: 100 }, { rl: { [d(0)]: { spend_limit: 50 } } }) // kein Abo: zählt nicht
  const recs = [{ rec: sub }, { rec: viaLim }, { rec: apiKey }]
  const p = limitsReport(recs, NOW, { plan: { v: 1, plan: 'max20', day: 14, at: NOW } }).plan!
  expect([p.start, p.next, p.daysLeft, p.price, p.listPrice, p.from]).toEqual(['2026-09-14', '2026-10-14', 8, 200, true, null])
  near(p.usd, 6.5) // 3 + 2 + 0,50 Mods + 1; der 40 Tage alte Tag liegt vor dem Beginn
  near(p.factor!, 6.5 / 200)
  const own = limitsReport(recs, NOW, { plan: { v: 1, plan: 'max20', day: 6, price: 207, at: NOW }, since: NOW - DAY }).plan!
  expect([own.start, own.price, own.listPrice, own.from]).toEqual(['2026-10-06', 207, false, null])
  near(own.usd, 3)
  const team = limitsReport(recs, NOW, { plan: { v: 1, plan: 'team', day: 1, at: NOW }, since: NOW - 2 * DAY }).plan!
  expect([team.price, team.factor, team.from]).toEqual([null, null, d(2)])
  // Seit 01.10.: 3 $ heute + 0,50 $ Mods gestern; der 26.09. liegt davor
  expect(summaryText(aggregate([{ id: 'P', rec: sub }], NOW, { plan: { v: 1, plan: 'team', day: 1, at: NOW } }), 'limits', 30, '#x', 'de')).toMatch(/^Abo-Monat: Team · seit 01\.10\. · erneuert 01\.11\. \(in 26 Tagen\) · 3,50 \$ API-Wert \(kein Preis eingestellt\)$/m)
})

test('0.5.0: /ledger reset lässt meta:plan stehen und leert lim; Reset aus einem anderen Chat leert lim', DE, async ($, on) => {
  const w = world(on, { answer: 'Löschen' })
  await w.start($)
  await w.ledger($, 'plan max20 8 207')
  w.st.rl = RL(T5, 30)
  await w.turn($, 1)
  expect(w.saved.has('meta:limSince')).toBe(true)
  expect(await w.ledger($, 'reset')).toMatch(/geleert \(1 Eintrag\)/)
  // meta:limSince wird mit dem Reset neu gesetzt statt gelöscht (Review: sonst setzte ein späterer Prozess es zu spät)
  expect([...w.saved.keys()].sort()).toEqual(['meta:limSince', 'meta:plan', 'meta:resetAt', 'meta:since'])
  expect(w.saved.get('meta:limSince')).toBe(NOW)
  await w.turn($, 1.25)
  near(w.rec()!.lim.five_hour![String(T5)]!.chat, 0.25)
  // Ein anderer Chat setzt zurück: auch die Fenster dieses Chats beginnen neu
  await w.clock.advance(1000)
  w.saved.delete('s:S1')
  w.saved.set('meta:resetAt', NOW + 1000)
  await w.clock.advance(1000)
  await w.turn($, 1.5)
  near(w.rec()!.lim.five_hour![String(T5)]!.chat, 0.25)
  expect(Object.keys(w.rec()!.days)).toEqual([TODAY])
  near(w.sum(), 0.25)
})

test('0.5.0: alter Datensatz ohne lim lädt fehlerfrei; kaputte lim-Einträge fliegen raus', () => {
  const old = { v: 1, days: { [TODAY]: 1 }, firstAt: 1, lastAt: 1, rl: { [TODAY]: { five_hour: 50 } } }
  expect(cleanRec(old)!.lim).toEqual({})
  const r = cleanRec({ ...old, lim: { five_hour: { [String(T5)]: limW({ chat: 1, pct: 3 }), abc: limW({}), [String(NOW)]: { chat: 'x' } }, spend_limit: { [String(T5)]: limW({}) }, seven_day: 5 } })!
  expect(Object.keys(r.lim)).toEqual(['five_hour'])
  expect(Object.keys(r.lim.five_hour!)).toEqual([String(T5)])
})

/** Ein Chat mit Fynns Abo, Fenstern und einem älteren, abgeschlossenen Fenster eines anderen Chats. */
async function limitsWorld($: any, on: On) {
  const old = recOf('Handy', { [TODAY]: 4 }, {
    rl: { [TODAY]: { five_hour: 80 } },
    lim: { five_hour: { [String(NOW - 2 * H)]: limW({ chat: 4, pct: 80, first: NOW - 4 * H, last: NOW - 2 * H }) } },
  })
  // Fenster-Daten seit 05:00: das alte Fenster (05–10) und das laufende (10–15) sind vollständig, die Woche nicht
  const w = world(on, { saved: new Map<string, unknown>([['s:OLD', old], ['meta:limSince', NOW - 7 * H]]) })
  await w.start($)
  await w.ledger($, 'plan max20 8 207')
  w.st.rl = RL(T5, 30, TW, 50)
  await w.turn($, 1.2, { usage: U('claude-opus-5-5', 1000, 20000) })
  return w
}

for (const surface of ['terminal', 'desktop'] as const)
  test(`0.5.0 UI ${surface}: /ledger limits mit 5 Stunden, Woche, Abo-Monat, Verlauf und Ø`, DE, async ($, on) => {
    const w = await limitsWorld($, on)
    const text = await w.ledger($, 'limits')
    const ui = await mountLedger($, text, surface)
    expect(await ui.find({ text: /^ENGINE:/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'cost-ledger · Limits' })).toBeDefined()
    expect(await ui.find({ text: /Max 20x · Stand 06\.10\. 12:00 · neu laden: \/ledger limits/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5 Stunden · Reset 15:00 (in 3 h 0 min)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Woche · Reset Sa 10.10. 12:00 (in 4 T 0 h)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ab 06.10.' })).toBeDefined() // Woche begann vor den Fenster-Daten
    expect(await ui.find({ type: 'Text', text: '30 %' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '50 %' }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: '100 % ≈ 4,00 $ (Schätzung)' })).toBeDefined() // 1,20 $ ÷ 30 × 100
    expect(await ui.find({ type: 'Text', text: 'Abo-Monat · Max 20x · seit 08.09. · erneuert 08.10. (in 2 Tagen)' })).toBeDefined()
    expect(await ui.find({ text: /^5,20 \$ API-Wert für 207,00 \$ Abo = 0,0×/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Letzte 5-Stunden-Fenster' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '06.10. 10–15' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '06.10. 05–10' })).toBeDefined()
    expect(await ui.find({ text: /läuft/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Ø 100 % ≈ 5,00 $ aus 1 Fenster (≥ 20 %, Schätzung)' })).toBeDefined() // 4 $ ÷ 80 × 100
    expect(await ui.find({ text: /% gilt fürs ganze Konto \(auch claude\.ai\)/ })).toBeDefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /^▄+$/ })).toBeDefined()
    else {
      expect(await ui.find({ type: 'Text', text: /^▄+$/ })).toBeUndefined()
      const widths = (await ui.findAll({ type: 'Box' })).map((b: any) => b.props.width).filter((x: unknown) => x !== undefined)
      expect(widths.filter((x: unknown) => !(typeof x === 'number' || (typeof x === 'string' && /^\d+%$/.test(x))))).toEqual([])
      expect((await ui.findAll({ type: 'Box' })).some((b: any) => b.props.backgroundColor === 'success')).toBe(true)
    }
    await ui.unmount()
  })

// Nach der angezeigten, gerundeten Zahl: 69,5 zeigt „70 %“ und ist gelb (Review)
for (const [p, color] of [[69.4, 'success'], [69.5, 'warning'], [89.4, 'warning'], [89.5, 'error'], [33.3, 'success']] as const)
  test(`0.5.0 UI: Ampel der Limit-Balken bei ${p} % → ${color}, alle Desktop-Breiten ganzzahlig`, DE, async ($, on) => {
    const w = world(on)
    await w.start($)
    w.st.rl = RL(T5, p, TW, p)
    await w.turn($, 0.1)
    const ui = await mountLedger($, await w.ledger($, 'limits'), 'desktop')
    const bars = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.backgroundColor === color)
    expect(bars.length).toBe(3) // 5 Stunden, Woche, Verlauf
    expect((await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.backgroundColor && b.props.backgroundColor !== color)).toEqual([])
    const widths = (await ui.findAll({ type: 'Box' })).map((b: any) => b.props.width).filter((x: unknown) => typeof x === 'string')
    expect(widths.every((x: string) => /^\d+%$/.test(x)), `${widths}`).toBe(true)
    await ui.unmount()
  })

test('0.5.0 UI: /ledger limits bei 60 Spalten ohne Abschneiden', DE, async ($, on) => {
  const w = await limitsWorld($, on)
  const ui = await mountLedger($, await w.ledger($, 'limits'), 'terminal', 60)
  const widths = (await ui.findAll({ type: 'Box' })).map((b: any) => b.props.width).filter((x: unknown) => typeof x === 'number')
  expect(widths.every((x: number) => x <= 56)).toBe(true)
  for (const r of (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexDirection === 'row' && !b.props.flexWrap)) {
    const sum = (r as any).children.reduce((a: number, c: any) => a + (typeof c === 'object' && typeof c.props?.width === 'number' ? c.props.width : 0), 0)
    expect(sum <= 56, `${sum}`).toBe(true)
  }
  expect(await ui.find({ type: 'Text', text: '1,20 $' })).toBeDefined()
  await ui.unmount()
})

test('0.5.0 UI: Leerzustand ohne Limits und ohne Plan; ohne Limits mit Plan; ohne Plan mit Limits', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await w.ledger($, 'limits')
  expect(text).toMatch(/Keine Limit-Daten: kein Abo erkannt oder seit dem Update noch keine Antwort\./)
  expect(text).toMatch(/Abo nicht eingestellt: \/ledger plan max20 14/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountLedger($, text, surface)
    expect(await ui.find({ type: 'Text', text: /^Keine Limit-Daten/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Abo nicht eingestellt: /ledger plan max20 14' })).toBeDefined()
    await ui.unmount()
  }
  await w.ledger($, 'plan pro 1')
  const withPlan = await mountLedger($, await w.ledger($, 'limits'), 'terminal')
  expect(await withPlan.find({ type: 'Text', text: /^Keine Limit-Daten/ })).toBeDefined()
  expect(await withPlan.find({ type: 'Text', text: /^Abo-Monat · Pro · seit 01\.10\./ })).toBeDefined()
  expect(await withPlan.find({ text: /Listenpreis/ })).toBeDefined()
  await withPlan.unmount()
  await w.ledger($, 'plan off')
  w.saved.set('meta:limSince', NOW - 7 * H) // Fenster vollständig erfasst
  w.st.rl = RL(T5, 2)
  await w.turn($, 0.1)
  const noPlan = await w.ledger($, 'limits')
  expect(noPlan).toMatch(/^5 Stunden: 2 % · 0,10 \$ · Reset 15:00 \(in 3 h 0 min\) · Hochrechnung ab 5 %$/m)
  expect(noPlan).toMatch(/Woche: noch kein Messwert/)
  expect(noPlan).toMatch(/Abo nicht eingestellt/)
  expect(noPlan).toMatch(/Ø 100 %: noch kein vollständig erfasstes, abgeschlossenes Fenster mit ≥ 20 %/)
})

test('0.5.0: Reset vorbei, noch keine neue Antwort', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.rl = RL(NOW + H, 40)
  await w.turn($, 0.2)
  await w.clock.advance(2 * H)
  const text = await w.ledger($, 'limits')
  expect(text).toMatch(/5 Stunden: Reset vorbei, noch keine neue Antwort/)
  expect(text).toMatch(/Letzte 5-Stunden-Fenster: 06\.10\. 08–13 0,20 \$ 40 %/)
  expect(await w.ledger($)).toMatch(/^Limits: 5 Std\.: Reset vorbei · \/ledger limits$/m)
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`0.5.0 UI ${surface}: Übersicht mit Limit-Zeile, ohne Fenster und Plan ohne`, DE, async ($, on) => {
    const w = await limitsWorld($, on)
    const text = await w.ledger($)
    expect(text.split('\n')[1]).toBe('Limits: 5 Std. 30 % · 1,20 $ · Reset 15:00 | Woche 50 % · 1,20 $ | Abo 5,20 $ = 0,0× · /ledger limits')
    const ui = await mountLedger($, text, surface)
    expect(await ui.find({ text: /^5 Std\. 30 % · 1,20 \$ · Reset 15:00$/ })).toBeDefined()
    expect(await ui.find({ text: /^│ Woche 50 % · 1,20 \$$/ })).toBeDefined()
    expect(await ui.find({ text: /^│ Abo 5,20 \$ = 0,0×$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '· /ledger limits' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Heute' })).toBeDefined()
    await ui.unmount()
  })

test('0.5.0: ohne Fenster und Plan keine Limit-Zeile in der Übersicht', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 0.5)
  const text = await w.ledger($)
  expect(text).not.toMatch(/^Limits:/m)
  const ui = await mountLedger($, text, 'terminal')
  expect(await ui.find({ text: /\/ledger limits/ })).toBeUndefined()
  await ui.unmount()
})

test('0.5.0: Text für Claude ≤ 10 Zeilen für limits und die Übersicht, auch mit allen Hinweisen', DE, async ($, on) => {
  const w = await limitsWorld($, on)
  for (const args of ['', 'limits', 'weeks']) expect((await w.ledger($, args)).split('\n').length <= 10, args).toBe(true)
  const limits = await w.ledger($, 'limits')
  expect(limits.split('\n')[0]).toMatch(/^\*\*Kostenbuch · Limits\*\* · Stand 06\.10\. 12:00 · #[0-9a-z]{5,}$/)
  expect(limits).toMatch(/^5 Stunden: 30 % · 1,20 \$ · Reset 15:00 \(in 3 h 0 min\) · 100 % ≈ 4,00 \$ \(Schätzung\)$/m)
  expect(limits).toMatch(/^Woche: 50 % · 1,20 \$ · Reset Sa 10\.10\. 12:00 \(in 4 T 0 h\) · Hochrechnung ab dem nächsten Fenster · ab 06\.10\.$/m)
  expect(limits).toMatch(/^Abo-Monat: Max 20x · seit 08\.09\. · erneuert 08\.10\. \(in 2 Tagen\) · 5,20 \$ API-Wert für 207,00 \$ Abo = 0,0× \(ab 06\.10\.\)$/m)
  expect(limits).toMatch(/^Letzte 5-Stunden-Fenster: 06\.10\. 10–15 1,20 \$ 30 % läuft · 06\.10\. 05–10 4,00 \$ 80 %$/m)
  // Mit allen Hinweisen (Speicher voll, unlesbar, ohne Kosten, Schreibfehler) bleibt es bei 10 Zeilen
  const r = aggregate([{ id: 'A', rec: recOf('P', { [TODAY]: 1 }) }], NOW, {
    hasCost: false,
    unreadable: 2,
    storeBytes: 4 * 1024 * 1024,
    writeError: 'voll',
    plan: { v: 1, plan: 'max20', day: 8, at: NOW },
    live: RL(T5, 30, TW, 50).map((x) => ({ kind: x.kind, pct: x.percentUsed, resetsAt: Date.parse(x.resetsAt) })),
  })
  for (const view of ['overview', 'weeks', 'limits'] as const) {
    const s = summaryText(r, view, 30, '#x0000', 'de').split('\n')
    expect(s.length <= 10, view).toBe(true)
    expect(s[s.length - 1], view).toMatch(/Schätzungen|Kontingent/)
  }
})

test('0.5.0: Formatierer für Reset, Dauer, Fenster, Prozent und Faktor in beiden Sprachen', () => {
  expect(clock(NOW)).toBe('12:00')
  expect(resetTime(T5, NOW, 'de')).toBe('15:00')
  expect(resetTime(TW, NOW, 'de')).toBe('Sa 10.10. 12:00')
  expect(resetTime(TW, NOW, 'en')).toBe('Sat Oct 10 12:00')
  expect(duration(3 * H + 50 * 60_000 + 59_000, 'de')).toBe('3 h 50 min')
  expect(duration(12 * 60_000, 'en')).toBe('12 min')
  expect(duration(30_000, 'en')).toBe('< 1 min')
  expect(duration(4 * DAY + 16 * H + 5 * 60_000, 'de')).toBe('4 T 16 h')
  expect(duration(4 * DAY + 16 * H, 'en')).toBe('4 d 16 h')
  expect(span(NOW + H, NOW + 6 * H, 'de')).toBe('06.10. 13–18')
  expect(span(NOW + 7 * H, NOW + 12 * H, 'de')).toBe('06.10. 19–24') // Ende um Mitternacht
  expect(span(NOW + 4 * H + 10 * 60_000, NOW + 9 * H + 10 * 60_000, 'en')).toBe('Oct 6 16:10–21:10')
  expect(pct(62.4)).toBe('62 %')
  expect(pct(23.5)).toBe('24 %')
  expect(factor(4.06, 'de')).toBe('4,1')
  expect(factor(4.06, 'en')).toBe('4.1')
})

test('0.5.0 Englisch (Standard): /ledger limits, plan und die Limit-Zeile', async ($, on) => {
  const w = world(on, { saved: new Map<string, unknown>([['meta:limSince', NOW - 7 * H]]) })
  await w.start($)
  expect(await w.ledger($, 'plan max20 8 207')).toBe('Plan saved: Max 20x, billing day 8, $207.00/month. Subscription month since Sep 8, renews Oct 8 · details: /ledger limits')
  w.st.rl = RL(T5, 30, TW, 50)
  await w.turn($, 1.2)
  const text = await w.ledger($, 'limits')
  expect(text).toMatch(/^\*\*Cost ledger · limits\*\* · as of Oct 6 12:00 · #/)
  expect(text).toMatch(/^5 hours: 30 % · \$1\.20 · reset 15:00 \(in 3 h 0 min\) · 100 % ≈ \$4\.00 \(estimate\)$/m)
  expect(text).toMatch(/^Week: 50 % · \$1\.20 · reset Sat Oct 10 12:00 \(in 4 d 0 h\) · projection from the next window · from Oct 6$/m)
  expect(text).toMatch(/^Subscription month: Max 20x · since Sep 8 · renews Oct 8 \(in 2 days\) · \$1\.20 API value for a \$207\.00 plan = 0\.0×/m)
  expect(text).toMatch(/% applies to the whole account \(incl\. claude\.ai\)/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountLedger($, text, surface)
    expect(await ui.find({ type: 'Text', text: 'cost-ledger · limits' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5 hours · reset 15:00 (in 3 h 0 min)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Subscription month · Max 20x · since Sep 8 · renews Oct 8 (in 2 days)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Last 5-hour windows' })).toBeDefined()
    expect(await ui.find({ text: /Stunden|Woche|Abo-Monat/ })).toBeUndefined()
    await ui.unmount()
  }
  expect((await w.ledger($)).split('\n')[1]).toBe('Limits: 5 h 30 % · $1.20 · reset 15:00 | week 50 % · $1.20 | plan $1.20 = 0.0× · /ledger limits')
  expect(await w.ledger($, 'help')).toMatch(/^- `\/ledger limits`: .*\n- `\/ledger plan`: .*\n- `\/ledger plan <plan> <day\|today> \[price\]`: /m)
  expect(await w.ledger($, 'plan nope 3')).toMatch(/^Not saved: “nope 3” is not valid\.\n/)
})

// ---------- 0.5.0: Befunde aus dem Review ----------

test('0.5.0 Review: Nachbuchung beim Resume geht ins Fenster der letzten Buchung, nicht ins laufende', DE, async ($, on) => {
  const kOld = String(NOW - 2 * DAY + H)
  const old = {
    ...newRec({ project: 'P', root: ROOT, title: 'Alt', kind: 'terminal' }, NOW - 2 * DAY, 1),
    days: { [dayBefore(NOW, 2)]: 1 },
    lim: { five_hour: { [kOld]: limW({ chat: 1, pct: 40, first: NOW - 2 * DAY, last: NOW - 2 * DAY }) } },
  }
  // Hartes Ende mitten im Turn: gebucht war 1 $, der Zähler steht beim Resume auf 3 $
  const w = world(on, { saved: new Map<string, unknown>([['s:S1', old]]), cost: 3 })
  await w.start($, 'S1', 'resume')
  w.st.rl = RL(T5, 10)
  await w.turn($, 3.1)
  near(w.rec()!.lim.five_hour![String(T5)]!.chat, 0.1)
  near(w.rec()!.lim.five_hour![kOld]!.chat, 3) // 1 $ + Nachbuchung 2 $
  near(w.rec()!.days[TODAY]!, 2.1) // der Tag bucht wie bisher alles heute
})

test('0.5.0 Review: Nachbuchung ohne Fenster der letzten Buchung (Datensatz vor 0.5.0) bleibt nur im Tag', DE, async ($, on) => {
  const old = { ...newRec({ project: 'P', root: ROOT, title: 'Alt', kind: 'terminal' }, NOW - 2 * DAY, 1), days: { [dayBefore(NOW, 2)]: 1 } }
  const w = world(on, { saved: new Map<string, unknown>([['s:S1', old]]), cost: 3 })
  await w.start($, 'S1', 'resume')
  w.st.rl = RL(T5, 10)
  await w.turn($, 3.1)
  expect(Object.keys(w.rec()!.lim.five_hour!)).toEqual([String(T5)])
  near(w.rec()!.lim.five_hour![String(T5)]!.chat, 0.1)
  near(w.rec()!.days[TODAY]!, 2.1)
})

test('0.5.0 Review: carry von vor einem fremden Reset verfällt auch nach /clear (ohne Datensatz)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.rl = RL(NOW + H, 40)
  await w.turn($, 0.2)
  await w.clock.advance(2 * H)
  w.st.cost = 0.3
  await w.ledger($) // 0,10 $ warten in carry (Fenster abgelaufen)
  await w.clock.advance(1000)
  w.saved.delete('s:S1')
  w.saved.set('meta:resetAt', NOW + 2 * H + 1000) // Reset in einem anderen Chat
  await w.clock.advance(1000)
  await $.session.end({ reason: 'clear' } as never)
  w.st.cost = 0
  await $.classic.SessionStart({ source: 'clear', session_id: 'S2' })
  w.st.rl = RL(NOW + 7 * H, 3)
  await w.turn($, 0.1)
  near(w.rec('S2')!.lim.five_hour![String(NOW + 7 * H)]!.chat, 0.1)
})

test('0.5.0 Review: session.end bucht den Rest ins Fenster, mit genau einem store.set und ohne meta:limSince', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.rl = RL(T5, 30, TW, 50)
  w.st.cost = 0.4
  const before = w.st.sets
  expect(await $.session.end({ reason: 'other' } as never)).toEqual({ sessionId: 'x' })
  expect(w.st.sets - before).toBe(1) // Budget 1,5 s: nur der Datensatz
  near(w.rec()!.lim.five_hour![String(T5)]!.chat, 0.4)
  near(w.rec()!.lim.seven_day![String(TW)]!.chat, 0.4)
  expect(w.saved.has('meta:limSince')).toBe(false)
})

test('0.5.0 Review: ein später gesetztes meta:limSince macht ältere Fenster anderer Chats nicht unvollständig', DE, async ($, on) => {
  const k = String(NOW - 2 * H) // Chat B: 05–10 Uhr, abgeschlossen, 50 %, 5 $, ab Fensterbeginn erfasst
  const b = recOf('B', { [TODAY]: 5 }, { lim: { five_hour: { [k]: limW({ chat: 5, pct: 50, first: NOW - 7 * H, last: NOW - 2 * H }) } } })
  const w = world(on, { saved: new Map<string, unknown>([['s:B', b]]) }) // kein meta:limSince
  await w.start($)
  w.st.rl = RL(T5, 10)
  await w.turn($, 0.1) // dieser Prozess setzt meta:limSince erst jetzt (12:00)
  expect(w.saved.get('meta:limSince')).toBe(NOW)
  const text = await w.ledger($, 'limits')
  expect(text).toMatch(/^Ø 100 % ≈ 10,00 \$ aus 1 Fenster \(≥ 20 %, Schätzung\)$/m)
  expect(text).toMatch(/06\.10\. 05–10 5,00 \$ 50 %$/m)
})

test('0.5.0 Review: /ledger plan constructor, __proto__ … sind ungültig und lassen den Plan stehen', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.ledger($, 'plan max20 8 207')
  for (const bad of ['constructor 8', '__proto__ 8', 'tostring 8', 'hasownproperty 8'])
    expect(await w.ledger($, `plan ${bad}`), bad).toMatch(/^Nicht gespeichert:/)
  expect(w.saved.get('meta:plan')).toEqual({ v: 1, plan: 'max20', day: 8, price: 207, at: NOW })
  expect(cleanPlan({ v: 1, plan: 'constructor', day: 8, at: NOW })).toBeNull()
})

test('0.5.0 Review: Limit-Zeile auch im Leerzustand direkt nach /ledger reset', DE, async ($, on) => {
  const w = world(on, { answer: 'Löschen' })
  await w.start($)
  await w.ledger($, 'plan max20 8 207')
  w.st.rl = RL(T5, 30)
  await w.turn($, 1)
  await w.ledger($, 'reset')
  const text = await w.ledger($)
  expect(text).toMatch(/^Limits: 5 Std\. 30 % · 0,00 \$ · Reset 15:00 \| Abo 0,00 \$ = 0,0× · \/ledger limits$/m)
  expect(text).toMatch(/Noch keine Einträge/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountLedger($, text, surface)
    expect(await ui.find({ text: /^5 Std\. 30 %/ })).toBeDefined()
    expect(await ui.find({ text: /Noch keine Einträge/ })).toBeDefined()
    await ui.unmount()
  }
})

/** Mindestbreite einer Zeile ohne Umbruch: feste Breiten, sonst minWidth + marginRight (Desktop-Balken). */
const minRow = (r: any) =>
  r.children.reduce((a: number, c: any) => {
    const p = typeof c === 'object' ? c.props ?? {} : {}
    return a + (typeof p.width === 'number' ? p.width : (typeof p.minWidth === 'number' ? p.minWidth : 0) + (typeof p.marginRight === 'number' ? p.marginRight : 0))
  }, 0)

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of [40, 57, 58, 60])
    test(`0.5.0 Review UI ${surface}: /ledger limits bei ${columns} Spalten ohne Überlauf`, DE, async ($, on) => {
      const w = await limitsWorld($, on)
      const ui = await mountLedger($, await w.ledger($, 'limits'), surface, columns)
      const boxes = await ui.findAll({ type: 'Box' })
      expect(boxes.map((b: any) => b.props.width).filter((x: unknown) => typeof x === 'number').every((x: number) => x <= columns - 4)).toBe(true)
      for (const r of boxes.filter((b: any) => b.props.flexDirection === 'row' && !b.props.flexWrap)) expect(minRow(r) <= columns - 4, `${minRow(r)}`).toBe(true)
      expect(await ui.find({ type: 'Text', text: '06.10. 05–10' })).toBeDefined()
      await ui.unmount()
    })

test('0.5.0 Review 2: Mod-Aufruf zwischen Resume und erstem Turn verschiebt die Nachbuchung nicht', { plugins: [sidekick], ...DE }, async ($, on) => {
  const kOld = String(NOW - 2 * DAY + H)
  const old = {
    ...newRec({ project: 'P', root: ROOT, title: 'Alt', kind: 'terminal' }, NOW - 2 * DAY, 1),
    days: { [dayBefore(NOW, 2)]: 1 },
    lim: { five_hour: { [kOld]: limW({ chat: 1, pct: 40, first: NOW - 2 * DAY, last: NOW - 2 * DAY }) } },
  }
  const w = world(on, { saved: new Map<string, unknown>([['s:S1', old]]), cost: 3 })
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: MILLION_IN } as never }))
  await w.start($, 'S1', 'resume')
  await $.command.run({ command: 'probe', args: '' }) // sidekick vor dem ersten Turn: kein Fenster bekannt → carry
  w.st.rl = RL(T5, 10)
  await w.turn($, 3.1)
  near(w.rec()!.lim.five_hour![kOld]!.chat, 3)
  const cur = w.rec()!.lim.five_hour![String(T5)]!
  near(cur.chat, 0.1)
  near(cur.mod, 0.5)
})

test('0.5.0 Review 2: Fenster ohne gebuchten Betrag zählen nicht zum Ø', () => {
  const k1 = String(NOW - H)
  const k2 = String(NOW - 6 * H)
  const r = recOf('P', {}, { lim: { five_hour: { [k1]: limW({ chat: 0, pct: 50 }), [k2]: limW({ chat: 6, pct: 30 }) } } })
  const l = limitsReport([{ rec: r }], NOW, {})
  expect(l.avg!.n).toBe(1)
  near(l.avg!.usd, 20)
  expect(limitsReport([{ rec: recOf('P', {}, { lim: { five_hour: { [k1]: limW({ chat: 0, pct: 50 }) } } }) }], NOW, {}).avg).toBeNull()
})

test('0.5.0 Review 2: model.fork und model.classify mit {deny} buchen nichts und geben die Ablehnung weiter', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.fork', () => ({ deny: 'kein Fork' }))
  on('model.classify', () => ({ deny: 'kein Classify' }))
  await w.start($)
  w.st.rl = RL(T5, 10)
  // Die Probe fängt die Ablehnung bei fork/classify nicht ab: ihr command.run scheitert, cost-ledger bucht nichts
  await expect($.command.run({ command: 'probe', args: 'fork' })).rejects.toThrow()
  await expect($.command.run({ command: 'probe', args: 'classify' })).rejects.toThrow()
  expect(w.rec()).toBeUndefined()
})

test('0.5.0 Review 2: /ledger plan und reset bei vollem Speicher → lesbarer Hinweis statt Fehler', DE, async ($, on) => {
  const w = world(on, { answer: 'Löschen' })
  await w.start($)
  await w.turn($, 1)
  w.st.setFails = true
  // Ein werfender Stub wird übersprungen, der Aufruf scheitert dann mit „no implementation“ (docs/raw/en/test.md:182)
  expect(await w.ledger($, 'plan max20 8 207')).toMatch(/^Speichern scheiterte zuletzt: .*store\.set/)
  expect(w.saved.has('meta:plan')).toBe(false)
  expect(await w.ledger($, 'reset')).toMatch(/^Speichern scheiterte zuletzt: .*store\.set/)
})

test('0.5.0 Review: keine Hochrechnung „100 % ≈ 0,00 $“ ohne gebuchten Betrag', () => {
  const l = limitsReport([{ rec: recOf('P', {}, { lim: { five_hour: { [String(T5)]: limW({ chat: 0, pct: 30 }) } } }) }], NOW, {})
  expect(l.five!.proj).toBeNull()
  expect(projectionText(l.five!, 'de')).toBe('keine Hochrechnung ohne gebuchten Betrag')
  expect(projectionText(l.five!, 'en')).toBe('no projection without a recorded amount')
})

test('0.5.0 Review: unvollständige abgeschlossene Fenster tragen „ab …“ auch im Text; der Ø-Hinweis sagt „vollständig erfasst“', DE, async ($, on) => {
  const k = String(NOW - 2 * H) // 05–10, abgeschlossen, 80 %, erfasst ab 08:00
  const b = recOf('B', { [TODAY]: 4 }, { rl: { [TODAY]: { five_hour: 80 } }, lim: { five_hour: { [k]: limW({ chat: 4, pct: 80, first: NOW - 4 * H, last: NOW - 2 * H }) } } })
  const w = world(on, { saved: new Map<string, unknown>([['s:B', b], ['meta:limSince', NOW - 4 * H]]) })
  await w.start($)
  const text = await w.ledger($, 'limits')
  expect(text).toMatch(/^Letzte 5-Stunden-Fenster: 06\.10\. 05–10 4,00 \$ 80 % ab 08:00$/m)
  expect(text).toMatch(/^Ø 100 %: noch kein vollständig erfasstes, abgeschlossenes Fenster mit ≥ 20 %$/m)
})

// ---------- 0.6.0: /ledger help (docs/HELP-SPEC.md §6) ----------

const GREEN = 'success' // Akzent als Theme-Key (HELP-SPEC §4, Fynn 2026-10-09)

/** Alle Texte eines Baums, rekursiv (für Suchen ohne die Engine). */
const allText = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(allText).join(''))

test('0.6.0 Hilfe: help, hilfe, ? und HELP liefern Markdown mit Kennung, en und de; weitere Wörter sind unbekannt', async ($, on) => {
  const w = world(on)
  await w.start($)
  for (const word of ['help', 'hilfe', '?', 'HELP']) {
    const text = await w.ledger($, word)
    expect(text, word).toMatch(/^\*\*cost-ledger · Help\*\* · #[0-9a-z]{5,}\n\nRecords what your chats and other mods cost/)
    expect(text.length < 10_000, word).toBe(true)
  }
  expect(await w.ledger($, 'help me')).toBe('Unknown: “help me”. All commands: /ledger help')
  expect(await w.ledger($, 'days')).toBe('Unknown: “days”. All commands: /ledger help') // days ist gestrichen (HELP-SPEC §5)
})

test('0.6.0 Hilfe (de): Markdown mit Befehlen, Funktionen, Einstellungen und Terminal-Fußzeile', { options: { language: 'de', keepDays: 30 } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await w.ledger($, 'hilfe')
  const lines = text.split('\n')
  expect(lines[0]).toMatch(/^\*\*cost-ledger · Hilfe\*\* · #[0-9a-z]{5,}$/)
  expect(lines).toContain('**BEFEHLE**')
  expect(lines).toContain('- `/ledger`: Übersicht: heute, 7 und 30 Tage, gesamt, letzte 14 Tage, Projekte, teuerste Chats, Mods')
  expect(lines).toContain('- `/ledger plan off`: Abo-Einstellung löschen')
  expect(lines).toContain('Deutsche Wörter gehen auch: hilfe, alle, heute, aus.')
  expect(text).toMatch(/^\*\*FUNKTIONEN:\*\* Abo ○ kein Abo \(\/ledger plan max20 14\) · Speicher belegt 0 % von 4 MiB \(nur Info\) · Erfasst seit 06\.10\.2026 \(nur Info\)$/m)
  expect(text).toMatch(/^\*\*EINSTELLUNGEN \(\/plugin\):\*\* Sprache de · Aufbewahrung \(Tage\) 30 · Tagesbetrag gelb ab \(\$\) 3 \(Standard\) · Tagesbetrag rot ab \(\$\) 8 \(Standard\)$/m)
  expect(lines[lines.length - 1]).toBe('Einstellungen ändern: /plugin configure cost-ledger · Mod abschalten: /plugin disable cost-ledger')
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`0.6.0 Hilfe UI ${surface}: Tabelle mit Titel, Abschnitten, Befehlen in Grün, Schaltern und passender Fußzeile`, DE, async ($, on) => {
    const w = world(on)
    await w.start($)
    const ui = await mountLedger($, await w.ledger($, 'help'), surface)
    expect(await ui.find({ text: /^ENGINE:/ })).toBeUndefined()
    const tree = await ui.drawn()
    expect(tree.props).toMatchObject({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%', key: 'cost-ledger-help' })
    expect((await ui.find({ type: 'Text', text: 'cost-ledger · Hilfe' }))?.props).toMatchObject({ color: GREEN, bold: true })
    for (const h of ['BEFEHLE', 'FUNKTIONEN', 'STATUS', 'UMSCHALTEN', 'EINSTELLUNGEN (/plugin)', 'WERT'])
      expect((await ui.find({ type: 'Text', text: h }))?.props.color, h).toBe(GREEN)
    expect(await ui.find({ type: 'Text', text: 'BEDIENUNG' })).toBeUndefined() // keine Klicks oder Tasten → Abschnitt entfällt
    for (const cmd of ['/ledger', '/ledger weeks', '/ledger chats|projects|models [7|30|all]', '/ledger limits', '/ledger plan <plan> <day|today> [price]', '/ledger reset', '/ledger help'])
      expect((await ui.find({ type: 'Text', text: cmd }))?.props.color, cmd).toBe(GREEN)
    // Akzentfarbe nur für Titel, Überschriften und Befehle, nie für Fließtext
    expect((await ui.find({ type: 'Text', text: /^Übersicht: heute/ }))?.props.color).toBeUndefined()
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some((x: any) => x.children?.[0] === '○ ' && x.props.color === 'inactive')).toBe(true)
    expect(texts.some((x: any) => x.children?.[0] === 'kein Abo' && x.props.color === 'inactive')).toBe(true)
    expect(await ui.find({ type: 'Text', text: '/ledger plan max20 14' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' (Standard)' })).toBeDefined()
    const footer =
      surface === 'desktop'
        ? 'Mod abschalten: + → Plugins → Manage plugins · Einstellungen ändern: im Terminal /plugin configure cost-ledger'
        : 'Einstellungen ändern: /plugin configure cost-ledger · Mod abschalten: /plugin disable cost-ledger'
    expect(await ui.find({ type: 'Text', text: footer })).toBeDefined()
    await ui.unmount()
  })

test('0.6.0 Hilfe: Zustand stimmt beim Aufruf: Abo einstellen → ●, Abo aus → ○; Speicher und Erfasst seit', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 1)
  await w.ledger($, 'plan max20 8 207')
  const on1 = await mountLedger($, await w.ledger($, 'help'), 'terminal')
  expect((await on1.findAll({ type: 'Text' })).some((x: any) => x.children?.[0] === '● ' && x.props.color === 'success')).toBe(true)
  expect(await on1.find({ type: 'Text', text: 'Max 20x · Tag 8 · 207,00 $ im Monat' })).toBeDefined()
  expect(await on1.find({ type: 'Text', text: '/ledger plan off' })).toBeDefined()
  expect(await on1.find({ type: 'Text', text: '06.10.2026' })).toBeDefined()
  expect(await on1.find({ type: 'Text', text: /^\d+ % von 4 MiB$/ })).toBeDefined()
  await on1.unmount()
  await w.ledger($, 'plan max5 1')
  expect(await w.ledger($, 'help')).toMatch(/Abo ● Max 5x · Tag 1 · 100,00 \$ im Monat \(Listenpreis\) \(\/ledger plan off\)/)
  await w.ledger($, 'plan off')
  const off = await mountLedger($, await w.ledger($, 'help'), 'desktop')
  expect(await off.find({ type: 'Text', text: 'kein Abo' })).toBeDefined()
  expect((await off.findAll({ type: 'Text' })).some((x: any) => x.children?.[0] === '● ')).toBe(false)
  await off.unmount()
})

test('0.6.0 Hilfe: nur lesend (kein Schreiben, kein Aufräumen); Lesefehler → Hilfe trotzdem', { options: { keepDays: 1, language: 'de' } }, async ($, on) => {
  const old = recOf('P', { [dayBefore(NOW, 40)]: 1 }, { lastAt: NOW - 40 * DAY })
  const w = world(on, { saved: new Map<string, unknown>([['s:OLD', old], ['meta:since', NOW - 50 * DAY]]) })
  await w.start($)
  const sets = w.st.sets
  const text = await w.ledger($, 'help')
  expect(w.st.sets).toBe(sets)
  expect(w.saved.has('s:OLD')).toBe(true) // aufgeräumt wird nur bei /ledger
  expect(text).toMatch(/Erfasst seit 17\.08\.2026/) // 50 Tage vor dem 06.10.
  expect(text).toMatch(/Aufbewahrung \(Tage\) 1 ·/)
})

test('0.6.0 Hilfe: store.keys scheitert → Hilfe mit Befehlen und Einstellungen, Fehler im Debug-Log', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  w.st.keysFail = true
  const text = await w.ledger($, 'help')
  expect(text).toMatch(/^\*\*cost-ledger · Hilfe\*\*/)
  expect(text).toMatch(/Abo ○ kein Abo/)
  expect(w.st.logs.some((l) => /\/ledger help/.test(l))).toBe(true)
})

test('0.6.0 Hilfe UI: VS Code, Fehlerzeile und unbekannte Kennung → Engine zeichnet den Markdown-Text', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  const text = await w.ledger($, 'help')
  const vscode = await mountLedger($, text, 'vscode')
  expect(await vscode.find({ text: /^ENGINE:/ })).toBeDefined()
  await vscode.unmount()
  const errored = await $.ui.mount({
    plugin: 'cost-ledger', component: 'CommandOutput', requestId: 'help-err', surface: 'terminal', viewport: { columns: 100, rows: 30 },
    props: { command: 'ledger', args: 'help', text, isErrored: true },
  })
  expect(await errored.find({ text: /^ENGINE:/ })).toBeDefined()
  await errored.unmount()
  const unknown = await mountLedger($, '**cost-ledger · Hilfe** · #zzzzzz', 'desktop')
  expect(await unknown.find({ text: /^ENGINE:/ })).toBeDefined()
  await unknown.unmount()
  // Kennung auch hinter einem Präfix wie in -p („cost-ledger: …“)
  const prefixed = await mountLedger($, `cost-ledger: ${text}`, 'terminal', 120, 'help')
  expect(await prefixed.find({ type: 'Text', text: 'cost-ledger · Hilfe' })).toBeDefined()
  await prefixed.unmount()
})

test('0.6.0 Review: eine gültige Kennung als Argument zeigt „Unbekannt“, nicht die Tabelle (Review worklist 0.7.0, K2)', DE, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turn($, 1)
  const help = await w.ledger($, 'help')
  const helpTag = /#[0-9a-z]{5,}/.exec(help)![0]
  const overview = await w.ledger($)
  const viewTag = /#[0-9a-z]{5,}/.exec(overview)![0]
  for (const tag of [helpTag, viewTag]) {
    const text = await w.ledger($, tag) // „Unbekannt: „#…“. Alle Befehle: /ledger help“, mit der Kennung in Zeile 1
    expect(text).toBe(`Unbekannt: „${tag}“. Alle Befehle: /ledger help`)
    const ui = await mountLedger($, text, 'terminal', 120, tag)
    expect(await ui.find({ text: /^ENGINE:Unbekannt/ }), tag).toBeDefined()
    await ui.unmount()
  }
  // Groß- und Kleinschreibung und Leerzeichen der Argumente stören die eigene Zeile nicht
  const ui = await mountLedger($, help, 'desktop', 120, '  HELP ')
  expect(await ui.find({ type: 'Text', text: 'cost-ledger · Hilfe' })).toBeDefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of [30, 40, 59, 60, 100, 140, 200])
    test(`0.6.0 Hilfe UI ${surface} bei ${columns} Spalten: nichts zu breit, Desktop nur ganzzahlige Prozent`, DE, async ($, on) => {
      const w = world(on)
      await w.start($)
      await w.ledger($, 'plan max20 8 207')
      const ui = await mountLedger($, await w.ledger($, 'help'), surface, columns)
      const inner = Math.max(30, Math.min(140, columns)) - 4
      const boxes = await ui.findAll({ type: 'Box' })
      const widths = boxes.map((b: any) => b.props.width).filter((x: unknown) => x !== undefined)
      if (surface === 'desktop') expect(widths.filter((x: unknown) => !(typeof x === 'string' && /^\d+%$/.test(x)))).toEqual([])
      else expect(widths.filter((x: unknown) => typeof x === 'number' && x > inner)).toEqual([])
      // Prozent-Spalten einer Zeile ergeben zusammen genau 100
      for (const r of boxes.filter((b: any) => b.props.flexDirection === 'row' && b.children?.length && b.children.every((c: any) => typeof c === 'object' && /^\d+%$/.test(String(c.props?.width)))))
        expect((r as any).children.reduce((a: number, c: any) => a + parseInt(c.props.width, 10), 0)).toBe(100)
      // Feste Spalten einer Zeile passen in die Zeile
      for (const r of boxes.filter((b: any) => b.props.flexDirection === 'row'))
        expect((r as any).children.reduce((a: number, c: any) => a + (typeof c === 'object' && typeof c.props?.width === 'number' ? c.props.width : 0), 0) <= inner).toBe(true)
      // Unter 60 Spalten stehen die Spalten untereinander: keine Zeile mit festen Spalten
      if (columns < 60) expect(boxes.some((b: any) => b.props.flexDirection === 'row' && b.children?.some((c: any) => typeof c === 'object' && c.props?.width !== undefined))).toBe(false)
      expect(await ui.find({ type: 'Text', text: '/ledger plan <plan> <day|today> [price]' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Tagesbetrag rot ab ($)' })).toBeDefined()
      await ui.unmount()
    })

test('0.6.0 Hilfe Vollständigkeit: jedes Wort, das der Parser annimmt, steht als ganzes Wort in der Hilfe (HELP-SPEC §6 Punkt 5)', () => {
  // Ganze Wörter statt Teilstrings (Review 0.6.0): „pro“ steckt sonst in „projects“, „all“ in „all time“
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9?]+/).filter(Boolean))
  for (const lang of ['en', 'de'] as const) {
    const d = ledgerHelp(cleanSettings({ language: lang }), { plan: null, storeBytes: 0, since: null })
    const cmds = tokens(d.commands.map((c) => c.cmd).join(' '))
    const notes = tokens((d.notes ?? []).join(' '))
    const row = (cmd: string) => d.commands.find((c) => c.cmd === cmd)!
    // Erstes Wort: Ansichten, plan, reset, help stehen als Befehl; '?' und deutsche Aliase in Wirkung bzw. Notiz
    for (const w of [...VIEW_WORDS, 'plan', 'reset', 'help']) expect(cmds.has(w), `${lang}: ${w}`).toBe(true)
    expect(row('/ledger help').does.includes('?'), lang).toBe(true)
    // Englische Wörter im Befehl, deutsche Aliase in der Notiz
    const english = (list: readonly string[]) => list.filter((w) => /^[a-z]+$/.test(w) && !notes.has(w))
    const lists = /\[([^\]]+)\]/.exec(row('/ledger chats|projects|models [7|30|all]').cmd)![1]!.split('|')
    for (const w of english(RANGE_WORDS)) expect(lists, `${lang}: ${w}`).toContain(w)
    for (const w of english(TODAY_WORDS)) expect(cmds.has(w), `${lang}: ${w}`).toBe(true)
    for (const w of english(OFF_WORDS)) expect(cmds.has(w), `${lang}: ${w}`).toBe(true)
    for (const w of [...HELP_WORDS, ...RANGE_WORDS, ...TODAY_WORDS, ...OFF_WORDS].filter((w) => w !== '?'))
      expect(cmds.has(w) || notes.has(w), `${lang}: ${w}`).toBe(true)
    // Plan-Namen samt Aliasen als ganze Wörter in der Plan-Zeile
    const planRow = tokens(row('/ledger plan <plan> <day|today> [price]').does)
    for (const w of planWords()) expect(planRow.has(w), `${lang}: ${w}`).toBe(true)
    expect(lists).toEqual(['7', '30', 'all'])
    expect(cmds.has('days'), lang).toBe(false) // days ist kein Befehl mehr
  }
})

test('0.6.0 Hilfe: Werte, Standard und Zustandstexte (stateText, ledgerHelp)', () => {
  const de = ledgerHelp(cleanSettings({ language: 'de', dayYellow: 2.5, dayRed: 9 }), { plan: { v: 1, plan: 'team', day: 3, at: NOW }, storeBytes: 1024 * 1024, since: NOW })
  expect(de.features[0]).toEqual({ name: 'Abo', state: { kind: 'on', text: 'Team · Tag 3 · ohne Preis' }, toggle: '/ledger plan off' })
  expect(de.features[1]!.state).toEqual({ kind: 'value', text: '25 % von 4 MiB' })
  expect(de.settings.map((s) => [s.value, s.isDefault])).toEqual([['de', false], ['365', true], ['2,5', false], ['9', false]])
  const en = ledgerHelp(cleanSettings({}), { plan: null, storeBytes: 0, since: null })
  expect(en.settings[0]).toEqual({ title: 'Language', value: 'en', isDefault: true })
  expect(en.features[2]!.state).toEqual({ kind: 'value', text: '–' })
  expect(stateText({ kind: 'on' }, 'de')).toBe('● an')
  expect(stateText({ kind: 'off' }, 'en')).toBe('○ off')
  expect(stateText({ kind: 'value', text: '365', isDefault: true }, 'en')).toBe('365 (default)')
})

test('0.6.0 Hilfe-Modul allgemein: BEDIENUNG nur mit Einträgen, leere Abschnitte entfallen, Akzent frei wählbar', () => {
  const d = {
    mod: 'demo', lang: 'en' as const, intro: 'Demo.', commands: [{ cmd: '/demo', does: 'Status' }],
    controls: [{ cmd: 'Click', does: 'Pokes it' }], features: [], settings: [], footer: { terminal: 'T', desktop: 'D' },
  }
  const t = helpTree(d, 100, 'terminal', '#123456') as any
  const all = allText(t)
  expect(all).toMatch(/CONTROLS/)
  expect(all).not.toMatch(/FEATURES|SETTINGS/)
  expect(all.endsWith('T')).toBe(true)
  expect(t.children[0].props.color).toBe('#123456')
  expect(allText(helpTree(d, 100, 'desktop', '#123456')).endsWith('D')).toBe(true)
  // Leerzeilen zwischen den Blöcken: sonst hängt Markdown alles nach der Liste an deren letzten Punkt (Review 0.6.0)
  expect(helpMarkdown(d, '#abcde').split('\n')).toEqual(['**demo · Help** · #abcde', '', 'Demo.', '', '**COMMANDS**', '- `/demo`: Status', '', '**CONTROLS**', '- `Click`: Pokes it', '', 'T'])
  // Schalter: ohne eigenen Text ist „an“ grün wie der Punkt; mit Text nur der Punkt
  const sw = helpTree({ ...d, controls: [], features: [{ name: 'A', state: { kind: 'on' }, toggle: '/demo off' }, { name: 'B', state: { kind: 'on', text: 'lang' }, toggle: 'x' }] }, 100, 'terminal', '#123456') as any
  const flat: any[] = []
  const walk = (n: any) => {
    if (n && typeof n === 'object') {
      flat.push(n)
      for (const c of n.children ?? []) walk(c)
    }
  }
  walk(sw)
  expect(flat.some((n) => n.type === 'Text' && n.children?.[0] === 'on' && n.props?.color === 'success')).toBe(true)
  expect(flat.some((n) => n.type === 'Text' && n.children?.[0] === 'lang' && n.props?.color === undefined)).toBe(true)
  // Unter 60 Spalten: Zustand und Umschalten in einem Text (bricht als ein Absatz um, nicht als zwei Spalten)
  const narrow = helpTree({ ...d, controls: [], features: [{ name: 'A', state: { kind: 'on', text: 'Max 5x · Tag 1 · 100,00 $ im Monat (Listenpreis)' }, toggle: '/demo off' }] }, 50, 'terminal', '#123456') as any
  const nodes: any[] = []
  const walk2 = (n: any) => {
    if (n && typeof n === 'object') {
      nodes.push(n)
      for (const c of n.children ?? []) walk2(c)
    }
  }
  walk2(narrow)
  const holder = nodes.find((n) => n.type === 'Text' && n.children?.some((c: any) => typeof c === 'object' && c.children?.[0] === ' · /demo off'))
  expect(holder).toBeDefined()
  expect(nodes.some((n) => n.type === 'Box' && n.props?.flexDirection === 'row' && n.children?.some((c: any) => c === holder))).toBe(false)
})
