// limit-bars: Systemwerte als Liste (SPEC Ausbau 0.13.0, löst die Säulen aus 0.12.0 ab), reine Funktionen ohne `$`.
// Ein dauerhafter PowerShell-Prozess (`$.process.spawn`) schreibt jede Sekunde eine Zeile: CPU, RAM und, mit NVIDIA-Karte,
// GPU-Last und belegter Grafikspeicher. Angezeigt werden höchstens 4 Zeilen untereinander mit Prozent und Trendpfeil.
import { FONT, RING_H, esc } from './ring.ts'
import { T } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { GREEN, GREY, ORANGE, RED, YELLOW } from './view.ts'

/** nvidia-smi über den festen Pfad (installiert der NVIDIA-Treiber); ohne die Datei keine GPU-Zeilen. */
export const NVIDIA_SMI = 'C:\\Windows\\System32\\nvidia-smi.exe'
/** Höchstens so viele Messungen je Prozess (30 min), dann endet er und der nächste Takt startet einen neuen. */
export const SYS_ROUNDS = 1800

/**
 * Festes Skript für Windows PowerShell 5.1, ohne Argumente oder Umgebung von außen, ohne doppelte Anführungszeichen.
 * CPU: Prozessorzeit aus zwei Rohwerten im Abstand von 1 s (`Win32_PerfRawData_PerfOS_Processor`, `_Total`; so zeigt sie der
 * Task-Manager unter Windows 11, Probe 2026-11-04). RAM: 1 − frei / gesamt. GPU: `nvidia-smi` (Last, belegter und gesamter
 * Grafikspeicher). Ausgabe je Sekunde eine Zeile mit Promille als ganzen Zahlen, Tab-getrennt: `cpu 340 ram 612 gpu 60 vram 569`.
 */
export const SYS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$t=[char]9',
  `$nv=Test-Path '${NVIDIA_SMI}'`,
  // Je Runde nur schnelle Abfragen (Probe 2026-11-04: Prozessor und Speicher je ≈ 20 ms, nvidia-smi ≈ 55 ms; Win32_OperatingSystem
  // brauchte dagegen 2,7–3,8 s und wird nur einmal beim Start für den Gesamtspeicher gefragt)
  '$tot=[double](Get-CimInstance -ClassName Win32_OperatingSystem).TotalVisibleMemorySize',
  "function u { Get-CimInstance -ClassName Win32_PerfRawData_PerfOS_Processor -Filter 'Name=''_Total''' }",
  '$a=u',
  '$w=[Diagnostics.Stopwatch]::StartNew()',
  // Geschlafen wird nur die Restzeit bis zur vollen Sekunde
  `for($i=0;$i -lt ${SYS_ROUNDS};$i++){ ` +
    '$r=1000-$w.ElapsedMilliseconds; if($r -gt 0){ Start-Sleep -Milliseconds $r }; $w.Restart(); $b=u; ' +
    '$c=1000*(1-([double]$b.PercentProcessorTime-$a.PercentProcessorTime)/([double]$b.Timestamp_Sys100NS-$a.Timestamp_Sys100NS)); $a=$b; ' +
    '$o=Get-CimInstance -ClassName Win32_PerfRawData_PerfOS_Memory; $m=1000*(1-[double]$o.AvailableKBytes/$tot); ' +
    "$l='cpu'+$t+[int][math]::Round($c)+$t+'ram'+$t+[int][math]::Round($m); " +
    `if($nv){ try { $g=(& '${NVIDIA_SMI}' --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits | Select-Object -First 1) -split ','; ` +
    "$l=$l+$t+'gpu'+$t+(10*[int]$g[0])+$t+'vram'+$t+[int][math]::Round(1000*[double]$g[1]/[double]$g[2]) } catch {} }; " +
    '[Console]::Out.WriteLine($l); [Console]::Out.Flush() }',
].join('; ')

/** Volle Zeilen aus dem Strom; der Rest wartet auf das nächste Stück (Stücke kommen nicht als Zeilen, types ProcessSpawnChunk). */
export function takeLines(buf: string, text: string): { lines: string[]; rest: string } {
  const all = (buf + text).split(/\r?\n/)
  const rest = all.pop() ?? ''
  return { lines: all.filter((l) => l.trim()), rest: rest.length > 4096 ? '' : rest }
}

export type Sample = { at: number; cpu: number; ram: number; gpu?: number; vram?: number }

/** Eine Zeile → Prozent (0–100, eine Stelle); ohne CPU oder RAM → undefined. */
export function parseSample(line: string, at: number): Sample | undefined {
  const p = line.trim().split('\t')
  const v: Record<string, number> = {}
  for (let i = 0; i + 1 < p.length; i += 2) if (/^-?\d+$/.test(p[i + 1]!)) v[p[i]!] = Number(p[i + 1])
  if (v.cpu === undefined || v.ram === undefined) return undefined
  const pct = (x: number) => Math.round(Math.max(0, Math.min(1000, x))) / 10
  const s: Sample = { at, cpu: pct(v.cpu), ram: pct(v.ram) }
  if (v.gpu !== undefined && v.vram !== undefined) {
    s.gpu = pct(v.gpu)
    s.vram = pct(v.vram)
  }
  return s
}

/** Trendpfeil erst ab so vielen Prozentpunkten Unterschied, damit Rauschen ihn nicht jede Sekunde kippt. */
export const TREND_MIN = 2
export type Trend = 'up' | 'down' | ''
export function trendOf(prev: number | undefined, cur: number): Trend {
  if (prev === undefined) return ''
  if (cur - prev >= TREND_MIN) return 'up'
  if (prev - cur >= TREND_MIN) return 'down'
  return ''
}

/** Farbe wie die Limit-Balken: grün unter 60 %, gelb ab 60 %, rot ab 85 %. */
export function levelColor(p: number): string {
  return p >= 85 ? RED : p >= 60 ? YELLOW : GREEN
}

export type SysTag = 'CPU' | 'RAM' | 'GPU' | 'VRAM'
export type SysRow = { tag: SysTag; pct: number | null; trend: Trend }
export type SysView = { rows: SysRow[]; alt: string }

/** Älter als so viel gilt eine Messung nicht mehr (Prozess beendet, Rechner schlief): `–`. */
export const SAMPLE_MAX_AGE = 10_000

/** Die Zeilen: CPU und RAM immer, GPU und VRAM nur, wenn die Messung sie hat. Ganze Prozent, Pfeil gegen die vorige Messung. */
export function sysView(cur: Sample | undefined, prev: Sample | undefined, now: number, lang: Lang): SysView {
  const fresh = !!cur && now - cur.at <= SAMPLE_MAX_AGE && now >= cur.at - 60_000 ? cur : undefined
  const row = (tag: SysTag, key: 'cpu' | 'ram' | 'gpu' | 'vram'): SysRow => {
    const v = fresh?.[key]
    return v === undefined ? { tag, pct: null, trend: '' } : { tag, pct: Math.round(v), trend: trendOf(prev?.[key], v) }
  }
  const rows = [row('CPU', 'cpu'), row('RAM', 'ram')]
  if (fresh?.gpu !== undefined) rows.push(row('GPU', 'gpu'), row('VRAM', 'vram'))
  const t = T[lang]
  const alt = rows.map((r) => t.sysAlt(r.tag, r.pct === null ? '–' : t.pct(String(r.pct)))).join('; ')
  return { rows, alt }
}

const ARROW: Readonly<Record<Trend, string>> = { up: '▲', down: '▼', '': '' }

// ---------- Desktop ----------

const ROW_FONT = 11
const ROW_CW = ROW_FONT * 0.6 // Monospace, 6,6 px je Zeichen
export const ROW_H = 14 // 4 Zeilen = 56 px, so hoch wie die Ringe
const TAG_CH = 4 // `VRAM`
const VAL_CH = 4 // `100%`
/** Breite der Liste: Kürzel, Leerzeichen, Prozent rechtsbündig, Leerzeichen, Pfeil (11 Zeichen ≈ 73 px). */
export const SYS_W = Math.ceil((TAG_CH + 1 + VAL_CH + 1 + 1) * ROW_CW) + 2

/**
 * Die Liste als Svg-Fragment, links oben bei (x, y), unten bündig mit den Ringen. Kürzel orange, Prozent rechtsbündig in einem
 * Feld für `100%` (alle Zahlen auf einer Höhe), Pfeil grau dahinter.
 */
export function sysSvg(v: SysView, x: number, y: number): string {
  const top = y + RING_H - v.rows.length * ROW_H
  const valEnd = x + (TAG_CH + 1 + VAL_CH) * ROW_CW
  const arrowX = valEnd + ROW_CW
  let out = ''
  v.rows.forEach((r, i) => {
    const base = top + i * ROW_H + 11
    out += `<text x="${x}" y="${base}" font-family="${FONT}" font-size="${ROW_FONT}" fill="${ORANGE}">${r.tag}</text>`
    out += `<text x="${Math.round(valEnd * 10) / 10}" y="${base}" text-anchor="end" font-family="${FONT}" font-size="${ROW_FONT}" fill="${r.pct === null ? GREY : levelColor(r.pct)}">${esc(r.pct === null ? '–' : `${r.pct}%`)}</text>`
    if (r.trend) out += `<text x="${Math.round(arrowX * 10) / 10}" y="${base}" font-family="${FONT}" font-size="${ROW_FONT - 2}" fill="${GREY}">${ARROW[r.trend]}</text>`
  })
  return out
}

// ---------- Terminal ----------

/** Eine Zelle im Terminal: `CPU   34%▲` (Kürzel auf 4, Prozent rechtsbündig auf 4, Pfeil oder Leerzeichen): 10 Zeichen. */
export const CELL_W = TAG_CH + 1 + VAL_CH + 1
export function cellText(r: SysRow): { tag: string; value: string; arrow: string } {
  return { tag: r.tag.padEnd(TAG_CH), value: ` ${(r.pct === null ? '–' : `${r.pct}%`).padStart(VAL_CH)}`, arrow: ARROW[r.trend] || ' ' }
}

/** Die Zeilen im Terminal-Band (2 Zeilen hoch): Spalten zu je zwei Werten, CPU über GPU, RAM über VRAM. */
export function termColumns(v: SysView): SysRow[][] {
  const by = (t: SysTag) => v.rows.find((r) => r.tag === t)
  return [[by('CPU'), by('GPU')], [by('RAM'), by('VRAM')]].map((c) => c.filter((r): r is SysRow => !!r))
}

/** Breite im Terminal: Spalten × 10 plus 2 Spalten Fuge. */
export const sysTermWidth = (v: SysView) => {
  const n = termColumns(v).filter((c) => c.length).length
  return n ? n * CELL_W + (n - 1) * 2 : 0
}
