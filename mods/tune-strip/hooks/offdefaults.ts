// offdefaults.ts: Schalter mit Standard „aus“ einmal ausdrücklich als false speichern (docs/SETTINGS-SPEC.md §3, Befund 2026-11-08).
// Vorlage für alle fynn-mods mit solchen Schaltern: templates/settings/, wörtlich als hooks/offdefaults.ts kopiert.
//
// Grund: Die Einstellungsseite der Desktop-App zeigt ein boolean-Feld, das nie gespeichert wurde, angehakt an, auch wenn sein
// `default` false ist, und „Speichern“ schreibt es dann als true (bei Fynn: sidekick „Good to know“). Ist der Wert ausdrücklich
// gespeichert, zeigt die Seite ihn richtig. Die Mod ändert dabei nichts am Verhalten: false galt vorher schon (Standard).
//
// Ablauf, einmal je neuem Aus-Feld (Store `offDefaults2` = die schon erledigten Felder):
//   1. Aus-Felder aus der Liste der Mod (`hooks/fields.ts`, gleich plugin.json, von check-mods geprüft): boolean mit default false.
//   2. Nur die installierte Kopie (`claude plugin list --json`, wie `writeSettings` Weg 2); eine `--plugin-dir`-Kopie schreibt nie.
//   3. `claude plugin configure <mod>@fynn-mods --json` nennt die nicht gesetzten Felder (`unconfigured`, rel/plugins-cli-reference.md:408).
//      `$.config.list` kann das nicht unterscheiden (ConfigRow hat nur den Wert, types@2.1.319:2038-2074), und `writeSettings` Weg 1
//      überspringt einen gleichen Wert; darum hier immer die CLI.
//   4. Nur nicht gesetzte Aus-Felder in einem Aufruf als false schreiben (`--values-stdin`). Gesetzte Werte bleiben unberührt.
// Fängt jeden Fehler selbst ab; ohne Erfolg keine Markierung, dann beim nächsten Start wieder.
import type { EngineInterface } from 'claude-code'
import { MARKETPLACE } from './language.ts'
import { isInstalledCopy } from './settings.ts'
import type { FieldDefs } from './settings.ts'

const CLI_TIMEOUT = 30000
// `offDefaults2`: die erste Fassung (`offDefaults`) vermerkte auch verlorene Schreibvorgänge; der neue Schlüssel prüft einmal neu
const STORE_KEY = 'offDefaults2'

/** Die Aus-Felder: boolean mit Standard false, sortiert. */
export function offFields(defs: FieldDefs): string[] {
  return Object.entries(defs)
    .filter(([, d]) => d.type === 'boolean' && d.default === false)
    .map(([k]) => k)
    .sort()
}

/** Was zu schreiben ist: Aus-Felder, die noch nicht erledigt und laut CLI nicht gesetzt sind. */
export function toStore(off: readonly string[], done: unknown, unconfigured: unknown): string[] {
  const doneList = Array.isArray(done) ? done : []
  const unset = Array.isArray(unconfigured) ? unconfigured : []
  return off.filter((k) => !doneList.includes(k) && unset.includes(k))
}

/**
 * Einmal je neuem Aus-Feld: nicht gesetzte Aus-Felder als false in userConfig speichern. Gibt die geschriebenen Felder zurück
 * (leer: nichts zu tun, schon erledigt oder nicht möglich). Im Hintergrund aufrufen, nach dem Umzug (nicht gleichzeitig mit ihm,
 * beide schreiben dieselbe settings.json).
 */
export async function storeOffDefaults($: EngineInterface, mod: string, defs: FieldDefs): Promise<string[]> {
  try {
    const off = offFields(defs)
    if (!off.length) return []
    const done = await $.store.get(STORE_KEY)
    const doneList = Array.isArray(done) ? done : []
    if (off.every((k) => doneList.includes(k))) return []
    const id = `${mod}@${MARKETPLACE}`
    const l = await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: CLI_TIMEOUT })
    if (l.exitCode !== 0) return []
    const rows = JSON.parse(l.stdout) as { id?: unknown; enabled?: unknown; installPath?: unknown; readFromFolder?: unknown }[]
    const row = Array.isArray(rows) ? rows.find((x) => x?.id === id) : undefined
    if (!row || row.enabled !== true || !isInstalledCopy(row, $.plugin.root)) return []
    const c = await $.process.run(['claude', 'plugin', 'configure', id, '--json'], { timeoutMs: CLI_TIMEOUT })
    if (c.exitCode !== 0) return []
    const info = JSON.parse(c.stdout) as { unconfigured?: unknown }
    // Ohne Liste wissen wir nicht, was gesetzt ist: nichts schreiben, nichts vermerken (Review S1)
    if (!Array.isArray(info?.unconfigured)) return []
    const fields = toStore(off, doneList, info.unconfigured)
    if (fields.length) {
      const stdin = JSON.stringify(Object.fromEntries(fields.map((f) => [f, 'false'])))
      const w = await $.process.run(['claude', 'plugin', 'configure', id, '--values-stdin', '--json'], { stdin, timeoutMs: CLI_TIMEOUT })
      if (w.exitCode !== 0) return []
      let saved: unknown
      try {
        saved = (JSON.parse(w.stdout) as { saved?: unknown }).saved
      } catch {
        // Exit 0 ohne JSON: gilt als gespeichert (wie writeSettings)
      }
      if (Array.isArray(saved) && !fields.every((f) => saved.includes(f))) return []
      // Nachlesen: Mehrere Mods starten gleichzeitig und schreiben mit eigenen `claude`-Prozessen dieselbe settings.json; der letzte
      // überschreibt die anderen, obwohl jeder „saved“ meldet (Befund 2026-11-08, tune-strip). Nur vermerken, was wirklich gespeichert
      // ist; sonst beim nächsten Start wieder (dann sind weniger Mods unfertig, die Konkurrenz nimmt ab).
      const v = await $.process.run(['claude', 'plugin', 'configure', id, '--json'], { timeoutMs: CLI_TIMEOUT })
      if (v.exitCode !== 0) return []
      const after = (JSON.parse(v.stdout) as { unconfigured?: unknown }).unconfigured
      if (!Array.isArray(after) || fields.some((f) => after.includes(f))) return []
    }
    await $.store.set(STORE_KEY, off)
    return fields
  } catch {
    return []
  }
}
