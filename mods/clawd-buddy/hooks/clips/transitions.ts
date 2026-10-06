// clawd-buddy: Clips der Gruppe "transitions" (Posenwechsel, damit nichts springt).
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropSprite } from '../stage.ts'

/** Requisiten, die nur diese Gruppe braucht (Name → Sprite). Namen müssen über alle Gruppen eindeutig sein. */
export const PROPS: Readonly<Record<string, PropSprite>> = {}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Übergänge zwischen kanonischen Posen
C('sit_down', 'stehen → sitzen', 'transition', { from: 'stand', to: 'sit', frames: [{ by: 1, t: 2 }, { by: 2, t: 2 }] });
C('stand_up', 'sitzen → stehen', 'transition', { from: 'sit', to: 'stand', frames: [{ by: 1, t: 2 }, { by: 0, fy: -1, legs: 'tuck', t: 1 }, { fy: 0, legs: 'stand', t: 2 }] });
C('lie_down', 'sitzen → liegen', 'transition', { from: 'sit', to: 'lie', frames: [{ squash: 1, eyes: 'half', t: 3 }, { squash: 2, armL: 'out', armR: 'out', eyes: 'closed', t: 3 }] });
C('get_up', 'liegen → sitzen', 'transition', { from: 'lie', to: 'sit', frames: [{ squash: 1, armL: 'down', armR: 'down', eyes: 'half', t: 3 }, { squash: 0, eyes: 'open', t: 2 }] });
C('turn_away', 'umdrehen', 'transition', { from: 'stand', to: 'back', frames: [{ look: [1, 0], t: 2 }, { eyes: 'none', back: true, t: 2 }] });
C('turn_back', 'zurückdrehen', 'transition', { from: 'back', to: 'stand', frames: [{ back: false, eyes: 'open', look: [1, 0], t: 2 }, { look: [0, 0], t: 2 }] });
C('lift', 'stehen → hochgehoben', 'transition', { from: 'stand', to: 'held', frames: [{ fy: -1, eyes: 'wide', t: 1 }, { fy: -2, legs: 'stepA', t: 1 }, { fy: -3, t: 1 }] });
C('drop', 'hochgehoben → stehen', 'transition', { from: 'held', to: 'stand', frames: [{ fy: -2, legs: 'tuck', t: 1 }, { fy: -1, t: 1 }, { fy: 0, by: 1, legs: 'spread', t: 1 }, { by: 0, legs: 'stand', eyes: 'open', t: 2 }] });

export const CLIPS: readonly ClipDef[] = out
