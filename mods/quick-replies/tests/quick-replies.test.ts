import type { Engine, On, RenderNode } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { joinBand, layer, LEVEL, levelOf, nameOf, splitBand } from '../hooks/band.ts'
import { HELP_WORDS, MORE_WORD, repliesHelp, STATUS_WORDS, TOGGLE_WORDS } from '../hooks/logic.ts'
import { T } from '../hooks/i18n.ts'

type Over = { isWorking?: boolean; hasSurvey?: boolean }
type Surface = 'terminal' | 'desktop'
const props = (bodyColumns: number, over: Over = {}) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {}, ...over }) as const
const band = (surface: Surface, bodyColumns = 120, over: Over = {}) =>
  ({ plugin: 'quick-replies', component: 'AbovePrompt', requestId: 'above-prompt', props: props(bodyColumns, over), surface }) as const

type Node = { type: string; props: Record<string, unknown>; children: Node[] }
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
type Fork = 'ok' | 'junk' | 'unanswered' | 'nothing' | 'deny' | 'slow' | 'cut'

// Grundausstattung: ein Mod weiter innen (clawd), Kern-Stubs, Uhr, Store, Fork-Stub
function world(on: On, opts: { fork?: Fork; submit?: 'ok' | 'drop'; stored?: unknown; forkUsage?: typeof usage } = {}) {
  const clock = mock.clock(on, { now: 0 })
  const w = {
    clock,
    sid: 's1',
    sent: [] as { text: string; asUser?: boolean }[],
    toasts: [] as string[],
    forks: [] as string[],
    registered: [] as string[],
    descriptions: [] as string[],
    hints: [] as string[],
    store: new Map<string, unknown>(opts.stored === undefined ? [] : [['settings', opts.stored]]),
  }
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['clawd'] }))
  // Wie die Engine die Befehlsausgabe zeichnet, wenn der Mod sie nicht übernimmt
  on('ui.render', { component: 'CommandOutput' }, ($, e) => ({ type: 'Text', props: {}, children: [`ENGINE: ${e.props.text}`] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.id', () => (w.sid === 'DENY' ? { deny: 'kaputt' } : { value: w.sid }))
  on('command.register', ($, e) => {
    w.registered.push(e.name)
    w.descriptions.push(e.description ?? '')
    w.hints.push(e.argumentHint ?? '')
    return { value: undefined }
  })
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.submit', ($, e) => {
    w.sent.push({ text: e.text, asUser: e.origin.kind === 'plugin' ? e.origin.asUser : undefined })
    if (opts.submit === 'drop') return { drop: 'blockiert' }
    return { text: e.text }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', async ($, e) => {
    w.forks.push(e.prompt)
    const kind = opts.fork ?? 'ok'
    if (kind === 'deny') return { deny: 'kein Fork' }
    if (kind === 'nothing') return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
    if (kind === 'unanswered') return { value: { isAnswered: false, reason: 'aborted', usage } }
    if (kind === 'cut') return { value: { isAnswered: false, reason: 'aborted', usage: opts.forkUsage ?? usage } }
    if (kind === 'junk') return { value: { isAnswered: true, text: 'Ich würde weitermachen.', usage } }
    if (kind === 'slow') await clock.sleep(9000)
    return { value: { isAnswered: true, text: '["Lauf die Tests","Committe das","Zeig den Diff","Push den Branch"]', usage: opts.forkUsage ?? usage } }
  })
  return w
}

const LONG = 'Ich habe die Funktion umgebaut und die Tests angepasst. Soll ich das noch committen?'
const finish = ($: Engine, answer = LONG, more: { agentId?: string; isAborted?: boolean; reason?: 'answer' | 'error'; model?: string } = {}) =>
  $.turn.complete({
    turnId: 't1',
    answer,
    durationMs: 10,
    isAborted: more.isAborted ?? false,
    reason: more.isAborted ? 'aborted' : (more.reason ?? 'answer'),
    agentId: more.agentId,
    usage: more.model ? { ...usage, model: more.model } : null,
  })
const suggest = ($: Engine, text: string) => $.prompt.suggest({ text, origin: { kind: 'suggestion' } })
const type = ($: Engine, text: string, inputText: string) =>
  $.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText })
// Prompt leeren (Backspace über alles)
const clear = ($: Engine, text: string) =>
  $.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: 0, end: text.length, inputText: '' })
const labels = async (ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) => {
  const out: string[] = []
  for (const n of [1, 2, 3, 4]) {
    const b = await ui.find({ key: `reply-${n}` })
    if (b) out.push(String(b.props.label))
  }
  return out
}

// Session starten und einmal zeichnen: erst das Band nennt die Oberfläche (Lehre 9)
async function boot($: Engine, surface: Surface = 'desktop') {
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  return $.ui.mount(band(surface))
}

test('vor dem ersten Turn und ohne Vorschlag: keine Pille, fremder Inhalt unverändert, keine zusätzliche Höhe', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await boot($, surface)
    expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['clawd'] })
    // Turn fertig, aber Claude Code schlägt nichts vor und der Fork ist aus: weiterhin nichts
    await finish($)
    await ui.find({ type: 'Text', text: 'clawd' })
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['clawd'] })
    await ui.unmount()
  }
})

test('Standard: nur der eine Vorschlag von Claude Code als einzelner Knopf, auf beiden Oberflächen; kein Fork', async ($, on) => {
  const w = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await boot($, surface)
    await finish($)
    await w.clock.advance(100)
    const r = await suggest($, 'Committe die Änderungen')
    // Der graue Vorschlag im Prompt bleibt: next(e) unverändert
    expect(r).toEqual({ isShown: true })
    expect(await labels(ui)).toEqual(['Committe die Änderungen'])
    expect((await ui.find({ key: 'reply-1' }))?.props).toMatchObject({ hotkey: '1', plain: true })
    const tree = (await ui.drawn()) as Node
    // Wurzel des Bands (band.ts): oben die eigene Ebene, darin die Pille; darunter der Grund
    expect(tree).toMatchObject({ type: 'Box', props: { key: 'band', flexDirection: 'column', justifyContent: 'flex-end' } })
    expect(tree.children[0].props).toMatchObject({ key: 'layer:20:quick-replies', flexShrink: 0 })
    const pill = tree.children[0].children[0]
    expect(pill.props).toMatchObject({ key: 'quick-replies', flexShrink: 0 })
    expect(pill.props.borderStyle).toBe(surface === 'desktop' ? 'round' : undefined)
    // theirs nie direkt in der Spalte (Lehre 4)
    expect(tree.children[1].props).toMatchObject({ key: 'band-base', flexDirection: 'row', alignItems: 'flex-end' })
    expect(tree.children[1].children[0].props).toMatchObject({ flexGrow: 1 })
    expect(tree.children[1].children[0].children[0]).toMatchObject({ type: 'Text', children: ['clawd'] })
    await ui.unmount()
  }
  expect(w.forks).toEqual([])
})

test('Vorschlag eines Plugins zählt nicht', async ($, on) => {
  world(on)
  const ui = await boot($)
  await finish($)
  await $.prompt.suggest({ text: 'Fremd', origin: { kind: 'plugin', name: 'x' } })
  expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
  await ui.unmount()
})

test('more an: Fork über den Timer nach dem Turn, Claude Code vorn, bis zu 4 im 2 × 2 (links 1/3, rechts 2/4)', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true } })
  const ui = await boot($, 'terminal')
  await finish($)
  // turn.complete wartet nicht auf den Fork: erst der Timer stößt ihn an (Lehre 12)
  expect(w.forks.length).toBe(0)
  await suggest($, 'Committe die Änderungen')
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  // Standard englisch: die Vorschläge kommen auf Englisch
  expect(w.forks[0]).toContain('JSON array')
  expect(w.forks[0]).toContain('written in English')
  expect(await labels(ui)).toEqual(['Committe die Änderungen', 'Lauf die Tests', 'Committe das', 'Zeig den Diff'])
  const pill = ((await ui.drawn()) as Node).children[0].children[0]
  expect(pill.children.length).toBe(2)
  expect(pill.children[0].children.map((c) => c.children[0].props.key)).toEqual(['reply-1', 'reply-2'])
  await ui.unmount()
  const narrow = await $.ui.mount(band('terminal', 40))
  expect(((await narrow.drawn()) as Node).children[0].children[0].children.length).toBe(4)
  await narrow.unmount()
})

test('more an: kommt der Fork vor Claude Code, rückt Claude Codes Vorschlag auf 1, die anderen rücken nach, der vierte fällt weg', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true } })
  const ui = await boot($, 'terminal')
  await finish($)
  await w.clock.advance(100)
  expect(await labels(ui)).toEqual(['Lauf die Tests', 'Committe das', 'Zeig den Diff', 'Push den Branch'])
  await suggest($, 'Committe die Änderungen')
  expect(await labels(ui)).toEqual(['Committe die Änderungen', 'Lauf die Tests', 'Committe das', 'Zeig den Diff'])
  await ui.unmount()
})

test('more gilt global: eine andere Session stellt um, diese folgt ab der nächsten Antwort', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: false } })
  const ui = await boot($)
  await finish($)
  await w.clock.advance(100)
  expect(w.forks.length).toBe(0)
  // /replies more on in einer anderen Session schreibt nur in den gemeinsamen Store
  w.store.set('settings', { enabled: true, more: true })
  await finish($)
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  w.store.set('settings', { enabled: true, more: false })
  await finish($)
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  await ui.unmount()
})

test('Fork-Fehlerpfade: Müll, keine Antwort, nichts zu forken, abgelehnt → nur Claude Codes Vorschlag, kein Toast', async ($, on) => {
  const w = world(on, { fork: 'junk', stored: { enabled: true, more: true } })
  const ui = await boot($)
  await finish($)
  await suggest($, 'Weiter')
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  expect(await labels(ui)).toEqual(['Weiter'])
  expect(w.toasts).toEqual([])
  expect(String((await $.command.run({ command: 'replies', args: '' })).text)).toContain('Fork no suggestions')
  await ui.unmount()
})

test('de: Fork verlangt deutsche Vorschläge, Status nennt den Fork-Zustand deutsch', { options: { language: 'de' } }, async ($, on) => {
  const w = world(on, { fork: 'junk', stored: { enabled: true, more: true } })
  const ui = await boot($)
  await finish($)
  await suggest($, 'Weiter')
  await w.clock.advance(100)
  expect(w.forks[0]).toContain('written in German')
  expect(String((await $.command.run({ command: 'replies', args: '' })).text)).toContain('Fork keine Vorschläge')
  await ui.unmount()
})

for (const kind of ['unanswered', 'nothing', 'deny'] as const) {
  test(`Fork ${kind} → nur Claude Codes Vorschlag, kein Wurf, kein Toast`, async ($, on) => {
    const w = world(on, { fork: kind, stored: { enabled: true, more: true } })
    const ui = await boot($)
    await finish($)
    await suggest($, 'Weiter')
    await w.clock.advance(100)
    expect(w.forks.length).toBe(1)
    expect(await labels(ui)).toEqual(['Weiter'])
    expect(w.toasts).toEqual([])
    await ui.unmount()
  })
}

test('kein Fork: aus, kurze Antwort, ohne gezeichnetes Band (-p), Subagent, Abbruch, Fehler-Turn', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: false } })
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await $.command.run({ command: 'replies', args: 'more on' })
  // ohne Band (wie -p): kein Fork
  await finish($)
  await w.clock.advance(100)
  expect(w.forks.length).toBe(0)
  const ui = await $.ui.mount(band('desktop'))
  await finish($, 'OK')
  await finish($, LONG, { agentId: 'a1' })
  await finish($, LONG, { isAborted: true })
  await finish($, LONG, { reason: 'error' })
  await w.clock.advance(100)
  expect(w.forks.length).toBe(0)
  await $.command.run({ command: 'replies', args: 'more off' })
  await finish($)
  await w.clock.advance(100)
  expect(w.forks.length).toBe(0)
  await $.command.run({ command: 'replies', args: 'more on' })
  await finish($)
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  // Ein Turn, der vor dem Timer endet, forkt für die alte Antwort nicht mehr
  await finish($)
  await $.turn.start({ turnId: 't3', text: 'noch was' })
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  await ui.unmount()
})

test('Druck sendet den vollen Text als Nachricht des Nutzers, danach ist die Pille weg bis zum nächsten Turn', async ($, on) => {
  const w = world(on)
  const ui = await boot($)
  await finish($)
  const long = 'Bitte prüfe alle Tests noch einmal sehr gründlich und berichte'
  await suggest($, long)
  expect(String((await ui.find({ key: 'reply-1' }))?.props.label).endsWith('…')).toBe(true)
  await ui.press({ key: 'reply-1' })
  expect(w.sent).toEqual([{ text: long, asUser: true }])
  expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'clawd' })).toBeDefined()
  await $.turn.start({ turnId: 't2', text: long })
  await finish($, 'Erledigt, alles grün.')
  await suggest($, 'Committe das')
  expect(await labels(ui)).toEqual(['Committe das'])
  await ui.unmount()
})

test('Senden von Claude Code abgelehnt ({ drop }) → Toast mit dem Text, Pille kommt zurück', async ($, on) => {
  const w = world(on, { submit: 'drop' })
  const ui = await boot($, 'desktop')
  await finish($)
  await suggest($, 'Run the tests')
  await ui.press({ key: 'reply-1' })
  expect(w.toasts).toEqual(['Sending failed. Please send it yourself: Run the tests'])
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  await ui.unmount()
})

test('de: Toast beim Fehlschlag deutsch', { options: { language: 'de' } }, async ($, on) => {
  const w = world(on, { submit: 'drop' })
  const ui = await boot($, 'desktop')
  await finish($)
  await suggest($, 'Lauf die Tests')
  await ui.press({ key: 'reply-1' })
  expect(w.toasts).toEqual(['Senden ging nicht. Bitte selbst senden: Lauf die Tests'])
  await ui.unmount()
})

// prompt.submit ist ein Event: Sein Stub liefert das Ergebnis des Events (docs/raw/en/test.md:110, :192); ein { deny } lässt den
// Test ab 2.1.295 scheitern (docs/SUMMARY.md:956; beobachtet: „returned neither { text } nor { drop }“). Den abgelehnten Aufruf bildet deshalb $.session.id nach, das vor dem Senden läuft: Auch das endet
// im selben .catch von send (register.ts).
test('Senden: abgelehnter Aufruf → Toast', async ($, on) => {
  const w = world(on)
  const ui = await boot($, 'desktop')
  await finish($)
  await suggest($, 'Lauf die Tests')
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  w.sid = 'DENY'
  await ui.press({ key: 'reply-1' })
  await ui.find({ type: 'Text', text: 'clawd' })
  expect(w.sent).toEqual([])
  expect(w.toasts.some((t) => t.includes('Lauf die Tests'))).toBe(true)
  await ui.unmount()
})

test('leer bei isWorking, hasSurvey, Text im Prompt, Subagent-Ansicht und /replies off', async ($, on) => {
  const w = world(on)
  await (await boot($)).unmount()
  await finish($)
  await suggest($, 'Weiter')
  for (const over of [{ isWorking: true }, { hasSurvey: true }]) {
    const ui = await $.ui.mount(band('desktop', 120, over))
    expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['clawd'] })
    await ui.unmount()
  }
  const sub = await $.ui.mount({ ...band('desktop'), props: { ...props(120), view: { agentId: 'a1' } } })
  expect(await sub.find({ key: 'reply-1' })).toBeUndefined()
  await sub.unmount()
  const ui = await $.ui.mount(band('desktop'))
  await type($, '', 'x')
  expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
  // Ein Befehl ohne Turn: danach gilt der Prompt wieder als leer
  await $.command.run({ command: 'replies', args: 'status' })
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  await $.command.run({ command: 'replies', args: 'off' })
  expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
  expect(w.store.get('settings')).toEqual({ enabled: false, more: false })
  await ui.unmount()
})

test('Ziffer als erstes Zeichen im leeren Prompt sendet den Vorschlag sofort, die Ziffer landet nicht im Prompt', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true } })
  for (const surface of ['desktop', 'terminal'] as const) {
    w.sent.length = 0
    const ui = await boot($, surface)
    await finish($)
    await suggest($, 'Committe die Änderungen')
    // über die 2 s Ruhe nach der letzten Eingabe hinaus
    await w.clock.advance(2100)
    expect(await labels(ui)).toEqual(['Committe die Änderungen', 'Lauf die Tests', 'Committe das', 'Zeig den Diff'])
    expect(await type($, '', '3')).toMatchObject({ text: '', cursor: 0 })
    await ui.find({ type: 'Text', text: 'clawd' })
    expect(w.sent).toEqual([{ text: 'Committe das', asUser: true }])
    expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
    // Pille weg bis zum nächsten Turn: Ziffern sind wieder normaler Text
    expect(await type($, '', '1')).toMatchObject({ text: '1' })
    expect(w.sent.length).toBe(1)
    await clear($, '1')
    await $.turn.start({ turnId: 't2', text: 'Committe das' })
    await ui.unmount()
  }
})

test('Ziffer lang gedrückt: die zusammengefasste Wiederholung sendet wie die einzelne Ziffer, weitere Wiederholungen landen nicht im Prompt', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true } })
  for (const surface of ['desktop', 'terminal'] as const) {
    w.sent.length = 0
    const ui = await boot($, surface)
    await finish($)
    await suggest($, 'Committe die Änderungen')
    await w.clock.advance(2100)
    expect((await labels(ui))[0]).toBe('Committe die Änderungen')
    // Taste gehalten: der Editor liefert „1111“ als eine Eingabe
    expect(await type($, '', '1111')).toMatchObject({ text: '', cursor: 0 })
    await ui.find({ type: 'Text', text: 'clawd' })
    expect(w.sent).toEqual([{ text: 'Committe die Änderungen', asUser: true }])
    // Wiederholungen danach, einzeln oder zusammengefasst, solange die Taste gehalten wird
    expect(await type($, '', '1')).toMatchObject({ text: '' })
    await w.clock.advance(1000)
    expect(await type($, '', '111')).toMatchObject({ text: '' })
    expect(w.sent.length).toBe(1)
    // losgelassen: nach der Pause ist die Ziffer wieder Text
    await w.clock.advance(1300)
    expect(await type($, '', '1')).toMatchObject({ text: '1' })
    await clear($, '1')
    await $.turn.start({ turnId: 't2', text: 'Committe die Änderungen' })
    await finish($)
    await suggest($, 'Weiter')
    await w.clock.advance(2100)
    expect((await labels(ui))[1]).toBe('Lauf die Tests')
    // Erste Wiederholung erst nach dem Senden: auch sie landet nicht im Prompt; eine andere Ziffer schon
    expect(await type($, '', '2')).toMatchObject({ text: '' })
    await ui.find({ type: 'Text', text: 'clawd' })
    expect(w.sent.length).toBe(2)
    expect(await type($, '', '2')).toMatchObject({ text: '' })
    expect(await type($, '', '1')).toMatchObject({ text: '1' })
    await clear($, '1')
    // danach zählt auch die 2 wieder als Text
    expect(await type($, '', '2')).toMatchObject({ text: '2' })
    expect(w.sent.length).toBe(2)
    await clear($, '2')
    await $.turn.start({ turnId: 't3', text: '2' })
    await ui.unmount()
  }
})

test('Ziffer lang gedrückt, Senden gescheitert: die Pille kommt zurück, aber Wiederholungen der Taste senden nicht erneut', async ($, on) => {
  const w = world(on, { submit: 'drop' })
  const ui = await boot($, 'desktop')
  await finish($)
  await suggest($, 'Run the tests')
  expect(await labels(ui)).toEqual(['Run the tests'])
  expect(await type($, '', '1')).toMatchObject({ text: '' })
  await ui.find({ type: 'Text', text: 'clawd' })
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  expect(await type($, '', '11')).toMatchObject({ text: '' })
  await w.clock.advance(1000)
  expect(await type($, '', '1')).toMatchObject({ text: '' })
  await ui.find({ type: 'Text', text: 'clawd' })
  expect(w.sent.length).toBe(1)
  expect(w.toasts.length).toBe(1)
  // losgelassen und neu gedrückt: ein neuer Versuch
  await w.clock.advance(1300)
  expect(await type($, '', '1')).toMatchObject({ text: '' })
  await ui.find({ type: 'Text', text: 'clawd' })
  expect(w.sent.length).toBe(2)
  await ui.unmount()
})

test('Ziffer bleibt normaler Text: nach anderem Text, über der Zahl der Vorschläge, eingefügt, ohne sichtbare Pille', async ($, on) => {
  const w = world(on)
  // Vorschlag da, aber das Band wurde noch nie mit Pille gezeichnet
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await finish($)
  await suggest($, 'Weiter')
  expect(await type($, '', '1')).toMatchObject({ text: '1' })
  await clear($, '1')
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  // nur ein Vorschlag: 2 ist Text
  expect(await type($, '', '2')).toMatchObject({ text: '2' })
  await clear($, '2')
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  // eingefügt oder mehrere Zeichen auf einmal: Text
  expect(await type($, '', '12')).toMatchObject({ text: '12' })
  await clear($, '12')
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  // Ziffer nach Text: Text
  await type($, '', 'a')
  expect(await type($, 'a', '1')).toMatchObject({ text: 'a1' })
  await clear($, 'a1')
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  // Claude arbeitet: keine Pille, also auch kein Senden
  await ui.unmount()
  const busy = await $.ui.mount(band('desktop', 120, { isWorking: true }))
  await busy.find({ type: 'Text', text: 'clawd' })
  expect(await type($, '', '1')).toMatchObject({ text: '1' })
  await busy.unmount()
  expect(w.sent).toEqual([])
})

test('Stabilität: späte Vorschläge innerhalb von 2 s nach einer Eingabe werden verzögert', async ($, on) => {
  const w = world(on, { fork: 'slow', stored: { enabled: true, more: true } })
  const ui = await boot($)
  await finish($)
  await suggest($, 'Weiter')
  await w.clock.advance(100)
  expect(await labels(ui)).toEqual(['Weiter'])
  // Der Nutzer tippt kurz vor dem Eintreffen der Fork-Antwort (nach 9 s) etwas und löscht es wieder
  await w.clock.advance(8000)
  await type($, '', 'x')
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'x', cursor: 1, start: 0, end: 1, inputText: '' })
  await w.clock.advance(1500)
  expect(await labels(ui)).toEqual(['Weiter'])
  await w.clock.advance(600)
  expect(await labels(ui)).toEqual(['Weiter', 'Lauf die Tests', 'Committe das', 'Zeig den Diff'])
  await ui.unmount()
})

test('/clear: neue Session-ID ohne session.start verwirft den alten Vorschlag', async ($, on) => {
  const w = world(on)
  const ui = await boot($, 'terminal')
  await finish($)
  await suggest($, 'Weiter')
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  await ui.unmount()
  w.sid = 's2'
  const again = await $.ui.mount(band('terminal'))
  expect(await again.find({ key: 'reply-1' })).toBeUndefined()
  await again.unmount()
})

test('eigener Fehler beim Zeichnen → Bandinhalt unverändert, Clawd bleibt', async ($, on) => {
  const w = world(on)
  await (await boot($, 'terminal')).unmount()
  await finish($)
  await suggest($, 'Weiter')
  w.sid = 'DENY'
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
  expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['clawd'] })
  await ui.unmount()
})

const REPLIES = {
  en: { head: 'quick-replies: off · more suggestions via fork off', surface: 'Surface: desktop', on: 'quick-replies on', moreOn: 'via fork on', moreOff: 'more suggestions off', usage: 'Usage', registered: 'Reply suggestions above Clawd' },
  de: { head: 'quick-replies: aus · weitere Vorschläge per Fork aus', surface: 'Oberfläche: desktop', on: 'quick-replies an', moreOn: 'per Fork an', moreOff: 'weitere Vorschläge aus', usage: 'Nutzung', registered: 'Antwort-Vorschläge über Clawd' },
} as const

for (const language of ['en', 'de'] as const) {
  test(`/replies status, on, off, more on|off, Hilfe (${language}); session.start registriert und lädt die Einstellungen`, { options: { language } }, async ($, on) => {
    const x = REPLIES[language]
    const w = world(on, { stored: { enabled: false, more: false } })
    await boot($)
    expect(w.registered).toEqual(['replies'])
    expect(w.descriptions[0]).toContain(x.registered)
    const run = async (args: string) => String((await $.command.run({ command: 'replies', args })).text)
    expect(await run('')).toContain(x.head)
    expect(await run('status')).toContain(x.surface)
    expect(await run('on')).toBe(x.on)
    expect(await run('more on')).toContain(x.moreOn)
    expect(w.store.get('settings')).toEqual({ enabled: true, more: true })
    expect(await run('more off')).toContain(x.moreOff)
    expect(await run('quatsch')).toContain(x.usage)
    // Argumente sind englisch, in beiden Sprachen; das frühere deutsche `mehr` gibt es seit 0.1.0 nicht mehr
    expect(await run('mehr on')).toContain(x.usage)
  })
}

type Origin = { kind: 'composer' | 'sdk' | 'bridge' | 'peer' } | { kind: 'plugin'; name: string; asUser: boolean }
const submit = ($: Engine, text: string, more: { origin?: Origin; turnId?: string; image?: boolean } = {}) =>
  $.prompt.submit({
    text,
    wait: false,
    turnId: more.turnId,
    origin: more.origin ?? { kind: 'composer' },
    ...(more.image ? { attachments: [{ type: 'image', mediaType: 'image/png', data: 'AA==' }] } : {}),
  } as Parameters<Engine['prompt']['submit']>[0])

test('Ziffer allein abgeschickt: der Vorschlag mit dieser Nummer geht stattdessen raus (Terminal und Desktop)', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true } })
  for (const [surface, kind] of [['desktop', 'sdk'], ['terminal', 'composer']] as const) {
    w.sent.length = 0
    const ui = await boot($, surface)
    await finish($)
    await suggest($, 'Committe die Änderungen')
    await w.clock.advance(2100)
    expect(await labels(ui)).toEqual(['Committe die Änderungen', 'Lauf die Tests', 'Committe das', 'Zeig den Diff'])
    expect(await submit($, ' 2 ', { origin: { kind } })).toMatchObject({ text: 'Lauf die Tests' })
    expect(w.sent).toEqual([{ text: 'Lauf die Tests', asUser: undefined }])
    expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
    // höchstens einmal pro Turn: die nächste 1 ist wieder Text
    expect(await submit($, '1', { origin: { kind } })).toMatchObject({ text: '1' })
    await $.turn.start({ turnId: 't2', text: 'Lauf die Tests' })
    // Taste gehalten, dann abgeschickt: „1111“ zählt wie „1“
    await finish($)
    await suggest($, 'Committe die Änderungen')
    await w.clock.advance(2100)
    expect((await labels(ui))[0]).toBe('Committe die Änderungen')
    expect(await submit($, '1111', { origin: { kind } })).toMatchObject({ text: 'Committe die Änderungen' })
    await $.turn.start({ turnId: 't3', text: 'Committe die Änderungen' })
    await ui.unmount()
  }
})

test('Ziffer allein abgeschickt bleibt Text: ohne Vorschlag, über der Zahl, mehr Text, mitten im Turn, Anhang, fremde Herkunft, aus, /clear', async ($, on) => {
  const w = world(on)
  // vor dem ersten Turn
  const ui = await boot($, 'desktop')
  expect(await submit($, '1')).toMatchObject({ text: '1' })
  await finish($)
  await suggest($, 'Weiter')
  expect(await labels(ui)).toEqual(['Weiter'])
  expect(await submit($, '2')).toMatchObject({ text: '2' })
  expect(await submit($, '1 bitte')).toMatchObject({ text: '1 bitte' })
  expect(await submit($, '12')).toMatchObject({ text: '12' })
  expect(await submit($, '22')).toMatchObject({ text: '22' })
  expect(await submit($, '1', { turnId: 't1' })).toMatchObject({ text: '1' })
  expect(await submit($, '1', { image: true })).toMatchObject({ text: '1' })
  expect(await submit($, '1', { origin: { kind: 'peer' } })).toMatchObject({ text: '1' })
  // Remote Control (Telefon, Web) zeigt die Pille nicht
  expect(await submit($, '1', { origin: { kind: 'bridge' } })).toMatchObject({ text: '1' })
  // die eigene Sendung eines Vorschlags, der selbst eine Ziffer ist, bleibt, wie sie ist
  expect(await submit($, '1', { origin: { kind: 'plugin', name: 'quick-replies', asUser: true } })).toMatchObject({ text: '1' })
  await $.command.run({ command: 'replies', args: 'off' })
  expect(await submit($, '1')).toMatchObject({ text: '1' })
  await $.command.run({ command: 'replies', args: 'on' })
  // Session-ID nicht lesbar: lieber die Ziffer als einen womöglich fremden Vorschlag
  w.sid = 'DENY'
  expect(await submit($, '1')).toMatchObject({ text: '1' })
  w.sid = 's2'
  expect(await submit($, '1')).toMatchObject({ text: '1' })
  expect(w.sent.map((s) => s.text)).toEqual(['1', '2', '1 bitte', '12', '22', '1', '1', '1', '1', '1', '1', '1', '1'])
  await ui.unmount()
})

test('Ziffer allein abgeschickt: nur ein Vorschlag, der zu sehen war (kam er erst nach der getippten Ziffer, bleibt sie Text)', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true } })
  const ui = await boot($, 'desktop')
  await finish($)
  // Ziffer getippt, bevor ein Vorschlag da ist: bleibt im Prompt, die Pille ist ausgeblendet
  expect(await type($, '', '1')).toMatchObject({ text: '1' })
  await suggest($, 'Committe das')
  await w.clock.advance(2100)
  expect(await ui.find({ key: 'reply-1' })).toBeUndefined()
  expect(await submit($, '1', { origin: { kind: 'sdk' } })).toMatchObject({ text: '1' })
  expect(w.sent.map((s) => s.text)).toEqual(['1'])
  await ui.unmount()
})

test('Ziffer allein abgeschickt, von einem Hook weiter innen gestoppt: die Pille kommt zurück', async ($, on) => {
  const w = world(on, { submit: 'drop' })
  const ui = await boot($, 'desktop')
  await finish($)
  await suggest($, 'Committe das')
  expect(await labels(ui)).toEqual(['Committe das'])
  expect(await submit($, '1', { origin: { kind: 'sdk' } })).toMatchObject({ drop: 'blockiert' })
  expect(w.sent.map((s) => s.text)).toEqual(['Committe das'])
  expect(await labels(ui)).toEqual(['Committe das'])
  await ui.unmount()
})

test('Ziffer allein abgeschickt: ohne gezeichnetes Band (-p) bleibt sie Text', async ($, on) => {
  world(on)
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await finish($)
  await suggest($, 'Weiter')
  expect(await submit($, '1', { origin: { kind: 'sdk' } })).toMatchObject({ text: '1' })
})

test('nach /clear sendet ein Druck nicht den Vorschlag des alten Chats', async ($, on) => {
  const w = world(on)
  const ui = await boot($, 'desktop')
  await finish($)
  await suggest($, 'Committe das')
  expect(await ui.find({ key: 'reply-1' })).toBeDefined()
  // Im Desktop prüft das Zeichnen die Session-ID nur gedrosselt; der Druck prüft sie immer
  w.sid = 's2'
  await ui.press({ key: 'reply-1' })
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

// ---- Reihenfolge der Mods (band.ts, docs/BAND.md): das Band sieht immer gleich aus, egal wer in der Kette außen liegt

type Tier = 'prepend' | 'append'
// Partner-Mods laufen in eigener Umgebung (keine Importe aus dem Test): darum hier eine knappe eigene Fassung des Protokolls,
// so wie ein anderer Mod es nach docs/BAND.md umsetzen würde
// Wie limit-bars: Balken links neben den Grund, Ebenen bleiben oben
const bars = (tier: Tier) => ({
  name: `bars-${tier}`,
  tier,
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      type N = { props?: Record<string, unknown>; children?: unknown[] }
      const key = (n: unknown) => String((n as N)?.props?.key ?? '')
      const layers: unknown[] = []
      const lift = (n: unknown): unknown => {
        if (!n || typeof n !== 'object') return n
        if (key(n).startsWith('layer:')) return (layers.push(n), null)
        if (key(n) === 'band') {
          for (const c of (n as N).children ?? []) if (key(c).startsWith('layer:')) layers.push(c)
          const wrap = ((n as N).children ?? []).find((c) => key(c) === 'band-base') as N | undefined
          return lift((wrap?.children?.[0] as N | undefined)?.children?.[0] ?? null)
        }
        return Array.isArray((n as N).children) ? { ...(n as N), children: (n as N).children!.map(lift).filter((c) => c !== null) } : n
      }
      const base = lift(await next(e))
      const mine = { type: 'Box', props: { key: 'limit-bars' }, children: ['5h 7d'] }
      const row = { type: 'Box', props: { flexDirection: 'row' }, children: base ? [mine, base] : [mine] }
      if (layers.length === 0) return row as RenderNode
      layers.sort((a, b) => Number(key(b).split(':')[1]) - Number(key(a).split(':')[1]))
      const ground = { type: 'Box', props: { key: 'band-base', flexDirection: 'row' }, children: [{ type: 'Box', props: { flexGrow: 1 }, children: [row] }] }
      return { type: 'Box', props: { key: 'band', flexDirection: 'column' }, children: [...layers, ground] } as RenderNode
    })
  },
})
// Wie sidekick während der Übergabe: oberste Ebene, Quick-Replies ausgeblendet
const busy = (tier: Tier) => ({
  name: `busy-${tier}`,
  tier,
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      type N = { props?: Record<string, unknown>; children?: unknown[] }
      const key = (n: unknown) => String((n as N)?.props?.key ?? '')
      const theirs = (await next(e)) as N
      const box = { type: 'Box', props: { key: 'layer:30:sidekick', flexDirection: 'column' }, children: [{ type: 'Box', props: { key: 'sidekick-busy' }, children: ['sidekick'] }] }
      // Liegt schon eine Wurzel vor: Pille raus, eigene Ebene obenauf; sonst eine neue Wurzel über dem Grund
      if (key(theirs) === 'band') {
        const kids = (theirs.children ?? []).filter((c) => key(c) !== 'layer:20:quick-replies')
        return { ...theirs, children: [box, ...kids] } as RenderNode
      }
      const ground = { type: 'Box', props: { key: 'band-base', flexDirection: 'row' }, children: [{ type: 'Box', props: { flexGrow: 1 }, children: [theirs] }] }
      return { type: 'Box', props: { key: 'band', flexDirection: 'column' }, children: [box, ground] } as RenderNode
    })
  },
})
const keys = (n: Node): string[] => (n && typeof n === 'object' ? [String(n.props?.key ?? ''), ...(n.children ?? []).flatMap(keys)] : [])

for (const tier of ['prepend', 'append'] as const) {
  test(`Reihenfolge: Balken ${tier === 'prepend' ? 'außen' : 'innen'} → Pille über Balken und Clawd, nie daneben`, { plugins: [bars(tier)] }, async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await boot($, surface)
      await finish($)
      await suggest($, 'Committe die Änderungen')
      const tree = (await ui.drawn()) as Node
      expect(tree.props.key).toBe('band')
      expect(tree.children.length).toBe(2)
      expect(tree.children[0].props.key).toBe('layer:20:quick-replies')
      // Der Grund: Balken und Clawd in einer Zeile, die Pille steckt nicht darin
      const ground = keys(tree.children[1])
      expect(ground).toContain('limit-bars')
      expect(ground).not.toContain('quick-replies')
      expect(JSON.stringify(tree.children[1])).toContain('clawd')
      await ui.unmount()
    }
  })
}

for (const [qrTier, skTier] of [['prepend', 'append'], ['append', 'prepend']] as const) {
  test(`Reihenfolge: sidekick ${skTier === 'prepend' ? 'außen' : 'innen'}, Balken ${qrTier === 'prepend' ? 'außen' : 'innen'} → sidekick zuoberst, Pille ausgeblendet`, { plugins: [bars(qrTier), busy(skTier)] }, async ($, on) => {
    world(on)
    const ui = await boot($, 'desktop')
    await finish($)
    await suggest($, 'Committe die Änderungen')
    const tree = (await ui.drawn()) as Node
    expect(tree.props.key).toBe('band')
    // sidekick rückt auf die Höhe der Pille: direkt über dem Grund
    expect(tree.children.map((c) => c.props.key)).toEqual(['layer:30:sidekick', 'band-base'])
    expect(keys(tree)).not.toContain('quick-replies')
    expect(keys(tree.children[1])).toContain('limit-bars')
    await ui.unmount()
  })
}

test('band.ts: höchste Ebene oben, ohne Ebenen bleibt der Grund unverändert, eine fremde Hülle gibt ihre Ebenen frei', () => {
  const ground = { type: 'Text', props: {}, children: ['clawd'] } as RenderNode
  expect(joinBand([], ground)).toBe(ground)
  expect(splitBand(ground)).toEqual({ layers: [], base: ground })
  const a = layer(20, 'quick-replies', 'A')
  const b = layer(30, 'sidekick', 'B')
  const joined = joinBand([a, b], ground) as Node
  expect(joined.children.map((c) => c.props.key)).toEqual(['layer:30:sidekick', 'layer:20:quick-replies', 'band-base'])
  // Ein Mod ohne Protokoll packt die Wurzel in seine Zeile: die Ebenen kommen trotzdem heraus, der Grund bleibt in der Hülle
  const foreign = { type: 'Box', props: { flexDirection: 'row' }, children: ['x', joined] } as RenderNode
  const s = splitBand(foreign)
  expect(s.layers.map(nameOf)).toEqual(['sidekick', 'quick-replies'])
  expect(s.base).toEqual({ type: 'Box', props: { flexDirection: 'row' }, children: ['x', ground] })
  expect(levelOf(a)).toBe(20)
  expect(levelOf(ground)).toBe(-1)
  expect(joinBand([a], null)).toMatchObject({ props: { key: 'band' }, children: [a] })
})

test('Kostenzeile: Fork-Aufrufe dieses Chats mit geschätztem API-Wert, nach /clear wieder leer', async ($, on) => {
  // 1000 Input, 38k aus dem Cache, 50 Output auf Opus 5.5: (1000 × 4 + 38000 × 0,2 + 50 × 20) / 1e6 = 0,0126 $
  const forkUsage = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 38000, cache_creation_input_tokens: 0 }
  const w = world(on, { stored: { enabled: true, more: true }, forkUsage })
  const ui = await boot($, 'terminal')
  const status = async () => String((await $.command.run({ command: 'replies', args: '' })).text)
  expect(await status()).toContain('Fork in this chat: –')
  await finish($, LONG, { model: 'claude-opus-5-5' })
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  expect(await status()).toContain('Fork in this chat: 1× · ~$0.013 (API price, estimated; on a subscription it counts toward the usage limits) · 39k tokens, 97 % from cache')
  await $.turn.start({ turnId: 't2', text: 'weiter' })
  await finish($, LONG, { model: 'claude-opus-5-5' })
  await w.clock.advance(100)
  expect(await status()).toContain('Fork in this chat: 2× · ~$0.025')
  // /clear: neue Session-ID, der nächste Turn zählt neu
  w.sid = 's2'
  await finish($, LONG, { model: 'claude-opus-5-5' })
  expect(await status()).toContain('Fork in this chat: –')
  await ui.unmount()
})

test('Kostenzeile 0.4.3: Haiku-5.5-Session, Fork mit 120k Prompt-Tokens bleibt auf der günstigen Stufe (Summe, kein Einzelaufruf)', async ($, on) => {
  // (10000 × 0,1 + 100000 × 0,01 + 10000 × 0,1 × 1,25 + 1000 × 0,5) / 1e6 = 0,00375 $; fünffach wären es 0,019 $
  const forkUsage = { input_tokens: 10_000, output_tokens: 1000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 10_000 }
  const w = world(on, { stored: { enabled: true, more: true }, forkUsage })
  const ui = await boot($, 'terminal')
  await finish($, LONG, { model: 'claude-haiku-5-5' })
  await w.clock.advance(100)
  expect(String((await $.command.run({ command: 'replies', args: '' })).text)).toContain('Fork in this chat: 1× · ~$0.004 ')
  await ui.unmount()
})

test('Kostenzeile de', { options: { language: 'de' } }, async ($, on) => {
  const forkUsage = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 38000, cache_creation_input_tokens: 0 }
  const w = world(on, { stored: { enabled: true, more: true }, forkUsage })
  const ui = await boot($, 'terminal')
  await finish($, LONG, { model: 'claude-opus-5-5' })
  await w.clock.advance(100)
  expect(String((await $.command.run({ command: 'replies', args: '' })).text)).toContain(
    'Fork in diesem Chat: 1× · ~0,013 $ (API-Preis, geschätzt; im Abo zählt es gegen die Nutzungslimits) · 39k Tokens, 97 % aus dem Cache',
  )
  await ui.unmount()
})

test('Kostenzeile: „nothing-to-fork“ zählt nicht', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true }, fork: 'nothing' })
  const ui = await boot($, 'terminal')
  await finish($)
  await w.clock.advance(100)
  expect(w.forks.length).toBe(1)
  expect(String((await $.command.run({ command: 'replies', args: '' })).text)).toContain('Fork in this chat: –')
  await ui.unmount()
})

test('Kostenzeile: zählt einen abgelösten oder abgebrochenen Fork, nicht einen, der nach /clear zurückkommt', async ($, on) => {
  const forkUsage = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 38000, cache_creation_input_tokens: 0 }
  const status = async () => String((await $.command.run({ command: 'replies', args: '' })).text)
  {
    // Turn abgelöst, während der Fork läuft: die Tokens sind verbraucht und zählen
    const w = world(on, { stored: { enabled: true, more: true }, forkUsage, fork: 'slow' })
    const ui = await boot($, 'terminal')
    await finish($, LONG, { model: 'claude-opus-5-5' })
    await w.clock.advance(100)
    await $.turn.start({ turnId: 't2', text: 'weiter' })
    await w.clock.advance(9000)
    expect(await status()).toContain('Fork in this chat: 1× · ~$0.013')
    // Kommt der Fork erst nach /clear zurück, gehört er zum alten Chat
    await finish($, LONG, { model: 'claude-opus-5-5' })
    await w.clock.advance(100)
    w.sid = 's2'
    await finish($, LONG, { model: 'claude-opus-5-5' })
    await w.clock.advance(100)
    expect(await status()).toContain('Fork in this chat: –')
    await w.clock.advance(9000)
    // Nur der Fork des neuen Chats zählt
    expect(await status()).toContain('Fork in this chat: 1×')
    await ui.unmount()
  }
})

test('Kostenzeile: abgebrochener Fork zählt, was vor dem Abbruch kam; direkt nach /clear zeigt der Status –; kleine Werte', async ($, on) => {
  const w = world(on, { stored: { enabled: true, more: true }, fork: 'cut' })
  const ui = await boot($, 'terminal')
  await finish($, LONG, { model: 'claude-opus-5-5' })
  await w.clock.advance(100)
  // Stub-Usage: 1 Input, 1 Output → 24 µ$, 2 Tokens
  const text = String((await $.command.run({ command: 'replies', args: '' })).text)
  expect(text).toContain('Fork in this chat: 1× · <$0.001')
  expect(text).toContain('· 2 tokens, 0 % from cache')
  w.sid = 's2'
  expect(String((await $.command.run({ command: 'replies', args: '' })).text)).toContain('Fork in this chat: –')
  await ui.unmount()
})

// ---------- 0.5.0: /replies help (docs/HELP-SPEC.md §6) ----------

const ACCENT = 'autoAccept'
const DE = { options: { language: 'de' } }
const replies = async ($: Engine, args: string) => String((await $.command.run({ command: 'replies', args })).text)
const mountHelp = ($: Engine, text: string, surface: string, columns = 120, isErrored = false, args = 'help') =>
  $.ui.mount({
    plugin: 'quick-replies',
    component: 'CommandOutput',
    requestId: `help-${surface}-${columns}-${isErrored}-${args}`,
    surface,
    viewport: { columns, rows: 40 },
    props: { command: 'replies', args, text, isErrored },
  } as Parameters<Engine['ui']['mount']>[0])

test('0.5.0 Hilfe: help, ? und HELP liefern Markdown mit Kennung; argumentHint und Nutzung nennen help; weitere Wörter sind unbekannt', async ($, on) => {
  const w = world(on)
  await boot($)
  expect(w.hints[0]).toBe('[status|on|off|more on|more off|help]')
  // Nutzungszeile und argumentHint laufen nicht auseinander (beide Sprachen)
  for (const lang of ['en', 'de'] as const) expect(T[lang].usage, lang).toContain(`/replies ${w.hints[0]}`)
  for (const word of ['help', '?', 'HELP', ' help ']) {
    const text = await replies($, word)
    expect(text, word).toMatch(/^\*\*quick-replies · Help\*\* · #[0-9a-z]{5,}\n\nShows Claude Code's own suggestion/)
    expect(text.length < 10_000, word).toBe(true)
  }
  // jede Hilfe bekommt eine eigene Kennung
  expect((await replies($, 'help')).split('\n')[0]).not.toBe((await replies($, 'help')).split('\n')[0])
  for (const bad of ['help me', 'quatsch', 'status x'])
    expect(await replies($, bad), bad).toBe('Usage: /replies [status|on|off|more on|more off|help] · All commands: /replies help')
})

test('0.5.0 Hilfe (de): Markdown mit Befehlen, Bedienung, Funktionen, Einstellungen und Terminal-Fußzeile', DE, async ($, on) => {
  world(on, { stored: { enabled: true, more: false } })
  await boot($)
  const text = await replies($, 'help')
  const lines = text.split('\n')
  expect(lines[0]).toMatch(/^\*\*quick-replies · Hilfe\*\* · #[0-9a-z]{5,}$/)
  expect(lines).toContain('**BEFEHLE**')
  expect(lines).toContain('- `/replies more on`: Weitere Vorschläge per Fork, bis zu vier insgesamt, in allen Sessions')
  expect(lines).toContain('- `/replies help`: Diese Hilfe (auch: ?)')
  expect(lines).toContain('**BEDIENUNG**')
  expect(lines).toContain('- `1–4 im leeren Prompt`: Sendet diesen Vorschlag sofort; die Ziffer bleibt nicht im Prompt')
  expect(text).toMatch(/^Fork: kostet pro Antwort etwa eine kurze Antwort/m)
  expect(text).toMatch(/^\*\*FUNKTIONEN:\*\* Vorschläge ● an \(\/replies off\) · Mehr per Fork ○ aus \(\/replies more on\) · Anordnung auto \(Standard\) \(Einstellung\)$/m)
  expect(text).toMatch(/^\*\*EINSTELLUNGEN \(\/plugin\):\*\* Sprache de · Mehr Vorschläge per Fork aus \(Standard\) · Anordnung auto \(Standard\)$/m)
  expect(lines[lines.length - 1]).toBe('Einstellungen ändern: /plugin configure quick-replies · Mod abschalten: /plugin disable quick-replies')
  expect(await replies($, 'quatsch')).toBe('Nutzung: /replies [status|on|off|more on|more off|help] · Alle Befehle: /replies help')
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`0.5.0 Hilfe UI ${surface}: Tabelle mit Titel, Abschnitten, Befehlen in Violett, Schaltern und passender Fußzeile`, DE, async ($, on) => {
    world(on, { stored: { enabled: true, more: false } })
    await boot($)
    const ui = await mountHelp($, await replies($, 'help'), surface)
    expect(await ui.find({ text: /^ENGINE:/ })).toBeUndefined()
    const tree = await ui.drawn()
    expect(tree.props).toMatchObject({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%', key: 'quick-replies-help' })
    expect((await ui.find({ type: 'Text', text: 'quick-replies · Hilfe' }))?.props).toMatchObject({ color: ACCENT, bold: true })
    for (const h of ['BEFEHLE', 'BEDIENUNG', 'FUNKTIONEN', 'STATUS', 'UMSCHALTEN', 'EINSTELLUNGEN (/plugin)', 'WERT'])
      expect((await ui.find({ type: 'Text', text: h }))?.props.color, h).toBe(ACCENT)
    for (const cmd of ['/replies status', '/replies on', '/replies off', '/replies more on', '/replies more off', '/replies help', 'Klick auf einen Vorschlag', '1–4 im leeren Prompt', 'Nur 1–4 abschicken'])
      expect((await ui.find({ type: 'Text', text: cmd }))?.props.color, cmd).toBe(ACCENT)
    // Akzentfarbe nur für Titel, Überschriften und Befehle, nie für Fließtext
    expect((await ui.find({ type: 'Text', text: /^Zeigt den Vorschlag/ }))?.props.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'Vorschläge einschalten' }))?.props.color).toBeUndefined()
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some((x: any) => x.children?.[0] === '● ' && x.props.color === 'success')).toBe(true)
    expect(texts.some((x: any) => x.children?.[0] === '○ ' && x.props.color === 'inactive')).toBe(true)
    // „● an“ ganz in success (Vorlage 3ad541e)
    expect(texts.some((x: any) => x.children?.[0] === 'an' && x.props.color === 'success')).toBe(true)
    expect(await ui.find({ type: 'Text', text: ' (Standard)' })).toBeDefined()
    const footer =
      surface === 'desktop'
        ? 'Mod abschalten: + → Plugins → Manage plugins · Einstellungen ändern: im Terminal /plugin configure quick-replies'
        : 'Einstellungen ändern: /plugin configure quick-replies · Mod abschalten: /plugin disable quick-replies'
    expect(await ui.find({ type: 'Text', text: footer })).toBeDefined()
    await ui.unmount()
  })

test('0.5.0 Hilfe UI: VS Code, mobil, Fehlerzeile, Status und unbekannte Kennung → Engine; Kennung hinter „quick-replies: “ wird gefunden', async ($, on) => {
  world(on)
  await boot($)
  const text = await replies($, 'help')
  for (const surface of ['vscode', 'mobile']) {
    const ui = await mountHelp($, text, surface)
    expect(await ui.find({ text: /^ENGINE:/ }), surface).toBeDefined()
    await ui.unmount()
  }
  const errored = await mountHelp($, text, 'terminal', 100, true)
  expect(await errored.find({ text: /^ENGINE:/ })).toBeDefined()
  await errored.unmount()
  const unknown = await mountHelp($, '**quick-replies · Help** · #zzzzzz', 'desktop')
  expect(await unknown.find({ text: /^ENGINE:/ })).toBeDefined()
  await unknown.unmount()
  const status = await mountHelp($, await replies($, 'status'), 'terminal')
  expect(await status.find({ text: /^ENGINE:/ })).toBeDefined()
  await status.unmount()
  const prefixed = await mountHelp($, `quick-replies: ${text}`, 'terminal')
  expect(await prefixed.find({ type: 'Text', text: 'quick-replies · Help' })).toBeDefined()
  await prefixed.unmount()
  // Nur die Ausgabe von help bzw. ?: eine gültige Kennung bei anderen Argumenten zeichnet nichts (Review worklist, K2)
  const tag = /#[0-9a-z]{5,}/.exec(text)![0]
  // echter Fall: /replies #<Kennung> antwortet mit der Nutzungszeile, ohne Kennung
  const real = await replies($, tag)
  expect(real.startsWith('Usage:')).toBe(true)
  const realUi = await mountHelp($, real, 'desktop', 120, false, tag)
  expect(await realUi.find({ text: /^ENGINE:/ })).toBeDefined()
  await realUi.unmount()
  for (const args of [tag, 'status', 'help me', ''])
    for (const surface of ['terminal', 'desktop']) {
      const other = await mountHelp($, text, surface, 120, false, args)
      expect(await other.find({ text: /^ENGINE:/ }), `${surface} „${args}“`).toBeDefined()
      await other.unmount()
    }
  for (const args of ['?', ' HELP '])
    for (const surface of ['terminal', 'desktop']) {
      const alias = await mountHelp($, text, surface, 120, false, args)
      expect(await alias.find({ type: 'Text', text: 'quick-replies · Help' }), `${surface} „${args}“`).toBeDefined()
      await alias.unmount()
    }
})

test('0.5.0 Hilfe: Zustand beim Aufruf: off → ○ mit /replies on, more on → ● mit /replies more off; Einstellungen aus userConfig', { options: { more: true, layout: 'grid' } }, async ($, on) => {
  world(on)
  await boot($)
  await replies($, 'off')
  await replies($, 'more on')
  const text = await replies($, 'help')
  const ui = await mountHelp($, text, 'terminal')
  expect(await ui.find({ type: 'Text', text: '/replies on' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/replies more off' })).toBeDefined()
  // „an (pausiert)“: eigener Text in der normalen Schriftfarbe, nur der Punkt grün
  expect((await ui.find({ type: 'Text', text: 'on (paused)' }))?.props.color).toBeUndefined()
  await ui.unmount()
  expect(text).toMatch(/Suggestions ○ off \(\/replies on\) · More via fork ● on \(paused\) \(\/replies more off\) · Layout grid \(setting\)/)
  expect(text).toMatch(/\*\*SETTINGS \(\/plugin\):\*\* Language en \(default\) · More suggestions via fork on · Layout grid$/m)
  // Status = Stand beim Aufruf: die alte Zeichnung bleibt, eine neue zeigt den neuen Stand
  await replies($, 'on')
  const old = await mountHelp($, text, 'desktop')
  expect(await old.find({ text: /○/ })).toBeDefined()
  await old.unmount()
  expect(await replies($, 'help')).toMatch(/Suggestions ● on \(\/replies off\)/)
})

test('0.5.0 Hilfe: höchstens 10 Schnappschüsse, der älteste fällt heraus', async ($, on) => {
  world(on)
  await boot($)
  const first = await replies($, 'help')
  for (let i = 0; i < 10; i++) await replies($, 'help')
  const gone = await mountHelp($, first, 'terminal')
  expect(await gone.find({ text: /^ENGINE:/ })).toBeDefined()
  await gone.unmount()
})

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of [30, 40, 59, 60, 100, 140, 200])
    test(`0.5.0 Hilfe UI ${surface} bei ${columns} Spalten: nichts zu breit, Desktop nur ganzzahlige Prozent`, DE, async ($, on) => {
      world(on)
      await boot($)
      const ui = await mountHelp($, await replies($, 'help'), surface, columns)
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
      expect(await ui.find({ type: 'Text', text: '/replies more off' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Mehr Vorschläge per Fork' })).toBeDefined()
      await ui.unmount()
    })

test('0.5.0 Hilfe Vollständigkeit: jedes Wort, das der Parser annimmt, steht in der Hilfe (HELP-SPEC §6 Punkt 5)', () => {
  for (const lang of ['en', 'de'] as const) {
    const d = repliesHelp({ lang, enabled: true, more: false, config: { more: false, layout: 'auto' } })
    const cmds = d.commands.map((c) => c.cmd)
    // ganze Wörter, keine Teilstrings: sonst steckt „on“ in „configure“ (templates/help/README.md, Tests)
    const words = (s: string) => s.split(/[^\p{L}\p{N}?]+/u).filter(Boolean)
    const help = new Set([...d.commands.flatMap((c) => [c.cmd, c.does]), ...(d.notes ?? [])].flatMap(words))
    for (const word of [...STATUS_WORDS, ...TOGGLE_WORDS, MORE_WORD, ...HELP_WORDS]) expect(help.has(word), `${lang}: ${word}`).toBe(true)
    for (const word of STATUS_WORDS) expect(cmds, `${lang}: ${word}`).toContain(`/replies ${word}`)
    expect(cmds, lang).toContain(`/replies ${HELP_WORDS[0]}`)
    // Aliase der Hilfe stehen als eigenes Wort in ihrer Zeile
    const helpRow = d.commands.find((c) => c.cmd === `/replies ${HELP_WORDS[0]}`)!.does
    for (const word of HELP_WORDS.slice(1)) expect(words(helpRow), `${lang}: ${word}`).toContain(word)
    for (const word of TOGGLE_WORDS) {
      expect(cmds, `${lang}: ${word}`).toContain(`/replies ${word}`)
      expect(cmds, `${lang}: more ${word}`).toContain(`/replies ${MORE_WORD} ${word}`)
    }
    expect(d.controls?.length).toBe(3)
    expect(d.settings.map((s) => s.value)).toEqual([lang, lang === 'en' ? 'off' : 'aus', 'auto'])
  }
})
