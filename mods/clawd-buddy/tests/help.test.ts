// clawd-buddy 0.7.0: /clawd help als gezeichnete Tabelle (docs/HELP-SPEC.md §6). help.ts ist eine Kopie von templates/help/help.ts.
import { expect, mock, test } from 'claude-code/testing'
import { ACCENT, DEFAULTS, HELP_WORDS, SUBCOMMANDS, clawdHelp, isHelp } from '../hooks/clawdhelp.ts'
import { stateText } from '../hooks/help.ts'

const DE = { options: { language: 'de' } }

/** Speicher, Log und ein fremder Inhalt für `next(e)` bei jedem ui.render (wie in clawd-buddy.test.ts). */
function stubs(on: any) {
  const store = new Map<string, unknown>()
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
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['ENGINE'] }))
  return { store, logs }
}

const clawd = async ($: any, args: string): Promise<string> => String(((await $.command.run({ command: 'clawd', args })) as { text?: string }).text)

/** Eine Zeile der Befehlsausgabe zeichnen, wie die Engine es tut (types CommandOutput). */
const mount = ($: any, text: string, surface: string, columns = 100, isErrored = false, args = 'help') =>
  $.ui.mount({
    plugin: 'clawd-buddy',
    component: 'CommandOutput',
    requestId: `help-${surface}-${columns}`,
    surface,
    viewport: { columns, rows: 30 },
    props: { command: 'clawd', args, text, isErrored },
  })

test('Hilfe: help, ?, HELP und Leerzeichen liefern Markdown mit Kennung (en); weitere Wörter sind unbekannt und verweisen auf /clawd help', async ($, on) => {
  mock.clock(on)
  stubs(on)
  for (const word of ['help', '?', 'HELP', '  help  ']) {
    const text = await clawd($, word)
    expect(text, word).toMatch(/^\*\*clawd-buddy · Help\*\* · #[0-9a-z]{5,}\n\nAn animated pixel mascot above the prompt/)
    expect(text.length < 10_000, word).toBe(true)
  }
  expect(await clawd($, 'help me')).toBe('unknown: help. Commands: on | off | list | demo <animation> | nap | boop | status | flicker | help → /clawd help')
  expect(await clawd($, 'quatsch')).toBe('unknown: quatsch. Commands: on | off | list | demo <animation> | nap | boop | status | flicker | help → /clawd help')
  // Der Status nennt help in der Kurzzeile
  expect(await clawd($, '')).toMatch(/\| flicker \| help$/)
})

test('Hilfe (de): Markdown mit Befehlen, Bedienung, Funktionen, Einstellungen und Terminal-Fußzeile', DE, async ($, on) => {
  mock.clock(on)
  stubs(on)
  const text = await clawd($, 'help')
  const lines = text.split('\n')
  expect(lines[0]).toMatch(/^\*\*clawd-buddy · Hilfe\*\* · #[0-9a-z]{5,}$/)
  expect(lines).toContain('**BEFEHLE**')
  expect(lines).toContain('- `/clawd [status]`: Status: an/aus, Laune, Müdigkeit, Ärger; im Desktop auch Messwerte der Zeichnung')
  expect(lines).toContain('- `/clawd nap`: Schickt ihn für etwa 5 Minuten schlafen')
  expect(lines).toContain('**BEDIENUNG**')
  expect(lines).toContain('- `Klick auf Clawd`: Terminal: kichert; viele Klicks ärgern ihn (zählt in status)')
  expect(text).toMatch(/^\*\*FUNKTIONEN:\*\* Buddy ● an \(\/clawd off\) · Weniger Bewegung ○ aus \(Einstellung\)$/m)
  expect(text).toMatch(
    /^\*\*EINSTELLUNGEN \(\/plugin\):\*\* Nacht beginnt \(Stunde\) 23 \(Standard\) · Nacht endet \(Stunde\) 6 \(Standard\) · Leerlauf bis Zeitvertreib \(s\) 45 \(Standard\) · Weniger Bewegung aus \(Standard\) · Position im Band rechts \(Standard\) · Geburtstag \(TT\.MM\.\) 05\.01\. \(Standard\) · Sprache de$/m,
  )
  expect(lines[lines.length - 1]).toBe('Einstellungen ändern: /plugin configure clawd-buddy · Mod abschalten: /plugin disable clawd-buddy')
  // Leerzeile vor jedem Block, sonst hängt CommonMark ihn an den letzten Listenpunkt (templates/help/README.md, 0.7.1)
  for (const block of ['**BEFEHLE**', '**BEDIENUNG**', '**FUNKTIONEN:**', '**EINSTELLUNGEN (/plugin):**', 'Einstellungen ändern:'])
    expect(lines[lines.findIndex((l) => l.startsWith(block)) - 1], block).toBe('')
  // Unbekannt (de): Kurzhilfe und Verweis
  expect(await clawd($, 'hilfe')).toBe('unbekannt: hilfe. Befehle: on | off | list | demo <animation> | nap | boop | status | flicker | help → /clawd help')
})

test('Hilfe: Einstellungen abweichend vom Standard (Optionen) erscheinen mit ihrem Wert, ohne „(Standard)“', { options: { language: 'de', nightStart: 22, nightEnd: 7, idleSeconds: 90, reducedMotion: true, side: 'left', birthday: '' } }, async ($, on) => {
  mock.clock(on)
  stubs(on)
  const text = await clawd($, '?')
  expect(text).toMatch(/Weniger Bewegung ● an \(Einstellung\)/)
  expect(text).toMatch(
    /Nacht beginnt \(Stunde\) 22 · Nacht endet \(Stunde\) 7 · Leerlauf bis Zeitvertreib \(s\) 90 · Weniger Bewegung an · Position im Band links · Geburtstag \(TT\.MM\.\) aus \(leer\) · Sprache de$/m,
  )
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`Hilfe UI ${surface}: Rahmen, Titel und Überschriften in Claude-Orange, Befehle in Orange, Fließtext ohne Akzent, Schalter, Fußzeile je Surface`, DE, async ($, on) => {
    mock.clock(on)
    stubs(on)
    const ui = await mount($, await clawd($, 'help'), surface)
    expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeUndefined()
    const tree = await ui.drawn()
    expect(tree.props).toMatchObject({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%', key: 'clawd-buddy-help' })
    expect((await ui.find({ type: 'Text', text: 'clawd-buddy · Hilfe' }))?.props).toMatchObject({ color: ACCENT, bold: true })
    for (const h of ['BEFEHLE', 'BEDIENUNG', 'FUNKTIONEN', 'STATUS', 'UMSCHALTEN', 'EINSTELLUNGEN (/plugin)', 'WERT'])
      expect((await ui.find({ type: 'Text', text: h }))?.props.color, h).toBe(ACCENT)
    for (const cmd of ['/clawd [status]', '/clawd on', '/clawd off', '/clawd list', '/clawd demo <animation>', '/clawd nap', '/clawd boop', '/clawd flicker', '/clawd help', 'Klick auf Clawd'])
      expect((await ui.find({ type: 'Text', text: cmd }))?.props.color, cmd).toBe(ACCENT)
    expect((await ui.find({ type: 'Text', text: /^Ein animiertes Pixel-Maskottchen/ }))?.props.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^Blendet Clawd aus/ }))?.props.color).toBeUndefined()
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some((x: any) => x.children?.[0] === '● ' && x.props.color === 'success')).toBe(true)
    expect(texts.some((x: any) => x.children?.[0] === '○ ' && x.props.color === 'inactive')).toBe(true)
    expect(await ui.find({ type: 'Text', text: ' (Standard)' })).toBeDefined()
    const footer =
      surface === 'desktop' ? 'Mod abschalten: + → Plugins → Manage plugins · Einstellungen ändern: im Terminal /plugin configure clawd-buddy' : 'Einstellungen ändern: /plugin configure clawd-buddy · Mod abschalten: /plugin disable clawd-buddy'
    expect(await ui.find({ type: 'Text', text: footer })).toBeDefined()
    await ui.unmount()
  })

test('Hilfe: Zustand beim Aufruf: /clawd off → Buddy ○ mit /clawd on; /clawd on → ● mit /clawd off', DE, async ($, on) => {
  mock.clock(on)
  stubs(on)
  await clawd($, 'off')
  const off = await mount($, await clawd($, 'help'), 'terminal')
  expect(await off.find({ type: 'Text', text: '/clawd on' })).toBeDefined()
  const offTexts = await off.findAll({ type: 'Text' })
  // Buddy aus und Weniger Bewegung aus: zwei ○, kein ●
  expect(offTexts.filter((x: any) => x.children?.[0] === '○ ').length).toBe(2)
  expect(offTexts.some((x: any) => x.children?.[0] === '● ')).toBe(false)
  await off.unmount()
  await clawd($, 'on')
  expect(await clawd($, 'help')).toMatch(/Buddy ● an \(\/clawd off\)/)
})

test('Hilfe UI: VS Code, mobile (ohne eigene Zeichnung), Fehlerzeile und unbekannte Kennung → next(e); Kennung hinter „clawd-buddy: “ wird gefunden', DE, async ($, on) => {
  mock.clock(on)
  stubs(on)
  const text = await clawd($, 'help')
  for (const surface of ['vscode', 'mobile']) {
    const ui = await mount($, text, surface)
    expect(await ui.find({ type: 'Text', text: 'ENGINE' }), String(surface)).toBeDefined()
    await ui.unmount()
  }
  const errored = await mount($, text, 'terminal', 100, true)
  expect(await errored.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  await errored.unmount()
  const unknown = await mount($, '**clawd-buddy · Hilfe** · #zzzzzz', 'desktop')
  expect(await unknown.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  await unknown.unmount()
  // Andere Ausgaben von /clawd (Status, list) zeichnet die Engine
  const status = await mount($, await clawd($, 'status'), 'terminal')
  expect(await status.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  await status.unmount()
  // Wie in -p und interaktiv: „clawd-buddy: “ vor der Antwort (templates/help/README.md, Befunde)
  const prefixed = await mount($, `clawd-buddy: ${text}`, 'terminal')
  expect(await prefixed.find({ type: 'Text', text: 'clawd-buddy · Hilfe' })).toBeDefined()
  await prefixed.unmount()
})

test('Hilfe UI: eine gültige Kennung als eingetipptes Argument (/clawd demo #…) zeichnet keine Hilfe (Review 0.7.0 K2)', DE, async ($, on) => {
  mock.clock(on)
  stubs(on)
  const tag = /#[0-9a-z]{5,}/.exec(await clawd($, 'help'))![0]
  const answer = await clawd($, `demo ${tag}`)
  expect(answer).toContain(tag)
  const ui = await mount($, answer, 'terminal', 100, false, `demo ${tag}`)
  expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  await ui.unmount()
})

test('Hilfe UI (en): englische Überschriften, Titel und Fußzeile', async ($, on) => {
  mock.clock(on)
  stubs(on)
  const ui = await mount($, await clawd($, 'help'), 'desktop')
  expect((await ui.find({ type: 'Text', text: 'clawd-buddy · Help' }))?.props).toMatchObject({ color: ACCENT, bold: true })
  for (const h of ['COMMANDS', 'CONTROLS', 'FEATURES', 'STATUS', 'TOGGLE', 'SETTINGS (/plugin)', 'VALUE'])
    expect((await ui.find({ type: 'Text', text: h }))?.props.color, h).toBe(ACCENT)
  expect(await ui.find({ type: 'Text', text: 'Click on Clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Idle time before pastimes (s)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Turn the mod off: + → Plugins → Manage plugins · Change settings: /plugin configure clawd-buddy in a terminal' })).toBeDefined()
  await ui.unmount()
})

test('Hilfe: höchstens 10 Schnappschüsse; der älteste fällt heraus und wird dann von der Engine gezeichnet', DE, async ($, on) => {
  mock.clock(on)
  stubs(on)
  const first = await clawd($, 'help')
  for (let i = 0; i < 10; i++) await clawd($, 'help')
  const old = await mount($, first, 'terminal')
  expect(await old.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  await old.unmount()
  const fresh = await mount($, await clawd($, 'help'), 'terminal')
  expect(await fresh.find({ type: 'Text', text: 'ENGINE' })).toBeUndefined()
  await fresh.unmount()
})

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of [30, 40, 59, 60, 100, 140, 200])
    test(`Hilfe UI ${surface} bei ${columns} Spalten: nichts zu breit, Desktop nur ganzzahlige Prozent`, DE, async ($, on) => {
      mock.clock(on)
      stubs(on)
      const ui = await mount($, await clawd($, 'help'), surface, columns)
      const inner = Math.max(30, Math.min(140, columns)) - 4
      const boxes = await ui.findAll({ type: 'Box' })
      const widths = boxes.map((b: any) => b.props.width).filter((x: unknown) => x !== undefined)
      if (surface === 'desktop') expect(widths.filter((x: unknown) => !(typeof x === 'string' && /^\d+%$/.test(x)))).toEqual([])
      else expect(widths.filter((x: unknown) => typeof x === 'number' && x > inner)).toEqual([])
      for (const r of boxes.filter((b: any) => b.props.flexDirection === 'row' && b.children?.length && b.children.every((c: any) => typeof c === 'object' && /^\d+%$/.test(String(c.props?.width)))))
        expect((r as any).children.reduce((a: number, c: any) => a + parseInt(c.props.width, 10), 0)).toBe(100)
      for (const r of boxes.filter((b: any) => b.props.flexDirection === 'row'))
        expect((r as any).children.reduce((a: number, c: any) => a + (typeof c === 'object' && typeof c.props?.width === 'number' ? c.props.width : 0), 0) <= inner).toBe(true)
      if (columns < 60) expect(boxes.some((b: any) => b.props.flexDirection === 'row' && b.children?.some((c: any) => typeof c === 'object' && c.props?.width !== undefined))).toBe(false)
      expect(await ui.find({ type: 'Text', text: '/clawd demo <animation>' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Geburtstag (TT.MM.)' })).toBeDefined()
      await ui.unmount()
    })

test('Hilfe Vollständigkeit: jeder Unterbefehl und jedes Hilfe-Wort, das der Parser annimmt, steht in der Hilfe (HELP-SPEC §6 Punkt 5)', () => {
  for (const lang of ['en', 'de'] as const) {
    const d = clawdHelp({ ...DEFAULTS, lang, enabled: true, side: 'right' })
    const cmds = d.commands.map((c) => c.cmd)
    // Als ganze Wörter (Tokens), nicht als Teilstring: sonst steckt `on` in „configure“ (templates/help/README.md)
    const cmdTokens = new Set(cmds.flatMap((c) => c.split(/[\s[\]]+/).filter(Boolean)))
    for (const word of SUBCOMMANDS) expect(cmdTokens.has(word), `${lang}: ${word}`).toBe(true)
    const helpTokens = new Set(d.commands.flatMap((c) => `${c.cmd} ${c.does}`.split(/[\s()[\]]+/).filter(Boolean)))
    for (const word of HELP_WORDS) expect(helpTokens.has(word), `${lang}: ${word}`).toBe(true)
    // Jede Einstellung aus plugin.json steht da (sieben Felder)
    expect(d.settings.length).toBe(7)
  }
})

test('Hilfe: isHelp, Standardwerte und Zustandstexte', () => {
  expect(isHelp('help')).toBe(true)
  expect(isHelp(' ? ')).toBe(true)
  expect(isHelp('Help')).toBe(true)
  expect(isHelp('help me')).toBe(false)
  expect(isHelp('')).toBe(false)
  expect(isHelp('hilfe')).toBe(false)
  const en = clawdHelp({ ...DEFAULTS, lang: 'en', enabled: false, side: 'right' })
  expect(en.features[0]).toEqual({ name: 'Buddy', state: { kind: 'off' }, toggle: '/clawd on' })
  expect(en.settings.map((s) => [s.value, s.isDefault])).toEqual([['23', true], ['6', true], ['45', true], ['off', true], ['right', true], ['05.01.', true], ['en', true]])
  expect(stateText(en.features[1]!.state, 'en')).toBe('○ off')
})
