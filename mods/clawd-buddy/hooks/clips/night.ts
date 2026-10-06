// clawd-buddy: Clips der Gruppe "night" (Nacht und Morgen).
// Stil der Referenz (Fynn): Hände sind Blöcke, nichts taucht auf oder verschwindet. Die Schlafmütze holt er hinter der Linie hervor, zieht sie
// gerade hoch und schiebt sie sich auf den Kopf; beim Aufschrecken fliegt sie im Bogen nach links auf den Boden, er packt sie in die Tasche. Die Sonne steigt hinter
// der Linie auf, er schaut hinüber und streckt sich, danach geht sie wieder hinter der Linie unter. Die Tasse holt er aus der Tasche.
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { armBlock, fetchIn, fetchOut } from '../macros.ts'

/** Sprite um 180° drehen (Zeichenraster); für die Mütze, die sich im Flug überschlägt. */
const flip = (rows: readonly string[]): string[] => rows.map((r) => r.split('').reverse().join('')).reverse()
// Schlafmütze: blauer Zipfel nach links geneigt, weiße Bommel (2×2) seitlich am Zipfel (oben ist Blau, damit beim Hochziehen nicht zuerst ein weißer Klotz erscheint),
// dicker weißer Bund unten (13×8, so breit wie der Kopf; der Bund liegt auf den zwei obersten Kopfzeilen und lässt an den Seiten keine Kopfpixel frei)
const CAP0 = ['..BBBB.....', '.BBBBBB....', 'WWBBBBBBB..', 'WWBBBLBBBB.', '.BBBBBLBBBB', '.BBBBBBBBB.'].map((r) => '.' + r + '.').concat(['WWWWWWWWWWWWW', 'WWWWWWWWWWWWW'])
/** Sonne aus Scheibe (Radius 4) und Strahlen: im Wechsel lange gerade Strahlen bzw. lange schräge Strahlen (13×13, Mitte 6|6). */
const sunRows = (longCross: boolean): string[] => {
  const g = Array.from({ length: 13 }, () => Array.from({ length: 13 }, () => '.'))
  const put = (dx: number, dy: number): void => { g[6 + dy][6 + dx] = 'Y' }
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 18) put(dx, dy)
  const lc = longCross ? 2 : 1
  const ld = longCross ? 1 : 2
  for (const sgn of [-1, 1]) {
    for (let d = 0; d < lc; d++) { put(sgn * (5 + d), 0); put(0, sgn * (5 + d)) }
    for (let d = 0; d < ld; d++) for (const s2 of [-1, 1]) put(sgn * (4 + d), s2 * (4 + d))
  }
  return g.map((r) => r.join(''))
}

const MUG_ROWS = ['..WRRRW', 'WWWWWWG', 'W.WWWWG', 'W.WWWWG', 'WWWWWWG', '..WGGGG']
/** Gekippte Tasse: Spalten ab 4 (die Trinkseite) eine Zeile tiefer, Höhe +1. */
const tiltRows = (rows: readonly string[]): string[] => {
  const g = Array.from({ length: rows.length + 1 }, () => Array.from({ length: 7 }, () => '.'))
  rows.forEach((r, y) => r.split('').forEach((c, x) => { if (c !== '.') g[x >= 4 ? y + 1 : y][x] = c }))
  return g.map((r) => r.join(''))
}

/** Requisiten, die nur diese Gruppe braucht (Name → Sprite). Namen müssen über alle Gruppen eindeutig sein. */
export const PROPS: Readonly<Record<string, PropSprite>> = {
  mood_cap: { rows: CAP0 },
  mood_capFlip: { rows: flip(CAP0) },
  // Tasse im Profil 7×6: Henkel links (abgewandt) mit Loch, Kaffee oben, graue Schattenkante rechts; mug1 = leicht gekippt (rechte Hälfte eine Zeile tiefer)
  mood_mug: { rows: MUG_ROWS },
  mood_mug1: { rows: tiltRows(MUG_ROWS) },
  mood_sun: { rows: sunRows(true) },
  mood_sun2: { rows: sunRows(false) },
  // großes Ausrufezeichen (Effekt am Kopf): Balken, Spitze, Punkt
  mood_excl: { rows: ['WWW', 'WWW', 'WWW', 'WWW', '.W.', '...', 'WWW', 'WWW'], effect: true },
  // Schlaf-Z in zwei Größen: ein echtes Z (nicht die sanduhrartige 3×3-Form)
  // Zahnbürste 6×1: blauer Griff links, weiße Borsten rechts
  night_brush: { rows: ['BBBBWW'] },
  mood_z1: { rows: ['WWW', '..W', '.W.', 'W..', 'WWW'], effect: true },
  mood_z2: { rows: ['WWWWW', '....W', '...W.', '..W..', '.W...', 'W....', 'WWWWW'], effect: true },
  // Schweißtropfen, größer als der Basis-Tropfen
  mood_sweat: { rows: ['.L.', 'LLL', 'LLL', '.L.'], effect: true },
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Schlafmütze (sleep, startled): aus der Liegepose setzt er sich auf, holt die Mütze hinter der Linie hervor und setzt sie auf.
// Sitzend (Körperoberkante 2), weil die Mütze im Stehen oben aus der Bühne ragen würde. Die Mütze steigt auf der Blockhand aus der Tiefe
// auf (die Hand trägt sie von UNTEN wie ein Tablett, Stummel von 3), ganz nah neben ihm; auf Kopfhöhe schiebt sie sich in kurzen Schritten
// über den Kopf. Beim Abnehmen rutscht sie in denselben Schritten rückwärts auf die wartende Hand und wird hinter der Linie versenkt:
// Weg hinein und Weg hinaus sind spiegelgleich, damit man die Herkunft nicht raten muss.
const CAP_H = 8
const CAP_X = 2 // auf dem Kopf: deckt die ganze Kopfbreite (Spalten 2 bis 14); die Hand endet davor an Spalte 1
const CAP_START = -11 // beim Hervorholen und Wegräumen: rechte Kante direkt neben dem Körper (Spalte 1)
const capTop = (top: number): number => top - 6 // der Bund (letzte zwei Zeilen) liegt auf den zwei obersten Kopfzeilen
const CAP_SIT_Y = capTop(2) // sitzend: -4
// Liegend: bleibt für die ganze Schlafschleife exakt auf diesem Platz (Carry-Abgleich der Engine: `startled` beginnt mit demselben Bild)
const CAP_LIE: PropRef = ['mood_cap', CAP_X, capTop(4), 'g']
const cap = (x: number, y: number): PropRef => ['mood_cap', x, y, 'g']
/** Blockhand sitzend (Körperoberkante 2) direkt unter der Mütze: Oberkante des Blocks eine Zeile unter ihrer Unterkante (Stummel von 3). */
const handUnder = (side: 'L' | 'R', y: number): Frame => armBlock(side, 3, Math.min(9, y + CAP_H))
/** Weg der Mütze aus der Tiefe auf Kopfhöhe: zuerst langsam (die Bommel wächst Zeile für Zeile aus der Linie), dann 2 Pixel je Tick. */
const CAP_RISE: readonly number[] = [10, 9, 8, 6, 4, 2, 0, -2, CAP_SIT_Y]
/** Waagerechter Weg über den Kopf in drei kurzen Schritten (beim Abnehmen rückwärts). */
const CAP_SLIDE: readonly number[] = [-9, -7, -5, -3, -1, 1, CAP_X]

/** Sitzend die Mütze hervorholen, hochziehen, auf den Kopf schieben; danach hinlegen. Beginnt und endet liegend. */
const capOn = (short = false): Frame[] => {
  const f: Frame[] = []
  // 1. Aufsetzen (wie get_up): er ist noch müde
  f.push({ squash: 1, armL: 'down', armR: 'down', eyes: 'half', t: short ? 1 : 2 }, { squash: 0, t: short ? 1 : 2 })
  // 2. Zur Seite wenden, Auge zu, Hand kramt knapp über der Linie (taucht ein und aus)
  f.push({ look: [-2, 1], eyes: 'winkR', t: 2 })
  for (let i = 0; i < (short ? 2 : 3); i++) f.push({ ...armBlock('L', i % 2 ? 3 : 2, i % 2 ? 7 : 5), t: 2 })
  // 3. Fund: Auge auf, Hand greift tief hinter der Linie zu; die Mütze steigt mit der Hand aus der Tiefe auf
  f.push({ eyes: 'open', ...armBlock('L', 3, 9), t: 2 })
  CAP_RISE.forEach((y, i) => f.push({ ...handUnder('L', y), look: i > 4 ? [-1, -1] : [-2, 0], props: [cap(CAP_START, y)], t: 1 }))
  f.push({ look: [-1, -1], t: 2 })
  // 4. Über den Kopf schieben: kurze Schritte, die Hand bleibt unter der Mütze, bis sie auf dem Kopf liegt
  CAP_SLIDE.forEach((x) => f.push({ ...(x < CAP_X ? handUnder('L', CAP_SIT_Y) : {}), look: [0, -1], props: [cap(x, CAP_SIT_Y)], t: 1 }))
  f.push({ armL: 'down', look: [0, 0], eyes: 'half', t: 2 })
  // 5. Hinlegen (wie lie_down): die Mütze sinkt mit dem Kopf
  f.push({ squash: 1, props: [cap(CAP_X, capTop(3))], t: 2 })
  f.push({ squash: 2, armL: 'out', armR: 'out', eyes: 'closed', props: [CAP_LIE], t: 3 })
  return f
}

/** Gegenstück, spiegelgleich: aufsetzen, die linke Hand wartet seitlich unter dem Kopf, die Mütze rutscht auf sie, sie sinkt hinter die Linie. */
const capOff = (): Frame[] => {
  const f: Frame[] = []
  f.push({ squash: 1, armL: 'down', armR: 'down', eyes: 'half', props: [cap(CAP_X, capTop(3))], t: 2 })
  f.push({ squash: 0, props: [cap(CAP_X, CAP_SIT_Y)], t: 2 })
  // Blockhand hebt sich seitlich unter den Mützenrand, er schaut hin
  f.push({ look: [-2, 0], eyes: 'open', ...armBlock('L', 3, 3), t: 2 })
  f.push({ ...handUnder('L', CAP_SIT_Y), t: 2 })
  // Mütze rutscht in drei Schritten nach links auf die Hand
  for (const x of [0, -3, -6, -9, CAP_START]) f.push({ ...handUnder('L', CAP_SIT_Y), props: [cap(x, CAP_SIT_Y)], t: 1 })
  f.push({ look: [-2, 1], t: 2 })
  // Die Hand senkt sie hinter die Linie
  for (const y of [-2, 0, 2, 4, 6, 8]) f.push({ ...handUnder('L', y), props: [cap(CAP_START, y)], t: 1 })
  f.push({ ...armBlock('L', 3, 9), props: [], t: 2 })
  f.push({ armL: 'down', look: [0, 0], eyes: 'half', t: 2 })
  f.push({ squash: 1, t: 2 }, { squash: 2, armL: 'out', armR: 'out', eyes: 'closed', t: 3 })
  return f
}

// ---- Schlafen: je ein Z zur Zeit steigt rechts neben dem Kopf auf, erst klein, dann groß (nie zwei zugleich, nie an Mütze oder Arm)
const Z1 = (y: number): PropRef => ['mood_z1', 16, y, 'g']
const Z2 = (y: number): PropRef => ['mood_z2', 17, y, 'g']
const zz = (z: PropRef, t: number, mouth: 'o' | null = null): Frame => ({ eyes: 'closed', mouth, props: [CAP_LIE, z], t })

// ---- Aufschrecken: Der Kopf wirft die Mütze ab, sie überschlägt sich in einem flachen Bogen nach links und landet aufrecht auf dem Boden direkt
// neben ihm (nichts verlässt die Bühne). Er springt auf, landet, schaut sie an und packt sie in die Tasche (fetchOut: sie wird kleiner und verschwindet dort).
// Solange die Mütze fliegt, liegt er noch (Mütze nie über den Augen); erst danach springt er.
const CAP_PACK = { name: 'mood_cap', size: [13, 8] as const, at: [-12, 2] as const, side: 'L' as const, grip: 5, rummage: 3 }
const CAP_THROW: readonly (readonly [number, number])[] = [[-3, -4], [-8, -4], [-12, -3], [-12, -1], CAP_PACK.at]
const EXCL: PropRef = ['mood_excl', 19, -2, 'g']
const capFly = (): Frame[] => {
  const body: readonly Frame[] = [{ squash: 1 }, {}, { squash: 0, armL: 'up1', armR: 'up1' }, { by: 1, legs: 'tuck' }, { by: 0, legs: 'stand' }]
  return CAP_THROW.map(([x, y], i): Frame => ({
    eyes: 'wide', mouth: 'o', ...body[i],
    props: [['mood_cap' + (i % 2 && i < 4 ? 'Flip' : ''), x, y, 'g'], ...(i < 3 ? [EXCL] : [])], t: 1,
  }))
}
const startleJump = (): Frame[] => {
  const arcs: readonly Frame[] = [
    { armL: 'raise', armR: 'raise', look: [-2, -1] }, { fy: -1 }, { fy: -2 }, { fy: -3 }, { fy: -3 }, { fy: -2 }, { fy: -1 },
    { fy: 0, by: 1, legs: 'spread', armL: 'up1', armR: 'up1' },
    { by: 0, legs: 'stand', armL: 'down', armR: 'down', look: [-2, 0], mouth: 'o' },
  ]
  return arcs.map((f): Frame => ({ ...f, t: 1 }))
}

// ---- Nacht
C('yawn', 'Gähnen', 'night', { frames: [
  { armL: 'up1', armR: 'up1', eyes: 'half', t: 2 }, { armL: 'raise', armR: 'raise', eyes: 'closed', mouth: 'yawn', squash: -1, t: 3 },
  { mouth: 'yawnBig', t: 6 }, { mouth: 'yawn', t: 2 }, { squash: 0, armL: 'up1', armR: 'up1', mouth: null, eyes: 'half', t: 3 },
  { armL: 'down', armR: 'down', t: 4 }] });
C('drowsy', 'Nickt weg', 'night', { loop: true, interruptible: true, frames: [
  { eyes: 'half', t: 10 }, { by: 1, eyes: 'closed', t: 7 }, { by: 0, eyes: 'wide', t: 1 }, { eyes: 'half', t: 8 }] });
// Schlafen: Die Engine legt ihn über sit_down/lie_down hin; hier holt er (liegend beginnend) die Mütze, setzt sie auf und schläft.
// Der Mützenplatz bleibt in der Schleife unverändert (er atmet nur mit Mund und Z), damit ein Aufwecken (Carry) und `startled` nahtlos anschließen.
C('sleep', 'Schläft (zZz)', 'night', { from: 'lie', loop: true, interruptible: true,
  intro: capOn(),
  frames: [
    zz(Z1(3), 3), zz(Z1(2), 3, 'o'), zz(Z1(1), 3),
    zz(Z2(0), 3, 'o'), zz(Z2(-1), 3), zz(Z2(-2), 4, 'o'),
    { eyes: 'closed', mouth: null, props: [CAP_LIE], t: 5 }],
  outro: capOff() });
// Aufschrecken: Er schläft mit Mütze (kurz: zZ), zuckt zusammen (Ausrufezeichen), springt hoch und wirft dabei die Mütze ab:
// sie überschlägt sich und fliegt nach links quer über die Bühne hinaus. Er landet und schaut ihr nach.
// Standalone läuft das Intro (Mütze aufsetzen), beim echten Aufwecken aus dem Schlaf deckt der Carry den Anfang ab und es entfällt.
const capLanded: PropRef = ['mood_cap', CAP_PACK.at[0], CAP_PACK.at[1], 'g']
C('startled', 'Aufschrecken', 'night', { from: 'lie', to: 'stand',
  intro: capOn(true),
  frames: [
    zz(Z1(2), 2), zz(Z2(-1), 3),
    // Zusammenzucken: Augen auf, Mund auf, großes Ausrufezeichen neben dem Kopf
    { eyes: 'wide', mouth: 'o', props: [CAP_LIE, EXCL], t: 4 },
    ...capFly(),
    ...startleJump(),
    // Schreck sitzt noch: ein Schweißtropfen entsteht an der Stirn und rinnt herab, er schaut der Mütze nach
    { eyes: 'wide', props: [capLanded, ['mood_sweat', 15, 0, 'g']], t: 2 },
    { props: [capLanded, ['mood_sweat', 15, 2, 'g']], t: 2 },
    { look: [-1, 0], props: [capLanded, ['mood_sweat', 15, 4, 'g']], t: 2 },
    { look: [-2, 1], eyes: 'open', mouth: null, props: [capLanded], t: 3 }],
  // Er hebt sie auf und packt sie in die Tasche, dann beruhigt er sich
  outro: [...fetchOut(CAP_PACK), { eyes: 'half', t: 2 }, { eyes: 'open', t: 2 }] });
C('rub_eyes', 'Augen reiben', 'night', { frames: [
  { armL: 'rub', eyes: 'closed', t: 3 }, { armL: 'rubUp', t: 2 }, { armL: 'rub', t: 2 }, { armL: 'rubUp', t: 2 },
  { armL: 'down', armR: 'rub', t: 2 }, { armR: 'rubUp', t: 2 }, { armR: 'rub', t: 2 }, { armR: 'down', eyes: 'half', t: 4 }, { eyes: 'open', t: 3 }] });

// ---- Morgen
// Sonnenaufgang links hinten: Die Scheibe steigt hinter der Linie auf, er schaut hinüber (Hand als Blende vor den Augen), streckt sich mit Blockarmen,
// gähnt, lächelt der Sonne zu und winkt; sie geht danach wieder hinter der Linie unter (nichts verschwindet einfach).
const SUN_X = -16
const SUN_Y = -4
const sunAt = (x: number, y: number, tick: number): PropRef => [Math.floor(tick / 3) % 2 ? 'mood_sun2' : 'mood_sun', x, y, 'g']
const SUN_RISE: readonly number[] = [9, 7, 5, 3, 1, -1, -3, SUN_Y]
const sunRise = (): Frame[] => {
  const f: Frame[] = [{ eyes: 'half', t: 2 }]
  const arm: Record<number, Frame> = { 3: armBlock('L', 2, 3), 4: armBlock('L', 2, 2), 5: armBlock('L', 2, 1) }
  SUN_RISE.forEach((y, i) => {
    f.push({ ...arm[i], ...(i === 1 ? { look: [-2, 0] as const } : {}), ...(i === 3 ? { eyes: 'winkR' } : {}), props: [sunAt(SUN_X, y, i * 2)], t: 2 })
  })
  return f
}
C('morning_stretch', 'Morgen-Strecken', 'morning', {
  intro: sunRise(),
  frames: (() => {
    const f: Frame[] = []
    let tk = 16
    const s = (fr: Frame): void => {
      f.push({ ...fr, props: [sunAt(SUN_X, SUN_Y, tk)] })
      tk += fr.t ?? 1
    }
    // Hand als Blende vor den Augen, geblendet: Auge zu, dann sinkt die Hand in Schritten, er lächelt der Sonne zu
    s({ t: 6 })
    s({ ...armBlock('L', 2, 2), eyes: 'open', t: 2 })
    s({ ...armBlock('L', 2, 3), eyes: 'open', look: [-1, 0], mouth: 'smile', t: 3 })
    s({ armL: 'down', look: [0, 0], eyes: 'half', mouth: null, t: 3 })
    // Strecken: beide Arme sind 3 Pixel dicke Blöcke, die in 2-Pixel-Schritten nach oben wandern; der Körper wird um 1 höher, er gähnt
    const blk = (top: number): Frame => ({ armL: { out: 2, y: top, h: 3 }, armR: { out: 2, y: top, h: 3 } })
    s({ ...blk(3), t: 2 })
    s({ ...blk(1), squash: -1, eyes: 'closed', mouth: 'yawn', t: 2 })
    s({ ...blk(-1), t: 6 })
    s({ ...blk(1), t: 2 })
    s({ ...blk(3), squash: 0, mouth: null, eyes: 'open', t: 2 })
    // Zufrieden zur Sonne drehen, lächeln (rote Wangen), Arme zurück
    s({ armL: 'down', armR: 'down', look: [-1, 0], mouth: 'smile', t: 6 })
    return f
  })(),
  outro: (() => {
    const f: Frame[] = []
    // Winken (Blockarm wippt zwischen zwei Höhen) und die Sonne sinkt dabei hinter die Linie
    const ys = [...SUN_RISE].reverse().slice(1)
    ys.push(9, 11)
    ys.forEach((y, i) => {
      f.push({ armL: i % 2 ? 'up1' : 'up2', eyes: 'open', mouth: 'smile', look: [-1, 0], props: i < ys.length - 1 ? [sunAt(SUN_X, y, 40 + i * 2)] : [], t: i < ys.length - 1 ? 2 : 1 })
    })
    f.push({ armL: 'down', t: 2 })
    f.push({ eyes: 'open', mouth: null, look: [0, 0], t: 3 })
    return f
  })(),
})

// Kaffee: Tasse (mit Henkel) aus der Tasche holen, Dampf; die Blockhand hebt sie an und führt sie über den Körper zum Mund, die vordere Hand
// greift den Henkel. Er trinkt zweimal (Tasse leicht gekippt, Augen zu, kein Dampf mehr), setzt sie zufrieden wieder ab und packt sie weg.
const MUG = { name: 'mood_mug', size: [7, 6] as const, at: [-8, 4] as const, side: 'L' as const, grip: 3 }
const mug = (x: number, y: number, tilt = false): PropRef => [tilt ? 'mood_mug1' : 'mood_mug', x, y, 'g']
// Dampf: zwei Wölkchen übereinander im Wechsel, nur solange die Tasse neben ihm steht (über dem Kopf wäre er störend)
const steam = (x: number, y: number, k = 0): readonly PropRef[] => (x <= -5 ? [['steam' + (k % 2 ? 2 : 1), x + 3, y - 3], ['steam' + (k % 2 ? 1 : 2), x + 2, y - 6]] : [])
/** Seitliche Blockhand unter der Tasse (Spitze deckt ihre Kante, solange sie neben ihm ist). */
const mugHand = (x: number, y: number): Frame => armBlock('L', Math.max(2, 2 - (x + 6)), y + 3)
const MUG_X: readonly number[] = [-7, -5, -3, -1, 1] // Weg zum Mund in 2-Pixel-Schritten
C('coffee', 'Kaffee', 'morning', {
  intro: fetchIn(MUG),
  frames: [
    { look: [-2, 1], eyes: 'open', mouth: null, props: [mug(-8, 4), ...steam(-8, 4, 0)], t: 3 },
    { props: [mug(-8, 4), ...steam(-8, 4, 1)], t: 3 },
    // zugreifen, anheben und über den Körper zum Mund führen
    { ...mugHand(-8, 4), props: [mug(-8, 4), ...steam(-8, 4, 0)], t: 2 },
    { ...mugHand(-8, 3), props: [mug(-8, 3), ...steam(-8, 3, 1)], t: 1 },
    ...MUG_X.map((x, i): Frame => ({ ...mugHand(x, 3), look: [0, 0], props: [mug(x, 3), ...steam(x, 3, i)], t: 1 })),
    // die vordere Hand greift den Henkel, die Tasse steht vor dem Mund
    { armL: 'hold', eyes: 'half', props: [mug(3, 3)], t: 2 },
    // zwei Schlucke: Tasse kippt, Augen zu
    { eyes: 'closed', props: [mug(3, 3, true)], t: 3 },
    { props: [mug(3, 3)], t: 2 },
    { props: [mug(3, 3, true)], t: 4 },
    { eyes: 'happy', props: [mug(3, 3)], t: 2 },
    // zurück: Tasse absetzen, zufrieden lächeln
    ...[...MUG_X].reverse().map((x, i): Frame => ({ ...mugHand(x, 3), look: [-2, 1], mouth: 'smile', props: [mug(x, 3), ...steam(x, 3, i)], t: 1 })),
    { ...mugHand(-8, 3), props: [mug(-8, 3), ...steam(-8, 3, 0)], t: 1 },
    { ...mugHand(-8, 4), props: [mug(-8, 4), ...steam(-8, 4, 1)], t: 2 },
    { armL: 'down', props: [mug(-8, 4), ...steam(-8, 4, 0)], t: 3 },
    { mouth: null, eyes: 'open', props: [mug(-8, 4), ...steam(-8, 4, 1)], t: 3 },
  ],
  outro: fetchOut(MUG),
})

// Zähneputzen: Zahnbürste aus der Tasche (liegt neben ihm), die Blockhand hebt sie auf Mundhöhe und führt sie über den Körper zum Mund, die vordere Hand
// greift den Griff, er putzt (Bürste wackelt, Schaum), spült, bringt sie zurück und packt sie weg. Die Bürste liegt unter dem Mund, der Mund bleibt frei.
const BRUSH = { name: 'night_brush', size: [6, 1] as const, at: [-7, 9] as const, side: 'L' as const, grip: 0, rummage: 2 }
const br = (x: number, y: number): PropRef => ['night_brush', x, y, 'g']
const brHand = (x: number, y: number): Frame => armBlock('L', Math.max(2, 2 - (x + 5)), y)
const foam = (i: number): PropRef => ['puff', 10 + (i % 2), 6, 'g']
C('morning_brush', 'Zähne putzen', 'morning', {
  intro: fetchIn(BRUSH),
  frames: [
    { look: [-2, 1], eyes: 'half', mouth: null, props: [br(-7, 9)], t: 2 },
    ...[8, 7, 6].map((y): Frame => ({ ...brHand(-7, y), props: [br(-7, y)], t: 1 })),
    ...[-4, -1, 2].map((x): Frame => ({ ...brHand(x, 6), look: [0, 1], props: [br(x, 6)], t: 1 })),
    // die vordere Hand greift den Griff, die Borsten am Mund
    { armL: 'hold', mouth: 'flat', props: [br(3, 6)], t: 2 },
    ...Array.from({ length: 12 }, (_, i): Frame => ({ props: [br(3 + (i % 2), 6), ...(i > 2 ? [foam(i)] : [])], t: 1 })),
    { eyes: 'closed', props: [br(3, 6)], t: 3 },
    // zurück: Hand wechselt wieder an die Seite, Bürste zurück zur Ablage
    { ...brHand(2, 6), eyes: 'half', mouth: null, props: [br(3, 6)], t: 1 },
    ...[2, -1, -4].map((x): Frame => ({ ...brHand(x, 6), look: [-2, 1], props: [br(x, 6)], t: 1 })),
    ...[-7, -7, -7].map((x, i): Frame => ({ ...brHand(x, [7, 8, 9][i]), props: [br(x, [7, 8, 9][i])], t: 1 })),
    { armL: 'down', props: [br(-7, 9)], t: 2 }],
  outro: fetchOut(BRUSH),
})

export const CLIPS: readonly ClipDef[] = out
