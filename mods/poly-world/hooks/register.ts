// poly-world: eine schwebende Low-Poly-Insel hinter dem Chat der Desktop- und Mobil-App, Himmel nach Uhrzeit, dazu ein Farbsatz
// (mods/poly-world/SPEC.md). Ein Theme je Session: gesetzt in session.start und auf eigenen Befehl, gelöscht nur bei /world off
// (types@2.1.325:2745-2757, docs/raw/en/interface.md:445-447).
import type { EngineInterface, On, ThemeResult } from 'claude-code'

import { SETTINGS } from './fields.js'
import { helpMarkdown, helpTree } from './help.js'
import type { HelpData } from './help.js'
import { T } from './i18n.js'
import type { Lang } from './i18n.js'
import { isLanguage, languageCommand, languageHelp } from './language.js'
import { look, palette, SCENE, unpainted } from './look.js'
import { scene } from './scene.js'
import { formatTime, lateEvening, localMinute, parseTime, phaseAt } from './sky.js'
import { readSettings, writeNote, writeSettings } from './settings.js'
import type { Values, WriteResult } from './settings.js'

const SELF = 'poly-world'
const CMD = 'world'
/** Akzent der Hilfe als Theme-Key (docs/HELP-SPEC.md §4): Türkis wie Wasser und Himmel. */
const ACCENT = 'planMode'

// Wortlisten des Parsers, exportiert für den Vollständigkeitstest der Hilfe (templates/help/README.md „Tests“)
export const HELP_WORDS: readonly string[] = ['help', '?']
export const STATUS_WORDS: readonly string[] = ['status']
export const TOGGLE_WORDS: readonly string[] = ['on', 'off']
export const COLORS_WORD = 'colors'
export const TIME_WORD = 'time'
export const NOW_WORD = 'now'

/** Fensterlicht ab dieser Müdigkeit von Clawd (SPEC Tests: `tired ≥ 0.6`). */
export const TIRED_AT = 0.6
/** Prüfabstand der Uhr: neu gezeichnet wird nur, wenn sich Phase oder Licht nach Uhrzeit ändert. */
const CLOCK_MS = 60000

const pal = palette()

// Modul-Zustand (SPEC „Zustand“): flüchtig, ein Reload setzt ihn zurück
let cfg: Values = readSettings(SETTINGS, undefined)
let lang: Lang = 'en'
let working = false
let preview: number | undefined
/** Letztes Ergebnis von $.theme.set; `off`, wenn die Insel aus ist; ein Text, wenn der Aufruf warf. */
let lastSet: ThemeResult | 'off' | { error: string } | undefined
let clockKey = ''
let tick: { cancel(): void } | undefined
const drawn = new Map<string, HelpData>()
let helpNo = 0

function applyCfg(v: Values) {
  cfg = { ...cfg, ...v }
  lang = cfg.language === 'de' ? 'de' : 'en'
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 200)

/** Das ganze Theme setzen (Szene, Farben nur wenn an). Wirft nie. */
async function setLook($: EngineInterface): Promise<void> {
  try {
    lastSet = await $.theme.set(look(pal, cfg.colors === true))
  } catch (err) {
    lastSet = { error: why(err) }
    $.ui.log(`poly-world: theme.set failed: ${why(err)}`, { to: 'debug' })
  }
}

/** Was die Uhr am Bild ändert: Phase und Fensterlicht nach Uhrzeit. */
const keyOf = (minute: number) => `${phaseAt(minute)}|${lateEvening(minute)}`

/** Musik und Müdigkeit aus `$.state` der anderen Mods (nur lesen). Fehlt ein Wert, fällt die Reaktion weg (SPEC „Fehlerverhalten“). */
async function others($: EngineInterface): Promise<{ music: boolean | undefined; tired: number | undefined }> {
  let music: boolean | undefined
  let tired: number | undefined
  try {
    const p = (await $.state.get({ plugin: 'tune-strip', key: 'playing' })).value
    if (p && typeof p.playing === 'boolean') music = p.playing
  } catch {
    // ohne tune-strip
  }
  try {
    const m = (await $.state.get({ plugin: 'clawd-buddy', key: 'mood' })).value
    if (m && typeof m.tired === 'number' && Number.isFinite(m.tired)) tired = m.tired
  } catch {
    // ohne clawd-buddy (oder vor dessen Patch)
  }
  return { music, tired }
}

/** Fensterlicht: Clawd müde, ohne dessen Wert nach Uhrzeit (spät abends). */
export const windowLit = (tired: number | undefined, minute: number) => (tired === undefined ? lateEvening(minute) : tired >= TIRED_AT)

function remember(now: number, data: HelpData): string {
  const tag = `#${(++helpNo).toString(36)}${now.toString(36).slice(-5)}`
  drawn.set(tag, data)
  while (drawn.size > 10) drawn.delete(drawn.keys().next().value as string)
  return tag
}

function helpData(): HelpData {
  const t = T[lang]
  const onOff = (v: unknown) => (v === true ? t.on : t.off)
  return {
    mod: SELF,
    lang,
    intro: t.helpIntro,
    commands: [
      { cmd: '/world', does: t.helpStatus },
      { cmd: '/world on|off', does: t.helpToggle },
      { cmd: '/world colors on|off', does: t.helpColors },
      { cmd: '/world time <HH:MM>|now', does: t.helpTime },
      languageHelp(CMD, lang),
      { cmd: '/world help', does: t.helpHelp },
    ],
    notes: t.helpNotes,
    features: [
      { name: t.featIsland, state: { kind: cfg.enabled ? 'on' : 'off' }, toggle: cfg.enabled ? '/world off' : '/world on' },
      { name: t.featColors, state: { kind: cfg.colors ? 'on' : 'off' }, toggle: cfg.colors ? '/world colors off' : '/world colors on' },
      {
        name: t.featTime,
        state: { kind: 'value', text: preview === undefined ? t.timeClock : formatTime(preview), isDefault: preview === undefined },
        toggle: preview === undefined ? '/world time <HH:MM>' : '/world time now',
      },
    ],
    settings: [
      { title: t.setEnabled, value: onOff(cfg.enabled), isDefault: cfg.enabled === true },
      { title: t.setColors, value: onOff(cfg.colors), isDefault: cfg.colors === true },
      { title: t.setLanguage, value: lang, isDefault: lang === 'en' },
    ],
    footer: { terminal: t.helpFooterTerminal, desktop: t.helpFooterDesktop },
  }
}

async function status($: EngineInterface): Promise<string> {
  const t = T[lang]
  const now = await $.clock.now()
  const minute = preview ?? localMinute(now)
  const { music, tired } = await others($)
  const mark = (v: boolean) => (v ? '✓' : '–')
  const sceneLine =
    preview === undefined ? `${t.phase[phaseAt(minute)]} ${formatTime(minute)}` : `${t.phase[phaseAt(minute)]} ${t.preview(formatTime(minute))}`
  const drawnLine = !cfg.enabled
    ? t.drawnOff
    : lastSet === undefined || lastSet === 'off'
      ? t.drawnNotYet
      : 'error' in lastSet
        ? t.drawnNo(lastSet.error)
        : lastSet.isDrawn
          ? t.drawnYes
          : t.drawnNo(lastSet.reason)
  const lines = [
    `${t.title} · ${t.island}: ${cfg.enabled ? t.on : t.off} · ${t.colorsLabel}: ${cfg.colors ? t.on : t.off}`,
    '',
    `- ${t.scene}: ${sceneLine}`,
    `- ${t.drawn}: ${drawnLine}`,
    `- ${t.reactions}: ${t.working} ${mark(working)} · ${music === undefined ? t.musicNone : `${t.music} ${mark(music)}`} · ${tired === undefined ? t.tiredByTime : t.tired} ${mark(windowLit(tired, minute))}`,
  ]
  if (cfg.colors && pal.error) lines.push(`- ${t.colorsSkipped(pal.error)}`)
  else if (cfg.colors && unpainted(pal).length) lines.push(`- ${t.colorsSkipped(unpainted(pal)[0]!)}`)
  return lines.join('\n')
}

/** Speichern nach dem Umschalten; Weg 2 (CLI) zieht die Werte hier nach, Weg 1 lädt die Mod neu (templates/settings). */
async function persist($: EngineInterface, values: Values): Promise<WriteResult> {
  const r = await writeSettings($, SELF, SETTINGS, values, lang)
  return r
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  applyCfg(readSettings(SETTINGS, options))

  on('session.start', async ($, e, next) => {
    // Vorschau gilt bis `now` oder bis zum nächsten Chat (SPEC „Bedienung“)
    preview = undefined
    // Ein Reload mitten im Turn verliert den Rauch bis zum nächsten turn.start (kosmetisch, Review K2)
    working = false
    // Kein clear hier: das löschte das Theme eines anderen Mods bei jedem Reload (types@2.1.325:2745-2752)
    if (cfg.enabled) await setLook($)
    else lastSet = 'off'
    tick?.cancel()
    try {
      clockKey = keyOf(localMinute(await $.clock.now()))
      tick = $.clock.every(CLOCK_MS, async () => {
        try {
          const k = keyOf(preview ?? localMinute(await $.clock.now()))
          if (k === clockKey) return
          clockKey = k
          $.ui.invalidate('ui.render')
        } catch {
          // nächste Minute wieder
        }
      })
    } catch (err) {
      $.ui.log(`poly-world: clock not started: ${why(err)}`, { to: 'debug' })
    }
    // Befehl zuletzt (CLAUDE.md): ein belegter Name wirft, der Rest läuft weiter
    try {
      await $.command.register({ name: CMD, description: T[lang].helpIntro, argumentHint: 'on|off · colors on|off · time <HH:MM>|now · language · help' })
    } catch (err) {
      $.ui.log(`/${CMD} not registered: ${why(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  // Arbeit → Rauch; Subagents ändern nichts (SPEC „Verhalten“ 3). Nur beobachten.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId && !working) {
      working = true
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && working) {
      working = false
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('command.run', { command: CMD }, async ($, e) => {
    // Sprache aller fynn-mods als erste Prüfung (templates/language/README.md Punkt 3)
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: SELF, cmd: CMD, lang }, e.args) }
    const t = T[lang]
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (args.length === 1 && HELP_WORDS.includes(args[0]!)) {
      const data = helpData()
      return { text: helpMarkdown(data, remember(await $.clock.now(), data)) }
    }
    if (args.length === 0 || (args.length === 1 && STATUS_WORDS.includes(args[0]!))) return { text: await status($) }

    // Umschalten wirkt sofort in diesem Chat und wird dann gespeichert (Weg 1 lädt neu und setzt dasselbe in session.start)
    if (args.length === 1 && TOGGLE_WORDS.includes(args[0]!)) {
      const want = args[0] === 'on'
      if (cfg.enabled === want) return { text: want ? t.alreadyOn : t.alreadyOff }
      if (want) {
        applyCfg({ enabled: true })
        await setLook($)
      } else {
        applyCfg({ enabled: false })
        // Nur hier, auf Wunsch der Person (SPEC „Ein Theme je Session“)
        try {
          await $.theme.clear()
        } catch (err) {
          $.ui.log(`poly-world: theme.clear failed: ${why(err)}`, { to: 'debug' })
        }
        lastSet = 'off'
      }
      const r = await persist($, { enabled: want })
      return { text: `${want ? t.turnedOn : t.turnedOff}\n\n${writeNote(r, lang)}` }
    }
    if (args.length === 2 && args[0] === COLORS_WORD && TOGGLE_WORDS.includes(args[1]!)) {
      const want = args[1] === 'on'
      if (cfg.colors === want) return { text: want ? t.colorsAlreadyOn : t.colorsAlreadyOff }
      applyCfg({ colors: want })
      if (cfg.enabled) await setLook($)
      const r = await persist($, { colors: want })
      return { text: `${want ? t.colorsOn : t.colorsOff}\n\n${writeNote(r, lang)}` }
    }
    if (args.length === 2 && args[0] === TIME_WORD) {
      const now = localMinute(await $.clock.now())
      if (args[1] === NOW_WORD) {
        preview = undefined
        $.ui.invalidate('ui.render')
        return { text: t.timeNow(formatTime(now), t.phase[phaseAt(now)]) + (cfg.enabled ? '' : `\n\n${t.offHint}`) }
      }
      const m = parseTime(args[1]!)
      if (m === undefined) return { text: t.timeBad(args[1]!) }
      preview = m
      $.ui.invalidate('ui.render')
      return { text: t.timeSet(formatTime(m), t.phase[phaseAt(m)]) + (cfg.enabled ? '' : `\n\n${t.offHint}`) }
    }
    return { text: t.unknown(e.args.trim()) }
  })

  // /world help gezeichnet (templates/help/README.md Punkt 4)
  on('ui.render', { component: 'CommandOutput', props: { command: CMD } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    if (!HELP_WORDS.includes(String(e.props.args ?? '').trim().toLowerCase())) return next(e)
    const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
    const data = tag ? drawn.get(tag) : undefined
    return data ? helpTree(data, e.viewport?.columns ?? 100, e.surface, ACCENT) : next(e)
  })

  // Die Szene. Jeder Mod hört diesen Ort: fremde Szene oder fremder Mod → unverändert weiter (types@2.1.325:11604-11612)
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== $.plugin.name || e.props.scene !== SCENE) return next(e)
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || !cfg.enabled) return next(e)
    try {
      const now = await $.clock.now()
      const minute = preview ?? localMinute(now)
      const { music, tired } = await others($)
      const flags = {
        working,
        music: music === true,
        window: windowLit(tired, minute),
        laptop: working && phaseAt(minute) === 'night',
      }
      const t = T[lang]
      const extras = [
        ...(flags.working ? [t.altSmoke] : []),
        ...(flags.music ? [t.altLanterns] : []),
        ...(flags.window ? [t.altWindow] : []),
        ...(flags.laptop ? [t.altLaptop] : []),
      ]
      const { Svg } = $.ui.resolve(e)
      return Svg({
        source: scene({ ...flags, minute, paused: preview !== undefined, now }),
        // Uhrzeit nur in der Vorschau: Live zeichnet die Szene nur beim Phasenwechsel neu, eine Uhrzeit veraltete (Review K3)
        alt: t.alt(t.phase[phaseAt(minute)], preview === undefined ? '' : formatTime(minute), extras),
        isInteractive: true,
      })
    } catch (err) {
      // Kein Hintergrund statt eines kaputten (SPEC „Fehlerverhalten“)
      $.ui.log(`poly-world: backdrop not drawn: ${why(err)}`, { to: 'debug' })
      return next(e)
    }
  })
}
