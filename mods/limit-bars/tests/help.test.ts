// limit-bars 0.7.0: /bars help als gezeichnete Tabelle (docs/HELP-SPEC.md §6), Verweis der Nebenbefehle, Vollständigkeit.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { DISK_WORDS, HANDOFF_CONTINUE_WORDS, HANDOFF_SHOW_WORDS, HELP_WORDS, KEEP_OFF_WORDS, ON_OFF_WORDS, PART_WORDS, RESET_WORDS, SHOW_WORDS, STATUS_WORDS, parseBars } from '../hooks/display.ts'
import { CACHE_WORDS, DEFAULT_SETTINGS } from '../hooks/cache.ts'
import { stateText } from '../hooks/help.ts'
import { HELP_ACCENT, barsHelpData } from '../hooks/helpdata.ts'
import type { HelpInput } from '../hooks/helpdata.ts'
import { T } from '../hooks/i18n.ts'

const NOW = new Date(2026, 9, 9, 10, 0, 0).getTime()
const MIN = 60000
const DE = { options: { language: 'de' } } as const
const ACCENT = 'warning' // Theme-Key, HELP-SPEC §4 (0.7.1)

function world(on: On, o: { saved?: Map<string, unknown>; storeGetFails?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const saved = o.saved ?? new Map<string, unknown>()
  const commands: string[] = []
  let listed = 0
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: undefined, window: 1000000 }, rateLimits: [] } }))
  on('store.get', ($, e) => (o.storeGetFails ? { deny: 'kaputt' } : { value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => {
    listed += 1
    return { value: [{ name: 'limit-bars:uebergabe', description: 'Übergabe', source: 'plugin' }] }
  })
  on('command.run', ($, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  // Die Engine zeichnet eine Befehlszeile als Text; erkennbar am Präfix
  on('ui.render', ($, e) =>
    e.component === 'CommandOutput'
      ? { type: 'Text', props: {}, children: [`ENGINE:${String((e.props as { text?: string }).text ?? '')}`] }
      : { type: 'engine', ref: 0 },
  )
  return {
    clock,
    saved,
    commands,
    get listed() {
      return listed
    },
  }
}

const run = async ($: any, command: string, args = '') => (await $.command.run({ command, args } as never)).text as string
const bars = ($: any, args = '') => run($, 'bars', args)

async function mountHelp($: any, text: string, surface: string, columns = 120, isErrored = false) {
  return $.ui.mount({
    plugin: 'limit-bars',
    component: 'CommandOutput',
    requestId: `h-${surface}-${columns}-${isErrored}`,
    surface,
    viewport: { columns, rows: 40 },
    props: { command: 'bars', args: 'help', text, isErrored },
  })
}

const has = async (ui: any, text: string | RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

// ---------- Befehl ----------

test('0.7.0 Hilfe: help, ?, HELP und Leerzeichen liefern Markdown mit Kennung (en); weitere Wörter sind unbekannt', async ($, on) => {
  world(on)
  for (const word of ['help', '?', 'HELP', '  help  ']) {
    const text = await bars($, word)
    expect(text, word).toMatch(/^\*\*limit-bars · Help\*\* · #[0-9a-z]{5,}\n\nUsage limits as bars above the prompt/)
    expect(text.length < 10_000, word).toBe(true)
  }
  expect(await bars($, 'help me')).toBe(T.en.unknownArg('help me', '[show 5h|week|cache|storage on|off] [reset] [help]'))
  expect(await bars($, 'help me')).toContain('→ `/bars help`')
  expect(parseBars('?')).toEqual({ kind: 'help' })
  expect(parseBars('show help')).toEqual({ kind: 'bad' })
})

test('0.7.0 Hilfe (de): Markdown mit allen fünf Befehlen, Skill, Funktionen, Einstellungen und Terminal-Fußzeile', DE, async ($, on) => {
  world(on)
  const text = await bars($, 'help')
  const lines = text.split('\n')
  expect(lines[0]).toMatch(/^\*\*limit-bars · Hilfe\*\* · #[0-9a-z]{5,}$/)
  expect(lines).toContain('**BEFEHLE**')
  // Leerzeilen zwischen den Blöcken (Vorlage 3ad541e), sonst hängt CommonMark alles an den letzten Listenpunkt
  expect(lines[lines.indexOf('**BEFEHLE**') - 1]).toBe('')
  expect(lines[lines.findIndex((l) => l.startsWith('**FUNKTIONEN:**')) - 1]).toBe('')
  expect(lines[lines.length - 2]).toBe('')
  for (const cmd of ['/bars', '/bars show 5h|week|cache|storage on|off', '/bars reset', '/bars help', '/cache', '/cache ttl 5|60|auto', '/cache warn on|off', '/cache hints on|off', '/cache big <n>', '/handoff', '/handoff show', '/handoff continue', '/keepwarm [stunden]', '/keepwarm off', '/disk [refresh]', 'Skill uebergabe'])
    expect(lines.some((l) => l.startsWith(`- \`${cmd}\`: `)), cmd).toBe(true)
  expect(text).toMatch(/^\*\*FUNKTIONEN:\*\* 5-Stunden-Balken ● an · per Einstellung \(\/bars 5h off\) · Wochen-Balken ● an · per Einstellung \(\/bars week off\) · Cache-Ring ● an · per Einstellung \(\/bars cache off\) · Speicher-Ring ○ ohne storagePath \(Einstellung storagePath\) · Rückfrage vor kaltem Senden ● an \(\/cache warn off\) · Hinweis vor Ablauf ● an \(\/cache hints off\) · Schwelle „groß“ 150k \(Standard\) \(\/cache big <n>\) · Cache-Dauer auto · 60 min \(Standard\) \(\/cache ttl 5\|60\|auto\) · Warmhalten ○ aus \(\/keepwarm \[stunden\]\)$/m)
  expect(text).toMatch(/^\*\*EINSTELLUNGEN \(\/plugin\):\*\* Sprache de · Reset-Anzeige mixed \(Standard\) · Hervorheben ab \(%\) 90 \(Standard\) · 5-Stunden-Balken zeigen an \(Standard\) · Wochen-Balken zeigen an \(Standard\) · Cache-Ring zeigen an \(Standard\) · Speicher-Ring zeigen an \(Standard\) · Nur 5-Stunden-Limit \(veraltet\) aus \(Standard\) · Speicher-Laufwerk leer = aus \(Standard\)$/m)
  expect(lines[lines.length - 1]).toBe('Einstellungen ändern: /plugin configure limit-bars · Mod abschalten: /plugin disable limit-bars')
})

test('0.7.0 Hilfe: Lesefehler im Store → Hilfe trotzdem, mit den Standards', DE, async ($, on) => {
  world(on, { storeGetFails: true })
  const text = await bars($, 'help')
  expect(text).toMatch(/^\*\*limit-bars · Hilfe\*\*/)
  expect(text).toMatch(/Rückfrage vor kaltem Senden ● an/)
})

// ---------- Zeichnung ----------

for (const surface of ['terminal', 'desktop'] as const)
  test(`0.7.0 Hilfe UI ${surface}: Rahmen, Titel und Überschriften in Gelb, Befehle in Gelb, Fließtext ohne Akzent, Schalter, Fußzeile`, DE, async ($, on) => {
    world(on)
    const ui = await mountHelp($, await bars($, 'help'), surface)
    expect(await ui.find({ text: /^ENGINE:/ })).toBeUndefined()
    const tree = await ui.drawn()
    expect(tree.props).toMatchObject({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%', key: 'limit-bars-help' })
    expect(HELP_ACCENT).toBe(ACCENT)
    expect((await ui.find({ type: 'Text', text: 'limit-bars · Hilfe' }))?.props).toMatchObject({ color: ACCENT, bold: true })
    for (const h of ['BEFEHLE', 'FUNKTIONEN', 'STATUS', 'UMSCHALTEN', 'EINSTELLUNGEN (/plugin)', 'WERT'])
      expect((await ui.find({ type: 'Text', text: h }))?.props.color, h).toBe(ACCENT)
    expect(await has(ui, 'BEDIENUNG')).toBe(false) // keine Klicks oder Tasten
    for (const cmd of ['/bars', '/bars show 5h|week|cache|storage on|off', '/cache warn on|off', '/handoff continue', '/keepwarm off', '/disk [refresh]', 'Skill uebergabe'])
      expect((await ui.find({ type: 'Text', text: cmd }))?.props.color, cmd).toBe(ACCENT)
    expect((await ui.find({ type: 'Text', text: /^Limits als Balken/ }))?.props.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^Teil ein- oder ausblenden/ }))?.props.color).toBeUndefined()
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some((x: any) => x.children?.[0] === '● ' && x.props.color === 'success')).toBe(true)
    expect(texts.some((x: any) => x.children?.[0] === '○ ' && x.props.color === 'inactive')).toBe(true)
    expect(texts.some((x: any) => x.children?.[0] === 'ohne storagePath' && x.props.color === 'inactive')).toBe(true)
    expect(await has(ui, '/bars cache off')).toBe(true)
    expect(await has(ui, ' (Standard)')).toBe(true)
    const footer = surface === 'desktop' ? 'Mod abschalten: + → Plugins → Manage plugins · Einstellungen ändern: im Terminal /plugin configure limit-bars' : 'Einstellungen ändern: /plugin configure limit-bars · Mod abschalten: /plugin disable limit-bars'
    expect(await has(ui, footer)).toBe(true)
    await ui.unmount()
  })

test('0.7.0 Hilfe UI: VS Code, mobil, Fehlerzeile, unbekannte Kennung und gewöhnliches /bars → Engine zeichnet den Text', DE, async ($, on) => {
  world(on)
  const text = await bars($, 'help')
  for (const surface of ['vscode', 'mobile']) {
    const ui = await mountHelp($, text, surface)
    expect(await ui.find({ text: /^ENGINE:/ }), String(surface)).toBeDefined()
    await ui.unmount()
  }
  const errored = await mountHelp($, text, 'terminal', 100, true)
  expect(await errored.find({ text: /^ENGINE:/ })).toBeDefined()
  await errored.unmount()
  const unknown = await mountHelp($, '**limit-bars · Hilfe** · #zzzzzz', 'desktop')
  expect(await unknown.find({ text: /^ENGINE:/ })).toBeDefined()
  await unknown.unmount()
  // Die Statustabelle von /bars bleibt Markdown
  const status = await mountHelp($, await bars($), 'terminal')
  expect(await status.find({ text: /^ENGINE:### limit-bars · Anzeige/ })).toBeDefined()
  await status.unmount()
  // 0.7.2: gültige Kennung, aber die Zeile stammt nicht von `/bars help` (z. B. `/bars #kennung`) → Engine (Review worklist, K2)
  const mountArgs = (args: string, surface: string) =>
    $.ui.mount({
      plugin: 'limit-bars', component: 'CommandOutput', requestId: `h-args-${args}-${surface}`, surface, viewport: { columns: 100, rows: 40 },
      props: { command: 'bars', args, text, isErrored: false },
    })
  const tag = /#[0-9a-z]{5,}/.exec(text)![0]
  for (const args of [tag, 'status', 'help me']) {
    const ui = await mountArgs(args, 'terminal')
    expect(await ui.find({ text: /^ENGINE:/ }), args).toBeDefined()
    await ui.unmount()
  }
  for (const args of ['?', ' HELP ']) {
    const ui = await mountArgs(args, 'desktop')
    expect(await has(ui, 'limit-bars · Hilfe'), args).toBe(true)
    await ui.unmount()
  }
  // Kennung auch hinter dem Präfix „limit-bars: “ (templates/help/README.md, Befunde)
  const prefixed = await mountHelp($, `limit-bars: ${text}`, 'terminal')
  expect(await has(prefixed, 'limit-bars · Hilfe')).toBe(true)
  await prefixed.unmount()
})

test('0.7.0 Hilfe UI: höchstens 10 Schnappschüsse, der älteste fällt heraus', DE, async ($, on) => {
  world(on)
  const first = await bars($, 'help')
  for (let i = 0; i < 10; i++) await bars($, 'help')
  const old = await mountHelp($, first, 'terminal')
  expect(await old.find({ text: /^ENGINE:/ })).toBeDefined()
  await old.unmount()
  const fresh = await mountHelp($, await bars($, 'help'), 'terminal')
  expect(await fresh.find({ text: /^ENGINE:/ })).toBeUndefined()
  await fresh.unmount()
})

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of [30, 40, 50, 59, 60, 100, 140, 200])
    test(`0.7.0 Hilfe UI ${surface} bei ${columns} Spalten: nichts zu breit, Desktop nur ganzzahlige Prozent`, DE, async ($, on) => {
      world(on)
      const ui = await mountHelp($, await bars($, 'help'), surface, columns)
      const inner = Math.max(30, Math.min(140, columns)) - 4
      const boxes = await ui.findAll({ type: 'Box' })
      const widths = boxes.map((b: any) => b.props.width).filter((x: unknown) => x !== undefined && x !== '100%')
      if (surface === 'desktop') expect(widths.filter((x: unknown) => !(typeof x === 'string' && /^\d+%$/.test(x)))).toEqual([])
      else expect(widths.filter((x: unknown) => typeof x === 'number' && x > inner)).toEqual([])
      for (const r of boxes.filter((b: any) => b.props.flexDirection === 'row' && b.children?.length && b.children.every((c: any) => typeof c === 'object' && /^\d+%$/.test(String(c.props?.width)))))
        expect((r as any).children.reduce((a: number, c: any) => a + parseInt(c.props.width, 10), 0)).toBe(100)
      for (const r of boxes.filter((b: any) => b.props.flexDirection === 'row'))
        expect((r as any).children.reduce((a: number, c: any) => a + (typeof c === 'object' && typeof c.props?.width === 'number' ? c.props.width : 0), 0) <= inner).toBe(true)
      if (columns < 60) expect(boxes.some((b: any) => b.props.flexDirection === 'row' && b.children?.some((c: any) => typeof c === 'object' && c.props?.width !== undefined))).toBe(false)
      expect(await has(ui, '/bars show 5h|week|cache|storage on|off')).toBe(true)
      expect(await has(ui, 'Speicher-Laufwerk')).toBe(true)
      await ui.unmount()
    })

// ---------- Zustand beim Aufruf ----------

test('0.7.0 Hilfe: Zustand stimmt nach dem Umschalten (/bars, /cache, /keepwarm)', DE, async ($, on) => {
  world(on, {
    saved: new Map<string, unknown>([
      ['cache:sess-1', { lastActivity: NOW - 10 * MIN, ttl: 60, ttlSource: 'gemessen', ctx: 212000, model: 'claude-opus-5-5', savedAt: NOW - 10 * MIN }],
    ]),
  })
  expect(await bars($, 'help')).toMatch(/Cache-Dauer auto · 60 min gemessen \(\/cache ttl/)
  await bars($, 'cache off')
  await bars($, 'week off')
  // Warmhalten vor ttl 5: mit 5 min wäre der Cache nach 10 min schon kalt
  expect(await run($, 'keepwarm', '2')).toMatch(/^Warmhalten an bis 12:00/)
  await run($, 'cache', 'warn off')
  await run($, 'cache', 'hints off')
  await run($, 'cache', 'big 300k')
  await run($, 'cache', 'ttl 5')
  const text = await bars($, 'help')
  expect(text).toMatch(/Cache-Ring ○ aus · per Befehl \(\/bars cache on\)/)
  expect(text).toMatch(/Wochen-Balken ○ aus · per Befehl \(\/bars week on\)/)
  expect(text).toMatch(/5-Stunden-Balken ● an · per Einstellung \(\/bars 5h off\)/)
  expect(text).toMatch(/Rückfrage vor kaltem Senden ○ aus \(\/cache warn on\)/)
  expect(text).toMatch(/Hinweis vor Ablauf ○ aus \(\/cache hints on\)/)
  expect(text).toMatch(/Schwelle „groß“ 300k \(\/cache big <n>\)/)
  expect(text).toMatch(/Cache-Dauer 5 min \(\/cache ttl 5\|60\|auto\)/)
  expect(text).toMatch(/Warmhalten ● bis 12:00 \(\/keepwarm off\)/)
  const ui = await mountHelp($, text, 'desktop')
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.some((x: any) => x.children?.[0] === 'aus · per Befehl' && x.props.color === 'inactive')).toBe(true)
  expect(await has(ui, 'bis 12:00')).toBe(true)
  await ui.unmount()
  // Die Hilfe ist eine Momentaufnahme: nach /bars reset zeigt erst ein neuer Aufruf den neuen Stand
  await bars($, 'reset')
  expect(await bars($, 'help')).toMatch(/Cache-Ring ● an · per Einstellung/)
})

test('0.7.0 Hilfe: Einstellungen aus userConfig mit Wert und Standard; Speicher-Ring mit Laufwerk', { options: { language: 'de', storagePath: 'E:\\', showWeekly: false, highlightAt: 80, resetStyle: 'clock' } }, async ($, on) => {
  world(on)
  const text = await bars($, 'help')
  expect(text).toMatch(/Wochen-Balken ○ aus · per Einstellung \(\/bars week on\)/)
  expect(text).toMatch(/Speicher-Ring ● an · per Einstellung \(\/bars storage off\)/)
  expect(text).toMatch(/Reset-Anzeige clock · Hervorheben ab \(%\) 80 · /)
  expect(text).toMatch(/Wochen-Balken zeigen aus · /)
  expect(text).toMatch(/Speicher-Laufwerk E:\\$/m)
})

test('0.7.0 Hilfe: Speicher-Ring mit Pfad ohne Laufwerksbuchstaben', { options: { language: 'en', storagePath: '/mnt/data' } }, async ($, on) => {
  world(on)
  expect(await bars($, 'help')).toMatch(/Storage ring ○ no drive letter \(setting storagePath\)/)
})

// ---------- Nebenbefehle ----------

test('0.7.0 Nebenbefehle: /cache, /keepwarm, /disk und /handoff mit help oder ? antworten mit dem Verweis', DE, async ($, on) => {
  const w = world(on)
  for (const cmd of ['cache', 'keepwarm', 'disk', 'handoff'])
    for (const arg of ['help', '?', 'HELP']) expect(await run($, cmd, arg), `${cmd} ${arg}`).toBe('Alle Befehle: `/bars help`')
  // /cache help ändert keine Einstellung
  expect(w.saved.has('settings')).toBe(false)
})

test('0.7.0 /handoff help startet keine Übergabe (bis 0.6.x startete jedes Argument eine)', async ($, on) => {
  const w = world(on)
  expect(await run($, 'handoff', 'help')).toBe('All commands: `/bars help`')
  await w.clock.advance(2000)
  expect(w.listed).toBe(0)
  expect(w.commands).toEqual([])
  // Danach startet ein echtes /handoff normal (nicht „läuft schon“)
  expect(await run($, 'handoff')).toBe(T.en.handoffWriting)
  await w.clock.advance(1000)
  expect(w.commands).toEqual(['limit-bars:uebergabe'])
})

test('0.7.0 Unbekannte Argumente verweisen auf /bars help', DE, async ($, on) => {
  world(on)
  expect(await run($, 'cache', 'quatsch an')).toContain('→ `/bars help`')
  expect(await run($, 'disk', 'quatsch')).toContain('→ `/bars help`')
  expect(await run($, 'keepwarm', 'quatsch')).toContain('→ `/bars help`')
  expect(await bars($, 'quatsch')).toContain('→ `/bars help`')
})

// ---------- Vollständigkeit (HELP-SPEC §6 Punkt 5) ----------

const input = (o: Partial<HelpInput> = {}): HelpInput => ({
  lang: 'de',
  options: {},
  shown: { fiveHour: true, weekly: true, cache: true, storage: true },
  overrides: {},
  storagePath: '',
  hasDrive: false,
  settings: { ...DEFAULT_SETTINGS },
  memTtl: 60,
  memTtlSource: 'Standard',
  keep: null,
  ...o,
})

test('0.7.0 Hilfe Vollständigkeit: jedes Wort, das die Parser annehmen, steht in der Hilfe', () => {
  // Wortlisten, die die Parser selbst nutzen: /cache (cache.ts applySetting), /handoff, /keepwarm, /disk (register.ts)
  const SIDE = [...Object.values(CACHE_WORDS).flat(), ...HANDOFF_SHOW_WORDS, ...HANDOFF_CONTINUE_WORDS, ...KEEP_OFF_WORDS, ...DISK_WORDS]
  const OTHER = ['/handoff', '/keepwarm', '/disk', '/cache', '/bars', 'uebergabe']
  for (const lang of ['en', 'de'] as const) {
    const d = barsHelpData(input({ lang }))
    // Ganze Wörter aus Befehlsspalte und Alias-Zeile, nicht Teilstrings (templates/help/README.md: sonst steckt `on` in „configure“)
    const tokens = new Set([...d.commands.map((c) => c.cmd), ...(d.notes ?? [])].join(' ').split(/[\s·,|=()[\]<>]+/).filter(Boolean))
    for (const word of [...HELP_WORDS, ...STATUS_WORDS, ...RESET_WORDS, ...SHOW_WORDS, ...ON_OFF_WORDS, ...PART_WORDS, ...SIDE, ...OTHER])
      expect(tokens.has(word), `${lang}: ${word}`).toBe(true)
    expect(tokens.has('configure'), lang).toBe(false) // nur Befehle und Aliase, nicht die Fußzeile
    // alle vier Teile und alle neun Einstellungen
    expect(d.features.slice(0, 4).map((f) => f.toggle)).toEqual(['/bars 5h off', '/bars week off', '/bars cache off', lang === 'de' ? 'Einstellung storagePath' : 'setting storagePath'])
    expect(d.settings.length).toBe(9)
  }
})

test('0.7.0 Hilfe-Daten: Werte, Standard und Zustandstexte', () => {
  const d = barsHelpData(input({ lang: 'en', overrides: { fiveHour: false }, shown: { fiveHour: false, weekly: true, cache: true, storage: true }, hasDrive: true, storagePath: 'E:\\', memTtlSource: 'gemessen', memTtl: 5 }))
  expect(d.features[0]).toEqual({ name: '5-hour bar', state: { kind: 'off', text: 'off · by /bars' }, toggle: '/bars 5h on' })
  expect(d.features[3]).toEqual({ name: 'Storage ring', state: { kind: 'on', text: 'on · by setting' }, toggle: '/bars storage off' })
  expect(d.features[7]!.state).toEqual({ kind: 'value', text: 'auto · 5 min measured', isDefault: false })
  expect(d.features[8]).toEqual({ name: 'Keep-warm', state: { kind: 'off' }, toggle: '/keepwarm [hours]' })
  expect(d.settings[0]).toEqual({ title: 'Language', value: 'en', isDefault: true })
  expect(d.settings[8]).toEqual({ title: 'Storage drive', value: 'E:\\' })
  expect(stateText(d.features[0]!.state, 'en')).toBe('○ off · by /bars')
  expect(stateText(d.features[7]!.state, 'en')).toBe('auto · 5 min measured')
  // Speicher-Ring per /bars aus und ohne Laufwerk: Schalter ist storagePath, nicht /bars storage on (Review K4)
  const off = barsHelpData(input({ lang: 'en', overrides: { storage: false }, shown: { fiveHour: true, weekly: true, cache: true, storage: false } }))
  expect(off.features[3]).toEqual({ name: 'Storage ring', state: { kind: 'off', text: 'off · by /bars' }, toggle: 'setting storagePath' })
})
