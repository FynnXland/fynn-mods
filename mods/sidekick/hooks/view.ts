// sidekick: /savings als reiner Datenbaum {type, props, children} (types RenderElement), ohne $.ui.resolve (SPEC Nachtrag 0.5.0).
// Stil wie cost-ledger view.ts: Rahmen, Claude-Orange nur für Überschriften, Beträge in normaler Schrift, Nebensachen gedimmt;
// Farbe tragen nur die Balken. Spalten sind Boxen mit fester Breite. Im Desktop sind Balken Boxen mit Hintergrundfarbe und
// ganzzahliger Prozentbreite (Kommaprozente verwirft er, cost-ledger-Befund), im Terminal dünne `▄`.
import type { RenderElement, RenderNode } from 'claude-code'
import { dec, tokensText, t, usdText } from './i18n.ts'
import { ARTS, modelRows, periodTitle, secsText } from './logic.ts'
import type { Day, Period } from './logic.ts'
import { modelLabel } from './models.ts'
import { RULE_IDS } from './wartung.ts'

export type Surface = 'terminal' | 'desktop'

// Theme-Keys statt fester Hex-Werte: Sie folgen dem Theme des Nutzers, hell wie dunkel (types Color/ThemeKey)
const ORANGE = 'claude'
const GREEN = 'success'
const MODEL_COLORS = ['claude', 'suggestion', 'permission', 'warning', 'planMode', 'ide', 'remember']
const EARLIER_COLOR = 'inactive'

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

function savingsBlock(d: Day, sf: Surface, inner: number): RenderElement[] {
  const x = t()
  const saved = d.kaltVermieden.usd + d.neuWarm.usd
  const items = [
    { label: x.vColdAvoided, n: d.kaltVermieden.n, usd: d.kaltVermieden.usd },
    { label: x.vWarmNew, n: d.neuWarm.n, usd: d.neuWarm.usd },
  ]
  const nameW = Math.min(28, Math.max(14, ...items.map((i) => i.label.length + 1)))
  const cells = Math.max(6, Math.min(32, inner - nameW - 12 - 6 - 1))
  const rows = items.map((i) =>
    row({}, [cell(nameW, text(i.label)), bar(sf, saved > 0 ? i.usd / saved : 0, cells, GREEN), cell(12, i.usd ? text(usdText(i.usd)) : dim('–'), true), cell(6, dim(`${i.n}×`), true)]),
  )
  const accepted = (['fassung', 'skill', 'modell'] as const).map((a) => `${x.art[a]} ${d.hinweise[a]?.angenommen ?? 0}`).join(' · ')
  return [heading(x.vSavingsHead), ...rows, el('Box', { marginTop: 1 }, [dim(x.vAccepted(accepted))]), dim(x.vFormula)]
}

/** Je Modell: Anteil an den eigenen Kosten als Balken, Betrag, Aufrufe; darunter je Rolle Anzahl, Dauer und Preis je Aufruf. */
function modelsBlock(d: Day, sf: Surface, inner: number): RenderElement {
  const x = t()
  const { list, earlier } = modelRows(d)
  const sum = list.reduce((a, m) => a + m.usd, 0) + earlier.usd
  const names = list.map((m) => modelLabel(m.key))
  const nameW = Math.min(18, Math.max(10, ...names.map((n) => n.length + 1), x.vEarlier.length + 1))
  const cells = Math.max(6, Math.min(32, inner - nameW - 6 - 12 - 6 - 1))
  const pct = (v: number) => `${sum > 0 ? Math.round((v / sum) * 100) : 0} %`
  const kids: RenderNode[] = list.flatMap((m, i) => {
    const color = MODEL_COLORS[i % MODEL_COLORS.length]!
    const calls = m.m.pruefung.n + m.m.uebergabe.n
    const roles = (['pruefung', 'uebergabe'] as const)
      .filter((r) => m.m[r].n)
      .map((r) => x.vRoleLine(x.role[r], m.m[r].n, secsText(m.m[r].ms, m.m[r].n), usdText(m.m[r].usd / m.m[r].n)))
    return [
      row({ marginTop: 1 }, [cell(nameW, text(names[i]!, { bold: true })), bar(sf, sum > 0 ? m.usd / sum : 0, cells, color), cell(6, dim(pct(m.usd)), true), cell(12, text(usdText(m.usd)), true), cell(6, dim(`${calls}×`), true)]),
      ...roles.map((r) => dim(r)),
      dim(x.vTokens(tokensText(m.m.in), tokensText(m.m.out))),
    ]
  })
  if (earlier.usd) {
    kids.push(
      row({ marginTop: 1 }, [cell(nameW, dim(x.vEarlier)), bar(sf, sum > 0 ? earlier.usd / sum : 0, cells, EARLIER_COLOR), cell(6, dim(pct(earlier.usd)), true), cell(12, text(usdText(earlier.usd)), true), cell(6, dim(earlier.n ? `${earlier.n}×` : ''), true)]),
      dim(x.vEarlierNote),
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

/** Der ganze Baum für die `CommandOutput`-Zeile von `/savings`; `columns` dient nur als Richtwert (Terminal-Balken, Umbruch). */
export function savingsTree(d: Day, p: Period, now: number, columns: number, surface: Surface = 'terminal'): RenderElement {
  const x = t()
  const cols = Math.max(30, Math.min(columns || 100, 140))
  const inner = cols - 4 // Rahmen und paddingX
  const head = row({ justifyContent: 'space-between', flexWrap: 'wrap' }, [text('sidekick', { color: ORANGE, bold: true }), dim(`${periodTitle(p, now)} · /savings today · week · all`)])
  const saved = d.kaltVermieden.usd + d.neuWarm.usd
  const ratio = d.kosten > 0 && saved > 0 ? `1 : ${dec(saved / d.kosten, saved / d.kosten >= 10 ? 0 : 1)}` : '–'
  const fw = inner >= 60 ? '33%' : '100%'
  const w = wartungBlock(d)
  return col({ key: 'sidekick-savings', borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%' }, [
    head,
    row({ flexWrap: 'wrap', marginTop: 1 }, [
      figure(x.vCost, usdText(d.kosten), x.vCostSub(d.pruefungen, d.uebergaben), fw),
      figure(x.vSaved, usdText(saved), x.vSavedSub(d.kaltVermieden.n + d.neuWarm.n), fw),
      figure(x.vRatio, ratio, x.vRatioSub, fw),
    ]),
    ...savingsBlock(d, surface, inner),
    modelsBlock(d, surface, inner),
    hintsBlock(d),
    ...(w ? [w] : []),
    countsBlock(d),
    el('Box', { marginTop: 1 }, [dim(plain(x.savingsFoot))]),
  ])
}
