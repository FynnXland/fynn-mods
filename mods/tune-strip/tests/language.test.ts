// language.test.ts: Tests für hooks/language.ts (docs/LANGUAGE-SPEC.md §7). Vorlage templates/language/, als
// tests/language.test.ts in jede Mod kopiert; nur SELF und CMD unten werden je Mod angepasst. Läuft über den echten
// Hauptbefehl der Mod (das `$` des Tests hat kein `$.config`), `$.config.list` und `$.config.set` per Stub.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { FYNN_MODS, LANGUAGES, installedMods, isLanguage, languageHelp } from '../hooks/language.ts'

// ---- je Mod anpassen ----
const SELF = 'tune-strip'
const CMD = 'tune'
// -------------------------

const OTHERS = FYNN_MODS.filter((m) => m !== SELF)
const OTHER = OTHERS[0]!
const DE = { options: { language: 'de' } } as const
const EN = { options: { language: 'en' } } as const

type Row = { key: string; label: string; kind: string; value: unknown; options?: string[]; provider: { plugin: string; tier: string }; isLocked: boolean }

const row = (mod: string, field: string, value: unknown, o: { owner?: string; locked?: boolean; options?: string[] } = {}): Row => ({
  key: `${mod}.${field}`,
  label: field,
  kind: field === 'language' ? 'choice' : 'text',
  value,
  ...(field === 'language' ? { options: o.options ?? ['en', 'de'] } : {}),
  provider: { plugin: o.owner ?? `${mod}@fynn-mods`, tier: 'user' },
  isLocked: o.locked ?? false,
})
const engineRow: Row = { key: 'language', label: 'Language', kind: 'text', value: 'Default (English)', provider: { plugin: 'engine', tier: 'core' }, isLocked: false }

/** Alle sechs Mods mit `value`, dazu Fremdes: Sprache der Engine, fremdes Plugin mit `language`, andere Felder, fremder Besitzer. */
const all = (value: string): Row[] => [
  engineRow,
  ...FYNN_MODS.map((m) => row(m, 'language', value)),
  row(SELF, 'other', 'x'),
  row('other-plugin', 'language', value, { owner: 'other-plugin@somewhere' }),
  row(OTHER, 'language', value, { owner: `not-${OTHER}@x` }), // gleicher Schlüssel, fremder Besitzer: zählt nicht
]

type World = {
  sets: { key: string; value: unknown }[]
  rows: Row[]
  lists: number
  listFails: boolean
  deny: Record<string, string>
  throws: Record<string, string>
  // Weg 2 (`claude plugin`, LANGUAGE-SPEC §10): Standard „claude nicht aufrufbar“
  cliDeny: string
  listed: unknown
  listExit: number
  values: Record<string, string>
  refuse: Record<string, string>
  runs: { argv: string[]; stdin?: string }[]
}

const proc = (stdout: string, stderr = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

function world(on: On, rows: Row[]): World {
  const w: World = { sets: [], rows, lists: 0, listFails: false, deny: {}, throws: {}, cliDeny: 'spawn claude ENOENT', listed: [], listExit: 0, values: {}, refuse: {}, runs: [] }
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.runs.push({ argv, ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }) })
    if (w.cliDeny) return { deny: w.cliDeny }
    const cmd = argv.join(' ')
    if (cmd === 'claude plugin list --json') return w.listExit ? proc('', 'list kaputt', w.listExit) : proc(JSON.stringify(w.listed))
    const m = /^claude plugin configure ([a-z-]+)@fynn-mods (--json|--values-stdin --json)$/.exec(cmd)
    if (!m) return proc('', `unerwarteter Aufruf: ${cmd}`, 9)
    const mod = m[1]!
    if (m[2] === '--json') return proc(JSON.stringify({ pluginId: `${mod}@fynn-mods`, inputs: { language: w.values[mod] ?? '' }, schema: { language: { default: 'en' } } }))
    if (w.refuse[mod]) return proc(JSON.stringify({ refused: { message: w.refuse[mod], option: 'language' } }), 'Failed to save configuration: …', 1)
    w.values[mod] = (JSON.parse(e.init?.stdin ?? '{}') as { language: string }).language
    return proc(JSON.stringify({ saved: ['language'] }))
  })
  // Fehler per `{ deny }`: lässt den Aufruf in der Mod mit dem Grund scheitern; ein werfender Stub gilt dagegen als
  // „übersprungen“ und kommt als „no implementation for …“ an (docs/raw/en/test.md:187)
  on('config.list', () => {
    w.lists++
    if (w.listFails) return { deny: 'kaputt' }
    return { value: JSON.parse(JSON.stringify(w.rows)) }
  })
  on('config.set', ($, e) => {
    w.sets.push({ key: e.key, value: e.value })
    if (w.throws[e.key]) throw new Error(w.throws[e.key])
    if (w.deny[e.key]) return { deny: w.deny[e.key]! }
    return { value: e.value }
  })
  return w
}

const run = async ($: any, args: string) => (await $.command.run({ command: CMD, args })).text as string
const line = (mod: string, what: string) => `- ${mod}: ${what}`
const APPLIED_EN = 'Applies now, the mods were reloaded. Other open chats pick it up at their next start at the latest.'
const APPLIED_DE = 'Gilt sofort, die Mods wurden neu geladen. Andere offene Chats spätestens beim nächsten Start.'

test('language: isLanguage nur am ersten Wort, Groß- und Kleinschreibung egal', () => {
  expect(isLanguage('language')).toBe(true)
  expect(isLanguage('  LANGUAGE de')).toBe(true)
  expect(isLanguage('Language en')).toBe(true)
  expect(isLanguage('languages')).toBe(false)
  expect(isLanguage('help language')).toBe(false)
  expect(isLanguage('')).toBe(false)
  expect(LANGUAGES).toEqual(['en', 'de'])
  expect(FYNN_MODS).toContain(SELF)
})

test('language: Hilfezeile in en und de', () => {
  expect(languageHelp(CMD, 'en')).toEqual({ cmd: `/${CMD} language de|en`, does: 'Switch the language of all fynn-mods' })
  expect(languageHelp(CMD, 'de')).toEqual({ cmd: `/${CMD} language de|en`, does: 'Sprache aller fynn-mods umstellen' })
})

test('language en: setzt alle sechs, die eigene zuletzt; Fremdes und andere Felder bleiben in Ruhe; Antwort englisch', DE, async ($, on) => {
  const w = world(on, all('de'))
  const text = await run($, 'language en')
  expect(w.sets.map((s) => s.key)).toEqual([...OTHERS, SELF].map((m) => `${m}.language`))
  expect(w.sets.every((s) => s.value === 'en')).toBe(true)
  expect(text).toBe(['**fynn-mods · Language: English**', '', ...FYNN_MODS.map((m) => line(m, 'en ✓')), '', APPLIED_EN].join('\n'))
})

test('language de aus englischer Mod: Antwort deutsch', EN, async ($, on) => {
  world(on, all('en'))
  const text = await run($, 'language de')
  expect(text).toBe(['**fynn-mods · Sprache: Deutsch**', '', ...FYNN_MODS.map((m) => line(m, 'de ✓')), '', APPLIED_DE].join('\n'))
})

test('language: nur ein Teil installiert (eigene per --plugin-dir): nur diese erscheinen und werden gesetzt', DE, async ($, on) => {
  const w = world(on, [engineRow, row(SELF, 'language', 'de', { owner: `${SELF}@inline` }), row(OTHER, 'language', 'de')])
  const text = await run($, 'language en')
  expect(w.sets.map((s) => s.key)).toEqual([`${OTHER}.language`, `${SELF}.language`])
  const shown = FYNN_MODS.filter((m) => m === SELF || m === OTHER)
  expect(text).toBe(['**fynn-mods · Language: English**', '', ...shown.map((m) => line(m, 'en ✓')), '', APPLIED_EN].join('\n'))
})

test('language: Zeile mit dem Schlüssel einer fynn-mod, aber fremdem Besitzer → wird nicht gesetzt und nicht gezeigt', DE, async ($, on) => {
  // Allein, ohne die echte Zeile davor: Sonst überspränge sie schon die Doppelprüfung (Review S1)
  const w = world(on, [row(OTHER, 'language', 'de', { owner: `not-${OTHER}@x` }), row(SELF, 'language', 'de')])
  const text = await run($, 'language en')
  expect(w.sets.map((s) => s.key)).toEqual([`${SELF}.language`])
  expect(text).not.toContain(OTHER)
})

test('language: Wert schon gleich → kein set, „(war schon)“; alle gleich → „Überall schon eingestellt.“', EN, async ($, on) => {
  const w = world(on, [row(OTHER, 'language', 'de'), row(SELF, 'language', 'en')])
  const text = await run($, 'language de')
  expect(w.sets.map((s) => s.key)).toEqual([`${SELF}.language`])
  expect(text).toContain(line(OTHER, 'de ✓ (war schon)'))
  expect(text).toContain(line(SELF, 'de ✓'))
  expect(text.split('\n').at(-1)).toBe(APPLIED_DE)
  w.rows = [row(OTHER, 'language', 'de'), row(SELF, 'language', 'de')]
  w.sets.length = 0
  const again = await run($, 'LANGUAGE DE')
  expect(w.sets).toEqual([])
  expect(again.split('\n').at(-1)).toBe('Überall schon eingestellt.')
})

test('language: gesperrte Zeile und nicht angebotener Wert → kein set, eigene Zeile; die anderen laufen weiter', DE, async ($, on) => {
  const w = world(on, [row(OTHERS[0]!, 'language', 'en', { locked: true }), row(OTHERS[1]!, 'language', 'en', { options: ['en'] }), row(SELF, 'language', 'en')])
  const text = await run($, 'language de')
  expect(w.sets.map((s) => s.key)).toEqual([`${SELF}.language`])
  expect(text).toContain(line(OTHERS[0]!, 'gesperrt (verwaltete Einstellung)'))
  expect(text).toContain(line(OTHERS[1]!, 'abgelehnt: Wert wird nicht angeboten'))
  expect(text).toContain(line(SELF, 'de ✓'))
})

test('language: abgelehnter oder werfender set → Zeile nennt die Mod, die anderen laufen weiter', DE, async ($, on) => {
  const w = world(on, all('en'))
  w.deny[`${OTHERS[0]}.language`] = 'nicht jetzt'
  w.throws[`${OTHERS[1]}.language`] = 'Schreiben fehlgeschlagen'
  const text = await run($, 'language de')
  expect(w.sets).toHaveLength(6)
  // Im Test-Kit lässt ein `deny`-Stub den Aufruf werfen (docs/raw/en/test.md:187); in einer Session kommt `{ deny }` zurück
  expect(text).toMatch(new RegExp(`^- ${OTHERS[0]}: (abgelehnt|Fehler): .*nicht jetzt`, 'm'))
  expect(text).toMatch(new RegExp(`^- ${OTHERS[1]}: Fehler: `, 'm'))
  for (const m of [...OTHERS.slice(2), SELF]) expect(text).toContain(line(m, 'de ✓'))
  expect(text.split('\n').at(-1)).toBe(APPLIED_DE)
})

test('language: alles fehlgeschlagen → keine „gilt sofort“-Zeile', DE, async ($, on) => {
  const w = world(on, [row(SELF, 'language', 'en')])
  w.deny[`${SELF}.language`] = 'nein'
  const text = await run($, 'language de')
  expect(text).toMatch(new RegExp(`^\\*\\*fynn-mods · Sprache: Deutsch\\*\\*\\n\\n- ${SELF}: (abgelehnt|Fehler): .*nein$`))
})

test('language: $.config.list wirft → Meldung, kein set', DE, async ($, on) => {
  const w = world(on, all('de'))
  w.listFails = true
  expect(await run($, 'language en')).toMatch(/^Einstellungen nicht lesbar: .*kaputt.*\. Nichts geändert\.$/)
  expect(w.sets).toEqual([])
})

test('language: $.config.list wirft, englisch', EN, async ($, on) => {
  const w = world(on, all('de'))
  w.listFails = true
  expect(await run($, 'language')).toMatch(/^Couldn't read the settings: .*kaputt.*\. Nothing changed\.$/)
})

// ---- Weg 2: keine Plugin-Zeilen (Desktop, -p, SDK) → `claude plugin` (LANGUAGE-SPEC §10) ----

const ALLOWED = /^claude plugin (list --json|configure [a-z-]+@fynn-mods (--json|--values-stdin --json))$/
const SAVED_EN = 'Saved. Applies from the next chat; in this one right after `/reload-plugins`.'
const SAVED_DE = 'Gespeichert. Gilt ab dem nächsten Chat, in diesem sofort nach `/reload-plugins`.'
/** `claude plugin list --json`: eigene und eine weitere fynn-mod aktiv, dazu Fremdes, das nie angefasst wird. */
const LISTED = [
  { id: `${SELF}@fynn-mods`, enabled: true, hasUserConfig: true },
  { id: `${OTHERS[0]}@fynn-mods`, enabled: true, hasUserConfig: true },
  { id: `${OTHERS[1]}@fynn-mods`, enabled: false, hasUserConfig: true }, // abgeschaltet
  { id: `${OTHERS[2]}@other-market`, enabled: true, hasUserConfig: true }, // anderer Marketplace
  { id: 'foreign@fynn-mods', enabled: true, hasUserConfig: true }, // keine der sechs
]

test('language: Weg 2, installedMods nimmt nur aktivierte <mod>@fynn-mods der sechs', () => {
  expect(installedMods(LISTED)).toEqual(FYNN_MODS.filter((m) => m === SELF || m === OTHERS[0]))
  expect(installedMods(null)).toEqual([])
  expect(installedMods({ id: `${SELF}@fynn-mods` })).toEqual([])
})

test('language: Weg 2, claude nicht aufrufbar → Meldung mit Grund, nichts geändert', DE, async ($, on) => {
  const w = world(on, [engineRow, row('other-plugin', 'language', 'de', { owner: 'other-plugin@x' })])
  expect(await run($, 'language en')).toMatch(
    new RegExp(`^Hier zeigt Claude Code keine Plugin-Einstellungen, und \`claude plugin\` ließ sich nicht aufrufen \\(.*ENOENT.*\\), deshalb ist nichts geändert\\. In einer Terminal-Session: \`/${CMD} language de\`\\.$`),
  )
  expect(w.sets).toEqual([])
  expect(w.runs.map((r) => r.argv.join(' '))).toEqual(['claude plugin list --json'])
})

test('language: Weg 2, claude nicht aufrufbar, englisch; list mit Exit ≠ 0 ebenso', EN, async ($, on) => {
  const w = world(on, [engineRow])
  expect(await run($, 'language')).toMatch(/^Claude Code doesn't list plugin settings here, and `claude plugin` could not be run \(.*ENOENT.*\), so nothing changed\./)
  w.cliDeny = ''
  w.listExit = 2
  expect(await run($, 'language de')).toMatch(/could not be run \(list kaputt\)/)
})

test('language: Weg 2, keine fynn-mod in der Liste → Meldung, nichts geschrieben', DE, async ($, on) => {
  const w = world(on, [engineRow])
  w.cliDeny = ''
  w.listed = [{ id: 'foreign@fynn-mods', enabled: true }]
  expect(await run($, 'language en')).toBe(`In \`claude plugin list\` steht keine fynn-mod, deshalb ist nichts geändert. In einer Terminal-Session: \`/${CMD} language de\`.`)
  expect(w.runs).toHaveLength(1)
})

test('language: Weg 2 ohne Wert → aktuelle Sprache je installierter fynn-mod, nur lesende Aufrufe', DE, async ($, on) => {
  const w = world(on, [engineRow])
  w.cliDeny = ''
  w.listed = LISTED
  w.values = { [SELF]: 'de' } // OTHERS[0] nie gesetzt → Standard aus dem Schema
  const shown = FYNN_MODS.filter((m) => m === SELF || m === OTHERS[0])
  expect(await run($, 'language')).toBe(
    ['**fynn-mods · Sprache**', '', ...shown.map((m) => line(m, m === SELF ? 'de' : 'en')), '', `Umstellen: \`/${CMD} language de|en\``].join('\n'),
  )
  expect(w.runs.every((r) => ALLOWED.test(r.argv.join(' ')) && !r.argv.includes('--values-stdin'))).toBe(true)
})

test('language: Weg 2 setzt nur installierte fynn-mods, eigene zuletzt, nur erlaubte Aufrufe; Antwort englisch', DE, async ($, on) => {
  const w = world(on, [engineRow])
  w.cliDeny = ''
  w.listed = [...LISTED, { id: `${OTHERS[3]}@fynn-mods`, enabled: true, hasUserConfig: true }]
  w.values = { [SELF]: 'de', [OTHERS[0]!]: 'de', [OTHERS[3]!]: 'en' }
  const text = await run($, 'language en')
  const writes = w.runs.filter((r) => r.argv.includes('--values-stdin'))
  expect(writes.map((r) => r.argv[3])).toEqual([`${OTHERS[0]}@fynn-mods`, `${SELF}@fynn-mods`]) // OTHERS[3] war schon en
  expect(writes.every((r) => r.stdin === '{"language":"en"}')).toBe(true)
  expect(w.runs.every((r) => ALLOWED.test(r.argv.join(' ')))).toBe(true)
  expect(w.sets).toEqual([])
  const shown = FYNN_MODS.filter((m) => m === SELF || m === OTHERS[0] || m === OTHERS[3])
  expect(text).toBe(
    ['**fynn-mods · Language: English**', '', ...shown.map((m) => line(m, m === OTHERS[3] ? 'en ✓ (already)' : 'en ✓')), '', SAVED_EN].join('\n'),
  )
})

test('language: Weg 2, abgelehnter Wert → Zeile mit dem Grund aus --json, die anderen laufen weiter', EN, async ($, on) => {
  const w = world(on, [engineRow])
  w.cliDeny = ''
  w.listed = LISTED
  w.values = { [SELF]: 'en', [OTHERS[0]!]: 'en' }
  w.refuse = { [OTHERS[0]!]: 'Option "language" must be one of: en, de' }
  const text = await run($, 'language de')
  expect(text).toContain(line(OTHERS[0]!, 'abgelehnt: Option "language" must be one of: en, de'))
  expect(text).toContain(line(SELF, 'de ✓'))
  expect(text.split('\n').at(-1)).toBe(SAVED_DE)
})

test('language: unbekannter Wert und zu viele Wörter → Meldung mit gültigen Werten, nichts gelesen', DE, async ($, on) => {
  const w = world(on, all('de'))
  expect(await run($, 'language fr')).toBe(`Unbekannte Sprache „fr“. Gültig: \`/${CMD} language de\` oder \`/${CMD} language en\`.`)
  expect(await run($, 'Language de en')).toBe(`Unbekannte Sprache „de en“. Gültig: \`/${CMD} language de\` oder \`/${CMD} language en\`.`)
  expect(w.lists).toBe(0)
  expect(w.sets).toEqual([])
})

test('language: unbekannter Wert, englisch', EN, async ($, on) => {
  world(on, all('de'))
  expect(await run($, 'language deutsch')).toBe(`Unknown language “deutsch”. Valid: \`/${CMD} language de\` or \`/${CMD} language en\`.`)
})

test('language ohne Wert: aktuelle Sprache je Mod in der Sprache der Mod, nichts gesetzt', DE, async ($, on) => {
  const w = world(on, [row(OTHERS[1]!, 'language', 'en'), row(SELF, 'language', 'de'), row(OTHERS[0]!, 'language', 'de')])
  const shown = FYNN_MODS.filter((m) => m === SELF || m === OTHERS[0] || m === OTHERS[1])
  const value = (m: string) => (m === OTHERS[1] ? 'en' : 'de')
  expect(await run($, '  LANGUAGE  ')).toBe(['**fynn-mods · Sprache**', '', ...shown.map((m) => line(m, value(m))), '', `Umstellen: \`/${CMD} language de|en\``].join('\n'))
  expect(w.sets).toEqual([])
})

test('language ohne Wert, englisch', EN, async ($, on) => {
  world(on, [row(SELF, 'language', 'en')])
  expect(await run($, 'language')).toBe(['**fynn-mods · Language**', '', line(SELF, 'en'), '', `Switch: \`/${CMD} language de|en\``].join('\n'))
})
