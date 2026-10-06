// clawd-buddy: Clips mit der echten Engine abspielen und jedes Bild aufnehmen (reine Funktionen, nur für Tests und Werkzeuge).
import { createEngine } from './engine.ts'
import type { ClipDef } from './clipdef.ts'
import type { PropTable } from './stage.ts'
import type { Shot } from './lint.ts'

/** Kleiner deterministischer Zufallsgenerator (Seed → Folge in [0,1)). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Library = { clips: readonly ClipDef[]; props: PropTable }
export type CapturedShot = Shot & { clip: string; phase: string; tick: number }

const IDLE = new Set(['idle_breathe', 'idle_look'])

export const newEngine = (lib: Library, seed = 1, extra: { hour?: number; idleSeconds?: number } = {}) =>
  createEngine({ clips: lib.clips, props: lib.props, rng: mulberry32(seed), hour: 12, ...extra })

/**
 * Einen Clip abspielen: vorher ein paar Ruhebilder, dann der Clip (Schleifen `loops`-mal), danach zurück in die Ruhe.
 * `from`: optional ein Clip, der vorher läuft (um Übergänge aus einer anderen Ausgangspose zu sehen).
 */
export function captureClip(
  lib: Library,
  name: string,
  o: { seed?: number; loops?: number; maxTicks?: number; hour?: number; from?: string | null } = {},
): CapturedShot[] {
  const { seed = 1, loops = 2, maxTicks = 2500, hour = 12, from = null } = o
  const e = newEngine(lib, seed, { hour })
  e.start()
  for (let i = 0; i < 4; i++) e.tick()
  if (from) {
    e.play(from)
    for (let i = 0; i < 600 && (e.S.gallery || !IDLE.has(e.S.play?.clip.name ?? '')); i++) e.tick()
  }
  const frames: CapturedShot[] = []
  const rec = () => {
    const c = e.render()
    const pl = e.S.play
    frames.push({ buf: c.buf, hit: c.hit, pose: e.pose(), clip: pl?.clip.name ?? '', phase: pl?.phase ?? '', tick: e.S.ticks })
  }
  // Begleiter-Clips (Interaktion mit einem Subagenten): vorher läuft ein Subagent, sein Helfer steigt auf; danach endet er, der Helfer sinkt ab
  const comp = lib.clips.find((c) => c.name === name)?.companion === true
  if (comp) e.set({ agents: 1 })
  for (let i = 0; i < (comp ? 10 : 3); i++) {
    rec()
    e.tick()
  }
  e.play(name)
  let seen = false
  let wraps = 0
  let lastFi = -1
  let released = false
  let idleRun = 0
  for (let i = 0; i < maxTicks; i++) {
    rec()
    const pl = e.S.play
    if (pl && pl.clip.name === name) seen = true
    if (comp && seen && (released || (pl && pl.clip.name !== name))) e.set({ agents: 0 })
    if (pl && pl.clip.name === name && pl.phase === 'body') {
      if (pl.fi < lastFi) wraps++
      lastFi = pl.fi
      if (wraps >= loops - 1 && !released && pl.clip.loop) {
        released = true
        e.S.gallery = null
      }
    }
    e.tick()
    const cur = e.S.play
    if (!e.S.gallery && cur && IDLE.has(cur.clip.name) && !e.S.queue.length) idleRun++
    else idleRun = 0
    if (idleRun >= 6 && !e.S.mates.length) break
  }
  rec() // Abschlussbild nach dem letzten Takt (z. B. Begleiter ganz abgesunken)
  return frames
}
