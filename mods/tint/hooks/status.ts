// status.ts: Text und Zeichnung des Status von /tint (SPEC „Verhalten“ 3: Farbsatz, an/aus, gemalt, Farbmuster der Rollen).
// Der Markdown-Text ist die Wahrheit (Claude liest ihn, VS Code und -p zeigen ihn). Die Zeichnung für Terminal und Desktop liest
// nur diesen Text und färbt in den Zeilen „Hell:“/„Dunkel:“ je Paar „<Rolle> #hex“ ein Kästchen ein. Ohne `$`, ohne Zustand.
import type { RenderElement, RenderNode } from 'claude-code'

import type { Swatches } from './palettes.js'
import { SWATCH_ROLES } from './palettes.js'

type Props = Record<string, string | number | boolean>
const el = (type: 'Box' | 'Text', props: Props, children: RenderNode[]): RenderElement => ({ type, props, children })
const text = (s: string, props: Props = {}) => el('Text', props, [s])

/** Zeile mit Farbmustern: `- Hell: Fläche #faf4ed · Schrift #464261 · …` */
export function swatchLine(label: string, names: Readonly<Record<string, string>>, sw: Swatches): string {
  return `- ${label}: ${SWATCH_ROLES.map((r) => `${names[r]} ${sw[r]}`).join(' · ')}`
}

const SWATCH = /^- ([^:]+): (.+#[0-9a-f]{6}.*)$/i
const PAIR = /(\S+) (#[0-9a-f]{6})/gi

/** Markdown ohne Auszeichnung für die gezeichnete Fassung. */
const plain = (s: string) => s.replace(/^- /, '').replace(/\*\*/g, '').replace(/`/g, '')

/** Die Zeichnung aus dem Status-Text; `undefined`, wenn der Text keine Farbmuster-Zeile hat (dann zeigt die Engine Markdown). */
export function statusTree(markdown: string, mod: string, accent: string): RenderElement | undefined {
  const lines = markdown.split('\n').filter((l) => l.trim())
  if (!lines.some((l) => SWATCH.test(l))) return undefined
  const kids: RenderNode[] = lines.map((line, i) => {
    const m = SWATCH.exec(line)
    if (!m) {
      const t = plain(i === 0 ? line.replace(new RegExp(`^${mod}: `), '') : line)
      return i === 0 ? text(t, { color: accent, bold: true }) : text(t)
    }
    const parts: RenderNode[] = [text(`${m[1]}: `, { dimColor: true })]
    for (const p of m[2]!.matchAll(PAIR)) parts.push(text('■', { color: p[2]!.toLowerCase() }), text(` ${p[1]}  `))
    return el('Text', {}, parts)
  })
  return el('Box', { flexDirection: 'column', borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%', key: `${mod}-status` }, kids)
}
