// clawd-buddy: Hinweis-Clips am Turn-Ende (Fynn, 2026-10-06: kleine Animationen, die den Arbeitsablauf erleichtern).
//
// ctx_full:  Das Kontextfenster wird voll (70 bzw. 85 %, mood.ts → CTX_WARN): Zeit für `/compact` oder einen neuen Chat. Bildsprache wie
//            beim Komprimieren (clips/extra.ts): Papier ist der Gesprächsverlauf. Er zeigt einmal, dass es nicht mehr hineinpasst.
// done_long: Ein langer Turn (ab 5 min, mood.ts → LONG_TURN_MS) ist fertig: ein deutlicheres „Puh, geschafft“, damit man beim
//            Zurückkommen sieht, dass die große Aufgabe durch ist.
// Alle laufen einmal ganz durch (nicht unterbrechbar) und räumen ihre Gegenstände selbst wieder weg.
import { clip, rep } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropRef, PropSprite } from '../stage.ts'
import { armBlock, fetchIn, fetchOut, riseIn, sinkOut } from '../macros.ts'

/**
 * Zielflagge 6×9 (eine Familie): schwarz-weiß kariertes Tuch links, brauner Stab rechts (an ihm hält die Hand).
 * 0 = Tuch glatt, 1 = Tuch flattert (die Karos versetzt, die äußere Ecke hängt eine Zeile tiefer).
 */
const FLAG: readonly (readonly string[])[] = [
  ['KWKWKR', 'WKWKWR', 'KWKWKR', '.....R', '.....R', '.....R', '.....R', '.....R', '.....R'],
  ['.KWKWR', 'KWKWKR', 'WKWKWR', 'K....R', '.....R', '.....R', '.....R', '.....R', '.....R'],
]

/** Requisiten, die nur diese Gruppe braucht. Der Karton und das Papier gehören dem Komprimieren (clips/extra.ts: cmp_box…, cmp_st…). */
export const PROPS: Readonly<Record<string, PropSprite>> = {
  hint_flag0: { rows: FLAG[0] },
  hint_flag1: { rows: FLAG[1] },
}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}
const g = (name: string, x: number, y: number): PropRef => [name, x, y, 'g']

// ---- Kontext fast voll ---------------------------------------------------------------------------------------------------------
// Karton quillt über: Er stellt den Papierkarton neben sich (schon zwei Knäuel darin) und wirft ein drittes hinein, jetzt quillt er
// über. Zweimal drückt er den Haufen mit der Hand nieder, beide Male federt er wieder hoch. Er schaut zu dir, ein Schweißtropfen, ein
// Schulterzucken („passt nicht mehr“), dann packt er den Karton wieder ein.
const BX = -10
const BOX = { size: [10, 9] as const, at: [BX, 1] as const, side: 'L' as const, grip: 3 }
const box = (n: number): PropRef => g(`cmp_box${n}`, BX, 1)
/** Hand drückt oben auf den Haufen; `n` = Kartonbild (4 = niedergedrückt, 3 = quillt über). */
const pressBox = (n: number, by: number, t: number): Frame => ({ ...armBlock('L', 3, n === 4 ? 4 : 2), by, props: [box(n)], t })
C('ctx_box', 'Karton quillt über (Kontext fast voll)', 'ctx_full', {
  intro: fetchIn({ ...BOX, name: 'cmp_box2' }),
  frames: [
    { look: [-2, 1], eyes: 'open', mouth: null, props: [box(2)], t: 3 },
    // ein Knäuel aus der Hand (Effekt an der Figur) fällt hinein, der Haufen quillt über
    { armL: 'raise', look: [-2, -1], props: [box(2), ['cmp_pp2', -1, -2]], t: 3 },
    { ...armBlock('L', 4, 0), props: [box(2), g('cmp_pp2', -6, -2)], t: 1 },
    { props: [box(2), g('cmp_pp2', -6, 0)], t: 1 },
    { armL: 'down', look: [-2, 1], props: [box(3)], t: 3 },
    { eyes: 'wide', t: 3 },
    // zweimal niederdrücken, der Haufen federt zurück
    ...rep(2, [pressBox(3, 0, 2), pressBox(4, 1, 3), pressBox(3, 0, 2), { armL: 'down', eyes: 'wide', props: [box(3)], t: 3 }]),
    // zu dir: Schweißtropfen, Schulterzucken
    { look: [2, 0], props: [box(3), ['sweat', 15, -1]], t: 3 }, { props: [box(3), ['sweat', 15, 1]], t: 3 }, { eyes: 'half', props: [box(3), ['sweat', 15, 3]], t: 2 },
    { armL: 'up2', armR: 'up2', by: 1, props: [box(3)], t: 2 }, { by: 0, t: 5 }, { armL: 'down', armR: 'down', eyes: 'open', t: 3 },
  ],
  outro: fetchOut({ ...BOX, name: 'cmp_box3' }) });

// Wackelnder Stapel: Rechts neben ihm steigt ein hoher, lockerer Papierstapel aus der Eingabebox (der Verlauf). Er schaut hinauf, der
// Stapel schwankt, er stützt ihn mit der Hand, bis er still steht, wischt sich die Stirn und lässt ihn wieder in die Eingabe sinken.
const SX = 18
const STACK = { name: 'cmp_st0', size: [8, 8] as const, at: [SX, 2] as const, during: { look: [1, 0] as const } }
const st = (dx = 0): PropRef => g('cmp_st0', SX + dx, 2)
const prop = (dx: number): Frame => ({ ...armBlock('R', 4, 1), props: [st(dx)], t: 2 })
C('ctx_stack', 'Wackelnder Papierstapel (Kontext fast voll)', 'ctx_full', { mirror: false,
  intro: [...riseIn(STACK), { look: [1, -1], eyes: 'open', mouth: null, t: 3 }],
  frames: [
    // der Stapel schwankt, er reißt die Augen auf
    { eyes: 'wide', props: [st(1)], t: 2 }, { props: [st(0)], t: 2 }, { props: [st(-1)], t: 2 }, { props: [st(1)], t: 2 },
    // stützt ihn mit der Hand, das Schwanken wird kleiner
    prop(0), prop(1), prop(0), { ...armBlock('R', 4, 1), props: [st(0)], t: 4 },
    { armR: 'down', eyes: 'open', look: [1, 0], t: 3 },
    // wischt sich die Stirn (Tropfen), schaut zu dir
    { armL: 'rubUp', look: [0, 0], props: [st(0), ['sweat', 1, 0]], t: 2 }, { armL: 'rub', props: [st(0), ['sweat', 1, 2]], t: 2 },
    { armL: 'rubUp', props: [st(0), ['sweat', 1, 4]], t: 2 }, { armL: 'down', props: [st(0)], t: 2 },
    { look: [1, 1], eyes: 'half', t: 6 }, { eyes: 'open', t: 2 },
  ],
  outro: [...sinkOut(STACK), { look: [0, 0], t: 2 }] });

// ---- Langer Turn geschafft -------------------------------------------------------------------------------------------------------
// Puh: Er reckt sich lang (Arme hoch, auf die Zehen, Augen zu), atmet tief aus (Wölkchen), wischt sich die Stirn und strahlt.
C('long_phew', 'Puh, geschafft (langer Turn)', 'done_long', { shapedEyes: true, frames: [
  { eyes: 'closed', armL: 'up2', armR: 'up2', t: 2 },
  { armL: 'raise', armR: 'raise', fy: -1, legs: 'tuck', t: 6 },
  { armL: 'up2', armR: 'up2', fy: 0, legs: 'stand', t: 2 }, { armL: 'down', armR: 'down', by: 1, t: 2 },
  { props: [['puff', 16, 2]], t: 3 }, { props: [['puff', 17, 1]], t: 3 }, { props: [['puff', 18, 0]], t: 2 },
  { by: 0, eyes: 'open', props: [], t: 2 },
  { armL: 'rubUp', props: [['sweat', 15, 0]], t: 2 }, { armL: 'rub', props: [['sweat', 15, 2]], t: 2 }, { armL: 'rubUp', props: [['sweat', 15, 4]], t: 2 },
  { armL: 'down', props: [], t: 2 },
  { eyes: 'happy', mouth: 'smile', props: [['sparkle', -3, 0, 'g'], ['sparkle', 18, 1, 'g']], t: 4 }, { props: [], t: 3 }, { eyes: 'open', mouth: null, t: 2 }] });

// Zielflagge: Er holt eine karierte Flagge aus der Tasche, reckt sie hoch und schwenkt sie (das Tuch flattert), dann wieder hinunter und weg.
const FX0 = -7
const FLAG_FETCH = { name: 'hint_flag0', size: [6, 9] as const, at: [FX0, 1] as const, side: 'L' as const, grip: 4 }
const flag = (k: number, x: number, y: number): PropRef => g(`hint_flag${k}`, x, y)
const flagHand = (y: number): Frame => armBlock('L', 3, Math.max(0, y + 4))
C('long_flag', 'Schwenkt die Zielflagge (langer Turn)', 'done_long', { shapedEyes: true,
  intro: fetchIn(FLAG_FETCH),
  frames: [
    // hochrecken
    ...[0, -1, -2, -3].map((y): Frame => ({ ...flagHand(y), look: [-2, -1], eyes: 'open', mouth: null, props: [flag(0, FX0, y)], t: 1 })),
    // schwenken: Tuch flattert, die Flagge kippt einen Pixel hin und her, er strahlt
    ...Array.from({ length: 6 }, (_, i): Frame => ({ ...flagHand(-3), eyes: 'happy', mouth: 'smile', fy: i % 2 ? 0 : -1, legs: i % 2 ? 'stand' : 'tuck', props: [flag(i % 2, FX0 - (i % 2), -3)], t: 3 })),
    { fy: 0, legs: 'stand', eyes: 'open', mouth: null, props: [flag(0, FX0, -3)], t: 2 },
    // wieder hinunter
    ...[-2, -1, 0, 1].map((y): Frame => ({ ...flagHand(y), look: [-2, 1], props: [flag(0, FX0, y)], t: 1 })),
    { armL: 'down', props: [flag(0, FX0, 1)], t: 2 }],
  outro: fetchOut(FLAG_FETCH) });

export const CLIPS: readonly ClipDef[] = out
