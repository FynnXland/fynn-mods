// Bildstreifen rendern:
//   node tools/sheet.mjs <clip>... | --all | --cat <kategorie>   [--out dir] [--scale 5] [--loops 2] [--seed 1] [--from <clip>] [--blind]
// Schreibt <out>/<clip>.png (Standard: .sheets/). Phasenleiste: blau = Intro, grün = Hauptteil, orange = Outro.
// Mit --blind heißt die Datei neutral (b<Hash>.png), damit der Dateiname den Clip nicht verrät; die Zuordnung steht in <out>/index.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_CLIPS } from '../hooks/library.ts'
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
const index = {}
for (const n of names) {
  if (!ALL_CLIPS.some((c) => c.name === n)) {
    console.error('unbekannter Clip:', n)
    process.exitCode = 1
    continue
  }
  const frames = captureClip(n, { loops, seed, from })
  const { png, cells, frames: nf } = renderSheet(frames, { scale })
  const file = blind ? `b${hash(n + ':' + seed)}.png` : `${n}.png`
  writeFileSync(`${out}/${file}`, png)
  index[n] = join(out, file).replaceAll('\\', '/')
  console.log(`${n}: ${nf} Ticks, ${cells} Bilder -> ${index[n]}`)
}
if (blind) writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1))
