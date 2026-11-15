// Die zwei offenen Tests aus dem userConfig-Umbau (Nachtrag 0.24.1, docs/SETTINGS-SPEC.md §9), nachgeholt in 0.26.0:
// 1. hooks/offdefaults.ts speichert sidekicks Aus-Schalter (`notes`, `modelTipAuto`) einmal als false, nur wenn sie nicht gesetzt sind.
// 2. hooks/settings.ts liest nach Weg 2 nach: überschrieben → zweiter Versuch, wieder überschrieben → „Nicht gespeichert“.
// Beide Funktionen bekommen ein nachgebautes `$` (nur process.run, store, plugin.root), damit die CLI-Folge genau prüfbar ist.
import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { SETTINGS } from '../hooks/fields.js'
import { offFields, storeOffDefaults } from '../hooks/offdefaults.js'
import { writeSettings } from '../hooks/settings.js'

const ROOT = 'C:\\mods\\sidekick'
const ID = 'sidekick@fynn-mods'
type Run = { argv: string[]; stdin?: string }

/** Ein `$` mit nachgebauter CLI: `configure --json` antwortet nacheinander aus `reads`, `--values-stdin` merkt sich die Werte. */
function fake(o: { reads: { inputs?: Record<string, unknown>; unconfigured?: string[] }[]; store?: Map<string, unknown> }) {
  const runs: Run[] = []
  const store = o.store ?? new Map<string, unknown>()
  const reads = [...o.reads]
  const res = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  const $ = {
    plugin: { root: ROOT },
    config: { list: async () => [] },
    store: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => void store.set(k, v) },
    process: {
      run: async (argv: string[], init?: { stdin?: string }) => {
        runs.push({ argv, ...(init?.stdin ? { stdin: init.stdin } : {}) })
        const cmd = argv.join(' ')
        if (cmd === 'claude plugin list --json') return res(JSON.stringify([{ id: ID, enabled: true, installPath: ROOT }]))
        if (cmd === `claude plugin configure ${ID} --values-stdin --json`) return res(JSON.stringify({ saved: Object.keys(JSON.parse(init?.stdin ?? '{}')) }))
        if (cmd === `claude plugin configure ${ID} --json`) return res(JSON.stringify(reads.shift() ?? { inputs: {}, unconfigured: [] }))
        return res('', 9)
      },
    },
  }
  const writes = () => runs.filter((r) => r.stdin).map((r) => JSON.parse(r.stdin!) as Record<string, string>)
  return { $: $ as unknown as EngineInterface, runs, store, writes }
}

test('0.24.1 Aus-Standards: sidekick hat genau notes und modelTipAuto als Aus-Schalter (queue steht auf an)', () => {
  expect(offFields(SETTINGS)).toEqual(['modelTipAuto', 'notes'])
})

test('0.24.1 Aus-Standards: nicht gesetzte Aus-Schalter einmal als false, gesetzte bleiben; danach nichts mehr', async () => {
  // notes ist gesetzt (fehlt in unconfigured), modelTipAuto nicht
  const f = fake({ reads: [{ unconfigured: ['modelTipAuto', 'level'] }, { unconfigured: ['level'] }] })
  expect(await storeOffDefaults(f.$, 'sidekick', SETTINGS)).toEqual(['modelTipAuto'])
  expect(f.writes()).toEqual([{ modelTipAuto: 'false' }])
  expect(f.store.get('offDefaults2')).toEqual(['modelTipAuto', 'notes'])
  // Zweiter Start: alles erledigt, keine CLI mehr
  const before = f.runs.length
  expect(await storeOffDefaults(f.$, 'sidekick', SETTINGS)).toEqual([])
  expect(f.runs.length).toBe(before)
})

test('0.24.1 Aus-Standards: überschreibt ein anderer Prozess das Schreiben, wird nichts vermerkt (beim nächsten Start wieder)', async () => {
  const f = fake({ reads: [{ unconfigured: ['modelTipAuto', 'notes'] }, { unconfigured: ['notes'] }] })
  expect(await storeOffDefaults(f.$, 'sidekick', SETTINGS)).toEqual([])
  expect(f.writes()).toEqual([{ modelTipAuto: 'false', notes: 'false' }])
  expect(f.store.has('offDefaults2')).toBe(false)
})

test('0.24.1 Nachlesen: überschrieben → zweiter Versuch gilt; zweimal überschrieben → Nicht gespeichert mit Feldnamen', async () => {
  // Erster Versuch: notes steht danach wieder auf false (ein anderer Prozess), zweiter Versuch stimmt
  let f = fake({ reads: [{ inputs: { notes: false }, unconfigured: [] }, { inputs: { notes: true }, unconfigured: [] }] })
  expect(await writeSettings(f.$, 'sidekick', SETTINGS, { notes: true }, 'de')).toEqual({ ok: true, way: 'cli' })
  expect(f.writes()).toEqual([{ notes: 'true' }, { notes: 'true' }])
  // Beide Versuche überschrieben (Feld wieder nicht gesetzt)
  f = fake({ reads: [{ inputs: {}, unconfigured: ['notes'] }, { inputs: {}, unconfigured: ['notes'] }] })
  const r = await writeSettings(f.$, 'sidekick', SETTINGS, { notes: true }, 'en')
  expect(r.ok).toBe(false)
  expect(r.ok ? '' : r.reason).toContain('another process overwrote notes')
  expect(f.writes()).toHaveLength(2)
  // Lässt sich nicht nachlesen (kein inputs), gilt es als gespeichert wie bisher
  f = fake({ reads: [{}] })
  expect(await writeSettings(f.$, 'sidekick', SETTINGS, { notes: true }, 'de')).toEqual({ ok: true, way: 'cli' })
  expect(f.writes()).toHaveLength(1)
})
