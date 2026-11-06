// clawd-buddy: Clips der Gruppe "frost" (0.13.0, SPEC „Ausbau 0.13.0“ Teil A): Bei kaltem Cache oder im neuen Chat steht Clawd manchmal
// eingefroren in einem Eisklumpen. Tippen macht Risse, Senden zerbricht das Eis (oder es schmilzt), er schüttelt sich frei.
//
// Ablauf und Posen: Der Block gehört zur kanonischen Pose `ice` (stage.ts → POSES): Arme verschränkt, Block und Glanz stehen. So bleibt er
// über mehrere Clips stehen (frost_in → frozen → frost_crack → frost_break/frost_melt), ohne dass ein Clip ihn liegen lassen muss.
//   frost_in     stand → ice   Frost kriecht von der Linie hoch, er zittert und reibt sich die Arme, schaut überrascht, der Block schließt sich
//   frozen       ice → ice     Schleife: starr im Eis, Glanzlicht wandert über die Kante, ab und zu ein Schneekristall; nachts schläft er (zZ)
//   frost_crack  ice → ice     Riss-Stufe 1, 2, 3 (frost_crack1 … 3), Schleife, bleibt gerissen stehen
//   frost_break  ice → stand   Block springt in Splitter, die hinter die Linie fallen; er schüttelt sich, bibbert, niest, reibt sich warm
//   frost_melt   ice → stand   Block schmilzt von oben, Tropfen, Pfütze; er schüttelt einen Fuß aus, reibt sich warm, die Pfütze versickert
//   freeze/thaw  Übergänge stand ↔ ice (ruhig, ohne Zittern, ohne Splitter): für reduzierte Bewegung und jeden anderen Ausstieg aus dem Eis
// frost_break und frost_melt gibt es je Riss-Stufe (…0 bis …3), damit der Riss beim Auftauen nicht zurückspringt; die Engine wählt die passende.
//
// Zeichnung: Der Block (frost_ice…) liegt HINTER der Figur (`under`), sein Inneres ist ein dunkles Eisblau (PAL I); Glanz und Risse
// (frost_fx…) liegen als Effekt VOR ihr, nie über einem Auge. Alle Eis-Bilder haben eine verdeckte Zeile unter der Linie: der Block steckt im
// Boden, Frost wächst von dort hoch und die Pfütze versickert dorthin (ANIMATION-GUIDE §0: rein und raus nur nach unten).
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'

// ---- Geometrie -------------------------------------------------------------------------------------------------------------------
// Alle Eis-Bilder: 23 breit, 13 hoch, Ursprung (−3, −2) relativ zum Heimatplatz. Spalte cx = x + 3, Zeile cy = y + 2.
// Der Block selbst reicht von x −1 bis 17 (19 breit, 1–2 px Rand um die Figur mit verschränkten Armen) und von y −2 bis 9 (Zeile 12 = y 10
// liegt hinter der Linie). Die Pfütze ist breiter (bis x −2 … 18).
const SW = 23
const SH = 13
const OX = -3
const OY = -2
const BL = 2 // Spalte des linken Blockrands
const BR = 20 // Spalte des rechten Blockrands
const at = (name: string): PropRef => [name, OX, OY, 'g']

const blank = (): string[][] => Array.from({ length: SH }, () => Array.from({ length: SW }, () => '.'))
const rowsOf = (g: string[][]): string[] => g.map((r) => r.join(''))

/** Blockreihe: Rand hellblau, Inneres Eisblau. */
function fillRow(g: string[][], cy: number): void {
  for (let cx = BL; cx <= BR; cx++) g[cy][cx] = cx === BL || cx === BR ? 'L' : 'I'
}

/** Voller Block. `glint` 0 = nur der feste Glanz oben links, 1 … 6 = ein Glanzlicht wandert über die obere und die rechte Kante. */
function full(glint: number): PropSprite {
  const g = blank()
  for (let cx = BL + 1; cx < BR; cx++) g[0][cx] = 'L'
  for (let cy = 1; cy < SH; cy++) fillRow(g, cy)
  // fester Glanz: obere linke Kante
  g[0][4] = g[0][5] = 'W'
  g[1][BL] = g[2][BL] = 'W'
  const top = (a: number, b: number) => { for (let cx = a; cx <= b; cx++) g[0][cx] = 'W' }
  const side = (a: number, b: number) => { for (let cy = a; cy <= b; cy++) g[cy][BR] = 'W' }
  if (glint === 1) top(7, 9)
  if (glint === 2) top(11, 13)
  if (glint === 3) top(15, 17)
  if (glint === 4) { top(18, 19); side(1, 1) }
  if (glint === 5) side(3, 5)
  if (glint === 6) side(7, 9)
  return { rows: rowsOf(g), under: true }
}

/**
 * Wachsender Frost: `h` Zeilen von unten (die unterste liegt hinter der Linie). Die oberste Reihe ist eine durchgehende Kristallkante
 * (Hellblau mit weißen Funken, ohne Lücken: hinter dem Kopf zerfiele sie sonst in Einzelteile, die aus dem Nichts auftauchen).
 */
function growing(h: number): PropSprite {
  const g = blank()
  const top = SH - h
  for (let cy = top + 1; cy < SH; cy++) fillRow(g, cy)
  for (let cx = BL; cx <= BR; cx++) g[top][cx] = (cx + h) % 4 === 0 && cx !== BL && cx !== BR ? 'W' : 'L'
  return { rows: rowsOf(g), under: true }
}

/**
 * Frostlinie VOR der Figur (Effekt): Kristalle eine Reihe über der wachsenden Kante, damit man sieht, wie der Frost an ihm hochkriecht.
 * Sie liegt nie auf dem Block selbst (sonst zerlegte sie dessen Kante) und nie über einem Auge (x 3–5 und 11–13 in den Augenzeilen y 1–4).
 */
function frostLine(h: number): PropSprite {
  const g = blank()
  const cy = SH - h - 1
  const y = cy + OY
  for (let cx = BL + 2; cx <= BR - 2; cx++) {
    const x = cx + OX
    if (y >= 1 && y <= 4 && ((x >= 3 && x <= 5) || (x >= 11 && x <= 13))) continue
    if ((cx + h) % 2 === 0) g[cy][cx] = (cx + h) % 4 === 0 ? 'W' : 'L'
  }
  return { rows: rowsOf(g), effect: true }
}

/** Schmelzender Block: oben `m` Zeilen weg; die neue Oberkante ist rund und nass (Glanz), an den Seiten hängen Tropfen. */
function melting(m: number): PropSprite {
  const g = blank()
  for (let cx = BL + 1; cx < BR; cx++) g[m][cx] = 'L'
  for (let cy = m + 1; cy < SH; cy++) fillRow(g, cy)
  g[m][5] = g[m][6] = 'W'
  if (m + 1 < SH - 1) g[m + 1][BR] = 'W'
  return { rows: rowsOf(g), under: true }
}

/** Pfütze an den Füßen (Zeile y 9), Stufe 0 breit … 3 schmal; darunter die verdeckte Zeile: sie versickert hinter der Linie. */
const PUDDLE: readonly (readonly [number, number])[] = [[1, 21], [3, 19], [6, 16], [9, 13]]
function puddle(n: number): PropSprite {
  const g = blank()
  const [a, b] = PUDDLE[n]
  for (let cx = a; cx <= b; cx++) g[SH - 2][cx] = cx === a || cx === b ? 'B' : 'L'
  for (let cx = a; cx <= b; cx++) g[SH - 1][cx] = 'B'
  return { rows: rowsOf(g), under: true }
}

// ---- Glanz und Risse (vor der Figur, Effekt) ---------------------------------------------------------------------------------------
// Punkte in Heimatplatz-Koordinaten (x, y). Augen liegen bei x 4 und 12, y 2–3 (Blick ±1): dort nie zeichnen.
type Pt = readonly [number, number]
const SHINE: readonly Pt[] = [[2, -1], [1, 0], [0, 1], [1, 2], [0, 3]]
// Risse laufen über Kopf und Arme und enden im Rand, nie am äußeren Blockrand (außer oben): sonst zerfiele der Rand in Stücke.
const CRACK: readonly (readonly Pt[])[] = [
  // Stufe 1: von der oberen rechten Kante schräg nach unten
  [[13, -2], [14, -1], [15, 0], [15, 1], [16, 2], [16, 3], [15, 4], [12, -1]],
  // Stufe 2: dazu links unten, quer über die verschränkten Arme
  [[7, 5], [6, 5], [5, 6], [4, 6], [3, 7], [2, 7], [1, 8], [0, 9]],
  // Stufe 3: dazu mitten über den Kopf und rechts unten
  [[8, -1], [7, 0], [8, 1], [9, 2], [14, 5], [15, 6], [16, 7], [15, 8], [10, 2]],
]
function overlay(level: number): PropSprite {
  const g = blank()
  const put = ([x, y]: Pt, c: string) => { g[y - OY][x - OX] = c }
  for (const p of SHINE) put(p, 'W')
  for (let k = 0; k < level; k++) for (const p of CRACK[k]) put(p, 'W')
  return { rows: rowsOf(g), effect: true }
}

const fxs = (rows: readonly string[]): PropSprite => ({ rows, effect: true })

export const PROPS: Readonly<Record<string, PropSprite>> = {
  // Block: 0 = ruhig, 1–6 Glanzlicht, 12–22 wachsend (12 + h, h = 2 … 12 Zeilen), 31–40 schmelzend (30 + m), 50–53 Pfütze
  ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => ['frost_ice' + i, full(i)])),
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['frost_ice' + (12 + i), growing(2 + i)])),
  // Frostlinie vor der Figur zu den Höhen 2 … 12
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['frost_fl' + (2 + i), frostLine(2 + i)])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['frost_ice' + (31 + i), melting(1 + i)])),
  ...Object.fromEntries(PUDDLE.map((_, i) => ['frost_ice' + (50 + i), puddle(i)])),
  // Glanz (0) und Risse (1–3)
  ...Object.fromEntries([0, 1, 2, 3].map((n) => ['frost_fx' + n, overlay(n)])),
  // Splitter (alle 2 Zeilen hoch, damit sie an der Linie immer halb verdeckt verschwinden)
  frost_sh1: fxs(['LW', 'WL']),
  frost_sh2: fxs(['W', 'L']),
  frost_sh3: fxs(['.L', 'W.']),
  frost_drop: fxs(['L', 'B']),
  frost_flake: fxs(['.W.', 'WLW', '.W.']),
  frost_snap: fxs(['W.W', '.W.']),
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Bausteine -------------------------------------------------------------------------------------------------------------------
const ice = (n: number | string): PropRef => at('frost_ice' + n)
const fx = (n: number): PropRef => at('frost_fx' + n)
const g = (name: string, x: number, y: number): PropRef => [name, x, y, 'g']
/** Block wachsend mit h Zeilen (2 … 12), 13 = geschlossen. */
const grow = (h: number): PropRef[] => (h >= 13 ? [ice(0)] : [ice(10 + h), at('frost_fl' + h)])
/** Die Pose `ice` als Frame (Arme verschränkt, Block, Glanz). */
const ICED: Frame = { fx: 0, fy: 0, by: 0, squash: 0, legs: 'stand', armL: 'cross', armR: 'cross', eyes: 'open', look: [0, 0], face: 0, props: [ice(0), fx(0)] }

/** Splitter: Start (x, y), Geschwindigkeit, Form. Sie fliegen vom Blockrand nach außen und fallen hinter die Linie. */
type Shard = readonly [x: number, y: number, vx: number, vy: number, shape: 1 | 2 | 3]
const SHARDS: readonly Shard[] = [
  [-2, 6, -0.5, -0.2, 3], [-2, 2, -1.2, -0.8, 1], [2, -3, -2.4, -1.0, 2], [5, -3, -1.5, -1.2, 1],
  [17, 6, 0.5, -0.2, 3], [17, 2, 1.2, -0.8, 1], [14, -3, 2.4, -1.0, 2], [9, -3, 1.8, -1.2, 3],
]
const GRAV = 0.33
/** Splitter τ Ticks nach dem Bruch; null = schon hinter der Linie. Letzter sichtbarer Platz ist y 9 (untere Hälfte schon verdeckt). */
function shardAt(s: Shard, tau: number): PropRef | null {
  const [x0, y0, vx, vy, k] = s
  const prevY = tau > 0 ? y0 + vy * (tau - 1) + GRAV * (tau - 1) * (tau - 1) : -99
  if (prevY >= 9) return null
  const y = Math.min(9, Math.round(y0 + vy * tau + GRAV * tau * tau))
  return g('frost_sh' + k, Math.round(x0 + vx * tau), y)
}
const shardsAt = (tau: number): PropRef[] => SHARDS.map((s) => shardAt(s, tau)).filter((p): p is PropRef => !!p)

/** Er bibbert: 1 px hin und her, Arme verschränkt. */
const shiver = (n: number, extra: Frame = {}): Frame[] =>
  Array.from({ length: n }, (_, i): Frame => ({ fx: i % 2 ? 0 : 1, ...extra, t: 1 }))
/** Warm reiben: Hände vor dem Körper wechseln auf und ab. */
const rubWarm = (n: number): Frame[] =>
  Array.from({ length: n }, (_, i): Frame => (i % 2 ? { armL: 'holdUp', armR: 'hold', t: 2 } : { armL: 'hold', armR: 'holdUp', t: 2 }))

// =================================================================================================================================
// Übergänge (ruhig): einfrieren und auftauen ohne Zittern und Splitter. Auch der Weg aus dem Eis für jede andere Stimmung.
// =================================================================================================================================

C('freeze', 'stehen → eingefroren', 'transition', { from: 'stand', to: 'ice', frames: [
  { look: [0, 1], props: grow(2), t: 3 }, { props: grow(3), t: 3 },
  { armL: 'cross', props: grow(4), t: 3 }, { armR: 'cross', props: grow(5), t: 3 },
  ...[6, 7, 8, 9, 10, 11, 12].map((h): Frame => ({ props: grow(h), look: h > 9 ? [0, 0] : [0, 1], eyes: h > 10 ? 'half' : 'open', t: 2 })),
  { ...ICED, eyes: 'half', t: 3 }, { ...ICED, t: 2 },
] })

/** Ruhiges Schmelzen (auch der erste Teil von frost_melt): Block wird von oben kleiner, wird zur Pfütze. */
function meltDown(drops: boolean, level: number): Frame[] {
  const f: Frame[] = [{ ...ICED, props: [ice(0), fx(level)], t: 2 }]
  for (let m = 1; m <= 10; m++) {
    const top = m - 2 // Oberkante in y
    const dr: PropRef[] = drops && m >= 2 && m <= 9 ? [g('frost_drop', m % 2 ? -2 : 18, Math.min(7, top + 2 + (m % 3)))] : []
    f.push({
      props: [ice(30 + m), ...dr],
      eyes: m >= 6 ? (m === 6 ? 'half' : 'open') : 'open',
      look: m >= 6 && m < 9 ? [0, -1] : [0, 0],
      ...(m === 8 ? { armL: 'down' } : {}), ...(m === 9 ? { armR: 'down' } : {}),
      t: 2,
    })
  }
  f.push({ props: [ice(50)], look: [0, 1], t: 3 })
  return f
}
const seep = (): Frame[] => [
  { props: [ice(51)], t: 2 }, { props: [ice(52)], t: 2 }, { props: [ice(53)], t: 2 }, { props: [], look: [0, 0], t: 2 },
]

C('thaw', 'eingefroren → stehen', 'transition', { from: 'ice', to: 'stand', frames: [
  ...meltDown(false, 0), ...seep(), { eyes: 'half', t: 1 }, { eyes: 'open', t: 2 },
] })

// =================================================================================================================================
// frost_in: Frost kriecht von der Linie hoch, er bemerkt es, zittert, reibt sich die Arme, schaut überrascht nach oben, der Block schließt sich.
// Der erste Clip ist der ruhigste (reduzierte Bewegung).
// =================================================================================================================================

C('frost_creep', 'Friert langsam ein', 'frost_in', { to: 'ice', frames: [
  { look: [0, 1], props: grow(2), t: 4 }, { eyes: 'half', props: grow(3), t: 4 }, { eyes: 'open', props: grow(4), t: 3 },
  { armL: 'cross', props: grow(5), t: 3 }, { armR: 'cross', props: grow(6), t: 3 },
  ...[7, 8, 9, 10, 11, 12].map((h): Frame => ({ props: grow(h), look: [0, h > 9 ? -1 : 1], t: 2 })),
  { ...ICED, t: 4 },
] })

C('frost_shiver', 'Friert ein, zittert und reibt sich die Arme', 'frost_in', { to: 'ice', weight: 3, frames: [
  // Frost an den Füßen: er schaut hinunter, erschrickt
  { look: [0, 1], props: grow(2), t: 3 }, { eyes: 'wide', props: grow(3), t: 3 },
  // zittert und verschränkt die Arme
  ...shiver(6, { props: grow(3) }), { fx: 1, armL: 'cross', props: grow(4), t: 1 }, { fx: 0, armR: 'cross', t: 1 },
  ...shiver(4, { props: grow(5) }),
  // reibt sich die Oberarme, zittert weiter, der Frost steigt
  { fx: 1, armL: 'hold', props: grow(6), t: 1 }, { fx: 0, armL: 'cross', t: 1 }, { fx: 1, armR: 'hold', props: grow(7), t: 1 }, { fx: 0, armR: 'cross', t: 1 },
  { fx: 1, armL: 'hold', props: grow(8), t: 1 }, { fx: 0, armL: 'cross', t: 1 }, { fx: 1, armR: 'hold', props: grow(9), t: 1 }, { fx: 0, armR: 'cross', t: 1 },
  // schaut überrascht nach oben, wie der Frost über den Kopf wächst
  { eyes: 'wide', look: [0, -1], props: grow(10), t: 2 }, { props: grow(11), t: 2 }, { props: grow(12), t: 2 },
  // zu: der Block schließt sich, der Glanz liegt auf dem Eis
  { ...ICED, eyes: 'wide', look: [0, -1], t: 4 }, { ...ICED, t: 6 },
] })

// =================================================================================================================================
// frozen: starr im Eis (Schleife, bis Fynn tippt oder sendet). Blinzeln übernimmt die Engine (Augen offen).
// =================================================================================================================================

const flake = (y: number): PropRef => g('frost_flake', 18, y)
C('frozen', 'Steht eingefroren im Eis', 'frozen', { from: 'ice', loop: true, interruptible: true, when: 'day', frames: [
  { ...ICED, t: 18 },
  // ein Glanzlicht wandert über die Kante
  ...[1, 2, 3, 4, 5, 6].map((n): Frame => ({ props: [ice(n), fx(0)], t: 2 })),
  { props: [ice(0), fx(0)], t: 16 },
  // die Augen wandern zur Seite und zurück
  { look: [1, 0], t: 8 }, { look: [0, 0], t: 10 },
  // ein Schneekristall funkelt an der oberen Ecke
  { props: [ice(0), fx(0), flake(-4)], t: 3 }, { props: [ice(0), fx(0), flake(-3)], t: 3 }, { props: [ice(0), fx(0)], t: 14 },
] })

// Nachts: im Eis eingeschlafen, Augen zu, zZ steigt an der oberen Ecke auf.
const z = (name: string, y: number): PropRef => g(name, 18, y)
C('frozen_sleep', 'Im Eis eingeschlafen', 'frozen', { from: 'ice', loop: true, interruptible: true, when: 'night',
  intro: [{ ...ICED, eyes: 'half', t: 6 }, { eyes: 'closed', t: 4 }],
  frames: [
    { eyes: 'closed', props: [ice(0), fx(0)], t: 8 },
    { props: [ice(0), fx(0), z('zs', -3)], t: 4 }, { props: [ice(0), fx(0), z('zs', -4)], t: 4 },
    { props: [ice(0), fx(0)], t: 6 },
    { props: [ice(0), fx(0), z('zb', -3)], t: 4 }, { props: [ice(0), fx(0), z('zb', -4)], t: 4 },
    { props: [ice(0), fx(0)], t: 10 },
    ...[1, 2, 3, 4, 5, 6].map((n): Frame => ({ props: [ice(n), fx(0)], t: 3 })),
  ],
  outro: [{ props: [ice(0), fx(0)], eyes: 'half', t: 3 }, { eyes: 'wide', t: 2 }, { eyes: 'open', t: 2 }] })

// =================================================================================================================================
// frost_crack1 … 3: Tippen macht Risse (je Tipp-Schub eine Stufe). Es knackt (kleiner Funke am Riss), er schaut hin; danach Schleife.
// =================================================================================================================================

const SNAP: readonly PropRef[] = [g('frost_snap', 12, -4), g('frost_snap', -4, 4), g('frost_snap', 6, -4)]
const LOOK_AT: readonly (readonly [number, number])[] = [[1, -1], [-1, 1], [0, -1]]
for (const lv of [1, 2, 3]) {
  C('frost_crack' + lv, `Eis bekommt Risse (Stufe ${lv})`, 'frost_crack', { from: 'ice', loop: true, interruptible: true,
    intro: [
      { ...ICED, props: [ice(0), fx(lv - 1)], t: 1 },
      { eyes: 'wide', props: [ice(0), fx(lv), SNAP[lv - 1]], t: 2 },
      { look: LOOK_AT[lv - 1], props: [ice(0), fx(lv)], t: 5 },
      { eyes: 'open', t: 3 },
    ],
    frames: [
      { look: [0, 0], props: [ice(0), fx(lv)], t: 14 },
      { look: LOOK_AT[lv - 1], t: 6 }, { look: [0, 0], t: 10 },
      { eyes: lv === 3 ? 'wide' : 'open', t: 3 }, { eyes: 'open', t: 6 },
    ] })
}

// =================================================================================================================================
// frost_break0 … 3: Senden zerbricht das Eis (≈ 3 von 4). Splitter fliegen nach außen und fallen hinter die Linie; er schüttelt sich wie ein
// Hund, bibbert, niest („Hatschi“), reibt sich warm. Nicht unterbrechbar, ≈ 4 s.
// =================================================================================================================================

function breakFrames(level: number): Frame[] {
  const f: Frame[] = [{ ...ICED, props: [ice(0), fx(level)], t: 1 }]
  // die übrigen Risse laufen in schneller Folge durch
  for (let lv = level + 1; lv <= 3; lv++) f.push({ eyes: 'wide', props: [ice(0), fx(lv)], t: 1 })
  f.push({ eyes: 'wide', fx: 1, props: [ice(0), fx(3)], t: 1 }, { fx: 0, t: 1 })
  // Bruch: die Arme fahren auseinander, die Splitter fliegen; er schüttelt sich (Augen zu, Arme flattern, schnell hin und her)
  const SHAKE: readonly Frame[] = [
    { fx: -1, face: -1, eyes: 'closed', armL: 'up1', armR: 'down' }, { fx: 1, face: 1, armL: 'down', armR: 'up1' },
  ]
  // bis der letzte Splitter hinter der Linie ist (nichts verschwindet in der Luft)
  for (let tau = 0; tau < 40; tau++) {
    const sh = shardsAt(tau)
    if (!sh.length) break
    if (tau < 2) f.push({ eyes: 'wide', armL: 'up1', armR: 'up1', fx: 0, face: 0, props: sh, t: 1 })
    else if (tau < 16) f.push({ ...SHAKE[tau % 2], props: sh, t: 1 })
    else f.push({ fx: 0, face: 0, armL: 'down', armR: 'down', eyes: 'half', props: sh, t: 1 })
  }
  f.push(
    { fx: 0, face: 0, armL: 'down', armR: 'down', eyes: 'open', props: [], t: 2 },
    // bibbert, Arme verschränkt
    { armL: 'cross', armR: 'cross', eyes: 'half', t: 1 }, ...shiver(6, { eyes: 'half' }),
    // „Ha… “: Kopf zurück, Augen halb, dann „…tschi!“: nach vorn geneigt, Augen zu, ein Wölkchen fliegt
    { fx: 0, squash: -1, look: [0, -1], eyes: 'half', armL: 'down', armR: 'down', t: 4 },
    { squash: 0, by: 1, eyes: 'closed', look: [0, 1], props: [g('puff', 17, 5)], t: 2 },
    { props: [g('puff', 18, 5)], t: 2 },
    { by: 0, props: [], t: 2 }, { eyes: 'open', look: [0, 0], t: 2 },
    // reibt sich warm, dann zufrieden
    ...rubWarm(6),
    { armL: 'down', armR: 'down', eyes: 'closed', blush: true, t: 3 }, { eyes: 'open', blush: false, t: 2 },
  )
  return f
}
for (const lv of [0, 1, 2, 3]) {
  C('frost_break' + (lv || ''), lv ? `Eis zerbricht (nach Riss-Stufe ${lv})` : 'Eis zerbricht, er schüttelt sich frei', 'frost_break', {
    from: 'ice', to: 'stand', frames: breakFrames(lv),
  })
}

// =================================================================================================================================
// frost_melt0 … 3: Senden lässt das Eis schmelzen (≈ 1 von 4). Block wird von oben kleiner, Tropfen fallen, Pfütze; er schüttelt einen Fuß aus,
// reibt sich warm, die Pfütze versickert unter der Linie.
// =================================================================================================================================

function meltFrames(level: number): Frame[] {
  return [
    ...meltDown(true, level),
    // Fuß ausschütteln (in der Pfütze)
    { legs: 'kickR', look: [1, 1], t: 2 }, { legs: 'stand', t: 1 }, { legs: 'kickR', t: 2 }, { legs: 'stand', t: 1 }, { legs: 'kickR', t: 2 },
    { legs: 'stand', look: [0, 0], props: [ice(51)], t: 2 },
    ...rubWarm(4),
    { armL: 'down', armR: 'down', props: [ice(52)], t: 2 }, { props: [ice(53)], t: 2 }, { props: [], eyes: 'closed', blush: true, t: 3 },
    { eyes: 'open', blush: false, t: 2 },
  ]
}
for (const lv of [0, 1, 2, 3]) {
  C('frost_melt' + (lv || ''), lv ? `Eis schmilzt (nach Riss-Stufe ${lv})` : 'Eis schmilzt, er schüttelt den Fuß aus', 'frost_melt', {
    from: 'ice', to: 'stand', frames: meltFrames(lv),
  })
}

export const CLIPS: readonly ClipDef[] = out
