// Test-Hilfe (0.23.0, wie limit-bars tests/cli.ts): Einstellungen schreibt sidekick ohne Plugin-Zeilen über
// `claude plugin configure` (Weg 2, hooks/settings.ts). `cliStubs` meldet keine Plugin-Zeilen (`config.list` leer) und nimmt
// nur `claude plugin list --json` und genau diesen `configure`-Aufruf an; die geschriebenen Werte stehen in `writes`.
import type { On } from 'claude-code'
import { SETTINGS } from '../hooks/fields.ts'
import { cleanRuntime, settingsOf } from '../hooks/logic.ts'
import { readSettings } from '../hooks/settings.ts'

export type Cli = { writes: Record<string, string>[]; fail: string }

export const CONFIGURE = 'claude plugin configure sidekick@fynn-mods --values-stdin --json'

const res = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// Ordner der Mod, wie `$.plugin.root` ihn im Test meldet: Weg 2 schreibt nur für die installierte Kopie (hooks/settings.ts)
const MOD_ROOT = String((import.meta as { dir?: string }).dir ?? '').replace(/[\\/]tests$/, '')

/** Antwort auf `process.run`, wenn es ein Aufruf von `claude plugin` ist; sonst undefined. */
export function cliAnswer(e: { argv: readonly string[]; init?: { stdin?: string } }, cli: Cli) {
  if (e.argv[0] !== 'claude') return undefined
  if (e.argv.join(' ') === 'claude plugin list --json') return res(0, JSON.stringify([{ id: 'sidekick@fynn-mods', enabled: true, installPath: MOD_ROOT }]))
  if (e.argv.join(' ') !== CONFIGURE) return res(9, '', 'unerwartet')
  if (cli.fail) return res(1, JSON.stringify({ refused: { message: cli.fail } }))
  const values = JSON.parse(e.init?.stdin ?? '{}') as Record<string, string>
  cli.writes.push(values)
  return res(0, JSON.stringify({ saved: Object.keys(values) }))
}

/** Stubs für Weg 2; zurück kommt die Liste der Schreibvorgänge (alle Werte als Strings, wie die CLI sie bekommt). */
export function cliStubs(on: On): Cli {
  const cli: Cli = { writes: [], fail: '' }
  on('config.list', () => ({ value: [] }))
  on('process.run', ($, e) => cliAnswer(e as never, cli) ?? res(9, '', 'unerwartet'))
  return cli
}

/** Alle geschriebenen Werte zusammen (der letzte gewinnt). */
export const written = (cli: Cli): Record<string, string> => Object.assign({}, ...cli.writes)

/**
 * Die Einstellungen, wie sie nach den Schreibvorgängen gespeichert wären: Standard (plus `base`, z. B. die Test-Optionen), darüber
 * die geschriebenen Felder (die CLI wandelt „true“/„7“ selbst um), Laufzeitwerte aus dem Store `runtime`.
 */
export function settingsNow(cli: Cli, saved: Map<string, unknown>, base: Record<string, unknown> = {}) {
  const raw: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(written(cli))) {
    const def = SETTINGS[k]
    raw[k] = def?.type === 'boolean' ? v === 'true' : def?.type === 'number' ? Number(v) : v
  }
  return settingsOf(readSettings(SETTINGS, raw), cleanRuntime(saved.get('runtime')))
}
