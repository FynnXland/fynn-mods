// clawd-buddy: Bühne, Posen und Zeichnen (reine Daten und Funktionen, kein `$`, kein DOM, keine Uhr).
//
// Die Bühne ist ein Pixelraster, 2 Pixelzeilen = 1 Terminalzeile (Halbblock ▀/▄). Die Figur (17×10 Pixel)
// steht auf der untersten Pixelzeile; sie steht auf der Oberkante der Eingabebox. Alles, was unter die letzte Zeile
// geschoben wird, verschwindet "hinter der Linie" (wird abgeschnitten): so kommen Gegenstände und Helfer ins Bild.
// Die Bühne nutzt die ganze Leiste über der Eingabe (Fynn). Die Figur sitzt rechts; rechts bleibt Platz für Gegenstände neben ihr.
// Ein- und Ausgang gibt es nur nach unten (hinter die Linie), nie über den linken, rechten oder oberen Rand (lint.ts prüft das).
export const W = 100 // Bühne: Spalten
export const H = 14 // Bühne: Pixelzeilen (7 Terminalzeilen)
export const FX = 60 // Ursprung der Figur (linke Spalte) im Heimatplatz; rechts bleiben 23 Spalten Platz (gespiegelte Clips, wenn links Begleiter stehen), links 60
export const FY = 4 // Ursprung der Figur (oberste Zeile) im Heimatplatz
export const TICK = 75 // ms pro Tick: ~13 Bilder/s. Alle Clipdauern t zählen in Ticks.

/** Palette der Bühne (Palettenzeichen → Farbe). O = Clawds Orange, K = Augen, Q = Schattenton der Vorderarme. */
export const PAL: Readonly<Record<string, string>> = {
  O: '#D77757', Q: '#A9573C', K: '#000000', W: '#F2F2F2', G: '#9A9A9A', D: '#4A4A4A',
  B: '#5B9BD5', E: '#6CC070', Y: '#F2C94C', P: '#F09A8A', C: '#E9D8BE', R: '#7A4A2A',
  L: '#8CCBF2', N: '#3E4C9A', T: '#2E2E2E', M: '#C9594B',
  // Helfer (Subagenten): hellere Claude-Farbe für den Körper, dunklere für Arme und die hintere Reihe (Fynn, 2026-10-06: statt Blau)
  A: '#EDA98A', F: '#B8664A',
}

/** Requisite: Palettenraster, '.' = durchsichtig. `effect`: kleiner Effekt (Funkeln, Note, …), der aus der Figur entsteht. */
export type PropSprite = {
  rows: readonly string[]
  effect?: true
  /** Schrift/Zeichen/Uhr: beim Spiegeln nur den Platz wechseln, das Bild selbst nicht umdrehen (ein „?“ bleibt ein „?“). */
  noFlip?: true
  /**
   * Bild für die gespiegelte Figur (wird dann wie jedes andere gespiegelt): für Gegenstände, deren Form mitgespiegelt werden muss, deren Zeichen
   * darin aber lesbar bleiben sollen (Denkblase mit „?“: die Spur hängt an der Figur). Darin steht das Zeichen seitenverkehrt.
   */
  mirrorRows?: readonly string[]
  /**
   * Verlängerung der Hand (Schattenton wie die Vorderarme), z. B. die schreibende Hand auf dem Blatt: gilt in den Prüfungen als Effekt
   * an der Figur, darf aber auf dem Gegenstand liegen, den sie hält (anim.test „Effekte überlappen sich nie“).
   */
  hand?: true
}
/** Verweis auf eine Requisite im Frame: [Name, x, y, 'g'?]. Ohne 'g' relativ zur Figur, mit 'g' relativ zum Heimatplatz. */
export type PropRef = readonly [name: string, x: number, y: number, flag?: 'g' | 'G']
/**
 * Arm der Figur: Name (`down`, `up1`, `raise` …), **Blockarm** `{ out, y, h? }` oder gestreckter Arm `{ to: [x, y] }`.
 * Blockarm = achsenparalleles Rechteck am Körper (wie die Armstummel des echten Clawd): `out` Pixel lang (2 = Stummel), Oberkante `y`
 * Pixel unter der Körperoberkante, `h` Pixel dick (Standard 2). `y` darf bis 9 gehen und darüber (dann steckt die Hand hinter der Linie).
 * Der gestreckte Arm (`to`, dünn, diagonal) ist nur für das Ziehen mit der Maus gedacht.
 */
export type ArmSpec = string | { out: number; y: number; h?: number } | { to: readonly [number, number] }

export type Pose = {
  fx: number
  fy: number
  by: number
  squash: number
  legs: string
  armL: ArmSpec
  armR: ArmSpec
  eyes: string
  look: readonly [number, number]
  mouth: string | null
  blush: boolean
  back: boolean
  props: readonly PropRef[]
  /** Ganze Szene gespiegelt (um die Mitte der Figur), siehe Engine: Clips laufen zufällig links- oder rechtsherum. */
  mirror?: boolean
  /**
   * Gesicht seitlich versetzt (Pixel, + = nach rechts) für die 3/4-Drehung: Augen, Mund und Wangen rücken zur zugewandten Seite,
   * wie im Laptop-GIF (die abgewandte Körperseite liegt dann im Schatten). Unabhängig von `look` (Pupillen) und nicht begrenzt.
   */
  face?: number
}

/** Kanonische Posen: Ein- und Ausstiegspunkte aller Clips. */
export const DEF: Pose = {
  fx: 0, fy: 0, by: 0, squash: 0, legs: 'stand', armL: 'down', armR: 'down', eyes: 'open',
  look: [0, 0], mouth: null, blush: false, back: false, props: [],
}
export const POSES: Readonly<Record<string, Pose>> = {
  stand: { ...DEF },
  sit: { ...DEF, by: 2 },
  lie: { ...DEF, by: 2, squash: 2, armL: 'out', armR: 'out', eyes: 'closed' },
  back: { ...DEF, back: true, eyes: 'none' },
  held: { ...DEF, fy: -3, legs: 'stepA', eyes: 'wide' },
}
export const POSE_NAMES: Readonly<Record<string, string>> = {
  stand: 'stehen', sit: 'sitzen', lie: 'liegen', back: 'abgewandt', held: 'hochgehoben',
}

/** Arme: Pixel des linken Arms relativ zur Körperoberkante; rechts gespiegelt (x → 16−x). */
export const ARMS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  down: [[0, 4], [1, 4], [0, 5], [1, 5]],
  up1: [[0, 3], [1, 3], [0, 4], [1, 4]],
  up2: [[0, 2], [1, 2], [0, 3], [1, 3]],
  raise: [[0, 0], [1, 0], [0, 1], [1, 1]],
  wave1: [[-1, 0], [0, 0], [0, 1], [1, 1]],
  wave2: [[0, -1], [1, -1], [0, 0], [1, 0]],
  out: [[-2, 4], [-1, 4], [0, 4], [1, 4], [-2, 5], [-1, 5], [0, 5], [1, 5]],
  hide: [],
}
/**
 * Arme vor dem Körper (Schattenfarbe Q). Wie alle Hände Blöcke, 2 Pixel dick (Fynn: "die Hände sollten blockig wirken", ein Stil für alles),
 * nie dünne Striche. Links angegeben, rechts gespiegelt (x → 16−x).
 */
export const FRONT: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  type: [[3, 4], [4, 4], [5, 4], [3, 5], [4, 5], [5, 5]],
  typeUp: [[3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4]],
  hold: [[3, 4], [4, 4], [3, 5], [4, 5]],
  /** Hält etwas unten vor dem Bauch (Buch, Zeitung) an den unteren Ecken. */
  holdLow: [[3, 6], [4, 6], [3, 7], [4, 7]],
  holdUp: [[3, 3], [4, 3], [3, 4], [4, 4]],
  chin: [[5, 5], [6, 5], [7, 5], [5, 6], [6, 6], [7, 6], [7, 4], [8, 4]],
  chinUp: [[5, 4], [6, 4], [7, 4], [5, 5], [6, 5], [7, 5], [7, 3], [8, 3]],
  rub: [[3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4]],
  rubUp: [[3, 2], [4, 2], [5, 2], [3, 3], [4, 3], [5, 3]],
}
// Verschränkte Arme liegen unter den Augen (Zeilen 4–6), damit kein Auge verdeckt wird.
export const CROSS_L: readonly (readonly [number, number])[] = [
  [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6],
]
export const CROSS_R: readonly (readonly [number, number])[] = [
  [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [13, 5],
]

export const LEGS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  stand: [[2, 8], [2, 9], [4, 8], [4, 9], [12, 8], [12, 9], [14, 8], [14, 9]],
  stepA: [[2, 8], [4, 8], [4, 9], [12, 8], [14, 8], [14, 9]],
  stepB: [[2, 8], [2, 9], [4, 8], [12, 8], [12, 9], [14, 8]],
  tuck: [[2, 8], [4, 8], [12, 8], [14, 8]],
  kickR: [[2, 8], [2, 9], [4, 8], [4, 9], [12, 8], [12, 9], [14, 8], [15, 9]],
  kickL: [[1, 9], [2, 8], [4, 8], [4, 9], [12, 8], [12, 9], [14, 8], [14, 9]],
  tapR: [[2, 8], [2, 9], [4, 8], [4, 9], [12, 8], [12, 9], [14, 8]],
  spread: [[1, 8], [1, 9], [4, 8], [4, 9], [12, 8], [12, 9], [15, 8], [15, 9]],
  none: [],
}

/** Augen: relativ zum Anker (links 4|top+2, rechts 12|top+2); rechts gespiegelt. `wink`: nur das linke Auge zu. */
export const EYES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  open: [[0, 0], [0, 1]],
  closed: [[-1, 1], [0, 1]],
  half: [[0, 1]],
  happy: [[-1, 1], [0, 0], [1, 1]],
  angry: [[0, 0], [0, 1], [1, -1]],
  sad: [[0, 0], [0, 1], [-1, -1]],
  wide: [[0, 0], [0, 1], [1, 0], [1, 1]],
  dizzy: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  tight: [[-1, 0], [0, 1], [-1, 2]],
  none: [],
}
/** Einseitige Augen (nur links bzw. nur rechts gezeichnet), z. B. Zwinkern beim Kramen. */
export const EYES_ONE: Readonly<Record<string, { left: string; right: string }>> = {
  winkR: { left: 'open', right: 'closed' }, // rechtes Auge zu
  winkL: { left: 'closed', right: 'open' }, // linkes Auge zu
}
export const LOOKABLE_EYES: ReadonlySet<string> = new Set(['open', 'wide', 'half', 'angry', 'sad', 'winkR', 'winkL'])
export const MOUTH: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  o: [[8, 5]],
  yawn: [[8, 4], [8, 5]],
  yawnBig: [[7, 4], [8, 4], [9, 4], [7, 5], [8, 5], [9, 5]],
  smile: [[7, 4], [8, 5], [9, 4]],
  flat: [[7, 5], [8, 5], [9, 5]],
}

/** Welche Pose-Felder die Figur "strukturell" verändern (sichere Frames, Glättung). */
export const STRUCT = ['fx', 'fy', 'by', 'squash', 'back'] as const
export const NUM = ['fx', 'fy', 'by', 'squash'] as const

/** Tabelle der Requisiten; wird von props.ts befüllt (kein Import-Kreis: stage.ts kennt nur die Referenz). */
export type PropTable = Readonly<Record<string, PropSprite>>

export type Composed = {
  /** Palettenzeichen je Pixel oder null. */
  buf: (string | null)[]
  /** Besitzer je Pixel: 'body' | 'armL' | 'armR' | 'prop:<name>' | null (für Maus und Prüfung). */
  hit: (string | null)[]
}

const scaled = new Map<string, PropSprite | undefined>()
/**
 * Requisite nach Namen. `name@NN` ist dieselbe Requisite auf NN % verkleinert (nächster Nachbar): So wächst ein Gegenstand aus der
 * Tasche heraus und schrumpft beim Wegpacken wieder hinein (Fynn: "der Laptop wird kleiner und verschwindet").
 */
export function propSprite(props: PropTable, name: string): PropSprite | undefined {
  const at = name.indexOf('@')
  if (at < 0) return props[name]
  const key = name
  if (scaled.has(key)) return scaled.get(key)
  const src = props[name.slice(0, at)]
  const f = Number(name.slice(at + 1)) / 100
  let out: PropSprite | undefined
  if (src && f > 0) {
    const h = src.rows.length
    const w = Math.max(...src.rows.map((r) => r.length))
    const nh = Math.max(1, Math.round(h * f))
    const nw = Math.max(1, Math.round(w * f))
    const rows: string[] = []
    for (let j = 0; j < nh; j++) {
      let row = ''
      for (let i = 0; i < nw; i++) row += src.rows[Math.floor(((j + 0.5) * h) / nh)][Math.floor(((i + 0.5) * w) / nw)] ?? '.'
      rows.push(row)
    }
    out = { rows, ...(src.effect ? { effect: true as const } : {}), ...(src.noFlip ? { noFlip: true as const } : {}) }
  }
  scaled.set(key, out)
  return out
}

/** Pose → Pixelpuffer (+ Trefferkarte). Alles außerhalb der Bühne, auch unter der Linie, wird abgeschnitten. */
export function compose(p: Pose, props: PropTable): Composed {
  const buf: (string | null)[] = new Array(W * H).fill(null)
  const hit: (string | null)[] = new Array(W * H).fill(null)
  const ox = FX + Math.round(p.fx)
  const oy = FY + Math.round(p.fy)
  const top = p.by + p.squash
  const bot = 7 + p.by
  // Spiegeln um die Mitte der Figur (Spalte ox+8); linker und rechter Arm tauschen dabei ihre Trefferkennung.
  const mx = (x: number) => (p.mirror ? 2 * (ox + 8) - x : x)
  const mt = (tag: string | null) => (p.mirror && tag === 'armL' ? 'armR' : p.mirror && tag === 'armR' ? 'armL' : tag)
  const set = (x0: number, y: number, c: string | undefined, tag: string | null) => {
    const x = mx(x0)
    if (x < 0 || y < 0 || x >= W || y >= H || !c) return
    buf[y * W + x] = c
    if (tag) hit[y * W + x] = mt(tag)
  }
  const eyePx = new Set<number>()
  for (const [x, y] of LEGS[p.legs] || []) set(ox + x, oy + y, 'O', 'body')
  for (let y = top; y <= bot; y++) for (let x = 2; x <= 14; x++) set(ox + x, oy + y, 'O', 'body')
  const sideArm = (spec: ArmSpec, right: boolean) => {
    const tag = right ? 'armR' : 'armL'
    if (typeof spec === 'object') {
      if ('to' in spec) return stretchArm(spec.to, right, top, ox, oy, set)
      // Blockarm: Rechteck am Körperrand (Körper Spalte 2–14), `out` Pixel nach außen
      for (let j = 0; j < (spec.h ?? 2); j++) {
        for (let i = 0; i < spec.out; i++) set(ox + (right ? 14 + 1 + i : 1 - i), oy + top + spec.y + j, 'O', tag)
      }
      return
    }
    const pts = ARMS[spec]
    if (!pts) return
    for (const [x, y] of pts) set(ox + (right ? 16 - x : x), oy + top + y, 'O', tag)
  }
  sideArm(p.armL, false)
  sideArm(p.armR, true)
  if (!p.back) {
    // Seitlicher Blick höchstens 1 Pixel: Die Pupille bleibt eine Spalte vom Körperrand weg (Fynn: vor dunklem Hintergrund
    // wirkt ein Auge am Rand wie abgeschnitten).
    const lk = LOOKABLE_EYES.has(p.eyes) ? [Math.max(-1, Math.min(1, p.look[0])), p.look[1]] : [0, 0]
    const one = EYES_ONE[p.eyes]
    const fc = Math.round(p.face ?? 0)
    const drawEye = (name: string, right: boolean) => {
      for (const [dx, dy] of EYES[name] || []) {
        const x = (right ? 12 - dx : 4 + dx) + fc
        set(ox + x + lk[0], oy + top + 2 + dy + lk[1], 'K', null)
        eyePx.add((oy + top + 2 + dy + lk[1]) * W + mx(ox + x + lk[0]))
      }
    }
    if (one) {
      drawEye(one.left, false)
      drawEye(one.right, true)
    } else {
      drawEye(p.eyes, false)
      drawEye(p.eyes, true)
    }
    // Kein Mund (Fynn: ohne wirkt er stimmiger als mit einem, der zwischendurch auftaucht). `mouth` bleibt in den Clips stehen,
    // wird aber nicht gezeichnet; die Formen in MOUTH bleiben für eine spätere Wiederaufnahme.
    if (p.blush) {
      set(ox + 3 + fc, oy + top + 4, 'P', null)
      set(ox + 13 + fc, oy + top + 4, 'P', null)
    }
  }
  for (const pr of p.props) {
    const [name, px, py, flag] = pr
    const s = propSprite(props, name)
    if (!s) continue
    const bx = flag ? FX + px : ox + px
    const by = flag ? FY + py : oy + py + p.by
    // 'G': fest auf der Bühne, wird beim Spiegeln nicht mitgespiegelt (Begleiter der Subagenten bleiben links)
    const put = flag === 'G' && p.mirror ? (x: number, y: number, c: string, tag: string) => set(mx(x), y, c, tag) : set
    // Nicht spiegelbar (Schrift, Zeichen, Uhren): gespiegelt wird nur die Lage, die Spalten laufen rückwärts, damit das Bild gleich bleibt
    const keep = !!s.noFlip && !!p.mirror && flag !== 'G'
    const rows = p.mirror && flag !== 'G' && s.mirrorRows ? s.mirrorRows : s.rows
    const w = Math.max(...rows.map((r) => r.length))
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] !== '.') put(keep ? bx + w - 1 - rx : bx + rx, by + ry, row[rx], 'prop:' + name)
    })
  }
  // Hände vor dem Körper gehen nie über die Augen (Fynn), außer beim Augenreiben (rub*), wo genau das gemeint ist: Berührt ein Vorderarm
  // ein Auge (auch nur daneben oder darunter), rutscht er als Ganzes bis zu 3 Pixel nach unten; nur wenn das nicht reicht, bleibt dort eine Lücke.
  const touchesEye = (x: number, y: number): boolean =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => eyePx.has((y + dy) * W + mx(x + dx)))
  const frontArm = (spec: ArmSpec, right: boolean) => {
    const tag = right ? 'armR' : 'armL'
    let pts: (readonly [number, number])[]
    if (spec === 'cross') pts = (right ? CROSS_R : CROSS_L).map(([x, y]) => [ox + x, oy + top + y] as const)
    else if (typeof spec === 'object' || !FRONT[spec]) return
    else pts = FRONT[spec].map(([x, y]) => [ox + (right ? 16 - x : x), oy + top + y] as const)
    if (typeof spec === 'string' && spec.startsWith('rub')) {
      for (const [x, y] of pts) set(x, y, 'Q', tag)
      return
    }
    let shift = 0
    while (shift < 3 && pts.some(([x, y]) => touchesEye(x, y + shift))) shift++
    for (const [x, y] of pts) if (!eyePx.has((y + shift) * W + mx(x))) set(x, y + shift, 'Q', tag)
  }
  frontArm(p.armL, false)
  frontArm(p.armR, true)
  return { buf, hit }
}

/** Gestreckter Arm: Schulter → Ziel (Figurkoordinaten), 2 Pixel dick, Länge höchstens 9. */
function stretchArm(
  to: readonly [number, number],
  right: boolean,
  top: number,
  ox: number,
  oy: number,
  set: (x: number, y: number, c: string | undefined, tag: string | null) => void,
) {
  const sx = right ? 15 : 1
  const sy = top + 4.5
  // Kurz halten (Fynn: lange Arme wirken unrealistisch) und kaum nach unten greifen.
  let dx = to[0] - sx
  let dy = Math.min(2, to[1] - sy)
  const len = Math.hypot(dx, dy) || 1
  const max = 5
  if (len > max) {
    dx = (dx / len) * max
    dy = (dy / len) * max
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)))
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(sx + (dx * i) / steps)
    const y = Math.round(sy + (dy * i) / steps - 0.5)
    set(ox + x, oy + y, 'O', right ? 'armR' : 'armL')
    set(ox + x, oy + y + 1, 'O', right ? 'armR' : 'armL')
  }
}
