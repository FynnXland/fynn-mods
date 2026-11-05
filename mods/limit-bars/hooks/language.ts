// language.ts: `/<befehl> language [de|en]` stellt die Sprache aller installierten fynn-mods um (docs/LANGUAGE-SPEC.md).
// Vorlage für alle sechs Mods: templates/language/ (README dort), wörtlich als hooks/language.ts kopiert.
//
// Weg 1 (Terminal): `$.config.list()` liefert die userConfig-Felder jedes aktivierten Plugins als `<name>.<feld>` (types
// ConfigRow), `$.config.set` ändert eines wie im /config-Menü. Die Engine lädt die Mod dabei sofort neu, `register` läuft
// mit den neuen options (types@2.1.318:10004).
// Weg 2 (Desktop, -p, SDK): Dort listet `$.config.list()` keine Plugin-Zeilen (LANGUAGE-SPEC §2). Dann über die offizielle
// CLI: `claude plugin list --json`, `claude plugin configure <id> --json` und `… --values-stdin` (rel/plugins-cli-reference.md:
// 388-414). Die Befehle stehen hier fest; nur `<name>@fynn-mods` der sechs Mods und `{"language":"de|en"}` werden eingesetzt.
// Gilt ab dem nächsten Chat, im laufenden nach `/reload-plugins` (LANGUAGE-SPEC §10).
import type { ConfigRow, EngineInterface } from 'claude-code'

/** Die Mods, deren Feld `language` der Befehl umstellt; nie andere Plugins, nie andere Felder. */
export const FYNN_MODS: readonly string[] = ['clawd-buddy', 'cost-ledger', 'limit-bars', 'quick-replies', 'sidekick', 'tune-strip']
export const LANGUAGE_WORD = 'language'
export const LANGUAGES: readonly string[] = ['en', 'de']
/** Marketplace der Mods (Weg 2 setzt nur `<name>@fynn-mods` um). */
export const MARKETPLACE = 'fynn-mods'
export type Lang = 'en' | 'de'

/** Wer fragt: Name der Mod (wird zuletzt umgestellt), ihr Hauptbefehl ohne `/` und ihre aktuelle Sprache. */
export type LanguageCaller = { mod: string; cmd: string; lang: Lang }

const TEXT = {
  en: {
    name: 'English',
    titleSet: (name: string) => `**fynn-mods · Language: ${name}**`,
    titleShow: '**fynn-mods · Language**',
    done: '✓',
    already: '✓ (already)',
    locked: 'locked (managed setting)',
    notOffered: 'refused: value not offered',
    denied: (why: string) => `refused: ${why}`,
    failed: (why: string) => `error: ${why}`,
    unknownValue: '?',
    applied: 'Applies now, the mods were reloaded. Other open chats pick it up at their next start at the latest.',
    savedNext: 'Saved. Applies from the next chat; in this one right after `/reload-plugins`.',
    allAlready: 'Already set everywhere.',
    switchLine: (cmd: string) => `Switch: \`/${cmd} language de|en\``,
    notHere: (cmd: string, why: string) =>
      `Claude Code doesn't list plugin settings here, and \`claude plugin\` could not be run (${why}), so nothing changed. In a terminal session: \`/${cmd} language de\`.`,
    noneInstalled: (cmd: string) => `No fynn-mods found in \`claude plugin list\`, so nothing changed. In a terminal session: \`/${cmd} language de\`.`,
    listFailed: (why: string) => `Couldn't read the settings: ${why}. Nothing changed.`,
    unknown: (cmd: string, what: string) => `Unknown language “${what}”. Valid: \`/${cmd} language de\` or \`/${cmd} language en\`.`,
    helpDoes: 'Switch the language of all fynn-mods',
  },
  de: {
    name: 'Deutsch',
    titleSet: (name: string) => `**fynn-mods · Sprache: ${name}**`,
    titleShow: '**fynn-mods · Sprache**',
    done: '✓',
    already: '✓ (war schon)',
    locked: 'gesperrt (verwaltete Einstellung)',
    notOffered: 'abgelehnt: Wert wird nicht angeboten',
    denied: (why: string) => `abgelehnt: ${why}`,
    failed: (why: string) => `Fehler: ${why}`,
    unknownValue: '?',
    applied: 'Gilt sofort, die Mods wurden neu geladen. Andere offene Chats spätestens beim nächsten Start.',
    savedNext: 'Gespeichert. Gilt ab dem nächsten Chat, in diesem sofort nach `/reload-plugins`.',
    allAlready: 'Überall schon eingestellt.',
    switchLine: (cmd: string) => `Umstellen: \`/${cmd} language de|en\``,
    notHere: (cmd: string, why: string) =>
      `Hier zeigt Claude Code keine Plugin-Einstellungen, und \`claude plugin\` ließ sich nicht aufrufen (${why}), deshalb ist nichts geändert. In einer Terminal-Session: \`/${cmd} language de\`.`,
    noneInstalled: (cmd: string) => `In \`claude plugin list\` steht keine fynn-mod, deshalb ist nichts geändert. In einer Terminal-Session: \`/${cmd} language de\`.`,
    listFailed: (why: string) => `Einstellungen nicht lesbar: ${why}. Nichts geändert.`,
    unknown: (cmd: string, what: string) => `Unbekannte Sprache „${what}“. Gültig: \`/${cmd} language de\` oder \`/${cmd} language en\`.`,
    helpDoes: 'Sprache aller fynn-mods umstellen',
  },
} as const

/** Erstes Wort ist `language` (Groß- und Kleinschreibung egal); ob der Rest passt, prüft `languageCommand`. */
export function isLanguage(args: string): boolean {
  return (args.trim().split(/\s+/)[0] ?? '').toLowerCase() === LANGUAGE_WORD
}

/** Die Zeile für BEFEHLE in `/<befehl> help` (LANGUAGE-SPEC §6 Punkt 4). */
export function languageHelp(cmd: string, lang: Lang): { cmd: string; does: string } {
  return { cmd: `/${cmd} ${LANGUAGE_WORD} de|en`, does: TEXT[lang].helpDoes }
}

const SUFFIX = `.${LANGUAGE_WORD}`

/** Mod-Name einer Zeile, wenn sie das Feld `language` einer fynn-mod ist und dieser Mod gehört; sonst undefined. */
function modOf(row: ConfigRow): string | undefined {
  if (!row.key.endsWith(SUFFIX)) return undefined
  const mod = row.key.slice(0, -SUFFIX.length)
  if (!FYNN_MODS.includes(mod)) return undefined
  const owner = String(row.provider?.plugin ?? '')
  return owner === mod || owner.startsWith(`${mod}@`) ? mod : undefined
}

/** Fehlertext kurz und einzeilig. */
function why(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err)
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > 200 ? `${line.slice(0, 199)}…` : line || '?'
}

const CLI_TIMEOUT = 30000

/** Grund aus einer gescheiterten `claude plugin configure`-Ausgabe: `refused.message` (mit `--json`), sonst stderr. */
function refusal(stdout: string, stderr: string, exitCode: number): string {
  try {
    const j = JSON.parse(stdout) as { refused?: { message?: unknown } }
    if (typeof j?.refused?.message === 'string' && j.refused.message) return why(j.refused.message)
  } catch {
    // keine JSON-Ausgabe
  }
  return why(stderr.trim() || `exit ${exitCode}`)
}

/** Hat `configure --values-stdin --json` das Feld gespeichert? `saved` nennt die Optionen (rel/plugins-cli-reference.md:399). */
function savedLanguage(stdout: string): boolean {
  try {
    const j = JSON.parse(stdout) as { saved?: unknown }
    return !Array.isArray(j?.saved) || j.saved.includes(LANGUAGE_WORD)
  } catch {
    return true // Exit 0 ohne JSON: gilt als gespeichert
  }
}

/** Installierte, aktivierte fynn-mods aus `claude plugin list --json`, in der Reihenfolge von FYNN_MODS. */
export function installedMods(listed: unknown): string[] {
  const rows = Array.isArray(listed) ? (listed as { id?: unknown; enabled?: unknown }[]) : []
  return FYNN_MODS.filter((m) => rows.some((r) => r?.id === `${m}@${MARKETPLACE}` && r?.enabled === true))
}

/** Aktuelle Sprache einer Mod über `claude plugin configure <id> --json`; undefined, wenn nicht lesbar. */
async function cliValue($: EngineInterface, mod: string): Promise<string | undefined> {
  try {
    const r = await $.process.run(['claude', 'plugin', 'configure', `${mod}@${MARKETPLACE}`, '--json'], { timeoutMs: CLI_TIMEOUT })
    if (r.exitCode !== 0) return undefined
    const j = JSON.parse(r.stdout) as { inputs?: Record<string, unknown>; schema?: Record<string, { default?: unknown }> }
    const v = j?.inputs?.[LANGUAGE_WORD] || j?.schema?.[LANGUAGE_WORD]?.default
    return typeof v === 'string' && v ? v : undefined
  } catch {
    return undefined
  }
}

/** Weg 2: über `claude plugin`, wenn die Engine keine Plugin-Zeilen listet (Desktop, -p, SDK; LANGUAGE-SPEC §10). */
async function viaCli($: EngineInterface, who: LanguageCaller, wanted: string | undefined): Promise<string> {
  const now = TEXT[who.lang]
  let mods: string[]
  try {
    const r = await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: CLI_TIMEOUT })
    if (r.exitCode !== 0) return now.notHere(who.cmd, why(r.stderr.trim() || `exit ${r.exitCode}`))
    mods = installedMods(JSON.parse(r.stdout))
  } catch (err) {
    return now.notHere(who.cmd, why(err))
  }
  if (!mods.length) return now.noneInstalled(who.cmd)
  // Lesen parallel, Schreiben nacheinander: alle schreiben dieselbe settings.json
  const values = await Promise.all(mods.map((m) => cliValue($, m)))
  const current = new Map(mods.map((m, i) => [m, values[i]]))

  if (wanted === undefined) {
    const lines = mods.map((m) => `- ${m}: ${current.get(m) ?? now.unknownValue}`)
    return [now.titleShow, '', ...lines, '', now.switchLine(who.cmd)].join('\n')
  }

  const target = wanted as Lang
  const t = TEXT[target]
  const result = new Map<string, string>()
  let changed = 0
  for (const mod of [...mods.filter((m) => m !== who.mod), ...mods.filter((m) => m === who.mod)]) {
    if (current.get(mod) === target) {
      result.set(mod, `${target} ${t.already}`)
      continue
    }
    try {
      const r = await $.process.run(['claude', 'plugin', 'configure', `${mod}@${MARKETPLACE}`, '--values-stdin', '--json'], {
        stdin: JSON.stringify({ [LANGUAGE_WORD]: target }),
        timeoutMs: CLI_TIMEOUT,
      })
      if (r.exitCode === 0 && savedLanguage(r.stdout)) {
        result.set(mod, `${target} ${t.done}`)
        changed++
      } else result.set(mod, t.denied(refusal(r.stdout, r.stderr, r.exitCode)))
    } catch (err) {
      result.set(mod, t.failed(why(err)))
    }
  }
  const lines = mods.map((m) => `- ${m}: ${result.get(m)}`)
  const done = [...result.values()].every((v) => v === `${target} ${t.already}`) ? t.allAlready : changed ? t.savedNext : ''
  return [t.titleSet(t.name), '', ...lines, ...(done ? ['', done] : [])].join('\n')
}

/**
 * Der ganze Befehl `/<befehl> language [de|en]`: `args` sind die Argumente des Hauptbefehls (erstes Wort `language`).
 * Fängt jeden Fehler selbst ab und gibt immer Markdown-Text zurück. Wartet nur in Mods-API-Aufrufen.
 */
export async function languageCommand($: EngineInterface, who: LanguageCaller, args: string): Promise<string> {
  const now = TEXT[who.lang]
  const words = args.trim().split(/\s+/).slice(1)
  const wanted = words[0]?.toLowerCase()
  if (words.length > 1 || (wanted !== undefined && !LANGUAGES.includes(wanted))) return now.unknown(who.cmd, words.join(' '))

  let rows: ConfigRow[]
  try {
    rows = await $.config.list()
  } catch (err) {
    return now.listFailed(why(err))
  }
  const mine = new Map<string, ConfigRow>()
  for (const row of rows) {
    const mod = modOf(row)
    if (mod && !mine.has(mod)) mine.set(mod, row)
  }
  if (!mine.size) return viaCli($, who, wanted)
  const order = FYNN_MODS.filter((m) => mine.has(m))

  if (wanted === undefined) {
    const lines = order.map((m) => `- ${m}: ${String(mine.get(m)!.value)}`)
    return [now.titleShow, '', ...lines, '', now.switchLine(who.cmd)].join('\n')
  }

  const target = wanted as Lang
  const t = TEXT[target]
  const result = new Map<string, string>()
  let changed = 0
  // Die eigene Mod zuletzt: Ihr Neuladen macht diesen Aufruf zur alten Instanz (LANGUAGE-SPEC §4)
  const setOrder = [...order.filter((m) => m !== who.mod), ...order.filter((m) => m === who.mod)]
  for (const mod of setOrder) {
    const row = mine.get(mod)!
    if (String(row.value) === target) {
      result.set(mod, `${target} ${t.already}`)
      continue
    }
    if (row.isLocked) {
      result.set(mod, t.locked)
      continue
    }
    if (row.options && !row.options.includes(target)) {
      result.set(mod, t.notOffered)
      continue
    }
    try {
      const r = await $.config.set({ key: row.key, value: target })
      if ('deny' in r && r.deny !== undefined) result.set(mod, t.denied(why(r.deny)))
      else {
        result.set(mod, `${target} ${t.done}`)
        changed++
      }
    } catch (err) {
      result.set(mod, t.failed(why(err)))
    }
  }
  const lines = order.map((m) => `- ${m}: ${result.get(m)}`)
  const done = [...result.values()].every((v) => v === `${target} ${t.already}`) ? t.allAlready : changed ? t.applied : ''
  return [t.titleSet(t.name), '', ...lines, ...(done ? ['', done] : [])].join('\n')
}
