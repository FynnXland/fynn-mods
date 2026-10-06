// clawd-buddy: Hooks-Modul. Beobachtet nur: jeder Event-Hook gibt per `next(e)` unverändert weiter, nichts wird blockiert oder verändert.
//
// Aufgabe: aus Events *Fakten* sammeln (wann begann der Turn, welches Tool läuft seit wann, ob eine Frage offen ist, wann zuletzt
// getippt wurde, wie der letzte Turn endete) und sie als `props` an das Client-Modul `./buddy.ts` reichen. Die Stimmung leitet der Client
// daraus auf seiner eigenen Uhr ab (mood.ts); `$.ui.invalidate` läuft darum nur bei echten Ereignissen, nie im Bildtakt (Desktop: desk.ts).
// Zeichnet ins Band über dem Prompt (docs/raw/en/interface.md:207-213) und lässt fremden Inhalt stehen (`await next(e)` als Kind).
import type { EngineInterface, On, Timer } from 'claude-code'
import { joinBand, splitBand } from './band.ts'
import { ALL_CLIPS } from './library.ts'
import { AWAY_MS, NO_FACTS, NO_STRAIN, SETBACK, STREAK_STEP, TYPING_MS, addHit, ctxLevel, deriveTemper, shellKind, sidekickValue, strainTurnEnd, strainTurnStart, toolKind } from './mood.ts'
import type { Strain } from './mood.ts'
import { createDesk, DESK_TICK } from './desk.ts'
import { T, clipLabel, langOf, num as fmt } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { H, W } from './stage.ts'
import type { Desk } from './desk.ts'
import type { Facts, ToolKind } from './mood.ts'

type Stored = { enabled?: boolean; annoy?: number; seenAt?: number }

// Flüchtiger Zustand dieses Moduls (wird aus Events neu abgeleitet; Reload setzt zurück)
let enabled = true
let annoy = 0
let napN = 0
let boopN = 0
let demo = ''
let demoN = 0
const seed = 20260
const running = new Map<string, { kind: ToolKind; since: number }>()
let facts: Facts = { ...NO_FACTS }
let strain: Strain = { ...NO_STRAIN } // Laune: Rückschläge, Erfolge, Arbeitszeit am Stück (mood.ts)
let turnHadError = false
const agentSeen = new Map<string, number>() // laufende Subagenten: agentId → letzte Aktivität (ms)
let askTool = ''
let ctxWarned = 0 // zuletzt gemeldete Stufe des Kontextfensters (mood.ts → CTX_WARN)
let ctxPending = false // neue Stufe erreicht, wird am Turn-Ende gezeigt
let typingPerf = 0 // performance.now() des letzten Tastendrucks (synchron lesbar, ohne `$`-Aufruf pro Taste)
let typingInvalidatedPerf = -1e9
// Rückkehr nach langer Pause (Begrüßung): letzte Anwesenheit (ms, auch über Sitzungen hinweg gespeichert) und Drosseln
let lastSeen = 0
let seenSaved = 0
let seenPerf = -1e9

// Desktop-App: Dort lädt der Client-Rahmen nicht; die Engine läuft im Hooks-Modul (desk.ts). Jede Zeichnung liefert die nächsten
// Sekunden als ein Svg mit SMIL-Animation, das der Desktop selbst abspielt. Neu gezeichnet wird nur bei Ereignissen und kurz bevor die
// Animation endet (Fynn, 2026-10-06: Jede Neuzeichnung des Bands lässt den Desktop auch die von sidekick gehookten eigenen Nachrichten
// neu anfordern; bei ~5 Bildwechseln/s flackerten deren Hover-Leiste und Hinterlegung. Vorher, 2026-10-05: 13/s ließen Knöpfe im Band flackern.)
// Der Wächter (`$.clock.every`, liefert einen Timer mit `cancel()`, types:12280) läuft nur, solange die Desktop-App das Band zeichnet und
// der Buddy an ist: `/clawd off` bricht ihn ab, und zeichnet die App auf die Bitte hin 2 s lang nicht, bricht er sich selbst ab; das
// nächste Zeichnen startet ihn neu. Gezählt wird in Wächter-Runden, nicht in Echtzeit (im Test-Kit läuft nur die Uhr der Mods-API).
const DESK_SCALE = 4 // CSS-Pixel je Figurpixel: Figur 68 × 40 px, Bühne 400 × 56 px
const DESK_CHECK = 250 // ms je Wächter-Runde
const DESK_LEAD = 1000 // so lange vor dem Ende der Animation um die nächste bitten
const DESK_IDLE_CHECKS = 8 // ~2 s ohne Antwort auf die Bitte: Wächter beenden
let desk: Desk | null = null
let deskTimer: Timer | null = null
let deskChecks = 0 // Wächter-Runden seit der letzten Zeichnung
let deskPlanMs = 0 // Länge der zuletzt gezeichneten Animation
let deskAsked = 0 // Wächter-Runden, seit um eine neue Zeichnung gebeten wurde (0 = keine Bitte offen)
// Flackern (Fynn, 2026-10-06: „Es darf nicht flackern“): Ein neues `source` lässt den Rahmen neu laden, die Figur blinkt dabei kurz.
// Das Band wird aber auch für andere Mods neu gezeichnet (limit-bars, sidekick, quick-replies) und bei Ereignissen, die an der laufenden
// Animation nichts ändern. Dann geht dasselbe Svg noch einmal hinaus; neu gerechnet wird erst kurz bevor die neuen Fakten etwas anderes
// zeigen (desk.divergence) oder die Animation endet. Eingriffe (`/clawd demo|nap|boop|on`) erzwingen eine neue Zeichnung.
let deskSource = ''
let deskDrawnAt = 0 // Uhrzeit der letzten echten Zeichnung
let deskForce = false
// Messung für `/clawd status` (Fynn, 2026-10-05: Clawd wirkt bei mehreren Agenten verzögert). Zählt seit dem letzten `/clawd status`,
// mit performance.now() (synchron, kein `$`-Aufruf): Zeichnungen, Länge und Bildwechsel der Animationen, Rechen- und Zeichendauer.
type DeskMeter = { since: number; draws: number; reused: number; planSecs: number; changes: number; chars: number; calcSum: number; calcMax: number; drawSum: number; drawMax: number; othersSum: number }
const newMeter = (): DeskMeter => ({ since: performance.now(), draws: 0, reused: 0, planSecs: 0, changes: 0, chars: 0, calcSum: 0, calcMax: 0, drawSum: 0, drawMax: 0, othersSum: 0 })
let meter = newMeter()
function meterText(lang: Lang, m: DeskMeter, at: number): string {
  const s = (at - m.since) / 1000
  if (m.draws === 0) return T[lang].deskNone
  const avg = (sum: number) => fmt(lang, sum / m.draws)
  const avgAll = (sum: number) => fmt(lang, sum / (m.draws + m.reused))
  return T[lang].desk({
    secs: s.toFixed(0), draws: m.draws, reused: m.reused, perMin: fmt(lang, s > 0 ? (m.draws * 60) / s : 0), planSecs: avg(m.planSecs), changes: avg(m.changes),
    kb: fmt(lang, m.chars / m.draws / 1000), calcAvg: avg(m.calcSum), calcMax: fmt(lang, m.calcMax), drawAvg: avgAll(m.drawSum),
    drawMax: fmt(lang, m.drawMax), others: avgAll(m.othersSum),
  })
}

/** Fakten für die Desktop-Engine zur Uhrzeit `now`: wie gespeichert, dazu der letzte Tastendruck auf diese Uhr umgerechnet. */
function deskFacts(now: number): Facts {
  const f: Facts = { ...facts }
  if (typingPerf > 0) f.typingAt = now - (performance.now() - typingPerf)
  return f
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function latestTool(): Facts['tool'] {
  let best: { kind: ToolKind; since: number } | null = null
  for (const t of running.values()) if (!best || t.since >= best.since) best = t
  return best
}

// Top-Level-Funktion: `$` darf nur an solche weitergereicht werden (docs/raw/en/create.md:317)
async function save($: EngineInterface) {
  const prev = ((await $.store.get('buddy')) ?? {}) as Stored
  await $.store.set('buddy', { ...prev, enabled, annoy })
}

/**
 * Fynn ist da (tippt bzw. die Desktop-Sitzung wird wieder angezeigt). War er länger als AWAY_MS weg, begrüßt Clawd ihn mit einer
 * Aufsteh-Animation (`facts.backAt`). Gespeichert wird nur der Zeitpunkt, höchstens alle 5 Minuten.
 */
async function noteSeen($: EngineInterface, now: number) {
  if (lastSeen > 0 && now - lastSeen >= AWAY_MS) {
    facts = { ...facts, backAt: now }
    $.ui.invalidate('ui.render')
  }
  lastSeen = Math.max(lastSeen, now)
  if (now - seenSaved < 300_000) return
  seenSaved = now
  const prev = ((await $.store.get('buddy')) ?? {}) as Stored
  await $.store.set('buddy', { ...prev, seenAt: now })
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  const nightStart = num(options.nightStart, 23)
  const nightEnd = num(options.nightEnd, 6)
  const idleSeconds = num(options.idleSeconds, 45)
  const reduced = options.reducedMotion === true
  const flip = options.side === 'left'
  const birthday = typeof options.birthday === 'string' ? options.birthday : ''
  const lang = langOf(options.language)
  const tx = T[lang]

  on('session.start', async ($, e, next) => {
    try {
      const s = ((await $.store.get('buddy')) ?? {}) as Stored
      if (typeof s.enabled === 'boolean') enabled = s.enabled
      annoy = num(s.annoy, 0)
      // Zuletzt gesehen (auch in einer anderen Sitzung): eine neue Sitzung am nächsten Morgen begrüßt dich so ebenfalls
      if (!lastSeen) lastSeen = num(s.seenAt, 0)
    } catch (err) {
      $.ui.log(`clawd-buddy: store not read: ${String(err)}`, { to: 'debug' })
    }
    try {
      await $.command.register({ name: 'clawd', description: tx.description, argumentHint: 'on | off | list | demo <animation> | nap | boop' })
    } catch (err) {
      $.ui.log(`/clawd not registered: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  // ---- Nutzungslimits (nur Prozent und Reset-Zeit, types:10566): ausgeschöpftes Limit → eigene Animationen
  on('session.measure', async ($, e, next) => {
    try {
      const pick = (kind: string) => e.rateLimits.find((r) => r.kind === kind)
      const five = pick('five_hour')
      const week = pick('seven_day')
      const ms = (iso?: string) => (iso ? Date.parse(iso) || undefined : undefined)
      const limits = { five: five?.percentUsed, fiveReset: ms(five?.resetsAt), week: week?.percentUsed, weekReset: ms(week?.resetsAt) }
      if (JSON.stringify(limits) !== JSON.stringify(facts.limits ?? {})) {
        facts = { ...facts, limits }
        $.ui.invalidate('ui.render')
      }
    } catch (err) {
      $.ui.log(`clawd-buddy: limits not read: ${String(err)}`, { to: 'debug' })
    }
    // Kontextfenster: nur die Prozentzahl (types:10771). Eine neue Stufe zeigt er am Turn-Ende; fällt sie (Komprimieren), ist sie wieder scharf.
    try {
      const pct = e.context?.percent
      if (typeof pct === 'number' && Number.isFinite(pct)) {
        const lvl = ctxLevel(pct)
        if (lvl > ctxWarned) ctxPending = true
        ctxWarned = lvl
        if (ctxPending && !facts.turnActive) {
          const at = await $.clock.now()
          ctxPending = false // erst nach dem Lesen der Uhr: wirft sie, bleibt die Warnung für das Turn-Ende stehen
          facts = { ...facts, ctxAt: at }
          $.ui.invalidate('ui.render')
        }
      }
    } catch (err) {
      $.ui.log(`clawd-buddy: context not read: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  // ---- Fakten aus den Events
  on('turn.start', async ($, e, next) => {
    facts = { ...facts, turnActive: true, endedKind: '', lastTool: undefined }
    try {
      if (!strain.turnSince) strain = strainTurnStart(strain, await $.clock.now())
      turnHadError = false
    } catch {
      // Laune ist Beiwerk: ohne Uhr bleibt sie, wie sie ist
    }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Ein Subagent-Lauf trägt `agentId`: dann ist dieser Subagent fertig (zählt nicht mehr), die Hauptstimmung bleibt
    if (e.agentId) {
      if (agentSeen.delete(e.agentId)) {
        let doneAt = facts.agentDoneAt ?? 0
        try {
          doneAt = await $.clock.now()
        } catch (err) {
          $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
        }
        facts = { ...facts, agents: [...agentSeen.values()], agentDoneAt: doneAt }
        $.ui.invalidate('ui.render')
      }
    } else {
      // Wirft die Uhr, bleibt der Turn trotzdem nicht "aktiv" hängen (letzte bekannte Zeit als Ersatz)
      let now = facts.endedAt
      try {
        now = await $.clock.now()
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
      running.clear()
      askTool = ''
      const turnMs = strain.turnSince ? Math.max(0, now - strain.turnSince) : 0
      facts = { ...facts, turnActive: false, tool: null, ask: false, endedAt: now, endedKind: e.reason === 'answer' ? 'done' : 'oops', turnMs }
      if (ctxPending) {
        ctxPending = false
        facts = { ...facts, ctxAt: now }
      }
      strain = strainTurnEnd(strain, now, e.reason === 'answer', !turnHadError)
      // Erfolgsserie erreicht eine Marke (5, 10, 15 …): Pokal/Medaille statt des normalen Abschlusses
      if (strain.streak > 0 && strain.streak % STREAK_STEP === 0) facts = { ...facts, streakAt: now }
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    // Subagenten-Tools (agentId) ändern die Hauptstimmung nicht; eine offene Rückfrage eines Subagenten räumen wir aber mit auf
    if (e.agentId) {
      // Subagent (auch Hintergrund, Worktree, Workflow, Teammate) ist aktiv: zählt für die Stimmung "Subagenten" bzw. "Schwarm"
      try {
        const isNew = !agentSeen.has(e.agentId)
        agentSeen.set(e.agentId, await $.clock.now())
        facts = { ...facts, agents: [...agentSeen.values()] }
        if (isNew) $.ui.invalidate('ui.render')
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
      try {
        return await next(e)
      } finally {
        if (askTool === id) {
          askTool = ''
          facts = { ...facts, ask: false }
          $.ui.invalidate('ui.render')
        }
      }
    }
    const isQuestion = e.tool === 'AskUserQuestion'
    const now = await $.clock.now()
    // Shell-Befehle genauer: Commit/Push bzw. Tests/Checks (nur Mustervergleich, der Befehl wird nicht gespeichert)
    const base = toolKind(e.tool)
    const kind = base === 'shell' ? shellKind((e as { command?: unknown }).command) : base
    running.set(id, { kind, since: now })
    facts = { ...facts, tool: latestTool(), ask: isQuestion || facts.ask, askSince: isQuestion && !facts.ask ? now : facts.askSince }
    $.ui.invalidate('ui.render')
    let res: Awaited<ReturnType<typeof next>> | undefined
    try {
      res = await next(e)
      return res
    } finally {
      // Laune: nur die Markierung zählt (Fehler bzw. abgelehnt), der Inhalt des Ergebnisses wird nicht gelesen
      if (res && (res.isError === true || typeof res.deny === 'string')) {
        strain = addHit(strain, now, res.isError === true ? SETBACK.toolError : SETBACK.denied)
        turnHadError = true
      } else if (!res) {
        strain = addHit(strain, now, SETBACK.toolError)
        turnHadError = true
      }
      running.delete(id)
      if (isQuestion || askTool === id) {
        askTool = ''
        facts = { ...facts, ask: false }
      }
      // Nachlauf (mood.ts TOOL_LINGER_MS): seine Arbeit bleibt kurz die Stimmung, auch wenn das Tool schon fertig ist
      let endedAt = now
      try {
        endedAt = await $.clock.now()
      } catch {
        // ohne Uhr zählt der Beginn als Ende: der Nachlauf wird nur kürzer
      }
      facts = { ...facts, tool: latestTool(), lastTool: isQuestion ? facts.lastTool : { kind, endedAt } }
      $.ui.invalidate('ui.render')
    }
  })

  on('tool.check', async ($, e, next) => {
    const decision = await next(e)
    // Eine Rückfrage ist gemeint, wenn die Kette bei einem echten Aufruf (`tool_use_id`) `ask` meldet. Ob der Modus sie danach selbst
    // bewilligt (z. B. "Berechtigungen umgehen"), sieht dieses Modul nicht; die Frage gilt bis das Tool endet.
    if (decision.decision === 'ask' && e.tool_use_id) {
      askTool = e.tool_use_id
      try {
        if (!facts.ask) facts = { ...facts, askSince: await $.clock.now() }
      } catch {
        // ohne Uhr keine Steigerung, die Rückfrage gilt trotzdem
      }
      facts = { ...facts, ask: true }
      $.ui.invalidate('ui.render')
    }
    return decision
  })

  // Komprimieren des Hauptgesprächs (nicht das Vorausrechnen `precompute`, nicht das eines Subagenten): solange es läuft
  on('session.compact', async ($, e, next) => {
    if (e.agentId || e.trigger === 'precompute') return next(e)
    try {
      facts = { ...facts, compactSince: await $.clock.now() }
      $.ui.invalidate('ui.render')
    } catch (err) {
      $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
    }
    try {
      return await next(e)
    } finally {
      facts = { ...facts, compactSince: undefined }
      $.ui.invalidate('ui.render')
    }
  })

  // Ein Skill startet: kurz zeigen (nur der Name zählt als Ereignis, der Text wird nicht gelesen)
  on('skill.prompt', async ($, e, next) => {
    try {
      facts = { ...facts, skillAt: await $.clock.now() }
      $.ui.invalidate('ui.render')
    } catch (err) {
      $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    // Zuerst weiterreichen: das Tippen darf nie verzögert werden. Keine `$`-Aufrufe pro Taste außer dem gedrosselten invalidate.
    const result = await next(e)
    typingPerf = performance.now()
    // Desktop: die Animation sieht das Mitlesen TYPING_MS lang voraus, also reicht eine Neuzeichnung je halbem Fenster
    if (typingPerf - typingInvalidatedPerf > (deskTimer ? TYPING_MS / 2 : 1000)) {
      typingInvalidatedPerf = typingPerf
      $.ui.invalidate('ui.render')
    }
    // Anwesenheit höchstens alle 30 s vermerken (erste Taste nach einer Pause zählt sofort)
    if (typingPerf - seenPerf > 30_000) {
      seenPerf = typingPerf
      try {
        await noteSeen($, await $.clock.now())
      } catch (err) {
        $.ui.log(`clawd-buddy: presence not noted: ${String(err)}`, { to: 'debug' })
      }
    }
    return result
  })

  // ---- Meldungen des Clients (Ärger-Zähler persistieren)
  on('ui.message', async ($, e, next) => {
    const data = e.data as { k?: string; annoy?: number } | null
    if (data && data.k === 'stat' && typeof data.annoy === 'number') {
      annoy = data.annoy
      try {
        await save($)
      } catch (err) {
        $.ui.log(`clawd-buddy: saving failed: ${String(err)}`, { to: 'debug' })
      }
    }
    return next(e)
  })

  // ---- /clawd
  on('command.run', { command: 'clawd' }, async ($, e) => {
    // Ohne Argument ist `args` "" (types:1616): dann Status
    const [first, ...rest] = e.args.trim().split(/\s+/)
    const sub = first || 'status'
    const arg = rest.join(' ').trim()
    // Desktop: die Engine steht beim Anfang der gezeigten Animation; vor einem Eingriff erst auf jetzt nachziehen
    const deskCatchUp = async () => {
      if (!desk) return
      deskForce = true
      try {
        desk.catchUp(await $.clock.now())
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
    }
    // demo und nap schalten ihn ein; das wird wie bei /clawd on gespeichert
    const ensureOn = async () => {
      if (enabled) return
      enabled = true
      try {
        await save($)
      } catch (err) {
        $.ui.log(`clawd-buddy: saving failed: ${String(err)}`, { to: 'debug' })
      }
    }
    if (sub === 'on' || sub === 'off') {
      enabled = sub === 'on'
      deskForce = true
      if (!enabled) {
        deskTimer?.cancel()
        deskTimer = null
      }
      try {
        await save($)
      } catch (err) {
        $.ui.log(`clawd-buddy: saving failed: ${String(err)}`, { to: 'debug' })
      }
      $.ui.invalidate('ui.render')
      return { text: enabled ? tx.on : tx.off }
    }
    if (sub === 'list') {
      const groups = new Map<string, string[]>()
      for (const c of ALL_CLIPS) if (c.cat !== 'transition') groups.set(c.cat, [...(groups.get(c.cat) ?? []), c.name])
      return { text: [...groups].map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n') }
    }
    if (sub === 'demo') {
      if (!arg) return { text: tx.demoUsage }
      const exact = ALL_CLIPS.find((c) => c.name === arg)
      // Gesucht wird in beiden Sprachen (Name, deutsche und englische Bezeichnung)
      const q = arg.toLowerCase()
      const part = ALL_CLIPS.filter((c) => c.name.includes(arg) || c.label.toLowerCase().includes(q) || clipLabel('en', c).toLowerCase().includes(q))
      const hit = exact ?? part[0]
      if (!hit) return { text: tx.demoNone(arg) }
      demo = hit.name
      demoN += 1
      await ensureOn()
      await deskCatchUp()
      desk?.engine.play(hit.name)
      $.ui.invalidate('ui.render')
      const more = part.length > 1 && !exact ? tx.demoMore(part.slice(1, 5).map((c) => c.name).join(', ')) : ''
      return { text: tx.demoPlays(hit.name, clipLabel(lang, hit)) + more }
    }
    if (sub === 'nap') {
      napN += 1
      await ensureOn()
      await deskCatchUp()
      desk?.nap()
      $.ui.invalidate('ui.render')
      return { text: tx.nap }
    }
    if (sub === 'boop') {
      boopN += 1
      await deskCatchUp()
      desk?.engine.click()
      $.ui.invalidate('ui.render')
      return { text: 'boop!' }
    }
    if (sub === 'status') {
      let now = facts.endedAt
      try {
        now = await $.clock.now()
      } catch (err) {
        $.ui.log(`clawd-buddy: clock not read: ${String(err)}`, { to: 'debug' })
      }
      const t = deriveTemper(strain, now)
      const m = tx.mood
      const mood = t.temper <= -0.6 ? m.veryGrumpy : t.temper <= -0.2 ? m.grumpy : t.temper >= 0.5 ? m.great : t.temper >= 0.2 ? m.good : m.even
      const deskInfo = meterText(lang, meter, performance.now())
      meter = newMeter()
      const text = tx.status({ on: enabled, mood, temper: fmt(lang, t.temper, 2), tired: Math.round(t.tired * 100), annoy, desk: deskInfo })
      return { text: `${text} ${tx.help}` }
    }
    return { text: `${tx.unknown(sub)} ${tx.help}` }
  })

  // ---- Zeichnen
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Was andere Mods ins Band zeichnen, bleibt erhalten (interface.md:210)
    const drawStart = performance.now()
    const theirs = await next(e)
    const othersMs = performance.now() - drawStart
    try {
      if (!enabled) return theirs
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return theirs
      // Ebenen anderer Mods (Quick-Replies, sidekick) bleiben über dem Grund, nie neben Clawd, egal wer in der Kette außen liegt
      // (band.ts, docs/BAND.md). Clawd kommt nur neben den Grund (z. B. die Limit-Balken).
      const { layers, base } = splitBand(theirs)
      const now = await $.clock.now()
      // Schnittstelle zu sidekick: dessen `$.state`-Wert lesen. Das Lesen beim Zeichnen abonniert ihn, ein Schreiben von sidekick
      // zeichnet das Band neu (types:3308-3313). Ohne sidekick bleibt er leer.
      try {
        const sk = await $.state.get({ plugin: 'sidekick', key: 'buddy' })
        const v = sidekickValue(sk.value)
        if (JSON.stringify(v) !== JSON.stringify(facts.sidekick ?? null)) facts = { ...facts, sidekick: v }
      } catch (err) {
        $.ui.log(`clawd-buddy: sidekick state not read: ${String(err)}`, { to: 'debug' })
      }
      // Client-Props dürfen kein `undefined` enthalten (die Engine lehnt sie ab): leere Felder weglassen
      const f: Facts = JSON.parse(JSON.stringify(facts)) as Facts
      if (typingPerf > 0) f.typingAt = now - (performance.now() - typingPerf)
      const { Box, Client } = $.ui.resolve(e)
      const buddyProps = {
        // Zeichnet ein anderer Mod links daneben, bekommt er 44 Spalten (Clawd behält mindestens 40)
        columns: base ? Math.min(e.props.bodyColumns, Math.max(40, e.props.bodyColumns - 44)) : e.props.bodyColumns,
        maxRows: e.props.maxRows,
        now,
        nightStart,
        nightEnd,
        idleSeconds,
        reduced,
        flip,
        birthday,
        seed,
        facts: f,
        strain,
        demo,
        demoN,
        napN,
        boopN,
        annoy,
      }
      if (e.surface === 'desktop') {
        // Desktop: Engine im Hooks-Modul, Bild als animiertes Svg (deckende Figur auf durchsichtigem Grund), direkt über der Eingabe.
        if (!desk) {
          desk = createDesk({ seed, nightStart, nightEnd, idleSeconds, reduced, flip, birthday })
        }
        if (!deskTimer) {
          deskForce = true // die Sitzung wird (wieder) angezeigt: der Rahmen ist ohnehin neu
          // Der Wächter startet neu: die Sitzung wird (wieder) angezeigt, Fynn schaut also hin
          try {
            await noteSeen($, now)
          } catch (err) {
            $.ui.log(`clawd-buddy: presence not noted: ${String(err)}`, { to: 'debug' })
          }
          deskTimer = $.clock.every(DESK_CHECK, () => {
            // Aus oder die App zeichnet das Band nicht mehr (z. B. Sitzung verdeckt): Wächter beenden; das nächste Zeichnen startet ihn neu
            if (!desk || !enabled || deskAsked > DESK_IDLE_CHECKS) {
              deskTimer?.cancel()
              deskTimer = null
              return
            }
            deskChecks += 1
            if (deskAsked > 0) deskAsked += 1
            else if (deskChecks * DESK_CHECK >= deskPlanMs - DESK_LEAD) {
              deskAsked = 1
              $.ui.invalidate('ui.render')
            }
          })
        }
        const calcStart = performance.now()
        const fNow = deskFacts(now)
        // Ändern die neuen Fakten an der gezeigten Animation (vorerst) nichts, bleibt das Svg dasselbe: kein Neuladen, kein Flackern
        const keep = deskSource !== '' && !deskForce && deskAsked === 0
        const div = keep ? desk.divergence(now, fNow) : 0
        const left = keep ? desk.remaining(now) : 0
        if (keep && div > DESK_LEAD && left > DESK_LEAD) {
          // Der Wächter bittet kurz vor der Abweichung bzw. dem Ende um die nächste Zeichnung (Runden zählen ab der letzten echten)
          deskPlanMs = now - deskDrawnAt + Math.min(div, left)
          meter.reused += 1
        } else {
          // Stand so auf jetzt nachziehen, wie die gezeigte Animation lief, dann ab jetzt mit den neuen Fakten vorausrechnen
          const plan = desk.draw(now, fNow, strain, DESK_SCALE)
          deskSource = plan.source
          deskDrawnAt = now
          deskForce = false
          deskPlanMs = plan.ticks * DESK_TICK
          deskChecks = 0
          deskAsked = 0
          const calc = performance.now() - calcStart
          meter.draws += 1
          meter.planSecs += deskPlanMs / 1000
          meter.changes += plan.changes
          meter.chars += plan.source.length
          meter.calcSum += calc
          meter.calcMax = Math.max(meter.calcMax, calc)
        }
        const { Svg } = $.ui.resolve(e)
        const drawMs = performance.now() - drawStart
        meter.drawSum += drawMs
        meter.drawMax = Math.max(meter.drawMax, drawMs)
        meter.othersSum += othersMs
        return joinBand(layers, Box({
          flexDirection: flip ? 'row-reverse' : 'row',
          alignItems: 'flex-end',
          // Jede Seite drückt ihren Inhalt selbst nach unten (Spalte, justifyContent flex-end): die Desktop-App setzt alignItems der
          // Zeile nicht immer um, und je nach Reihenfolge der Mods saßen fremde Balken sonst oben statt auf Höhe von Clawds Füßen.
          children: [
            Box({ flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end', children: [base] }),
            Box({
              key: 'buddy',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              // Nie zusammendrücken: sonst schneidet ein schmales Band (Seitenbereich offen) das 400-px-Bild rechts ab, und mit ihm die Hand
              // (Fynn, 2026-10-06). Schmaler wird die linke Seite mit flexGrow.
              flexShrink: 0,
              // isInteractive: im Rahmen ohne Skripte, damit SMIL läuft (types:11957); als Bild stünde nur das erste Bild
              children: [Svg({ source: deskSource, alt: tx.alt, width: W * DESK_SCALE, height: H * DESK_SCALE, isInteractive: true })],
            }),
          ],
        }))
      }
      // Eine Zeile: was andere Mods ins Band zeichnen (z. B. Limit-Balken), steht links und füllt den Platz; Clawd unten rechts daneben
      return joinBand(layers, Box({
        flexDirection: flip ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        children: [
          Box({ flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end', children: [base] }),
          Box({ flexDirection: 'column', justifyContent: 'flex-end', children: [Client({ key: 'buddy', module: './buddy.ts', props: buddyProps })] }),
        ],
      }))
    } catch (err) {
      $.ui.log(`clawd-buddy ui.render: ${String(err)}`, { to: 'debug' })
      return theirs
    }
  })
}
