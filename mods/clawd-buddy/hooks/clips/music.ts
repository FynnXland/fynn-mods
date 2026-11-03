// clawd-buddy: Clips der Gruppe "music" (0.9.0, Fynn 2026-11-03: „Mitwippen zur Musik“). Sie kommen nur in die Auswahl, wenn spotify
// meldet, dass Musik läuft (`spotify.playing`), und Clawd Zeit hat: im Leerlauf, während du tippst und beim langen Warten
// (engine.ts → MUSIC_MOODS). Bei Arbeit bleibt er bei seiner Arbeit.
//
// Einen Takt liefert die Mediensteuerung nicht; er wippt in festem Tempo (BEAT, ~115 Schläge pro Minute), nachts halb so schnell.
// Regeln wie überall: Hände sind Blöcke, nichts taucht auf (die Kopfhörer kommen aus der Tasche wie der Partyhut, Noten entstehen
// an der Figur und vergehen nahe bei ihr), der erste Clip ist der ruhigste (weniger Bewegung nimmt ihn).
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'

/** Ein Schlag in Takten (75 ms): Abschlag 3, Aufschlag 4 ≈ 0,53 s ≈ 115 pro Minute. */
const DOWN = 3
const UP = 4

/**
 * Kopfhörer (15×5): graues Band über dem Kopf, rote Muscheln seitlich am Kopf (x 1–2 und 14–15, über den Augen in x 4 und 12 frei).
 * Sitzen auf dem Kopf bei (1, -2) relativ zur Figur und wippen mit ihr (`by`).
 */
export const PROPS: Readonly<Record<string, PropSprite>> = {
  music_phones: { rows: ['..GGGGGGGGGGG..', '.GG.........GG.', 'MM...........MM', 'MM...........MM', 'MM...........MM'] },
}

const out: ClipDef[] = []
const C = (name: string, label: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, 'music', def))
}

const FULL: Frame = { by: 0, eyes: 'open', look: [0, 0], mouth: null, armL: 'down', armR: 'down', legs: 'stand' }
const PHONES: PropRef = ['music_phones', 1, -2]

/** Noten (wie beim Pfeifen) steigen rechts neben dem Kopf auf und vergehen dort; je Halbschlag ein Schritt. */
const NOTE_PATH: readonly (readonly [number, number])[] = [[18, 2], [19, 0], [19, -2], [19, -4]]
const notesAt = (k: number, births: readonly number[]): PropRef[] =>
  births.flatMap((b): PropRef[] => {
    const p = NOTE_PATH[k - b]
    return p ? [['note', p[0], p[1]]] : []
  })

/**
 * Wippen über `beats` Schläge: Abschlag = Körper einen Pixel tiefer, Fuß tippt; Aufschlag = zurück. `extra(k)` ergänzt je Halbschlag
 * (k = 0 … 2·beats−1) Felder, `props(k)` die Requisiten.
 */
function bob(beats: number, o: { down?: number; up?: number; extra?: (k: number) => Frame; props?: (k: number) => PropRef[] } = {}): Frame[] {
  const f: Frame[] = []
  for (let k = 0; k < beats * 2; k++) {
    const down = k % 2 === 0
    f.push({ by: down ? 1 : 0, legs: down ? 'tapR' : 'stand', ...(o.extra?.(k) ?? {}), props: o.props?.(k) ?? [], t: down ? (o.down ?? DOWN) : (o.up ?? UP) })
  }
  return f
}

// ---- Mitwippen mit Noten (der ruhigste, zuerst): Schultern und Fuß im Takt, Augen mal zu, alle zwei Takte steigt eine Note auf
C('music_bob', 'Wippt zur Musik', { when: 'day', loop: true, interruptible: true, weight: 3, frames: [
  { ...FULL, t: 1 },
  ...bob(8, {
    extra: (k) => ({ eyes: k % 4 === 0 ? 'happy' : 'open', look: [0, 0] }),
    props: (k) => notesAt(k, [0, 8]),
  }),
] })

// ---- Kopfhörer aus der Tasche (wie der Partyhut): kramen, hochziehen, aufsetzen, mit geschlossenen Augen wippen; beim Ende (Pause,
// Arbeit) nimmt er sie ab und packt sie wieder ein (dieselben Bilder rückwärts)
const handL = (o: number, y: number): Frame => ({ armL: { out: o, y, h: 2 } })
const phonesIn: Frame[] = [
  { ...FULL, look: [-2, 1], eyes: 'winkR', ...handL(1, 5), props: [], t: 2 },
  ...[0, 1, 2].map((i): Frame => ({ ...FULL, by: 1, look: [-2, 1], eyes: 'winkR', ...handL(1, i % 2 ? 6 : 5), armR: 'up1', props: [], t: 1 })),
  { ...FULL, eyes: 'wide', look: [-1, -1], ...handL(2, 1), props: [['music_phones@30', -1, -1]], t: 2 },
  { ...FULL, eyes: 'open', look: [-1, -1], ...handL(2, 0), props: [['music_phones@60', -3, -2]], t: 2 },
  { ...FULL, armL: 'raise', props: [['music_phones@80', -5, -3]], t: 2 },
  { ...FULL, armL: 'raise', props: [['music_phones', -4, -4]], t: 1 },
  { ...FULL, armL: 'up2', armR: 'up2', props: [['music_phones', -1, -3]], t: 1 },
  { ...FULL, armL: 'up2', armR: 'up2', props: [PHONES], t: 2 },
  { ...FULL, eyes: 'happy', props: [PHONES], t: 3 },
]
const phonesOut: Frame[] = [...[...phonesIn].reverse().map((x) => ({ ...x })), { ...FULL, props: [], t: 2 }]
C('music_phones', 'Hört Musik mit Kopfhörern', { when: 'day', loop: true, interruptible: true, weight: 2, intro: phonesIn, frames: [
  ...bob(8, {
    // Augen zu im Takt; im fünften Schlag fasst er an die Muschel (Lautstärke)
    extra: (k) => ({ eyes: k % 2 === 0 ? 'closed' : 'happy', armR: k === 8 || k === 9 ? 'up2' : 'down' }),
    props: (k) => [PHONES, ...notesAt(k, [2, 10])],
  }),
], outro: phonesOut })

// ---- Luftgitarre (nur bei guter Laune): breitbeinig, linke Hand am Hals der unsichtbaren Gitarre, rechte schlägt vor dem Bauch an;
// ein schnelles Solo, dann ein Sprung mit hochgerissenen Armen und Funkeln
C('music_airguitar', 'Spielt Luftgitarre', { when: 'day', temper: 'good', interruptible: false, weight: 1.5, frames: [
  { ...FULL, legs: 'spread', ...handL(3, 3), look: [-1, 1], props: [], t: 3 },
  ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((k): Frame[] => [
    { by: 1, legs: 'spread', ...handL(3, 3), armR: 'hold', eyes: 'tight', props: notesAt(k, [0, 4]), t: DOWN },
    { by: 0, armR: 'holdUp', eyes: k % 2 ? 'closed' : 'tight', props: notesAt(k + 1, [0, 4]), t: UP },
  ]),
  // Solo: doppelt so schnell, die Hand am Hals rutscht hoch
  ...[0, 1, 2, 3, 4, 5].flatMap((k): Frame[] => [
    { by: 1, ...handL(4, k % 3), armR: 'hold', eyes: 'tight', props: [], t: 2 },
    { by: 0, armR: 'holdUp', props: [], t: 2 },
  ]),
  { by: 1, legs: 'stand', armL: 'down', armR: 'down', eyes: 'happy', look: [0, 0], props: [], t: 2 },
  { by: 0, fy: -3, legs: 'tuck', armL: 'raise', armR: 'raise', eyes: 'happy', props: [['sparkle', -4, 0, 'g'], ['sparkle', 18, 1, 'g']], t: 3 },
  { fy: -1, legs: 'stand', props: [['sparkle', -4, 1, 'g']], t: 2 },
  { fy: 0, by: 1, armL: 'up1', armR: 'up1', props: [], t: 2 },
  { ...FULL, props: [], t: 3 },
] })

// ---- Nachts: nur langsames Nicken mit halb geschlossenen Augen, halb so schnell, keine Noten (Fynn: „ruhig wippen“)
C('music_nod_night', 'Nickt nachts leise zur Musik', { when: 'night', loop: true, interruptible: true, weight: 3, frames: [
  { ...FULL, eyes: 'half', t: 1 },
  ...bob(4, { down: DOWN * 2, up: UP * 2, extra: (k) => ({ eyes: 'half', look: [0, k % 2 === 0 ? 1 : 0], legs: 'stand' }) }),
] })

export const CLIPS: readonly ClipDef[] = out
