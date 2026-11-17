// band.ts: gemeinsamer Baustein für das Band über dem Prompt ab Claude Code 2.1.323 (docs/BAND.md, docs/BAND-SPEC-2.md §3).
// Vorlage: templates/band/band.ts. Jede Band-Mod (clawd-buddy, limit-bars, prompt-deck, quick-replies, sidekick, tune-strip) hat eine
// wörtliche Kopie in hooks/band.ts und importiert sie als './band.js'; scripts/check-mods.ps1 vergleicht die Kopien.
// Die Datei ruft nichts an `$` auf und braucht deshalb keine Rechte.
//
// Seit 2.1.323 zeichnet jede Mod in `AbovePrompt` nur ihre eigene Zeile (en/interface.md:200-204, types@2.1.325:11360-11375).
// Die Wurzel dieser Zeile trägt einen Schlüssel:
// - Ebene `layer:<Höhe>:<Name>`: eigene Zeile über der Grundzeile, die höhere Zahl steht oben.
// - Platz `slot:<Zahl>:<Name>` bzw. `slot:<Zahl>:<Name>:right`: Teil der einen Grundzeile, aufsteigend von links.
// - Platz 0 ist Clawds Bühne im Desktop (absolut an der eigenen Wurzel): eine eigene Zeile nach der Grundzeile.
// - Fuß `foot:<Zahl>:<Name>`: eigene Zeile unter Grundzeile und Bühne, direkt über dem Eingabefeld; kleinere Zahl weiter
//   oben (BAND-SPEC-2 §10; derzeit nutzt keine Mod sie, sidekick steht seit 0.29.0 wieder als Ebene 50 oben, §11).
// `arrange` setzt die Zeilen in `AbovePromptList` danach zusammen (types@2.1.325:11440-11489, Probe docs/BAND-PROBE-2.1.325.md).
import type { RenderElement, RenderNode } from 'claude-code'

/** Höhen der Ebenen: weiter oben = größere Zahl. prompt-deck (10) steht direkt über der Grundzeile (BAND-SPEC-2 §11). */
export const LEVEL = { promptDeck: 10, quickReplies: 20, tuneStrip: 40, sidekick: 50 } as const

/** Plätze: kleinere Zahl = weiter links. Platz 0 ist Clawds Bühne im Desktop (eigene Zeile nach der Grundzeile). */
export const SLOTS = { clawdStage: 0, limitBars: 10, tuneStrip: 20, clawdBuddy: 30 } as const

/** Abstand zwischen den Plätzen der Grundzeile, in Zellen (Terminal und Desktop, Probe 7b). */
export const SLOT_GAP = 2

const LAYER = 'layer:'
const SLOT = 'slot:'
const FOOT_KEY = 'foot:'
const RIGHT = ':right'

/** Eine Zeile des Bands, wie `AbovePromptList` sie in `e.props.rows` liefert (types@2.1.325:111-121). */
export type BandRow = { readonly plugin: string; readonly tree: RenderElement }

/** Was ein Schlüssel bedeutet. */
export type BandKey =
  | { kind: 'layer'; level: number; name: string }
  | { kind: 'slot'; no: number; name: string; right: boolean }
  | { kind: 'foot'; no: number; name: string }
  | { kind: 'rest' }

/** Stilangaben für die eigene Wurzel, z. B. `width`, `overflow` oder Clawds `position: 'absolute'`. */
export type RootStyle = Record<string, string | number | boolean>

function box(props: RootStyle, children: RenderNode[]): RenderElement {
  // Elemente als reine Daten (types@2.1.325:10385-10393), ohne $.ui.resolve
  return { type: 'Box', props, children }
}

const list = (content: RenderNode | readonly RenderNode[]): RenderNode[] =>
  Array.isArray(content) ? [...(content as readonly RenderNode[])] : [content as RenderNode]

/**
 * Wurzel einer Ebene: `Box{key:'layer:<Höhe>:<Name>', column}` um den Inhalt. `style` geht an dieselbe Wurzel;
 * `key` und `flexDirection` setzt immer diese Funktion.
 */
export function layer(level: number, name: string, content: RenderNode | readonly RenderNode[], style: RootStyle = {}): RenderElement {
  return box({ ...style, key: `${LAYER}${level}:${name}`, flexDirection: 'column' }, list(content))
}

/**
 * Wurzel eines Platzes: `Box{key:'slot:<Zahl>:<Name>[:right]', column}` um den Inhalt. Feste Breite in Zellen und
 * `overflow: 'hidden'` gehören in `style` (Probe 7b: Flexbox schrumpft über die Hüllen nicht), ebenso Clawds Bühne
 * (`position: 'absolute', bottom: 0, right: 0`, nur die eigene Wurzel darf das, Probe §2 c′).
 * Ein rechter Platz bekommt `alignItems: 'flex-end'` an der eigenen Wurzel: Steht er allein (ohne `band-row`), geht seine
 * Zeile über die volle Breite, und sein Inhalt bleibt trotzdem rechts (wie bisher hinter dem wachsenden Rest).
 * `style` kann das überschreiben.
 */
export function slot(no: number, name: string, content: RenderNode | readonly RenderNode[], side: 'left' | 'right' = 'left', style: RootStyle = {}): RenderElement {
  const key = `${SLOT}${no}:${name}${side === 'right' ? RIGHT : ''}`
  const align: RootStyle = side === 'right' ? { alignItems: 'flex-end' } : {}
  return box({ ...align, ...style, key, flexDirection: 'column' }, list(content))
}

/**
 * Wurzel eines Fußes: `Box{key:'foot:<Zahl>:<Name>', column}` um den Inhalt, als Zeile unter Grundzeile und Bühne.
 * `style` geht an dieselbe Wurzel; `key` und `flexDirection` setzt immer diese Funktion.
 */
export function foot(no: number, name: string, content: RenderNode | readonly RenderNode[], style: RootStyle = {}): RenderElement {
  return box({ ...style, key: `${FOOT_KEY}${no}:${name}`, flexDirection: 'column' }, list(content))
}

const NUMBER = /^\d+$/

/** Schlüssel lesen: `layer:20:quick-replies`, `slot:30:clawd-buddy:right`, `foot:10:<Name>`; alles andere ist Rest. */
export function parseKey(key: string): BandKey {
  if (key.startsWith(LAYER)) {
    const [n = '', ...rest] = key.slice(LAYER.length).split(':')
    const name = rest.join(':')
    if (NUMBER.test(n) && name !== '') return { kind: 'layer', level: Number(n), name }
  }
  if (key.startsWith(SLOT)) {
    const [n = '', ...rest] = key.slice(SLOT.length).split(':')
    const right = rest.length > 1 && rest[rest.length - 1] === 'right'
    const name = (right ? rest.slice(0, -1) : rest).join(':')
    if (NUMBER.test(n) && name !== '') return { kind: 'slot', no: Number(n), name, right }
  }
  if (key.startsWith(FOOT_KEY)) {
    const [n = '', ...rest] = key.slice(FOOT_KEY.length).split(':')
    const name = rest.join(':')
    if (NUMBER.test(n) && name !== '') return { kind: 'foot', no: Number(n), name }
  }
  return { kind: 'rest' }
}

type Data = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
const ownKey = (n: unknown): string => {
  const k = (n as Data | null)?.props?.key
  return typeof k === 'string' ? k : ''
}

/**
 * Schlüssel einer Zeile. Die Engine reicht die Wurzel der Mod unverändert weiter (gemessen mit 2.1.325, README
 * „Form von rows[].tree“); gesucht wird trotzdem bis zu drei Box-Ebenen tiefer, damit auch eine Hülle oder eine
 * noch nicht umgebaute Zeile (Platz unter `band-row`) eingeordnet wird. Der erste Band-Schlüssel zählt; ohne einen
 * ist die Zeile Rest.
 */
export function keyOfRow(row: BandRow): string {
  let level: unknown[] = [row.tree]
  for (let depth = 0; depth < 4 && level.length > 0; depth++) {
    const next: unknown[] = []
    for (const n of level) {
      const k = ownKey(n)
      if (parseKey(k).kind !== 'rest') return k
      const d = n as Data | null
      if (d && typeof d === 'object' && d.type === 'Box' && Array.isArray(d.children)) next.push(...d.children)
    }
    level = next
  }
  return ''
}

/** Die Zeilen eingeteilt und sortiert; jede Zeile kommt genau einmal vor. */
export type Split = {
  /** Ebenen, absteigend nach Höhe (bei gleicher Höhe in Kettenfolge). */
  layers: BandRow[]
  /** Zeilen ohne Band-Schlüssel, in Kettenfolge (fremde Mods). */
  rest: BandRow[]
  /** Linke Plätze ab 1, aufsteigend. */
  left: BandRow[]
  /** Rechte Plätze ab 1, aufsteigend. */
  right: BandRow[]
  /** Platz 0 (Clawds Bühne im Desktop), in Kettenfolge. */
  stage: BandRow[]
  /** Füße unter Grundzeile und Bühne, aufsteigend (bei gleicher Zahl in Kettenfolge). */
  foot: BandRow[]
}

/** Einteilen nach Schlüssel (SPEC §3 Schritt 1). Rein, ohne `$`. */
export function splitRows(rows: readonly BandRow[]): Split {
  const keyed = rows.map((row, i) => ({ row, i, key: parseKey(keyOfRow(row)) }))
  const by = (a: { i: number }, b: { i: number }) => a.i - b.i
  const layers = keyed
    .filter((x) => x.key.kind === 'layer')
    .sort((a, b) => (b.key.kind === 'layer' ? b.key.level : 0) - (a.key.kind === 'layer' ? a.key.level : 0) || by(a, b))
  const slots = keyed.filter((x) => x.key.kind === 'slot')
  const no = (x: (typeof keyed)[number]) => (x.key.kind === 'slot' ? x.key.no : 0)
  const isRight = (x: (typeof keyed)[number]) => x.key.kind === 'slot' && x.key.right
  const asc = (a: (typeof keyed)[number], b: (typeof keyed)[number]) => no(a) - no(b) || by(a, b)
  const footNo = (x: (typeof keyed)[number]) => (x.key.kind === 'foot' ? x.key.no : 0)
  return {
    layers: layers.map((x) => x.row),
    rest: keyed.filter((x) => x.key.kind === 'rest').map((x) => x.row),
    left: slots.filter((x) => no(x) > 0 && !isRight(x)).sort(asc).map((x) => x.row),
    right: slots.filter((x) => no(x) > 0 && isRight(x)).sort(asc).map((x) => x.row),
    stage: slots.filter((x) => no(x) === 0).map((x) => x.row),
    foot: keyed
      .filter((x) => x.key.kind === 'foot')
      .sort((a, b) => footNo(a) - footNo(b) || by(a, b))
      .map((x) => x.row),
  }
}

/** Die Reihenfolge, in der die Zeilen untereinander stehen: Ebenen, Rest, Plätze, Bühne, Füße. */
export function orderOf(s: Split): BandRow[] {
  return [...s.layers, ...s.rest, ...s.left, ...s.right, ...s.stage, ...s.foot]
}

/**
 * Ob die Anordnung nichts zu tun hat (SPEC §3 Schritt 2): höchstens ein Platz in der Grundzeile und die Zeilen
 * stehen schon in der Reihenfolge von `orderOf`. Dann gibt `arrange` `next(e)` unverändert zurück. Das macht die
 * Anordnung idempotent: Die inneren Hooks sehen nur noch die Teilmengen, die der äußere einzeln weitergibt.
 */
export function isSettled(rows: readonly BandRow[], s: Split = splitRows(rows)): boolean {
  if (s.left.length + s.right.length > 1) return false
  const order = orderOf(s)
  return order.every((row, i) => row === rows[i])
}

/**
 * Zellen, die `band-row` für Abstände braucht: `SLOT_GAP` je Lücke zwischen zwei Kindern. Der Abstandhalter vor den
 * rechten Plätzen ist selbst ein Kind und hat Lücken auf beiden Seiten. Ohne `band-row` (höchstens ein Platz) 0.
 * Für die Breitenrechnung von tune-strip: Rest = bodyColumns − Breiten der anderen Plätze − rowGapCells(links, rechts).
 */
export function rowGapCells(left: number, right: number): number {
  if (left + right <= 1) return 0
  const children = left + right + (right > 0 ? 1 : 0)
  return SLOT_GAP * (children - 1)
}

/** Was `arrange` von `e` braucht: die Zeilen in `e.props.rows`. Alle anderen Props reicht es unverändert weiter. */
export type ListEvent = { readonly props: { readonly rows: readonly BandRow[] } }

/**
 * Anordnung für `on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => arrange(e, next))`.
 *
 * - Grundzeile mit höchstens einem Platz: `next(e)` unverändert, bzw. ein `next` mit den Zeilen in der richtigen Folge.
 * - Sonst `Box{column, key:'band'}`: Ebenen (ein `next`), Rest (ein `next`, falls vorhanden), `Box{row, key:'band-row'}`
 *   mit je einem `next` pro Platz in `Box{flexShrink:0}` (links aufsteigend, Abstand `Box{flexGrow:1}`, rechts
 *   aufsteigend), danach Clawds Bühne (ein `next`) und zuletzt die Füße (ein `next`) als unterste Zeile.
 * - Hüllen um fremde Zeilen tragen nur `key`, `flexDirection`, `flexShrink`, `flexGrow`, `columnGap`, `rowGap`, `alignItems`
 *   (Probe 7: `minWidth` oder `position` darum wird abgelehnt).
 * - Scheitert etwas: `next(e)`, lieber gestapelt als leer (SPEC §3 Schritt 4).
 */
export async function arrange<E extends ListEvent>(e: E, next: (e: NoInfer<E>) => Promise<RenderElement>): Promise<RenderElement> {
  try {
    const rows = e.props.rows
    const s = splitRows(rows)
    if (isSettled(rows, s)) return await next(e)
    const sub = (rs: readonly BandRow[]): Promise<RenderElement> => next({ ...e, props: { ...e.props, rows: rs } })
    if (s.left.length + s.right.length <= 1) return await sub(orderOf(s))
    const kids: RenderNode[] = []
    if (s.layers.length > 0) kids.push(await sub(s.layers))
    if (s.rest.length > 0) kids.push(await sub(s.rest))
    const line: RenderNode[] = []
    // Index im Schlüssel: Zwei Zeilen mit gleichem Schlüssel (z. B. @inline neben @fynn-mods beim Testen) bleiben unterscheidbar
    const cell = async (row: BandRow): Promise<RenderElement> =>
      box({ key: `band-cell:${line.length}:${keyOfRow(row)}`, flexShrink: 0 }, [await sub([row])])
    for (const row of s.left) line.push(await cell(row))
    if (s.right.length > 0) {
      line.push(box({ key: 'band-gap', flexGrow: 1 }, []))
      for (const row of s.right) line.push(await cell(row))
    }
    kids.push(box({ key: 'band-row', flexDirection: 'row', columnGap: SLOT_GAP, alignItems: 'flex-end' }, line))
    if (s.stage.length > 0) kids.push(await sub(s.stage))
    if (s.foot.length > 0) kids.push(await sub(s.foot))
    return box({ key: 'band', flexDirection: 'column' }, kids)
  } catch {
    return next(e)
  }
}
