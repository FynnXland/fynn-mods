// clawd-buddy: Clips der Gruppe "mouse" (Reaktionen auf Klicken und Ziehen im Terminal).
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'

/** Requisiten, die nur diese Gruppe braucht (Name → Sprite). Namen müssen über alle Gruppen eindeutig sein. */
export const PROPS: Readonly<Record<string, PropSprite>> = {}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Maus
C('giggle', 'Kichern', 'mouse', { frames: [
  { eyes: 'happy', mouth: 'smile', by: 1, t: 1 }, { by: 0, t: 1 }, { by: 1, t: 1 }, { by: 0, t: 1 }, { by: 1, t: 1 }, { by: 0, t: 2 },
  { mouth: null, t: 2 }, { eyes: 'open', t: 2 }] });
C('boop', 'Boop', 'mouse', { frames: [
  { eyes: 'tight', by: 1, props: [['heart', 16, -2]], t: 2 }, { by: 0, props: [['heart', 16, -3]], t: 3 }, { props: [['heart', 17, -4]], t: 2 },
  { props: [], eyes: 'happy', t: 3 }, { eyes: 'open', t: 2 }] });
C('blush', 'Rot werden', 'mouse', { frames: [
  { blush: true, eyes: 'happy', t: 3 }, { fx: -1, t: 3 }, { fx: 0, t: 3 }, { fx: 1, t: 3 }, { fx: 0, t: 3 }, { blush: false, eyes: 'open', t: 2 }] });
C('grumpy', 'Genervt', 'mouse', { frames: [
  { eyes: 'angry', armL: 'cross', armR: 'cross', mouth: 'flat', props: [['puff', 16, 0]], t: 4 }, { props: [['puff', 17, -1]], t: 3 },
  { props: [], t: 6 }, { look: [1, 0], t: 5 }, { look: [0, 0], t: 3 }, { armL: 'down', armR: 'down', mouth: null, eyes: 'open', t: 3 }] });
// Beleidigt, von vorn: Blick zur Seite, Schmollmund (solange die Arme noch unten sind, sieht man ihn), dann verschränkt er die Arme und
// pustet ein "hmpf"-Wölkchen aus (Effekt neben dem Kopf). Das Wegdrehen kommt später.
const hmpf = (i: number): PropRef => ['puff', 16 + i, 2 - i]
C('sulk', 'Beleidigt', 'mouse', { frames: [
  { eyes: 'half', look: [1, 0], mouth: 'flat', t: 3 },
  { mouth: 'o', by: 1, t: 2 }, { by: 0, t: 2 },
  { armL: 'cross', armR: 'cross', t: 3 },
  { props: [hmpf(0)], by: 1, t: 3 }, { props: [hmpf(1)], by: 0, t: 3 }, { props: [hmpf(2)], t: 2 }, { props: [], t: 5 },
  { props: [hmpf(0)], by: 1, t: 3 }, { props: [hmpf(1)], by: 0, t: 3 }, { props: [hmpf(2)], t: 2 }, { props: [], t: 6 },
  { armL: 'down', armR: 'down', mouth: null, eyes: 'open', look: [0, 0], t: 3 }] });
C('held_wiggle', 'Hochgehoben (zappelt)', 'mouse', { from: 'held', loop: true, frames: [{ legs: 'stepA', t: 2 }, { legs: 'stepB', t: 2 }] });
// Schwindelig: Spiralaugen (dizzy), zwei Sternchen kreisen über dem Kopf (gegenläufig, nie übereinander), der Körper schwankt um 1 Pixel;
// dann schüttelt er den Kopf (Augen zu) und ist wieder klar.
const orbit = (k: number): PropRef[] =>
  [0, 4].map((o): PropRef => {
    const th = ((k + o) * Math.PI) / 4 + Math.PI / 8 // Versatz, damit beide nie genau übereinander stehen
    return ['sparkle', 7 + Math.round(6 * Math.cos(th)), -3 + Math.round(Math.sin(th))]
  })
const sway = [-1, 0, 1, 0]
C('dizzy', 'Schwindelig', 'mouse', { shapedEyes: true, frames: [
  ...Array.from({ length: 24 }, (_, k): Frame => ({ eyes: 'dizzy', mouth: k % 8 < 4 ? 'flat' : 'o', fx: sway[k % 4], props: orbit(k), t: 1 })),
  // schüttelt den Kopf, die Sternchen sind weg
  { eyes: 'closed', mouth: null, fx: -1, props: [], t: 1 }, { fx: 1, t: 1 }, { fx: -1, t: 1 }, { fx: 1, t: 1 }, { fx: 0, t: 2 },
  { eyes: 'half', t: 3 }, { eyes: 'open', t: 2 }] });

export const CLIPS: readonly ClipDef[] = out
