// cost-ledger: `/ledger here` (SPEC Nachtrag 0.8.0). Was kostet dieses Projekt, was dieser Chat? Reine Funktionen ohne `$`.
// Desktop: ein Svg mit Ring (Anteil des Chats am Projekt) und der großen Zahl (API-Wert des Projekts), darunter die
// Fußzeile als Text in Theme-Farben. Terminal: dieselben Zahlen in wenigen Zeilen mit einem Balken statt des Rings.
import type { RenderElement, RenderNode } from 'claude-code'
import { T, dateTime, fullDate, rangeLabel, usd } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { NO_FOLDER, dayBefore, dayKey } from './logic.ts'
import type { Kind, Rec } from './logic.ts'

/** Alles, was Zeichnung und Text brauchen. `project` = `null`: Skript-Lauf oder Ordner unbekannt (Verhalten 6). */
export type Here = {
  now: number
  /** Tage einschließlich heute, `0` = seit Beginn der Aufzeichnung */
  range: number
  project: string | null
  projectUsd: number
  /** Chats des Projekts im Zeitraum mit Kosten (dieser eingeschlossen) */
  projectChats: number
  chatUsd: number
  /** Tage im Zeitraum, an denen dieser Chat etwas gebucht hat */
  chatDays: number
  /** Hat dieser Chat überhaupt schon etwas gebucht? */
  booked: boolean
  since: number | null
  /** Gerätenamen mit Sync (dieses zuerst); `null` = Sync aus */
  devices: string[] | null
  /** Hinweise wie in `/ledger` (Sync-Fehler, Gerät nicht lesbar, Schreibfehler, Speicher fast voll); Review 0.8.0 S3 */
  notes?: string[]
}

/** Summe eines Datensatzes im Zeitraum: Chat-Kosten und Mod-Aufrufe; dazu die Tage mit Buchung. */
function recSum(rec: Rec, inRange: (d: string) => boolean): { usd: number; days: Set<string> } {
  let sum = 0
  const days = new Set<string>()
  for (const [d, v] of Object.entries(rec.days))
    if (inRange(d) && v > 0) {
      sum += v
      days.add(d)
    }
  for (const m of Object.values(rec.mods))
    for (const [d, x] of Object.entries(m.days))
      if (inRange(d) && x.usd > 0) {
        sum += x.usd
        days.add(d)
      }
  return { usd: sum, days }
}

/**
 * Zahlen für `/ledger here`. `recs`: eigene und (mit Sync) fremde Datensätze; fremde mit gleichem Ordnernamen tragen schon
 * den Projektnamen dieses Geräts (`mergeRecs`). Skript-Läufe zählen wie in `/ledger projects` nicht zum Projekt.
 */
export function hereOf(
  recs: { id: string; rec: Rec }[],
  o: { now: number; range: number; sessionId: string; project: string; kind: Kind; since: number | null; devices: string[] | null; notes?: string[] },
): Here {
  const today = dayKey(o.now)
  const from = o.range > 0 ? dayBefore(o.now, o.range - 1) : ''
  const inRange = (d: string) => d <= today && (!from || d >= from)
  const project = o.kind === 'script' || !o.project || o.project === NO_FOLDER ? null : o.project
  const own = recs.find((x) => x.id === o.sessionId)?.rec
  const chat = own ? recSum(own, inRange) : { usd: 0, days: new Set<string>() }
  let projectUsd = 0
  let projectChats = 0
  if (project)
    for (const { id, rec } of recs) {
      if (rec.project !== project || (rec.kind === 'script' && id !== o.sessionId)) continue
      const s = recSum(rec, inRange)
      projectUsd += s.usd
      if (s.usd > 0) projectChats++
    }
  const booked = !!own && (Object.values(own.days).some((v) => v > 0) || Object.values(own.mods).some((m) => Object.keys(m.days).length > 0))
  return { now: o.now, range: o.range, project, projectUsd, projectChats, chatUsd: chat.usd, chatDays: chat.days.size, booked, since: o.since, devices: o.devices, notes: o.notes ?? [] }
}

/** Der Wert `cost-ledger.here` für limit-bars (SPEC Nachtrag 0.10.0, Vertrag in types/index.d.ts). */
export type HereState = { chatUsd: number; projectUsd: number | null; project: string | null; since: string; devices: number }

/**
 * Aus denselben Zahlen wie `/ledger here all` (`hereOf` mit `range` 0). `folder`: letzter Ordnername wie das Sync-Feld `proj`
 * (leer, wenn er nicht geteilt werden darf); ohne Projekt bleibt er weg. Beträge auf den Cent gerundet: Genauer zeigt sie keiner.
 */
export function hereState(h: Here, folder: string): HereState {
  const cent = (v: number) => Math.round(v * 100) / 100
  return {
    chatUsd: cent(h.chatUsd),
    projectUsd: h.project ? cent(h.projectUsd) : null,
    project: h.project && folder ? folder : null,
    since: dayKey(h.since ?? h.now),
    devices: Math.max(1, h.devices?.length ?? 1),
  }
}

/** Anteil des Chats am Projekt (0–1); `null` ohne Projekt oder ohne Projektkosten. */
export function shareOf(h: Here): number | null {
  if (!h.project || !(h.projectUsd > 0)) return null
  return Math.max(0, Math.min(1, h.chatUsd / h.projectUsd))
}

/** Anteil als Text mit einer Nachkommastelle: `1,6 %`, unter 0,1 % `< 0,1 %`, `0 %` und `100 %` ohne Stelle. */
export function shareText(s: number | null, lang: Lang): string {
  if (s === null) return '–'
  const p = s * 100
  const comma = (x: string) => (lang === 'de' ? x.replace('.', ',') : x)
  if (p <= 0) return '0 %'
  if (p >= 99.95) return '100 %'
  if (p < 0.1) return `< ${comma('0.1')} %`
  return `${comma(p.toFixed(1))} %`
}

/** Die große Zahl: ab 100 $ ganze Dollar (`887 $`, `$1,204`), darunter mit Cent wie überall. */
export function bigUsd(v: number, lang: Lang): string {
  if (!(v >= 99.995)) return usd(v, lang)
  const whole = String(Math.round(v))
  return lang === 'de' ? `${whole.replace(/\B(?=(\d{3})+$)/g, '.')} $` : `$${whole.replace(/\B(?=(\d{3})+$)/g, ',')}`
}

// ---------- Desktop: Svg ----------

// Feste Farben, weil ein Svg als Bild gezeichnet wird (types SvgProps) und keine Theme-Keys kennt. Dunkel wie in
// limit-bars (Fynn nutzt das dunkle Theme); fürs helle Theme eine Variante per `prefers-color-scheme` [UNKLAR, ob das Bild
// dem Theme der App oder dem des Systems folgt].
const ORANGE = '#D77757'
const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif"
const STYLE =
  '.t{fill:#ECEAE3}.g{fill:#9A9A9A}.k{stroke:#454540}' +
  '@media (prefers-color-scheme: light){.t{fill:#262624}.g{fill:#6B6A65}.k{stroke:#E1DFD7}}'
export const RING = 96
const R = 40
const STROKE = 12
/** Sichtbarer Mindestbogen für Anteile unter 1 %: 1 % des Kreises (Verhalten 3, die Zahl bleibt genau). */
const MIN_ARC = 0.01
/** Höchstlänge des Svg-Dokuments (types SvgProps `source`). */
export const SVG_LIMIT = 131072

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f2 = (n: number) => String(Math.round(n * 100) / 100)

/** Bogen ab 12 Uhr im Uhrzeigersinn für den Anteil `s` (0–1) um (cx, cy). */
export function arcPath(s: number, cx: number, cy: number): string {
  const a = Math.min(1, Math.max(MIN_ARC, s)) * 2 * Math.PI
  const x = cx + R * Math.sin(a)
  const y = cy - R * Math.cos(a)
  return `M${f2(cx)} ${f2(cy - R)}A${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${f2(x)} ${f2(y)}`
}

/** Grobe Breite eines Texts in px (proportionale Schrift, eher zu breit geschätzt, damit nichts abgeschnitten wird). */
const textW = (s: string, size: number) => Math.ceil(s.length * size * 0.6)

/** Überschrift über der großen Zahl: `ClaudeMods · API-Wert gesamt` bzw. `· 30 Tage`; ohne Projekt `Dieser Chat · …`. */
export function hereHead(h: Here, lang: Lang): string {
  const t = T[lang]
  const what = h.range > 0 ? rangeLabel(h.range, lang) : t.hereTotal
  const chats = h.project && h.projectChats > 0 ? ` · ${t.hereChats(h.projectChats)}` : ''
  return `${h.project ?? t.hereThisChat}${chats} · ${t.hereApiValue(what)}`
}

/** Zeile unter der großen Zahl: `dieser Chat 14,20 $ · 3 Tage aktiv`, vor der ersten Buchung „noch nichts gebucht“. */
export function hereChatLine(h: Here, lang: Lang): string {
  const t = T[lang]
  if (!h.booked) return t.hereNothingYet
  const days = t.hereActiveDays(h.chatDays)
  return h.project ? `${t.hereChatLabel} ${usd(h.chatUsd, lang)} · ${days}` : days
}

/** Fußzeile: seit wann, welche Geräte, API-Wert statt Rechnung; ohne Projekt der Grund. */
export function hereFoot(h: Here, lang: Lang): string[] {
  const t = T[lang]
  const first: string[] = []
  if (h.range <= 0 || (h.since !== null && dayKey(h.since) > dayBefore(h.now, h.range - 1)))
    first.push(h.since !== null ? t.hereSince(fullDate(h.since, lang)) : t.hereSinceUnknown)
  first.push(h.devices ? h.devices.join(' + ') : `${t.hereOneDevice} (${t.hereSyncHint})`)
  return [first.join(' · '), ...(h.project ? [] : [t.hereNoProject]), t.hereApiNote]
}

/** Das Bild: links der Ring (ohne Projekt keiner), rechts Überschrift, große Zahl und Chat-Zeile. */
export function hereSvg(h: Here, lang: Lang): { source: string; width: number; height: number; alt: string } {
  const s = shareOf(h)
  const ring = h.project !== null
  const big = bigUsd(h.project ? h.projectUsd : h.chatUsd, lang)
  const full = hereHead(h, lang)
  const head = full.length <= 48 ? full : `${full.slice(0, 47).trimEnd()}…`
  const line = hereChatLine(h, lang)
  const x0 = ring ? RING + 20 : 4
  const height = RING + 8
  const width = x0 + Math.max(textW(head, 13), textW(big, 44), textW(line, 13) + (ring ? 16 : 0)) + 8
  let body = `<style>${STYLE}</style>`
  if (ring) {
    const cx = 4 + RING / 2
    const cy = 4 + RING / 2
    body += `<circle class="k" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke-width="${STROKE}"/>`
    if (s !== null && s > 0)
      body +=
        s >= 0.9995
          ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ORANGE}" stroke-width="${STROKE}"/>`
          : `<path d="${arcPath(s, cx, cy)}" fill="none" stroke="${ORANGE}" stroke-width="${STROKE}"/>`
    body += `<text class="t" x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="600">${esc(shareText(s, lang))}</text>`
  }
  body += `<text class="g" x="${x0}" y="27" font-family="${FONT}" font-size="13">${esc(head)}</text>`
  body += `<text class="t" x="${x0 - 2}" y="70" font-family="${FONT}" font-size="44" font-weight="600">${esc(big)}</text>`
  const lx = ring && h.booked ? x0 + 16 : x0
  if (ring && h.booked) body += `<rect x="${x0}" y="83" width="10" height="10" rx="2" fill="${ORANGE}"/>`
  body += `<text class="g" x="${lx}" y="93" font-family="${FONT}" font-size="13">${esc(line)}</text>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  return { source, width, height, alt: hereText(h, lang).replace(/\*\*/g, '') }
}

// ---------- Baum für die CommandOutput-Zeile ----------

type Props = Record<string, string | number | boolean>
const el = (type: 'Box' | 'Text', props: Props, children: RenderNode[]): RenderElement => ({ type, props, children })
const text = (s: string, props: Props = {}) => el('Text', props, [s])
const dim = (s: string) => text(s, { dimColor: true })

/** Terminal-Balken für den Anteil: `█` in Claude-Orange, Rest `░` gedimmt; ab einem Anteil > 0 mindestens eine Zelle. */
export function hereBar(s: number | null, cells: number): { on: number; off: number } {
  const n = Math.max(1, cells)
  const on = s === null || !(s > 0) ? 0 : Math.min(n, Math.max(1, Math.round(s * n)))
  return { on, off: n - on }
}

/** Der Baum: Desktop mit Svg, Terminal mit Text und Balken. `columns` nur als Richtwert für die Balkenlänge. */
export function hereTree(h: Here, lang: Lang, columns: number, surface: 'terminal' | 'desktop'): RenderElement {
  const foot = hereFoot(h, lang).map((s) => dim(s))
  const notes: RenderNode[] = (h.notes ?? []).map((n) => text(n, { color: 'warning' }))
  const frame = (kids: RenderNode[]) => el('Box', { flexDirection: 'column', borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%' }, kids)
  if (surface === 'desktop') {
    const pic = hereSvg(h, lang)
    const svg: RenderElement = { type: 'Svg', props: { source: pic.source, alt: pic.alt, width: pic.width, height: pic.height } }
    return frame([svg, ...notes, el('Box', { flexDirection: 'column', marginTop: 1 }, foot)])
  }
  const inner = Math.max(26, Math.min(columns || 80, 140) - 4)
  const big = bigUsd(h.project ? h.projectUsd : h.chatUsd, lang)
  const kids: RenderNode[] = [text(hereHead(h, lang), { color: 'claude', bold: true }), text(big, { bold: true })]
  if (h.project) {
    const s = shareOf(h)
    const label = shareText(s, lang)
    const b = hereBar(s, Math.min(40, inner - label.length - 1))
    kids.push(
      el('Text', {}, [
        ...(b.on ? [text('█'.repeat(b.on), { color: 'claude' })] : []),
        ...(b.off ? [text('░'.repeat(b.off), { color: 'inactive' })] : []),
        text(` ${label}`),
      ]),
    )
  }
  kids.push(text(hereChatLine(h, lang)))
  return frame([...kids, ...notes, el('Box', { flexDirection: 'column', marginTop: 1 }, foot)])
}

/** Die Zeile „Hier: …“ unten in der Übersicht. */
export function hereLine(h: Here, lang: Lang): string {
  const t = T[lang]
  return h.project ? t.ovHere(h.project, usd(h.projectUsd, lang), shareText(shareOf(h), lang)) : t.ovHereNoProject(usd(h.chatUsd, lang))
}

/** Text für Claude, eine Zeile, die Kennung am Ende (der Render-Hook sucht sie in der ersten Zeile). */
export function hereText(h: Here, lang: Lang, tag = ''): string {
  const t = T[lang]
  const since = h.range > 0 ? rangeLabel(h.range, lang) : h.since !== null ? t.hereSince(fullDate(h.since, lang)) : t.hereTotal
  const devices = h.devices ? h.devices.join(' + ') : t.hereOneDevice
  const chat = h.booked ? usd(h.chatUsd, lang) : t.hereNothingYet
  const body = h.project
    ? t.hereSum(h.project, usd(h.projectUsd, lang), since, chat, shareText(shareOf(h), lang), devices)
    : h.booked
      ? t.hereSumNoProject(chat, since, devices)
      : t.hereSumNoProjectEmpty(devices)
  const line = tag ? `${body} · ${dateTime(h.now, lang)} · ${tag}` : body
  return [line, ...(h.notes ?? [])].join('\n')
}
