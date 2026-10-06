// clawd-buddy: Tests des Mods (Hooks-Modul + Client-Modul) nach SPEC.md → Tests. Animationsdaten und Engine testet anim.test.ts.
import { expect, mock, test } from 'claude-code/testing'
import { LONG_TURN_MS, NO_FACTS, NO_STRAIN, SETBACK, addHit, ctxLevel, deriveMood, deriveTemper, shellKind, sidekickValue, specialDay, strainTurnEnd, strainTurnStart, toolKind } from '../hooks/mood.ts'
import { ALL_CLIPS } from '../hooks/library.ts'
import { CLIP_EN, T, clipLabel, langOf, num } from '../hooks/i18n.ts'
import type { Facts, Strain } from '../hooks/mood.ts'

const BAND = {
  plugin: 'clawd-buddy',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 30, isFullscreen: true },
  props: { hasSurvey: false, isWorking: false, maxRows: 7, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 }, view: {} },
} as const

/** Stubs für Speicher und Log; liefert, was der Mod gespeichert und geloggt hat. */
const LAYERED = (ground: unknown) => ({
  type: 'Box',
  props: { key: 'band', flexDirection: 'column', justifyContent: 'flex-end' },
  children: [
    { type: 'Box', props: { key: 'layer:20:quick-replies', flexDirection: 'column', flexShrink: 0 }, children: [{ type: 'Box', props: { key: 'quick-replies' }, children: ['Pille'] }] },
    { type: 'Box', props: { key: 'band-base', flexDirection: 'row', alignItems: 'flex-end' }, children: [{ type: 'Box', props: { flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end' }, children: [ground] }] },
  ],
})

function stubs(on: any, initial: Record<string, unknown> = {}, layered = false) {
  const store = new Map<string, unknown>(Object.entries(initial))
  const logs: string[] = []
  on('store.get', ($: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.log', ($: unknown, e: any) => {
    logs.push(e.text)
    return { value: undefined }
  })
  const text = { type: 'Text', props: {}, children: ['von anderen'] }
  // layered: weiter innen liegt quick-replies und hat seine Pille als Ebene über den Grund gesetzt (band.ts, docs/BAND.md)
  on('ui.render', () => (layered ? LAYERED(text) : text))
  return { store, logs }
}

async function clientProps(ui: any): Promise<any> {
  const c = await ui.find({ type: 'Client', key: 'buddy' })
  return c?.props.props
}

test('Band: Terminal zeigt die Figur in Halbblock-Auflösung (Client), fremder Inhalt bleibt', async ($, on) => {
  mock.clock(on)
  stubs(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'buddy' })).toBeDefined()
  await ui.advance(300)
  expect(await ui.find({ type: 'Text', text: /[▀▄█]/, in: 'buddy' })).toBeDefined()
  await ui.unmount()
})

/** Das Bild, das ein Svg aus desk.ts zur Zeit `ms` nach Beginn zeigt: alle sichtbaren Kachelbilder (SMIL: visibility, diskrete keyTimes). */
function frameAt(svg: string, ms: number): string {
  const dur = Number(/dur="([\d.]+)s"/.exec(svg)?.[1] ?? 1) * 1000
  const at = Math.min(1, ms / dur)
  let out = ''
  for (const g of svg.match(/<g visibility="\w+">.*?<\/g>/g) ?? []) {
    const body = g.replace(/<g[^>]*>|<animate[^>]*\/>|<\/g>/g, '')
    const m = /values="([^"]+)" keyTimes="([^"]+)"/.exec(g)
    if (!m) {
      out += body // Kachel mit nur einem Bild
      continue
    }
    const vals = m[1].split(';')
    const keys = m[2].split(';').map(Number)
    let v = vals[0]
    keys.forEach((k, i) => {
      if (k <= at + 1e-9) v = vals[i]
    })
    if (v === 'visible') out += body
  }
  return out
}

test('Band: Desktop zeigt die Figur als animiertes Svg (SMIL im Rahmen) und zeichnet in Ruhe nur zum Ende der Animation neu; /clawd off hält den Wächter an', async ($, on) => {
  const clock = mock.clock(on)
  const { logs } = stubs(on)
  let invalidates = 0
  on('ui.invalidate', () => {
    invalidates++
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  const svgEl = await ui.find({ type: 'Svg' })
  expect(svgEl?.props.isInteractive).toBe(true)
  const first = svgEl?.props.source as string
  expect(first).toMatch(/^<svg [^>]*viewBox="0 0 100 14"/)
  // Durchsichtiger Grund im Rahmen: ohne passendes Farbschema malt Chromium ihn im Dark Mode weiß
  expect(first).toMatch(/^<svg [^>]*><style>:root\{color-scheme:light dark\}html,body\{margin:0;padding:0;overflow:hidden\}/)
  // Clawds Box wird nie zusammengedrückt (sonst wäre die Hand rechts abgeschnitten)
  expect((await ui.find({ type: 'Box', key: 'buddy' }))?.props.flexShrink).toBe(0)
  expect(first).toMatch(/#D77757/i)
  expect(first).toMatch(/<animate attributeName="visibility" calcMode="discrete"/)
  expect(first.length).toBeLessThanOrEqual(131072)
  // Ruhiger Clawd (er atmet, blinzelt, schaut): die Animation läuft im Svg, das Band wird in der Zeit nicht neu gezeichnet
  const dur = Number(/dur="([\d.]+)s"/.exec(first)?.[1]) * 1000
  expect(dur).toBeGreaterThanOrEqual(10_000)
  await clock.advance(dur - 1500)
  expect(invalidates).toBe(0)
  // Kurz vor dem Ende: genau eine Bitte um die nächste Animation
  await clock.advance(1000)
  expect(invalidates).toBe(1)
  await ui.redraw()
  const next = (await ui.find({ type: 'Svg' }))?.props.source as string
  expect(next).not.toBe(first)
  // Antwortet die App nicht mehr (Sitzung verdeckt), bittet er nicht erneut und endet nach ~2 s
  const k = invalidates
  await clock.advance(60_000)
  expect(invalidates - k).toBe(1)
  // Demo: sofort neu gezeichnet, das neue Svg zeigt sie
  await ui.redraw()
  await $.command.run({ command: 'clawd', args: 'demo wave_question' })
  await ui.redraw()
  expect((await ui.find({ type: 'Svg' }))?.props.source).not.toBe(next)
  // Aus: der Wächter ist sofort beendet (kein invalidate mehr), und nichts wirft ins Debug-Log
  const offRes = await $.command.run({ command: 'clawd', args: 'off' })
  expect(offRes.text).toMatch(/: off$/)
  const n = invalidates
  await clock.advance(60_000)
  expect(invalidates).toBe(n)
  // Wieder an: das nächste Zeichnen startet den Wächter neu
  await $.command.run({ command: 'clawd', args: 'on' })
  await ui.redraw()
  const m = invalidates
  await clock.advance(31_000)
  expect(invalidates - m).toBe(1)
  expect(logs.filter((l) => /Error|not a function/i.test(l))).toEqual([])
  await ui.unmount()
})

test('Band: Desktop setzt nahtlos fort (die nächste Animation beginnt mit dem Bild, das die vorige zu dieser Zeit zeigte); Tippen zeichnet selten neu', async ($, on) => {
  const clock = mock.clock(on)
  const { logs } = stubs(on)
  let invalidates = 0
  on('ui.invalidate', () => {
    invalidates++
    return { value: undefined }
  })
  on('prompt.edit', ($: unknown, e: any) => ({ text: e.text, cursor: e.cursor }))
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', ($: unknown, e: any) => ({ changed: e.changed }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = async () => (await ui.find({ type: 'Svg' }))?.props.source as string
  for (const [i, ms] of [2025, 1275, 3075].entries()) { // ganze Takte: ein Rest unter 75 ms verschöbe die Erwartung um ein Bild; unter DESK_REUSE_MS
    const before = await svg()
    await clock.advance(ms)
    // Neu zeichnen ohne neue Fakten (z. B. für einen anderen Mod): dasselbe Svg, der Rahmen lädt nicht neu (kein Flackern)
    await ui.redraw()
    expect(await svg()).toBe(before)
    // Neue Fakten, die am Bild nichts ändern (Limit-Stand weit unter voll): ebenfalls dasselbe Svg
    await ($ as any).session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 + i, resetsAt: '2030-01-01T10:00:00Z' }], changed: ['rateLimits'] })
    await ui.redraw()
    expect(await svg()).toBe(before)
    // Ein Ereignis, das etwas ändert: neues Svg, das mit dem Bild beginnt, das das vorige zu dieser Zeit zeigte
    if (i % 2 === 0) await $.turn.start({ text: 'los', turnId: 't' + i })
    else await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', turnId: 't' + (i - 1) } as any)
    await ui.redraw()
    const after = await svg()
    expect(after).not.toBe(before)
    // Der Stand rückt in ganzen Takten (75 ms) vor
    expect(frameAt(after, 0)).toMatch(/#D77757/i)
    expect(frameAt(after, 0), `Durchgang ${i}`).toBe(frameAt(before, Math.floor(ms / 75) * 75))
  }
  // Älter als 5 s: nicht mehr weitergeben, neu zeichnen (ein unerkannter Neustart des Rahmens spränge sonst weit zurück)
  {
    const before = await svg()
    await clock.advance(6000)
    await ui.redraw()
    expect(await svg()).not.toBe(before)
  }
  // /clawd status nennt die Messwerte der Desktop-Zeichnung und beginnt danach neu
  const st = await $.command.run({ command: 'clawd', args: 'status' })
  expect(st.text).toMatch(/draws \(.*\/min\), \d+ times kept unchanged \(no reload\), animations avg .* s with .* frame changes/)
  // Tippen: das erste Zeichen zeichnet neu, danach höchstens alle 3 s (vorher je Sekunde)
  const k = invalidates
  for (let i = 0; i < 20; i++) {
    await $.prompt.edit({ text: 'x'.repeat(i + 1), inputText: 'x', cursor: i + 1, start: i, end: i } as any)
  }
  expect(invalidates - k).toBe(1)
  expect(logs.filter((l) => /Error|not a function/i.test(l))).toEqual([])
  await ui.unmount()
})

test('Band: auf vscode/mobile nichts Eigenes; zu schmal oder zu flach: nichts gezeichnet', async ($, on) => {
  mock.clock(on)
  stubs(on)
  const v = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await v.find({ type: 'Client' })).toBeUndefined()
  expect(await v.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
  await v.unmount()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 12 } })
  await ui.advance(300)
  expect(await ui.find({ type: 'Text', text: /[▀▄█]/, in: 'buddy' })).toBeUndefined()
  await ui.unmount()
})

test('/clawd off blendet aus, on zeigt wieder; list und demo antworten; Zustand liegt im Speicher', async ($, on) => {
  mock.clock(on)
  const { store } = stubs(on)
  on('ui.invalidate', () => ({ value: undefined }))
  const list = await $.command.run({ command: 'clawd', args: 'list' })
  expect(list.text).toMatch(/idle_breathe/)
  const demo = await $.command.run({ command: 'clawd', args: 'demo wave' })
  expect(demo.text).toMatch(/playing: wave/)
  const nope = await $.command.run({ command: 'clawd', args: 'demo gibtsnicht' })
  expect(nope.text).toMatch(/no animation/)
  await $.command.run({ command: 'clawd', args: 'off' })
  expect((store.get('buddy') as any).enabled).toBe(false)
  const off = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await off.find({ type: 'Client' })).toBeUndefined()
  expect(await off.find({ type: 'Text', text: 'von anderen' })).toBeDefined()
  await off.unmount()
  await $.command.run({ command: 'clawd', args: 'on' })
  const on2 = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await on2.find({ type: 'Client', key: 'buddy' })).toBeDefined()
  await on2.unmount()
})

test('Fakten: turn.start → arbeitet, tool.call je Art, Subagent ändert nichts, turn.complete → fertig bzw. Fehler', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: unknown, e: any) => ({ text: '' }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', async () => {
    await clock.sleep(5000)
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'los', turnId: 't1' })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  let p = await clientProps(ui)
  expect(p.facts.turnActive).toBe(true)
  // Edit läuft (in der Schwebe): Art write
  const call = $.tool.call({ tool: 'Edit', tool_use_id: 'a', file_path: 'x', old_string: 'a', new_string: 'b' } as any)
  await clock.advance(1000)
  await ui.redraw()
  p = await clientProps(ui)
  expect(p.facts.tool.kind).toBe('write')
  // Subagenten-Tool (agentId) ändert die Hauptstimmung nicht
  const sub = $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'ls', agentId: 'ag1' } as any)
  await clock.advance(1000)
  await ui.redraw()
  p = await clientProps(ui)
  expect(p.facts.tool.kind).toBe('write')
  await clock.advance(6000)
  await call
  await sub
  await ui.redraw()
  p = await clientProps(ui)
  expect(p.facts.tool).toBeNull()
  // Nachlauf: das eben beendete Edit bleibt bis zu 8 s die Stimmung, danach grübelt er
  expect(p.facts.lastTool?.kind).toBe('write')
  // (ohne den Subagenten von oben, der sonst als „Subagenten arbeiten“ zählt)
  const own = { ...p.facts, agents: [] }
  expect(deriveMood(own, p.facts.lastTool.endedAt + 7000)).toBe('work_write')
  expect(deriveMood(own, p.facts.lastTool.endedAt + 9000)).toBe('work_think')
  // Ende: fertig bzw. Fehler (aborted)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: true, reason: 'aborted', turnId: 't1' })
  await ui.redraw()
  p = await clientProps(ui)
  expect(p.facts.turnActive).toBe(false)
  expect(p.facts.endedKind).toBe('oops')
  await $.turn.start({ text: 'nochmal', turnId: 't2' })
  await ui.redraw()
  expect((await clientProps(ui)).facts.lastTool).toBeUndefined()
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', turnId: 't2' })
  await ui.redraw()
  p = await clientProps(ui)
  expect(p.facts.endedKind).toBe('done')
  await ui.unmount()
})

test('Fakten: tool.check ask → wartet auf dich, bis das Tool endet; AskUserQuestion ebenso', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'ask', reason: 'test' }))
  on('tool.call', async () => {
    await clock.sleep(4000)
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'x', turnId: 't' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'c', command: 'rm x' } as any)
  const chk = $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'c' })
  await clock.advance(500)
  await chk
  await ui.redraw()
  expect((await clientProps(ui)).facts.ask).toBe(true)
  await clock.advance(5000)
  await call
  await ui.redraw()
  expect((await clientProps(ui)).facts.ask).toBe(false)
  // Eine hypothetische Prüfung ohne echten Aufruf (keine tool_use_id) ist keine Rückfrage
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  await ui.redraw()
  expect((await clientProps(ui)).facts.ask).toBe(false)
  await ui.unmount()
})

test('Fakten: AskUserQuestion lässt ihn warten, solange die Frage offen ist', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('tool.call', async () => {
    await clock.sleep(4000)
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'x', turnId: 't' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const call = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q', questions: [] } as any)
  await clock.advance(500)
  await ui.redraw()
  expect((await clientProps(ui)).facts.ask).toBe(true)
  await clock.advance(5000)
  await call
  await ui.redraw()
  expect((await clientProps(ui)).facts.ask).toBe(false)
  await ui.unmount()
})

test('Beobachtend: alle Event-Hooks reichen unverändert weiter (Ergebnis des Stubs kommt an)', async ($, on) => {
  mock.clock(on)
  stubs(on)
  on('turn.start', () => ({ turnId: 'EXAKT' }))
  on('turn.complete', () => ({ text: 'EXAKT' }))
  on('tool.check', () => ({ decision: 'deny', reason: 'EXAKT' }))
  on('tool.call', () => ({ result: 'EXAKT' }))
  expect((await $.turn.start({ text: 'a', turnId: 'x' })).turnId).toBe('EXAKT')
  expect((await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'x' })).text).toBe('EXAKT')
  expect((await $.tool.check({ tool: 'Bash', input: {} })).reason).toBe('EXAKT')
  expect((await $.tool.call({ tool: 'Read', tool_use_id: 'r', file_path: 'a' } as any) as any).result).toBe('EXAKT')
})

test('Laune: Rückschläge steigern den Frust und klingen ab, Erfolge in Folge heben die Laune, lange Arbeit macht müde', () => {
  const H = 3_600_000
  let s: Strain = { ...NO_STRAIN }
  expect(deriveTemper(s, 0).temper).toBe(0)
  // Ein Fehler ärgert etwas, mehrere immer mehr
  s = addHit(s, 0, SETBACK.toolError)
  const one = deriveTemper(s, 0).temper
  s = addHit(addHit(s, 0, SETBACK.toolError), 0, SETBACK.toolError)
  s = strainTurnEnd(strainTurnStart(s, 0), 1000, false, false)
  const many = deriveTemper(s, 1000).temper
  expect(one).toBeLessThan(0)
  expect(many).toBeLessThan(one)
  expect(many).toBeLessThan(-0.6)
  // Abklingen: nach einer Stunde ohne weitere Rückschläge deutlich milder
  expect(deriveTemper(s, H).temper).toBeGreaterThan(many + 0.4)
  // Erfolge in Folge: Frust weg, dann gute Laune
  let t = 2 * H
  for (let i = 0; i < 6; i++) s = strainTurnEnd(strainTurnStart(s, (t += 60_000)), (t += 60_000), true, true)
  expect(deriveTemper(s, t).temper).toBeGreaterThan(0.5)
  // Ein Turn mit Tool-Fehler unterbricht die Serie
  s = strainTurnEnd(strainTurnStart(s, (t += 1000)), (t += 1000), true, false)
  expect(s.streak).toBe(0)
  // Müdigkeit: 2 h Arbeit am Stück = voll müde, nach langer Pause wieder frisch
  let w: Strain = { ...NO_STRAIN }
  let u = 0
  for (let i = 0; i < 24; i++) w = strainTurnEnd(strainTurnStart(w, (u += 60_000)), (u += 5 * 60_000), true, true)
  expect(deriveTemper(w, u).tired).toBe(1)
  expect(deriveTemper(w, u + 30 * 60_000).tired).toBe(0)
  w = strainTurnStart(w, u + 30 * 60_000)
  expect(w.workMs).toBe(0)
})

test('Laune im Mod: Tool meldet isError bzw. abgelehnt → Rückschlag, Turn ohne Fehler → Erfolg (nur die Markierung zählt)', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  let mode = 'error'
  on('tool.call', () => (mode === 'error' ? { isError: true, result: 'geheim' } : mode === 'deny' ? { deny: 'nein' } : { result: 'ok' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const before = (await clientProps(ui)).strain as Strain
  await $.turn.start({ text: 'a', turnId: 'x1' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'e1', command: 'x' } as any)
  mode = 'deny'
  await $.tool.call({ tool: 'Bash', tool_use_id: 'e2', command: 'x' } as any)
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, reason: 'answer', turnId: 'x1' })
  await ui.redraw()
  const after = (await clientProps(ui)).strain as Strain
  expect(after.hits.length - before.hits.length).toBe(2)
  expect(after.streak).toBe(0)
  expect(JSON.stringify(after)).not.toMatch(/geheim/)
  mode = 'ok'
  await clock.advance(1000)
  await $.turn.start({ text: 'b', turnId: 'x2' })
  await $.tool.call({ tool: 'Read', tool_use_id: 'o1', file_path: 'y' } as any)
  await clock.advance(5000)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', turnId: 'x2' })
  await ui.redraw()
  const ok = (await clientProps(ui)).strain as Strain
  expect(ok.streak).toBe(1)
  expect(ok.workMs).toBeGreaterThan(after.workMs)
  const st = await $.command.run({ command: 'clawd', args: 'status' })
  expect(st.text).toMatch(/tiredness/)
  await ui.unmount()
})

test('session.start: liest an/aus und Ärger aus dem Speicher, meldet /clawd an; abgelehnter Speicher und Befehl sind kein Absturz (Deutsch)', { options: { language: 'de' } }, async ($, on) => {
  mock.clock(on)
  const { logs } = stubs(on, { buddy: { enabled: false, annoy: 3 } })
  on('session.start', () => ({ cwd: '/work' }))
  let registered = ''
  on('command.register', ($: unknown, e: any) => {
    registered = e.name
    return { value: undefined }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  expect(registered).toBe('clawd')
  const st = await $.command.run({ command: 'clawd', args: '' } as any)
  expect(st.text).toMatch(/clawd-buddy: aus, .*Ärger 3/)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
  // demo schaltet ein und speichert das
  await $.command.run({ command: 'clawd', args: 'demo nod' } as any)
  const boop = await $.command.run({ command: 'clawd', args: 'boop' } as any)
  expect(boop.text).toMatch(/boop/)
  const nap = await $.command.run({ command: 'clawd', args: 'nap' } as any)
  expect(nap.text).toMatch(/müde/)
  expect(logs.filter((l) => /Error/i.test(l))).toEqual([])
})

test('session.start: Speicher und Befehlsanmeldung abgelehnt → Debug-Log, Mod läuft weiter', async ($, on) => {
  mock.clock(on)
  const logs: string[] = []
  on('store.get', () => ({ deny: 'nein' }))
  on('store.set', () => ({ deny: 'nein' }))
  on('ui.log', ($: unknown, e: any) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ deny: 'nein' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
  expect(logs.some((l) => /store not read/.test(l))).toBe(true)
  expect(logs.some((l) => /not registered/.test(l))).toBe(true)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Client', key: 'buddy' })).toBeDefined()
  await ui.unmount()
})

test('Fehlerpfad: wirft das Tool, bleibt kein laufendes Tool hängen und es zählt als Rückschlag', async ($, on) => {
  mock.clock(on)
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('tool.call', () => {
    throw new Error('kaputt')
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const before = ((await clientProps(ui)).strain as Strain).hits.length
  await $.turn.start({ text: 'a', turnId: 'f1' })
  let threw = false
  try {
    await $.tool.call({ tool: 'Bash', tool_use_id: 'k1', command: 'x' } as any)
  } catch {
    threw = true
  }
  expect(threw).toBe(true)
  await ui.redraw()
  const p = await clientProps(ui)
  expect(p.facts.tool).toBeNull()
  expect((p.strain as Strain).hits.length).toBe(before + 1)
  await ui.unmount()
})

test('Besondere Tage, lange Rückfrage, Erfolgsserie', () => {
  const at = (s: string) => new Date(s).getTime()
  expect(specialDay(at('2027-01-05T09:00:00'), '05.01.')).toBe('birthday')
  expect(specialDay(at('2027-01-06T09:00:00'), '05.01.')).toBe('')
  expect(specialDay(at('2027-01-05T09:00:00'), '')).toBe('')
  expect(specialDay(at('2026-12-31T19:00:00'), '05.01.')).toBe('newyear')
  expect(specialDay(at('2026-12-31T10:00:00'), '05.01.')).toBe('')
  expect(specialDay(at('2027-01-01T03:00:00'), '05.01.')).toBe('newyear')
  const t = 9_000_000
  expect(deriveMood({ ...NO_FACTS, ask: true, askSince: t }, t + 10_000)).toBe('waitUser')
  expect(deriveMood({ ...NO_FACTS, ask: true, askSince: t }, t + 46_000)).toBe('waitUserLong')
  expect(deriveMood({ ...NO_FACTS, endedKind: 'done', endedAt: t, streakAt: t }, t + 1000)).toBe('streak')
  expect(deriveMood({ ...NO_FACTS, endedKind: 'done', endedAt: t, streakAt: t }, t + 5000)).toBe('idle')
})

test('Shell genauer: Commit/Push → work_git, Tests/Checks → work_test (ohne Wechsel ins allgemeine Warten), sonst Shell', () => {
  expect(shellKind('git commit -m "x"')).toBe('git')
  expect(shellKind('git -C repo push origin main')).toBe('git')
  expect(shellKind('npm test')).toBe('test')
  expect(shellKind('claude plugin validate . --strict')).toBe('test')
  expect(shellKind('pwsh -File scripts/check-mods.ps1 -Name x')).toBe('test')
  expect(shellKind('git status --short')).toBe('shell')
  expect(shellKind('ls -la')).toBe('shell')
  expect(shellKind(undefined)).toBe('shell')
  const t = 5_000_000
  expect(deriveMood({ ...NO_FACTS, turnActive: true, tool: { kind: 'test', since: t } }, t + 70_000)).toBe('work_test')
  expect(deriveMood({ ...NO_FACTS, turnActive: true, tool: { kind: 'git', since: t } }, t + 500)).toBe('work_git')
})

test('Limits: ausgeschöpftes Wochen- bzw. 5-h-Limit hat Vorrang (außer Rückfrage), nach dem Reset kurz Freude', () => {
  const t = 2_000_000
  const lim = (five: number, week: number) => ({ five, fiveReset: t + 3_600_000, week, weekReset: t + 86_400_000 })
  expect(deriveMood({ ...NO_FACTS, limits: lim(100, 40) }, t)).toBe('limit_5h')
  expect(deriveMood({ ...NO_FACTS, limits: lim(100, 100) }, t)).toBe('limit_week')
  expect(deriveMood({ ...NO_FACTS, turnActive: true, limits: lim(100, 40) }, t)).toBe('limit_5h')
  expect(deriveMood({ ...NO_FACTS, ask: true, limits: lim(100, 40) }, t)).toBe('waitUser')
  expect(deriveMood({ ...NO_FACTS, limits: lim(99, 99) }, t)).toBe('idle')
  // Reset-Zeitpunkt vorbei: 6 s Freude, dann normal
  expect(deriveMood({ ...NO_FACTS, limits: lim(100, 40) }, t + 3_600_000 + 1000)).toBe('limit_back')
  expect(deriveMood({ ...NO_FACTS, limits: lim(100, 40) }, t + 3_600_000 + 7000)).toBe('idle')
})

test('Limits im Mod: session.measure liefert Prozent und Reset, nur diese Zahlen kommen im Client an', async ($, on) => {
  mock.clock(on)
  stubs(on)
  on('session.measure', ($: unknown, e: any) => ({ changed: e.changed }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ($ as any).session.measure({
    context: { window: 200000 }, changed: ['rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2030-01-01T10:00:00Z' }, { kind: 'seven_day', percentUsed: 37.5, resetsAt: '2030-01-05T10:00:00Z' }],
  })
  await ui.redraw()
  const p = await clientProps(ui)
  expect(p.facts.limits).toEqual({ five: 100, fiveReset: Date.parse('2030-01-01T10:00:00Z'), week: 37.5, weekReset: Date.parse('2030-01-05T10:00:00Z') })
  expect(deriveMood(p.facts, p.now)).toBe('limit_5h')
  await ui.unmount()
})

test('Subagenten: laufende (auch im Hintergrund) zeigen die Helfer (beliebig viele, ab 7 in zweiter Reihe); Ende per turn.complete, sonst nach 10 min', () => {
  const t = 1_000_000
  expect(deriveMood({ ...NO_FACTS, agents: [t] }, t + 1000)).toBe('work_agent')
  expect(deriveMood({ ...NO_FACTS, agents: [t, t, t, t] }, t + 1000)).toBe('work_agent')
  expect(deriveMood({ ...NO_FACTS, agents: Array(10).fill(t) }, t + 1000)).toBe('work_agent') // kein Schwarm mehr: Helfer-Reihen
  expect(deriveMood({ ...NO_FACTS, agents: [t] }, t + 300_000)).toBe('work_agent')
  expect(deriveMood({ ...NO_FACTS, agents: [t] }, t + 601_000)).toBe('idle')
  // Eigenes Tool des Hauptagenten hat Vorrang vor einzelnen Subagenten, der Schwarm nicht
  expect(deriveMood({ ...NO_FACTS, turnActive: true, tool: { kind: 'read', since: t }, agents: [t] }, t + 500)).toBe('work_read')
  expect(deriveMood({ ...NO_FACTS, turnActive: true, tool: { kind: 'read', since: t }, agents: Array(10).fill(t) }, t + 500)).toBe('work_read')
  // Rückfrage bleibt oben, ein eben beendeter Turn zeigt erst "fertig"
  expect(deriveMood({ ...NO_FACTS, ask: true, agents: [t, t, t, t] }, t)).toBe('waitUser')
  expect(deriveMood({ ...NO_FACTS, endedKind: 'done', endedAt: t, agents: [t] }, t + 1000)).toBe('done')
})

test('Subagenten im Mod: Tool-Aufrufe mit agentId zählen, ihr turn.complete beendet sie, die Hauptstimmung bleibt', async ($, on) => {
  mock.clock(on)
  stubs(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (const id of ['a1', 'a2', 'a3', 'a4']) await $.tool.call({ tool: 'Read', tool_use_id: 'r' + id, file_path: 'x', agentId: id } as any)
  await ui.redraw()
  let p = await clientProps(ui)
  expect(p.facts.agents.length).toBe(4)
  expect(p.facts.turnActive).toBe(false)
  expect(deriveMood(p.facts, p.now)).toBe('work_agent') // 4 Helfer stehen als Begleiter, Schwarm erst ab 10
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 's1', agentId: 'a1' } as any)
  await ui.redraw()
  p = await clientProps(ui)
  expect(p.facts.agents.length).toBe(3)
  expect(deriveMood(p.facts, p.now)).toBe('work_agent')
  expect(p.facts.endedKind).toBe('')
  await ui.unmount()
})

test('Stimmungsableitung: Priorität, Schwellen 10 s und 60 s, Subagent-Tool zählt als arbeiten', () => {
  const base: Facts = { ...NO_FACTS, turnActive: true }
  expect(deriveMood({ ...NO_FACTS }, 0)).toBe('idle')
  expect(deriveMood({ ...base }, 0)).toBe('work_think')
  expect(deriveMood({ ...base, tool: { kind: 'write', since: 0 } }, 500)).toBe('work_write')
  expect(deriveMood({ ...base, tool: { kind: 'shell', since: 0 } }, 9_999)).toBe('work_shell')
  expect(deriveMood({ ...base, tool: { kind: 'shell', since: 0 } }, 10_000)).toBe('wait10')
  expect(deriveMood({ ...base, tool: { kind: 'shell', since: 0 } }, 61_000)).toBe('wait60')
  expect(deriveMood({ ...base, tool: { kind: 'agent', since: 0 } }, 120_000)).toBe('work_agent')
  expect(deriveMood({ ...base, tool: { kind: 'read', since: 0 }, ask: true }, 100)).toBe('waitUser')
  expect(deriveMood({ ...NO_FACTS, endedKind: 'done', endedAt: 1000 }, 2000)).toBe('done')
  expect(deriveMood({ ...NO_FACTS, endedKind: 'oops', endedAt: 1000 }, 2000)).toBe('oops')
  expect(deriveMood({ ...NO_FACTS, endedKind: 'done', endedAt: 1000 }, 9000)).toBe('idle')
  expect(deriveMood({ ...NO_FACTS, typingAt: 1000 }, 2000)).toBe('watching')
  expect(deriveMood({ ...NO_FACTS, typingAt: 1000 }, 5000)).toBe('watching')
  expect(deriveMood({ ...NO_FACTS, typingAt: 1000 }, 8000)).toBe('idle')
  for (const [t, k] of [['Read', 'read'], ['Grep', 'read'], ['Glob', 'read'], ['Edit', 'write'], ['Write', 'write'], ['NotebookEdit', 'write'], ['Bash', 'shell'], ['PowerShell', 'shell'], ['WebFetch', 'web'], ['WebSearch', 'web'], ['Task', 'agent'], ['Agent', 'agent'], ['TodoWrite', 'think']] as const) {
    expect(toolKind(t)).toBe(k)
  }
})

test('Client: ui.advance treibt Bilder; Bash > 10 s lässt ihn warten, Mitternacht-Nacht schickt ihn schlafen (mock.clock, ui.advance)', async ($, on) => {
  const clock = mock.clock(on, { now: 1_790_000_000_000 })
  stubs(on)
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', async () => {
    await clock.sleep(20_000)
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'lang', turnId: 'x' })
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'z', command: 'build' } as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(100)
  await ui.redraw()
  const p0 = await clientProps(ui)
  expect(deriveMood(p0.facts, p0.now)).toBe('work_shell')
  // Der Client rechnet Zeit als Basis + Ticks: nach 11 s Bildtakt ist das Tool "lang"
  await ui.advance(11_000)
  const pNow = p0.now + 11_000
  expect(deriveMood(p0.facts, pNow)).toBe('wait10')
  await clock.advance(20_000)
  await call
  await ui.unmount()
})

test('Client: Klick, wiederholte Klicks (Ärger → Post → Speicher), Armziehen, Hochheben; 100 Frames ohne Unmount', async ($, on) => {
  mock.clock(on)
  const { store } = stubs(on)
  // Nur Terminal: auf dem Desktop ist die Figur ein Bild ohne Mausereignisse (desk.ts)
  for (const surface of ['terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.advance(500)
    // Figur steht rechts im Band; der Stub zeichnet links etwas, Clawd hat dann 56 Spalten (Bühne ab Spalte 44): Figur ab Zelle 16, Körper in Zeilen 2–5
    for (let i = 0; i < 8; i++) {
      await ui.pointer({ type: 'down', x: 24, y: 3, button: 'left' })
      await ui.pointer({ type: 'up', x: 24, y: 3, button: 'left' })
      await ui.advance(600)
    }
    // Ärger wurde gespeichert
    expect((store.get('buddy') as any)?.annoy).toBeGreaterThan(0)
    // Hover und Ziehen am Arm, Loslassen
    await ui.pointer({ type: 'enter', x: 8, y: 3 })
    await ui.pointer({ type: 'move', x: 9, y: 3 })
    await ui.advance(1500)
    await ui.pointer({ type: 'down', x: 17, y: 4, button: 'left' })
    for (let k = 0; k < 5; k++) await ui.pointer({ type: 'move', x: 15 - k * 2, y: 4 - k * 0.5, button: 'left' })
    await ui.pointer({ type: 'up', x: 6, y: 2, button: 'left' })
    await ui.advance(3000)
    // 100 simulierte Frames: der Client lebt noch (kein Unmount durch Render-Schleife)
    await ui.advance(10_000)
    expect(await ui.find({ type: 'Text', text: /[▀▄█]/, in: 'buddy' })).toBeDefined()
    await ui.unmount()
  }
})

test('Konfiguration: Nachtzeiten, Leerlauf, reduzierte Bewegung und Seite kommen als props im Client an', { options: { nightStart: 22, nightEnd: 7, idleSeconds: 30, reducedMotion: true, side: 'left' } }, async ($, on) => {
  mock.clock(on)
  stubs(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const p = await clientProps(ui)
  expect(p.nightStart).toBe(22)
  expect(p.nightEnd).toBe(7)
  expect(p.idleSeconds).toBe(30)
  expect(p.reduced).toBe(true)
  expect(p.flip).toBe(true)
  await ui.unmount()
})

test('Fehlerpfad: wirft das Speichern, bleibt das Band gezeichnet und der Befehl antwortet', async ($, on) => {
  mock.clock(on)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ deny: 'gesperrt' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['von anderen'] }))
  const r = await $.command.run({ command: 'clawd', args: 'off' })
  expect(r.text).toMatch(/: off$/)
  await $.command.run({ command: 'clawd', args: 'on' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Client', key: 'buddy' })).toBeDefined()
  await ui.unmount()
})

test('Reihenfolge: liegt quick-replies weiter innen, bleibt seine Pille über dem Band, Clawd steht nur neben dem Grund', async ($, on) => {
  mock.clock(on)
  stubs(on, {}, true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const tree: any = await ui.drawn()
    expect(tree.props.key).toBe('band')
    expect(tree.children.map((c: any) => c.props.key)).toEqual(['layer:20:quick-replies', 'band-base'])
    // Im Grund: der fremde Text und Clawd in einer Zeile, keine Pille
    const row = tree.children[1].children[0].children[0]
    expect(JSON.stringify(row)).toContain('von anderen')
    expect(JSON.stringify(row)).toContain('buddy')
    expect(JSON.stringify(row)).not.toContain('quick-replies')
    await ui.unmount()
  }
})

test('Sprache: beide Tabellen haben dieselben Schlüssel und keine leeren Texte; jeder Clip hat eine englische Bezeichnung; Zahlenformat', () => {
  const flat = (o: Record<string, unknown>, p = ''): Record<string, string> => {
    const r: Record<string, string> = {}
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string') r[p + k] = v
      else if (typeof v === 'function') r[p + k] = String((v as (...a: unknown[]) => unknown)({ on: true, mood: 'x', temper: '0', tired: 1, annoy: 0, desk: 'd', secs: '1', draws: 1, perMin: '1', planSecs: '1', changes: '1', kb: '1', calcAvg: '1', calcMax: '1', drawAvg: '1', drawMax: '1', others: '1' }, 'y'))
      else Object.assign(r, flat(v as Record<string, unknown>, `${p}${k}.`))
    }
    return r
  }
  const en = flat(T.en)
  const de = flat(T.de)
  expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort())
  for (const v of [...Object.values(en), ...Object.values(de)]) expect(v.trim().length).toBeGreaterThan(0)
  for (const c of ALL_CLIPS) expect(CLIP_EN[c.name], c.name).toBeTruthy()
  expect(Object.keys(CLIP_EN).filter((n) => !ALL_CLIPS.some((c) => c.name === n))).toEqual([])
  expect(clipLabel('de', ALL_CLIPS[0])).toBe(ALL_CLIPS[0].label)
  expect(num('en', 1.5)).toBe('1.5')
  expect(num('de', 1.5)).toBe('1,5')
  expect(num('de', -0.25, 2)).toBe('-0,25')
  expect(langOf('de')).toBe('de')
  expect(langOf(undefined)).toBe('en')
  expect(langOf('fr')).toBe('en')
})

test('Sprache en (Standard): Befehle, Status und alt-Text englisch; Suche findet auch deutsche Bezeichnungen', async ($, on) => {
  mock.clock(on)
  stubs(on)
  on('ui.invalidate', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Clawd, the mascot')
  expect((await $.command.run({ command: 'clawd', args: 'demo Jonglieren' })).text).toBe('playing: juggle (Juggling)')
  expect((await $.command.run({ command: 'clawd', args: 'nap' })).text).toMatch(/getting sleepy/)
  const st = (await $.command.run({ command: 'clawd', args: 'status' })).text
  expect(st).toMatch(/^clawd-buddy: on, calm \(0\.00\), tiredness 0%, annoyance 0\. Desktop drawing/)
  expect(st).toMatch(/Commands: on \| off/)
  expect((await $.command.run({ command: 'clawd', args: 'xyz' })).text).toMatch(/^unknown: xyz\. Commands:/)
  await ui.unmount()
})

test('Sprache de: Befehle, Status und alt-Text deutsch wie bisher; Suche findet auch englische Bezeichnungen', { options: { language: 'de' } }, async ($, on) => {
  mock.clock(on)
  stubs(on)
  on('ui.invalidate', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Clawd, das Maskottchen')
  expect((await $.command.run({ command: 'clawd', args: 'demo Juggling' })).text).toBe('spielt: juggle (Jonglieren)')
  expect((await $.command.run({ command: 'clawd', args: 'demo' })).text).toMatch(/Mit \/clawd list/)
  const st = (await $.command.run({ command: 'clawd', args: 'status' })).text
  expect(st).toMatch(/^clawd-buddy: an, ausgeglichen \(0,00\), Müdigkeit 0 %, Ärger 0\. Desktop-Zeichnung/)
  expect((await $.command.run({ command: 'clawd', args: 'off' })).text).toBe('clawd-buddy: aus')
  await ui.unmount()
})

test('sidekick, Komprimieren, Skill: Stimmungen mit Vorrang und Ablauf', () => {
  const t = 1_000_000
  const sk = (kind: 'check' | 'stop' | 'handoff' | 'fresh', at = t) => ({ ...NO_FACTS, sidekick: { kind, at } })
  expect(deriveMood(sk('check'), t + 1000)).toBe('sk_check')
  expect(deriveMood(sk('check'), t + 31_000)).toBe('idle') // Sicherheitsnetz: hängende Prüfung
  expect(deriveMood(sk('stop'), t + 60_000)).toBe('sk_stop')
  expect(deriveMood({ ...sk('stop'), ask: true }, t)).toBe('waitUser') // Claudes eigene Rückfrage geht vor
  expect(deriveMood(sk('handoff'), t + 20_000)).toBe('sk_handoff')
  // Neuer Chat: der Turn darin beginnt sofort, die Freude geht kurz vor, dann Arbeit
  const fresh = { ...sk('fresh'), turnActive: true }
  expect(deriveMood(fresh, t + 2000)).toBe('sk_fresh')
  expect(deriveMood(fresh, t + 7000)).toBe('work_think')
  expect(deriveMood({ ...NO_FACTS, sidekick: null }, t)).toBe('idle')
  // Komprimieren hält die Arbeit an, ein Skill-Start zeigt sich kurz
  expect(deriveMood({ ...NO_FACTS, turnActive: true, tool: { kind: 'read', since: t }, compactSince: t }, t + 20_000)).toBe('compact')
  expect(deriveMood({ ...NO_FACTS, compactSince: t }, t + 6 * 60_000)).toBe('idle')
  expect(deriveMood({ ...NO_FACTS, turnActive: true, skillAt: t }, t + 1000)).toBe('skill')
  expect(deriveMood({ ...NO_FACTS, turnActive: true, skillAt: t }, t + 5000)).toBe('work_think')
})

const MSGS = [{ role: 'user', text: 'Zusammenfassung', toolUses: [] }]

test('sidekick im Mod: Clawd liest sidekick.buddy beim Zeichnen; Komprimieren und Skill landen in den Fakten', async ($, on) => {
  const clock = mock.clock(on)
  const { logs } = stubs(on)
  // Ein Stub ersetzt die Antwort des Hosts; Stubs antworten mit `{ value }` (wie store.get oben), hier mit dem ganzen StateRead
  let side: unknown = { kind: 'stop', at: 0 }
  on('state.get', ($: unknown, e: any) => ({ value: e.plugin === 'sidekick' && e.key === 'buddy' ? { value: side, version: 1 } : { value: undefined, version: 0 } }))
  on('session.compact', async () => {
    await clock.sleep(3000)
    return { messages: MSGS }
  })
  on('skill.prompt', ($: unknown, e: any) => ({ text: e.text }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  let p = await clientProps(ui)
  expect(p.facts.sidekick?.kind, logs.join(' | ')).toBe('stop')
  side = null
  await ui.redraw()
  p = await clientProps(ui)
  expect(p.facts.sidekick).toBeNull()
  // Komprimieren (nicht das Vorausrechnen): solange es läuft
  const pre = $.session.compact({ trigger: 'precompute', messages: MSGS } as any)
  await clock.advance(3500)
  await pre
  await ui.redraw()
  expect((await clientProps(ui)).facts.compactSince).toBeUndefined()
  const run = $.session.compact({ trigger: 'manual', messages: MSGS } as any)
  await clock.advance(1000)
  await ui.redraw()
  expect(typeof (await clientProps(ui)).facts.compactSince).toBe('number')
  await clock.advance(3000)
  await run
  await ui.redraw()
  expect((await clientProps(ui)).facts.compactSince).toBeUndefined()
  await $.skill.prompt({ skill: 'commit', text: 'x' } as any)
  await ui.redraw()
  expect(typeof (await clientProps(ui)).facts.skillAt).toBe('number')
  await ui.unmount()
})

test('sidekick: nur gültige Werte zählen (ein fremder Mod könnte den Wert umschreiben)', () => {
  expect(sidekickValue({ kind: 'stop', at: 5 })).toEqual({ kind: 'stop', at: 5 })
  expect(sidekickValue({ kind: 'boom', at: 5 })).toBeNull()
  expect(sidekickValue({ kind: 'check', at: 'x' })).toBeNull()
  expect(sidekickValue('stop')).toBeNull()
  expect(sidekickValue(undefined)).toBeNull()
})

test('Beobachtend bei Fehlern: Komprimieren wirft bzw. wird übersprungen → Ergebnis kommt durch, compactSince wird geleert; sidekick-Wert nicht lesbar → Band bleibt', async ($, on) => {
  const clock = mock.clock(on)
  const { logs } = stubs(on)
  on('state.get', () => {
    throw new Error('nicht lesbar')
  })
  let mode: 'skip' | 'throw' = 'skip'
  on('session.compact', () => {
    if (mode === 'throw') throw new Error('kaputt')
    return { skip: 'blockiert' }
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await clientProps(ui)).toBeDefined()
  expect((await clientProps(ui)).facts.sidekick ?? null).toBeNull()
  const r = await $.session.compact({ trigger: 'manual', messages: MSGS } as any)
  expect(r).toEqual({ skip: 'blockiert' })
  await ui.redraw()
  expect((await clientProps(ui)).facts.compactSince).toBeUndefined()
  mode = 'throw'
  let failed = false
  try {
    await $.session.compact({ trigger: 'auto', messages: MSGS } as any)
  } catch {
    failed = true
  }
  await clock.advance(10)
  await ui.redraw()
  expect((await clientProps(ui)).facts.compactSince).toBeUndefined()
  void failed
  void logs
  await ui.unmount()
})


test('Hinweise am Turn-Ende: Kontext fast voll (vor Pokal und Fertig), langer Turn → Puh geschafft', () => {
  const t = 1_000_000
  expect(ctxLevel(10)).toBe(0)
  expect(ctxLevel(70)).toBe(70)
  expect(ctxLevel(84.9)).toBe(70)
  expect(ctxLevel(99)).toBe(85)
  const ended = { ...NO_FACTS, endedKind: 'done' as const, endedAt: t }
  expect(deriveMood({ ...ended, ctxAt: t, streakAt: t }, t + 1000)).toBe('ctx_full')
  expect(deriveMood({ ...ended, ctxAt: t }, t + 5000)).toBe('idle')
  // während der Arbeit nie (gezeigt wird erst am Turn-Ende)
  expect(deriveMood({ ...NO_FACTS, turnActive: true, ctxAt: t }, t + 1000)).toBe('work_think')
  expect(deriveMood({ ...ended, turnMs: LONG_TURN_MS }, t + 1000)).toBe('done_long')
  expect(deriveMood({ ...ended, turnMs: LONG_TURN_MS - 1 }, t + 1000)).toBe('done')
  expect(deriveMood({ ...ended, endedKind: 'oops', turnMs: LONG_TURN_MS }, t + 1000)).toBe('oops')
})

test('Kontext im Mod: neue Stufe zeigt er am Turn-Ende, jede Stufe einmal; nach dem Komprimieren wieder scharf', async ($, on) => {
  const clock = mock.clock(on)
  stubs(on)
  on('session.measure', ($: unknown, e: any) => ({ changed: e.changed }))
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const measure = (percent: number) => ($ as any).session.measure({ context: { window: 200000, tokens: percent * 2000, percent }, rateLimits: [], changed: ['context'] })
  const turn = async (n: number, pct: number, ms = 1000) => {
    await $.turn.start({ text: 'los', turnId: 't' + n })
    await measure(pct)
    await clock.advance(ms)
    await $.turn.complete({ answer: 'ok', durationMs: ms, isAborted: false, reason: 'answer', turnId: 't' + n })
    await ui.redraw()
    return clientProps(ui)
  }
  let p = await turn(1, 72)
  expect(deriveMood(p.facts, p.now)).toBe('ctx_full')
  await clock.advance(10_000)
  p = await turn(2, 75)
  expect(deriveMood(p.facts, p.now)).toBe('done') // dieselbe Stufe nicht noch einmal
  await clock.advance(10_000)
  p = await turn(3, 30) // komprimiert
  expect(deriveMood(p.facts, p.now)).toBe('done')
  await clock.advance(10_000)
  p = await turn(4, 71, LONG_TURN_MS)
  expect(deriveMood(p.facts, p.now)).toBe('ctx_full')
  expect(p.facts.turnMs).toBeGreaterThanOrEqual(LONG_TURN_MS)
  // nach dem Komprimieren fehlt percent bis zur nächsten Antwort: nichts passiert
  await clock.advance(10_000)
  await ($ as any).session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
  await ui.redraw()
  p = await clientProps(ui)
  expect(deriveMood(p.facts, p.now)).toBe('idle')
  // ohne Turn (Messung danach) sofort
  await clock.advance(10_000)
  await measure(90)
  await ui.redraw()
  p = await clientProps(ui)
  expect(deriveMood(p.facts, p.now)).toBe('ctx_full')
  await ui.unmount()
})
