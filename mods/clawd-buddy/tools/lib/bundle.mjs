// Kleiner Bündler für die eigenen TS-Module: Typen entfernen, ESM → Funktionsmodule mit eigenem __req.
// Unterstützt nur die Muster, die dieser Mod selbst benutzt (import { a as b } / import * as ns, export const|function, export default function, export { … }).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join, posix, relative } from 'node:path'

export function walkTs(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkTs(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

export function listModules(root, skip = []) {
  return walkTs(join(root, 'hooks'))
    .map((p) => relative(root, p).replaceAll('\\', '/'))
    .filter((p) => !skip.includes(p))
    .sort()
}

const stripComments = (js) => js.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

/** ESM → Funktionsmodul: import → __req(), export → exports.X. */
export function toFunctionModule(path, source) {
  let js = stripTypeScriptTypes(source, { mode: 'strip' })
  const dir = posix.dirname(path)
  const resolve = (spec) => posix.normalize(posix.join(dir, spec))
  const names = []
  js = js.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'\s*;?/g, (_, ns, spec) => `const ${ns} = __req('${resolve(spec)}');`)
  js = js.replace(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?/g, (_, list, spec) => {
    const parts = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '))
    return `const { ${parts.join(', ')} } = __req('${resolve(spec)}');`
  })
  js = js.replace(/export\s+const\s+(\w+)/g, (_, n) => { names.push([n, n]); return `const ${n}` })
  js = js.replace(/export\s+default\s+function\s+(\w+)/g, (_, n) => { names.push(['default', n]); return `function ${n}` })
  js = js.replace(/export\s+function\s+(\w+)/g, (_, n) => { names.push([n, n]); return `function ${n}` })
  js = js.replace(/export\s*\{([^}]*)\}\s*;?/g, (_, list) => { list.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => names.push([n, n])); return '' })
  const bare = stripComments(js)
  if (/\bexport\b/.test(bare)) throw new Error(`${path}: nicht unterstütztes export-Muster`)
  if (/\bimport\b\s*[\w{*]/.test(bare)) throw new Error(`${path}: nicht umgesetzter import`)
  const tail = names.map(([k, v]) => `exports.${k} = ${v};`).join(' ')
  return `__def('${path}', function (exports, __req) {\n${js}\n${tail}\n});`
}

export function bundle(root, files) {
  return [
    `const __mods = {}, __defs = {};
function __def(p, f) { __defs[p] = f; }
function __req(p) {
  if (__mods[p]) return __mods[p];
  if (!__defs[p]) throw new Error('Modul fehlt: ' + p);
  const exports = {}; __mods[p] = exports; __defs[p](exports, __req); return exports;
}`,
    ...files.map((f) => toFunctionModule(f, readFileSync(join(root, f), 'utf8'))),
  ].join('\n')
}
