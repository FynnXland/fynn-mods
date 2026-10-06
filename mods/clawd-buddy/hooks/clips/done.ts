// clawd-buddy: Clips der Gruppe "done" (Turn fertig, Fehler, Erfolgsserie).
import { clip, rep } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { armBlock, fetchIn, fetchOut } from '../macros.ts'

/** Requisiten, die nur diese Gruppe braucht (Name → Sprite). Namen müssen über alle Gruppen eindeutig sein. */
export const PROPS: Readonly<Record<string, PropSprite>> = {
  // Hand an der Stirn (4×2, Schattenton der Vorderarme): verlängert den seitlich hochgezogenen Blockarm über die Stirn (Zeilen 0 und 1, über den Augen)
  oops_hand: { rows: ['QQQQ', 'QQQQ'], effect: true },
  // Pokal 7×8: goldener Kelch (Mitte drei Spalten in jeder Zeile gefüllt, damit die verkleinerten Fassungen aus der Tasche zusammenhängen), brauner Sockel
  done_trophy: { rows: ['YYYYYYY', 'YWYYYYY', '.YYYYY.', '.YYYYY.', '..YYY..', '..YYY..', '..YYY..', '.RRRRR.'] },
  // Medaille: 0 = liegend mit Band (6×2), 1 = umgehängt (5×6: Bandstränge außen, damit Augen und Mund frei bleiben, goldene Scheibe unten)
  done_medal0: { rows: ['MMMYYY', 'MMMYWY'] },
  done_medal1: { rows: ['M...M', 'M...M', 'M...M', 'MMMMM', '.YYY.', '.YWY.'] },
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Fertig / Fehler
// Funken stehen fest an der Bühne (Flag 'g'), nicht an der springenden Figur, und bleiben unter dem oberen Rand (Sprung höchstens 3).
C('celebrate_jump', 'Freudensprung', 'done', { shapedEyes: true, frames: [
  { by: 1, t: 2 }, { by: 0, fy: -3, legs: 'tuck', armL: 'raise', armR: 'raise', eyes: 'happy', props: [['sparkle', -4, 0, 'g'], ['sparkle', 18, 1, 'g']], t: 3 },
  { fy: -2, props: [['dotY', -3, -2, 'g'], ['dotY', 19, -2, 'g'], ['dotY', 8, -3, 'g']], t: 1 }, { fy: -1, t: 1 },
  { fy: 0, by: 1, legs: 'spread', props: [['dotY', -2, 1, 'g'], ['dotY', 19, 2, 'g']], t: 1 }, { by: 0, legs: 'stand', t: 2 },
  { armL: 'down', armR: 'down', props: [], t: 3 }, { eyes: 'open', t: 2 }] });
C('sparkle_cheer', 'Jubeln mit Funkeln', 'done', { frames: [
  { armL: 'up1', armR: 'up1', eyes: 'happy', t: 2 },
  ...rep(3, [{ armL: 'up2', armR: 'up2', props: [['sparkle', -3, 0], ['dotY', 18, -2]], t: 2 }, { armL: 'raise', armR: 'raise', props: [['dotY', -2, -2], ['sparkle', 17, 0]], t: 2 }]),
  { armL: 'up1', armR: 'up1', props: [], t: 2 }, { armL: 'down', armR: 'down', t: 2 }, { eyes: 'open', t: 2 }] });
C('shrug', 'Schulterzucken', 'oops', { frames: [
  { eyes: 'sad', t: 3 }, { armL: 'up1', armR: 'up1', by: 1, t: 2 }, { armL: 'up2', armR: 'up2', by: 0, mouth: 'flat', t: 6 },
  { armL: 'up1', armR: 'up1', t: 2 }, { armL: 'down', armR: 'down', mouth: null, t: 3 }, { eyes: 'open', t: 2 }] });
C('sweat_drop', 'Schweißtropfen', 'oops', { frames: [
  { eyes: 'wide', props: [['sweat', 15, -1]], t: 3 }, { props: [['sweat', 15, 0]], t: 3 }, { props: [['sweat', 15, 2]], eyes: 'sad', t: 3 },
  { props: [['sweat', 15, 4]], t: 3 }, { props: [], t: 3 }, { eyes: 'open', t: 2 }] });

// ---- Laune-Clips (temper): kommen bei Frust bzw. guter Laune dazu, steigern die Fehler-Reaktion. Bewusst am Ende der Gruppe (der erste Clip bleibt neutral).
// Facepalm: der linke Blockarm geht hoch, die Hand legt sich über die Stirn (über den Augen, die zu sind), der Kopf sinkt, ein Seufzer.
const hand = (x: number): PropRef => ['oops_hand', x, 0]
C('facepalm', 'Facepalm', 'oops', { temper: 'bad', frames: [
  { eyes: 'wide', mouth: 'o', t: 2 },
  { armL: 'up2', eyes: 'closed', mouth: 'flat', t: 1 },
  { armL: 'raise', props: [hand(1)], t: 1 }, { props: [hand(2)], t: 2 },
  { by: 1, props: [hand(2), ['puff', 16, 1]], t: 3 },
  { props: [hand(2), ['puff', 17, 0]], t: 3 },
  { props: [hand(2)], t: 6 },
  { by: 0, armL: 'up2', props: [], t: 2 }, { armL: 'down', eyes: 'half', mouth: null, t: 3 }, { eyes: 'open', t: 2 }] });
// Stampfen: wütende Augen, Fäuste (kurze Arme) hoch, zweimal fest aufstampfen (Körper sackt kurz), dabei steigen Dampfwölkchen vom Kopf.
const fume = (a: number): readonly PropRef[] => [['steam' + (a % 2 ? 2 : 1), 4, -2 - (a % 2)], ['steam' + (a % 2 ? 1 : 2), 10, -3 + (a % 2)]]
C('stomp', 'Stampft vor Wut', 'oops', { temper: 'bad', weight: 0.6, frames: [
  { eyes: 'angry', mouth: 'flat', armL: 'up2', armR: 'up2', t: 2 },
  { legs: 'tapR', props: fume(0), t: 2 }, { legs: 'stand', by: 1, props: fume(1), t: 2 }, { by: 0, props: fume(0), t: 1 },
  { legs: 'tapR', props: fume(1), t: 2 }, { legs: 'stand', by: 1, props: fume(0), t: 2 }, { by: 0, props: fume(1), t: 2 },
  { props: fume(0), t: 2 }, { props: fume(1), t: 2 },
  { armL: 'down', armR: 'down', eyes: 'half', props: [], t: 3 }, { mouth: null, eyes: 'open', t: 2 }] });
// Erleichterung (nach Frust endlich geklappt): großes Ausatmen, er sackt zusammen, wischt sich die Stirn (ein Tropfen), dann ein kleines Lächeln.
C('relief', 'Erleichtert', 'done', { temper: 'bad', frames: [
  { eyes: 'closed', mouth: 'yawnBig', by: 1, props: [['puff', 16, 3]], t: 3 },
  { props: [['puff', 17, 2]], t: 3 }, { props: [['puff', 18, 1]], t: 2 },
  { mouth: 'flat', props: [], t: 3 },
  { armL: 'rubUp', props: [['sweat', 15, 0]], t: 2 }, { armL: 'rub', props: [['sweat', 15, 2]], t: 2 }, { armL: 'rubUp', props: [['sweat', 15, 4]], t: 2 }, { armL: 'down', props: [], t: 2 },
  { by: 0, eyes: 'happy', mouth: 'smile', t: 4 }, { eyes: 'open', mouth: null, t: 2 }] });
// Siegestanz (gute Laune): wechselseitig Arm hoch und Bein vor, kleine Hüpfer, Funken stehen fest neben ihm.
const sp = (a: number): readonly PropRef[] => (a % 2
  ? [['sparkle', -4, 1, 'g'], ['dotY', 19, -1, 'g']]
  : [['dotY', -3, -1, 'g'], ['sparkle', 18, 1, 'g']])
C('victory_dance', 'Siegestanz', 'done', { temper: 'good', frames: [
  { eyes: 'happy', mouth: 'smile', t: 1 },
  ...Array.from({ length: 6 }, (_, i): Frame[] => [
    { legs: i % 2 ? 'kickL' : 'kickR', armL: i % 2 ? 'down' : 'raise', armR: i % 2 ? 'raise' : 'down', fy: -1, props: sp(i), t: 2 },
    { legs: 'stand', fy: 0, t: 1 },
  ]).flat(),
  { armL: 'raise', armR: 'raise', fy: -2, legs: 'tuck', props: sp(7), t: 2 }, { fy: 0, legs: 'stand', armL: 'down', armR: 'down', props: [], t: 2 },
  { eyes: 'open', mouth: null, t: 2 }] });

// ---- Erfolgsserie (streak): einmalig, nicht unterbrechbar, ~4 s ------------------------------------------------------------------------
// Pokal: aus der Tasche, die Blockhand hebt ihn hoch (links neben dem Kopf), Funkeln über ihm, er schaut stolz hinauf, dann wieder herab und eingepackt.
const TROPHY = { name: 'done_trophy', size: [7, 8] as const, at: [-8, 2] as const, side: 'L' as const, grip: 5, rummage: 2 }
const tro = (y: number): PropRef => ['done_trophy', -8, y, 'g']
const troHand = (y: number): Frame => armBlock('L', 4, y + 5)
const spark = (i: number): readonly PropRef[] => (i % 2 ? [['sparkle', 10, -4, 'g'], ['dotY', 17, 3, 'g']] : [['sparkle', 4, -4, 'g'], ['sparkle', 18, 0, 'g']])
C('streak_trophy', 'Pokal (Erfolgsserie)', 'streak', { interruptible: false,
  intro: fetchIn(TROPHY),
  frames: [
    ...[1, 0, -1, -2, -3].map((y): Frame => ({ ...troHand(y), look: [-2, -1], eyes: 'open', mouth: null, props: [tro(y)], t: 1 })),
    ...[0, 1, 0, 1].map((i): Frame => ({ mouth: 'smile', props: [tro(-3), ...spark(i)], t: 3 })),
    ...[-2, -1, 0, 1, 2].map((y): Frame => ({ ...troHand(y), mouth: null, props: [tro(y)], t: 1 })),
    { armL: 'down', props: [tro(2)], t: 2 }],
  outro: fetchOut(TROPHY) });
// Medaille: aus der Tasche, die Blockhand hebt sie über den Kopf, sie wird umgehängt; er reckt stolz die Brust (Fäuste in die Seiten), Funkeln. Dann nimmt er
// sie wieder ab und packt sie ein.
const MEDAL = { name: 'done_medal0', size: [6, 2] as const, at: [-7, 8] as const, side: 'L' as const, grip: 0, rummage: 2 }
const med0 = (x: number, y: number): PropRef => ['done_medal0', x, y, 'g']
const med1 = (x: number, y: number): PropRef => ['done_medal1', x, y, 'g']
const medHand = (x: number, y: number): Frame => armBlock('L', Math.max(2, 2 - (x + 5)), y)
C('streak_medal', 'Medaille (Erfolgsserie)', 'streak', { interruptible: false,
  intro: fetchIn(MEDAL),
  frames: [
    ...[6, 3, 0, -2].map((y): Frame => ({ ...medHand(-7, y), look: [-2, -1], eyes: 'open', mouth: null, props: [med0(-7, y)], t: 1 })),
    ...[-4, -1, 2].map((x): Frame => ({ ...medHand(x, -2), props: [med0(x, -2)], t: 1 })),
    // umhängen
    { armL: 'raise', props: [med1(6, -2)], t: 1 }, { armL: 'down', look: [0, 1], props: [med1(6, 1)], t: 1 }, { props: [med1(6, 3)], t: 2 },
    // stolz: Brust raus, Fäuste in die Seiten, Blick nach oben, Lächeln, Funkeln
    ...[0, 1, 0, 1].map((i): Frame => ({ armL: 'up1', armR: 'up1', look: [0, -1], mouth: 'smile', props: [med1(6, 3), ...spark(i)], t: 3 })),
    // abnehmen
    { armL: 'raise', armR: 'down', mouth: null, props: [med1(6, 1)], t: 1 }, { props: [med1(6, -2)], t: 1 },
    ...[2, -1, -4].map((x): Frame => ({ ...medHand(x, -2), look: [-2, 0], props: [med0(x, -2)], t: 1 })),
    ...[-7, ...[-7, -7, -7, -7]].slice(0, 5).map((x, i): Frame => ({ ...medHand(x, [-2, 0, 3, 6, 8][i]), look: [-2, 1], props: [med0(x, [-2, 0, 3, 6, 8][i])], t: 1 }))],
  outro: fetchOut(MEDAL) });

export const CLIPS: readonly ClipDef[] = out
