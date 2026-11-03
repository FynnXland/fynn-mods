// cost-ledger: Geräte zusammenführen über einen synchronisierten Ordner (SPEC Nachtrag 0.7.0). Reine Logik ohne `$`.
// Jedes Gerät schreibt nur seine eigene Datei `cost-ledger-<id>.json` und liest die der anderen. Die Datei liegt in einem
// Cloud-Ordner und enthält deshalb nur Beträge, Tage, Fenster und Modelle, dazu was das Zusammenführen braucht (Session-ID,
// letzte Buchung): keine Pfade, keinen Git-Remote, keine Chat-Titel, keine Mod-Namen (Bedingung Fynn 2026-10-19, SPEC
// Nachtrag 0.7.0, Verhalten 1a). Ab 0.8.0 zusätzlich je Datensatz der letzte Ordnername der Projektwurzel (`proj`), damit
// „dieses Projekt“ über Geräte zählt (Fynn 2026-11-03, SPEC Nachtrag 0.8.0, Entscheidung 3).
// Die Dateiversion bleibt 1: Ein 0.7.0-Leser schickt jeden Datensatz durch `cleanRec`, das unbekannte Felder verwirft; er
// nimmt die Datei an und zeigt die Chats wie bisher unter dem Gerät.
import { DEVICE_PROJECT, LIMIT_KINDS, cleanRec, folderOf } from './logic.ts'
import type { ModDay, ModelDay, Rec } from './logic.ts'

export type Device = { id: string; name: string }
export type SyncFile = { v: 1; kind: 'cost-ledger-device'; device: Device; at: number; since: number | null; recs: Record<string, Rec> }

/** Höchstens so groß darf eine Datei sein, die gelesen oder geschrieben wird (`$.fs.read`/`write`, en/reference.md:313). */
export const FILE_LIMIT = 4 * 1024 * 1024
const NAME = /^cost-ledger-([0-9a-f]{8})\.json$/
/** Modell-Schlüssel, die in die Datei dürfen (`opus-5-5`, `unbekannt`); alles andere (ARN, Deployment-Name) wird `other`. */
const SAFE_MODEL = /^[a-z0-9][a-z0-9.-]{0,39}$/
export const OTHER_MODEL = 'other'
/** Alle Mod-Aufrufe eines Datensatzes unter einem Schlüssel, ohne die Namen der Mods. */
export const POOLED_MODS = 'mods'
/** Session-IDs (UUIDs); andere Schlüssel kommen nicht in die Datei und werden beim Lesen verworfen. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/
const HOUR = 60 * 60 * 1000

/** Zufällige Geräte-ID, 8 Hex-Zeichen. */
export function newDeviceId(random: () => number = Math.random): string {
  return Array.from({ length: 8 }, () => Math.floor(random() * 16).toString(16)).join('')
}

/** Gerätename: ohne Steuerzeichen, Leerraum zusammengezogen, höchstens 30 Zeichen; leer → Standard aus der ID. */
export function cleanDeviceName(name: string | undefined, id: string, fallback: (id: string) => string): string {
  const s = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
  return s || fallback(id)
}

/**
 * Sync-Ordner prüfen: absolut, kein Netzwerkort (`\\server`, `//server`, `\\?\…`; `$.fs` lehnt ihn ohnehin ab, types:3221),
 * kein `..`, nicht die Wurzel eines Laufwerks oder Dateisystems. `windows`: Die Session läuft unter Windows, dann nur
 * `X:\…` (ein `/…` hinge dort vom aktuellen Laufwerk ab, types:3216-3219). Gibt den Pfad ohne abschließenden Trenner
 * zurück, sonst `null`.
 */
export function validDir(input: string, windows = false): string | null {
  const p = String(input ?? '').trim().replace(/^"(.*)"$/, '$1')
  if (!p || /^[\\/]{2}/.test(p)) return null
  const drive = /^[A-Za-z]:[\\/]/.test(p)
  if (!drive && (windows || !p.startsWith('/'))) return null
  if (p.split(/[\\/]+/).some((s) => s === '..')) return null
  const out = p.replace(/[\\/]+$/, '')
  return !out || /^[A-Za-z]:$/.test(out) ? null : out
}

/** Dateiname der Gerätedatei. */
export function fileName(id: string): string {
  return `cost-ledger-${id}.json`
}

/** Geräte-ID aus einem Dateinamen; andere Dateien im Ordner (auch Konfliktkopien der Sync-Clients) → `null`. */
export function idFromName(name: string): string | null {
  return NAME.exec(name)?.[1] ?? null
}

/** Pfad im Ordner, mit dem Trenner, den der Ordner schon nutzt. */
export function inDir(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return /[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/** Länge in UTF-8-Bytes (die Grenze von `$.fs` gilt für Bytes, nicht für Zeichen). */
export function utf8Bytes(s: string): number {
  if (s.length * 3 <= FILE_LIMIT) return s.length // reicht sicher; spart die Schleife
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/** Modelle mit sicheren Schlüsseln; unbekannte Formen gehen in `other` (Tage werden addiert). */
function safeModels(src: Rec['models']): Rec['models'] {
  const out: Rec['models'] = {}
  for (const [k, m] of Object.entries(src)) {
    const days = (out[SAFE_MODEL.test(k) ? k : OTHER_MODEL] ??= { days: {} }).days
    for (const [d, x] of Object.entries(m.days)) {
      const h: ModelDay | undefined = days[d]
      days[d] = h ? { in: h.in + x.in, out: h.out + x.out, cr: h.cr + x.cr, cw: h.cw + x.cw, usd: h.usd + x.usd, n: h.n + x.n } : { ...x }
    }
  }
  return out
}

/** Mod-Aufrufe ohne Namen: alle Mods eines Datensatzes je Tag zusammen unter `mods`. */
function pooledMods(src: Rec['mods']): Rec['mods'] {
  const days: Record<string, ModDay> = {}
  for (const m of Object.values(src))
    for (const [d, x] of Object.entries(m.days)) {
      const h = days[d]
      const tok = h?.in !== undefined || x.in !== undefined
      days[d] = {
        usd: (h?.usd ?? 0) + x.usd,
        calls: (h?.calls ?? 0) + x.calls,
        ...(tok ? { in: (h?.in ?? 0) + (x.in ?? 0), out: (h?.out ?? 0) + (x.out ?? 0), cr: (h?.cr ?? 0) + (x.cr ?? 0), cw: (h?.cw ?? 0) + (x.cw ?? 0) } : {}),
      }
    }
  return Object.keys(days).length ? { [POOLED_MODS]: { days } } : {}
}

/** Ordnername, wie er in die Datei darf: kein Trenner, kein Laufwerk, 1–64 Zeichen. */
const SAFE_PROJ = /^[^\\/:]{1,64}$/

/**
 * Benutzernamen aus bekannten Pfaden (Benutzerordner unter Windows mit Laufwerk, `/home/<name>/…`, `/Users/<name>/…`).
 * Ohne neues Recht kennt der Mod den Benutzernamen nur so; ein Projekt auf einem anderen Laufwerk verrät ihn nicht.
 */
export function usersIn(paths: readonly string[]): string[] {
  const out = new Set<string>()
  for (const p of paths) {
    const m = /^(?:[A-Za-z]:)?[\\/]+(?:Users|home)[\\/]+([^\\/]+)/i.exec(String(p ?? ''))
    if (m?.[1]) out.add(m[1].toLowerCase())
  }
  return [...out]
}

/**
 * Letzter Ordnername für die Datei (SPEC Nachtrag 0.8.0, Schutz): aus der Wurzel, nie aus Titel oder Remote. Leer, wenn er
 * nicht zum Muster passt (Laufwerkswurzel `E:`), gleich einem Benutzernamen ist oder einen enthält (Ordner direkt im
 * Benutzerordner).
 */
export function safeProj(name: string, users: readonly string[]): string {
  const s = String(name ?? '').trim()
  if (!SAFE_PROJ.test(s) || /[\u0000-\u001f\u007f]/.test(s)) return ''
  const low = s.toLowerCase()
  return users.some((u) => u && low.includes(u)) ? '' : s
}

/**
 * Was von einem Datensatz in die geteilte Datei darf, als ausdrückliche Liste (ein neues Feld in `Rec` kommt so nie
 * ungefragt hinein): Beträge je Tag, Mod-Aufrufe ohne Namen, Modelle mit sicheren Schlüsseln, Limit-Fenster, Art des Chats,
 * erste Buchung auf die Stunde gerundet, letzte Buchung (fürs Zusammenführen), der letzte Ordnername (`proj`, ab 0.8.0).
 * Pfad, Projektname aus dem Repo, Titel, Remote und die Aktivität (`act`, `hours`) bleiben leer.
 */
export function shareRec(r: Rec, users: readonly string[] = []): Rec {
  const rl: Rec['rl'] = {}
  for (const [d, k] of Object.entries(r.rl)) {
    const kinds: Record<string, number> = {}
    for (const kind of LIMIT_KINDS) if (typeof k[kind] === 'number') kinds[kind] = k[kind]!
    if (Object.keys(kinds).length) rl[d] = kinds
  }
  const lim: Rec['lim'] = {}
  for (const kind of LIMIT_KINDS) if (r.lim[kind]) lim[kind] = { ...r.lim[kind] }
  const proj = r.kind === 'script' ? '' : safeProj(r.root ? folderOf(r.root) : (r.proj ?? ''), users)
  return {
    v: 1,
    project: '',
    root: '',
    title: '',
    kind: r.kind,
    firstAt: Math.floor(r.firstAt / HOUR) * HOUR,
    lastAt: r.lastAt,
    c: r.c,
    days: { ...r.days },
    mods: pooledMods(r.mods),
    models: safeModels(r.models),
    modModels: safeModels(r.modModels),
    act: {},
    hours: {},
    rl,
    lim,
    remote: '',
    ...(proj ? { proj } : {}),
  }
}

/** `meta:sync` prüfen: `{ v:1, dir, at }` mit gültigem Ordner, sonst `null` (= Sync aus). */
export function cleanSync(v: unknown): { dir: string; at: number } | null {
  const o = v as { v?: unknown; dir?: unknown; at?: unknown } | null
  if (!o || typeof o !== 'object' || o.v !== 1 || typeof o.dir !== 'string') return null
  const dir = validDir(o.dir)
  return dir ? { dir, at: typeof o.at === 'number' ? o.at : 0 } : null
}

/** `meta:device` prüfen: ID aus 8 Hex-Zeichen, Name bereinigt. */
export function cleanDevice(v: unknown, fallback: (id: string) => string): Device | null {
  const o = v as { id?: unknown; name?: unknown } | null
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !/^[0-9a-f]{8}$/.test(o.id)) return null
  return { id: o.id, name: cleanDeviceName(typeof o.name === 'string' ? o.name : '', o.id, fallback) }
}

/** Inhalt der eigenen Gerätedatei. */
export function buildFile(device: Device, since: number | null, recs: { id: string; rec: Rec }[], now: number, users: readonly string[] = []): string {
  const out: Record<string, Rec> = {}
  for (const { id, rec } of recs) if (SESSION_ID.test(id)) out[id] = shareRec(rec, users)
  const file: SyncFile = { v: 1, kind: 'cost-ledger-device', device, at: now, since, recs: out }
  return JSON.stringify(file)
}

/**
 * Fremde Gerätedatei prüfen. `null` bei halb geschriebener Datei (Parse-Fehler), unbekannter Version oder Form, oder wenn
 * die ID im Inhalt nicht zum Dateinamen passt. Einzelne kaputte Datensätze fallen heraus; was durchkommt, läuft noch einmal
 * durch `shareRec` (keine fremden Schlüssel mit Zeilenumbrüchen o. Ä. in der Anzeige).
 */
export function parseFile(text: string, id: string): SyncFile | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  const o = v as Partial<SyncFile> | null
  if (!o || typeof o !== 'object' || o.v !== 1 || o.kind !== 'cost-ledger-device' || !o.device || o.device.id !== id) return null
  if (typeof o.at !== 'number' || !o.recs || typeof o.recs !== 'object') return null
  const recs: Record<string, Rec> = {}
  for (const [sid, r] of Object.entries(o.recs)) {
    const c = SESSION_ID.test(sid) ? cleanRec(r) : null
    // `cleanRec` verwirft `proj`; hier eigens übernehmen, geprüft wie beim Schreiben (ohne Pfad: `root` ist leer)
    const proj = (r as { proj?: unknown } | null)?.proj
    if (c) recs[sid] = shareRec(typeof proj === 'string' ? { ...c, proj } : c)
  }
  const name = cleanDeviceName(typeof o.device.name === 'string' ? o.device.name : '', id, (x) => x)
  return { v: 1, kind: 'cost-ledger-device', device: { id, name }, at: o.at, since: typeof o.since === 'number' ? o.since : null, recs }
}

/**
 * Eigene und fremde Datensätze vereinigen, nach Session-ID ohne doppelte Zählung: Kommt eine ID mehrfach vor (zurückgespielte
 * Sicherung, kopierter Speicher), zählt nur der Datensatz mit dem jüngsten `lastAt`. Fremde Datensätze, deren letzte Buchung
 * vor `cutoff` liegt (älter als `keepDays`), zählen nicht; löschen tut sie nur ihr eigenes Gerät.
 *
 * Projekt (ab 0.8.0): Ein fremder Chat mit Ordnernamen (`proj`) kommt zum Projekt dieses Geräts mit gleichem Ordnernamen,
 * ohne Rücksicht auf Groß- und Kleinschreibung (`here`: Wurzel und Projekt des laufenden Chats). Gibt es keins, heißt das
 * Projekt wie der Ordner. Ohne `proj` (0.7.0 auf dem anderen Gerät) und bei Skript-Läufen bleibt er unter dem Gerät.
 * Mod-Aufrufe fremder Chats bleiben ohne Mod-Namen unter dem Gerät.
 */
export function mergeRecs(
  own: { id: string; rec: Rec }[],
  peers: SyncFile[],
  cutoff = 0,
  here?: { root: string; project: string },
): { id: string; rec: Rec; device?: string }[] {
  const all = new Map<string, { rec: Rec; device?: string }>()
  const byFolder = new Map<string, string>()
  const learn = (root: string, project: string) => {
    const f = folderOf(root).toLowerCase()
    if (f && !byFolder.has(f)) byFolder.set(f, project)
  }
  if (here) learn(here.root, here.project)
  for (const { id, rec } of own) {
    all.set(id, { rec })
    if (rec.kind !== 'script') learn(rec.root, rec.project)
  }
  for (const p of peers)
    for (const [id, r] of Object.entries(p.recs)) {
      if (r.lastAt < cutoff) continue
      const group = `${DEVICE_PROJECT}${p.device.name}`
      const mods = r.mods[POOLED_MODS] ? { [group]: r.mods[POOLED_MODS]! } : {}
      const key = r.proj && r.kind !== 'script' ? r.proj.toLowerCase() : ''
      if (key && !byFolder.has(key)) byFolder.set(key, r.proj!)
      const project = key ? byFolder.get(key)! : group
      const rec = { ...r, project, mods }
      const have = all.get(id)
      if (!have || rec.lastAt > have.rec.lastAt) all.set(id, { rec, ...(key ? { device: p.device.name } : {}) })
    }
  return [...all.entries()].map(([id, x]) => ({ id, rec: x.rec, ...(x.device ? { device: x.device } : {}) }))
}
