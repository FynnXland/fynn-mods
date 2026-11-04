// cost-ledger: die Übersicht als reiner Datenbaum {type, props, children} (types RenderElement), ohne $.ui.resolve.
// Nur Box und Text mit Props aus der Allowlist (API-DETAILS.md:1043-1080), sonst zeichnet die Engine ihr Original.
//
// Stil wie limit-bars: Claude-Orange nur für Überschriften, Beträge in normaler Schrift, Nebensachen gedimmt; Farbe tragen
// nur die Balken. Kein festes Außenmaß: Der Desktop meldet mehr Spalten, als er zeigt, und zeichnet Blockzeichen breiter
// als eine Zelle. Spalten sind deshalb Boxen mit fester Breite; im Desktop sind Balken Boxen mit Hintergrundfarbe und
// ganzzahliger Prozentbreite (Kommaprozente verwirft er), im Terminal dünne `▄`. Der leere Teil zeigt den Hintergrund.
import type { RenderElement, RenderNode } from 'claude-code'
import { T, dateTime, duration, fullDate, pct, rangeLabel, resetTime, shortDate, span, tokens, usd, weekLabel } from './i18n.ts'
import type { Lang } from './i18n.ts'
import {
  MOD_PART,
  UNKNOWN_MODEL,
  chatLabel,
  devicesLabel,
  isoWeek,
  modelName,
  notesOf,
  outsideText,
  overviewLimits,
  partLabel,
  partialLabel,
  planLabel,
  planLine,
  projectLabel,
  projectionText,
} from './logic.ts'
import type { Bucket, LimWindow, LimitsReport, Report, Settings, ViewName } from './logic.ts'

/** `here`: die Zeile „Hier: …“ unten in der Übersicht (ab 0.8.0), fertig formatiert. */
export type View = { report: Report; view: ViewName; range: number; here?: string }
type Surface = 'terminal' | 'desktop'

// Theme-Keys statt fester Hex-Werte: Sie folgen dem Theme des Nutzers, hell wie dunkel (types Color/ThemeKey).
const ORANGE = 'claude'
const YELLOW = 'warning'
const RED = 'error'
// Farben je Modell (ab 0.8.1, Fynn 2026-11-04): fest je Familie statt nach Rang, damit ein Modell in jeder Ansicht dieselbe
// Farbe hat, und klar verschiedene Farbtöne. Vorher waren vier der acht Rang-Farben Blautöne (suggestion, permission, ide,
// remember). Opus ist Claudes Hausfarbe, die übrigen folgen der Häufigkeit in Fynns Daten.
const FAMILY_COLORS: readonly [string, string][] = [
  ['opus', 'claude'],
  ['sonnet', 'ide'],
  ['haiku', 'success'],
  ['fable', 'autoAccept'],
  ['mythos', 'planMode'],
]
/** Für weitere Modelle oder eine zweite Version derselben Familie in einer Ansicht. */
const SPARE_COLORS = ['warning', 'permission']
/** Alle Mod-Aufrufe zusammen, in einem eigenen Farbton (die Modelle der Mods zeigt /ledger models). */
const MODS_COLOR = 'bashBorder'
const UNKNOWN_COLOR = 'inactive'
/**
 * Näherung der Theme-Farben (dunkles Theme) für Svg, das keine Theme-Keys kennt (types SvgProps: als Bild gezeichnet).
 * Legende und Beträge daneben stehen als Text in echten Theme-Farben.
 */
export const THEME_HEX: Record<string, string> = {
  claude: '#D77757',
  ide: '#4782C8',
  success: '#4EBA65',
  autoAccept: '#AF87FF',
  planMode: '#48968C',
  warning: '#E5B84B',
  permission: '#B1B9F9',
  bashBorder: '#FD5DB1',
  inactive: '#8A8A8A',
}

/**
 * Farbe je Modell-Schlüssel in der Reihenfolge `keys` (größter Betrag zuerst): die Farbe seiner Familie, solange sie in
 * dieser Ansicht noch frei ist, sonst eine Reservefarbe, danach Grau. Ohne Modell-Daten immer Grau.
 */
export function familyColors(keys: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  const spare = [...SPARE_COLORS]
  for (const k of keys) {
    if (k === UNKNOWN_MODEL) {
      out.set(k, UNKNOWN_COLOR)
      continue
    }
    const fam = FAMILY_COLORS.find(([f]) => k.startsWith(f))?.[1]
    const c = fam && !used.has(fam) ? fam : (spare.shift() ?? UNKNOWN_COLOR)
    used.add(c)
    out.set(k, c)
  }
  return out
}

/** Alle Mod-Teile eines Verlaufs (`mod:<modell>`) unter einem Schlüssel. */
const MODS_KEY = MOD_PART
function poolMods(parts: readonly { key: string; usd: number }[]): { key: string; usd: number }[] {
  const out = new Map<string, number>()
  for (const p of parts) {
    const k = p.key.startsWith(MOD_PART) ? MODS_KEY : p.key
    out.set(k, (out.get(k) ?? 0) + p.usd)
  }
  return [...out.entries()].map(([key, usd]) => ({ key, usd }))
}

type Props = Record<string, string | number | boolean>

function el(type: 'Box' | 'Text', props: Props, children: RenderNode[]): RenderElement {
  return { type, props, children }
}
const text = (s: string, props: Props = {}) => el('Text', props, [s])
const dim = (s: string) => text(s, { dimColor: true })
const row = (props: Props, kids: RenderNode[]) => el('Box', { flexDirection: 'row', ...props }, kids)
const col = (props: Props, kids: RenderNode[]) => el('Box', { flexDirection: 'column', ...props }, kids)
/** Feste Spalte; `right` richtet den Inhalt rechts aus (Beträge). */
const cell = (width: number, kid: RenderNode, right = false) =>
  el('Box', { width, flexShrink: 0, ...(right ? { justifyContent: 'flex-end' } : {}) }, [kid])
const heading = (s: string) => el('Box', { marginTop: 1 }, [text(s, { color: ORANGE, bold: true })])

/** `total` ganze Einheiten nach Anteilen verteilen: erst abrunden, den Rest an die größten Nachkommareste (Summe = total). */
function largestRemainder(shares: number[], total: number): number[] {
  const sum = shares.reduce((a, b) => a + b, 0)
  if (!(sum > 0) || total <= 0) return shares.map(() => 0)
  const raw = shares.map((x) => (x / sum) * total)
  const got = raw.map((x) => Math.floor(x))
  let left = total - got.reduce((a, b) => a + b, 0)
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    got[i]! += 1
    left -= 1
  }
  return got
}

/**
 * Balken der Länge `ratio` (0–1), aufgeteilt in `parts` (Anteile) mit je einer Farbe; ein einfarbiger Balken hat einen Teil.
 * Desktop: Boxen in ganzzahliger Prozentbreite (der Desktop verwirft Kommaprozente), Summe genau 100. Terminal: ganze
 * Zellen `▄`, verteilt nach größtem Rest; ein Teil unter einer halben Zelle kann dort fehlen.
 */
export function stackedBar(surface: Surface, ratio: number, cells: number, parts: { color: string; share: number }[]): RenderElement {
  const r = Math.max(0, Math.min(1, ratio || 0))
  const list = parts.filter((p) => p.share > 0)
  if (surface === 'desktop') {
    const pct = r > 0 ? Math.max(1, Math.round(r * 100)) : 0
    const widths = largestRemainder(list.map((p) => p.share), 100)
    const segs = list.flatMap((p, i) => (widths[i]! > 0 ? [el('Box', { width: `${widths[i]}%`, backgroundColor: p.color }, [' '])] : []))
    const fill = pct > 0 && segs.length ? [el('Box', { width: `${pct}%`, flexDirection: 'row' }, segs)] : [' ']
    return el('Box', { flexGrow: 1, minWidth: 6, marginRight: 1 }, fill)
  }
  const n = Math.max(1, cells)
  const on = r > 0 ? Math.max(1, Math.round(r * n)) : 0
  const got = largestRemainder(list.map((p) => p.share), on)
  const kids: RenderNode[] = list.flatMap((p, i) => (got[i]! > 0 ? [text('▄'.repeat(got[i]!), { color: p.color })] : []))
  return el('Box', { width: n + 1, flexShrink: 0 }, [kids.length ? el('Text', {}, kids) : ' '])
}

const bar = (sf: Surface, ratio: number, cells: number, color: string) => stackedBar(sf, ratio, cells, [{ color, share: 1 }])

/**
 * Farbe je Verlaufsteil, in Legenden-Reihenfolge: die Chat-Modelle nach Gesamtbetrag in der Farbe ihrer Familie, dann
 * „ohne Angabe“ (grau), zuletzt alle Mod-Aufrufe zusammen (`MODS_KEY`, ein eigener Farbton).
 */
export function modelColors(buckets: Bucket[]): Map<string, string> {
  const tot = new Map<string, number>()
  for (const b of buckets) for (const p of poolMods(b.parts)) tot.set(p.key, (tot.get(p.key) ?? 0) + p.usd)
  const chat = [...tot.entries()].filter(([k]) => k !== MODS_KEY && k !== UNKNOWN_MODEL).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const out = familyColors(chat)
  if (tot.has(UNKNOWN_MODEL)) out.set(UNKNOWN_MODEL, UNKNOWN_COLOR)
  if (tot.has(MODS_KEY)) out.set(MODS_KEY, MODS_COLOR)
  return out
}

/** Ampel für Tagesbeträge (`dayYellow`/`dayRed`); darunter die normale Schriftfarbe des Themes (`text`). */
function ampel(v: number, s: Settings): Props {
  return { color: v >= s.dayRed ? RED : v >= s.dayYellow ? YELLOW : 'text' }
}

function cut(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`
}

/** Eine Kennzahl: Zeitraum gedimmt, API-Wert (Chats samt Mod-Aufrufen) fett, darunter die Anzahl der Chats. */
function figure(label: string, w: { usd: number; chats: number }, width: string, lang: Lang): RenderElement {
  return col({ width, paddingRight: 2 }, [dim(label), text(usd(w.usd, lang), { bold: true }), dim(T[lang].chats(w.chats))])
}

/**
 * Verlauf der letzten 14 Tage oder Wochen: je Zeile ein Balken, geteilt nach Modell, darunter die Legende. Der Betrag ist
 * der echte Chat-Betrag plus die Mod-Aufrufe; die Aufteilung folgt den geschätzten Modell-Anteilen, alle Mod-Teile stehen
 * zusammen als „Mod-Aufrufe“ (ab 0.8.1). Die Ampel färbt bei Tagen den Betrag.
 */
function historyBlock(r: Report, s: Settings, sf: Surface, inner: number, weeks: boolean): RenderElement[] {
  const lang = s.lang
  const t = T[lang]
  const buckets = weeks ? r.series.weeks : r.series.days
  // Übersicht einfarbig; die Aufteilung nach Modell zeigen /ledger weeks und /ledger models (ab 0.8.0)
  const colors = weeks ? modelColors(buckets) : new Map<string, string>()
  const max = Math.max(0, ...buckets.map((b) => b.usd))
  const top = buckets.find((b) => b.usd === max && max > 0)?.key
  const labelW = 7
  // Terminal: Beschriftung, Betrag 10, Marke 12 → der Rest ist Balken
  const cells = Math.max(6, Math.min(32, inner - labelW - 10 - 12 - 1))
  const rows = buckets.map((b) =>
    row({}, [
      cell(labelW, dim(weeks ? weekLabel(isoWeek(b.key), lang) : shortDate(b.key, lang))),
      weeks
        ? stackedBar(
            sf,
            max > 0 ? b.usd / max : 0,
            cells,
            // Legenden-Reihenfolge auch im Balken: dieselbe Farbe steht in jeder Zeile an derselben Stelle
            [...colors.keys()].flatMap((k) => {
              const p = poolMods(b.parts).find((x) => x.key === k)
              return p ? [{ color: colors.get(k)!, share: b.usd > 0 ? p.usd / b.usd : 0 }] : []
            }),
          )
        : bar(sf, max > 0 ? b.usd / max : 0, cells, ORANGE),
      cell(10, b.usd > 0 ? text(usd(b.usd, lang), weeks ? {} : ampel(b.usd, s)) : dim('–'), true),
      cell(12, b.key === top ? dim(`  ${t.highest}`) : ''),
    ]),
  )
  const legend: RenderNode[] = [...colors.entries()].map(([k, c]) =>
    el('Box', { marginRight: 2 }, [el('Text', {}, [text('▄ ', { color: c }), dim(partLabel(k, lang))])]),
  )
  return [heading(weeks ? t.last14Weeks : t.last14Days), ...rows, ...(legend.length ? [row({ flexWrap: 'wrap', marginTop: 1 }, legend)] : [])]
}

function projectsBlock(r: Report, title: string, sf: Surface, width: number, limit: number, basis: string, lang: Lang): RenderElement {
  const list = r.projects.slice(0, limit).map((p) => ({ ...p, label: projectLabel(p.name, lang) }))
  const max = Math.max(0, ...list.map((p) => p.usd))
  const nameW = Math.min(18, Math.max(8, ...list.map((p) => p.label.length + 1)))
  const cells = Math.max(4, Math.min(24, width - nameW - 10 - 1 - 2)) // 2 = paddingRight
  const kids: RenderNode[] = list.length
    ? list.map((p) => row({}, [cell(nameW, text(cut(p.label, nameW - 1))), bar(sf, max > 0 ? p.usd / max : 0, cells, ORANGE), cell(10, text(usd(p.usd, lang)), true)]))
    : [dim(T[lang].noCosts)]
  if (r.projects.length > limit) kids.push(dim(T[lang].more(r.projects.length - limit)))
  return col({ width: basis, paddingRight: 2 }, [heading(title), ...kids])
}

function chatsBlock(r: Report, title: string, width: number, limit: number, basis: string, lang: Lang): RenderElement {
  const list = r.chats.slice(0, limit)
  const nameW = Math.max(12, Math.min(48, width - 3 - 10))
  const kids: RenderNode[] = list.length
    ? list.flatMap((c, i) => [
        row({}, [
          cell(3, dim(`${i + 1}`)),
          el('Box', { flexGrow: 1, minWidth: 8 }, [text(cut(chatLabel(c, lang), nameW), { wrap: 'truncate-end' })]),
          cell(10, text(usd(c.usd, lang)), true),
        ]),
        row({}, [cell(3, ''), dim(`${projectLabel(c.project, lang)}${c.device ? ` (${c.device})` : ''} · ${shortDate(c.lastDay, lang)}`)]),
      ])
    : [dim(T[lang].noCosts)]
  return col({ width: basis }, [heading(title), ...kids])
}

const f2 = (n: number) => String(Math.round(n * 100) / 100)
const escSvg = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Kreis mit Anteilen (Svg, Desktop): Bögen ab 12 Uhr im Uhrzeigersinn, zwischen zwei Teilen eine Fuge von 2°, in der Mitte
 * ein Text. Ein einziger Teil ist ein ganzer Kreis (ein Bogen auf seinen Startpunkt zeichnet nichts).
 */
export function donutSvg(parts: { hex: string; share: number }[], center: string, alt: string): { source: string; width: number; height: number; alt: string } {
  const size = 104
  const c = size / 2
  const R = 40
  const W = 14
  const list = parts.filter((p) => p.share > 0)
  const sum = list.reduce((a, p) => a + p.share, 0)
  const gap = list.length > 1 ? (2 / 360) * 2 * Math.PI : 0
  const pt = (a: number) => `${f2(c + R * Math.sin(a))} ${f2(c - R * Math.cos(a))}`
  let body = `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${THEME_HEX.inactive}" stroke-opacity="0.25" stroke-width="${W}"/>`
  if (list.length === 1) body += `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${list[0]!.hex}" stroke-width="${W}"/>`
  else {
    let at = 0
    for (const p of list) {
      const span = (p.share / sum) * 2 * Math.PI
      const a0 = at + gap / 2
      const a1 = Math.max(a0 + 0.001, at + span - gap / 2)
      body += `<path d="M${pt(a0)}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}" fill="none" stroke="${p.hex}" stroke-width="${W}"/>`
      at += span
    }
  }
  body += `<style>.t{fill:#ECEAE3}@media (prefers-color-scheme: light){.t{fill:#262624}}</style>`
  body += `<text class="t" x="${c}" y="${c + 5}" text-anchor="middle" font-family="'Segoe UI', system-ui, sans-serif" font-size="14" font-weight="600">${escSvg(center)}</text>`
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`, width: size, height: size, alt }
}

/**
 * `/ledger models`: je Modell Anteil am geschätzten API-Wert, Betrag, Anzahl und darunter die Tokens, in der festen Farbe
 * der Modellfamilie (ab 0.8.1). Desktop: oben ein Kreis mit den Anteilen, je Zeile ein Farbquadrat statt eines Balkens;
 * Terminal: farbige Balken.
 */
function modelsBlock(r: Report, title: string, sf: Surface, inner: number, lang: Lang): RenderElement {
  const t = T[lang]
  const sum = r.models.reduce((a, m) => a + m.usd, 0)
  const names = r.models.map((m) => modelName(m.key, lang))
  const colors = familyColors(r.models.map((m) => m.key))
  const share = (v: number) => (sum > 0 ? Math.round((v / sum) * 100) : 0)
  const nameW = Math.min(16, Math.max(10, ...names.map((n) => n.length + 1))) + (sf === 'desktop' ? 2 : 0)
  const cells = Math.max(6, Math.min(32, inner - nameW - 6 - 10 - 8 - 1))
  const kids: RenderNode[] = r.models.length
    ? r.models.flatMap((m, i) => [
        // Umbruch nur, wenn die Zeile nicht passt (bei 40 Spalten zu breit, Review 0.8.1 K6)
        row({ marginTop: 1, flexWrap: 'wrap' }, [
          sf === 'desktop'
            ? cell(nameW, el('Text', {}, [text('■ ', { color: colors.get(m.key)! }), text(names[i]!, { bold: true })]))
            : cell(nameW, text(names[i]!, { bold: true })),
          ...(sf === 'desktop' ? [] : [bar(sf, sum > 0 ? m.usd / sum : 0, cells, colors.get(m.key)!)]),
          cell(6, dim(`${share(m.usd)} %`), true),
          cell(10, text(usd(m.usd, lang)), true),
          cell(8, dim(`${m.n}×`), true),
        ]),
        dim(t.tokenLine(tokens(m.in, lang), tokens(m.out, lang), tokens(m.cr, lang), tokens(m.cw, lang))),
      ])
    : [dim(t.noTokens)]
  if (sf === 'desktop' && sum > 0) {
    const alt = r.models.map((m, i) => `${names[i]} ${share(m.usd)} %`).join(', ')
    const pic = donutSvg(
      r.models.map((m) => ({ hex: THEME_HEX[colors.get(m.key)!] ?? THEME_HEX.inactive!, share: m.usd })),
      usd(sum, lang),
      alt,
    )
    const svg: RenderElement = { type: 'Svg', props: { source: pic.source, alt: pic.alt, width: pic.width, height: pic.height } }
    kids.unshift(el('Box', { marginTop: 1 }, [svg]))
  }
  kids.push(el('Box', { marginTop: 1 }, [dim(t.modelsNote)]))
  return col({}, [heading(title), ...kids])
}

/**
 * Ampel für die Auslastung eines Limit-Fensters: grün unter 70 %, gelb unter 90 %, rot ab 90 % (SPEC Nachtrag 0.5.0).
 * Nach der angezeigten, gerundeten Zahl, damit „70 %“ nie grün ist (`percentUsed` hat eine Nachkommastelle).
 */
function limColor(p: number): string {
  const v = Math.round(p || 0)
  return v >= 90 ? RED : v >= 70 ? YELLOW : 'success'
}

/**
 * Ein Limit-Fenster (5 Stunden oder Woche): Überschrift mit Reset und Countdown (Stand beim Aufruf), rechts „ab …“, falls
 * das Fenster vor der ersten Fenster-Buchung begann; darunter Balken = % genutzt, %, API-Wert und die Hochrechnung.
 */
function windowBlock(
  w: LimWindow | null,
  seen: boolean,
  title: string,
  k: number | null,
  l: LimitsReport,
  now: number,
  sf: Surface,
  inner: number,
  lang: Lang,
): RenderNode[] {
  const t = T[lang]
  if (!w) return [heading(title), dim(seen ? t.resetPassed : t.noWindowYet)]
  const from = partialLabel(w, l.limSince, lang)
  const head = row({ justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 1 }, [
    text(`${title} · ${t.resetAt(resetTime(w.resetsAt, now, lang))} (${t.inTime(duration(w.resetsAt - now, lang))})`, { color: ORANGE, bold: true }),
    ...(from ? [dim(from)] : []),
  ])
  // Terminal: Balken, % 7, Betrag 12; die Hochrechnung bricht bei schmaler Breite in die nächste Zeile um
  const cells = Math.max(6, Math.min(32, inner - 7 - 12 - 1))
  const line = row({ flexWrap: 'wrap' }, [
    bar(sf, w.pct / 100, cells, limColor(w.pct)),
    cell(7, text(pct(w.pct), { color: limColor(w.pct) }), true),
    cell(12, text(usd(w.usd, lang), { bold: true }), true),
    el('Box', { paddingLeft: 3 }, [dim(projectionText(w, lang))]),
  ])
  // Geschätzter Anteil außerhalb des Ledgers (SPEC Nachtrag 0.7.0, Verhalten 4)
  const outside = outsideText(w, k, lang)
  return [head, line, ...(outside ? [dim(outside)] : [])]
}

function planBlock(l: LimitsReport, lang: Lang): RenderNode[] {
  const t = T[lang]
  if (!l.plan) return [heading(t.subMonth), dim(t.planNotSet)]
  const p = planLine(l.plan, lang)
  return [heading(`${t.subMonth} · ${p.head}`), el('Text', {}, [text(p.value), ...(p.note ? [dim(` · ${p.note}`)] : [])])]
}

/** Die letzten 10 Fünf-Stunden-Fenster: Balken = API-Wert relativ zum teuersten, Farbe nach % wie oben; darunter das Ø. */
function windowsHistory(l: LimitsReport, sf: Surface, inner: number, lang: Lang): RenderNode[] {
  const t = T[lang]
  const max = Math.max(0, ...l.history.map((w) => w.usd))
  const labelW = 19
  // Beschriftung 19, Betrag 10, % 7, Marke 15 („  outside 100 %“) → der Rest ist Balken. Reicht die Breite nicht, brechen
  // die Zellen um: Der kleinste Balken braucht im Terminal 5 Zellen, im Desktop minWidth 6 + marginRight 1 (stackedBar)
  const markW = 15
  const cells = Math.max(4, Math.min(24, inner - labelW - 10 - 7 - markW - 1))
  const narrow = inner < labelW + (sf === 'desktop' ? 7 : cells + 1) + 10 + 7 + markW
  // Marke: läuft, unvollständig ab …, sonst der geschätzte Anteil außerhalb des Ledgers
  const mark = (w: LimWindow) =>
    w.running ? `  ${t.running}` : w.partial ? `  ${partialLabel(w, l.limSince, lang)}` : w.outside !== null ? `  ${t.outsideShort(pct(w.outside))}` : ''
  const rows = l.history.map((w) =>
    row(narrow ? { flexWrap: 'wrap' } : {}, [
      cell(labelW, dim(span(w.start, w.resetsAt, lang))),
      bar(sf, max > 0 ? w.usd / max : 0, cells, limColor(w.pct)),
      cell(10, text(usd(w.usd, lang)), true),
      cell(7, dim(pct(w.pct)), true),
      cell(markW, dim(mark(w))),
    ]),
  )
  return [
    heading(t.lastWindows),
    ...(rows.length ? rows : [dim(t.noWindows)]),
    el('Box', { marginTop: 1 }, [l.avg ? text(t.avg(usd(l.avg.usd, lang), l.avg.n)) : dim(t.avgNone)]),
  ]
}

/** `/ledger limits`: 5 Stunden, Woche, Abo-Monat, Verlauf; ohne Limit-Daten ein Hinweis statt der Fenster. */
function limitsBlocks(r: Report, sf: Surface, inner: number, lang: Lang): RenderNode[] {
  const t = T[lang]
  const l = r.limits
  if (!l.seenFive && !l.seenWeek)
    return [el('Box', { marginTop: 1 }, [text(t.noLimitData)]), ...(l.plan ? planBlock(l, lang) : [dim(t.planNotSet)])]
  return [
    ...windowBlock(l.five, l.seenFive, t.fiveHours, l.calib.five, l, r.now, sf, inner, lang),
    ...windowBlock(l.week, l.seenWeek, t.week, l.calib.week, l, r.now, sf, inner, lang),
    ...planBlock(l, lang),
    ...windowsHistory(l, sf, inner, lang),
  ]
}

/** Abo und Limits oben in der Übersicht, je eine Zeile in Klartext (`overviewLimits`). Entfällt ohne Fenster und ohne Plan. */
function limitsLine(r: Report, lang: Lang): RenderElement | null {
  const lines = overviewLimits(r.limits, lang)
  if (!lines.length) return null
  const piece = (p: { text: string; dim?: boolean; pct?: number }) =>
    p.pct !== undefined ? text(p.text, { color: limColor(p.pct) }) : p.dim ? dim(p.text) : text(p.text)
  return col({ marginTop: 1 }, lines.map((l) => el('Text', {}, l.map(piece))))
}

/** Mod-Aufrufe in der Übersicht: eine gedimmte Zeile, denn sie stecken schon in den Beträgen. */
function modsLine(r: Report, lang: Lang): RenderElement | null {
  const t = T[lang]
  if (!r.mods.length) return null
  const list = r.mods.slice(0, 4).map((m) => `${projectLabel(m.name, lang)} ${usd(m.usd, lang)} (${m.calls}×)`).join(' · ')
  return el('Box', { marginTop: 1 }, [dim(`${t.ovModsOf(list)}${r.mods.length > 4 ? ` · ${t.more(r.mods.length - 4)}` : ''} · ${t.modsExtra}`)])
}

/** Der Befehl, der dieselbe Ansicht mit frischen Zahlen zeichnet (samt Zeitraum). */
function reloadCommand(v: View): string {
  if (v.view === 'overview') return '/ledger'
  if (v.view === 'weeks' || v.view === 'limits') return `/ledger ${v.view}`
  return `/ledger ${v.view}${v.range === 30 ? '' : v.range <= 0 ? ' all' : ` ${v.range}`}`
}

/** Der ganze Baum für eine `CommandOutput`-Zeile von `/ledger`; `columns` dient nur als Richtwert (Terminal-Balken, Umbruch). */
export function ledgerTree(v: View, s: Settings, columns: number, surface: Surface = 'terminal'): RenderElement {
  const lang = s.lang
  const t = T[lang]
  const r = v.report
  const cols = Math.max(30, Math.min(columns || 100, 140))
  const inner = cols - 4 // Rahmen und paddingX
  const limits = v.view === 'limits'
  // Übersicht und Wochen (ab 0.8.0): oben ein Satz, was „API-Wert“ heißt; unten statt der Fußzeile die anderen Ansichten
  const over = v.view === 'overview' || v.view === 'weeks'
  // Ohne Knopf (er bräuchte neue Rechte): oben rechts Stand und wie man neu lädt; bei den Limits statt „seit“ der Plan
  const first = limits ? (r.limits.plan ? `${planLabel(r.limits.plan.plan)} · ` : '') : r.since ? `${t.since(fullDate(r.since, lang))} · ` : ''
  const dev = devicesLabel(r, lang)
  const stand = `${first}${dev ? `${dev} · ` : ''}${t.asOf(dateTime(r.now, lang))}${over ? '' : ` · ${t.reload(reloadCommand(v))}`}`
  const head = row({ justifyContent: 'space-between', flexWrap: 'wrap' }, [text(limits ? t.limitsHead : 'cost-ledger', { color: ORANGE, bold: true }), dim(stand)])
  const notes: RenderNode[] = notesOf(r, lang).map((n) => text(n, { color: YELLOW }))
  const explain: RenderNode[] = over ? [dim(t.ovExplain)] : []
  const foot = el('Box', { marginTop: 1 }, [dim(limits ? t.limitsFoot : over ? t.ovMore : t.foot)])
  const frame = (kids: RenderNode[]) => col({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%' }, [head, ...explain, ...notes, ...kids, foot])

  // Limits gibt es auch ohne Buchung (Plan eingestellt, Messung dieses Prozesses)
  if (limits) return frame(limitsBlocks(r, surface, inner, lang))
  // Die Limit-Zeile entfällt nur ohne Fenster und ohne Plan, auch im Leerzustand (z. B. direkt nach /ledger reset)
  const lim = v.view === 'overview' || v.view === 'weeks' ? limitsLine(r, lang) : null
  if (r.total === 0) return frame([...(lim ? [lim] : []), el('Box', { marginTop: 1 }, [text(t.empty)])])
  const range = rangeLabel(v.range, lang)
  if (v.view === 'chats') return frame([chatsBlock(r, t.chatsIn(range), inner, 20, '100%', lang)])
  if (v.view === 'projects') return frame([projectsBlock(r, t.projectsIn(range), surface, inner, 40, '100%', lang)])
  if (v.view === 'models') return frame([modelsBlock(r, t.modelsIn(range), surface, inner, lang)])

  const w = r.windows
  const d30 = rangeLabel(30, lang)
  // Spalten als Prozent der Zeile (nie breiter als die Zeile): zwei Blöcke ab etwa 90 Zeichen, vier Kennzahlen ab 80
  const side = inner >= 90
  const half = side ? Math.floor(inner / 2) - 2 : inner
  const fw = inner >= 80 ? '25%' : inner >= 40 ? '50%' : '100%'
  // Reihenfolge: wie viel (Kennzahlen), was das im Abo heißt (Abo, Limits), wann (Verlauf), wofür (Projekte, Chats, Mods),
  // und dieser Chat (Hier). Fynn 2026-11-03, Bau 0.8.0
  const mods = modsLine(r, lang)
  return frame([
    row({ flexWrap: 'wrap', marginTop: 1 }, [
      figure(t.today, w.today, fw, lang),
      figure(t.days7, w.d7, fw, lang),
      figure(t.days30, w.d30, fw, lang),
      figure(t.allTime, w.all, fw, lang),
    ]),
    ...(lim ? [lim] : []),
    ...historyBlock(r, s, surface, inner, v.view === 'weeks'),
    row({ flexWrap: 'wrap' }, [
      projectsBlock(r, t.projectsIn(d30), surface, half, 8, side ? '50%' : '100%', lang),
      chatsBlock(r, t.chatsIn(d30), half, 5, side ? '50%' : '100%', lang),
    ]),
    ...(mods ? [mods] : []),
    ...(v.here ? [el('Box', { marginTop: 1 }, [el('Text', {}, [text(v.here), dim(' (/ledger here)')])])] : []),
  ])
}
