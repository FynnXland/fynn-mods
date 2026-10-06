import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { MIN, completeCost, dayKey, rewriteCost } from '../hooks/cache.ts'
import {
  DEFAULT_SETTINGS,
  addDay,
  bookModel,
  modelRows,
  wrongChatChoices,
  applySetting,
  bookingStep,
  checkSystem,
  handoffEstimate,
  cleanLedger,
  emptyDay,
  historyTail,
  isSuppressed,
  parseVerdict,
  soundsLikeReply,
  planCompaction,
  savingsReport,
  sumPeriod,
  rankChoices,
  triggerOf,
} from '../hooks/logic.ts'
import type { Ledger } from '../hooks/logic.ts'
import { DEFAULT_HINTS, applyHints, availOf, cleanWartung, doneFromSkill, doneFromText, memoryMeasure, normModel, pickHint, projectKey, rebase, rootFromFiles, unusedSkills } from '../hooks/wartung.ts'
import type { Measure, Wartung } from '../hooks/wartung.ts'
import { T, dec, setLang, shortDate, spanText, tokensText, usdText } from '../hooks/i18n.ts'
import { CHECK, HANDOFF as HANDOFF_ROLE, genitiveDe, modelLabel, modelName } from '../hooks/models.ts'
import { savingsTree } from '../hooks/view.ts'

// Die bisherigen Tests prüfen die deutschen Texte (language: de, Fynns Einstellung); eigene Tests unten prüfen Englisch.
const DE = { options: { language: 'de' } }
function deTest(name: string, body: ($: Engine, on: On) => unknown) {
  test(name, DE, async ($, on) => {
    setLang('de')
    return body($, on)
  })
}

const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime()
const DAY = 24 * 60 * MIN
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
const MODEL_USAGE = { input_tokens: 3000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const verdict = (o: Record<string, string>) => '```json\n' + JSON.stringify({ urteil: 'durch', art: 'sonstiges', zeile: '', fassung: '', skill: '', kurzfassung: 'Kurz.', ...o }) + '\n```'
const HANDOFF = '# Übergabe: Test\n\n> **Stand:** fertig\n> **Weiter mit:** weiter\n\n## Auftrag\nTesten, ob die Übergabe ankommt und nichts verloren geht.'

// ---------- reine Logik ----------

deTest('Auslöser: (c) vor (a) vor (b), sonst keiner', async () => {
  const s = DEFAULT_SETTINGS
  expect(triggerOf({ first: true, ctx: 200000, cold: true, settings: s })).toBe('c')
  expect(triggerOf({ first: true, ctx: 1000, cold: false, settings: s })).toBe('a')
  expect(triggerOf({ first: false, ctx: 80000, cold: false, settings: s })).toBe('b')
  expect(triggerOf({ first: false, ctx: 100000, cold: true, settings: s })).toBe('b')
  expect(triggerOf({ first: false, ctx: 79999, cold: false, settings: s })).toBe(null)
  // Unbekannter Cache-Zustand bei großem Kontext mit Verlauf: vorsichtig wie kalt; nicht bei der ersten Nachricht
  expect(triggerOf({ first: false, ctx: 600000, cold: false, unknown: true, settings: s })).toBe('c')
  expect(triggerOf({ first: true, ctx: 600000, cold: false, unknown: true, settings: s })).toBe('a')
  expect(triggerOf({ first: false, ctx: 100000, cold: false, unknown: true, settings: s })).toBe('b')
})

deTest('Ignorierter Hinweis-Typ kommt erst nach +50k oder einem Commit wieder', async () => {
  const ign = { neuer_chat: { ctx: 100000, commits: 2 } }
  expect(isSuppressed(ign, 'neuer_chat', 120000, 2)).toBe(true)
  expect(isSuppressed(ign, 'neuer_chat', 150000, 2)).toBe(false)
  expect(isSuppressed(ign, 'neuer_chat', 110000, 3)).toBe(false)
  expect(isSuppressed(ign, 'skill', 110000, 2)).toBe(false)
})

deTest('Antwort der Prüfung: Zäune, ungültiges JSON, modell nur bei (a), Skill nur aus der Liste, anhalten ohne Aktion → hinweis', async () => {
  expect(parseVerdict(verdict({ urteil: 'hinweis', art: 'skill', skill: '/code-review', zeile: 'Diff prüfen?' }), 'b', ['code-review'])?.urteil).toBe('hinweis')
  expect(parseVerdict('kein json', 'b', [])).toBe(null)
  expect(parseVerdict('{"urteil": "vielleicht"}', 'b', [])).toBe(null)
  expect(parseVerdict('{kaputt', 'b', [])).toBe(null)
  expect(parseVerdict(verdict({ urteil: 'hinweis', art: 'modell', zeile: 'Sonnet reicht' }), 'b', [])?.urteil).toBe('durch')
  expect(parseVerdict(verdict({ urteil: 'hinweis', art: 'modell', zeile: 'Sonnet reicht' }), 'a', [])?.urteil).toBe('hinweis')
  // Erste Nachricht: nie „neuer Chat“
  expect(parseVerdict(verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), 'a', [])?.urteil).toBe('durch')
  expect(parseVerdict(verdict({ urteil: 'hinweis', art: 'skill', skill: 'erfunden', zeile: 'x' }), 'b', ['code-review'])?.urteil).toBe('durch')
  expect(parseVerdict(verdict({ urteil: 'anhalten', art: 'sonstiges', zeile: 'Hm' }), 'b', [])?.urteil).toBe('hinweis')
  expect(parseVerdict(verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'Unklar' }), 'b', [])?.urteil).toBe('hinweis')
  expect(parseVerdict(verdict({ urteil: 'hinweis', art: 'sonstiges', zeile: '' }), 'b', [])?.urteil).toBe('durch')
  const long = parseVerdict(verdict({ urteil: 'hinweis', zeile: 'x'.repeat(200), kurzfassung: 'k'.repeat(900) }), 'b', [])
  expect(long?.zeile.length).toBe(160)
  // Gekürzt wird an der Wortgrenze, nicht mitten im Wort (Fynn: „TE…“)
  const words = parseVerdict(verdict({ urteil: 'hinweis', zeile: 'Neues Thema Weiterentwicklung '.repeat(8) }), 'b', [])
  expect(words?.zeile.endsWith('Weiterentwicklung…') || words?.zeile.endsWith('Thema…') || words?.zeile.endsWith('Neues…')).toBe(true)
  expect((words?.zeile.length ?? 0) <= 160).toBe(true)
  expect(long?.kurzfassung.length).toBe(600)
})

deTest('Verlaufsende: etwa 100 000 Zeichen, ohne Tool-Ergebnisse, die neuesten bleiben', async () => {
  const msgs = [] as { role: string; text: string; toolResults?: unknown }[]
  for (let i = 0; i < 300; i++) msgs.push({ role: i % 2 ? 'assistant' : 'user', text: `N${i} ` + 'x'.repeat(995), toolResults: ['GEHEIMES-ERGEBNIS'] })
  msgs.push({ role: 'system', text: 'nicht dabei' })
  const h = historyTail(msgs)
  expect(h.length <= 100000).toBe(true)
  expect(h.length > 95000).toBe(true)
  expect(h).toContain('N299 ')
  expect(h).not.toContain('N0 ')
  expect(h).not.toContain('GEHEIMES-ERGEBNIS')
  expect(h).not.toContain('nicht dabei')
  expect(h.indexOf('N298 ') < h.indexOf('N299 ')).toBe(true)
})

deTest('Einstellungen: englische Befehle', async () => {
  const s = DEFAULT_SETTINGS
  expect(applySetting(s, 'off')?.on).toBe(false)
  expect(applySetting(s, 'threshold 5k')?.threshold).toBe(5000)
  expect(applySetting(s, 'big 1,5m')?.big).toBe(1500000)
  expect(applySetting(s, 'skills off')?.skills).toBe(false)
  expect(applySetting(s, 'ttl 5')?.ttl).toBe(5)
  expect(applySetting(s, 'schwelle 5k')).toBe(null)
})

deTest('Ersparnis kalt: 1. Anfrage alt × Schreibpreis − (gelesen × Lesepreis + geschrieben × Schreibpreis), danach (alt − 1. Anfrage) × Lesepreis', async () => {
  const b = { kind: 'kalt' as const, oldCtx: 300000, model: 'claude-opus-5-5', ttl: 60 as const, first: 0, steps: 0, at: NOW }
  const s = bookingStep(b, { total: 25000, read: 3000, written: 22000 })
  expect(near(s.usd, 2.4 - ((3000 * 0.2) / 1e6 + rewriteCost(22000, 'claude-opus-5-5', 60)))).toBe(true)
  expect(s.first).toBe(true)
  // Kalt läuft jetzt weiter wie warm: der neue Chat liest danach je Anfrage um (alt − 1. Anfrage) weniger
  expect(s.next).toMatchObject({ first: 25000, steps: 1 })
  const s2 = bookingStep(s.next!, { total: 40000, read: 39000, written: 1000 })
  expect(near(s2.usd, (275000 * 0.2) / 1e6)).toBe(true)
  expect(s2.first).toBe(false)
  expect(s2.next).toMatchObject({ first: 25000, steps: 2 })
})

deTest('Ersparnis warm: 1. Anfrage alt × Lesepreis − (gelesen + geschrieben), danach (alt − 1. Anfrage) × Lesepreis, bis alte Größe oder 50', async () => {
  const b = { kind: 'warm' as const, oldCtx: 300000, model: 'claude-opus-5-5', ttl: 60 as const, first: 0, steps: 0, at: NOW }
  const s1 = bookingStep(b, { total: 25000, read: 3000, written: 22000 })
  expect(near(s1.usd, (300000 * 0.2) / 1e6 - ((3000 * 0.2) / 1e6 + rewriteCost(22000, 'claude-opus-5-5', 60)))).toBe(true)
  expect(s1.next?.first).toBe(25000)
  // Ab der 2. Anfrage unabhängig vom Wachstum des neuen Chats und ohne Schreibkosten
  const s2 = bookingStep(s1.next!, { total: 60000, read: 30000, written: 30000 })
  expect(near(s2.usd, (275000 * 0.2) / 1e6)).toBe(true)
  // Nie negativ
  expect(bookingStep({ ...b, first: 320000, steps: 1 }, { total: 100000, read: 100000, written: 0 }).usd).toBe(0)
  expect(bookingStep({ ...b, first: 25000, steps: 3 }, { total: 300000, read: 300000, written: 0 }).next).toBe(null)
  expect(bookingStep({ ...b, first: 25000, steps: 49 }, { total: 30000, read: 30000, written: 0 }).next).toBe(null)
})

deTest('Ersparnis: offene Buchung aus 0.3 ohne first nimmt den Kontext der laufenden Anfrage; handoffUsd fällt weg', async () => {
  const old = cleanLedger({ tage: {}, upd: NOW, offen: { kind: 'warm', oldCtx: 300000, model: 'claude-opus-5-5', ttl: 60, handoffUsd: 0.04, steps: 12, at: NOW } })
  expect(old.offen).toMatchObject({ first: 0, steps: 12 })
  expect('handoffUsd' in (old.offen ?? {})).toBe(false)
  const s = bookingStep(old.offen!, { total: 100000, read: 99000, written: 1000 })
  expect(near(s.usd, (200000 * 0.2) / 1e6)).toBe(true)
  expect(s.next).toMatchObject({ first: 100000, steps: 13 })
})

deTest('Modelle: eine Konstante je Rolle, Name für Texte daraus', async () => {
  expect(CHECK).toEqual({ model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 400, timeoutMs: 6000 })
  expect(HANDOFF_ROLE).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 3000, timeoutMs: 45000 })
  expect(modelName('claude-sonnet-5-5')).toBe('Sonnet')
  expect(modelName('haiku')).toBe('Haiku')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus')
  expect(T.de.fassung).toBe('Sonnets Fassung senden')
  expect(T.en.fassung).toBe("Send Sonnet's version")
  expect(genitiveDe('Opus')).toBe('Opus’')
  expect(genitiveDe('Haiku')).toBe('Haikus')
})

deTest('handoffEstimate: Übergabe zu HANDOFF-Preisen (≤ 100 000 Zeichen, 3 Zeichen je Token, maxTokens) + Grundlast neu', async () => {
  // Sonnet 5.5: 2 $ Eingabe, 10 $ Ausgabe je Million; Grundlast 20k auf Opus 5.5 mit 1-h-TTL = 0,16 $
  const expected = (100000 / 3) * (2 / 1e6) + 3000 * (10 / 1e6) + rewriteCost(20000, 'claude-opus-5-5', 60)
  expect(near(handoffEstimate(400000, 20000, 'claude-opus-5-5', 60), expected)).toBe(true)
  expect(near(handoffEstimate(30000, 0, 'claude-opus-5-5', 60), (30000 / 3) * (2 / 1e6) + 3000 * (10 / 1e6))).toBe(true)
})

deTest('Zeiträume heute, Woche, gesamt', async () => {
  const day = (usd: number) => ({ ...emptyDay(), kosten: usd })
  const l: Ledger = { tage: { [dayKey(NOW)]: day(1), [dayKey(NOW - 3 * DAY)]: day(2), [dayKey(NOW - 20 * DAY)]: day(4) }, upd: NOW }
  expect(sumPeriod([l], 'today', NOW).kosten).toBe(1)
  expect(sumPeriod([l], 'week', NOW).kosten).toBe(3)
  expect(sumPeriod([l], 'all', NOW).kosten).toBe(7)
})

deTest('Verdichtung: alte Sessions einmal, aktuelle und schon verdichtete nicht', async () => {
  const d = { ...emptyDay(), kosten: 1, pruefungen: 2 }
  const old = { sid: 'alt', ledger: { tage: { '2026-09-01': d }, upd: NOW - 8 * DAY } }
  const fresh = { sid: 'neu', ledger: { tage: { '2026-10-04': d }, upd: NOW - DAY } }
  const self = { sid: 'ich', ledger: { tage: { '2026-09-02': d }, upd: NOW - 9 * DAY } }
  const p1 = planCompaction({ tage: {}, upd: 0 }, [old, fresh, self], NOW, 'ich')
  expect(p1.merged).toEqual(['alt'])
  expect(p1.next.tage['2026-09-01']?.kosten).toBe(1)
  // Zweite Session startet gleichzeitig und liest den Stand nach der ersten: keine Doppelzählung
  const p2 = planCompaction(p1.next, [old, fresh], NOW, 'andere')
  expect(p2.merged).toEqual([])
  expect(p2.next.tage['2026-09-01']?.kosten).toBe(1)
  expect(addDay(d, d).pruefungen).toBe(4)
})

deTest('/savings: Kosten, Schätzung mit Rechenweise, Zählungen', async () => {
  const d = { ...emptyDay(), kosten: 0.5, pruefungen: 4, warteMs: 6000, kaltVermieden: { n: 2, usd: 4.6 } }
  d.hinweise.skill = { gezeigt: 3, angenommen: 1, ignoriert: 2, abgebrochen: 0 }
  const t = savingsReport(d, 'week', NOW)
  expect(t.split('\n')[0]).toBe('**Woche (29.09.–05.10.)**')
  expect(t).toContain('**Ersparnis (Schätzung)** ≈ 4,60 $')
  expect(t).toContain('**Verhältnis** 1 : 9,2')
  expect(t).toContain('| Kaltstart vermieden | 2 | ≈ 4,60 $ | 1. Anfrage: Kontext alt × Schreibpreis − (gelesen × Lesepreis')
  expect(t).toContain('mittlere Wartezeit **1,5 s**')
  expect(t).toContain('| Skill | 3 | 1 | 2 | 0 |')
  expect(t).toContain('/skill-doctor')
})

// ---------- Hooks mit Stubs ----------

type StepU = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string }
const stepUsage = (read: number, written: number): StepU => ({ input_tokens: 2, output_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: written, model: 'claude-opus-5-5' })

type W = {
  saved?: Map<string, unknown>
  surfaces?: string[]
  completeFails?: boolean
  clearFails?: boolean
  submitFails?: boolean
  handoffDelayMs?: number
  // Wartungs-Hinweise (SPEC Nachtrag 0.2.0)
  root?: string | null // null: $.session.root() wirft
  memory?: { path: string; type: string; tokens: number }[]
  model?: string
  skills?: { totalSkills: number; includedSkills: number; tokens: number; skillFrontmatter: { name: string; source: string; tokens: number }[] }
  cmds?: { name: string; description: string; source: string }[]
  usageFails?: boolean
  noBreakdown?: boolean // breakdown fehlt in der Antwort
}

function world(on: On, o: W = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const toasts: string[] = []
  const asks: { question: string; options: string[] }[] = []
  const sent: string[] = []
  const commands: string[] = []
  const checks: { system: string; prompt: string; req: unknown }[] = []
  const handoffs: string[] = []
  const handoffReqs: unknown[] = []
  const handoffSystems: string[] = []
  let answer: string | null = 'Trotzdem senden'
  let reply: unknown = { isAnswered: true, text: verdict({}), usage: MODEL_USAGE }
  let handoffReply: unknown = { isAnswered: true, text: HANDOFF, usage: MODEL_USAGE }
  let id = 'sess-1'
  let ctx: number | undefined = 1000
  let messages: unknown[] = [{ role: 'assistant', text: 'vorher', toolUses: [] }]
  on('session.id', () => ({ value: id }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  const skills = o.skills ?? { totalSkills: 1, includedSkills: 1, tokens: 10, skillFrontmatter: [{ name: 'mod-review', source: 'projectSettings', tokens: 10 }] }
  on('session.usage', ($, e) => {
    if (o.usageFails && e.breakdown) throw new Error('kein breakdown')
    return {
      value: {
        startedAt: NOW,
        context: { tokens: ctx, window: 1000000, ...(e.breakdown && !o.noBreakdown ? { breakdown: { skills, memoryFiles: o.memory ?? [], model: o.model ?? 'claude-opus-5-5[1m]' } } : {}) },
        rateLimits: [],
      } as never,
    }
  })
  on('session.root', () => {
    if (o.root === null) throw new Error('kein root')
    return { value: o.root ?? 'C:\\Proj\\App' }
  })
  on('session.messages', () => ({ value: messages as never }))
  on('command.list', () => ({
    value: [
      { name: 'mod-review', description: 'Prüft einen Mod\nzweite Zeile', source: 'user' },
      { name: 'code-review', description: 'Review the diff', source: 'builtin' },
      { name: 'clear', description: 'Clear', source: 'builtin' },
      ...(o.cmds ?? []),
    ],
  }))
  on('model.complete', async ($, e) => {
    if (o.completeFails) return { deny: 'kein Modell' }
    if (e.system?.includes('Schreibe eine Übergabe')) {
      handoffs.push(e.prompt)
      handoffReqs.push({ model: e.model, effort: e.effort, maxTokens: e.maxTokens, timeoutMs: e.timeoutMs })
      handoffSystems.push(e.system)
      if (o.handoffDelayMs) await clock.sleep(o.handoffDelayMs)
      return { value: handoffReply as never }
    }
    checks.push({ system: e.system ?? '', prompt: e.prompt, req: { model: e.model, effort: e.effort, maxTokens: e.maxTokens, timeoutMs: e.timeoutMs } })
    return { value: reply as never }
  })
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
  on('command.register', () => ({ value: undefined }))
  on('command.run', ($, e) => {
    commands.push(e.command)
    // Ein werfender Stub wird übersprungen (docs/raw/en/test.md:182); ohne weitere Antwort scheitert der Aufruf
    if (o.clearFails && e.command === 'clear') throw new Error('nicht jetzt')
    if (e.command === 'clear') id = 'sess-2'
    return { text: '' }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'PowerShell') return { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'ps99999', kind: 'committed' } } } }
    if (e.tool === 'Bash') return { result: { stdout: '[main abc1234] x', stderr: '', interrupted: false, isImage: false, gitOperation: { commit: { sha: 'abc1234', kind: 'committed', branch: 'main' } } } }
    if (e.tool !== 'AskUserQuestion') return { result: '' }
    const q = (e as unknown as { questions: { question: string; options: { label: string }[] }[] }).questions[0]!
    asks.push({ question: q.question, options: q.options.map((x) => x.label) })
    if (answer === null) return { deny: 'Dialog geschlossen' }
    return { result: { answers: { [q.question]: answer } } }
  })
  on('prompt.submit', ($, e) => {
    // Ein werfender Stub wird übersprungen; ohne weitere Antwort scheitert der Aufruf
    if (o.submitFails && e.origin.kind === 'plugin') throw new Error('nicht jetzt')
    sent.push(e.text)
    return { text: e.text }
  })
  on('skill.prompt', ($, e) => ({ text: e.text }))
  let bandTree: unknown = null
  on('ui.render', ($, e) => (e.component === 'AbovePrompt' && bandTree ? (bandTree as never) : { type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
  let next: StepU = stepUsage(0, 0)
  let turn = 0
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: next }
  })
  async function step($: Engine, u: StepU, agentId?: string) {
    next = u
    turn += 1
    const s = $.turn.step({ turnId: `t${turn}`, index: 0, model: u.model, messageCount: 3, ...(agentId ? { agentId } : {}) })
    let r = await s.next()
    while (r.done !== true) r = await s.next()
    await flush()
  }
  return {
    clock,
    saved,
    toasts,
    asks,
    sent,
    commands,
    checks,
    handoffs,
    handoffReqs,
    handoffSystems,
    step,
    setAnswer: (a: string | null) => (answer = a),
    setReply: (r: unknown) => (reply = r),
    setHandoff: (r: unknown) => (handoffReply = r),
    setCtx: (n: number | undefined) => (ctx = n),
    setMessages: (m: unknown[]) => (messages = m),
    setBand: (t: unknown) => (bandTree = t),
    ledger: (sid = 'sess-1') => cleanLedger(saved.get(`bilanz:${sid}`)),
  }
}

/** Buchungen laufen im Hintergrund (Promise-Kette): ein paar Runden warten. */
async function flush(rounds = 40) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

const userPrompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const today = (l: Ledger) => l.tage[dayKey(NOW)] ?? emptyDay()

deTest('Filter: Befehl, fremde Herkunft, laufender Turn, kleiner Kontext ohne Auslöser → keine Prüfung, unverändert', async ($, on) => {
  const w = world(on)
  expect(await $.prompt.submit(userPrompt('/savings'))).toMatchObject({ text: '/savings' })
  expect(await $.prompt.submit({ text: 'vom Plugin', wait: false, origin: { kind: 'plugin', name: 'x' } } as never)).toMatchObject({ text: 'vom Plugin' })
  expect(await $.prompt.submit({ ...userPrompt('mitten im Turn'), turnId: 't9' })).toMatchObject({ text: 'mitten im Turn' })
  expect(await $.prompt.submit(userPrompt('klein'))).toMatchObject({ text: 'klein' })
  expect(w.checks.length).toBe(0)
  expect(w.asks.length).toBe(0)
})

deTest('Desktop: origin sdk wird nur mit Desktop in surfaces() geprüft, in -p (leer) nie', async ($, on) => {
  const w = world(on, { surfaces: [] })
  w.setCtx(90000)
  await $.prompt.submit({ text: 'aus -p', wait: false, origin: { kind: 'sdk' } } as never)
  expect(w.checks.length).toBe(0)
})

deTest('Desktop: origin sdk mit surfaces ["desktop"] wird geprüft', async ($, on) => {
  const w = world(on, { surfaces: ['desktop'] })
  w.setCtx(90000)
  await $.prompt.submit({ text: 'im Desktop', wait: false, origin: { kind: 'sdk' } } as never)
  expect(w.checks.length).toBe(1)
})

deTest('Auslöser (a) erste Nachricht ruft die Prüfung genau einmal, mit Skill-Liste und Fakten', async ($, on) => {
  const w = world(on)
  w.setMessages([])
  await $.prompt.submit(userPrompt('Hallo, lass uns X bauen'))
  expect(w.checks.length).toBe(1)
  expect(w.checks[0]!.prompt).toContain('Auslöser: erste Nachricht des Chats')
  expect(w.checks[0]!.system).toContain('- mod-review: Prüft einen Mod')
  expect(w.checks[0]!.system).toContain('- code-review: Review the diff')
  expect(w.checks[0]!.system).not.toContain('- clear:')
})

deTest('Auslöser (b) ab Schwelle ruft die Prüfung genau einmal; durch → unverändert, Kosten und Wartezeit gebucht', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  expect(await $.prompt.submit(userPrompt('weiter'))).toMatchObject({ text: 'weiter' })
  await flush()
  expect(w.checks.length).toBe(1)
  expect(w.checks[0]!.prompt).toContain('Kontext über der Schwelle')
  const d = today(w.ledger())
  expect(d.pruefungen).toBe(1)
  expect(near(d.kosten, completeCost(MODEL_USAGE, CHECK.model))).toBe(true)
  // Modell, effort, Grenze und Zeitlimit kommen aus der Konstante der Rolle
  expect(w.checks[0]!.req).toEqual({ model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 400, timeoutMs: 6000 })
  // Die Kurzfassung wird gespeichert und bei der nächsten Prüfung mitgegeben
  await $.prompt.submit(userPrompt('und noch was'))
  expect(w.checks[1]!.prompt).toContain('Kurzfassung bisher: Kurz.')
  expect(w.checks[1]!.prompt).toContain('1. weiter')
})

deTest('Auslöser (c) kalt und groß: Dialog mit Kosten, auch wenn die Prüfung nichts liefert', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  w.setReply({ isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  const r = await $.prompt.submit(userPrompt('weiter mit Ports'))
  expect(w.checks.length).toBe(1)
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain('Cache seit 10 min kalt, 300k Kontext. Senden schreibt alles neu (≈ 2,40 $).')
  expect(w.asks[0]!.question).toContain('Neuer Chat mit Übergabe: ≈')
  expect(w.asks[0]!.options).toEqual(['Neuer Chat mit Übergabe (empfohlen)', 'Neuer Chat ohne Übergabe', 'Trotzdem senden', 'Abbrechen'])
  // „Trotzdem senden“: unverändert
  expect(r).toMatchObject({ text: 'weiter mit Ports' })
  // Der folgende Kaltstart war gefragt: zählt nicht als „ohne Rückfrage“
  await w.step($, stepUsage(0, 300000))
  expect(today(w.ledger()).kaltOhne.n).toBe(0)
  await w.clock.advance(70 * MIN)
  await w.step($, stepUsage(0, 300000))
  expect(today(w.ledger()).kaltOhne.n).toBe(1)
})

deTest('hinweis → durch, Zeile unter genau dieser Nachricht, auf Terminal und Desktop', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'hinweis', art: 'skill', skill: 'mod-review', zeile: 'Vor dem Ship prüfen' }), usage: MODEL_USAGE })
  expect(await $.prompt.submit(userPrompt('ship it'))).toMatchObject({ text: 'ship it' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'm1', surface, props: { text: 'ship it', origin: { kind: 'composer' }, isExpanded: true } } as never)
    // Die Nachricht der Engine bleibt, darunter die farbige sidekick-Zeile
    expect(await ui.find({ type: 'Text', text: 'ship it' })).toBeDefined()
    const line = JSON.stringify(await ui.find({ key: 'sidekick-line' }))
    expect(line).toContain('· sidekick: Vor dem Ship prüfen (/mod-review)')
    expect(line).toContain('#6CB6FF')
    expect(await ui.find({ key: 'sidekick-sent' })).toBeUndefined()
    await ui.unmount()
  }
  // Andere Oberflächen (z. B. VS Code): nur Text
  const plain = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'm1', surface: 'vscode', props: { text: 'ship it', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(String((await plain.find({ type: 'Text' }))?.children)).toContain('ship it\n\n· sidekick: Vor dem Ship prüfen (/mod-review)')
  await plain.unmount()
  // Eine andere Nachricht bleibt unverändert
  const other = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'm2', surface: 'desktop', props: { text: 'anders', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(String((await other.find({ type: 'Text' }))?.children)).toBe('anders')
  await other.unmount()
  await flush()
  expect(today(w.ledger()).hinweise.skill?.gezeigt).toBe(1)
})

deTest('Ignorierter Hinweis kommt nicht sofort wieder, nach einem Commit schon; Skill-Nutzung nimmt an', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'hinweis', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  await $.prompt.submit(userPrompt('eins'))
  await $.prompt.submit(userPrompt('zwei')) // „eins“ ignoriert → neuer_chat gesperrt
  await flush()
  expect(today(w.ledger()).hinweise.neuer_chat).toEqual({ gezeigt: 1, angenommen: 0, ignoriert: 1, abgebrochen: 0 })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
  await $.prompt.submit(userPrompt('drei'))
  await flush()
  expect(today(w.ledger()).hinweise.neuer_chat?.gezeigt).toBe(2)
  expect(w.checks[2]!.prompt).toContain('letzter Commit: abc1234')
  // Skill-Hinweis, dann wird der Skill genutzt
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'hinweis', art: 'skill', skill: 'mod-review', zeile: 'Review' }), usage: MODEL_USAGE })
  await $.prompt.submit(userPrompt('vier'))
  await $.skill.prompt({ skill: 'mod-review', text: '...' })
  await flush()
  const d = today(w.ledger())
  expect(d.hinweise.skill?.angenommen).toBe(1)
  expect(d.skills['mod-review']).toBe(1)
})

deTest('anhalten fassung: richtige Antworten, „Fassung senden“ sendet den neuen Text', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'Unklar, welche Datei', fassung: 'Bitte ändere hooks/register.ts: X' }), usage: MODEL_USAGE })
  w.setAnswer('Sonnets Fassung senden')
  const r = await $.prompt.submit(userPrompt('mach das bitte mal schnell'))
  expect(w.asks[0]!.options).toEqual(['Sonnets Fassung senden (empfohlen)', 'Trotzdem senden', 'Abbrechen'])
  expect(w.asks[0]!.question).toBe('Unklar, welche Datei\n\nFassung:\n„Bitte ändere hooks/register.ts: X“\n\nWie weiter?')
  expect(r).toMatchObject({ text: 'Bitte ändere hooks/register.ts: X' })
  // Der Desktop zeigt das Original in der Sprechblase: darunter steht, dass die Fassung gesendet wurde
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'mf', surface: 'desktop', props: { text: 'mach das bitte mal schnell', origin: { kind: 'sdk' }, isExpanded: true } } as never)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain('· sidekick: gesendet wurde Sonnets Fassung')
  // Darunter im Rahmen, was wirklich gesendet wurde
  const box = await ui.find({ key: 'sidekick-sent' })
  expect(JSON.stringify(box)).toContain('Bitte ändere hooks/register.ts: X')
  await ui.unmount()
  await flush()
  expect(today(w.ledger()).hinweise.fassung?.angenommen).toBe(1)
})

deTest('Abbrechen gibt {drop} mit dem eigenen Text zurück', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Abbrechen')
  const r = await $.prompt.submit(userPrompt('ganz was anderes'))
  expect(w.asks[0]!.options).toEqual(['Neuer Chat mit Übergabe (empfohlen)', 'Neuer Chat ohne Übergabe', 'Trotzdem senden', 'Abbrechen'])
  expect(r.drop).toContain('ganz was anderes')
})

deTest('Fehlerpfade: Timeout, ungültiges JSON, abgelehntes ask → durch; Timeout-usage wird gebucht', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: false, reason: 'aborted', usage: { input_tokens: 500, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  expect(await $.prompt.submit(userPrompt('a'))).toMatchObject({ text: 'a' })
  await flush()
  expect(near(today(w.ledger()).kosten, (500 * 2) / 1e6)).toBe(true) // Sonnet 5.5: 2 $ je Million Eingabe
  w.setReply({ isAnswered: true, text: 'Das ist kein JSON', usage: MODEL_USAGE })
  expect(await $.prompt.submit(userPrompt('b'))).toMatchObject({ text: 'b' })
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neu' }), usage: MODEL_USAGE })
  w.setAnswer(null)
  expect(await $.prompt.submit(userPrompt('c'))).toMatchObject({ text: 'c' })
  expect(w.asks.length).toBe(1)
})

deTest('Fehlerpfad: $.model.complete wird abgelehnt → durch', async ($, on) => {
  const w = world(on, { completeFails: true })
  w.setCtx(90000)
  expect(await $.prompt.submit(userPrompt('trotzdem'))).toMatchObject({ text: 'trotzdem' })
})

deTest('Neuer Chat: Übergabe → clear → submit mit ursprünglicher Nachricht; Ersparnis nach der ersten Anfrage', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  w.setMessages([
    { role: 'user', text: 'Baue den Sidekick', toolUses: [] },
    { role: 'assistant', text: 'Mache ich', toolUses: [{ name: 'Bash', result: 'TOOL-OUTPUT' }] },
  ])
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  w.setAnswer('Neuer Chat mit Übergabe')
  const r = await $.prompt.submit(userPrompt('jetzt die Tests'))
  expect(r.drop).toContain('neuer Chat')
  expect(w.commands).not.toContain('clear')
  await w.clock.advance(400)
  await flush()
  expect(w.handoffs.length).toBe(1)
  expect(w.handoffs[0]).toContain('[Nutzer] Baue den Sidekick')
  expect(w.handoffs[0]).not.toContain('TOOL-OUTPUT')
  expect(w.commands).toEqual(['clear'])
  expect(w.sent.at(-1)).toContain('# Übergabe: Test')
  expect(w.sent.at(-1)).toContain('jetzt die Tests')
  expect(w.saved.get('handoff:last')).toMatchObject({ msg: 'jetzt die Tests' })
  // Neue Session: Buchung offen, erste Anfrage misst und bucht
  expect(w.ledger('sess-2').offen?.kind).toBe('kalt')
  await w.step($, stepUsage(0, 20000))
  const d = today(w.ledger('sess-2'))
  // Die Übergabe steht in den Kosten der alten Session, nicht in der Ersparnis
  const expected = rewriteCost(300002, 'claude-opus-5-5', 60) - rewriteCost(20000, 'claude-opus-5-5', 60)
  expect(d.kaltVermieden.n).toBe(1)
  expect(near(d.kaltVermieden.usd, expected)).toBe(true)
  expect(w.ledger('sess-2').offen).toMatchObject({ first: 20002, steps: 1 })
  expect(w.handoffReqs[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 3000, timeoutMs: 45000 })
  // 2. Anfrage: (alt − 1. Anfrage) × Lesepreis, die Zahl der Buchungen bleibt 1
  await w.step($, stepUsage(20000, 3000))
  const d2 = today(w.ledger('sess-2'))
  expect(d2.kaltVermieden.n).toBe(1)
  expect(near(d2.kaltVermieden.usd, expected + ((300002 - 20002) * 0.2) / 1e6)).toBe(true)
  // Die alte Session hat Prüfung und Übergabe gebucht
  expect(today(w.ledger('sess-1')).uebergaben).toBe(1)
  // Kosten je Rolle mit deren Modell: Prüfung (CHECK) und Übergabe (HANDOFF)
  expect(near(today(w.ledger('sess-1')).kosten, completeCost(MODEL_USAGE, CHECK.model) + completeCost(MODEL_USAGE, HANDOFF_ROLE.model))).toBe(true)
  // /savings sieht beide Sessions (getrennte Schlüssel)
  const s = await $.command.run({ command: 'savings', args: 'today' } as never)
  expect(s.text).toContain('| Kaltstart vermieden | 1 |')
  expect(s.text).toContain('Übergaben: **1**')
})

deTest('Neuer Chat: Übergabe scheitert → zweite Frage, ohne Zustimmung nichts gesendet', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setHandoff({ isAnswered: false, reason: 'aborted', usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.prompt.submit(userPrompt('andere Sache'))
  w.setAnswer('Abbrechen')
  await w.clock.advance(400)
  await flush()
  expect(w.asks.length).toBe(2)
  expect(w.asks[1]!.question).toContain('Die Übergabe ließ sich nicht schreiben (aborted)')
  expect(w.asks[1]!.options).toEqual(['Trotzdem senden', 'Abbrechen'])
  expect(w.commands).not.toContain('clear')
  expect(w.sent).toEqual([])
  expect(w.toasts.at(-1)).toContain('andere Sache')
})

deTest('Neuer Chat: /clear scheitert → Toast, Übergabe gespeichert', async ($, on) => {
  const w = world(on, { clearFails: true })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.prompt.submit(userPrompt('neu'))
  await w.clock.advance(400)
  await flush()
  expect(w.toasts.at(-1)).toContain('/clear ging nicht')
  expect(w.saved.get('handoff:last')).toMatchObject({ msg: 'neu' })
  expect(w.sent).toEqual([])
  const st = await $.command.run({ command: 'sidekick', args: 'status' } as never)
  expect(st.text).toContain('# Übergabe: Test')
})

deTest('Mit Anhang oder @datei keine Antwort „Neuer Chat“', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  await $.prompt.submit(userPrompt('schau in @src/app.ts'))
  expect(w.asks[0]!.options).toEqual(['Trotzdem senden (empfohlen)', 'Abbrechen'])
  // Die Prüfung will neuer_chat bei Anhang: wird zur Zeile
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  const r = await $.prompt.submit({ ...userPrompt('Bild'), attachments: [{ kind: 'image' }] } as never)
  expect(r).toMatchObject({ text: 'Bild' })
  expect(w.asks.length).toBe(1)
})

deTest('turn.step mit agentId wird ignoriert; ohne offene Buchung kein Bilanz-Eintrag', async ($, on) => {
  const w = world(on)
  await w.step($, stepUsage(0, 300000), 'agent-1')
  expect(w.saved.get('cache:sess-1')).toBeUndefined()
  await w.step($, stepUsage(0, 300000))
  expect(w.saved.get('cache:sess-1')).toBeDefined()
  expect(w.saved.has('bilanz:sess-1')).toBe(false)
})

deTest('/sidekick: Einstellungen persistent, Status zeigt Schwelle, Unbekanntes wird erklärt', async ($, on) => {
  const w = world(on)
  const r1 = await $.command.run({ command: 'sidekick', args: 'threshold 5k' } as never)
  expect(r1.text).toContain('| **Schwelle** | 5,0k')
  expect(w.saved.get('settings')).toMatchObject({ threshold: 5000 })
  const r2 = await $.command.run({ command: 'sidekick', args: 'quatsch' } as never)
  expect(r2.text).toContain('Unbekannt')
  await $.command.run({ command: 'sidekick', args: 'off' } as never)
  w.setCtx(500000)
  await $.prompt.submit(userPrompt('aus'))
  expect(w.checks.length).toBe(0)
})

deTest('Persistenz: Bilanz und Einstellungen überleben einen Neustart (Store-Stub), Verdichtung beim Start', async ($, on) => {
  const old: Ledger = { tage: { '2026-09-20': { ...emptyDay(), kosten: 0.3, pruefungen: 3 } }, upd: NOW - 10 * DAY }
  const saved = new Map<string, unknown>([
    ['settings', { ...DEFAULT_SETTINGS, threshold: 5000 }],
    ['bilanz:alte-session', old],
    ['bilanz:sess-9', { tage: { [dayKey(NOW)]: { ...emptyDay(), kosten: 0.2, pruefungen: 2 } }, upd: NOW }],
  ])
  const w = world(on, { saved })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await flush(400)
  expect(saved.has('bilanz:alte-session')).toBe(false)
  expect(cleanLedger(saved.get('bilanz:tage')).aus).toEqual(['alte-session'])
  const all = await $.command.run({ command: 'savings', args: 'all' } as never)
  expect(all.text).toContain('Prüfungen: **5**')
  const tdy = await $.command.run({ command: 'savings', args: 'today' } as never)
  expect(tdy.text).toContain('Prüfungen: **2**')
  // Einstellung aus dem Store gilt: 6k Kontext löst (b) aus
  w.setCtx(6000)
  await $.prompt.submit(userPrompt('x'))
  expect(w.checks.length).toBe(1)
})

deTest('Review S1: eine Fassung über 600 Zeichen wird nicht angeboten, sondern zur Zeile', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'Unklar', fassung: 'y'.repeat(601) }), usage: MODEL_USAGE })
  expect(await $.prompt.submit(userPrompt('mach mal'))).toMatchObject({ text: 'mach mal' })
  expect(w.asks.length).toBe(0)
})

deTest('Review S2: der drop-Grund bei „Neuer Chat“ enthält den eigenen Text', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  const r = await $.prompt.submit(userPrompt('mein wichtiger Text'))
  expect(r.drop).toContain('mein wichtiger Text')
})

deTest('Review K8: Commit über PowerShell wird erkannt', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  await $.tool.call({ tool: 'PowerShell', command: 'git commit -m x' } as never)
  await $.prompt.submit(userPrompt('weiter'))
  expect(w.checks[0]!.prompt).toContain('letzter Commit: ps99999')
})

deTest('Review K8: Senden nach /clear scheitert → Toast, Übergabe in /sidekick status', async ($, on) => {
  const w = world(on, { submitFails: true })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.prompt.submit(userPrompt('neu und wichtig'))
  await w.clock.advance(400)
  await flush()
  expect(w.commands).toEqual(['clear'])
  expect(w.toasts.at(-1)).toContain('Chat geleert, aber die Nachricht ließ sich nicht senden')
  const st = await $.command.run({ command: 'sidekick', args: '' } as never)
  expect(st.text).toContain('neu und wichtig')
})

deTest('Review K8: housekeeping löscht Cache- und Sitzungs-Einträge älter als 7 Tage', async ($, on) => {
  const saved = new Map<string, unknown>([
    ['cache:alt', { lastActivity: NOW - 9 * DAY, savedAt: NOW - 9 * DAY }],
    ['sitzung:alt', { summary: 'x', savedAt: NOW - 8 * DAY }],
    ['cache:neu', { lastActivity: NOW - DAY, savedAt: NOW - DAY }],
  ])
  world(on, { saved })
  on('session.start', () => ({ cwd: '/work' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await flush(400)
  expect(saved.has('cache:alt')).toBe(false)
  expect(saved.has('sitzung:alt')).toBe(false)
  expect(saved.has('cache:neu')).toBe(true)
})

deTest('Fortgesetzter Chat, den sidekick nicht kennt: die letzten eigenen Nachrichten kommen aus dem Verlauf', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setMessages([
    { role: 'user', text: 'Baue die Ports-Übersicht', toolUses: [] },
    { role: 'assistant', text: 'Erledigt', toolUses: [] },
    { role: 'user', text: '<command-name>/clear</command-name>', toolUses: [] },
    { role: 'user', text: 'Jetzt die Farben', toolUses: [] },
    { role: 'assistant', text: 'Ok', toolUses: [] },
  ])
  await $.prompt.submit(userPrompt('ganz neues Thema'))
  expect(w.checks[0]!.prompt).toContain('1. Baue die Ports-Übersicht')
  expect(w.checks[0]!.prompt).toContain('2. Jetzt die Farben')
  expect(w.checks[0]!.prompt).not.toContain('/clear')
  expect(w.checks[0]!.prompt).toContain('Kontext über der Schwelle')
})

deTest('Neuer Chat ohne Übergabe: kein Modellaufruf, /clear, nur die Nachricht; Ersparnis ohne Übergabekosten', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  w.setAnswer('Neuer Chat ohne Übergabe')
  const r = await $.prompt.submit(userPrompt('eigenständige Aufgabe'))
  expect(w.asks[0]!.question).toContain('Neuer Chat ohne Übergabe: ≈')
  expect(r.drop).toContain('Ein neuer Chat startet')
  await w.clock.advance(400)
  await flush()
  expect(w.handoffs.length).toBe(0)
  expect(w.commands).toEqual(['clear'])
  expect(w.sent.at(-1)).toBe('eigenständige Aufgabe')
  expect(w.ledger('sess-2').offen).toMatchObject({ first: 0, steps: 0 })
  await w.step($, stepUsage(0, 20000))
  const d = today(w.ledger('sess-2'))
  expect(near(d.kaltVermieden.usd, rewriteCost(300002, 'claude-opus-5-5', 60) - rewriteCost(20000, 'claude-opus-5-5', 60))).toBe(true)
  expect(today(w.ledger('sess-1')).uebergaben).toBe(0)
})

deTest('Empfehlung auf Platz 1: Verlauf nicht nötig → ohne Übergabe; billig → senden; sonst mit Übergabe', async () => {
  const base = { resendable: true, fassung: false }
  expect(rankChoices({ ...base, cold: true, sendUsd: 4.7, verlauf: 'nicht' })).toEqual(['plain', 'new', 'send', 'abort'])
  expect(rankChoices({ ...base, cold: true, sendUsd: 4.7, verlauf: 'braucht' })).toEqual(['new', 'plain', 'send', 'abort'])
  expect(rankChoices({ ...base, cold: true, sendUsd: 0.12, verlauf: 'kaum' })).toEqual(['send', 'new', 'plain', 'abort'])
  expect(rankChoices({ ...base, cold: true, sendUsd: 4.7 })).toEqual(['new', 'plain', 'send', 'abort'])
  expect(rankChoices({ ...base, cold: false, sendUsd: Infinity, verlauf: 'nicht' })).toEqual(['plain', 'new', 'send', 'abort'])
  expect(rankChoices({ resendable: false, fassung: false, cold: true, sendUsd: 4.7, verlauf: 'nicht' })).toEqual(['send', 'abort'])
  // Mit Fassung höchstens 4: die nicht empfohlene Variante des neuen Chats fällt weg
  expect(rankChoices({ resendable: true, fassung: true, cold: true, sendUsd: 4.7, verlauf: 'nicht' })).toEqual(['plain', 'fassung', 'send', 'abort'])
  expect(rankChoices({ resendable: true, fassung: true, cold: true, sendUsd: 4.7 })).toEqual(['new', 'fassung', 'send', 'abort'])
  expect(parseVerdict(verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'x', verlauf: 'nicht' }), 'b', [])?.verlauf).toBe('nicht')
  expect(parseVerdict(verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'x', verlauf: 'quatsch' }), 'b', [])?.verlauf).toBeUndefined()
})

deTest('Kalt, Nachricht braucht den Verlauf nicht: „ohne Übergabe“ steht auf 1 und funktioniert mit „(empfohlen)“', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'hinweis', art: 'neuer_chat', zeile: 'Eigenständige Aufgabe', verlauf: 'nicht' }), usage: MODEL_USAGE })
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  w.setAnswer('Neuer Chat ohne Übergabe (empfohlen)')
  const r = await $.prompt.submit(userPrompt('Ändere die Farbe in limit-bars'))
  expect(w.asks[0]!.options[0]).toBe('Neuer Chat ohne Übergabe (empfohlen)')
  expect(r.drop).toContain('Ein neuer Chat startet')
  await w.clock.advance(400)
  await flush()
  expect(w.handoffs.length).toBe(0)
  expect(w.sent.at(-1)).toBe('Ändere die Farbe in limit-bars')
})

deTest('Chat, den sidekick zum ersten Mal sieht (Cache unbekannt), großer Kontext: Rückfrage mit „unbekannt“', async ($, on) => {
  const w = world(on)
  w.setCtx(597000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'durch', verlauf: 'nicht' }), usage: MODEL_USAGE })
  w.setAnswer('Abbrechen')
  const r = await $.prompt.submit(userPrompt('Zwei kleine Änderungen an limit-bars'))
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain('Cache-Zustand unbekannt')
  expect(w.asks[0]!.options[0]).toBe('Neuer Chat ohne Übergabe (empfohlen)')
  expect(r.drop).toContain('nicht gesendet')
})

deTest('Während der Übergabe: blaue Box über dem Prompt mit Sekunden, danach wieder weg', async ($, on) => {
  const w = world(on, { handoffDelayMs: 5000 })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  const BAND = { plugin: 'sidekick', component: 'AbovePrompt', requestId: 'above-prompt', surface: 'desktop', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } }
  // Vorher: nichts von sidekick im Band
  let band = await $.ui.mount(BAND as never)
  expect(await band.find({ key: 'sidekick-busy' })).toBeUndefined()
  await band.unmount()
  await $.prompt.submit(userPrompt('neues Thema'))
  await w.clock.advance(400)
  await w.clock.advance(3000)
  band = await $.ui.mount(BAND as never)
  const busy = JSON.stringify(await band.find({ key: 'sidekick-busy' }))
  expect(busy).toContain('sidekick schreibt die Übergabe')
  expect(busy).toContain('3 s')
  expect(busy).toContain('"marginBottom":1') // Leerzeile unter der Box (Fynn, 2026-10-06)
  await band.unmount()
  // Übergabe fertig: /clear, senden, Box weg
  await w.clock.advance(3000)
  await flush()
  expect(w.commands).toEqual(['clear'])
  band = await $.ui.mount(BAND as never)
  expect(await band.find({ key: 'sidekick-busy' })).toBeUndefined()
  await band.unmount()
})

deTest('Übergabe läuft und sidekick liegt außen: Box über allem, Quick-Replies ausgeblendet, Balken bleiben', async ($, on) => {
  const w = world(on, { handoffDelayMs: 5000 })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.prompt.submit(userPrompt('neues Thema'))
  await w.clock.advance(1400)
  // Das Band, wie es von innen kommt: Quick-Replies-Pille und Balken (stellvertretend für die anderen Mods)
  w.setBand({ type: 'Box', props: { flexDirection: 'column' }, children: [
    { type: 'Box', props: { key: 'quick-replies' }, children: [{ type: 'Text', props: {}, children: ['Pille'] }] },
    { type: 'Box', props: { key: 'limit-bars' }, children: [{ type: 'Text', props: {}, children: ['5h 40 %'] }] },
  ] })
  const band = await $.ui.mount({ plugin: 'sidekick', component: 'AbovePrompt', requestId: 'above-prompt', surface: 'desktop', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as never)
  expect(await band.find({ key: 'sidekick-busy' })).toBeDefined()
  expect(await band.find({ key: 'quick-replies' })).toBeUndefined()
  expect(await band.find({ key: 'limit-bars' })).toBeDefined()
  await band.unmount()
})

deTest('Übergabe läuft, Band nach band.ts von innen: sidekick-Ebene zuoberst, Pillen-Ebene raus, Balken im Grund', async ($, on) => {
  const w = world(on, { handoffDelayMs: 5000 })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.prompt.submit(userPrompt('neues Thema'))
  await w.clock.advance(1400)
  // quick-replies und limit-bars liegen innen: Wurzel des Bands mit Pillen-Ebene über dem Grund (docs/BAND.md)
  w.setBand({ type: 'Box', props: { key: 'band', flexDirection: 'column', justifyContent: 'flex-end' }, children: [
    { type: 'Box', props: { key: 'layer:20:quick-replies', flexDirection: 'column', flexShrink: 0 }, children: [{ type: 'Box', props: { key: 'quick-replies' }, children: ['Pille'] }] },
    { type: 'Box', props: { key: 'band-base', flexDirection: 'row', alignItems: 'flex-end' }, children: [{ type: 'Box', props: { flexGrow: 1 }, children: [
      { type: 'Box', props: { key: 'limit-bars' }, children: [{ type: 'Text', props: {}, children: ['5h 40 %'] }] },
    ] }] },
  ] })
  const band = await $.ui.mount({ plugin: 'sidekick', component: 'AbovePrompt', requestId: 'above-prompt', surface: 'desktop', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as never)
  type N = { props: { key?: string }; children: N[] }
  const tree = (await band.drawn()) as N
  // sidekick rückt auf die Höhe der Pille: direkt über dem Grund
  expect(tree.children.map((c) => c.props.key)).toEqual(['layer:30:sidekick', 'band-base'])
  expect(await band.find({ key: 'quick-replies' })).toBeUndefined()
  expect(await band.find({ key: 'limit-bars' })).toBeDefined()
  await band.unmount()
})

// ---------- Wartungs-Hinweise (SPEC Nachtrag 0.2.0) ----------

const ALL_CMDS = [
  { name: 'skill-doctor', description: 'Skills', source: 'builtin' },
  { name: 'claude-api', description: 'API', source: 'builtin' },
  { name: 'init', description: 'Init', source: 'builtin' },
  { name: 'anthropic-skills:consolidate-memory', description: 'Memory', source: 'user' },
]
const AVAIL = availOf(ALL_CMDS)
const measure = (o: Partial<Measure> = {}): Measure => ({
  project: 0,
  hasOwn: true,
  autoMem: null,
  model: 'claude-opus-5-5',
  skillsTotal: 40,
  skillsIncluded: 40,
  skillsTokens: 3000,
  unused: null,
  countingDays: 0,
  sessionDays: 1,
  avail: AVAIL,
  ...o,
})
const W0: Wartung = { v: 1, regeln: {}, sessions: [] }
const ago = (days: number) => NOW - days * DAY
const PROJ = 'C:\\Proj\\App'
const KEY = 'c:/proj/app'
const projectFile = (tokens: number) => ({ path: `${PROJ}\\CLAUDE.md`, type: 'Project', tokens })
const wStore = (w: ReturnType<typeof world>) => cleanWartung(w.saved.get(`wartung:${KEY}`))

async function lineUnder($: Engine, text: string, requestId: string): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId, surface: 'desktop', props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)
  const line = JSON.stringify((await ui.find({ key: 'sidekick-line' })) ?? '')
  await ui.unmount()
  return line
}

deTest('Wartung, Auswahl: skills-cut vor audit; danach audit, solange skills-cut ruht; einzeln und ganz abschaltbar', async () => {
  const m = measure({ skillsTotal: 61, skillsIncluded: 52, project: 3400 })
  const h = pickHint(m, W0, DEFAULT_HINTS, NOW)
  expect(h?.id).toBe('skills-cut')
  expect(h?.line).toBe('Skill-Liste gekürzt: Claude sieht 52 von 61 Skills → /skill-doctor')
  const w = { ...W0, regeln: { 'skills-cut': { hintAt: NOW } } }
  expect(pickHint(m, w, DEFAULT_HINTS, NOW + DAY)?.id).toBe('audit')
  expect(pickHint(m, w, DEFAULT_HINTS, NOW + 8 * DAY)?.id).toBe('skills-cut') // Ruhezeit 7 Tage
  expect(pickHint(m, W0, { ...DEFAULT_HINTS, off: ['skills-cut'] }, NOW)?.id).toBe('audit')
  expect(pickHint(m, W0, { ...DEFAULT_HINTS, on: false }, NOW)).toBe(null)
})

deTest('Wartung, audit: Schwelle 3k, Wachstum ≥ 30 %, anderes Modell, Ruhezeit 30 Tage', async () => {
  expect(pickHint(measure({ project: 3400 }), W0, DEFAULT_HINTS, NOW)?.line).toBe('Anweisungen ≈ 3,4k Tokens, prompt-audit lief hier noch nie → /claude-api prompt-audit (eigener Chat)')
  expect(pickHint(measure({ project: 2900 }), W0, DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint(measure({ project: 2900 }), W0, { ...DEFAULT_HINTS, auditMin: 2000 }, NOW)?.id).toBe('audit')
  const done = (o: object = {}) => ({ ...W0, regeln: { audit: { doneAt: ago(40), doneTokens: 3000, doneModel: 'claude-opus-5-5', ...o } } })
  expect(pickHint(measure({ project: 3900 }), done(), DEFAULT_HINTS, NOW)?.line).toContain('um 30 % gewachsen → /claude-api prompt-audit')
  expect(pickHint(measure({ project: 3800 }), done(), DEFAULT_HINTS, NOW)).toBe(null) // 27 %
  expect(pickHint(measure({ project: 3500 }), done(), DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint(measure({ project: 3500, model: 'claude-opus-6' }), done({ doneModel: 'claude-opus-5-5' }), DEFAULT_HINTS, NOW)?.line).toBe('Seit dem letzten Audit neues Modell (claude-opus-6) → /claude-api prompt-audit')
  // `[1m]` gilt als dasselbe Modell
  expect(normModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  expect(pickHint(measure({ project: 3500, model: normModel('Claude-Opus-5-5[1m]') }), done(), DEFAULT_HINTS, NOW)).toBe(null)
  // Ruhezeit: Audit vor 20 Tagen, gewachsen → noch nicht; Hinweis vor 10 Tagen → nicht; vor 31 Tagen → wieder
  expect(pickHint(measure({ project: 5000 }), done({ doneAt: ago(20) }), DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint(measure({ project: 3400 }), { ...W0, regeln: { audit: { hintAt: ago(10) } } }, DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint(measure({ project: 3400 }), { ...W0, regeln: { audit: { hintAt: ago(31) } } }, DEFAULT_HINTS, NOW)?.id).toBe('audit')
})

deTest('Wartung, memory: ab 1k nie aufgeräumt, +40 %, ab 5k mit 7 Tagen Ruhe', async () => {
  expect(pickHint(measure({ autoMem: 1600 }), W0, DEFAULT_HINTS, NOW)?.line).toBe('Memory-Index ≈ 1,6k Tokens, nie aufgeräumt → /anthropic-skills:consolidate-memory')
  expect(pickHint(measure({ autoMem: 900 }), W0, DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint(measure({ autoMem: null }), W0, DEFAULT_HINTS, NOW)).toBe(null)
  const done = (days: number, tokens: number) => ({ ...W0, regeln: { memory: { doneAt: ago(days), doneTokens: tokens } } })
  expect(pickHint(measure({ autoMem: 1200 }), done(20, 1000), DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint(measure({ autoMem: 1400 }), done(20, 1000), DEFAULT_HINTS, NOW)?.line).toContain('um 40 % gewachsen')
  expect(pickHint(measure({ autoMem: 5200 }), done(8, 5000), DEFAULT_HINTS, NOW)?.line).toBe('Memory-Index nahe der Ladegrenze (≈ 5,2k Tokens) → /anthropic-skills:consolidate-memory')
  expect(pickHint(measure({ autoMem: 5200 }), done(6, 5000), DEFAULT_HINTS, NOW)).toBe(null)
  // Ohne den Befehl (CLI-Session, Probe Phase 0) bleibt die Regel stumm
  expect(pickHint(measure({ autoMem: 1600, avail: { ...AVAIL, memory: null } }), W0, DEFAULT_HINTS, NOW)).toBe(null)
})

deTest('Wartung, skills-heavy erst ab 30 Tagen Zählung; eingebaute Skills zählen nicht als ungenutzt', async () => {
  const m = measure({ skillsTokens: 4800, unused: 18, countingDays: 30 })
  expect(pickHint(m, W0, DEFAULT_HINTS, NOW)?.line).toBe('18 Skills seit 30 Tagen ungenutzt, Liste ≈ 4,8k Tokens → /skill-doctor')
  expect(pickHint({ ...m, unused: 9 }, W0, DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint({ ...m, countingDays: 29 }, W0, DEFAULT_HINTS, NOW)).toBe(null)
  expect(pickHint({ ...m, skillsTokens: 3900 }, W0, DEFAULT_HINTS, NOW)).toBe(null)
  const listed = [
    { name: 'docx', source: 'syncedSkills' },
    { name: 'pdf', source: 'syncedSkills' },
    { name: 'dataviz', source: 'built-in' },
    { name: 'remotion:remotion-create', source: 'plugin' },
  ]
  expect(unusedSkills(listed, new Set(['anthropic-skills:pdf', 'remotion-create']))).toBe(1)
})

deTest('Wartung, init: keine eigene CLAUDE.md und Chats an ≥ 3 Tagen; Datei im Elternordner zählt nicht', async () => {
  expect(pickHint(measure({ hasOwn: false, sessionDays: 3 }), W0, DEFAULT_HINTS, NOW)?.line).toBe('Noch keine CLAUDE.md in diesem Projekt (Chats an 3 Tagen) → /init')
  expect(pickHint(measure({ hasOwn: false, sessionDays: 2 }), W0, DEFAULT_HINTS, NOW)).toBe(null)
  const parent = { path: 'C:\\Proj\\CLAUDE.md', type: 'Project', tokens: 200 }
  expect(memoryMeasure([parent], PROJ)).toEqual({ project: 200, hasOwn: false, autoMem: null })
  const own = memoryMeasure([parent, projectFile(2000), { path: 'D:\\Home\\f\\.claude\\projects\\x\\memory\\MEMORY.md', type: 'AutoMem', tokens: 493 }, { path: 'C:\\x\\memory\\topic.md', type: 'AutoMem', tokens: 99 }], PROJ)
  expect(own).toEqual({ project: 2200, hasOwn: true, autoMem: 493 })
})

deTest('Wartung: Projektschlüssel, erledigt erkennen, Vergleichsgröße nach Verkleinerung, Einstellungen', async () => {
  expect(projectKey('D:\\Dev\\ClaudeMods\\.claude\\worktrees\\begleiter-mod-build-d1a1ec')).toBe('d:/dev/claudemods')
  expect(projectKey('D:\\Dev\\ClaudeMods\\')).toBe('d:/dev/claudemods')
  expect(doneFromText('/claude-api prompt-audit')).toEqual(['audit'])
  expect(doneFromText('/claude-api migrate')).toEqual([])
  expect(doneFromText('/anthropic-skills:consolidate-memory')).toEqual(['memory'])
  expect(doneFromText('/skill-doctor')).toEqual(['skills-cut', 'skills-heavy'])
  expect(doneFromText('/init')).toEqual(['init'])
  expect(doneFromText('init bitte')).toEqual([])
  expect(doneFromSkill('claude-api', 'x'.repeat(5000) + '\n\n## User Request\n\nprompt-audit')).toEqual(['audit'])
  expect(doneFromSkill('claude-api', '## User Request\n\nmigrate')).toEqual([])
  expect(doneFromSkill('anthropic-skills:consolidate-memory', '')).toEqual(['memory'])
  const w = rebase({ ...W0, regeln: { audit: { doneAt: ago(1), doneTokens: 3400 } } }, measure({ project: 2600 }))
  expect(w.regeln.audit?.doneTokens).toBe(2600)
  const parse = (t: string) => (t === '2k' ? 2000 : null)
  expect(applyHints(DEFAULT_HINTS, 'audit off', parse)?.settings?.off).toEqual(['audit'])
  expect(applyHints(DEFAULT_HINTS, 'audit-min 2k', parse)?.settings?.auditMin).toBe(2000)
  expect(applyHints(DEFAULT_HINTS, 'done memory', parse)?.done).toBe('memory')
  expect(applyHints(DEFAULT_HINTS, 'done quatsch', parse)?.error).toContain('Unbekannte Regel')
  expect(applyHints(DEFAULT_HINTS, 'status', parse)).toBe(null)
})

deTest('Wartung: erste Nachricht zeigt die Audit-Zeile, merkt gezeigt und den Chat-Tag; zweite Nachricht nicht mehr', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  expect(await $.prompt.submit(userPrompt('los gehts'))).toMatchObject({ text: 'los gehts' })
  const line = await lineUnder($, 'los gehts', 'w1')
  expect(line).toContain('· sidekick: Anweisungen ≈ 3,4k Tokens, prompt-audit lief hier noch nie → /claude-api prompt-audit (eigener Chat)')
  await flush()
  const st = wStore(w)
  expect(st.regeln.audit?.hintAt).toBe(NOW)
  expect(st.sessions).toEqual([dayKey(NOW)])
  expect(today(w.ledger()).wartung.audit?.gezeigt).toBe(1)
  await $.prompt.submit(userPrompt('zweite'))
  expect(await lineUnder($, 'zweite', 'w2')).not.toContain('sidekick')
})

deTest('Wartung: der Hinweis der Prüfung hat Vorrang, der Wartungs-Hinweis gilt dann nicht als gezeigt', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'hinweis', art: 'sonstiges', zeile: 'Haiku sagt etwas' }), usage: MODEL_USAGE })
  await $.prompt.submit(userPrompt('mit Haiku'))
  const line = await lineUnder($, 'mit Haiku', 'w1')
  expect(line).toContain('Haiku sagt etwas')
  expect(line).not.toContain('prompt-audit')
  await flush()
  expect(wStore(w).regeln.audit?.hintAt).toBe(undefined)
  expect(today(w.ledger()).wartung.audit).toBe(undefined)
})

deTest('Wartung: getipptes /claude-api prompt-audit nach dem Hinweis → erledigt, angenommen, Nachricht unverändert', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('los gehts'))
  await w.clock.advance(5 * MIN)
  expect(await $.prompt.submit(userPrompt('/claude-api prompt-audit'))).toMatchObject({ text: '/claude-api prompt-audit' })
  await flush(120)
  const st = wStore(w).regeln.audit
  expect(st?.doneAt).toBe(NOW + 5 * MIN)
  expect(st?.doneTokens).toBe(3400)
  expect(st?.doneModel).toBe('claude-opus-5-5')
  expect(today(w.ledger()).wartung.audit?.angenommen).toBe(1)
})

deTest('Wartung: skill.prompt von claude-api mit prompt-audit erledigt den Audit, auch ohne vorherigen Hinweis', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  await $.skill.prompt({ skill: 'claude-api', text: 'Anleitung …\n\n## User Request\n\nprompt-audit' })
  await flush(120)
  expect(wStore(w).regeln.audit?.doneAt).toBe(NOW)
  expect(today(w.ledger()).wartung.audit).toBe(undefined)
})

deTest('Wartung: Worktree-Wurzel zählt zum Hauptprojekt', async ($, on) => {
  const w = world(on, { root: `${PROJ}\\.claude\\worktrees\\x`, memory: [{ path: `${PROJ}\\.claude\\worktrees\\x\\CLAUDE.md`, type: 'Project', tokens: 3400 }], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('im Worktree'))
  await flush()
  expect(wStore(w).regeln.audit?.hintAt).toBe(NOW)
})

deTest('Wartung, init: dritter Chat-Tag ohne CLAUDE.md → /init; am selben Tag zählt nur einer', async ($, on) => {
  const saved = new Map<string, unknown>([[`wartung:${KEY}`, { v: 1, regeln: {}, sessions: [dayKey(ago(2)), dayKey(ago(1))] }]])
  const w = world(on, { saved, memory: [], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('neues Projekt'))
  expect(await lineUnder($, 'neues Projekt', 'w1')).toContain('Noch keine CLAUDE.md in diesem Projekt (Chats an 3 Tagen) → /init')
  await flush()
  expect(wStore(w).sessions.length).toBe(3)
})

deTest('Wartung, init: am selben Tag mehrere Chats → kein Hinweis', async ($, on) => {
  const saved = new Map<string, unknown>([[`wartung:${KEY}`, { v: 1, regeln: {}, sessions: [dayKey(NOW)] }]])
  world(on, { saved, memory: [], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('nochmal heute'))
  expect(await lineUnder($, 'nochmal heute', 'w1')).not.toContain('sidekick')
})

deTest('Wartung, skills-heavy: Nutzung aus den Bilanzen, Zählung seit 40 Tagen', async ($, on) => {
  const listed = Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, source: 'syncedSkills', tokens: 240 }))
  const old: Ledger = { tage: { [dayKey(ago(40))]: { ...emptyDay(), skills: { s0: 1 } }, [dayKey(ago(3))]: { ...emptyDay(), skills: { s1: 2, s2: 1 } } }, upd: ago(3) }
  const saved = new Map<string, unknown>([['bilanz:alt', old]])
  world(on, { saved, memory: [projectFile(500)], cmds: ALL_CMDS, skills: { totalSkills: 20, includedSkills: 20, tokens: 4800, skillFrontmatter: listed } })
  await $.prompt.submit(userPrompt('viele Skills'))
  // s0 nur vor 40 Tagen benutzt → zählt als ungenutzt; s1, s2 benutzt → 18 ungenutzt
  expect(await lineUnder($, 'viele Skills', 'w1')).toContain('18 Skills seit 30 Tagen ungenutzt, Liste ≈ 4,8k Tokens → /skill-doctor')
})

deTest('Wartung stumm: Befehl fehlt, der Chat-Tag zählt trotzdem', async ($, on) => {
  // Befehl fehlt
  const w = world(on, { memory: [projectFile(3400)] })
  await $.prompt.submit(userPrompt('ohne claude-api'))
  expect(await lineUnder($, 'ohne claude-api', 'w1')).not.toContain('sidekick')
  await flush()
  expect(wStore(w).sessions).toEqual([dayKey(NOW)])
})

deTest('Wartung stumm: hints off', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  w.saved.set('hints', { on: false })
  await $.prompt.submit(userPrompt('aus'))
  expect(await lineUnder($, 'aus', 'w1')).not.toContain('sidekick')
})

deTest('Wartung stumm: -p (origin sdk, keine Surfaces) prüft nicht und zählt keinen Chat-Tag', async ($, on) => {
  const w = world(on, { surfaces: [], memory: [projectFile(3400)], cmds: ALL_CMDS })
  await $.prompt.submit({ text: 'aus -p', wait: false, origin: { kind: 'sdk' } } as never)
  await flush()
  expect(w.saved.has(`wartung:${KEY}`)).toBe(false)
})

deTest('Wartung, Fehlerpfad: breakdown wirft → keine Zeile, Nachricht unverändert', async ($, on) => {
  world(on, { usageFails: true, memory: [projectFile(3400)], cmds: ALL_CMDS })
  expect(await $.prompt.submit(userPrompt('trotzdem'))).toMatchObject({ text: 'trotzdem' })
  expect(await lineUnder($, 'trotzdem', 'w1')).not.toContain('sidekick')
})

deTest('Wartung, Fehlerpfad: root wirft → Schlüssel aus der Anweisungsdatei, init stumm', async ($, on) => {
  const w = world(on, { root: null, memory: [projectFile(3400)], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('ohne root'))
  expect(await lineUnder($, 'ohne root', 'w1')).toContain('prompt-audit')
  await flush()
  expect(wStore(w).regeln.audit?.hintAt).toBe(NOW)
})

deTest('/sidekick hints: status, Regel aus, done, audit-min, unbekannt', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  const status = String((await $.command.run({ command: 'sidekick', args: 'hints status' }) as { text?: string }).text)
  expect(status).toContain('**Wartungs-Hinweise** an')
  expect(status).toContain('prompt-audit')
  expect(status).toContain('3,4k (ab 3,0k)')
  await $.command.run({ command: 'sidekick', args: 'hints audit off' })
  expect((w.saved.get('hints') as { off: string[] }).off).toEqual(['audit'])
  await $.command.run({ command: 'sidekick', args: 'hints audit-min 2k' })
  expect((w.saved.get('hints') as { auditMin: number }).auditMin).toBe(2000)
  await $.command.run({ command: 'sidekick', args: 'hints done memory' })
  expect(wStore(w).regeln.memory?.doneAt).toBe(NOW)
  const bad = String((await $.command.run({ command: 'sidekick', args: 'hints quatsch' }) as { text?: string }).text)
  expect(bad).toContain('Unbekannt')
  const main = String((await $.command.run({ command: 'sidekick', args: 'status' }) as { text?: string }).text)
  expect(main).toContain('**Wartungs-Hinweise:** an (aus: audit)')
})

deTest('Wartung: nur eingebaute Namen für claude-api, skill-doctor, init; Präfix nur bei consolidate-memory (Review S3, K4)', async () => {
  const a = availOf([{ name: 'foo:init' }, { name: 'init' }, { name: 'bar:claude-api' }])
  expect(a.init).toBe('/init')
  expect(a.audit).toBe(null)
  expect(availOf([{ name: 'consolidate-memory' }]).memory).toBe('/consolidate-memory')
  expect(doneFromText('/foo:init')).toEqual([])
  expect(doneFromText('/x:skill-doctor')).toEqual([])
  expect(doneFromSkill('foo:init', '')).toEqual([])
  expect(doneFromSkill('consolidate-memory', '')).toEqual(['memory'])
  expect(rootFromFiles([{ path: `${PROJ}\\.claude\\CLAUDE.md`, type: 'Project', tokens: 10 }])).toBe('c:/proj/app')
})

deTest('Wartung: Prüfung urteilt „durch“ → Wartungs-Zeile erscheint', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  w.setCtx(90000)
  await $.prompt.submit(userPrompt('geprüft'))
  expect(w.checks.length).toBe(1)
  expect(await lineUnder($, 'geprüft', 'w1')).toContain('prompt-audit lief hier noch nie')
  await flush()
  expect(today(w.ledger()).wartung.audit?.gezeigt).toBe(1)
})

deTest('Wartung: Prüfung hält mit Rückfrage an → keine Wartungs-Zeile, nicht gezählt', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'Unklar', fassung: 'Bitte X tun.' }), usage: MODEL_USAGE })
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt('mach das bitte mal schnell'))
  expect(w.asks.length).toBe(1)
  expect(await lineUnder($, 'mach das bitte mal schnell', 'w1')).not.toContain('prompt-audit')
  await flush()
  expect(today(w.ledger()).wartung.audit).toBe(undefined)
  expect(wStore(w).regeln.audit?.hintAt).toBe(undefined)
})

deTest('Wartung: /claude-api prompt-audit über prompt.submit und skill.prompt zählt nur einmal als angenommen', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('los gehts'))
  await w.clock.advance(MIN)
  await $.prompt.submit(userPrompt('/claude-api prompt-audit'))
  await $.skill.prompt({ skill: 'claude-api', text: 'Anleitung\n\n## User Request\n\nprompt-audit' })
  await flush(200)
  expect(today(w.ledger()).wartung.audit?.angenommen).toBe(1)
})

deTest('Wartung, Fehlerpfad: breakdown fehlt → keine Zeile, Nachricht unverändert', async ($, on) => {
  world(on, { noBreakdown: true, cmds: ALL_CMDS })
  expect(await $.prompt.submit(userPrompt('ohne breakdown'))).toMatchObject({ text: 'ohne breakdown' })
  expect(await lineUnder($, 'ohne breakdown', 'w1')).not.toContain('sidekick')
})

deTest('Wartung, Fehlerpfad: root wirft und keine CLAUDE.md → init bleibt stumm', async ($, on) => {
  const saved = new Map<string, unknown>([[`wartung:${KEY}`, { v: 1, regeln: {}, sessions: [dayKey(ago(2)), dayKey(ago(1))] }]])
  world(on, { saved, root: null, memory: [], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('ohne root'))
  expect(await lineUnder($, 'ohne root', 'w1')).not.toContain('/init')
})

deTest('/savings zeigt die Wartungs-Tabelle mit gezeigt und angenommen', async ($, on) => {
  const day = { ...emptyDay(), wartung: { audit: { gezeigt: 2, angenommen: 1 } } }
  const saved = new Map<string, unknown>([['bilanz:x', { tage: { [dayKey(NOW)]: day }, upd: NOW }]])
  world(on, { saved })
  const text = String(((await $.command.run({ command: 'savings', args: 'today' })) as { text?: string }).text)
  expect(text).toContain('| Wartung | gezeigt | angenommen |')
  expect(text).toContain('| prompt-audit | 2 | 1 |')
})

deTest('0.2.2: <system-reminder> vom Host verbraucht die Wartungs-Prüfung nicht und geht ohne Prüfung durch', async ($, on) => {
  const w = world(on, { surfaces: ['desktop'], memory: [projectFile(3400)], cmds: ALL_CMDS })
  w.setCtx(90000)
  const sys = '<system-reminder>\nYou are operating in a git worktree.\n</system-reminder>'
  expect(await $.prompt.submit({ text: sys, wait: false, origin: { kind: 'sdk' } } as never)).toMatchObject({ text: sys })
  expect(w.checks.length).toBe(0)
  w.setCtx(1000)
  await $.prompt.submit({ text: 'erste echte', wait: false, origin: { kind: 'sdk' } } as never)
  expect(await lineUnder($, 'erste echte', 'w1')).toContain('prompt-audit')
})

deTest('0.2.2: /sidekick hints … setzt die Prüfung des laufenden Chats zurück', async ($, on) => {
  const w = world(on, { memory: [projectFile(1800)], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('erste'))
  expect(await lineUnder($, 'erste', 'w1')).not.toContain('sidekick') // 1,8k < 3k
  await $.command.run({ command: 'sidekick', args: 'hints audit-min 1k' })
  await $.prompt.submit(userPrompt('zweite'))
  expect(await lineUnder($, 'zweite', 'w2')).toContain('Anweisungen ≈ 1,8k Tokens, prompt-audit lief hier noch nie')
  await $.prompt.submit(userPrompt('dritte'))
  expect(await lineUnder($, 'dritte', 'w3')).not.toContain('sidekick')
  await flush()
  expect(wStore(w).regeln.audit?.hintAt).toBe(NOW)
})

deTest('0.2.3: keine Fassung bei Nachrichten unter 4 Wörtern; dann erscheint der Wartungs-Hinweis', async ($, on) => {
  const fassung = verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'Unklar', fassung: 'Bitte X tun.' })
  expect(parseVerdict(fassung, 'a', [], 'Testtest')?.urteil).toBe('durch')
  expect(parseVerdict(fassung, 'a', [], 'Sag nur OK.')?.urteil).toBe('durch')
  expect(parseVerdict(fassung, 'a', [], 'Bau mir bitte den Mod')?.urteil).toBe('anhalten')
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  w.setReply({ isAnswered: true, text: fassung, usage: MODEL_USAGE })
  w.setMessages([])
  await $.prompt.submit(userPrompt('Testtest'))
  expect(w.checks.length).toBe(1)
  expect(w.asks.length).toBe(0)
  expect(await lineUnder($, 'Testtest', 'w1')).toContain('prompt-audit lief hier noch nie')
})

deTest('0.2.4: Fassung bleibt die Nachricht des Nutzers; Antworten und Rückfragen des Assistenten werden verworfen', async () => {
  expect(soundsLikeReply('Ich bin bereit – was möchtest du machen?')).toBe(true)
  expect(soundsLikeReply('Welches der drei Projekte soll ich anders angehen – die Geschichte, die Horror-Story oder das Debugging?')).toBe(true)
  expect(soundsLikeReply('Gerne! Ich schaue mir das an.')).toBe(true)
  // Probe mit dem echten Haiku (2026-10-06): neue Rückfragen in der Fassung
  expect(soundsLikeReply('Lass mich die drei Projekte neu angehen. Was soll sich konkret ändern?', 'mach die drei projekte mal anders')).toBe(true)
  expect(soundsLikeReply('Kannst du das, was du eben gemacht hast, nochmal machen, aber besser? Was genau soll sich verbessern?', 'kannst du das mit dem ding von vorhin nochmal machen aber besser')).toBe(true)
  expect(soundsLikeReply('Kannst du die Funktion parseVerdict in logic.ts robuster machen?', 'kannst du das parse ding robuster machen')).toBe(false)
  // Fynns eigene Fragen an den Assistenten bleiben erlaubt
  expect(soundsLikeReply('Ich habe gerade alle Chats geschlossen. Soll ich die Desktop-App komplett neu starten?', 'hab grad alle chats zu soll ich die app neu starten')).toBe(false)
  expect(soundsLikeReply('Bitte committe den Stand und bring den Mod ins Workshop-Format.', 'commit und workshop format')).toBe(false)
  // Steht die Floskel schon in Fynns Text, ist es seine
  expect(soundsLikeReply('Was soll ich tun, wenn der Build scheitert?', 'was soll ich tun wenn der build scheitert')).toBe(false)
  const reply = verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'Unklar, welches Projekt gemeint ist.', fassung: 'Welches der drei Projekte soll ich anders angehen?' })
  const v = parseVerdict(reply, 'b', [], 'mach die drei projekte mal anders bitte')
  expect(v?.urteil).toBe('hinweis')
  expect(v?.fassung).toBe('')
  expect(v?.zeile).toBe('Unklar, welches Projekt gemeint ist.')
  const noLine = verdict({ urteil: 'anhalten', art: 'fassung', zeile: '', fassung: 'Ich bin bereit – was möchtest du machen?' })
  expect(parseVerdict(noLine, 'a', [], 'sag einfach nur kurz OK')?.urteil).toBe('durch')
  // Echte Haiku-Antwort (Probe 2026-10-06): deutsches „… mit geradem " geschlossen → repariert statt verworfen
  const broken = '```json { "urteil": "hinweis", "art": "fassung", "zeile": "Unklar, was „anders" heißen soll – Struktur oder Ton?", "fassung": "", "kurzfassung": "x" } ```'
  expect(parseVerdict(broken, 'b', [], 'mach die drei projekte mal anders')?.zeile).toBe('Unklar, was „anders“ heißen soll – Struktur oder Ton?')
  // Die Rollenregel steht im Prompt
  const sys = checkSystem(null)
  expect(sys).toContain('Absender bleibt der Nutzer')
  expect(sys).toContain('Du bist nicht der Assistent')
})

// ---------- Sprache (userConfig language, release/I18N.md) ----------

test('i18n: beide Tabellen haben dieselben Schlüssel und keine leeren Texte', async () => {
  const keys = (o: object) => Object.keys(o).sort()
  expect(keys(T.en)).toEqual(keys(T.de))
  for (const lang of ['en', 'de'] as const) {
    for (const [k, v] of Object.entries(T[lang])) {
      if (typeof v === 'string') expect(v.trim().length > 0).toBe(true)
      else if (typeof v === 'object') {
        expect(keys(v)).toEqual(keys((T.de as Record<string, object>)[k]!))
        for (const x of Object.values(v)) expect(String(x).trim().length > 0).toBe(true)
      } else expect(String((v as (...a: unknown[]) => string)('x', 'y', 'z')).trim().length > 0).toBe(true)
    }
  }
})

test('i18n: Formatierer en und de', async () => {
  setLang('en')
  expect(usdText(14.444)).toBe('≈ $14.44')
  expect(usdText(0.004)).toBe('< $0.01')
  expect(usdText(-0.12)).toBe('≈ −$0.12')
  expect(usdText(0)).toBe('≈ $0')
  expect(tokensText(1500)).toBe('1.5k')
  expect(tokensText(1_200_000)).toBe('1.2M')
  expect(spanText(20000)).toBe('under 1 min')
  expect(dec(1.5, 1)).toBe('1.5')
  expect(shortDate(NOW)).toBe('Oct 5')
  setLang('de')
  expect(usdText(14.444)).toBe('≈ 14,44 $')
  expect(usdText(0.004)).toBe('< 0,01 $')
  expect(tokensText(1500)).toBe('1,5k')
  expect(spanText(20000)).toBe('unter 1 min')
  expect(shortDate(NOW)).toBe('05.10.')
  // Unbekannte Werte: Englisch (Standard)
  expect(setLang('fr')).toBe('en')
  expect(setLang(undefined)).toBe('en')
})

test('i18n: die Prüfung antwortet in der eingestellten Sprache; Prompt bleibt deutsch, Fassung in der Sprache der Nachricht', async () => {
  setLang('en')
  const en = checkSystem(null)
  expect(en).toContain('"zeile": ein kurzer Satz, höchstens 120 Zeichen, auf Englisch')
  expect(en).toContain('Kurzfassung des Chats fort, auf Englisch')
  expect(en).toContain('in der Sprache seiner Nachricht')
  expect(en).not.toContain('Fynn')
  setLang('de')
  expect(checkSystem(null)).toContain('auf Deutsch, sachlich')
})

test('i18n: Englisch ist Standard; Rückfrage, Zeile und Befehle auf Englisch', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'Unclear which file', fassung: 'Please change hooks/register.ts: X' }), usage: MODEL_USAGE })
  w.setAnswer("Send Sonnet's version (recommended)")
  const r = await $.prompt.submit(userPrompt('please do that thing again'))
  expect(w.asks[0]!.question).toContain('Version:\n"Please change hooks/register.ts: X"')
  expect(w.asks[0]!.question).toContain('How do you want to continue?')
  expect(w.asks[0]!.options).toEqual(["Send Sonnet's version (recommended)", 'Send anyway', 'Cancel'])
  expect(r).toMatchObject({ text: 'Please change hooks/register.ts: X' })
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'm1', surface: 'desktop', props: { text: 'please do that thing again', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-line' }))).toContain("· sidekick: Sonnet's version was sent")
  expect(JSON.stringify(await ui.find({ key: 'sidekick-sent' }))).toContain('sent:')
  await ui.unmount()
  // Die Anweisung der Prüfung verlangt Englisch
  expect(w.checks[0]!.system).toContain('auf Englisch')
  const status = String(((await $.command.run({ command: 'sidekick', args: 'status' })) as { text?: string }).text)
  expect(status).toContain('**on** · status')
  expect(status).toContain('| **Threshold** | 80k context (checks from here) |')
  expect(status).toContain('**Maintenance hints:** on')
  const bad = String(((await $.command.run({ command: 'sidekick', args: 'quatsch' })) as { text?: string }).text)
  expect(bad).toContain('Unknown: "quatsch". Possible:')
  const savings = String(((await $.command.run({ command: 'savings', args: 'today' })) as { text?: string }).text)
  expect(savings).toContain('**Cost**')
  expect(savings).toContain("| Sonnet's version accepted | 1 |")
  expect(savings).toContain('- Checks: **1**')
  expect(savings).toContain('| Sonnet 5.5 | Check | 1 |')
})

test('i18n: Kalt-Rückfrage und Übergabe auf Englisch, mit englischer Gliederung', async ($, on) => {
  const w = world(on)
  w.setCtx(300000)
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  w.setAnswer('New chat with handoff (recommended)')
  await $.prompt.submit(userPrompt('continue with the parser please'))
  expect(w.asks[0]!.question).toContain('Cache cold for 10 min, 300k context. Sending rewrites everything (≈ $2.40).')
  expect(w.asks[0]!.options[0]).toBe('New chat with handoff (recommended)')
  await w.clock.advance(400)
  await flush(200)
  expect(w.handoffs.length).toBe(1)
  expect(w.toasts.some((x) => x.startsWith('New chat with handoff started.'))).toBe(true)
  expect(w.sent.some((x) => x.includes('\n\n---\n\nMy next message:\n\ncontinue with the parser please'))).toBe(true)
  // Übergabe-Prompt: englische Gliederung und Ausgabesprache
  expect(w.handoffSystems[0]).toContain('# Handoff: <one line')
  expect(w.handoffSystems[0]).toContain('Schreibe auf Englisch.')
})

test('i18n: Wartungs-Zeile und hints-Status auf Englisch', async ($, on) => {
  const w = world(on, { memory: [projectFile(3400)], cmds: ALL_CMDS })
  await $.prompt.submit(userPrompt('first real message here'))
  expect(await lineUnder($, 'first real message here', 'w1')).toContain('Instructions ≈ 3.4k tokens, prompt-audit never ran here → /claude-api prompt-audit (separate chat)')
  const status = String(((await $.command.run({ command: 'sidekick', args: 'hints status' })) as { text?: string }).text)
  expect(status).toContain('**Maintenance hints** on')
  expect(status).toContain('| Rule | Measured | done | shown | next possible |')
  expect(status).toContain('3.4k (from 3.0k)')
  const err = String(((await $.command.run({ command: 'sidekick', args: 'hints done nope' })) as { text?: string }).text)
  expect(err).toContain('Unknown rule "nope". Possible:')
  void w
})

test('i18n: Regeln erkennen beide Sprachen, egal welche Einstellung', async () => {
  setLang('en')
  expect(soundsLikeReply("I'm ready – what would you like to do?")).toBe(true)
  expect(soundsLikeReply('Which of the three projects should I change?', 'change the three projects')).toBe(true)
  expect(soundsLikeReply('Sure! Let me look at that.')).toBe(true)
  expect(soundsLikeReply('Ich bin bereit – was möchtest du machen?')).toBe(true)
  expect(soundsLikeReply('Can you make parseVerdict in logic.ts more robust?', 'can you make the parse thing more robust')).toBe(false)
  expect(soundsLikeReply('I closed all chats. Should I restart the desktop app?', 'closed all chats should i restart the app')).toBe(false)
  expect(doneFromText('/claude-api prompt-audit')).toEqual(['audit'])
  const fassung = verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'x', fassung: 'Please do X.' })
  expect(parseVerdict(fassung, 'a', [], 'OK thanks')?.urteil).toBe('durch')
})

deTest('i18n de: Übergabe-Prompt mit deutscher Gliederung', async ($, on) => {
  const w = world(on)
  w.setCtx(300000)
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  w.setAnswer('Neuer Chat mit Übergabe (empfohlen)')
  await $.prompt.submit(userPrompt('weiter mit dem Parser bitte'))
  await w.clock.advance(400)
  await flush(200)
  expect(w.handoffSystems[0]).toContain('# Übergabe: <eine Zeile')
  expect(w.handoffSystems[0]).toContain('Schreibe auf Deutsch.')
})

for (const [lang, opts] of [['de', { options: { language: 'de' } }], ['en', {}]] as const) {
  test(`i18n ${lang}: freier Text unter „Other“ sendet wie getippt und zählt als ignoriert`, opts, async ($, on) => {
    setLang(lang)
    const w = world(on)
    w.setCtx(90000)
    w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'x', fassung: 'Please change hooks/register.ts: X' }), usage: MODEL_USAGE })
    w.setAnswer('mach einfach weiter so')
    expect(await $.prompt.submit(userPrompt('please do that thing again'))).toMatchObject({ text: 'please do that thing again' })
    await flush()
    expect(today(w.ledger()).hinweise.fassung?.ignoriert).toBe(1)
  })
}

test('i18n en: Cancel bricht ab, Text zum Kopieren auf Englisch', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'fassung', zeile: 'x', fassung: 'Please change hooks/register.ts: X' }), usage: MODEL_USAGE })
  w.setAnswer('Cancel')
  const r = await $.prompt.submit(userPrompt('please do that thing again'))
  expect(r).toMatchObject({ drop: 'sidekick: not sent. Your text to copy:\n\nplease do that thing again' })
})

// ---------- 0.5.0: falscher Chat (Gebietswechsel) und Modelle in /savings ----------

const WRONG = { urteil: 'anhalten', art: 'falscher_chat', zeile: 'Dieser Chat: Handy-Game (Unity). Deine Nachricht: Website-CSS.' }
const WRONG_MSG = 'kannst du mir das css für die landingpage der website machen'

deTest('0.5.0: falscher_chat wird immer zur Rückfrage, nie bei der ersten oder einer kurzen Nachricht', async () => {
  const msg = WRONG_MSG
  expect(parseVerdict(verdict(WRONG), 'b', [], msg)?.urteil).toBe('anhalten')
  // Auch ein „hinweis“ hält an (Fynn: verweigern statt Zeile); eine Fassung fällt weg
  const h = parseVerdict(verdict({ ...WRONG, urteil: 'hinweis', fassung: 'Bitte mach das CSS.' }), 'c', [], msg)
  expect(h?.urteil).toBe('anhalten')
  expect(h?.fassung).toBe('')
  expect(parseVerdict(verdict(WRONG), 'a', [], msg)?.urteil).toBe('durch')
  expect(parseVerdict(verdict(WRONG), 'b', [], 'css bitte')?.urteil).toBe('durch')
  // Der Prompt kennt die Art und grenzt sie vom Themenwechsel ab
  const sys = checkSystem(null)
  expect(sys).toContain('"falscher_chat"')
  expect(sys).toContain('mehr als ein Themenwechsel')
  expect(sys).toContain('"neuer_chat" und "falscher_chat" nie bei der ersten Nachricht')
})

deTest('0.5.0: Reihenfolge beim falschen Chat: Abbrechen, passender neuer Chat, der andere, senden', async () => {
  expect(wrongChatChoices(true)).toEqual(['abort', 'plain', 'new', 'send'])
  expect(wrongChatChoices(true, 'nicht')).toEqual(['abort', 'plain', 'new', 'send'])
  expect(wrongChatChoices(true, 'braucht')).toEqual(['abort', 'new', 'plain', 'send'])
  expect(wrongChatChoices(true, 'kaum')).toEqual(['abort', 'new', 'plain', 'send'])
  expect(wrongChatChoices(false, 'braucht')).toEqual(['abort', 'send'])
})

deTest('0.5.0: falscher Chat → Rückfrage, Abbrechen empfohlen; Abbrechen gibt den Text zurück und zählt als angenommen', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict(WRONG), usage: MODEL_USAGE })
  w.setAnswer('Abbrechen (empfohlen)')
  const r = await $.prompt.submit(userPrompt(WRONG_MSG))
  expect(w.asks[0]!.options).toEqual(['Abbrechen (empfohlen)', 'Neuer Chat ohne Übergabe', 'Neuer Chat mit Übergabe', 'Trotzdem senden'])
  expect(w.asks[0]!.question).toContain('Das passt gar nicht zu diesem Chat.')
  expect(w.asks[0]!.question).toContain('Website-CSS')
  expect(w.asks[0]!.question.endsWith('Bist du im falschen Chat?')).toBe(true)
  expect(r.drop).toBe(`sidekick: nicht gesendet (falscher Chat?). Dein Text zum Kopieren:\n\n${WRONG_MSG}`)
  await flush(200)
  expect(today(w.ledger()).hinweise.falscher_chat).toEqual({ gezeigt: 1, angenommen: 1, ignoriert: 0, abgebrochen: 0 })
})

deTest('0.5.0: falscher Chat → „Neuer Chat ohne Übergabe“ leert und sendet nur die Nachricht', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict(WRONG), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat ohne Übergabe')
  const r = await $.prompt.submit(userPrompt(WRONG_MSG))
  expect(r.drop).toContain('neuer Chat')
  await w.clock.advance(400)
  await flush()
  expect(w.handoffs.length).toBe(0)
  expect(w.commands).toEqual(['clear'])
  expect(w.sent).toEqual([WRONG_MSG])
  expect(today(w.ledger()).hinweise.falscher_chat?.angenommen).toBe(1)
  expect(today(w.ledger()).hinweise.neuer_chat).toBeUndefined()
})

deTest('0.5.0: falscher Chat → Trotzdem senden: gesendet, ignoriert, danach ruht die Art bis +50k oder Commit', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict(WRONG), usage: MODEL_USAGE })
  w.setAnswer('Trotzdem senden')
  expect(await $.prompt.submit(userPrompt(WRONG_MSG))).toMatchObject({ text: WRONG_MSG })
  expect(await $.prompt.submit(userPrompt('und noch der footer für die website bitte'))).toMatchObject({ text: 'und noch der footer für die website bitte' })
  expect(w.asks.length).toBe(1)
  await flush()
  expect(today(w.ledger()).hinweise.falscher_chat?.ignoriert).toBe(1)
})

deTest('0.5.0: falscher Chat mit Anhang: nur Abbrechen und senden', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict(WRONG), usage: MODEL_USAGE })
  w.setAnswer('Abbrechen (empfohlen)')
  await $.prompt.submit({ ...userPrompt(WRONG_MSG), attachments: [{ kind: 'image' }] } as never)
  expect(w.asks[0]!.options).toEqual(['Abbrechen (empfohlen)', 'Trotzdem senden'])
})

deTest('0.5.0: falscher Chat geht vor der Kalt-Rückfrage, die Kosten des Sendens stehen dabei', async ($, on) => {
  const w = world(on)
  w.setCtx(undefined)
  await w.step($, stepUsage(0, 300000))
  await w.clock.advance(70 * MIN)
  w.setReply({ isAnswered: true, text: verdict(WRONG), usage: MODEL_USAGE })
  w.setAnswer('Trotzdem senden')
  await $.prompt.submit(userPrompt(WRONG_MSG))
  const q = w.asks[0]!.question
  expect(q).toContain('Das passt gar nicht zu diesem Chat.')
  expect(q).toContain('Cache seit 10 min kalt, 300k Kontext. Senden schreibt alles neu')
  expect(q.endsWith('Bist du im falschen Chat?')).toBe(true)
  expect(w.asks[0]!.options[0]).toBe('Abbrechen (empfohlen)')
})

test('0.5.0 en: wrong chat question and dropped text in English', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ ...WRONG, zeile: 'This chat: mobile game. Your message: website CSS.' }), usage: MODEL_USAGE })
  w.setAnswer('Cancel (recommended)')
  const r = await $.prompt.submit(userPrompt('please write the css for the landing page of the website'))
  expect(w.asks[0]!.options).toEqual(['Cancel (recommended)', 'New chat without handoff', 'New chat with handoff', 'Send anyway'])
  expect(w.asks[0]!.question.endsWith('Are you in the wrong chat?')).toBe(true)
  expect(r.drop).toContain('sidekick: not sent (wrong chat?)')
})

deTest('0.5.0: Modellaufrufe je Modell und Rolle; Name mit Version; altes ohne Modell bleibt „früher“', async () => {
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  // Neue Modelle nicht aus der Preistabelle raten
  expect(modelLabel('claude-haiku-5')).toBe('Haiku 5')
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  const d = { ...emptyDay(), kosten: 0.5, pruefungen: 5 }
  const u = { input_tokens: 3000, output_tokens: 200, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }
  for (const [model, role, usd, ms] of [
    ['claude-sonnet-5-5', 'pruefung', 0.01, 1800],
    ['claude-sonnet-5-5', 'pruefung', 0.01, 2200],
    ['claude-sonnet-5-5', 'uebergabe', 0.03, 8000],
    ['claude-haiku-4-5-20251001', 'pruefung', 0.004, 1500],
  ] as const) {
    d.kosten += usd
    if (role === 'pruefung') d.pruefungen += 1
    bookModel(d, model, role, usd, ms, u)
  }
  const s = d.modelle['claude-sonnet-5-5']!
  expect(s.pruefung).toEqual({ n: 2, usd: 0.02, ms: 4000 })
  expect(s.uebergabe.n).toBe(1)
  expect(s.in).toBe(12000)
  expect(s.out).toBe(600)
  const rows = modelRows(d)
  expect(rows.list.map((x) => x.key)).toEqual(['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'])
  expect(near(rows.earlier.usd, 0.5)).toBe(true)
  expect(rows.earlier.n).toBe(5)
  // Speichern und Zusammenzählen halten die Modelle
  const back = cleanLedger(JSON.parse(JSON.stringify({ tage: { '2026-10-05': d }, upd: NOW }))).tage['2026-10-05']!
  expect(addDay(back, back).modelle['claude-sonnet-5-5']!.pruefung.n).toBe(4)
  const md = savingsReport(d, 'today', NOW, '#abc12')
  expect(md.split('\n')[0]).toBe('**Heute (05.10.)** · #abc12')
  expect(md).toContain('| Modell | Rolle | Aufrufe | ≈ $ | je Aufruf | Ø Dauer |')
  expect(md).toContain('| Sonnet 5.5 | Prüfung | 2 | ≈ 0,02 $ | ≈ 0,01 $ | 2,0 s |')
  expect(md).toContain('| Sonnet 5.5 | Übergabe | 1 | ≈ 0,03 $ | ≈ 0,03 $ | 8,0 s |')
  expect(md).toContain('| Haiku 4.5 | Prüfung | 1 |')
  expect(md).toContain('| früher, ohne Modell | – | 5 | ≈ 0,50 $ | – | – |')
  // Ohne Altlast keine Zeile „früher“; Rundungsreste zählen nicht
  const fresh = { ...emptyDay(), kosten: 0.01, pruefungen: 1 }
  bookModel(fresh, 'claude-sonnet-5-5', 'pruefung', 0.01, 1000, u)
  expect(savingsReport(fresh, 'today', NOW)).not.toContain('früher')
})

deTest('0.5.0: Prüfung und Übergabe buchen je Modell mit Dauer', async ($, on) => {
  const w = world(on, { handoffDelayMs: 5000 })
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe')
  await $.prompt.submit(userPrompt('ganz was anderes jetzt bitte'))
  await w.clock.advance(400)
  await flush()
  await w.clock.advance(5000)
  await flush(200)
  const m = today(w.ledger()).modelle['claude-sonnet-5-5']!
  expect(m.pruefung.n).toBe(1)
  expect(near(m.pruefung.usd, completeCost(MODEL_USAGE, CHECK.model))).toBe(true)
  expect(m.uebergabe.n).toBe(1)
  expect(m.uebergabe.ms).toBe(5000)
  expect(m.in).toBe(6000)
})

deTest('0.5.0: /savings gezeichnet im Terminal und Desktop; VS Code und unbekannte Zeilen bekommen Markdown', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict(WRONG), usage: MODEL_USAGE })
  w.setAnswer('Abbrechen (empfohlen)')
  await $.prompt.submit(userPrompt(WRONG_MSG))
  await flush()
  const out = await $.command.run({ command: 'savings', args: 'today' } as never)
  const text = String(out.text)
  expect(/^\*\*Heute \(05\.10\.\)\*\* · #[0-9a-z]{5,}$/.test(text.split('\n')[0]!)).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface, props: { command: 'savings', args: 'today', text, isErrored: false } } as never)
    const tree = JSON.stringify(await ui.find({ key: 'sidekick-savings' }))
    expect(tree).toContain('Modelle (eigene Aufrufe)')
    expect(tree).toContain('Sonnet 5.5')
    expect(tree).toContain('Prüfung 1×')
    expect(tree).toContain('Falscher Chat')
    expect(tree).toContain('"borderStyle":"round"')
    // Keine Markdown-Zeichen in der Zeichnung
    expect(tree).not.toContain('**')
    if (surface === 'desktop') expect(tree).toContain('"backgroundColor"')
    else expect(tree).toContain('▄')
    await ui.unmount()
  }
  const vs = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'vscode', props: { command: 'savings', args: 'today', text, isErrored: false } } as never)
  expect(await vs.find({ key: 'sidekick-savings' })).toBeFalsy()
  await vs.unmount()
  const old = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'desktop', props: { command: 'savings', args: 'today', text: '**Heute (05.10.)** · #zzzzzz', isErrored: false } } as never)
  expect(await old.find({ key: 'sidekick-savings' })).toBeFalsy()
  await old.unmount()
})

deTest('0.5.0 Review S1: nach Abbrechen beim falschen Chat sieht die nächste Prüfung die fremde Nachricht nicht', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ kurzfassung: 'Game.' }), usage: MODEL_USAGE })
  await $.prompt.submit(userPrompt('mach den joystick größer bitte'))
  w.setReply({ isAnswered: true, text: verdict({ ...WRONG, kurzfassung: 'Game und Website.' }), usage: MODEL_USAGE })
  w.setAnswer('Abbrechen (empfohlen)')
  await $.prompt.submit(userPrompt(WRONG_MSG))
  w.setReply({ isAnswered: true, text: verdict({}), usage: MODEL_USAGE })
  await $.prompt.submit(userPrompt('jetzt die gegnerwellen bitte'))
  const p = w.checks[2]!.prompt
  expect(p).toContain('Kurzfassung bisher: Game.')
  expect(p).not.toContain('landingpage')
  expect(p).toContain('mach den joystick größer bitte')
})

deTest('0.5.0 Review S2: Esc im Dialog „falscher Chat“ sendet nicht, Text zum Kopieren, gezählt als abgebrochen', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict(WRONG), usage: MODEL_USAGE })
  w.setAnswer(null)
  const r = await $.prompt.submit(userPrompt(WRONG_MSG))
  expect(r.drop).toContain('nicht gesendet (falscher Chat?)')
  expect(r.drop).toContain(WRONG_MSG)
  await flush(200)
  expect(today(w.ledger()).hinweise.falscher_chat?.abgebrochen).toBe(1)
  // Andere Rückfragen bleiben fail-open: geschlossen → gesendet
  w.setReply({ isAnswered: true, text: verdict({ urteil: 'anhalten', art: 'neuer_chat', zeile: 'Neues Thema' }), usage: MODEL_USAGE })
  expect(await $.prompt.submit(userPrompt('ganz was anderes im projekt'))).toMatchObject({ text: 'ganz was anderes im projekt' })
})

deTest('0.5.0 Review K1: neuer Chat mit Übergabe aus „falscher Chat“ bucht keine Ersparnis', async ($, on) => {
  const w = world(on)
  w.setCtx(90000)
  w.setReply({ isAnswered: true, text: verdict({ ...WRONG, verlauf: 'kaum' }), usage: MODEL_USAGE })
  w.setAnswer('Neuer Chat mit Übergabe (empfohlen)')
  await $.prompt.submit(userPrompt(WRONG_MSG))
  expect(w.asks[0]!.options[1]).toBe('Neuer Chat mit Übergabe')
  await w.clock.advance(400)
  await flush(200)
  expect(w.handoffs.length).toBe(1)
  expect(w.commands).toEqual(['clear'])
  expect(w.ledger('sess-2').offen ?? null).toBe(null)
  expect(today(w.ledger()).hinweise.falscher_chat?.angenommen).toBe(1)
})

deTest('0.5.0 Review K5: Desktop-Breiten ganzzahlig, isErrored reicht durch, Singular', async ($, on) => {
  const d = { ...emptyDay(), kosten: 0.37, pruefungen: 1, uebergaben: 1, kaltVermieden: { n: 1, usd: 2.333 }, neuWarm: { n: 2, usd: 0.777 } }
  bookModel(d, 'claude-sonnet-5-5', 'pruefung', 0.013, 1800)
  bookModel(d, 'claude-haiku-4-5', 'pruefung', 0.0071, 1500)
  bookModel(d, 'claude-sonnet-5-5', 'uebergabe', 0.05, 9000)
  const tree = JSON.stringify(savingsTree(d, 'all', NOW, 120, 'desktop'))
  const widths = [...tree.matchAll(/"width":"([^"]+)%"/g)].map((m) => m[1]!)
  expect(widths.length > 3).toBe(true)
  for (const x of widths) expect(/^\d+$/.test(x)).toBe(true)
  expect(tree).toContain('1 Prüfung · 1 Übergabe')
  world(on)
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'desktop', props: { command: 'savings', args: '', text: '**x** · #abcdef', isErrored: true } } as never)
  expect(await ui.find({ key: 'sidekick-savings' })).toBeFalsy()
  await ui.unmount()
})

test('0.5.0 en: drawn /savings in English', async () => {
  setLang('en')
  const d = { ...emptyDay(), kosten: 0.02, pruefungen: 1, kaltVermieden: { n: 1, usd: 2.5 } }
  bookModel(d, 'claude-sonnet-5-5', 'pruefung', 0.02, 1800)
  const tree = JSON.stringify(savingsTree(d, 'week', NOW, 100, 'desktop'))
  expect(tree).toContain('Models (own calls)')
  expect(tree).toContain('Check 1× · avg 1.8 s')
  expect(tree).toContain('Cold start avoided')
  expect(tree).toContain('1 : 125')
})
