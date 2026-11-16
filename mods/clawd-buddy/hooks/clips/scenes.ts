// clawd-buddy 0.16.0: neue Szenen nach Ideen aus clawd-companion (SPEC "Ausbau 0.16.0"). Übernommen ist nur die Idee je Szene;
// alle Bilder sind neu in unserem Raster gezeichnet (ANIMATION-GUIDE.md): nichts taucht auf, Gegenstände kommen aus der Tasche oder
// steigen hinter der Linie auf, raus nur nach unten, über dem Kopf nur 4 Pixelzeilen.
//
// Gruppen: work_think (Zahnräder), work_shell (Schmiede), waitPermission/waitPermissionLong (Glocke, Signalflaggen), done_long (Partyhut,
// Pokal), night (Hängematte, Lagerfeuer: Schlaf-Varianten, die Engine wählt sie statt `sleep`), hello (Begrüßung bei neuem Chat).
import { clip } from '../clipdef.js'
import type { ClipDef, Frame } from '../clipdef.js'
import type { PropRef, PropSprite } from '../stage.js'
import { armBlock, fetchIn, fetchOut, riseIn, sinkOut } from '../macros.js'
import type { FetchOpts } from '../macros.js'

const g = (name: string, x: number, y: number): PropRef => [name, x, y, 'g']
/** Zeilen spiegeln (links ↔ rechts), für Gegenstände, die es für beide Hände gibt. */
const flipX = (rows: readonly string[]): string[] => rows.map((r) => r.split('').reverse().join(''))

// ---- Zahnrad: Scheibe mit Nabe, Zähne als Ring-Stücke; `phase` dreht die Zähne (drei Stellungen ergeben eine Drehung)
function gearRows(d: number, teeth: number, phase: number, body: string, hub: string): string[] {
  const m = (d - 1) / 2
  const rb = d / 2 - 1.1
  const rt = d / 2 + 0.3
  const half = Math.PI / teeth / 2.1
  const rows: string[] = []
  for (let y = 0; y < d; y++) {
    let row = ''
    for (let x = 0; x < d; x++) {
      const dx = x - m
      const dy = y - m
      const r = Math.hypot(dx, dy)
      let ch = '.'
      if (r <= 0.8) ch = hub
      else if (r <= rb) ch = body
      else if (r <= rt) {
        const a = Math.atan2(dy, dx)
        for (let k = 0; k < teeth; k++) {
          let da = Math.abs(a - (phase + (k * 2 * Math.PI) / teeth)) % (2 * Math.PI)
          if (da > Math.PI) da = 2 * Math.PI - da
          if (da <= half) ch = body
        }
      }
      row += ch
    }
    rows.push(row)
  }
  return rows
}
/**
 * Zahnrad-Ständer 13×13: goldenes Rad (8) links, graues (6) rechts daneben, beide greifen ineinander und drehen gegenläufig.
 * Zwei dunkle Pfosten unter den Achsen auf einem gemeinsamen Fuß halten alles zusammen (eine zusammenhängende Form in jeder Stellung).
 */
function gearStand(k: number): string[] {
  const grid = Array.from({ length: 13 }, () => Array.from({ length: 13 }, () => '.'))
  for (let y = 4; y <= 12; y++) for (const x of [3, 4, 9, 10]) grid[y]![x] = 'D'
  for (let x = 1; x <= 11; x++) grid[11]![x] = 'D'
  for (let x = 0; x <= 12; x++) grid[12]![x] = 'D'
  const put = (rows: readonly string[], ox: number, oy: number): void =>
    rows.forEach((r, y) => r.split('').forEach((c, x) => { if (c !== '.') grid[oy + y]![ox + x] = c }))
  put(gearRows(8, 6, (k * Math.PI) / 9, 'Y', 'R'), 0, 0)
  put(gearRows(6, 4, Math.PI / 4 - (k * Math.PI) / 6, 'G', 'D'), 7, 1)
  return grid.map((r) => r.join(''))
}

// ---- Handglocke: Griff oben, goldener Mantel, Klöppel unten. Geschwungen kippt der Mantel um den Griff (untere Zeilen weiter aus).
const BELL = ['...R...', '...R...', '..YYY..', '..YWY..', '.YYYYY.', 'YYYYYYY', '...D...']
/** Mantel kippen: Zeile y um `sh[y]` Spalten versetzt, auf 11 Spalten Leinwand (Griff bleibt in Spalte 5). */
const tilt = (sh: readonly number[]): string[] => BELL.map((r, y) => ('..' + r + '..').split('').map((_, x, a) => a[x - sh[y]!] ?? '.').join(''))

// ---- Signalflagge (Einweiser): Tuch diagonal weiß/rot, Stab an der Körperseite (dort hält die Hand)
const FLAG_L = ['WMMMR', 'WWMMR', 'WWWMR', 'WWWWR', '....R', '....R']

// ---- Partyhut, Luftballon, Konfetti
const HAT = ['..W..', '.PYP.', '.YPY.', 'PYPYP']
const BALLOON = ['.MMM.', 'MMWMM', 'MMMMM', '.MMM.', '..M..', '..W..', '..W..', '..W..', '..W..']

// ---- Silberpokal mit zwei Henkeln (anders als der goldene Pokal der Erfolgsserie: silbern, breit, blauer Fuß)
const CUP = [
  '...GWGGGGG...',
  'GGGGWGGGGGGGG',
  'G..GWGGGGG..G',
  'GG..GGGGG..GG',
  '.....GGG.....',
  '....BBBBB....',
]

// ---- Schmiede: Amboss (Horn links), Hammer in drei Stellungen um die Hand (oben, halb, unten)
const ANVIL = ['WWWWWWWWWW', '..GGGGGGGG', '....GGGG..', '...GGGGGG.']
// Drehpunkt ist das Stielende rechts unten (Spalte 6), dort hält die Hand.
const HAM: readonly (readonly string[])[] = [
  // 0: hochgereckt, Stiel senkrecht, Kopf oben quer
  ['.....GGG', '.....GGG', '......R.', '......R.', '......R.', '........'],
  // 1: halb geschwungen, Stiel schräg
  ['.GG.....', '.GGR....', '....R...', '.....R..', '......R.', '........'],
  // 2: Schlag, Stiel waagerecht, Kopf zeigt nach unten aufs Werkstück
  ['........', '........', '........', '........', 'GGGRRRR.', 'GGG.....'],
]

// ---- Hängematte im Gestell (30×14, Zeile r = y_g r − 4): Querbalken ganz oben, zwei Pfosten bis zum Boden, das Tuch hängt an Seilen.
// Ein Stück: Balken, Pfosten, Seile und Tuch hängen in jeder Stellung zusammen, so steigt es als Ganzes hinter der Linie auf.
// 0 = leer gespannt (vor seinen Beinen, solange er steht), 1 = er liegt darin (das Tuch vor seinem Unterkörper, die geschlossenen Augen
// bleiben frei), 2/3 = schaukelt nach links bzw. rechts.
function hammockRows(state: number): string[] {
  const w = 30
  const g2 = Array.from({ length: 14 }, () => Array.from({ length: w }, () => '.'))
  const sh = state === 2 ? -1 : state === 3 ? 1 : 0
  const line = (x0: number, y0: number, x1: number, y1: number, c: string): void => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= n; i++) g2[Math.round(y0 + ((y1 - y0) * i) / n)]![Math.round(x0 + ((x1 - x0) * i) / n)] = c
  }
  for (let x = 0; x < w; x++) g2[0]![x] = 'R'
  for (let y = 0; y < 14; y++) {
    g2[y]![0] = 'R'
    g2[y]![w - 1] = 'R'
  }
  const stripe = (x: number): string => (x % 2 ? 'B' : 'L')
  if (state === 0) {
    // leer: flacher Bogen, Enden auf Zeile 9, Mitte zwei Zeilen tiefer
    line(3, 1, 4, 9, 'C')
    line(26, 1, 25, 9, 'C')
    for (let x = 4; x <= 25; x++) {
      const d = Math.min(x - 4, 25 - x)
      const y = 9 + Math.min(3, Math.floor(d / 2))
      g2[y]![x] = stripe(x)
      g2[y - 1]![x] = stripe(x)
    }
  } else {
    // er liegt darin: Mulde y_g 6–8 (Zeilen 10–12), darunter eine Zeile Luft über dem Boden
    line(3, 1, 4 + sh, 10, 'C')
    line(26, 1, 25 + sh, 10, 'C')
    for (let x = 4; x <= 25; x++) for (let y = 10; y <= 12; y++) if (!(y === 12 && (x < 6 || x > 23))) g2[y]![x + sh] = stripe(x)
  }
  return g2.map((r) => r.join(''))
}

// ---- Lagerfeuer und Zelt
const FIRE: readonly (readonly string[])[] = [
  ['..M..', '.MYM.', '.MYYM', 'R.R.R', '.RRR.'],
  ['.M...', '.MYM.', 'MYYM.', 'R.R.R', '.RRR.'],
  ['...M.', '.MYM.', '.MYYM', 'R.R.R', '.RRR.'],
]
const FIRE_OUT = ['.....', '.....', '.....', 'R.R.R', '.RRR.']
const TENT = [
  '.....E.....',
  '....EEE....',
  '...EEEEE...',
  '..EEEDEEE..',
  '.EEEDDDEEE.',
  'EEEDDDDDEEE',
  'EEEDDDDDEEE',
]
// Schlafsack: legt sich vor den liegenden Körper (unterste drei Körperzeilen), Kopfteil frei
const BAG = ['NNNNNNNNNNNNNNN', 'NBNNNNNNNNNNNNN', 'NNNNNNNNNNNNNNN']

// ---- Begrüßung: kleiner Strohhut mit rotem Band (schief auf der rechten Kopfseite; hell, damit er vor dem dunklen Grund zu sehen ist)
const TOPHAT = ['.CCCCC.', '.MMMMM.', 'CCCCCCC']
const TOPHAT_TILT = ['..CCCCC', '.MMMMM.', 'CCCCCCC']

/** Requisiten, die nur diese Gruppe braucht. Präfix `sc_`. */
export const PROPS: Readonly<Record<string, PropSprite>> = {
  sc_gears0: { rows: gearStand(0) },
  sc_gears1: { rows: gearStand(1) },
  sc_gears2: { rows: gearStand(2) },
  sc_bell0: { rows: tilt([0, 0, 0, 0, 0, 0, 0]) },
  // 1 = nach außen gekippt (weit), 2 = zum Körper gekippt (nur wenig, damit der Mantel nicht in die Figur schwingt); für die linke Hand umgekehrt
  sc_bell1: { rows: tilt([0, 0, 0, 1, 1, 2, 2]) },
  sc_bell2: { rows: tilt([0, 0, 0, 0, -1, -1, -1]) },
  sc_bell3: { rows: tilt([0, 0, 0, -1, -1, -2, -2]) },
  sc_bell4: { rows: tilt([0, 0, 0, 0, 1, 1, 1]) },
  // Schall-Striche an der Glocke: ")" seitlich und "/" schräg darüber; für die linke Glocke "(" und "\"
  sc_ring0: { rows: ['W.', '.W', '.W', 'W.'], effect: true },
  sc_ring1: { rows: ['..W', '.W.', 'W..'], effect: true },
  sc_ringL0: { rows: ['.W', 'W.', 'W.', '.W'], effect: true },
  sc_ringL1: { rows: ['W..', '.W.', '..W'], effect: true },
  sc_flagL: { rows: FLAG_L },
  sc_flagR: { rows: flipX(FLAG_L) },
  sc_hat: { rows: HAT },
  sc_balloon: { rows: BALLOON },
  // Konfetti (Effekt an der Figur): bunte Schnipsel, zwei Stellungen zum Rieseln
  sc_conf0: { rows: ['P.B', '.E.', 'Y.P'], effect: true },
  sc_conf1: { rows: ['.Y.', 'B.E', '.P.'], effect: true },
  sc_cup: { rows: CUP },
  // Amboss mit Werkstück obenauf (eine Requisite, damit das Stück mit dem Amboss hinter der Linie aufsteigt): 0 glühend, 1 aufglühend (Schlag), 2 abgekühlt
  sc_anvil0: { rows: ['..MYM.....', ...ANVIL] },
  sc_anvil1: { rows: ['..YYY.....', ...ANVIL] },
  sc_anvil2: { rows: ['..GGG.....', ...ANVIL] },
  sc_ham0: { rows: HAM[0]! },
  sc_ham1: { rows: HAM[1]! },
  sc_ham2: { rows: HAM[2]! },
  sc_spark0: { rows: ['Y...W', '..Y..'], effect: true },
  sc_spark1: { rows: ['.W.Y.', 'Y...W'], effect: true },
  sc_hammock0: { rows: hammockRows(0) },
  sc_hammock1: { rows: hammockRows(1) },
  sc_hammock2: { rows: hammockRows(2) },
  sc_hammock3: { rows: hammockRows(3) },
  sc_fire0: { rows: FIRE[0]! },
  // Weniger Bewegung: das Feuer steht still (Bild 0)
  sc_fire1: { rows: FIRE[1]!, still: 'sc_fire0' },
  sc_fire2: { rows: FIRE[2]!, still: 'sc_fire0' },
  sc_fire3: { rows: FIRE_OUT },
  sc_tent: { rows: TENT },
  sc_bag: { rows: BAG },
  sc_tophat0: { rows: TOPHAT },
  sc_tophat1: { rows: TOPHAT_TILT },
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

/** Eine Hand hält während einer Bildfolge etwas fest (überschreibt den Arm in jedem Bild, z. B. beim Kramen mit der anderen Hand). */
const holding = (frames: readonly Frame[], side: 'L' | 'R', hand: Frame): Frame[] =>
  frames.map((f) => ({ ...f, [side === 'L' ? 'armL' : 'armR']: hand[side === 'L' ? 'armL' : 'armR'] }))
/** Aus der Tasche in die Hand (fetchIn ohne das Abstellen am Schluss): der Gegenstand bleibt an `at` in der Hand. */
const pullIn = (o: FetchOpts): Frame[] => fetchIn(o).slice(0, -1)
/**
 * Wie pullIn für Gegenstände, deren Griff nicht an der Kante liegt (Glocke): ab dem Absenken hält `hand` ihn (fetchIn rechnet die
 * Armlänge sonst von der Gegenstandskante aus).
 */
const heldIn = (o: FetchOpts, hand: Frame): Frame[] => {
  const k = 1 + (o.rummage ?? 4) + 2
  const f = pullIn(o)
  return [...f.slice(0, k), ...holding(f.slice(k), o.side ?? 'L', hand)]
}
/** Gegenstück: die ersten zwei Bilder von fetchOut (greifen, halten) mit `hand`, dann zur Tasche. */
const heldOut = (o: FetchOpts, hand: Frame): Frame[] => {
  const f = fetchOut(o)
  return [...holding(f.slice(0, 2), o.side ?? 'L', hand), ...f.slice(2)]
}

// =====================================================================================================================
// work_think: Zahnräder. Ein kleiner Ständer mit zwei Zahnrädern steigt links hinter der Linie auf, bis die Räder neben seinem
// Kopf stehen. Er stupst das graue Rad an, beide drehen gegenläufig, er schaut hinauf und nickt im Takt der Zähne. Zum Schluss
// bleiben sie stehen, er nickt zufrieden, der Ständer sinkt zurück.
const GX = -15
const GY = -3
const gears = (k: number): PropRef => g(`sc_gears${((k % 3) + 3) % 3}`, GX, GY)
C('think_gears', 'Zahnräder drehen sich', 'work_think', {
  loop: true, interruptible: true,
  intro: [
    ...riseIn({ name: 'sc_gears0', size: [13, 13], at: [GX, GY], step: 2, during: { look: [-1, 0] } }),
    { look: [-1, -1], eyes: 'open', t: 3 },
    // anstupsen: die Blockhand tippt an das graue Rad, das sich in Bewegung setzt
    { ...armBlock('L', 3, 1), look: [-1, 0], eyes: 'winkR', props: [gears(0)], t: 2 },
    { ...armBlock('L', 4, 1), props: [gears(0)], t: 2 },
    { ...armBlock('L', 3, 1), props: [gears(1)], t: 2 },
    { armL: 'down', eyes: 'open', look: [-1, -1], props: [gears(2)], t: 3 },
  ],
  // Drehen: alle 3 Ticks eine Zahnstellung weiter, er nickt bei jeder zweiten (Körper 1 tiefer) und blinzelt einmal
  frames: Array.from({ length: 12 }, (_, i): Frame => ({ by: i % 2, look: [-1, -1], eyes: i === 7 ? 'half' : 'open', props: [gears(i)], t: 3 })),
  outro: [
    { by: 0, props: [gears(0)], t: 4 },
    { eyes: 'happy', look: [0, 0], t: 4 }, { eyes: 'open', t: 2 },
    ...sinkOut({ name: 'sc_gears0', size: [13, 13], at: [GX, GY], step: 2, during: { look: [-1, 1] } }),
    { look: [0, 0], t: 2 },
  ],
})

// =====================================================================================================================
// waitPermission: Glocke. Eine Handglocke aus der Tasche, er hebt sie seitlich neben den Kopf und schwingt sie; an der Glocke
// entstehen kurze Schall-Striche. Er schaut zu dir (eine Freigabe wartet).
// Der Griff (Spalte 5 der Leinwand) liegt unter der Handspitze eines 5 Pixel langen Blockarms; der Mantel hängt neben der Figur.
const BX = 14
const BY = -1
const BELL_O: FetchOpts = { name: 'sc_bell0', size: [11, 7], at: [BX, BY], side: 'R', grip: 0, rummage: 3 }
const bellHand = armBlock('R', 5, BY)
const bell = (k: number): PropRef => g(`sc_bell${k}`, BX, BY)
/** Ein Schwung: zum Körper kippen (Schall außen), Mitte, nach außen kippen (Schall darüber), Mitte. */
const swing = (t: number): Frame[] => [
  { ...bellHand, props: [bell(2), g('sc_ring0', 24, 1)], t },
  { ...bellHand, props: [bell(0)], t: 1 },
  { ...bellHand, props: [bell(1), g('sc_ring1', 21, -4)], t },
  { ...bellHand, props: [bell(0)], t: 1 },
]
C('ring_bell', 'Läutet die Glocke (Freigabe)', 'waitPermission', {
  loop: true, interruptible: true,
  intro: [...heldIn(BELL_O, bellHand), { ...bellHand, props: [bell(0)], t: 2 }],
  frames: [
    { ...bellHand, look: [0, 1], eyes: 'open', props: [bell(0)], t: 3 },
    ...swing(2), ...swing(2), ...swing(2),
    // kurz Pause: schaut zu dir, blinzelt
    { ...bellHand, props: [bell(0)], t: 5 }, { eyes: 'half', t: 1 }, { eyes: 'open', t: 4 },
  ],
  outro: heldOut({ ...BELL_O, lift: 0 }, bellHand),
})

// waitPermissionLong: zwei Glocken, in jeder Hand eine, heftig im Gleichtakt; Schall auf beiden Seiten.
const BXL = -9
const BELL_L: FetchOpts = { name: 'sc_bell0', size: [11, 7], at: [BXL, BY], side: 'L', grip: 0, rummage: 2 }
const bellHandL = armBlock('L', 5, BY)
const bellL = (k: number): PropRef => g(`sc_bell${k ? k + 2 : 0}`, BXL, BY)
const both = (kl: number, kr: number, fx: readonly PropRef[], t: number, extra: Frame = {}): Frame =>
  ({ ...bellHand, ...bellHandL, props: [bellL(kl), bell(kr), ...fx], t, ...extra })
C('ring_bell_long', 'Läutet zwei Glocken (Freigabe wartet lange)', 'waitPermissionLong', {
  loop: true, interruptible: true, weight: 2, // im Pool stehen auch Glocke, Flaggen, Blick und Zeigen (engine.ts ASK_SHARED)
  intro: [
    ...heldIn(BELL_O, bellHand), { ...bellHand, props: [bell(0)], t: 1 },
    ...holding(heldIn({ ...BELL_L, keep: [bell(0)] }, bellHandL), 'R', bellHand),
  ],
  frames: [
    both(0, 0, [], 2, { look: [0, 1], eyes: 'wide' }),
    ...Array.from({ length: 3 }, (): Frame[] => [
      // beide nach rechts: rechte Glocke nach außen, linke zum Körper
      both(2, 1, [g('sc_ring1', 21, -4), g('sc_ringL0', -9, 1)], 2, { by: 1 }),
      both(0, 0, [], 1, { by: 0 }),
      // beide nach links
      both(1, 2, [g('sc_ring0', 24, 1), g('sc_ringL1', -9, -4)], 2, { by: 1 }),
      both(0, 0, [], 1, { by: 0 }),
    ]).flat(),
    both(0, 0, [], 4, { eyes: 'open' }),
  ],
  outro: [...holding(heldOut({ ...BELL_L, keep: [bell(0)], lift: 0 }, bellHandL), 'R', bellHand), ...heldOut({ ...BELL_O, lift: 0 }, bellHand)],
})

// =====================================================================================================================
// waitPermission: Signalflaggen. Zwei kleine Flaggen aus der Tasche, eine je Hand; er winkt sie im Wechsel hoch und runter wie ein
// Einweiser und schaut zu dir.
const FLX = -5
const FRX = 17
const flagL = (y: number): PropRef => g('sc_flagL', FLX, y)
const flagR = (y: number): PropRef => g('sc_flagR', FRX, y)
const FLAG_LO: FetchOpts = { name: 'sc_flagL', size: [5, 6], at: [FLX, 2], side: 'L', grip: 4, rummage: 2 }
const FLAG_RO: FetchOpts = { name: 'sc_flagR', size: [5, 6], at: [FRX, 2], side: 'R', grip: 4, rummage: 2 }
/** Flagge oben (y −4), Mitte (−1), unten (2); die Hand hält das Stabende vier Zeilen unter der Oberkante. */
const flagPose = (yl: number, yr: number, t: number, extra: Frame = {}): Frame =>
  ({ ...armBlock('L', 3, yl + 4), ...armBlock('R', 3, yr + 4), props: [flagL(yl), flagR(yr)], t, ...extra })
C('wave_flags', 'Winkt mit Signalflaggen (Freigabe)', 'waitPermission', {
  loop: true, interruptible: true,
  intro: [...pullIn(FLAG_LO), ...holding(pullIn({ ...FLAG_RO, keep: [flagL(2)] }), 'L', armBlock('L', 3, 6))],
  frames: [
    flagPose(2, 2, 3, { look: [0, 1], eyes: 'open' }),
    flagPose(-1, 2, 1), flagPose(-4, 2, 3), flagPose(-1, -1, 1), flagPose(2, -4, 3), flagPose(-1, -1, 1),
    flagPose(-4, 2, 3), flagPose(-1, -1, 1), flagPose(2, -4, 3), flagPose(2, -1, 1),
    flagPose(2, 2, 4, { eyes: 'half' }), flagPose(2, 2, 3, { eyes: 'open' }),
  ],
  outro: [...holding(fetchOut({ ...FLAG_RO, keep: [flagL(2)], lift: 0 }), 'L', armBlock('L', 3, 6)), ...fetchOut({ ...FLAG_LO, lift: 0 })],
})

// =====================================================================================================================
// done_long: Partyhut. Er holt einen Partyhut aus der Tasche und setzt ihn sich auf, dann einen Luftballon an der Schnur für die
// andere Hand. Konfetti rieselt an ihm, er freut sich und wippt den Ballon. Danach Ballon und Hut wieder in die Tasche (nichts fliegt davon).
const HAT_SIDE = -5
const HAT_ON: PropRef = ['sc_hat', 6, -4] // auf dem Kopf (geht mit der Figur mit)
const HAT_O: FetchOpts = { name: 'sc_hat', size: [5, 4], at: [HAT_SIDE, -4], side: 'L', grip: 4, rummage: 3 }
const BAL_O: FetchOpts = { name: 'sc_balloon', size: [5, 9], at: [15, -3], side: 'R', grip: 7, rummage: 2 }
const bal = (y: number): PropRef => g('sc_balloon', 15, y)
const balHand = armBlock('R', 2, 4)
const hatSlide = (xs: readonly number[]): Frame[] =>
  xs.map((x): Frame => ({ ...(x < -1 ? armBlock('L', 3, 0) : { armL: 'down' }), look: [x < 2 ? -1 : 0, -1], props: [g('sc_hat', x, -4)], t: 1 }))
const conf = (i: number): readonly PropRef[] => (i % 2
  ? [g('sc_conf1', -4, 1 + (i % 4 > 1 ? 1 : 0)), g('sc_conf0', 20, 4)]
  : [g('sc_conf0', -4, 3), g('sc_conf1', 20, 2 + (i % 4 > 1 ? 1 : 0))])
C('party_hat', 'Party mit Hut und Luftballon (langer Turn)', 'done_long', {
  shapedEyes: true,
  intro: [
    ...pullIn(HAT_O),
    ...hatSlide([-3, -1, 1, 3, 5]),
    { armL: 'down', look: [0, 0], props: [HAT_ON], t: 2 },
    ...pullIn({ ...BAL_O, keep: [HAT_ON] }),
  ],
  frames: [
    ...Array.from({ length: 8 }, (_, i): Frame => ({
      ...balHand, eyes: 'happy', mouth: 'smile', armL: i % 2 ? 'up2' : 'up1', by: i % 4 === 3 ? 1 : 0,
      props: [...conf(i), HAT_ON, bal(i % 2 ? -4 : -3)], t: 3,
    })),
    { ...balHand, armL: 'down', by: 0, eyes: 'open', mouth: null, props: [HAT_ON, bal(-3)], t: 3 },
  ],
  outro: [
    ...fetchOut({ ...BAL_O, keep: [HAT_ON], lift: 0 }),
    // Hut abnehmen: die Hand holt ihn vom Kopf zur Seite, dann in die Tasche
    { ...armBlock('L', 3, 0), look: [-1, -1], props: [g('sc_hat', 5, -4)], t: 2 },
    ...hatSlide([3, 1, -1, -3, HAT_SIDE]),
    ...fetchOut({ ...HAT_O, lift: 0 }),
  ],
})

// done_long: Pokal stemmen. Ein breiter Silberpokal aus der Tasche; er hebt ihn über den Kopf, packt beide Henkel und stemmt ihn
// zweimal hoch, es funkelt. Dann wieder herunter und in die Tasche.
const CUP_SIDE = -14
const CUP_O: FetchOpts = { name: 'sc_cup', size: [13, 6], at: [CUP_SIDE, -4], side: 'L', grip: 4, rummage: 3 }
const cup = (x: number, y: number): PropRef => g('sc_cup', x, y)
/** Beide Arme gestreckt an den Henkeln (Blockarm 3 dick über der Schulter), `y` = Oberkante des Pokals. */
const lift = (y: number): Frame => ({ armL: { out: 2, y: y + 2, h: 3 }, armR: { out: 2, y: y + 2, h: 3 } })
const shine = (i: number): readonly PropRef[] => (i % 2 ? [g('sparkle', -3, -2), g('sparkle', 17, -1)] : [g('sparkle', -2, 0), g('sparkle', 18, -3)])
C('trophy_lift', 'Stemmt einen Pokal (langer Turn)', 'done_long', {
  shapedEyes: true,
  intro: [
    ...pullIn(CUP_O),
    // über den Kopf: der Pokal wandert nach rechts, bis die Henkel über den Schultern liegen
    ...[-11, -8, -5, -2].map((x): Frame => ({ ...armBlock('L', 3, 0), look: [-1, -1], props: [cup(x, -4)], t: 1 })),
    { ...lift(-4), look: [0, -1], props: [cup(2, -4)], t: 3 },
  ],
  frames: [
    ...Array.from({ length: 4 }, (_, i): Frame[] => [
      { ...lift(-3), by: 1, eyes: 'closed', props: [cup(2, -3)], t: 2 },
      { ...lift(-4), by: 0, eyes: 'happy', props: [cup(2, -4), ...shine(i)], t: 4 },
    ]).flat(),
    { ...lift(-4), eyes: 'open', props: [cup(2, -4)], t: 3 },
  ],
  outro: [
    ...[-2, -5, -8, -11].map((x): Frame => ({ ...armBlock('L', 3, 0), armR: 'down', look: [-1, -1], props: [cup(x, -4)], t: 1 })),
    ...fetchOut({ ...CUP_O, lift: 0 }),
  ],
})

// =====================================================================================================================
// work_shell: Schmiede. Ein kleiner Amboss mit glühendem Werkstück steigt links hinter der Linie auf, er holt einen Hammer aus der
// Tasche und schlägt zu: Funken an der Aufschlagstelle, das Stück glüht auf. Zum Schluss kühlt es ab (grau, Dampf), der Hammer geht
// zurück in die Tasche, der Amboss sinkt.
const AX = -12
const AY = 6
const HX = -10
const HY = -1
const anvil = (k: number, dy = 0): readonly PropRef[] => [g(`sc_anvil${k}`, AX, AY - 1 + dy)]
const ham = (k: number): PropRef => g(`sc_ham${k}`, HX, HY)
/** Hand am Hammerstiel: oben (0), halb (1), Schlag (2). */
const hamHand = (k: number): Frame => armBlock('L', 5, k === 2 ? 3 : 2)
const HAM_O: FetchOpts = { name: 'sc_ham0', size: [8, 6], at: [HX, HY], side: 'L', grip: 3, rummage: 2 }
const strike = (k: number, glow: number, fx: readonly PropRef[] = [], extra: Frame = {}): Frame =>
  ({ ...hamHand(k), props: [...fx, ...anvil(glow), ham(k)], t: k === 2 ? 3 : 2, ...extra })
C('forge_hammer', 'Schmiedet am Amboss', 'work_shell', {
  loop: true, interruptible: true,
  intro: [
    // Amboss und Werkstück steigen gemeinsam auf
    ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((d): Frame => ({ look: [-1, 1], props: [...anvil(0, d)], t: 1 })),
    ...holding(pullIn({ ...HAM_O, keep: [...anvil(0)] }), 'R', { armR: 'down' }),
  ],
  frames: [
    strike(0, 0, [], { look: [-1, 1], eyes: 'open', by: 0 }), strike(1, 0), strike(2, 1, [g('sc_spark0', -8, 1)], { by: 1 }),
    strike(1, 0, [g('sc_spark1', -8, 1)], { by: 0 }), strike(0, 0),
    strike(1, 0), strike(2, 1, [g('sc_spark1', -8, 1)], { by: 1 }), strike(1, 0, [g('sc_spark0', -8, 1)], { by: 0 }), strike(0, 0),
    strike(1, 0, [], { eyes: 'tight' }), strike(2, 1, [g('sc_spark0', -8, 1)], { by: 1 }), strike(1, 0, [g('sc_spark1', -8, 1)], { by: 0, eyes: 'open' }),
    strike(0, 0, [], { t: 5 }),
  ],
  outro: [
    // abkühlen: das Stück wird grau, ein Dampfwölkchen steigt auf
    { ...hamHand(0), props: [...anvil(2), ham(0), g('puff', -9, 3)], t: 3 },
    { props: [...anvil(2), ham(0), g('puff', -9, 2)], t: 3 },
    { eyes: 'happy', props: [...anvil(2), ham(0)], t: 3 },
    ...holding(fetchOut({ ...HAM_O, keep: [...anvil(2)], lift: 0 }), 'R', { armR: 'down' }),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d): Frame => ({ eyes: 'open', look: [-1, 1], props: d < 10 ? [...anvil(2, d)] : [], t: 1 })),
    { look: [0, 0], t: 2 },
  ],
})

// =====================================================================================================================
// night: Hängematte (Schlaf-Variante). Ein Gestell mit gespannter Hängematte steigt hinter der Linie auf, er hüpft hinein, legt
// sich hin und schaukelt sanft, zZz. Beim Aufwachen schreckt er kurz hoch, steigt heraus, alles sinkt wieder.
const PX = -7
const hm = (k: number, dy = 0): PropRef => g(`sc_hammock${k}`, PX, -4 + dy)
// Schlaf-Z über dem Kopf, unter dem Querbalken (der Kopf liegt in der Hängematte 2 Pixel höher als am Boden)
const ZH = (k: number): PropRef => (k ? g('zb', 15, -3) : g('zs', 13, -1))
/** Liegen in der Hängematte: Körper wie die Pose `lie`, 2 Pixel über dem Boden. */
const IN_HM: Frame = { fy: -2, by: 2, squash: 2, armL: 'out', armR: 'out', eyes: 'closed', legs: 'stand' }
C('hammock_sleep', 'Schläft in der Hängematte (zZz)', 'night', {
  loop: true, interruptible: true, when: 'night', weight: 0.5, // zusammen so oft wie die Schlafmütze (sleep)
  intro: [
    ...[14, 12, 10, 8, 6, 4, 2, 0].map((d): Frame => ({ look: [0, -1], eyes: 'half', props: [hm(0, d)], t: 2 })),
    { look: [1, 0], t: 2 }, { look: [-1, 0], t: 2 }, { look: [0, 0], t: 2 },
    // hineinhüpfen und hinlegen
    { by: 1, t: 2 }, { by: 0, fy: -1, legs: 'tuck', t: 1 }, { fy: -2, t: 1 },
    { fy: -2, by: 1, squash: 1, legs: 'stand', props: [hm(1)], t: 2 },
    { ...IN_HM, props: [hm(1)], t: 3 },
  ],
  frames: [
    { ...IN_HM, fx: 0, props: [hm(1), ZH(0)], t: 4 },
    { fx: -1, props: [hm(2), ZH(0)], t: 4 },
    { fx: 0, props: [hm(1), ZH(1)], t: 4 },
    { fx: 1, props: [hm(3), ZH(1)], t: 4 },
    { fx: 0, props: [hm(1)], t: 4 },
  ],
  outro: [
    // aufwachen: Augen auf, Ausrufezeichen, aufsetzen, heraushüpfen
    { ...IN_HM, fx: 0, eyes: 'wide', props: [hm(1), g('excl', 16, -2)], t: 4 },
    { fy: -2, by: 1, squash: 1, armL: 'down', armR: 'down', props: [hm(1)], t: 2 },
    { fy: -2, by: 0, squash: 0, legs: 'tuck', props: [hm(0)], t: 1 },
    { fy: -1, t: 1 }, { fy: 0, by: 1, legs: 'spread', t: 1 }, { by: 0, legs: 'stand', eyes: 'open', t: 2 },
    ...[2, 4, 6, 8, 10, 12, 14].map((d): Frame => ({ look: [0, 1], props: d < 14 ? [hm(0, d)] : [], t: 2 })),
    { look: [0, 0], t: 2 },
  ],
})

// night: Lagerfeuer (Schlaf-Variante). Links steigen ein kleines Zelt und ein Lagerfeuer auf, er liegt daneben und zieht den Schlafsack
// hoch; das Feuer flackert, zZz. Beim Aufwachen schreckt er hoch, das Feuer geht aus (Rauch), alles sinkt wieder.
const TX = -26
const FIX = -9
const tent = (dy = 0): PropRef => g('sc_tent', TX, 3 + dy)
const fire = (k: number, dy = 0): PropRef => g(`sc_fire${k}`, FIX, 5 + dy)
const bag = (dy = 0): PropRef => g('sc_bag', 1, 7 + dy)
// Schlaf-Z rechts neben dem Kopf (er liegt am Boden)
const ZC = (k: number, y: number): PropRef => g(k ? 'mood_z2' : 'mood_z1', 16 + k, y)
C('campfire_sleep', 'Schläft am Lagerfeuer (zZz)', 'night', {
  from: 'lie', loop: true, interruptible: true, when: 'night', weight: 0.5,
  intro: [
    ...[7, 5, 3, 1, 0].map((d): Frame => ({ eyes: 'half', props: [tent(d), fire(3, d)], t: 2 })),
    // er stochert nicht: das Feuer geht von allein an (Funken aus der Glut)
    { props: [tent(), fire(0)], t: 2 }, { props: [tent(), fire(1)], t: 2 },
    // Schlafsack von unten hochziehen
    ...[3, 2, 1, 0].map((d): Frame => ({ eyes: 'half', props: [tent(), fire(d % 3), bag(d)], t: 1 })),
    { eyes: 'closed', props: [tent(), fire(0), bag()], t: 3 },
  ],
  frames: [
    { props: [tent(), fire(0), bag(), ZC(0, 1)], t: 3 },
    { props: [tent(), fire(1), bag(), ZC(0, 0)], t: 3 },
    { props: [tent(), fire(2), bag(), ZC(1, -2)], t: 3 },
    { props: [tent(), fire(0), bag(), ZC(1, -3)], t: 3 },
    { props: [tent(), fire(1), bag()], t: 3 },
    { props: [tent(), fire(2), bag()], t: 3 },
  ],
  outro: [
    { eyes: 'wide', props: [tent(), fire(0), bag(), g('mood_excl', 18, 0)], t: 4 },
    { eyes: 'open', props: [tent(), fire(3), bag(), g('puff', -7, 6)], t: 3 },
    { props: [tent(), fire(3), bag(), g('puff', -6, 5)], t: 2 },
    ...[1, 2, 3, 4].map((d): Frame => ({ props: [tent(), fire(3), ...(d < 4 ? [bag(d)] : [])], t: 1 })),
    ...[1, 3, 5, 7].map((d): Frame => ({ look: [-1, 0], props: d < 7 ? [tent(d), fire(3, d)] : [], t: 2 })),
    { look: [0, 0], eyes: 'closed', t: 2 },
  ],
})

// =====================================================================================================================
// hello: Begrüßung bei einem neuen Chat. Er ist anfangs ganz hinter der Linie (leere Bühne), späht mit den Augen darüber, schaut
// sich um, steigt auf und winkt.
C('hello_peek', 'Späht hervor und winkt (neuer Chat)', 'hello', {
  frames: [
    { fy: 10, eyes: 'open', t: 6 },
    { fy: 9, t: 2 }, { fy: 8, t: 2 }, { fy: 7, t: 2 }, { fy: 6, look: [0, -1], t: 4 },
    { look: [-1, -1], t: 4 }, { look: [1, -1], t: 4 }, { eyes: 'half', t: 1 }, { eyes: 'open', look: [0, -1], t: 3 },
    { fy: 4, t: 1 }, { fy: 2, legs: 'tuck', t: 1 }, { fy: 0, legs: 'stand', look: [0, 0], t: 2 },
    { armR: 'wave1', eyes: 'happy', t: 3 }, { armR: 'wave2', t: 3 }, { armR: 'wave1', t: 3 }, { armR: 'wave2', t: 3 },
    { armR: 'down', eyes: 'open', t: 3 },
  ],
})
// hello: mit Strohhut. Zuerst kommt der Hut hinter der Linie hervor, dann er; er lüftet ihn grüßend, setzt ihn wieder auf und packt
// ihn dann in die Tasche.
const hatOn = (k = 0): PropRef => [`sc_tophat${k}`, 8, -3]
const TOPHAT_O: FetchOpts = { name: 'sc_tophat0', size: [7, 3], at: [17, -3], side: 'R', grip: 1, rummage: 2 }
C('hello_hat', 'Lüftet den Hut (neuer Chat)', 'hello', {
  intro: [
    // ganz hinter der Linie, auch der Hut (er sitzt 3 Zeilen über dem Kopf, darum tiefer als bei hello_peek)
    { fy: 13, eyes: 'open', t: 1 }, { props: [hatOn()], t: 5 },
    { fy: 12, t: 3 }, { fy: 11, t: 3 }, { fy: 10, t: 4 }, { fy: 9, t: 2 }, { fy: 8, t: 2 }, { fy: 7, t: 2 }, { fy: 6, t: 2 },
    { fy: 5, t: 1 }, { fy: 4, t: 1 }, { fy: 2, t: 1 },
    { fy: 0, look: [0, 0], t: 3 },
  ],
  frames: [
    // Hut lüften: die rechte Hand fasst die Krempe, hebt und kippt ihn, er zwinkert
    { ...armBlock('R', 2, -2), t: 2 },
    { ...armBlock('R', 2, -3), eyes: 'winkL', props: [[`sc_tophat1`, 8, -4]], t: 5 },
    { ...armBlock('R', 2, -2), eyes: 'open', props: [hatOn()], t: 2 },
    { armR: 'down', eyes: 'happy', t: 5 },
    { eyes: 'open', t: 2 },
  ],
  outro: [
    // abnehmen und einpacken: die Hand zieht ihn zur rechten Seite, dort geht er in die Tasche
    { ...armBlock('R', 2, -2), look: [1, -1], props: [hatOn()], t: 2 },
    { ...armBlock('R', 3, -2), props: [g('sc_tophat0', 11, -3)], t: 1 },
    { ...armBlock('R', 3, -2), props: [g('sc_tophat0', 14, -3)], t: 1 },
    { ...armBlock('R', 3, -2), props: [g('sc_tophat0', 17, -3)], t: 2 },
    ...fetchOut({ ...TOPHAT_O, lift: 0 }),
  ],
})

export const CLIPS: readonly ClipDef[] = out
