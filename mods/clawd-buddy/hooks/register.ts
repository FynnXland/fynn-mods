// clawd-buddy: Hooks-Modul. Beobachtet nur: jeder Event-Hook gibt per `next(e)` unverändert weiter, nichts wird blockiert oder verändert.
//
// Aufgabe: aus Events *Fakten* sammeln (wann begann der Turn, welches Tool läuft seit wann, ob eine Frage offen ist, wann zuletzt
// getippt wurde, wie der letzte Turn endete) und sie als `props` an das Client-Modul `./buddy.ts` reichen. Die Stimmung leitet der Client
// daraus auf seiner eigenen Uhr ab (mood.ts); `$.ui.invalidate` läuft darum nur bei echten Ereignissen, nie im Bildtakt.
// Zeichnet ins Band über dem Prompt (docs/raw/en/interface.md:207-213) und lässt fremden Inhalt stehen (`await next(e)` als Kind).
import type { EngineInterface, On, Timer } from 'claude-code'
import { joinBand, splitBand } from './band.ts'
import { ALL_CLIPS } from './library.ts'
import { AWAY_MS, NO_FACTS, NO_STRAIN, SETBACK, STREAK_STEP, addHit, deriveTemper, shellKind, strainTurnEnd, strainTurnStart, toolKind } from './mood.ts'
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
let typingPerf = 0 // performance.now() des letzten Tastendrucks (synchron lesbar, ohne `$`-Aufruf pro Taste)
let typingInvalidatedPerf = -1e9
// Rückkehr nach langer Pause (Begrüßung): letzte Anwesenheit (ms, auch über Sitzungen hinweg gespeichert) und Drosseln
let lastSeen = 0
let seenSaved = 0
let seenPerf = -1e9

// Desktop-App: Dort lädt der Client-Rahmen nicht; die Engine läuft im Hooks-Modul (desk.ts) und zeichnet je Takt ein Svg.
// Der Takt (`$.clock.every`, liefert einen Timer mit `cancel()`, types:11881) läuft nur, solange die Desktop-App das Band zeichnet und der
// Buddy an ist: `/clawd off` bricht ihn ab, und zeichnet die App 2 s lang nicht mehr, bricht er sich selbst ab; das nächste Zeichnen startet ihn neu.
// Invalidiert wird nur, wenn sich das Bild geändert hat (Fynn, 2026-10-05: 13 Neuzeichnungen/s ließen die Knöpfe anderer Mods im Band
// unter der Maus flackern). Darum zählt der Abbruch nur Takte, in denen ein geändertes Bild auf seine Zeichnung wartet.
const DESK_SCALE = 4 // CSS-Pixel je Figurpixel: Figur 68 × 40 px, Bühne 400 × 56 px
const DESK_IDLE_TICKS = 27 // ~2 s ohne Zeichnung (in Takten gezählt, nicht in Echtzeit)
let desk: Desk | null = null
let deskTimer: Timer | null = null
let deskNowBase = 0 // Hooks-Uhr bei der letzten Desktop-Zeichnung
let deskTicksSinceDraw = 0 // Takte seit der letzten Desktop-Zeichnung
let deskShown = '' // zuletzt gezeichnetes Svg
let deskUnanswered = 0 // Takte, seit ein geändertes Bild invalidiert und noch nicht gezeichnet wurde (0 = nichts offen)
const deskNow = (): number => deskNowBase + deskTicksSinceDraw * DESK_TICK
// Messung für `/clawd status` (Fynn, 2026-10-05: Clawd wirkt bei mehreren Agenten verzögert). Zählt seit dem letzten `/clawd status`,
// mit performance.now() (synchron, kein `$`-Aufruf je Takt): Takte, größte Lücke zwischen Takten, Bildwechsel, Zeichnungen, Dauer.
type DeskMeter = { since: number; ticks: number; lastTick: number; gapMax: number; calcSum: number; calcMax: number; changes: number; draws: number; drawSum: number; drawMax: number; othersSum: number }
const newMeter = (): DeskMeter => ({ since: performance.now(), ticks: 0, lastTick: 0, gapMax: 0, calcSum: 0, calcMax: 0, changes: 0, draws: 0, drawSum: 0, drawMax: 0, othersSum: 0 })
let meter = newMeter()
function meterText(lang: Lang, m: DeskMeter, at: number): string {
  const s = (at - m.since) / 1000
  if (m.ticks === 0 && m.draws === 0) return T[lang].deskNone
  const ps = (n: number) => fmt(lang, s > 0 ? n / s : 0)
  const avg = (sum: number, n: number) => fmt(lang, n ? sum / n : 0)
  return T[lang].desk({
    secs: s.toFixed(0), tps: ps(m.ticks), target: fmt(lang, 1000 / DESK_TICK), gap: Math.round(m.gapMax),
    calcAvg: avg(m.calcSum, m.ticks), calcMax: fmt(lang, m.calcMax), changes: ps(m.changes), draws: ps(m.draws),
    drawAvg: avg(m.drawSum, m.draws), drawMax: fmt(lang, m.drawMax), others: avg(m.othersSum, m.draws),
  })
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
    return next(e)
  })

  // ---- Fakten aus den Events
  on('turn.start', async ($, e, next) => {
    facts = { ...facts, turnActive: true, endedKind: '' }
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
      facts = { ...facts, turnActive: false, tool: null, ask: false, endedAt: now, endedKind: e.reason === 'answer' ? 'done' : 'oops' }
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
    running.set(id, { kind: base === 'shell' ? shellKind((e as { command?: unknown }).command) : base, since: now })
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
      facts = { ...facts, tool: latestTool() }
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

  on('prompt.edit', async ($, e, next) => {
    // Zuerst weiterreichen: das Tippen darf nie verzögert werden. Keine `$`-Aufrufe pro Taste außer dem gedrosselten invalidate.
    const result = await next(e)
    typingPerf = performance.now()
    if (typingPerf - typingInvalidatedPerf > 1000) {
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
      desk?.engine.play(hit.name)
      $.ui.invalidate('ui.render')
      const more = part.length > 1 && !exact ? tx.demoMore(part.slice(1, 5).map((c) => c.name).join(', ')) : ''
      return { text: tx.demoPlays(hit.name, clipLabel(lang, hit)) + more }
    }
    if (sub === 'nap') {
      napN += 1
      await ensureOn()
      desk?.nap()
      $.ui.invalidate('ui.render')
      return { text: tx.nap }
    }
    if (sub === 'boop') {
      boopN += 1
      desk?.engine.click()
      $.ui.invalidate('ui.render')
      return { text: 'boop!' }
    }
    if (sub === 'status') {
      let now = deskNowBase
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
        // Desktop: Engine im Hooks-Modul, Bild als Svg (deckende Figur auf durchsichtigem Grund), direkt über der Eingabe.
        deskNowBase = now
        if (!desk) {
          desk = createDesk({ seed, nightStart, nightEnd, idleSeconds, reduced, flip, birthday })
        }
        deskTicksSinceDraw = 0
        deskUnanswered = 0
        if (!deskTimer) {
          // Der Takt startet neu: die Sitzung wird (wieder) angezeigt, Fynn schaut also hin
          try {
            await noteSeen($, now)
          } catch (err) {
            $.ui.log(`clawd-buddy: presence not noted: ${String(err)}`, { to: 'debug' })
          }
          deskTimer = $.clock.every(DESK_TICK, () => {
            // Aus oder die App zeichnet das Band nicht mehr (z. B. Sitzung verdeckt): Takt beenden; das nächste Zeichnen startet ihn neu
            if (!desk || !enabled || deskUnanswered > DESK_IDLE_TICKS) {
              deskTimer?.cancel()
              deskTimer = null
              return
            }
            const tickStart = performance.now()
            if (meter.lastTick) meter.gapMax = Math.max(meter.gapMax, tickStart - meter.lastTick)
            meter.lastTick = tickStart
            meter.ticks += 1
            deskTicksSinceDraw += 1
            const t = deskNow()
            const df: Facts = { ...facts }
            if (typingPerf > 0) df.typingAt = t - (performance.now() - typingPerf)
            desk.tick(t, df, strain)
            // Gleiches Bild: nichts neu zeichnen (das ganze Band würde sonst bei jedem Takt neu gerendert)
            const changed = desk.svg(DESK_SCALE) !== deskShown
            if (changed) $.ui.invalidate('ui.render')
            if (changed || deskUnanswered > 0) deskUnanswered += 1
            if (changed) meter.changes += 1
            const calc = performance.now() - tickStart
            meter.calcSum += calc
            meter.calcMax = Math.max(meter.calcMax, calc)
          })
        }
        const { Svg } = $.ui.resolve(e)
        deskShown = desk.svg(DESK_SCALE)
        const drawMs = performance.now() - drawStart
        meter.draws += 1
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
              children: [Svg({ source: deskShown, alt: tx.alt, width: W * DESK_SCALE, height: H * DESK_SCALE })],
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
