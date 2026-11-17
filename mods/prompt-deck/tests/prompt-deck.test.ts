// Tests für prompt-deck (SPEC „Tests“). Eigene kleine Welt mit Stubs, nach dem Muster von sidekick tests/prompts.test.ts.
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { LEVEL, SLOTS, layer, slot } from '../hooks/band.js'
import {
  BUTTONS_MAX,
  BUTTON_KINDS,
  LABEL_MAX,
  SAVED_MAX,
  buttonLabel,
  buttonNames,
  buttonRows,
  buttonsArg,
  checkName,
  cleanSaved,
  freeName,
  lastOwnText,
  pHint,
  saveArgs,
  savedState,
  shownPrompts,
  upsert,
  wordSet,
} from '../hooks/deck.js'
import { HELP_WORDS, LIST_WORDS } from '../hooks/register.js'
import { setLang } from '../hooks/i18n.js'
import { LANGUAGES, LANGUAGE_WORD } from '../hooks/language.js'
import { cliStubs, written } from './cli.js'

const NOW = new Date(2026, 10, 17, 10, 0, 0).getTime()
const TIDY = 'Sortiere die Chats unter dir nach ihrem tatsächlichen Zweck und archiviere die, die wir nicht mehr brauchen.'
const MULTI = 'Zeile eins\nZeile zwei mit  zwei Leerzeichen\n\n  eingerückt\tTab\r\nCRLF „Umlaute“ äöü `code` $x | pipe --off'
const DE = { options: { language: 'de' } }

function deTest(name: string, a: Record<string, string | number | boolean> | (($: Engine, on: On) => unknown), b?: ($: Engine, on: On) => unknown) {
  const cfg = typeof a === 'function' ? {} : a
  const body = typeof a === 'function' ? a : b!
  test(name, { options: { ...DE.options, ...cfg } }, async ($, on) => {
    setLang('de')
    return body($, on)
  })
}

type Status = { level: 'off' | 'cache' | 'guide'; busy: boolean; later?: true; laterUsed?: number } | undefined

function world(on: On, o: { surfaces?: string[]; submitDrop?: string; submitThrow?: boolean; status?: Status; stateThrows?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  const cli = cliStubs(on)
  const toasts: string[] = []
  const submitted: { text: string; origin?: unknown }[] = []
  const registered = new Map<string, string>()
  const state = new Map<string, unknown>()
  const stateSets: { key: string; value: unknown }[] = []
  let invalidates = 0
  let msgs: unknown[] = [{ role: 'assistant', text: 'vorher', toolUses: [] }]
  let hold = false
  let release: (() => void) | null = null
  if (o.status) state.set('sidekick.status', o.status)
  on('session.start', () => ({ cwd: '/work' }) as never)
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['desktop']) as never }))
  on('session.messages', () => ({ value: msgs as never }))
  on('command.register', ($, e) => {
    registered.set(e.name, e.argumentHint ?? '')
    return { value: { command: e.name } as never }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => {
    invalidates += 1
    return { value: undefined }
  })
  on('state.get', ($: unknown, e: any) => {
    if (o.stateThrows) throw new Error('state.get')
    return { value: { value: state.get(`${e.plugin}.${e.key}`), version: 1 } }
  })
  on('state.set', ($: unknown, e: any) => {
    state.set(`${e.plugin}.${e.key}`, e.value)
    stateSets.push({ key: `${e.plugin}.${e.key}`, value: e.value })
    return { value: { isSet: true, version: 1 } }
  })
  on('prompt.submit', async ($, e) => {
    if (hold) await new Promise<void>((r) => (release = r))
    if (o.submitThrow) throw new Error('weg')
    if (o.submitDrop) return { drop: o.submitDrop }
    submitted.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String((e.props as { text?: string }).text ?? 'keine Zeile')] }))
  return {
    clock,
    store,
    cli,
    toasts,
    submitted,
    registered,
    state,
    stateSets,
    invalidates: () => invalidates,
    setMessages: (m: unknown[]) => (msgs = m),
    holdSubmit: () => (hold = true),
    releaseSubmit: () => {
      hold = false
      release?.()
    },
    saved: () => cleanSaved(store.get('saved')),
    setStatus: (s: Status) => state.set('sidekick.status', s),
  }
}

async function flush(rounds = 300) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
const run = async ($: Engine, command: string, args = '', origin: { kind: string; name?: string } = { kind: 'composer' }) => (await $.command.run({ command, args, origin } as never)).text ?? ''
const fromSidekick = { kind: 'plugin', name: 'sidekick' }
async function start($: Engine) {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never)
  await flush()
}
let mountNo = 0
const PROPS = { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} }
async function band($: Engine, surface: 'desktop' | 'terminal' | 'vscode' = 'desktop', props: Partial<typeof PROPS> = {}) {
  return $.ui.mount({ plugin: 'prompt-deck', component: 'AbovePrompt', requestId: `band-${surface}-${++mountNo}`, surface, props: { ...PROPS, ...props } } as never)
}
async function output($: Engine, args: string, text: string, surface: 'desktop' | 'terminal' | 'vscode' = 'desktop') {
  return $.ui.mount({ plugin: 'prompt-deck', component: 'CommandOutput', requestId: `out-${surface}-${++mountNo}`, surface, viewport: { columns: 100, rows: 30 }, props: { command: 'deck', args, text, isErrored: false } } as never)
}

// ---------- reine Logik ----------

deTest('Logik: Namen, freier Name, upsert mit 12, Knöpfe höchstens 4, Beschriftung 14 Zeichen, /p-Hinweis', () => {
  expect(checkName('/Tidy Chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('/p tidy-chats', [], false)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('tidy-chats', ['tidy-chats'], false)).toMatchObject({ ok: false, why: 'own', suggest: 'tidy-chats-2' })
  expect(checkName('tidy-chats', ['tidy-chats'], true)).toEqual({ ok: true, name: 'tidy-chats' })
  expect(checkName('Böse!', [], true)).toMatchObject({ ok: false, why: 'invalid' })
  expect(freeName('a', new Set(['a', 'a-2']))).toBe('a-3')
  let list = cleanSaved([])
  for (let i = 0; i < SAVED_MAX; i++) list = upsert(list, { name: `p${i}`, text: `t${i}`, button: true, at: i, from: 'manual' }).list
  expect(upsert(list, { name: 'p12', text: 'x', button: true, at: 0, from: 'manual' }).kind).toBe('full')
  const r = upsert(list, { name: 'p0', text: 'neu', button: false, at: 99, from: 'manual' })
  expect(r.kind).toBe('replaced')
  expect(r.list[0]).toEqual({ name: 'p0', text: 'neu', button: true, at: 0, from: 'manual' })
  expect(buttonNames(list)).toEqual(['p0', 'p1', 'p2', 'p3'])
  expect(BUTTONS_MAX).toBe(4)
  expect(buttonLabel('ein-sehr-langer-name')).toBe('ein-sehr-lang…')
  expect(buttonLabel('ein-sehr-langer-name').length).toBe(LABEL_MAX)
  expect(pHint([])).toBe('<name>')
  expect(pHint(list.slice(0, 2))).toBe('<p0|p1>')
  expect(cleanSaved([null, { name: 'X Y', text: 'a' }, { name: 'ok', text: ' ' }, { name: 'ok', text: 'a' }, { name: 'ok', text: 'b' }])).toEqual([{ name: 'ok', text: 'a', button: true, at: 0, from: 'manual' }])
})

deTest('Logik: save-Argumente, Schalter vor dem Namen, Text unverändert (auch --off im Text)', () => {
  expect(saveArgs(` tidy ${MULTI}`)).toEqual({ name: 'tidy', text: MULTI, off: false, manual: false })
  expect(saveArgs(` --off --manual tidy ${MULTI}`)).toEqual({ name: 'tidy', text: MULTI, off: true, manual: true })
  expect(saveArgs(' --manual')).toEqual({ name: '', text: '', off: false, manual: true })
  expect(saveArgs(' tidy')).toEqual({ name: 'tidy', text: '', off: false, manual: false })
  expect(saveArgs(' tidy\nZeile')).toEqual({ name: 'tidy', text: 'Zeile', off: false, manual: false })
})

deTest('Logik: letzte eigene Nachricht ohne Vorspann, Befehle und Host-Texte', () => {
  expect(lastOwnText([{ role: 'user', text: TIDY }, { role: 'user', text: '/deck save x' }, { role: 'user', text: '[Cross-session idle notice] x' }])).toBe(TIDY)
  expect(lastOwnText([{ role: 'user', text: `<system-reminder>a</system-reminder>\n${TIDY}` }])).toBe(TIDY)
  expect(lastOwnText([{ role: 'assistant', text: 'x' }])).toBe('')
})

deTest('Absprache prompt-deck.saved: nur Namen und Wortmengen, kein Text', () => {
  const v = savedState([{ name: 'tidy-chats', text: TIDY, button: true, at: 1, from: 'auto' }])
  expect(v).toEqual({ items: [{ name: 'tidy-chats', words: wordSet(TIDY) }] })
  expect(JSON.stringify(v)).not.toContain('Sortiere die Chats unter')
})

deTest('Knopfarten: Liste mit 0/1/5 Prompts (5: einer nicht sichtbar), Zustände mit und ohne sidekick', () => {
  const p = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `p${i}`, text: `t${i}`, button: true, at: i, from: 'manual' as const }))
  const none = buttonRows({ cfg: {}, sidekick: undefined, saved: [] })
  expect(none.map((r) => r.id)).toEqual(['later', 'prompts'])
  expect(none[0]!.state).toContain('nur mit sidekick')
  expect(buttonRows({ cfg: {}, sidekick: { level: 'cache' }, saved: [] })[0]!.state).toContain('Begleiter')
  expect(buttonRows({ cfg: {}, sidekick: { level: 'guide' }, saved: p(1) }).map((r) => r.state)).toEqual(['an · nur während Claude arbeitet (sidekick, Warteschlange an)', 'an · 1 von 4 Plätzen belegt', 'sichtbar'])
  const five = buttonRows({ cfg: {}, sidekick: undefined, saved: p(5) })
  expect(five.slice(2).map((r) => r.state)).toEqual(['sichtbar', 'sichtbar', 'sichtbar', 'sichtbar', 'nicht sichtbar (nur 4 Plätze)'])
  expect(buttonRows({ cfg: { promptButtons: false }, sidekick: undefined, saved: p(1) }).map((r) => r.state)).toEqual(['an · erscheint nur mit sidekick', 'aus', 'nicht sichtbar (Prompt-Knöpfe aus)'])
  expect(shownPrompts({ cfg: { promptButtons: false }, sidekick: undefined, saved: p(2) })).toEqual([])
  expect(buttonsArg('')).toEqual({ kind: 'list' })
  expect(buttonsArg('later off')).toEqual({ kind: 'set', target: 'later', on: false })
  expect(buttonsArg('x y z')).toEqual({ kind: 'usage' })
  expect(BUTTON_KINDS.map((k) => k.field)).toEqual(['laterButton', 'promptButtons'])
})

// ---------- /deck ----------

deTest('session.start: Befehle deck und p angemeldet, prompt-deck.saved aus dem Store geschrieben', async ($, on) => {
  const w = world(on)
  w.store.set('saved', [{ name: 'tidy-chats', text: TIDY, button: true, at: 1, from: 'auto' }])
  await start($)
  expect([...w.registered.keys()]).toEqual(['deck', 'p'])
  expect(w.registered.get('p')).toBe('<tidy-chats>')
  expect(w.registered.get('deck')).toContain('language')
  expect(w.state.get('prompt-deck.saved')).toEqual({ items: [{ name: 'tidy-chats', words: wordSet(TIDY) }] })
})

deTest('/deck save, list, show, <name> on|off, forget', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await run($, 'deck')).toContain('Noch keine gespeicherten Prompts')
  const out = await run($, 'deck', `save tidy-chats ${TIDY}`)
  expect(out).toContain('✓ Gespeichert als /p tidy-chats.')
  expect(out).toContain('Mit Knopf.')
  expect(w.saved()).toEqual([{ name: 'tidy-chats', text: TIDY, button: true, at: NOW, from: 'manual' }])
  expect(w.registered.get('p')).toBe('<tidy-chats>')
  expect(w.state.get('prompt-deck.saved')).toEqual({ items: [{ name: 'tidy-chats', words: wordSet(TIDY) }] })
  for (const args of ['', 'list', 'prompts', 'LIST']) {
    const list = await run($, 'deck', args)
    expect(list).toContain('**Gespeicherte Prompts** · 1 von 12 · #')
    expect(list).toContain('| `/p tidy-chats` | Sortiere die Chats')
    for (const l of list.split('\n').filter((x) => x.startsWith('|'))) expect(l.split('|').length - 2).toBe(3)
  }
  const one = await run($, 'deck', 'show tidy-chats')
  expect(one).toContain('**/p tidy-chats** · Knopf an · selbst gespeichert')
  expect(one).toContain(TIDY)
  expect(await run($, 'deck', 'show')).toContain('So geht es')
  expect(await run($, 'deck', 'tidy-chats off')).toContain('ohne Knopf')
  expect(w.saved()[0]!.button).toBe(false)
  expect(await run($, 'deck', 'tidy-chats on')).toContain('hat jetzt einen Knopf')
  expect(await run($, 'deck', 'gibtsnicht on')).toContain('Keinen gespeicherten Prompt „gibtsnicht“')
  expect(await run($, 'deck', 'forget tidy-chats')).toContain('✓ /p tidy-chats gelöscht.')
  expect(w.saved()).toEqual([])
  expect(w.state.get('prompt-deck.saved')).toEqual({ items: [] })
  expect(w.registered.get('p')).toBe('<name>')
  expect(await run($, 'deck', 'forget tidy-chats')).toContain('Keinen gespeicherten Prompt')
  expect(await run($, 'deck', 'quatsch')).toContain('Unbekannt: „quatsch“')
})

deTest('/deck save ohne Text: letzte eigene Nachricht; ungültig, 13. Prompt, Überschreiben, mehrzeilig unverändert', async ($, on) => {
  const w = world(on)
  await start($)
  w.setMessages([
    { role: 'user', text: TIDY, toolUses: [] },
    { role: 'assistant', text: 'erledigt', toolUses: [] },
    { role: 'user', text: '/deck save tidy', toolUses: [] },
  ])
  expect(await run($, 'deck', 'save tidy')).toContain('✓ Gespeichert als /p tidy.')
  expect(w.saved()[0]!.text).toBe(TIDY)
  w.setMessages([{ role: 'assistant', text: 'nur ich', toolUses: [] }])
  expect(await run($, 'deck', 'save leer')).toContain('keine eigene Nachricht')
  expect(await run($, 'deck', 'save')).toContain('So geht es')
  expect(await run($, 'deck', 'save Böse! x')).toContain('geht nicht als Name')
  await run($, 'deck', `save multi ${MULTI}`)
  expect(w.saved()[1]!.text).toBe(MULTI)
  for (let i = 2; i < 12; i++) await run($, 'deck', `save p${i} Text ${i}`)
  expect(w.saved().length).toBe(12)
  expect(await run($, 'deck', 'save p12 zu viel')).toContain('Schon 12 gespeicherte Prompts')
  expect(await run($, 'deck', 'save tidy Neuer Text')).toContain('✓ /p tidy überschrieben.')
  expect(w.saved()[0]!.text).toBe('Neuer Text')
  expect(await run($, 'deck', 'save p11 anders')).toContain('Nur als Befehl')
})

// ---------- Übergabe von sidekick ----------

deTest('save von sidekick: angenommen, erste Zeile maschinenlesbar, mehrzeilig, belegter Name → freier, --off, --manual, voll', async ($, on) => {
  const w = world(on)
  await start($)
  const a = await run($, 'deck', `save tidy-chats ${MULTI}`, fromSidekick)
  expect(a.split('\n')[0]).toBe('saved tidy-chats')
  expect(w.saved()[0]).toEqual({ name: 'tidy-chats', text: MULTI, button: true, at: NOW, from: 'auto' })
  // nie überschreiben: belegter Name bekommt einen freien
  const b = await run($, 'deck', `save tidy-chats ${TIDY}`, fromSidekick)
  expect(b.split('\n')[0]).toBe('saved tidy-chats-2')
  expect(w.saved()[0]!.text).toBe(MULTI)
  // Umzug: ohne Knopf, selbst gespeichert
  const c = await run($, 'deck', `save --off --manual alt Ein alter Prompt mit Text`, fromSidekick)
  expect(c.split('\n')[0]).toBe('saved alt')
  expect(w.saved()[2]).toMatchObject({ name: 'alt', button: false, from: 'manual' })
  expect((await run($, 'deck', 'save leer', fromSidekick)).split('\n')[0]).toBe('refused no-text')
  expect((await run($, 'deck', 'save', fromSidekick)).split('\n')[0]).toBe('refused no-name')
  expect((await run($, 'deck', 'save Böse! x', fromSidekick)).split('\n')[0]).toBe('refused invalid-name')
  for (let i = 3; i < 12; i++) await run($, 'deck', `save p${i} t ${i}`, fromSidekick)
  expect((await run($, 'deck', 'save p12 t', fromSidekick)).split('\n')[0]).toBe('full')
  expect(w.saved().length).toBe(12)
})

deTest('Befehle von anderen Plugins abgelehnt (auch sidekick außer save), nichts gespeichert oder gelöscht', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  for (const [args, who] of [[`save x ${TIDY}`, 'fremd'], ['forget tidy', 'fremd'], ['forget tidy', 'sidekick'], ['tidy off', 'sidekick'], ['buttons prompts off', 'sidekick']] as const) {
    const out = await run($, 'deck', args, { kind: 'plugin', name: who })
    expect(out.split('\n')[0]).toBe('refused not-allowed')
  }
  expect(w.saved().map((s) => [s.name, s.button])).toEqual([['tidy', true]])
  expect(w.cli.writes).toEqual([])
})

// ---------- /p ----------

deTest('/p <name>: sendet einmal mit asUser über den Timer; unbekannt; ohne Namen die Liste; von Plugin abgelehnt; -p ohne Senden', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'deck', `save tidy-chats ${TIDY}`)
  expect(await run($, 'p', 'tidy-chats')).toBe('/p tidy-chats gesendet')
  // noch nicht gesendet: erst nach dem Hook (sidekick Bau 0.21.0)
  await flush()
  expect(w.submitted).toEqual([])
  await w.clock.advance(200)
  await flush()
  expect(w.submitted).toEqual([{ text: TIDY, origin: { kind: 'plugin', name: 'prompt-deck', asUser: true } }])
  expect(await run($, 'p', 'nix')).toContain('Keinen gespeicherten Prompt „nix“')
  expect(await run($, 'p')).toContain('gespeichert: `tidy-chats`')
  expect(await run($, 'p', 'tidy-chats', { kind: 'plugin', name: 'sidekick' })).toContain('nur, wenn du es selbst tippst')
  await w.clock.advance(200)
  await flush()
  expect(w.submitted.length).toBe(1)
})

deTest('/p in -p (keine Oberfläche): nichts gesendet, Text sagt es', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  expect(await run($, 'p', 'tidy')).toContain('nicht mit `-p`')
  await w.clock.advance(200)
  await flush()
  expect(w.submitted).toEqual([])
})

deTest('/p: abgelehnter Submit → Toast mit Grund', async ($, on) => {
  const w = world(on, { submitDrop: 'Grenze erreicht' })
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  await run($, 'p', 'tidy')
  await w.clock.advance(200)
  await flush()
  expect(w.toasts.some((x) => x.includes('/p tidy nicht gesendet: Grenze erreicht'))).toBe(true)
})

// ---------- Band ----------

deTest('Band: Desktop zeichnet layer:10:prompt-deck mit höchstens 4 Knöpfen, linksbündig; Terminal, VS Code, Umfrage, ohne Knöpfe: keine Zeile', async ($, on) => {
  const w = world(on)
  await start($)
  const empty = await band($)
  expect(await empty.find({ key: 'layer:10:prompt-deck' })).toBeUndefined()
  expect(await empty.find({ type: 'Text', text: 'keine Zeile' })).toBeDefined()
  await empty.unmount()
  for (let i = 0; i < 5; i++) await run($, 'deck', `save p${i} Text ${i}`)
  const ui = await band($)
  const root = await ui.drawn()
  expect(await ui.find({ key: 'layer:10:prompt-deck' })).toBeDefined()
  expect(JSON.stringify(root).indexOf('layer:10:prompt-deck')).toBeLessThan(JSON.stringify(root).indexOf('prompt-deck-row'))
  expect(LEVEL.promptDeck).toBe(10)
  const row = await ui.find({ key: 'prompt-deck-row' })
  expect(row?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })
  const json = JSON.stringify(root)
  for (let i = 0; i < 4; i++) expect(json).toContain(`prompt-deck-p-p${i}`)
  expect(json).not.toContain('prompt-deck-p-p4')
  expect(json).not.toContain('prompt-deck-later')
  await ui.unmount()
  for (const [surface, props] of [['terminal', {}], ['vscode', {}], ['desktop', { hasSurvey: true }]] as const) {
    const o = await band($, surface, props)
    expect(await o.find({ key: 'layer:10:prompt-deck' })).toBeUndefined()
    await o.unmount()
  }
  // promptButtons aus (Befehl, Weg 2): keine Zeile
  expect(await run($, 'deck', 'buttons prompts off')).toContain('✓ Prompt-Knöpfe aus.')
  expect(written(w.cli)).toEqual({ promptButtons: 'false' })
  const off = await band($)
  expect(await off.find({ key: 'layer:10:prompt-deck' })).toBeUndefined()
  await off.unmount()
})

deTest('Knopf: Klick sendet sofort mit asUser; Doppelklick einmal; während einer Antwort Toast „danach“', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  const ui = await band($, 'desktop', { isWorking: false })
  w.holdSubmit()
  await ui.press({ key: 'prompt-deck-p-tidy' })
  await ui.press({ key: 'prompt-deck-p-tidy' })
  await flush()
  expect(w.toasts.some((x) => x.includes('/p tidy ist schon unterwegs'))).toBe(true)
  w.releaseSubmit()
  await flush()
  expect(w.submitted.map((s) => s.text)).toEqual([TIDY])
  await ui.unmount()
  const busy = await band($, 'desktop', { isWorking: true })
  await busy.press({ key: 'prompt-deck-p-tidy' })
  await flush()
  expect(w.toasts.some((x) => x.includes('/p tidy kommt nach der aktuellen Antwort'))).toBe(true)
  expect(w.submitted.length).toBe(2)
})

deTest('Danach: nur mit sidekick.status.later und laterButton an; Klick schreibt prompt-deck.later, zweiter löscht', async ($, on) => {
  const w = world(on, { status: { level: 'guide', busy: false, later: true } })
  await start($)
  const ui = await band($)
  expect(await ui.find({ key: 'prompt-deck-later' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"Danach"')
  await ui.press({ key: 'prompt-deck-later' })
  await flush()
  expect(w.state.get('prompt-deck.later')).toEqual({ armed: true, at: NOW })
  expect(w.invalidates()).toBeGreaterThan(0)
  await ui.unmount()
  const again = await band($)
  expect(JSON.stringify(await again.drawn())).toContain('Danach ✓')
  await again.press({ key: 'prompt-deck-later' })
  await flush()
  expect(w.state.get('prompt-deck.later')).toBe(null)
  await again.unmount()
  const back = await band($)
  expect(JSON.stringify(await back.drawn())).toContain('"Danach"')
  await back.unmount()
})

deTest('Danach: fällt sidekick.status.later weg → Knopf weg, Markierung gelöscht (nach dem Zeichnen); verbraucht → wieder „Danach“', async ($, on) => {
  const w = world(on, { status: { level: 'guide', busy: false, later: true } })
  await start($)
  const ui = await band($)
  await ui.press({ key: 'prompt-deck-later' })
  await flush()
  await ui.unmount()
  // sidekick hat die Markierung verbraucht
  w.setStatus({ level: 'guide', busy: false, later: true, laterUsed: NOW })
  const used = await band($)
  expect(JSON.stringify(await used.drawn())).toContain('"Danach"')
  await used.unmount()
  await w.clock.advance(100)
  await flush()
  expect(w.state.get('prompt-deck.later')).toBe(null)
  // neu markiert, dann Zug vorbei
  w.setStatus({ level: 'guide', busy: false, later: true })
  const b2 = await band($)
  await b2.press({ key: 'prompt-deck-later' })
  await flush()
  await b2.unmount()
  const armed = w.state.get('prompt-deck.later')
  expect(armed).toMatchObject({ armed: true })
  w.setStatus({ level: 'guide', busy: false })
  const gone = await band($)
  expect(await gone.find({ key: 'prompt-deck-later' })).toBeUndefined()
  // nichts beim Zeichnen geschrieben
  expect(w.state.get('prompt-deck.later')).toEqual(armed)
  await gone.unmount()
  await w.clock.advance(100)
  await flush()
  expect(w.state.get('prompt-deck.later')).toBe(null)
})

deTest('Danach: laterButton aus → kein Knopf, auch mit sidekick.status.later', { laterButton: false }, async ($, on) => {
  world(on, { status: { level: 'guide', busy: false, later: true } })
  await start($)
  const ui = await band($)
  expect(await ui.find({ key: 'prompt-deck-later' })).toBeUndefined()
  await ui.unmount()
})

deTest('Neuladen mitten im Zug: eine Markierung aus $.state wird übernommen (✓), der Klick nimmt sie zurück (Review S2)', async ($, on) => {
  const w = world(on, { status: { level: 'guide', busy: false, later: true } })
  w.state.set('prompt-deck.later', { armed: true, at: NOW - 5000 })
  await start($)
  const ui = await band($)
  expect(JSON.stringify(await ui.drawn())).toContain('Danach ✓')
  await ui.press({ key: 'prompt-deck-later' })
  await flush()
  expect(w.state.get('prompt-deck.later')).toBe(null)
  await ui.unmount()
  // ein später noch alter Stand wird nicht wieder übernommen
  w.state.set('prompt-deck.later', { armed: true, at: NOW - 5000 })
  const again = await band($)
  expect(JSON.stringify(await again.drawn())).toContain('"Danach"')
  await again.unmount()
})

deTest('Befehle aus anderen Herkünften (peer, coordinator, Zeitplan) senden und ändern nichts; Desktop (sdk) gilt als getippt (Review K1)', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`, { kind: 'sdk' })
  expect(w.saved().length).toBe(1)
  for (const kind of ['peer', 'coordinator', 'scheduled-trigger', 'channel']) {
    expect(await run($, 'p', 'tidy', { kind })).toContain('nur, wenn du es selbst tippst')
    expect((await run($, 'deck', 'forget tidy', { kind })).split('\n')[0]).toBe('refused not-allowed')
  }
  await w.clock.advance(200)
  await flush()
  expect(w.submitted).toEqual([])
  expect(w.saved().length).toBe(1)
})

deTest('Fehlerpfade: Submit wirft → Toast; mobile → keine Zeile (Review K8)', async ($, on) => {
  const w = world(on, { submitThrow: true })
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  const ui = await band($)
  await ui.press({ key: 'prompt-deck-p-tidy' })
  await flush()
  expect(w.toasts.some((x) => x.startsWith('/p tidy nicht gesendet'))).toBe(true)
  await ui.unmount()
  const mobile = await $.ui.mount({ plugin: 'prompt-deck', component: 'AbovePrompt', requestId: 'band-mobile', surface: 'mobile', props: PROPS } as never)
  expect(await mobile.find({ key: 'layer:10:prompt-deck' })).toBeUndefined()
  await mobile.unmount()
})

deTest('Ohne sidekick (kein sidekick.status): Prompt-Knöpfe ja, Danach nein', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  const ui = await band($)
  expect(await ui.find({ key: 'prompt-deck-p-tidy' })).toBeDefined()
  expect(await ui.find({ key: 'prompt-deck-later' })).toBeUndefined()
  await ui.unmount()
  expect(w.state.get('sidekick.status')).toBeUndefined()
})

deTest('Fehler beim Lesen von $.state: Prompt-Knöpfe bleiben, kein Danach', async ($, on) => {
  const w = world(on, { stateThrows: true, status: { level: 'guide', busy: false, later: true } })
  await start($)
  w.store.set('saved', [{ name: 'tidy', text: TIDY, button: true, at: 1, from: 'manual' }])
  await run($, 'deck', 'list')
  const ui = await band($)
  expect(await ui.find({ key: 'prompt-deck-p-tidy' })).toBeDefined()
  expect(await ui.find({ key: 'prompt-deck-later' })).toBeUndefined()
  await ui.unmount()
})

deTest('/clear setzt $.state zurück: Knöpfe kommen aus dem Speicher, prompt-deck.saved mit der nächsten Änderung neu', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  w.state.clear()
  const ui = await band($)
  expect(await ui.find({ key: 'prompt-deck-p-tidy' })).toBeDefined()
  await ui.unmount()
  await run($, 'deck', `save zwei Noch ein Prompt mit Text`)
  expect((w.state.get('prompt-deck.saved') as { items: { name: string }[] }).items.map((i) => i.name)).toEqual(['tidy', 'zwei'])
})

// ---------- Tabellen ----------

deTest('/deck list als Baum (Terminal und Desktop) mit Senden, Knopf an/aus, Löschen; VS Code und fremde Kennung: Markdown', async ($, on) => {
  const w = world(on)
  await start($)
  await run($, 'deck', `save tidy ${TIDY}`)
  const text = `prompt-deck: ${await run($, 'deck', 'list')}`
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await output($, 'list', text, surface)
    expect(await ui.find({ key: 'prompt-deck-list' })).toBeDefined()
    await ui.unmount()
  }
  const vs = await output($, 'list', text, 'vscode')
  expect(await vs.find({ key: 'prompt-deck-list' })).toBeUndefined()
  await vs.unmount()
  const ui = await output($, 'list', text)
  await ui.press({ key: 'prompt-deck-pr-btn-tidy' })
  await flush()
  expect(w.saved()[0]!.button).toBe(false)
  await ui.press({ key: 'prompt-deck-pr-send-tidy' })
  await flush()
  expect(w.submitted.map((s) => s.text)).toEqual([TIDY])
  await ui.press({ key: 'prompt-deck-pr-del-tidy' })
  await flush()
  expect(w.saved()).toEqual([])
  await ui.unmount()
  const unknown = await output($, 'list', 'prompt-deck: **x** · #zzzzzz')
  expect(await unknown.find({ key: 'prompt-deck-list' })).toBeUndefined()
  await unknown.unmount()
})

deTest('/deck buttons: Liste, Textbefehle ändern genau ein Feld bzw. einen Prompt, Baum mit Klicks, unbekannt', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await run($, 'deck', 'buttons')).toContain('Noch keine gespeicherten Prompts')
  await run($, 'deck', `save tidy ${TIDY}`)
  const md = await run($, 'deck', 'buttons')
  expect(md).toContain('**Knöpfe über dem Eingabefeld**')
  expect(md).toContain('| Danach | an |')
  expect(md).toContain('| `/p tidy` | an | sichtbar |')
  expect(await run($, 'deck', 'buttons tidy off')).toContain('ohne Knopf')
  expect(w.saved()[0]!.button).toBe(false)
  expect(w.cli.writes).toEqual([])
  expect(await run($, 'deck', 'buttons later off')).toContain('✓ Danach-Knopf aus.')
  expect(written(w.cli)).toEqual({ laterButton: 'false' })
  expect(await run($, 'deck', 'buttons later off')).toContain('ist schon aus')
  expect(await run($, 'deck', 'buttons nix on')).toContain('Keinen Knopf „nix“')
  expect(await run($, 'deck', 'buttons a b c')).toContain('Aufruf')
  const text = `prompt-deck: ${await run($, 'deck', 'buttons')}`
  const ui = await output($, 'buttons', text, 'terminal')
  expect(await ui.find({ key: 'prompt-deck-buttons' })).toBeDefined()
  await ui.press({ key: 'prompt-deck-bt-prompts' })
  await flush()
  expect(written(w.cli)).toEqual({ laterButton: 'false', promptButtons: 'false' })
  expect(w.toasts.some((x) => x.includes('Prompt-Knöpfe aus'))).toBe(true)
  await ui.press({ key: 'prompt-deck-bt-p-tidy' })
  await flush()
  expect(w.saved()[0]!.button).toBe(true)
  await ui.unmount()
})

// ---------- Hilfe und Sprache ----------

deTest('Hilfe: alle Befehle und Wörter des Parsers, Baum auf beiden Oberflächen, fremde Kennung → Markdown', async ($, on) => {
  world(on)
  await start($)
  const md = await run($, 'deck', 'help')
  expect(await run($, 'deck', '?')).toContain('**prompt-deck · Hilfe**')
  const tokens = new Set(md.split(/[^a-z?<>|-]+/i))
  for (const word of ['list', 'save', 'show', 'forget', 'buttons', 'later', 'prompts', 'on', 'off', 'help', LANGUAGE_WORD, ...LANGUAGES, ...HELP_WORDS, ...LIST_WORDS]) {
    expect(md.includes(word) && (tokens.has(word) || md.includes(`/deck ${word}`) || md.includes(`${word}|`) || md.includes(`|${word}`)), word).toBe(true)
  }
  expect(md).toContain('/p <name>')
  expect(md).toContain('Danach-Knopf')
  expect(md).toContain('nicht gefunden: kein Danach-Knopf')
  expect(await run($, 'deck', 'help foo')).toContain('Unbekannt')
  const text = `prompt-deck: ${md}`
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await output($, 'help', text, surface)
    expect(await ui.find({ key: 'prompt-deck-help' })).toBeDefined()
    await ui.unmount()
  }
  const tag = /#[0-9a-z]{5,}/.exec(md)![0]
  const fake = await output($, tag, `prompt-deck: Unbekannt: „${tag}“`)
  expect(await fake.find({ key: 'prompt-deck-help' })).toBeUndefined()
  await fake.unmount()
})

test('Englisch: Hilfe, Liste und Knöpfe', { options: { language: 'en' } }, async ($, on) => {
  setLang('en')
  world(on, { status: { level: 'guide', busy: false, later: true } })
  await start($)
  expect(await run($, 'deck', 'help')).toContain('**prompt-deck · Help**')
  expect(await run($, 'deck', `save tidy ${TIDY}`)).toContain('✓ Saved as /p tidy.')
  expect(await run($, 'deck', 'list')).toContain('**Saved prompts** · 1 of 12')
  const ui = await band($)
  expect(JSON.stringify(await ui.drawn())).toContain('"Later"')
  await ui.unmount()
})

// ---------- Anordnung ----------

test('arrange mit sidekick (50), tune-strip (40), quick-replies (20), prompt-deck (10), limit-bars, Clawd: Reihenfolge wie Skizze', async ($) => {
  const t = (s: string): RenderElement => ({ type: 'Text', props: {}, children: [s] })
  const rows = [
    { plugin: 'limit-bars', tree: slot(SLOTS.limitBars, 'limit-bars', t('balken')) },
    { plugin: 'prompt-deck', tree: layer(LEVEL.promptDeck, 'prompt-deck', t('knöpfe')) },
    { plugin: 'clawd-buddy', tree: slot(SLOTS.clawdBuddy, 'clawd-buddy', t('clawd'), 'right') },
    { plugin: 'quick-replies', tree: layer(LEVEL.quickReplies, 'quick-replies', t('pille')) },
    { plugin: 'sidekick', tree: layer(LEVEL.sidekick, 'sidekick', t('hinweis')) },
    { plugin: 'tune-strip', tree: layer(LEVEL.tuneStrip, 'tune-strip', t('musik')) },
  ]
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'prompt-deck', component: 'AbovePromptList', requestId: 'list', viewport: { columns: 100, rows: 30 }, surface, props: { ...PROPS, rows } } as never)
    expect((await ui.findAll({ type: 'Text' })).map((x) => x.text)).toEqual(['hinweis', 'musik', 'pille', 'knöpfe', 'balken', 'clawd'])
    await ui.unmount()
  }
})
