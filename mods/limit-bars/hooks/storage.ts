// limit-bars: Speicher-Ring, reine Funktionen ohne `$` (SPEC.md, Ausbau v0.4.0). Ausgabe der PowerShell-Skripte lesen,
// Endungen auf Gruppen verteilen, Größen formatieren und den Ring als Svg-Fragment zeichnen. Die Skripte selbst stehen
// hier, damit Tests prüfen können, dass der Pfad nie im Skripttext steht (nur über LB_PATH).
import { FONT, RING_H, RING_SEGMENTS, RING_SIZE, esc } from './ring.ts'
import { EMPTY, GREY, ORANGE } from './view.ts'
import { T, dec, int } from './i18n.ts'
import type { Lang } from './i18n.ts'

export const GROUPS = ['programs', 'media', 'models', 'code', 'archives', 'other'] as const
export type Group = (typeof GROUPS)[number]

// Kategorische Palette im Stil der übrigen limit-bars-Farben (Fynn 2026-10-06: „vom Style her angleichen“): weich, OKLCH-
// Helligkeit 0,58–0,66 und Sättigung 0,11–0,13 wie ORANGE/RED/GREEN (0,60–0,73 / 0,13–0,15), Farbtöne weg von Grün, Gelb,
// Rot und Orange. dataviz-Validator --mode dark in dieser Reihenfolge: alle Prüfungen bestanden, ohne Warnung.
// `other` ist neutral, damit es nicht wie eine eigene Art wirkt
export const GROUP_COLOR: Readonly<Record<Group, string>> = {
  programs: '#5497D9',
  media: '#C1628A',
  models: '#BF853A',
  code: '#12A7A7',
  archives: '#8668B6',
  other: '#808080',
}

const EXTS: Readonly<Record<Exclude<Group, 'other'>, string>> = {
  programs: 'dll exe lib so dylib pyd pyc jar aot dill a o obj pdb node wasm class dex msi sys ocx',
  media: 'wav mp3 flac ogg m4a aac opus mp4 mov mkv webm avi png jpg jpeg gif webp psd tif tiff bmp ico heic',
  models: 'pth pt gguf safetensors ckpt onnx bin npy npz h5 tflite parquet index',
  code: 'py js ts tsx jsx mjs cjs json md txt html css scss dart java kt c cc cpp h hpp rs go cs yaml yml toml xml sql map sh ps1 lock',
  archives: 'zip 7z rar tar gz tgz xz bz2 apk aab whl nupkg mrpack pack iso',
}

const GROUP_OF: ReadonlyMap<string, Group> = new Map(
  (Object.keys(EXTS) as Exclude<Group, 'other'>[]).flatMap((g) => EXTS[g].split(' ').map((x) => ['.' + x, g] as [string, Group])),
)

/** Gruppe einer Endung (mit Punkt, z. B. `.dll`); unbekannt oder ohne Endung: `other`. */
export function groupOf(ext: string): Group {
  return GROUP_OF.get(ext.toLowerCase()) ?? 'other'
}

// Absoluter Pfad, damit keine powershell.exe aus dem Arbeitsordner der Sitzung zum Zug kommt (Review 0.4.0, Hinweis 1)
export const PS_ABS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

// Feste Skripte für Windows PowerShell 5.1 (`powershell.exe`). Ohne doppelte Anführungszeichen, damit das Quoting der
// Argumente unter Windows nichts verändert. Der Pfad kommt nur aus $env:LB_PATH. Lesen nur Verzeichnisse und Größen.
export const PROBE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$d=New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($env:LB_PATH))',
  '$t=[char]9',
  "'total'+$t+$d.TotalSize",
  "'free'+$t+$d.TotalFreeSpace",
].join('; ')

// Exit 2: Pfad gibt es nicht; exit 3: der Startordner ist nicht lesbar (sonst sähe ein Tippfehler aus wie „0 Dateien“)
export const SCAN_SCRIPT = [
  'if(-not [IO.Directory]::Exists($env:LB_PATH)){ exit 2 }',
  '$h=@{}; $n=0; $s=0; $t=[char]9; $rp=[IO.FileAttributes]::ReparsePoint; $first=$true',
  '$st=New-Object System.Collections.Generic.Stack[string]; $st.Push($env:LB_PATH)',
  'while($st.Count -gt 0){ $d=$st.Pop(); try { $di=New-Object IO.DirectoryInfo $d; ' +
    'foreach($c in $di.EnumerateDirectories()){ if(-not ($c.Attributes -band $rp)){ $st.Push($c.FullName) } }; ' +
    'foreach($f in $di.EnumerateFiles()){ $n++; $s+=$f.Length; $e=$f.Extension.ToLowerInvariant(); $h[$e]=$h[$e]+$f.Length } } ' +
    'catch { if($first){ exit 3 } }; $first=$false }',
  "'files'+$t+$n",
  "'scanned'+$t+$s",
  "foreach($k in $h.Keys){ 'ext'+$t+$k+$t+$h[$k] }",
].join('; ')

/** Laufwerksbuchstabe eines Windows-Pfads (`E:\…` → `E:`); sonst undefined (dann gibt es keinen Ring). */
export function driveOf(path: string): string | undefined {
  const m = /^([A-Za-z]):/.exec(path.trim())
  return m ? `${m[1]!.toUpperCase()}:` : undefined
}

export type Drive = { total: number; free: number }
export type Scan = { at: number; files: number; scanned: number; groups: Record<Group, number> }

const num = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

/** `total<TAB>n` und `free<TAB>n` aus dem Probe-Skript; unvollständig oder unplausibel → undefined. */
export function parseProbe(stdout: string): Drive | undefined {
  const v: Record<string, number> = {}
  for (const line of stdout.split(/\r?\n/)) {
    const [k, n] = line.split('\t')
    if (k === 'total' || k === 'free') v[k] = num(n)
  }
  const total = v.total ?? NaN
  const free = v.free ?? NaN
  return total > 0 && free >= 0 && free <= total ? { total, free } : undefined
}

/** Ausgabe des Scan-Skripts → Bytes je Gruppe. Ohne `files`/`scanned` → undefined. `other` bekommt später den Rest. */
export function parseScan(stdout: string, at: number): Scan | undefined {
  let files = NaN
  let scanned = NaN
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>
  for (const line of stdout.split(/\r?\n/)) {
    const p = line.split('\t')
    if (p[0] === 'files') files = num(p[1])
    else if (p[0] === 'scanned') scanned = num(p[1])
    else if (p[0] === 'ext' && p.length === 3) {
      const b = num(p[2])
      if (b > 0) groups[groupOf(p[1]!)] += b
    }
  }
  return Number.isFinite(files) && Number.isFinite(scanned) ? { at, files, scanned, groups } : undefined
}

/** Gruppen für die Anzeige: `other` bekommt zusätzlich, was belegt, aber nicht gescannt ist (System, Papierkorb …). */
export function shownGroups(drive: Drive, scan: Scan): Record<Group, number> {
  const used = drive.total - drive.free
  return { ...scan.groups, other: scan.groups.other + Math.max(0, used - scan.scanned) }
}

const GIB = 1024 ** 3
const MIB = 1024 ** 2

/** Kurz wie im Explorer (binär): `512M`, `114G`, ab 1000G `1.2T` (de `1,2T`). */
export function sizeShort(bytes: number, lang: Lang): string {
  if (bytes < GIB) return `${Math.round(bytes / MIB)}M`
  const g = bytes / GIB
  if (Math.round(g) < 1000) return `${Math.round(g)}G`
  return `${dec(g / 1024, 1, lang)}T`
}

/** Lang für Legende und `alt`: `114 GB`, `1.2 TB`, `512 MB`. */
export function sizeLong(bytes: number, lang: Lang): string {
  const s = sizeShort(bytes, lang)
  return `${s.slice(0, -1)} ${s.slice(-1)}B`
}

/** Ein Bogen auf dem Ring als Anteil 0..1 ab 12 Uhr im Uhrzeigersinn. */
export type Arc = { from: number; to: number; color: string }

/** Was der Speicher-Ring zeigt. */
export type DiskView = { label: string; main: string; sub: string; arcs: Arc[]; alt: string }

/**
 * Bögen in fester Reihenfolge der Gruppen.
 * - Band (`withFree` aus): Der ganze Ring ist das Belegte (Variante B, Fynn 2026-10-06: anteilig am ganzen Laufwerk war
 *   der farbige Teil bei 14 % Belegung im Band kaum zu erkennen). Ohne Scan ein grauer Ring, ohne Belegung ein leerer.
 * - `/disk` (`withFree` an, Fynn 2026-10-06): Der Ring ist das ganze Laufwerk, der freie Teil grau (`EMPTY`).
 */
export function diskArcs(drive: Drive, scan: Scan | undefined, withFree = false): Arc[] {
  const used = drive.total - drive.free
  if (!(used > 0)) return [{ from: 0, to: 1, color: EMPTY }]
  const g = scan ? shownGroups(drive, scan) : undefined
  const parts = g ? GROUPS.map((k) => ({ bytes: Math.max(0, g[k]), color: GROUP_COLOR[k] })) : [{ bytes: used, color: GREY }]
  const sum = parts.reduce((n, p) => n + p.bytes, 0)
  if (!(sum > 0)) return [{ from: 0, to: 1, color: GREY }]
  // Mit freiem Teil: Bezug ist das Laufwerk (gescannt kann größer sein als belegt, dann an der Summe)
  const base = withFree ? Math.max(drive.total, sum + drive.free) : sum
  const arcs: Arc[] = []
  let at = 0
  for (const p of parts) {
    const w = p.bytes / base
    if (w <= 0) continue
    arcs.push({ from: at, to: Math.min(1, at + w), color: p.color })
    at += w
  }
  if (withFree && at < 1) arcs.push({ from: at, to: 1, color: EMPTY })
  return arcs
}

/** Kürzel über dem Ring, in beiden Sprachen (Fynn, 2026-10-06: „nicht E:, sondern Storage“). */
export const DISK_LABEL = 'Storage'
/** Breite des Felds: das Kürzel ist breiter als der Ring (7 Zeichen bei 12 px Monospace ≈ 51 px). */
export const DISK_W = 52

/** Ansicht für Band und `/disk`: Kürzel `Storage`, Mitte belegt, darunter `/gesamt` (Fynn, 2026-10-06). */
export function diskView(drive: string, d: Drive, scan: Scan | undefined, lang: Lang, withFree = false): DiskView {
  const used = d.total - d.free
  return {
    label: DISK_LABEL,
    main: sizeShort(used, lang),
    sub: `/${sizeShort(d.total, lang)}`,
    arcs: diskArcs(d, scan, withFree),
    alt: T[lang].diskAlt(drive, sizeLong(used, lang), sizeLong(d.total, lang)),
  }
}

const R = 18 // wie der Cache-Ring: Mittellinie, außen 20, innen 16
const STROKE = 4
const f2 = (n: number) => String(Math.round(n * 100) / 100)

// Segmente mit Fugen wie der Cache-Ring (Fynn 2026-10-06: „geriffelt wie Cache“). Im Band 28 Segmente mit 1 px Fuge, genau
// wie RING_SEGMENTS; in /disk (doppelt so groß gezeichnet) 56 mit 0,5 px Fuge, das ergibt nach dem Vergrößern dasselbe
// Verhältnis von Segment zu Fuge (3 : 1) wie im Band.
export const DISK_SEGMENTS = RING_SEGMENTS
export const BIG_SEGMENTS = 56

/**
 * Farbe je Segment: jeder Bogen bekommt Segmente nach seinem Anteil (größter Rest), jeder sichtbare Bogen mindestens eins,
 * damit auch kleine Gruppen im Ring erscheinen. Fehlt dafür Platz, gibt der größte Bogen ab.
 */
export function segmentColors(arcs: readonly Arc[], n: number): string[] {
  const parts = arcs.map((a) => ({ color: a.color, exact: Math.max(0, a.to - a.from) * n, count: 0 }))
  for (const p of parts) p.count = p.exact > 0 ? Math.max(1, Math.floor(p.exact)) : 0
  let total = parts.reduce((s, p) => s + p.count, 0)
  while (total > n) {
    const big = parts.reduce((a, b) => (b.count > a.count ? b : a))
    if (big.count <= 1) break
    big.count -= 1
    total -= 1
  }
  while (total < n) {
    const next = parts.reduce((a, b) => (b.exact - b.count > a.exact - a.count ? b : a))
    next.count += 1
    total += 1
  }
  return parts.flatMap((p) => Array<string>(p.count).fill(p.color)).slice(0, n)
}

/** Segment i von n als Bogen um (cx, cy), ab 12 Uhr im Uhrzeigersinn, mit `gap` px Fuge auf der Mittellinie. */
function segmentPath(i: number, n: number, gap: number, cx: number, cy: number): string {
  const step = (2 * Math.PI) / n
  const half = gap / 2 / R
  const p = (t: number) => `${f2(cx + R * Math.sin(t))} ${f2(cy - R * Math.cos(t))}`
  return `M${p(i * step + half)}A${R} ${R} 0 0 1 ${p((i + 1) * step - half)}`
}

/** Der Speicher-Ring samt Kürzel als Svg-Fragment, links oben bei (x, y); belegt DISK_W × RING_H, der Ring ist so groß wie der Cache-Ring. */
export function diskRingSvg(v: DiskView, x: number, y: number, n = DISK_SEGMENTS, gap = 1): string {
  const cx = x + DISK_W / 2
  const cy = y + (RING_H - RING_SIZE) + RING_SIZE / 2
  let out = `<text x="${cx}" y="${y + 11}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${ORANGE}">${esc(v.label)}</text>`
  segmentColors(v.arcs, n).forEach((color, i) => {
    out += `<path d="${segmentPath(i, n, gap, cx, cy)}" fill="none" stroke-width="${STROKE}" stroke="${color}"/>`
  })
  out += `<text x="${cx}" y="${cy + 1}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${GREY}">${esc(v.main)}</text>`
  out += `<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-family="${FONT}" font-size="8" fill="${GREY}">${esc(v.sub)}</text>`
  return out
}

// ---------- /disk ----------

/** Eine Zeile der Legende: Gruppe (oder frei), Bytes, Anteil am Belegten bzw. am Laufwerk (0..1). */
export type StorageRow = { key: Group | 'free'; name: string; color: string; bytes: number; share: number }

/** Alles, was `/disk` zeigt; aus einem Stand gebaut, damit Text und Zeichnung dieselben Zahlen haben. */
export type StorageReport = { drive: string; d: Drive; scan?: Scan; view: DiskView; rows: StorageRow[]; free: StorageRow; at: number }

export function storageReport(drive: string, d: Drive, scan: Scan | undefined, now: number, lang: Lang): StorageReport {
  const t = T[lang]
  const rows: StorageRow[] = []
  if (scan) {
    const g = shownGroups(d, scan)
    // Gescannt kann größer sein als belegt (Kompression, Hardlinks, Cloud-Platzhalter): Anteile dann an der Summe
    const base = Math.max(d.total - d.free, GROUPS.reduce((n, k) => n + g[k], 0))
    for (const k of GROUPS) {
      if (g[k] > 0) rows.push({ key: k, name: t.groups[k], color: GROUP_COLOR[k], bytes: g[k], share: base > 0 ? g[k] / base : 0 })
    }
    rows.sort((a, b) => b.bytes - a.bytes)
  }
  const free: StorageRow = { key: 'free', name: t.diskFree, color: EMPTY, bytes: d.free, share: d.free / d.total }
  return { drive, d, scan, view: diskView(drive, d, scan, lang, true), rows, free, at: now }
}

/** Prozent mit einer Nachkommastelle: en `58.7%`, de `58,7 %`. */
export function pct1(share: number, lang: Lang): string {
  return T[lang].pct(dec(share * 100, 1, lang))
}

const two = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] // nur en, de zeigt `06.10.`

/** Zeitpunkt des Scans: heute `10:42`, sonst en `Oct 6 10:42`, de `06.10. 10:42`. */
export function scanTime(at: number, now: number, lang: Lang): string {
  const a = new Date(at)
  const n = new Date(now)
  const hm = `${two(a.getHours())}:${two(a.getMinutes())}`
  if (a.toDateString() === n.toDateString()) return hm
  return lang === 'de' ? `${two(a.getDate())}.${two(a.getMonth() + 1)}. ${hm}` : `${MONTHS[a.getMonth()]} ${a.getDate()} ${hm}`
}

/** Markdown-Text von `/disk` (für `-p`, VS Code, das Modell); `tag` steht am Ende der ersten Zeile (wie `/ledger`). */
export function storageMarkdown(r: StorageReport, tag: string, lang: Lang, note = ''): string {
  const t = T[lang]
  const used = r.d.total - r.d.free
  const lines = [`${t.storageTitle(r.drive, sizeLong(used, lang), sizeLong(r.d.total, lang), pct1(used / r.d.total, lang))} ${tag}`, '']
  if (r.scan) {
    lines.push(t.storageHead, '|---|---:|---:|')
    for (const x of r.rows) lines.push(`| ${x.name} | ${sizeLong(x.bytes, lang)} | ${pct1(x.share, lang)} |`)
    lines.push('', `${t.diskFree}: ${sizeLong(r.d.free, lang)} · ${t.storageOfDrive(pct1(r.free.share, lang))}`)
    lines.push(t.storageScanned(scanTime(r.scan.at, r.at, lang), int(r.scan.files, lang)))
  } else {
    lines.push(`${t.diskFree}: ${sizeLong(r.d.free, lang)} · ${t.storageOfDrive(pct1(r.free.share, lang))}`, t.storageNoScan)
  }
  if (note) lines.push('', note)
  return lines.join('\n')
}

const BIG = 2 // Vergrößerung des Rings in der Befehlsansicht: 80 × 112 px
const ROW_H = 20
const TEXT = '#D0D0D0' // Namen in der Legende (Textfarbe, nicht die Reihenfarbe)

/** Desktop-Bild von `/disk`: großer Ring links, Legende rechts (Farbfeld, Name, Größe, Anteil). */
export function storageSvg(r: StorageReport, lang: Lang): { source: string; width: number; height: number; alt: string } {
  const t = T[lang]
  const ringW = DISK_W * BIG
  const x0 = ringW + 24
  const nameW = 190 // längster Name etwa 24 Zeichen bei 12 px Monospace (≈ 7,3 px je Zeichen)
  const xSize = x0 + 18 + nameW + 64
  const xPct = xSize + 72
  // Die Zeile „frei“ trägt rechts den längeren Text „85,7 % des Laufwerks“: das Bild muss ihn ganz fassen
  const freeText = t.storageOfDrive(pct1(r.free.share, lang))
  const width = Math.ceil(Math.max(xPct, xSize + 12 + freeText.length * 7.3) + 8)
  const legend = [...r.rows, r.free]
  const footer = r.scan ? t.storageScanned(scanTime(r.scan.at, r.at, lang), int(r.scan.files, lang)) : t.storageNoScan
  const legendH = (legend.length + 1) * ROW_H + 8
  const height = Math.max(RING_H * BIG, legendH)
  let body = `<g transform="scale(${BIG})">${diskRingSvg(r.view, 0, 0, BIG_SEGMENTS, 0.5)}</g>`
  const y0 = Math.max(0, (height - legendH) / 2)
  legend.forEach((x, i) => {
    const y = y0 + i * ROW_H
    const share = x.key === 'free' ? t.storageOfDrive(pct1(x.share, lang)) : pct1(x.share, lang)
    body +=
      `<rect x="${x0}" y="${y + 3}" width="10" height="10" rx="2" fill="${x.color}"/>` +
      `<text x="${x0 + 18}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${x.key === 'free' ? GREY : TEXT}">${esc(x.name)}</text>` +
      `<text x="${xSize}" y="${y + 12}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${TEXT}">${esc(sizeLong(x.bytes, lang))}</text>` +
      `<text x="${x.key === 'free' ? xSize + 12 : xPct}" y="${y + 12}"${x.key === 'free' ? '' : ' text-anchor="end"'} font-family="${FONT}" font-size="12" fill="${GREY}">${esc(share)}</text>`
  })
  body += `<text x="${x0}" y="${y0 + legend.length * ROW_H + 14}" font-family="${FONT}" font-size="10" fill="${GREY}">${esc(footer)}</text>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  const alt = [r.view.alt, ...r.rows.map((x) => `${x.name} ${sizeLong(x.bytes, lang)}`), `${t.diskFree} ${sizeLong(r.d.free, lang)}`].join('; ')
  return { source, width, height, alt }
}

/** Terminal-Ansicht von `/disk`: Balken aus Zellen je Gruppe (Breite `cols`) und Legendenzeilen. */
export function storageTerminal(r: StorageReport, cols: number, lang: Lang): { bar: { color: string; n: number }[]; lines: { color: string; text: string }[]; footer: string } {
  const t = T[lang]
  const w = Math.max(10, Math.min(60, cols - 2))
  const bar: { color: string; n: number }[] = []
  // Wie der große Ring: das ganze Laufwerk, Gruppen nach Größe, der freie Teil zuletzt
  let drawn = 0
  for (const a of diskArcs(r.d, r.scan, true)) {
    const n = Math.round(a.to * w) - drawn
    if (n > 0) bar.push({ color: a.color, n })
    drawn += Math.max(0, n)
  }
  const nameW = Math.max(...[...r.rows, r.free].map((x) => x.name.length))
  const lines = [...r.rows, r.free].map((x) => ({
    color: x.color,
    text: `${x.name.padEnd(nameW)}  ${sizeLong(x.bytes, lang).padStart(7)}  ${x.key === 'free' ? t.storageOfDrive(pct1(x.share, lang)) : pct1(x.share, lang).padStart(7)}`,
  }))
  const footer = r.scan ? t.storageScanned(scanTime(r.scan.at, r.at, lang), int(r.scan.files, lang)) : t.storageNoScan
  return { bar, lines, footer }
}
