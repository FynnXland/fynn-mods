// clawd-buddy: Client-Modul (läuft im Zeichen-Thread, siehe types:1225-1431). Hier lebt die Animation: Engine, Bildtakt, Maus.
//
// Das Hooks-Modul reicht nur Fakten als `props` herein (mood.ts → Facts, Uhrzeit, Einstellungen). Der Client leitet daraus die
// Stimmung ab, treibt die Engine mit `surface.every(TICK)` (75 ms) und zeichnet das Bild in Halbblock-Auflösung (`▀` mit color = obere,
// backgroundColor = untere Pixelzeile, 2 Pixel pro Zelle). Keine Arbeit pro Frame außer Engine-Tick und Zeichnen; kein `setState` im Render.
import type { ClientPointerEvent, ClientSurface } from 'claude-code'
import { createEngine } from './engine.ts'
import type { Engine } from './engine.ts'
import { ALL_CLIPS, ALL_PROPS } from './library.ts'
import { WELCOME_WINDOW_MS, activeAgents, deriveMood, deriveTemper, specialDay } from './mood.ts'
import type { Facts, Strain } from './mood.ts'
import { mulberry32 } from './capture.ts'
import { H, PAL, TICK, W } from './stage.ts'

export type BuddyProps = {
  /** Spalten und Zeilen, die das Band hergibt (bodyColumns, maxRows). */
  columns: number
  maxRows: number
  /** Uhrzeit des Hooks-Moduls beim Zeichnen (ms) und Einstellungen. */
  now: number
  nightStart: number
  nightEnd: number
  idleSeconds: number
  reduced: boolean
  /** Spiegeln (Platz links im Band). */
  flip: boolean
  seed: number
  facts: Facts
  /** Geburtstag "TT.MM." (userConfig `birthday`) für besondere Tage. */
  birthday?: string
  /** Rohdaten der Laune (mood.ts → deriveTemper), auf der Uhr des Clients ausgewertet. */
  strain?: Strain
  /** `/clawd demo <clip>`, `/clawd nap`, `/clawd boop`: ein neuer Wert löst die Aktion einmal aus. */
  demo: string
  demoN: number
  napN: number
  boopN: number
  /** Ärger aus dem Speicher (nur beim Start gelesen). */
  annoy: number
}

type Ctl = {
  props: BuddyProps
  ticks: number
  /** Synchronpunkt der Uhr: Hooks-Zeit `baseNow` bei Tick `baseTick` und echter Uhr `basePerf`. */
  baseNow: number
  baseTick: number
  basePerf: number
  mood: string
  seenDemo: number
  seenNap: number
  seenBoop: number
  lastAnnoy: number
  lastHour: number
  /** /clawd nap: bis zu diesem Tick gilt Nacht mit kurzem Leerlauf (Uhr und Einstellungen greifen erst danach wieder). */
  napUntil: number
  /** Zuletzt begrüßte Rückkehr (facts.backAt). */
  seenBack: number
}
type State = { engine: Engine; ctl: Ctl; n: number }

const NAP_TICKS = 4000 // ~5 Minuten

const perfNow = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)

/** Aktuelle Zeit (ms): Basis aus dem Hooks-Modul plus Verstrichenes. Unter `ui.advance` zählt die Tickzahl, sonst die echte Uhr. */
function clockNow(c: Ctl): number {
  const byTicks = (c.ticks - c.baseTick) * TICK
  const byPerf = perfNow() - c.basePerf
  return c.baseNow + Math.max(byTicks, byPerf)
}

function hourOf(ms: number): number {
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60
}

function syncProps(c: Ctl, p: BuddyProps) {
  if (p.now !== c.props.now) {
    c.baseNow = p.now
    c.baseTick = c.ticks
    c.basePerf = perfNow()
  }
  c.props = p
}

function applyActions(st: State) {
  const c = st.ctl
  const e = st.engine
  const p = c.props
  if (p.demoN !== c.seenDemo) {
    c.seenDemo = p.demoN
    if (p.demo) e.play(p.demo)
  }
  if (p.napN !== c.seenNap) {
    c.seenNap = p.napN
    e.set({ hour: 23.5, nightStart: 22, nightEnd: 7, idleSeconds: 1 })
    c.napUntil = c.ticks + NAP_TICKS
  }
  if (p.boopN !== c.seenBoop) {
    c.seenBoop = p.boopN
    e.click()
  }
  const back = p.facts.backAt ?? 0
  if (back !== c.seenBack) {
    c.seenBack = back
    if (back && clockNow(c) - back < WELCOME_WINDOW_MS) e.welcome()
  }
  if (c.ticks >= c.napUntil) e.set({ nightStart: p.nightStart, nightEnd: p.nightEnd, idleSeconds: p.idleSeconds })
  e.set({ reduced: p.reduced })
}

function tick(surface: ClientSurface<State>) {
  const st = surface.state
  if (!st) return
  const c = st.ctl
  c.ticks++
  const now = clockNow(c)
  if (c.ticks === c.napUntil) st.engine.set({ nightStart: c.props.nightStart, nightEnd: c.props.nightEnd, idleSeconds: c.props.idleSeconds })
  if (c.ticks >= c.napUntil && (c.ticks % 50 === 1 || c.lastHour < 0 || c.ticks === c.napUntil)) {
    c.lastHour = hourOf(now)
    st.engine.set({ hour: c.lastHour, special: specialDay(now, c.props.birthday ?? '') })
  }
  if (c.ticks % 10 === 1 && c.props.strain) {
    const t = deriveTemper(c.props.strain, now)
    st.engine.set({ temper: t.temper, tired: t.tired })
  }
  st.engine.set({ agents: activeAgents(c.props.facts, now) })
  const m = deriveMood(c.props.facts, now)
  if (m !== c.mood) {
    c.mood = m
    st.engine.setMood(m)
  }
  st.engine.tick()
  surface.setState({ engine: st.engine, ctl: c, n: st.n + 1 })
}

function pointer(surface: ClientSurface<State>, ev: ClientPointerEvent) {
  const st = surface.state
  if (!st) return
  const p = st.ctl.props
  const cols = Math.min(W, p.columns)
  const rows = Math.min(H / 2, p.maxRows)
  const x0 = W - cols
  const r0 = H / 2 - rows
  const sx = p.flip ? W - 1 - ev.x : x0 + ev.x
  const sy = (ev.fine ? ev.fine.y : ev.y + 0.5) * 2 + r0 * 2
  st.engine.render() // aktuelle Trefferkarte
  st.engine.pointer(ev.type, sx, sy)
  surface.setState({ engine: st.engine, ctl: st.ctl, n: st.n + 1 })
  if (ev.type === 'up' && st.engine.S.annoy !== st.ctl.lastAnnoy) {
    st.ctl.lastAnnoy = st.engine.S.annoy
    surface.post({ k: 'stat', annoy: st.engine.S.annoy })
  }
}

/** Pixelpuffer → Halbblock-Zeilen (Text mit eingebetteten Läufen gleicher Farben). */
function drawRows(surface: ClientSurface<State>, buf: readonly (string | null)[], cols: number, rows: number, flip: boolean) {
  const { Text } = surface.elements
  const x0 = W - cols
  const r0 = H / 2 - rows
  const lines = []
  for (let r = r0; r < r0 + rows; r++) {
    const runs: { fg?: string; bg?: string; text: string }[] = []
    for (let c = 0; c < cols; c++) {
      const x = flip ? W - 1 - c : x0 + c
      const top = buf[2 * r * W + x]
      const bot = buf[(2 * r + 1) * W + x]
      let ch = ' '
      let fg: string | undefined
      let bg: string | undefined
      if (top && bot) {
        if (top === bot) {
          ch = '█'
          fg = PAL[top]
        } else {
          ch = '▀'
          fg = PAL[top]
          bg = PAL[bot]
        }
      } else if (top) {
        ch = '▀'
        fg = PAL[top]
      } else if (bot) {
        ch = '▄'
        fg = PAL[bot]
      }
      const prev = runs[runs.length - 1]
      if (prev && prev.fg === fg && prev.bg === bg) prev.text += ch
      else runs.push({ fg, bg, text: ch })
    }
    lines.push(
      Text({
        children: runs.map((run) => {
          const tp: { color?: string; backgroundColor?: string } = {}
          if (run.fg) tp.color = run.fg
          if (run.bg) tp.backgroundColor = run.bg
          return Text({ ...tp, children: [run.text] })
        }),
      }),
    )
  }
  return lines
}

export default function Buddy(props: BuddyProps, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  // Einmal starten, solange der Zustand fehlt (types:1409). Das setState hier läuft genau einmal.
  if (surface.state === undefined) {
    const engine = createEngine({
      clips: ALL_CLIPS, props: ALL_PROPS, rng: mulberry32(props.seed), hour: hourOf(props.now),
      nightStart: props.nightStart, nightEnd: props.nightEnd, idleSeconds: props.idleSeconds, reduced: props.reduced,
    })
    engine.S.annoy = props.annoy
    const ctl: Ctl = {
      props, ticks: 0, baseNow: props.now, baseTick: 0, basePerf: perfNow(), mood: 'idle',
      seenDemo: props.demoN, seenNap: props.napN, seenBoop: props.boopN, lastAnnoy: props.annoy, lastHour: -1, napUntil: -1, seenBack: 0,
    }
    engine.start()
    const st: State = { engine, ctl, n: 0 }
    surface.setState(st)
    surface.every(TICK, () => tick(surface))
    surface.onPointer((ev) => pointer(surface, ev))
    return Text({ children: [' '] })
  }
  const st = surface.state
  syncProps(st.ctl, props)
  applyActions(st)
  const cols = Math.min(W, props.columns)
  const rows = Math.min(H / 2, props.maxRows)
  if (cols < 20 || rows < 4) return Text({ children: [' '] }) // zu wenig Platz: nichts zeichnen
  const { buf } = st.engine.render()
  return Box({ flexDirection: 'column', width: cols, height: rows, children: drawRows(surface, buf, cols, rows, props.flip) })
}
