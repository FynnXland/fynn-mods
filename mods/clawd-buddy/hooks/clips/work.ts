// clawd-buddy: Clips der Gruppe "work" (Claude arbeitet: schreiben, lesen, Shell, Web, denken).
//
// Regeln (Fynn, Runde 4): Gegenstände kommen aus der Tasche (macros.fetchIn, Hand wühlt unten seitlich, schnelle Reaktion, Gegenstand klein
// an der Hand, wächst, wird abgestellt) und gehen dorthin zurück (macros.fetchOut). Große Geräte (Terminal, Schalttafel, Mast) steigen von
// unten auf. Hände sind Blöcke (Arme kurz, out <= 4). Nichts taucht aus dem Nichts auf, nichts wird am Rand abgeschnitten, Augen bleiben frei.
// Lesen: einige Clips links, einige rechts, die Zeitung VOR ihm.
//
// Laptop (Referenz-GIF, Bild für Bild, maßstäblich auf unser Raster): Hocke, Hand in der Tasche, Auge zu, Hand schnellt mit dem Laptop hoch,
// er klappt auf, steht im Profil rechts neben ihm, kurzes Strecken, er dreht sich zu 3/4 zum Laptop (Schattenstreifen Q an der Körperseite,
// Augen rücken zum Laptop) und tippt mit zwei Händen abwechselnd (nahe Hand orange als Blockarm, ferne Hand dunkler als Requisite).
// Am Ende klappt er zu, dreht sich zurück, nimmt ihn hoch, er wird kleiner und verschwindet in der Tasche.
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { armBlock, fetchIn, fetchOut, riseIn, sinkOut } from '../macros.ts'
import type { FetchOpts } from '../macros.ts'

// ---------------------------------------------------------------------------------------------------------------------
// Kleine Zeichenhilfen für Sprites (Pixelraster als Zeichenmatrix)
type Grid = string[][]
const grid = (w: number, h: number): Grid => Array.from({ length: h }, () => Array<string>(w).fill('.'))
const put = (g: Grid, x: number, y: number, c: string): void => {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c
}
const rect = (g: Grid, x: number, y: number, w: number, h: number, c: string): void => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c)
}
const rowsOf = (g: Grid): string[] => g.map((r) => r.join(''))
const mirror = (rows: readonly string[]): string[] => rows.map((r) => [...r].reverse().join(''))
const spr = (rows: readonly string[]): PropSprite => ({ rows })
const fxSpr = (rows: readonly string[]): PropSprite => ({ rows, effect: true })

type Side = 'L' | 'R'
/** Blockarm, dessen Handspitze in Spalte `tip` (g-Koordinate) endet; y = Oberkante des 2 Pixel dicken Arms. */
const handTo = (side: Side, tip: number, y: number): Frame => armBlock(side, Math.max(2, Math.min(4, side === 'L' ? 2 - tip : tip - 14)), y)
const ref = (name: string, x: number, y: number): PropRef => [name, x, y, 'g']
const gp = ref

// ---------------------------------------------------------------------------------------------------------------------
// Requisiten
/** Textzeile aus Wörtern (Segmente mit 1 Pixel Lücke), höchstens `max` Pixel lang. */
const WORDS = [[2, 3, 1, 2], [3, 1, 3, 2], [1, 2, 3, 3]]
function textLine(g: Grid, x: number, y: number, max: number, v: number, c: string): void {
  let cx = x
  for (const seg of WORDS[v % WORDS.length]) {
    if (cx + seg > x + max) break
    rect(g, cx, y, seg, 1, c)
    cx += seg + 1
  }
}

/** Schriftrolle der Breite w (w >= 4): zwei Walzen (Kappen stehen über und unter dem Blatt vor), dazwischen Blatt mit drei Textzeilen aus Wörtern; `ph` wechselt die Wortlage (Lesen). */
function scroll(w: number, ph: number): PropSprite {
  const g = grid(w, 9)
  if (w <= 4) {
    // aufgerollt: eine dicke Walze
    rect(g, 0, 1, 4, 7, 'C')
    rect(g, 1, 1, 1, 7, 'W')
    rect(g, 3, 1, 1, 7, 'R')
    rect(g, 0, 0, 4, 1, 'R')
    rect(g, 0, 8, 4, 1, 'R')
    return spr(rowsOf(g))
  }
  rect(g, 2, 1, w - 4, 7, 'C')
  for (const x of [0, w - 2]) {
    rect(g, x, 1, 2, 7, 'C')
    rect(g, x + (x ? 1 : 0), 1, 1, 7, x ? 'R' : 'W')
    rect(g, x, 0, 2, 1, 'R')
    rect(g, x, 8, 2, 1, 'R')
  }
  for (let i = 0; i < 3; i++) textLine(g, 3, 2 + 2 * i, w - 6, ph + i, 'R')
  return spr(rowsOf(g))
}

/**
 * Lupe (8x8, Griff unten rechts; die Prop-Tabelle spiegelt sie für die rechte Seite): Ring hellblau, durchsichtiges Glas, darin der Käfer vergrößert (4x4, `v` lässt die
 * Beinchen wechseln), Glanzpunkt links oben, kurzer Griff in Creme.
 */
function lens(v: number): PropSprite {
  const g = grid(8, 8)
  for (let i = 1; i <= 4; i++) {
    put(g, i, 0, 'B')
    put(g, i, 5, 'B')
    put(g, 0, i, 'B')
    put(g, 5, i, 'B')
  }
  const bug = ['.MM.', 'MKMM', 'MMKM', v ? '.K.K' : 'K.K.']
  bug.forEach((r, j) => [...r].forEach((c, i) => c !== '.' && put(g, 1 + i, 1 + j, c)))
  for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6], [7, 6], [6, 7], [7, 7]] as const) put(g, x, y, 'C')
  return spr(rowsOf(g))
}
/** Marienkäfer am Boden (7x4, blickt nach links): schwarzer Kopf, roter Rücken mit schwarzen Punkten, drei Beinpaare, die Beinchen wechseln mit `v`. */
const bug = (v: number): PropSprite => spr(['..MMMM.', 'KKMKMMM', 'KMMMMKM', v ? 'K.K.K.K' : '.K.K.K.'])

/**
 * Terminal (14x10): Fenster mit grauem Rahmen (ohne Ständer, es ist ein Fenster und kein Monitor), Titelleiste mit drei Punkten (rot, gelb, grün),
 * schwarze Fläche. Zwölf Zustände (eine Familie, siehe famName): 0 leere Eingabe, 1 und 2 der Befehl wird geschrieben (gelbes ">", grüner Text, weißer Cursor),
 * 3 die Ausgabe kommt, 4 und 5 ein Fortschrittsbalken füllt sich (3 und 6 von 6). 6 bis 11 = die Zeilen laufen weiter nach oben (drei Zeilen, eine halbe Zeile
 * pro Zustand, nach 6 Zuständen wiederholt sich das Bild nahtlos), unten die Eingabezeile mit blinkendem Cursor (an in 6 bis 8, aus in 9 bis 11).
 */
const famName = (prefix: string, k: number): string => (k < 10 ? `${prefix}${k}` : k === 10 ? `${prefix}Flip` : `${prefix}Hi`)
const termName = (k: number): string => famName('work_term', k)
const TLINES = [5, 3, 6]
function terminal(n: number): PropSprite {
  const g = grid(14, 10)
  rect(g, 0, 0, 14, 10, 'G')
  rect(g, 1, 2, 12, 7, 'K')
  rect(g, 1, 1, 12, 1, 'D')
  put(g, 2, 1, 'M')
  put(g, 4, 1, 'Y')
  put(g, 6, 1, 'E')
  if (n <= 5) {
    // Eingabezeichen ">" (Winkel über drei Zeilen)
    put(g, 2, 2, 'Y')
    put(g, 3, 3, 'Y')
    put(g, 2, 4, 'Y')
    const len = n === 0 ? 0 : n === 1 ? 2 : 4
    rect(g, 5, 3, len, 1, 'E')
    if (n <= 2) rect(g, 5 + len + (len ? 1 : 0), 2, 2, 3, 'W')
    if (n >= 3) rect(g, 2, 5, 5, 1, 'E')
    // Fortschrittsbalken: dunkle Bahn, hellblaue Füllung
    if (n >= 4) {
      rect(g, 2, 7, 6, 2, 'D')
      rect(g, 2, 7, n === 4 ? 3 : 6, 2, 'L')
    }
  } else {
    const k = n - 6
    const o = k % 2
    const step = Math.floor(k / 2)
    for (let i = 0; i < 3; i++) rect(g, 2, 2 + o + 2 * i, TLINES[(step + i) % 3], 1, 'E')
    put(g, 2, 8, 'Y')
    if (k < 3) rect(g, 4, 8, 2, 1, 'W')
  }
  return spr(rowsOf(g))
}

/**
 * Breites Log-Fenster (18x7) mit Titelpunkten, zwei laufenden Log-Zeilen (gelber Zeitstempel, graue und weiße Schrift) und unten einem grünen Fortschrittsbalken.
 * Zustand n = 2 * Füllstufe + Zeilenversatz: Füllstufe 0 bis 5 (Balken 0, 3, 6, 9, 12, 14 von 14), Versatz 0/1 schiebt die Zeilen um eine Zeile weiter.
 */
const logName = (n: number): string => famName('work_log', n)
const LOGL = [6, 9, 4, 8, 5, 10]
function logWin(n: number): PropSprite {
  const f = n >> 1
  const s = n & 1
  const g = grid(18, 7)
  rect(g, 0, 0, 18, 7, 'G')
  rect(g, 1, 1, 16, 5, 'K')
  rect(g, 1, 0, 16, 1, 'D')
  put(g, 2, 0, 'M')
  put(g, 4, 0, 'Y')
  put(g, 6, 0, 'E')
  for (let i = 0; i < 2; i++) {
    const row = 1 + s + 2 * i
    rect(g, 2, row, 2, 1, 'Y')
    rect(g, 5, row, LOGL[(f + i) % LOGL.length], 1, i ? 'W' : 'G')
  }
  rect(g, 2, 5, 14, 1, 'D')
  rect(g, 2, 5, [0, 3, 6, 9, 12, 14][f], 1, 'E')
  return spr(rowsOf(g))
}

/**
 * Kleines Tablet-Fenster (12x9, Ecken abgerundet) mit Spinner und Ausgabe: oben links ein Ladekreis (vier Punkte, einer leuchtet und wandert im Uhrzeigersinn),
 * daneben ein Platzhalterbalken. Zustand n = 4 * fertige Zeilen (0 bis 2) + Spinnerphase (0 bis 3): fertige Zeilen erscheinen unten als grüne Zeile mit gelber Marke.
 */
const spinName = (n: number): string => famName('work_spn', n)
function spinWin(n: number): PropSprite {
  const l = n >> 2
  const p = n & 3
  const g = grid(12, 9)
  rect(g, 0, 0, 12, 9, 'G')
  for (const [x, y] of [[0, 0], [11, 0], [0, 8], [11, 8]] as const) put(g, x, y, '.')
  rect(g, 1, 1, 10, 7, 'K')
  const ring = [[3, 1], [4, 2], [3, 3], [2, 2]] as const
  ring.forEach(([x, y], i) => put(g, x, y, i === p ? 'W' : 'D'))
  rect(g, 6, 2, 4, 1, 'G')
  if (l >= 1) {
    put(g, 2, 5, 'Y')
    rect(g, 4, 5, 5, 1, 'E')
  }
  if (l >= 2) {
    put(g, 2, 7, 'Y')
    rect(g, 4, 7, 3, 1, 'E')
  }
  return spr(rowsOf(g))
}

/**
 * Laptop im Profil (7x6), Tastatur zur Figur, Deckel hinten. Zustände: 0 zugeklappt (5x3, liegt auf dem Boden), 6 Deckel einen Spalt offen,
 * 1 Deckel 45 Grad zur Figur hin, 2 senkrecht, 3 offen nach hinten geneigt (Schirm hellblau), 4 und 5 offen mit leuchtender Taste (Anschlag).
 * Ein Sprite je Zustand, alle bündig links; offen steht er bei y_g = 4 (Boden = Zeile 9), zugeklappt bei y_g = 7.
 */
function lapP(n: number): PropSprite {
  if (n === 0) return spr(['GGGGG', 'DDDDD', 'GGGGG'])
  const g = grid(7, 6)
  rect(g, 0, 5, 5, 1, 'G')
  for (let i = 0; i < 4; i++) put(g, i, 4, i % 2 ? 'D' : 'W')
  put(g, 4, 4, 'G')
  if (n === 6) {
    rect(g, 0, 2, 2, 1, 'G')
    rect(g, 2, 3, 3, 1, 'G')
    rect(g, 0, 4, 4, 1, 'D')
  } else if (n === 1) {
    for (let i = 0; i < 4; i++) put(g, i, i, 'G')
  } else if (n === 2) {
    for (let y = 0; y < 4; y++) {
      put(g, 4, y, 'G')
      put(g, 3, y, 'L')
    }
  } else {
    for (const [x, y] of [[6, 0], [6, 1], [5, 2], [5, 3]] as const) put(g, x, y, 'G')
    for (const [x, y] of [[5, 0], [5, 1], [4, 2], [4, 3]] as const) put(g, x, y, 'L')
    if (n === 4) {
      put(g, 0, 4, 'Y')
      put(g, 4, 3, 'W')
    }
    if (n === 5) {
      put(g, 2, 4, 'Y')
      put(g, 5, 1, 'W')
    }
  }
  return spr(rowsOf(g))
}

/** Schattenseite der 3/4-Drehung (Effekt, relativ zur Figur bei x = 2): Streifen der Breite 1 bis 3 in Q; 4 = Breite 3 mit Lücke an der Augenzeile (für geschlossene und Bogenaugen). */
function turnQ(n: number): PropSprite {
  const w = n === 4 ? 3 : n
  const rows = Array.from({ length: 8 }, () => 'Q'.repeat(w))
  if (n === 4) rows[3] = 'QQ.'
  return fxSpr(rows)
}

/**
 * Schalttafel mit einem großen Knopf und einer Signallampe (10x8, steht links von der Figur, der Knopf liegt auf ihrer Seite). Zustand n = gedrückt (1)
 * + 2 * Lampe an: der Knopf ist rot, gedrückt flach; die Lampe auf dem Turm links leuchtet gelb.
 */
function pult(n: number): PropSprite {
  const pressed = n % 2 === 1
  const lamp = n >= 2
  const g = grid(10, 8)
  // Lampenturm links
  rect(g, 0, 2, 2, 6, 'G')
  rect(g, 0, 0, 2, 2, lamp ? 'Y' : 'T')
  if (lamp) put(g, 0, 0, 'W')
  rect(g, 0, 2, 2, 1, 'D')
  // Gehäuse
  rect(g, 2, 5, 8, 3, 'G')
  rect(g, 3, 6, 6, 1, 'D')
  // Knopf
  if (pressed) {
    rect(g, 3, 4, 6, 1, 'M')
  } else {
    rect(g, 4, 3, 4, 1, 'M')
    rect(g, 3, 4, 6, 1, 'M')
    put(g, 4, 3, 'P')
  }
  return spr(rowsOf(g))
}

/**
 * Sendemast (15x14): hoher Gitterturm (A-Form mit Querstreben), Lampe an der Spitze (Zeile 2, Mitte Spalte 7). `tilt`: die Spitze steht schief. `arcs`: Farbe je Funkbogen
 * 1 bis 3 (innen nach außen; '' = nicht da): Bögen ")))" und "(((" links und rechts der Lampe, jeder ist neu hell (W), wird mit dem Alter hellblau (L), blau (B)
 * und zuletzt fast unsichtbar (T). Die Bögen hängen über eine dunkle Achse in der Lampenzeile am Mast, damit sie zum Mast gehören (kein loses Teil).
 */
function mast(tilt: number, arcs: readonly string[]): PropSprite {
  const g = grid(15, 14)
  const c = 7
  const o = 2
  put(g, c + tilt, o, 'Y')
  put(g, c + tilt, o + 1, 'W')
  rect(g, c - 2 + tilt, o + 2, 5, 1, 'G')
  put(g, c - 2 + tilt, o + 1, 'G')
  put(g, c + 2 + tilt, o + 1, 'G')
  for (let y = 3; y <= 4; y++) put(g, c + tilt, o + y, 'G')
  for (let r = 5; r < 12; r++) {
    const half = Math.floor((r - 2) / 3)
    put(g, c - half, o + r, 'G')
    put(g, c + half, o + r, 'G')
    if (r % 3 === 1) for (let x = c - half; x <= c + half; x++) put(g, x, o + r, 'G')
  }
  const far = arcs.reduce((m, col, i) => (col ? i + 1 : m), 0)
  if (far) {
    for (let x = 1; x <= 2 * far + 1; x++) {
      put(g, c + x, 2, 'T')
      put(g, c - x, 2, 'T')
    }
    arcs.forEach((col, i) => {
      if (!col) return
      const k = i + 1
      const x0 = 2 * k // Enden des Bogens im Abstand x0 von der Lampe, Mitte einen weiter außen
      const h = k === 1 ? 1 : 2
      for (const s of [1, -1]) {
        put(g, c + s * x0, 2 - h, col)
        put(g, c + s * x0, 2 + h, col)
        for (let y = 2 - h + 1; y <= 2 + h - 1; y++) put(g, c + s * (x0 + 1), y, col)
      }
    })
  }
  return spr(rowsOf(g))
}
/** Globus (7x9): blaue Kugel mit grünen Kontinenten, die beim Drehen wandern (k = Drehstellung 0 bis 6), Ständer unten. */
const MAP = [
  '..EE....EEE...',
  '.EEEE..EEEEE..',
  '.EEE..EEEE.EE.',
  '..EE...EEE.EEE',
  '..E....EE..EE.',
  '...E...E....E.',
  '......E.......',
]
const SPAN = [[2, 4], [1, 5], [0, 6], [0, 6], [0, 6], [1, 5], [2, 4]]
function globe(k: number): PropSprite {
  const g = grid(7, 9)
  for (let r = 0; r < 7; r++) {
    for (let c = SPAN[r][0]; c <= SPAN[r][1]; c++) put(g, c, r, MAP[r][(c + 2 * k) % 14] === 'E' ? 'E' : 'B')
  }
  put(g, 1, 2, 'L')
  put(g, 2, 1, 'L')
  rect(g, 3, 7, 1, 1, 'Y')
  rect(g, 1, 8, 5, 1, 'Y')
  return spr(rowsOf(g))
}
/** WLAN-Zeichen (Effekt, 7x5): Punkt, mittlerer und äußerer Bogen; `level` 1 bis 3 wächst nach oben. */
function wifi(level: number): PropSprite {
  const g = grid(7, 5)
  put(g, 3, 4, 'W')
  if (level >= 2) {
    rect(g, 2, 2, 3, 1, 'W')
    put(g, 1, 3, 'W')
    put(g, 5, 3, 'W')
  }
  if (level >= 3) {
    rect(g, 1, 0, 5, 1, 'L')
    put(g, 0, 1, 'L')
    put(g, 6, 1, 'L')
  }
  return fxSpr(rowsOf(g))
}

/** WLAN-Router (9x7), symmetrisch um die Mittelspalte 4: zwei Antennen (Spalten 2 und 6), drei Lämpchen (2, 4, 6), `ph` lässt sie im Wechsel blinken. */
function router(ph: number): PropSprite {
  const g = grid(9, 7)
  for (let y = 0; y < 3; y++) {
    put(g, 2, y, 'G')
    put(g, 6, y, 'G')
  }
  rect(g, 0, 3, 9, 1, 'G')
  rect(g, 0, 4, 9, 2, 'D')
  put(g, 2, 4, ph ? 'E' : 'Y')
  put(g, 4, 4, 'W')
  put(g, 6, 4, ph ? 'E' : 'Y')
  rect(g, 2, 5, 5, 1, 'T')
  rect(g, 0, 6, 9, 1, 'T')
  return spr(rowsOf(g))
}

/**
 * Denkblase mit Gedankenspur (Effekt) für "Denkt (…)": fester Raum 18x10 (g-Ursprung (-19, -4)). Zustände: 0 kleiner Kreis am Kopf, 1 dazu der mittlere Kreis,
 * 2 bis 5 die Blase mit Rand wächst (5x3, 9x5, 11x7, 13x9), 6 bis 8 in der großen Blase erscheinen nacheinander die drei Punkte "…". Alles hängt zusammen
 * (Spur berührt die Blase), also ein Teil und nie loses Zeug.
 */
function thinkC(n: number): PropSprite {
  const g = grid(18, 10)
  if (n >= 2) {
    const [w, h] = [[5, 3], [9, 5], [11, 7], [13, 9]][Math.min(n, 5) - 2]
    const x0 = 13 - w
    const y0 = 9 - h
    const cut = w >= 11 && h >= 7 ? [3, 1] : [1]
    const inside = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false
      const d = Math.min(y, h - 1 - y)
      return d >= cut.length || (x >= cut[d] && x < w - cut[d])
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
        put(g, x0 + x, y0 + y, edge ? 'W' : 'D')
      }
    }
    for (let i = 0; i < n - 5; i++) rect(g, 3 + 3 * i, 4, 2, 2, 'W')
  }
  rect(g, 16, 8, 2, 2, 'W')
  if (n >= 1) for (const [x, y] of [[13, 7], [14, 7], [13, 8], [14, 8], [15, 8], [14, 9]] as const) put(g, x, y, 'W')
  return fxSpr(rowsOf(g))
}
/**
 * Denkblase mit Gedankenspur (Effekt) für "Grübelt": Alle Zustände liegen in einem festen Feld 18x10 (g-Ursprung (-19, -4)) und bilden eine Familie.
 * Die Spur aus zwei Punkten hängt an der Figur (kleiner Punkt am Kopf, größerer dahinter), die Blase wächst von unten rechts, wo die Spur sie berührt,
 * nach links oben. Die Blase ist dunkelgrau mit weißem Rand, damit Gelb und Weiß gut lesen. Zustände: 0 nur der kleine Punkt, 1 beide Punkte, 2 bis 4
 * kleine, mittlere, große Blase (5x3, 9x5, 11x7), 5 volle Blase 13x9 leer, 6 mit großem Fragezeichen (gespiegelt bleibt es lesbar: `mirrorRows`), 7 Glühbirne aus (grau), 8 Birne an (gelb),
 * 9 Birne an mit Strahlen.
 */
const THX = -19
const THY = -4
const THS: readonly (readonly [number, number])[] = [[0, 0], [0, 0], [5, 3], [9, 5], [11, 7], [13, 9]]
const BULB_ON = ['..YYY..', '.YWYYY.', 'YWYYYYY', 'YYYYYYY', '.YYYYY.', '..WWW..', '...W...']
const BULB_OFF = ['..GGG..', '.GGGGG.', 'GGGGGGG', 'GGGGGGG', '.GGGGG.', '..WWW..', '...W...']
const QMARK = ['.WWW.', 'W...W', '....W', '...W.', '..W..', '.....', '..W..']
function think(n: number, mirrored = false): PropSprite {
  const g = grid(18, 10)
  if (n >= 2) {
    const [w, h] = THS[Math.min(n, 5)]
    const x0 = 13 - w
    const y0 = 9 - h
    // abgerundetes Rechteck: Ecken je nach Größe um 1 oder 2 Pixel abgeschnitten
    const cut = w >= 11 && h >= 7 ? [3, 1] : [1]
    const inside = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false
      const d = Math.min(y, h - 1 - y)
      return d >= cut.length || (x >= cut[d] && x < w - cut[d])
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
        put(g, x0 + x, y0 + y, edge ? 'W' : 'D')
      }
    }
  }
  // Spur: großer Punkt (3x3) und kleiner Punkt (2x2), beide am unteren rechten Rand der Blase
  rect(g, 16, 8, 2, 2, 'W')
  if (n >= 1) rect(g, 13, 7, 3, 3, 'W')
  const stamp = (rows: readonly string[], x: number, y: number): void =>
    rows.forEach((r, j) => [...r].forEach((c, i) => c !== '.' && put(g, x + i, y + j, c)))
  // Für die gespiegelte Figur seitenverkehrt einsetzen: beim Spiegeln dreht es sich wieder richtig herum (Fynn, 2026-10-06: „?“ falsch herum)
  if (n === 6) stamp(mirrored ? QMARK.map((r) => [...r].reverse().join('')) : QMARK, 4, 1)
  if (n === 7) stamp(BULB_OFF, 3, 1)
  if (n >= 8) {
    stamp(BULB_ON, 3, 1)
    if (n === 9) for (const [x, y] of [[1, 3], [11, 3], [2, 1], [10, 1], [2, 5], [10, 5]] as const) put(g, x, y, 'Y')
  }
  const sp = fxSpr(rowsOf(g))
  return n === 6 && !mirrored ? { ...sp, mirrorRows: think(6, true).rows } : sp
}

/** Z zum Einschlafen (Effekt, 5x5). */
const ZBIG = fxSpr(['WWWWW', '...W.', '..W..', '.W...', 'WWWWW'])
const ZSMALL = fxSpr(['WWWW', '..W.', '.W..', 'WWWW'])
/** Großes Ausrufezeichen (Effekt, 2x6): Schreck beim Aufwachen. */
const EXCL = fxSpr(['WW', 'WW', 'WW', 'WW', '..', 'WW'])
/** Funken (Effekt): groß (5x5, weiße Mitte) und klein (3x3). */
const SPARK5 = fxSpr(['..Y..', '..Y..', 'YYWYY', '..Y..', '..Y..'])
const SPARK3 = fxSpr(['.Y.', 'YWY', '.Y.'])

/** Mini-Tastatur (11x2): Tastenreihe und Gehäuse. */
const KEYB = spr(['GDGDGDGDGDG', 'DDDDDDDDDDD'])

/** Fensterchen (10x6) mit Titelpunkten und zwei laufenden grünen Zeilen: k = 0 bis 5 schiebt die Zeilen weiter (halbe Zeile, dann neue Länge). */
const MLINES = [5, 3, 6, 2, 4, 6, 3]
function miniWin(k: number): PropSprite {
  const g = grid(10, 6)
  rect(g, 0, 0, 10, 6, 'G')
  rect(g, 1, 1, 8, 4, 'K')
  put(g, 1, 0, 'M')
  put(g, 3, 0, 'Y')
  put(g, 5, 0, 'E')
  for (let i = 0; i < 2; i++) {
    const row = 1 + (k % 2) + 2 * i
    rect(g, 2, row, MLINES[(Math.floor(k / 2) + i) % MLINES.length], 1, 'E')
    put(g, 1, row, 'Y')
  }
  return spr(rowsOf(g))
}

/**
 * Brieftaube (7x4, blickt nach links): 0 Flügel oben, 1 Flügel unten. Ohne Auge (Fynn, 2026-10-07: „wirkt unrealistisch“): kleiner Kopf über
 * dem Schnabel, rundlicher grauer Körper, dunkler Schwanz, helle Flügel. Schnabel unverändert links in Zeile 2 (dort hält sie den Brief).
 */
const dove = (v: number): PropSprite => spr(v ? ['.......', '.G.GG..', 'YGGGGGD', '...WW..'] : ['...WW..', '.G.WW..', 'YGGGGGD', '..GGG..'])
/** Brief zu (Effekt, 4x3, roter Siegel) und aufgefaltet (Effekt, 5x5 mit Textzeilen). */
const ENV = fxSpr(['WWWW', 'WMMW', 'WWWW'])
const LETTER = fxSpr(['WWWWW', 'WDDDW', 'WWWWW', 'WDDDW', 'WWWWW'])

/**
 * Git-Fenster (18x9) mit Commit-Graph: Titelpunkte, schwarze Fläche. Zustand 0 bis 7: ein grüner Commit-Punkt, dann wächst die Hauptlinie Punkt für Punkt, ab 3 zweigt
 * ein gelber Seitenzweig nach oben ab (zwei Punkte), ab 5 läuft die Hauptlinie weiter, 6 der Zweig läuft zurück (Merge), 7 der Merge-Punkt blitzt weiß auf.
 */
const ggName = (n: number): string => famName('work_gg', n)
function gitWin(n: number): PropSprite {
  const g = grid(18, 9)
  rect(g, 0, 0, 18, 9, 'G')
  rect(g, 1, 1, 16, 7, 'K')
  rect(g, 1, 0, 16, 1, 'D')
  put(g, 2, 0, 'M')
  put(g, 4, 0, 'Y')
  put(g, 6, 0, 'E')
  const dot = (x: number, y: number, c: string): void => rect(g, x, y, 2, 2, c)
  dot(2, 5, 'E')
  if (n >= 1) {
    rect(g, 4, 6, 2, 1, 'G')
    dot(6, 5, 'E')
  }
  if (n >= 2) {
    rect(g, 8, 6, 2, 1, 'G')
    dot(10, 5, 'E')
  }
  if (n >= 3) {
    for (const [x, y] of [[8, 4], [9, 3], [10, 3]] as const) put(g, x, y, 'G')
    dot(11, 2, 'Y')
  }
  if (n >= 4) {
    rect(g, 13, 3, 2, 1, 'G')
    dot(15, 2, 'Y')
  }
  if (n >= 5) {
    rect(g, 12, 6, 2, 1, 'G')
    dot(14, 5, 'E')
  }
  if (n >= 6) put(g, 16, 4, 'G')
  if (n === 7) dot(14, 5, 'W')
  return spr(rowsOf(g))
}

/**
 * Klemmbrett (12x10) mit Liste: braune Platte, grauer Klipp, weißes Blatt mit drei Zeilen (Kästchen links, Text rechts). Zustand 0 leer, 1 bis 3 = eine bis drei Zeilen
 * mit grünem Häkchen, 4 = erste Zeile Häkchen, zweite ein rotes X (die dritte bleibt leer).
 */
const CLIPRES = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 2, 0]]
const TEXTL = [4, 3, 4]
function clipb(n: number): PropSprite {
  const g = grid(12, 10)
  rect(g, 0, 0, 12, 10, 'R')
  rect(g, 1, 1, 10, 9, 'W')
  rect(g, 4, 0, 4, 1, 'G')
  CLIPRES[n].forEach((r, i) => {
    const y = 1 + 3 * i
    rect(g, 2, y, 3, 3, 'W')
    if (r === 0) {
      rect(g, 2, y, 3, 3, 'G')
      put(g, 3, y + 1, 'W')
    } else if (r === 1) {
      for (const [x, yy] of [[2, 0], [0, 1], [2, 1], [1, 2]] as const) put(g, 2 + x, y + yy, 'E')
    } else {
      for (const [x, yy] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]] as const) put(g, 2 + x, y + yy, 'M')
    }
    rect(g, 6, y + 1, TEXTL[i], 1, 'G')
  })
  return spr(rowsOf(g))
}

/** Diskette (6x6, klassisches Speichern-Symbol): blauer Körper mit abgeschrägter Ecke, grauer Metallschieber oben mit dunklem Schlitz, weißes Etikett unten mit Textzeile. */
const FLOPPY = spr(['NGGDG.', 'NGGDGN', 'NNNNNN', 'NWWWWN', 'NWDDWN', 'NWWWWN'].map((r) => r.replace(/N/g, 'B')))
/** Häkchen (Effekt, 5x4): grün bzw. weiß (blitzt). */
const tick = (c: string): PropSprite => fxSpr(['....' + c, '...' + c + '.', c + '.' + c + '..', '.' + c + '...'])
/** Wolke (Effekt): 0 klein (6x2), 1 groß weiß (10x3), 2 groß grün. */
function cloud(n: number): PropSprite {
  if (n === 0) return fxSpr(['..WW..', 'WWWWWW'])
  const c = n === 2 ? 'E' : 'W'
  return fxSpr(['...CCC....', '.CCCCCCCC.', 'CCCCCCCCCC'].map((r) => r.replace(/C/g, c)))
}
/** Pfeil nach oben (Effekt, 3x4, hellblau). */
const ARROW = fxSpr(['.L.', 'LLL', '.L.', '.L.'])

/**
 * Reagenzglas (4x7): helle Glaswand mit Rand, innen eine zwei Pixel breite Flüssigkeit. Zustand n = 4 * Farbe + Bläschenphase: Farbe 0 blau (Probe), 1 grün (bestanden),
 * 2 rot (fehlgeschlagen); Phase 0 keine Bläschen, 1 bis 3 ein Bläschen steigt in der Flüssigkeit und darüber auf.
 */
const tbName = (n: number): string => famName('work_tb', n)
function tube(n: number): PropSprite {
  const col = 'BEM'[n >> 2]
  const b = n & 3
  const g = grid(4, 7)
  rect(g, 0, 0, 4, 1, 'W')
  for (let y = 1; y <= 5; y++) {
    put(g, 0, y, 'W')
    put(g, 3, y, 'W')
  }
  rect(g, 1, 6, 2, 1, 'W')
  rect(g, 1, 3, 2, 3, col)
  if (b === 1) put(g, 1, 5, 'W')
  if (b === 2) put(g, 2, 4, 'W')
  if (b === 3) put(g, 1, 3, 'W')
  if (b === 3) put(g, 2, 2, 'W')
  return spr(rowsOf(g))
}

export const PROPS: Readonly<Record<string, PropSprite>> = {
  // Laptop im Profil und die Schattenseite der 3/4-Drehung samt ferner Hand
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((n) => [`work_lapP${n}`, lapP(n)])),
  work_tq1: turnQ(1),
  work_tq2: turnQ(2),
  work_tq3: turnQ(3),
  work_tq4: turnQ(4),
  work_fh1: fxSpr(['QQQ', 'QQQ']),
  work_scroll1: scroll(4, 0),
  work_scroll2: scroll(6, 0),
  work_scroll3: scroll(8, 0),
  work_scroll4: scroll(10, 0),
  work_scroll5: scroll(12, 0),
  work_scroll6: scroll(12, 1),
  work_scroll7: scroll(12, 2),
  work_bug0: bug(0),
  work_bug1: bug(1),
  work_lensR0: spr(mirror(lens(0).rows)),
  work_lensR1: spr(mirror(lens(1).rows)),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => [termName(k), terminal(k)])),
  ...Object.fromEntries([0, 1, 2, 3].map((n) => [`work_pult${n}`, pult(n)])),
  work_mast0: mast(0, []),
  work_mast1: mast(1, []),
  work_mast2: mast(0, ['W']),
  work_mast3: mast(0, ['L', 'W']),
  work_mast4: mast(0, ['B', 'L', 'W']),
  work_mast5: mast(0, ['T', 'B', 'L']),
  work_mast6: mast(0, ['', 'T', 'B']),
  work_mast7: mast(0, ['', '', 'T']),
  work_globe0: globe(0),
  work_globe1: globe(1),
  work_globe2: globe(2),
  work_globe3: globe(3),
  work_globe4: globe(4),
  work_globe5: globe(5),
  work_globe6: globe(6),
  work_router0: router(0),
  work_router1: router(1),
  work_wifi1: wifi(1),
  work_wifi2: wifi(2),
  work_wifi3: wifi(3),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`work_tc${n}`, thinkC(n)])),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`work_th${n}`, think(n)])),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => [logName(n), logWin(n)])),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => [spinName(n), spinWin(n)])),
  work_fl0: FLOPPY,
  work_ok0: tick('E'),
  work_ok1: tick('W'),
  work_cl0: cloud(0),
  work_cl1: cloud(1),
  work_cl2: cloud(2),
  work_up: ARROW,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => [tbName(n), tube(n)])),
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((n) => [ggName(n), gitWin(n)])),
  ...Object.fromEntries([0, 1, 2, 3, 4].map((n) => [`work_cb${n}`, clipb(n)])),
  work_kb0: KEYB,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((k) => [`work_mw${k}`, miniWin(k)])),
  work_dove0: dove(0),
  work_dove1: dove(1),
  work_env: ENV,
  work_let: LETTER,
  work_td1: fxSpr(['W']),
  work_td2: fxSpr(['WW', 'WW']),
  work_zB: ZBIG,
  work_zS: ZSMALL,
  work_ex: EXCL,
  work_sp5: SPARK5,
  work_sp3: SPARK3,
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}
const blkR = (o: number, y: number): Frame => armBlock('R', o, y)
const blkL = (o: number, y: number): Frame => armBlock('L', o, y)

// ---------------------------------------------------------------------------------------------------------------------
// Schreiben: Laptop (gemeinsame Bausteine der drei Laptop-Clips)
// Der Laptop liegt rechts neben ihm (Profil, Tastatur zur Figur). Geschlossen kommt er aus der Tasche (fetchIn, Hand schnellt hoch), wird aufgeklappt
// (die Hand hebt den Deckel, er kippt nach hinten), er streckt sich, dreht sich zu 3/4 (Streifen Q, Körper 1 nach rechts, Blick zum Laptop) und tippt:
// die nahe Hand ist der orangene Blockarm, die ferne ein dunkler Block (Requisite) daneben; sie wechseln die Höhe. Hände liegen über den Tasten.
const LPX = 16
const LP: FetchOpts = { name: 'work_lapP0', size: [5, 3], at: [LPX, 7], side: 'R', grip: 1 }
const lp = (n: number): PropRef => ref(`work_lapP${n}`, LPX, n === 0 ? 7 : 4)
const TQ = (n: number): PropRef => ['work_tq' + n, 2, 0]
const FH = (y: number): PropRef => ['work_fh1', 15, y]

/**
 * Tippbild im gedrehten Zustand: nahe Hand (Blockarm) bei Zeile `near`, ferne Hand bei `far` (null = nicht sichtbar), Laptop-Zustand `lapN`.
 * `by` = Körper tiefer (Hände bleiben auf derselben Bühnenzeile). Das Gesicht (`face`) rückt zum Laptop: 2 (das rechte Auge sitzt dann am
 * Körperrand, nur bei weiten Augen in der schnellen Phase), sonst 1 (bei Bogen- und geschlossenen Augen ist 1 das Maximum, sonst ragte die rechte Seite über den Körperrand). Der
 * Schattenstreifen bekommt die Lücke an der Augenzeile, wenn die Augen Bögen sind (Requisiten werden nach den Augen gezeichnet und dürfen sie nicht abdecken).
 */
function tk(near: number, far: number | null, lapN: number, t: number, extra: Frame = {}, by = 0, fxs: PropRef[] = []): Frame {
  const eyes = extra.eyes ?? 'open'
  const narrow = eyes === 'closed' || eyes === 'happy'
  return {
    fx: 1, look: [0, 0], face: eyes === 'wide' ? 2 : 1, armL: 'hide', ...blkR(3, near - by), eyes,
    props: [lp(lapN), TQ(narrow ? 4 : 3), ...(far === null ? [] : [FH(far - by)]), ...fxs], t, ...extra,
  }
}
/** Anschlag A (nahe Hand unten) und B (ferne Hand unten); abwechselnd ergibt das das Tippen. */
const A = (t: number, extra: Frame = {}, by = 0, fxs: PropRef[] = []): Frame => tk(6, 4, 4, t, extra, by, fxs)
const B = (t: number, extra: Frame = {}, by = 0, fxs: PropRef[] = []): Frame => tk(4, 6, 5, t, extra, by, fxs)
/** `n` Anschläge im Takt `t`; `gaze` = Blickhöhe je Anschlag (1 Tastatur, 0 geradeaus, -1 Schirm), reihum. */
const taps = (n: number, t: number, extra: Frame = {}, by = 0, gaze: readonly number[] = [0]): Frame[] =>
  Array.from({ length: n }, (_, i) => (i % 2 ? B : A)(t, { look: [0, gaze[i % gaze.length]], ...extra }, by))

/** Hervorholen, Aufklappen, Strecken, Wenden zu 3/4: alles bis zum ersten Tippbild. */
const lapIntro = (eyes?: string): Frame[] => [
  ...fetchIn(eyes ? { ...LP, eyes } : LP),
  // Deckel aufklappen: die Hand fasst die Vorderkante und hebt sie, der Deckel kippt nach hinten
  { ...blkR(2, 6), look: [1, 1], props: [lp(0)], t: 1 },
  { ...blkR(2, 5), props: [lp(6)], t: 1 },
  { ...blkR(2, 3), props: [lp(1)], t: 1 },
  { armR: 'down', props: [lp(2)], t: 1 },
  { props: [lp(3)], t: 2 },
  // kurzes Strecken
  { squash: -1, armL: 'raise', armR: 'raise', look: [0, 0], t: 3 },
  { squash: 0, armL: 'up1', armR: 'up1', t: 2 },
  { armL: 'down', armR: 'down', t: 1 },
  // Wenden: Schattenstreifen und Gesicht wandern in Stufen mit (Streifen 1, 2, 3 und Gesicht 1, 1, 2), der Körper rückt zum Laptop
  { fx: 1, face: 1, look: [0, 0], props: [lp(3), TQ(1)], t: 2 },
  { armL: 'hide', props: [lp(3), TQ(2)], t: 2 },
  tk(5, null, 3, 2, { face: 2 }),
]
/** Zuklappen, zurückdrehen (Gesicht 2, 1, 0 und Streifen 3, 2, 1, 0 in Stufen), aufnehmen und in der Tasche verstauen. */
const cl = (n: number, out: number, y: number, t: number): Frame => ({ fx: 1, look: [0, 0], face: 2, armL: 'hide', ...blkR(out, y), eyes: 'open', mouth: null, props: [lp(n), TQ(3)], t })
const lapOutro = (): Frame[] => [
  cl(3, 4, 6, 1), cl(2, 4, 5, 1), cl(1, 3, 4, 1), cl(6, 3, 5, 1), cl(0, 3, 6, 2),
  { armL: 'down', armR: 'down', face: 1, props: [lp(0), TQ(2)], t: 1 },
  { fx: 0, face: 0, look: [0, 0], props: [lp(0), TQ(1)], t: 1 },
  { props: [lp(0)], t: 1 },
  ...fetchOut(LP),
]

// Tempo-Wechsel im Hauptteil: langsam (t 3, Blick wandert zwischen Tastatur und Schirm), schneller (t 2), Blinzeln, schnelle Phase (t 1, beide Hände rasch, weite
// Augen, einen Pixel nach vorn gebeugt), Enter mit Bogenaugen, dann wieder langsamer; zwischendurch Nachdenken mit Blick nach oben.
C('type_laptop', 'Tippt am Laptop', 'work_write', {
  loop: true, interruptible: true,
  intro: lapIntro(),
  frames: [
    ...taps(4, 3, {}, 0, [1, 0, -1, 0]),
    ...taps(6, 2, {}, 0, [0, -1, 0, 1, -1, 0]),
    // Blinzeln
    B(1, { eyes: 'half' }), B(1, { eyes: 'closed' }), B(2),
    ...taps(2, 2),
    // schnelle Phase: gebeugt, weite Augen, jeden Tick ein Anschlag
    ...taps(2, 1, { eyes: 'wide' }, 1, [-1]), ...taps(10, 1, { eyes: 'wide' }, 1, [-1, -1, 0]),
    // Enter: die Hand fährt hoch und haut drauf, die Augen werden zu Bögen, er richtet sich auf
    tk(2, 6, 3, 2, { eyes: 'wide' }, 1), A(1, { eyes: 'happy' }, 1), A(2, { eyes: 'happy' }),
    // wieder langsamer
    ...taps(2, 1), ...taps(4, 2, {}, 0, [0, 1]), ...taps(2, 3, {}, 0, [1, 0]),
    // nachdenken: beide Hände heben sich, Blick nach oben, ein Blinzeln
    tk(3, 5, 3, 3, { look: [0, -1] }), tk(3, 5, 3, 2, { eyes: 'half', look: [0, -1] }), tk(3, 5, 3, 1, { eyes: 'closed' }), tk(3, 5, 3, 2, { look: [0, 0] }),
    ...taps(2, 3, {}, 0, [1, 0]),
  ],
  outro: lapOutro(),
})

// Schnell: tagsüber. Gemütlich losgetippt, dann stufenlos schneller bis jeden Tick ein Anschlag; Enter mit Bogenaugen, danach ein Freudenhüpfer (die Arme gehen abwechselnd hoch).
const hop = (fy: number, armL: string, armR: string, t = 1): Frame => tk(6, null, 3, t, { eyes: 'happy', fy, armL, armR })
C('type_fast', 'Tippt schnell', 'work_write', {
  when: 'day', loop: true, interruptible: true,
  intro: lapIntro(),
  frames: [
    ...taps(2, 3, {}, 0, [1, -1]), ...taps(4, 2, {}, 0, [0, -1]),
    ...taps(2, 1, { eyes: 'wide' }, 1, [-1]), ...taps(10, 1, { eyes: 'wide' }, 1, [-1, -1, 0]),
    // Enter
    tk(2, 6, 3, 2, { eyes: 'wide' }, 1), A(1, { eyes: 'happy' }, 1), A(2, { eyes: 'happy' }),
    // Freudenhüpfer
    hop(-1, 'up2', 'down'), hop(-2, 'down', 'up2'), hop(-1, 'up2', 'down'), hop(0, 'down', 'down', 2),
    ...taps(2, 2, {}, 0, [0, 1]), ...taps(2, 3, {}, 0, [1, 0]),
  ],
  outro: lapOutro(),
})

// Nachts: langsam tippen mit halben Augen, dann nickt er weg (der Körper sackt in Stufen, Augen zu), zwei Zs steigen auf, er schreckt hoch (Ausrufezeichen), gähnt,
// streckt sich und tippt weiter.
const zPath = (x: number): PropRef[] => [gp('work_zS', x, 0), gp('work_zB', x, -1), gp('work_zB', x, -2), gp('work_zB', x, -3), gp('work_zB', x, -4), gp('work_zS', x, -4), gp('work_td2', x + 1, -3), gp('work_td1', x + 1, -3)]
const zzSteps = Array.from({ length: 15 }, (_, i) => {
  const fx: PropRef[] = []
  if (i < 8) fx.push(zPath(16)[i])
  if (i >= 7) fx.push(zPath(20)[i - 7])
  return tk(6, null, 4, 1, { eyes: 'closed', mouth: i % 8 < 4 ? 'o' : null }, 2, fx) // ferne Hand ruht (sonst überlappt sie die Zs)
})
const exAt = (y: number, extra: Frame = {}, t = 1): Frame => tk(6, null, 3, t, { look: [0, 0], ...extra }, 0, [gp('work_ex', 17, y)])
C('type_sleepy', 'Tippt verschlafen (nachts)', 'work_write', {
  when: 'night', loop: true, interruptible: true,
  intro: lapIntro('half'),
  frames: [
    // langsam tippen, halbe Augen
    A(3, { eyes: 'half' }), B(3, { eyes: 'half' }), A(3, { eyes: 'half' }), B(3, { eyes: 'half' }),
    // nickt ein: Körper in Stufen tiefer, Augen zu, ruckt kurz hoch, sackt ganz ab
    A(2, { eyes: 'half' }, 1),
    A(1, { eyes: 'closed' }, 1),
    A(1, { eyes: 'half' }, 0),
    A(2, { eyes: 'closed' }, 1),
    A(2, { eyes: 'closed', mouth: 'o' }, 2),
    // zwei Zs steigen an der Figur auf, werden klein und lösen sich auf
    ...zzSteps,
    // Aufschrecken: Körper hoch, Augen weit, Sprung mit Armen hoch, großes Ausrufezeichen
    tk(6, null, 3, 1, { eyes: 'wide', mouth: 'o', armL: 'up1', armR: 'down' }, 1),
    exAt(-2, { eyes: 'wide', fy: -1, armL: 'up2', armR: 'up1' }),
    exAt(-3, { fy: -2 }),
    exAt(-3, { fy: -1, armL: 'up1', armR: 'down' }),
    exAt(-3, { fy: 0, armL: 'down' }, 3),
    // das Ausrufezeichen fällt zum Punkt zusammen
    tk(6, null, 3, 1, { mouth: null }, 0, [gp('work_td2', 17, 1)]),
    tk(6, null, 3, 1, {}, 0, [gp('work_td1', 17, 2)]),
    // verwirrt blinzeln, gähnen und strecken (beide Arme hoch), Augen zu
    tk(6, 4, 4, 3, { eyes: 'half' }),
    tk(6, 4, 4, 1, { eyes: 'closed' }),
    tk(6, null, 3, 2, { eyes: 'closed', armL: 'up1', armR: 'up1', mouth: 'yawn' }),
    tk(6, null, 3, 3, { eyes: 'closed', armL: 'up2', armR: 'up2', mouth: 'yawnBig' }),
    tk(6, null, 3, 2, { eyes: 'closed', armL: 'up1', armR: 'up1', mouth: 'yawn' }),
    A(2, { eyes: 'half', mouth: null }),
    // weitertippen
    B(3, { eyes: 'half' }), A(3, { eyes: 'half' }), B(3, { eyes: 'half' }),
  ],
  outro: lapOutro(),
})

// ---------------------------------------------------------------------------------------------------------------------
// Lesen
// Schriftrolle (links): aus der Tasche geholt (aufgerollt), rollt sich seitlich auf, er liest die Zeilen, rollt sie wieder zusammen und verstaut sie.
const SCROLL = { name: 'work_scroll1', size: [4, 9] as const, at: [-4, 1] as const, side: 'L' as const, grip: 4 }
const SW = [4, 6, 8, 10, 12]
const sc = (n: number, extra: Frame = {}): Frame => ({ ...handTo('L', -1, 5), props: [ref(`work_scroll${n}`, -(n <= 5 ? SW[n - 1] : 12), 1)], ...extra })
C('read_scroll', 'Liest eine Schriftrolle', 'work_read', {
  loop: true, interruptible: true,
  intro: [
    ...fetchIn(SCROLL),
    // aufrollen: die Hand hält die rechte Walze und ruckt, das linke Ende rollt nach links aus
    sc(1, { look: [-2, 1], t: 2 }), sc(2, { ...handTo('L', -1, 4), t: 2 }), sc(3, { ...handTo('L', -1, 5), t: 2 }),
    sc(4, { ...handTo('L', -1, 4), t: 2 }), sc(5, { ...handTo('L', -1, 5), eyes: 'wide', t: 3 }), sc(5, { eyes: 'open', t: 1 }),
  ],
  frames: [
    sc(5, { look: [-2, 1], t: 3 }), sc(5, { look: [-1, 1], t: 3 }), sc(6, { look: [-2, 1], t: 3 }), sc(6, { look: [-1, 1], t: 3 }),
    sc(7, { look: [-2, 1], t: 3 }), sc(7, { look: [-1, 1], t: 3 }), sc(5, { look: [-2, 1], eyes: 'happy', t: 3 }), sc(5, { eyes: 'open', t: 2 }),
  ],
  outro: [
    sc(4, { ...handTo('L', -1, 4), look: [-2, 1], t: 2 }), sc(3, { ...handTo('L', -1, 5), t: 2 }), sc(2, { ...handTo('L', -1, 4), t: 2 }),
    sc(1, { ...handTo('L', -1, 5), t: 2 }),
    ...fetchOut(SCROLL),
  ],
})

// Lupe (rechts): Ein Marienkäfer krabbelt von unten hinter der Linie hervor (er steigt auf und bleibt rechts neben ihm stehen, die Beinchen wuseln). Er holt die Lupe
// aus der Tasche (die Hand schnellt mit der kleinen Lupe hoch, sie wächst in der Hand), hält sie über den Käfer (im Glas ist er groß zu sehen: der Fehler!) und
// folgt ihm ein Stück hin und her. Am Ende kommt die Lupe zurück in die Tasche und der Käfer krabbelt hinter die Linie.
const BUGY = 6
const BG = (x: number, k: number): PropRef => ref(`work_bug${k % 2}`, x, BUGY)
const LENSP: FetchOpts = { name: 'work_lensR0', size: [8, 8], at: [17, 0], side: 'R', grip: 5, keep: [BG(20, 0)] }
/** Lupe in der Hand: Griff unten links bei Spalte x, Hand = Blockarm (out = x - 14, 2 bis 4); der Käfer krabbelt mit, drei Spalten rechts vom Griff. */
const LH = (x: number, y: number, k: number, extra: Frame = {}): Frame => ({
  ...blkR(Math.max(2, Math.min(4, x - 14)), y + 5), props: [BG(x + 3, k), ref(k % 2 ? 'work_lensR1' : 'work_lensR0', x, y)], ...extra,
})
C('magnify', 'Lupe', 'work_read', {
  loop: true, interruptible: true,
  intro: [
    ...riseIn({ name: 'work_bug0', names: ['work_bug0', 'work_bug1'], size: [7, 4], at: [20, BUGY], step: 1, during: { look: [1, 1] } }),
    // Griff in die Tasche: bis zur schnellen Reaktion und zum Hochhalten der kleinen Lupe, dann wächst sie in der Hand und kommt über den Käfer
    ...fetchIn(LENSP).slice(0, 7),
    LH(17, -3, 0, { look: [1, 0], eyes: 'wide', t: 1 }), LH(17, -1, 1, { t: 1 }), LH(17, 0, 0, { eyes: 'open', look: [1, 1], t: 2 }),
  ],
  frames: [
    LH(17, 0, 1, { look: [1, 1], t: 2 }), LH(17, 0, 0, { t: 2 }), LH(16, 0, 1, { t: 2 }), LH(16, 0, 0, { t: 2 }), LH(16, 0, 1, { eyes: 'wide', t: 3 }),
    LH(17, 0, 0, { eyes: 'open', t: 2 }), LH(18, 0, 1, { look: [1, 0], t: 2 }), LH(18, 0, 0, { t: 2 }), LH(18, 0, 1, { t: 2 }), LH(18, 0, 0, { eyes: 'happy', t: 3 }),
    LH(17, 0, 1, { eyes: 'open', look: [1, 1], t: 2 }), LH(17, 0, 0, { t: 2 }),
  ],
  outro: [
    LH(17, 0, 1, { look: [1, 1], t: 1 }),
    ...fetchOut(LENSP),
    ...sinkOut({ name: 'work_bug0', names: ['work_bug0', 'work_bug1'], size: [7, 4], at: [20, BUGY], step: 1, during: { look: [1, 1] } }),
    { look: [0, 0], t: 1 },
  ],
})

// ---------------------------------------------------------------------------------------------------------------------
// Shell
// Terminal: ein Fenster mit Titelleiste (rot, gelb, grün) steigt von unten hinter der Linie auf und steht links (eine Lücke bis zur Figur). Er schaut zu, wie ein Befehl
// getippt wird, die Ausgabe kommt und ein Fortschrittsbalken wächst (Intro). Dann laufen die Zeilen weiter durch (Schleife, die Eingabezeile unten mit blinkendem
// Cursor), er schaut zu, nickt, tippt zwischendurch kurz mit der Blockhand an den Rand des Fensters und blinzelt. Zum Schluss sinkt das Fenster wieder.
const TX = -15
const TSIZE = [14, 10] as const
const ta = (k: number, t: number, extra: Frame = {}): Frame => ({ props: [ref(termName(k), TX, 0)], t, ...extra })
const TERM_EVENTS: Readonly<Record<number, Frame>> = {
  3: { look: [-1, 1] }, 6: { look: [-1, 0] }, 9: { by: 1 }, 10: { by: 0 }, 14: { ...blkL(4, 5) }, 15: { armL: 'down' }, 19: { eyes: 'closed' }, 20: { eyes: 'open' },
  23: { look: [-1, 1] }, 26: { by: 1 }, 27: { by: 0, look: [-1, 0] },
}
C('terminal_watch', 'Schaut aufs Terminal', 'work_shell', {
  loop: true, interruptible: true,
  intro: [
    ...riseIn({ name: termName(0), size: TSIZE, at: [TX, 0], step: 2, during: { look: [-1, 0] } }),
    // Eingabezeile: der Cursor wartet, der Befehl wird geschrieben (kurzer Blocktipp an den Rand), Ausgabe, Fortschrittsbalken
    ta(0, 3, { look: [-1, 0], eyes: 'open' }), ta(1, 1, { ...blkL(4, 5) }), ta(1, 1, { armL: 'down' }), ta(2, 3),
    ta(3, 2, { look: [-1, 1] }), ta(4, 2, { by: 1 }), ta(4, 2, { by: 0 }), ta(5, 3, { eyes: 'wide' }), ta(5, 2, { eyes: 'open' }),
  ],
  frames: Array.from({ length: 30 }, (_, i) => ta(6 + (i % 6), 2, TERM_EVENTS[i] ?? {})),
  outro: [
    ...sinkOut({ name: termName(11), size: TSIZE, at: [TX, 0], step: 2, during: { look: [-1, 0], by: 0, armL: 'down', eyes: 'open' } }),
    { look: [0, 0], armL: 'down', t: 2 },
  ],
})

// Log-Fenster (rechts): ein breites Fenster steigt von unten auf. Die Log-Zeilen laufen, unten wächst langsam ein grüner Fortschrittsbalken (er beginnt danach von vorn,
// wie der nächste Download). Er steht ruhig davor, schaut ab und zu hin, blinzelt und nickt, wenn der Balken voll ist.
const LOGX = 19
const LOGSIZE = [18, 7] as const
const lg = (n: number, t: number, extra: Frame = {}): Frame => ({ props: [ref(logName(n), LOGX, 3)], t, ...extra })
const LOG_EVENTS: Readonly<Record<number, Frame>> = {
  4: { look: [1, 0] }, 7: { look: [0, 0] }, 10: { eyes: 'closed' }, 11: { eyes: 'open' }, 12: { look: [1, 0] }, 15: { look: [0, 0] },
  18: { look: [1, -1] }, 20: { look: [1, 0] }, 22: { by: 1 }, 23: { by: 0, look: [1, 0] },
}
C('shell_log', 'Schaut aufs Log-Fenster', 'work_shell', {
  loop: true, interruptible: true,
  intro: riseIn({ name: logName(0), size: LOGSIZE, at: [LOGX, 3], step: 1, during: { look: [1, 0] } }),
  frames: Array.from({ length: 24 }, (_, i) => lg((i >> 2) * 2 + (i % 2), 3, LOG_EVENTS[i] ?? {})),
  outro: [
    ...sinkOut({ name: logName(11), size: LOGSIZE, at: [LOGX, 3], step: 1, during: { look: [1, 0], by: 0, eyes: 'open' } }),
    { look: [0, 0], t: 2 },
  ],
})

// Tablet mit Ladekreis (rechts): ein kleines Fenster kommt aus der Tasche. Der Ladekreis dreht sich, er wartet, und bei jeder fertigen Zeile nickt er. Nach der dritten Zeile
// wird die Anzeige geleert und es geht von vorn los. Am Ende kommt das Fenster zurück in die Tasche.
const SPW = { name: spinName(0), size: [12, 9] as const, at: [18, 1] as const, side: 'R' as const, grip: 4 }
const sp = (l: number, p: number, t: number, extra: Frame = {}): Frame => ({ props: [ref(spinName(l * 4 + p), 18, 1)], t, ...extra })
const spins = (l: number, n: number, extra: Frame = {}): Frame[] => Array.from({ length: n }, (_, i) => sp(l, i % 4, 2, i === 0 ? extra : {}))
C('shell_spinner', 'Wartet auf das Tablet', 'work_shell', {
  loop: true, interruptible: true,
  intro: fetchIn(SPW),
  frames: [
    ...spins(0, 6, { look: [1, 0], eyes: 'open' }), sp(0, 2, 2, { look: [1, -1] }), sp(0, 3, 2, { look: [1, 0] }),
    sp(1, 0, 1, { by: 1 }), sp(1, 1, 2, { by: 0 }), ...spins(1, 6).slice(2), sp(1, 2, 2, { eyes: 'closed' }), sp(1, 3, 2, { eyes: 'open' }),
    sp(2, 0, 1, { by: 1 }), sp(2, 1, 2, { by: 0 }), ...spins(2, 8).slice(2), sp(2, 2, 2, { look: [1, -1] }), sp(2, 3, 2, { look: [1, 0] }),
  ],
  outro: fetchOut(SPW),
})

// Knopf-Pult: eine Schalttafel mit einem großen roten Knopf und einer Signallampe steigt von unten auf (links). Er drückt mit der Blockhand von oben auf den Knopf
// (er sinkt ein, die Lampe geht an), drückt ihn noch einmal (aus), tippt schnell zweimal und freut sich am Blinken. Dann sinkt das Pult wieder.
const PU = (n: number): PropRef => ref(`work_pult${n}`, -10, 2)
const pa = (n: number, t: number, extra: Frame = {}): Frame => ({ props: [PU(n)], t, ...extra })
const hov = blkL(4, 3)
const prs = blkL(4, 4)
C('press_buttons', 'Drückt Knöpfe', 'work_shell', {
  loop: true, interruptible: true,
  intro: riseIn({ name: 'work_pult0', size: [10, 8], at: [-10, 2], step: 1, during: { look: [-1, 0] } }),
  frames: [
    pa(0, 2, { ...hov, look: [-1, 0], eyes: 'open' }),
    // erster Druck: Knopf sinkt ein, die Lampe geht an
    pa(3, 3, { ...prs, eyes: 'wide' }), pa(2, 2, { ...hov, eyes: 'open' }), pa(2, 3, { armL: 'down', eyes: 'happy' }),
    // zweiter Druck: Lampe aus
    pa(2, 1, { ...hov, eyes: 'open' }), pa(1, 3, { ...prs }), pa(0, 2, { ...hov }),
    // schnell hintereinander
    pa(3, 2, { ...prs }), pa(2, 1, { ...hov }), pa(1, 2, { ...prs }), pa(0, 1, { ...hov }), pa(3, 2, { ...prs }), pa(2, 2, { ...hov }),
    // Lampe blinkt, er freut sich
    pa(2, 2, { armL: 'down', eyes: 'happy', look: [-1, 0] }), pa(0, 1), pa(2, 1), pa(0, 1), pa(2, 2),
    pa(0, 2, { eyes: 'open', look: [-1, 0] }),
  ],
  outro: [
    ...sinkOut({ name: 'work_pult0', size: [10, 8], at: [-10, 2], step: 1, during: { armL: 'down', look: [-1, 0] } }),
    { look: [0, 0], t: 2 },
  ],
})

// ---------------------------------------------------------------------------------------------------------------------
// Web
// Globus: kommt aus der Tasche, er stupst ihn an, die Kontinente laufen erst schnell, dann immer langsamer.
const GLOBE = { name: 'work_globe0', size: [7, 9] as const, at: [-7, 1] as const, side: 'L' as const, grip: 7 }
const GB = (k: number): PropRef => ref(`work_globe${k % 7}`, -7, 1)
const spin = (from: number, n: number, t: number): Frame[] => Array.from({ length: n }, (_, i): Frame => ({ props: [GB(from + i)], t }))
C('globe_spin', 'Globus', 'work_web', {
  loop: true, interruptible: true,
  intro: fetchIn(GLOBE),
  frames: [
    { look: [-2, 0], armL: { out: 3, y: 3, h: 2 }, props: [GB(0)], t: 3 }, { armL: { out: 2, y: 3, h: 2 }, eyes: 'wide', t: 2 },
    { armL: { out: 3, y: 3, h: 2 }, props: [GB(0)], t: 1 }, { armL: { out: 2, y: 3, h: 2 }, t: 1 },
    ...spin(1, 7, 1), ...spin(1, 7, 1), ...spin(1, 5, 2), ...spin(6, 3, 3), { armL: 'down', props: [GB(2)], eyes: 'open', t: 2 },
    { eyes: 'happy', t: 3 }, { eyes: 'open', t: 1 },
  ],
  outro: fetchOut(GLOBE),
})

// Sendemast: er steigt von unten auf (Gitterturm, Lampe an der Spitze), er stupst ihn an (er wackelt), dann sendet die Spitze Funkbögen ")))" und "(((", die von der
// Lampe nach außen wandern und schwächer werden (weiß, hellblau, blau) und vergehen. Am Ende sinkt der Mast wieder.
const MX = -12
const MY = -4
const MSIZE = [15, 14] as const
const mf = (n: number): PropRef => ref(`work_mast${n}`, MX, MY)
const wave = (n: number, t: number, extra: Frame = {}): Frame => ({ props: [mf(n)], t, ...extra })
C('antenna', 'Antenne (Web)', 'work_web', {
  loop: true, interruptible: true,
  intro: riseIn({ name: 'work_mast0', size: MSIZE, at: [MX, MY], step: 2, during: { look: [-1, -1] } }),
  frames: [
    wave(0, 3, { look: [-1, -1], armL: 'down' }),
    // anstupsen: die Blockhand tippt an den Mastfuß, die Spitze wackelt
    wave(0, 2, { ...blkL(4, 7), look: [-2, 0], eyes: 'winkR' }), wave(1, 1), wave(0, 1), wave(1, 1), wave(0, 2),
    wave(0, 2, { armL: 'down', eyes: 'open', look: [-1, -1] }),
    // Funkbögen wandern nach außen und vergehen (zweimal)
    wave(2, 2, { eyes: 'wide' }), wave(3, 2), wave(4, 2, { eyes: 'happy' }), wave(5, 2), wave(6, 2), wave(7, 1), wave(0, 1),
    wave(2, 2, { eyes: 'open' }), wave(3, 2), wave(4, 2), wave(5, 2), wave(6, 2), wave(7, 1), wave(0, 2),
  ],
  outro: [
    ...sinkOut({ name: 'work_mast0', size: MSIZE, at: [MX, MY], step: 2, during: { look: [-2, 1] } }),
    { eyes: 'open', look: [0, 0], armL: 'down', t: 2 },
  ],
})

// WLAN-Router (rechts): aus der Tasche geholt, er stupst ihn an, die Lämpchen blinken, und das WLAN-Zeichen geht genau von seiner Mitte aus (Punkt zwischen den
// beiden Antennen, Bögen darüber), wächst und löst sich wieder auf; er schaut ihm nach.
const ROUTER = { name: 'work_router0', size: [9, 7] as const, at: [17, 3] as const, side: 'R' as const, grip: 4 }
const RT = (ph: number, ...fx: PropRef[]): readonly PropRef[] => [ref(`work_router${ph}`, 17, 3), ...fx]
const WF = (n: number): PropRef => ref(`work_wifi${n}`, 18, -2)
C('wifi_router', 'WLAN-Router', 'work_web', {
  loop: true, interruptible: true,
  intro: fetchIn(ROUTER),
  frames: [
    { look: [1, 0], ...blkR(3, 6), props: RT(0), t: 2 }, { ...blkR(2, 6), props: RT(1), t: 1 }, { ...blkR(3, 6), props: RT(0), t: 2 },
    { armR: 'down', look: [1, -1], eyes: 'wide', props: RT(1, WF(1)), t: 2 }, { props: RT(0, WF(2)), t: 2 }, { props: RT(1, WF(3)), eyes: 'happy', t: 3 },
    { props: RT(0, WF(2)), eyes: 'open', t: 2 }, { props: RT(1, WF(3)), t: 2 }, { props: RT(0, WF(3)), t: 3 },
    { props: RT(1, WF(2)), t: 2 }, { props: RT(0, WF(1)), t: 2 }, { props: RT(0), look: [1, 0], t: 3 },
  ],
  outro: fetchOut(ROUTER),
})

// ---------------------------------------------------------------------------------------------------------------------
// Denken (Effekte: sie entstehen am Kopf und bauen sich an ihm wieder ab, nie weit weg). Hände wie immer Blöcke: die rechte Blockhand tippt
// in kleinen Schritten an den Kopf, die linke bleibt unten.
const hand = (y: number): Frame => ({ armR: { out: 2, y, h: 2 } })
const TC = (n: number, t: number, extra: Frame = {}): Frame => ({ props: [ref(`work_tc${n}`, -19, -4)], t, ...extra })
C('think_dots', 'Denkt (…)', 'work_think', {
  weight: 0.5, loop: true, interruptible: true, frames: [
    { ...hand(3), look: [-1, -1], eyes: 'open', props: [], t: 3 },
    // aufbauen: kleiner Kreis, mittlerer Kreis, dann wächst die Blase mit Rand, zuletzt erscheinen die drei Punkte "…" darin
    TC(0, 2, hand(2)), TC(1, 2, hand(3)), TC(2, 2, hand(2)), TC(3, 2, hand(3)), TC(4, 2, hand(2)), TC(5, 3, { ...hand(3), look: [-2, -1] }),
    TC(6, 3, hand(2)), TC(7, 3, hand(3)), TC(8, 6, hand(2)), TC(8, 2, { ...hand(3), eyes: 'half' }), TC(8, 2, { ...hand(2), eyes: 'open' }),
    // abbauen: die Punkte verschwinden, die Blase schrumpft, dann die zwei Kreise am Kopf
    TC(7, 2, { look: [-1, -1] }), TC(6, 2), TC(5, 2), TC(4, 1), TC(3, 1), TC(2, 1), TC(1, 2), TC(0, 2),
    { ...hand(4), armR: 'down', props: [], look: [0, 0], t: 2 },
  ],
})

// Grübelt: Er schaut schräg nach links oben und hebt die Hand an die Wange (sie wippt in kleinen Schritten). Von seinem Kopf geht eine Gedankenspur aus (ein
// kleiner Punkt am Kopf, dann ein größerer), an der die Denkblase nach links oben wächst. Darin erst ein großes Fragezeichen, dann geht eine Glühbirne an
// (erst grau, flackert, dann gelb mit Strahlen): Idee! Er hüpft, die Arme gehen abwechselnd hoch, dann schrumpft die Blase wieder zur Spur am Kopf.
const TH = (n: number, t: number, extra: Frame = {}): Frame => ({ props: [ref(`work_th${n}`, -19, -4)], t, ...extra })
C('think_tap', 'Grübelt', 'work_think', {
  loop: true, interruptible: true,
  frames: [
    // Hand an die Wange, Blick schräg nach oben, tippt
    { armL: 'up1', look: [-1, -1], eyes: 'open', props: [], t: 3 }, { armL: 'up2', t: 2 }, { armL: 'up1', t: 2 }, { armL: 'up2', look: [-2, -1], t: 2 },
    // Gedankenspur und Blase wachsen
    TH(0, 1, { armL: 'up1' }), TH(1, 1, { armL: 'up2' }), TH(2, 1, { armL: 'up1' }), TH(3, 1, { armL: 'up2' }), TH(4, 1, { armL: 'up1' }), TH(5, 2, { armL: 'up2' }),
    // Fragezeichen
    TH(6, 3, { armL: 'up1' }), TH(6, 2, { armL: 'up2' }), TH(6, 3, { armL: 'up1', eyes: 'half' }),
    // Idee: Hand weg vom Kinn, die Birne geht an, flackert, leuchtet
    TH(7, 2, { armL: 'down', eyes: 'wide', look: [-2, -1] }), TH(8, 1), TH(7, 1), TH(8, 1), TH(9, 3, { eyes: 'happy' }),
    // Jubel: Hüpfer, die Arme gehen abwechselnd hoch, die Birne pulsiert
    TH(8, 1, { fy: -1, armL: 'up2', look: [0, 0] }), TH(9, 1, { fy: -2, armL: 'down', armR: 'up2' }), TH(8, 1, { fy: -1, armR: 'down', armL: 'up2' }),
    TH(9, 2, { fy: 0, armL: 'down' }), TH(8, 2, { eyes: 'open', look: [-2, -1] }),
    // die Blase schrumpft zur Spur am Kopf und verschwindet dort
    TH(7, 1), TH(5, 1), TH(4, 1), TH(3, 1), TH(2, 1), TH(1, 1), TH(0, 1), { props: [], look: [0, 0], t: 2 },
  ],
})

// ---------------------------------------------------------------------------------------------------------------------
// Neue Arbeits-Clips (Runde 4)

// Mini-Tastatur (vor ihm): sie kommt aus der Tasche und wandert vor den Bauch (unterhalb der Augen), dann steigt rechts ein Fensterchen von unten auf. Er tippt mit beiden
// Vorderarmen abwechselnd, die Zeilen im Fensterchen laufen, der Blick wechselt zwischen Fenster und Tasten. Am Ende sinkt das Fenster, die Tastatur geht zurück in die Tasche.
const KBP = { name: 'work_kb0', size: [11, 2] as const, at: [16, 8] as const, side: 'R' as const, grip: 0 }
const KB = (x: number, y: number): PropRef => ref('work_kb0', x, y)
const KF = KB(3, 6)
const MWIN = { name: 'work_mw0', size: [10, 6] as const, at: [19, 4] as const, keep: [KF] }
const kt = (k: number, t: number, extra: Frame = {}): Frame => ({ props: [KF, ref(`work_mw${k}`, 19, 4)], t, ...extra })
const hands = (i: number): Frame => (i % 2 ? { armL: 'typeUp', armR: 'type' } : { armL: 'type', armR: 'typeUp' })
C('shell_keys', 'Tippt auf Mini-Tastatur', 'work_shell', {
  loop: true, interruptible: true,
  intro: [
    ...fetchIn(KBP).slice(0, 7),
    { ...blkR(2, 0), eyes: 'open', look: [0, 0], props: [KB(15, 0)], t: 1 },
    { ...blkR(2, 3), props: [KB(14, 3)], t: 1 },
    { ...blkR(2, 5), props: [KB(10, 5)], t: 1 },
    { ...blkR(2, 6), props: [KB(6, 6)], t: 1 },
    { armL: 'hold', armR: 'hold', props: [KF], look: [0, 1], t: 2 },
    ...riseIn({ ...MWIN, step: 1, during: { ...hands(0), look: [1, 0] } }),
  ],
  frames: Array.from({ length: 14 }, (_, i) => kt(i % 6, 2, { ...hands(i), look: i % 5 === 4 ? [0, 1] : [1, 0], eyes: i === 9 ? 'closed' : 'open' })),
  outro: [
    ...sinkOut({ ...MWIN, step: 1, during: { ...hands(0), look: [1, 0], eyes: 'open' } }),
    { armL: 'hold', armR: 'hold', props: [KF], look: [0, 1], t: 1 },
    { armL: 'down', ...blkR(2, 6), props: [KB(6, 6)], t: 1 },
    { ...blkR(2, 5), props: [KB(10, 5)], t: 1 },
    { ...blkR(2, 4), props: [KB(14, 4)], t: 1 },
    { ...blkR(2, 6), props: [KB(16, 6)], t: 1 },
    ...fetchOut(KBP),
  ],
})

// Brieftaube (rechts): sie steigt von unten hinter der Linie auf und flattert, einen Brief im Schnabel (der Brief ist ein Effekt am Schnabel). Er streckt die Hand,
// nimmt ihn, die Taube taucht wieder nach unten weg. Er öffnet den Brief (er klappt auf), liest, freut sich, faltet ihn und steckt ihn in die Tasche (der Brief wird dabei klein).
const DX = 22
const dv = (y: number, k: number): PropRef => ref(`work_dove${k % 2}`, DX, y)
const ev = (x: number, y: number): PropRef => ref('work_env', x, y)
const dFlap = (n: number, y: number, env: PropRef, extra: Frame = {}): Frame[] => Array.from({ length: n }, (_, i): Frame => ({ props: [dv(y, i), env], t: 1, ...extra }))
C('web_dove', 'Brieftaube', 'work_web', {
  interruptible: true,
  frames: [
    ...Array.from({ length: 8 }, (_, i): Frame => ({ props: [dv(9 - i, i), ev(18, 10 - i)], look: [1, -1], t: 1 })),
    ...dFlap(6, 2, ev(18, 3), { eyes: 'wide', look: [1, -1] }),
    { ...blkR(2, 3), props: [dv(2, 0), ev(18, 3)], t: 1 }, { ...blkR(3, 3), props: [dv(2, 1), ev(18, 3)], t: 1 }, { ...blkR(4, 3), props: [dv(2, 0), ev(18, 3)], t: 2 },
    // er nimmt den Brief, die Taube taucht nach unten weg
    { ...blkR(2, 4), props: [dv(2, 1), ev(16, 4)], eyes: 'open', t: 1 },
    ...[4, 6, 8].map((y, i): Frame => ({ ...blkR(2, 4), props: [dv(y, i), ev(16, 4)], look: [1, 0], t: 1 })),
    { ...blkR(2, 4), props: [ev(16, 4)], t: 2 },
    // aufklappen und lesen
    { ...blkR(2, 5), props: [ref('work_let', 16, 3)], eyes: 'wide', t: 2 },
    { props: [ref('work_let', 16, 3)], look: [1, 0], eyes: 'open', t: 3 }, { look: [1, 1], t: 3 }, { look: [1, 0], t: 2 }, { eyes: 'happy', t: 3 },
    // zufalten und in die Tasche stecken
    { ...blkR(2, 4), eyes: 'open', look: [1, 1], props: [ev(16, 4)], t: 2 },
    { ...blkR(2, 5), props: [['work_env@70', 14, 5, 'g']], t: 1 },
    { ...blkR(1, 6), props: [['work_env@40', 13, 6, 'g']], by: 1, eyes: 'winkR', look: [1, 1], t: 1 },
    { ...blkR(1, 5), props: [], by: 1, t: 1 },
    { armR: 'down', by: 0, eyes: 'open', look: [0, 0], t: 2 },
  ],
})

// ---------------------------------------------------------------------------------------------------------------------
// Laune-Clips (Engine: temper bad / good / tired). Sie stehen am Ende ihrer Gruppe, damit der erste Clip der Gruppe neutral bleibt.

// Gereizt tippen (Frust): Laptop-Basis (gleiches Intro und Outro), angry-Augen, flacher Mund, harte schnelle Anschläge (der Körper zuckt 1 px), zwischendurch ein
// genervtes Seufzen (Körper sackt, Mund rund) und Kopfschütteln, einmal ein kleines Dampfwölkchen über dem Kopf (steam1 und steam2, ein Effekt am Kopf).
const GR = { eyes: 'angry', mouth: 'flat' }
const hard = (i: number, fxs: PropRef[] = [], extra: Frame = {}): Frame => (i % 2 ? B : A)(1, { ...GR, ...extra }, i % 2, fxs)
C('type_grumpy', 'Tippt gereizt', 'work_write', {
  temper: 'bad', loop: true, interruptible: true,
  intro: lapIntro(),
  frames: [
    ...Array.from({ length: 8 }, (_, i) => hard(i)),
    // genervtes Seufzen: Körper sackt, Mund rund
    A(3, { eyes: 'angry', mouth: 'o' }, 1), A(2, { eyes: 'half', mouth: 'o' }, 1), A(2, { ...GR }, 0),
    // Kopfschütteln
    A(2, { ...GR, face: 2 }), A(2, { ...GR, face: 1 }), A(2, { ...GR, face: 2 }), A(2, { ...GR, face: 1 }),
    // noch härter: das Dampfwölkchen steigt über dem Kopf auf und löst sich auf
    hard(0, [gp('steam1', 6, -1)]), hard(1, [gp('steam2', 8, -2)]), hard(2, [gp('steam1', 6, -3)]), hard(3, [gp('steam2', 8, -3)]),
    ...Array.from({ length: 6 }, (_, i) => hard(i + 4)),
    // Enter mit Wucht
    tk(2, 6, 3, 2, { ...GR }, 1), A(1, { ...GR }, 1), A(2, { ...GR }),
  ],
  outro: lapOutro(),
})

// Müde tippen: Laptop-Basis, langsam mit halben Augen, er nickt kurz ein, reibt sich mit beiden Händen die Augen (Vorderarme, Augen zu), streckt den Rücken (Arme hoch,
// gähnen) und tippt weiter.
const TD = { eyes: 'half' }
C('type_tired', 'Tippt müde', 'work_write', {
  temper: 'tired', loop: true, interruptible: true,
  intro: lapIntro(),
  frames: [
    ...taps(4, 3, TD, 0, [1, 0, -1, 0]),
    A(2, TD, 1), A(2, { eyes: 'closed' }, 1), A(2, TD, 0),
    // Augen reiben
    tk(6, null, 3, 2, { eyes: 'closed', armL: 'rub', armR: 'rub' }), tk(6, null, 3, 2, { eyes: 'closed', armL: 'rubUp', armR: 'rubUp' }),
    tk(6, null, 3, 2, { eyes: 'closed', armL: 'rub', armR: 'rub' }), tk(6, null, 3, 2, { eyes: 'closed', armL: 'rubUp', armR: 'rubUp' }),
    A(2, TD), B(3, TD),
    ...taps(4, 3, TD, 0, [1, 0]),
    // Rücken strecken und gähnen
    tk(6, null, 3, 2, { eyes: 'closed', armL: 'up1', armR: 'up1', mouth: 'yawn' }), tk(6, null, 3, 3, { eyes: 'closed', armL: 'up2', armR: 'up2', mouth: 'yawnBig' }),
    tk(6, null, 3, 2, { eyes: 'closed', armL: 'up1', armR: 'up1', mouth: 'yawn' }),
    A(3, { ...TD, mouth: null }), ...taps(3, 3, TD, 0, [1, 0]),
  ],
  outro: lapOutro(),
})

// Seufzend nachdenken (Frust): der Kopf liegt schwer in der Hand (Vorderarm als Kinnstütze, er wechselt zwischendurch die Griffhöhe), der Blick geht nach oben und wandert,
// der Kopf neigt sich schief (das Gesicht rückt 1 Pixel zur Seite), er schüttelt leicht den Kopf und seufzt: ein Wölkchen geht aus dem Mund nach unten und zur Seite
// (Effekt am Körper) und löst sich auf, dabei sackt er etwas. Keine Gedankenblase.
C('think_sigh', 'Seufzt beim Denken', 'work_think', {
  temper: 'bad', loop: true, interruptible: true,
  frames: [
    { armL: 'chin', armR: 'down', look: [-1, -1], eyes: 'half', mouth: 'flat', face: 1, props: [], t: 5 },
    { armL: 'chinUp', look: [0, -1], t: 3 }, { armL: 'chin', look: [1, -1], face: 0, t: 5 }, { armL: 'chinUp', look: [0, -1], face: -1, t: 3 }, { armL: 'chin', look: [-1, -1], t: 4 },
    // Kopfschütteln
    { face: 1, t: 1 }, { face: -1, t: 1 }, { face: 1, t: 1 }, { face: -1, t: 1 }, { face: 0, look: [-1, -1], t: 3 },
    // Seufzer: Augen zu, tief einatmen, ausatmen, das Wölkchen wandert nach unten links
    { eyes: 'closed', mouth: 'o', t: 3 }, { by: 1, mouth: 'o', props: [gp('puff', 7, 6)], t: 2 }, { props: [gp('puff', 4, 7)], t: 2 },
    { props: [gp('puff', 0, 8)], t: 2 }, { props: [gp('dotW', -1, 9)], mouth: 'flat', t: 2 }, { props: [], t: 1 },
    { by: 1, eyes: 'half', look: [-1, -1], t: 5 }, { by: 0, armL: 'chinUp', t: 3 }, { armL: 'chin', face: 1, look: [0, -1], t: 5 },
    { armL: 'down', eyes: 'open', look: [0, 0], mouth: null, face: 0, t: 1 },
  ],
})

// Gut gelaunt denken: Hand am Kinn (Kinn reiben, Griff wechselt), die Pupillen wandern nach oben links und oben rechts, er wippt leicht im Takt, lächelt, blinzelt und
// lässt einmal eine kleine Note aufsteigen (Effekt am Kopf). Keine Gedankenblase.
const hp = (i: number, extra: Frame = {}): Frame => ({ by: i % 2 ? 1 : 0, armL: (i >> 1) % 2 ? 'chinUp' : 'chin', armR: 'down', mouth: 'smile', t: 2, ...extra })
C('think_happy', 'Denkt gut gelaunt', 'work_think', {
  temper: 'good', loop: true, interruptible: true,
  frames: [
    hp(0, { look: [-1, -1], eyes: 'open', props: [] }), hp(1), hp(2), hp(3), hp(4, { look: [0, -1] }), hp(5), hp(6, { look: [1, -1] }), hp(7), hp(8), hp(9, { eyes: 'closed' }),
    hp(10, { eyes: 'open', look: [1, -1], props: [gp('note', 14, -1)] }), hp(11, { props: [gp('note', 15, -2)] }), hp(12, { props: [gp('note', 14, -3)] }), hp(13, { props: [] }),
    hp(14, { look: [0, -1] }), hp(15), hp(16, { look: [-1, -1] }), hp(17), hp(18), hp(19),
    { by: 0, armL: 'down', eyes: 'open', look: [0, 0], mouth: null, props: [], t: 1 },
  ],
})

// ---------------------------------------------------------------------------------------------------------------------
// Denk-Clips ohne Gedankenblase: ruhig, jeder mit eigenem Charakter (Schleife etwa 4 bis 8 s).

// Kinn reiben: die Hand am Kinn wechselt zwischen unten und oben (reiben), die Pupillen wandern oben links und oben rechts, gelegentlich ein kleines Nicken ("mhm").
const ch = (up: boolean, t: number, extra: Frame = {}): Frame => ({ armL: up ? 'chinUp' : 'chin', armR: 'down', t, ...extra })
C('think_chin', 'Reibt sich das Kinn', 'work_think', {
  loop: true, interruptible: true,
  frames: [
    ch(false, 5, { look: [-1, -1], eyes: 'open', mouth: null }), ch(true, 4), ch(false, 4), ch(true, 4), ch(false, 4),
    ch(true, 5, { look: [0, -1] }), ch(false, 5, { look: [1, -1] }), ch(true, 4), ch(false, 4), ch(true, 4),
    // mhm: zweimal nicken
    ch(false, 3, { look: [1, 0] }), ch(false, 2, { by: 1 }), ch(false, 2, { by: 0 }), ch(false, 2, { by: 1 }), ch(false, 4, { by: 0, look: [0, -1] }),
    ch(true, 3, { eyes: 'closed' }), ch(false, 6, { eyes: 'open', look: [-1, -1] }), ch(true, 4), ch(false, 4),
    { armL: 'down', look: [0, 0], t: 1 },
  ],
})

// Am Kopf kratzen: ein Blockarm geht seitlich hoch an den Kopf und kratzt mit kurzem Auf und Ab, der Kopf neigt sich schief (das Gesicht rückt 1 Pixel), der Blick geht nach oben.
const scr = (y: number, t: number, extra: Frame = {}): Frame => ({ armR: { out: 2, y, h: 2 }, armL: 'down', t, ...extra })
C('think_scratch', 'Kratzt sich am Kopf', 'work_think', {
  loop: true, interruptible: true,
  frames: [
    scr(4, 5, { look: [-1, -1], face: 1, eyes: 'open' }), scr(3, 3), scr(1, 3),
    scr(0, 3), scr(1, 3), scr(0, 3), scr(1, 3), scr(0, 3), scr(1, 3), scr(0, 4),
    scr(2, 3, { look: [0, -1] }), scr(4, 4, { face: 0, look: [1, -1] }),
    // einen Moment überlegen, dann die andere Neigung
    scr(5, 6, { armR: 'down', look: [1, -1], face: -1 }), { armR: 'down', eyes: 'closed', t: 2 }, { eyes: 'open', look: [0, -1], t: 6 },
    scr(3, 3, { face: -1 }), scr(1, 3), scr(0, 3), scr(1, 3), scr(0, 3), scr(1, 3), scr(2, 3), scr(4, 4, { face: 0, look: [-1, -1] }),
    { armR: 'down', look: [0, 0], face: 0, t: 1 },
  ],
})

// Nachdenklich auf und ab: er geht langsam ein paar Pixel nach links (die Hand am Kinn), bleibt stehen und schaut hoch, geht zurück, schaut wieder hoch.
const pace = (from: number, to: number, look: readonly [number, number]): Frame[] => {
  const dir = Math.sign(to - from)
  const out: Frame[] = []
  for (let x = from, i = 0; x !== to; i++) {
    x += dir
    out.push({ fx: x, legs: i % 2 ? 'stepA' : 'stepB', look, t: 3 })
  }
  return out
}
C('think_pace', 'Geht nachdenklich auf und ab', 'work_think', {
  loop: true, interruptible: true,
  frames: [
    { armL: 'chin', armR: 'down', look: [-1, 0], eyes: 'open', legs: 'stand', t: 3 },
    ...pace(0, -6, [-1, 0]),
    { legs: 'stand', look: [0, -1], armL: 'chinUp', t: 8 }, { armL: 'chin', look: [-1, -1], t: 6 },
    ...pace(-6, 0, [1, 0]),
    { legs: 'stand', look: [1, -1], armL: 'chinUp', t: 7 }, { armL: 'chin', look: [0, -1], t: 5 }, { eyes: 'closed', t: 2 }, { eyes: 'open', look: [-1, -1], t: 5 },
    { armL: 'down', look: [0, 0], t: 1 },
  ],
})

// Lange nach oben schauen: die Arme hängen ruhig, die Pupillen kreisen langsam (oben links, oben, oben rechts, oben), er blinzelt, am Ende einer Schleife blitzt kurz ein
// kleines Ausrufezeichen auf (Effekt neben dem Kopf, fällt zum Punkt zusammen).
const lu = (x: number, t: number, extra: Frame = {}): Frame => ({ look: [x, -1], t, ...extra })
C('think_look_up', 'Schaut nachdenklich nach oben', 'work_think', {
  loop: true, interruptible: true,
  frames: [
    lu(-1, 8, { armL: 'down', armR: 'down', eyes: 'open', props: [] }), lu(0, 6), lu(1, 8), lu(0, 6), lu(-1, 7, { eyes: 'closed' }), lu(-1, 6, { eyes: 'open' }), lu(0, 6),
    lu(1, 8), lu(0, 5, { eyes: 'half' }), lu(-1, 6, { eyes: 'open' }), lu(0, 7), lu(1, 6, { eyes: 'closed' }), lu(1, 6, { eyes: 'open' }), lu(0, 8),
    // Idee, selten und kurz
    lu(0, 2, { eyes: 'wide', props: [gp('work_ex', 16, -3)] }), lu(0, 3, { props: [gp('work_td2', 16, 0)] }), lu(0, 2, { props: [gp('work_td1', 16, 1)] }),
    { look: [0, 0], eyes: 'open', props: [], t: 1 },
  ],
})

// Mit dem Fuß tippen: die Arme sind verschränkt, der Fuß tippt langsam im Takt, der Blick wandert nach oben, ein Blinzeln, ein Nicken.
const ft = (leg: string, t: number, extra: Frame = {}): Frame => ({ legs: leg, armL: 'cross', armR: 'cross', t, ...extra })
C('think_tap_foot', 'Tippt grübelnd mit dem Fuß', 'work_think', {
  loop: true, interruptible: true,
  frames: [
    ft('stand', 3, { look: [-1, -1], eyes: 'open' }), ft('tapR', 3), ft('stand', 3), ft('tapR', 3), ft('stand', 3), ft('tapR', 3), ft('stand', 4, { look: [0, -1] }),
    ft('tapR', 3), ft('stand', 3), ft('tapR', 3), ft('stand', 3, { look: [1, -1] }), ft('tapR', 3), ft('stand', 3), ft('tapR', 3, { eyes: 'closed' }), ft('stand', 4, { eyes: 'open' }),
    ft('tapR', 3, { by: 1 }), ft('stand', 3, { by: 0 }), ft('tapR', 3), ft('stand', 3, { look: [-1, -1] }), ft('tapR', 3), ft('stand', 4),
    { legs: 'stand', armL: 'down', armR: 'down', look: [0, 0], t: 1 },
  ],
})

// ---------------------------------------------------------------------------------------------------------------------
// Git (Stimmung work_git) und Tests (Stimmung work_test)

// Commit-Graph (git graph): ein Fenster steigt von unten auf, darin wächst ein kleiner Graph: grüne Commit-Punkte auf der Hauptlinie, ein gelber Seitenzweig, der abzweigt
// und wieder zurückläuft (Merge, der Punkt blitzt auf). Er schaut zu und nickt bei jedem neuen Punkt. Dann beginnt der Graph von vorn.
const GGX = 19
const GGSIZE = [18, 9] as const
const gg = (n: number, t: number, extra: Frame = {}): Frame => ({ props: [ref(ggName(n), GGX, 1)], t, ...extra })
C('git_graph', 'Schaut dem Commit-Graph zu', 'work_git', {
  loop: true, interruptible: true,
  intro: riseIn({ name: ggName(0), size: GGSIZE, at: [GGX, 1], step: 2, during: { look: [1, 0] } }),
  frames: [
    gg(0, 5, { look: [1, 0], eyes: 'open', by: 0 }),
    gg(1, 1, { by: 1 }), gg(1, 5, { by: 0 }), gg(2, 1, { by: 1 }), gg(2, 5, { by: 0 }),
    gg(3, 6, { eyes: 'closed' }), gg(3, 1, { eyes: 'open' }),
    gg(4, 1, { by: 1 }), gg(4, 5, { by: 0 }), gg(5, 1, { by: 1 }), gg(5, 5, { by: 0 }), gg(6, 6),
    gg(7, 2, { by: 1, look: [1, -1] }), gg(7, 7, { by: 0, look: [1, 0] }),
  ],
  outro: [
    ...sinkOut({ name: ggName(7), size: GGSIZE, at: [GGX, 1], step: 2, during: { look: [1, 0], by: 0, eyes: 'open' } }),
    { look: [0, 0], t: 2 },
  ],
})

// Klemmbrett-Liste (Tests): ein Klemmbrett mit Liste kommt aus der Tasche und steht rechts neben ihm. Die Zeilen werden nacheinander mit grünen Häkchen abgehakt, er
// nickt bei jedem. Bei der zweiten Liste erscheint selten ein rotes X, er runzelt kurz die Stirn. Dann wird die Liste geleert und es geht von vorn los.
const CLIPP = { name: 'work_cb0', size: [12, 10] as const, at: [17, 0] as const, side: 'R' as const, grip: 5 }
const cb = (n: number, t: number, extra: Frame = {}): Frame => ({ props: [ref(`work_cb${n}`, 17, 0)], t, ...extra })
C('test_checklist', 'Hakt eine Liste ab', 'work_test', {
  loop: true, interruptible: true,
  intro: fetchIn(CLIPP),
  frames: [
    cb(0, 5, { look: [1, 0], eyes: 'open', mouth: null, by: 0 }),
    cb(1, 1, { by: 1 }), cb(1, 5, { by: 0 }), cb(2, 1, { by: 1 }), cb(2, 5, { by: 0 }), cb(3, 1, { by: 1 }), cb(3, 6, { by: 0, look: [1, -1] }),
    cb(0, 5, { look: [1, 0] }),
    cb(1, 1, { by: 1 }), cb(1, 5, { by: 0 }),
    // das rote X: Stirnrunzeln (halbe Augen, flacher Mund), er sackt etwas
    cb(4, 3, { eyes: 'wide', look: [1, 0] }), cb(4, 6, { eyes: 'half', mouth: 'flat', by: 1 }), cb(4, 3, { by: 0, eyes: 'open', mouth: null }),
    cb(0, 4, { look: [1, 0] }),
  ],
  outro: fetchOut(CLIPP),
})

// Speichern (git save): eine Diskette (klassisches Speichern-Symbol) kommt aus der Tasche und steht rechts neben ihm. Er nimmt sie, hält sie hoch, ein grünes Häkchen blitzt daneben
// auf (gespeichert), er stellt sie ab, packt sie zurück in die Tasche und holt die nächste Runde.
const FL = { name: 'work_fl0', size: [6, 6] as const, at: [17, 4] as const, side: 'R' as const, grip: 2 }
const fd = (y: number, extra: Frame = {}, fxs: PropRef[] = []): Frame => ({ ...blkR(3, y + 2), props: [ref('work_fl0', 17, y), ...fxs], t: 1, ...extra })
const okAt = (c: number): PropRef => ref(`work_ok${c}`, 18, -3)
C('git_save', 'Speichert eine Diskette', 'work_git', {
  loop: true, interruptible: true,
  intro: fetchIn(FL),
  frames: [
    fd(4, { look: [1, 1], eyes: 'open', t: 2 }), fd(3), fd(2), fd(1, { look: [1, -1], t: 4 }),
    // gespeichert: das Häkchen blitzt grün und weiß auf, er freut sich
    fd(1, { eyes: 'wide', t: 2 }, [okAt(0)]), fd(1, { t: 1 }, [okAt(1)]), fd(1, { t: 2 }, [okAt(0)]), fd(1, { t: 1 }, [okAt(1)]), fd(1, { eyes: 'open', t: 3 }, [okAt(0)]),
    fd(1, { by: 1, t: 2 }), fd(1, { by: 0, t: 2 }),
    // abstellen, in die Tasche, nächste Diskette
    fd(2), fd(3), fd(4, { t: 2 }),
    ...fetchOut(FL),
    ...fetchIn(FL),
  ],
  outro: fetchOut(FL),
})

// Hochladen (git push): eine kleine Wolke erscheint über ihm und wird groß. Er schiebt mit der Blockhand einen hellblauen Pfeil nach oben, der in die Wolke steigt; die Wolke
// blinkt grün (angekommen). Das wiederholt sich, dann schrumpft die Wolke und löst sich auf.
const CLX = 13
const cld = (n: number, t: number, extra: Frame = {}, fxs: PropRef[] = []): Frame => ({ props: [ref(`work_cl${n}`, n === 0 ? 15 : CLX, n === 0 ? -2 : -3), ...fxs], t, ...extra })
const arrow = (y: number, extra: Frame = {}): Frame => cld(1, 1, { ...blkR(3, 4), ...extra }, [ref('work_up', 17, y)])
const pushArrow = (): Frame[] => [
  arrow(3, { look: [1, -1], eyes: 'open' }), arrow(2), arrow(1), arrow(0),
  cld(2, 2, { ...blkR(3, 5), eyes: 'wide' }), cld(1, 1, { armR: 'down' }), cld(2, 2, { eyes: 'open' }), cld(1, 2),
]
C('git_push', 'Schiebt nach oben in die Wolke', 'work_git', {
  loop: true, interruptible: true,
  frames: [
    { props: [], armR: 'down', look: [0, -1], eyes: 'open', t: 3 },
    cld(0, 2, { look: [1, -1] }), cld(1, 3),
    ...pushArrow(), cld(1, 3), ...pushArrow(), cld(1, 3, { eyes: 'closed' }),
    cld(1, 2, { eyes: 'open' }), cld(0, 2), { props: [], look: [0, 0], t: 2 },
  ],
})

// Reagenzglas (Tests): ein Glas mit blauer Probe kommt aus der Tasche, er hebt es, schüttelt es (Bläschen steigen auf). Meist wird die Flüssigkeit grün und es funkelt
// (bestanden); in jeder dritten Runde wird sie rot, ein Rauchwölkchen steigt auf und er runzelt die Stirn (fehlgeschlagen). Dann geht das Glas zurück in die Tasche, die nächste Probe kommt.
const TB = { name: tbName(0), size: [4, 7] as const, at: [17, 3] as const, side: 'R' as const, grip: 4 }
const th = (n: number, x: number, y: number, extra: Frame = {}, fxs: PropRef[] = []): Frame => ({
  ...blkR(Math.max(2, Math.min(4, x - 14)), y + 4), props: [ref(tbName(n), x, y), ...fxs], t: 1, ...extra,
})
const tubeRound = (fail: boolean): Frame[] => {
  const end = fail ? 8 : 4
  return [
    th(0, 17, 3, { look: [1, 1], eyes: 'open', t: 2 }), th(0, 17, 2), th(0, 17, 1, { look: [1, 0], t: 2 }),
    // schütteln: das Glas ruckt hin und her, Bläschen steigen
    ...Array.from({ length: 10 }, (_, i) => th(1 + (i % 3), i % 2 ? 18 : 17, i % 2 ? 2 : 1)),
    th(0, 17, 1, { eyes: 'wide', t: 3 }),
    ...(fail
      ? [
        th(end, 17, 1, { eyes: 'half', mouth: 'flat', by: 1, t: 2 }, [ref('puff', 17, -1)]), th(end, 17, 1, { t: 2 }, [ref('puff', 17, -2)]),
        th(end, 17, 1, { by: 0, t: 3 }),
      ]
      : [
        th(end, 17, 1, { eyes: 'open', mouth: 'smile', t: 2 }, [ref('work_sp3', 21, 2)]), th(end, 17, 1, { t: 2 }, [ref('work_sp5', 21, 0)]),
        th(end, 17, 1, { t: 2 }, [ref('work_sp3', 22, 3)]), th(end, 17, 1, { t: 2 }),
      ]),
    th(end, 17, 1, { mouth: null, by: 0, eyes: 'open' }), th(end, 17, 2), th(end, 17, 3, { t: 2 }),
    ...fetchOut({ ...TB, name: tbName(end) }),
    ...fetchIn(TB),
  ]
}
C('test_tube', 'Schüttelt ein Reagenzglas', 'work_test', {
  loop: true, interruptible: true,
  intro: fetchIn(TB),
  frames: [...tubeRound(false), ...tubeRound(false), ...tubeRound(true)],
  outro: fetchOut(TB),
})

export const CLIPS: readonly ClipDef[] = out
