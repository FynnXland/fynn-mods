// Test-Hilfe (wie sidekick tests/cli.ts): Einstellungen schreibt prompt-deck ohne Plugin-Zeilen über `claude plugin configure` (Weg 2,
// hooks/settings.ts). `cliStubs` meldet keine Plugin-Zeilen (`config.list` leer) und nimmt nur `claude plugin list --json` und genau
// diesen `configure`-Aufruf an; die geschriebenen Werte stehen in `writes`.
import type { On } from 'claude-code'

export type Cli = { writes: Record<string, string>[]; fail: string }

export const CONFIGURE = 'claude plugin configure prompt-deck@fynn-mods --values-stdin --json'

const res = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// Ordner der Mod, wie `$.plugin.root` ihn im Test meldet: Weg 2 schreibt nur für die installierte Kopie (hooks/settings.ts)
const MOD_ROOT = String((import.meta as { dir?: string }).dir ?? '').replace(/[\\/]tests$/, '')

/** Antwort auf `process.run`, wenn es ein Aufruf von `claude plugin` ist; sonst undefined. */
export function cliAnswer(e: { argv: readonly string[]; init?: { stdin?: string } }, cli: Cli) {
  if (e.argv[0] !== 'claude') return undefined
  if (e.argv.join(' ') === 'claude plugin list --json') return res(0, JSON.stringify([{ id: 'prompt-deck@fynn-mods', enabled: true, installPath: MOD_ROOT }]))
  if (e.argv.join(' ') === 'claude plugin configure prompt-deck@fynn-mods --json') return res(0, JSON.stringify({ inputs: Object.assign({}, ...cli.writes) }))
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
