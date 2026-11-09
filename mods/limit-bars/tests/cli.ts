// Test-Hilfe (0.16.0): Einstellungen schreibt limit-bars ohne Plugin-Zeilen über `claude plugin configure` (Weg 2,
// hooks/settings.ts). Dieser Stub nimmt nur genau diesen Aufruf an und merkt sich die geschriebenen Werte.
export type Cli = { writes: Record<string, string>[]; fail: string }

export const CONFIGURE = 'claude plugin configure limit-bars@fynn-mods --values-stdin --json'

const res = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** Antwort auf `process.run`, wenn es der Aufruf von `claude plugin configure` ist; sonst undefined (der eigene Stub antwortet). */
// Ordner der Mod, wie `$.plugin.root` ihn im Test meldet: Weg 2 schreibt nur für die installierte Kopie (hooks/settings.ts)
const MOD_ROOT = String((import.meta as { dir?: string }).dir ?? '').replace(/[\\/]tests$/, '')

export function cliAnswer(e: { argv: readonly string[]; init?: { stdin?: string } }, cli: Cli) {
  if (e.argv[0] !== 'claude') return undefined
  if (e.argv.join(' ') === 'claude plugin list --json') return res(0, JSON.stringify([{ id: 'limit-bars@fynn-mods', enabled: true, installPath: MOD_ROOT }]))
  if (e.argv.join(' ') !== CONFIGURE) return res(9, '', 'unerwartet')
  if (cli.fail) return res(1, JSON.stringify({ refused: { message: cli.fail } }))
  const values = JSON.parse(e.init?.stdin ?? '{}') as Record<string, string>
  cli.writes.push(values)
  return res(0, JSON.stringify({ saved: Object.keys(values) }))
}
