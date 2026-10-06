// clawd-buddy: Clips der Gruppe "idle" (Grundpose).
import { clip } from '../clipdef.ts'
import type { ClipDef, Frame } from '../clipdef.ts'
import type { PropSprite } from '../stage.ts'

/** Requisiten, die nur diese Gruppe braucht (Name → Sprite). Namen müssen über alle Gruppen eindeutig sein. */
export const PROPS: Readonly<Record<string, PropSprite>> = {}

const out: ClipDef[] = []
const C = (name: string, label: string, cat: string, def: Partial<Omit<ClipDef, 'name' | 'label' | 'cat'>> & { frames: readonly Frame[] }): void => {
  out.push(clip(name, label, cat, def))
}

// ---- Grundpose
// Stehen soll so lebendig wirken wie die übrigen Clips (Fynn: im Leerlauf wirkte er träge): Atmen über die Schultern (Engine-Ebene),
// dazwischen kleine, kurze Bewegungen: Gewicht verlagern (Fußtipper), kurzer Blick zur Seite, Arme kurz anheben.
C('idle_breathe', 'Atmen & Blinzeln', 'idle', { loop: true, breathe: true, lookable: true, interruptible: true, frames: [
  { t: 14 },
  { legs: 'tapR', t: 2 }, { legs: 'stand', t: 2 }, { legs: 'tapR', t: 2 }, { legs: 'stand', t: 12 },
  { look: [1, 0], t: 6 }, { look: [0, 0], t: 10 },
  { armL: 'up1', t: 2 }, { armL: 'down', t: 14 },
  { look: [-1, 0], t: 5 }, { look: [0, 0], t: 8 },
] });
C('idle_look', 'Umschauen', 'idle', { interruptible: true, frames: [
  { look: [-1, 0], t: 4 }, { look: [-1, -1], t: 3 }, { look: [0, 0], t: 2 }, { look: [1, 0], t: 4 }, { look: [1, -1], t: 2 }, { look: [0, 0], t: 3 }] });

export const CLIPS: readonly ClipDef[] = out
