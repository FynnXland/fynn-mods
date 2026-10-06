// clawd-buddy: Choreografie-Bausteine für Clips (reine Funktionen, liefern Frame-Listen).
//
// Leitregel (Fynn): NICHTS taucht einfach auf. Jeder Gegenstand und jeder Helfer kommt irgendwo her und geht irgendwo hin:
//   - Gegenstände holt die Figur *hinter der Linie* hervor (fetchIn) – so wie das echte Clawd den Laptop: erst kramt es
//     seitlich mit einem zugekniffenen Auge und tastender Hand, dann zieht es den Gegenstand hoch und stellt ihn neben sich ab.
//   - Wegräumen ist das Gegenstück (fetchOut): greifen, hinter die Linie absenken, Hand zurückziehen.
//   - Helfer und Tiere steigen hinter der Linie auf (riseIn/sinkOut) oder gehen von der linken Bühnenkante herein und hinaus
//     (slideX). Effekte (Funkeln, Note, Herz …) entstehen an der Figur (siehe `effect` in props.ts).
//   - Gegenstände stehen *seitlich* neben der Figur auf der Linie, nicht vor dem Bauch (Seitenansicht des echten Clawd).
//
// Koordinaten: Requisiten mit Flag 'g' liegen relativ zum Heimatplatz (stage.ts → FX, FY), Armziele (`{to:[x,y]}`) relativ zur
// Figur. "Hinter der Linie" heißt y_g ≥ HIDDEN_GY: alles dort ist abgeschnitten.
import { FY, H } from './stage.ts'
import type { PropRef } from './stage.ts'
import type { Frame } from './clipdef.ts'

/** Erste y_g-Zeile, die schon hinter der Linie liegt (nichts davon ist sichtbar). */
export const HIDDEN_GY = H - FY

type Pt = readonly [number, number]
type Side = 'L' | 'R'
const arm = (side: Side) => (side === 'L' ? 'armL' : 'armR')
const other = (side: Side): Side => (side === 'L' ? 'R' : 'L')

export type FetchOpts = {
  /** Name der Requisite (Eintrag im Requisitentisch). */
  name: string
  /** Breite und Höhe der Requisite in Pixeln. */
  size: Pt
  /**
   * Endposition (linke obere Ecke, g-Koordinaten) auf dem Boden. Der Gegenstand steht **direkt neben der Figur**, nur eine Armlänge entfernt:
   * die Hand ist ein Blockarm von 2–6 Pixeln Länge, ihre Spitze überdeckt die der Figur zugewandte Kante. Die Länge ergibt sich aus `at`.
   */
  at: Pt
  /** Seite, auf der der Gegenstand liegt (Standard 'L'). */
  side?: Side
  /** Zeilen unter der Oberkante des Gegenstands, an denen die Hand greift (Standard 0 = obere Ecke; bei Profil-Laptop z. B. die Grundplatte). */
  grip?: number
  /** Kram-Takte, jeder 2 Ticks (Standard 4). */
  rummage?: number
  /** Pixel pro Tick beim Hochziehen und Absetzen (Standard 2). */
  rise?: number
  /** Wie viele Pixel er den Gegenstand über seinen Endplatz anhebt, bevor er ihn absetzt (Standard 3). */
  lift?: number
  /** Andere Requisiten, die währenddessen im Bild bleiben. */
  keep?: readonly PropRef[]
  /** X-Versatz der Figur (Standard 0), falls sie nicht am Heimatplatz steht. */
  fx?: number
  /** Augenzustand beim Kramen (Standard: das der Gegenstandsseite abgewandte Auge zu, wie beim echten Clawd). */
  eyes?: string
}

/** Länge des Blockarms (Spalten ab Körperrand), sodass die Handspitze die Gegenstandskante gerade überdeckt. */
function reachOut(o: FetchOpts): number {
  const side = o.side ?? 'L'
  const at = o.at[0] - (o.fx ?? 0)
  const out = side === 'L' ? 2 - (at + o.size[0] - 1) : at - 14
  return Math.max(2, Math.min(6, out))
}
const lookDown = (side: Side): readonly [number, number] => (side === 'L' ? [-2, 1] : [2, 1])
const winkEyes = (side: Side): string => (side === 'L' ? 'winkR' : 'winkL')
const blockArm = (side: Side, out: number, y: number) => ({ [arm(side)]: { out, y, h: 2 } }) as Frame

/** Verkleinerungsstufe (Prozent), bei der der Gegenstand höchstens `maxW`×`maxH` Pixel groß ist. */
function shrinkPct(size: Pt, maxW: number, maxH: number): number {
  return Math.max(10, Math.floor(Math.min(maxW / size[0], maxH / size[1], 1) * 100))
}
/** Kleine Variante (`name@NN`) und ihre Größe. */
function small(o: FetchOpts, pct: number): { name: string; w: number; h: number } {
  const f = pct / 100
  return { name: pct >= 100 ? o.name : `${o.name}@${pct}`, w: Math.max(1, Math.round(o.size[0] * f)), h: Math.max(1, Math.round(o.size[1] * f)) }
}
/** x (Figurkoordinate) eines Gegenstands der Breite w, dessen der Figur zugewandte Kante bei Spalte `edge` der rechten Seite liegt, gespiegelt für links. */
const sideX = (side: Side, edge: number, w: number): number => (side === 'R' ? edge : 17 - edge - w)

/**
 * Gegenstand aus der Tasche holen, Bild für Bild nach Fynns Laptop-GIF: Er geht leicht in die Hocke, die Hand der Gegenstandsseite
 * steckt unten in der Tasche und wühlt (auf und ab), das andere Auge ist zugekniffen, der freie Arm hebt sich etwas. Dann die schnelle
 * Reaktion: aufrichten, die Hand schnellt hoch und hält den Gegenstand klein in der Hand, er wächst beim Hochhalten, dann senkt die Hand
 * ihn seitlich neben die Figur und stellt ihn auf `at` ab. Nichts kommt mehr von unten durch die Linie und kein Arm reicht nach unten.
 */
export function fetchIn(o: FetchOpts): Frame[] {
  const side = o.side ?? 'L'
  const keep = o.keep ?? []
  const fx = o.fx ?? 0
  const eyes = o.eyes ?? winkEyes(side)
  const n = o.rummage ?? 4
  const step = o.rise ?? 2
  const grip = o.grip ?? 0
  const out = reachOut(o)
  const yFinal = o.at[1]
  const yPeak = Math.max(Math.min(0, yFinal), yFinal - (o.lift ?? 3)) // über dem Körper (y < 0) ohne Anheben
  const prop = (y: number): PropRef => [o.name, o.at[0], y, 'g']
  const hand = (objY: number) => blockArm(side, out, objY + grip)
  const away = side === 'L' ? 'armR' : 'armL'
  const s1 = small(o, shrinkPct(o.size, 3, 2))
  const s2 = small(o, shrinkPct(o.size, 6, 4))
  const frames: Frame[] = []
  // 1. Blick zur Tasche, Auge zu
  frames.push({ look: lookDown(side), eyes, props: keep, t: 2 })
  // 2. Hocke und Wühlen: Hand unten in der Tasche (kurzer Blockarm), wackelt auf und ab; der andere Arm geht etwas hoch
  for (let i = 0; i < n; i++) frames.push({ by: 1, eyes, look: lookDown(side), ...blockArm(side, 1, i % 2 ? 6 : 5), [away]: 'up1', props: keep, t: 1 })
  // 3. Fund, schnelle Reaktion: aufrichten, Hand schnellt hoch, der Gegenstand ist noch klein in der Hand
  frames.push({ by: 0, eyes: 'wide', look: [side === 'L' ? -1 : 1, -1], ...blockArm(side, 2, 1), [away]: 'down', props: [...keep, [s1.name, fx + sideX(side, 16, s1.w), 1 - s1.h, 'g']], t: 2 })
  // 4. Hochhalten: Arm oben, der Gegenstand wächst über der Hand
  const rx = fx + sideX(side, 15, s2.w)
  const ry = Math.max(-FY, -s2.h)
  frames.push({ eyes: 'open', look: [side === 'L' ? -1 : 1, -1], [arm(side)]: 'raise', props: [...keep, [s2.name, rx, ry, 'g']], t: 2 })
  // 5. Seitlich herunterführen (ein Zwischenbild in voller Größe auf halbem Weg) und absetzen; die Hand hält ihn am Griffpunkt
  let y = yPeak
  const midY = Math.round((ry + yPeak) / 2)
  frames.push({ ...blockArm(side, Math.max(2, out - 1), Math.max(0, midY + grip)), props: [...keep, [o.name, Math.round((rx + o.at[0]) / 2), midY, 'g']], t: 1 })
  frames.push({ look: lookDown(side), ...hand(y), props: [...keep, prop(y)], t: 2 })
  while (y < yFinal) {
    y = Math.min(yFinal, y + step)
    frames.push({ ...hand(y), props: [...keep, prop(y)], t: 1 })
  }
  frames.push({ ...hand(yFinal), props: [...keep, prop(yFinal)], t: 2 })
  frames.push({ eyes: 'open', [arm(side)]: 'down', look: [0, 0], props: [...keep, prop(yFinal)], t: 2 })
  return frames
}

/** Gegenstand wegpacken (Gegenstück zu fetchIn): greifen, anheben, zur Tasche führen, dort schrumpft er hinein; Hand wühlt kurz nach. */
export function fetchOut(o: FetchOpts): Frame[] {
  const side = o.side ?? 'L'
  const keep = o.keep ?? []
  const fx = o.fx ?? 0
  const step = o.rise ?? 2
  const grip = o.grip ?? 0
  const out = reachOut(o)
  const yFinal = o.at[1]
  const yPeak = Math.max(Math.min(0, yFinal), yFinal - (o.lift ?? 3)) // über dem Körper (y < 0) ohne Anheben
  const prop = (y: number): PropRef => [o.name, o.at[0], y, 'g']
  const hand = (objY: number) => blockArm(side, out, objY + grip)
  const s2 = small(o, shrinkPct(o.size, 5, 3))
  const s1 = small(o, shrinkPct(o.size, 3, 2))
  const frames: Frame[] = []
  frames.push({ look: lookDown(side), ...hand(yFinal), props: [...keep, prop(yFinal)], t: 2 })
  let y = yFinal
  while (y > yPeak) {
    y = Math.max(yPeak, y - step)
    frames.push({ ...hand(y), props: [...keep, prop(y)], t: 1 })
  }
  frames.push({ ...hand(yPeak), props: [...keep, prop(yPeak)], t: 2 })
  // Zur Tasche: die Hand kommt an den Körper, der Gegenstand wird kleiner …
  frames.push({ ...blockArm(side, 2, 3), props: [...keep, [s2.name, fx + sideX(side, 16, s2.w), 3 - s2.h + 1, 'g']], t: 2 })
  frames.push({ by: 1, eyes: winkEyes(side), ...blockArm(side, 1, 5), props: [...keep, [s1.name, fx + sideX(side, 16, s1.w), 6 - s1.h + 1, 'g']], t: 1 })
  // … und ist in der Tasche. Hand wühlt kurz nach, dann aufrichten
  frames.push({ by: 1, eyes: winkEyes(side), ...blockArm(side, 1, 6), props: keep, t: 1 })
  frames.push({ by: 1, eyes: winkEyes(side), ...blockArm(side, 1, 5), props: keep, t: 1 })
  frames.push({ by: 0, eyes: 'open', look: [0, 0], [arm(side)]: 'down', props: keep, t: 2 })
  return frames
}

export type RiseOpts = {
  name: string
  size: Pt
  /** Endposition (g-Koordinaten). */
  at: Pt
  /** Pixel pro Tick (Standard 1). */
  step?: number
  /** Namen zum Durchschalten beim Aufsteigen (z. B. Helfer mit Armen oben), sonst nur `name`. */
  names?: readonly string[]
  keep?: readonly PropRef[]
  /** Frame-Felder während des Aufstiegs (z. B. Blick zum Helfer). */
  during?: Frame
}

/** Etwas steigt hinter der Linie auf (Helfer, Tier, Gegenstand ohne Hand). Der letzte Frame zeigt es fertig auf `at`. */
export function riseIn(o: RiseOpts): Frame[] {
  const step = o.step ?? 1
  const keep = o.keep ?? []
  const frames: Frame[] = []
  let y = HIDDEN_GY
  let i = 0
  while (y > o.at[1]) {
    y = Math.max(o.at[1], y - step)
    const nm = o.names ? o.names[i++ % o.names.length] : o.name
    frames.push({ ...o.during, props: [...keep, [nm, o.at[0], y, 'g']], t: 1 })
  }
  return frames
}

/** Gegenstück zu riseIn: sinkt hinter die Linie. Der letzte Frame zeigt nur noch `keep`. */
export function sinkOut(o: RiseOpts): Frame[] {
  const step = o.step ?? 1
  const keep = o.keep ?? []
  const frames: Frame[] = []
  let y = o.at[1]
  let i = 0
  while (y < HIDDEN_GY) {
    y = Math.min(HIDDEN_GY, y + step)
    const nm = o.names ? o.names[i++ % o.names.length] : o.name
    frames.push({ ...o.during, props: [...keep, [nm, o.at[0], y, 'g']], t: 1 })
  }
  frames.push({ ...o.during, props: keep, t: 1 })
  return frames
}

export type SlideOpts = {
  /** Namen, die abwechselnd gezeigt werden (z. B. zwei Schrittbilder). */
  names: readonly string[]
  /** Start-x und End-x (g-Koordinaten), y fest. Außerhalb der Bühne beginnen/enden heißt: hereinkommen/hinausgehen. */
  from: number
  to: number
  y: number
  /** Pixel pro Tick (Standard 1). */
  step?: number
  /** Ticks je Schrittbild (Standard 2). */
  every?: number
  keep?: readonly PropRef[]
  during?: Frame
}

/** Etwas wandert waagerecht über die Bühne (Helfer geht von links herein oder hinaus). */
export function slideX(o: SlideOpts): Frame[] {
  const step = o.step ?? 1
  const every = o.every ?? 2
  const keep = o.keep ?? []
  const dir = Math.sign(o.to - o.from) || 1
  const frames: Frame[] = []
  let x = o.from
  let i = 0
  while (dir > 0 ? x < o.to : x > o.to) {
    x += dir * step
    frames.push({ ...o.during, props: [...keep, [o.names[Math.floor(i / every) % o.names.length], x, o.y, 'g']], t: 1 })
    i++
  }
  return frames
}

/** Die Figur geht von `from` nach `to` (fx, 1 px je Tick), Beine abwechselnd; endet mit stehenden Beinen. */
export function walk(from: number, to: number, o: { props?: readonly PropRef[]; during?: Frame } = {}): Frame[] {
  const dir = Math.sign(to - from) || 1
  const frames: Frame[] = []
  let x = from
  let i = 0
  while (x !== to) {
    x += dir
    frames.push({ ...o.during, fx: x, legs: Math.floor(i / 1) % 2 ? 'stepA' : 'stepB', look: [dir, 0], ...(o.props ? { props: o.props } : {}), t: 1 })
    i++
  }
  frames.push({ ...o.during, fx: to, legs: 'stand', look: [0, 0], t: 1 })
  return frames
}

/** Einen Frame n Ticks halten (Kurzform). */
export const hold = (t: number, patch: Frame = {}): Frame => ({ ...patch, t })

/** Blockarm als Frame-Feld (Kurzform für eigene Choreografie). */
export const armBlock = blockArm
