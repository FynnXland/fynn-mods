// band.ts: gemeinsames Protokoll für das Band über dem Prompt (AbovePrompt). Gleiche Kopie in limit-bars, clawd-buddy,
// quick-replies und sidekick (Mods importieren nur relativ); Beschreibung in docs/BAND.md, Änderungen immer in allen Kopien.
//
// Die Reihenfolge der Mods in der Kette hängt von der Installation ab (docs/raw/en/events.md:291-305). Damit das Band trotzdem
// immer gleich aussieht, gibt es zwei Arten von Inhalt:
// - Grund: was nebeneinander in einer Zeile steht (Limit-Balken links, Clawd rechts). Jeder Mod setzt seinen Teil neben den Grund.
// - Ebenen: was als eigene Zeile über dem Grund steht (Quick-Replies, sidekick). Ein Box-Knoten mit key `layer:<Höhe>:<Name>`.
//   Jeder Mod holt die Ebenen aus dem, was `next` liefert, heraus, baut nur den Grund um und setzt die Ebenen wieder obenauf,
//   die höchste zuoberst. So wandert keine Ebene in die Zeile eines anderen Mods, egal wer außen liegt.
import type { RenderElement, RenderNode } from 'claude-code'

const LAYER = 'layer:'
const ROOT = 'band'
const BASE = 'band-base'

export type Split = { layers: RenderElement[]; base: RenderNode | null }

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

/** Den Grund aus einer Wurzel holen, die joinBand gebaut hat. */
function baseOf(root: Data): unknown {
  const wrap = (root.children ?? []).find((c) => keyOf(c) === BASE) as Data | undefined
  const inner = wrap?.children?.[0] as Data | undefined
  return inner?.children?.[0] ?? null
}

function lift(node: unknown, out: RenderElement[]): unknown {
  if (!node || typeof node !== 'object') return node
  const n = node as Data
  if (levelOf(n) >= 0) {
    out.push(n as RenderElement)
    return null
  }
  // Wurzel eines anderen Mods: ihre Ebenen einsammeln, an ihrer Stelle steht nur noch ihr Grund
  if (keyOf(n) === ROOT) {
    for (const c of n.children ?? []) if (levelOf(c) >= 0) out.push(c as RenderElement)
    return lift(baseOf(n), out)
  }
  if (!Array.isArray(n.children)) return node
  let changed = false
  const kids: unknown[] = []
  for (const c of n.children) {
    const l = lift(c, out)
    if (l !== c) changed = true
    if (l !== null) kids.push(l)
  }
  // Nichts gefunden: derselbe Knoten, damit ein Band ohne Ebenen genau so bleibt, wie es war
  return changed ? { ...n, children: kids } : node
}

/** Ebenen aus dem Ergebnis von `next` herausholen, auch aus fremden Hüllen; der Rest ist der Grund. */
export function splitBand(theirs: RenderNode | null | undefined): Split {
  const layers: RenderElement[] = []
  const base = lift(theirs ?? null, layers) as RenderNode | null
  return { layers, base }
}

/** Ebenen (höchste oben) über den Grund setzen; ohne Ebenen bleibt der Grund unverändert. */
export function joinBand(layers: readonly RenderElement[], base: RenderNode | null | undefined): RenderNode | null {
  if (layers.length === 0) return base ?? null
  const sorted = layers
    .map((l, i) => ({ l, i }))
    .sort((a, b) => levelOf(b.l) - levelOf(a.l) || a.i - b.i)
    .map((x) => x.l)
  const kids: RenderNode[] = [...sorted]
  if (base !== null && base !== undefined) {
    // Der Grund steht in einer eigenen Zeile unten bündig, nie direkt in der Spalte (quick-replies, Lehren 4 und 5)
    kids.push(
      box({ key: BASE, flexDirection: 'row', alignItems: 'flex-end' }, [
        box({ flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end' }, [base]),
      ]),
    )
  }
  return box({ key: ROOT, flexDirection: 'column', justifyContent: 'flex-end' }, kids)
}

/** Eine Ebene: eigener Box-Knoten mit `layer:<Höhe>:<Name>`, der Inhalt unverändert darin. */
export function layer(level: number, name: string, content: RenderNode): RenderElement {
  return box({ key: `${LAYER}${level}:${name}`, flexDirection: 'column', flexShrink: 0 }, [content])
}

// Elemente als reine Daten (types@2.1.289:11659-11684), ohne $.ui.resolve
function box(props: Record<string, string | number | boolean>, children: RenderNode[]): RenderElement {
  return { type: 'Box', props, children } as RenderElement
}

/** Höhen der Ebenen: weiter oben = größere Zahl. */
export const LEVEL = { quickReplies: 20, sidekick: 30 } as const
