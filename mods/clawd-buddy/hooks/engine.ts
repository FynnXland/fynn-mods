// clawd-buddy: Animations-Engine (reine Zustandsmaschine, deterministisch).
//
// Kein `$`, kein DOM, keine Uhr: Zeit läuft nur über `tick()` (1 Tick = TICK ms, im Mod `surface.every(TICK)` bzw. `$.clock.every(TICK)`), Zufall über
// `opts.rng` (im Test mit festem Seed). Der Aufrufer zeichnet `engine.render()` (Pixelpuffer) und reicht Zeigerereignisse
// in Bühnenpixeln herein (Client: Zelle → Pixel).
//
// Ablauf eines Clips: intro (einmal) → frames (bei `loop` wiederholt) → outro (einmal beim Verlassen). Ein Stimmungswechsel
// wartet auf den nächsten sicheren Frame im Hauptteil, dann läuft das Outro, dann (falls nötig) Übergangsclips zur Ausgangspose
// des nächsten Clips. Nur Maus und Aufwachen unterbrechen sofort, immer über einen Reaktionsclip; Gegenstände am Boden bleiben
// dabei stehen ("Carry") und werden später ordentlich weggeräumt, nie ausgeblendet.
import { FX, FY, H, LOOKABLE_EYES, POSES, STRUCT, TICK, W, compose } from './stage.ts'
import type { Composed, Pose, PropRef, PropTable } from './stage.ts'
import { isSafe, mergeFrames, planPath, resolveClip, smooth } from './clipdef.ts'
import type { ClipDef, Resolved } from './clipdef.ts'

export type Rng = () => number

export type EngineOpts = {
  clips: readonly ClipDef[]
  props: PropTable
  rng?: Rng
  hour?: number
  nightStart?: number
  nightEnd?: number
  idleSeconds?: number
  reduced?: boolean
  onLog?: (line: string) => void
}

export type PointerType = 'down' | 'move' | 'up' | 'enter' | 'leave'
type Phase = 'intro' | 'body' | 'outro' | 'end'

type Play = {
  clip: ClipDef
  intro: Resolved[]
  body: Resolved[]
  outro: Resolved[]
  phase: Phase
  fi: number
  tick: number
  /** true, wenn der Clip mitten im Ablauf verlassen wurde: dann landet die Figur in der Ausgangspose (`from`). */
  interrupted: boolean
}

type Drag = {
  /** press: gedrückt gehalten, noch nicht hochgehoben (erst nach HOLD_TICKS); lift: hängt am Zeiger; arm: Arm wird gezogen. */
  mode: 'arm' | 'lift' | 'press'
  /** Abstand Zeiger → Figurursprung beim Hochheben (damit die Figur an der gegriffenen Stelle hängt). */
  gx?: number
  side: 'L' | 'R'
  x0: number
  y0: number
  x: number
  y: number
  moved: number
  age: number
  t0: number
  cx?: number
  cy?: number
  lastAge?: number
}

export type EngineState = {
  play: Play | null
  queue: (string | ClipDef)[]
  pending: boolean
  ticks: number
  mood: string
  idleTicks: number
  sleepStage: number
  annoy: number
  lastPick: Record<string, string>
  blinkAt: number
  blinkUntil: number
  hover: { x: number; y: number } | null
  drag: Drag | null
  gallery: string | null
  galleryLoop: boolean
  hour: number
  nightStart: number
  nightEnd: number
  idleLimit: number
  reduced: boolean
  lastClipName: string
  lastPose: Pose | null
  /** Kanonische Pose, in der die Figur gerade steht bzw. nach dem laufenden Clip steht. */
  landing: string
  /** Bodengegenstände eines per Maus unterbrochenen Clips: bleiben stehen, bis sie ordentlich weggeräumt sind. */
  carry: { clip: ClipDef; props: readonly PropRef[]; mirror: boolean } | null
  /** Laune -1 … +1 und Müdigkeit 0 … 1 (mood.ts → deriveTemper), vom Client gesetzt. */
  temper: number
  tired: number
  pendingClick: boolean
  /** Gewünschte Stimmung, die noch nicht übernommen ist (siehe setMood). */
  moodWant: { m: string; since: number } | null
  /** Tick, an dem der laufende (nicht dynamische) Clip begann, und wann jeder Clip zuletzt begann (Cooldown). */
  clipStart: number
  playedAt: Record<string, number>
  /** Laufende Subagenten (vom Client/Desktop gesetzt) und die Begleiter auf ihren Plätzen: Versatz nach unten je Platz (0 = steht, MATE_HIDE = hinter der Linie). */
  agents: number
  mates: number[]
  /** Besonderer Tag (Geburtstag, Silvester/Neujahr), vom Client aus Datum und Einstellung gesetzt. */
  special: '' | 'birthday' | 'newyear'
  /** Begrüßung läuft (Fynn kommt nach langer Pause zurück, siehe welcome): Stimmungswechsel warten, bis sie durch ist. */
  welcome: boolean
}

/**
 * Begleiter-Plätze (g-Koordinaten) links neben der Figur, Sprites `agent_s`/`agent_sb` (6×5) aus clips/agent.ts.
 * Vordere Reihe bis 6 Helfer; ab dem 7. steht eine dunklere zweite Reihe (`agent_sback`) versetzt dahinter (Fynn: viele kaschieren).
 */
export const MATE_X: readonly number[] = [-8, -16, -24, -32, -40, -48, -12, -20, -28, -36, -44, -52]
export const MATE_Y = 5
const FRONT_MATES = 6
const BACK_Y = 4
const MATE_HIDE = 5

const ONE_SHOT = new Set(['done', 'oops', 'limit_back', 'agent_done', 'streak'])
const URGENT = new Set(['waitUser', 'done', 'oops', 'limit_5h', 'limit_week', 'limit_back', 'agent_done', 'streak', 'waitUserLong'])
const MOOD_DEBOUNCE = 10 // ~0,75 s: so lange muss eine neue Stimmung anhalten
const MIN_DWELL = 40 // ~3 s: so lange spielt ein Clip mindestens, bevor eine ruhige Stimmung ihn ablöst
const COOLDOWN = 280 // ~21 s: ein eben gespielter Clip wird so lange deutlich seltener gewählt
const NIGHT_PLAY = 3 // nachts: so viele Leerlaufzeiten Zeitvertreib, bevor er einschläft
const LOOP_STAY = 330 // ~25 s: so lange bleibt eine Schleife ohne Stimmungswechsel bei sich, dann darf eine Variante kommen
const CLICK_TICKS = 5 // höchstens ~400 ms zwischen down und up = Klick
const HOLD_TICKS = 9 // ~0,7 s; so lange muss man ihn festhalten, bevor er sich hochheben lässt (Fynn: "es soll ein bisschen dauern")

/** Dynamischer Clip: schon aufgelöst, vom Engine-Code erzeugt (Ausklang, Zurückschnappen, Fallen …). */
type Dyn = ClipDef & { resolved: Resolved[] }
const isDyn = (c: ClipDef): c is Dyn => (c as Dyn).resolved !== undefined

export function createEngine(opts: EngineOpts) {
  const rng: Rng = opts.rng ?? Math.random
  const clips = opts.clips
  const props = opts.props
  const byName: Record<string, ClipDef> = Object.fromEntries(clips.map((c) => [c.name, c]))
  const S: EngineState = {
    play: null, queue: [], pending: false, ticks: 0, mood: 'idle', idleTicks: 0, sleepStage: 0, annoy: 0, lastPick: {},
    blinkAt: 40, blinkUntil: -1, hover: null, drag: null, gallery: null, galleryLoop: false, hour: opts.hour ?? 12,
    nightStart: opts.nightStart ?? 23, nightEnd: opts.nightEnd ?? 6, idleLimit: ((opts.idleSeconds ?? 45) * 1000) / TICK,
    reduced: opts.reduced ?? false, lastClipName: '', lastPose: null, landing: 'stand', carry: null, pendingClick: false,
    temper: 0, tired: 0, moodWant: null, clipStart: 0, playedAt: {}, agents: 0, mates: [], special: '', welcome: false,
  }

  // ---- Begleiter (Subagenten): je laufendem Subagenten (max. 12, ab 7 in zweiter Reihe) steht ein kleiner Helfer auf seinem Platz. Er steigt einmal von
  // unten auf, bleibt die ganze Zeit da und sinkt ab, wenn der Subagent fertig ist (Fynn: nicht ständig auftauchen und verschwinden).
  const ownsMate = (): boolean => !!S.play && !isDyn(S.play.clip) && S.play.clip.companion === true && S.play.phase !== 'end'
  function updateMates() {
    if (!props.agent_s) return
    const want = Math.min(MATE_X.length, S.agents)
    while (S.mates.length < want) S.mates.push(MATE_HIDE)
    for (let i = 0; i < S.mates.length; i++) {
      if (i === 0 && ownsMate()) S.mates[0] = 0
      else if (i < want) {
        // nacheinander aufsteigen: der nächste erst, wenn der vorige fast steht
        if (i === 0 || S.mates[i - 1] <= 2) S.mates[i] = Math.max(0, S.mates[i] - 1)
      } else S.mates[i] = Math.min(MATE_HIDE, S.mates[i] + 1)
    }
    while (S.mates.length > want && S.mates[S.mates.length - 1] >= MATE_HIDE) S.mates.pop()
  }
  function mateProps(): PropRef[] {
    const out: PropRef[] = []
    const back: PropRef[] = []
    S.mates.forEach((off, i) => {
      if (off >= MATE_HIDE || (i === 0 && ownsMate())) return
      // Hintere Reihe: dunklere Silhouetten, 1 px höher, zuerst gezeichnet (liegen hinter der vorderen Reihe)
      if (i >= FRONT_MATES) {
        back.push([props.agent_sback ? 'agent_sback' : 'agent_s', MATE_X[i], BACK_Y + off, 'G'])
        return
      }
      const blink = off === 0 && (S.ticks + i * 17) % 53 < 2
      // Steht er allein (Clawd macht etwas anderes), werkelt er meist still vor sich hin (Fynn: mit sich selbst beschäftigt)
      const busy = off === 0 && !blink && !!props.agent_s8 && !!props.agent_s9 && (S.ticks + i * 11) % 60 < 40
      const name = blink ? 'agent_sb' : busy ? ((S.ticks >> 2) % 2 ? 'agent_s8' : 'agent_s9') : 'agent_s'
      out.push([name, MATE_X[i], MATE_Y + off, 'G'])
    })
    return [...back, ...out]
  }
  let last: Composed | null = null
  const log = (s: string) => opts.onLog?.(s)

  // ---- Tageszeit
  const isNight = () => {
    const h = S.hour
    const a = S.nightStart
    const b = S.nightEnd
    return a > b ? h >= a || h < b : h >= a && h < b
  }
  const isMorning = () => S.hour >= 6 && S.hour < 10.5

  // ---- Auswahl
  const when = (c: ClipDef) =>
    (c.when === 'night' ? isNight() : c.when === 'day' ? !isNight() : true) && (!c.special || c.special === S.special)
  /** Tageszeit-Abschnitt für `daypart`: 0 Morgen (5–11), 1 Mittag (11–17), 2 Abend (17 bis Nachtbeginn), 3 Nacht. */
  const daypartIndex = (): number => (isNight() ? 3 : S.hour >= 5 && S.hour < 11 ? 0 : S.hour >= 11 && S.hour < 17 ? 1 : 2)
  const poolOf = (mood: string): ClipDef[] => clips.filter((c) => c.cat === mood && when(c))
  /**
   * Gewicht nach Laune: Frust-Clips erst ab etwas Frust und mit ihm immer häufiger, bis sie die Gruppe dominieren; Clips für gute
   * Laune bzw. Müdigkeit entsprechend. Neutrale Clips werden bei starker Laune etwas seltener.
   */
  function weightOf(c: ClipDef): number {
    const bad = Math.max(0, -S.temper - 0.2) / 0.8
    const good = Math.max(0, S.temper - 0.2) / 0.8
    // Cooldown: eben gespielte Clips kommen nicht gleich wieder (Fynn: Notizblock wieder raus, kaum dass er weg war)
    let cool = S.ticks - (S.playedAt[c.name] ?? -1e9) < COOLDOWN ? 0.15 : 1
    // Mit Begleitern links: Clips, die sich nicht nach rechts spiegeln lassen, kämen ihnen in die Quere → selten
    // Mit Begleitern links: nur Clips, deren Gegenstände in einer Ausrichtung ganz rechts bzw. an der Figur bleiben
    if (S.mates.length && !c.companion && !c.minMates && freeSide(c) < 0) cool = 0
    if (c.minMates && S.mates.filter((o) => o === 0).length < c.minMates) cool = 0
    // Tageszeit (Zeitvertreib verändert sich über den Tag) und besondere Tage (dann bevorzugt)
    if (c.daypart) cool *= c.daypart[daypartIndex()]
    if (c.special) cool *= 5
    if (c.temper === 'bad') return c.weight * 4 * bad * cool
    if (c.temper === 'good') return c.weight * 3 * good * cool
    if (c.temper === 'tired') return c.weight * 3 * Math.max(0, S.tired - 0.2) * cool
    return c.weight * (1 - 0.5 * Math.max(bad, good)) * cool
  }

  /** Gewichtet zufällig, nie dasselbe zweimal hintereinander (pro Schlüssel). */
  function pick(pool: readonly ClipDef[], key: string): string {
    const items = pool.filter((c) => c.name !== S.lastPick[key] && weightOf(c) > 0)
    const list = items.length ? items : pool.filter((c) => !c.temper).length ? pool.filter((c) => !c.temper) : pool
    let r = rng() * list.reduce((a, c) => a + weightOf(c), 0)
    let chosen = list[list.length - 1]
    for (const c of list) {
      r -= weightOf(c)
      if (r < 0) {
        chosen = c
        break
      }
    }
    S.lastPick[key] = chosen.name
    return chosen.name
  }

  function chooseForMood(): string {
    if (S.gallery) return S.gallery
    const m = S.mood
    if (m === 'idle') {
      // Nachts erst eine Weile ruhiger Zeitvertreib, eingeschlafen wird nach dem Dreifachen der Leerlaufzeit (oder wenn es schon begann)
      if (isNight() && (S.sleepStage > 0 || S.idleTicks > S.idleLimit * NIGHT_PLAY)) {
        if (S.sleepStage === 0) {
          S.sleepStage = 1
          return 'yawn'
        }
        if (S.sleepStage === 1) {
          S.sleepStage = 2
          return 'drowsy'
        }
        S.sleepStage = 3
        return 'sleep'
      }
      // Nur Zeitvertreib, der zur Tageszeit passt (nachts z. B. nur die ruhigen); sonst Grundpose
      const fun = poolOf('fun').filter((c) => weightOf(c) > 0 || c.name === S.lastClipName)
      const lastWasFun = fun.some((c) => c.name === S.lastClipName)
      if (!fun.some((c) => weightOf(c) > 0)) return rng() < 0.22 && S.lastClipName !== 'idle_look' ? 'idle_look' : 'idle_breathe'
      if (!S.reduced && S.idleTicks > S.idleLimit && !lastWasFun && rng() < 0.6) return pick(fun, 'fun')
      return rng() < 0.22 && S.lastClipName !== 'idle_look' ? 'idle_look' : 'idle_breathe'
    }
    const pool = poolOf(m)
    if (!pool.length) return 'idle_breathe'
    if (S.reduced && !ONE_SHOT.has(m)) return pool[0].name
    return pick(pool, m)
  }

  // ---- Pose (mit Ebenen)
  function currentPose(): Pose {
    if (S.drag) {
      const d = dragPose()
      return S.mates.length ? { ...d, props: [...mateProps(), ...d.props] } : d
    }
    const pl = S.play
    let p: Pose = { ...POSES[S.landing] }
    if (pl) {
      const list = pl[pl.phase === 'end' ? 'body' : pl.phase]
      if (list.length) p = { ...list[Math.min(pl.fi, list.length - 1)].p }
      const clip = pl.clip
      if (S.carry) p.mirror = S.carry.mirror
      // Ebenen über jedem Clip: Atmen, Blick zum Cursor, Blinzeln
      // Atmen: Die Schultern (Arme) heben sich kurz um 1 Pixel, statt den ganzen Körper zu senken (das wirkte ruckelig, Fynn).
      // Nur wenn beide Arme unten hängen; sonst bleibt die Pose, wie der Clip sie zeigt.
      if (clip.breathe && !S.reduced && p.armL === 'down' && p.armR === 'down' && S.ticks % 26 < 7) {
        p.armL = 'up1'
        p.armR = 'up1'
      }
      if (clip.lookable && S.hover && LOOKABLE_EYES.has(p.eyes)) {
        const dx = S.hover.x - (FX + p.fx + 8)
        const dy = S.hover.y - (FY + p.fy + p.by + p.squash + 3)
        const lx = Math.abs(dx) > 3 ? Math.sign(dx) : 0
        p.look = [p.mirror ? -lx : lx, dy < -3 ? -1 : dy > 4 ? 1 : 0]
      }
      // Blinzeln: Das Lid senkt sich kurz (nur das untere Augenpixel bleibt). Die waagerechten „geschlossen“-Augen sitzen eine Spalte
      // weiter außen; als Blinzeln wirkte das wie ein Flackern zur Seite (Fynn).
      if (p.eyes === 'open' && !S.reduced) {
        if (S.ticks >= S.blinkAt) {
          S.blinkUntil = S.ticks + 1
          S.blinkAt = S.ticks + 50 + Math.floor(rng() * 60)
          if (rng() < 0.1) S.blinkAt = S.ticks + 4
        }
        if (S.ticks <= S.blinkUntil) p.eyes = 'half'
      }
      // Laune im Gesicht, über neutralen Augen und Mund jedes Clips (Laune-Clips spielen sie selbst aus)
      if (!S.reduced && !clip.temper && !p.back) {
        // Augen bleiben rechteckig: gereizt = zusammengekniffen (halb), müde = gelegentlich lange Lider (ohne Mund, Fynn)
        if (S.temper <= -0.35 && p.eyes === 'open') p.eyes = 'half'
        else if (S.tired >= 0.5 && p.eyes === 'open' && S.ticks % 70 < 25) p.eyes = 'half'
        // Sehr gereizt: ab und zu steigt ein Dampfwölkchen vom Kopf
        if (S.temper <= -0.75 && S.ticks % 60 < 8) {
          const k = S.ticks % 60 < 4
          p.props = [...p.props, [k ? 'steam1' : 'steam2', 7, k ? -2 : -3] as PropRef]
        }
      }
    }
    // Begleiter der laufenden Subagenten
    if (S.mates.length) {
      const m = mateProps()
      if (m.length) p = { ...p, props: [...m, ...p.props] }
    }
    // Mitgenommene Bodengegenstände bleiben stehen, solange Reaktionsclips laufen
    if (S.carry) {
      const have = new Set(p.props.map((x) => x[0]))
      const extra = S.carry.props.filter((x) => !have.has(x[0]))
      if (extra.length) p = { ...p, props: [...p.props, ...extra] }
    }
    return p
  }

  // ---- Wiedergabe
  function dyn(name: string, label: string, from: string, to: string, frames: readonly Resolved[]): Dyn {
    return {
      name, label, cat: 'dynamic', from, to, loop: false, breathe: false, lookable: false, interruptible: false,
      when: 'any', weight: 1, intro: [], frames: [], outro: [], resolved: [...frames],
    }
  }

  function startClip(item: string | ClipDef, skipIntro = false) {
    const c = typeof item === 'string' ? byName[item] : item
    let intro: Resolved[] = []
    let body: Resolved[]
    let outro: Resolved[] = []
    if (isDyn(c)) body = smooth(c.resolved, S.lastPose)
    else {
      let r = resolveClip(c)
      // Zufällig gespiegelt (Fynn: mal links, mal rechts), wenn der Clip es erlaubt und gespiegelt ganz auf die Bühne passt
      // Mit Begleitern (Subagenten links) spielt er seine eigenen Clips gespiegelt, also rechts von sich (Fynn); Begleiter-Clips nie
      const m = S.carry ? S.carry.mirror : c.companion || c.minMates ? false : S.mates.length ? freeSide(c) === 1 : c.mirror !== false && !S.reduced && rng() < 0.5 && mirrorFits(c)
      if (m) {
        const mm = (l: Resolved[]) => l.map((f) => ({ p: { ...f.p, mirror: true }, t: f.t }))
        r = { intro: mm(r.intro), body: mm(r.body), outro: mm(r.outro) }
      }
      if (!skipIntro) intro = smooth(r.intro, S.lastPose)
      const before = intro.length ? intro[intro.length - 1].p : S.lastPose
      body = smooth(r.body, before)
      outro = r.outro
    }
    S.play = { clip: c, intro, body, outro, phase: intro.length ? 'intro' : 'body', fi: 0, tick: 0, interrupted: false }
    S.pending = false
    S.lastClipName = c.name
    if (!isDyn(c)) {
      S.clipStart = S.ticks
      S.playedAt[c.name] = S.ticks
    }
    S.landing = c.from
    log(`${isDyn(c) ? '  ↳ ' : ''}<b>${c.label}</b> <span>(${isDyn(c) ? 'weich' : c.cat})</span>`)
  }

  const fitCache = new Map<string, boolean>()
  /** Passt der Clip gespiegelt vollständig auf die Bühne (kein Pixel geht verloren)? */
  function mirrorFits(c: ClipDef): boolean {
    let ok = fitCache.get(c.name)
    if (ok === undefined) {
      const r = resolveClip(c)
      const count = (p: Pose) => compose(p, props).buf.reduce((a, v, i) => a + (v ? 1 : 0) + (v && (i % W === 0 || i % W === W - 1) ? 1000 : 0), 0)
      ok = [...r.intro, ...r.body, ...r.outro].every((f) => count({ ...f.p, mirror: true }) === count(f.p))
      fitCache.set(c.name, ok)
    }
    return ok
  }

  const sideCache = new Map<string, -1 | 0 | 1>()
  /**
   * Ausrichtung, bei der links von Clawd (wo die Begleiter stehen) keine Gegenstände des Clips liegen: 0 = ungespiegelt,
   * 1 = gespiegelt, -1 = keine (dann ist der Clip mit Begleitern nicht wählbar).
   */
  function freeSide(c: ClipDef): -1 | 0 | 1 {
    let s = sideCache.get(c.name)
    if (s === undefined) {
      const r = resolveClip(c)
      const frames = [...r.intro, ...r.body, ...r.outro]
      // Gegenstände rechts der Figurkante, die Figur selbst höchstens mit ausgestrecktem Arm links (läuft nicht zu den Begleitern)
      const leftFree = (mirror: boolean) =>
        frames.every((f) => compose({ ...f.p, mirror }, props).hit.every((t, i) => !t || i % W >= (t.startsWith('prop:') ? FX - 1 : FX - 3)))
      s = leftFree(false) ? 0 : c.mirror !== false && mirrorFits(c) && leftFree(true) ? 1 : -1
      sideCache.set(c.name, s)
    }
    return s
  }

  /** Enthält der Anfang des Clips schon alle Gegenstände des Carry? Dann entfällt sein Intro. */
  function carryCovers(c: ClipDef): boolean {
    if (!S.carry) return false
    const r = resolveClip(c)
    const first = (r.intro.length ? r.intro[r.intro.length - 1] : r.body[0])?.p
    return !!first && S.carry.props.every((cp) => first.props.some((x) => x[0] === cp[0] && x[1] === cp[1] && x[2] === cp[2]))
  }

  function nextFromQueue() {
    if (!S.queue.length) {
      S.welcome = false
      S.queue = planTo(chooseForMood())
    }
    let item = S.queue.shift()!
    let skipIntro = false
    if (S.carry) {
      const target = typeof item === 'string' ? byName[item] : item
      if (isDyn(target) || target.cat === 'mouse') {
        // Zwischenclips und Reaktionen laufen über dem Carry
      } else if (carryCovers(target)) {
        skipIntro = true
        S.carry = null
      } else {
        // Der nächste Clip braucht die Gegenstände nicht: erst ordentlich wegräumen (Outro des unterbrochenen Clips)
        const out = carryOutro(S.carry.clip)
        S.carry = null
        if (out) {
          S.queue.unshift(item)
          item = out
        }
      }
    }
    startClip(item, skipIntro)
  }

  /** Outro des unterbrochenen Clips als eigener Clip, ab der aktuellen Pose. */
  function carryOutro(c: ClipDef): Dyn | null {
    if (!c.outro.length) return null
    const start = S.lastPose ?? POSES[c.from]
    return dyn(c.name + '_outro', c.label + ' (wegräumen)', c.from, c.from, mergeFrames(start, c.outro))
  }

  function planTo(name: string): string[] {
    return [...planPath(clips, S.landing, byName[name].from), name]
  }

  function endClip() {
    const pl = S.play!
    const c = pl.clip
    if (S.gallery && !S.galleryLoop && c.name === S.gallery) S.gallery = null
    if (ONE_SHOT.has(S.mood) && poolOf(S.mood).some((x) => x.name === c.name)) setMood('idle', true)
    S.landing = pl.interrupted ? c.from : c.to
    pl.phase = 'end'
    // Sicherheitsnetz: Arme und Mund sauber zurück (Gegenstände müssen die Clips selbst wegräumen, siehe Prüfung)
    const list = pl.outro.length ? pl.outro : pl.body
    const lastP = list.length ? list[list.length - 1].p : null
    const tidy = lastP && !isDyn(c) ? tidyFrames(lastP) : []
    if (tidy.length) S.queue.unshift(dyn('tidy', 'Arme zurück', S.landing, S.landing, tidy))
    nextFromQueue()
  }

  function tidyFrames(p: Pose): Resolved[] {
    if (p.armL === 'down' && p.armR === 'down' && !p.mouth) return []
    return [{ p: { ...p, armL: 'down', armR: 'down', mouth: null }, t: 1 }]
  }

  /** Clip verlassen: Outro abspielen (wenn vorhanden), danach weiter mit der Warteschlange. */
  function leaveClip(target: string | null) {
    const pl = S.play!
    pl.interrupted = true
    S.landing = pl.clip.from
    if (target) S.queue = [...planPath(clips, pl.clip.from, byName[target].from), target]
    if (pl.outro.length && pl.phase !== 'outro') {
      pl.phase = 'outro'
      pl.fi = 0
      pl.tick = 0
    } else endClip()
  }

  /** Sofortunterbrechung (Maus, Aufwachen): weich in die kanonische Pose, Bodengegenstände bleiben als Carry stehen. */
  function leaveNow(target: string | null) {
    const p = currentPose()
    const pl = S.play
    const fromPose = S.landing
    const base = POSES[fromPose]
    // Der Begleiter eines Subagenten (agent_s…) gehört der Begleiter-Ebene, nicht dem Carry
    const ground = p.props.filter((x) => x[3] === 'g' && props[x[0]]?.effect !== true && !x[0].startsWith('agent_s'))
    if (pl && !isDyn(pl.clip) && pl.clip.outro.length && ground.length) S.carry = { clip: pl.clip, props: ground, mirror: !!p.mirror }
    // Weich in die Ausgangspose (halber Schritt, dann ganz)
    const settle: Resolved[] = []
    const needs = STRUCT.some((k) => p[k] !== base[k]) || (p.legs !== 'stand' && p.legs !== base.legs)
    if (needs) {
      const mid = { ...p } as Pose
      for (const k of STRUCT) if (typeof base[k] === 'number') (mid as unknown as Record<string, number>)[k] = Math.round(((p[k] as number) + (base[k] as number)) / 2)
      const end = { ...p, ...Object.fromEntries(STRUCT.map((k) => [k, base[k]])), legs: base.legs, look: [0, 0], eyes: p.eyes === 'none' ? base.eyes : p.eyes } as Pose
      settle.push({ p: mid, t: 1 }, { p: end, t: 1 })
    }
    const settled = settle.length ? settle[settle.length - 1].p : p
    // Was in der Hand war (relative Nicht-Effekt-Requisiten), verschwindet nicht abrupt: der Clip soll es selbst weglegen;
    // hier bleiben nur Effekte (sie lösen sich im Reaktionsclip auf) und der Carry.
    const keepFx = settled.props.filter((x) => props[x[0]]?.effect === true)
    const frames = [...settle, ...tidyFrames({ ...settled, props: keepFx })]
    S.play = { clip: pl ? pl.clip : byName.idle_breathe, intro: [], body: [], outro: [], phase: 'end', fi: 0, tick: 0, interrupted: true }
    S.landing = fromPose
    const rest = target ? [...planPath(clips, fromPose, byName[target].from), target] : S.queue
    S.queue = frames.length ? [dyn('ausklang', 'Ausklang (Pose zurück)', fromPose, fromPose, frames), ...rest] : rest
    nextFromQueue()
  }

  function requestChange() {
    S.pending = true
    S.queue = []
  }

  function advance() {
    const pl = S.play
    if (!pl || pl.phase === 'end') return nextFromQueue()
    const list = pl[pl.phase]
    pl.tick++
    const fr = list[pl.fi]
    if (fr && pl.tick < fr.t) return
    pl.fi++
    pl.tick = 0
    if (pl.fi >= list.length) return phaseEnd(pl)
    if (pl.phase === 'body' && S.pending && isSafe(pl.clip, list[pl.fi].p)) leaveClip(chooseForMood())
  }

  function phaseEnd(pl: Play) {
    if (pl.phase === 'intro') {
      pl.phase = 'body'
      pl.fi = 0
      if (!pl.body.length) phaseEnd(pl)
      return
    }
    if (pl.phase === 'body') {
      if (pl.clip.loop) {
        // Schleifengrenze = Ausgangspose: weiterlaufen oder weich aussteigen. Ohne Stimmungswechsel bleibt er bei seiner Schleife und
        // wählt erst nach LOOP_STAY eine Variante (Fynn: nicht ständig zwischen den Denk-Clips springen).
        pl.fi = 0
        // (Im Leerlauf wählt die Grundpose an jeder Schleifengrenze neu, sonst käme Zeitvertreib zu spät.)
        if (!S.pending && !S.queue.length && S.mood !== 'idle' && (S.ticks - S.clipStart < LOOP_STAY || S.gallery)) return
        if (!S.pending && !S.queue.length && S.gallery) return
        const want = S.queue.length ? null : chooseForMood()
        if (!S.pending && want === pl.clip.name) return
        return leaveClip(want)
      }
      if (pl.outro.length) {
        pl.phase = 'outro'
        pl.fi = 0
        return
      }
    }
    endClip()
  }

  // ---- Zeiger (Bühnenpixel, Bruchteile erlaubt)
  function dragPose(): Pose {
    const d = S.drag!
    const base = { ...POSES.stand }
    if (d.mode === 'arm') {
      const to: readonly [number, number] = [d.x - FX, d.y - FY]
      const dist = Math.hypot(d.x - d.x0, d.y - d.y0)
      return {
        ...base, [d.side === 'L' ? 'armL' : 'armR']: { to }, eyes: dist > 5 ? 'wide' : 'open',
        look: [d.side === 'L' ? -1 : 1, 0], mouth: dist > 7 ? 'o' : null,
      }
    }
    if (d.mode === 'press') {
      // Festgehalten, aber noch nicht hoch: er stemmt sich etwas in Zugrichtung und schaut groß
      const lean = Math.abs(d.x - d.x0) > 1.5 ? Math.sign(d.x - d.x0) : 0
      return { ...base, fx: lean, by: d.age > 3 ? 1 : 0, eyes: 'wide', look: [lean, -1] }
    }
    // Hochgehoben: hängt an der gegriffenen Stelle und folgt dem Zeiger direkt (waagerecht über die ganze Bühne);
    // nur das Abheben geht schrittweise (1 px je Tick bis 2–4 px über dem Boden).
    const tfy = Math.min(-2, Math.max(-4, Math.round(d.y - d.y0) - 2))
    const tfx = Math.max(-FX + 1, Math.min(W - FX - 18, Math.round(d.x - (d.gx ?? 0) - FX)))
    d.cy = d.cy === undefined ? 0 : d.cy
    d.cx = tfx
    if (d.lastAge !== d.age) {
      d.cy += Math.sign(tfy - d.cy)
      d.lastAge = d.age
    }
    return {
      ...base, fy: d.cy, fx: d.cx, legs: d.cy < 0 ? ((S.ticks >> 1) % 2 ? 'stepA' : 'stepB') : 'stand',
      eyes: 'wide', mouth: 'o',
    }
  }

  function wake(): string[] {
    if (S.sleepStage === 0) return []
    const wasLying = S.landing === 'lie'
    S.sleepStage = 0
    return wasLying ? ['startled', 'rub_eyes'] : ['rub_eyes']
  }

  /**
   * Begrüßung, wenn Fynn nach langer Pause zurückkommt (nicht mehr an die Uhrzeit gebunden, Fynn): aufwachen bzw. Augen reiben, dann
   * ein Morgen-Clip (Strecken, Kaffee, Zähne putzen). Läuft ganz durch; nur dringende Stimmungen (Rückfrage, Fertig, Fehler) brechen ab.
   */
  function welcome() {
    const morning = clips.filter((c) => c.cat === 'morning')
    if (!morning.length || S.gallery) return
    const mc = pick(morning, 'morning')
    const w = wake()
    const isWaking = (q: string | ClipDef) => q === 'rub_eyes' || q === 'startled'
    S.welcome = true
    S.moodWant = null
    if (!w.length && (S.queue.some(isWaking) || (S.play && isWaking(S.play.clip.name)))) {
      // Wacht gerade schon auf (Stimmungswechsel kam zuerst): nur den Morgen-Clip anhängen
      S.queue.push(mc)
      return
    }
    S.queue = []
    chainNow([...(w.length ? w : ['rub_eyes']), mc])
  }

  function chainNow(list: string[]) {
    leaveNow(list[0])
    S.queue.push(...list.slice(1))
  }

  function click() {
    S.idleTicks = 0
    const w = wake()
    if (w.length) {
      S.queue = []
      return chainNow(w)
    }
    S.annoy = Math.min(8, S.annoy + 1)
    let r: string
    if (S.annoy >= 6) {
      r = 'sulk'
      S.annoy = 3
    } else if (S.annoy >= 4) r = 'grumpy'
    else r = pick(clips.filter((c) => ['giggle', 'boop', 'blush'].includes(c.name)), 'click')
    chainNow([r])
  }

  function snapBackClip(side: 'L' | 'R', to: readonly [number, number]): Dyn {
    const key = side === 'L' ? 'armL' : 'armR'
    const sx = side === 'L' ? 1 : 15
    const sy = 4.5
    const lerp = (k: number): readonly [number, number] => [Math.round(sx + (to[0] - sx) * k), Math.round(sy + (to[1] - sy) * k)]
    const f = (extra: Record<string, unknown>, t: number): Resolved => ({ p: { ...POSES.stand, ...extra } as Pose, t })
    return dyn('zurueckschnappen', 'Arm schnappt zurück', 'stand', 'stand', [
      f({ [key]: { to: lerp(0.5) }, eyes: 'wide' }, 1),
      f({ [key]: 'up1', eyes: 'wide', fx: side === 'L' ? 1 : -1 }, 1),
      f({ [key]: 'down', eyes: 'closed', fx: side === 'L' ? -1 : 1 }, 1),
      f({ [key]: 'up1', eyes: 'open' }, 1),
      f({ [key]: 'down', eyes: 'open' }, 2),
      f({ eyes: 'sad' }, 4),
      f({}, 2),
    ])
  }

  function walkBackClip(fx: number): Dyn {
    const frames: Resolved[] = []
    let x = fx
    const dir = -Math.sign(fx)
    let i = 0
    while (x !== 0) {
      x += dir
      frames.push({ p: { ...POSES.stand, fx: x, legs: i++ % 2 ? 'stepA' : 'stepB', look: [dir, 0] }, t: Math.abs(fx) > 12 ? 1 : 2 })
    }
    frames.push({ p: { ...POSES.stand }, t: 2 })
    return dyn('zurueckgehen', 'geht zurück an seinen Platz', 'stand', 'stand', frames)
  }

  /**
   * Neue Stimmung. Damit er nicht hektisch zwischen Clips springt, wenn Tools im Sekundentakt wechseln (Fynn: die Gedankenblase
   * tauchte ständig auf und verschwand), wird ein Wechsel erst übernommen, wenn die neue Stimmung MOOD_DEBOUNCE Ticks anhält und der
   * laufende Clip mindestens MIN_DWELL Ticks gespielt hat (außer im Leerlauf). Sofort wirken: wartet auf dich, fertig, Fehler,
   * Aufwachen, Galerie und `silent`.
   */
  function setMood(m: string, silent = false) {
    if (silent) return applyMood(m, true)
    if (m === S.mood) {
      S.moodWant = null
      return
    }
    if (URGENT.has(m) || S.gallery || S.sleepStage > 0 || !S.play) {
      S.moodWant = null
      return applyMood(m)
    }
    if (!S.moodWant || S.moodWant.m !== m) S.moodWant = { m, since: S.ticks }
  }

  function moodDue(): boolean {
    const w = S.moodWant
    if (!w || S.welcome) return false
    const steady = S.ticks - w.since >= MOOD_DEBOUNCE
    const dwelt = S.mood === 'idle' || S.ticks - S.clipStart >= MIN_DWELL
    return steady && dwelt
  }

  function applyMood(m: string, silent = false) {
    S.moodWant = null
    S.welcome = false
    if (S.mood === m && !silent) return
    const was = S.mood
    S.mood = m
    S.idleTicks = 0
    if (!silent) {
      S.gallery = null
      const w = m !== 'idle' ? wake() : []
      if (w.length) chainNow(w)
      else requestChange()
      log(`Stimmung: ${was} → <b>${m}</b>`)
    }
  }

  /** Ein Bild weiter (1 Tick). */
  function tick() {
    S.ticks++
    updateMates()
    if (S.mood === 'idle' && !S.drag) S.idleTicks++
    if (S.ticks % 30 === 0 && S.annoy > 0) S.annoy--
    if (S.drag) {
      S.drag.age++
      if (S.drag.mode === 'press' && S.drag.age >= HOLD_TICKS) {
        // Lange genug festgehalten: jetzt lässt er sich hochheben, an der Stelle, an der er gegriffen wurde
        S.drag.mode = 'lift'
        S.drag.gx = S.drag.x0 - FX
        S.drag.y0 = S.drag.y
        S.drag.age = 0
        log('<b>Hochgehoben</b>')
      }
      S.lastPose = currentPose()
      return
    }
    if (moodDue()) applyMood(S.moodWant!.m)
    advance()
    S.lastPose = currentPose()
  }

  function hitAt(x: number, y: number): string | null {
    if (!last) return null
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return null
    return last.hit[iy * W + ix]
  }

  /** Zeigerereignis in Bühnenpixeln. Liefert true, wenn die Figur es verwendet hat (Treffer auf Körper oder Arm). */
  function pointer(type: PointerType, x: number, y: number): boolean {
    if (type === 'leave') {
      if (!S.drag) S.hover = null
      return false
    }
    if (type === 'enter' || type === 'move') {
      S.hover = { x, y }
      if (S.drag) {
        S.drag.moved += Math.hypot(x - S.drag.x, y - S.drag.y)
        S.drag.x = x
        S.drag.y = y
      }
      return !!S.drag
    }
    if (type === 'down') {
      const tag = hitAt(x, y)
      if (!tag || tag.startsWith('prop')) return false
      const standing = S.landing === 'stand' && S.sleepStage === 0
      const mode = !standing ? 'click' : tag === 'armL' || tag === 'armR' ? 'arm' : 'press'
      if (mode === 'click') {
        S.pendingClick = true
        return true
      }
      S.drag = { mode, side: tag === 'armL' ? 'L' : 'R', x0: x, y0: y, x, y, moved: 0, age: 0, t0: S.ticks }
      return true
    }
    // up
    if (S.pendingClick) {
      S.pendingClick = false
      click()
      return true
    }
    const d = S.drag
    if (!d) return false
    S.drag = null
    S.idleTicks = 0
    if (d.moved < 1.2 && S.ticks - d.t0 < CLICK_TICKS) {
      click()
      return true
    }
    if (d.mode === 'press') {
      // Losgelassen, bevor er hochgehoben war: kurz zurückfedern, sonst nichts
      S.play = { clip: byName.idle_breathe, intro: [], body: [], outro: [], phase: 'end', fi: 0, tick: 0, interrupted: true }
      S.landing = 'stand'
      S.queue = [dyn('zurueckfedern', 'federt zurück', 'stand', 'stand', [{ p: { ...POSES.stand, by: 1 }, t: 1 }, { p: { ...POSES.stand }, t: 2 }])]
      nextFromQueue()
      return true
    }
    const none = { clip: byName.idle_breathe, intro: [], body: [], outro: [], phase: 'end' as Phase, fi: 0, tick: 0, interrupted: true }
    if (d.mode === 'arm') {
      S.annoy = Math.min(8, S.annoy + 1)
      S.play = { ...none }
      S.landing = 'stand'
      S.queue = [snapBackClip(d.side, [d.x - FX, d.y - FY])]
      nextFromQueue()
      log('<b>Arm losgelassen</b> → schnappt zurück')
    } else {
      const fx = d.cx || 0
      const f = (e: Record<string, unknown>, t: number): Resolved => ({ p: { ...POSES.stand, fx, ...e } as Pose, t })
      S.play = { ...none }
      S.landing = 'held'
      S.queue = [
        dyn('fallen', 'fällt runter', 'held', 'stand', [
          f({ fy: -2, legs: 'tuck', eyes: 'wide' }, 1), f({ fy: -1, legs: 'tuck', eyes: 'wide' }, 1),
          f({ by: 1, legs: 'spread', eyes: 'closed' }, 1), f({}, 2),
        ]),
      ]
      if (d.moved > 80) {
        const dz = resolveClip(byName.dizzy).body.map((fr) => ({ p: { ...fr.p, fx: fr.p.fx + fx }, t: fr.t }))
        S.queue.push(dyn('dizzy_fx', 'schwindelig', 'stand', 'stand', dz))
      }
      if (fx !== 0) S.queue.push(walkBackClip(fx))
      nextFromQueue()
      log('<b>Losgelassen</b> → landet' + (d.moved > 80 ? ', schwindelig' : '') + (fx ? ', geht zurück' : ''))
    }
    return true
  }

  /** Aktuelles Bild als Pixelpuffer (und Trefferkarte für die Maus). */
  function render(): Composed {
    last = compose(currentPose(), props)
    return last
  }

  /** Einen bestimmten Clip abspielen (Demo/Galerie), vom aktuellen Zustand aus über die nötigen Übergänge. */
  function play(name: string, loop = false) {
    S.gallery = name
    S.galleryLoop = loop
    S.idleTicks = 0
    chainNow([name])
  }

  return {
    S,
    tick,
    render,
    pose: currentPose,
    setMood,
    play,
    pointer,
    click,
    requestChange,
    byName,
    isNight,
    isMorning,
    poolOf,
    set(o: { hour?: number; nightStart?: number; nightEnd?: number; idleSeconds?: number; reduced?: boolean; temper?: number; tired?: number; agents?: number; special?: '' | 'birthday' | 'newyear' }) {
      if (o.agents !== undefined) S.agents = Math.max(0, o.agents)
      if (o.special !== undefined) S.special = o.special
      if (o.temper !== undefined) S.temper = Math.max(-1, Math.min(1, o.temper))
      if (o.tired !== undefined) S.tired = Math.max(0, Math.min(1, o.tired))
      if (o.hour !== undefined) S.hour = o.hour
      if (o.nightStart !== undefined) S.nightStart = o.nightStart
      if (o.nightEnd !== undefined) S.nightEnd = o.nightEnd
      if (o.idleSeconds !== undefined) S.idleLimit = (o.idleSeconds * 1000) / TICK
      if (o.reduced !== undefined) S.reduced = o.reduced
    },
    wakeUp() {
      const w = wake()
      if (w.length) chainNow(w)
    },
    welcome,
    start() {
      nextFromQueue()
    },
  }
}

export type Engine = ReturnType<typeof createEngine>
