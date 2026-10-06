// clawd-buddy: Basis-Requisiten (reine Daten). Weitere Requisiten liefern die Clip-Gruppen unter hooks/clips/.
// Palettenzeichen siehe stage.ts → PAL. '.' ist durchsichtig. `effect`: kleiner Effekt, der aus der Figur entsteht
// (Funkeln, Note, Herz, Schweiß …); alles andere muss im Bild herein- und hinausgeführt werden (siehe macros.ts).
import type { PropSprite } from './stage.ts'

const s = (rows: readonly string[]): PropSprite => ({ rows })
const fx = (rows: readonly string[]): PropSprite => ({ rows, effect: true })

export const BASE_PROPS: Readonly<Record<string, PropSprite>> = {
  laptop: s(['DDDDDDD', 'DGGGGGD', 'DGGWGGD', 'DDDDDDD']),
  magnifier: s(['.WWW..', 'W...W.', 'W...W.', '.WWW..', '....R.', '.....R']),
  paper: s(['WWWWW', 'WGGGW', 'WWWWW', 'WGGWW', 'WWWWW']),
  paper2: s(['WWWWW', 'WGGWW', 'WWWWW', 'WGGGW', 'WWWWW']),
  book: s(['WWWKWWW', 'WGWKWGW', 'WWWKWWW', '.DDDDD.']),
  bookFlip: s(['WWWKW..', 'WGWKWWW', 'WWWKWGW', '.DDDDD.']),
  console: s(['DDDDD', 'DYDBD', 'DDDDD', 'DGDGD', 'DDDDD']),
  console2: s(['DDDDD', 'DBDYD', 'DDDDD', 'DGDED', 'DDDDD']),
  screen: s(['DDDDDD', 'DEEDDD', 'DDEEED', 'DEDDDD', 'DDDDDD']),
  screen2: s(['DDDDDD', 'DDEEED', 'DEDDDD', 'DEEEDD', 'DDDDDD']),
  globe: s(['.BBB.', 'BEBEB', 'BBBBB', 'BEBEB', '.BBB.']),
  globe2: s(['.BBB.', 'EBEBB', 'BBBBB', 'EBEBB', '.BBB.']),
  cup: s(['WWWW.', 'WRRWW', 'WRRW.', 'WWWW.']),
  helper: s(['.OOO.', 'OKOKO', '.OOO.', '.O.O.']),
  helperHi: s(['OOOO.', 'OKOKO', '.OOO.', '.O.O.']),
  antenna: s(['.Y.', '.K.', '.K.', '.K.']),
  waveL: fx(['.W', 'W.', '.W']),
  waveR: fx(['W.', '.W', 'W.']),
  note: fx(['.YY', '.Y.', 'YY.', 'YY.']),
  sparkle: fx(['.Y.', 'YYY', '.Y.']),
  dotY: fx(['Y']),
  dotW: fx(['W']),
  ballY: s(['Y']),
  ballB: s(['B']),
  ballP: s(['P']),
  fly: s(['WK']),
  pebble: s(['GG']),
  question: fx(['WWW', '..W', '.WW', '...', '.W.']),
  excl: fx(['W', 'W', 'W', '.', 'W']),
  sweat: fx(['.L', 'LL', 'LL']),
  heart: fx(['.P.P.', 'PPPPP', '.PPP.', '..P..']),
  zs: fx(['WWW', '.W.', 'WWW']),
  zb: fx(['WWWW', '..W.', '.W..', 'WWWW']),
  cap: s(['.....NW', '...NNN.', '.NNNNN.']),
  puff: fx(['.WW.', 'WWWW']),
  steam1: fx(['.W', 'W.']),
  steam2: fx(['W.', '.W']),
  blockB: s(['BB']),
  blockY: s(['YY']),
  blockP: s(['PP']),
  blockE: s(['EE']),
  blockW: s(['WW']),
  sun: s(['Y.Y', '.Y.', 'Y.Y']),
}
