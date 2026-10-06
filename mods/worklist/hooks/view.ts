// worklist: Anzeige der Seitenleiste ohne `$`. Aus einem View-Modell werden gebaut: Statuszeile mit Fortschritt der Liste,
// JETZT (nur wenn etwas läuft), HINWEIS (nur wenn die Liste anhält), DANACH (Eingabefeld oben, darunter die Liste) und VERLAUF.
// Jeder Bereich wird zwischengespeichert und nur neu gebaut, wenn sich seine Daten, die Breite oder die Sprache ändern: Neu
// gebaute Knöpfe nahmen im Desktop keinen Klick an (mods/quick-replies/SPEC.md, Prototyp 3).
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

/** Statuszeile ganz oben: Symbol und ein Satz. Farbe nur bei „läuft“ (accent) und „wartet auf dich“ (strong). */
export type Tone = 'accent' | 'strong' | 'dim'
export type StatusLine = { icon: string; text: string; tone: Tone }

/** JETZT: nur, solange Claude arbeitet oder ein To-do läuft bzw. geprüft wird. */
export type NowView = {
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

type QueueItem = { id: string; text: string; skipped: boolean }
type HistoryItem = { text: string; doneAt: number; durationMs: number; result: string; how: 'auto' | 'manual' }

/**
 * Hinweis, wenn die Liste anhält:
 * - question: ein To-do hat eine Rückfrage (Stufen 5–9); Fynns Antwort im Chat setzt es fort
 * - stop: Abbruch, Fehler, unbekannter Befehl (STOPP)
 * - hold: ohne To-do (Schleifenschutz, maxAutoRun); nur „Fortsetzen“
 * - background: Hintergrundarbeit läuft länger als 2 Minuten
 */
export type NoticeKind = 'question' | 'stop' | 'hold' | 'background'
// noResume: nach dem zweiten Halt am selben To-do helfen nur Fynns Antwort, Abhaken oder Überspringen (SPEC 0.4.2)
type Notice = { kind: NoticeKind; reason: string; noResume?: boolean }

/** Knopf in der Kopfzeile von DANACH: Pause, Start (pausiert) oder Jetzt starten (Liste wartet). */
export type Control = 'pause' | 'start' | 'go'

export type View = {
  lang: Lang
  status: StatusLine
  progress: { done: number; total: number } | null
  now: NowView | null
  notice: Notice | null
  queue: readonly QueueItem[]
  control: Control
  draft: string
  history: readonly HistoryItem[] // neueste zuerst
  historyOpen: boolean
  historyAll: boolean
  inputKey: string // Schlüssel des Eingabefelds; wechselt nach jedem Einreihen, damit es leer neu erscheint
  todayStart: number // Mitternacht heute (lokal), für die Gruppen
}

export type Actions = {
  resume: () => void
  markDone: () => void
  skip: () => void
  stopWaiting: () => void
  keepWaiting: () => void
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
export function clock(ms: number): string {
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

/** Textbalken (kein Svg im Pane). */
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
  const children: RenderNode[] = []
  children.push(part('status', JSON.stringify([v.status, v.progress]), () => statusBox(el, v, tx, width)))
  const now = v.now
  if (now) children.push(part('now', JSON.stringify(now), () => nowBox(el, now, tx, width)))
  const notice = v.notice
  if (notice) children.push(part('notice', JSON.stringify(notice), () => noticeBox(el, notice, tx, act)))
  children.push(
    part('queue', JSON.stringify([v.queue, v.control, !!el.Input, v.inputKey]), () => queueBox(el, v, tx, act, width)),
    part('history', JSON.stringify([v.history.length, v.history[0]?.doneAt ?? 0, v.historyOpen, v.historyAll, v.todayStart]), () =>
      historyBox(el, v, tx, act),
    ),
  )
  return el.Box({ flexDirection: 'column', rowGap: 1, children })
}

function statusBox(el: El, v: View, tx: Strings, width: number): RenderNode {
  const { Box, Text } = el
  const s = v.status
  const color = s.tone === 'dim' ? undefined : ORANGE
  const rows: RenderNode[] = [
    Text({ wrap: 'wrap', bold: s.tone === 'strong', color, dimColor: s.tone === 'dim', children: [`${s.icon} ${s.text}`] }),
  ]
  const p = v.progress
  if (p && p.total > 0) {
    rows.push(
      Text({
        wrap: 'truncate-end',
        children: [Text({ color: ORANGE, children: [bar(p.done, p.total, Math.min(24, width - 18))] }), Text({ dimColor: true, children: [` ${tx.progress(p.done, p.total)}`] })],
      }),
    )
  }
  return Box({ flexDirection: 'column', paddingX: 1, children: rows })
}

function nowBox(el: El, now: NowView, tx: Strings, width: number): RenderNode {
  const { Box, Text } = el
  const rows: RenderNode[] = []
  const label = now.kind === 'todo' ? `◆ To-do ${now.index}/${now.total}` : tx.fromChat
  rows.push(
    Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [Text({ bold: true, color: ORANGE, children: [label] }), Text({ dimColor: true, children: [clock(now.elapsedMs)] })],
    }),
  )
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
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: ORANGE,
    paddingX: 1,
    children: [Text({ dimColor: true, children: [tx.now] }), ...rows],
  })
}

function noticeBox(el: El, notice: Notice, tx: Strings, act: Actions): RenderNode {
  const { Box, Text, Button } = el
  const text: RenderNode[] = [Text({ bold: true, color: ORANGE, children: [notice.kind === 'background' ? tx.noticeWaitTitle : tx.noticeTitle] }), Text({ wrap: 'wrap', children: [notice.reason] })]
  if (notice.kind === 'question') text.push(Text({ dimColor: true, wrap: 'wrap', children: [tx.answerInChat] }))
  // Die Empfehlung vorn und hervorgehoben; Überspringen klein und mit Abstand, damit es nicht aus Versehen trifft
  const buttons: RenderNode[] =
    notice.kind === 'background'
      ? [
          Button({ key: 'stop-waiting', label: tx.stopWaiting, variant: 'primary', onPress: () => act.stopWaiting() }),
          Button({ key: 'keep-waiting', label: tx.keepWaiting, onPress: () => act.keepWaiting() }),
        ]
      : notice.kind === 'hold'
        ? [Button({ key: 'resume', label: tx.resume, variant: 'primary', onPress: () => act.resume() })]
        : [
            ...(notice.noResume ? [] : [Button({ key: 'resume', label: tx.resume, variant: 'primary', onPress: () => act.resume() })]),
            Button({ key: 'mark-done', label: tx.markDone, ...(notice.noResume ? { variant: 'primary' as const } : {}), onPress: () => act.markDone() }),
            Box({ marginLeft: GAP, children: [Button({ key: 'skip', label: tx.skip, plain: true, onPress: () => act.skip() })] }),
          ]
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: ORANGE,
    paddingX: 1,
    rowGap: 1,
    children: [
      Box({ flexDirection: 'column', children: text }),
      Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: GAP, rowGap: 1, children: buttons }),
    ],
  })
}

function queueBox(el: El, v: View, tx: Strings, act: Actions, width: number): RenderNode {
  const { Box, Text, Button, Input } = el
  const rows: RenderNode[] = [
    // Kopfzeile: Titel und Zahl links, Start/Pause rechts
    Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      children: [
        Text({ children: [Text({ bold: true, color: ORANGE, children: [tx.next] }), Text({ dimColor: true, children: [` · ${v.queue.length === 0 ? tx.nothingOpen : tx.nOpen(v.queue.length)}`] })] }),
        Button({
          key: 'pause',
          label: v.control === 'pause' ? tx.pause : v.control === 'start' ? tx.start : tx.go,
          plain: true,
          onPress: () => act.control(),
        }),
      ],
    }),
  ]
  // Eingabefeld oben: die häufigste Aktion. Mobil gibt es keins (types: Elements['mobile']); dort bleibt /todo <Aufgabe>
  if (Input) {
    rows.push(
      Box({
        marginTop: 1,
        marginBottom: v.queue.length > 0 ? 1 : 0,
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
          Box({
            flexGrow: 1,
            flexShrink: 1,
            flexDirection: 'column',
            children: [
              Text({ wrap: 'wrap', children: [clamp(q.text, width - 18)] }),
              ...(q.skipped ? [Text({ dimColor: true, children: [tx.skippedMark] })] : []),
            ],
          }),
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
  return Box({ flexDirection: 'column', borderStyle: 'round', borderColor: EMPTY, paddingX: 1, children: rows })
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
