// settings.ts: Eigene Einstellungen einer fynn-mod lesen und schreiben, eine Wahrheitsquelle: userConfig (docs/SETTINGS-SPEC.md §4).
// Vorlage für alle sechs Mods: templates/settings/ (README dort), wörtlich als hooks/settings.ts kopiert.
//
// Lesen: nur aus `options` von `register(on, options)` (en/reference.md:33), geprüft gegen die Liste der Felder der Mod.
// Schreiben, wie der Sprachbefehl (hooks/language.ts):
//   Weg 1 (Terminal): `$.config.set({ key: '<mod>.<feld>' })`. Die Engine lädt die Mod sofort neu (types@2.1.319:10034).
//   Weg 2 (Desktop, -p, SDK, dort listet `$.config.list()` keine Plugin-Zeilen, LANGUAGE-SPEC §2):
//     `claude plugin configure <mod>@fynn-mods --values-stdin --json` (rel/plugins-cli-reference.md:398-418). Werte gehen als
//     Strings; die CLI wandelt „true“/„7“ selbst um und prüft min/max (Probe 2026-11-08, SETTINGS-SPEC §2). Gilt im laufenden
//     Chat, weil die Mod ihre Werte selbst nachzieht, in anderen nach `/reload-plugins` oder im nächsten Chat.
// Mehrere Felder auf einmal gehen über Weg 2 (ein Schreiben); Weg 1 lädt die Mod bei jedem `set` neu (Review 0.x S3).
// Nur eigene Felder: Schlüssel `<mod>.<feld>`, Besitzer `<mod>` bzw. `<mod>@…`. Nie andere Plugins.
import type { ConfigRow, EngineInterface } from 'claude-code'
import { MARKETPLACE } from './language.ts'

export type SettingValue = string | number | boolean
/** Ein Feld wie in plugin.json `userConfig` (Standard Pflicht; Zahl ohne Wert gibt es nicht, die CLI kann Zahlen nicht leeren). */
export type FieldDef =
  | { type: 'boolean'; default: boolean }
  | { type: 'number'; default: number; min?: number; max?: number }
  | { type: 'string'; default: string; options?: readonly string[] }
export type FieldDefs = Readonly<Record<string, FieldDef>>
export type Values = Record<string, SettingValue>
export type Lang = 'en' | 'de'

/** Ergebnis eines Schreibens: `config` = Weg 1 (Mod lädt neu), `cli` = Weg 2 (Mod zieht die Werte selbst nach). */
export type WriteResult = { ok: true; way: 'config' | 'cli' } | { ok: false; reason: string }

const CLI_TIMEOUT = 30000

const TEXT = {
  en: {
    now: 'Saved, applies now.',
    cli: 'Saved. Applies in this chat now, in other open chats after `/reload-plugins`.',
    failed: (why: string) => `Not saved: ${why}.`,
    invalid: (field: string) => `invalid value for ${field}`,
    locked: (field: string) => `${field} is locked by a managed setting`,
    noCli: (why: string) => `\`claude plugin\` could not be run (${why})`,
    notInstalled: (id: string) => `${id} is not installed and on`,
    otherCopy: (id: string) => `this copy is loaded from another folder; only the installed ${id} saves settings here`,
    lost: (fields: string) => `another process overwrote ${fields} at the same moment; run the command again`,
  },
  de: {
    now: 'Gespeichert, gilt sofort.',
    cli: 'Gespeichert. Gilt in diesem Chat sofort, in anderen offenen Chats nach `/reload-plugins`.',
    failed: (why: string) => `Nicht gespeichert: ${why}.`,
    invalid: (field: string) => `ungültiger Wert für ${field}`,
    locked: (field: string) => `${field} ist durch eine verwaltete Einstellung gesperrt`,
    noCli: (why: string) => `\`claude plugin\` ließ sich nicht aufrufen (${why})`,
    notInstalled: (id: string) => `${id} ist nicht installiert und an`,
    otherCopy: (id: string) => `diese Kopie ist aus einem anderen Ordner geladen; Einstellungen speichert hier nur das installierte ${id}`,
    lost: (fields: string) => `ein anderer Prozess hat ${fields} im selben Moment überschrieben; Befehl bitte noch einmal ausführen`,
  },
} as const

/** Ein Wert, wenn er zum Feld passt (Typ, Grenzen, Auswahl); sonst undefined. */
export function fitValue(def: FieldDef, v: unknown): SettingValue | undefined {
  if (def.type === 'boolean') return typeof v === 'boolean' ? v : undefined
  if (def.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
    if (def.min !== undefined && v < def.min) return undefined
    if (def.max !== undefined && v > def.max) return undefined
    return v
  }
  if (typeof v !== 'string') return undefined
  // Ein gespeicherter Wert außerhalb `options` gilt als nicht gesetzt (types@2.1.319:8067-8069)
  if (def.options && !def.options.includes(v)) return undefined
  return v
}

/** Alle Felder aus `options`, ungültige und fehlende mit Standard. */
export function readSettings(defs: FieldDefs, options: Readonly<Record<string, unknown>> | undefined): Values {
  const out: Values = {}
  for (const [field, def] of Object.entries(defs)) out[field] = fitValue(def, options?.[field]) ?? def.default
  return out
}

/** Nur die Felder aus `next`, die von `current` abweichen und gültig sind. */
export function changed(defs: FieldDefs, current: Values, next: Partial<Values>): Values {
  const out: Values = {}
  for (const [field, v] of Object.entries(next)) {
    const def = defs[field]
    if (!def || v === undefined) continue
    const fit = fitValue(def, v)
    if (fit !== undefined && fit !== current[field]) out[field] = fit
  }
  return out
}

/** Fehlertext kurz und einzeilig. */
function why(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err)
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > 200 ? `${line.slice(0, 199)}…` : line || '?'
}

const normPath = (p: unknown) => (typeof p === 'string' ? p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '')

/** Zwei Ordner gleich? Trenner, Groß-/Kleinschreibung (Windows) und ein Schlussstrich zählen nicht. */
export function samePath(a: unknown, b: unknown): boolean {
  return normPath(a) !== '' && normPath(a) === normPath(b)
}

/**
 * Lädt diese Kopie die installierte Mod? `readFromFolder` (Laden direkt aus dem Marketplace-Ordner) oder `installPath` (Cache),
 * rel/plugins-cli-reference.md:323-332, rel/plugins-loading.md:217. Liegt der Marketplace-Ordner hinter einer Verknüpfung (Junction),
 * meldet die CLI ihn anders als `$.plugin.root`: dann zählen die letzten vier Ordner (z. B. `<repo>/mods/<name>` samt Elternordner).
 */
export function isInstalledCopy(row: { installPath?: unknown; readFromFolder?: unknown }, root: unknown): boolean {
  if (samePath(root, row.installPath) || samePath(root, row.readFromFolder)) return true
  const tail = (p: unknown) => normPath(p).split('/').slice(-4).join('/')
  return normPath(row.readFromFolder).split('/').length >= 4 && tail(root) === tail(row.readFromFolder)
}

function ownRow(row: ConfigRow, mod: string): string | undefined {
  if (!row.key.startsWith(`${mod}.`)) return undefined
  const owner = String(row.provider?.plugin ?? '')
  return owner === mod || owner.startsWith(`${mod}@`) ? row.key.slice(mod.length + 1) : undefined
}

/** Grund aus einer gescheiterten `configure`-Ausgabe: `refused.message` (mit `--json`), sonst stderr. */
function refusal(stdout: string, stderr: string, exitCode: number): string {
  try {
    const j = JSON.parse(stdout) as { refused?: { message?: unknown } }
    if (typeof j?.refused?.message === 'string' && j.refused.message) return why(j.refused.message)
  } catch {
    // keine JSON-Ausgabe
  }
  return why(stderr.trim() || `exit ${exitCode}`)
}

/**
 * Schreibt eigene Felder (nur gültige; ein ungültiger Wert bricht ab, bevor etwas geschrieben ist).
 * Weg 1, wenn `$.config.list()` alle Felder als Zeilen dieser Mod listet; sonst Weg 2. Die Mod lädt in Weg 1 bei jedem `set`
 * neu, darum nach dem Aufruf nichts mehr tun, was die alte Instanz braucht. Fängt jeden Fehler selbst ab.
 */
export async function writeSettings($: EngineInterface, mod: string, defs: FieldDefs, values: Values, lang: Lang): Promise<WriteResult> {
  const t = TEXT[lang]
  const fields = Object.keys(values)
  for (const field of fields) {
    const def = defs[field]
    // `--values-stdin` nimmt nur einzeilige Strings (rel/plugins-cli-reference.md:407)
    if (!def || fitValue(def, values[field]) === undefined || /[\r\n]/.test(String(values[field]))) return { ok: false, reason: t.invalid(field) }
  }
  if (!fields.length) return { ok: true, way: 'config' }

  let rows: ConfigRow[] = []
  try {
    rows = await $.config.list()
  } catch {
    rows = [] // dann Weg 2
  }
  const mine = new Map<string, ConfigRow>()
  for (const row of rows) {
    const field = ownRow(row, mod)
    if (field && !mine.has(field)) mine.set(field, row)
  }
  const viaConfig = fields.every((f) => mine.has(f))
  if (viaConfig) for (const field of fields) if (mine.get(field)!.isLocked) return { ok: false, reason: t.locked(field) }
  // Mehrere Felder: lieber ein Schreiben über die CLI; geht das nicht, nacheinander über $.config.set
  if (!viaConfig || fields.length > 1) {
    const r = await viaCli($, mod, fields, values, t)
    if (!('unavailable' in r)) return r
    if (!viaConfig) return { ok: false, reason: r.unavailable }
  }
  for (const field of fields) {
    const row = mine.get(field)!
    if (row.value === values[field]) continue
    try {
      const r = await $.config.set({ key: row.key, value: values[field]! })
      if ('deny' in r && r.deny !== undefined) return { ok: false, reason: why(r.deny) }
    } catch (err) {
      return { ok: false, reason: why(err) }
    }
  }
  return { ok: true, way: 'config' }
}

/**
 * Weg 2: `claude plugin configure`, ein Schreiben für alle Felder. `{ unavailable }` mit Grund, wenn die CLI nicht läuft oder dies
 * nicht die installierte Kopie ist; sonst das Ergebnis.
 */
async function viaCli($: EngineInterface, mod: string, fields: string[], values: Values, t: (typeof TEXT)['en'] | (typeof TEXT)['de']): Promise<WriteResult | { unavailable: string }> {
  const id = `${mod}@${MARKETPLACE}`
  // Nur die installierte Kopie schreibt über die CLI: Eine per --plugin-dir geladene (`@inline`, z. B. im Smoke-Test) schriebe sonst
  // ihre Werte in die Einstellungen der installierten.
  try {
    const l = await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: CLI_TIMEOUT })
    if (l.exitCode !== 0) {
      return { unavailable: t.noCli(why(l.stderr.trim() || `exit ${l.exitCode}`)) }
    }
    const rows = JSON.parse(l.stdout) as { id?: unknown; enabled?: unknown; installPath?: unknown; readFromFolder?: unknown }[]
    const row = Array.isArray(rows) ? rows.find((x) => x?.id === id) : undefined
    if (!row || row.enabled !== true) {
      return { unavailable: t.notInstalled(id) }
    }
    if (!isInstalledCopy(row, $.plugin.root)) {
      return { unavailable: t.otherCopy(id) }
    }
  } catch (err) {
    return { unavailable: t.noCli(why(err)) }
  }

  const stdin = JSON.stringify(Object.fromEntries(fields.map((f) => [f, String(values[f])])))
  try {
    // Zwei Versuche: Starten mehrere Mods gleichzeitig, schreiben sie mit eigenen `claude`-Prozessen dieselbe settings.json, und der
    // letzte überschreibt die anderen, obwohl jeder „saved“ meldet (Befund 2026-11-08, SETTINGS-SPEC §9). Darum nachlesen.
    for (let attempt = 1; ; attempt++) {
      const r = await $.process.run(['claude', 'plugin', 'configure', id, '--values-stdin', '--json'], {
        stdin,
        timeoutMs: CLI_TIMEOUT,
      })
      if (r.exitCode !== 0) return { ok: false, reason: refusal(r.stdout, r.stderr, r.exitCode) }
      try {
        const j = JSON.parse(r.stdout) as { saved?: unknown }
        if (Array.isArray(j?.saved)) {
          const missing = fields.filter((f) => !(j.saved as unknown[]).includes(f))
          if (missing.length) return { ok: false, reason: t.invalid(missing.join(', ')) }
        }
      } catch {
        // Exit 0 ohne JSON: gilt als gespeichert
      }
      const gone = await lostFields($, id, fields, values)
      if (!gone.length) return { ok: true, way: 'cli' }
      if (attempt >= 2) return { ok: false, reason: t.lost(gone.join(', ')) }
    }
  } catch (err) {
    return { unavailable: t.noCli(why(err)) }
  }
}

/**
 * Nach Weg 2 nachlesen (`claude plugin configure <id> --json`, rel/plugins-cli-reference.md:408): die Felder, deren gespeicherter Wert
 * nicht der geschriebene ist oder die wieder als nicht gesetzt gelten (ein geleertes Textfeld `""` gilt als nicht gesetzt und zählt
 * nicht). Lässt sich nicht nachlesen, gilt es als gespeichert wie bisher.
 */
async function lostFields($: EngineInterface, id: string, fields: string[], values: Values): Promise<string[]> {
  try {
    const v = await $.process.run(['claude', 'plugin', 'configure', id, '--json'], { timeoutMs: CLI_TIMEOUT })
    if (v.exitCode !== 0) return []
    const j = JSON.parse(v.stdout) as { inputs?: Record<string, unknown>; unconfigured?: unknown }
    if (!j?.inputs || typeof j.inputs !== 'object') return []
    const unset = Array.isArray(j.unconfigured) ? j.unconfigured : []
    return fields.filter((f) => String(j.inputs![f] ?? '') !== String(values[f]) || (String(values[f]) !== '' && unset.includes(f)))
  } catch {
    return []
  }
}

/** Die Zeile nach einer Änderung: gilt sofort, gilt hier sofort und anderswo später, oder nicht gespeichert. */
export function writeNote(r: WriteResult, lang: Lang): string {
  const t = TEXT[lang]
  return r.ok ? (r.way === 'cli' ? t.cli : t.now) : t.failed(r.reason)
}

/**
 * Einmaliger Umzug alter Store-Werte nach userConfig (SETTINGS-SPEC §4). `legacy` sind die Werte, die bisher galten
 * (ein Feld fehlt = nichts umzuziehen). Gibt die Werte zurück, die diese Instanz übernehmen soll: nach Weg 2 und wenn das
 * Schreiben scheiterte (damit sich nichts ändert); nach Weg 1 keine (die Mod ist schon neu geladen); `clear` löscht die alten Store-Schlüssel und läuft nur, wenn nichts mehr umzuziehen ist
 * oder das Schreiben gelang. Fängt jeden Fehler selbst ab.
 */
export async function migrateSettings(
  $: EngineInterface,
  mod: string,
  defs: FieldDefs,
  current: Values,
  legacy: Partial<Values>,
  clear: () => Promise<unknown>,
  lang: Lang,
): Promise<{ apply: Values; result: WriteResult | undefined }> {
  const diff = changed(defs, current, legacy)
  if (!Object.keys(diff).length) {
    try {
      await clear()
    } catch {
      // beim nächsten Start wieder
    }
    return { apply: {}, result: undefined }
  }
  const result = await writeSettings($, mod, defs, diff, lang)
  if (result.ok) {
    try {
      await clear()
    } catch {
      // beim nächsten Start wieder; dann gleicht `options` schon und es wird nur gelöscht
    }
  }
  // Nach Weg 1 läuft schon die neu geladene Instanz mit den Werten; die alte tut nichts mehr (Review S2)
  return { apply: result.ok && result.way === 'config' ? {} : diff, result }
}
