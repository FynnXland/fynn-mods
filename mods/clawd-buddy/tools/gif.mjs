// Animiertes GIF aus echten Clips (gleiche Engine wie im Mod, über tools/lib/capture.mjs):
//   node tools/gif.mjs <clip>... [--out datei.gif] [--scale 4] [--seed 1] [--loops 1] [--hour 12] [--width 44]
//   node tools/gif.mjs --story +helper type_laptop:6 high_five_helper helper_gift celebrate_jump juggle:7 [...]
// --story: alle Clips laufen nacheinander in EINER Engine (echte Übergänge; ein Helfer bleibt über mehrere Clips stehen).
//   `name:6` kürzt eine Schleife nach etwa 6 s (er steigt an der nächsten sicheren Stelle aus), `+helper` lässt einen Subagenten-
//   Helfer aufsteigen; ein Übergabe-Clip (Subagent fertig) lässt ihn danach absinken. Ohne --story wird jeder Clip einzeln aufgenommen.
// --sheet vorschau.png: zusätzlich eine Tafel mit einem Bild je Sekunde (zum Prüfen ohne GIF-Abspieler).
// Standard: .sheets/clawd.gif. Hintergrund, Linie und Kasten wie in tools/lib/sheet.mjs (Ton der Desktop-App).
// Gleiche Folgebilder werden zusammengefasst; die Dauer folgt dem Takt der Engine (TICK ms pro Bild).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_CLIPS } from '../hooks/library.ts'
import { H, PAL, TICK, W } from '../hooks/stage.ts'
import { captureClip, newEngine } from './lib/capture.mjs'
import { Canvas, hex } from './lib/png.mjs'

const args = process.argv.slice(2)
const VALUE_OPTS = ['--out', '--scale', '--seed', '--loops', '--hour', '--width', '--sheet']
const story = args.includes('--story')
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const out = opt('--out', fileURLToPath(new URL('../.sheets/clawd.gif', import.meta.url)))
const scale = Number(opt('--scale', 4))
const seed = Number(opt('--seed', 1))
const loops = Number(opt('--loops', 1))
const hour = Number(opt('--hour', 12))
const minWidth = Number(opt('--width', 44))
const names = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]))
if (!names.length) {
  console.error('Clip-Namen angeben, z. B.: node tools/gif.mjs type_laptop celebrate_jump juggle')
  process.exit(2)
}
const clipName = (n) => n.split(':')[0]
for (const n of names) {
  if (n === '+helper') continue
  if (!ALL_CLIPS.some((c) => c.name === clipName(n))) {
    console.error('unbekannter Clip:', n)
    process.exit(1)
  }
}

const IDLE = new Set(['idle_breathe', 'idle_look'])

const timeline = []
/** Story: eine Engine, Clips der Reihe nach; zwischen zwei Clips kurz die Grundpose. */
function captureStory() {
  const e = newEngine(seed, { hour })
  e.start()
  const shots = []
  const step = () => {
    e.tick()
    shots.push({ buf: e.render().buf })
  }
  for (let i = 0; i < 4; i++) step()
  for (const n of names) {
    if (n === '+helper') {
      e.set({ agents: 1 })
      continue
    }
    const name = clipName(n)
    const capTicks = n.includes(':') ? Math.round((Number(n.split(':')[1]) * 1000) / TICK) : Infinity
    const done = ALL_CLIPS.find((c) => c.name === name)?.cat === 'agent_done'
    const at = shots.length
    e.play(name)
    let seen = 0
    let idle = 0
    for (let i = 0; i < 2500 && idle < 6; i++) {
      step()
      const cur = e.S.play?.clip.name ?? ''
      if (cur === name && !seen) {
        seen = 1
        e.S.gallery = null // nur einmal, danach zurück in die Grundpose
        if (done) e.set({ agents: 0 })
      }
      if (seen) seen++
      if (seen === capTicks) e.requestChange()
      idle = seen && IDLE.has(cur) && !e.S.queue.length ? idle + 1 : 0
    }
    timeline.push(`${n} ${((shots.length - at) * TICK / 1000).toFixed(1)} s`)
  }
  // Am Ende in Ruhe (gleiches Bild wie am Anfang: nahtlose Schleife), Helfer ganz abgesunken
  for (let i = 0; i < 400 && e.S.mates.length; i++) step()
  for (let i = 0; i < 4; i++) step()
  return shots
}

const frames = story ? captureStory() : names.flatMap((n) => captureClip(n, { loops, seed, hour }))

// Ausschnitt: Vereinigung aller belegten Pixel über alle Bilder, mindestens `minWidth` Spalten, unten bis zur Linie
let x0 = W
let x1 = -1
let y0 = H
for (const f of frames) {
  f.buf.forEach((v, i) => {
    if (!v) return
    const x = i % W
    const y = Math.floor(i / W)
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
  })
}
x0 = Math.max(0, x0 - 2)
x1 = Math.min(W - 1, x1 + 2)
while (x1 - x0 + 1 < minWidth && (x0 > 0 || x1 < W - 1)) {
  if (x0 > 0) x0--
  if (x1 - x0 + 1 < minWidth && x1 < W - 1) x1++
}
y0 = Math.max(0, y0 - 1)
const cols = x1 - x0 + 1
const rows = H - y0
const boxH = 3 * scale
const lineH = Math.max(1, Math.floor(scale / 3))
const width = cols * scale
const height = rows * scale + boxH

// Palette: Bühne, Kasten, Linie, dann die Farben der Figur
const BG = [26, 26, 25]
const BOX = [34, 34, 34]
const LINE = [90, 90, 90]
const colors = [BG, BOX, LINE]
const index = new Map(colors.map((c, i) => [c.join(','), i]))
const colorOf = (rgb) => {
  const k = rgb.join(',')
  if (!index.has(k)) {
    if (colors.length >= 256) throw new Error('mehr als 256 Farben')
    index.set(k, colors.length)
    colors.push(rgb)
  }
  return index.get(k)
}
const palIndex = {}
for (const [k, v] of Object.entries(PAL)) if (v) palIndex[k] = colorOf(hex(v))

function raster(f) {
  const px = new Uint8Array(width * height) // 0 = Bühne
  for (let y = rows * scale; y < height; y++) px.fill(1, y * width, (y + 1) * width)
  for (let y = rows * scale; y < rows * scale + lineH; y++) px.fill(2, y * width, (y + 1) * width)
  f.buf.forEach((v, j) => {
    if (!v) return
    const x = (j % W) - x0
    const y = Math.floor(j / W) - y0
    if (x < 0 || x >= cols || y < 0 || y >= rows) return
    const c = palIndex[v]
    for (let dy = 0; dy < scale; dy++) px.fill(c, (y * scale + dy) * width + x * scale, (y * scale + dy) * width + (x + 1) * scale)
  })
  return px
}

// Gleiche Folgebilder zusammenfassen
const cells = []
for (const f of frames) {
  const key = f.buf.join('|')
  const prev = cells[cells.length - 1]
  if (prev && prev.key === key) prev.n++
  else cells.push({ key, f, n: 1 })
}

// --- GIF89a mit LZW ---------------------------------------------------------------------------------------------
function lzw(minSize, data) {
  const clear = 1 << minSize
  const eoi = clear + 1
  const bytes = []
  let cur = 0
  let nbits = 0
  let size = minSize + 1
  const emit = (code) => {
    cur |= code << nbits
    nbits += size
    while (nbits >= 8) {
      bytes.push(cur & 0xff)
      cur >>>= 8
      nbits -= 8
    }
  }
  let dict = new Map()
  let next = eoi + 1
  emit(clear)
  let prefix = data[0]
  for (let i = 1; i < data.length; i++) {
    const k = data[i]
    const key = prefix * 256 + k
    const hit = dict.get(key)
    if (hit !== undefined) {
      prefix = hit
      continue
    }
    emit(prefix)
    if (next < 4096) {
      dict.set(key, next++)
      if (next > 1 << size && size < 12) size++
    } else {
      emit(clear)
      dict = new Map()
      next = eoi + 1
      size = minSize + 1
    }
    prefix = k
  }
  emit(prefix)
  emit(eoi)
  if (nbits > 0) bytes.push(cur & 0xff)
  const outB = []
  for (let i = 0; i < bytes.length; i += 255) {
    const part = bytes.slice(i, i + 255)
    outB.push(part.length, ...part)
  }
  outB.push(0)
  return outB
}

const tableBits = Math.max(1, Math.ceil(Math.log2(colors.length)))
const tableSize = 1 << tableBits
const u16 = (n) => [n & 0xff, (n >> 8) & 0xff]
const bytes = [...Buffer.from('GIF89a'), ...u16(width), ...u16(height), 0x80 | ((tableBits - 1) << 4) | (tableBits - 1), 0, 0]
for (let i = 0; i < tableSize; i++) bytes.push(...(colors[i] ?? [0, 0, 0]))
bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0) // Endlosschleife
let carry = 0
for (const c of cells) {
  const exact = (c.n * TICK) / 10 + carry // Hundertstelsekunden
  const delay = Math.max(2, Math.round(exact))
  carry = exact - delay
  bytes.push(0x21, 0xf9, 0x04, 0x00, ...u16(delay), 0, 0)
  bytes.push(0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0)
  const minSize = Math.max(2, tableBits)
  bytes.push(minSize, ...lzw(minSize, raster(c.f)))
}
bytes.push(0x3b)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(bytes))
const secs = ((frames.length * TICK) / 1000).toFixed(1)
console.log(`${story ? 'Story ' : ''}${names.join(', ')}: ${frames.length} Ticks (${secs} s), ${cells.length} Bilder, ${width}×${height} px -> ${out}`)
if (story) console.log(`  ${timeline.join(" | ")}`)

// Vorschau-Tafel: ein Bild je Sekunde, 6 je Zeile
const sheetOut = opt('--sheet', '')
if (sheetOut) {
  const every = Math.round(1000 / TICK)
  const picks = frames.filter((_, i) => i % every === 0)
  const per = 6
  const gap = 4
  const cv = new Canvas(per * (width + gap), Math.ceil(picks.length / per) * (height + gap), [60, 60, 60])
  picks.forEach((f, k) => {
    const px = raster(f)
    const ox = (k % per) * (width + gap)
    const oy = Math.floor(k / per) * (height + gap)
    for (let i = 0; i < px.length; i++) cv.rect(ox + (i % width), oy + Math.floor(i / width), 1, 1, colors[px[i]])
  })
  writeFileSync(sheetOut, cv.png())
}
