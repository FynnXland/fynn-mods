// band.ts: gemeinsames Protokoll für das Band über dem Prompt (AbovePrompt). Gleiche Kopie in limit-bars, clawd-buddy,
// quick-replies, sidekick und spotify (Mods importieren nur relativ); Beschreibung in docs/BAND.md, Änderungen immer in allen Kopien.
// ENTWURF (Protokoll mit Plätzen, mods/spotify/PROTOKOLL-ENTWURF.md): bis zur Freigabe nur in spotify, die anderen Kopien bleiben.
//
// Die Reihenfolge der Mods in der Kette hängt von der Installation ab (docs/raw/en/events.md:291-305). Damit das Band trotzdem
// immer gleich aussieht, gibt es drei Arten von Inhalt:
// - Platz: ein Teil der Grund-Zeile (limit-bars 10, spotify 20, clawd-buddy 30 rechts). Box-Knoten mit key `slot:<Zahl>:<Name>`
//   (links) bzw. `slot:<Zahl>:<Name>:right`. Die Zeile sortiert alle Plätze nach der Zahl, egal wer in der Kette außen liegt.
// - Rest: was weder Platz noch Ebene ist (der Kern-Knoten `{type:'engine'}` oder die Zeichnung eines noch nicht umgestellten
//   Mods). Er steht in der Mitte der Zeile und füllt den freien Platz.
// - Ebenen: was als eigene Zeile über dem Grund steht (Quick-Replies, sidekick). Ein Box-Knoten mit key `layer:<Höhe>:<Name>`.
// Jeder Mod holt Plätze und Ebenen aus dem, was `next` liefert, heraus, ergänzt seinen Teil und baut alles neu zusammen.
import type { RenderElement, RenderNode } from 'claude-code'

const LAYER = 'layer:'
const SLOT = 'slot:'
const ROOT = 'band'
const BASE = 'band-base'
const ROW = 'band-row'
const REST = 'band-rest'

export type Split = { layers: RenderElement[]; slots: RenderElement[]; base: RenderNode | null }

type Data = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

const keyOf = (n: unknown): string => {
  const k = (n as Data | null)?.props?.key
  return typeof k === 'string' ? k : ''
}

/** Höhe einer Ebene aus ihrem key (`layer:20:quick-replies` → 20); kein Ebenen-key → -1. */
export function levelOf(n: unknown): number {
  const k = keyOf(n)
  if (!k.startsWith(LAYER)) return -1
  const v = Number(k.slice(LAYER.length).split(':')[0])
  return Number.isFinite(v) ? v : 0
}

/** Name einer Ebene (`layer:20:quick-replies` → quick-replies). */
export function nameOf(n: unknown): string {
  const k = keyOf(n)
  return k.startsWith(LAYER) ? k.slice(LAYER.length).split(':').slice(1).join(':') : ''
}

/** Platznummer aus dem key (`slot:20:spotify` → 20); kein Platz-key → -1. */
export function slotNo(n: unknown): number {
  const k = keyOf(n)
  if (!k.startsWith(SLOT)) return -1
  const v = Number(k.slice(SLOT.length).split(':')[0])
  return Number.isFinite(v) && v >= 0 ? v : -1
}

/** Name eines Platzes (`slot:20:spotify` → spotify, `slot:30:clawd-buddy:right` → clawd-buddy). */
export function slotName(n: unknown): string {
  const k = keyOf(n)
  return k.startsWith(SLOT) ? (k.slice(SLOT.length).split(':')[1] ?? '') : ''
}

const isRight = (n: unknown): boolean => keyOf(n).endsWith(':right')

/** Den Grund aus einer Wurzel holen, die joinBand gebaut hat. */
function baseOf(root: Data): unknown {
  const wrap = (root.children ?? []).find((c) => keyOf(c) === BASE) as Data | undefined
  const inner = wrap?.children?.[0] as Data | undefined
  return inner?.children?.[0] ?? null
}

function lift(node: unknown, layers: RenderElement[], slots: RenderElement[]): unknown {
  if (!node || typeof node !== 'object') return node
  const n = node as Data
  if (levelOf(n) >= 0) {
    layers.push(n as RenderElement)
    return null
  }
  if (slotNo(n) >= 0) {
    slots.push(n as RenderElement)
    return null
  }
  // Wurzel eines anderen Mods: ihre Ebenen einsammeln, an ihrer Stelle steht nur noch ihr Grund
  if (keyOf(n) === ROOT) {
    for (const c of n.children ?? []) if (levelOf(c) >= 0) layers.push(c as RenderElement)
    return lift(baseOf(n), layers, slots)
  }
  // Zeile aus joinBand: ihre Plätze einsammeln, an ihrer Stelle steht nur noch der Rest
  if (keyOf(n) === ROW) {
    let rest: unknown = null
    for (const c of n.children ?? []) {
      if (slotNo(c) >= 0) slots.push(c as RenderElement)
      else if (keyOf(c) === REST) rest = (c as Data).children?.[0] ?? null
    }
    return lift(rest, layers, slots)
  }
  if (!Array.isArray(n.children)) return node
  let changed = false
  const kids: unknown[] = []
  for (const c of n.children) {
    const l = lift(c, layers, slots)
    if (l !== c) changed = true
    if (l !== null) kids.push(l)
  }
  // Nichts gefunden: derselbe Knoten, damit ein Band ohne Ebenen und Plätze genau so bleibt, wie es war
  return changed ? { ...n, children: kids } : node
}

/** Ebenen und Plätze aus dem Ergebnis von `next` herausholen, auch aus fremden Hüllen; der Rest ist der Grund. */
export function splitBand(theirs: RenderNode | null | undefined): Split {
  const layers: RenderElement[] = []
  const slots: RenderElement[] = []
  const base = lift(theirs ?? null, layers, slots) as RenderNode | null
  return { layers, slots, base }
}

/**
 * Ebenen (höchste oben) über den Grund setzen; ohne Ebenen und Plätze bleibt der Grund unverändert.
 * Mit Plätzen entsteht die Zeile: linke Plätze aufsteigend, der Rest in der Mitte (füllt), rechte Plätze aufsteigend.
 */
export function joinBand(layers: readonly RenderElement[], base: RenderNode | null | undefined, slots: readonly RenderElement[] = []): RenderNode | null {
  const row = rowOf(slots, base)
  if (layers.length === 0) return row
  const sorted = layers
    .map((l, i) => ({ l, i }))
    .sort((a, b) => levelOf(b.l) - levelOf(a.l) || a.i - b.i)
    .map((x) => x.l)
  const kids: RenderNode[] = [...sorted]
  if (row !== null) {
    // Der Grund steht in einer eigenen Zeile unten bündig, nie direkt in der Spalte (quick-replies, Lehren 4 und 5)
    kids.push(
      box({ key: BASE, flexDirection: 'row', alignItems: 'flex-end' }, [
        box({ flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end' }, [row]),
      ]),
    )
  }
  return box({ key: ROOT, flexDirection: 'column', justifyContent: 'flex-end' }, kids)
}

/** Ohne Plätze der Grund selbst, sonst die Zeile mit den Plätzen. */
function rowOf(slots: readonly RenderElement[], base: RenderNode | null | undefined): RenderNode | null {
  if (slots.length === 0) return base ?? null
  const sorted = slots
    .map((s, i) => ({ s, i }))
    .sort((a, b) => slotNo(a.s) - slotNo(b.s) || a.i - b.i)
    .map((x) => x.s)
  const left = sorted.filter((s) => !isRight(s))
  const right = sorted.filter(isRight)
  const rest = box({ key: REST, flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-end' }, base ? [base] : [])
  return box({ key: ROW, flexDirection: 'row', alignItems: 'flex-end', columnGap: SLOT_GAP }, [...left, rest, ...right])
}

/** Abstand zwischen den Plätzen. */
export const SLOT_GAP = 2

/** Eine Ebene: eigener Box-Knoten mit `layer:<Höhe>:<Name>`, der Inhalt unverändert darin. */
export function layer(level: number, name: string, content: RenderNode): RenderElement {
  return box({ key: `${LAYER}${level}:${name}`, flexDirection: 'column', flexShrink: 0 }, [content])
}

/** Ein Platz der Grund-Zeile: Box-Knoten mit `slot:<Zahl>:<Name>` (rechts: `…:right`), unten bündig, schrumpft nie. */
export function slot(no: number, name: string, content: RenderNode, side: 'left' | 'right' = 'left'): RenderElement {
  return box({ key: `${SLOT}${no}:${name}${side === 'right' ? ':right' : ''}`, flexShrink: 0, flexDirection: 'column', justifyContent: 'flex-end' }, [content])
}

// Elemente als reine Daten (types@2.1.289:11659-11684), ohne $.ui.resolve
function box(props: Record<string, string | number | boolean>, children: RenderNode[]): RenderElement {
  return { type: 'Box', props, children } as RenderElement
}

/** Höhen der Ebenen: weiter oben = größere Zahl. */
export const LEVEL = { quickReplies: 20, sidekick: 30 } as const

/** Plätze der Grund-Zeile: kleinere Zahl = weiter links. */
export const SLOTS = { limitBars: 10, spotify: 20, clawdBuddy: 30 } as const
