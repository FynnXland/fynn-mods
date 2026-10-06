// clawd-buddy: Antrieb für die Desktop-App (rein, kein `$`).
//
// In der Desktop-App lädt der Client-Rahmen nicht (SPEC → Offene Punkte), ein statisches `Svg` und ein Takt aus dem Hooks-Modul
// (`$.clock.every` + `$.ui.invalidate`) aber schon (Sondierung 2, 9,5 Neuzeichnungen/s gemessen). Darum läuft die Engine dort im
// Hooks-Modul: register.ts ruft je Takt `tick`, beim Zeichnen `svg`. Die Figur ist ein Bild (SvgProps: ohne `isInteractive` ein Bild,
// types:11547): deckend, auf durchsichtigem Grund, ohne Mausereignisse.
import { createEngine } from './engine.ts'
import type { Engine } from './engine.ts'
import { mulberry32 } from './capture.ts'
import { ALL_CLIPS, ALL_PROPS } from './library.ts'
import { WELCOME_WINDOW_MS, activeAgents, deriveMood, deriveTemper, specialDay } from './mood.ts'
import type { Facts, Strain } from './mood.ts'
import { H, PAL, TICK, W } from './stage.ts'

export type DeskOpts = { seed: number; nightStart: number; nightEnd: number; idleSeconds: number; reduced: boolean; flip: boolean; birthday?: string }

export type Desk = {
  engine: Engine
  /** Ein Bild weiter; `now` = Uhrzeit (ms). */
  tick: (now: number, facts: Facts, strain: Strain) => void
  /** Aktuelles Bild als SVG-Dokument (Pixel = `scale` CSS-Pixel). */
  svg: (scale: number) => string
  /** `/clawd nap`: eine Weile Nacht und kurzer Leerlauf, damit er einschläft. */
  nap: () => void
}

const NAP_TICKS = 3000 // 5 Minuten

const hourOf = (ms: number): number => {
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60
}

export function createDesk(o: DeskOpts): Desk {
  const engine = createEngine({
    clips: ALL_CLIPS, props: ALL_PROPS, rng: mulberry32(o.seed), nightStart: o.nightStart, nightEnd: o.nightEnd,
    idleSeconds: o.idleSeconds, reduced: o.reduced,
  })
  let n = 0
  let mood = ''
  let napUntil = -1
  let seenBack = 0
  engine.start()
  return {
    engine,
    nap() {
      napUntil = n + NAP_TICKS
      engine.set({ hour: 23.5, nightStart: 22, nightEnd: 7, idleSeconds: 1 })
    },
    tick(now, facts, strain) {
      if (n === napUntil) engine.set({ nightStart: o.nightStart, nightEnd: o.nightEnd, idleSeconds: o.idleSeconds })
      if (n % 50 === 0 && n >= napUntil) engine.set({ hour: hourOf(now), special: specialDay(now, o.birthday ?? '') })
      if (n % 10 === 0) {
        const t = deriveTemper(strain, now)
        engine.set({ temper: t.temper, tired: t.tired })
      }
      n++
      const back = facts.backAt ?? 0
      if (back !== seenBack) {
        seenBack = back
        if (back && now - back < WELCOME_WINDOW_MS) engine.welcome()
      }
      engine.set({ agents: activeAgents(facts, now) })
      const m = deriveMood(facts, now)
      if (m !== mood) {
        mood = m
        engine.setMood(m)
      }
      engine.tick()
    },
    svg(scale) {
      const { buf } = engine.render()
      // Waagerechte Läufe gleicher Farbe zu einem Rechteck zusammenfassen (kleines Dokument)
      let rects = ''
      for (let y = 0; y < H; y++) {
        let x = 0
        while (x < W) {
          const c = buf[y * W + x]
          if (!c) {
            x++
            continue
          }
          let e = x + 1
          while (e < W && buf[y * W + e] === c) e++
          const rx = o.flip ? W - e : x
          rects += `<rect x="${rx}" y="${y}" width="${e - x}" height="1" fill="${PAL[c]}"/>`
          x = e
        }
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges">${rects}</svg>`
    },
  }
}

export const DESK_TICK = TICK
