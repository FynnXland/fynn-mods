import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { aggregate, callCost, partLabel, cleanRec, cleanRemote, dayBefore, dayKey, isoWeek, modelKey, modelName, newRec, priceFor, projectOf, summaryText, titleFromPrompt, weekStart } from '../hooks/logic.ts'
import { T, dateTime, fullDate, langOf, rangeLabel, shortDate, tokens, usd, weekLabel } from '../hooks/i18n.ts'
import { modelColors, stackedBar } from '../hooks/view.ts'
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

function world(on: On, o: W = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const st = { cost: o.cost === undefined ? 0 : o.cost, setFails: false, logs: [] as string[], asks: [] as string[][], turn: 0, ctx: undefined as number | undefined, rl: [] as { kind: string; percentUsed: number }[] }
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 1000000, ...(st.ctx === undefined ? {} : { percent: st.ctx }) }, rateLimits: st.rl, ...(st.cost === null ? {} : { cost: { usd: st.cost } }) } as never,
  }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  on('session.root', () => ({ value: o.root ?? ROOT }))
  on('session.repo', () => ({ value: (o.repoName || o.remote ? { root: ROOT, remote: o.remote ?? null, internal: false, name: o.repoName ?? null } : null) as never }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    // Ein werfender Stub wird übersprungen; ohne weitere Antwort scheitert der Aufruf (docs/raw/en/test.md:182)
    if (st.setFails) throw new Error('Speicher voll')
    saved.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
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
  expect(modelKey('haiku')).toBe('haiku-4-5')
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
        const r = await $.model.complete({ model: 'haiku', prompt: 'x' })
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
  near(m.usd, 1) // Haiku 1 $ je Million Input
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
  near(w.rec()!.mods.sidekick!.days[TODAY]!.usd, 1) // „usage rides every arm“ (types ModelCompleteResult)
})

test('Preistabelle wie sidekick: Alias, volle ID, unbekannt → Opus 5.5', () => {
  expect(priceFor('haiku').id).toBe('haiku-4-5')
  expect(priceFor('claude-haiku-4-5-20251001').id).toBe('haiku-4-5')
  expect(priceFor('opus[1m]').id).toBe('opus-5-5')
  expect(priceFor('claude-opus-5').id).toBe('opus-5')
  expect(priceFor('???').id).toBe('opus-5-5')
  near(callCost({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }, 'haiku'), 0.1 + 1.25)
})

// ---------- Modelle ----------

const U = (model: string, inp: number, out: number, cr = 0, cw = 0) => ({ input_tokens: inp, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, model })

test('/ledger models: Tokens je Modell aus Turns, Subagents und Mod-Aufrufen; sortiert nach Betrag', { plugins: [sidekick], ...DE }, async ($, on) => {
  const w = world(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'OK', usage: MILLION_IN } as never }))
  await w.start($)
  await w.turn($, 1, { usage: U('claude-opus-5-5', 1000, 50000, 2000000, 100000) })
  await w.turn($, 1.2, { usage: U('claude-opus-5-5', 500, 10000) })
  await w.turn($, 1.3, { agentId: 'a1', usage: U('claude-haiku-4-5-20251001', 200, 3000) })
  await $.command.run({ command: 'probe', args: '' }) // sidekick: Haiku, 1M Input
  const m = w.rec()!.models
  expect(m['opus-5-5']!.days[TODAY]).toMatchObject({ in: 1500, out: 60000, cr: 2000000, cw: 100000, n: 2 })
  expect(m['haiku-4-5']!.days[TODAY]!.n).toBe(1) // Subagent
  expect(w.rec()!.modModels['haiku-4-5']!.days[TODAY]!.n).toBe(1) // sidekick, getrennt (ab 0.3.0)
  expect(w.rec()!.mods.sidekick!.days[TODAY]).toMatchObject({ calls: 1, in: 1000000 })
  const text = await w.ledger($, 'models')
  expect(text).toMatch(/Opus 5\.5: .*2× · Input 1,5k · Output 60k · Cache 2,0M gelesen, 100k geschrieben/)
  expect(text).toMatch(/Haiku 4\.5: .*2×/) // Modellsicht zählt Chat und Mods zusammen
  expect(text.indexOf('Opus 5.5') < text.indexOf('Haiku 4.5')).toBe(true) // Opus ≈ 2,3 $, Haiku ≈ 1,0 $
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
  expect(await w.ledger($, 'help')).toMatch(/\/ledger chats \[7\|30\|all\]/)
  expect(await w.ledger($, 'quatsch')).toMatch(/Unbekannt: „quatsch“/)
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

async function mountLedger($: any, text: string, surface: string, columns = 120) {
  return $.ui.mount({
    plugin: 'cost-ledger',
    component: 'CommandOutput',
    requestId: `r-${surface}-${columns}`,
    surface,
    viewport: { columns, rows: 40 },
    props: { command: 'ledger', args: '', text, isErrored: false },
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
  expect(await w.ledger($, 'help')).toMatch(/\*\*\/ledger chats \[7\|30\|all\]\*\*: the 20 most expensive chats/)
  expect(await w.ledger($, 'hilfe')).toMatch(/^\*\*\/ledger\*\*: overview/)
  expect(await w.ledger($, 'xyz')).toMatch(/^Unknown: “xyz”\.\n\*\*\/ledger\*\*/)
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
