import { expect, test } from 'claude-code/testing'
import { forkStateText, langOf, T } from '../hooks/i18n.ts'
import { clean, forkPrompt, keyOf, merge, parseFork } from '../hooks/logic.ts'
import { chooseLayout, label } from '../hooks/view.ts'

test('Zusammenführen: Claude Code vorn, dann Fork, höchstens 4, ohne Doppelte; ohne Quellen leer', () => {
  const r = merge('Teste es!', ['teste es', 'Zeig den Log', 'Mach weiter', 'Vierter'])
  expect(r.map((x) => x.text)).toEqual(['Teste es!', 'Zeig den Log', 'Mach weiter'])
  expect(r.map((x) => x.source)).toEqual(['engine', 'fork', 'fork'])
  expect(merge('Nur einer', [])).toEqual([{ text: 'Nur einer', source: 'engine' }])
  expect(merge('', ['A', 'B', 'C']).length).toBe(3)
  expect(merge('', [])).toEqual([])
  expect(merge('X', ['A', 'B', 'C']).length).toBe(4)
  expect(new Set(merge('X', ['A', 'B', 'C']).map((x) => keyOf(x.text))).size).toBe(4)
})

test('Fork-Antwort: JSON-Array aus Strings oder Objekten mit prompt, Müll, Text drumherum', () => {
  expect(parseFork('["Teste es","Zeig den Diff","Weiter","zu viel"]')).toEqual(['Teste es', 'Zeig den Diff', 'Weiter'])
  expect(parseFork('Hier: [{"label":"x","prompt":"Lauf die Tests"}, 3, "B"] fertig')).toEqual(['Lauf die Tests', 'B'])
  // Länger als der Knopf zeigt: verworfen, nicht gekürzt
  expect(parseFork('["Kurz", "Das hier ist deutlich länger als vierzig Zeichen, mit verstecktem Rest"]')).toEqual(['Kurz'])
  expect(parseFork('[]')).toEqual([])
  expect(parseFork('kein json')).toEqual([])
  expect(parseFork('[kaputt')).toEqual([])
  expect(parseFork('{"a":1}')).toEqual([])
})

test('Bereinigen: Escape-Sequenzen und unsichtbare Zeichen raus, Tag-Zeichen verwerfen den Text, Länge begrenzt', () => {
  expect(clean('\x1b[31mrot\x1b[0m  und​\nweiter')).toBe('rot und weiter')
  expect(clean('ok\u{E0041}')).toBe('')
  expect(clean('a'.repeat(400)).length).toBe(300)
  // Deutsche und englische Ausgaben werden gleich bereinigt
  expect(clean('  Führe die Tests\u200b aus  ')).toBe('Führe die Tests aus')
  expect(clean('Run\x1b[0m the tests')).toBe('Run the tests')
  expect(parseFork('["Lauf die Tests","Run the tests"]')).toEqual(['Lauf die Tests', 'Run the tests'])
})

test('Fork-Frage: nur ein JSON-Array, nicht weitermachen, Ausgabesprache nach Einstellung', () => {
  for (const lang of ['en', 'de'] as const) {
    const p = forkPrompt(lang)
    expect(p).toContain('JSON array')
    expect(p).toContain('Do not continue')
  }
  expect(forkPrompt('en')).toContain('written in English')
  expect(forkPrompt('de')).toContain('written in German')
})

test('Sprache: Standard en, de nur bei "de"; beide Tabellen mit denselben Schlüsseln und ohne leere Texte', () => {
  expect(langOf(undefined)).toBe('en')
  expect(langOf('fr')).toBe('en')
  expect(langOf('de')).toBe('de')
  const shape = (o: unknown, path = ''): string[] =>
    o && typeof o === 'object'
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => shape(v, `${path}.${k}`))
      : [`${path}:${typeof o}`]
  expect(shape(T.de)).toEqual(shape(T.en))
  const texts = (o: unknown): string[] =>
    typeof o === 'string'
      ? [o]
      : typeof o === 'function'
        ? [String((o as (x: never) => unknown)('x' as never)), String((o as (x: never) => unknown)(2 as never))]
        : o && typeof o === 'object'
          ? Object.values(o as Record<string, unknown>).flatMap(texts)
          : []
  for (const lang of ['en', 'de'] as const) for (const t of texts(T[lang])) expect(t.trim().length > 0).toBe(true)
  // Zahl und Einzahl
  expect(T.en.fork.found(1)).toBe('1 suggestion')
  expect(T.de.fork.found(3)).toBe('3 Vorschläge')
  expect(forkStateText(T.en, { kind: 'unanswered', reason: 'aborted' })).toBe('no answer (aborted)')
  expect(forkStateText(T.de, { kind: 'idle' })).toBe('–')
})

test('Anzeige: kürzen auf 40 Zeichen; 2 × 2 nur ab zwei Vorschlägen und wenn es passt', () => {
  const long = 'Bitte prüfe alle Tests noch einmal sehr gründlich durch'
  expect(label(long).length).toBe(40)
  expect(label(long).endsWith('…')).toBe(true)
  expect(chooseLayout(['Ja, mach das', 'Teste es'], 91)).toBe('grid')
  expect(chooseLayout(['Ja, mach das', long], 60)).toBe('list')
  expect(chooseLayout(['Nur einer'], 120)).toBe('list')
  expect(chooseLayout(['a', 'b'], 10, 'grid')).toBe('grid')
})
