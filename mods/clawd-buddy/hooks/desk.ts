// clawd-buddy: Antrieb für die Desktop-App (rein, kein `$`).
//
// In der Desktop-App lädt der Client-Rahmen nicht (SPEC → Offene Punkte); ein `Svg` aus dem Hooks-Modul aber schon. Darum läuft die
// Engine dort im Hooks-Modul. Sie zeichnet nicht mehr je Bild neu (0.4.2): Jede Neuzeichnung des Bands lässt die Desktop-App auch die
// Zeilen neu anfordern, die andere Mods hooken (sidekick: UserMessage), und deren Hover-Leiste flackerte (Fynn, 2026-10-06). Stattdessen
// rechnet `plan` die nächsten Sekunden voraus und liefert sie als ein SVG mit SMIL-Animation, das der Desktop als Bild zeichnet
// (SvgProps ohne `isInteractive`, types:11934-11935, 11956-11957). Der Stand der Engine bleibt dabei unverändert
// (Schnappschuss samt Zufall). `draw` zieht ihn beim nächsten Zeichnen nach dem Zeitplan der gezeigten Animation auf die Uhrzeit nach,
// gibt also genau das Gezeigte wieder, und rechnet erst ab da mit den neuen Fakten weiter: Ein Ereignis wirkt ab seiner Zeichnung, nie rückwirkend.
//
// Bild statt Rahmen (0.6.6, Fynn: `/clawd flicker` blinkt in allen drei Abschnitten): Bis 0.6.5 lief das SVG mit `isInteractive` in einem
// Rahmen ohne Skripte. Ein neues `source` lädt den Rahmen neu, er ist dabei ~50 ms leer (gemessen im Chromium der App), und die App lud
// beim Wechsel auch den unveränderten zweiten Rahmen neu: Die Staffelübergabe aus 0.6.3 half nicht. Ein Bild zeigt beim Tausch das alte, bis
// das neue fertig ist (gemessen: kein leerer Moment). Eine neue Animation gilt darum sofort. SMIL läuft auch im Bild der App, obwohl die
// Typen es nur beim Rahmen nennen (types:11956-11957): Desktop-Abnahme durch Fynn am 2026-10-07 (SPEC, Nachtrag 0.6.6).
// Der Zeitplan (`segs`, `acts`) bleibt in der Form aus 0.6.3: Seit 0.6.6 hat er nach jeder Zeichnung genau einen Abschnitt und keine
// ausstehenden Eingriffe, das Nachziehen läuft also mit den Fakten der gezeigten Animation.
//
// Das Bild ist in senkrechte Kacheln geteilt, jede mit eigener Zeitliste: Begleiter, die nebeneinander blinzeln und werkeln, ergäben
// als Ganzes sonst so viele verschiedene Bilder, dass die Animation nur wenige Sekunden fassen könnte.
import { createEngine } from './engine.ts'
import type { Engine } from './engine.ts'
import { seededRng } from './capture.ts'
import { ALL_CLIPS, ALL_PROPS } from './library.ts'
import { WELCOME_WINDOW_MS, activeAgents, deriveMood, deriveTemper, specialDay } from './mood.ts'
import type { Facts, Strain } from './mood.ts'
import { H, PAL, POSES, TICK, W, compose } from './stage.ts'

export type DeskOpts = { seed: number; nightStart: number; nightEnd: number; idleSeconds: number; reduced: boolean; flip: boolean; birthday?: string }

export type Plan = {
  /** SVG-Dokument; das erste Bild ist auch ohne SMIL sichtbar. */
  source: string
  /** Länge der Animation in Takten; danach bleibt das letzte Bild stehen. */
  ticks: number
  /** Kachelbilder darin und Takte, an denen sich etwas ändert. */
  frames: number
  changes: number
}

/** Eingriff per `/clawd`: Clip vorführen, Nickerchen, anstupsen. */
export type Act = { play: string } | 'nap' | 'boop'

export type Desk = {
  engine: Engine
  /**
   * Zeichnen zur Uhrzeit `now` (ms): Stand nach dem Zeitplan der gezeigten Animation nachziehen, dann ab da mit den neuen Fakten
   * vorausrechnen (Pixel = `scale` CSS-Pixel). Neues und vorgemerkte Eingriffe gelten sofort; die neuen Fakten gelten danach als gezeigt.
   */
  draw: (now: number, facts: Facts, strain: Strain, scale: number) => Plan
  /** Stand auf `now` nachziehen, so wie die gezeigte Animation lief. */
  catchUp: (now: number) => void
  /** Eingriff für die nächste Zeichnung vormerken; er wirkt ab ihr. */
  request: (a: Act) => void
  /** Stand bis `now` nachziehen, Takt für Takt, mit festen Fakten; liefert die Zahl der Takte. Der erste Aufruf setzt nur die Uhr. */
  advance: (now: number, facts: Facts, strain: Strain) => number
  /** Die nächsten Takte ab dem Stand als animiertes SVG, mit festen Fakten; der Stand selbst bleibt, wie er ist. */
  plan: (facts: Facts, strain: Strain, scale: number) => Plan
  /**
   * Ab wann (ms nach `now`) zeigten die Fakten `facts` etwas anderes als die gezeigte Animation (Stimmung oder Zahl der Helfer)?
   * `Infinity`: bis zu ihrem Ende nichts; 0: sofort (noch nichts gezeigt, oder Fynn ist eben zurückgekommen).
   */
  divergence: (now: number, facts: Facts, strain: Strain) => number
  /** Wie lange (ms ab `now`) die gezeigte Animation noch läuft. */
  remaining: (now: number) => number
}

const NAP_TICKS = 3000 // 5 Minuten
export const PLAN_TICKS = 400 // höchstens 30 s je Animation
export const PLAN_CHARS = 85_000 // Bilder je Animation; Rest für Zeitlisten und Rahmen
export const SOURCE_MAX = 131_072 // Svg.source höchstens (types:11939)
const CATCH_UP = 2400 // höchstens 3 min nachziehen; länger verdeckt: die Zeit davor wird übersprungen
const TILE = 10 // Kachelbreite in Bühnenpixeln
const TILES = Math.ceil(W / TILE)

type Shown = { id: number; from: number } // ab Takt `from` steht Kachelbild `id`
/** Fakten für die Takte bis einschließlich Zählerstand `until` (D.n nach dem Takt). */
type Seg = { until: number; facts: Facts; strain: Strain }
/** Eingriff, der wirkt, sobald der Zählerstand `at` erreicht ist (vor dem Bild dazu). */
type At = { at: number; act: Act }

const hourOf = (ms: number): number => {
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60
}

export function createDesk(o: DeskOpts): Desk {
  const rnd = seededRng(o.seed)
  const engine = createEngine({
    clips: ALL_CLIPS, props: ALL_PROPS, rng: rnd.next, nightStart: o.nightStart, nightEnd: o.nightEnd,
    idleSeconds: o.idleSeconds, reduced: o.reduced,
  })
  // Zustand des Antriebs (neben der Engine); `at` = Uhrzeit des Stands, -1 = noch keiner
  let D = { n: 0, mood: '', napUntil: -1, seenBack: 0, at: -1 }
  let drawn: { facts: Facts; strain: Strain; at: number; ticks: number } | null = null // zuletzt gezeigte Animation: Fakten, Beginn, Länge
  let segs: Seg[] = [] // Zeitplan der gezeigten Animation (leer: noch keine)
  let acts: At[] = []
  let queued: Act[] = [] // vorgemerkt für die nächste Zeichnung
  engine.start()

  function tick(now: number, facts: Facts, strain: Strain) {
    if (D.n === D.napUntil) engine.set({ nightStart: o.nightStart, nightEnd: o.nightEnd, idleSeconds: o.idleSeconds })
    if (D.n % 50 === 0 && D.n >= D.napUntil) engine.set({ hour: hourOf(now), special: specialDay(now, o.birthday ?? '') })
    if (D.n % 10 === 0) {
      const t = deriveTemper(strain, now)
      engine.set({ temper: t.temper, tired: t.tired })
    }
    D.n++
    const back = facts.backAt ?? 0
    if (back !== D.seenBack) {
      D.seenBack = back
      if (back && now - back < WELCOME_WINDOW_MS) engine.welcome()
    }
    engine.set({ agents: activeAgents(facts, now) })
    const m = deriveMood(facts, now)
    if (m !== D.mood) {
      D.mood = m
      engine.setMood(m)
    }
    engine.tick()
  }

  function apply(a: Act) {
    if (a === 'nap') {
      // Eine Weile Nacht und kurzer Leerlauf, damit er einschläft
      D.napUntil = D.n + NAP_TICKS
      engine.set({ hour: 23.5, nightStart: 22, nightEnd: 7, idleSeconds: 1 })
    } else if (a === 'boop') engine.click()
    else engine.play(a.play)
    // `simulate` zeichnet gleich danach; das Zeichnen kann Zufall verbrauchen (Blinzeln). Hier ebenso, damit das Nachziehen gleich läuft
    // (Review 0.6.3, K9)
    engine.render()
  }

  const segAt = (n: number): Seg => segs.find((x) => x.until >= n) ?? segs[segs.length - 1]
  /** Ein Takt nach dem Zeitplan, danach die Eingriffe, die mit ihm fällig werden. */
  function step(at: number) {
    const g = segAt(D.n + 1)
    tick(at, g.facts, g.strain)
    for (const x of acts) if (x.at === D.n) apply(x.act)
  }

  const frame = (): string[] => tilesOf(engine.render().buf, o.flip)

  function advanceBy(now: number, one: (at: number) => void): number {
    if (D.at < 0 || now - D.at > CATCH_UP * TICK) D.at = D.at < 0 ? now : now - CATCH_UP * TICK
    let k = 0
    while (now - D.at >= TICK) {
      D.at += TICK
      one(D.at)
      k++
    }
    return k
  }

  const advance = (now: number, facts: Facts, strain: Strain): number => advanceBy(now, (at) => tick(at, facts, strain))

  /** Nachziehen nach dem Zeitplan der gezeigten Animation; erledigte Eingriffe fallen heraus. */
  function follow(now: number) {
    advanceBy(now, step)
    acts = acts.filter((x) => x.at > D.n)
  }

  const save = () => ({ e: engine.save(), d: { ...D }, a: rnd.a })
  function load(snap: ReturnType<typeof save>) {
    engine.restore(snap.e)
    D = snap.d
    rnd.a = snap.a
  }

  /** Die nächsten Takte nach dem Zeitplan als animiertes SVG; der Stand selbst bleibt, wie er ist. */
  function simulate(scale: number): Plan {
    const snap = save()
    const ids = Array.from({ length: TILES }, () => new Map<string, number>()) // Kachelbild → Nummer
    const bodies: string[][] = Array.from({ length: TILES }, () => [])
    const shown: Shown[][] = Array.from({ length: TILES }, () => [])
    let chars = 0
    let ticks = 0
    const at = Math.max(D.at, 0)
    for (let i = 0; i <= PLAN_TICKS; i++) {
      if (i > 0) step(at + i * TICK)
      else for (const x of acts) if (x.at === D.n) apply(x.act)
      const f = frame()
      // Platz reicht nicht mehr für die neuen Kachelbilder: die Animation endet vor diesem Takt (der erste passt immer)
      const fresh = f.reduce((n, body, t) => n + (ids[t].has(body) ? 0 : body.length), 0)
      if (i > 0 && chars + fresh > PLAN_CHARS) break
      chars += fresh
      f.forEach((body, t) => {
        let id = ids[t].get(body)
        if (id === undefined) {
          id = bodies[t].length
          ids[t].set(body, id)
          bodies[t].push(body)
        }
        const s = shown[t]
        if (!s.length || s[s.length - 1].id !== id) s.push({ id, from: i })
      })
      ticks = i
    }
    load(snap)
    // Zu lang (viele Wechsel verlängern die Zeitlisten): die Animation halbieren, bis sie passt; ein einzelnes Bild passt immer
    let p = build(bodies, shown, Math.max(ticks, 1), scale)
    while (p.source.length > SOURCE_MAX && p.ticks > 1) {
      const half = Math.floor(p.ticks / 2)
      p = build(bodies, shown.map((s) => s.filter((x) => x.from < half)), half, scale)
    }
    return p
  }

  function plan(facts: Facts, strain: Strain, scale: number): Plan {
    const keep = { segs, acts }
    segs = [{ until: Infinity, facts, strain }]
    acts = []
    const p = simulate(scale)
    segs = keep.segs
    acts = keep.acts
    return p
  }

  /** Neu zeichnen: nachziehen, Zeitplan fortschreiben, vorausrechnen, Fälliges anwenden. */
  function redraw(now: number, facts: Facts, strain: Strain, scale: number): Plan {
    if (segs.length) follow(now)
    else advance(now, facts, strain)
    const n = D.n
    // Neue Fakten und vorgemerkte Eingriffe gelten ab jetzt
    segs = [{ until: Infinity, facts, strain }]
    acts = queued.map((act) => ({ at: n, act }))
    queued = []
    const p = simulate(scale)
    for (const x of acts) if (x.at === n) apply(x.act)
    acts = acts.filter((x) => x.at > n)
    drawn = { facts, strain, at: now, ticks: p.ticks }
    return p
  }

  return {
    engine,
    advance,
    plan,
    draw: redraw,
    catchUp(now) {
      if (segs.length) follow(now)
    },
    request(a) {
      queued.push(a)
    },
    divergence(now, facts, strainNow) {
      if (!drawn || (facts.backAt ?? 0) !== (drawn.facts.backAt ?? 0)) return 0
      // Die Laune (Gewichte der Clips) ist mit den Fakten gezeichnet; hat sie sich geändert, gleich neu (Review 2, K1)
      if (strainNow !== drawn.strain) return 0
      const end = drawn.at + drawn.ticks * TICK
      for (let t = now; t <= end; t += TICK) {
        if (deriveMood(facts, t) !== deriveMood(drawn.facts, t) || activeAgents(facts, t) !== activeAgents(drawn.facts, t)) return t - now
      }
      return Infinity
    },
    remaining(now) {
      return drawn ? Math.max(0, drawn.at + drawn.ticks * TICK - now) : 0
    },
  }
}

// Nur für den Rahmen (isInteractive, im Betrieb seit 0.6.6 nicht mehr, nur in Abschnitt 2 von `/clawd flicker`); im Bild wirkungslos.
// Der Rahmen bekäme sonst einen weißen Grund: Chromium hinterlegt einen Rahmen deckend, wenn dessen Farbschema
// (ohne Angabe hell) nicht zu dem der Seite passt, im Dark Mode also immer. `light dark` übernimmt das Schema der Seite.
// Bettet der Rahmen das SVG in ein HTML-Dokument ein, hätte `body` 8 px Rand: das Bild rutschte nach rechts unten aus dem Kasten und
// würde dort abgeschnitten. Ohne HTML-Hülle treffen die Regeln nichts.
const CSS = ':root{color-scheme:light dark}html,body{margin:0;padding:0;overflow:hidden}body>svg{display:block}'
const head = (scale: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges"><style>${CSS}</style>`

/** Das Bild als Pfade je Kachel und Farbe; waagerechte Läufe gleicher Farbe werden Rechtecke (an Kachelgrenzen geteilt). */
function tilesOf(buf: readonly (string | null)[], flip: boolean): string[] {
  const runs: Map<string, string>[] = Array.from({ length: TILES }, () => new Map())
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
      let a = flip ? W - e : x
      const b = a + e - x
      while (a < b) {
        const t = Math.floor(a / TILE)
        const end = Math.min(b, (t + 1) * TILE)
        runs[t].set(c, `${runs[t].get(c) ?? ''}M${a} ${y}h${end - a}v1h-${end - a}z`)
        a = end
      }
      x = e
    }
  }
  return runs.map((m) => {
    let out = ''
    for (const [c, d] of m) out += `<path fill="${PAL[c]}" d="${d}"/>`
    return out
  })
}

// Ziffern 3 × 5 für die Testbilder (Zeilen von oben, je 3 Bit)
const DIGITS: Record<number, number[]> = { 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7] }
const GRAY = '#8a8a8a'

/**
 * Testbild für `/clawd flicker`: Clawd steht still, oben links die Nummer des Abschnitts. `nonce` ändert nur ein unsichtbares Rechteck:
 * gleiches Bild, anderes `source`. Rechts neben der Nummer blinkt ein Punkt per SMIL (an/aus je 0,5 s): Blinkt er, läuft SMIL in dieser
 * Darstellung.
 */
export function stillSource(scale: number, flip: boolean, digit: number, nonce: number): string {
  const body = tilesOf(compose({ ...POSES.stand }, ALL_PROPS).buf, flip).join('')
  let d = ''
  ;(DIGITS[digit] ?? []).forEach((bits, y) => {
    for (let x = 0; x < 3; x++) if (bits & (4 >> x)) d += `M${1 + x} ${1 + y}h1v1h-1z`
  })
  const pulse = `<path fill="${GRAY}" d="M6 3h2v2h-2z"><animate attributeName="visibility" calcMode="discrete" dur="1s" repeatCount="indefinite" values="visible;hidden" keyTimes="0;0.5"/></path>`
  return `${head(scale)}<rect x="${nonce % 1000}" y="0" width="0" height="0"/><path fill="${GRAY}" d="${d}"/>${pulse}${body}</svg>`
}

/** SVG mit SMIL aus den Abfolgen je Kachel (Takt 0 bis `ticks`); nur die darin gezeigten, nicht leeren Kachelbilder kommen hinein. */
function build(bodies: readonly string[][], shown: readonly Shown[][], ticks: number, scale: number): Plan {
  const dur = `${((ticks * TICK) / 1000).toFixed(3)}s`
  const kt = (i: number) => String(+(i / ticks).toFixed(5))
  let groups = ''
  let frames = 0
  const changeAt = new Set<number>()
  shown.forEach((seq, t) => {
    for (const s of seq) if (s.from > 0) changeAt.add(s.from)
    for (const id of new Set(seq.map((s) => s.id))) {
      if (!bodies[t][id]) continue
      frames++
      // Sichtbar ab jedem Abschnitt dieses Bilds, verborgen ab dem nächsten anderen; das letzte bleibt am Ende stehen.
      // Der erste Abschnitt beginnt bei Takt 0, also beginnt auch jede Liste dort.
      const keys: [number, 'visible' | 'hidden'][] = []
      for (const s of seq) {
        const vis = s.id === id ? 'visible' : 'hidden'
        if (!keys.length || keys[keys.length - 1][1] !== vis) keys.push([s.from, vis])
      }
      const anim = keys.length > 1
        ? `<animate attributeName="visibility" calcMode="discrete" dur="${dur}" fill="freeze" values="${keys.map((k) => k[1]).join(';')}" keyTimes="${keys.map((k) => kt(k[0])).join(';')}"/>`
        : ''
      groups += `<g visibility="${keys[0][1]}">${anim}${bodies[t][id]}</g>`
    }
  })
  return { source: `${head(scale)}${groups}</svg>`, ticks, frames, changes: changeAt.size }
}

export const DESK_TICK = TICK
