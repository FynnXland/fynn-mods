// clawd-buddy: Clips der Gruppe "fun" (Zeitvertreib im Leerlauf).
//
// Regeln: Bühne 100 breit, Figur bei x 60 (stage.ts → FX). Rein und raus nur nach unten (hinter die Linie); links, rechts und oben wird nie etwas
// abgeschnitten. Gegenstände kommen aus der Tasche (fetchIn/fetchOut oder eigene Kram-Frames), die Hände sind Blöcke, die Augen bleiben immer frei
// (Requisiten vor dem Körper liegen im Streifen zwischen den Augen, x 5 bis 11, oder unterhalb/oberhalb der Augenzeilen; der Blick geht höchstens 1 Pixel zur Seite).
// Unverändert (Fynn mag sie): stretch, dance, hop, smell_flower.
import { clip, rep } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { fetchIn, fetchOut, riseIn, sinkOut, HIDDEN_GY } from '../macros.ts'

const s = (rows: readonly string[]): PropSprite => ({ rows })
const fxp = (rows: readonly string[]): PropSprite => ({ rows, effect: true })

/** Seifenblasen-Umrisse (Durchmesser → Raster): Glanzpunkt (W) oben links, rosa Schimmer (P) unten rechts. */
const BUB_ROWS: Readonly<Record<number, readonly string[]>> = {
  3: ['.L.', 'L.L', '.L.'],
  4: ['.LL.', 'LW.L', 'L..L', '.LL.'],
  5: ['.LLL.', 'LW..L', 'L...L', 'L..PL', '.LLL.'],
  6: ['.LLLL.', 'LW...L', 'L....L', 'L....L', 'L...PL', '.LLLL.'],
  7: ['..LLL..', '.LW..L.', 'LW....L', 'L.....L', 'L....PL', '.L..PL.', '..LLL..'],
}
/** Zerplatzen, Stufe 0 (9×9): der Blasenring (Durchmesser 7) mit kleinen weißen Spitzen nach außen. */
const POP_RING: readonly string[] = (() => {
  const g = Array.from({ length: 9 }, () => Array(9).fill('.'))
  BUB_ROWS[7].forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') g[y + 1][x + 1] = c }))
  for (const [x, y] of [[4, 0], [4, 8], [0, 4], [8, 4], [1, 1], [7, 1], [1, 7], [7, 7]]) g[y][x] = 'W'
  return g.map((r) => r.join(''))
})()

/** Requisiten, die nur diese Gruppe braucht (Name → Sprite). Namen müssen über alle Gruppen eindeutig sein (Präfix `fun_`). */
const PROPS_BASE: Readonly<Record<string, PropSprite>> = {
  // Fluchwölkchen "#!%" (11×7): weiße Sprechwolke mit schwarzem Fluch, ein zusammenhängendes Stück (Effekt über dem Kopf)
  // Fliege (2×2, ein Körperpixel dunkelgrau, ein Flügelpixel weiß; die Flügel schlagen): winzig und als Effekt, damit sie zwischen den Händen verschwinden darf
  fun_fly1: fxp(['.W', 'D.']),
  fun_fly2: fxp(['W.', 'D.']),
  // Stein (8×6): heller Glanz oben links, dunkle Unterseite; zwei Bilder (die Sprenkel wandern), damit man ihn rollen sieht
  fun_stone1: s(['...GWW..', '..GWWWG.', '.GWWGGGD', 'GWGGGGGD', 'GGGGGGDD', '.DDDDDD.']),
  fun_stone2: s(['...GGW..', '..GWWGG.', '.GGGGWGD', 'GGGWGGGD', 'GDGGGDDD', '.DDDDDD.']),
  // Jonglierbälle (3×3): drei klare Farben mit weißem Glanzpunkt
  fun_jy: s(['WYY', 'YYY', 'YYY']),
  fun_jb: s(['WBB', 'BBB', 'BBB']),
  fun_je: s(['WEE', 'EEE', 'EEE']),
  // Gänseblümchen (5×8): 1 Knospe, 2 halb offen, 3 blühend; gleiche Stiel- und Blattzeilen
  fun_flower1: s(['.....', '..W..', '.EEE.', '..E..', '.EE..', '..EE.', '..E..', '..E..']),
  fun_flower2: s(['.....', '.WYW.', '.WWW.', '..E..', '.EE..', '..EE.', '..E..', '..E..']),
  fun_flower3: s(['.WWW.', 'WWYWW', '.WWW.', '..E..', '.EE..', '..EE.', '..E..', '..E..']),
  // Prellball (3×3, blau mit weißem Glanzpunkt); beim Aufprall gestaucht (3×2)
  fun_ball1: s(['WBB', 'BBB', 'BBB']),
  fun_ball2: s(['WBB', 'BBB']),
  // Seifenblasenstab (6×9): grüner Ring, cremefarbener Griff (2 breit), brauner Knauf
  fun_wand1: s(['.EEEE.', 'E....E', 'E....E', 'E....E', '.EEEE.', '..CC..', '..CC..', '..CC..', '..RR..']),
  // Seifenblasen (Effekte, wachsen am Ring): Ziffer = Durchmesser 3 bis 7
  ...Object.fromEntries(Object.entries(BUB_ROWS).map(([d, rows]) => ['fun_bub' + d, fxp(rows)])),
  // Zerplatzen: Ziffern 0 bis 2 und 9 gehören zur selben Familie wie die Blase (damit das Platzen als eine Blase verfolgt wird):
  // 0 Ring mit Spitzen (9×9), 1 Stern aus 8 Strahlen (9×9), 2 kleiner Stern (5×5), 9 Tropfen, der nach unten wegfällt
  fun_bub0: fxp(POP_RING),
  fun_bub1: fxp(['W...W...W', '.L..L..L.', '..L.L.L..', '...LLL...', 'WLLLWLLLW', '...LLL...', '..L.L.L..', '.L..L..L.', 'W...W...W']),
  fun_bub2: fxp(['..W..', '.WLW.', 'WLWLW', '.WLW.', '..W..']),
  fun_bub9: fxp(['.L', 'LL', 'LL']),
}

// ---- Tageszeit-Faktoren: [Morgen, Mittag, Abend, Nacht]
const DP: Record<string, readonly [number, number, number, number]> = {
  stretch: [3, 1, 0.6, 0], whistle: [2.5, 1, 0.5, 0], stroll_whistle: [2.5, 1, 0.5, 0], dance: [2.5, 1, 0.4, 0],
  fly_chase: [1, 1.3, 0.5, 0], pebble_kick: [1, 1.3, 0.5, 0], juggle: [0.5, 2.5, 0.5, 0], smell_flower: [0.5, 2.5, 0.5, 0],
  bubbles: [0.5, 2.5, 0.5, 0], hop: [1, 2.5, 0.5, 0], dribble_ball: [0.5, 2.5, 0.4, 0], grumble_kick: [1, 1, 0.7, 0],
  happy_hum: [1, 1, 2, 0.3], nap_sitting: [0.2, 0.6, 2, 0.5],
}
const NIGHT: readonly [number, number, number, number] = [0, 0, 0.3, 2]

const out: ClipDef[] = []
type Extra = { daypart?: readonly [number, number, number, number]; special?: 'birthday' | 'newyear' }
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & Extra & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, { ...(DP[name] ? { daypart: DP[name] } : {}), ...def }))
}

const G = (name: string, x: number, y: number): PropRef => [name, x, y, 'g']
/**
 * Frameliste am ersten Schritt aus dem Heimatplatz teilen (Intro bis einschließlich dieses Frames, Rest = Hauptteil). So liegt ein Gegenstand
 * auf der Bühne nie in einem "sicheren" Frame des Hauptteils: Das Intro lässt sich nicht unterbrechen, und im Hauptteil steht er nie am Platz.
 */
const splitAtMove = (frames: readonly Frame[]): [Frame[], Frame[]] => {
  const i = frames.findIndex((f) => f.fx !== undefined && f.fx !== 0)
  return i < 0 ? [[], [...frames]] : [frames.slice(0, i + 1), frames.slice(i + 1)]
}
/** Beine beim Gehen: wechseln mit jedem Schritt. */
const stepLegs = (i: number): string => (i % 2 ? 'stepA' : 'stepB')
const mod = (a: number, n: number): number => ((a % n) + n) % n
/** Weg durch Stützpunkte mit höchstens `v` Pixeln je Tick (größte Achsendifferenz). Der erste Punkt ist der Start und wird nicht ausgegeben. */
function route(pts: readonly (readonly [number, number])[], v = 2): [number, number][] {
  const res: [number, number][] = []
  let [x, y] = pts[0]
  for (const [tx, ty] of pts.slice(1)) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(tx - x), Math.abs(ty - y)) / v))
    const sx = x
    const sy = y
    for (let i = 1; i <= n; i++) res.push([Math.round(sx + ((tx - sx) * i) / n), Math.round(sy + ((ty - sy) * i) / n)])
    x = tx
    y = ty
  }
  return res
}
/** Gehen als ruhiger Zweiertakt (Beine und Gegenarme wechseln alle 2 Ticks): wirkt weniger zappelig. */
const gait = (k: number): Frame => {
  const a = Math.floor(k / 2) % 2 === 1
  return { legs: a ? 'stepA' : 'stepB', armL: a ? 'up1' : 'down', armR: a ? 'down' : 'up1' }
}
const STAND: Frame = { legs: 'stand', armL: 'down', armR: 'down' }
/** Blockarm links (Länge `out`, 2 dick, Oberkante `y` unter der Körperoberkante). */
const handL = (out: number, y: number): Frame => ({ armL: { out, y, h: 2 } })
/**
 * Kram-Teil der Tasche (nach Fynns Laptop-GIF), links: Blick zur Tasche, Auge zu, Hocke, die Hand wühlt unten (wippt senkrecht), dann der Fund:
 * aufrichten, die Hand schnellt hoch, der kleine Gegenstand (`found`, Props) sitzt über der Hand. Jeder Frame nennt alle Felder (damit man ihn umkehren kann).
 */
const FULL: Frame = { by: 0, eyes: 'open', look: [0, 0], mouth: null, armL: 'down', armR: 'down' }
const rummageFrames = (n: number, found: readonly PropRef[]): Frame[] => [
  { ...FULL, look: [-2, 1], eyes: 'winkR', ...handL(1, 5), props: [], t: 2 },
  ...Array.from({ length: n }, (_, i): Frame => ({ ...FULL, by: 1, look: [-2, 1], eyes: 'winkR', ...handL(1, i % 2 ? 6 : 5), armR: 'up1', props: [], t: 1 })),
  { ...FULL, eyes: 'wide', look: [-1, -1], ...handL(2, 1), props: found, t: 2 },
]

// ---- Zeitvertreib
C('stretch', 'Strecken', 'fun', { interruptible: true, frames: [
  { armL: 'up1', armR: 'up1', t: 2 }, { armL: 'up2', armR: 'up2', squash: -1, t: 2 },
  { armL: 'raise', armR: 'raise', eyes: 'closed', t: 2 }, { armL: 'wave2', armR: 'wave2', fy: -1, t: 6 },
  { mouth: 'o', t: 3 }, { fy: 0, armL: 'raise', armR: 'raise', mouth: null, t: 2 },
  { squash: 0, armL: 'up2', armR: 'up2', eyes: 'happy', t: 2 }, { armL: 'up1', armR: 'up1', t: 2 },
  { armL: 'down', armR: 'down', eyes: 'open', t: 3 }] });

// Pfeifen: Die Noten (3×4 Pixel) steigen rechts neben dem Kopf ein paar Pixel auf und vergehen dort nahe der Figur (nie oben aus dem Bild, nie auf dem Arm).
// Höchstens zwei zugleich, mindestens 4 Pixel Abstand in der Höhe (Fynn: "beim Pfeifen überschneiden sich die Pixel der zwei Töne").
const NOTE_PATH: readonly (readonly [number, number])[] = [[18, 2], [19, 0], [19, -2], [19, -4]]
const whistleFrames: Frame[] = []
for (let i = 0; i < 13; i++) {
  const props: PropRef[] = []
  for (const born of [0, 3, 6, 9]) {
    const p = NOTE_PATH[i - born]
    if (p) props.push(['note', p[0], p[1]])
  }
  whistleFrames.push({ ...(i === 0 ? { mouth: 'o', look: [1, 0] } : {}), ...(i === 11 ? { mouth: null, look: [0, 0] } : {}), props, t: 3 })
}
C('whistle', 'Pfeifen', 'fun', { interruptible: true, breathe: true, frames: whistleFrames });

// Fliege jagen: Eine winzige Fliege (2 Pixel, dunkel) steigt hinter der Linie links neben ihm hoch und schwirrt über und um seinen Kopf; er schaut ihr nach.
// Dann setzt sie sich genau vor sein Gesicht zwischen die Augen: er holt mit beiden Händen aus und klatscht einmal zusammen (die Hände treffen sich vor der Brust),
// die Fliege ist weg (zwischen den Händen). Er öffnet die Hände, sucht, zuckt mit den Schultern und lächelt. Sie bewegt sich höchstens 3 Pixel je Tick und verdeckt nie ein Auge.
function flyFrames(): Frame[] {
  const f: Frame[] = []
  let flap = 0
  const fly = (x: number, y: number): PropRef => G('fun_fly' + (1 + (flap++ % 2)), x, y)
  const gaze = (x: number, y: number): readonly [number, number] => [Math.max(-1, Math.min(1, Math.round((x - 7) / 5))), y < -1 ? -1 : y > 5 ? 1 : 0]
  f.push({ ...FULL, props: [], t: 3 })
  f.push({ look: [-1, 1], props: [], t: 2 })
  // 1. Von unten hinter der Linie hoch (der Anfang ist unten abgeschnitten), dann in großen Bögen über und um den Kopf
  const pts: [number, number][] = [[-4, 9], [-6, 3], [-3, -3], [2, -4], [7, -3], [12, -4], [17, -2], [19, 3], [17, 6], [14, 0], [10, -3], [4, -2], [-1, 0], [-2, 4], [1, -1], [5, -3], [7, -2]]
  f.push({ look: gaze(pts[0][0], pts[0][1]), eyes: 'wide', props: [fly(pts[0][0], pts[0][1])], t: 1 })
  for (const [x, y] of route(pts, 3)) f.push({ look: gaze(x, y), eyes: 'open', props: [fly(x, y)], t: 1 })
  // 2. Sie schwebt herab und setzt sich vor sein Gesicht zwischen die Augen
  for (const [x, y] of route([[7, -2], [7, 3]], 2)) f.push({ look: [0, 0], props: [fly(x, y)], t: 1 })
  for (let i = 0; i < 4; i++) f.push({ look: [0, 0], eyes: 'open', props: [fly(7, 3)], t: 1 })
  // 3. Ausholen (Arme auseinander), Klatschen (die Hände treffen sich vor der Brust, die Fliege ist zwischen ihnen weg), kurz festhalten
  f.push({ armL: 'up2', armR: 'up2', mouth: 'flat', props: [fly(7, 3)], t: 2 })
  f.push({ armL: 'hold', armR: 'hold', props: [fly(7, 3)], t: 1 })
  f.push({ armL: 'chinUp', armR: 'chinUp', props: [], t: 3 })
  // 4. Hände auf, nachsehen, Schulterzucken, Lächeln
  f.push({ armL: 'hold', armR: 'hold', mouth: null, eyes: 'half', t: 2 })
  f.push({ armL: 'down', armR: 'down', look: [-1, 1], t: 3 })
  f.push({ look: [1, 1], t: 3 })
  f.push({ armL: 'up2', armR: 'up2', look: [0, 0], mouth: 'flat', eyes: 'open', t: 3 })
  f.push({ armL: 'down', armR: 'down', mouth: 'smile', eyes: 'happy', t: 4 })
  f.push({ mouth: null, eyes: 'open', t: 2 })
  return f
}
C('fly_chase', 'Fliege jagen', 'fun', { interruptible: false, frames: flyFrames() });

// Stein kicken: Er holt einen Stein (8×6) aus der Tasche und stellt ihn links neben sich ab. Erst tippt er ihn nur an (der Stein hoppelt 4 Pixel), geht hin,
// holt richtig aus und kickt: Der Stein fliegt in drei Bögen nach links (groß, mittel, klein), rollt noch ein Stück bis zur Kante der Linie und fällt dort nach
// unten weg (hinter die Linie). Er schaut mit den Augen mit, freut sich (zwei Hüpfer) und geht zurück.
const STONE_Y = 4 // Oberkante des liegenden Steins (8×6 steht auf dem Boden, Zeile 9)
const STONE = { name: 'fun_stone1', size: [8, 6] as const, at: [-8, STONE_Y] as const, side: 'L' as const }
function pebbleFrames(): Frame[] {
  const f: Frame[] = [...fetchIn(STONE)]
  let fig = 0
  let k = 0
  let n = 0
  const stone = (x: number, y: number): PropRef => G('fun_stone' + (1 + (n++ % 2)), x, y)
  const still = (x: number): PropRef => G('fun_stone1', x, STONE_Y)
  // 1. Antippen: kurz ausholen, mit dem vorderen Fuß anstoßen; der Stein hoppelt 4 Pixel (rechte Kante dann bei -5)
  f.push({ look: [-2, 1], by: 1, armR: 'up1', legs: 'stand', props: [still(-8)], t: 2 })
  fig = -1
  f.push({ fx: fig, by: 0, legs: 'kickL', armR: 'down', armL: 'up1', props: [still(-8)], t: 1 })
  for (const [px, py] of [[-10, STONE_Y - 1], [-11, STONE_Y - 1], [-12, STONE_Y]] as [number, number][]) {
    f.push({ fx: fig, legs: 'stand', armL: 'down', props: [stone(px, py)], t: 1 })
  }
  f.push({ look: [-2, 1], eyes: 'half', mouth: 'flat', props: [still(-12)], t: 3 })
  // 2. Das war zu lasch: hingehen (4 Schritte), stehen bleiben
  for (let i = 0; i < 4; i++) {
    fig--
    k++
    f.push({ fx: fig, ...gait(k), eyes: 'open', mouth: null, look: [-2, 1], props: [still(-12)], t: 1 })
  }
  f.push({ legs: 'stand', armL: 'down', armR: 'down', eyes: 'open', t: 2 })
  // 3. Richtig ausholen: zurücklehnen (ein Pixel nach hinten, Körper tiefer, Gegenarm hoch), dann der Schlag
  f.push({ fx: fig + 1, by: 1, armR: 'up2', props: [still(-12)], t: 3 })
  f.push({ fx: fig, by: 0, legs: 'kickL', armR: 'down', armL: 'up2', eyes: 'wide', props: [still(-12)], t: 1 })
  // 4. Flug in drei Bögen (Dauer, Höhe, Pixel nach links je Tick): groß, mittel, klein
  let sx = -12
  // Kürzer als früher: Clawd steht jetzt bei Spalte 60, der Stein darf den linken Rand nicht berühren
  const arcs: [number, number, number][] = [[10, 8, -2], [6, 3, -2], [4, 1, -1]]
  for (const [T, h, vx] of arcs) {
    for (let i = 1; i <= T; i++) {
      sx += vx
      const sy = STONE_Y - Math.round(h * Math.sin((Math.PI * i) / T))
      f.push({ fx: fig, legs: 'stand', armL: 'down', look: [-2, sy < 3 ? -1 : 0], mouth: sy < 2 ? 'o' : null, props: [stone(sx, sy)], t: 1 })
    }
  }
  // 5. Er rollt noch ein Stück (2 Pixel je Tick) bis zur Kante und fällt dort nach unten weg: der Fall ist unten abgeschnitten (hinter der Linie)
  for (let i = 0; i < 3; i++) {
    sx -= 2
    f.push({ look: [-2, 1], eyes: 'open', mouth: null, props: [stone(sx, STONE_Y)], t: 1 })
  }
  for (const y of [STONE_Y + 1, STONE_Y + 3, STONE_Y + 5]) f.push({ look: [-2, 1], mouth: 'o', props: [stone(sx - 1, y)], t: 1 })
  f.push({ props: [], look: [-2, 1], mouth: 'o', t: 3 })
  // 6. Jubeln: strahlende Augen, zwei kleine Hüpfer (die ganze Figur hebt sich ein Pixel), Arme als kurze Stummel
  f.push({ mouth: null, eyes: 'happy', look: [-1, 0], armL: 'up1', armR: 'up1', t: 2 })
  for (let i = 0; i < 2; i++) {
    f.push({ fy: -1, t: 2 })
    f.push({ fy: 0, t: 1 })
  }
  f.push({ armL: 'down', armR: 'down', eyes: 'open', look: [1, 0], t: 1 })
  while (fig < 0) {
    fig++
    k++
    f.push({ fx: fig, ...gait(k), look: [1, 0], t: 1 })
  }
  f.push({ ...STAND, look: [0, 0], t: 1 })
  return f
}
const PEBBLE = splitAtMove(pebbleFrames())
C('pebble_kick', 'Stein kicken', 'fun', { interruptible: true, intro: PEBBLE[0], frames: PEBBLE[1] });

const danceStep = (n) => [
  { armL: 'up2', armR: 'down', legs: 'stepA', fx: -1, eyes: 'happy', t: 3, props: n ? [['note', -4, 0]] : [] },
  { armL: 'down', armR: 'up2', legs: 'stepB', fx: 1, t: 3, props: n ? [['note', 18, -1]] : [] }];
C('dance', 'Tänzchen', 'fun', { interruptible: true, frames: [
  ...danceStep(0), ...danceStep(1), ...danceStep(0), ...danceStep(1),
  { fx: 0, armL: 'down', armR: 'down', legs: 'stand', by: 1, props: [], t: 1 },
  { by: 0, fy: -2, legs: 'tuck', armL: 'raise', armR: 'raise', t: 2 }, { fy: -1, t: 1 },
  { fy: 0, by: 1, legs: 'spread', t: 1 }, { by: 0, legs: 'stand', armL: 'down', armR: 'down', eyes: 'open', t: 3 }] });

// Jonglieren (vorsichtig, VOR ihm): Er holt nacheinander drei Bälle (gelb, blau, grün, je 3×3) aus der Tasche (kramen, Fund, hochhalten) und wirft jeden in
// einen Kreis um seinen Kopf: links hoch, über den Kopf, rechts herunter, unten vor dem Bauch durch. Die Hände sind Vorderarm-Blöcke (Q) vor dem Körper unten
// links und rechts; sie heben sich, wenn ein Ball vorbeikommt. Die Bälle fliegen nie über ein Auge (der Kreis liegt außerhalb der Augenspalten und der Blick bleibt geradeaus).
// Am Ende fängt die linke Hand jeden Ball und steckt ihn zurück in die Tasche (er wird dort klein), zuletzt "Tada".
const JN = 20 // Plätze im Kreis; jeder Ball rückt einen Platz je Tick weiter (≈ 2 Pixel je Tick)
const JCX = 8 // Mittelpunkt (g-Koordinaten) und Halbachsen des Kreises der Ballmitten
const JCY = 2
const JAX = 7
const JAY = 5
const JK0 = 12 // Einwurfplatz (oben links)
const JCATCH = 8 // Fangplatz der linken Hand (unten links)
const JB = ['fun_jy', 'fun_jb', 'fun_je']
const jpos = (k: number): [number, number] => {
  const a = (2 * Math.PI * mod(k, JN)) / JN
  return [Math.round(JCX + JAX * Math.cos(a)) - 1, Math.round(JCY + JAY * Math.sin(a)) - 1]
}
type JBall = { n: string; k: number }
function juggleParts(): { intro: Frame[]; body: Frame[]; outro: Frame[] } {
  const intro: Frame[] = []
  const body: Frame[] = []
  const outro: Frame[] = []
  let dst = intro
  const balls: JBall[] = []
  /** Ein Tick: Frame mit allen Bällen (plus Zusatz) ausgeben, danach rücken alle Bälle einen Platz weiter. */
  const tick = (fr: Frame, extra: readonly PropRef[] = []): void => {
    dst.push({ ...fr, props: [...balls.map((b) => G(b.n, ...jpos(b.k))), ...extra], t: 1 })
    balls.forEach((b) => b.k++)
  }
  /** Beide Hände vor dem Körper; sie heben sich, wenn ein Ball links aufsteigt (linke Hand wirft) bzw. rechts herunterkommt (rechte Hand fängt). */
  const hands = (): Frame => {
    const near = (lo: number, hi: number): boolean => balls.some((b) => mod(b.k - lo, JN) <= hi - lo)
    return { armL: near(8, 12) ? 'holdUp' : 'hold', armR: near(0, 3) ? 'holdUp' : 'hold' }
  }
  const base = (): Frame => ({ by: 0, eyes: 'open', look: [0, 0], mouth: null, ...hands() })
  const fetchBall = (idx: number): void => {
    const nm = JB[idx]
    const other: Frame = { armR: balls.length ? 'hold' : 'down' }
    const lk: readonly [number, number] = idx ? [0, 1] : [-2, 1] // mit Bällen im Kreis nur nach unten schauen (ein Blick nach links träfe die Bahn)
    for (let i = 0; i < 2; i++) tick({ ...base(), look: lk, eyes: 'winkR', ...handL(1, 5), ...other })
    for (let i = 0; i < 4; i++) tick({ ...base(), by: 1, look: lk, eyes: 'winkR', ...handL(1, i % 2 ? 6 : 5), ...other })
    for (let i = 0; i < 2; i++) tick({ ...base(), eyes: 'wide', look: [-1, -1], ...handL(2, 1), ...other }, [G(nm + '@67', -1, -1)])
    for (let i = 0; i < 2; i++) tick({ ...base(), armL: 'raise', ...other }, [G(nm, -1, -3)])
    balls.push({ n: nm, k: JK0 })
    tick(base())
    for (let i = 0; i < 2; i++) tick(base())
  }
  tick({ ...base(), armR: 'down', armL: 'down' })
  tick({ ...base(), armR: 'down', armL: 'down' })
  for (let idx = 0; idx < 3; idx++) fetchBall(idx)
  // Hauptteil: die Bälle kreisen, die Hände heben sich im Takt
  dst = body
  for (let i = 0; i < 50; i++) tick(base())
  // Ausklang: Die linke Hand fängt jeden Ball unten links und steckt ihn in die Tasche (er wird klein und ist darin weg)
  dst = outro
  const putAway = (): void => {
    for (let g = 0; g < JN && !balls.some((b) => mod(b.k, JN) === JCATCH); g++) tick(base())
    const i = balls.findIndex((b) => mod(b.k, JN) === JCATCH)
    const b = balls[i]
    tick({ ...base(), armL: 'hold' }) // Ball liegt in der Hand (Platz JCATCH)
    balls.splice(i, 1)
    tick({ ...base(), ...handL(2, 4) }, [G(b.n, -1, 4)])
    tick({ ...base(), eyes: 'winkR', look: [0, 0], ...handL(2, 5) }, [G(b.n + '@67', -1, 5)])
    tick({ ...base(), eyes: 'winkR', look: [0, 0], ...handL(1, 6) }, [G(b.n + '@67', -1, 6)])
    tick({ ...base(), eyes: 'winkR', look: [0, 0], ...handL(1, 5) })
    tick({ ...base(), by: 0 })
  }
  while (balls.length) putAway()
  outro.push({ armL: 'up2', armR: 'up2', look: [0, 0], eyes: 'open', mouth: 'smile', props: [], t: 2 })
  outro.push({ armL: 'raise', armR: 'raise', fy: -1, t: 2 })
  outro.push({ armL: 'up1', armR: 'up1', fy: 0, t: 1 })
  outro.push({ armL: 'down', armR: 'down', mouth: null, t: 2 })
  return { intro, body, outro }
}
const JUG = juggleParts()
C('juggle', 'Jonglieren', 'fun', { interruptible: false, intro: JUG.intro, frames: JUG.body, outro: JUG.outro });

// Schlendern und pfeifen: Er geht gemütlich ein langes Stück nach links (30 Pixel), die Arme schwingen, die Noten steigen neben seinem Kopf ein paar Pixel auf und
// vergehen dort (sie gehen mit ihm mit). Links schaut er zum Himmel, pfeift weiter und hüpft einmal, dann geht er genauso zurück.
function strollFrames(): Frame[] {
  const f: Frame[] = []
  let tick = 0
  let fx = 0
  let born: number[] = []
  const push = (extra: Frame, emit: boolean): void => {
    born = born.filter((b) => tick - b < NOTE_PATH.length * 2)
    if (emit && (born.length === 0 || tick - born[born.length - 1] >= 8)) born.push(tick)
    // Noten relativ zur Figur: jede steigt in 4 Stufen zu je 2 Ticks
    const props = born.map((b): PropRef => ['note', ...NOTE_PATH[Math.floor((tick - b) / 2)]])
    f.push({ ...extra, fx, props, t: 1 })
    tick++
  }
  const whistle = (): Frame => ({ mouth: tick % 6 < 3 ? 'o' : null })
  const walkSteps = (dir: number, count: number, look: readonly [number, number]): void => {
    for (let st = 0; st < count; st++) {
      fx += dir
      const swing = st % 2 ? { armL: 'down', armR: 'up1' } : { armL: 'up1', armR: 'down' }
      push({ ...swing, legs: stepLegs(st), look, by: 0, eyes: 'open', ...whistle() } as Frame, true)
      push({ by: 1, legs: stepLegs(st), ...whistle() }, true)
    }
  }
  push({ look: [-1, 0], eyes: 'happy', ...whistle() }, true)
  walkSteps(-1, 30, [-1, 0])
  // links: stehen bleiben, zum Himmel schauen, weiterpfeifen, ein kleiner Hüpfer
  push({ legs: 'stand', by: 0, armL: 'down', armR: 'down', look: [-1, -1], ...whistle() }, true)
  for (let i = 0; i < 5; i++) push({ look: [i % 2 ? -1 : 0, -1], by: i % 2 ? 1 : 0, ...whistle() }, true)
  push({ fy: -1, legs: 'tuck', armL: 'up1', armR: 'up1', eyes: 'happy', ...whistle() }, true)
  push({ fy: 0, legs: 'stand', armL: 'down', armR: 'down', by: 0, ...whistle() }, true)
  push({ look: [1, 0], eyes: 'open', ...whistle() }, true)
  walkSteps(1, 30, [1, 0])
  push({ legs: 'stand', by: 0, armL: 'down', armR: 'down', look: [0, 0], eyes: 'happy', ...whistle() }, false)
  for (let i = 0; i < 8; i++) push({ mouth: null, eyes: 'open' }, false)
  return f
}
C('stroll_whistle', 'Schlendert und pfeift', 'fun', { interruptible: true, frames: strollFrames() });

// Blume: Links neben ihm wächst hinter der Linie eine Blume hervor (Knospe, öffnet sich). Er schaut hin, geht die 12 Pixel hin, beugt sich
// vor, schnuppert, freut sich (Herz). Dann geht er zurück, die Blume sinkt wieder hinter die Linie.
const FLOWER_X = -17
const FLOWER_Y = 2
const fl = (n: number, y: number = FLOWER_Y): PropRef => G('fun_flower' + n, FLOWER_X, y)
function flowerIntro(): Frame[] {
  const f: Frame[] = []
  f.push({ look: [-2, 1], eyes: 'open', props: [], t: 4 })
  // wächst aus der Tiefe: die Knospe schaut zuerst über die Linie, Stiel folgt, oben öffnet sie sich
  for (let y = HIDDEN_GY - 1, i = 0; y >= FLOWER_Y; y--, i++) f.push({ props: [fl(y > FLOWER_Y + 2 ? 1 : y > FLOWER_Y ? 2 : 3, y)], t: i % 3 === 2 ? 2 : 1 })
  return f
}
function flowerFrames(): Frame[] {
  const f: Frame[] = []
  f.push({ eyes: 'wide', mouth: 'o', look: [-2, 0], props: [fl(3)], t: 4 })
  f.push({ eyes: 'happy', mouth: 'smile', t: 2 })
  // hingehen (12 Pixel)
  let fx = 0
  for (let i = 0; i < 12; i++) {
    fx--
    f.push({ fx, legs: stepLegs(i), look: [-2, 1], armL: i % 2 ? 'up1' : 'down', armR: i % 2 ? 'down' : 'up1', eyes: 'open', mouth: null, props: [fl(3)], t: 1 })
  }
  f.push({ legs: 'stand', armL: 'down', armR: 'down', by: 1, look: [-2, 0], t: 3 })
  // schnuppern: der Kopf geht tiefer und wieder hoch, der Mund zieht Luft ein
  for (let i = 0; i < 3; i++) {
    f.push({ by: 1, mouth: 'o', eyes: 'closed', t: 2 })
    f.push({ by: 0, mouth: null, t: 2 })
  }
  f.push({ by: 1, eyes: 'happy', mouth: 'smile', blush: true, props: [fl(3), ['heart', 3, -4]], t: 4 })
  f.push({ props: [fl(3), ['heart', 3, -4], ['heart', 9, -4]], t: 3 })
  f.push({ by: 0, props: [fl(3)], t: 2 })
  f.push({ blush: false, mouth: null, eyes: 'open', look: [1, 0], t: 2 })
  // zurück
  for (let i = 0; i < 12; i++) {
    fx++
    f.push({ fx, legs: stepLegs(i), look: [1, 0], armL: i % 2 ? 'up1' : 'down', armR: i % 2 ? 'down' : 'up1', t: 1 })
  }
  f.push({ legs: 'stand', armL: 'down', armR: 'down', look: [-2, 1], t: 3 })
  return f
}
function flowerOutro(): Frame[] {
  const f: Frame[] = []
  for (let y = FLOWER_Y; y <= HIDDEN_GY; y++) f.push({ look: [-2, 1], props: y >= HIDDEN_GY ? [] : [fl(y > FLOWER_Y + 2 ? 1 : y > FLOWER_Y ? 2 : 3, y)], t: y % 3 === 0 ? 2 : 1 })
  f.push({ look: [0, 0], eyes: 'happy', t: 2 })
  f.push({ eyes: 'open', t: 2 })
  return f
}
C('smell_flower', 'Riecht an einer Blume', 'fun', { interruptible: true, intro: flowerIntro(), frames: flowerFrames(), outro: flowerOutro() });

// Ball prellen: Er holt einen kleinen blauen Ball (3×3, weißer Glanzpunkt) aus der Tasche und stellt ihn links neben sich ab. Mit der Blockhand prellt er ihn wie beim
// Dribbeln: der Ball springt senkrecht (erst 2, dann 4 und zuletzt 6 Pixel hoch, am Boden gestaucht), die Hand folgt ihm ein Stück nach oben und drückt ihn unten wieder
// herunter; die Augen schauen ihm nach. Nach dem höchsten Sprung fängt er ihn, freut sich kurz und packt ihn wieder in die Tasche.
const BALL = { name: 'fun_ball1', size: [3, 3] as const, at: [-4, 7] as const, side: 'L' as const, lift: 2 }
function dribbleFrames(): Frame[] {
  const f: Frame[] = []
  const ball = (h: number): PropRef => (h === 0 ? G('fun_ball2', BALL.at[0], BALL.at[1] + 1) : G('fun_ball1', BALL.at[0], BALL.at[1] - h))
  // Ein Prellen: Dauer T, Höhe H. Tick 0 = Ball am Boden (gestaucht), dann Auf und Ab.
  const bounce = (T: number, H: number): void => {
    for (let i = 0; i < T; i++) {
      const h = Math.round(H * Math.sin((Math.PI * i) / T))
      f.push({ ...handL(4, 6 - Math.round(h / 2)), armR: h >= 2 && i < T / 2 ? 'up1' : 'down', mouth: null, look: [-2, h >= 4 ? -1 : h <= 1 ? 1 : 0], props: [ball(h)], t: 1 })
    }
  }
  f.push({ look: [-2, 1], eyes: 'open', mouth: null, ...handL(4, 6), props: [ball(0)], t: 2 })
  for (const [T, H] of [[6, 2], [8, 4], [10, 6]] as [number, number][]) bounce(T, H)
  // Fangen: Ball unten in der Hand, kurze Freude (strahlende Augen), dann packt er ihn weg
  f.push({ ...handL(4, 6), armR: 'down', eyes: 'happy', mouth: null, look: [-2, 1], props: [G('fun_ball1', BALL.at[0], BALL.at[1])], t: 3 })
  f.push({ eyes: 'open', t: 1 })
  return f
}
C('dribble_ball', 'Ball prellen', 'fun', { interruptible: false, intro: fetchIn(BALL), frames: dribbleFrames(), outro: fetchOut(BALL) });

// Seifenblasen: Er holt einen Seifenblasenstab (Ring + Griff) aus der Tasche und hält ihn links neben sich am Griff. Er pustet (Mund rund, rosa Wangen): Die erste Blase wächst
// gleichmäßig am Ring (Größe 3 bis 7), löst sich und schwebt langsam über die ganze Bühne nach links (ein Pixel je Tick, dabei sanft auf und ab, leicht steigend). Kurz vor dem
// linken Rand platzt sie in drei Stufen (Ring mit Spitzen, Stern, kleiner Stern); zuletzt fällt ein Tropfen nach unten weg. Noch während sie fliegt, pustet er eine zweite (Größe 6):
// sie schwebt langsamer und sinkt leicht, platzt weiter rechts und später als die erste. Er packt den Stab schon weg, während die zweite noch ein Stück fliegt; danach schaut er
// ihr beim Platzen zu und lacht. Der Clip läuft bewusst nach links und wird nie gespiegelt. Alles liegt in Ticks T seit dem Lösen der ersten Blase (T = 0).
const WAND = { name: 'fun_wand1', size: [4, 9] as const, at: [-5, 1] as const, side: 'L' as const, grip: 6, lift: 2, rummage: 3 }
const WAND_LEFT = WAND.at[0] // linke Kante des Rings
const bubGx = (d: number): number => WAND_LEFT - 1 - d // linke Kante der wachsenden Blase: ihre rechte Kante liegt eine Spalte links vom Ring
const bubGy = (d: number): number => 3 - Math.floor(d / 2) // auf Höhe der Ringmitte
const bubGrow = (d: number): PropRef => G('fun_bub' + d, bubGx(d), bubGy(d))
type BubOpts = { d: number; grow0: number; rel: number; len: number; pos: (t: number) => [number, number] }
/**
 * Eine Blase als Funktion der Zeit T: ab `grow0` wächst sie am Ring (Größe 3 bis d, je 2 Ticks), bis `rel` bleibt sie am Ring, danach fliegt sie `len` Ticks
 * (Bahn `pos(t)`), platzt in drei Stufen (je 2 Ticks) und hinterlässt einen Tropfen, der nach unten wegfällt. Alle Stufen gehören zur Blasenfamilie (fun_bub*).
 */
const bubbleAt = (o: BubOpts) => (T: number): PropRef[] => {
  if (T < o.grow0) return []
  if (T <= o.rel) return [bubGrow(Math.min(o.d, 3 + Math.floor((T - o.grow0) / 2)))]
  const t = T - o.rel
  const [px, py] = o.pos(o.len)
  if (t <= o.len) {
    const [x, y] = o.pos(t)
    return [G('fun_bub' + o.d, x, y)]
  }
  const u = t - o.len - 1
  if (u < 4) return [G('fun_bub' + (u < 2 ? 0 : 1), px - 1, py - 1)]
  if (u < 6) return [G('fun_bub2', px + 1, py + 1)]
  const y = py + 3 + 2 * (u - 6)
  return y < HIDDEN_GY + 4 ? [G('fun_bub9', px + 3, y)] : []
}
// Erste Blase: 40 Ticks Flug, 1 Pixel je Tick; die Höhe schwingt sanft und steigt insgesamt leicht (nie höher als Zeile -3, damit das Platzen oben nicht abgeschnitten wird)
const B1 = bubbleAt({ d: 7, grow0: -99, rel: 0, len: 40, pos: (t) => [bubGx(7) - t, bubGy(7) + Math.round(-t / 16 + 0.8 * Math.sin(t / 5))] })
// Zweite Blase: pustet er ab T = 8, löst sich bei T = 19, fliegt 56 Ticks mit 0,4 Pixel je Tick und sinkt dabei leicht; platzt bei T = 76 (nach der ersten, bei T = 41, aber viel weiter rechts)
const B2 = bubbleAt({ d: 6, grow0: 10, rel: 19, len: 56, pos: (t) => [bubGx(6) - Math.round(0.4 * t), bubGy(6) + Math.round(t / 22 + 0.7 * Math.sin(t / 6))] })
const T_PACK = 60 // ab hier packt er den Stab weg (das Outro), die zweite Blase fliegt weiter
const T_POP2 = 76 // Beginn des Platzens der zweiten Blase (19 + 56 + 1)
function bubbleBody(): Frame[] {
  const body: Frame[] = []
  const wand = G('fun_wand1', WAND.at[0], WAND.at[1])
  const hold: Frame = handL(4, WAND.at[1] + WAND.grip)
  const tick = (extra: Frame, more: readonly PropRef[] = []): void => {
    body.push({ ...hold, ...extra, props: [wand, ...more], t: 1 })
  }
  const times = (n: number, run: (i: number) => void): void => {
    for (let i = 0; i < n; i++) run(i)
  }
  const puff: Frame = { mouth: 'o', blush: true, look: [-2, 0], eyes: 'open' }
  times(2, () => tick({ look: [-2, 0], eyes: 'open' }))
  // Luft holen (Augen zu), pusten, gleichmäßig wachsen (je 2 Ticks: 3, 4, 5, 6, 7), lösen (T = 0)
  times(2, () => tick({ eyes: 'closed', mouth: null, look: [-2, 0] }))
  for (let d = 3; d <= 7; d++) times(2, () => tick(puff, [bubGrow(d)]))
  times(2, () => tick({ mouth: null, blush: false, eyes: 'open' }, [bubGrow(7)]))
  for (let T = 1; T < T_PACK; T++) {
    let face: Frame
    if (T < 8) face = { look: [-2, 0], eyes: 'open', mouth: null }
    else if (T < 10) face = { eyes: 'closed', mouth: null, look: [-2, 0], blush: false }
    else if (T < 18) face = puff
    else if (T < 20) face = { mouth: null, blush: false, eyes: 'open', look: [-2, 0] }
    else if (T < 41) face = { look: [-2, 0], eyes: 'open', mouth: null }
    else if (T < 45) face = { eyes: 'wide', mouth: 'o' }
    else if (T < 47) face = { eyes: 'open', mouth: null, look: [-2, 0] }
    else if (T < 55) face = { eyes: T % 4 < 2 ? 'happy' : 'open', blush: true, fy: T % 4 < 2 ? -1 : 0, mouth: null }
    else face = { eyes: 'open', blush: false, fy: 0, look: [-2, 0], mouth: null }
    tick(face, [...B1(T), ...B2(T)])
  }
  return body
}
/** Stab aus der Tasche: kramen, Fund (winzig über der Hand), hochhalten (wächst), dann seitlich absenken, bis die Hand ihn am Griff hält. Das Wegpacken ist dasselbe rückwärts. */
const wandAt = (x: number, y: number): PropRef => G('fun_wand1', x, y)
const WAND_IN: Frame[] = [
  ...rummageFrames(3, [G('fun_wand1@33', -1, -2)]),
  { ...FULL, armL: 'raise', props: [G('fun_wand1@44', -2, -4)], t: 2 },
  { ...FULL, ...handL(4, 3), look: [-2, 1], props: [wandAt(-4, -3)], t: 1 },
  { ...FULL, ...handL(4, 5), look: [-2, 1], props: [wandAt(-5, -1)], t: 1 },
  { ...FULL, ...handL(4, 7), look: [-2, 1], props: [wandAt(WAND.at[0], WAND.at[1])], t: 2 },
]
/** Ausklang: Der Stab wird tickweise weggepackt (Intro rückwärts), die zweite Blase fliegt dabei weiter; danach sieht er sie platzen und lacht. */
function bubbleOutro(): Frame[] {
  const out: Frame[] = []
  let T = T_PACK
  for (const fr of [...WAND_IN].reverse()) {
    for (let k = 0; k < (fr.t ?? 1); k++) out.push({ ...fr, props: [...(fr.props ?? []), ...B2(T++)], t: 1 })
  }
  for (; T < T_POP2 + 6; T++) {
    const popping = T >= T_POP2
    out.push({ ...FULL, look: [-2, 0], eyes: popping && T < T_POP2 + 4 ? 'wide' : 'open', mouth: popping && T < T_POP2 + 4 ? 'o' : null, props: B2(T), t: 1 })
  }
  for (let i = 0; i < 6; i++) out.push({ ...FULL, look: [-2, 1], props: B2(T++), t: 1 })
  for (let i = 0; i < 2; i++) {
    out.push({ ...FULL, eyes: 'happy', blush: true, fy: -1, props: [], t: 2 })
    out.push({ ...FULL, blush: true, fy: 0, props: [], t: 2 })
  }
  out.push({ ...FULL, blush: false, fy: 0, props: [], t: 2 })
  return out
}
C('bubbles', 'Seifenblasen', 'fun', { interruptible: false, mirror: false, intro: WAND_IN, frames: bubbleBody(), outro: bubbleOutro() });

C('hop', 'Hüpfen', 'fun', { interruptible: true, frames: [
  ...rep(2, [{ by: 1, t: 2 }, { by: 0, fy: -2, legs: 'tuck', eyes: 'happy', armL: 'up1', armR: 'up1', t: 2 }, { fy: -1, t: 1 }, { fy: 0, by: 1, legs: 'spread', t: 1 }, { by: 0, legs: 'stand', t: 2 }]),
  { armL: 'down', armR: 'down', eyes: 'open', t: 3 }] });

// ---- Laune-Clips (temper), am Ende der Gruppe (der erste Clip bleibt neutral).
// Missmutiger Kick: halbe Augen, flacher Mund, er kickt gegen die Luft (Staubwölkchen am Fuß, ein kleines Dampfwölkchen über dem Kopf), tritt noch einmal und gibt auf.
const dust = (x: number): PropRef => ['puff', x, 7]
C('grumble_kick', 'Kickt missmutig', 'fun', { temper: 'bad', interruptible: true, frames: [
  { eyes: 'half', mouth: 'flat', look: [0, 1], armL: 'up1', armR: 'up1', t: 3 },
  { legs: 'kickR', by: 1, t: 2 }, { legs: 'stand', by: 0, props: [dust(16)], t: 2 },
  { props: [dust(17), ['steam1', 11, -2]], t: 2 }, { props: [['steam2', 11, -3]], t: 3 }, { props: [['steam1', 12, -3]], t: 3 },
  { props: [], t: 2 }, { legs: 'kickL', by: 1, t: 2 }, { legs: 'stand', by: 0, props: [dust(-4)], t: 2 }, { props: [dust(-5)], t: 2 },
  { armL: 'down', armR: 'down', look: [0, 0], mouth: null, eyes: 'open', props: [], t: 3 }] });
// Fröhliches Summen (gute Laune): er wippt im Takt, Noten steigen vom Kopf auf, am Ende ein Herz.
const hum = (i: number): readonly PropRef[] => [['note', 16, 1 - (i % 3)], ['note', 20, -1 - (i % 2) * 2]]
C('happy_hum', 'Summt fröhlich', 'fun', { temper: 'good', interruptible: true, frames: [
  { eyes: 'happy', mouth: 'o', t: 1 },
  ...Array.from({ length: 6 }, (_, i): Frame[] => [
    { by: 1, armL: i % 2 ? 'up1' : 'down', armR: i % 2 ? 'down' : 'up1', props: hum(i), t: 2 },
    { by: 0, mouth: i % 2 ? 'smile' : 'o', t: 2 },
  ]).flat(),
  { by: 0, armL: 'down', armR: 'down', mouth: 'smile', props: [['heart', 16, -1]], t: 4 }, { props: [['heart', 17, -3]], t: 3 },
  { props: [], eyes: 'open', mouth: null, t: 2 }] });
// Nickerchen im Sitzen (müde): setzt sich, nickt weg (Kopf sackt, zZ), schreckt leicht hoch und steht wieder auf.
C('nap_sitting', 'Nickerchen im Sitzen', 'fun', { temper: 'tired', interruptible: true, frames: [
  { eyes: 'half', t: 3 }, { by: 1, t: 2 }, { by: 2, t: 4 },
  { eyes: 'closed', squash: 1, props: [['zs', 16, 1]], t: 4 }, { squash: 0, props: [['zs', 17, -1]], t: 3 },
  { eyes: 'closed', squash: 1, props: [['zb', 16, -1]], t: 5 },
  // schreckt hoch
  { eyes: 'wide', squash: 0, by: 1, mouth: 'o', props: [], t: 2 }, { by: 2, eyes: 'half', mouth: null, t: 4 },
  { by: 1, t: 2 }, { by: 0, eyes: 'open', t: 3 }] });

// ===================================================================================================================
// Tageszeit- und Sonderclips (Nacht ruhig, Geburtstag, Silvester). Koordinaten wie oben: 'g' = relativ zum Heimatplatz, ohne Flag relativ zur Figur.
// Effekte (Funken, Flammen, Rauch, Konfetti, Sterne, Luftballon) müssen dort entstehen und vergehen, wo sie nahe an der Figur sind (Lint); Gegenstände kommen aus der Tasche
// oder von unten. Augen nur open/wide/half/closed (rechteckig).
// ===================================================================================================================
const PROPS_NEW: Record<string, PropSprite> = {
  // Teelicht (5×3): Docht, Wachs, Aluschälchen; Flamme als Effekt (0 = Funke beim Anzünden, 1/2 flackern, 3 = vom Pusten nach links gebogen)
  fun_tea: s(['..D..', 'CCCCC', 'GGGGG']),
  fun_flame0: fxp(['Y']),
  fun_flame1: fxp(['.Y.', 'YWY']),
  fun_flame2: fxp(['..Y', 'YWY']),
  fun_flame3: fxp(['Y..', 'YW.']),
  // Zaun (7×4) und Schäfchen (6×4: weiße Wolle, grauer Kopf und Beine; 2 = Beine gestreckt im Sprung)
  fun_fence: s(['R.R.R.R', 'CCCCCCC', 'R.R.R.R', 'R.R.R.R']),
  fun_sh1: s(['.WWW..', 'WWWWWG', 'WWWWWG', '.G..G.']),
  fun_sh2: s(['.WWW..', 'WWWWWG', 'WWWWWG', 'G....G']),
  // Sterne (Effekte): 1 = kleiner Punkt, 2 = Funkeln; Sternschnuppe 3×1 mit Schweif
  fun_st1: fxp(['W']),
  fun_st2: fxp(['.Y.', 'YWY', '.Y.']),
  fun_shoot: fxp(['GWW']),
  // Torte (9×6): drei Kerzen (rot, blau, grün), rosa Guss, Creme, Schokolade, weißer Teller; Kerzenflammen (1×2, Effekte) flackern
  fun_cake: s(['..M.B.E..', '..M.B.E..', 'PPPPPPPPP', 'CCCCCCCCC', 'RRRRRRRRR', 'WWWWWWWWW']),
  fun_cf1: fxp(['Y', 'W']),
  fun_cf2: fxp(['W', 'Y']),
  // Konfetti (Einzelpixel-Effekte in sechs Farben)
  fun_cp: fxp(['P']), fun_cb: fxp(['B']), fun_ce: fxp(['E']), fun_cm: fxp(['M']), fun_cl: fxp(['L']),
  // Partyhut (5×4): gelber Bommel, roter Kegel mit blauem Band
  fun_hat: s(['..Y..', '..M..', '.MBM.', 'MMMMM']),
  // Luftschlangen (3×4, wellig, Effekte) in Rosa/Gelb/Blau
  fun_strp1: fxp(['P..', '.P.', '..P', '.P.']), fun_strp2: fxp(['..P', '.P.', 'P..', '.P.']),
  fun_stry1: fxp(['Y..', '.Y.', '..Y', '.Y.']), fun_stry2: fxp(['..Y', '.Y.', 'Y..', '.Y.']),
  fun_strb1: fxp(['B..', '.B.', '..B', '.B.']), fun_strb2: fxp(['..B', '.B.', 'B..', '.B.']),
  // Luftballon (Effekt, 4×5 mit Schnur): 1 = ganz, 2 = geplatzt (Stern 5×5), 3 = Reste (3×3)
  fun_bal1: fxp(['.MM.', 'MWMM', 'MMMM', '.MM.', '..G.']),
  fun_bal2: fxp(['M.M.M', '.MWM.', 'MWWWM', '.MWM.', 'M.M.M']),
  fun_bal3: fxp(['M.M', '.M.', 'M.M']),
  // Feuerwerk: Rakete (1×3, Effekt) und Funken in Farben (Einzelpixel-Effekte)
  fun_rk1: fxp(['W', 'Y', 'M']), fun_rk2: fxp(['W', 'M', 'Y']),
  fun_fwm: fxp(['M']), fun_fwb: fxp(['B']), fun_fwe: fxp(['E']), fun_fwp: fxp(['P']), fun_fwl: fxp(['L']),
  // Wunderkerze (1×6): dunkle Spitze, grauer Draht
  fun_spk: s(['D', 'G', 'G', 'G', 'G', 'G']),
}

// ---- Teelicht
const TEA = { name: 'fun_tea', size: [5, 3] as const, at: [-6, 7] as const, side: 'L' as const }
const teaP = G('fun_tea', -6, 7)
const flame = (n: number): PropRef => (n === 0 ? G('fun_flame0', -4, 6) : G('fun_flame' + n, -5, 5))
const smoke = (i: number): PropRef => G(i % 2 ? 'steam2' : 'steam1', -4 + (i % 2), 5 - 2 * i)
const sit = (by: number): Frame => ({ by, eyes: 'half', look: [-1, 1], armL: 'down', armR: 'down', mouth: null })
const FLICKER = [1, 2, 1, 1, 2, 1, 2, 1, 1, 2, 2, 1, 2, 1]
C('night_candle', 'Teelicht in der Nacht', 'fun', { daypart: NIGHT, interruptible: false, intro: fetchIn(TEA), frames: [
  // setzt sich, halbe Augen; zündet an (ein Funke, dann die Flamme)
  { ...sit(1), props: [teaP], t: 2 }, { ...sit(2), props: [teaP], t: 3 },
  { props: [teaP, flame(0)], t: 2 },
  // schaut in die Flamme, nickt dabei leicht ein
  ...FLICKER.flatMap((n, i): Frame[] => (i === 4 || i === 10
    ? [{ eyes: 'closed', by: 3, props: [teaP, flame(n)], t: 2 }, { eyes: 'half', by: 2, props: [teaP, flame(n)], t: 2 }]
    : [{ ...sit(2), props: [teaP, flame(n)], t: 2 }])),
  // tief Luft holen, pusten (die Flamme biegt sich weg), aus; ein Rauchfaden steigt auf
  { by: 1, eyes: 'closed', props: [teaP, flame(1)], t: 3 },
  { by: 2, eyes: 'half', mouth: 'o', props: [teaP, flame(3)], t: 2 },
  { props: [teaP, flame(0)], t: 1 },
  ...[0, 1, 2, 3].map((i): Frame => ({ mouth: i < 2 ? 'o' : null, props: [teaP, smoke(i)], t: 2 })),
  { by: 1, eyes: 'closed', mouth: 'smile', props: [teaP], t: 3 },
  { by: 0, eyes: 'open', mouth: null, look: [0, 1], t: 2 },
], outro: fetchOut(TEA) });

// ---- Schäfchen zählen
const FENCE = { name: 'fun_fence', size: [7, 4] as const, at: [-20, 6] as const }
const sheepAt = (t: number, N: number): PropRef | null => {
  if (t < 0 || t > N) return null
  const y = 10 - Math.round(12 * Math.sin((Math.PI * t) / N))
  if (y >= HIDDEN_GY) return null
  return G(y < 5 ? 'fun_sh2' : 'fun_sh1', -32 + Math.round((24 * t) / N), y)
}
function sheepFrames(): Frame[] {
  const f: Frame[] = []
  const fence = G('fun_fence', FENCE.at[0], FENCE.at[1])
  const jumps: [number, number][] = [[0, 14], [20, 14], [42, 18]]
  const apex = jumps.map(([t0, N]) => t0 + Math.round(N / 2))
  for (let T = 0; T <= 74; T++) {
    const sheep = jumps.map(([t0, N]) => sheepAt(T - t0, N)).filter((p): p is PropRef => p !== null)
    const high = sheep.some((p) => p[2] < 4)
    const asleep = T >= 62
    const nod = apex.some((a) => T === a || T === a + 1) && T < 62
    const fr: Frame = {
      by: asleep ? 3 : nod ? 3 : 2,
      eyes: asleep ? 'closed' : T < 20 ? 'open' : 'half',
      look: [-1, high ? -1 : 0],
      mouth: null,
      props: [fence, ...sheep, ...(asleep && T < 72 ? [['zs', 16 + (T % 3 === 0 ? 1 : 0), 1 - Math.floor((T - 62) / 5)] as PropRef] : [])],
      t: 1,
    }
    f.push(fr)
  }
  // schreckt kurz hoch: ein Blick, dann gähnt er
  f.push({ by: 1, eyes: 'wide', mouth: 'o', look: [0, 0], props: [fence], t: 2 })
  f.push({ by: 2, eyes: 'half', mouth: 'yawn', props: [fence], t: 3 })
  f.push({ mouth: null, props: [fence], t: 1 })
  return f
}
const sheepOutro = (): Frame[] => [
  ...sinkOut({ name: 'fun_fence', size: FENCE.size, at: FENCE.at, during: { by: 2, eyes: 'half', look: [-1, 1], mouth: null } }),
  { by: 1, eyes: 'open', look: [0, 0], t: 2 }, { by: 0, t: 2 },
]
C('night_sheep', 'Schäfchen zählen', 'fun', { daypart: NIGHT, interruptible: false, intro: [
  { by: 1, eyes: 'half', look: [-1, 1], t: 2 }, { by: 2, t: 2 },
  ...riseIn({ name: 'fun_fence', size: FENCE.size, at: FENCE.at, during: { by: 2, eyes: 'open', look: [-1, 0] } }),
], frames: sheepFrames(), outro: sheepOutro() });

// ---- Sterne gucken
const STARS: readonly (readonly [number, number])[] = [[-2, -2], [4, -1], [10, -2], [15, -1], [20, -2]]
const starProp = (i: number, T: number, from: number, to: number): PropRef[] => {
  const at = from + 2 * i
  const end = to + 2 * i
  if (T < at || T >= end) return []
  const [x, y] = STARS[i]
  const ph = (T - at + 3 * i) % 8
  return ph < 4 || ph >= 6 ? [G('fun_st1', x, y)] : [G('fun_st2', x - 1, y - 1)]
}
function starFrames(): Frame[] {
  const f: Frame[] = []
  const LIE: Frame = { by: 2, squash: 2, armL: 'out', armR: 'out', legs: 'stand' }
  f.push({ by: 1, look: [0, -1], t: 2 })
  f.push({ by: 2, squash: 1, armL: 'out', armR: 'out', t: 2 })
  f.push({ ...LIE, look: [0, -1], eyes: 'open', t: 2 })
  for (let T = 0; T < 50; T++) {
    const props = STARS.flatMap((_, i) => starProp(i, T, 2, 38))
    const k = T - 22
    if (k >= 0 && k < 8) props.push(G('fun_shoot', -3 + 3 * k, 1 + Math.floor(k / 3)))
    const wish = T >= 31 && T < 37
    f.push({ ...LIE, eyes: wish ? 'closed' : 'open', look: [k >= 0 && k < 8 ? Math.min(1, Math.floor(k / 3) - 1) : 0, -1], mouth: k >= 0 && k < 8 ? 'o' : T >= 37 ? 'smile' : null, blush: wish, props, t: 1 })
  }
  f.push({ ...LIE, mouth: null, blush: false, eyes: 'half', props: [], t: 3 })
  f.push({ by: 2, squash: 1, eyes: 'open', look: [0, 0], armL: 'down', armR: 'down', t: 2 })
  f.push({ by: 1, squash: 0, t: 2 })
  f.push({ by: 0, t: 2 })
  return f
}
C('night_stars', 'Sterne gucken', 'fun', { daypart: NIGHT, interruptible: false, frames: starFrames() });

// ---- Geburtstag: Torte
const CAKE = { name: 'fun_cake', size: [9, 6] as const, at: [-8, 4] as const, side: 'L' as const }
const cakeP = G('fun_cake', -8, 4)
const CANDLES = [-6, -4, -2]
const flames = (n: number, ph: number): PropRef[] => CANDLES.slice(0, n).map((x, i) => G('fun_cf' + (1 + ((ph + i) % 2)), x, 2))
const CONF_NAMES = ['dotY', 'dotW', 'fun_cp', 'fun_cb', 'fun_ce', 'fun_cm']
const CONF_A = [9, -9, 12, -12, 15, -16]
const confetti = (k: number): PropRef[] =>
  CONF_NAMES.flatMap((nm, i): PropRef[] => {
    const x = Math.round(8 + CONF_A[i] * (1 - Math.pow(0.7, k)))
    const y = Math.round(-1 + (-1.3 - 0.12 * i) * k + 0.45 * k * k)
    return y > 6 || (y >= 3 && x <= 1) ? [] : [[nm, x, y]] // links fallen sie nie auf die Torte: dort vergehen sie über ihr, nahe an seinem Arm
  })
const note = (i: number): PropRef => ['note', 16 + (i % 2), 1 - (i % 3)]
C('bday_cake', 'Geburtstagstorte', 'fun', { special: 'birthday', interruptible: false, intro: fetchIn(CAKE), frames: [
  // schaut auf die Torte; die Kerzen werden angezündet (links nach rechts)
  { look: [-1, 1], props: [cakeP], t: 3 },
  ...[1, 2, 3].map((n): Frame => ({ props: [cakeP, ...flames(n, 0)], t: 3 })),
  // singt (Noten steigen auf), wippt im Takt, die Flammen flackern
  ...Array.from({ length: 8 }, (_, i): Frame[] => [
    { by: 1, mouth: 'o', armL: i % 2 ? 'up1' : 'down', armR: i % 2 ? 'down' : 'up1', props: [cakeP, ...flames(3, i), note(i)], t: 2 },
    { by: 0, mouth: 'smile', props: [cakeP, ...flames(3, i + 1), note(i + 1)], t: 2 },
  ]).flat(),
  // Wunsch: Augen zu, tief einatmen, pusten: die Flammen gehen nacheinander aus, Rauch steigt auf
  { armL: 'down', armR: 'down', by: 1, mouth: null, eyes: 'closed', look: [0, 0], props: [cakeP, ...flames(3, 0)], t: 4 },
  { by: 0, mouth: 'o', eyes: 'half', look: [-1, 1], props: [cakeP, ...flames(3, 1)], t: 2 },
  { props: [cakeP, ...flames(2, 0)], t: 1 }, { props: [cakeP, ...flames(1, 1)], t: 1 }, { props: [cakeP], t: 1 },
  ...[0, 1, 2].map((i): Frame => ({ mouth: i < 2 ? 'o' : null, eyes: 'open', props: [cakeP, ...CANDLES.map((x) => G(i % 2 ? 'steam2' : 'steam1', x, 2 - i))], t: 2 })),
  { props: [cakeP], t: 1 },
  // Jubel: Konfetti, Arme hoch, Hüpfer, strahlen
  { eyes: 'closed', mouth: 'smile', blush: true, armL: 'up2', armR: 'up2', fy: -1, props: [cakeP, ...confetti(1)], t: 2 },
  ...[2, 3, 4, 5, 6, 7].map((k): Frame => ({ fy: k % 2 ? 0 : -1, armL: k % 2 ? 'up1' : 'up2', armR: k % 2 ? 'up1' : 'up2', props: [cakeP, ...confetti(k)], t: 2 })),
  { fy: 0, armL: 'down', armR: 'down', eyes: 'open', mouth: null, blush: false, look: [-1, 1], props: [cakeP], t: 3 },
], outro: fetchOut(CAKE) });

// ---- Partyhut: aus der Tasche, Wurf auf den Kopf (der Hut sitzt über dem Kopf, x 6 bis 10); das Absetzen ist dasselbe rückwärts
const HAT: PropRef = ['fun_hat', 6, -4]
const hatIn = (): Frame[] => [
  ...rummageFrames(3, [['fun_hat@60', -1, -1]]),
  { ...FULL, armL: 'raise', props: [['fun_hat@80', -2, -3]], t: 2 },
  { ...FULL, armL: 'raise', props: [['fun_hat', -2, -4]], t: 1 },
  { ...FULL, armL: 'up2', props: [['fun_hat', 2, -4]], t: 1 },
  { ...FULL, armL: 'down', props: [['fun_hat', 5, -4]], t: 1 },
  { ...FULL, props: [HAT], t: 2 },
]
const reverseFrames = (fr: readonly Frame[]): Frame[] => [...fr].reverse().map((x) => ({ ...x }))
const streamer = (c: 'p' | 'y' | 'b', x0: number, x1: number, k: number, n: number): PropRef => {
  const x = Math.round(x0 + ((x1 - x0) * k) / n)
  const y = -4 + Math.round((8 * k) / n)
  return ['fun_str' + c + (1 + (k % 2)), x, y]
}
const balloonPath: [number, number][] = [[-9, 10], [-9, 8], [-9, 6], [-9, 4], [-8, 2], [-6, 0], [-3, -2], [0, -3], [2, -4]]
C('bday_party', 'Geburtstagsparty', 'fun', { special: 'birthday', interruptible: false, intro: hatIn(), frames: [
  // freut sich über den Hut; Luftschlangen schießen aus den hochgerissenen Armen und trudeln herab
  { mouth: 'smile', eyes: 'closed', blush: true, by: 1, props: [HAT], t: 2 }, { by: 0, eyes: 'open', t: 2 },
  { armL: 'raise', armR: 'raise', props: [HAT, streamer('p', -4, -6, 0, 8), streamer('b', 18, 20, 0, 8)], t: 1 },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((k): Frame => ({
    fy: 0, armL: k < 5 ? 'raise' : 'up2', armR: k < 5 ? 'raise' : 'up2',
    props: [HAT, streamer('p', -4, -6, k, 8), streamer('b', 18, 20, k, 8)], t: 2,
  })),
  // kleines Tänzchen mit Hut und Noten
  ...[0, 1, 2, 3].flatMap((i): Frame[] => [
    { fy: 0, armL: 'up2', armR: 'down', legs: 'stepA', fx: -1, eyes: 'closed', mouth: 'smile', props: [HAT, ...(i % 2 ? [['note', -4, 0] as PropRef] : [])], t: 3 },
    { armL: 'down', armR: 'up2', legs: 'stepB', fx: 1, props: [HAT, ...(i % 2 ? [['note', 18, -1] as PropRef] : [])], t: 3 },
  ]),
  { fx: 0, legs: 'stand', armL: 'down', armR: 'down', eyes: 'open', mouth: null, blush: false, props: [HAT], t: 2 },
  // ein Luftballon steigt von unten links auf, schwebt über seinen Kopf und platzt; er schreckt hoch und lacht
  ...balloonPath.map(([x, y], i): Frame => ({ look: [-1, i > 4 ? -1 : 0], props: [HAT, G('fun_bal1', x, y)], t: 2 })),
  { props: [HAT, G('fun_bal1', 2, -4)], eyes: 'wide', t: 3 },
  { props: [HAT, G('fun_bal2', 1, -4)], eyes: 'wide', mouth: 'o', armL: 'up2', armR: 'up2', by: 1, t: 2 },
  { props: [HAT, G('fun_bal3', 2, -3)], fy: 0, t: 2 },
  { props: [HAT], eyes: 'closed', mouth: 'smile', blush: true, look: [0, 0], armL: 'down', armR: 'down', t: 4 },
  { eyes: 'open', mouth: null, blush: false, t: 2 },
], outro: [...reverseFrames(hatIn()), { ...FULL, props: [], t: 2 }] });

// ---- Silvester: Feuerwerk
const FW_COLORS = ['fun_fwm', 'dotY', 'fun_fwb', 'dotW', 'fun_fwe', 'fun_fwp', 'fun_fwl', 'dotY']
const FW_DIRS: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
const FW_R = [1, 2, 3, 3, 3, 3]
const FW_G = [0, 0, 0, 1, 2, 3]
/** Funkenkranz um (cx, cy) im k-ten Tick (0 = Rakete steigt noch): 8 Funken, die auseinanderfliegen und herabsinken; die letzten Funken erlöschen. */
const burst = (cx: number, cy: number, k: number, off: number): PropRef[] =>
  k < 1 || k > 6 ? [] : FW_DIRS.flatMap(([dx, dy], i): PropRef[] => {
    if (k === 6 && i % 2) return []
    const r = FW_R[k - 1]
    const d = dx && dy ? Math.round(r * 0.75) : r
    return [[FW_COLORS[(i + off) % 8], cx + dx * d, Math.max(-4, cy + dy * d + FW_G[k - 1])]]
  })
const rocket = (x: number, k: number): PropRef[] => (k < 0 || k > 5 ? [] : [['fun_rk' + (1 + (k % 2)), x, 10 - 2 * k]])
function fireworkFrames(): Frame[] {
  const f: Frame[] = []
  const launches: [number, number, number][] = [[0, -3, 0], [8, 19, 3], [18, -3, 5], [18, 19, 1]]
  for (let T = 0; T < 40; T++) {
    const props: PropRef[] = []
    for (const [t0, x, off] of launches) {
      const k = T - t0
      props.push(...rocket(x, k), ...burst(x, -1, k - 5, off))
    }
    const bursting = T >= 5
    f.push({
      eyes: bursting ? 'wide' : 'open', mouth: bursting ? 'o' : null, look: [T % 14 < 7 ? -1 : 1, -1],
      armL: T >= 6 ? (T % 4 < 2 ? 'up2' : 'up1') : 'down', armR: T >= 6 ? (T % 4 < 2 ? 'up1' : 'up2') : 'down',
      fy: T >= 8 && T % 6 < 2 ? -1 : 0, props, t: 1,
    })
  }
  f.push({ fy: 0, armL: 'down', armR: 'down', eyes: 'closed', mouth: 'smile', blush: true, look: [0, 0], props: [], t: 4 })
  f.push({ eyes: 'open', mouth: null, blush: false, t: 2 })
  return f
}
C('ny_fireworks', 'Feuerwerk', 'fun', { special: 'newyear', interruptible: false, frames: [{ look: [0, -1], t: 3 }, ...fireworkFrames()] });

// ---- Silvester: Wunderkerze (mit Partyhut)
const SPK_P = (x: number, y: number): PropRef => G('fun_spk', x, y)
const sparkIn = (): Frame[] => {
  const keep: PropRef[] = [HAT]
  const rm = rummageFrames(3, [['fun_spk@50', 0, -2], HAT]).map((fr, i, arr) => (i < arr.length - 1 ? { ...fr, props: keep } : fr))
  return [
    ...rm,
    { ...FULL, ...handL(2, 2), props: [HAT, G('fun_spk@83', 0, -1)], t: 1 },
    { ...FULL, ...handL(3, 3), props: [HAT, SPK_P(-1, -2)], t: 2 },
  ]
}
/** Funken an der Spitze (tx, ty) im Takt k: vier Einzelpixel, die jeden Tick wechseln; nie auf dem Draht. */
const SPARK_PAT: readonly (readonly (readonly [number, number, string])[])[] = [
  [[-2, -1, 'dotY'], [1, -2, 'dotW'], [-1, -2, 'dotY'], [2, 0, 'dotW']],
  [[1, -1, 'dotW'], [-2, -2, 'dotY'], [0, -2, 'dotW'], [-2, 1, 'dotY']],
  [[-1, -2, 'dotY'], [2, -1, 'dotW'], [-2, 0, 'dotW'], [1, -2, 'dotY']],
  [[2, -2, 'dotY'], [-2, -1, 'dotW'], [1, 0, 'dotY'], [-1, -2, 'dotW']],
]
const sparks = (tx: number, ty: number, k: number, n = 4): PropRef[] => SPARK_PAT[k % 4].slice(0, n).map(([dx, dy, nm]) => G(nm, tx + dx, ty + dy))
const WAVE: readonly (readonly [number, number])[] = [[-1, -2], [-2, -1], [-2, 0], [-1, 0], [0, -1], [0, -2]]
C('ny_sparkler', 'Wunderkerze', 'fun', { special: 'newyear', interruptible: false, intro: [...hatIn(), ...sparkIn()], frames: [
  ...Array.from({ length: 20 }, (_, k): Frame => {
    const [tx, ty] = WAVE[k % WAVE.length]
    return { ...handL(2 - tx, ty + 5), armR: k % 4 < 2 ? 'up1' : 'down', eyes: 'open', look: [-1, 0], mouth: 'smile', props: [HAT, SPK_P(tx, ty), ...sparks(tx, ty, k)], t: 2 }
  }),
  // die Funken werden weniger und erlöschen, dann wandert der Draht zurück in die Tasche
  ...[3, 2, 1].map((n, k): Frame => ({ ...handL(3, 3), mouth: null, props: [HAT, SPK_P(-1, -2), ...sparks(-1, -2, k, n)], t: 3 })),
  { ...handL(3, 3), props: [HAT, SPK_P(-1, -2)], t: 2 },
], outro: [...reverseFrames(sparkIn()), ...reverseFrames(hatIn()), { ...FULL, props: [], t: 2 }] });

export const PROPS: Readonly<Record<string, PropSprite>> = { ...PROPS_BASE, ...PROPS_NEW }
export const CLIPS: readonly ClipDef[] = out
