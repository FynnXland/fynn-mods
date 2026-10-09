// sidekick: /savings als reiner Datenbaum {type, props, children} (types RenderElement), ohne $.ui.resolve (SPEC Nachtrag 0.5.0).
// Stil wie cost-ledger view.ts: Rahmen, Claude-Orange nur für Überschriften, Beträge in normaler Schrift, Nebensachen gedimmt;
// Farbe tragen nur die Balken. Spalten sind Boxen mit fester Breite. Im Desktop sind Balken Boxen mit Hintergrundfarbe und
// ganzzahliger Prozentbreite (Kommaprozente verwirft er, cost-ledger-Befund), im Terminal dünne `▄`.
import type { RenderElement, RenderNode } from 'claude-code'
import { tokensText, t, usdFine, usdText } from './i18n.ts'
import { ARTS, ROLES, active, compareNote, dayModels, dayRows, factorText, keyDate, modelCompare, perText, modelRows, periodTitle, ratioOf, savedOf, secsText, spanLabel, spanOf } from './logic.ts'
import type { Day, Period, Span } from './logic.ts'
import { modelLabel } from './models.ts'
import { RULE_IDS } from './wartung.ts'

export type Surface = 'terminal' | 'desktop'

// Theme-Keys statt fester Hex-Werte: Sie folgen dem Theme des Nutzers, hell wie dunkel (types Color/ThemeKey)
const ORANGE = 'claude'
const GREEN = 'success'
const MODEL_COLORS = ['claude', 'suggestion', 'permission', 'warning', 'planMode', 'ide', 'remember']
const EARLIER_COLOR = 'inactive'
const DAY_COLOR = 'suggestion'

type Props = Record<string, string | number | boolean>

function el(type: 'Box' | 'Text', props: Props, children: RenderNode[]): RenderElement {
  return { type, props, children }
}
const text = (s: string, props: Props = {}) => el('Text', props, [s])
const dim = (s: string) => text(s, { dimColor: true })
const row = (props: Props, kids: RenderNode[]) => el('Box', { flexDirection: 'row', ...props }, kids)
const col = (props: Props, kids: RenderNode[]) => el('Box', { flexDirection: 'column', ...props }, kids)
/** Feste Spalte; `right` richtet den Inhalt rechts aus (Beträge, Zahlen). */
const cell = (width: number, kid: RenderNode, right = false) => el('Box', { width, flexShrink: 0, ...(right ? { justifyContent: 'flex-end' } : {}) }, [kid])
const heading = (s: string) => el('Box', { marginTop: 1 }, [text(s, { color: ORANGE, bold: true })])
/** Markdown-Zeichen aus den gemeinsamen Texten entfernen (`**`, Backticks, kursive Sternchen, Listenstrich). */
const plain = (s: string) => s.replace(/\*\*|`/g, '').replace(/^\*|\*$/g, '').replace(/^- /, '')

/** Balken der Länge `ratio` (0–1). Desktop: Box in ganzzahliger Prozentbreite, mindestens 1 %; Terminal: ganze Zellen `▄`. */
function bar(surface: Surface, ratio: number, cells: number, color: string): RenderElement {
  const r = Math.max(0, Math.min(1, ratio || 0))
  if (surface === 'desktop') {
    const pct = r > 0 ? Math.max(1, Math.round(r * 100)) : 0
    const fill = pct > 0 ? [el('Box', { width: `${pct}%`, backgroundColor: color }, [' '])] : [' ']
    return el('Box', { flexGrow: 1, minWidth: 6, marginRight: 1 }, fill)
  }
  const n = Math.max(1, cells)
  const on = r > 0 ? Math.max(1, Math.round(r * n)) : 0
  return el('Box', { width: n + 1, flexShrink: 0 }, [on ? text('▄'.repeat(on), { color }) : ' '])
}

/** Eine Kennzahl: Überschrift gedimmt, Wert fett, darunter eine gedimmte Zeile. */
const figure = (label: string, value: string, sub: string, width: string) => col({ width, paddingRight: 2 }, [dim(label), text(value, { bold: true }), dim(sub)])

/** Kopfzeile einer Tabelle (gedimmt) oder eine Zeile: erste Spalte breit, die übrigen rechtsbündig. */
function tableRow(first: string, rest: (string | number)[], w0: number, head = false): RenderElement {
  const t0 = head ? dim(first) : text(first)
  return row({}, [cell(w0, t0), ...rest.map((v) => cell(12, head ? dim(String(v)) : text(String(v)), true))])
}

/** Ersparnis je Posten als Balken; `full` (Details): dazu die nur gezählten Annahmen und die Rechenweise. */
function savingsBlock(d: Day, sf: Surface, inner: number, full: boolean): RenderElement[] {
  const x = t()
  const saved = savedOf(d)
  const items = [
    { label: x.vColdAvoided, n: d.kaltVermieden.n, usd: d.kaltVermieden.usd },
    { label: x.vWarmNew, n: d.neuWarm.n, usd: d.neuWarm.usd },
  ]
  const nameW = Math.min(28, Math.max(14, ...items.map((i) => i.label.length + 1)))
  const cells = Math.max(6, Math.min(32, inner - nameW - 12 - 6 - 1))
  const rows = items.map((i) =>
    row({}, [cell(nameW, text(i.label)), bar(sf, saved > 0 ? i.usd / saved : 0, cells, GREEN), cell(12, i.usd ? text(usdText(i.usd)) : dim('–'), true), cell(6, dim(`${i.n}×`), true)]),
  )
  if (!full) return [heading(x.vSavingsHead), ...rows]
  const accepted = (['fassung', 'skill', 'modell'] as const).map((a) => `${x.art[a]} ${d.hinweise[a]?.angenommen ?? 0}`).join(' · ')
  return [heading(x.vSavingsHead), ...rows, el('Box', { marginTop: 1 }, [dim(x.vAccepted(accepted))]), dim(x.vFormula)]
}

/** Farbe eines Modells: nach seinem Platz in `modelRows`, in Modell- und Vergleichsblock gleich. */
const colorOf = (d: Day, key: string) => {
  const i = modelRows(d).list.findIndex((m) => m.key === key)
  return i < 0 ? EARLIER_COLOR : MODEL_COLORS[i % MODEL_COLORS.length]!
}

const usedLine = (s: Span | null) => (s ? [dim(t().vUsed(spanLabel(s), s.days))] : [])

/** Je Modell: Anteil an den eigenen Kosten als Balken, Betrag, Aufrufe; darunter je Rolle Anzahl, Dauer und Preis je Aufruf, Tokens und Zeitraum. */
function modelsBlock(d: Day, days: Record<string, Day>, sf: Surface, inner: number): RenderElement {
  const x = t()
  const { list, earlier } = modelRows(d)
  const sum = list.reduce((a, m) => a + m.usd, 0) + earlier.usd
  const names = list.map((m) => modelLabel(m.key))
  const nameW = Math.min(18, Math.max(10, ...names.map((n) => n.length + 1), x.vEarlier.length + 1))
  const cells = Math.max(6, Math.min(32, inner - nameW - 6 - 12 - 6 - 1))
  const pct = (v: number) => `${sum > 0 ? Math.round((v / sum) * 100) : 0} %`
  const kids: RenderNode[] = list.flatMap((m, i) => {
    const color = MODEL_COLORS[i % MODEL_COLORS.length]!
    const calls = ROLES.reduce((a, r) => a + m.m[r].n, 0)
    const roles = ROLES
      .filter((r) => m.m[r].n)
      .map((r) => x.vRoleLine(x.role[r], m.m[r].n, secsText(m.m[r].ms, m.m[r].n), usdFine(m.m[r].usd / m.m[r].n)))
    return [
      row({ marginTop: 1 }, [cell(nameW, text(names[i]!, { bold: true })), bar(sf, sum > 0 ? m.usd / sum : 0, cells, color), cell(6, dim(pct(m.usd)), true), cell(12, text(usdText(m.usd)), true), cell(6, dim(`${calls}×`), true)]),
      ...roles.map((r) => dim(r)),
      dim(x.vTokens(tokensText(m.m.in), tokensText(m.m.out))),
      ...usedLine(spanOf(days, (x2) => !!x2.modelle[m.key])),
    ]
  })
  if (earlier.usd) {
    kids.push(
      row({ marginTop: 1 }, [cell(nameW, dim(x.vEarlier)), bar(sf, sum > 0 ? earlier.usd / sum : 0, cells, EARLIER_COLOR), cell(6, dim(pct(earlier.usd)), true), cell(12, text(usdText(earlier.usd)), true), cell(6, dim(earlier.n ? `${earlier.n}×` : ''), true)]),
      dim(x.vEarlierNote),
      ...usedLine(spanOf(days, (x2) => modelRows(x2).earlier.usd > 0)),
    )
  }
  if (!kids.length) kids.push(dim(x.vNoModels))
  return col({}, [heading(x.vModelsHead), ...kids])
}

function hintsBlock(d: Day): RenderElement {
  const x = t()
  const hs = ARTS.filter((a) => d.hinweise[a])
  if (!hs.length) return col({}, [heading(x.vHintsHead), dim(x.vNone)])
  const w0 = Math.min(22, Math.max(12, ...hs.map((a) => x.art[a].length + 1)))
  const c = x.vHintCols
  const rows = hs.map((a) => {
    const h = d.hinweise[a]!
    return tableRow(x.art[a], [h.gezeigt, h.angenommen, h.ignoriert, h.abgebrochen], w0)
  })
  return col({}, [heading(x.vHintsHead), tableRow(c.art, [c.gezeigt, c.angenommen, c.ignoriert, c.abgebrochen], w0, true), ...rows])
}

function wartungBlock(d: Day): RenderElement | null {
  const x = t()
  const ws = RULE_IDS.filter((id) => d.wartung[id])
  if (!ws.length) return null
  const w0 = Math.min(24, Math.max(12, ...ws.map((id) => x.rule[id].length + 1)))
  const c = x.vHintCols
  return col({}, [
    heading(x.vWartungHead),
    tableRow('', [c.gezeigt, c.angenommen], w0, true),
    ...ws.map((id) => tableRow(x.rule[id], [d.wartung[id]!.gezeigt, d.wartung[id]!.angenommen], w0)),
  ])
}

/** „Gut zu wissen“ (Nachtrag 0.13.0): Prüfungen, Kosten, Dauer, was daraus wurde; getrennt von Kosten und Verhältnis. */
function notesBlock(d: Day, full: boolean): RenderElement | null {
  const x = t()
  const nz = d.notizen
  if (!nz.n) return null
  const lines = [x.vNotesLine(nz.n, usdText(nz.usd), secsText(nz.ms, nz.n)), x.vNotesCounts(nz.gezeigt, nz.erklaert, nz.bekannt, nz.spaeter, nz.chat, nz.ignoriert)]
  if (full) lines.push(x.vNotesRest(nz.keins, nz.verworfen, nz.fehler))
  return col({ marginTop: full ? 0 : 1 }, [heading(x.vNotesHead), ...lines.map((l) => dim(l))])
}

function countsBlock(d: Day): RenderElement {
  const x = t()
  const sk = Object.entries(d.skills).sort((a, b) => b[1] - a[1])
  const lines = [
    x.checks(d.pruefungen, secsText(d.warteMs, d.pruefungen)),
    x.handoffs(d.uebergaben, d.hinweise.modell?.gezeigt ?? 0),
    x.coldWithout(d.kaltOhne.n, usdText(d.kaltOhne.usd)),
    x.skillsUsed(sk.slice(0, 8).map(([k, v]) => `${k} ${v}×`).join(', ')),
  ]
  return col({}, [heading(x.vCountsHead), ...lines.map((l) => text(plain(l)))])
}

/**
 * Vergleich der Prüfung je Modell (`/savings detail`): Balken = Preis je Prüfung im Verhältnis zum teuersten, dazu Preis, Dauer,
 * Anzahl, Faktor zum günstigsten; darunter je Zeile Ø Tokens und Zeitraum (`compareNote`). Nur ab zwei Zeilen (sonst gibt es nichts zu vergleichen).
 */
function compareBlock(d: Day, days: Record<string, Day>, sf: Surface, inner: number): RenderElement | null {
  const x = t()
  const rows = modelCompare(d, days)
  if (rows.length < 2) return null
  const c = x.vCompareCols
  const nameW = Math.min(18, Math.max(10, ...rows.map((r) => r.label.length + 1)))
  const cells = Math.max(6, Math.min(32, inner - nameW - 14 - 8 - 7 - 9 - 1))
  const max = Math.max(...rows.map((r) => r.per))
  const head = row({}, [cell(nameW, dim(c.model)), bar(sf, 0, cells, EARLIER_COLOR), cell(14, dim(c.per), true), cell(8, dim(c.time), true), cell(7, dim(c.n), true), cell(9, dim(c.factor), true)])
  const kids: RenderNode[] = rows.map((r) =>
    row({}, [
      cell(nameW, r.key ? text(r.label, { bold: true }) : dim(r.label)),
      bar(sf, max > 0 ? r.per / max : 0, cells, r.key ? colorOf(d, r.key) : EARLIER_COLOR),
      cell(14, text(perText(r)), true),
      cell(8, dim(secsText(r.ms, r.n)), true),
      cell(7, dim(`${r.n}×`), true),
      cell(9, r.factor ? text(factorText(r)) : dim('–'), true),
    ]),
  )
  const notes = rows.map(compareNote).filter(Boolean).map((n) => dim(n))
  const bound = rows.some((r) => r.bound)
  return col({}, [
    heading(x.vCompareHead),
    head,
    ...kids,
    el('Box', { marginTop: 1, flexDirection: 'column' }, [...notes, ...(bound ? [dim(x.compareMixed)] : []), dim(x.vCompareNote)]),
  ])
}

/** Verlauf je Tag, neueste zuerst: Kosten als Balken (im Verhältnis zum teuersten Tag), Kosten, Ersparnis, Prüfungen, Modelle. */
function daysBlock(days: Record<string, Day>, sf: Surface, inner: number): RenderElement | null {
  const x = t()
  const { list, more } = dayRows(days)
  if (!list.length) return null
  const models = list.map((r) => dayModels(r.d))
  // Modelle als eigene Spalte nur, wenn Platz ist; sonst gedimmt darunter
  const mw = Math.min(34, Math.max(0, ...models.map((m) => m.length + 1)))
  const side = inner >= 76 && mw > 0
  const cells = Math.max(6, Math.min(24, inner - 9 - 12 - 12 - 6 - (side ? mw : 0) - 1))
  const max = Math.max(...list.map((r) => r.d.kosten))
  const kids: RenderNode[] = list.flatMap((r, i) => {
    const line = row({}, [
      cell(9, text(keyDate(r.key))),
      bar(sf, max > 0 ? r.d.kosten / max : 0, cells, DAY_COLOR),
      cell(12, text(usdText(r.d.kosten)), true),
      cell(12, savedOf(r.d) ? text(usdText(savedOf(r.d))) : dim('–'), true),
      cell(6, dim(`${r.d.pruefungen}×`), true),
      ...(side ? [el('Box', { width: mw, flexShrink: 0, paddingLeft: 2 }, [dim(models[i]!)])] : []),
    ])
    return side || !models[i] ? [line] : [line, dim(`  ${models[i]}`)]
  })
  if (more) kids.push(dim(x.vDaysMore(more)))
  return col({}, [heading(x.vDaysHead), ...kids])
}

/**
 * Der ganze Baum für die `CommandOutput`-Zeile von `/savings`; `columns` dient nur als Richtwert (Terminal-Balken, Umbruch).
 * Ohne `days`: knappe Karte (Kennzahlen, Ersparnis). Mit `days` (`/savings detail`): alles, dazu Vergleich und Verlauf je Tag.
 */
export function savingsTree(d: Day, p: Period, now: number, columns: number, surface: Surface = 'terminal', days?: Record<string, Day>): RenderElement {
  const x = t()
  const cols = Math.max(30, Math.min(columns || 100, 140))
  const inner = cols - 4 // Rahmen und paddingX
  const cmd = days ? '/savings detail today · week · all' : '/savings today · week · all'
  const head = row({ justifyContent: 'space-between', flexWrap: 'wrap' }, [
    text(days ? `sidekick · ${x.detailWord}` : 'sidekick', { color: ORANGE, bold: true }),
    dim(`${periodTitle(p, now)} · ${cmd}`),
  ])
  const fw = inner >= 60 ? '33%' : '100%'
  const figures = row({ flexWrap: 'wrap', marginTop: 1 }, [
    figure(x.vCost, usdText(d.kosten), x.vCostSub(d.pruefungen, d.uebergaben, d.modelle ? Object.values(d.modelle).reduce((a, m) => a + m.aufteilung.n, 0) : 0), fw),
    figure(x.vSaved, usdText(savedOf(d)), x.vSavedSub(d.kaltVermieden.n + d.neuWarm.n), fw),
    figure(x.vRatio, ratioOf(d), x.vRatioSub, fw),
  ])
  const box = (kids: RenderNode[]) => col({ key: 'sidekick-savings', borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%' }, kids)
  if (!days) {
    const notes = notesBlock(d, false)
    return box([head, figures, ...savingsBlock(d, surface, inner, false), ...(notes ? [notes] : []), el('Box', { marginTop: 1 }, [dim(x.vMore)])])
  }
  const span = spanOf(days, active)
  const nodes = [
    compareBlock(d, days, surface, inner),
    daysBlock(days, surface, inner),
    hintsBlock(d),
    wartungBlock(d),
    notesBlock(d, true),
  ].filter((n): n is RenderElement => n !== null)
  return box([
    head,
    ...(span ? [dim(x.vSpan(keyDate(span.from), keyDate(span.to), span.days))] : []),
    figures,
    ...savingsBlock(d, surface, inner, true),
    modelsBlock(d, days, surface, inner),
    ...nodes,
    countsBlock(d),
    el('Box', { marginTop: 1 }, [dim(plain(x.savingsFoot))]),
  ])
}
