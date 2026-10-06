// Bildstreifen rendern:
//   node tools/sheet.mjs <clip>... | --all | --cat <kategorie>   [--out dir] [--scale 5] [--loops 2] [--seed 1] [--from <clip>] [--blind] [--mirror]
// Mit --mirror: der Clip einmal gespiegelt (Intro, Hauptteil, Outro direkt gezeichnet, ohne Engine), Datei <clip>.mirror.png.
// Schreibt <out>/<clip>.png (Standard: .sheets/). Phasenleiste: blau = Intro, grün = Hauptteil, orange = Outro.
// Mit --blind heißt die Datei neutral (b<Hash>.png), damit der Dateiname den Clip nicht verrät; die Zuordnung steht in <out>/index.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_CLIPS, ALL_PROPS } from '../hooks/library.ts'
import { resolveClip } from '../hooks/clipdef.ts'
import { compose } from '../hooks/stage.ts'
import { captureClip } from './lib/capture.mjs'
import { renderSheet } from './lib/sheet.mjs'

const args = process.argv.slice(2)
const VALUE_OPTS = ['--out', '--scale', '--loops', '--seed', '--cat', '--from']
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const out = opt('--out', fileURLToPath(new URL('../.sheets/', import.meta.url)))
const scale = Number(opt('--scale', 5))
const loops = Number(opt('--loops', 2))
const seed = Number(opt('--seed', 1))
const from = opt('--from', null)
let names = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]))
if (args.includes('--all')) names = ALL_CLIPS.map((c) => c.name)
if (args.includes('--cat')) names = ALL_CLIPS.filter((c) => c.cat === opt('--cat')).map((c) => c.name)
if (!names.length) {
  console.error('Clip-Namen angeben, --all oder --cat <kategorie>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })
const blind = args.includes('--blind')
const hash = (str) => {
  let h = 2166136261
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h.toString(16).padStart(8, '0')
}
/** Alle Bilder des Clips gespiegelt, je Bild so oft wie seine Dauer (für die Phasenleiste wie bei captureClip). */
function mirrored(name) {
  const r = resolveClip(ALL_CLIPS.find((c) => c.name === name))
  const out = []
  for (const phase of ['intro', 'body', 'outro']) {
    for (const f of r[phase]) {
      const c = compose({ ...f.p, mirror: true }, ALL_PROPS)
      for (let k = 0; k < f.t; k++) out.push({ buf: c.buf, hit: c.hit, pose: f.p, clip: name, phase, tick: out.length })
    }
  }
  return out
}
const index = {}
for (const n of names) {
  if (!ALL_CLIPS.some((c) => c.name === n)) {
    console.error('unbekannter Clip:', n)
    process.exitCode = 1
    continue
  }
  const mirror = args.includes('--mirror')
  const frames = mirror ? mirrored(n) : captureClip(n, { loops, seed, from })
  const { png, cells, frames: nf } = renderSheet(frames, { scale })
  const file = blind ? `b${hash(n + ':' + seed)}.png` : `${n}${mirror ? '.mirror' : ''}.png`
  writeFileSync(`${out}/${file}`, png)
  index[n] = join(out, file).replaceAll('\\', '/')
  console.log(`${n}: ${nf} Ticks, ${cells} Bilder -> ${index[n]}`)
}
if (blind) writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1))
