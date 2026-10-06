// limit-bars: Hooks-Modul. Im Band über dem Prompt (AbovePrompt, docs/raw/en/interface.md:207-213) zwei schmale Balken für das
// 5-Stunden- und das Wochenlimit und rechts daneben ein Ring, wie lange der Prompt-Cache dieser Session noch warm ist.
// Limits: `$.session.usage()` beim Start und bei jedem Tick, dazu `session.measure` (types@2.1.288:10410-10436).
// Cache: `turn.step` der Hauptschleife (usage mit cache_read/cache_creation, types@2.1.289:12837-12869), gespeichert in `$.store`.
// Dazu die Cache-Wache nach Nate Herks Cache Keeper (docs/vorlagen/nateherk-cache-keeper, MIT): Rückfrage vor kaltem Senden,
// Hinweis kurz vor Ablauf, /cache, /handoff mit Skill „uebergabe“, /keepwarm (Standard aus).
// Texte en/de nach `userConfig.language` (i18n.ts); Argumente englisch, die deutschen gelten weiter als Alias.
// Fail-open: Ein Fehler heißt nur „keine Anzeige“ bzw. „Nachricht geht unverändert durch“; was andere Mods zeichnen, bleibt erhalten.
import type { EngineInterface, On, RenderNode, Timer } from 'claude-code'
import { joinBand, splitBand } from './band.ts'
import {
  DEFAULT_SETTINGS,
  MIN,
  applySetting,
  cacheReport,
  cacheState,
  cleanMem,
  cleanSettings,
  emptyMem,
  inputCost,
  observeStep,
  pingDue,
  pingMissed,
  readCost,
  rewriteCost,
  ringFor,
  spanText,
  terminalBlock,
  tokensText,
  ttlOf,
} from './cache.ts'
import type { CacheMem, KeepWarm, ReportLimit, Settings, StepUsage } from './cache.ts'
import { CACHE_ARGS, CACHE_HINT, HANDOFF_HINT, T, hhmm, langOf, usd } from './i18n.ts'
import type { Lang } from './i18n.ts'
import { ringFilled } from './ring.ts'
import { desktopSvg } from './svg.ts'
import { EMPTY, ORANGE, filled, layoutTerminal, pickWindows, placeholderWindows, shownWindows } from './view.ts'
import type { Opts, ResetStyle, Win } from './view.ts'

// Optionen aus userConfig, in register() gesetzt
let lang: Lang = 'en'
let opts: Opts = { resetStyle: 'mixed', highlightAt: 90, onlyFiveHour: false, lang }

// Limits: flüchtig (Kontingent gehört zum Konto und kommt mit jeder Messung neu)
let wins: Win[] = []
let usageAsked = false
// 10-s-Takt, nur solange das Band gezeichnet wird (Timer mit cancel(), types@2.1.288:11912-11917; eine abgelehnte Periode beendet ihn,
// types@2.1.288:3251). Jeder Tick holt `$.session.usage()`: Das sind die Werte der letzten API-Antwort (types@2.1.288:11033-11034), also
// auch mitten in einem langen Turn, während `session.measure` erst am Turn-Ende kommt (Fynn, 2026-10-05: "aktualisiert viel zu selten").
// Der Takt läuft auch ohne Daten. Neu gezeichnet wird nur, wenn sich etwas Sichtbares ändert (Fynn, 2026-10-05: Jedes
// Invalidate zeichnet das ganze Band neu, auch die Knöpfe anderer Mods, die dann beim Darüberfahren flackerten).
const TICK = 10000
let timer: Timer | null = null
let drawnKey = '' // was zuletzt gezeichnet wurde (Texte, Farben, Füllstufen)
let awaitingRender = false // ein Neuzeichnen ist angefordert, aber noch nicht gekommen
let timerSince = 0 // Uhrzeit beim Start des Takts
let ticks = 0 // Ticks seit dem Start
// Lehnt eine Claude-Code-Version das Umschreiben von bodyColumns ab, stapelt limit-bars danach über dem Rest (SPEC.md, Phase 0)
let noRewrite = false

// Cache dieser Session. `mem` liegt in `$.store` unter `cache:<sessionId>`, damit der Ring nach Neustart oder Reload weiß, wie warm er ist.
let sessionId = ''
let mem: CacheMem = emptyMem()
let settings: Settings = { ...DEFAULT_SETTINGS }
let justCompacted = false
let working = false // ein Turn der Hauptschleife läuft (turn.step … turn.complete)
let currentTurn = ''
let cold = { count: 0, usd: 0 } // kalte Neustarts dieser Sitzung
let last: { read: number; written: number; at: number } | null = null
let sessionUsd: number | null = null
let alerted = 0 // lastActivity, für die der Hinweis „läuft bald ab“ schon kam
// Warmhalten: Standard aus, eigener 30-s-Takt nur solange an (es muss auch laufen, wenn das Band nicht gezeichnet wird)
let keep: KeepWarm | null = null
let keepTimer: Timer | null = null
let pinging = false
let forking = false // ein Warmhalte-Ping ist unterwegs
// Übergabe: /handoff startet den Skill, turn.complete fängt dessen Antwort ab
const H = { pending: false, armed: false, notTurn: '', text: '', continuing: false }

const STYLES: readonly ResetStyle[] = ['mixed', 'clock', 'countdown']
const KEEP_MAX_H = 4
const SKILL = /(^|:)uebergabe$/
// Überschrift der Übergabe in beiden Sprachen (skills/uebergabe/SKILL.md); wie bisher auch als `##`/`###`
const HANDOFF_TITLE = /^#{1,3} (Handoff|Übergabe)\b/m

const msg = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 140)

/**
 * Einmal `fn` nach `ms`, außerhalb des aufrufenden Hooks. Aus einem command.run-Hook lehnt der Host `$.command.run` und
 * `$.prompt.submit` ab (SPEC, Bau v0.2.0); ein Timer über das schon genehmigte `$.clock.every` kommt heraus (statt `$.clock.after`).
 */
function later($: EngineInterface, ms: number, fn: () => void) {
  const t = $.clock.every(ms, () => {
    t.cancel()
    fn()
  })
}

/** Limits einmal abholen (ohne `breakdown` kostenlos, types@2.1.288:11048-11056); abgelehnt: die nächste Messung füllt sie. */
async function loadWindows($: EngineInterface): Promise<void> {
  usageAsked = true
  try {
    wins = pickWindows((await $.session.usage()).rateLimits)
  } catch {
    // kein Anfangsstand
  }
}

/** Gehört der Stand noch zu diesem Chat? Nach /clear oder /resume gibt es eine neue Session-ID: dann deren Stand laden. */
async function bindSession($: EngineInterface): Promise<void> {
  let id = ''
  try {
    id = await $.session.id()
  } catch {
    return
  }
  if (!id || id === sessionId) return
  const switched = sessionId !== ''
  sessionId = id
  mem = emptyMem()
  last = null
  justCompacted = false
  alerted = 0
  if (switched) {
    cold = { count: 0, usd: 0 }
    stopKeep($, T[lang].whyNewChat)
  }
  try {
    const saved = cleanMem(await $.store.get(`cache:${id}`))
    if (saved) mem = { lastActivity: saved.lastActivity, ttl: saved.ttl, ttlSource: saved.ttlSource, ctx: saved.ctx, model: saved.model }
  } catch {
    // ohne gespeicherten Stand: unbekannt bis zur ersten Anfrage
  }
}

function persist($: EngineInterface, now: number) {
  if (!sessionId) return
  $.store.set(`cache:${sessionId}`, { ...mem, savedAt: now }).catch(() => {})
}

/** Einträge älter als 7 Tage aufräumen (SPEC, Persistenz). */
async function cleanup($: EngineInterface, now: number) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith('cache:')).slice(0, 200)
  for (const k of keys) {
    const m = cleanMem(await $.store.get(k))
    if (!m || now - m.savedAt > 7 * 24 * 60 * MIN) await $.store.delete(k)
  }
}

function stopKeep($: EngineInterface, why: string) {
  if (!keep) return
  const k = keep
  keep = null
  keepTimer?.cancel()
  keepTimer = null
  $.ui.toast(T[lang].keepOff(why, String(k.pings), usd(k.usd, lang)), { timeoutMs: 10000 })
  $.ui.invalidate('ui.render')
}

/** Ein Takt des Warmhaltens: Ping per `$.model.fork` kurz vor Ablauf; schreibt er statt zu lesen, schaltet es sich ab. */
function keepStep($: EngineInterface) {
  if (!keep || pinging) return
  const t = T[lang]
  pinging = true
  $.clock
    .now()
    .then(async (now) => {
      if (!keep) return
      if (now >= keep.until) return stopKeep($, t.whyTimeUp)
      const ttl = ttlOf(mem, settings)
      if (working || !pingDue(mem.lastActivity, ttl, now)) return
      if (now - mem.lastActivity >= ttl * MIN) return stopKeep($, t.whyWasCold)
      forking = true
      // Nur die Antwort „ok“ zählt nicht, nur das Lesen des Caches; der Prompt bleibt deshalb einsprachig
      const r = await $.model.fork({ prompt: 'limit-bars keep-warm ping. Reply only with: ok' }).finally(() => {
        forking = false
      })
      if (!keep) return
      const u = (r as { usage?: StepUsage }).usage
      if (u) {
        keep.pings += 1
        keep.usd += inputCost(u, mem.model, ttl)
      }
      // `usage` kommt auch bei einem gescheiterten Fork (api-error, aborted), dann meist mit Nullen (types@2.1.289:5976-5977):
      // nur eine Antwort, die wirklich aus dem Cache las, zählt als Warmhalten (Review S1)
      if (!u || (!r.isAnswered && r.reason !== 'empty-reply') || !(u.cache_read_input_tokens > 0)) {
        return stopKeep($, r.isAnswered || r.reason === 'empty-reply' ? t.whyNoRead : t.whyNoReply(String(r.reason)))
      }
      if (pingMissed(u)) return stopKeep($, t.whyRewrote(tokensText(u.cache_creation_input_tokens, lang)))
      mem = { ...mem, lastActivity: now }
      persist($, now)
      $.ui.invalidate('ui.render')
    })
    .catch((err) => stopKeep($, t.whyFailed(msg(err))))
    .finally(() => {
      pinging = false
    })
}

/** Hinweis, sobald ein großer Chat in die gelbe Phase geht; einmal je Phase (SPEC, Vorwarnung). */
function alertStep($: EngineInterface, now: number) {
  if (!settings.alerts || keep || mem.ctx < settings.bigTokens || alerted === mem.lastActivity) return
  const ttl = ttlOf(mem, settings)
  const st = cacheState(mem.lastActivity, ttl, now, false)
  if (st.kind !== 'cooling') return
  alerted = mem.lastActivity
  $.ui.toast(T[lang].alert(spanText(st.left, lang), tokensText(mem.ctx, lang), usd(rewriteCost(mem.ctx, mem.model, ttl), lang)), { timeoutMs: 20000 })
}

/** Die Übergabe ohne Vorrede vor der Überschrift (`# Handoff` bzw. `# Übergabe`). */
function handoffBody(answer: string): string {
  const t = String(answer || '').trim()
  const i = t.search(HANDOFF_TITLE)
  return i > 0 ? t.slice(i) : t
}

async function loadHandoffs($: EngineInterface): Promise<{ at: number; session: string; text: string }[]> {
  try {
    const v = await $.store.get('handoffs')
    return Array.isArray(v) ? v.filter((h) => h && typeof h.text === 'string' && typeof h.at === 'number') : []
  } catch {
    return []
  }
}

function captureHandoff($: EngineInterface, answer: string, now: number) {
  const t = T[lang]
  H.armed = false
  const body = handoffBody(answer)
  if (body.length < 200) {
    $.ui.toast(t.handoffEmpty, { timeoutMs: 8000 })
    return
  }
  H.text = body
  // Die letzten 3 Übergaben in `$.store`; scheitert /clear, holt `/handoff show` sie zurück
  loadHandoffs($)
    .then((list) => $.store.set('handoffs', [{ at: now, session: sessionId, text: body }, ...list].slice(0, 3)))
    .catch(() => {})
  // Nicht im Hook fragen: der Turn endet gerade, ein Dialog hielte ihn offen
  later($, 300, () => {
    $.ui
      // Die Frage endet mit „?“ (types@2.1.289:2340); Optionen tragen keine Beschreibung, darum steht die Erklärung im Fragetext
      .ask(t.handoffQuestion, { options: [t.clearGo, t.keepChat], header: t.handoffHeader })
      .then((a) => (a === t.clearGo ? clearAndContinue($) : undefined))
      .catch(() => $.ui.toast(t.handoffSavedLater, { timeoutMs: 12000 }))
  })
}

async function clearAndContinue($: EngineInterface) {
  const t = T[lang]
  if (H.continuing) return
  if (!H.text) {
    const list = await loadHandoffs($)
    if (!list[0]) {
      $.ui.toast(t.handoffNone, { timeoutMs: 8000 })
      return
    }
    H.text = list[0].text
  }
  if (working) {
    $.ui.toast(t.handoffBusy, { timeoutMs: 8000 })
    return
  }
  H.continuing = true
  const text = `${t.handoffPrefix}\n\n${H.text}`
  try {
    try {
      await $.command.run({ command: 'clear' })
    } catch (err) {
      $.ui.toast(t.clearFailed(msg(err)), { timeoutMs: 15000 })
      return
    }
    H.text = ''
    try {
      await $.prompt.submit({ text, asUser: true })
      // /clear startet eine neue Session, die alte bleibt erhalten (docs/raw/related/interactive-mode.md:276)
      $.ui.toast(t.handoffStarted, { timeoutMs: 8000 })
    } catch {
      $.ui.toast(t.handoffSendFailed, { timeoutMs: 15000 })
    }
  } finally {
    H.continuing = false
  }
}

/** Was Balken, Ring und Terminal-Block jetzt zeigen; gemeinsam für das Zeichnen und den Änderungsschlüssel. */
function snapshot(now: number) {
  const shown = wins.length > 0 ? shownWindows(wins, now, opts) : []
  const ttl = ttlOf(mem, settings)
  const st = cacheState(mem.lastActivity, ttl, now, !!keep)
  const big = mem.ctx >= settings.bigTokens
  return { shown, ring: ringFor(st, ttl, mem.ctx, big, lang), block: terminalBlock(st, big, lang) }
}

/** Alles, was im Band sichtbar ist, als Schlüssel: ändert er sich, muss neu gezeichnet werden, sonst nicht. */
function keyOf(v: ReturnType<typeof snapshot>): string {
  const r = v.ring
  return JSON.stringify([
    v.shown.map((x) => [x.tag, x.pct.long, x.reset?.long ?? '', x.color, x.strong, x.fresh, Math.round(x.ratio * 44)]),
    [r.main, r.sub ?? '', r.subColor ?? '', r.color, r.mainColor, ringFilled(r.fill), r.kept],
    v.block?.text ?? '',
  ])
}

/** Neu zeichnen nur bei sichtbarer Änderung (Minute, Prozent, Kontext, Zustand). */
function refresh($: EngineInterface, now: number) {
  if (keyOf(snapshot(now)) === drawnKey) return
  awaitingRender = true
  $.ui.invalidate('ui.render')
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  const hl = typeof options.highlightAt === 'number' && Number.isFinite(options.highlightAt) ? options.highlightAt : 90
  lang = langOf(options.language)
  opts = {
    resetStyle: STYLES.find((s) => s === options.resetStyle) ?? 'mixed',
    highlightAt: Math.max(50, Math.min(100, hl)),
    onlyFiveHour: options.onlyFiveHour === true,
    lang,
  }

  on('session.start', async ($, e, next) => {
    // Nur wo das Band gezeichnet wird (types@2.1.288:9576); `-p`/SDK liefern null, VS Code und mobil zeichnen kein Band
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      await loadWindows($)
      if (wins.length > 0) $.ui.invalidate('ui.render')
    }
    try {
      settings = cleanSettings(await $.store.get('settings'))
    } catch {
      // Standard
    }
    await bindSession($)
    $.clock
      .now()
      .then((now) => cleanup($, now))
      .catch(() => {})
    // Befehle zuletzt, jeder für sich (CLAUDE.md, Registrieren in session.start)
    const t = T[lang]
    for (const c of [
      { name: 'cache', description: t.cmdCache, argumentHint: CACHE_HINT },
      { name: 'handoff', description: t.cmdHandoff, argumentHint: HANDOFF_HINT },
      { name: 'keepwarm', description: t.cmdKeepwarm, argumentHint: t.hintKeepwarm },
    ]) {
      try {
        await $.command.register(c)
      } catch {
        // ohne diesen Befehl
      }
    }
    return next(e)
  })

  // Jede Anfrage der Hauptschleife: Cache gelesen oder neu geschrieben? Nur beobachten (Vorlage register.mjs:537-568)
  on('turn.step', async function* ($, e, next) {
    // Subagenten nicht; ebenso nicht der eigene Warmhalte-Ping, falls `$.model.fork` als Schritt erscheint (nicht belegt, Review
    // [UNKLAR]): sonst bliebe `working` ohne turn.complete stehen und das Warmhalten pingte nie wieder
    if (e.agentId || forking) return yield* next(e)
    let startedAt = 0
    try {
      startedAt = await $.clock.now()
    } catch {
      // ohne Uhr keine Auswertung
    }
    working = true
    currentTurn = e.turnId
    const r = yield* next(e)
    try {
      const u = r.usage
      if (u && startedAt) {
        await bindSession($)
        const res = observeStep(mem, u, startedAt, justCompacted)
        justCompacted = false
        if (res.coldWritten) {
          cold.count += 1
          cold.usd += rewriteCost(res.coldWritten, res.mem.model, ttlOf(res.mem, settings))
        }
        mem = res.mem
        last = { read: u.cache_read_input_tokens, written: u.cache_creation_input_tokens, at: startedAt }
        persist($, startedAt)
        refresh($, await $.clock.now())
      }
    } catch {
      // Beiwerk: die Anfrage selbst bleibt unberührt
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    working = false
    try {
      if (H.armed && e.turnId !== H.notTurn) captureHandoff($, e.reason === 'answer' ? e.answer : '', await $.clock.now())
    } catch {
      H.armed = false
    }
    return r
  })

  // Die erste Anfrage nach einer Kompaktierung schreibt den kürzeren Kontext neu: kein kalter Neustart (Vorlage, justCompacted)
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && r && !('skip' in r && r.skip)) justCompacted = true
    return r
  })

  // Rückfrage vor kaltem Senden. Fail-open: lieber eine Nachricht durchlassen als eine verschlucken.
  on('prompt.submit', async ($, e, next) => {
    const t = T[lang]
    let question = ''
    // Einstellungen frisch lesen: `/cache warn off` in einer anderen Session soll sofort auch hier gelten (0.2.1).
    // Fail-open: geht das Lesen schief, bleibt der Stand dieser Session.
    try {
      settings = cleanSettings(await $.store.get('settings'))
    } catch {
      // Stand dieser Session
    }
    try {
      const fromUser = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
      if (settings.guard && fromUser && !e.turnId && !e.text.trim().startsWith('/')) {
        await bindSession($)
        if (mem.ctx >= settings.bigTokens) {
          const ttl = ttlOf(mem, settings)
          const st = cacheState(mem.lastActivity, ttl, await $.clock.now(), false)
          if (st.kind === 'cold') {
            question = t.guardQuestion(
              spanText(-st.left, lang),
              tokensText(mem.ctx, lang),
              usd(rewriteCost(mem.ctx, mem.model, ttl), lang),
              usd(readCost(mem.ctx, mem.model), lang),
            )
          }
        }
      }
    } catch {
      return next(e)
    }
    if (!question) return next(e)
    let answer = t.send
    // Mit Anhängen oder `@datei` kein „Erst komprimieren“: als Plugin-Prompt neu gesendet, fehlten sie (types@2.1.289:8521-8523, Review S3)
    const resendable = !e.attachments?.length && !/(^|\s)@\S/.test(e.text)
    try {
      answer = await $.ui.ask(question, { options: resendable ? [t.send, t.compact, t.abort] : [t.send, t.abort], header: 'Cache' })
    } catch {
      // niemand zu fragen (-p) oder Dialog geschlossen: so senden, wie getippt
      return next(e)
    }
    if (answer === t.abort) {
      try {
        $.ui.toast(t.abortToast, { timeoutMs: 12000 })
      } catch {
        // nur der Hinweis fehlt
      }
      return { drop: t.dropAbort }
    }
    if (answer === t.compact && resendable) {
      // Aus prompt.submit lehnt der Host `$.session.compact()` ab („would compact under the turn this hook is holding“, Test-Kit
      // 2.1.289). Darum: Nachricht zurückhalten, außerhalb des Hooks komprimieren, dann den Text als eigene Nachricht senden.
      const text = e.text
      later($, 300, () => {
        $.session
          .compact()
          .catch((err) => $.ui.toast(t.compactFailed(msg(err)), { timeoutMs: 10000 }))
          .then(() => $.prompt.submit({ text, asUser: true }))
          .catch((err) => $.ui.toast(t.resendFailed(msg(err), text.slice(0, 160)), { timeoutMs: 30000 }))
      })
      return { drop: t.dropCompact }
    }
    return next(e)
  })

  on('command.run', { command: 'cache' }, async ($, e) => {
    const t = T[lang]
    const [key, value] = e.args.trim().toLowerCase().split(/\s+/)
    let note = ''
    if (key) {
      // `$.store` teilen sich alle Sessions: vor dem Schreiben neu lesen, sonst überschreibt eine die andere (Review S2)
      try {
        settings = cleanSettings(await $.store.get('settings'))
      } catch {
        // bleibt beim Stand dieser Session
      }
      const s = applySetting(settings, key, value ?? '')
      if (!s) return { text: t.unknownArg(e.args.trim(), CACHE_ARGS) }
      settings = s
      try {
        await $.store.set('settings', settings)
        note = `${t.saved}\n`
      } catch {
        note = `${t.notSaved}\n`
      }
      $.ui.invalidate('ui.render')
    }
    const now = await $.clock.now()
    await bindSession($)
    let limits: ReportLimit[] = []
    try {
      limits = shownWindows(wins, now, opts).map((s) => ({ tag: s.tag, pct: s.pct.long, ratio: s.ratio, reset: s.reset?.long }))
    } catch {
      // ohne Limits
    }
    const list = await loadHandoffs($)
    const text = cacheReport({ now, mem, settings, keep, cold, last, limits, sessionUsd, handoffAt: list[0]?.at ?? null, lang })
    return { text: note + text }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const t = T[lang]
    const arg = e.args.trim().toLowerCase()
    if (arg === 'show' || arg === 'zeigen') {
      const list = await loadHandoffs($)
      return { text: list[0] ? t.handoffLast(hhmm(list[0].at), list[0].text) : t.handoffNoneSaved }
    }
    if (arg === 'continue' || arg === 'weiter') {
      later($, 300, () => {
        clearAndContinue($).catch(() => {})
      })
      return { text: t.handoffContinuing }
    }
    if (H.pending || H.armed) return { text: t.handoffRunning }
    H.pending = true
    // Außerhalb des Hooks: den Skill suchen und starten (die Engine stellt ihn hinter einen laufenden Turn). Die Sprache geht als
    // Argument mit, der Skill schreibt die Übergabe darin (skills/uebergabe/SKILL.md, `$ARGUMENTS`).
    later($, 300, () => {
      $.command
        .list()
        .then((cmds) => {
          const cmd = cmds.find((c) => c.name === 'limit-bars:uebergabe') ?? cmds.find((c) => SKILL.test(c.name))
          if (!cmd) throw new Error(t.skillMissing)
          H.armed = true
          H.notTurn = working ? currentTurn : ''
          return $.command.run({ command: cmd.name, args: lang })
        })
        .catch((err) => {
          H.armed = false
          $.ui.toast(t.handoffStartFailed(msg(err)), { timeoutMs: 10000 })
        })
        .finally(() => {
          H.pending = false
        })
    })
    return { text: t.handoffWriting }
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const t = T[lang]
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'aus' || (arg === '' && keep)) {
      if (!keep) return { text: t.keepAlreadyOff }
      stopKeep($, t.whyTurnedOff)
      return { text: t.keepTurnedOff }
    }
    const h = arg ? Number(arg.replace(',', '.')) : 2
    if (!(h > 0)) return { text: t.keepUsage(String(KEEP_MAX_H)) }
    const now = await $.clock.now()
    await bindSession($)
    const ttl = ttlOf(mem, settings)
    const st = cacheState(mem.lastActivity, ttl, now, false)
    if (st.kind === 'unknown') return { text: t.keepNothing }
    if (st.kind === 'cold') return { text: t.keepCold }
    const hours = Math.min(KEEP_MAX_H, h)
    keep = { until: now + hours * 60 * MIN, pings: 0, usd: 0 }
    keepTimer?.cancel()
    keepTimer = $.clock.every(30000, () => keepStep($))
    $.ui.invalidate('ui.render')
    return {
      text: t.keepOn(
        hhmm(keep.until),
        h > KEEP_MAX_H ? t.keepCapped(String(KEEP_MAX_H)) : '',
        ttl >= 60 ? '8 min' : '90 s',
        usd(readCost(mem.ctx, mem.model), lang),
        tokensText(mem.ctx, lang),
        String(Math.ceil((hours * 60) / (ttl >= 60 ? 52 : 3.5))),
      ),
    }
  })

  on('session.measure', async ($, e, next) => {
    // Bei jeder Messung übernehmen, nicht nur wenn `changed` `rateLimits` nennt; ein fehlendes Fenster verschwindet
    try {
      wins = pickWindows(e.rateLimits)
      refresh($, await $.clock.now())
    } catch {
      // Beiwerk: die Messung selbst bleibt unberührt
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let called = false
    let nextFailed = false
    let theirs: RenderNode | null | undefined = null
    // Jeder Aufruf von `next` läuft hierüber: so ist klar, ob ein Fehler aus der Kette stammt oder aus diesem Hook
    const pass = async (arg: typeof e) => {
      called = true
      try {
        return await next(arg)
      } catch (err) {
        nextFailed = true
        throw err
      }
    }
    try {
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return await pass(e)
      // Nennt `session.start` die Oberfläche nicht (z. B. eine App, die als SDK startet), holt das erste Zeichnen den Anfangsstand
      if (!usageAsked) await loadWindows($)
      const now = await $.clock.now()
      awaitingRender = false
      // Eine abgelehnte Periode beendet das Intervall still: bleiben zwei Ticks aus, wird der Takt neu gestartet
      if (timer && now - timerSince >= (ticks + 2) * TICK) {
        timer.cancel()
        timer = null
      }
      if (!timer) {
        timerSince = now
        ticks = 0
        timer = $.clock.every(TICK, () => {
          ticks += 1
          // Neuzeichnen angefordert, aber keins gekommen (Band eingeklappt, Sitzung verdeckt): Takt beenden; das nächste Zeichnen
          // startet ihn neu. Ohne Änderung wird nichts angefordert, dann läuft er still weiter (usage() ist kostenlos).
          if (awaitingRender) {
            timer?.cancel()
            timer = null
            return
          }
          // Kostenlos ohne `breakdown`; leer heißt "noch keine Antwort", dann bleibt der bisherige Stand
          bindSession($)
            .then(() => $.session.usage())
            .then((u) => {
              const fresh = pickWindows(u.rateLimits)
              if (fresh.length > 0) wins = fresh
              // Kontext zwischen den Turns (types@2.1.289:10406-10411); fehlt nach /clear und /compact bis zur nächsten Antwort
              if (mem.lastActivity && typeof u.context.tokens === 'number') mem = { ...mem, ctx: u.context.tokens }
              if (u.cost) sessionUsd = u.cost.usd
              return $.clock.now()
            })
            .then((t) => {
              alertStep($, t)
              refresh($, t)
            })
            .catch(() => {
              // abgelehnt: es bleibt beim letzten Stand
            })
        })
      }
      // Eine Umfrage hält das Band; ein Hook weicht ihr (types@2.1.288:9580)
      if (e.props.hasSurvey) return await pass(e)
      const view = snapshot(now)
      drawnKey = keyOf(view)
      const { Box, Text } = $.ui.resolve(e)
      let mine: RenderNode
      let stack = false
      if (e.surface === 'desktop') {
        // Desktop: Ring immer (vor der ersten Anfrage grau mit „–“), Balken mit Werten, sobald es Limits gibt; kein Umschreiben von
        // bodyColumns, weil Clawds Svg eine feste Größe hat
        theirs = await pass(e)
        const { Svg } = $.ui.resolve(e)
        // Ohne Limits stehen Platzhalter da (5h –, 7d –), damit die Balken wie der Ring sofort sichtbar sind
        const pic = desktopSvg(view.shown.length > 0 ? view.shown : placeholderWindows(opts), view.ring)
        // Unten bündig mit Clawds Füßen, auch wenn die Desktop-App alignItems der äußeren Zeile nicht umsetzt (Spalte + flex-end)
        mine = Box({ key: 'limit-bars', flexShrink: 0, flexDirection: 'column', justifyContent: 'flex-end', children: [Svg({ source: pic.source, alt: pic.alt, width: pic.width, height: pic.height })] })
      } else {
        const block = view.block
        const lay = layoutTerminal(view.shown, e.props.bodyColumns, block?.text)
        if (!lay) return await pass(e)
        if (noRewrite) {
          theirs = await pass(e)
          stack = true
        } else {
          // Platz abgeben: Mods weiter innen (z. B. clawd-buddy) sehen die Breite ohne die Balken. Props-Rewrites sind erlaubt
          // (types@2.1.288:9103-9104), das Feld heißt aber "Read-only" (types@2.1.288:9598-9604). Phase 0 hat belegt, dass die
          // Engine es annimmt; lehnt eine spätere Version ab, scheitert dieses Zeichnen, und ab dann wird gestapelt.
          try {
            theirs = await pass({ ...e, props: { ...e.props, bodyColumns: e.props.bodyColumns - lay.width } })
          } catch (err) {
            noRewrite = true
            throw err
          }
        }
        const children: RenderNode[] = lay.blocks.map((b) => {
          const s = b.shown
          const f = filled(s.ratio, b.width)
          return Box({
            flexDirection: 'column',
            width: b.width,
            flexShrink: 0,
            children: [
              Box({
                flexDirection: 'row',
                children: [
                  Text({ color: ORANGE, bold: s.strong, children: [s.tag] }),
                  Text({ children: [' '] }),
                  s.fresh ? Text({ dimColor: true, children: [b.pct] }) : Text({ color: s.color, bold: s.strong, children: [b.pct] }),
                  ...(b.rest ? [Text({ dimColor: true, wrap: 'truncate-end', children: [b.rest] })] : []),
                ],
              }),
              Box({
                flexDirection: 'row',
                children: [
                  ...(f > 0 ? [Text({ color: s.color, children: ['▄'.repeat(f)] })] : []),
                  ...(f < b.width ? [Text({ color: EMPTY, children: ['▄'.repeat(b.width - f)] })] : []),
                ],
              }),
            ],
          })
        })
        // Cache-Block hinter den Balken, auf der Zeile der Beschriftungen
        if (lay.extra && block) {
          children.push(Box({ key: 'cache', flexDirection: 'column', flexShrink: 0, children: [Text({ color: block.color, children: [lay.extra] }), Text({ children: [' '] })] }))
        }
        mine = Box({
          key: 'limit-bars',
          width: lay.width,
          // Nie schrumpfen: läuft das Band über, gibt die dehnbare Seite nach, nicht die Beschriftung
          flexShrink: 0,
          flexDirection: 'row',
          columnGap: 2,
          children,
        })
      }
      // Ebenen anderer Mods (Quick-Replies, sidekick) bleiben über dem Grund, nie neben den Balken, egal wer in der Kette außen
      // liegt (band.ts, docs/BAND.md). Die Balken kommen nur neben den Grund.
      const { layers, base } = splitBand(theirs)
      if (!base) return joinBand(layers, mine)
      // Ohne weitere Mods antwortet der Kern mit seinem eigenen Knoten `{type:'engine'}` (types@2.1.288:9033-9041), der im Band
      // nichts zeichnet (types@2.1.288:9570). Dann ist limit-bars innen bzw. allein, der Knoten bleibt erhalten. Er steht NEBEN den
      // Balken, nicht darunter: Die Desktop-App gibt ihm Höhe, übereinander rutschten die Balken über Clawds Füße (Fynn, 2026-10-03).
      if (typeof base === 'object' && base.type === 'engine' && !stack) {
        return joinBand(layers, Box({ flexDirection: 'row', alignItems: 'flex-end', children: [mine, Box({ flexGrow: 1, children: [base] })] }))
      }
      if (stack) return joinBand(layers, Box({ flexDirection: 'column', children: [mine, base] }))
      // limit-bars weiter außen: Balken links, der Rest rechts, unten bündig (wie clawd-buddy, gespiegelt gebaut)
      return joinBand(
        layers,
        Box({
          flexDirection: 'row',
          alignItems: 'flex-end',
          // Rechte Seite: Inhalt nach rechts (alignItems) und nach unten (justifyContent) als Spalte, unabhängig von alignItems der Zeile
          children: [mine, Box({ flexGrow: 1, flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-end', children: [base] })],
        }),
      )
    } catch (err) {
      // Fehler aus der Kette: weiterwerfen, die Engine behandelt den Hook dann als gescheitert (docs/raw/en/events.md:313-316)
      if (nextFailed) throw err
      // Eigener Fehler (fail-open): ohne Anzeige; der Inhalt der anderen bleibt, `next` läuft höchstens einmal
      return called ? theirs : next(e)
    }
  })
}
