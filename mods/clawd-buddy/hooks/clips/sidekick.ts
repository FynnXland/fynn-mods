// clawd-buddy: Clips der Gruppe "sidekick" (Schnittstelle zum Mod sidekick: prüft deine Nachricht, hält sie an, baut einen neuen Chat).
//
// Kategorien (die Engine wählt nach Stimmung): sk_check (prüft, Ende offen), sk_stop (hält an, wartet auf Fynn), sk_handoff (schreibt den
// Übergabebrief für den neuen Chat), sk_fresh (der neue Chat ist da). Der erste Clip jeder Kategorie ist der ruhigste (reduzierte Bewegung).
//
// Stil wie die Referenz type_laptop: Blockhände, Gegenstände kommen aus der Tasche (Hocke, Hand wühlt, ein Auge zu, Gegenstand klein an der Hand,
// er wächst) und gehen dorthin zurück; was gehalten wird, steht seitlich neben der Figur. Die Eingabe liegt UNTER der Linie: Blick nach unten.
// Alle Gegenstände tragen 'g' (fest auf der Bühne), die Figur läuft hier nirgends hin.
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { armBlock, fetchIn, fetchOut, riseIn, sinkOut } from '../macros.ts'

type Side = 'L' | 'R'
const g = (name: string, x: number, y: number): PropRef => [name, x, y, 'g']
const spr = (rows: readonly string[]): PropSprite => ({ rows })
const fxs = (rows: readonly string[]): PropSprite => ({ rows, effect: true })

// ---- Requisiten ------------------------------------------------------------------------------------------------------------------

/**
 * Lupe 8×8, Griff oben rechts (die Hand hält sie von oben, das Glas zeigt schräg nach unten zur Eingabe): weißer Ring, hellblauer Glanz,
 * im Glas vergrößerte Schrift (grau). `v` verschiebt die Wörter, als glitte die Lupe über den Text.
 */
const lens = (v: number): PropSprite => spr([
  '......CC',
  '.....CC.',
  '.WWWWC..',
  'WL...W..',
  v ? 'W.GGGW..' : 'WGG.GW..',
  'W....W..',
  v ? 'WGG.GW..' : 'WG.GGW..',
  '.WWWW...',
])

/** Stoppschild: rotes Achteck mit weißem Rand und weißem Querbalken (9×10) an einem kurzen grauen Stiel (2 Zeilen). */
const SIGN_ROWS = [
  '..WWWWW..',
  '.WMMMMMW.',
  'WMMMMMMMW',
  'WMMMMMMMW',
  'WMWWWWWMW',
  'WMWWWWWMW',
  'WMMMMMMMW',
  'WMMMMMMMW',
  '.WMMMMMW.',
  '..WWWWW..',
  '....G....',
  '....G....',
]

/**
 * Briefbogen 7×9 (steht seitlich auf der Linie): weißes Blatt, vier Schriftzeilen (dunkelgrau) in den Zeilen 1, 3, 5, 7. Zustand n = 0 … 8:
 * Zeile k ist halb geschrieben bei n = 2k + 1 und fertig ab n = 2k + 2.
 */
const LINE_FULL = ['DDD.', 'DD.D', 'DDDD', '.DDD']
const LINE_HALF = ['DD..', 'DD..', 'DD..', '.DD.']
function sheet(n: number): PropSprite {
  const rows = Array.from({ length: 9 }, () => 'WWWWWWW')
  for (let k = 0; k < 4; k++) {
    const txt = n >= 2 * k + 2 ? LINE_FULL[k] : n === 2 * k + 1 ? LINE_HALF[k] : null
    if (txt) rows[1 + 2 * k] = 'W' + txt.replace(/\./g, 'W') + 'WW'
  }
  return spr(rows)
}

/** Umschlag 7×5: creme (hebt sich vom weißen Brief ab), V-förmige Klappe (grau); `seal` setzt das rote Siegel in die Spitze der Klappe. */
const envelope = (seal: boolean): PropSprite => spr(['GCCCCCG', 'CGCCCGC', 'CCGCGCC', seal ? 'CCCMCCC' : 'CCCGCCC', 'CCCCCCC'])

export const PROPS: Readonly<Record<string, PropSprite>> = {
  sk_lens0: lens(0),
  sk_lens1: lens(1),
  sk_sign: spr(SIGN_ROWS),
  // Brief: Schreibzustände 0 … 8, dann gefaltet (halb: sk_ltr9, ganz: sk_ltrHi) und beim Umblättern hochkant (sk_ltrFlip). Eine Familie
  // (lint.ts → family), damit Falten und Umblättern als derselbe Gegenstand gelten.
  ...Object.fromEntries(Array.from({ length: 9 }, (_, n) => ['sk_ltr' + n, sheet(n)])),
  sk_ltr9: spr(['GGGGGGG', 'WWWWWWW', 'WDDWDWW', 'WWWWWWW', 'WWWWWWW']),
  sk_ltrHi: spr(['GGGGGGG', 'WWWWWWW', 'WWWWWWW']),
  sk_ltrFlip: spr(['..WG...', '..WG...', '..WG...', '..WG...', '..WG...', '..WG...', '..WG...', '..WG...', '..WG...']),
  // Schreibhand vor dem Blatt (Schattenton Q wie die Vorderarme): 0 = Hand am Blattrand, 1 = einen Pixel weiter auf dem Blatt, mit Stiftspitze (D)
  sk_tip0: { rows: ['QQ', 'QQ'], effect: true, hand: true },
  sk_tip1: { rows: ['QQQ', 'DQQ'], effect: true, hand: true },
  // Umschläge (zu): 0 = unversiegelt, 1 = versiegelt
  sk_env0: envelope(false),
  sk_env1: envelope(true),
  // Geöffnet (7×9, unten der cremefarbene Umschlag mit grauer Öffnungskante, darüber die aufgeklappte Klappe): 2 = leer offen, 3 = der Brief (weiß,
  // Schriftzeilen) kommt heraus, 4 = der Brief steht weit heraus
  sk_env2: spr(['.......', '...C...', '..CCC..', '.CCCCC.', 'GGGGGGG', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC']),
  sk_env3: spr(['.......', '...C...', '.WWWWW.', '.WDDDW.', 'GWWWWWG', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC']),
  sk_env4: spr(['.WWWWW.', '.WDDDW.', 'CWWWWWC', 'CWDDWWC', 'GWWWWWG', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC', 'CCCCCCC']),
  // Effekte: konzentrierte Augenbrauen (über beiden Augen), grüner Haken (Zeile geprüft), gelbes Ausrufezeichen, weißer Pfeil nach unten
  sk_brow: fxs(['QQ.......QQ', '..Q.....Q..']),
  sk_tick: fxs(['....E', '...E.', 'E.E..', '.E...']),
  sk_excl: fxs(['YY', 'YY', 'YY', 'YY', '..', 'YY']),
  sk_arrow: fxs(['..W..', '..W..', '..W..', 'W.W.W', '.WWW.', '..W..']),

  // ---- 0.13.0: Rückfragen nach Grund, Hinweiszeile, Wartung ----
  // Atemwölkchen in der Kälte (klein, weiß) und Zähneklappern (der schmale Mund geht auf und zu, stage.ts → MOUTH.whistle)
  sk_breath: fxs(['.W', 'WW']),
  sk_breath2: fxs(['W.W', '.W.']),
  // Landkarte 9×6: Papier creme, Falz grau, Fluss blau, Wald grün, rotes Kreuz; 1 = hochkant gedreht, 2 = auf dem Kopf
  sk_map0: spr(['CEECGCCBC', 'EECCGCBCC', 'CCCCGBCCC', 'CCCBGCCMC', 'CCBCGCMCM', 'CBCCGCCMC']),
  sk_map1: spr(['CBCCEC', 'CCBCEE', 'CCCBCE', 'GGGGGG', 'CCCCBC', 'CMCCCB', 'MCMCCC', 'CMCCCC', 'CCCCCC']),
  sk_map2: spr(['CMCCGCCBC', 'MCMCGCBCC', 'CMCCGBCCC', 'CCCBGCCCC', 'CCBCGCCEE', 'CBCCGCEEC']),
  // Waage 11×7 (steht auf der Linie): Ständer grau, Balken gekippt, zwei gelbe Schalen; 0 = links unten, 1 = rechts unten
  sk_scale0: spr(['.....G.....', '.....GGGGG.', '.GGGGG...G.', '.G...G..YYY', 'YYY..G.....', '.....G.....', '...GGGGG...']),
  sk_scale1: spr(['.....G.....', '.GGGGG.....', '.G...GGGGG.', 'YYY..G...G.', '.....G..YYY', '.....G.....', '...GGGGG...']),
  // Zwei Zettel 5×6: links grau verkritzelt (alte Fassung), rechts sauber mit grünem Haken (Haikus Fassung)
  sk_noteA: spr(['WWWWW', 'WGGWW', 'WWGGW', 'WGWGW', 'WGGWW', 'WWWWW']),
  sk_noteB: spr(['WWWWW', 'WWWWE', 'WWWEW', 'EWEWW', 'WEWWW', 'WWWWW']),
  // Block 7×9 für „neues Thema“: 0 = beschriebene Seite, Flip = Seite steht beim Umblättern hochkant, 1 = leeres Blatt
  sk_pad0: spr(['RRRRRRR', 'WWWWWWW', 'WDDDWDW', 'WWWWWWW', 'WDDWDDW', 'WWWWWWW', 'WDDDDWW', 'WWWWWWW', 'WWWWWWW']),
  sk_padFlip: spr(['RRRRRRR', '...WG..', '...WG..', '...WG..', '...WG..', '...WG..', '...WG..', '...WG..', '...WG..']),
  sk_pad1: spr(['RRRRRRR', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW', 'WWWWWWW']),
  // Glühbirne über dem Kopf: 0 = aus (grau), 1 = an (gelb, weißer Glühfaden, Strahlen)
  sk_bulb0: fxs(['..GGG..', '.GGGGG.', '..GGG..', '...D...']),
  sk_bulb1: fxs(['Y.YYY.Y', '.YYWYY.', 'Y.YYY.Y', '...D...']),
  // Ölkännchen 6×5 (grau, Tülle oben links, Griff rechts): 0 = aufrecht, 1 = geneigt (Tülle unten); Öltropfen goldgelb
  sk_oil0: spr(['G.....', '.G.DD.', '..GGGD', '.GGGGD', '.GGGG.']),
  sk_oil1: spr(['......', '...DD.', '.GGGGD', 'GGGGGD', 'G.GGG.']),
  sk_drop: fxs(['Y', 'Y']),
  // Besen 3×8 (Stiel braun, Borsten gelb) und kleine Staubwölkchen
  sk_broom: spr(['.R.', '.R.', '.R.', '.R.', '.R.', 'YYY', 'YYY', 'Y.Y']),
  sk_dust: fxs(['G.', 'GG']),
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Bausteine -------------------------------------------------------------------------------------------------------------------

/** Kurzes Kramen in der Tasche (wie fetchIn, aber schneller): Blick zur Seite, Auge zu, Hocke, Hand wackelt unten, freier Arm etwas hoch. */
function dig(side: Side, n: number, keep: readonly PropRef[] = []): Frame[] {
  const away = side === 'L' ? 'armR' : 'armL'
  const eyes = side === 'L' ? 'winkR' : 'winkL'
  const look: readonly [number, number] = side === 'L' ? [-2, 1] : [2, 1]
  const f: Frame[] = [{ look, eyes, props: keep, t: 1 }]
  for (let i = 0; i < n; i++) f.push({ by: 1, eyes, look, ...armBlock(side, 1, i % 2 ? 6 : 5), [away]: 'up1', props: keep, t: 1 })
  return f
}

/** Gegenstück: Hand mit dem kleinen Gegenstand an der Tasche, er verschwindet darin, die Hand wühlt kurz nach, aufrichten. */
function stow(small: PropRef, keep: readonly PropRef[] = []): Frame[] {
  return [
    { by: 1, eyes: 'winkR', look: [-2, 1], ...armBlock('L', 1, 5), props: [...keep, small], t: 1 },
    { by: 1, ...armBlock('L', 1, 6), props: keep, t: 1 },
    { by: 1, ...armBlock('L', 1, 5), t: 1 },
    { by: 0, eyes: 'open', look: [0, 0], face: 0, armL: 'down', t: 2 },
  ]
}

// =================================================================================================================================
// sk_check: sidekick prüft die Nachricht (1–6 s, Ende offen). Schleifen, überall sichere Frames.
// =================================================================================================================================

// 1 (ruhig): Er liest die Eingabe unter sich konzentriert mit: Augenbrauen zusammengezogen, Blick wandert Zeile für Zeile (Gesicht und Pupille),
// stockt an einem Wort, nickt prüfend, ein kleiner grüner Haken steigt neben dem Kopf auf (die Zeile ist geprüft).
const brow = (face: number, lx: number): PropRef => ['sk_brow', 3 + face + lx, 2]
const rd = (face: number, lx: number, t: number, extra: Frame = {}): Frame => ({ face, look: [lx, 1], props: [brow(face, lx)], t, ...extra })
const scanLine = (): Frame[] => [rd(-1, -1, 3), rd(-1, 0, 3), rd(0, 0, 3), rd(0, 1, 3), rd(1, 1, 4)]
const tick = (y: number): PropRef => g('sk_tick', 16, y)
const nodTick = (): Frame[] => [
  { face: 0, look: [0, 1], eyes: 'open', props: [], t: 2 },
  { by: 1, props: [], t: 2 },
  { by: 0, props: [tick(-2)], t: 3 },
  { props: [tick(-3)], t: 3 },
  { props: [], t: 2 },
]
C('sk_read_check', 'Liest deine Nachricht prüfend mit', 'sk_check', {
  loop: true, interruptible: true,
  frames: [
    rd(-1, -1, 2, { eyes: 'half' }),
    ...scanLine(),
    // stockt an einem Wort: Augen ganz auf, kurz verweilen, dann weiter
    rd(0, 0, 2, { eyes: 'open' }), rd(0, 0, 3, { eyes: 'half' }),
    ...nodTick(),
    rd(-1, -1, 2, { eyes: 'half' }),
    ...scanLine(),
    ...nodTick(),
  ],
})

// 2: Er holt die Lupe aus der Tasche (kurz, unter 1 s), hält sie seitlich mit dem Glas schräg nach unten über die Eingabe, ein Auge zu, und
// schwenkt sie langsam hin und her; im Glas laufen die vergrößerten Wörter mit. Beim Verlassen schrumpft sie zurück in die Tasche.
const lensAt = (dx: number, dy: number, v: number, t: number, extra: Frame = {}): Frame => ({
  ...armBlock('L', 2 + dx, 1 + dy), props: [g('sk_lens' + v, -7 - dx, 1 + dy)], t, ...extra,
})
C('sk_lens_check', 'Prüft deine Nachricht mit der Lupe', 'sk_check', {
  loop: true, interruptible: true,
  intro: [
    ...dig('L', 3),
    { by: 0, eyes: 'wide', look: [-1, -1], ...armBlock('L', 2, 1), armR: 'down', props: [g('sk_lens0@40', -3, -2)], t: 2 },
    { eyes: 'open', ...armBlock('L', 2, 0), props: [g('sk_lens0@70', -6, -2)], t: 1 },
    lensAt(0, 0, 0, 2, { eyes: 'winkR', look: [-1, 1] }),
  ],
  frames: [
    lensAt(0, 0, 0, 3, { eyes: 'winkR', look: [-1, 1] }),
    lensAt(1, 0, 1, 3),
    lensAt(2, 0, 0, 3),
    lensAt(2, 1, 1, 3),
    lensAt(1, 1, 0, 3),
    // kurz aufschauen (beide Augen auf), dann weiter prüfen
    lensAt(1, 1, 0, 3, { eyes: 'open', look: [0, 0] }),
    lensAt(0, 1, 1, 3, { eyes: 'winkR', look: [-1, 1] }),
    lensAt(0, 0, 0, 3),
  ],
  outro: [
    lensAt(0, 0, 0, 1, { eyes: 'open', look: [-1, 0] }),
    { ...armBlock('L', 2, 1), props: [g('sk_lens0@70', -6, -1)], t: 1 },
    { ...armBlock('L', 2, 3), props: [g('sk_lens0@40', -2, 2)], t: 1 },
    ...stow(g('sk_lens0@25', -1, 4)),
  ],
})

// =================================================================================================================================
// sk_stop: sidekick hält die Nachricht an und fragt per Dialog (Schleife, bis Fynn antwortet). Freundlich, nicht böse.
// =================================================================================================================================

// 1 (ruhig): "Moment mal!" Er hebt eine Hand, ein gelbes Ausrufezeichen erscheint neben dem Kopf; dann zeigt er mit der anderen Hand nach
// unten zur Eingabe, ein weißer Pfeil wippt dort zur Linie. Die erhobene Hand pulsiert sanft.
const EX = g('sk_excl', 18, -3)
const arrow = (y: number): PropRef => g('sk_arrow', 19, y)
/** Erhobene Hand: senkrechter Blockarm (2 breit, 3 hoch) neben dem Kopf, ragt über ihn hinaus; HAND_LO = einen Pixel tiefer (Puls). */
const HAND = { out: 2, y: -2, h: 3 }
const HAND_LO = { out: 2, y: -1, h: 3 }
C('sk_hold_on', 'Hebt die Hand: Moment mal!', 'sk_stop', {
  loop: true, interruptible: true,
  frames: [
    { armL: 'up1', eyes: 'open', look: [0, 1], props: [], t: 1 },
    { armL: 'up2', t: 1 },
    { armL: HAND, eyes: 'wide', props: [EX], t: 4 },
    { eyes: 'open', t: 3 },
    { armL: HAND_LO, t: 2 }, { armL: HAND, t: 3 },
    // zeigt nach unten auf die Eingabe
    { ...armBlock('R', 2, 5), look: [1, 1], props: [EX], t: 1 },
    { ...armBlock('R', 3, 6), props: [EX, arrow(3)], t: 3 },
    { props: [EX, arrow(4)], t: 3 },
    { props: [EX, arrow(3)], t: 3 },
    { props: [EX, arrow(4)], t: 3 },
    { armR: 'down', look: [0, 1], props: [EX], t: 2 },
    // schaut dich an, die Hand pulsiert, das Ausrufezeichen blinkt einmal
    { armL: HAND_LO, props: [], t: 2 }, { armL: HAND, props: [EX], t: 3 },
    { eyes: 'half', t: 1 }, { eyes: 'open', t: 3 },
  ],
  outro: [{ armL: 'up2', armR: 'down', props: [], t: 1 }, { armL: 'up1', t: 1 }, { armL: 'down', eyes: 'open', look: [0, 0], t: 2 }],
})

// 2: Er holt ein Stoppschild aus der Tasche (klein an der Hand, es wächst), hält es seitlich hoch und wackelt freundlich damit; zwischendurch
// schaut er zur Eingabe und nickt. Beim Verlassen schrumpft es zurück in die Tasche.
const signAt = (dx: number, dy: number, t: number, extra: Frame = {}): Frame => ({
  ...armBlock('L', 3 + dx, dy), props: [g('sk_sign', -9 - dx, -4 + dy)], t, ...extra,
})
C('sk_stop_sign', 'Hält ein Stoppschild hoch', 'sk_stop', {
  loop: true, interruptible: true,
  intro: [
    ...dig('L', 4),
    { by: 0, eyes: 'wide', look: [-1, -1], ...armBlock('L', 2, 1), armR: 'down', props: [g('sk_sign@20', -2, -1)], t: 2 },
    { eyes: 'open', armL: 'raise', props: [g('sk_sign@50', -6, -4)], t: 2 },
    signAt(0, 0, 2, { look: [0, 1] }),
  ],
  frames: [
    signAt(0, 0, 4, { look: [0, 1], eyes: 'open' }),
    // wackelt: ein Stück raus, zurück, wieder raus
    signAt(1, 0, 2), signAt(0, 0, 2), signAt(1, 0, 2), signAt(0, 0, 3),
    // schaut zur Eingabe, nickt
    signAt(0, 0, 3, { look: [1, 1] }),
    signAt(0, 0, 2, { eyes: 'half' }), signAt(0, 0, 3, { eyes: 'open' }),
    // senkt es kurz und hebt es wieder an
    signAt(0, 1, 2, { look: [0, 1] }), signAt(0, 0, 3),
    signAt(1, 0, 2), signAt(0, 0, 2), signAt(1, 0, 2), signAt(0, 0, 4),
  ],
  outro: [
    signAt(0, 1, 2, { look: [-1, 0] }),
    { ...armBlock('L', 2, 2), props: [g('sk_sign@50', -6, -2)], t: 1 },
    { ...armBlock('L', 2, 3), props: [g('sk_sign@20', -2, 2)], t: 1 },
    ...stow(g('sk_sign@20', -1, 4)),
  ],
})

// =================================================================================================================================
// sk_handoff: sidekick baut einen neuen Chat mit Übergabe (10–45 s). Er schreibt einen Brief; beim Verlassen faltet er ihn, steckt ihn in einen
// Umschlag und schickt ihn nach unten hinter die Linie ab.
// =================================================================================================================================

const LTR = { name: 'sk_ltr0', size: [7, 9] as const, at: [-7, 1] as const, side: 'L' as const, grip: 3 }
const ltr = (n: number | string): PropRef => g('sk_ltr' + n, -7, 1)
/** Schreibzeile k liegt in Bühnenzeile 2 + 2k (g); die Hand liegt auf der Zeile, ihr Arm (Block) kommt seitlich vom Körper. */
const lineY = (k: number): number => 2 + 2 * k
const wr = (n: number, k: number, reach: 0 | 1, t: number, extra: Frame = {}): Frame => ({
  face: -1, look: [-1, 1], ...armBlock('L', 3, lineY(k) - 1), props: [ltr(n), g('sk_tip' + reach, reach ? -3 : -2, lineY(k) - 1)], t, ...extra,
})
/** Eine Zeile schreiben: Die Hand kritzelt (Stift tippt auf, Hand zurück), die Zeile wächst in zwei Schritten. */
const writeLine = (k: number): Frame[] => [
  wr(2 * k, k, 0, 2), wr(2 * k, k, 1, 2), wr(2 * k + 1, k, 0, 1), wr(2 * k + 1, k, 1, 2),
  wr(2 * k + 1, k, 0, 1), wr(2 * k + 1, k, 1, 2), wr(2 * k + 2, k, 0, 2),
]
C('sk_write_letter', 'Schreibt einen Übergabebrief', 'sk_handoff', {
  loop: true, interruptible: true,
  intro: [...fetchIn(LTR), { face: -1, look: [-1, 1], props: [ltr(0)], t: 2 }],
  frames: [
    ...writeLine(0), ...writeLine(1),
    // überlegt kurz: Hand runter, Blick nach oben, blinzeln
    { face: 0, armL: 'down', look: [0, -1], props: [ltr(4)], t: 4 }, { eyes: 'closed', t: 1 }, { eyes: 'open', t: 3 },
    ...writeLine(2), ...writeLine(3),
    // Seite voll: liest sie durch, nickt zufrieden
    { face: -1, armL: 'down', look: [-1, 0], props: [ltr(8)], t: 4 }, { by: 1, t: 2 }, { by: 0, t: 3 },
    // dreht das Blatt um: Hand an die Oberkante, das Blatt steht kurz hochkant, die Rückseite ist leer
    { ...armBlock('L', 3, 1), t: 2 },
    { props: [ltr('Flip')], t: 2 },
    { props: [ltr(0)], t: 2 },
    { armL: 'down', t: 2 },
  ],
  outro: [
    // schreibt schnell zu Ende
    wr(7, 3, 1, 1), wr(8, 3, 0, 1),
    // faltet: Hand an die Oberkante, klappt die obere Hälfte herunter, dann noch einmal
    { face: -1, look: [-1, 1], ...armBlock('L', 3, 1), props: [ltr(8)], t: 2 },
    { ...armBlock('L', 3, 3), t: 1 },
    { ...armBlock('L', 3, 5), props: [g('sk_ltr9', -7, 5)], t: 2 },
    { ...armBlock('L', 3, 7), props: [g('sk_ltrHi', -7, 7)], t: 2 },
    { armL: 'down', t: 1 },
    // holt einen Umschlag aus der Tasche und stülpt ihn über den gefalteten Brief
    ...fetchIn({ name: 'sk_env0', size: [7, 5], at: [-7, 5], side: 'L', grip: 1, rummage: 3, keep: [g('sk_ltrHi', -7, 7)] }),
    // versiegelt ihn (Hand drückt auf die Klappe) …
    { face: -1, look: [-1, 1], ...armBlock('L', 3, 5), props: [g('sk_env0', -7, 5)], t: 2 },
    { ...armBlock('L', 3, 6), props: [g('sk_env1', -7, 5)], t: 2 },
    { armL: 'down', t: 1 },
    // … und schickt ihn ab: der Umschlag gleitet durch die Linie wie durch einen Briefschlitz
    ...sinkOut({ name: 'sk_env1', size: [7, 5], at: [-7, 5], during: { look: [-1, 1] } }),
    { face: 0, look: [0, 0], eyes: 'happy', t: 3 }, { eyes: 'open', t: 2 },
  ],
})

// =================================================================================================================================
// sk_fresh: Der neue Chat ist da (einmalig, ~5 s). Der Umschlag kommt von unten durch die Linie zurück, er öffnet ihn, schaut hinein, freut sich,
// winkt dir zu und packt ihn ein.
// =================================================================================================================================

const envUp = (name: string, y: number, t: number, extra: Frame = {}): Frame => ({ ...armBlock('L', 3, y + 1), props: [g(name, -7, y)], t, ...extra })
C('sk_open_letter', 'Öffnet den Brief vom neuen Chat', 'sk_fresh', {
  frames: [
    { look: [-1, 1], eyes: 'wide', t: 2 },
    ...riseIn({ name: 'sk_env1', size: [7, 5], at: [-7, 5], during: { look: [-1, 1] } }),
    // greift zu und hebt ihn an
    envUp('sk_env1', 5, 2, { eyes: 'open' }), envUp('sk_env1', 4, 1), envUp('sk_env1', 3, 1), envUp('sk_env1', 2, 2),
    // bricht das Siegel, die Klappe geht auf, der Brief gleitet in zwei Schritten heraus, er schaut hinein
    { face: -1, look: [-1, 0], props: [g('sk_env0', -7, 2)], t: 2 },
    { props: [g('sk_env2', -7, -2)], t: 3 },
    { props: [g('sk_env3', -7, -2)], eyes: 'wide', t: 2 },
    { props: [g('sk_env4', -7, -2)], t: 4 },
    // freut sich: Bogenaugen, rote Wangen, Herz über dem Kopf, kleiner Wipper
    { eyes: 'happy', blush: true, props: [g('sk_env4', -7, -2), g('heart', 6, -4)], t: 3 },
    { by: 1, t: 2 },
    { by: 0, props: [g('sk_env4', -7, -2)], t: 2 },
    // winkt dir mit der freien Hand zu
    { face: 0, look: [0, 1], eyes: 'open', armR: 'wave1', t: 2 }, { armR: 'wave2', t: 2 }, { armR: 'wave1', t: 2 }, { armR: 'wave2', t: 2 },
    { armR: 'wave1', t: 2 }, { armR: 'wave2', t: 2 },
    { armR: 'down', t: 2 },
    // steckt den Brief zurück, klappt zu und packt den Umschlag in die Tasche
    { face: -1, look: [-1, 1], props: [g('sk_env3', -7, -2)], t: 1 },
    { props: [g('sk_env2', -7, -2)], t: 2 },
    envUp('sk_env0', 2, 2),
    { ...armBlock('L', 2, 1), props: [g('sk_env0@60', -5, 0)], t: 1 },
    { ...armBlock('L', 2, 3), props: [g('sk_env0@40', -2, 2)], t: 1 },
    ...stow(g('sk_env0@25', -1, 4)),
    { blush: false, t: 2 },
  ],
})

// =================================================================================================================================
// 0.13.0: Rückfragen nach Grund (sidekick.buddy.why, SPEC „Ausbau 0.13.0“ Teil B). Alle Schleifen, bis Fynn im Dialog antwortet.
// =================================================================================================================================

// ---- sk_stop_cold: Kalt-Cache-Frage. Er friert, ohne einzufrieren. ----

// 1 (ruhig): umarmt sich selbst, bibbert 1 px, die Zähne klappern (der schmale Mund geht auf und zu), ein Atemwölkchen steigt auf; ab und zu
// ein Blick hinunter zur Eingabe. Arme vor dem Körper an den Seiten (nicht verschränkt: sonst läge der Mund darunter).
const breath = (k: number): PropRef => (k ? g('sk_breath2', 17, 2) : g('sk_breath', 17, 3))
const chatter = (n: number, extra: Frame = {}): Frame[] =>
  Array.from({ length: n }, (_, i): Frame => ({ fx: i % 2, mouth: i % 2 ? 'whistle' : null, ...extra, t: 1 }))
C('sk_cold_shiver', 'Bibbert: Der Cache ist kalt', 'sk_stop_cold', {
  loop: true, interruptible: true,
  intro: [{ armL: 'hold', armR: 'hold', eyes: 'half', t: 2 }],
  frames: [
    ...chatter(6, { armL: 'hold', armR: 'hold', eyes: 'half', props: [] }),
    { fx: 0, mouth: null, props: [breath(0)], t: 3 }, { props: [breath(1)], t: 3 }, { props: [], t: 2 },
    ...chatter(6),
    // schaut zur Eingabe hinunter
    { fx: 0, mouth: null, look: [0, 1], eyes: 'open', t: 6 }, { look: [0, 0], eyes: 'half', t: 2 },
    ...chatter(4),
    { fx: 0, mouth: null, props: [breath(0)], t: 3 }, { props: [breath(1)], t: 3 }, { props: [], t: 4 },
  ],
  outro: [{ fx: 0, mouth: null, armL: 'down', armR: 'down', eyes: 'open', look: [0, 0], props: [], t: 2 }],
})

// 2: tritt von einem Fuß auf den anderen, haucht in die Hände (Hände vor dem Körper oben, Wölkchen), reibt sie, schaut zur Eingabe.
C('sk_cold_stomp', 'Tritt auf der Stelle und haucht in die Hände', 'sk_stop_cold', {
  loop: true, interruptible: true,
  frames: [
    { legs: 'stepA', armL: 'down', armR: 'down', eyes: 'half', t: 2 }, { legs: 'stepB', t: 2 }, { legs: 'stepA', t: 2 }, { legs: 'stepB', t: 2 },
    { legs: 'stand', armL: 'holdUp', armR: 'holdUp', eyes: 'closed', t: 2 },
    { props: [breath(0)], t: 3 }, { props: [breath(1)], t: 3 },
    { armL: 'hold', armR: 'holdUp', eyes: 'half', props: [], t: 2 }, { armL: 'holdUp', armR: 'hold', t: 2 },
    { armL: 'hold', armR: 'holdUp', t: 2 }, { armL: 'holdUp', armR: 'hold', t: 2 },
    { armL: 'down', armR: 'down', eyes: 'open', look: [0, 1], t: 6 }, { look: [0, 0], t: 2 },
  ],
  outro: [{ legs: 'stand', armL: 'down', armR: 'down', eyes: 'open', look: [0, 0], props: [], t: 2 }],
})

// ---- sk_stop_wrong: falscher Chat. Landkarte aus der Tasche, er dreht sie, Kopf schief, Fragezeichen. ----
const MAPL = { name: 'sk_map0', size: [9, 6] as const, at: [-10, 4] as const, side: 'L' as const, grip: 1, rummage: 3 }
const mapUp = (n: number, x: number, y: number, t: number, extra: Frame = {}): Frame => ({
  ...armBlock('L', 3, y + 2), props: [g('sk_map' + n, x, y)], t, ...extra,
})
const QM = g('question', 17, -3)
C('sk_map_lost', 'Dreht ratlos eine Landkarte', 'sk_stop_wrong', {
  loop: true, interruptible: true,
  intro: [...fetchIn(MAPL), mapUp(0, -10, 2, 2, { look: [-1, 0] }), mapUp(0, -10, 0, 2)],
  frames: [
    mapUp(0, -10, 0, 6, { face: -1, look: [-1, 0], eyes: 'open' }),
    // dreht sie hochkant …
    mapUp(1, -8, -2, 6, { face: -1 }),
    // … und auf den Kopf, legt den Kopf schief, Fragezeichen
    mapUp(2, -10, 0, 4, { face: 1, look: [-1, 0] }),
    { face: 1, props: [g('sk_map2', -10, 0), QM], t: 8 },
    { eyes: 'half', t: 1 }, { eyes: 'open', t: 3 },
    // schaut zu dir hinunter, ob du weißt, wo es hingeht
    { face: 0, look: [0, 1], props: [g('sk_map2', -10, 0), QM], t: 8 },
    // dreht sie zurück
    mapUp(1, -8, -2, 5, { look: [-1, 0] }),
    mapUp(0, -10, 0, 3),
  ],
  outro: [mapUp(0, -10, 2, 2, { face: 0, look: [-1, 1] }), mapUp(0, -10, 4, 2), { armL: 'down', t: 1 }, ...fetchOut(MAPL)],
})

// ---- sk_stop_model: Modell-Tipp. Eine kleine Waage steht neben ihm, die Schalen wippen; er wägt mit den Händen mit. ----
const sc = (n: number): PropRef => g('sk_scale' + n, -12, 3)
/** Waage angehoben (y über dem Boden), beim Hervorholen und Wegpacken. */
const sc0 = (y: number): PropRef => g('sk_scale0', -12, y)
C('sk_scale_weigh', 'Wägt mit einer kleinen Waage ab', 'sk_stop_model', {
  loop: true, interruptible: true,
  // eigene Kram-Folge statt fetchIn: die Waage ist zu filigran, verkleinert zerfiele sie in Einzelteile (nur @30 hängt zusammen)
  intro: [
    ...dig('L', 3),
    { by: 0, eyes: 'wide', look: [-1, -1], ...armBlock('L', 2, 1), armR: 'down', props: [g('sk_scale0@30', -3, -1)], t: 2 },
    { eyes: 'open', ...armBlock('L', 2, 3), props: [sc0(0)], t: 2 },
    { look: [-1, 1], ...armBlock('L', 2, 5), props: [sc0(2)], t: 1 },
    { ...armBlock('L', 2, 6), props: [sc(0)], t: 2 },
  ],
  frames: [
    { look: [-1, 1], face: -1, armL: 'up1', armR: 'down', props: [sc(0)], t: 6 },
    { armL: 'down', armR: 'up1', props: [sc(1)], t: 6 },
    { armL: 'up1', armR: 'down', props: [sc(0)], t: 6 },
    { armL: 'down', armR: 'up1', props: [sc(1)], t: 6 },
    // überlegt: schaut zu dir, blinzelt
    { face: 0, look: [0, 1], armL: 'down', armR: 'down', props: [sc(0)], t: 8 }, { eyes: 'half', t: 1 }, { eyes: 'open', t: 3 },
  ],
  outro: [
    { face: 0, look: [-1, 1], armL: 'down', armR: 'down', props: [sc(0)], t: 1 },
    { ...armBlock('L', 2, 6), t: 2 }, { ...armBlock('L', 2, 5), props: [sc0(2)], t: 1 }, { ...armBlock('L', 2, 3), props: [sc0(0)], t: 2 },
    { ...armBlock('L', 2, 2), props: [g('sk_scale0@30', -3, 1)], t: 1 },
    ...stow(g('sk_scale0@20', -1, 4)),
  ],
})

// ---- sk_stop_rewrite: Haikus Fassung. Zwei Zettel, links verkritzelt, rechts mit Haken; er schaut abwechselnd. ----
const NOTE_A = { name: 'sk_noteA', size: [5, 6] as const, at: [-6, 4] as const, side: 'L' as const, rummage: 2 }
const NOTE_B = { name: 'sk_noteB', size: [5, 6] as const, at: [18, 4] as const, side: 'R' as const, rummage: 2 }
const na = (y: number): PropRef => g('sk_noteA', -6, y)
const nb = (y: number): PropRef => g('sk_noteB', 18, y)
/** Beide Zettel hochgehalten (y −1), die Hände halten sie am unteren Rand. */
const both = (t: number, extra: Frame = {}): Frame => ({ ...armBlock('L', 2, 4), ...armBlock('R', 2, 4), props: [na(-1), nb(-1)], t, ...extra })
C('sk_two_notes', 'Hält zwei Fassungen hoch und vergleicht', 'sk_stop_rewrite', {
  loop: true, interruptible: true,
  intro: [
    ...fetchIn(NOTE_A), ...fetchIn({ ...NOTE_B, keep: [na(4)] }),
    // hebt beide an
    { ...armBlock('L', 2, 7), ...armBlock('R', 2, 7), props: [na(2), nb(2)], t: 2 },
    both(2),
  ],
  frames: [
    both(6, { face: -1, look: [-1, 0] }),
    both(6, { face: 1, look: [1, 0] }),
    both(4, { face: -1, look: [-1, 0] }),
    // länger beim rechten, nickt
    both(4, { face: 1, look: [1, 0] }), both(2, { by: 1 }), both(4, { by: 0 }),
    // schaut zu dir: welche?
    both(8, { face: 0, look: [0, 1] }),
  ],
  outro: [
    { face: 0, look: [0, 0], ...armBlock('L', 2, 7), ...armBlock('R', 2, 7), props: [na(2), nb(2)], t: 2 },
    { armL: 'down', armR: 'down', props: [na(4), nb(4)], t: 1 },
    ...fetchOut({ ...NOTE_B, keep: [na(4)] }), ...fetchOut(NOTE_A),
  ],
})

// ---- sk_stop_topic: neues Thema. Er blättert auf einem Block eine Seite um und tippt auf das leere Blatt. ----
const PAD = { name: 'sk_pad0', size: [7, 9] as const, at: [-7, 1] as const, side: 'L' as const, grip: 3, rummage: 3 }
const pad = (n: string | number): PropRef => g('sk_pad' + n, -7, 1)
C('sk_blank_page', 'Blättert um und zeigt auf ein leeres Blatt', 'sk_stop_topic', {
  loop: true, interruptible: true,
  intro: [...fetchIn(PAD), { face: -1, look: [-1, 1], props: [pad(0)], t: 3 }],
  frames: [
    // blättert: Hand an die Oberkante, die Seite steht hochkant, dahinter das leere Blatt
    { face: -1, look: [-1, 1], ...armBlock('L', 3, 1), props: [pad(0)], t: 3 },
    { props: [pad('Flip')], t: 2 },
    { props: [pad(1)], t: 2 },
    // tippt zweimal auf das leere Blatt und schaut dich an
    { ...armBlock('L', 3, 5), t: 2 }, { ...armBlock('L', 2, 5), t: 2 }, { ...armBlock('L', 3, 5), t: 2 }, { ...armBlock('L', 2, 5), t: 2 },
    { armL: 'down', face: 0, look: [0, 1], t: 8 }, { eyes: 'half', t: 1 }, { eyes: 'open', t: 4 },
    // blättert zurück (die beschriebene Seite kommt wieder)
    { face: -1, look: [-1, 1], ...armBlock('L', 3, 1), t: 2 },
    { props: [pad('Flip')], t: 2 },
    { props: [pad(0)], t: 2 },
    { armL: 'down', t: 4 },
  ],
  outro: [{ face: 0, look: [0, 0], armL: 'down', props: [pad(0)], t: 1 }, ...fetchOut(PAD)],
})

// =================================================================================================================================
// sk_hint: sidekick setzt eine Hinweiszeile (einmalig, ~3 s). Eine Glühbirne geht über dem Kopf an, er zeigt nach oben zur Zeile.
// =================================================================================================================================

const bulb = (n: number): PropRef => g('sk_bulb' + n, 5, -4)
C('sk_bulb', 'Glühbirne: ein Hinweis steht über der Eingabe', 'sk_hint', {
  frames: [
    { look: [0, -1], eyes: 'open', props: [bulb(0)], t: 3 },
    { props: [bulb(1)], eyes: 'wide', t: 2 }, { props: [bulb(0)], t: 1 }, { props: [bulb(1)], t: 3 },
    // zeigt nach oben (die Hinweiszeile steht über dem Band)
    { armR: 'up1', t: 1 }, { armR: 'raise', t: 10 },
    { armR: 'up1', eyes: 'open', look: [0, 1], t: 2 }, { armR: 'down', t: 6 },
    { props: [bulb(0)], look: [0, 0], t: 3 }, { props: [], t: 2 },
  ],
})

// =================================================================================================================================
// sk_upkeep: Wartungshinweis (einmalig, ~3–4 s). Er ölt kurz die Linie (zwei Tropfen) oder fegt sie mit einem kleinen Besen.
// =================================================================================================================================

// 1 (ruhig): Ölkännchen aus der Tasche, neigt es, zwei Tropfen fallen aus der Tülle auf die Linie und versickern, packt es weg.
const OIL = { name: 'sk_oil0', size: [6, 5] as const, at: [-6, 5] as const, side: 'L' as const, grip: 2, rummage: 3 }
const oil = (n: number, y: number): PropRef => g('sk_oil' + n, -6, y)
const drop = (y: number): PropRef => g('sk_drop', -6, y)
C('sk_oil_can', 'Ölt kurz die Eingabe', 'sk_upkeep', {
  frames: [
    ...fetchIn(OIL),
    // hebt es an und neigt es
    { face: -1, look: [-1, 1], ...armBlock('L', 3, 4), props: [oil(0, 2)], t: 2 },
    { props: [oil(1, 2)], t: 2 },
    { props: [oil(1, 2), drop(7)], t: 2 }, { props: [oil(1, 2), drop(8)], t: 1 }, { props: [oil(1, 2), drop(9)], t: 1 },
    { props: [oil(1, 2)], t: 2 },
    { props: [oil(1, 2), drop(7)], t: 2 }, { props: [oil(1, 2), drop(8)], t: 1 }, { props: [oil(1, 2), drop(9)], t: 1 },
    // richtet es auf, nickt zufrieden, packt es weg
    { props: [oil(0, 2)], t: 2 }, { ...armBlock('L', 3, 7), props: [oil(0, 5)], t: 2 }, { armL: 'down', face: 0, eyes: 'closed', t: 3 },
    { eyes: 'open', look: [0, 0], t: 1 },
    ...fetchOut(OIL),
  ],
})

// 2: kleiner Besen aus der Tasche, fegt zweimal hin und her über die Linie, Staub fällt hinter die Linie, packt ihn weg.
const BROOM = { name: 'sk_broom', size: [3, 8] as const, at: [-4, 2] as const, side: 'L' as const, grip: 2, rummage: 3 }
const broom = (x: number): PropRef => g('sk_broom', x, 2)
const sweep = (x: number, dust: readonly PropRef[], t: number): Frame => ({ ...armBlock('L', Math.min(6, -x), 4), props: [broom(x), ...dust], t })
C('sk_sweep', 'Fegt kurz die Eingabe', 'sk_upkeep', {
  frames: [
    ...fetchIn(BROOM),
    { face: -1, look: [-1, 1], t: 1 },
    sweep(-5, [], 2), sweep(-6, [g('sk_dust', -9, 8)], 2), sweep(-5, [g('sk_dust', -10, 9)], 2), sweep(-4, [], 2),
    sweep(-5, [], 2), sweep(-6, [g('sk_dust', -9, 8)], 2), sweep(-5, [g('sk_dust', -10, 9)], 2), sweep(-4, [], 2),
    { face: 0, look: [0, 0], armL: 'down', eyes: 'closed', props: [broom(-4)], t: 3 }, { eyes: 'open', t: 1 },
    ...fetchOut(BROOM),
  ],
})

export const CLIPS: readonly ClipDef[] = out
