// Erzeugt showcase/index.html aus dem echten Code (hooks/*.ts): Typen entfernen, Module bündeln, Oberfläche anhängen.
//   node tools/build-showcase.mjs
// Das Ergebnis ist eine einzelne HTML-Datei ohne Abhängigkeiten (Doppelklick genügt, auch über file://).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { bundle as makeBundle, listModules } from './lib/bundle.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// Nicht ins Showcase-Bündel: Hooks-Modul und Client-Modul
const SKIP = ['hooks/register.ts', 'hooks/buddy.ts']
const files = listModules(root, SKIP)
const bundle = makeBundle(root, files)

// Syntaxprüfung und kurzer Rauchtest des Bündels in Node (ohne Browser)
const ctx = vm.createContext({ Math, console })
vm.runInContext(`${bundle}\nconst { createEngine } = __req('hooks/engine.ts'); const { ALL_CLIPS, ALL_PROPS } = __req('hooks/library.ts');
const e = createEngine({ clips: ALL_CLIPS, props: ALL_PROPS, rng: () => 0.5 }); e.start(); for (let i = 0; i < 400; i++) e.tick(); e.render();
globalThis.__ok = ALL_CLIPS.length;`, ctx)

const template = readFileSync(join(root, 'tools/showcase/template.html'), 'utf8')
const ui = readFileSync(join(root, 'tools/showcase/ui.js'), 'utf8')
const html = `${template}\n<script>\n${bundle}\n</script>\n<script>\n${ui}\n</script>\n</body>\n</html>\n`
mkdirSync(join(root, 'showcase'), { recursive: true })
writeFileSync(join(root, 'showcase/index.html'), html)
console.log(`showcase/index.html geschrieben: ${files.length} Module, ${ctx.__ok} Clips, ${(html.length / 1024).toFixed(0)} KB`)
