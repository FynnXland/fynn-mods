// clawd-buddy: Prüfung "nichts taucht aus dem Nichts auf" (reine Funktion, nur für Tests und Werkzeuge; der Mod lädt sie nicht).
//
// Fynn: "dass es sich immer von irgendwo genommen wird oder es kommt von irgendwo". Aus aufgenommenen Bildern (siehe capture.ts)
// werden je Requisite zusammenhängende Pixelgruppen ("Komponenten") gebildet und von Bild zu Bild verfolgt (gleiche Familie,
// nächster Schwerpunkt, höchstens MAX_STEP Pixel). Eine neue Komponente (Spawn) bzw. eine verschwundene (Vanish) ist nur erlaubt, wenn sie
//   - am Bühnenrand ABGESCHNITTEN ist (unten = hinter der Linie hervor bzw. dahinter weg; links/rechts/oben ebenso), oder
//   - ein kleiner Effekt (`effect` in props.ts: Funkeln, Note, Herz, Schweiß …) nahe an der Figur ist.
// Die Hand allein genügt nicht: Sie darf nur halten, was vorher irgendwo herkam. Außerdem werden Ruckler der Figur (> 2 px pro Tick)
// und am Ende noch herumliegende Gegenstände gemeldet.
//
// Fynn (Runde 4): Rein und raus nur nach UNTEN. Der linke, rechte und obere Bühnenrand sind kein Ein- oder Ausgang; ein Gegenstand,
// Effekt oder die Figur, die dort abgeschnitten wird, ist ein Fehler ("am Rand abgeschnitten"). Gegenstände aus der Tasche erscheinen
// verkleinert (`name@NN`) an der Hand und wachsen dann; beim Wegpacken schrumpfen sie dort wieder (erlaubt, wenn klein und an der Hand).
import { H, W, propSprite } from './stage.ts'
import type { Composed, Pose, PropTable } from './stage.ts'

export type Shot = Composed & { pose: Pose }
export type Issue = { kind: string; frame: number; name: string; x: number; y: number }

const MAX_STEP = 8
const EFFECT_NEAR = 6
const POCKET_MAX = 6
const family = (n: string): string => n.replace(/@\d+$/, '').replace(/(\d|Flip|Hi)$/, '')

type Comp = {
  name: string
  pixels: number[]
  cx: number
  cy: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  effect: boolean
  total: number
  pocket: boolean
}

function components(frame: Shot, props: PropTable): Comp[] {
  const byName = new Map<string, number[]>()
  frame.hit.forEach((tag, i) => {
    if (tag && tag.startsWith('prop:')) {
      const exact = tag.slice(5)
      const list = byName.get(exact)
      if (list) list.push(i)
      else byName.set(exact, [i])
    }
  })
  const out: Comp[] = []
  for (const [exact, idxs] of byName) {
    const name = family(exact)
    const set = new Set(idxs)
    const seen = new Set<number>()
    for (const start of idxs) {
      if (seen.has(start)) continue
      const comp: number[] = []
      const stack = [start]
      seen.add(start)
      while (stack.length) {
        const i = stack.pop()!
        comp.push(i)
        const x = i % W
        const y = Math.floor(i / W)
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
            const j = ny * W + nx
            if (set.has(j) && !seen.has(j)) {
              seen.add(j)
              stack.push(j)
            }
          }
        }
      }
      const xs = comp.map((i) => i % W)
      const ys = comp.map((i) => Math.floor(i / W))
      const sprite = propSprite(props, exact)
      out.push({
        pocket: exact.includes('@'),
        name,
        pixels: comp,
        cx: xs.reduce((a, b) => a + b, 0) / comp.length,
        cy: ys.reduce((a, b) => a + b, 0) / comp.length,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        effect: Object.entries(props).some(([k, v]) => family(k) === name && v.effect === true),
        total: sprite ? sprite.rows.join('').replace(/\./g, '').length : 0,
      })
    }
  }
  return out
}

function figureSets(frame: Shot): { arm: number[]; body: number[] } {
  const arm: number[] = []
  const body: number[] = []
  frame.hit.forEach((tag, i) => {
    if (tag === 'armL' || tag === 'armR') arm.push(i)
    else if (tag === 'body') body.push(i)
  })
  return { arm, body }
}

function near(c: Comp, pts: number[], d: number): boolean {
  for (const i of pts) {
    const x = i % W
    const y = Math.floor(i / W)
    if (x >= c.minX - d && x <= c.maxX + d && y >= c.minY - d && y <= c.maxY + d) {
      for (const p of c.pixels) if (Math.max(Math.abs((p % W) - x), Math.abs(Math.floor(p / W) - y)) <= d) return true
    }
  }
  return false
}

const touchesSide = (c: Comp): boolean => c.minX <= 0 || c.maxX >= W - 1 || c.minY <= 0
const clipped = (c: Comp): boolean => c.pixels.length < c.total

/** Ein Spawn/Vanish ist erlaubt, wenn die Komponente unten abgeschnitten ist, klein aus der Tasche kommt oder ein Effekt nahe der Figur ist. */
function allowed(c: Comp, fig: { arm: number[]; body: number[] }): boolean {
  // Ein Gegenstand, der vollständig sichtbar auf der Linie steht, berührt zwar die unterste Zeile, ist aber nicht "hervorgekommen".
  if (c.maxY >= H - 1 && clipped(c)) return true
  if (c.pocket && c.pixels.length <= POCKET_MAX && near(c, fig.arm, 2)) return true
  return c.effect && (near(c, fig.body, EFFECT_NEAR) || near(c, fig.arm, EFFECT_NEAR))
}

/** Prüft eine aufgenommene Bildfolge. */
export function lintFrames(frames: readonly Shot[], props: PropTable): Issue[] {
  const issues: Issue[] = []
  let prev: Comp[] | null = null
  let prevFig: { arm: number[]; body: number[] } | null = null
  frames.forEach((f, idx) => {
    const comps = components(f, props)
    const fig = figureSets(f)
    // Seitlicher oder oberer Rand: dort darf nichts abgeschnitten werden (kein Ein-/Ausgang)
    for (const c of comps) {
      if (touchesSide(c) && clipped(c)) issues.push({ kind: 'am Rand abgeschnitten', frame: idx, name: c.name, x: Math.round(c.cx), y: Math.round(c.cy) })
    }
    for (const i of [...fig.body, ...fig.arm]) {
      const x = i % W
      if (x === 0 || x === W - 1) {
        issues.push({ kind: 'Figur am Rand', frame: idx, name: '', x, y: Math.floor(i / W) })
        break
      }
    }
    if (prev && prevFig) {
      const unmatched = new Set(prev.map((_, i) => i))
      for (const c of comps) {
        let best = -1
        let bd = Infinity
        prev.forEach((p, i) => {
          if (!unmatched.has(i) || p.name !== c.name) return
          const d = Math.hypot(p.cx - c.cx, p.cy - c.cy)
          if (d < bd) {
            bd = d
            best = i
          }
        })
        if (best >= 0 && bd <= MAX_STEP) unmatched.delete(best)
        else if (!allowed(c, fig)) issues.push({ kind: 'taucht auf', frame: idx, name: c.name, x: Math.round(c.cx), y: Math.round(c.cy) })
      }
      for (const i of unmatched) {
        const p = prev[i]
        if (!allowed(p, prevFig)) issues.push({ kind: 'verschwindet', frame: idx, name: p.name, x: Math.round(p.cx), y: Math.round(p.cy) })
      }
      const a = frames[idx - 1].pose
      const b = f.pose
      for (const k of ['fx', 'fy', 'by', 'squash'] as const) {
        if (Math.abs(a[k] - b[k]) > 2) issues.push({ kind: `Ruckler ${k}`, frame: idx, name: '', x: a[k], y: b[k] })
      }
    }
    prev = comps
    prevFig = fig
  })
  // Aufräumen: am Ende darf kein Nicht-Effekt-Gegenstand mehr im Bild liegen
  if (frames.length) {
    for (const c of components(frames[frames.length - 1], props)) {
      if (!c.effect) issues.push({ kind: 'liegt am Ende noch herum', frame: frames.length - 1, name: c.name, x: Math.round(c.cx), y: Math.round(c.cy) })
    }
  }
  return issues
}
