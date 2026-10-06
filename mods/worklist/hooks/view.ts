// worklist: Anzeige der Seitenleiste ohne `$`. Aus einem View-Modell werden die vier Bereiche JETZT, HINWEIS, DANACH und
// VERLAUF gebaut. Jeder Bereich wird zwischengespeichert und nur neu gebaut, wenn sich seine Daten, die Breite oder die Sprache
// ändern: Neu gebaute Knöpfe nahmen im Desktop keinen Klick an (mods/quick-replies/SPEC.md, Prototyp 3).
// Kein Svg (mods/orchestrator/SPEC.md:166: interaktives Svg im Pane flackerte im Desktop mit weißem Hintergrund).
import type { Elements, RenderElement, RenderNode } from 'claude-code'
import { dayDate } from './i18n.ts'
import type { Lang, Strings } from './i18n.ts'
import type { PlanItem } from './model.ts'

// Farben aus limit-bars (mods/limit-bars/hooks/view.ts), dort aus der clawd-buddy-Palette
export const ORANGE = '#D77757'
const YELLOW = '#F2C94C'
const EMPTY = '#4A4A4A'
const GREY = '#9A9A9A'

/** Abstand zwischen Knöpfen (SPEC: mindestens 2 Spalten). */
const GAP = 2
const HISTORY_SHORT = 10
const DAY = 86_400_000

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Input?: Elements['terminal']['Input'] }

export type NowView =
  | { kind: 'free'; note: string } // note: z. B. „Liste pausiert.“ oder „wartet auf dich: …“
  | {
      kind: 'todo' | 'chat'
      index: number // 1-basiert, nur bei 'todo'
      total: number
      text: string
      elapsedMs: number
      activity: string
      plan: readonly PlanItem[]
      waiting: string // „wartet auf Hintergrundarbeit: …“, sonst ''
      checking: boolean
    }

type QueueItem = { id: string; text: string }
type HistoryItem = { text: string; doneAt: number; durationMs: number; result: string; how: 'auto' | 'manual' }

/** Hinweis bei FRAGEN/STOPP; ohne To-do (Schleifenschutz, maxAutoRun) gibt es nur „Weiter“. */
type Notice = { reason: string; hasTodo: boolean }

/** Knopf unter der Warteschlange: Pause, Start (pausiert) oder Jetzt starten (Liste wartet nach einer Rückfrage im Chat). */
export type Control = 'pause' | 'start' | 'go'

export type View = {
  lang: Lang
  now: NowView
  notice: Notice | null
  queue: readonly QueueItem[]
  paused: boolean
  control: Control
  draft: string
  history: readonly HistoryItem[] // neueste zuerst
  historyOpen: boolean
  historyAll: boolean
  inputKey: string // Schlüssel des Eingabefelds; wechselt nach jedem Einreihen, damit es leer neu erscheint
  todayStart: number // Mitternacht heute (lokal), für die Gruppen
}

export type Actions = {
  proceed: () => void
  markDone: () => void
  resend: () => void
  up: (id: string) => void
  down: (id: string) => void
  remove: (id: string) => void
  add: (text: string) => void
  draft: (text: string) => void
  control: () => void
  toggleHistory: () => void
  toggleAll: () => void
}

/** Laufzeit `m:ss` bzw. `h:mm:ss`. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

/** Dauer im Verlauf (beide Sprachen gleich): `< 1 min`, `4 min`, `1 h 12 min`. */
export function duration(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000)
  if (min < 1) return '< 1 min'
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}

/** Textbalken für Claudes Plan (kein Svg im Pane). */
function bar(done: number, total: number, width: number): string {
  const w = Math.max(4, width)
  const filled = total <= 0 ? 0 : Math.round((done / total) * w)
  return '▰'.repeat(filled) + '▱'.repeat(w - filled)
}

/** Gruppenname eines Tages im Verlauf: Heute/Today, Gestern/Yesterday, sonst Wochentag und Datum. */
function dayLabel(at: number, todayStart: number, lang: Lang, tx: Strings): string {
  if (at >= todayStart) return tx.today
  if (at >= todayStart - DAY) return tx.yesterday
  return dayDate(lang, at)
}

/** Lange To-dos: höchstens `lines` Zeilen bei `cols` Spalten, an der Wortgrenze gekürzt. */
export function clamp(text: string, cols: number, lines = 3): string {
  const t = text.replace(/\s+/g, ' ').trim()
  const max = Math.max(12, cols) * lines
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`
}

type Cached = { sig: string; node: RenderNode }

/**
 * Baut die Seitenleiste. `cache` gehört dem Aufrufer und überlebt die Zeichnungen; jeder Bereich bleibt dasselbe Objekt,
 * solange seine Signatur gleich ist. Die Wurzel ist ein neues Objekt, ihre Kinder sind die zwischengespeicherten Bereiche.
 */
export function renderPane(el: El, v: View, tx: Strings, act: Actions, cols: number, surface: string, cache: Map<string, Cached>): RenderElement {
  const width = Math.max(20, cols)
  const part = (name: string, sig: string, build: () => RenderNode): RenderNode => {
    const full = `${surface}|${width}|${v.lang}|${sig}`
    const hit = cache.get(name)
    if (hit && hit.sig === full) return hit.node
    const node = build()
    cache.set(name, { sig: full, node })
    return node
  }
  const children: RenderNode[] = [part('now', JSON.stringify(v.now), () => nowBox(el, v.now, tx, width))]
  const notice = v.notice
  if (notice) children.push(part('notice', JSON.stringify(notice), () => noticeBox(el, notice, tx, act)))
  children.push(
    part('queue', JSON.stringify([v.queue, v.paused, v.control, !!el.Input, v.inputKey]), () => queueBox(el, v, tx, act, width)),
    part('history', JSON.stringify([v.history.length, v.history[0]?.doneAt ?? 0, v.historyOpen, v.historyAll, v.todayStart]), () =>
      historyBox(el, v, tx, act),
    ),
  )
  return el.Box({ flexDirection: 'column', rowGap: 1, children })
}

function header(el: El, title: string, right: string, color: string): RenderNode {
  const { Box, Text } = el
  return Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    children: [
      Text({ bold: true, color, children: [title] }),
      ...(right ? [Text({ dimColor: true, wrap: 'truncate-end', children: [right] })] : []),
    ],
  })
}

function nowBox(el: El, now: NowView, tx: Strings, width: number): RenderNode {
  const { Box, Text } = el
  const rows: RenderNode[] = []
  if (now.kind === 'free') {
    rows.push(header(el, tx.free, '', GREY))
    rows.push(Text({ dimColor: true, wrap: 'wrap', children: [now.note] }))
  } else {
    const label = now.kind === 'todo' ? `◆ To-do ${now.index}/${now.total}` : tx.fromChat
    rows.push(header(el, label, clock(now.elapsedMs), ORANGE))
    rows.push(Text({ bold: true, wrap: 'wrap', children: [clamp(now.text, width - 4)] }))
    if (now.activity) rows.push(Text({ color: GREY, wrap: 'truncate-end', children: [`↳ ${now.activity}`] }))
    if (now.waiting) rows.push(Text({ color: YELLOW, wrap: 'truncate-end', children: [now.waiting] }))
    if (now.checking) rows.push(Text({ color: GREY, wrap: 'truncate-end', children: [tx.checkingLine] }))
    if (now.plan.length > 0) {
      const done = now.plan.filter((s) => s.status === 'completed').length
      rows.push(
        Box({
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 1,
          children: [
            Text({ children: [Text({ color: ORANGE, children: [bar(done, now.plan.length, Math.min(20, width - 16))] }), ` ${done}/${now.plan.length}`] }),
            Text({ dimColor: true, children: [tx.plan] }),
          ],
        }),
      )
      for (const s of now.plan) {
        const mark = s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '▶' : '○'
        rows.push(
          Text({
            wrap: 'truncate-end',
            dimColor: s.status === 'completed',
            strikethrough: s.status === 'completed',
            bold: s.status === 'in_progress',
            children: [`${mark} ${s.text}`],
          }),
        )
      }
    }
  }
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: now.kind === 'free' ? EMPTY : ORANGE,
    paddingX: 1,
    children: [Text({ dimColor: true, children: [tx.now] }), ...rows],
  })
}

function noticeBox(el: El, notice: Notice, tx: Strings, act: Actions): RenderNode {
  const { Box, Text, Button } = el
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: ORANGE,
    paddingX: 1,
    rowGap: 1,
    children: [
      Box({
        flexDirection: 'column',
        children: [Text({ bold: true, color: ORANGE, children: [tx.noticeTitle] }), Text({ wrap: 'wrap', children: [notice.reason] })],
      }),
      Box({
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: GAP,
        rowGap: 1,
        children: [
          Button({ key: 'proceed', label: tx.proceed, variant: 'primary', onPress: () => act.proceed() }),
          ...(notice.hasTodo
            ? [
                Button({ key: 'mark-done', label: tx.markDone, onPress: () => act.markDone() }),
                Button({ key: 'resend', label: tx.resend, onPress: () => act.resend() }),
              ]
            : []),
        ],
      }),
    ],
  })
}

function queueBox(el: El, v: View, tx: Strings, act: Actions, width: number): RenderNode {
  const { Box, Text, Button, Input } = el
  const rows: RenderNode[] = [header(el, tx.next, v.queue.length === 0 ? tx.nothingOpen : tx.nOpen(v.queue.length), ORANGE)]
  if (v.paused && v.queue.length > 0) rows.push(Text({ color: YELLOW, children: [tx.paused] }))
  v.queue.forEach((q, i) => {
    const first = i === 0
    const last = i === v.queue.length - 1
    rows.push(
      Box({
        flexDirection: 'row',
        alignItems: 'flex-start',
        columnGap: 1,
        children: [
          Text({ color: GREY, children: [`${i + 1}.`] }),
          // Rahmen, Innenabstand, Nummer und die drei Knöpfe abgezogen
          Box({ flexGrow: 1, flexShrink: 1, children: [Text({ wrap: 'wrap', children: [clamp(q.text, width - 18)] })] }),
          Box({
            flexDirection: 'row',
            flexShrink: 0,
            columnGap: GAP,
            children: [
              // Auch am Rand gezeichnet (ohne Wirkung), damit die Spalten untereinander stehen
              Button({ key: `up-${q.id}`, label: '↑', plain: true, onPress: () => (first ? undefined : act.up(q.id)) }),
              Button({ key: `down-${q.id}`, label: '↓', plain: true, onPress: () => (last ? undefined : act.down(q.id)) }),
              Button({ key: `remove-${q.id}`, label: '✕', plain: true, onPress: () => act.remove(q.id) }),
            ],
          }),
        ],
      }),
    )
  })
  // Mobil gibt es kein Eingabefeld (types: Elements['mobile']); dort bleibt /todo <Aufgabe>
  if (Input) {
    rows.push(
      Box({
        marginTop: 1,
        children: [
          Input({
            key: v.inputKey,
            label: '+',
            placeholder: tx.placeholder,
            submitLabel: tx.submit,
            // /todo öffnet mit focus: true; der Fokus soll im Eingabefeld stehen (types: InputProps.autoFocus)
            autoFocus: true,
            // Der Entwurf überlebt ein Neuzeichnen (onInput merkt ihn), nach dem Einreihen ist er leer
            value: v.draft,
            onInput: (value: string) => act.draft(value),
            onSubmit: (value: string) => act.add(value),
          }),
        ],
      }),
    )
  }
  rows.push(
    Box({
      flexDirection: 'row',
      marginTop: 1,
      columnGap: GAP,
      children: [
        Button({
          key: 'pause',
          label: v.control === 'pause' ? tx.pause : v.control === 'start' ? tx.start : tx.go,
          plain: true,
          onPress: () => act.control(),
        }),
      ],
    }),
  )
  return Box({ flexDirection: 'column', borderStyle: 'round', borderDimColor: true, paddingX: 1, children: rows })
}

function historyBox(el: El, v: View, tx: Strings, act: Actions): RenderNode {
  const { Box, Text, Button } = el
  const rows: RenderNode[] = [
    Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Button({ key: 'history', label: `${v.historyOpen ? '▾' : '▸'} ${tx.history}`, plain: true, onPress: () => act.toggleHistory() }),
        Text({ dimColor: true, children: [v.history.length === 0 ? tx.historyEmpty : tx.nDone(v.history.length)] }),
      ],
    }),
  ]
  if (v.historyOpen) {
    const shown = v.historyAll ? v.history : v.history.slice(0, HISTORY_SHORT)
    let day = ''
    for (const h of shown) {
      const d = dayLabel(h.doneAt, v.todayStart, v.lang, tx)
      if (d !== day) {
        day = d
        rows.push(Text({ color: GREY, bold: true, children: [d] }))
      }
      const meta = [duration(h.durationMs), h.how === 'manual' ? tx.byHand : '', h.result].filter(Boolean).join(' · ')
      rows.push(
        Box({
          flexDirection: 'column',
          children: [
            Text({ dimColor: true, strikethrough: true, wrap: 'truncate-end', children: [`✓ ${h.text}`] }),
            Text({ dimColor: true, wrap: 'truncate-end', children: [`  ${meta}`] }),
          ],
        }),
      )
    }
    if (v.history.length > HISTORY_SHORT) {
      rows.push(
        Button({ key: 'history-all', label: v.historyAll ? tx.showLess : tx.showAll(v.history.length), plain: true, onPress: () => act.toggleAll() }),
      )
    }
  }
  return Box({ flexDirection: 'column', paddingX: 1, children: rows })
}
