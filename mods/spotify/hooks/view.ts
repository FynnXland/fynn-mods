// spotify: Zeichnung des Plays im Band, ohne `$`-Aufrufe (die Elementkonstruktoren kommen aus `$.ui.resolve(e)` und werden übergeben).
// Desktop: volle Stufe als eigene Leiste (Ebene), kompakt und mini als Platz in der Zeile; Cover als Svg (<image> mit data:-URL), Knöpfe nur mit Symbol. Terminal: eine Zeile.
import type { StageWidths, Stage } from './model.ts'
import { fmtTime, ratio } from './model.ts'
import { T } from './i18n.ts'
import type { Lang } from './i18n.ts'
import type { Track } from './ps.ts'

// Die Konstruktoren aus $.ui.resolve(e), grob typisiert: view.ts bleibt frei von $-Aufrufen und testbar
export type Els = {
  Box: (p: Record<string, unknown> & { children?: unknown[] }) => never
  Text: (p: Record<string, unknown> & { children?: unknown[] }) => never
  Button: (p: Record<string, unknown> & { children?: unknown[] }) => never
  Svg: (p: { source: string; alt: string; width?: number; height?: number }) => never
}

export const COVER_PX = 56
// Cover der Leiste: niedriger, damit die Leiste zwei Zeilen hoch bleibt
const BAR_COVER_PX = 44
// Stil der limit-bars (mods/limit-bars/hooks/svg.ts): Mono-Schrift, orange Beschriftung, grüner Segmentbalken aus 3-px-Segmenten mit 1-px-Fuge
const FONT = "ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace"
const ORANGE = '#D77757'
const GREEN = '#6CC070'
const GREY = '#9A9A9A'
const EMPTY = '#4A4A4A'
const SEGMENTS = 44
const PITCH = 4
const SEG = 3
const SEG_H = 8
const INFO_W = 340 // Balken (176), Fuge, Zeit; der Titel darf bis zur vollen Breite gehen
const INFO_H = 32
const CHAR_PX = 7.2 // Breite eines Zeichens der Mono-Schrift bei 12 px, großzügig gerechnet
const SEP_W = 2400 // die Trennlinie ist breiter als jedes Fenster; ihre Box schneidet sie ab
const SEP_H = 26
const COMPACT_COLUMN_PX = 190 // Platz in der Zeile: Titel (gekürzt) und drei Knöpfe
const GAP_PX = 16 // Cover – Spalte
/** Höhe der eigenen Leiste in der Ebenen-Ordnung (docs/BAND.md): über quick-replies (20) und sidekick (30). */
export const BAR_LEVEL = 40

/** Breiten der Stufen im Desktop in Pixeln, soweit sie einen Platz in der Zeile belegen; `full` ist die Leiste und belegt keinen. */
export const DESKTOP_WIDTHS: StageWidths = { full: 0, compact: COVER_PX + GAP_PX + COMPACT_COLUMN_PX, mini: COVER_PX + GAP_PX + 48 }

/** Svg für das Cover: JPEG (Base64) als <image>, ohne Cover ein graues Feld mit Note. */
export function coverSvg(cover: string | undefined, size = COVER_PX): string {
  const body = cover
    ? `<image href="data:image/jpeg;base64,${cover}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${size}" height="${size}" rx="4" fill="#3a3a3a"/><text x="${size / 2}" y="${Math.round(size * 0.68)}" text-anchor="middle" font-size="${Math.round(size * 0.46)}" fill="#9a9a9a" font-family="sans-serif">♪</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><clipPath id="r"><rect width="${size}" height="${size}" rx="4"/></clipPath><g clip-path="url(#r)">${body}</g></svg>`
}

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Text auf höchstens `max` Zeichen, mit … am Ende gekürzt. */
export function clip(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

/**
 * Titel und Position im Stil der Stats-Leiste von limit-bars: oben der Titel in Orange mit dem Interpreten in Grau, darunter ein
 * Segmentbalken (grün, Rest dunkelgrau) und rechts die Zeit (verstrichen grün, Länge grau).
 */
export function infoSvg(title: string, artist: string, pos: number, end: number): string {
  const max = Math.floor(INFO_W / CHAR_PX)
  const t = clip(title, max)
  const a = artist ? clip(` – ${artist}`, Math.max(0, max - [...t].length)) : ''
  const on = Math.round(ratio(pos, end) * SEGMENTS)
  let segs = ''
  for (let i = 0; i < SEGMENTS; i++) segs += `<rect x="${i * PITCH}" y="20" width="${SEG}" height="${SEG_H}" rx="0.5" fill="${i < on ? GREEN : EMPTY}"/>`
  const time = `<text x="${SEGMENTS * PITCH + 8}" y="28" font-family="${FONT}" font-size="12"><tspan fill="${GREEN}">${fmtTime(pos)}</tspan><tspan fill="${GREY}"> / ${fmtTime(end)}</tspan></text>`
  const head = `<text x="0" y="12" font-family="${FONT}" font-size="12"><tspan fill="${ORANGE}" font-weight="700">${esc(t)}</tspan>${a ? `<tspan fill="${GREY}">${esc(a)}</tspan>` : ''}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${INFO_W}" height="${INFO_H}" viewBox="0 0 ${INFO_W} ${INFO_H}">${head}${segs}${time}</svg>`
}

/** Orange Trennlinie (2 px) mit 8 px Luft darüber und 16 px darunter. */
export function sepSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SEP_W}" height="${SEP_H}" viewBox="0 0 ${SEP_W} ${SEP_H}"><rect y="8" width="${SEP_W}" height="2" fill="${ORANGE}" opacity="0.85"/></svg>`
}

export type Handlers = {
  press: (word: 'prev' | 'back' | 'toggle' | 'forward' | 'next' | 'shuffle' | 'repeat') => void
}

export type ViewInput = {
  lang: Lang
  stage: Exclude<Stage, 'off'>
  track: Track
  cover?: string
  /** Position jetzt (Sekunden), schon weitergerechnet. */
  pos: number
  /** Desktop-Leiste: zusätzlich −15 s, +15 s, Zufall und Wiederholen. */
  extraButtons: boolean
}

function titleOf(t: Track): string {
  return t.artist ? `${t.title} – ${t.artist}` : t.title
}

/**
 * Desktop. `full`: eine eigene Leiste (Ebene `BAR_LEVEL`) über allen Mods: Cover, Titel – Interpret, Zeit mit Balken, rechts alle Knöpfe.
 * `compact`/`mini`: ein Platz in der Zeile (Cover, Titel auf feste Breite gekürzt, Knöpfe). Die Knöpfe zeigen nur Symbole: der Desktop
 * zeichnet `label` als Knopftext, deshalb steht der Inhalt als Kind und der Knopf hat keinen `label`.
 */
export function desktopTree(els: Els, h: Handlers, v: ViewInput) {
  const { Box, Text, Button, Svg } = els
  const t = T[v.lang]
  const playing = v.track.status === 'Playing'
  const btn = (key: string, glyph: string, word: Parameters<Handlers['press']>[0], o: { primary?: boolean; on?: boolean; scope?: string; color?: string } = {}) =>
    Button({
      key,
      ...(o.scope ? { hover: { scope: o.scope } } : {}),
      children: [Text({ ...(o.color ? { color: o.color } : o.on ? { color: 'success' } : {}), children: [glyph] })],
      ...(o.primary ? { variant: 'primary' } : {}),
      onPress: () => h.press(word),
    })
  const toggle = btn('toggle', playing ? '⏸' : '▶', 'toggle', { primary: true })
  const title = Text({ wrap: 'truncate-end', children: [Text({ bold: true, children: [v.track.title] }), ...(v.track.artist ? [Text({ dimColor: true, children: [` – ${v.track.artist}`] })] : [])] })
  if (v.stage === 'mini') {
    const cover = Svg({ source: coverSvg(v.cover), alt: t.alt.cover(titleOf(v.track)), width: COVER_PX, height: COVER_PX })
    return Box({ key: 'spotify', flexDirection: 'row', alignItems: 'flex-end', columnGap: 1, flexShrink: 0, children: [cover, toggle] })
  }
  if (v.stage === 'compact') {
    const cover = Svg({ source: coverSvg(v.cover), alt: t.alt.cover(titleOf(v.track)), width: COVER_PX, height: COVER_PX })
    return Box({
      key: 'spotify',
      flexDirection: 'row',
      alignItems: 'flex-end',
      columnGap: 2,
      flexShrink: 0,
      children: [
        cover,
        Box({
          flexDirection: 'column',
          flexShrink: 0,
          width: COMPACT_COLUMN_PX,
          children: [title, Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, children: [btn('prev', '⏮', 'prev'), toggle, btn('next', '⏭', 'next')] })],
        }),
      ],
    })
  }
  // Leiste: Cover | Titel und Balken im Stil von limit-bars | Hinweiszeile und Knöpfe rechts; darunter die orange Trennlinie
  const cover = Svg({ source: coverSvg(v.cover, BAR_COVER_PX), alt: t.alt.cover(titleOf(v.track)), width: BAR_COVER_PX, height: BAR_COVER_PX })
  const info = Svg({
    source: infoSvg(v.track.title, v.track.artist, v.pos, v.track.end),
    alt: `${titleOf(v.track)}, ${t.alt.bar(fmtTime(v.pos), fmtTime(v.track.end))}`,
    width: INFO_W,
    height: INFO_H,
  })
  // Beim Überfahren eines Knopfs erscheint seine Bedeutung links neben den Knöpfen (Hover-Gruppe je Knopf). Der Hinweis steht in dem Platz,
  // der zwischen Titel und Knöpfen frei ist: die Knöpfe rücken nicht, und sie bleiben in der Leiste mittig.
  const hint = (scope: string, text: string) =>
    Box({ display: 'none', hover: { scope, display: 'flex' }, children: [Text({ dimColor: true, wrap: 'truncate-end', children: [text] })] })
  const named = (key: string, glyph: string, word: Parameters<Handlers['press']>[0], text: string, o: { primary?: boolean; on?: boolean; color?: string } = {}) => ({
    button: btn(key, glyph, word, { ...o, scope: `sp-${key}` }),
    hint: hint(`sp-${key}`, text),
  })
  // Drei große Knöpfe: zurück (neu starten, zweimal: voriger Titel), Abspielen/Pause als Pille in der Mitte, weiter. Die Symbole stehen
  // in Orange wie die Beschriftung der limit-bars; Leerzeichen machen die Knöpfe breiter (Höhe und Schriftgröße legt der Desktop fest).
  const wide = (g: string) => `   ${g}   `
  const toggleN = named('toggle', playing ? '     ⏸     ' : '     ▶     ', 'toggle', playing ? t.label.pause : t.label.play, { primary: true })
  const parts = v.extraButtons
    ? [
        named('prev', wide('⏮'), 'prev', t.label.prev, { color: ORANGE }),
        named('back', '−15', 'back', t.label.back),
        toggleN,
        named('forward', '+15', 'forward', t.label.forward),
        named('next', wide('⏭'), 'next', t.label.next, { color: ORANGE }),
      ]
    : [named('prev', wide('⏮'), 'prev', t.label.prev, { color: ORANGE }), toggleN, named('next', wide('⏭'), 'next', t.label.next, { color: ORANGE })]
  const modeParts = v.extraButtons
    ? [
        named('shuffle', '⇄', 'shuffle', t.label.shuffle, { on: v.track.shuffle }),
        named('repeat', v.track.repeat === 'Track' ? '↻1' : '↻', 'repeat', t.label.repeat, { on: v.track.repeat !== 'None' }),
      ]
    : []
  const controls = Box({
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 1,
    flexShrink: 0,
    children: [
      ...parts.map((x) => x.button),
      // Absatz zwischen Abspielen und den Zustandsknöpfen
      ...(modeParts.length ? [Box({ marginLeft: 2, flexDirection: 'row', columnGap: 1, children: modeParts.map((x) => x.button) })] : []),
    ],
  })
  const hints = Box({ flexGrow: 1, flexShrink: 1, flexDirection: 'row', justifyContent: 'flex-end', marginRight: 2, children: [...parts, ...modeParts].map((x) => x.hint) })
  const sep = Box({ width: '100%', overflow: 'hidden', flexShrink: 0, children: [Svg({ source: sepSvg(), alt: t.alt.sep, width: SEP_W, height: SEP_H })] })
  return Box({
    key: 'spotify',
    flexDirection: 'column',
    children: [
      Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, paddingLeft: 1, children: [cover, info, hints, controls] }),
      sep,
    ],
  })
}

/** Terminal: eine Zeile aus ♪, Titel (kürzt sich selbst), Zeit und drei Knöpfen; kleinere Stufen lassen Teile weg. */
export function terminalTree(els: Els, h: Handlers, v: ViewInput) {
  const { Box, Text, Button } = els
  const playing = v.track.status === 'Playing'
  const t = T[v.lang]
  const btn = (key: string, glyph: string, name: string, word: Parameters<Handlers['press']>[0]) =>
    Button({ key, label: name, children: [glyph], plain: true, onPress: () => h.press(word) })
  const play = btn('toggle', playing ? '⏸' : '▶', playing ? t.label.pause : t.label.play, 'toggle')
  if (v.stage === 'mini') return Box({ key: 'spotify', flexDirection: 'row', columnGap: 1, flexShrink: 0, children: [Text({ children: ['♪'] }), play] })
  return Box({
    key: 'spotify',
    flexDirection: 'row',
    columnGap: 1,
    flexShrink: 1,
    children: [
      Text({ color: 'success', children: ['♪'] }),
      Text({ wrap: 'truncate-end', children: [titleOf(v.track)] }),
      ...(v.stage === 'full' ? [Text({ dimColor: true, children: [`${fmtTime(v.pos)}/${fmtTime(v.track.end)}`] })] : []),
      btn('prev', '⏮', t.label.prev, 'prev'),
      play,
      btn('next', '⏭', t.label.next, 'next'),
    ],
  })
}

/** Terminal: `♪ Titel – Interpret  1:23/3:45  ⏮ ⏯ ⏭`; so lang die Stufe es zeigt. */
export function terminalLine(v: ViewInput): string {
  const t = v.track
  const time = `${fmtTime(v.pos)}/${fmtTime(t.end)}`
  const play = t.status === 'Playing' ? '⏸' : '▶'
  if (v.stage === 'mini') return `♪ ${play}`
  if (v.stage === 'compact') return `♪ ${titleOf(t)}  ⏮ ${play} ⏭`
  return `♪ ${titleOf(t)}  ${time}  ⏮ ${play} ⏭`
}

/** Schwellen der Stufen im Terminal in Spalten von `bodyColumns` (keine Breitenmeldung der anderen Mods im Terminal, docs/BAND.md); der Titel kürzt sich selbst. */
export const TERMINAL_WIDTHS: StageWidths = { full: 110, compact: 80, mini: 56 }
