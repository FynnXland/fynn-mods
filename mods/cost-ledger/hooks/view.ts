// cost-ledger: die Übersicht als reiner Datenbaum {type, props, children} (types RenderElement), ohne $.ui.resolve.
// Nur Box und Text mit Props aus der Allowlist (API-DETAILS.md:1043-1080), sonst zeichnet die Engine ihr Original.
//
// Stil wie limit-bars: Claude-Orange nur für Überschriften, Beträge in normaler Schrift, Nebensachen gedimmt; Farbe tragen
// nur die Balken. Kein festes Außenmaß: Der Desktop meldet mehr Spalten, als er zeigt, und zeichnet Blockzeichen breiter
// als eine Zelle. Spalten sind deshalb Boxen mit fester Breite; im Desktop sind Balken Boxen mit Hintergrundfarbe und
// ganzzahliger Prozentbreite (Kommaprozente verwirft er), im Terminal dünne `▄`. Der leere Teil zeigt den Hintergrund.
import type { RenderElement, RenderNode } from 'claude-code'
import { T, dateTime, duration, factor, fullDate, pct, rangeLabel, resetTime, shortDate, span, tokens, usd, weekLabel } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { MOD_PART, UNKNOWN_MODEL, chatLabel, isoWeek, modelName, notesOf, partLabel, partialLabel, planLabel, planLine, projectLabel, projectionText } from './logic.ts'
import type { Bucket, LimWindow, LimitsReport, Report, Settings, ViewName } from './logic.ts'

export type View = { report: Report; view: ViewName; range: number }
type Surface = 'terminal' | 'desktop'

// Theme-Keys statt fester Hex-Werte: Sie folgen dem Theme des Nutzers, hell wie dunkel (types Color/ThemeKey).
const ORANGE = 'claude'
const YELLOW = 'warning'
const RED = 'error'
// Farben je Modell, nach Anteil vergeben; ohne Modell-Daten gedimmt
const MODEL_COLORS = ['claude', 'suggestion', 'success', 'permission', 'warning', 'planMode', 'ide', 'remember']
const UNKNOWN_COLOR = 'inactive'

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
 * Farbe je Verlaufsteil: erst die Chat-Modelle nach Gesamtbetrag, danach die Mod-Teile (`mod:…`), damit sie in der
 * Legende hinter dem Chat stehen. Beträge ohne Modell-Daten (Chat wie Mods) immer gedimmt.
 */
export function modelColors(buckets: Bucket[]): Map<string, string> {
  const tot = new Map<string, number>()
  for (const b of buckets) for (const p of b.parts) tot.set(p.key, (tot.get(p.key) ?? 0) + p.usd)
  const unknown = (k: string) => k === UNKNOWN_MODEL || k === MOD_PART + UNKNOWN_MODEL
  const isMod = (k: string) => (k.startsWith(MOD_PART) ? 1 : 0)
  const keys = [...tot.entries()]
    .filter(([k]) => !unknown(k))
    .sort((a, b) => isMod(a[0]) - isMod(b[0]) || b[1] - a[1])
    .map(([k]) => k)
  const out = new Map(keys.map((k, i) => [k, MODEL_COLORS[i % MODEL_COLORS.length]!]))
  for (const k of [UNKNOWN_MODEL, MOD_PART + UNKNOWN_MODEL]) if (tot.has(k)) out.set(k, UNKNOWN_COLOR)
  return out
}

/** Ampel für Tagesbeträge (`dayYellow`/`dayRed`); darunter die normale Schriftfarbe des Themes (`text`). */
function ampel(v: number, s: Settings): Props {
  return { color: v >= s.dayRed ? RED : v >= s.dayYellow ? YELLOW : 'text' }
}

function cut(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`
}

/** Eine Kennzahl: Überschrift gedimmt, Betrag fett, darunter Chats und Mods. */
function figure(label: string, w: { usd: number; chats: number; mods: number }, width: string, lang: Lang): RenderElement {
  return col({ width, paddingRight: 2 }, [dim(label), text(usd(w.usd, lang), { bold: true }), dim(`${T[lang].chats(w.chats)} · Mods ${usd(w.mods, lang)}`)])
}

/**
 * Verlauf der letzten 14 Tage oder Wochen: je Zeile ein Balken, geteilt nach Modell, darunter die Legende. Der Betrag ist
 * der echte Chat-Betrag plus die Mod-Aufrufe; die Aufteilung folgt den geschätzten Modell-Anteilen, Mod-Teile stehen in
 * der Legende als „Modell · Mods“. Die Ampel färbt bei Tagen den Betrag.
 */
function historyBlock(r: Report, s: Settings, sf: Surface, inner: number, weeks: boolean): RenderElement[] {
  const lang = s.lang
  const t = T[lang]
  const buckets = weeks ? r.series.weeks : r.series.days
  const colors = modelColors(buckets)
  const max = Math.max(0, ...buckets.map((b) => b.usd))
  const top = buckets.find((b) => b.usd === max && max > 0)?.key
  const labelW = 7
  // Terminal: Beschriftung, Betrag 10, Marke 12 → der Rest ist Balken
  const cells = Math.max(6, Math.min(32, inner - labelW - 10 - 12 - 1))
  const rows = buckets.map((b) =>
    row({}, [
      cell(labelW, dim(weeks ? weekLabel(isoWeek(b.key), lang) : shortDate(b.key, lang))),
      stackedBar(sf, max > 0 ? b.usd / max : 0, cells, b.parts.map((p) => ({ color: colors.get(p.key) ?? UNKNOWN_COLOR, share: b.usd > 0 ? p.usd / b.usd : 0 }))),
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
        row({}, [cell(3, ''), dim(`${projectLabel(c.project, lang)} · ${shortDate(c.lastDay, lang)}`)]),
      ])
    : [dim(T[lang].noCosts)]
  return col({ width: basis }, [heading(title), ...kids])
}

/** `/ledger models`: je Modell Anteil am geschätzten API-Wert als Balken, Betrag, Anzahl und darunter die Tokens. */
function modelsBlock(r: Report, title: string, sf: Surface, inner: number, lang: Lang): RenderElement {
  const t = T[lang]
  const sum = r.models.reduce((a, m) => a + m.usd, 0)
  const names = r.models.map((m) => modelName(m.key, lang))
  const nameW = Math.min(16, Math.max(10, ...names.map((n) => n.length + 1)))
  const cells = Math.max(6, Math.min(32, inner - nameW - 6 - 10 - 8 - 1))
  const kids: RenderNode[] = r.models.length
    ? r.models.flatMap((m, i) => [
        row({ marginTop: 1 }, [
          cell(nameW, text(names[i]!, { bold: true })),
          bar(sf, sum > 0 ? m.usd / sum : 0, cells, ORANGE),
          cell(6, dim(`${sum > 0 ? Math.round((m.usd / sum) * 100) : 0} %`), true),
          cell(10, text(usd(m.usd, lang)), true),
          cell(8, dim(`${m.n}×`), true),
        ]),
        dim(t.tokenLine(tokens(m.in, lang), tokens(m.out, lang), tokens(m.cr, lang), tokens(m.cw, lang))),
      ])
    : [dim(t.noTokens)]
  kids.push(el('Box', { marginTop: 1 }, [dim(t.modelsNote)]))
  return col({}, [heading(title), ...kids])
}

function modsBlock(r: Report, title: string, lang: Lang): RenderElement {
  const t = T[lang]
  const line = r.mods.length ? r.mods.map((m) => `${m.name} ${usd(m.usd, lang)} (${m.calls}×)`).join(' · ') : t.noModCalls
  return col({}, [heading(title), text(line, r.mods.length ? {} : { dimColor: true }), dim(t.modsExtra)])
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
function windowBlock(w: LimWindow | null, seen: boolean, title: string, l: LimitsReport, now: number, sf: Surface, inner: number, lang: Lang): RenderNode[] {
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
  return [head, line]
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
  // Beschriftung 19, Betrag 10, % 7, Marke 12 → der Rest ist Balken. Reicht die Breite nicht, brechen die Zellen um:
  // Der kleinste Balken braucht im Terminal 5 Zellen, im Desktop minWidth 6 + marginRight 1 (stackedBar)
  const cells = Math.max(4, Math.min(24, inner - labelW - 10 - 7 - 12 - 1))
  const narrow = inner < labelW + (sf === 'desktop' ? 7 : cells + 1) + 10 + 7 + 12
  const rows = l.history.map((w) =>
    row(narrow ? { flexWrap: 'wrap' } : {}, [
      cell(labelW, dim(span(w.start, w.resetsAt, lang))),
      bar(sf, max > 0 ? w.usd / max : 0, cells, limColor(w.pct)),
      cell(10, text(usd(w.usd, lang)), true),
      cell(7, dim(pct(w.pct)), true),
      cell(12, dim(w.running ? `  ${t.running}` : w.partial ? `  ${partialLabel(w, l.limSince, lang)}` : '')),
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
    ...windowBlock(l.five, l.seenFive, t.fiveHours, l, r.now, sf, inner, lang),
    ...windowBlock(l.week, l.seenWeek, t.week, l, r.now, sf, inner, lang),
    ...planBlock(l, lang),
    ...windowsHistory(l, sf, inner, lang),
  ]
}

/** Kompakte Limit-Zeile oben in der Übersicht; bricht bei schmaler Breite um. Entfällt ohne Fenster und ohne Plan. */
function limitsLine(r: Report, lang: Lang): RenderElement | null {
  const t = T[lang]
  const l = r.limits
  const money = (v: number) => usd(v, lang)
  const parts: RenderNode[][] = []
  if (l.five)
    parts.push([text(`${t.fiveShort} `), text(pct(l.five.pct), { color: limColor(l.five.pct) }), dim(' · '), text(money(l.five.usd)), dim(` · ${t.resetAt(resetTime(l.five.resetsAt, r.now, lang))}`)])
  else if (l.seenFive) parts.push([dim(`${t.fiveShort}: ${t.resetPassedShort}`)])
  if (l.week) parts.push([text(`${t.weekShort} `), text(pct(l.week.pct), { color: limColor(l.week.pct) }), dim(' · '), text(money(l.week.usd))])
  if (l.plan) parts.push([text(`${t.planShort} ${money(l.plan.usd)}`), ...(l.plan.factor !== null ? [dim(' = '), text(`${factor(l.plan.factor, lang)}×`)] : [])])
  if (!parts.length) return null
  const kids: RenderNode[] = parts.map((p, i) => el('Box', { marginRight: 1 }, [el('Text', {}, [...(i ? [dim('│ ')] : []), ...p])]))
  kids.push(dim('· /ledger limits'))
  return row({ flexWrap: 'wrap', marginTop: 1 }, kids)
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
  // Ohne Knopf (er bräuchte neue Rechte): oben rechts Stand und wie man neu lädt; bei den Limits statt „seit“ der Plan
  const first = limits ? (r.limits.plan ? `${planLabel(r.limits.plan.plan)} · ` : '') : r.since ? `${t.since(fullDate(r.since, lang))} · ` : ''
  const stand = `${first}${t.asOf(dateTime(r.now, lang))} · ${t.reload(reloadCommand(v))}`
  const head = row({ justifyContent: 'space-between', flexWrap: 'wrap' }, [text(limits ? t.limitsHead : 'cost-ledger', { color: ORANGE, bold: true }), dim(stand)])
  const notes: RenderNode[] = notesOf(r, lang).map((n) => text(n, { color: YELLOW }))
  const foot = el('Box', { marginTop: 1 }, [dim(limits ? t.limitsFoot : t.foot)])
  const frame = (kids: RenderNode[]) => col({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%' }, [head, ...notes, ...kids, foot])

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
  return frame([
    ...(lim ? [lim] : []),
    row({ flexWrap: 'wrap', marginTop: 1 }, [
      figure(t.today, w.today, fw, lang),
      figure(t.days7, w.d7, fw, lang),
      figure(t.days30, w.d30, fw, lang),
      figure(t.allTime, w.all, fw, lang),
    ]),
    ...historyBlock(r, s, surface, inner, v.view === 'weeks'),
    row({ flexWrap: 'wrap' }, [
      projectsBlock(r, t.projectsIn(d30), surface, half, 8, side ? '50%' : '100%', lang),
      chatsBlock(r, t.chatsIn(d30), half, 5, side ? '50%' : '100%', lang),
    ]),
    modsBlock(r, t.modsIn(d30), lang),
  ])
}
