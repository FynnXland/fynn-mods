// quick-replies: reine Anzeige-Logik (ohne `$`), damit sie sich ohne Band testen lässt.

/** Längste Beschriftung; der volle Text wird trotzdem gesendet. */
const MAX_LABEL = 40
/** Spalten zwischen linker und rechter Hälfte im 2 × 2. */
export const GAP = 2
/** `1: ` vor der Beschriftung (Terminal, `plain`, types@2.1.289:1028-1031). */
const PREFIX = 3

export type Layout = 'grid' | 'list'
export type LayoutPref = 'auto' | Layout

export function label(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > MAX_LABEL ? t.slice(0, MAX_LABEL - 1).trimEnd() + '…' : t
}

/** Halbe Breite des Bands für eine Spalte des 2 × 2 (bodyColumns zieht das `[-]` der Engine schon ab, types@2.1.289:9735-9741). */
function halfWidth(bodyColumns: number): number {
  return Math.floor((bodyColumns - GAP) / 2)
}

/** 2 × 2, wenn die längste Beschriftung samt Ziffer in die halbe Breite passt, sonst vier Zeilen. */
export function chooseLayout(texts: readonly string[], bodyColumns: number, pref: LayoutPref = 'auto'): Layout {
  // Ein einzelner Vorschlag (nur der von Claude Code) steht allein in seiner Zeile
  if (texts.length <= 1) return 'list'
  if (pref !== 'auto') return pref
  const longest = texts.reduce((m, t) => Math.max(m, label(t).length), 0)
  return longest + PREFIX <= halfWidth(bodyColumns) ? 'grid' : 'list'
}
