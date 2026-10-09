// quick-replies: Hooks-Modul. Nach jeder Antwort von Claude stehen vorgeschlagene nächste Nachrichten als eigene Pille über Clawd
// im Band über dem Prompt (AbovePrompt, docs/raw/en/interface.md:207-213). Klick oder Ziffer 1–4 als erstes Zeichen im leeren
// Prompt (prompt.edit, types@2.1.289:8128-8203) schickt den Vorschlag als Nachricht des Nutzers ab ($.prompt.submit mit asUser,
// types@2.1.289:8516-8529). Wird die Ziffer allein abgeschickt, ersetzt prompt.submit sie durch den Vorschlag.
// Quellen: der eine Vorschlag von Claude Codes eigenem Dienst (prompt.suggest); auf Wunsch (/replies more on) bis zu vier
// aus einem Fork der Session (Claude Codes Vorschlag vorn, die aus dem Fork rücken nach) ($.model.fork, voller Kontext, gleicher Cache), nach dem Vorbild von next-steps.
// Der Mod beobachtet nur: Jeder Event-Hook gibt das Ergebnis von next(e) weiter; nur eine Ziffer, die einen Vorschlag sendet,
// landet nicht im Prompt bzw. wird beim Absenden durch den Vorschlag ersetzt. Er sendet nie von selbst, nur auf Klick oder Taste.
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { joinBand, layer, LEVEL, nameOf, splitBand } from './band.ts'
import { addCall, NO_COST } from './cost.ts'
import type { ForkCost } from './cost.ts'
import { forkCostText, forkStateText, langOf, T } from './i18n.ts'
import type { ForkState, Lang, Position } from './i18n.ts'
import { helpMarkdown, helpTree } from './help.ts'
import type { HelpData } from './help.ts'
import { forkPrompt, heldDigit, HELP_WORDS, MIN_ANSWER, merge, MORE_WORD, parseFork, repliesHelp, STATUS_WORDS, TOGGLE_WORDS } from './logic.ts'
import type { Reply } from './logic.ts'
import { chooseLayout, GAP, label } from './view.ts'
import type { Layout, LayoutPref } from './view.ts'

const CMD = 'replies'
const ARG_HINT = '[status|on|off|more on|more off|help]'
// Akzent der Hilfe: Theme-Key, passt sich hell und dunkel an (docs/HELP-SPEC.md §4, Violett; types@2.1.295:12590)
const ACCENT = 'autoAccept'
// Rahmen (2) und Innenabstand (2) der eigenen Pille (nur Desktop)
const FRAME = 4
// Keine Neubelegung so lange nach einer Eingabe (SPEC → Stabilität)
const QUIET_MS = 2000
// So lange nach der letzten Ziffer zählt dieselbe Ziffer als Wiederholung der gehaltenen Taste. Über der längsten
// Verzögerung bis zur ersten Wiederholung, die Windows einstellen lässt (1 s), und dem längsten Abstand danach.
const HOLD_MS = 1200
// Abgeschickte Ziffer zählt nur, wenn der Nutzer sie selbst geschickt hat: Prompt im Terminal oder SDK-Host (Desktop). Nicht
// Remote Control: Telefon und Web zeigen die Pille nicht (types@2.1.290:8554-8575)
const USER_ORIGINS: ReadonlySet<string> = new Set(['composer', 'sdk'])

type Settings = { enabled: boolean; more: boolean }

// Einstellungen: userConfig als Standard, /replies überschreibt in $.store. Der Store ist eine Datei des Plugins im Benutzerordner
// (types@2.1.289:3243-3248), gilt also für alle Projekte und Sessions; jede Session liest ihn nach jeder Antwort neu.
let defaults: Settings = { enabled: true, more: false }
let settings: Settings = { ...defaults }
let layoutPref: LayoutPref = 'auto'
let lang: Lang = 'en'

// Vorschläge der Hauptsession (flüchtig, pro Session-ID)
let sid = ''
let ready = false // ein Turn ist fertig und seither wurde kein Vorschlag gesendet
let engine = ''
let fork: string[] = []
let replies: Reply[] = []
let forkGen = 0
let forkState: ForkState = { kind: 'idle' }
// Fork-Aufrufe dieses Chats (für /replies status); der Fork läuft auf dem Modell der Hauptschleife (types@2.1.291:2552-2556)
let forkCost: ForkCost = NO_COST
let mainModel = ''

// Eingabe und Stabilität
let promptText = ''
// Die Pille stand beim letzten Zeichnen (nur dann schickt eine Ziffer im leeren Prompt den Vorschlag ab)
let shown = false
// Was die Pille in diesem Turn zuletzt gezeigt hat: Eine allein abgeschickte Ziffer sendet nur einen Vorschlag, der zu sehen war
let seen: string[] = []
let quiet: Timer | null = null
let pending = false
// Ziffer, deren Taste gerade einen Vorschlag gesendet hat: ihre Wiederholungen (Taste noch gehalten) landen nicht im Prompt
let held = 0
let holdTimer: Timer | null = null

// Zeichnen: die Pille bleibt dasselbe Objekt, solange sich nichts ändert. Clawd zeichnet das Band im Desktop etwa 13-mal pro
// Sekunde neu; neu gebaute Knöpfe nahmen dort keinen Klick an.
let cached: { sig: string; node: RenderNode } | null = null
let surface = ''
let bodyColumns = 0
let layout: Layout | '' = ''
let position: Position | '' = ''
let engineSeen = 0
// /clear-Prüfung im Desktop nicht bei jedem der ~13 Bilder pro Sekunde: bei neuen Vorschlägen und sonst jedes 10. Zeichnen.
// Im Terminal wird das Band nur bei Änderungen gezeichnet, dort jedes Mal.
const SID_EVERY = 10
let sidCheck = SID_EVERY

// /replies help: Schnappschüsse unter einer Kennung `#…`, höchstens 10 (docs/HELP-SPEC.md §3). Die Kennung ohne $.clock.now,
// das wäre ein neuer Call: Zähler plus Zufall, damit eine neu geladene Session keine alte Kennung trifft.
const drawn = new Map<string, HelpData>()
let helpNo = 0

function remember(data: HelpData): string {
  helpNo += 1
  const tag = `#${helpNo.toString(36)}${Math.random().toString(36).slice(2, 7).padEnd(5, '0')}`
  drawn.set(tag, data)
  while (drawn.size > 10) drawn.delete(drawn.keys().next().value as string)
  return tag
}

/** Einstellungen aus dem Store; ohne Store oder ohne Eintrag gilt der Standard aus userConfig. */
async function load($: EngineInterface) {
  try {
    settings = cleanSettings(await $.store.get('settings'), defaults)
  } catch {
    // bleibt beim Stand dieser Session
  }
}

function cleanSettings(v: unknown, base: Settings): Settings {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    more: typeof o.more === 'boolean' ? o.more : base.more,
  }
}

function promptEmpty(text: string): boolean {
  return text.trim() === ''
}

function resetTurn() {
  ready = false
  engine = ''
  fork = []
  replies = []
  seen = []
  forkGen += 1
  pending = false
}

/** Neuer Chat (/clear): Vorschläge und Fork-Kosten gehören zum alten. */
function newChat(now: string) {
  sid = now
  resetTurn()
  forkCost = NO_COST
}

function recompute() {
  replies = merge(engine, fork)
  sidCheck = SID_EVERY
}

/** Später ankommende Vorschläge (Engine, Fork): sofort einsetzen, außer der Nutzer hat in den letzten 2 s getippt oder gedrückt. */
function arrive($: EngineInterface) {
  if (!ready) return
  // Die Ruhe schützt nur, was schon zu sehen ist; ohne sichtbaren Vorschlag kommt der neue sofort
  if (quiet && replies.length > 0) {
    pending = true
    return
  }
  recompute()
  $.ui.invalidate('ui.render')
}

/** Eingabe oder Druck: 2 s Ruhe für die Plätze (einmaliger Timer: erster Tick, dann cancel()). */
function markInput($: EngineInterface) {
  quiet?.cancel()
  const t = $.clock.every(QUIET_MS, () => {
    t.cancel()
    if (quiet !== t) return
    quiet = null
    if (pending) {
      pending = false
      if (ready) {
        recompute()
        $.ui.invalidate('ui.render')
      }
    }
  })
  quiet = t
}

/** Taste der Ziffer `n` gehalten: Wiederholungen bis HOLD_MS nach der letzten schlucken (einmaliger Timer wie bei markInput). */
function hold($: EngineInterface, n: number) {
  unhold()
  const t = $.clock.every(HOLD_MS, () => {
    t.cancel()
    if (holdTimer === t) unhold()
  })
  // Erst mit laufendem Timer: ohne ihn bliebe die Ziffer bis zur nächsten anderen Eingabe gesperrt
  holdTimer = t
  held = n
}

function unhold() {
  holdTimer?.cancel()
  holdTimer = null
  held = 0
}

/** Fork nach dem Turn, außerhalb von turn.complete (Lehre 12). Fehler, Unsinn oder nichts: es bleibt beim Vorschlag der Engine. */
function askFork($: EngineInterface, gen: number) {
  forkState = { kind: 'running' }
  const chat = sid
  $.model
    .fork({ prompt: forkPrompt(lang) })
    .then((r) => {
      // Kosten zählen auch, wenn inzwischen ein neuer Turn läuft; nach /clear gehören sie zum alten Chat
      if ('usage' in r && chat === sid) forkCost = addCall(forkCost, r.usage, mainModel)
      if (gen !== forkGen) return
      if (!r.isAnswered) {
        forkState = { kind: 'unanswered', reason: r.reason }
        return
      }
      const list = parseFork(r.text)
      forkState = list.length > 0 ? { kind: 'found', count: list.length } : { kind: 'none' }
      if (list.length === 0) return
      fork = list
      arrive($)
    })
    .catch((err: unknown) => {
      if (gen === forkGen) forkState = { kind: 'error', message: String(err) }
    })
}

/** Sendet einen Vorschlag als Nachricht des Nutzers; die Pille verschwindet sofort. Nur auf Klick oder Taste. */
function send($: EngineInterface, text: string) {
  // Schon gesendet (Klick und Ziffer kurz nacheinander): nicht doppelt
  if (!ready) return
  ready = false
  markInput($)
  $.ui.invalidate('ui.render')
  // Nach /clear nie den Vorschlag des alten Chats in den neuen schicken
  $.session
    .id()
    .then((now) => {
      if (sid && now !== sid) {
        newChat(now)
        return
      }
      return $.prompt.submit({ text, asUser: true }).then((r) => {
        if (r.drop !== undefined) fail($, text)
      })
    })
    .catch(() => fail($, text))
}

function fail($: EngineInterface, text: string) {
  ready = replies.length > 0
  $.ui.invalidate('ui.render')
  // Der Host nennt den Mod beim Toast selbst (docs/raw/en/api.md:133)
  $.ui.toast(T[lang].sendFailed(text))
}

/** Wo quick-replies in der Kette sitzt: Der Kern antwortet ohne weitere Mods mit `{type:'engine'}` (types@2.1.289:9160-9170). */
function positionOf(theirs: RenderNode | null | undefined): Position {
  if (theirs === null || theirs === undefined) return 'alone'
  if (typeof theirs === 'object' && 'type' in theirs && theirs.type === 'engine') return 'inner'
  return 'outer'
}

function status(): string {
  const t = T[lang]
  const onOff = (v: boolean) => (v ? t.on : t.off)
  const source = (r: Reply) => (r.source === 'engine' ? t.sourceEngine : t.sourceFork)
  const list = replies.length > 0 ? replies.map((r, i) => `  ${i + 1}: ${r.text} (${source(r)})`) : ['  –']
  return [
    `quick-replies: ${onOff(settings.enabled)} · ${t.moreViaFork} ${onOff(settings.more)}`,
    `${t.suggestions}${ready ? '' : t.hidden}:`,
    ...list,
    `${t.lastSources}: ${t.sourceEngine} ${engine ? t.yes : t.no} · ${t.sourceFork} ${settings.more ? forkStateText(t, forkState) : t.off}`,
    forkCostText(t, forkCost),
    `${t.engineSeen}: ${engineSeen}×`,
    `${t.surface}: ${surface || t.notDrawn} · ${t.band(bodyColumns)} · ${t.layout} ${layout || '–'} · ${t.position} ${position ? t.positions[position] : '–'}`,
  ].join('\n')
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  defaults = { enabled: true, more: options.more === true }
  settings = { ...defaults }
  layoutPref = options.layout === 'grid' || options.layout === 'list' ? options.layout : 'auto'
  lang = langOf(options.language)

  on('session.start', async ($, e, next) => {
    await load($)
    try {
      sid = await $.session.id()
    } catch {
      sid = ''
    }
    resetTurn()
    forkCost = NO_COST
    // Commands zuletzt und in try/catch: ein belegter Name wirft (docs/raw/en/api.md:45)
    try {
      await $.command.register({ name: CMD, description: T[lang].description, argumentHint: ARG_HINT })
    } catch (err) {
      $.ui.log(`/${CMD} not registered: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    resetTurn()
    // Der Prompt wurde gerade abgeschickt
    promptText = ''
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.usage?.model) mainModel = e.usage.model
    if (!e.agentId && !e.isAborted && e.reason === 'answer') {
      try {
        // Nach /clear gibt es eine neue Session-ID ohne session.start (Lehre 13)
        const now = await $.session.id()
        if (sid && now !== sid) newChat(now)
        else sid = now
      } catch {
        // bleibt beim bisherigen Wert
      }
      // Eine andere Session kann /replies umgestellt haben: die Einstellung gilt global
      await load($)
      // Die Vorschläge kommen danach: der von Claude Code über prompt.suggest, die weiteren aus dem Fork
      ready = true
      pending = false
      recompute()
      $.ui.invalidate('ui.render')
      // Fork nur, wo gezeichnet wird (erst das Band nennt die Oberfläche, Lehre 9), also nie in -p, SDK, VS Code oder mobil
      if (settings.enabled && settings.more && surface && e.answer.trim().length >= MIN_ANSWER) {
        const gen = forkGen
        const t = $.clock.every(10, () => {
          t.cancel()
          // Inzwischen ein neuer Turn: kein Fork mehr für die alte Antwort
          if (gen === forkGen) askFork($, gen)
        })
      }
    }
    return next(e)
  })

  // Vorschlag von Claude Codes eigenem Dienst nach einem Turn (types@2.1.289:8653-8691): nur lesen, der graue Vorschlag bleibt
  on('prompt.suggest', async ($, e, next) => {
    if (e.origin.kind === 'suggestion' && e.text.trim()) {
      engineSeen += 1
      engine = e.text
      arrive($)
    }
    return next(e)
  })

  // Wird getippt, verschwindet die Pille; jede Eingabe hält die Plätze 2 s fest (Limit 50 ms: nur next wird abgewartet)
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    // Ziffer als erstes Zeichen in den leeren Prompt, während die Pille steht: Vorschlag sofort senden, die Ziffer landet nicht im
    // Prompt (Antwort mit leerem Text, types@2.1.291:8276-8283). Die Pause des Band-Hotkeys (docs/raw/en/reference.md:244) greift im
    // Desktop nicht, solange der Prompt den Fokus hat. Eine gehaltene Taste kommt als „111…“ in einer Eingabe an und zählt wie
    // die einzelne Ziffer; spätere Wiederholungen derselben Ziffer landen nicht im Prompt und senden nie erneut (auch nicht, wenn
    // das Senden scheiterte und die Pille zurück ist, oder schon der nächste Turn fertig ist).
    const n = e.text === '' && r.text === e.inputText ? heldDigit(e.inputText) : 0
    if (n > 0 && n === held) {
      hold($, n)
      return { ...r, text: '', cursor: 0 }
    }
    unhold()
    const pick = n > 0 ? replies[n - 1] : undefined
    if (pick && shown && ready) {
      if (e.inputText.length > 1) $.ui.log(`quick-replies: held digit ${n} (${e.inputText.length}×)`, { to: 'debug' })
      promptText = ''
      hold($, n)
      send($, pick.text)
      return { ...r, text: '', cursor: 0 }
    }
    const was = promptEmpty(promptText)
    promptText = r.text
    markInput($)
    if (was !== promptEmpty(promptText)) $.ui.invalidate('ui.render')
    return r
  })

  // Nur die Ziffer als ganze Nachricht abgeschickt (z. B. im Desktop, wenn die Ziffer im Prompt stehen blieb): stattdessen geht
  // der Vorschlag mit dieser Nummer raus, im Transkript steht sein Text (types@2.1.290:4024-4033, 8740-8791). Alles andere,
  // auch die eigenen Sendungen des Mods (origin plugin), läuft unverändert durch.
  on('prompt.submit', async ($, e, next) => {
    // Auch mehrfach dieselbe Ziffer (Taste gehalten, dann abgeschickt)
    const digit = e.text.trim()
    const n = heldDigit(digit)
    if (!n) return next(e)
    const pick = seen[n - 1]
    const why = !USER_ORIGINS.has(e.origin.kind)
      ? `origin ${e.origin.kind}`
      : e.turnId !== undefined || e.attachments?.length
        ? 'mid-turn or attachments'
        : !settings.enabled || !ready || !pick
          ? 'no suggestion shown'
          : ''
    if (why || !pick) {
      $.ui.log(`quick-replies: "${digit}" sent as typed (${why})`, { to: 'debug' })
      return next(e)
    }
    // Nach /clear nie den Vorschlag des alten Chats
    let now: string
    try {
      now = await $.session.id()
    } catch {
      return next(e)
    }
    if (sid && now !== sid) {
      newChat(now)
      return next(e)
    }
    ready = false
    promptText = ''
    $.ui.invalidate('ui.render')
    const r = await next({ ...e, text: pick })
    // Ein Hook weiter innen oder ein UserPromptSubmit-Hook hat die Nachricht gestoppt: die Pille kommt zurück
    if (r.drop !== undefined) {
      ready = replies.length > 0
      $.ui.invalidate('ui.render')
    }
    return r
  })

  on('command.run', { command: CMD }, async ($, e) => {
    // Der Befehl stand gerade im Prompt; ob das Leeren beim Absenden prompt.edit auslöst, ist nicht belegt
    if (!promptEmpty(promptText)) {
      promptText = ''
      $.ui.invalidate('ui.render')
    }
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    // Vorher neu lesen, damit eine zweite Session ihre Einstellung nicht verliert
    const change = async (patch: Partial<Settings>) => {
      try {
        settings = cleanSettings(await $.store.get('settings'), settings)
      } catch {
        // bleibt beim Stand dieser Session
      }
      settings = { ...settings, ...patch }
      try {
        await $.store.set('settings', settings)
      } catch {
        // gilt dann nur bis zum Reload
      }
      $.ui.invalidate('ui.render')
    }
    const t = T[lang]
    // Hilfe nur als einziges Wort (docs/HELP-SPEC.md §2); Zustand beim Aufruf, die Zeichnung schreibt sich nicht um
    if (args.length === 1 && HELP_WORDS.includes(args[0]!)) {
      const data = repliesHelp({ lang, enabled: settings.enabled, more: settings.more, config: { more: defaults.more, layout: layoutPref } })
      return { text: helpMarkdown(data, remember(data)) }
    }
    if (args.length === 0 || (args.length === 1 && STATUS_WORDS.includes(args[0]!))) {
      // Direkt nach /clear: Vorschläge und Fork-Kosten gehören noch zum alten Chat
      try {
        const now = await $.session.id()
        if (sid && now !== sid) newChat(now)
      } catch {
        // bleibt beim bisherigen Stand
      }
      return { text: status() }
    }
    if (args.length === 1 && TOGGLE_WORDS.includes(args[0]!)) {
      await change({ enabled: args[0] === 'on' })
      return { text: `quick-replies ${settings.enabled ? t.on : t.off}` }
    }
    if (args.length === 2 && args[0] === MORE_WORD && TOGGLE_WORDS.includes(args[1]!)) {
      await change({ more: args[1] === 'on' })
      return { text: settings.more ? t.moreOn : t.moreOff }
    }
    return { text: t.usage }
  })

  // /replies help gezeichnet an der Stelle der Befehlsausgabe (types@2.1.295:10025-10068). Die Kennung steht in der ersten Zeile,
  // aber nicht am Anfang: Claude Code setzt „quick-replies: “ davor (templates/help/README.md). Sonst die Engine-Fassung.
  on('ui.render', { component: 'CommandOutput', props: { command: CMD } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    // Nur die Ausgabe von /replies help (Absicherung wie templates/help und worklist K2; bei quick-replies wiederholt keine
    // andere Antwort das Argument, eine Kennung kann also nur aus help stammen)
    if (!HELP_WORDS.includes(e.props.args.trim().toLowerCase())) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const data = tag ? drawn.get(tag) : undefined
    return data ? helpTree(data, e.viewport?.columns ?? 100, e.surface, ACCENT) : next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let called = false
    let nextFailed = false
    let theirs: RenderNode | null | undefined = null
    shown = false
    // Das Band gibt es nur auf Terminal und Desktop (types@2.1.289:9711)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    try {
      called = true
      try {
        theirs = await next(e)
      } catch (err) {
        nextFailed = true
        throw err
      }
      // Die Oberfläche nennt erst das Zeichnen zuverlässig (Lehre 9)
      surface = e.surface
      bodyColumns = e.props.bodyColumns
      position = positionOf(theirs)
      // Nur zeichnen, wenn alles passt; sonst den Bandinhalt unverändert lassen, keine zusätzliche Höhe (Lehren 3 und 8)
      if (!settings.enabled || !ready || replies.length === 0) return theirs
      if (e.props.hasSurvey || e.props.isWorking || !promptEmpty(promptText)) return theirs
      // Transkript eines Subagents offen: die Vorschläge gehören zur Hauptsession (types@2.1.289:9750-9758)
      if (e.props.view.agentId) return theirs
      // Nach /clear: neue Session-ID, die Vorschläge gehören zum alten Chat (Lehre 13)
      sidCheck += 1
      if (e.surface === 'terminal' || sidCheck >= SID_EVERY) {
        sidCheck = 0
        const now = await $.session.id()
        if (sid && now !== sid) {
          newChat(now)
          // Auch der Prompt mit „/clear“ ist abgeschickt
          promptText = ''
          return theirs
        }
      }

      const { Box, Button } = $.ui.resolve(e)
      // Desktop: gerahmte Pille. Terminal: kompakt ohne Rahmen und Abstand, sonst läuft das Band neben Clawd über („n more“)
      const framed = e.surface === 'desktop'
      const inner = e.props.bodyColumns - (framed ? FRAME : 0)
      const texts = replies.map((r) => r.text)
      layout = chooseLayout(texts, inner, layoutPref)
      const sig = `${e.surface}|${inner}|${layout}|${texts.join('\u0000')}`
      if (!cached || cached.sig !== sig) {
        const half = Math.floor((inner - GAP) / 2)
        const buttons = texts.map((text, i) =>
          Button({ key: `reply-${i + 1}`, label: label(text), hotkey: String(i + 1), plain: true, onPress: () => send($, text) }),
        )
        const cell = (b: RenderNode) => Box({ width: e.surface === 'terminal' ? half : '50%', flexShrink: 0, children: [b] })
        const rows: RenderNode[] = []
        if (layout === 'grid') {
          // 2 × 2: links 1/3, rechts 2/4
          for (let i = 0; i < buttons.length; i += 2) {
            rows.push(Box({ flexDirection: 'row', columnGap: GAP, flexShrink: 0, children: buttons.slice(i, i + 2).map(cell) }))
          }
        } else {
          for (const b of buttons) rows.push(Box({ flexDirection: 'row', flexShrink: 0, children: [b] }))
        }
        // Eigene Pille: gedimmter Rahmen, eine Zeile Abstand zu Clawd und den Balken darunter
        const node = framed
          ? Box({ key: 'quick-replies', flexDirection: 'column', flexShrink: 0, borderStyle: 'round', borderDimColor: true, paddingX: 1, marginBottom: 1, children: rows })
          : Box({ key: 'quick-replies', flexDirection: 'column', flexShrink: 0, children: rows })
        cached = { sig, node }
      }
      // Eigene Ebene über dem Grund (Clawd, Balken), unter sidekick; gilt in jeder Reihenfolge der Mods (band.ts, docs/BAND.md)
      const { layers, base } = splitBand(theirs)
      // Während sidekick einen neuen Chat startet, keine Pille; sidekick weiter innen sieht sie nicht
      if (layers.some((l) => nameOf(l) === 'sidekick')) return joinBand(layers, base)
      shown = true
      seen = texts
      return joinBand([...layers, layer(LEVEL.quickReplies, 'quick-replies', cached.node)], base)
    } catch (err) {
      // Fehler aus der Kette weiterwerfen (docs/raw/en/events.md:313-316); eigener Fehler: Clawd und Balken bleiben stehen
      if (nextFailed) throw err
      $.ui.log(`quick-replies ui.render: ${String(err)}`, { to: 'debug' })
      return called ? theirs : next(e)
    }
  })
}
