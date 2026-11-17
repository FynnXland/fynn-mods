// Tests zum Ausbau 0.31.0: Einstellungs-Ansicht `/sidekick settings` (Gruppen, Satz, Wert, Knöpfe, ruhende Funktionen, Rückfall ohne
// Knöpfe, Schreiben über beide Wege), App-Fenster (Reihenfolge, Titel), Umzugshinweis zu den entfernten Kopien, Chat-Knopf mit Original.
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { T, setLang } from '../hooks/i18n.js'
import { SETTINGS } from '../hooks/fields.js'
import { SV_GROUPS, SV_KEYS, commandOf, dotOf, restsAt, svMarkdown } from '../hooks/settingsview.js'
import { chatButton } from '../hooks/chat.js'
import { cliStubs, written } from './cli.js'

const NOW = new Date(2026, 10, 17, 10, 0, 0).getTime()
const S = T.de.sv

function world(on: On, o: { surfaces?: string[]; rows?: () => unknown[]; saved?: Map<string, unknown>; breakRuntime?: { on: boolean } } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = o.saved ?? new Map<string, unknown>()
  const toasts: string[] = []
  const copies: string[] = []
  const cli = cliStubs(on, o.rows)
  on('session.start', () => ({ cwd: '/work' }) as never)
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['desktop']) as never }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 20000, window: 1000000 }, rateLimits: [] } as never }))
  on('session.root', () => ({ value: 'C:\\Proj' }))
  on('session.messages', () => ({ value: [] as never }))
  on('command.list', () => ({ value: [] as never }))
  on('command.register', ($, e) => ({ value: { command: e.name } as never }))
  on('store.get', ($, e) => {
    if (o.breakRuntime?.on && e.key === 'runtime') throw new Error('kaputt')
    return { value: store.get(e.key) }
  })
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
    return { value: { isCopied: true } } as never
  })
  on('state.get', () => ({ value: { value: undefined, version: 1 } }))
  const stateSets: string[] = []
  on('state.set', ($, e) => {
    stateSets.push(JSON.stringify(e))
    return { value: { isSet: true, version: 1 } }
  })
  return { clock, store, toasts, copies, cli, stateSets }
}

async function flush(rounds = 300) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
const run = async ($: Engine, args: string) => (await $.command.run({ command: 'sidekick', args, origin: { kind: 'composer' } } as never)).text ?? ''
async function start($: Engine) {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never)
  await flush()
}
const mount = async ($: Engine, text: string, surface = 'desktop') =>
  $.ui.mount({ plugin: 'sidekick', component: 'CommandOutput', surface, viewport: { columns: 100, rows: 40 }, props: { command: 'sidekick', args: 'settings', text, isErrored: false } } as never)
const json = async (ui: { find: (q: { key: string }) => Promise<unknown> }, key: string) => JSON.stringify((await ui.find({ key })) ?? null)

function deTest(name: string, a: Record<string, string | number | boolean> | (($: Engine, on: On) => unknown), b?: ($: Engine, on: On) => unknown) {
  const cfg = typeof a === 'function' ? {} : a
  const body = typeof a === 'function' ? a : b!
  test(name, { options: { language: 'de', ...cfg } }, async ($, on) => {
    setLang('de')
    return body($, on)
  })
}

// ---------- Daten ----------

test('Ansicht: jedes userConfig-Feld genau einmal, Gruppen in der Reihenfolge der SPEC, plugin.json gleiche Reihenfolge', () => {
  expect([...SV_KEYS].sort()).toEqual(Object.keys(SETTINGS).sort())
  expect(SV_KEYS.length).toBe(new Set(SV_KEYS).size)
  expect(SV_GROUPS.map((g) => g.id)).toEqual(['base', 'before', 'during', 'limits', 'lang'])
  expect(SV_GROUPS[1]!.keys).toEqual(['skills', 'catalog', 'modelTip', 'modelTipHaiku', 'modelTipAuto', 'retryLoop', 'maintenanceHints'])
  // fields.ts ist die Liste, die check-mods mit plugin.json vergleicht: gleiche Reihenfolge wie die Ansicht, Sprache zuletzt
  expect(Object.keys(SETTINGS)).toEqual([...SV_KEYS])
  for (const k of SV_KEYS)
    for (const l of ['de', 'en'] as const) {
      expect(T[l].sv.names[k]!.length > 0).toBe(true)
      expect(T[l].sv.does[k]!.length > 0).toBe(true)
    }
})

test('Ansicht: ruhende Funktionen je Stufe; Befehle je Feld', () => {
  expect(SV_KEYS.filter((k) => restsAt(k, 'guide'))).toEqual([])
  expect(SV_KEYS.filter((k) => !restsAt(k, 'cache'))).toEqual(['level', 'bigTokens', 'cacheTtl', 'language'])
  expect(SV_KEYS.filter((k) => !restsAt(k, 'off'))).toEqual(['level', 'language'])
  expect(commandOf('threshold', 80000)).toBe('/sidekick threshold 80k')
  expect(commandOf('auditMin', 2500)).toBe('/sidekick hints audit-min 2500')
  expect(commandOf('modelTipAuto', false)).toBe('/sidekick tips auto on|off')
})

test('Ampel: Schalter an grün, aus rot; Stufe Begleiter grün, Cache gelb, Aus rot; Zahlen, Lebensdauer, Sprache ohne Punkt', () => {
  expect(dotOf('queue', true)).toBe('on')
  expect(dotOf('notes', false)).toBe('off')
  expect(dotOf('level', 'guide')).toBe('on')
  expect(dotOf('level', 'cache')).toBe('mid')
  expect(dotOf('level', 'off')).toBe('off')
  expect(dotOf('threshold', 80000)).toBe('')
  expect(dotOf('cacheTtl', 'auto')).toBe('')
  expect(dotOf('language', 'de')).toBe('')
})

deTest('Ampel in der Zeichnung: ● in success (an) bzw. error (aus), Zahlen ohne Punkt', async ($, on) => {
  world(on)
  await start($)
  const ui = await mount($, await run($, 'settings'))
  const q = await json(ui, 'sidekick-set-queue')
  expect(q).toContain('"color":"success"')
  expect(q).toContain('● ')
  expect(await json(ui, 'sidekick-set-notes')).toContain('"color":"error"')
  expect(await json(ui, 'sidekick-set-threshold')).not.toContain('● ')
  await ui.unmount()
})

deTest('Markdown (de): Gruppen, je Feld Name, Wert, Befehl und Satz; nichts fehlt', () => {
  const md = svMarkdown({ ...Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, d.default])) } as never, 'guide')
  expect(md.split('\n')[0]).toBe('**sidekick · Einstellungen** · Stufe Begleiter')
  for (const g of ['Grundstufe', 'Vor dem Senden', 'Während Claude arbeitet', 'Grenzwerte', 'Sprache']) expect(md).toContain(`**${g}**`)
  expect(md.indexOf('**Vor dem Senden**')).toBeLessThan(md.indexOf('**Während Claude arbeitet**'))
  for (const k of SV_KEYS) {
    expect(md).toContain(`**${S.names[k]}**`)
    expect(md).toContain(S.does[k]!)
  }
  expect(md).toContain('- 🟢 **Warteschlange**: an · `/sidekick queue on|off`')
  expect(md).toContain('- 🔴 **Gut zu wissen**: aus · `/sidekick notes on|off`')
  expect(md).toContain('- **Prüfen ab**: 80k · `/sidekick threshold 80k`')
  // Unterpunkte des Modell-Tipps eingerückt
  expect(md).toContain('  - 🟢 **Modell-Tipp: Haiku erlauben**: an')
  expect(md).toContain(S.foot)
  expect(md).not.toContain('ruht bei')
})

// ---------- Befehl und Ansicht ----------

deTest('/sidekick settings im Desktop: Ansicht mit Knöpfen (jedes mit key), aktiver Wert mit ●, Zahlen mit „Befehl kopieren“', async ($, on) => {
  const w = world(on)
  await start($)
  const md = await run($, 'settings')
  expect(md.split('\n')[0]).toBe('**sidekick · Einstellungen** · Stufe Begleiter')
  const ui = await mount($, md)
  expect(await json(ui, 'sidekick-settings')).toContain('Vor dem Senden')
  expect(await json(ui, 'sidekick-set-queue-true')).toContain('● an')
  expect(await json(ui, 'sidekick-set-queue-false')).toContain('"aus"')
  expect(await json(ui, 'sidekick-set-level-guide')).toContain('● Begleiter')
  expect(await json(ui, 'sidekick-set-cacheTtl-auto')).toContain('● auto')
  expect(await json(ui, 'sidekick-set-language-de')).toContain('● Deutsch')
  expect(await json(ui, 'sidekick-set-threshold-copy')).toContain(S.btnCopy)
  expect(await json(ui, 'sidekick-set-threshold-true')).toBe('null')
  await ui.press({ key: 'sidekick-set-threshold-copy' })
  await flush()
  expect(w.copies).toEqual(['/sidekick threshold 80k'])
  expect(w.toasts.at(-1)).toBe(S.copied('/sidekick threshold 80k'))
  await ui.unmount()
})

deTest('Knopf schreibt über Weg 2 (claude plugin configure): Meldung „gilt sofort hier“, danach zeigt die Ansicht den neuen Wert', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await mount($, await run($, 'settings'))
  await ui.press({ key: 'sidekick-set-queue-false' })
  await flush()
  expect(written(w.cli)).toEqual({ queue: 'false' })
  // Review 0.31.0 S1: über /sidekick queue off, also mit dessen Meldung und dem Schreiben von sidekick.status für prompt-deck
  expect(w.toasts.at(-1)).toContain(T.de.q.set(false))
  expect(w.toasts.at(-1)).toContain('Gespeichert. Gilt in diesem Chat sofort')
  expect(w.stateSets.some((x) => x.includes('"status"'))).toBe(true)
  await ui.unmount()
  const again = await mount($, await run($, 'settings'))
  expect(await json(again, 'sidekick-set-queue-false')).toContain('● aus')
  await again.unmount()
  // Schon so: kein zweites Schreiben
  const third = await mount($, await run($, 'settings'))
  await third.press({ key: 'sidekick-set-queue-false' })
  await flush()
  expect(w.cli.writes.length).toBe(1)
  expect(w.toasts.at(-1)).toBe(T.de.q.already(false))
  await third.unmount()
})

test('Knopf schreibt über Weg 1 ($.config.set, Plugin-Zeilen da): nur das eigene Feld, „gilt sofort“', { options: { language: 'de' } }, async ($, on) => {
  setLang('de')
  const sets: { key: string; value: unknown }[] = []
  const w = world(on, { rows: () => [{ key: 'sidekick.notes', value: false, provider: { plugin: 'sidekick@fynn-mods' } }] })
  on('config.set', ($: unknown, e: any) => {
    sets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  await start($)
  const ui = await mount($, await run($, 'settings'))
  await ui.press({ key: 'sidekick-set-notes-true' })
  await flush()
  expect(sets).toEqual([{ key: 'sidekick.notes', value: true }])
  expect(w.cli.writes).toEqual([])
  expect(w.toasts.at(-1)).toContain('Gespeichert, gilt sofort.')
  await ui.unmount()
})

deTest('Stufe Cache: ruhende Funktionen grau mit „ruht bei Stufe Cache“, Kalt-Cache-Frage und Lebensdauer nicht', { level: 'cache' }, async ($, on) => {
  world(on)
  await start($)
  const md = await run($, 'settings')
  expect(md).toContain('- 🟢 **Skills vorschlagen**: an · _ruht bei Stufe Cache_')
  expect(md).toContain('- **Kalt-Cache-Frage ab**: 150k · `/sidekick big 150k`')
  const ui = await mount($, md)
  const all = await json(ui, 'sidekick-settings')
  expect(all).toContain('ruht bei Stufe Cache')
  expect(all).toContain('"dimColor":true')
  await ui.unmount()
})

deTest('Stufe per Knopf: schreibt level, die Anzeige liest danach die neue Stufe', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await mount($, await run($, 'settings'))
  await ui.press({ key: 'sidekick-set-level-cache' })
  await flush()
  expect(written(w.cli)).toEqual({ level: 'cache' })
  expect(w.toasts.at(-1)).toContain(S.set('Stufe', 'Cache'))
  await ui.unmount()
  expect((await run($, 'settings')).split('\n')[0]).toBe('**sidekick · Einstellungen** · Stufe Cache')
})

deTest('Sprache per Knopf: wie /sidekick language (alle fynn-mods über claude plugin configure), Meldung als Toast', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await mount($, await run($, 'settings'))
  await ui.press({ key: 'sidekick-set-language-en' })
  await flush()
  expect(written(w.cli)).toEqual({ language: 'en' })
  expect(w.toasts.at(-1)!.length > 0).toBe(true)
  expect(w.toasts.at(-1)).not.toContain('**')
  await ui.unmount()
})

deTest('Terminal: dieselbe Ansicht mit Knöpfen; VS Code und Fehler: Markdown der Engine (ohne Knöpfe)', async ($, on) => {
  world(on, { surfaces: ['terminal'] })
  await start($)
  const md = await run($, 'settings')
  const ui = await mount($, md, 'terminal')
  expect(await json(ui, 'sidekick-set-catalog-true')).toContain('● an')
  await ui.unmount()
  const vs = await mount($, md, 'vscode')
  expect(await json(vs, 'sidekick-set-catalog-true')).toBe('null')
  await vs.unmount()
})

deTest('/sidekick settings foo → Aufruf; /sidekick help nennt /sidekick settings; /sidekick status nennt den Weg', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'settings foo')).toBe(S.usage)
  expect(await run($, 'help')).toContain('/sidekick settings')
  expect(await run($, 'status')).toContain(T.de.settingsHint)
})

test('Ansicht englisch: Titel, Gruppen und Knöpfe auf Englisch', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  world(on)
  await start($)
  const md = await run($, 'settings')
  expect(md.split('\n')[0]).toBe('**sidekick · settings** · level Guide')
  for (const g of ['Base level', 'Before sending', 'While Claude works', 'Limits', 'Language']) expect(md).toContain(`**${g}**`)
  expect(md).toContain('- 🟢 **Queue**: on · `/sidekick queue on|off`')
  const ui = await mount($, md)
  expect(await json(ui, 'sidekick-set-queue-true')).toContain('● on')
  await ui.unmount()
  setLang('de')
})

deTest('Review S2: Schreiben scheitert → Toast „Nicht gespeichert“ mit Grund, Wert bleibt', async ($, on) => {
  const w = world(on)
  await start($)
  w.cli.fail = 'N: kaputt'
  const ui = await mount($, await run($, 'settings'))
  await ui.press({ key: 'sidekick-set-skills-false' })
  await flush()
  expect(w.toasts.at(-1)).toBe('Nicht gespeichert: N: kaputt.')
  await ui.unmount()
  const again = await mount($, await run($, 'settings'))
  expect(await json(again, 'sidekick-set-skills-true')).toContain('● an')
  await again.unmount()
})

deTest('Review S2: Zeichnen scheitert (Store wirft) → Markdown der Engine, keine Knöpfe', async ($, on) => {
  const flag = { on: false }
  world(on, { breakRuntime: flag })
  await start($)
  const md = await run($, 'settings')
  flag.on = true
  const ui = await mount($, md)
  expect(await json(ui, 'sidekick-settings')).toBe('null')
  await ui.unmount()
})

// ---------- Umzugshinweis (Teil 3) ----------

deTest('Umzugshinweis: einmal als Toast nach dem Start, einmal in /sidekick status, danach nie wieder', async ($, on) => {
  // Frühere Nutzung: Bilanz-Tage im Store
  const w = world(on, { saved: new Map<string, unknown>([['bilanz:alt', { tage: {} }]]) })
  await start($)
  await w.clock.advance(2000)
  await flush()
  expect(w.toasts.filter((x) => x.includes(T.de.cat.moved))).toEqual([`sidekick: ${T.de.cat.moved}`])
  expect(await run($, 'status')).toContain(T.de.cat.moved)
  expect(await run($, 'status')).not.toContain(T.de.cat.moved)
  await start($)
  await w.clock.advance(2000)
  await flush()
  expect(w.toasts.filter((x) => x.includes(T.de.cat.moved)).length).toBe(1)
  expect(w.store.get('notice:moved031')).toBe('done')
})

deTest('Umzugshinweis: neue Installation (keine Bilanz) → kein Toast, nichts im Status', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(2000)
  await flush()
  expect(w.toasts.filter((x) => x.includes(T.de.cat.moved))).toEqual([])
  expect(await run($, 'status')).not.toContain(T.de.cat.moved)
  expect(w.store.get('notice:moved031')).toBe('done')
})

// ---------- Seitenfenster-Chat (0.30.0) folgt derselben Regel ----------

test('Chat-Knopf: installiertes Original → „Im Chat mit … senden“ startet das Original; nicht installiert → Installationszeile', () => {
  const sp = [{ name: 'superpowers:systematic-debugging', source: 'plugin', plugin: 'superpowers' }]
  expect(chatButton({ id: 'sp-debug', warum: '' }, { cmds: sp, servers: [], surface: 'desktop' })).toMatchObject({ art: 'skill', cmd: 'superpowers:systematic-debugging' })
  expect(chatButton({ id: 'sp-debug', warum: '' }, { cmds: [], servers: [], surface: 'desktop' })).toMatchObject({ art: 'copy', line: '/plugin install superpowers@claude-plugins-official' })
  expect(chatButton({ id: 'emil-apple', warum: '' }, { cmds: [], servers: [], surface: 'desktop' })).toMatchObject({ art: 'skill', cmd: 'sidekick:apple-design' })
  expect(chatButton({ id: 'sp-debug', warum: '' }, { cmds: [...sp, { name: 'mod-debug', source: 'user' }], servers: [], surface: 'desktop' })).toEqual({ art: 'cmd', cmd: 'mod-debug' })
  // Seit 0.31.1 heißt der Knopf „Mit Skill senden“; welchen Befehl er startet, steht in der Zeile darunter
  expect(T.de.chat.btnSkill).toBe('Mit Skill senden')
  expect(T.de.chat.stRun('mattpocock-skills:grilling')).toBe('installiert, startet /mattpocock-skills:grilling')
})
