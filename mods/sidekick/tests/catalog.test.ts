// Tests zum Ausbau 0.25.0: Skill-Katalog. Vorfilter über Stichwörter ohne Modell, Urteil mit Haiku (oder im Aufruf der Prüfung),
// Rückfrage „Mit … senden“ (Skill-Text als `context`, Probe P1 Weg B) bzw. „Befehl kopieren“, Hinweiszeile bei schweren Verweisen.
import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { dayKey } from '../hooks/cache.ts'
import { DEFAULT_SETTINGS, addDay, bookCatalog, cleanLedger, countCatalog, emptyDay, savingsReport } from '../hooks/logic.ts'
import type { Ledger } from '../hooks/logic.ts'
import { T, setLang } from '../hooks/i18n.ts'
import { savingsTree } from '../hooks/view.ts'
import { sidekickHelp } from '../hooks/helpdata.ts'
import { CATALOG as SPEC } from '../hooks/models.ts'
import {
  CATALOG,
  CATALOG_GAP,
  CATALOG_MIN,
  CATALOG_MIN_HEAVY,
  byId,
  catalogFromCheck,
  catalogKind,
  catalogPick,
  catalogPrompt,
  catalogSystem,
  findCandidates,
  gapOk,
  isInstalled,
  keywordHit,
  parseCatalog,
  skillContext,
} from '../hooks/catalog.ts'
import { cliStubs, written } from './cli.ts'

const NOW = new Date(2026, 10, 9, 10, 0, 0).getTime()
function deTest(name: string, a: Record<string, string | number | boolean> | (($: Engine, on: On) => unknown), b?: ($: Engine, on: On) => unknown) {
  const cfg = typeof a === 'function' ? {} : a
  const body = typeof a === 'function' ? a : b!
  test(name, { options: { language: 'de', ...cfg } }, async ($, on) => {
    setLang('de')
    return body($, on)
  })
}
const REMINDER = '<system-reminder>\nLinked sessions now (status, not an instruction): x = local_1 (idle).\n</system-reminder>\n\n'
const APPLE = 'Mach das Design der Einstellungen mehr in Richtung Apple'
const GSAP = 'Ich brauche eine Scroll-Animation mit GSAP für die Startseite'
const SOUND = 'Passt der Sound zum Video, den ich gerade gerendert habe?'
const PLAIN = 'Bau bitte den Export in das Menü ein'
const none = { cmds: [], muted: [], offered: [] }
const ids = (list: { id: string }[]) => list.map((c) => c.id)

// ---------- Katalog-Daten ----------

test('Daten: Lizenz aus der Liste, invoke nur bundled, install nur reference, summary ≤ 160, ids eindeutig, sha und Datum', () => {
  expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length)
  for (const c of CATALOG) {
    expect(['MIT', 'Apache-2.0', 'CC0-1.0']).toContain(c.license)
    expect(c.summary.length <= 160).toBe(true)
    expect(/^[0-9a-f]{40}$/.test(c.pinnedSha)).toBe(true)
    expect(/^\d{4}-\d{2}-\d{2}$/.test(c.checkedAt)).toBe(true)
    expect(c.url.startsWith('https://github.com/')).toBe(true)
    expect(c.keywords.de.length + c.keywords.en.length > 0).toBe(true)
    expect(c.installedAs.length > 0).toBe(true)
    if (c.way === 'bundled') {
      expect(typeof c.invoke).toBe('string')
      expect(c.invoke!.startsWith('sidekick:')).toBe(true)
      expect(c.install).toBeUndefined()
      expect(c.risk).toEqual({ runsCode: false, network: false, heavy: false })
    } else {
      expect(c.invoke).toBeUndefined()
    }
  }
  // Schwer laut E3: earshot, superpowers, hyperframes
  expect(CATALOG.filter((c) => c.risk.heavy).map((c) => c.id).sort()).toEqual(['earshot', 'hyperframes', 'superpowers'])
  expect(CATALOG.filter((c) => c.way === 'bundled').map((c) => c.name)).toEqual(['apple-design', 'emil-design-eng', 'break-ui'])
  expect(SPEC).toEqual({ model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1000, timeoutMs: 4000 })
  expect(CATALOG_MIN).toBe(0.7)
  expect(CATALOG_MIN_HEAVY).toBe(0.9)
  expect(CATALOG_GAP).toBe(10)
})

// Die Dateien der mitgelieferten Skills (LICENSE, Kopfzeile, Flag, Begleitdateien, Gleichheit mit der Quelle) prüft
// scripts/check-bundled-skills.mjs: das Test-Kit liest keine Dateien (wie handoff.test.ts, SKILL_HEADINGS)

// ---------- Vorfilter ----------

deTest('Vorfilter: Treffer de/en, Groß/klein egal, Wortgrenzen, Wortanfang mit *, Phrase mit Bindestrich', () => {
  expect(ids(findCandidates(APPLE, none))).toEqual(['emil-apple'])
  expect(ids(findCandidates('Make the settings sheet feel more like iOS please', none))).toEqual(['emil-apple'])
  expect(ids(findCandidates(GSAP, none))).toEqual(['gsap'])
  expect(ids(findCandidates('Bitte das Panel ein bisschen FEDERNDER öffnen lassen', none))).toEqual(['emil-apple'])
  // Wortgrenze: „Applet“, „Apfel“ und „audios“ treffen nicht ganze Wörter
  expect(findCandidates('Das Java Applet startet nicht mehr richtig', none)).toEqual([])
  expect(ids(findCandidates('Mach einen Stress-Test für die Tabelle mit langen Namen', none))).toEqual(['emil-break'])
  expect(ids(findCandidates('Do a stress test of this table component now', none))).toEqual(['emil-break'])
  for (const s of ['ein bottom-sheet bauen', 'ein bottom sheet bauen', 'ein Bottomsheet bauen']) expect(keywordHit(byId('emil-apple')!, s)).toBe('bottom-sheet*')
  expect(ids(findCandidates('Die Scrollanimation auf der Startseite ruckelt mit GreenSock', none))).toEqual(['gsap'])
})

deTest('Vorfilter: installiert, stumm, schon angeboten → kein Kandidat; höchstens 3', () => {
  expect(findCandidates(GSAP, { cmds: [{ name: 'gsap-skills:gsap-core', plugin: 'gsap-skills' }], muted: [], offered: [] })).toEqual([])
  expect(findCandidates(GSAP, { cmds: [{ name: 'gsap-core' }], muted: [], offered: [] })).toEqual([])
  expect(findCandidates(GSAP, { cmds: [], muted: ['gsap'], offered: [] })).toEqual([])
  expect(findCandidates(GSAP, { cmds: [], muted: [], offered: ['gsap'] })).toEqual([])
  // Die eigene Kopie in sidekick zählt nicht als installiert
  expect(isInstalled(byId('emil-apple')!, [{ name: 'sidekick:apple-design', plugin: 'sidekick' }])).toBe(false)
  expect(isInstalled(byId('emil-apple')!, [{ name: 'apple-design' }])).toBe(true)
  const many = 'Apple Feinschliff mit Worst-Case-Daten, GSAP und Playwright testen bitte'
  expect(findCandidates(many, none).length).toBe(3)
})

deTest('Vorfilter: unter 4 Wörtern, Slash-Befehl, Übergabe und Auftrag aus einem anderen Chat → nichts', () => {
  expect(findCandidates('Apple Design bitte', none)).toEqual([])
  expect(findCandidates('/sidekick catalog mit apple design', none)).toEqual([])
  expect(findCandidates('# Übergabe: Design mehr wie Apple, nächster Schritt GSAP', none)).toEqual([])
  expect(findCandidates('Task (from the session that started this one): make it feel like iOS', none)).toEqual([])
  expect(findCandidates(PLAIN, none)).toEqual([])
})

deTest('Abstand: höchstens eine Rückfrage je 10 eigene Nachrichten', () => {
  expect(gapOk(1, 0)).toBe(true)
  expect(gapOk(5, 3)).toBe(false)
  expect(gapOk(12, 3)).toBe(false)
  expect(gapOk(13, 3)).toBe(true)
})

// ---------- Urteil ----------

deTest('Parser: id oder none, sicher als Zahl/Text begrenzt, unbekannte id → null; Schwelle; schwer erst ab 0,9', () => {
  const cands = findCandidates(APPLE, none)
  expect(parseCatalog('{"id":"emil-apple","sicher":0.8,"grund":"Apple-Gefühl."}', ['emil-apple'])).toEqual({ id: 'emil-apple', sicher: 0.8, grund: 'Apple-Gefühl' })
  expect(parseCatalog('```json\n{"id":"none","sicher":"0,9"}\n```', ['emil-apple'])).toEqual({ id: 'none', sicher: 0.9, grund: '' })
  expect(parseCatalog('{"id":"gsap","sicher":1}', ['emil-apple'])).toBe(null)
  expect(parseCatalog('kaputt', ['emil-apple'])).toBe(null)
  expect(parseCatalog({ id: 'emil-apple', sicher: 3 }, ['emil-apple'])?.sicher).toBe(1)
  expect(catalogPick({ id: 'emil-apple', sicher: 0.7, grund: '' }, cands)?.id).toBe('emil-apple')
  expect(catalogPick({ id: 'emil-apple', sicher: 0.69, grund: '' }, cands)).toBe(null)
  expect(catalogPick({ id: 'none', sicher: 1, grund: '' }, cands)).toBe(null)
  expect(catalogPick(null, cands)).toBe(null)
  const sound = [byId('earshot')!]
  expect(catalogPick({ id: 'earshot', sicher: 0.85, grund: '' }, sound)).toBe(null)
  expect(catalogPick({ id: 'earshot', sicher: 0.9, grund: '' }, sound)?.id).toBe('earshot')
  expect(catalogKind(byId('emil-apple')!)).toBe('skill')
  expect(catalogKind(byId('gsap')!)).toBe('copy')
  expect(catalogKind(byId('earshot')!)).toBe('line')
  // Feld der Prüfung
  expect(catalogFromCheck('{"urteil":"durch","katalog":{"id":"emil-apple","sicher":0.8,"grund":"g"}}', ['emil-apple'])?.id).toBe('emil-apple')
  expect(catalogFromCheck('{"urteil":"durch"}', ['emil-apple'])).toBe(null)
})

deTest('Prompt und system: Marker, Kandidaten mit Kurzbeschreibung, Kurzfassung; de/en; Text des Skills als context', () => {
  const p = catalogPrompt({ text: APPLE, summary: 'Einstellungsseite der App', cands: findCandidates(APPLE, none) })
  expect(p).toContain('[KURZFASSUNG DES CHATS]\nEinstellungsseite der App\n[/KURZFASSUNG DES CHATS]')
  expect(p).toContain('- emil-apple: apple-design (Emil Kowalski).')
  expect(p).toContain(`[NEUE NACHRICHT]\n${APPLE}\n[/NEUE NACHRICHT]`)
  expect(catalogSystem()).toContain('{"id":"<id>|none","sicher":0.0,')
  expect(catalogSystem()).toContain('Im Zweifel "none"')
  setLang('en')
  expect(catalogSystem()).toContain('When in doubt, "none"')
  setLang('de')
  const ctx = skillContext('---\n# From x\nname: a\n---\n\n# Body\nUse $ARGUMENTS here', '/r/skills/apple-design', byId('emil-apple')!, 'mein Text')
  expect(ctx).toContain('sidekick:apple-design')
  expect(ctx).toContain('Base directory for this skill: /r/skills/apple-design')
  expect(ctx).toContain('# Body\nUse mein Text here')
  expect(ctx).not.toContain('name: a')
})

// ---------- Bilanz und Hilfe ----------

deTest('Bilanz: Rolle katalog in /savings detail mit Feldern; alte Tage ohne Feld → 0', () => {
  const old = cleanLedger({ tage: { [dayKey(NOW)]: { kosten: 1 } } }).tage[dayKey(NOW)]!
  expect(old.katalog).toEqual({ n: 0, usd: 0, ms: 0, angeboten: 0, mitSkill: 0, kopiert: 0, trotzdem: 0, stumm: 0, zeile: 0 })
  const d = emptyDay()
  const u = { input_tokens: 1500, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  for (let i = 0; i < 2; i++) bookCatalog(d, 'claude-haiku-5-5', 0.0002, 1300, u)
  for (const f of ['angeboten', 'angeboten', 'mitSkill', 'kopiert', 'trotzdem', 'stumm'] as const) countCatalog(d, f)
  expect(d.modelle['claude-haiku-5-5']?.katalog.n).toBe(2)
  expect(addDay(d, old).katalog.angeboten).toBe(2)
  const md = savingsReport(d, 'all', NOW, '', { [dayKey(NOW)]: d })
  expect(md).toContain('| Haiku 5.5 | Katalog | 2 |')
  expect(md).toContain('Katalog: 2 Urteile (')
  expect(md).toContain('2× angeboten, 1× mit Skill gesendet, 1× Befehl kopiert, 1× trotzdem gesendet, 1× stumm')
  expect(JSON.stringify(savingsTree(d, 'all', NOW, 100, 'terminal', { [dayKey(NOW)]: d }))).toContain('1× Befehl kopiert')
  expect(savingsReport(emptyDay(), 'all', NOW, '', { [dayKey(NOW)]: emptyDay() })).not.toContain('Katalog:')
})

deTest('Hilfe: /sidekick catalog, on|off, mute; Funktion und Einstellung Skill-Katalog; en/de gleiche Schlüssel', () => {
  const f = { settings: DEFAULT_SETTINGS, ttl: { min: 5, source: 'default' as const }, hints: { on: true, off: [] }, known: 0, now: NOW, cfg: { catalog: false } }
  const h = sidekickHelp(f)
  const cmds = h.commands.map((c) => c.cmd)
  for (const c of ['/sidekick catalog', '/sidekick catalog on|off', '/sidekick catalog mute|unmute <id>']) expect(cmds).toContain(c)
  expect(h.features?.find((x) => x.name === 'Skill-Katalog')).toEqual({ name: 'Skill-Katalog', state: { kind: 'off' }, toggle: '/sidekick catalog on' })
  expect(h.settings?.find((x) => x.title === 'Skill-Katalog')).toMatchObject({ value: 'aus', isDefault: false })
  expect(Object.keys(T.en.cat).sort()).toEqual(Object.keys(T.de.cat).sort())
  expect(T.de.role.katalog).toBe('Katalog')
  expect(T.en.role.katalog).toBe('Catalog')
  setLang('en')
  expect(sidekickHelp({ ...f, cfg: {} }).features?.find((x) => x.name === 'Skill catalog')?.state).toEqual({ kind: 'on' })
  setLang('de')
})

// ---------- Hooks ----------

type Reply = string | Error | 'timeout'

function world(on: On, o: { surfaces?: string[]; cmds?: { name: string; plugin?: string; source?: string; description?: string }[]; copyFails?: boolean; readFails?: boolean; trigger?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  const asks: { question: string; options: string[]; header?: string }[] = []
  let answer: string | null = null
  const copies: string[] = []
  const reads: string[] = []
  const catCalls: string[] = []
  const checks: { system: string; prompt: string }[] = []
  let reply: Reply = '{"id":"emil-apple","sicher":0.85,"grund":"Apple-Gefühl für die Einstellungen"}'
  let checkReply = '{"urteil":"durch","art":"sonstiges","zeile":"","fassung":"","skill":"","kurzfassung":"k"}'
  let surfaces = o.surfaces ?? ['desktop']
  const cli = cliStubs(on)
  on('session.start', () => ({ cwd: '/work' }) as never)
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: surfaces as never }))
  // Kontext klein: ohne Auslöser keine Prüfung (außer `trigger`: über der Schwelle)
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: o.trigger ? 120000 : 20000, window: 1000000 }, rateLimits: [] } as never }))
  on('session.root', () => ({ value: 'C:\\Proj' }))
  // Mit Antwort im Verlauf: nicht die erste Nachricht (sonst Auslöser a)
  on('session.messages', () => ({ value: [{ role: 'user', text: PLAIN, toolUses: [] }, { role: 'assistant', text: 'Erledigt.', toolUses: [] }] as never }))
  on('command.list', () => ({ value: (o.cmds ?? []).map((c) => ({ description: '', source: 'plugin', ...c })) as never }))
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
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.copy', ($, e) => {
    copies.push(e.text)
    return { value: o.copyFails ? { isCopied: false, reason: 'no-clipboard' } : { isCopied: true } } as never
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ value: { isFilled: true } }) as never)
  on('fs.read', ($, e) => {
    reads.push(e.path)
    if (o.readFails) throw new Error('ENOENT')
    return { value: '---\n# From emilkowalski/skills@x\nname: apple-design\ndisable-model-invocation: true\n---\n\n# Apple Design\nSKILL-BODY' }
  })
  on('state.get', () => ({ value: { value: undefined, version: 1 } }))
  on('state.set', () => ({ value: { isSet: true, version: 1 } }))
  on('tool.call', async ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: '' }
    const q = (e as unknown as { questions: { question: string; header?: string; options: { label: string }[] }[] }).questions[0]!
    asks.push({ question: q.question, options: q.options.map((x) => x.label), ...(q.header ? { header: q.header } : {}) })
    if (answer === null) return { deny: 'Dialog geschlossen' }
    return { result: { answers: { [q.question]: answer } } }
  })
  const U = { input_tokens: 1500, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', ($, e) => {
    const sys = e.system ?? ''
    if (sys.includes('Ein Stichwortfilter hat') || sys.includes('A keyword filter found')) {
      catCalls.push(e.prompt)
      if (reply instanceof Error) throw reply
      if (reply === 'timeout') return { value: { isAnswered: false, reason: 'timeout', usage: U } as never }
      return { value: { isAnswered: true, text: reply, usage: U } as never }
    }
    checks.push({ system: sys, prompt: e.prompt })
    return { value: { isAnswered: true, text: checkReply, usage: U } as never }
  })
  on('prompt.submit', async ($, e) => ({ text: e.text, ...(e.context ? { context: e.context } : {}) }))
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? '')] }))
  return {
    clock,
    store,
    toasts,
    asks,
    copies,
    reads,
    catCalls,
    checks,
    cli,
    setAnswer: (a: string | null) => (answer = a),
    setReply: (r: Reply) => (reply = r),
    setCheckReply: (r: string) => (checkReply = r),
    setSurfaces: (s: string[]) => (surfaces = s),
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
type Res = { text?: string; context?: readonly string[]; drop?: string }
const send = ($: Engine, text: string, extra: Record<string, unknown> = {}) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never) as Promise<Res>
async function lineUnder($: Engine, text: string, requestId: string, surface = 'desktop') {
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId, surface, props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)
  const node = await ui.find({ key: 'sidekick-line' })
  const btn = await ui.find({ key: 'sidekick-use' })
  return { line: JSON.stringify(node ?? ''), btn, ui }
}
const skillCtx = (r: Res) => (r.context ?? []).find((c) => c.includes('SKILL-BODY'))
const X = T.de.cat
const rec = T.de.recommended

deTest('Mitgeliefert: Rückfrage mit Empfehlung oben; „Mit apple-design senden“ hängt den Skill-Text als context an, ohne drop', async ($, on) => {
  const w = world(on)
  await start($)
  w.setAnswer(X.optWith('apple-design') + rec)
  const r = await send($, REMINDER + APPLE)
  expect(w.catCalls.length).toBe(1)
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.header).toBe('Skill')
  expect(w.asks[0]!.question).toContain('Dafür gibt es *apple-design* von Emil Kowalski (MIT, liegt in sidekick): Apple-Gefühl für die Einstellungen.')
  // Kontext, den der Skill kostet (Planungs-Chat 2026-11-09)
  expect(w.asks[0]!.question).toMatch(/Mit dem Skill kommen ≈ 5[.,]8k Tokens Kontext zu dieser Nachricht\. Wie senden\?$/)
  expect(w.asks[0]!.options).toEqual([X.optWith('apple-design') + rec, X.optSend, X.optMute])
  expect(r.drop).toBeUndefined()
  // Text wie getippt (mit Vorspann der App), der Skill im context
  expect(r.text).toBe(REMINDER + APPLE)
  const ctx = skillCtx(r)!
  expect(ctx).toContain('sidekick:apple-design')
  expect(ctx).toContain('Base directory for this skill: ')
  expect(ctx).not.toContain('disable-model-invocation')
  expect(w.reads[0]!.replace(/\\/g, '/')).toMatch(/\/skills\/apple-design\/SKILL\.md$/)
  const { line, ui } = await lineUnder($, REMINDER + APPLE, 'u1')
  expect(line).toContain('mit apple-design gesendet (Emil Kowalski, MIT)')
  await ui.unmount()
  await flush()
  const d = today(w.ledger())
  expect(d.katalog).toMatchObject({ n: 1, angeboten: 1, mitSkill: 1 })
  expect(d.modelle['claude-haiku-5-5']?.katalog.n).toBe(1)
})

deTest('Mitgeliefert mit Anhang: Skill geht trotzdem mit (Weg B reicht Anhänge weiter)', async ($, on) => {
  const w = world(on)
  await start($)
  w.setAnswer(X.optWith('apple-design'))
  const r = await send($, APPLE, { attachments: [{ type: 'image', mediaType: 'image/png' }] })
  expect(r.drop).toBeUndefined()
  expect(skillCtx(r)).toBeDefined()
})

deTest('Mitgeliefert: Skill-Datei nicht lesbar → Toast, ohne Skill gesendet', async ($, on) => {
  const w = world(on, { readFails: true })
  await start($)
  w.setAnswer(X.optWith('apple-design'))
  const r = await send($, APPLE)
  expect(r.drop).toBeUndefined()
  expect(skillCtx(r)).toBeUndefined()
  expect(w.toasts.some((t) => t.includes('apple-design ließ sich nicht laden'))).toBe(true)
})

deTest('Trotzdem senden, geschlossen, Nicht mehr vorschlagen → unverändert gesendet; stumm gilt für alle Chats; je Chat einmal', async ($, on) => {
  const w = world(on)
  await start($)
  w.setAnswer(X.optSend)
  const r1 = await send($, APPLE)
  expect(r1.text).toBe(APPLE)
  expect(skillCtx(r1)).toBeUndefined()
  // schon angeboten: kein zweites Mal in diesem Chat, kein Haiku
  await send($, `${APPLE} und die Abstände`)
  expect(w.catCalls.length).toBe(1)
  expect(w.asks.length).toBe(1)
  await flush()
  expect(today(w.ledger()).katalog.trotzdem).toBe(1)
})

deTest('Geschlossen → durch; Nicht mehr vorschlagen → Store catalog:muted, Toast', async ($, on) => {
  const w = world(on)
  await start($)
  w.setAnswer(null)
  w.setReply('{"id":"emil-break","sicher":0.9,"grund":"Randfälle"}')
  const r0 = await send($, 'Mach einen Stresstest der Tabelle mit langen Namen')
  expect(r0.drop).toBeUndefined()
  expect(skillCtx(r0)).toBeUndefined()
  // Abstand: die nächste Katalog-Rückfrage erst 10 eigene Nachrichten nach der letzten (Nachricht 1 → frühestens 11)
  for (let i = 0; i < 8; i++) await send($, `${PLAIN} Nummer ${i}`)
  w.setReply('{"id":"emil-apple","sicher":0.85,"grund":"Apple"}')
  w.setAnswer(X.optMute)
  await send($, APPLE)
  expect(w.asks.length).toBe(1)
  await send($, `${PLAIN} noch einmal`)
  const r = await send($, `${APPLE} bitte jetzt`)
  expect(w.asks.length).toBe(2)
  expect(r.text).toBe(`${APPLE} bitte jetzt`)
  expect(w.store.get('catalog:muted')).toEqual(['emil-apple'])
  expect(w.toasts.some((t) => t.includes('apple-design wird nicht mehr vorgeschlagen'))).toBe(true)
  await flush()
  expect(today(w.ledger()).katalog.stumm).toBe(1)
})

deTest('Verweis leicht: Rückfrage, „Befehl kopieren“ → $.ui.copy mit der README-Zeile, drop mit Text; Kopieren scheitert → Zeile im Grund', async ($, on) => {
  const w = world(on)
  await start($)
  w.setReply('{"id":"gsap","sicher":0.9,"grund":"ScrollTrigger"}')
  w.setAnswer(X.optCopy + rec)
  const r = await send($, GSAP)
  expect(w.asks[0]!.question).toContain('Dafür gibt es *gsap-skills* von GreenSock (MIT, nicht installiert): ScrollTrigger.')
  expect(w.asks[0]!.question).toContain('sidekick installiert nichts')
  expect(w.asks[0]!.options[0]).toBe(X.optCopy + rec)
  expect(w.copies).toEqual(['/plugin marketplace add greensock/gsap-skills'])
  expect(r.drop).toContain('sidekick: Befehl kopiert: /plugin marketplace add greensock/gsap-skills')
  expect(r.drop).toContain(`Dein Text: ${GSAP}`)
  expect(r.drop).toContain('/reload-plugins')
  expect(r.drop).toContain('Hier einfügen und bestätigen')
  await flush()
  expect(today(w.ledger()).katalog.kopiert).toBe(1)
})

deTest('Verweis leicht mit Risiko (Review S3) und Shell-Zeile: Notiz in der Frage, „in einem Terminal ausführen“ im Grund', async ($, on) => {
  const w = world(on)
  await start($)
  w.setReply('{"id":"playwright","sicher":0.9,"grund":"End-to-End-Test"}')
  w.setAnswer(X.optSend)
  await send($, 'Teste die Website bitte mit Playwright im Browser durch')
  expect(w.asks[0]!.question).toContain('Dafür gibt es *playwright* von Microsoft (Apache-2.0, nicht installiert, npx @latest, Chromium): End-to-End-Test.')
  // Zehn Nachrichten später: eine Shell-Zeile (npx) wird kopiert, der Grund sagt „Terminal“
  for (let i = 0; i < 10; i++) await send($, `${PLAIN} Nummer ${i}`)
  w.setReply('{"id":"emil-mobile","sicher":0.9,"grund":"Safe Areas"}')
  w.setAnswer(X.optCopy)
  const r = await send($, 'Die PWA fühlt sich wie eine Website an, mach das nativer')
  expect(w.asks[1]!.question).toContain('(MIT, nicht installiert, npx, ungepinnt)')
  expect(w.copies).toEqual(['npx skills@latest add emilkowalski/skills'])
  expect(r.drop).toContain('In einem Terminal ausführen (nicht hier ins Eingabefeld)')
})

deTest('Verweis leicht: Kopieren scheitert → „Kopieren ging nicht“ mit Befehl und Text', async ($, on) => {
  const w = world(on, { copyFails: true })
  await start($)
  w.setReply('{"id":"gsap","sicher":0.9,"grund":"ScrollTrigger"}')
  w.setAnswer(X.optCopy)
  const r = await send($, GSAP)
  expect(r.drop).toContain('Kopieren ging nicht. Befehl: /plugin marketplace add greensock/gsap-skills')
  expect(r.drop).toContain(`Dein Text: ${GSAP}`)
})

deTest('Verweis schwer: keine Rückfrage, Nachricht geht, Zeile mit Knopf „Befehl kopieren“; Shell-Zeile wird kopiert, nicht eingefügt', async ($, on) => {
  const w = world(on, { surfaces: ['terminal'] })
  await start($)
  w.setReply('{"id":"earshot","sicher":0.95,"grund":"Audio prüfen"}')
  const r = await send($, SOUND)
  expect(w.asks.length).toBe(0)
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe(SOUND)
  const { line, btn, ui } = await lineUnder($, SOUND, 'u1', 'terminal')
  expect(line).toContain('Dafür gibt es earshot von Leon Lin (MIT, Python, ≈ 1 GB Modelle): Audio prüfen')
  expect(JSON.stringify(btn)).toContain(T.de.btnCopy)
  await ui.press({ key: 'sidekick-use' })
  await flush()
  expect(w.copies).toEqual(['uv tool install "earshot[mcp] @ git+https://github.com/Leonxlnx/earshot"'])
  // Review S2: nicht „ins Eingabefeld einfügen und abschicken“
  expect(w.toasts.at(-1)).toContain('In einem Terminal ausführen, nicht hier ins Eingabefeld.')
  await ui.unmount()
  await flush()
  expect(today(w.ledger()).katalog).toMatchObject({ angeboten: 1, zeile: 1 })
})

deTest('Verweis schwer unter 0,9 → nichts; Urteil none, unter Schwelle, Fehler, Timeout, ungültig → durch', async ($, on) => {
  const w = world(on)
  await start($)
  w.setReply('{"id":"earshot","sicher":0.85,"grund":"Audio"}')
  const r0 = await send($, SOUND)
  expect(r0.text).toBe(SOUND)
  expect(w.asks.length).toBe(0)
  const texts = [APPLE, `${APPLE} zwei`, `${APPLE} drei`, `${APPLE} vier`, `${APPLE} fünf`]
  const replies: Reply[] = ['{"id":"none","sicher":0.9}', '{"id":"emil-apple","sicher":0.6}', new Error('api down'), 'timeout', 'kaputt']
  for (let i = 0; i < replies.length; i++) {
    w.setReply(replies[i]!)
    const r = await send($, texts[i]!)
    expect(r.drop).toBeUndefined()
    expect(r.text).toBe(texts[i]!)
    expect(skillCtx(r)).toBeUndefined()
  }
  expect(w.asks.length).toBe(0)
})

deTest('Ohne Prüfung: Slash, Plugin-Herkunft, laufende Runde, wait, unter 4 Wörtern, ohne Stichwort → kein Haiku', async ($, on) => {
  const w = world(on)
  await start($)
  await send($, '/sidekick catalog')
  await send($, APPLE, { origin: { kind: 'plugin', name: 'x' } })
  await send($, APPLE, { turnId: 't1' })
  await send($, APPLE, { wait: true })
  await send($, 'Apple Design bitte')
  await send($, PLAIN)
  expect(w.catCalls.length).toBe(0)
  expect(w.asks.length).toBe(0)
})

deTest('Stufe Cache: kein Katalog', { level: 'cache' }, async ($, on) => {
  const w = world(on)
  await start($)
  await send($, APPLE)
  expect(w.catCalls.length).toBe(0)
})

deTest('Stufe Aus: kein Katalog', { level: 'off' }, async ($, on) => {
  const w = world(on)
  await start($)
  await send($, APPLE)
  expect(w.catCalls.length).toBe(0)
})

test('Englisch: Rückfrage und Antworten in der Sprache, system englisch', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  const w = world(on)
  await start($)
  w.setAnswer(T.en.cat.optSend)
  await send($, 'Make the settings sheet feel more like iOS please')
  expect(w.asks[0]!.question).toContain('There is *apple-design* by Emil Kowalski for this (MIT, ships with sidekick)')
  expect(w.asks[0]!.options).toEqual([T.en.cat.optWith('apple-design') + T.en.recommended, T.en.cat.optSend, T.en.cat.optMute])
  setLang('de')
})

deTest('catalog off: kein Katalog', { catalog: false }, async ($, on) => {
  const w = world(on)
  await start($)
  await send($, APPLE)
  expect(w.catCalls.length).toBe(0)
})

deTest('-p (sdk ohne Oberfläche): kein Katalog; im Desktop zählt sdk als getippt', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await start($)
  await send($, APPLE, { origin: { kind: 'sdk' } })
  expect(w.catCalls.length).toBe(0)
  w.setSurfaces(['desktop'])
  w.setAnswer(X.optSend)
  await send($, APPLE, { origin: { kind: 'sdk' } })
  expect(w.catCalls.length).toBe(1)
})

deTest('Installiert (Original-Skill vorhanden): kein Vorschlag', async ($, on) => {
  const w = world(on, { cmds: [{ name: 'apple-design', source: 'skills' }] })
  await start($)
  await send($, APPLE)
  expect(w.catCalls.length).toBe(0)
})

deTest('Zusammen mit der Prüfung (Auslöser b): Kandidaten im Prompt, Feld katalog, kein zweiter Aufruf', async ($, on) => {
  const w = world(on, { trigger: true })
  await start($)
  w.setCheckReply('{"urteil":"durch","art":"sonstiges","zeile":"","fassung":"","skill":"","kurzfassung":"k","katalog":{"id":"emil-apple","sicher":0.8,"grund":"Apple-Stil"}}')
  w.setAnswer(X.optSend)
  await send($, APPLE)
  expect(w.checks.length).toBe(1)
  expect(w.checks[0]!.prompt).toContain('Fremde Skills:\n- emil-apple: apple-design')
  expect(w.checks[0]!.system).toContain('"katalog"')
  expect(w.catCalls.length).toBe(0)
  expect(w.asks.length).toBe(1)
  expect(w.asks[0]!.question).toContain(': Apple-Stil.')
})

deTest('Zusammen mit der Prüfung: hat sie eine Zeile, kommt kein Katalog („höchstens eine Sache“)', async ($, on) => {
  const w = world(on, { trigger: true })
  await start($)
  w.setCheckReply('{"urteil":"hinweis","art":"fassung","zeile":"Welche Seite genau?","fassung":"","skill":"","kurzfassung":"k","katalog":{"id":"emil-apple","sicher":0.9,"grund":"x"}}')
  await send($, APPLE)
  expect(w.asks.length).toBe(0)
  expect(w.catCalls.length).toBe(0)
  // nicht verbraucht: nicht als angeboten gebucht
  await flush()
  expect(today(w.ledger()).katalog.angeboten).toBe(0)
})

// ---------- /sidekick catalog ----------

deTest('/sidekick catalog: Liste mit Herkunft, Lizenz, Weg, Stand; Knöpfe kopieren und stumm; on|off über writeCfg; mute/unmute', async ($, on) => {
  const w = world(on, { cmds: [{ name: 'earshot', source: 'skills' }] })
  await start($)
  const md = await run($, 'catalog')
  expect(md).toContain('**Skill-Katalog** · an')
  expect(md).toContain('| `emil-apple` apple-design | Emil Kowalski | MIT | mitgeliefert | aktiv |')
  expect(md).toContain('| `earshot` earshot | Leon Lin | MIT | Verweis, nur Hinweis, Python, ≈ 1 GB Modelle | installiert |')
  expect(md).toContain('| `emil-animate` animate, review-animations | Emil Kowalski | MIT | Verweis, npx, ungepinnt | aktiv |')
  expect(md).toContain('- `gsap`: `/plugin marketplace add greensock/gsap-skills` · https://github.com/greensock/gsap-skills')
  expect(md).toContain('- `emil-apple`: `/sidekick:apple-design`')
  const tag = /#[0-9a-z]{5,}/.exec(md)![0]
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'desktop', props: { command: 'sidekick', args: 'catalog', text: md, isErrored: false } } as never)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-cat-emil-apple' }))).toContain('apple-design')
  await ui.press({ key: 'sidekick-cat-copy-gsap' })
  await flush()
  expect(w.copies).toEqual(['/plugin marketplace add greensock/gsap-skills'])
  expect(w.toasts.some((t) => t.startsWith('Kopiert: /plugin marketplace add'))).toBe(true)
  await ui.press({ key: 'sidekick-cat-mute-gsap' })
  await flush()
  expect(w.store.get('catalog:muted')).toEqual(['gsap'])
  await ui.unmount()
  expect(tag.length > 1).toBe(true)
  expect(await run($, 'catalog unmute gsap')).toBe('✓ gsap-skills wird wieder vorgeschlagen.')
  expect(w.store.get('catalog:muted')).toEqual([])
  expect(await run($, 'catalog mute nix')).toContain('Unbekannter Eintrag „nix“')
  expect(await run($, 'catalog foo')).toBe(X.usage)
  expect(await run($, 'catalog on')).toBe(X.already(true))
  const off = await run($, 'catalog off')
  expect(off).toContain(X.set(false))
  expect(written(w.cli)).toEqual({ catalog: 'false' })
})

deTest('/sidekick catalog im Terminal (Review S5): gleiche Knöpfe; Shell-Zeile kopiert mit Hinweis „Terminal“', async ($, on) => {
  const w = world(on, { surfaces: ['terminal'] })
  await start($)
  const md = await run($, 'catalog')
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'terminal', props: { command: 'sidekick', args: 'catalog', text: md, isErrored: false } } as never)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-cat-earshot' }))).toContain('Leon Lin')
  await ui.press({ key: 'sidekick-cat-copy-earshot' })
  await flush()
  expect(w.copies).toEqual(['uv tool install "earshot[mcp] @ git+https://github.com/Leonxlnx/earshot"'])
  expect(w.toasts.at(-1)).toContain('In einem Terminal ausführen')
  await ui.press({ key: 'sidekick-cat-mute-emil-break' })
  await flush()
  expect(w.store.get('catalog:muted')).toEqual(['emil-break'])
  await ui.unmount()
})
