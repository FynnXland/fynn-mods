import { expect, test } from 'claude-code/testing'
import { forkStateText, langOf, T } from '../hooks/i18n.ts'
import { clean, forkPrompt, heldDigit, keyOf, merge, parseFork } from '../hooks/logic.ts'
import { chooseLayout, label } from '../hooks/view.ts'
import { addCall, callCost, NO_COST, priceFor } from '../hooks/cost.ts'

test('Zusammenführen: Claude Code vorn, dann Fork, höchstens 4, ohne Doppelte; ohne Quellen leer', () => {
  const r = merge('Teste es!', ['teste es', 'Zeig den Log', 'Mach weiter', 'Vierter'])
  expect(r.map((x) => x.text)).toEqual(['Teste es!', 'Zeig den Log', 'Mach weiter', 'Vierter'])
  expect(r.map((x) => x.source)).toEqual(['engine', 'fork', 'fork', 'fork'])
  expect(merge('Nur einer', [])).toEqual([{ text: 'Nur einer', source: 'engine' }])
  expect(merge('', ['A', 'B', 'C']).length).toBe(3)
  expect(merge('', [])).toEqual([])
  expect(merge('X', ['A', 'B', 'C']).length).toBe(4)
  expect(new Set(merge('X', ['A', 'B', 'C']).map((x) => keyOf(x.text))).size).toBe(4)
  // Fork allein: vier Plätze. Kommt Claude Code dazu, steht er vorn, die anderen rücken nach, der vierte fällt weg
  expect(merge('', ['A', 'B', 'C', 'D']).map((x) => x.text)).toEqual(['A', 'B', 'C', 'D'])
  expect(merge('X', ['A', 'B', 'C', 'D']).map((x) => x.text)).toEqual(['X', 'A', 'B', 'C'])
  // Ist er einer der vier, bleibt der vierte
  expect(merge('c', ['A', 'B', 'C', 'D']).map((x) => x.text)).toEqual(['c', 'A', 'B', 'D'])
})

test('Fork-Antwort: JSON-Array aus Strings oder Objekten mit prompt, Müll, Text drumherum', () => {
  expect(parseFork('["Teste es","Zeig den Diff","Weiter","Push","zu viel"]')).toEqual(['Teste es', 'Zeig den Diff', 'Weiter', 'Push'])
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
  expect(forkPrompt('en')).toContain('up to 4 ')
})

test('Fork-Frage: „/“ am Anfang nur für gewollte Befehle, sonst der Befehl in Anführungszeichen der Sprache', () => {
  for (const lang of ['en', 'de'] as const) expect(forkPrompt(lang)).toContain('executed as a slash command')
  expect(forkPrompt('en')).toContain('wrap the command in “”')
  expect(forkPrompt('de')).toContain('wrap the command in „“')
  // Typografische Anführungszeichen brauchen im JSON kein Escaping und bleiben erhalten
  expect(parseFork('["„/replies“ zählt falsch","/mod-test quick-replies"]')).toEqual(['„/replies“ zählt falsch', '/mod-test quick-replies'])
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

test('Kosten: Preis nach Modell-ID, Alias und unbekannt; Summe über Aufrufe', () => {
  expect(priceFor('claude-opus-5-5-20260101')).toEqual({ id: 'opus-5-5', input: 4, output: 20, read: 0.2 })
  expect(priceFor('opus-5')).toEqual({ id: 'opus-5', input: 5, output: 25, read: 0.5 })
  expect(priceFor('claude-sonnet-5-5[1m]').input).toBe(2)
  expect(priceFor('haiku').input).toBe(0.1)
  expect(priceFor('irgendwas').input).toBe(4)
  const u = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 38000, cache_creation_input_tokens: 2000 }
  // 1000 × 4 + 38000 × 0,2 + 2000 × 4 × 1,25 + 50 × 20 = 22600 → 0,0226 $
  expect(Math.round(callCost(u, 'claude-opus-5-5') * 1e6)).toBe(22600)
  const two = addCall(addCall(NO_COST, u, 'claude-opus-5-5'), u, 'claude-opus-5-5')
  expect(two.calls).toBe(2)
  expect(two.tokens).toBe(82100)
  expect(two.cached).toBe(76000)
})

test('0.4.3: Preise Haiku 5.5 und Sonnet 5.5; ein Fork über 100k Prompt-Tokens bleibt auf der günstigen Stufe', () => {
  expect(priceFor('claude-haiku-5-5')).toMatchObject({ id: 'haiku-5-5', input: 0.1, output: 0.5, read: 0.01 })
  // Alias haiku ist seit Claude Code 2.1.293 Haiku 5.5 (wie cost-ledger a57f8d4); die API-ID des Forks trifft die TABLE direkt
  expect(priceFor('haiku')).toMatchObject({ id: 'haiku-5-5', input: 0.1 })
  expect(priceFor('claude-haiku-5-5-20260601')).toMatchObject({ id: 'haiku-5-5', input: 0.1 })
  expect(priceFor('claude-haiku-4-5-20251001')).toMatchObject({ id: 'haiku-4-5', input: 1, output: 5, read: 0.1 })
  expect(priceFor('claude-sonnet-5-5').read).toBe(0.1)
  expect(priceFor('claude-sonnet-5').read).toBe(0.2)
  // 120 000 Prompt-Tokens mit Cache-Anteil: 10000 × 0,1 + 100000 × 0,01 + 10000 × 0,1 × 1,25 + 1000 × 0,5 = 3750
  const big = { input_tokens: 10_000, output_tokens: 1000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 10_000 }
  // Fork-Usage ist eine Summe über mehrere Antworten: immer die günstige Stufe, auch in der Kostenzeile
  expect(Math.round(callCost(big, 'claude-haiku-5-5') * 1e6)).toBe(3750)
  expect(Math.round(addCall(NO_COST, big, 'claude-haiku-5-5').usd * 1e6)).toBe(3750)
  // Die Stufe der Kopie (nur für echte Einzelaufrufe): über 100k fünffach, auch die Ausgabe; genau 100 000 noch günstig
  expect(Math.round(callCost(big, 'claude-haiku-5-5', true) * 1e6)).toBe(18750)
  const edge = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 }
  expect(Math.round(callCost(edge, 'claude-haiku-5-5', true) * 1e6)).toBe(1000)
  expect(Math.round(callCost({ ...edge, input_tokens: 10 }, 'claude-haiku-5-5', true) * 1e6)).toBe(5005)
  // andere Modelle ohne Stufe
  expect(callCost(big, 'claude-sonnet-5-5', true)).toBe(callCost(big, 'claude-sonnet-5-5'))
})

test('gehaltene Ziffer: eine oder mehrfach dieselbe von 1–4, sonst 0', () => {
  expect(heldDigit('1')).toBe(1)
  expect(heldDigit('4444')).toBe(4)
  expect(['', '0', '5', '12', '11 ', '1a', '١'].map(heldDigit)).toEqual([0, 0, 0, 0, 0, 0, 0])
})
