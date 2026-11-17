// Tests zum Ausbau 0.25.0: Skill-Katalog. Vorfilter über Stichwörter ohne Modell, Urteil mit Haiku (oder im Aufruf der Prüfung),
// Rückfrage „Mit … senden“ (Skill-Text als `context`, Probe P1 Weg B) bzw. „Befehl kopieren“, Hinweiszeile bei schweren Verweisen.
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { dayKey } from '../hooks/cache.js'
import { DEFAULT_SETTINGS, addDay, bookCatalog, cleanLedger, countCatalog, emptyDay, savingsReport } from '../hooks/logic.js'
import type { Ledger } from '../hooks/logic.js'
import { T, setLang } from '../hooks/i18n.js'
import { savingsTree } from '../hooks/view.js'
import { sidekickHelp } from '../hooks/helpdata.js'
import { CATALOG as SPEC } from '../hooks/models.js'
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
  launchOf,
  keywordHit,
  parseCatalog,
  skillContext,
  yieldedTo,
} from '../hooks/catalog.js'
import { cliStubs, written } from './cli.js'

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
    expect(['MIT', 'Apache-2.0', 'CC0-1.0', 'service']).toContain(c.license)
    expect(c.summary.length <= 160).toBe(true)
    // Ausbau 0.30.0 (E6): `service` nur ohne Repo und sha, die Adresse ist die Seite des Herstellers; sonst Repo mit gepinntem sha
    if (c.license === 'service') {
      expect(c.repo).toBe('')
      expect(c.pinnedSha).toBe('')
      expect(c.url.startsWith('https://')).toBe(true)
    } else {
      expect(/^[0-9a-f]{40}$/.test(c.pinnedSha)).toBe(true)
      expect(c.url.startsWith('https://github.com/')).toBe(true)
    }
    expect(/^\d{4}-\d{2}-\d{2}$/.test(c.checkedAt)).toBe(true)
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
  expect(CATALOG.filter((c) => c.risk.heavy).map((c) => c.id).sort()).toEqual(['earshot', 'hyperframes', 'superpowers', 'video-use'])
  // Ausbau 0.31.0 (E2, E3): nur Emils drei bleiben Kopien (seine README belegt keine Zeile für einzelne Skills)
  expect(CATALOG.filter((c) => c.way === 'bundled').map((c) => c.name)).toEqual(['apple-design', 'emil-design-eng', 'break-ui'])
  expect(SPEC).toEqual({ model: 'claude-haiku-5-5', effort: 'low', maxTokens: 1000, timeoutMs: 4000 })
  expect(CATALOG_MIN).toBe(0.7)
  expect(CATALOG_MIN_HEAVY).toBe(0.9)
  expect(CATALOG_GAP).toBe(10)
})

test('0.31.0 Daten: die Kopien aus 0.28.0 sind Verweise mit Installationszeile und launchAs, ib-meta gestrichen, Reihenfolge', () => {
  const order = CATALOG.map((c) => c.id)
  // E7 aus 0.28.0 bleibt: sp-debug vor sp-verify, mp-grill danach, alle vor den übrigen Verweisen
  expect(order.slice(3, 7)).toEqual(['sp-debug', 'sp-verify', 'sp-review', 'mp-grill'])
  expect(byId('ib-meta')).toBeUndefined()
  for (const id of ['sp-debug', 'sp-verify', 'sp-review']) {
    expect(byId(id)).toMatchObject({ repo: 'obra/superpowers', license: 'MIT', pinnedSha: '22f0b463e7a5e579904dd6211a520321035526f7', way: 'reference', kind: 'skill' })
    expect(byId(id)!.install).toEqual({ line: '/plugin install superpowers@claude-plugins-official' })
    expect(byId(id)!.installedAs).toContain('superpowers')
    expect(byId(id)!.launchAs).toEqual([byId(id)!.name])
  }
  expect(byId('mp-grill')).toMatchObject({ repo: 'mattpocock/skills', way: 'reference', install: { line: 'claude plugin install mattpocock-skills@claude-plugins-official' }, launchAs: ['grilling', 'grill-me'], installedAs: ['grilling', 'grill-me', 'mattpocock-skills'], yieldTo: ['*grill*'] })
  expect(byId('sp-debug')!.yieldTo).toEqual(['*debug*'])
  expect(byId('sp-debug')!.minSure).toBe(0.6)
  for (const c of CATALOG) {
    // Kein Verweis trägt Daten einer Kopie; launchAs nur bei Verweisen
    if (c.way === 'reference') {
      expect(c.invoke).toBeUndefined()
      expect(c.ctxTokens).toBeUndefined()
    } else expect(c.launchAs).toBeUndefined()
    expect('ctxNote' in c).toBe(false)
  }
  expect(CATALOG.filter((c) => c.launchAs).map((c) => c.id)).toEqual(['sp-debug', 'sp-verify', 'sp-review', 'mp-grill'])
})

test('0.31.0 launchOf und catalogKind: Original installiert → run mit vollem Namen, sonst nur Zeile; eigene und eingebaute zählen nicht', () => {
  const sp = byId('sp-debug')!
  const plug = [{ name: 'superpowers:systematic-debugging', source: 'plugin', plugin: 'superpowers' }]
  expect(launchOf(sp, plug)).toBe('superpowers:systematic-debugging')
  expect(launchOf(sp, [{ name: 'systematic-debugging', source: 'user' }])).toBe('systematic-debugging')
  // Nur das Plugin bekannt, ohne den Skill als Befehl: installiert, aber nicht startbar
  expect(launchOf(sp, [{ name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers' }])).toBe('')
  expect(launchOf(sp, [{ name: 'sidekick:systematic-debugging', source: 'plugin', plugin: 'sidekick' }])).toBe('')
  expect(launchOf(sp, [{ name: 'systematic-debugging', source: 'builtin' }])).toBe('')
  expect(launchOf(byId('mp-grill')!, [{ name: 'mattpocock-skills:grill-me', source: 'plugin', plugin: 'mattpocock-skills' }])).toBe('mattpocock-skills:grill-me')
  expect(launchOf(byId('gsap')!, plug)).toBe('')
  expect(catalogKind(sp, 'superpowers:systematic-debugging')).toBe('run')
  expect(catalogKind(sp)).toBe('line')
  expect(catalogKind(byId('emil-apple')!)).toBe('skill')
  expect(catalogKind(byId('gsap')!)).toBe('copy')
  // Vorfilter: installiertes Original bleibt Kandidat; das Original selbst stellt den Eintrag nicht zurück (*debug*, *grill*)
  expect(ids(findCandidates('Der Build geht nicht, warum?', { ...none, cmds: plug }))).toEqual(['sp-debug'])
  expect(yieldedTo(sp, plug)).toBe('')
  expect(yieldedTo(byId('mp-grill')!, [{ name: 'mattpocock-skills:grilling', source: 'plugin' }])).toBe('')
  // Nur das Plugin ohne startbaren Skill: wie installiert, kein Kandidat
  expect(ids(findCandidates('Der Build geht nicht, warum?', { ...none, cmds: [{ name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers' }] }))).toEqual([])
  // Projekt-Befehl hat weiter Vorrang
  expect(ids(findCandidates('Der Build geht nicht, warum?', { ...none, cmds: [...plug, { name: 'mod-debug', source: 'user' }] }))).toEqual([])
})

// ---------- Ausbau 0.28.0: Vorfilter der neuen Einträge ----------

deTest('0.28.0/0.31.0 Vorfilter: Treffer de/en je Eintrag aus 0.28.0', () => {
  // Sicht-Check 1 und 3 der SPEC
  expect(ids(findCandidates('Der Build geht nicht, warum?', none))).toEqual(['sp-debug'])
  expect(ids(findCandidates('Der Build geht nicht mehr, kannst du schauen?', none))).toEqual(['sp-debug'])
  expect(ids(findCandidates('The export still fails with a stack trace', none))).toEqual(['sp-debug'])
  expect(ids(findCandidates('Finde bitte heraus, woran es liegt, dass der Export hängt', none))).toEqual(['sp-debug'])
  expect(ids(findCandidates('Ist es fertig, und läuft der Export jetzt wirklich?', none))).toEqual(['sp-verify'])
  expect(ids(findCandidates('Did you test the export with real data?', none))).toEqual(['sp-verify'])
  expect(ids(findCandidates('Setz bitte die Review-Kommentare zum Export um', none))).toEqual(['sp-review'])
  expect(ids(findCandidates('Please address the review on the export branch', none))).toEqual(['sp-review'])
  // 0.31.0: ib-meta gestrichen (keine Installationszeile im README des Originals)
  expect(ids(findCandidates('Mach Meta-Tags und OG-Bild für die Startseite', none))).toEqual([])
  expect(ids(findCandidates('Ich habe eine Idee für ein neues Feature', none))).toEqual(['mp-grill'])
  expect(ids(findCandidates('Grill me about the plan for the sync feature', none))).toEqual(['mp-grill'])
  expect(ids(findCandidates('Das müssen wir klären, bevor Code entsteht', none))).toEqual(['mp-grill'])
})

deTest('0.28.0 Vorfilter: yieldTo, superpowers installiert, Verweise superpowers und mattpocock entschärft', () => {
  const BUG = 'Der Export geht nicht mehr, kannst du schauen?'
  // E5: /mod-debug hat Vorrang; sidekicks eigene Kopie zählt nicht
  expect(findCandidates(BUG, { cmds: [{ name: 'mod-debug' }], muted: [], offered: [] })).toEqual([])
  expect(ids(findCandidates(BUG, { cmds: [{ name: 'sidekick:systematic-debugging', plugin: 'sidekick' }], muted: [], offered: [] }))).toEqual(['sp-debug'])
  expect(yieldedTo(byId('sp-debug')!, [{ name: 'mod-debug' }])).toBe('/mod-debug')
  expect(yieldedTo(byId('sp-debug')!, [{ name: 'MOD-Debug' }])).toBe('/MOD-Debug')
  expect(yieldedTo(byId('sp-debug')!, [{ name: 'sidekick:systematic-debugging', plugin: 'sidekick' }])).toBe('')
  expect(yieldedTo(byId('sp-verify')!, [{ name: 'mod-debug' }])).toBe('')
  // E6: Plugin superpowers installiert, aber ohne den Skill als Befehl → keiner der drei (0.31.0: mit Skill → startbar, eigener Test)
  const sp = [{ name: 'superpowers:brainstorming', plugin: 'superpowers' }]
  for (const id of ['sp-debug', 'sp-verify', 'sp-review']) expect(isInstalled(byId(id)!, sp)).toBe(true)
  expect(findCandidates(BUG, { cmds: sp, muted: [], offered: [] })).toEqual([])
  // E6: der Verweis superpowers trifft „tdd“ und „systematisch debuggen“ nicht mehr, „brainstorm“ weiter
  expect(findCandidates('Lass uns das mit TDD und testgetrieben angehen', none)).toEqual([])
  expect(ids(findCandidates('Lass uns zuerst ein Brainstorming zum Menü machen', none))).toEqual(['superpowers'])
  // E9: Grill-Stichwörter bei mp-grill, Tickets weiter beim Verweis; mattpocock installiert → kein mp-grill
  expect(ids(findCandidates('Löchere mich zu dem Plan für den Export', none))).toEqual(['mp-grill'])
  expect(ids(findCandidates('Mach daraus Tickets für das nächste Release', none))).toEqual(['mattpocock'])
  expect(findCandidates('Löchere mich zu dem Plan für den Export', { cmds: [{ name: 'mattpocock-skills:to-prd', plugin: 'mattpocock-skills' }], muted: [], offered: [] })).toEqual([])
  // 0.31.0 (E2): ein loser Skill grill-me ist das startbare Original, der Eintrag bleibt Kandidat
  expect(ids(findCandidates('Grill me about the plan for the sync feature', { cmds: [{ name: 'grill-me' }], muted: [], offered: [] }))).toEqual(['mp-grill'])
})

deTest('0.31.0 skillContext: Kopf, Verzeichnis, $ARGUMENTS; ohne Hinweis (ctxNote entfällt)', () => {
  const body = '---\n# From emilkowalski/skills@x\nname: break-ui\ndisable-model-invocation: true\n---\nBreak $ARGUMENTS'
  const de = skillContext(body, '/r/skills/break-ui', byId('emil-break')!, 'die Liste')
  expect(de.split('\n')).toEqual([expect.stringContaining('sidekick:break-ui'), '', 'Base directory for this skill: /r/skills/break-ui', '', 'Break die Liste'])
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

function world(on: On, o: { surfaces?: string[]; cmds?: { name: string; plugin?: string; source?: string; description?: string }[]; copyFails?: boolean; readFails?: boolean; trigger?: boolean; runFails?: boolean; muteFails?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  const asks: { question: string; options: string[]; header?: string }[] = []
  let answer: string | null = null
  const copies: string[] = []
  const reads: string[] = []
  const runs: { command: string; args?: string }[] = []
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
    if (o.muteFails && e.key === 'catalog:muted') throw new Error('voll')
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
  // Desktop zeichnet ein eigenes Eingabefeld (no_composer), wie chat.test.ts
  on('prompt.fill', () => ({ isFilled: false, refusal: 'no_composer' }) as never)
  on('fs.read', ($, e) => {
    reads.push(e.path)
    if (o.readFails) throw new Error('ENOENT')
    return { value: '---\n# From emilkowalski/skills@x\nname: apple-design\ndisable-model-invocation: true\n---\n\n# Apple Design\nSKILL-BODY' }
  })
  // Ausbau 0.31.0: Start des installierten Originals (Probe P1, Weg A)
  on('command.run', ($, e) => {
    runs.push({ command: e.command, args: e.args })
    if (o.runFails) throw new Error('no session')
    return {} as never
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
    runs,
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
  expect(md).toContain('| `earshot` earshot | Leon Lin | MIT | MCP, Verweis, nur Hinweis, Python, ≈ 1 GB Modelle | installiert |')
  expect(md).toContain('| `emil-animate` animate, review-animations | Emil Kowalski | MIT | Skill, Verweis, npx, ungepinnt | aktiv |')
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

// ---------- Ausbau 0.28.0: Hooks ----------

deTest('0.31.0 /sidekick catalog: Verweise aus 0.28.0; Spalte Weg „zurückgestellt: /mod-debug“ bzw. „startet /…“; ohne Skill-Befehl → installiert', async ($, on) => {
  const w = world(on, { cmds: [{ name: 'mod-debug', source: 'projectSettings' }, { name: 'superpowers:brainstorming', plugin: 'superpowers' }, { name: 'mattpocock-skills:grilling', plugin: 'mattpocock-skills' }] })
  await start($)
  const md = await run($, 'catalog')
  expect(md).toContain('| `sp-debug` systematic-debugging | Jesse Vincent | MIT | Skill, Verweis, zurückgestellt: /mod-debug, ganzes Plugin superpowers mit Hooks | installiert |')
  expect(md).toContain('| `mp-grill` grilling | Matt Pocock | MIT | Skill, Verweis, startet /mattpocock-skills:grilling, ganzes Plugin, einige Skripte | installiert |')
  expect(md).not.toContain('ib-meta')
  expect(md).not.toContain('/sidekick:verification-before-completion')
  expect(md).toContain('- `sp-verify`: `/plugin install superpowers@claude-plugins-official`')
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'desktop', props: { command: 'sidekick', args: 'catalog', text: md, isErrored: false } } as never)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-cat-sp-debug' }))).toContain('zurückgestellt: /mod-debug')
  await ui.unmount()
  expect(w.copies).toEqual([])
})

deTest('0.31.0 /sidekick catalog: zurückgestellt bleibt aktiv (nicht installiert)', async ($, on) => {
  world(on, { cmds: [{ name: 'mod-debug' }] })
  await start($)
  expect(await run($, 'catalog')).toContain('| `sp-debug` systematic-debugging | Jesse Vincent | MIT | Skill, Verweis, zurückgestellt: /mod-debug, ganzes Plugin superpowers mit Hooks | aktiv |')
})
test('0.31.0 /sidekick catalog englisch: „deferred to /mod-debug“', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  world(on, { cmds: [{ name: 'mod-debug' }] })
  await start($)
  expect(await run($, 'catalog')).toContain('| `sp-debug` systematic-debugging | Jesse Vincent | MIT | skill, reference, deferred to /mod-debug, whole superpowers plugin, with hooks | active |')
  setLang('de')
})

const SP_CMD = { name: 'superpowers:systematic-debugging', source: 'plugin', plugin: 'superpowers' }

deTest('0.31.0: Original installiert → Rückfrage nennt den Befehl; „Mit … senden“ hält an und startet das Original mit der Nachricht', async ($, on) => {
  const w = world(on, { cmds: [SP_CMD] })
  await start($)
  w.setReply('{"id":"sp-debug","sicher":0.8,"grund":"Ursache vor dem Fix"}')
  w.setAnswer(X.optWith('systematic-debugging') + rec)
  const r = await send($, 'Der Build geht nicht, warum?')
  expect(w.asks[0]!.question).toBe(X.askRun('systematic-debugging', 'Jesse Vincent', 'MIT', 'Ursache vor dem Fix', 'superpowers:systematic-debugging'))
  expect(w.asks[0]!.options).toEqual([X.optWith('systematic-debugging') + rec, X.optSend, X.optMute])
  expect(r.drop).toBe(X.dropRun('superpowers:systematic-debugging'))
  // Kein Einlesen einer Kopie, Start erst im Timer (aus prompt.submit lehnt der Host ab)
  expect(w.reads).toEqual([])
  expect(w.runs).toEqual([])
  await w.clock.advance(100)
  await flush()
  expect(w.runs).toEqual([{ command: 'superpowers:systematic-debugging', args: 'Der Build geht nicht, warum?' }])
  expect(today(w.ledger()).katalog.mitSkill).toBe(1)
})

deTest('0.31.0: Start scheitert → Befehl samt Nachricht in der Zwischenablage, Toast; ohne Zwischenablage Toast zum Abtippen', async ($, on) => {
  const w = world(on, { cmds: [SP_CMD], runFails: true })
  await start($)
  w.setReply('{"id":"sp-debug","sicher":0.8,"grund":"Ursache"}')
  w.setAnswer(X.optWith('systematic-debugging') + rec)
  await send($, 'Der Build geht nicht, warum?')
  await w.clock.advance(100)
  await flush()
  expect(w.copies).toEqual(['/superpowers:systematic-debugging Der Build geht nicht, warum?'])
  expect(w.toasts.at(-1)).toContain('ließ sich nicht starten')
  expect(w.toasts.at(-1)).toContain('Zwischenablage')
})

deTest('0.31.0: Original installiert, aber Anhang oder @datei → keine Rückfrage, Zeile „ist installiert, starte ihn mit /…“ mit Knopf', async ($, on) => {
  const w = world(on, { cmds: [SP_CMD], surfaces: ['terminal'] })
  await start($)
  w.setReply('{"id":"sp-debug","sicher":0.8,"grund":"Ursache"}')
  w.setAnswer(X.optWith('systematic-debugging') + rec)
  const text = 'Der Build geht nicht, schau dir @src/build.ts an'
  const r = await send($, text)
  expect(w.asks).toEqual([])
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe(text)
  const { line, btn, ui } = await lineUnder($, text, 'req-att', 'terminal')
  expect(line).toContain('Dafür gibt es systematic-debugging; ist installiert, starte ihn mit /superpowers:systematic-debugging')
  expect(btn).toBeTruthy()
  await ui.unmount()
  expect(w.runs).toEqual([])
})

deTest('0.31.0: nicht installiert → keine Rückfrage, Hinweiszeile mit Installationszeile; „Stumm“ schaltet den Eintrag stumm', async ($, on) => {
  const w = world(on)
  await start($)
  w.setReply('{"id":"sp-debug","sicher":0.8,"grund":"Ursache"}')
  const text = 'Der Build geht nicht, warum?'
  const r = await send($, text)
  expect(w.asks).toEqual([])
  expect(r.drop).toBeUndefined()
  const { line, ui } = await lineUnder($, text, 'req-line')
  expect(line).toContain('Dafür gibt es systematic-debugging von Jesse Vincent (MIT, ganzes Plugin superpowers mit Hooks): Ursache')
  expect(JSON.stringify(await ui.find({ key: 'sidekick-use' }))).toContain(T.de.btnCopy)
  await ui.press({ key: 'sidekick-use' })
  await flush()
  expect(w.copies).toEqual(['/plugin install superpowers@claude-plugins-official'])
  await ui.press({ key: 'sidekick-mute' })
  await flush()
  expect(w.store.get('catalog:muted')).toEqual(['sp-debug'])
  expect(w.toasts.at(-1)).toBe(X.muted('systematic-debugging'))
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'sidekick', component: 'UserMessage', requestId: 'req-line', surface: 'desktop', props: { text, origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(await again.find({ key: 'sidekick-mute' })).toBeFalsy()
  expect(JSON.stringify(await again.find({ key: 'sidekick-line' }))).toContain(X.btnMuted)
  await again.unmount()
  expect(today(w.ledger()).katalog.stumm).toBe(1)
})

deTest('Review 0.31.0 S2: „Stumm“ an der Zeile scheitert → Toast mit Grund, Knopf bleibt', async ($, on) => {
  const w = world(on, { muteFails: true })
  await start($)
  w.setReply('{"id":"sp-debug","sicher":0.8,"grund":"Ursache"}')
  const text = 'Der Build geht nicht, warum?'
  await send($, text)
  const { ui } = await lineUnder($, text, 'req-mutefail')
  await ui.press({ key: 'sidekick-mute' })
  await flush()
  expect(w.toasts.at(-1)).toContain('Stumm schalten ging nicht')
  expect(await ui.find({ key: 'sidekick-mute' })).toBeTruthy()
  await ui.unmount()
})

deTest('0.31.0 Sicht-Check (Idee): grilling installiert über mattpocock → Rückfrage und Start von /mattpocock-skills:grilling', async ($, on) => {
  const w = world(on, { cmds: [{ name: 'mattpocock-skills:grilling', plugin: 'mattpocock-skills' }] })
  await start($)
  w.setReply('{"id":"mp-grill","sicher":0.8,"grund":"Plan Schritt für Schritt klären"}')
  w.setAnswer(X.optWith('grilling') + rec)
  const r = await send($, 'Ich habe eine Idee für ein neues Feature im Menü')
  expect(w.asks[0]!.question).toContain('installiert als /mattpocock-skills:grilling')
  expect(r.drop).toBe(X.dropRun('mattpocock-skills:grilling'))
  await w.clock.advance(100)
  await flush()
  expect(w.runs).toEqual([{ command: 'mattpocock-skills:grilling', args: 'Ich habe eine Idee für ein neues Feature im Menü' }])
})

deTest('0.31.0: „Trotzdem senden“ und „Nicht mehr vorschlagen“ bei installiertem Original wie bisher; Englisch', async ($, on) => {
  const w = world(on, { cmds: [SP_CMD] })
  await start($)
  w.setReply('{"id":"sp-debug","sicher":0.8,"grund":"Ursache"}')
  w.setAnswer(X.optMute)
  const r = await send($, 'Der Build geht nicht, warum?')
  expect(r.text).toBe('Der Build geht nicht, warum?')
  expect(w.store.get('catalog:muted')).toEqual(['sp-debug'])
  await w.clock.advance(100)
  await flush()
  expect(w.runs).toEqual([])
  setLang('en')
  expect(T.en.cat.askRun('grilling', 'Matt Pocock', 'MIT', 'x', 'mattpocock-skills:grilling')).toContain('installed as /mattpocock-skills:grilling')
  expect(T.en.cat.dropRun('a:b')).toBe('sidekick: starting /a:b with your message.')
  setLang('de')
})

deTest('0.28.0: „Mach daraus Tickets“ → weiter der Verweis mattpocock (Befehl kopieren); /mod-debug in der Liste → kein sp-debug, kein Haiku', async ($, on) => {
  const w = world(on, { cmds: [{ name: 'mod-debug' }] })
  await start($)
  w.setReply('{"id":"mattpocock","sicher":0.8,"grund":"Plan in Tickets"}')
  w.setAnswer(X.optCopy + rec)
  const r = await send($, 'Mach daraus Tickets für das nächste Release')
  expect(w.asks[0]!.question).toContain('*mattpocock-skills*')
  expect(w.copies).toEqual(['claude plugin install mattpocock-skills@claude-plugins-official'])
  expect(r.drop).toContain('In einem Terminal ausführen')
  const calls = w.catCalls.length
  await send($, 'Der Mod geht nicht, ich weiß nicht warum')
  expect(w.catCalls.length).toBe(calls)
})

deTest('0.28.0 Schwelle je Eintrag: sp-debug ab 0,6 (Probe P2\', Entscheidung (b)), die anderen weiter ab 0,7', () => {
  const dbg = [byId('sp-debug')!, byId('sp-verify')!]
  expect(byId('sp-debug')!.minSure).toBe(0.6)
  expect(CATALOG.filter((c) => c.minSure !== undefined).map((c) => c.id)).toEqual(['sp-debug'])
  expect(catalogPick({ id: 'sp-debug', sicher: 0.6, grund: '' }, dbg)?.id).toBe('sp-debug')
  expect(catalogPick({ id: 'sp-debug', sicher: 0.59, grund: '' }, dbg)).toBe(null)
  expect(catalogPick({ id: 'sp-verify', sicher: 0.65, grund: '' }, dbg)).toBe(null)
  expect(catalogPick({ id: 'sp-verify', sicher: 0.7, grund: '' }, dbg)?.id).toBe('sp-verify')
})

// ---------- Review 0.28.0 ----------

deTest('Review 0.28.0 S1/K1: eingebautes /debug stellt sp-debug nicht zurück; eigene Kopie ohne plugin-Feld zählt nicht als installiert', () => {
  const BUG = 'Der Export geht nicht mehr, kannst du schauen?'
  const builtin = [{ name: 'debug', source: 'builtin' }]
  expect(yieldedTo(byId('sp-debug')!, builtin)).toBe('')
  expect(ids(findCandidates(BUG, { cmds: builtin, muted: [], offered: [] }))).toEqual(['sp-debug'])
  // ein Benutzer- oder Projekt-Befehl gleichen Namens zählt weiter
  expect(yieldedTo(byId('sp-debug')!, [{ name: 'debug', source: 'projectSettings' }])).toBe('/debug')
  expect(isInstalled(byId('sp-debug')!, [{ name: 'sidekick:systematic-debugging' }])).toBe(false)
  expect(yieldedTo(byId('sp-debug')!, [{ name: 'sidekick:systematic-debugging' }])).toBe('')
})

deTest('Review 0.28.0 S1/K5: /sidekick catalog mit eingebautem /debug → sp-debug aktiv; im Terminal „zurückgestellt“ bei /mod-debug', async ($, on) => {
  world(on, { cmds: [{ name: 'debug', source: 'builtin' }], surfaces: ['terminal'] })
  await start($)
  const md = await run($, 'catalog')
  expect(md).toContain('| `sp-debug` systematic-debugging | Jesse Vincent | MIT | Skill, Verweis, ganzes Plugin superpowers mit Hooks | aktiv |')
})
deTest('Review 0.28.0 K5: Terminal zeigt „zurückgestellt: /mod-debug“', async ($, on) => {
  world(on, { cmds: [{ name: 'mod-debug' }], surfaces: ['terminal'] })
  await start($)
  const md = await run($, 'catalog')
  const ui = await $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface: 'terminal', props: { command: 'sidekick', args: 'catalog', text: md, isErrored: false } } as never)
  expect(JSON.stringify(await ui.find({ key: 'sidekick-cat-sp-debug' }))).toContain('zurückgestellt: /mod-debug')
  await ui.unmount()
})
