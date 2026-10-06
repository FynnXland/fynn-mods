// clawd-buddy: Clips der Gruppe "wait" (Wartezeiten und Nutzer-Bezug).
//
// Stil überall wie beim Referenzclip type_laptop (Fynn): Er wendet sich zur Seite, kneift ein Auge zu, die Blockhand kramt hinter der Linie,
// zieht den Gegenstand hoch und stellt ihn seitlich neben sich auf die Linie. Arme sind immer 2 Pixel dicke Blöcke, die in ganzen Schritten
// auf und ab gehen und ein Stück ausfahren; nichts taucht auf: Gegenstände kommen hinter der Linie hervor, Steine rollen über die linke
// Bühnenkante hinaus, Effekte (Puff, Schweiß) entstehen an der Figur.
import { clip, rep } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { armBlock, fetchIn, fetchOut, walk } from '../macros.ts'

// ---- Requisiten ------------------------------------------------------------------------------------------------------------------

/** Wecker, 11×10: gelbe Glocken, blauer Ring (hebt sich von Orange und vom Hintergrund ab), rundes weißes Zifferblatt mit vier Strichen und genau EIN
 *  Zeiger (rot, drei Pixel lang), der im Uhrzeigersinn in acht Stellungen umläuft (Variante 0 bis 7). Kein starrer zweiter Zeiger (Fynn). */
function clockRows(sec: number): string[] {
  const g: string[][] = ['.YY.....YY.', '..BBBBBBB..', '.BWWWWWWWB.', 'BWWWWWWWWWB', 'BWWWWWWWWWB', 'BWWWWWWWWWB', 'BWWWWWWWWWB', 'BWWWWWWWWWB', '.BWWWWWWWB.', '..BBBBBBB..']
    .map((r) => r.split(''))
  const put = (x: number, y: number, c: string) => { g[y][x] = c }
  for (const [x, y] of [[5, 2], [5, 8], [1, 5], [9, 5]]) put(x, y, 'K') // Striche bei 12, 6, 9, 3
  const [dx, dy] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]][sec % 8] // der eine Zeiger, im Uhrzeigersinn
  for (let k = 1; k <= 3; k++) put(5 + dx * k, 5 + dy * k, 'M')
  put(5, 5, 'K')
  return g.map((r) => r.join(''))
}

/** Sanduhr, 7×9: Kappen braun, Glas hellblau, Sand gelb. `top`/`pile` = Sandeinheiten oben/unten (je höchstens 9). */
function glassRows(top: number, pile: number): string[] {
  const g: string[][] = ['RRRRRRR', 'L.....L', '.L...L.', '..L.L..', '...L...', '..L.L..', '.L...L.', 'L.....L', 'RRRRRRR'].map((r) => r.split(''))
  const sand: Record<number, number[]> = {
    9: [1, 2, 3, 4, 5], 8: [1, 2, 4, 5], 6: [2, 4], 4: [], 1: [], 0: [],
  }
  for (const x of sand[Math.min(9, top)] ?? []) g[1][x] = 'Y'
  if (top >= 4) for (const x of [2, 3, 4]) g[2][x] = 'Y'
  if (top >= 1 && top <= 3) g[2][3] = top >= 2 ? 'Y' : '.'
  if (top >= 1) g[3][3] = 'Y'
  const streaming = top > 0 && pile > 0 && pile < 9
  if (streaming) g[4][3] = 'Y' // Hals
  const pileTop = pile >= 9 ? 5 : pile >= 6 ? 6 : 7
  if (streaming) for (let y = 5; y < pileTop; y++) g[y][3] = 'Y' // Strahl bis zum Haufen
  const row7 = pile >= 5 ? [1, 2, 3, 4, 5] : pile >= 3 ? [2, 3, 4] : pile >= 1 ? [3] : []
  for (const x of row7) g[7][x] = 'Y'
  if (pile >= 6) g[6][3] = 'Y'
  if (pile >= 8) { g[6][2] = 'Y'; g[6][4] = 'Y' }
  if (pile >= 9) g[5][3] = 'Y'
  return g.map((r) => r.join(''))
}

/** Spielzeug-Baustein 7×5 (wie ein Steckbaustein): zwei Noppen oben, Glanzstrich links oben. Farbe `c`. */
/** Angelrute 9×10: Rute schräg von unten rechts (Griff) nach oben links, Schnur hängt senkrecht ab, Bobber (rot/weiß) schwimmt auf dem Boden (= Wasser); `b` = Zeile des Bobbers. */
const rodRows = (b: number): string[] => {
  const g = Array.from({ length: 10 }, () => Array.from({ length: 9 }, () => '.'))
  for (let i = 0; i <= 7; i++) g[i][i + 1] = 'R'
  g[6][8] = 'R'; g[7][7] = 'R' // dickerer Griff
  for (let y = 1; y < b; y++) g[y][1] = 'W'
  g[b][1] = 'M'
  if (b + 1 <= 9) g[b + 1][1] = 'W'
  return g.map((r) => r.join(''))
}
/** Staffelei 9×9: Leinwand (brauner Rahmen) auf Dreibein; `n` Stufen des Bildes: 1 Himmel, 2 Wiese, 3 Sonne, 4 Haus. */
const easelRows = (n: number): string[] => {
  const g = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => '.'))
  for (let y = 0; y <= 5; y++) for (let x = 0; x <= 8; x++) g[y][x] = y === 0 || y === 5 || x === 0 || x === 8 ? 'R' : 'W'
  for (let x = 0; x <= 8; x++) g[6][x] = 'R'
  for (const x of [1, 4, 7]) { g[7][x] = 'R'; g[8][x] = 'R' }
  const paint = (x0: number, x1: number, y0: number, y1: number, c: string): void => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c }
  if (n >= 1) paint(1, 7, 1, 2, 'L')
  if (n >= 2) paint(1, 7, 3, 4, 'E')
  if (n >= 3) paint(6, 7, 1, 1, 'Y')
  if (n >= 4) paint(2, 3, 3, 4, 'M')
  return g.map((r) => r.join(''))
}
/** Koffer 11×7: Griff oben, brauner Korpus mit zwei gelben Schlössern und blauem Aufkleber, dunkle Kanten. */
const CASE_ROWS = ['...GGGGG...', '...G...G...', 'RRRRRRRRRRR', 'RRYYRRRYYRR', 'RRRRBBRRRRR', 'RRRRRRRRRRR', 'DRRRRRRRRRD']
/** Abreißkalender 7×7: roter Kopf, Tage als graue Punkte; `n` Punkte sind rot durchgestrichen. */
const calRows = (n: number): string[] => {
  const g = ['MMMMMMM', 'WWWWWWW', 'WGWGWGW', 'WWWWWWW', 'WGWGWGW', 'WWWWWWW', 'WGWGWGW'].map((r) => r.split(''))
  const dots: [number, number][] = [[1, 2], [3, 2], [5, 2], [1, 4], [3, 4], [5, 4], [1, 6], [3, 6], [5, 6]]
  dots.slice(0, n).forEach(([x, y]) => { g[y][x] = 'M' })
  return g.map((r) => r.join(''))
}

/** Notizblock 6×5: roter Kopf, weißes Blatt; Stufe 0 leer, 1 bis 4 = Zeilen füllen sich mit grauer Schrift. */
const padRows = (n: number): string[] => {
  const g = ['MMMMMM', 'WWWWWW', 'WWWWWW', 'WWWWWW', 'WWWWWW'].map((r) => r.split(''))
  const ink = (y: number, from: number, to: number): void => { for (let x = from; x < to; x++) g[y][x] = 'G' }
  if (n >= 1) ink(1, 1, n >= 2 ? 5 : 3)
  if (n >= 3) ink(3, 1, n >= 4 ? 4 : 3)
  return g.map((r) => r.join(''))
}
const brickRows = (c: string): string[] => ['.cc.cc.', 'cWWcccc', 'ccccccc', 'ccccccc', 'ccccccc'].map((r) => r.replaceAll('c', c))
export const PROPS: Readonly<Record<string, PropSprite>> = {
  wait_clock0: { rows: clockRows(0) },
  wait_clock1: { rows: clockRows(1) },
  wait_clock2: { rows: clockRows(2) },
  wait_clock3: { rows: clockRows(3) },
  wait_clock4: { rows: clockRows(4) },
  wait_clock5: { rows: clockRows(5) },
  wait_clock6: { rows: clockRows(6) },
  wait_clock7: { rows: clockRows(7) },
  // Sanduhr in sechs Füllständen (oben, unten): 0 voll oben … 5 ganz unten; hg6 = Kantenansicht beim Umdrehen
  wait_hg0: { rows: glassRows(9, 0) },
  wait_hg1: { rows: glassRows(8, 1) },
  wait_hg2: { rows: glassRows(6, 3) },
  wait_hg3: { rows: glassRows(4, 5) },
  wait_hg4: { rows: glassRows(1, 8) },
  wait_hg5: { rows: glassRows(0, 9) },
  wait_hg6: { rows: ['RRR', 'LYL', 'LYL', '.Y.', '.Y.', '.Y.', 'LYL', 'LYL', 'RRR'] },
  wait_pad0: { rows: padRows(0) },
  wait_pad1: { rows: padRows(1) },
  wait_pad2: { rows: padRows(2) },
  wait_pad3: { rows: padRows(3) },
  wait_pad4: { rows: padRows(4) },
  // Kreisel 5×5 in zwei Streifenphasen (Wechsel = Drehung), Angel 9×10 in drei Bobberständen (0/1 schwimmt, 2 taucht ab)
  wait_top0: { rows: ['..R..', '.YYY.', 'MMMMM', '.YYY.', '..M..'] },
  wait_top1: { rows: ['..R..', '.MMM.', 'YYYYY', '.MMM.', '..Y..'] },
  // Pflanze 7×8: Blüte, dichter Wuchs (Mitte drei Spalten in jeder Zeile gefüllt, damit die verkleinerten Fassungen aus der Tasche zusammenhängen), Topf
  wait_plant0: { rows: ['..PPP..', '..PYP..', '..EEE..', '.EEEEE.', '..EEE..', '.EEEEE.', '.MMMMM.', '..MMM..'] },
  wait_plant1: { rows: ['...PPP.', '...PYP.', '..EEE..', '.EEEEE.', '..EEE..', '.EEEEE.', '.MMMMM.', '..MMM..'] },
  // Klopf-Striche (Effekt am Aufschlag der Hand), zwei Phasen zum Flackern
  wait_knk0: { rows: ['W.W', '.W.'], effect: true },
  wait_knk1: { rows: ['.W.', 'W.W'], effect: true },
  wait_easel0: { rows: easelRows(0) },
  wait_easel1: { rows: easelRows(1) },
  wait_easel2: { rows: easelRows(2) },
  wait_easel3: { rows: easelRows(3) },
  wait_easel4: { rows: easelRows(4) },
  wait_popper: { rows: ['MYMYM', '.YMY.', '.MYM.', '..Y..', '..R..'] },
  wait_cfY: { rows: ['YY'], effect: true },
  wait_cfM: { rows: ['MM'], effect: true },
  wait_cfB: { rows: ['BB'], effect: true },
  wait_cfE: { rows: ['EE'], effect: true },
  wait_cfP: { rows: ['PP'], effect: true },
  wait_rod0: { rows: rodRows(7) },
  wait_rod1: { rows: rodRows(8) },
  wait_rod2: { rows: rodRows(9) },
  wait_case: { rows: CASE_ROWS },
  wait_cal0: { rows: calRows(0) },
  wait_cal1: { rows: calRows(3) },
  wait_cal2: { rows: calRows(6) },
  wait_cal3: { rows: calRows(9) },
  wait_blkB: { rows: brickRows('B') },
  wait_blkY: { rows: brickRows('Y') },
  wait_blkE: { rows: brickRows('E') },
  // Schweißtropfen 5×6 (Effekt an der Figur): deutlich größer als der Basis-Tropfen, hellblau mit weißem Glanzpunkt
  wait_drop: { rows: ['..L..', '.LLL.', 'LLLLL', 'LWLLL', 'LLLLL', '.LLL.'], effect: true },
  // Fragezeichen-Schild 7×10: gelbe Tafel mit schwarzem ?, Pfosten unten
  wait_sign: { rows: ['YYYYYYY', 'YWKKKWY', 'YWWWKWY', 'YWWKKWY', 'YWWWWWY', 'YWWKWWY', 'YYYYYYY', '...R...', '...R...', '...R...'] },
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

/** Schweißtropfen, der an der rechten Schläfe herabläuft (Stufe 0 bis 3, je 2 Zeilen tiefer). */
const dropAt = (i: number): PropRef => ['wait_drop', 17, -4 + 2 * i]

// ---- Warten (> 10 s) -------------------------------------------------------------------------------------------------------------
C('foot_tap', 'Fußtippen', 'wait10', { loop: true, interruptible: true, frames: [
  ...rep(3, [{ armL: 'cross', armR: 'cross', mouth: 'flat', legs: 'tapR', t: 2 }, { legs: 'stand', t: 2 }]),
  { look: [1, 0], t: 4 }, { look: [0, 0], t: 2 }] });

// Wecker: aus der Tasche geholt (Referenz-Choreografie) und links neben ihn gestellt. Er schaut hin und liest die Zeit ab: der Zeiger
// läuft im Uhrzeigersinn rund um das Zifferblatt (durchgehend, ein Bild alle 2 Ticks). Dann nickt er kurz, wird ungeduldig (Hände in die Seiten,
// der Fuß tippt), klopft zweimal mit der Blockhand an den Wecker, der dabei einen Pixel nach links ruckt, zuckt mit den Schultern, seufzt (ein
// großer Schweißtropfen läuft an der Schläfe herab) und räumt den Wecker am Ende wieder in die Tasche.
const CLOCK = { name: 'wait_clock0', size: [11, 10] as const, at: [-11, 0] as const, side: 'L' as const, grip: 5, rummage: 3, rise: 1 }
type CF = Frame & { dx?: number; extra?: readonly PropRef[] }
const clockAt = (tick: number, dx: number): PropRef => ['wait_clock' + (Math.floor(tick / 2) % 8), -11 + dx, 0, 'g']
/** Zerlegt die Frames in Einzelticks und setzt je Tick die nächste Zeigerstellung (Sekundenzeiger läuft durch); `dx` rückt den Wecker, `extra` sind Effekte. */
function sweep(list: readonly CF[]): Frame[] {
  const res: Frame[] = []
  let tick = 0
  for (const { dx, extra, ...f } of list) {
    for (let i = 0; i < (f.t ?? 1); i++, tick++) res.push({ ...(i === 0 ? f : {}), t: 1, props: [clockAt(tick, dx ?? 0), ...(extra ?? [])] })
  }
  return res
}
const knock = (): CF[] => [
  { ...armBlock('L', 3, 5), t: 2 },
  { ...armBlock('L', 4, 5), dx: -1, t: 1 },
  { ...armBlock('L', 3, 5), t: 2 },
]
C('watch_check', 'Blick auf die Uhr', 'wait10', { loop: true, interruptible: true,
  intro: fetchIn(CLOCK),
  frames: sweep([
    // 1. schaut auf die Uhr und liest die Zeit ab (der Sekundenzeiger macht einen ganzen Umlauf)
    { look: [-2, 0], eyes: 'open', mouth: null, armL: 'down', armR: 'down', t: 16 },
    // 2. nickt kurz (so spät schon)
    { by: 1, eyes: 'closed', t: 2 }, { by: 0, eyes: 'open', t: 3 },
    // 3. wird ungeduldig: halbe Augen, flacher Mund, Fäuste in die Seiten (Armstummel hoch), der Fuß tippt dreimal
    { eyes: 'half', mouth: 'flat', armL: 'up1', armR: 'up1', t: 2 },
    ...[0, 1, 2, 3, 4, 5].map((k): CF => ({ legs: k % 2 ? 'stand' : 'tapR', t: 2 })),
    // 4. klopft zweimal mit der Blockhand an den Wecker (die Hand fährt einen Pixel vor, der Wecker ruckt mit)
    { eyes: 'open', armR: 'down', ...knock()[0] }, ...knock().slice(1), ...knock(),
    // 5. zuckt mit den Schultern: beide Arme hoch, Augen zu
    { armL: 'up2', armR: 'up2', eyes: 'closed', mouth: 'flat', look: [0, 0], t: 4 },
    { armL: 'down', armR: 'down', eyes: 'open', look: [-2, 0], t: 3 },
    // 6. seufzt: Augen zu, ein großer Schweißtropfen läuft an der Schläfe herab
    { eyes: 'closed', mouth: 'o', look: [0, 0], by: 1, extra: [dropAt(0)], t: 2 },
    { by: 0, extra: [dropAt(1)], t: 2 }, { extra: [dropAt(2)], t: 2 }, { extra: [dropAt(3)], t: 2 },
    // 7. schaut noch einmal auf die Uhr
    { eyes: 'open', mouth: null, look: [-2, 0], t: 8 }]),
  outro: fetchOut(CLOCK) });

C('sit_wait', 'Sitzt und wartet', 'wait10', { from: 'sit', loop: true, interruptible: true, breathe: true, lookable: true, frames: [
  { t: 15 }, { look: [-1, 0], t: 6 }, { look: [0, 0], t: 3 }, { look: [1, -1], t: 6 }, { look: [0, 0], eyes: 'half', t: 5 }, { eyes: 'open', t: 8 }] });

// ---- Warten (> 60 s) -------------------------------------------------------------------------------------------------------------
C('lie_wait', 'Liegt und wartet', 'wait60', { from: 'lie', loop: true, interruptible: true, frames: [
  { eyes: 'half', t: 14 }, { eyes: 'open', look: [1, 0], t: 8 }, { look: [0, 0], t: 6 }, { eyes: 'half', t: 12 }, { eyes: 'closed', t: 6 }] });

// Türmchen: Er holt nacheinander drei Spielzeug-Bausteine (blau, gelb, grün; mit Noppen wie Steckbausteine) aus der Tasche (Hocke, Hand wühlt,
// der Stein kommt klein hoch und wächst), nimmt jeden am Abholplatz, trägt ihn sieben Schritte nach links und setzt ihn aufs Türmchen. Er freut
// sich (ein Hüpfer), dann baut er den Turm von oben nach unten ab: jeden Stein trägt er zurück und packt ihn wieder in die Tasche (er wird
// kleiner und verschwindet dort). Nichts rollt über den Rand und nichts bleibt liegen. Einmaliger Ablauf; Gesicht ruhig: Augen offen, Blick
// zum Stein, nur beim Hüpfen froh. Nicht unterbrechbar, damit nie ein halber Turm herumsteht.
const BW = 7 // Steinbreite
const STG = -7 // Abholplatz: direkt neben der Figur, die Hand (Länge 3) deckt die rechte Kante
const STEPS = 7 // Schritte beim Tragen
const TX = STG - STEPS // Turm: linke Spalte (g), direkt links vom Abholplatz
const BLOCKS = ['wait_blkB', 'wait_blkY', 'wait_blkE']
const yRest = (k: number): number => 5 - 4 * k // Oberkante des k-ten Steins im Turm (die oberen Steine decken die Noppen des unteren)
const blockAt = (k: number, x: number, y: number): PropRef => [BLOCKS[k], x, y, 'g']
const placed = (n: number): PropRef[] => Array.from({ length: n }, (_, k) => blockAt(k, TX, yRest(k)))
/** Blockhand greift den Stein 2 Zeilen unter seiner Oberkante (nie über den Körperrand hinaus: Mindesthöhe 0). */
const grab = (y: number) => armBlock('L', 3, Math.max(0, y + 2))
const brick = (k: number) => ({ name: BLOCKS[k], size: [BW, 5] as const, side: 'L' as const, grip: 2 })
const stepLegs = (i: number): string => (i % 2 ? 'stepA' : 'stepB')

/** Stein k aus der Tasche holen, hochnehmen, zum Turm tragen und aufsetzen; danach (außer beim letzten) zurück zum Abholplatz. */
function build(k: number): Frame[] {
  const done = placed(k)
  const carry = yRest(k) - 1
  const fr: Frame[] = fetchIn({ ...brick(k), at: [STG, 5], keep: done })
  // greift den Stein am Abholplatz und hebt ihn an; Blick bleibt beim Stein
  fr.push({ look: [-2, 1], eyes: 'open', mouth: null, ...grab(5), props: [...done, blockAt(k, STG, 5)], t: 2 })
  for (let y = 5; y > carry;) {
    y = Math.max(carry, y - 2)
    fr.push({ ...grab(y), props: [...done, blockAt(k, STG, y)], t: 1 })
  }
  for (let i = 1; i <= STEPS; i++) fr.push({ fx: -i, legs: stepLegs(i), ...grab(carry), props: [...done, blockAt(k, STG - i, carry)], t: 1 })
  // absetzen (ein Pixel nach unten), loslassen
  fr.push({ legs: 'stand', ...grab(yRest(k)), props: [...done, blockAt(k, TX, yRest(k))], t: 1 })
  fr.push({ armL: 'down', props: placed(k + 1), t: 2 })
  if (k < 2) fr.push(...walk(-STEPS, 0, { props: placed(k + 1) }))
  return fr
}

/** Freut sich über das Türmchen: Lächeln, ein Hüpfer mit hochgerissenen Armen. */
function cheer(): Frame[] {
  const fr: Frame[] = [{ eyes: 'happy', mouth: 'smile', look: [-2, 0], props: placed(3), t: 4 }]
  for (const [fy, legs, arm] of [[-1, 'tuck', 'up2'], [-2, 'tuck', 'up2'], [-1, 'tuck', 'up2'], [0, 'stand', 'down']] as const) fr.push({ fy, legs, armL: arm, armR: arm, t: 1 })
  fr.push({ eyes: 'open', mouth: null, look: [-2, 1], t: 2 })
  return fr
}

/** Obersten Stein k vom Turm nehmen, zurücktragen und in die Tasche packen; danach (außer beim letzten) wieder zum Turm gehen. */
function pack(k: number): Frame[] {
  const rest = placed(k)
  const carry = yRest(k) - 1
  const y0 = Math.max(0, carry) // Höhe, auf der er den Stein in die Tasche führt
  const fr: Frame[] = [{ look: [-2, 1], eyes: 'open', mouth: null, ...grab(yRest(k)), props: [...rest, blockAt(k, TX, yRest(k))], t: 2 }]
  fr.push({ ...grab(carry), props: [...rest, blockAt(k, TX, carry)], t: 1 })
  for (let i = 1; i <= STEPS; i++) fr.push({ fx: -STEPS + i, legs: stepLegs(i), ...grab(carry), props: [...rest, blockAt(k, TX + i, carry)], t: 1 })
  fr.push({ legs: 'stand', ...grab(carry), props: [...rest, blockAt(k, STG, carry)], t: 1 })
  for (let y = carry; y < y0;) {
    y = Math.min(y0, y + 2)
    fr.push({ ...grab(y), props: [...rest, blockAt(k, STG, y)], t: 1 })
  }
  fr.push(...fetchOut({ ...brick(k), at: [STG, y0], keep: rest }))
  if (k > 0) fr.push(...walk(0, -STEPS, { props: rest }))
  return fr
}

C('build_tower', 'Baut ein Türmchen', 'wait60', { frames: [
  ...build(0), ...build(1), ...build(2), ...cheer(), ...pack(2), ...pack(1), ...pack(0),
  { eyes: 'open', mouth: null, look: [0, 0], t: 3 }] });

// Sanduhr: wird links neben ihn gestellt; der Sand rinnt in sechs Stufen, am Ende nimmt er sie, dreht sie um (Kantenansicht) und
// stellt sie wieder ab. Beim Verlassen räumt er sie hinter die Linie.
const GLASS = { name: 'wait_hg2', size: [7, 9] as const, at: [-7, 1] as const, side: 'L' as const, grip: 1 }
const gl = (n: number | string, y = 1, x = -7): readonly PropRef[] => [[typeof n === 'number' ? 'wait_hg' + n : n, x, y, 'g']]
const sandStage = (n: number, t: number): Frame[] => [{ props: gl(n), t }]
const GLASS_FRAMES: readonly Frame[] = [
    { look: [-2, 1], eyes: 'open', mouth: null, armL: 'down', props: gl(0), t: 4 },
    ...sandStage(1, 5), ...sandStage(2, 4), { look: [0, 1], props: gl(2), t: 3 }, { look: [-2, 1], props: gl(3), t: 5 },
    { eyes: 'half', mouth: 'flat', props: gl(4), t: 5 },
    // fertig: Seufzer, dann umdrehen
    { eyes: 'closed', mouth: 'o', by: 1, props: [...gl(5), ['puff', 17, 1]], t: 3 }, { by: 0, props: [...gl(5), ['puff', 18, -1]], t: 3 },
    { eyes: 'open', mouth: null, props: gl(5), t: 2 },
    { ...armBlock('L', 3, 2), props: gl(5), t: 2 },
    { ...armBlock('L', 3, 1), props: gl(5, 0), t: 1 }, { ...armBlock('L', 3, 0), props: gl(5, -1), t: 1 }, { ...armBlock('L', 3, -1), props: gl(5, -2), t: 1 },
    { ...armBlock('L', 5, -1), props: gl('wait_hg6', -2, -5), t: 2 },
    { ...armBlock('L', 3, -1), props: gl(0, -2), t: 2 },
    { ...armBlock('L', 3, 0), props: gl(0, -1), t: 1 }, { ...armBlock('L', 3, 1), props: gl(0, 0), t: 1 }, { ...armBlock('L', 3, 2), props: gl(0, 1), t: 2 },
    { armL: 'down', props: gl(0), t: 2 }]
C('sand_glass', 'Sanduhr', 'wait60', { loop: true, interruptible: true,
  intro: fetchIn({ ...GLASS, name: 'wait_hg0' }), frames: GLASS_FRAMES, outro: fetchOut({ ...GLASS, name: 'wait_hg0' }) });

// Wartegehen: EINE Idee, ungeduldiges Auf-und-ab-Gehen. Er schlendert gelangweilt ein Stück nach links, bleibt stehen, schaut zurück und
// zuckt mit den Schultern, geht zügig zurück und tippt zu Hause mit dem Fuß. Augen bleiben immer offen (keine Striche, keine Brauen), die Arme
// wippen nur senkrecht (gleiche Länge), keine Gegenstände, keine Effekte.
const swingA = { armL: 'up1', armR: 'down' } as Frame // dezent: nur ein Arm gegengleich einen Pixel höher
const swingB = { armL: 'down', armR: 'up1' } as Frame
const pace = (from: number, to: number, look: number, every: number): Frame[] => {
  const dir = Math.sign(to - from)
  const fr: Frame[] = []
  for (let x = from + dir, i = 0; ; x += dir, i++) {
    fr.push({ fx: x, legs: i % 2 ? 'stepA' : 'stepB', ...(i % 2 ? swingA : swingB), look: [look, 0], t: every })
    if (x === to) break
  }
  fr.push({ legs: 'stand', armL: 'down', armR: 'down', t: 2 })
  return fr
}
C('walk_pace', 'Geht wartend auf und ab', 'wait60', { loop: true, interruptible: true, frames: [
  { mouth: 'flat', eyes: 'open', look: [-1, 0], t: 3 },
  // schlendert nach links, Arme wippen
  ...pace(0, -8, -2, 2),
  // schaut zurück zum Prompt und zuckt mit den Schultern (Arme hoch, wieder runter)
  { look: [2, 0], t: 4 },
  { armL: 'up2', armR: 'up2', by: 1, t: 3 },
  { armL: 'down', armR: 'down', by: 0, t: 3 },
  // geht zügig zurück
  ...pace(-8, 0, 2, 1),
  // zu Hause: der Fuß tippt dreimal, Blick nach unten zum Prompt
  { look: [0, 1], t: 2 },
  ...rep(3, [{ legs: 'tapR', t: 2 }, { legs: 'stand', t: 2 }]),
  { mouth: null, look: [0, 0], t: 3 }] });

// ---- Wartet auf dich -------------------------------------------------------------------------------------------------------------
C('look_prompt', 'Schaut zum Prompt', 'waitUser', { loop: true, interruptible: true, frames: [
  { look: [0, 1], t: 10 }, { look: [0, 0], t: 4 }, { by: 1, t: 1 }, { by: 0, t: 3 }, { look: [-1, 1], t: 6 }] });
C('wave_question', 'Winkt mit Fragezeichen', 'waitUser', { loop: true, interruptible: true, frames: [
  { props: [['question', 17, -3]], armR: 'wave1', t: 3 }, { armR: 'wave2', t: 3 }, { armR: 'wave1', t: 3 }, { armR: 'wave2', t: 3 },
  { armR: 'down', t: 8 }] });

// Schild: hinter der Linie hervorgeholt, links neben ihn gestellt; er hebt es an der Tafelkante hoch, schaut zum Nutzer, schwenkt es
// hin und her (Hand fährt ein und aus) und stellt es wieder ab. Beim Verlassen räumt er es hinter die Linie.
const SIGN = { name: 'wait_sign', size: [7, 10] as const, at: [-7, 0] as const, side: 'L' as const, grip: 2 }
const sg = (y: number, x = -7): readonly PropRef[] => [['wait_sign', x, y, 'g']]
const sh = (x: number, y: number, t = 2): Frame => ({ ...armBlock('L', 2 - (x + 6), y + 2), props: sg(y, x), t })
C('sign_question', 'Hält ein Fragezeichen-Schild hoch', 'waitUser', { loop: true, interruptible: true,
  intro: fetchIn(SIGN),
  frames: [
    { look: [-2, 1], eyes: 'open', mouth: null, armL: 'down', props: sg(0), t: 3 },
    { ...armBlock('L', 3, 2), props: sg(0), t: 2 },
    { ...armBlock('L', 3, 0), props: sg(-2), t: 1 }, { ...armBlock('L', 3, -2), props: sg(-4), t: 1 },
    // hält es hoch und schaut zum Nutzer unten, schwenkt hin und her
    { look: [0, 1], eyes: 'wide', mouth: 'smile', t: 3 },
    sh(-7, -4), sh(-6, -4), sh(-7, -4), sh(-8, -4), sh(-7, -4), sh(-6, -4), sh(-7, -4, 3),
    { eyes: 'open', mouth: null, look: [-2, 1], t: 2 },
    { ...armBlock('L', 3, 0), props: sg(-2), t: 1 }, { ...armBlock('L', 3, 2), props: sg(0), t: 2 },
    { armL: 'down', t: 4 }],
  outro: fetchOut(SIGN) });

// ---- Du tippst -------------------------------------------------------------------------------------------------------------------
C('peek_prompt', 'Liest beim Tippen mit', 'watching', { loop: true, interruptible: true, frames: [
  { look: [0, 1], t: 8 }, { look: [-1, 1], t: 5 }, { look: [1, 1], t: 5 }, { by: 1, t: 1 }, { by: 0, t: 2 }] });
C('nod', 'Nickt zustimmend', 'watching', { interruptible: true, frames: [
  { eyes: 'happy', by: 1, t: 2 }, { by: 0, t: 2 }, { by: 1, t: 2 }, { by: 0, t: 3 }, { eyes: 'open', t: 3 }] });

// Liest mit: Der Prompt liegt unter ihm. Die Pupillen wandern zeilenweise von links nach rechts (Gesicht und Pupille zusammen, 5 Stellungen), springen
// zurück in die nächste Zeile, ab und zu nickt er. Ruhig: nur die Augen und ein kleiner Nicker.
const SCAN: readonly (readonly [number, number])[] = [[-1, -1], [-1, 0], [0, 0], [0, 1], [1, 1]] // [face, look x]
const scanLine = (): Frame[] => SCAN.map(([face, lx], i): Frame => ({ face, look: [lx, 1], t: i === 4 ? 3 : 2 }))
C('read_along', 'Liest mit (Zeile für Zeile)', 'watching', { loop: true, interruptible: true, frames: [
  { eyes: 'open', mouth: null, face: -1, look: [-1, 1], t: 2 },
  ...scanLine(), ...scanLine(),
  { face: 0, look: [0, 1], t: 3 },
  { eyes: 'happy', by: 1, t: 2 }, { by: 0, t: 2 }, { eyes: 'open', t: 2 },
  ...scanLine(),
  { face: 0, look: [0, 0], t: 4 }] });

// Notizen: Er holt ein kleines Notizbuch aus der Tasche (rechts von ihm), schreibt mit der Blockhand mit (die Schrift wächst Zeile für Zeile),
// schaut zwischendurch zum Prompt und nickt, blättert um und packt das Buch beim Verlassen wieder ein.
const PAD = { name: 'wait_pad0', size: [6, 5] as const, at: [17, 5] as const, side: 'R' as const, grip: 0 }
const pad = (n: number): readonly PropRef[] => [['wait_pad' + n, 17, 5, 'g']]
const scribble = (n: number): Frame[] => [
  { ...armBlock('R', 3, 5), look: [1, 1], eyes: 'open', props: pad(n), t: 2 },
  { ...armBlock('R', 3, 6), props: pad(n + 1), t: 2 },
]
C('take_notes', 'Macht sich Notizen', 'watching', { loop: true, interruptible: true,
  intro: fetchIn(PAD),
  frames: [
    { look: [1, 1], eyes: 'open', mouth: null, armR: 'down', props: pad(0), t: 3 },
    ...scribble(0), ...scribble(1),
    // schaut zum Prompt, nickt
    { armR: 'down', look: [0, 1], props: pad(2), t: 4 }, { by: 1, props: pad(2), t: 2 }, { by: 0, t: 2 },
    ...scribble(2),
    { armR: 'down', look: [0, 1], props: pad(4), t: 3 },
    // blättert um: die Hand streicht über das Blatt, es ist wieder leer
    { ...armBlock('R', 3, 4), look: [1, 1], props: pad(4), t: 2 }, { ...armBlock('R', 3, 5), props: pad(0), t: 2 },
    { armR: 'down', t: 2 }],
  outro: fetchOut(PAD) });

// Reibt sich gespannt die Hände: beide Vorderhände reiben sich vor dem Mund (Blöcke, wechseln um 1 Pixel auf und ab, Augen und Mund bleiben frei),
// er lächelt und wippt leicht auf den Füßen.
const rub = (n: number, mouth: 'smile' | 'o' = 'smile'): Frame[] =>
  Array.from({ length: n }, (_, i): Frame => ({ armL: i % 2 ? 'chinUp' : 'chin', armR: i % 2 ? 'chinUp' : 'chin', mouth, t: 1 }))
C('rub_hands', 'Reibt sich gespannt die Hände', 'watching', { loop: true, interruptible: true, frames: [
  { eyes: 'wide', look: [0, 1], mouth: 'smile', armL: 'chin', armR: 'chin', t: 2 },
  ...rub(8),
  { by: 1, t: 2 }, { by: 0, t: 2 },
  ...rub(6),
  { by: 1, t: 2 }, { by: 0, t: 2 },
  { armL: 'down', armR: 'down', eyes: 'open', mouth: null, look: [0, 1], t: 4 }] });

// Ungeduldiges Schnauben (schlechte Laune): verschränkte Arme, der Fuß tippt schneller als beim normalen Fußtippen, er schnaubt ein Wölkchen aus.
const snort = (i: number): PropRef => ['puff', 16 + i, 2 - i]
C('impatient_huff', 'Schnaubt ungeduldig', 'wait10', { temper: 'bad', interruptible: true, frames: [
  { armL: 'cross', armR: 'cross', eyes: 'angry', mouth: 'flat', t: 2 },
  ...rep(5, [{ legs: 'tapR', t: 1 }, { legs: 'stand', t: 1 }]),
  { by: 1, props: [snort(0)], t: 2 }, { by: 0, props: [snort(1)], t: 2 }, { props: [snort(2)], t: 2 }, { props: [], t: 2 },
  ...rep(6, [{ legs: 'tapR', t: 1 }, { legs: 'stand', t: 1 }]),
  { by: 1, props: [snort(0)], t: 2 }, { by: 0, props: [snort(1)], t: 2 }, { props: [snort(2)], t: 2 }, { props: [], t: 3 },
  { armL: 'down', armR: 'down', eyes: 'half', mouth: null, t: 3 }, { eyes: 'open', t: 2 }] });

// ---- Rückfrage lange offen (waitUserLong): deutlicher als waitUser ------------------------------------------------------------------
// Er klopft mit der Blockhand mehrfach auf die Linie unter sich (= deine Eingabe), kleine Klopf-Striche am Aufschlag, schaut nach unten. Dann schaut er
// zu dir, klopft mit der anderen Hand weiter.
const rap = (side: 'L' | 'R', k: number): Frame[] => [
  { ...armBlock(side, 3, 5), props: [], t: 1 },
  { ...armBlock(side, 3, 7), props: [['wait_knk' + (k % 2), side === 'L' ? -2 : 15, 6, 'g']], t: 2 },
]
C('knock_prompt', 'Klopft auf die Eingabe', 'waitUserLong', { loop: true, interruptible: true, frames: [
  { by: 1, look: [0, 1], eyes: 'open', mouth: null, t: 1 },
  ...[0, 1, 2, 3].flatMap((k) => rap('L', k)),
  { armL: 'down', by: 0, look: [0, 0], mouth: 'o', props: [], t: 5 },
  { by: 1, look: [0, 1], mouth: null, t: 1 },
  ...[0, 1, 2, 3].flatMap((k) => rap('R', k)),
  { armR: 'down', by: 0, look: [0, 0], props: [], t: 6 }] });
// Er winkt groß mit beiden Armen im Wechsel, ein Fragezeichen hüpft neben ihm, ein "!" blinkt links dazu.
const bigWave = (i: number): Frame => ({
  armL: i % 2 ? 'wave2' : 'raise', armR: i % 2 ? 'raise' : 'wave2', eyes: 'wide', look: [0, 1], mouth: i % 2 ? 'o' : null,
  props: [['question', 18, i % 2 ? -3 : -2, 'g'], ...(i % 4 < 2 ? [['excl', -3, -3, 'g'] as PropRef] : [])], t: 2,
})
C('big_wave_question', 'Winkt groß mit Fragezeichen', 'waitUserLong', { loop: true, interruptible: true, frames: [
  ...Array.from({ length: 10 }, (_, i) => bigWave(i)),
  { armL: 'down', armR: 'down', eyes: 'open', mouth: null, props: [['question', 18, -2, 'g']], t: 4 }] });

// ---- Nutzungslimits ---------------------------------------------------------------------------------------------------------------
// Alle Gegenstände kommen aus der Tasche (fetchIn) und gehen beim Verlassen wieder hinein (fetchOut); er sitzt/liegt dazwischen.
/** Wie sweep(), aber mit beliebiger Requisitenfunktion je Tick (Blinken, Ticken); `extra` sind Effekte für den ganzen Frame. */
function ticked(list: readonly CF[], mk: (tick: number) => readonly PropRef[]): Frame[] {
  const res: Frame[] = []
  let tick = 0
  for (const { extra, dx: _dx, ...f } of list) {
    for (let i = 0; i < (f.t ?? 1); i++, tick++) res.push({ ...(i === 0 ? f : {}), t: 1, props: [...mk(tick), ...(extra ?? [])] })
  }
  return res
}
const sigh = (x: number, y: number): readonly PropRef[] => [['puff', x, y, 'g']]

// 5-Stunden-Limit (b): Er holt einen Wecker aus der Tasche, legt sich daneben und döst (zZ). Der Sekundenzeiger tickt weiter; der Loop ist 32 Ticks
// lang, damit der Zeiger beim Wiederholen nicht springt. Beim Verlassen setzt er sich auf, steht auf und packt den Wecker ein.
const zz1 = (y: number): PropRef => ['mood_z1', 16, y, 'g']
const zz2 = (y: number): PropRef => ['mood_z2', 17, y, 'g']
C('alarm_nap', 'Döst neben dem Wecker', 'limit_5h', { loop: true, interruptible: true,
  intro: [...fetchIn(CLOCK), { look: [0, 0], t: 1 }, { by: 1, t: 2 }, { by: 2, t: 2 }, { squash: 1, eyes: 'half', t: 2 },
    { squash: 2, armL: 'out', armR: 'out', eyes: 'closed', t: 3 }],
  frames: ticked([
    { eyes: 'closed', mouth: null, extra: [zz1(3)], t: 3 }, { mouth: 'o', extra: [zz1(2)], t: 3 }, { mouth: null, extra: [zz1(1)], t: 3 },
    { mouth: 'o', extra: [zz2(0)], t: 3 }, { mouth: null, extra: [zz2(-1)], t: 3 }, { mouth: 'o', extra: [zz2(-2)], t: 4 },
    { mouth: null, t: 5 }, { eyes: 'half', t: 4 }, { eyes: 'closed', t: 4 }], (t) => [clockAt(t, 0)]),
  outro: [{ squash: 1, eyes: 'half', t: 3 }, { squash: 0, armL: 'down', armR: 'down', t: 2 }, { by: 1, eyes: 'open', t: 2 }, { by: 0, t: 2 }, ...fetchOut(CLOCK)] });

// 5-Stunden-Limit (c): Er holt einen kleinen Kreisel aus der Tasche, schnippt ihn an und schaut zu, wie er sich dreht (die Streifen wechseln, am
// Ende wackelt er kurz), dann seufzt er und schnippt ihn wieder an. Beim Verlassen packt er ihn ein. Loop: 40 Ticks.
const TOP = { name: 'wait_top0', size: [5, 5] as const, at: [-5, 5] as const, side: 'L' as const, grip: 2 }
const topAt = (t: number): PropRef => {
  const spinning = t >= 3 && t < 27
  const wobble = t >= 17 && t < 27 && t % 4 < 2 ? 1 : 0 // zum Schluss wackelt er
  return ['wait_top' + (spinning ? t % 2 : 0), -5 + wobble, 5, 'g']
}
C('spin_top', 'Spielt mit einem Kreisel', 'limit_5h', { loop: true, interruptible: true,
  intro: fetchIn(TOP),
  frames: ticked([
    { ...armBlock('L', 3, 4), look: [-2, 1], eyes: 'open', mouth: null, t: 1 }, { ...armBlock('L', 3, 7), t: 1 }, { armL: 'down', t: 1 }, // anschnippen
    { t: 24 }, // er schaut zu
    { eyes: 'half', look: [0, 1], t: 6 }, { mouth: 'o', extra: sigh(16, 5), t: 3 }, { mouth: null, eyes: 'open', look: [-2, 1], t: 4 }], (t) => [topAt(t)]),
  outro: fetchOut(TOP) });

// 5-Stunden-Limit (e), genervt (ohne Gegenstand): Arme verschränkt, halbe Augen, flacher Mund, der Blick geht ungeduldig zur Seite, der Fuß tippt
// schnell, er schnaubt ein Wölkchen, stampft einmal fest auf und seufzt gereizt. Loop: 40 Ticks.
C('limit_annoyed', 'Genervt (wartet aufs Limit)', 'limit_5h', { loop: true, interruptible: true, frames: [
  { armL: 'cross', armR: 'cross', eyes: 'half', mouth: 'flat', look: [-2, 0], t: 3 },
  ...Array.from({ length: 6 }, (): Frame[] => [{ legs: 'tapR', t: 1 }, { legs: 'stand', t: 1 }]).flat(),
  { look: [0, 0], by: 1, props: sigh(16, 3), t: 2 }, { by: 0, props: sigh(17, 2), t: 2 }, { props: sigh(18, 1), t: 2 },
  // stampft einmal, Fäuste (kurze Arme) hoch
  { armL: 'up1', armR: 'up1', legs: 'tapR', props: [], t: 2 }, { legs: 'stand', by: 1, t: 2 }, { by: 0, t: 1 },
  { armL: 'down', armR: 'down', mouth: 'o', look: [0, 1], props: sigh(16, 3), t: 3 }, { props: sigh(17, 2), t: 3 },
  { mouth: 'flat', look: [-2, 0], props: [], t: 8 }] });

// 5-Stunden-Limit (f), traurig: Er sitzt mit hängenden Schultern neben einem zugeklappten Notizblock (aus der Tasche), den er nicht benutzen darf.
// Blick nach unten, kleiner Seufzer, einmal streicht er sehnsüchtig mit der Blockhand über den Block. Beim Verlassen packt er ihn wieder ein.
const PADL = { name: 'wait_pad0', size: [6, 5] as const, at: [-6, 5] as const, side: 'L' as const, grip: 0 }
const padL: PropRef = ['wait_pad0', -6, 5, 'g']
C('limit_sad', 'Traurig (darf nicht arbeiten)', 'limit_5h', { loop: true, interruptible: true,
  intro: [...fetchIn(PADL), { look: [0, 0], t: 1 }, { by: 1, t: 2 }, { by: 2, t: 2 }],
  frames: [
    { look: [-2, 1], eyes: 'half', mouth: 'flat', props: [padL], t: 10 },
    { look: [0, 1], t: 6 },
    { mouth: 'o', props: [padL, ...sigh(16, 3)], t: 3 }, { props: [padL, ...sigh(17, 2)], t: 3 },
    { mouth: 'flat', look: [-2, 1], props: [padL], t: 4 },
    // streicht darüber
    { ...armBlock('L', 3, 3), t: 2 }, { ...armBlock('L', 4, 3), t: 2 }, { ...armBlock('L', 3, 3), t: 2 }, { ...armBlock('L', 4, 3), t: 2 }, { armL: 'down', t: 3 },
    { look: [0, 1], t: 6 }],
  outro: [{ by: 1, t: 2 }, { by: 0, t: 2 }, ...fetchOut(PADL)] });

// Wochenlimit (b): Koffer links, Abreißkalender rechts, beide aus der Tasche. Er sitzt dazwischen und wartet; mit der Blockhand streicht er
// Tage im Kalender durch, schaut zum Koffer, seufzt. Nach dem dritten Mal blättert er ein neues Blatt auf.
const CASE = { name: 'wait_case', size: [11, 7] as const, at: [-11, 3] as const, side: 'L' as const, grip: 2 }
const CAL = { name: 'wait_cal0', size: [7, 7] as const, at: [17, 3] as const, side: 'R' as const, grip: 2 }
const caseRef: PropRef = ['wait_case', -11, 3, 'g']
const calAt = (v: number): PropRef => ['wait_cal' + v, 17, 3, 'g']
const strike = (v: number): Frame[] => [
  { ...armBlock('R', 3, 2), look: [1, 1], props: [caseRef, calAt(v)], t: 2 },
  { ...armBlock('R', 3, 3), props: [caseRef, calAt(v + 1)], t: 2 },
  { armR: 'down', t: 3 },
]
C('suitcase_wait', 'Sitzt auf gepackten Sachen und zählt Tage', 'limit_week', { loop: true, interruptible: true,
  intro: [...fetchIn(CASE), ...fetchIn({ ...CAL, keep: [caseRef] }), { look: [0, 0], t: 1 }, { by: 1, t: 2 }, { by: 2, t: 2 }],
  frames: [
    { look: [-2, 1], eyes: 'open', mouth: null, props: [caseRef, calAt(0)], t: 6 },
    ...strike(0), { look: [0, 0], eyes: 'half', mouth: 'flat', t: 8 },
    { look: [-2, 1], eyes: 'open', mouth: null, t: 4 },
    ...strike(1), { look: [0, 0], mouth: 'o', props: [caseRef, calAt(2), ['puff', 16, 1, 'g']], t: 3 }, { props: [caseRef, calAt(2), ['puff', 17, 0, 'g']], t: 3 },
    { mouth: null, props: [caseRef, calAt(2)], t: 6 },
    ...strike(2),
    // das Blatt ist voll: abreißen, ein neues Blatt (leer)
    { look: [1, 1], eyes: 'half', t: 4 },
    { ...armBlock('R', 3, 2), props: [caseRef, calAt(3)], t: 2 }, { ...armBlock('R', 3, 3), props: [caseRef, calAt(0)], t: 2 }, { armR: 'down', t: 3 },
    { look: [0, 0], eyes: 'half', mouth: 'flat', t: 8 }],
  outro: [{ by: 1, t: 2 }, { by: 0, t: 2 }, ...fetchOut({ ...CAL, keep: [caseRef] }), ...fetchOut(CASE)] });

// Wochenlimit (c): Er zieht eine Angel hinter der Linie hervor (zu lang für die Tasche: die Blockhand kramt unten und zieht sie hoch), setzt sich
// und hält sie; der Bobber schwimmt auf dem Boden. Einmal taucht er ab, er reißt die Angel hoch, nichts hängt dran: Seufzer. Loop: 48 Ticks.
// Beim Verlassen steht er auf und lässt sie wieder hinter der Linie versinken.
const rodUp = (y: number): PropRef => ['wait_rod0', -9, y, 'g']
const rodHand = (y: number): Frame => armBlock('L', 3, Math.min(9, y + 6))
const rodPull: Frame[] = [
  { look: [-2, 1], eyes: 'winkR', t: 2 }, { ...armBlock('L', 2, 8), t: 2 }, { ...armBlock('L', 3, 9), t: 2 },
  ...[10, 8, 6, 4, 2, 0].map((y): Frame => ({ ...rodHand(y), look: [-2, 0], eyes: 'open', props: [rodUp(y)], t: 1 })),
  { armL: 'down', t: 2 },
]
const rodSink: Frame[] = [
  { ...rodHand(0), props: [rodUp(0)], t: 2 },
  ...[2, 4, 6, 8, 10].map((y): Frame => ({ ...rodHand(y), props: [rodUp(y)], t: 1 })),
  { ...armBlock('L', 3, 9), props: [], t: 2 }, { armL: 'down', look: [0, 0], t: 2 },
]
const rodAt = (t: number): PropRef => {
  const bite = t >= 28 && t < 32
  const jerk = t >= 30 && t < 34 ? -1 : 0
  return ['wait_rod' + (bite ? 2 : Math.floor(t / 6) % 2), -9, jerk, 'g']
}
C('fishing_wait', 'Sitzt mit der Angel und wartet', 'limit_week', { loop: true, interruptible: true,
  intro: [...rodPull, { look: [0, 0], t: 1 }, { by: 1, t: 2 }, { by: 2, t: 2 }],
  frames: ticked([
    { ...armBlock('L', 3, 4), look: [-2, 1], eyes: 'open', mouth: null, t: 12 }, { eyes: 'half', t: 10 }, { eyes: 'open', t: 6 },
    { eyes: 'wide', t: 2 }, { ...armBlock('L', 3, 3), t: 2 }, // Biss, Ruck
    { ...armBlock('L', 3, 4), eyes: 'half', mouth: 'flat', t: 4 },
    { eyes: 'closed', mouth: 'o', extra: sigh(16, 3), t: 3 }, { extra: sigh(17, 2), t: 3 }, { mouth: null, eyes: 'open', t: 6 }], (t) => [rodAt(t)]),
  outro: [{ by: 1, t: 2 }, { by: 0, t: 2 }, ...rodSink] });

// 5-Stunden-Limit (d): Die Sanduhr aus sand_glass im normalen Tempo: er schaut dem Sand zu, seufzt und dreht sie um.
C('sandglass_wait', 'Wartet mit der Sanduhr', 'limit_5h', { loop: true, interruptible: true,
  intro: fetchIn({ ...GLASS, name: 'wait_hg0' }), frames: GLASS_FRAMES, outro: fetchOut({ ...GLASS, name: 'wait_hg0' }) });

// Wochenlimit (c): Er holt eine Topfpflanze (Blume) aus der Tasche, setzt sich daneben und schaut ihr zu: sie wiegt sich sanft im Wind, er streicht
// vorsichtig über ein Blatt und lächelt. Ruhige Schleife (48 Ticks), beim Verlassen packt er sie wieder ein.
const PLANT = { name: 'wait_plant0', size: [7, 8] as const, at: [-8, 2] as const, side: 'L' as const, grip: 5 }
C('limit_garden', 'Schaut der Blume beim Wachsen zu', 'limit_week', { loop: true, interruptible: true,
  intro: [...fetchIn(PLANT), { look: [0, 0], t: 1 }, { by: 1, t: 2 }, { by: 2, t: 2 }],
  frames: ticked([
    { look: [-2, 1], eyes: 'open', mouth: 'smile', t: 12 },
    { ...armBlock('L', 4, 3), t: 2 }, { ...armBlock('L', 3, 3), t: 2 }, { ...armBlock('L', 4, 3), t: 2 }, { armL: 'down', t: 2 },
    { eyes: 'half', t: 12 }, { look: [0, 0], eyes: 'open', t: 8 }, { look: [-2, 1], t: 8 }], (t) => [['wait_plant' + (Math.floor(t / 8) % 2), -8, 2, 'g']]),
  outro: [{ by: 1, t: 2 }, { by: 0, t: 2 }, ...fetchOut(PLANT)] });

// Wochenlimit (d): Er holt eine kleine Staffelei aus der Tasche und malt mit der Blockhand ein Bild (Himmel, Wiese, Sonne, Haus), tritt zurück,
// lächelt, und beginnt auf einer neuen Leinwand von vorn. Ruhige Schleife (38 Ticks), beim Verlassen packt er die Staffelei wieder ein.
const EASEL = { name: 'wait_easel0', size: [9, 9] as const, at: [17, 1] as const, side: 'R' as const, grip: 2 }
const easelAt = (v: number): readonly PropRef[] => [['wait_easel' + v, 17, 1, 'g']]
const daub = (v: number): Frame[] => [{ ...armBlock('R', 3, 2), props: easelAt(v), t: 2 }, { ...armBlock('R', 3, 3), props: easelAt(v + 1), t: 2 }]
C('limit_paint', 'Malt ein Bild', 'limit_week', { loop: true, interruptible: true,
  intro: fetchIn(EASEL),
  frames: [
    { look: [1, 1], eyes: 'open', mouth: null, armR: 'down', props: easelAt(0), t: 4 },
    ...[0, 1, 2, 3].flatMap(daub),
    { armR: 'down', look: [0, 0], mouth: 'smile', props: easelAt(4), t: 8 },
    { look: [1, 1], mouth: null, t: 3 },
    { ...armBlock('R', 3, 1), t: 2 }, { ...armBlock('R', 3, 2), props: easelAt(0), t: 2 }, { armR: 'down', t: 3 }],
  outro: fetchOut(EASEL) });

// Limit zurückgesetzt, es geht weiter (einmalig, kurz). (a) Er springt auf und jubelt: zwei Hüpfer, Funken stehen fest neben ihm.
const spk = (a: number): readonly PropRef[] => (a ? [['sparkle', 18, 1, 'g'], ['dotY', -3, -1, 'g']] : [['sparkle', -4, 1, 'g'], ['dotY', 19, -1, 'g']])
const hopHigh = (a: number): Frame[] => [
  { by: 1, legs: 'stand', t: 2 },
  { by: 0, fy: -3, legs: 'tuck', armL: 'raise', armR: 'raise', eyes: 'happy', mouth: 'smile', props: spk(a), t: 2 },
  { fy: -2, t: 1 }, { fy: -1, t: 1 }, { fy: 0, by: 1, legs: 'spread', t: 1 }, { by: 0, legs: 'stand', t: 1 },
]
C('limit_back_jump', 'Es geht weiter (Freudensprung)', 'limit_back', { interruptible: false, frames: [
  { eyes: 'wide', mouth: 'o', t: 2 }, ...hopHigh(0), ...hopHigh(1),
  { armL: 'down', armR: 'down', eyes: 'happy', mouth: 'smile', props: [], t: 3 }, { eyes: 'open', mouth: null, t: 2 }] });
// (b) Knallbonbon: Er holt eine Konfetti-Kanone aus der Tasche, schlägt darauf, Konfetti schießt hoch, fliegt über seinen Kopf und regnet daneben
// herab (verschwindet unten am Boden, nie am Rand); er tanzt dabei. Konfetti-Stücke gehen hinter ihm durch (sie werden dort nicht gezeichnet, damit
// die Augen frei bleiben). Danach packt er die Kanone wieder ein. ~4 s, nicht unterbrechbar.
const POPPER = { name: 'wait_popper', size: [5, 5] as const, at: [-6, 5] as const, side: 'L' as const, grip: 0, rummage: 2 }
const popperRef: PropRef = ['wait_popper', -6, 5, 'g']
const CONF = ['wait_cfY', 'wait_cfM', 'wait_cfB', 'wait_cfE', 'wait_cfP']
/** Stück k, τ Ticks nach dem Knall: Wurfparabel aus der Kanonenöffnung (-4, 4); null = noch nicht gestartet, hinter der Figur oder am Boden angekommen. */
const confetti = (k: number, tau0: number): PropRef | null => {
  const tau = tau0 - (k % 4) // gestaffelter Start
  if (tau < 0) return null
  const vx = 0.2 + (k * 1.4) / 15
  const vy = -1.7 - ((k * 7) % 5) * 0.25
  const x = Math.round(-4 + vx * tau)
  const y = Math.round(4 + vy * tau + 0.2 * tau * tau)
  if (y > 9 || y < -3) return null
  if (x + 1 >= 2 && x <= 14 && y >= 0) return null // hinter dem Körper
  if (x + 1 >= -6 && x <= -2 && y >= 4) return null // hinter der Kanone (nie auf ihr gezeichnet)
  return [CONF[k % 5], x, y, 'g']
}
/** Alle Stücke dieses Ticks; Stücke, die sich mit einem schon gesetzten berühren oder überlappen würden, bleiben weg (Effekte überlappen sich nie). */
const burst = (t: number, T0: number): PropRef[] => {
  const res: PropRef[] = []
  for (let k = 0; k < 16; k++) {
    const c = confetti(k, t - T0)
    if (c && !res.some((r) => Math.abs(r[2] - c[2]) <= 1 && Math.abs(r[1] - c[1]) <= 2)) res.push(c)
  }
  return res
}
const BANG = 4 // Tick des Knalls
C('limit_back_confetti', 'Es geht weiter (Konfetti)', 'limit_back', { interruptible: false,
  intro: fetchIn(POPPER),
  frames: ticked([
    { look: [-2, 1], eyes: 'open', mouth: null, t: 3 },
    { ...armBlock('L', 3, 3), t: 1 },
    { ...armBlock('L', 3, 5), eyes: 'wide', mouth: 'o', t: 2 },
    { armL: 'down', t: 1 },
    ...Array.from({ length: 6 }, (_, i): CF[] => [
      { legs: i % 2 ? 'kickL' : 'kickR', armL: i % 2 ? 'down' : 'raise', armR: i % 2 ? 'raise' : 'down', fy: -1, eyes: 'open', look: [0, 0], mouth: 'smile', t: 2 },
      { legs: 'stand', fy: 0, t: 1 },
    ]).flat(),
    { armL: 'down', armR: 'down', mouth: null, t: 6 }], (t) => [popperRef, ...burst(t, BANG)]),
  outro: fetchOut(POPPER) });

export const CLIPS: readonly ClipDef[] = out
