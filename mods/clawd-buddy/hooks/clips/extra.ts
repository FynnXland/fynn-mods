// clawd-buddy: Clips für Komprimieren (session.compact) und Skill-Aufruf (skill.prompt).
//
// Komprimieren: aus viel Papier wird ein kleines, dichtes Päckchen. Das Papier kommt von unten aus der Eingabebox hoch (es ist ja der
// Gesprächsverlauf), was am Ende übrig ist, steckt er in die Tasche. Skill: ein Buch bzw. ein Werkzeugkasten kommt aus der Tasche,
// wird seitlich neben ihm geöffnet und wieder weggepackt.
//
// Schleifen (compact): Nur die Schleifengrenze ist ein "sicherer Frame" (fx 0, by 0, alles im Ausgangszustand). Während der Handlung
// steht er einen Pixel zur Seite versetzt (fx ≠ 0) oder macht einen Schritt, damit die Engine nicht mitten im Pressen aussteigt und das
// Outro auf einen Zustand träfe, der nicht mehr passt.
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { armBlock, fetchIn, fetchOut, riseIn, sinkOut } from '../macros.ts'
import type { FetchOpts } from '../macros.ts'

// ---------------------------------------------------------------------------------------------------------------------
// Zeichenhilfen
type Grid = string[][]
const grid = (w: number, h: number): Grid => Array.from({ length: h }, () => Array<string>(w).fill('.'))
const put = (g: Grid, x: number, y: number, c: string): void => {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c
}
const rect = (g: Grid, x: number, y: number, w: number, h: number, c: string): void => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c)
}
/** Zeichenkette ab (x, y) eintragen; '.' bleibt durchsichtig. */
const text = (g: Grid, x: number, y: number, s: string): void => {
  ;[...s].forEach((c, i) => c !== '.' && put(g, x + i, y, c))
}
const rowsOf = (g: Grid): string[] => g.map((r) => r.join(''))
const spr = (rows: readonly string[]): PropSprite => ({ rows })
const fxSpr = (rows: readonly string[]): PropSprite => ({ rows, effect: true })
const ref = (name: string, x: number, y: number): PropRef => [name, x, y, 'g']
/** Schattenstreifen der 3/4-Drehung (wie beim Laptop): die abgewandte Körperseite dunkel, 1 bis 3 Spalten breit. */
const turnQ = (w: number): PropSprite => fxSpr(Array.from({ length: 8 }, () => 'Q'.repeat(w)))

// ---------------------------------------------------------------------------------------------------------------------
// Requisiten: Komprimieren
/**
 * Papierstapel (eine Familie, lint verfolgt sie als einen Gegenstand): 0 = hoher, lockerer Stapel (Blätter weiß, dazwischen dunkle Luft,
 * Kanten versetzt), 1 und 2 = zusammengedrückt (enger, grau statt Luft), 3 = kleines, dichtes Päckchen mit brauner Schnur.
 */
const STACK: readonly (readonly string[])[] = [
  ['.WWWWWW.', '..DDDDD.', 'WWWWWWW.', '.DDDDDD.', '.WWWWWWW', '.DDDDD..', 'WWWWWWW.', 'GGGGGGGG'],
  ['.WWWWWW.', 'WWWWWWW.', '.GGGGGG.', 'WWWWWWWW', 'GGGGGGG.', 'GGGGGGGG'],
  ['WWWWWWW', 'GGGGGGG', 'WWWWWWW', 'GGGGGGG', 'GGGGGGG'],
  ['WWWRWW', 'GGGRGG', 'WWWRWW', 'GGGRGG'],
]

/**
 * Pappkarton (10x9, eine Familie). Oben zwei Zeilen Platz für den Papierhaufen, darunter die aufgeklappten Laschen, der helle Rand und
 * die braune Front. 0 leer, 1 bis 3 ein, zwei, drei Papierknäuel (bei 3 quillt er über), 4 und 5 zusammengedrückt, 6 die Laschen
 * klappen zu, 7 zu und mit hellem Klebeband verschlossen.
 */
function box(n: number): PropSprite {
  const g = grid(10, 9)
  rect(g, 1, 5, 8, 4, 'R')
  if (n < 7) {
    rect(g, 1, 4, 8, 1, 'C')
    if (n < 6) {
      // Laschen schräg nach außen aufgeklappt
      put(g, 0, 2, 'R')
      put(g, 9, 2, 'R')
      put(g, 1, 3, 'R')
      put(g, 8, 3, 'R')
    }
  } else {
    rect(g, 1, 4, 8, 1, 'R')
  }
  const heap: Record<number, readonly [number, number, string][]> = {
    1: [[3, 3, 'WG']],
    2: [[2, 3, 'WGWWG'], [3, 2, 'WW']],
    3: [[2, 3, 'GWWGWW'], [2, 2, 'WWGWWG'], [3, 1, 'WGWW'], [4, 0, 'GW']],
    4: [[2, 3, 'GWGWGW'], [2, 2, 'WGWGWG']],
    5: [[2, 3, 'GWGWGW']],
    6: [[3, 3, 'WGWG']],
  }
  for (const [x, y, s] of heap[n] ?? []) text(g, x, y, s)
  if (n === 6) {
    // Laschen halb zu: liegen schräg über dem Rand
    text(g, 1, 3, 'RR')
    text(g, 7, 3, 'RR')
  }
  if (n === 7) rect(g, 4, 4, 2, 2, 'C')
  return spr(rowsOf(g))
}
/** Papier (eine Familie, Effekt wegen des Knäuels, das im Karton verschwindet): 0 Blatt mit Textzeilen, 1 zerknüllt, 2 Knäuel. */
const PAPER: readonly (readonly string[])[] = [
  ['WWWWW', 'WGGGW', 'WWWWW', 'WGGWW', 'WWWWW', 'WGGGW'],
  ['.WGW.', 'WWGWG', 'GWWGW', '.GWW.'],
  ['WWG', 'GWW', 'WGW'],
]

// ---------------------------------------------------------------------------------------------------------------------
// Requisiten: Skill
/**
 * Buch (eine Familie): 0 zugeklappt von der Seite (blaue Deckel, Seitenblock, Rücken rechts), 1 der Deckel hebt sich an der vorderen
 * Kante, 2 der Deckel steht senkrecht am Rücken, 3 aufgeschlagen (zwei Seiten mit dunklen Textzeilen, in der Mitte der graue Falz, darunter der Deckel).
 */
function book(n: number): PropSprite {
  const pages = ['WWWWWWWN', 'GGGGGGGN', 'WWWWWWWN', 'NNNNNNNN']
  if (n === 0) return spr(['NNNNNNNN', ...pages])
  if (n === 1) return spr(['NN......', '..NN....', '....NN..', '......NN', ...pages])
  if (n === 2) return spr([...Array.from({ length: 8 }, () => '.......N'), ...pages])
  return spr([
    '.WWWWWW.WWWWWW.',
    'WWDDDWWGWDDDDWW',
    'WWWWWWWGWWWWWWW',
    'WDDWDDWGWDDWDDW',
    'WWWWWWWGWWWWWWW',
    'NNNNNNNNNNNNNNN',
  ])
}

/**
 * Werkzeugkasten (9x7, eine Familie): 0 zu (roter Kasten, schwarzer Tragegriff, Deckel mit dunkler Fuge, gelbes Schloss), 1 der Deckel hebt
 * sich (Spalt), 2 offen (Deckel nach hinten weggeklappt, dunkle Öffnung, darüber schauen Maul des Schraubenschlüssels und gelber
 * Schraubendreher heraus), 3 offen ohne den Schlüssel (der steckt dann als eigene Requisite an derselben Stelle).
 * Die offene Form hat oben nichts, was der Schlüssel durchschneiden könnte: so bleibt der Kasten für lint ein Stück.
 */
function toolbox(n: number): PropSprite {
  if (n === 0) return spr(['..DDDDD..', '..D...D..', 'MMMMMMMMM', 'MMMMMMMMM', 'DDDDDDDDD', 'MMMMYMMMM', 'MMMMMMMMM'])
  if (n === 1) return spr(['.DDDDD...', '.D...D...', 'MMMMMMMM.', 'DDDDDDDDD', 'DDDDDDDDD', 'MMMMYMMMM', 'MMMMMMMMM'])
  const g = grid(9, 7)
  if (n === 2) {
    text(g, 1, 0, '.W.W.')
    text(g, 1, 1, '.WWW.')
  }
  text(g, 7, 0, 'Y')
  text(g, 7, 1, 'Y')
  text(g, 0, 2, 'DTTTTTTTD')
  text(g, 0, 3, 'MMMMMMMMM')
  text(g, 0, 4, 'MMMMMMMMM')
  text(g, 0, 5, 'MMMMYMMMM')
  text(g, 0, 6, 'MMMMMMMMM')
  return spr(rowsOf(g))
}
/** Bild um 90° im Uhrzeigersinn drehen. */
const rot = (rows: readonly string[]): string[] =>
  Array.from({ length: rows[0].length }, (_, x) => Array.from({ length: rows.length }, (_, y) => rows[rows.length - 1 - y][x]).join(''))
/**
 * Ringmaulschlüssel (5x8, eine Familie): oben das offene Maul, unten der Ring (graues Loch), dazwischen der Griff.
 * 0 bis 3: eine volle Drehung gegen den Uhrzeigersinn in 90°-Schritten (0 Maul oben, 1 Maul links, 2 Maul unten, 3 Maul rechts).
 * 4 und 5: nur die oberen zwei bzw. vier Zeilen von 0, solange der Rest noch im Kasten steckt.
 */
const W_UP = ['.W.W.', '.WWW.', '..W..', '..W..', '..W..', '..W..', '.WGW.', '.WWW.']
const WRENCH: readonly (readonly string[])[] = [W_UP, rot(rot(rot(W_UP))), rot(rot(W_UP)), rot(W_UP), W_UP.slice(0, 2), W_UP.slice(0, 4)]

export const PROPS: Readonly<Record<string, PropSprite>> = {
  ...Object.fromEntries(STACK.map((r, i) => [`cmp_st${i}`, spr(r)])),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((n) => [`cmp_box${n}`, box(n)])),
  cmp_pp0: spr(PAPER[0]),
  cmp_pp1: spr(PAPER[1]),
  cmp_pp2: fxSpr(PAPER[2]),
  cmp_tq1: turnQ(1),
  cmp_tq2: turnQ(2),
  cmp_tq3: turnQ(3),
  cmp_fh: fxSpr(['QQQ', 'QQQ']),
  ...Object.fromEntries([0, 1, 2, 3].map((n) => [`skl_bk${n}`, book(n)])),
  ...Object.fromEntries([0, 1, 2, 3].map((n) => [`skl_tb${n}`, toolbox(n)])),
  ...Object.fromEntries(WRENCH.map((r, i) => [`skl_wr${i}`, spr(r)])),
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}
const blkR = (o: number, y: number): Frame => armBlock('R', o, y)
const blkL = (o: number, y: number): Frame => armBlock('L', o, y)

// ---------------------------------------------------------------------------------------------------------------------
// Komprimieren 1 (ruhig): Ein hoher Papierstapel steigt rechts neben ihm aus der Eingabebox. Er dreht sich zu ihm (3/4, Schattenstreifen
// wie beim Laptop), legt beide Hände oben auf und drückt ihn in drei Stößen zusammen, bis ein kleines verschnürtes Päckchen übrig ist.
// Das kommt in die Tasche, der nächste Stapel steigt herauf, er tritt zurück: Schleifengrenze.
const SX = 18
const ST_H = [8, 6, 5, 4]
const ST_W = [8, 8, 7, 6]
const st = (k: number): PropRef => ref(`cmp_st${k}`, SX, 10 - ST_H[k])
const TQ = (w: number, x = 2): PropRef => [`cmp_tq${w}`, x, 0]
/** Beide Hände oben auf dem Stapel k (nahe Hand = Blockarm, ferne Hand = dunkler Block weiter rechts), `lift` Pixel darüber. */
function hands(k: number, by: number, lift: number, extra: Frame = {}, t = 1): Frame {
  const y = 10 - ST_H[k] - 2 - lift
  return {
    fx: 1, face: 1, armL: 'hide', by, ...blkR(4, y - by), look: [1, 1],
    props: [st(k), TQ(3), ref('cmp_fh', SX + ST_W[k] - 4, y)], t, ...extra,
  }
}
/** Ein Stoß: Hände heben, aufsetzen, mit dem ganzen Körper drücken (Augen zu), der Stapel wird zu k+1, kurz nachlassen. */
const press = (k: number): Frame[] => [
  hands(k, 0, 1, {}, 2),
  hands(k, 0, 0),
  hands(k + 1, 1, 0, { eyes: 'closed' }, 3),
  hands(k + 1, 0, 0, { eyes: 'open' }, 2),
]
const STACK_UP = { name: 'cmp_st0', size: [8, 8] as const, at: [SX, 2] as const, during: { look: [1, 1] as const } }
const PACK: FetchOpts = { name: 'cmp_st3', size: [6, 4], at: [SX, 6], side: 'R', fx: 1 }
C('compact_press', 'Presst einen Papierstapel', 'compact', {
  loop: true, interruptible: true,
  intro: [...riseIn(STACK_UP), { look: [0, 0], t: 3 }],
  frames: [
    // zum Stapel wenden
    { fx: 1, face: 1, look: [1, 0], props: [st(0), TQ(1)], t: 2 },
    { armL: 'hide', props: [st(0), TQ(2)], t: 2 },
    ...press(0), ...press(1), ...press(2),
    // fertig: Freude, ein Funkeln am Päckchen
    hands(3, 0, 1, { eyes: 'happy', props: [st(3), TQ(3), ref('sparkle', SX + 6, 3)] }, 3),
    // zurückdrehen, Hände weg
    { armR: 'down', eyes: 'open', look: [1, 1], props: [st(3), TQ(2)], t: 2 },
    { face: 0, armL: 'down', props: [st(3), TQ(1)], t: 1 },
    { props: [st(3)], t: 1 },
    // Päckchen in die Tasche, der nächste Stapel kommt herauf
    ...fetchOut(PACK),
    ...riseIn(STACK_UP),
    { fx: 0, look: [0, 0], t: 3 },
  ],
  outro: [...sinkOut(STACK_UP), { look: [0, 0], t: 2 }],
})

// ---------------------------------------------------------------------------------------------------------------------
// Komprimieren 2: Ein leerer Pappkarton kommt aus der Tasche und steht links. Rechts steigt ein beschriebenes Blatt aus der Eingabebox,
// er nimmt es, knüllt es zusammen und wirft das Knäuel im Bogen über den Kopf in den Karton. Nach drei Blättern quillt der Karton über:
// er dreht sich hin und drückt den Haufen mit beiden Händen platt, klappt die Laschen zu (Klebeband), steckt das Päckchen ein und holt
// den nächsten leeren Karton.
const BXX = -10
const bx = (n: number): PropRef => ref(`cmp_box${n}`, BXX, 1)
const pp = (n: number, x: number, y: number): PropRef => ref(`cmp_pp${n}`, x, y)
/** Flugbahn des Knäuels (3x3) von der erhobenen Hand rechts über den Kopf in den Karton links. */
const ARC: readonly (readonly [number, number])[] = [[12, -3], [8, -3], [4, -3], [0, -3], [-4, -2], [-6, 0], [-7, 2]]
const ARC_LOOK: readonly (readonly [number, number])[] = [[1, -1], [0, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [-1, 1]]
/** Ein Blatt verarbeiten: Karton steht im Zustand n und ist danach im Zustand n+1. Er steht die ganze Zeit bei fx 1 (kein sicherer Frame). */
function sheet(n: number): Frame[] {
  const b = bx(n)
  const fr: Frame[] = [{ fx: 1, look: [1, 1], eyes: 'open', armR: 'down', props: [b], t: 1 }]
  fr.push(...riseIn({ name: 'cmp_pp0', size: [5, 6], at: [SX, 4], step: 2, keep: [b] }))
  fr.push(
    // greifen, anheben, knüllen (Augen zu, die Hand drückt), Knäuel
    { ...blkR(3, 4), props: [b, pp(0, SX, 4)], t: 1 },
    { ...blkR(3, 2), look: [1, 0], props: [b, pp(0, SX, 2)], t: 1 },
    { ...blkR(2, 3), eyes: 'closed', props: [b, pp(1, SX, 3)], t: 2 },
    { ...blkR(3, 4), eyes: 'open', look: [1, 1], props: [b, pp(2, SX, 4)], t: 2 },
    // ausholen und werfen
    { ...blkR(3, 5), props: [b, pp(2, SX, 5)], t: 1 },
    { armR: 'raise', look: [1, -1], props: [b, pp(2, 16, -3)], t: 1 },
  )
  // im letzten Bild fällt es in den Karton (vor dem Karton gezeichnet, dessen Rand verdeckt es)
  ARC.forEach(([x, y], i) => fr.push({ armR: i < 2 ? 'up1' : 'down', look: ARC_LOOK[i], props: i === ARC.length - 1 ? [pp(2, x, y), b] : [b, pp(2, x, y)], t: 1 }))
  // landet im Karton
  fr.push({ look: [-1, 1], eyes: n === 2 ? 'wide' : 'open', props: [bx(n + 1)], t: n === 2 ? 4 : 2 })
  return fr
}
/** Beide Hände auf dem Haufen (zur linken Seite gewandt): nahe Hand = Blockarm links, ferne Hand = dunkler Block weiter links. */
const HEAP_TOP: Record<number, number> = { 3: 1, 4: 3, 5: 4 }
function squash(n: number, by: number, lift: number, extra: Frame = {}, t = 1): Frame {
  const y = HEAP_TOP[n] - 2 - lift
  return {
    fx: -1, legs: 'stand', face: -1, armR: 'hide', by, ...blkL(4, y - by), look: [-1, 1],
    props: [bx(n), TQ(3, 12), ref('cmp_fh', BXX + 3, y)], t, ...extra,
  }
}
const BOX0: FetchOpts = { name: 'cmp_box0', size: [10, 9], at: [BXX, 1], side: 'L', grip: 2 }
const BOX7: FetchOpts = { name: 'cmp_box7', size: [10, 9], at: [BXX, 1], side: 'L', grip: 4, fx: -1 }
C('compact_box', 'Knüllt Papier in einen Karton', 'compact', {
  loop: true, interruptible: true,
  intro: fetchIn(BOX0),
  frames: [
    ...sheet(0), ...sheet(1), ...sheet(2),
    // hinüber zum Karton (ein Schritt, kein sicherer Frame dazwischen) und zur Seite wenden
    { fx: 0, legs: 'stepA', look: [-1, 0], props: [bx(3)], t: 1 },
    { fx: -1, legs: 'stand', face: -1, armR: 'down', props: [bx(3), TQ(1, 14)], t: 2 },
    { armR: 'hide', props: [bx(3), TQ(2, 13)], t: 1 },
    // zweimal platt drücken
    squash(3, 0, 1, {}, 2), squash(3, 0, 0), squash(4, 1, 0, { eyes: 'closed' }, 3), squash(4, 0, 0, { eyes: 'open' }, 2),
    squash(4, 0, 1), squash(4, 0, 0), squash(5, 1, 0, { eyes: 'closed' }, 3), squash(5, 0, 0, { eyes: 'open' }, 2),
    // Laschen zuklappen, zukleben
    squash(5, 0, 1, { props: [bx(6), TQ(3, 12), ref('cmp_fh', BXX + 3, 1)] }, 2),
    squash(5, 0, 0, { props: [bx(7), TQ(3, 12), ref('cmp_fh', BXX + 3, 2)], eyes: 'happy' }, 3),
    // zurückdrehen
    { eyes: 'open', armL: 'down', props: [bx(7), TQ(2, 13)], t: 1 },
    { face: 0, armR: 'down', props: [bx(7), TQ(1, 14)], t: 1 },
    { props: [bx(7)], t: 1 },
    // Päckchen einstecken, neuen Karton holen, zurück an den Platz
    ...fetchOut(BOX7),
    ...fetchIn({ ...BOX0, fx: -1 }),
    { fx: 0, look: [0, 0], t: 2 },
  ],
  outro: fetchOut(BOX0),
})

// ---------------------------------------------------------------------------------------------------------------------
// Skill 1 (ruhig): Ein Buch kommt aus der Tasche und liegt zugeklappt rechts neben ihm. Er hebt den Deckel an der vorderen Kante, der
// Deckel stellt sich am Rücken auf und klappt nach rechts, das Buch liegt offen. Er legt die Hand auf die Seite, es funkelt, er nickt
// verstehend, klappt es zu und packt es wieder ein.
const BK: FetchOpts = { name: 'skl_bk0', size: [8, 5], at: [SX, 5], side: 'R', rummage: 3 }
const BK_Y = [5, 2, -2, 4]
const bk = (n: number): PropRef => ref(`skl_bk${n}`, SX, BK_Y[n])
C('skill_book', 'Schlägt ein Buch auf', 'skill', {
  intro: fetchIn(BK),
  frames: [
    // aufschlagen
    { ...blkR(4, 3), look: [1, 1], props: [bk(0)], t: 2 },
    { ...blkR(4, 0), look: [1, 0], props: [bk(1)], t: 2 },
    { armR: 'up1', look: [1, -1], props: [bk(2)], t: 2 },
    { armR: 'down', look: [1, 1], props: [bk(3)], t: 2 },
    // Hand auf die Seite, Funkeln über dem Buch
    { ...blkR(4, 2), t: 1 },
    { eyes: 'wide', props: [bk(3), ref('sparkle', 21, 0)], t: 2 },
    { props: [bk(3), ref('sparkle', 22, -2)], t: 2 },
    { eyes: 'open', armR: 'down', props: [bk(3)], t: 1 },
    // verstehendes Nicken
    { by: 1, eyes: 'closed', t: 2 }, { by: 0, eyes: 'open', t: 1 }, { by: 1, eyes: 'closed', t: 2 }, { by: 0, eyes: 'open', t: 2 },
    // zuklappen: der Deckel kommt über den Rücken zurück, die Hand fängt ihn an der Kante und drückt ihn zu
    { armR: 'up1', look: [1, -1], props: [bk(2)], t: 1 },
    { ...blkR(4, 0), look: [1, 0], props: [bk(1)], t: 1 },
    { ...blkR(4, 3), look: [1, 1], props: [bk(0)], t: 2 },
    { armR: 'down', look: [0, 0], t: 1 },
  ],
  outro: fetchOut(BK),
})

// ---------------------------------------------------------------------------------------------------------------------
// Skill 2: Ein Werkzeugkasten kommt aus der Tasche und steht rechts neben ihm. Er klappt den Deckel auf, zieht einen Ringmaulschlüssel heraus,
// hält ihn neben dem Kopf hoch und dreht ihn einmal ganz herum (es blitzt), steckt ihn zurück, klappt zu und packt den Kasten wieder ein.
// Beim Herausziehen ist nur der Teil über dem Kastenrand zu sehen (Bilder 4 und 5). Solange nur das Maul an der Hand herausschaut, heißt der
// Schlüssel `skl_wr4@100` (gleiches Bild): für lint ein kleiner Gegenstand an der Hand, wie aus der Tasche.
const TB: FetchOpts = { name: 'skl_tb0', size: [9, 7], at: [SX, 3], side: 'R', grip: 2, rummage: 3 }
const tb = (n: number): PropRef => ref(`skl_tb${n}`, SX, 3)
const wr = (n: number | string, x: number, y: number): PropRef => ref(typeof n === 'number' ? `skl_wr${n}` : n, x, y)
/** Schlüssel n so legen, dass sein Mittelpunkt bei (17.5, -0.5) an der erhobenen Hand bleibt (über dem Kasten, unter dem Bühnenrand). */
const wrAt = (n: number): PropRef => {
  const r = WRENCH[n]
  return wr(n, Math.round(17.5 - r[0].length / 2), Math.round(-0.5 - r.length / 2))
}
/** Herausziehen (rückwärts: zurückstecken): Hand und Schlüssel in Stufen. */
const PULL: readonly Frame[] = [
  { ...blkR(4, 3), look: [1, 1], props: [tb(3), wr('skl_wr4@100', 19, 3)], t: 1 },
  { ...blkR(4, 1), look: [1, 0], props: [tb(3), wr(5, 19, 1)], t: 1 },
  { ...blkR(4, -1), look: [1, -1], props: [tb(3), wr(0, 17, -3)], t: 1 },
]
C('skill_tools', 'Holt einen Schraubenschlüssel', 'skill', {
  intro: fetchIn(TB),
  frames: [
    // Deckel auf: der Griff kippt nach hinten, dann ist der Kasten offen
    { ...blkR(4, 3), look: [1, 1], props: [tb(0)], t: 1 },
    { ...blkR(4, 2), props: [tb(1)], t: 1 },
    { armR: 'down', props: [tb(2)], t: 1 },
    // in den Kasten greifen und den Schlüssel herausziehen
    ...PULL,
    { ...blkR(3, -1), props: [tb(3), wrAt(0)], t: 1 },
    // einmal ganz herumdrehen
    ...[1, 2, 3, 0].map((n, i): Frame => ({ eyes: i === 1 ? 'wide' : 'open', props: [tb(3), wrAt(n)], t: 2 })),
    // es blitzt: bereit
    { eyes: 'happy', props: [tb(3), wrAt(0), ref('sparkle', 20, -4)], t: 3 },
    // zurückstecken, Deckel zu
    ...[...PULL].reverse().map((f): Frame => ({ ...f, eyes: 'open', look: [1, 1], t: 1 })),
    { armR: 'down', props: [tb(2)], t: 1 },
    { ...blkR(4, 2), props: [tb(1)], t: 1 },
    { ...blkR(4, 3), props: [tb(0)], t: 1 },
  ],
  outro: fetchOut(TB),
})

export const CLIPS: readonly ClipDef[] = out
