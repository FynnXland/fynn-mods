// clawd-buddy: Clips der Gruppe "music" (0.9.0, Fynn 2026-11-03: „Mitwippen zur Musik“). Sie kommen nur in die Auswahl, wenn tune-strip
// meldet, dass Musik läuft (`tune-strip.playing`), und Clawd Zeit hat: im Leerlauf, während du tippst und beim langen Warten
// (engine.ts → MUSIC_MOODS). Bei Arbeit bleibt er bei seiner Arbeit.
//
// 0.11.0 (Fynn 2026-11-04, SPEC Nachtrag 0.11.0): Im Takt des Songs. tune-strip meldet `tune-strip.beat` (Tempo, Schlag, Gruppe, nur aus
// dem Klang). Die Wipp-Bilder tragen ihre Länge in Schlägen (`bt`); mit sicherem Takt richtet die Engine sie am Schlagraster aus, ohne
// Takt gilt das feste Tempo `t` (~115 pro Minute, nachts halb so schnell) wie bisher. Welche Clips kommen, hängt von der Gruppe ab
// (`music`: ruhig / Groove-Hip-Hop / hart / ohne Takt); Luftgitarre und Headbangen nur bei harten Songs, nie bei schlechter Laune.
// Regeln wie überall: Hände sind Blöcke, nichts taucht auf (die Kopfhörer kommen aus der Tasche wie der Partyhut, Noten entstehen
// an der Figur und vergehen nahe bei ihr), der erste Clip ist der ruhigste (weniger Bewegung nimmt ihn).
// Die Einstiegspose steht im Intro: Ein Hauptteil aus Schlag-Bildern beginnt auf dem Schlag, das Intro hält bis dahin (höchstens ein Schlag).
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { fetchIn, fetchOut } from '../macros.ts'

/** Ein Schlag in Takten (75 ms) ohne Takt aus tune-strip: Abschlag 3, Aufschlag 4 ≈ 0,53 s ≈ 115 pro Minute. */
const DOWN = 3
const UP = 4
/** Ab- und Aufschlag sind je ein halber Schlag. */
const HALF = 0.5

/**
 * Kopfhörer (15×5): graues Band über dem Kopf, rote Muscheln seitlich am Kopf (x 1–2 und 14–15, über den Augen in x 4 und 12 frei).
 * Sitzen auf dem Kopf bei (1, -2) relativ zur Figur und wippen mit ihr (`by`).
 */
export const PROPS: Readonly<Record<string, PropSprite>> = {
  music_phones: { rows: ['..GGGGGGGGGGG..', '.GG.........GG.', 'MM...........MM', 'MM...........MM', 'MM...........MM'] },
  // 0.12.0: Feuerzeug (grau, dunkle Kappe), Flamme in zwei Bildern (Effekt an der Spitze), Träne (Effekt am Auge)
  music_lighter: { rows: ['DD', 'GG', 'GG'] },
  music_flame1: { rows: ['Y.', 'YM'], effect: true },
  music_flame2: { rows: ['.Y', 'MY'], effect: true },
  music_tear: { rows: ['L', 'L'], effect: true },
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
 * (k = 0 … 2·beats−1) Felder, `props(k)` die Requisiten. `per`: Schläge je Ab- bzw. Aufschlag (nachts 1: Nicken auf jedem zweiten Schlag).
 */
function bob(beats: number, o: { down?: number; up?: number; per?: number; extra?: (k: number) => Frame; props?: (k: number) => PropRef[] } = {}): Frame[] {
  const f: Frame[] = []
  for (let k = 0; k < beats * 2; k++) {
    const down = k % 2 === 0
    f.push({
      by: down ? 1 : 0, legs: down ? 'tapR' : 'stand', ...(o.extra?.(k) ?? {}), props: o.props?.(k) ?? [],
      t: down ? (o.down ?? DOWN) : (o.up ?? UP), bt: o.per ?? HALF,
    })
  }
  return f
}

// ---- Mitwippen mit Noten (der ruhigste, zuerst): Schultern und Fuß im Takt, Augen mal zu, alle zwei Takte steigt eine Note auf
C('music_bob', 'Wippt zur Musik', { when: 'day', loop: true, interruptible: true, weight: 3, music: { calm: 3, groove: 2, hard: 1, sad: 0.5, none: 3 },
  intro: [{ ...FULL, t: 1 }],
  frames: bob(8, {
    extra: (k) => ({ eyes: k % 4 === 0 ? 'happy' : 'open', look: [0, 0] }),
    props: (k) => notesAt(k, [0, 8]),
  }),
})

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
C('music_phones', 'Hört Musik mit Kopfhörern', { when: 'day', loop: true, interruptible: true, weight: 2, music: { calm: 3, groove: 2, hard: 0.5, sad: 1, none: 2 },
  intro: phonesIn,
  frames: bob(8, {
    // Augen zu im Takt; im fünften Schlag fasst er an die Muschel (Lautstärke)
    extra: (k) => ({ eyes: k % 2 === 0 ? 'closed' : 'happy', armR: k === 8 || k === 9 ? 'up2' : 'down' }),
    props: (k) => [PHONES, ...notesAt(k, [2, 10])],
  }),
  outro: phonesOut,
})

// ---- Schunkeln (0.11.0, ruhige Songs): auf jedem Schlag rückt der Körper einen Pixel zur Seite, abwechselnd links und rechts, dazwischen
// zurück in die Mitte; halbe und frohe Augen, keine Noten. Die Mitte ist die Ausgangspose: dort darf er aussteigen.
C('music_sway', 'Schunkelt zur Musik', { when: 'day', loop: true, interruptible: true, weight: 2, music: { calm: 3, groove: 0, hard: 0, sad: 1.5, none: 2 },
  intro: [{ ...FULL, eyes: 'half', t: 1 }],
  frames: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k): Frame[] => [
    { fx: k % 2 === 0 ? -1 : 1, eyes: k % 4 < 2 ? 'half' : 'happy', look: [0, 0], armL: k % 2 === 0 ? 'up1' : 'down', armR: k % 2 === 0 ? 'down' : 'up1', props: [], t: DOWN, bt: HALF },
    { fx: 0, eyes: 'half', armL: 'down', armR: 'down', props: [], t: UP, bt: HALF },
  ]),
})

// ---- Vibe (0.11.0, Groove und Hip-Hop): lässiges Kopfnicken nach vorn (Blick nach unten, Körper einen Pixel tiefer), halbe Augen,
// die Schultern versetzt im Wechsel; auf dem vierten und achten Schlag schnippt er mit dem rechten Arm hoch, ein Funke an der Hand
C('music_vibe', 'Nickt lässig im Groove', { when: 'day', loop: true, interruptible: true, weight: 2, music: { calm: 0.5, groove: 4, hard: 0.5, sad: 0, none: 0 },
  intro: [{ ...FULL, eyes: 'half', t: 1 }],
  frames: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k): Frame[] => {
    const snap = k === 3 || k === 7
    return [
      { by: 1, look: [0, 1], eyes: 'half', armL: k % 2 === 0 ? 'up1' : 'down', armR: snap ? 'raise' : k % 2 === 0 ? 'down' : 'up1', props: snap ? [['sparkle', 18, -1]] : [], t: DOWN, bt: HALF },
      { by: 0, look: [0, 0], eyes: 'half', armL: 'down', armR: snap ? 'up2' : 'down', props: [], t: UP, bt: HALF },
    ]
  }),
})

// ---- Luftgitarre (0.11.0: nur bei harten Songs, auch bei neutraler Laune, nie bei schlechter): breitbeinig, linke Hand am Hals der
// unsichtbaren Gitarre, rechte schlägt vor dem Bauch an; ein schnelles Solo (Viertelschläge), dann ein Sprung mit hochgerissenen Armen
C('music_airguitar', 'Spielt Luftgitarre', { when: 'day', interruptible: false, weight: 1.5, music: { calm: 0, groove: 0, hard: 3, sad: 0, none: 0, notBad: true }, frames: [
  { ...FULL, legs: 'spread', ...handL(3, 3), look: [-1, 1], props: [], t: 3 },
  ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((k): Frame[] => [
    { by: 1, legs: 'spread', ...handL(3, 3), armR: 'hold', eyes: 'tight', props: notesAt(k, [0, 4]), t: DOWN, bt: HALF },
    { by: 0, armR: 'holdUp', eyes: k % 2 ? 'closed' : 'tight', props: notesAt(k + 1, [0, 4]), t: UP, bt: HALF },
  ]),
  // Solo: doppelt so schnell, die Hand am Hals rutscht hoch
  ...[0, 1, 2, 3, 4, 5].flatMap((k): Frame[] => [
    { by: 1, ...handL(4, k % 3), armR: 'hold', eyes: 'tight', props: [], t: 2, bt: HALF / 2 },
    { by: 0, armR: 'holdUp', props: [], t: 2, bt: HALF / 2 },
  ]),
  { by: 1, legs: 'stand', armL: 'down', armR: 'down', eyes: 'happy', look: [0, 0], props: [], t: 2 },
  { by: 0, fy: -3, legs: 'tuck', armL: 'raise', armR: 'raise', eyes: 'happy', props: [['sparkle', -4, 0, 'g'], ['sparkle', 18, 1, 'g']], t: 3 },
  { fy: -1, legs: 'stand', props: [['sparkle', -4, 1, 'g']], t: 2 },
  { fy: 0, by: 1, armL: 'up1', armR: 'up1', props: [], t: 2 },
  { ...FULL, props: [], t: 3 },
] })

// ---- Headbangen (0.11.0, nur harte Songs, nie bei schlechter Laune): kurzer Ausbruch über 8 Schläge. Breitbeinig, Arme leicht raus,
// je Schlag ein tiefes Nicken über 2 Pixel (Körper einen Pixel tiefer, dann zusätzlich die Oberkante flacher, zurück, oben; je ein
// Viertelschlag, kein Sprung über 1 Pixel; die Beine bleiben sichtbar), Augen zusammengekniffen. Am Ende ein Sprung mit hochgerissenen
// Armen wie bei der Luftgitarre.
const ARMS_OUT: Frame = { armL: { out: 1, y: 4, h: 2 }, armR: { out: 1, y: 4, h: 2 } }
C('music_headbang', 'Headbangt', { when: 'day', interruptible: false, weight: 1, music: { calm: 0, groove: 0, hard: 2.5, sad: 0, none: 0, notBad: true }, frames: [
  { ...FULL, legs: 'spread', ...ARMS_OUT, eyes: 'half', props: [], t: 3 },
  ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((k): Frame[] => [
    { by: 1, squash: 0, look: [0, 1], eyes: 'tight', t: 1, bt: 0.25 },
    { by: 1, squash: 1, look: [0, 1], eyes: 'closed', props: k % 4 === 3 ? [['sweat', 16, 0]] : [], t: 2, bt: 0.25 },
    { by: 1, squash: 0, look: [0, 0], eyes: 'tight', props: [], t: 2, bt: 0.25 },
    { by: 0, squash: 0, look: [0, 0], eyes: k % 2 ? 'tight' : 'half', t: 2, bt: 0.25 },
  ]),
  { by: 1, squash: 0, legs: 'stand', armL: 'down', armR: 'down', eyes: 'happy', look: [0, 0], props: [], t: 2 },
  { by: 0, fy: -3, legs: 'tuck', armL: 'raise', armR: 'raise', eyes: 'happy', props: [['sparkle', -4, 0, 'g'], ['sparkle', 18, 1, 'g']], t: 3 },
  { fy: -1, legs: 'stand', props: [['sparkle', -4, 1, 'g']], t: 2 },
  { fy: 0, by: 1, armL: 'up1', armR: 'up1', props: [], t: 2 },
  { ...FULL, props: [], t: 3 },
] })

// ---- Traurige Songs (0.12.0, Fynn 2026-11-04: „eigene Animationen“, „mit Träne“). Nur bei der Gruppe `sad`, nur tagsüber.

// Feuerzeug: holt es aus der Tasche (wie die Kopfhörer), hebt den Arm, der Daumen schnippt, eine kleine Flamme flackert über ihm (Effekt an
// der Spitze); er schwenkt es langsam, Körper und Feuerzeug je Schlag einen Pixel zur Seite, Augen halb und zu. Am Ende geht die Flamme aus
// (ein Wölkchen), er senkt den Arm und packt das Feuerzeug wieder ein.
const LIGHTER = { name: 'music_lighter', size: [2, 3] as const, at: [-2, 3] as const, side: 'L' as const, grip: 1, lift: 1, rummage: 3 }
const UP_L: PropRef = ['music_lighter', 0, -2] // in der hochgehaltenen Hand (Arm `raise`, die Hand deckt den Fuß)
const flame = (k: number): PropRef => [k % 2 ? 'music_flame2' : 'music_flame1', 0, -4]
const lighterUp: Frame[] = [
  { ...FULL, ...handL(3, 3), props: [['music_lighter', -2, 2, 'g']], t: 2 },
  { ...FULL, ...handL(2, 1), props: [['music_lighter', -1, 0]], t: 1 },
  { ...FULL, armL: 'raise', look: [-1, -1], props: [UP_L], t: 2 },
  { ...FULL, armL: 'raise', look: [-1, -1], props: [UP_L, ['sparkle', -3, -4]], t: 1 }, // Daumen schnippt
  { ...FULL, armL: 'raise', look: [0, 0], eyes: 'half', props: [UP_L, flame(0)], t: 2 },
]
const lighterDown: Frame[] = [
  { ...FULL, armL: 'raise', eyes: 'half', props: [UP_L, ['puff', -2, -4]], t: 2 }, // Flamme aus: ein Wölkchen an der Spitze
  { ...FULL, armL: 'raise', props: [UP_L], t: 1 },
  { ...FULL, ...handL(2, 1), props: [['music_lighter', -1, 0]], t: 1 },
  { ...FULL, ...handL(3, 3), props: [['music_lighter', -2, 2, 'g']], t: 1 },
  { ...FULL, ...handL(3, 3), props: [['music_lighter', LIGHTER.at[0], LIGHTER.at[1], 'g']], t: 1 },
  ...fetchOut(LIGHTER),
]
C('music_lighter', 'Schwenkt ein Feuerzeug', { when: 'day', loop: true, interruptible: true, weight: 1, mirror: true,
  music: { calm: 0, groove: 0, hard: 0, sad: 3, none: 0 },
  intro: [...fetchIn(LIGHTER), ...lighterUp],
  frames: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k): Frame[] => [
    { fx: k % 2 ? 1 : -1, armL: 'raise', eyes: k % 4 < 2 ? 'half' : 'closed', look: [0, 0], props: [UP_L, flame(k * 2)], t: DOWN, bt: HALF },
    { fx: 0, armL: 'raise', props: [UP_L, flame(k * 2 + 1)], t: UP, bt: HALF },
  ]),
  outro: lighterDown,
})

// Kinn auf der Hand: setzt sich, stützt das Kinn auf die rechte Hand, schaut nach unten und wiegt den Kopf langsam (Blick je zwei Schläge);
// alle acht Schläge ein Seufzer (Mund kurz rund, die freie Schulter hebt sich). Einmal je Durchgang entsteht unter dem linken Auge eine kleine
// Träne, läuft zwei Pixel herab und vergeht (Fynn: „mit Träne“).
const TEAR = (dy: number): PropRef => ['music_tear', 4, 4 + dy]
C('music_chin', 'Stützt traurig das Kinn auf', { from: 'sit', when: 'day', loop: true, interruptible: true, weight: 1,
  music: { calm: 0, groove: 0, hard: 0, sad: 3, none: 0 },
  intro: [{ eyes: 'half', look: [0, 1], armR: 'chin', t: 3 }],
  frames: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k): Frame[] => {
    const sigh = k === 3
    const tear = k >= 5 && k <= 7 ? [TEAR(k - 5)] : []
    return [
      { eyes: 'half', look: [k % 2 ? 1 : -1, 1], armR: 'chin', armL: sigh ? 'up1' : 'down', mouth: sigh ? 'o' : null, props: tear, t: DOWN * 2, bt: 1 },
      { eyes: k % 2 ? 'closed' : 'half', armL: 'down', mouth: null, props: tear, t: UP * 2, bt: 1 },
    ]
  }),
  outro: [{ eyes: 'open', look: [0, 0], armR: 'down', props: [], t: 2 }],
})

// Umarmen: verschränkt die Arme vor der Brust, als würde er sich selbst halten, Augen zu, und wiegt sich je zwei Schläge einen Pixel nach
// links und nach rechts (dazwischen die Mitte, dort darf er aussteigen)
C('music_hug', 'Wiegt sich mit verschränkten Armen', { when: 'day', loop: true, interruptible: true, weight: 1,
  music: { calm: 0, groove: 0, hard: 0, sad: 2, none: 0 },
  intro: [{ ...FULL, armL: 'cross', armR: 'cross', eyes: 'half', t: 2 }],
  frames: [-1, 0, 1, 0].flatMap((dx, k): Frame[] => [
    { fx: dx, armL: 'cross', armR: 'cross', eyes: 'closed', look: [0, 0], t: DOWN * 2, bt: 1 },
    { fx: dx, eyes: k % 2 ? 'half' : 'closed', t: UP * 2, bt: 1 },
  ]),
  outro: [{ ...FULL, t: 2 }],
})

// ---- Nachts: nur langsames Nicken mit halb geschlossenen Augen, halb so schnell, keine Noten (Fynn: „ruhig wippen“); mit Takt auf
// jedem zweiten Schlag des Songs (Ab- und Aufschlag je ein Schlag), Gruppe egal
C('music_nod_night', 'Nickt nachts leise zur Musik', { when: 'night', loop: true, interruptible: true, weight: 3,
  intro: [{ ...FULL, eyes: 'half', t: 1 }],
  frames: bob(4, { down: DOWN * 2, up: UP * 2, per: 1, extra: (k) => ({ eyes: 'half', look: [0, k % 2 === 0 ? 1 : 0], legs: 'stand' }) }),
})

export const CLIPS: readonly ClipDef[] = out
