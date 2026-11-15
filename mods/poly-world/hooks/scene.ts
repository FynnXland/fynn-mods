// scene.ts: die Szene als SVG-Text, ohne `$` (SPEC „Szene“). Eigene Kunst: eine schwebende Low-Poly-Insel mit Hütte, Bäumen und
// Wasserfall oben rechts, dahinter ein Himmel nach Uhrzeit.
//
// Aufbau (Skill plugin-authoring look.md „A moving scene“, „Any screen“):
// - Wurzel ohne viewBox, 100 % × 100 %: Der Himmel füllt jedes Fenster; Prozentangaben beziehen sich auf das echte Fenster.
// - Himmelsebene: verschachteltes <svg viewBox 1600×1000 slice> für Sterne, Sonne, Mond, Wolken.
// - Insel: verschachteltes <svg preserveAspectRatio="xMaxYMin meet"> im Kasten oben rechts, weg von der Mitte (Text) und vom Fuß
//   (Eingabe). Layout-Zahlen sind hier SVG-Einheiten, keine Zellen (docs/BAND-PROBE-2.1.325.md 7b betrifft nur Box/Text).
// - Tageszeit als 24-h-CSS-Zyklus: Jede Animation dauert 86 400 s und startet mit negativem animation-delay (= Sekunden seit
//   Mitternacht). Zeichnet die App neu, setzt der neue Text den Zyklus an derselben Stelle fort; ohne Neuzeichnen läuft er weiter.
//   Wolken und Schweben bekommen ebenso ihren Versatz aus der Uhr. Vorschau (`/world time`) hält den Zyklus an (paused).
// - Nur CSS und SMIL-freie Keyframes im eigenen <style>, kein Script, nichts geladen (types@2.1.325:13800-13840).
import { arcAt, arcPoint, DAY_MINUTES, KEYS, MOON, skyAt, SUN } from './sky.js'

export type SceneFlags = {
  /** Claude arbeitet: Rauch aus dem Schornstein */
  working: boolean
  /** Musik läuft (tune-strip.playing): Laternen an */
  music: boolean
  /** Fensterlicht (Clawd müde oder spät abends) */
  window: boolean
  /** Nachts bei Arbeit: bläulicher Laptop-Schein im Fenster */
  laptop: boolean
}

export type SceneInput = SceneFlags & {
  /** Minute des Tages, die gezeigt wird (mit Sekundenbruch) */
  minute: number
  /** Vorschau: Zyklus angehalten */
  paused: boolean
  /** Unix-ms jetzt, für den Versatz von Wolken und Schweben */
  now: number
}

/** Höchstlänge laut SPEC (Ziel), die Engine nimmt bis 131 072 Zeichen. */
export const SCENE_LIMIT = 60000

const pct = (minute: number) => `${((minute / DAY_MINUTES) * 100).toFixed(3).replace(/\.?0+$/, '')}%`
const n = (v: number) => String(Math.round(v * 100) / 100)

/** Keyframes einer Eigenschaft über den Tag an den Stützstellen des Himmels. */
function dayFrames(name: string, value: (k: (typeof KEYS)[number]) => string): string {
  return `@keyframes ${name}{${KEYS.map((k) => `${pct(k.at)}{${value(k)}}`).join('')}}`
}

const brightness = (light: number) => `filter:brightness(${n(light)}) saturate(${n(0.55 + 0.45 * light)})`

/** Keyframes für Sonne oder Mond: Stand alle 30 Minuten auf dem Bogen, unsichtbar außerhalb. */
function bodyFrames(name: string, body: { rise: number; set: number }): string {
  const frames: string[] = []
  for (let m = 0; m <= DAY_MINUTES; m += 30) {
    const a = arcAt(m, body)
    const p = arcPoint(a.t)
    frames.push(`${pct(m)}{transform:translate(${p.x}px,${p.y}px);opacity:${n(a.opacity)}}`)
  }
  return `@keyframes ${name}{${frames.join('')}}`
}

/** Feste Pseudo-Zufallszahlen (gleiche Sterne in jedem Bild). */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function stars(): string {
  const r = seeded(7)
  const out: string[] = []
  for (let i = 0; i < 46; i++) {
    const x = Math.round(r() * 1600)
    const y = Math.round(r() * 620)
    const size = n(0.8 + r() * 1.8)
    out.push(`<circle class="tw" cx="${x}" cy="${y}" r="${size}" style="animation-delay:-${n(r() * 5)}s"/>`)
  }
  return out.join('')
}

const poly = (points: string, fill: string) => `<polygon points="${points}" fill="${fill}"/>`

/** Low-Poly-Wolke an (x, y) mit Maßstab s. */
function cloud(s: number): string {
  return `<g transform="scale(${s})">${poly('0,38 14,22 34,16 50,4 74,0 94,12 108,20 124,30 120,40 0,40', '#ffffff')}${poly('0,38 120,40 124,30 92,34 60,30 30,34', '#dde7f2')}</g>`
}

// Felsunterseite: Facetten in Braun, nach unten dunkler
const ROCK = [
  ['72,208 130,214 90,248', '#7b5d45'],
  ['130,214 200,216 150,262', '#94735a'],
  ['90,248 130,214 150,262', '#6a503c'],
  ['200,216 270,214 245,262', '#856650'],
  ['150,262 200,216 245,262', '#a5846a'],
  ['270,214 330,206 312,250', '#6e5340'],
  ['245,262 270,214 312,250', '#5c4534'],
  ['90,248 150,262 120,290', '#5a4433'],
  ['150,262 245,262 200,305', '#7a5c46'],
  ['245,262 312,250 280,300', '#4e3b2d'],
  ['120,290 150,262 200,305', '#664c3a'],
  ['200,305 245,262 280,300', '#58422f'],
  ['120,290 200,305 168,336', '#4a382a'],
  ['200,305 280,300 236,340', '#423225'],
  ['168,336 200,305 236,340', '#3a2c21'],
  ['168,336 236,340 200,352', '#30251c'],
] as const

// Grasdecke oben und ihr dunklerer Rand
const GRASS = [
  ['58,196 92,178 120,196', '#78c862'],
  ['92,178 140,170 120,196', '#6cbb58'],
  ['140,170 200,166 170,192', '#7fd068'],
  ['120,196 140,170 170,192', '#62ad50'],
  ['200,166 262,170 230,192', '#6cbb58'],
  ['170,192 200,166 230,192', '#5aa64b'],
  ['262,170 312,176 290,194', '#7fd068'],
  ['230,192 262,170 290,194', '#66b354'],
  ['312,176 344,192 290,194', '#5aa64b'],
  ['58,196 120,196 72,208', '#4a9440'],
  ['72,208 120,196 130,214', '#3f8638'],
  ['120,196 170,192 130,214', '#4e9a44'],
  ['130,214 170,192 200,216', '#438c3b'],
  ['170,192 230,192 200,216', '#4a9440'],
  ['200,216 230,192 270,214', '#3f8638'],
  ['230,192 290,194 270,214', '#4e9a44'],
  ['270,214 290,194 330,206', '#438c3b'],
  ['290,194 344,192 330,206', '#3a7d33'],
] as const

const TREES = [
  // Tanne links
  '<rect x="107" y="176" width="6" height="18" fill="#6b4a32"/>',
  poly('92,184 110,148 110,184', '#2f7d4a'),
  poly('110,148 128,184 110,184', '#25663c'),
  poly('96,166 110,130 110,166', '#3a8f55'),
  poly('110,130 124,166 110,166', '#2f7d4a'),
  // kleine Tanne
  '<rect x="137" y="168" width="5" height="14" fill="#6b4a32"/>',
  poly('127,176 140,150 140,176', '#347f4c'),
  poly('140,150 153,176 140,176', '#296a3f'),
  poly('130,162 140,138 140,162', '#43985c'),
  poly('140,138 150,162 140,162', '#347f4c'),
  // Laubbaum rechts
  '<rect x="286" y="166" width="6" height="22" fill="#6b4a32"/>',
  poly('272,160 282,140 290,156', '#5fae4e'),
  poly('282,140 300,136 290,156', '#6fc05c'),
  poly('300,136 312,152 290,156', '#529c44'),
  poly('272,160 290,156 286,172', '#4b8f3e'),
  poly('290,156 312,152 306,168', '#43843a'),
  poly('286,172 290,156 306,168', '#3d7a35'),
].join('')

const HUT = [
  // Wand vorn, zwei Facetten
  poly('180,152 226,152 180,184', '#e2bf92'),
  poly('226,152 226,184 180,184', '#d1a97c'),
  // Dach
  poly('172,154 205,124 205,154', '#b8553d'),
  poly('205,124 238,154 205,154', '#9c4431'),
  // Schornstein
  '<rect x="220" y="124" width="9" height="22" fill="#77685c"/><rect x="218" y="121" width="13" height="4" fill="#5f534a"/>',
  // Tür
  '<rect x="210" y="163" width="11" height="21" fill="#7a4f33"/>',
  // Fenster (dunkel), Licht kommt darüber
  '<rect x="187" y="159" width="15" height="12" fill="#2b2f3a"/><rect x="194" y="159" width="1.5" height="12" fill="#5a4636"/>',
].join('')

const POND = poly('298,190 316,184 336,188 338,196 318,200 300,198', '#5fb6e0') + poly('316,184 336,188 318,192', '#8fd0f0')

const LANTERN_POSTS = [
  '<rect x="159" y="168" width="2.5" height="20" fill="#4a3a2e"/><rect x="155.5" y="161" width="9.5" height="8" fill="#3b3029"/>',
  '<rect x="251" y="170" width="2.5" height="20" fill="#4a3a2e"/><rect x="247.5" y="163" width="9.5" height="8" fill="#3b3029"/>',
].join('')

const FLOATING_ROCKS =
  `<g class="bob2">${poly('110,312 124,304 134,314 122,324', '#6a503c')}${poly('124,304 134,314 122,312', '#856650')}</g>` +
  `<g class="bob3">${poly('284,322 300,316 308,328 292,334', '#5c4534')}${poly('300,316 308,328 296,326', '#7b5d45')}</g>`

function css(input: SceneInput): string {
  const delay = `-${n(input.minute * 60)}s`
  const now = input.now / 1000
  // Wolken und Schweben setzen an der Uhr an, damit ein Neuzeichnen nicht zurückspringt
  const off = (period: number) => `-${n(now % period)}s`
  return [
    `.cyc{animation-duration:86400s;animation-timing-function:linear;animation-iteration-count:infinite;animation-fill-mode:both;animation-delay:${delay}${input.paused ? ';animation-play-state:paused' : ''}}`,
    dayFrames('s0', (k) => `stop-color:${k.sky.top}`),
    dayFrames('s1', (k) => `stop-color:${k.sky.mid}`),
    dayFrames('s2', (k) => `stop-color:${k.sky.low}`),
    dayFrames('st', (k) => `opacity:${n(k.sky.stars)}`),
    dayFrames('li', (k) => brightness(k.sky.light)),
    bodyFrames('su', SUN),
    bodyFrames('mo', MOON),
    '.s0{animation-name:s0}.s1{animation-name:s1}.s2{animation-name:s2}.st{animation-name:st}.li{animation-name:li}.su{animation-name:su}.mo{animation-name:mo}',
    '@keyframes tw{0%,100%{opacity:1}50%{opacity:.35}}.tw{fill:#fff;animation:tw 4s ease-in-out infinite}',
    '@keyframes dr{from{transform:translateX(-320px)}to{transform:translateX(1700px)}}',
    `.c1{animation:dr 260s linear infinite;animation-delay:${off(260)}}.c2{animation:dr 340s linear infinite;animation-delay:${off(340)}}.c3{animation:dr 420s linear infinite;animation-delay:${off(420)}}`,
    '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
    `.bob{animation:bob 7s ease-in-out infinite;animation-delay:${off(7)}}.bob2{animation:bob 5s ease-in-out infinite;animation-delay:${off(5)}}.bob3{animation:bob 6s ease-in-out infinite;animation-delay:${off(6)}}`,
    '@keyframes fall{to{stroke-dashoffset:-36}}.fall{animation:fall .9s linear infinite}.fall2{animation:fall .7s linear infinite}',
    '@keyframes puff{0%{transform:translate(0,0) scale(.6);opacity:0}12%{opacity:.9}100%{transform:translate(16px,-74px) scale(2.1);opacity:0}}',
    '.pf{transform-box:fill-box;transform-origin:center;animation:puff 3.6s ease-out infinite}.pf2{animation-delay:-1.2s}.pf3{animation-delay:-2.4s}',
    '@keyframes fl{0%,100%{opacity:.9}40%{opacity:.6}70%{opacity:1}}.fl{animation:fl 1.7s ease-in-out infinite}',
    '@keyframes scr{0%,100%{opacity:.75}50%{opacity:.45}}.scr{animation:scr 2.3s ease-in-out infinite}',
  ].join('')
}

function lights(f: SceneFlags): string {
  const out: string[] = []
  if (f.window) {
    out.push('<rect x="187" y="159" width="15" height="12" fill="#ffd27a"/><rect x="194" y="159" width="1.5" height="12" fill="#5a4636"/>')
    out.push('<circle cx="194.5" cy="165" r="16" fill="url(#warm)"/>')
  }
  if (f.laptop) out.push('<rect class="scr" x="189" y="164" width="8" height="6" fill="#8fc8ff"/><circle class="scr" cx="193" cy="167" r="13" fill="url(#blue)"/>')
  if (f.music)
    out.push(
      '<g class="fl"><rect x="157" y="163" width="6.5" height="5" fill="#ffcf6b"/><circle cx="160.2" cy="165.5" r="14" fill="url(#warm)"/></g>',
      '<g class="fl" style="animation-delay:-.8s"><rect x="249" y="165" width="6.5" height="5" fill="#ffcf6b"/><circle cx="252.2" cy="167.5" r="14" fill="url(#warm)"/></g>',
    )
  if (f.working)
    out.push(
      '<g fill="#c4cad3" stroke="#aab1bc" stroke-width=".8">',
      '<circle class="pf" cx="225" cy="117" r="6.5"/>',
      '<circle class="pf pf2" cx="225" cy="117" r="6.5"/>',
      '<circle class="pf pf3" cx="225" cy="117" r="6.5"/>',
      '</g>',
    )
  return out.join('')
}

/** Die ganze Szene als SVG-Text. Immer kürzer als SCENE_LIMIT (Test). */
export function scene(input: SceneInput): string {
  const sky = skyAt(input.minute)
  const sun = arcAt(input.minute, SUN)
  const moon = arcAt(input.minute, MOON)
  const sp = arcPoint(sun.t)
  const mp = arcPoint(moon.t)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">',
    `<style>${css(input)}</style>`,
    '<defs>',
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop class="cyc s0" offset="0" stop-color="${sky.top}"/><stop class="cyc s1" offset=".58" stop-color="${sky.mid}"/><stop class="cyc s2" offset="1" stop-color="${sky.low}"/></linearGradient>`,
    '<radialGradient id="sun"><stop offset="0" stop-color="#fff6d8"/><stop offset=".35" stop-color="#ffe7a3"/><stop offset=".36" stop-color="#ffd87a" stop-opacity=".45"/><stop offset="1" stop-color="#ffd87a" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="warm"><stop offset="0" stop-color="#ffcf6b" stop-opacity=".7"/><stop offset="1" stop-color="#ffcf6b" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="blue"><stop offset="0" stop-color="#7fbfff" stop-opacity=".6"/><stop offset="1" stop-color="#7fbfff" stop-opacity="0"/></radialGradient>',
    '<linearGradient id="fallg" gradientUnits="userSpaceOnUse" x1="0" y1="196" x2="0" y2="360"><stop offset="0" stop-color="#d8f0ff" stop-opacity=".95"/><stop offset="1" stop-color="#d8f0ff" stop-opacity="0"/></linearGradient>',
    '</defs>',
    '<rect width="100%" height="100%" fill="url(#sky)"/>',
    // Himmelsebene: füllt jedes Fenster (slice), Sterne oben, Sonne und Mond auf dem Bogen, Wolken
    '<svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">',
    `<g class="cyc st" opacity="${sky.stars}">${stars()}</g>`,
    `<g class="cyc mo" transform="translate(${mp.x},${mp.y})" opacity="${moon.opacity}"><circle r="34" fill="#f3f1e6"/>${poly('-14,-18 0,-10 -6,4 -20,-4', '#dedbcc')}${poly('8,6 20,10 14,22 2,16', '#e5e2d4')}</g>`,
    `<g class="cyc su" transform="translate(${sp.x},${sp.y})" opacity="${sun.opacity}"><circle r="110" fill="url(#sun)"/></g>`,
    `<g class="cyc li"><g class="c1">${`<g transform="translate(0,120)">${cloud(1.4)}</g>`}</g><g class="c2"><g transform="translate(0,210)">${cloud(1)}</g></g><g class="c3"><g transform="translate(0,70)">${cloud(0.8)}</g></g></g>`,
    '</svg>',
    // Insel oben rechts
    '<svg x="62%" y="3%" width="35%" height="46%" viewBox="0 0 400 360" preserveAspectRatio="xMaxYMin meet">',
    '<g class="bob">',
    `<g class="cyc li">${ROCK.map(([p, c]) => poly(p, c)).join('')}`,
    '<path d="M337,197 C343,214 345,240 345,360" stroke="url(#fallg)" stroke-width="7" fill="none"/>',
    '<path class="fall" d="M337,197 C343,214 345,240 345,360" stroke="#ffffff" stroke-opacity=".55" stroke-width="3" fill="none" stroke-dasharray="5 13"/>',
    '<path class="fall2" d="M333,199 C338,218 339,246 339,330" stroke="url(#fallg)" stroke-width="2.5" fill="none" stroke-dasharray="9 9"/>',
    `${GRASS.map(([p, c]) => poly(p, c)).join('')}${POND}${TREES}${HUT}${LANTERN_POSTS}</g>`,
    lights(input),
    '</g>',
    `<g class="cyc li">${FLOATING_ROCKS}</g>`,
    '</svg>',
    '</svg>',
  ].join('')
}
