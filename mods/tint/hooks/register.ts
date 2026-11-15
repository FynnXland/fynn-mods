// tint: ein ruhiger Farbsatz für die Desktop-App (Code-Tab), hell und dunkel, ohne Hintergrund (mods/tint/SPEC.md).
// Ein Theme je Session: gesetzt in session.start und auf eigenen Befehl, gelöscht nur bei /tint off
// (docs/raw/en/interface.md:445-447, types@2.1.325:2721-2757). Nur `colors`, nie `backdrop`.
// 0.2.0: eigene Farbsätze aus Design-Systemen über das Werkzeug save_colors (SPEC „Ausbau 0.2.0“); Claude liest, tint prüft.
import type { EngineInterface, On, ThemeResult } from 'claude-code'

import { check, clean, contrastLine, MAX_SETS, parseInput, readOwnSets, RESERVED, swatchesOf } from './custom.js'
import type { OwnSet, OwnSets } from './custom.js'
import { SETTINGS } from './fields.js'
import { helpMarkdown, helpTree } from './help.js'
import type { HelpData } from './help.js'
import { T } from './i18n.js'
import type { Lang } from './i18n.js'
import { isLanguage, languageCommand, languageHelp } from './language.js'
import { blocked, build, isPalette, PALETTES, SETS } from './palettes.js'
import type { Built, PaletteName, Swatches } from './palettes.js'
import { readSettings, writeNote, writeSettings } from './settings.js'
import type { Values } from './settings.js'
import { statusTree, swatchLine } from './status.js'

const SELF = 'tint'
const CMD = 'tint'
const TOOL = 'save_colors'
// Voller Name als Literal: validate liest Matcher nur aus Literalen (templates/tpl-ai-tool, en/api.md:49-66)
const TOOL_FULL = 'mcp__tint__save_colors'
/** Akzent der Hilfe und des Status als Theme-Key (docs/HELP-SPEC.md §4); `permission` ist noch von keiner fynn-mod belegt. */
const ACCENT = 'permission'
/** userConfig `palette` für „der zuletzt gewählte eigene Satz“ ($.store `active`). */
const CUSTOM = 'custom'

// Wortlisten des Parsers, exportiert für den Vollständigkeitstest der Hilfe (templates/help/README.md „Tests“)
export const HELP_WORDS: readonly string[] = ['help', '?']
export const STATUS_WORDS: readonly string[] = ['status']
export const TOGGLE_WORDS: readonly string[] = ['on', 'off']
export const PALETTE_WORDS: readonly string[] = PALETTES
export const CUSTOM_WORDS: readonly string[] = [CUSTOM]
export const REMOVE_WORDS: readonly string[] = ['remove']

/** Alle drei festen Farbsätze einmal beim Laden gebaut (makeColors ist rein). */
const BUILT: Readonly<Record<PaletteName, Built>> = {
  herbstglut: build('herbstglut'),
  'rose-pine': build('rose-pine'),
  nord: build('nord'),
}

// Modul-Zustand (SPEC „Zustand“): flüchtig, ein Reload setzt ihn zurück
let cfg: Values = readSettings(SETTINGS, undefined)
let lang: Lang = 'en'
/** Letztes Ergebnis von $.theme.set; `off`, wenn tint aus ist; `{ error }`, wenn nicht gesetzt oder der Aufruf warf. */
let lastSet: ThemeResult | 'off' | { error: string } | undefined
const drawn = new Map<string, HelpData>()
let helpNo = 0
/** Spiegel von $.store `sets` und `active` (von allen Sessions geteilt, darum vor jedem Befehl neu gelesen). */
let own: OwnSets = {}
let active: string | undefined
let storeError: string | undefined

function applyCfg(v: Values) {
  cfg = { ...cfg, ...v }
  lang = cfg.language === 'de' ? 'de' : 'en'
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 200)

/** $.store lesen; ein Fehler lässt den alten Spiegel stehen und landet im Status. Wirft nie. */
async function loadStore($: EngineInterface): Promise<void> {
  try {
    own = readOwnSets(await $.store.get('sets'))
    const a = await $.store.get('active')
    active = typeof a === 'string' ? a : undefined
    storeError = undefined
  } catch (err) {
    storeError = why(err)
    $.ui.log(`tint: store read failed: ${storeError}`, { to: 'debug' })
  }
}

/** Was gerade gilt: ein fester Satz oder ein eigener. `missing`: `palette` ist custom, der aktive eigene Satz fehlt → Herbstglut. */
type Pick = { key: string; label: string; swatches: { light: Swatches; dark: Swatches }; built: () => Built; isOwn: boolean; source?: string }
function builtinPick(name: PaletteName): Pick {
  return { key: name, label: SETS[name].label, swatches: SETS[name].swatches, built: () => BUILT[name], isOwn: false }
}
function ownPick(name: string, set: OwnSet): Pick {
  return { key: name, label: name, swatches: swatchesOf(set), built: () => check(name, set).built, isOwn: true, source: set.source }
}
function chosen(): { pick: Pick; missing?: string } {
  if (isPalette(cfg.palette)) return { pick: builtinPick(cfg.palette) }
  if (cfg.palette === CUSTOM && active && own[active]) return { pick: ownPick(active, own[active]!) }
  return { pick: builtinPick('herbstglut'), missing: cfg.palette === CUSTOM ? (active ?? '') : undefined }
}

/** Den gewählten Farbsatz setzen, nur `colors` (SPEC „Verhalten“ 2). Malbar muss er sein, sonst nichts setzen. Wirft nie. */
async function setColors($: EngineInterface): Promise<void> {
  const { pick } = chosen()
  let b: Built
  try {
    b = pick.built()
  } catch (err) {
    b = { theme: undefined, problems: [], error: why(err) }
  }
  const stop = blocked(b)
  if (stop || !b.theme) {
    lastSet = { error: stop ?? 'no colors' }
    $.ui.log(`tint: ${pick.key} not set: ${lastSet.error}`, { to: 'debug' })
    return
  }
  try {
    lastSet = await $.theme.set({ colors: b.theme })
  } catch (err) {
    lastSet = { error: why(err) }
    $.ui.log(`tint: theme.set failed: ${why(err)}`, { to: 'debug' })
  }
}

function remember(data: HelpData): string {
  // Kennung ohne $.clock (kein neues Recht): Zähler plus Zufall (templates/help/README.md, quick-replies 0.5.0)
  helpNo += 1
  const tag = `#${helpNo.toString(36)}${Math.random().toString(36).slice(2, 7).padEnd(5, '0')}`
  drawn.set(tag, data)
  while (drawn.size > 10) drawn.delete(drawn.keys().next().value as string)
  return tag
}

const list = () => PALETTES.map((p) => `\`${p}\``).join(', ')
const ownList = () => Object.keys(own).map((n) => `\`${n}\``).join(', ')

function helpData(): HelpData {
  const t = T[lang]
  const { pick } = chosen()
  return {
    mod: SELF,
    lang,
    intro: t.helpIntro,
    commands: [
      { cmd: '/tint', does: t.helpStatus },
      { cmd: `/tint ${PALETTES.join('|')}`, does: t.helpPick },
      { cmd: `/tint <name>|${CUSTOM}`, does: t.helpPickOwn },
      { cmd: '/tint remove <name>', does: t.helpRemove },
      { cmd: '/tint on|off', does: t.helpToggle },
      languageHelp(CMD, lang),
      { cmd: '/tint help', does: t.helpHelp },
    ],
    notes: [t.helpImport, ...t.helpNotes],
    features: [
      { name: t.featColors, state: { kind: cfg.enabled ? 'on' : 'off' }, toggle: cfg.enabled ? '/tint off' : '/tint on' },
      { name: t.featSet, state: { kind: 'value', text: pick.label, isDefault: pick.key === 'herbstglut' && !pick.isOwn }, toggle: '/tint <name>' },
      { name: t.featOwn, state: { kind: 'value', text: Object.keys(own).length ? Object.keys(own).join(', ') : t.none, isDefault: !Object.keys(own).length }, toggle: '/tint remove <name>' },
    ],
    settings: [
      { title: t.setEnabled, value: cfg.enabled ? t.on : t.off, isDefault: cfg.enabled === true },
      { title: t.setPalette, value: String(cfg.palette), isDefault: cfg.palette === 'herbstglut' },
      { title: t.setLanguage, value: lang, isDefault: lang === 'en' },
    ],
    footer: { terminal: t.helpFooterTerminal, desktop: t.helpFooterDesktop },
  }
}

function drawnLine(): string {
  const t = T[lang]
  if (!cfg.enabled) return t.drawnOff
  if (lastSet === undefined || lastSet === 'off') return t.drawnNotYet
  if ('error' in lastSet) return t.drawnNoOwn(lastSet.error)
  if (lastSet.isDrawn) return t.drawnYes
  // Mit requestId steht das Theme für eine Surface, die später andockt (types@2.1.325:14420-14424; REVIEW K1)
  return lastSet.requestId ? t.drawnLater(lastSet.reason) : t.drawnNo(lastSet.reason)
}

function status(): string {
  const t = T[lang]
  const { pick, missing } = chosen()
  const lines = [
    `${t.title} · ${pick.label} · ${cfg.enabled ? t.on : t.off}`,
    '',
    `- ${t.drawn}: ${drawnLine()}`,
    swatchLine(t.light, t.role, pick.swatches.light),
    swatchLine(t.dark, t.role, pick.swatches.dark),
    `- ${t.sets(list())}`,
  ]
  const names = Object.keys(own)
  lines.push(`- ${names.length ? t.ownSets(names.map((n) => `\`${n}\` (${own[n]!.source})`).join(' · ')) : t.noOwnSets}`)
  if (missing !== undefined) lines.push(`- ${t.missing(missing)}`)
  if (storeError) lines.push(`- ${t.storeFailed(storeError)}`)
  // Bei den festen Sätzen nie erreicht (Test „malbar“), bleibt als Schutz für eine neue make-colors.js
  const stop = blocked(pick.built())
  if (stop) lines.push(`- ${t.skipped(stop)}`)
  return lines.join('\n')
}

/** `palette` (und bei eigenen Sätzen `active`) wählen und setzen. writeSettings zuletzt: Weg 1 lädt die Mod neu. */
async function choose($: EngineInterface, palette: string, ownName?: string): Promise<string> {
  const t = T[lang]
  const label = ownName ?? SETS[palette as PaletteName].label
  if (ownName && active !== ownName) {
    try {
      await $.store.set('active', ownName)
      active = ownName
    } catch (err) {
      return t.storeFailed(why(err))
    }
  } else if (cfg.palette === palette) {
    if (!cfg.enabled) return `${t.already(label)} ${t.offHint}`
    await setColors($)
    return t.already(label)
  }
  const write = cfg.palette !== palette
  applyCfg({ palette })
  if (cfg.enabled) await setColors($)
  const note = write ? `\n\n${writeNote(await writeSettings($, SELF, SETTINGS, { palette }, lang), lang)}` : ''
  return `${t.setNow(label)}${cfg.enabled ? '' : ` ${t.offHint}`}${note}`
}

async function remove($: EngineInterface, name: string): Promise<string> {
  const t = T[lang]
  if (RESERVED.includes(name)) return t.removeBuiltin(name)
  // Ohne frischen Stand würde `sets` Sätze anderer Sessions überschreiben (wie in saveColors)
  if (storeError) return t.storeFailed(storeError)
  if (!own[name]) return t.removeUnknown(name, ownList() || t.none)
  const wasActive = active === name
  const rest = { ...own }
  delete rest[name]
  try {
    await $.store.set('sets', rest)
    own = rest
    if (wasActive) {
      await $.store.delete('active')
      active = undefined
    }
  } catch (err) {
    return t.storeFailed(why(err))
  }
  // War er aktiv, gilt danach Herbstglut (SPEC „Befehle“); die Einstellung zieht mit, damit sie nicht auf einen leeren Satz zeigt
  if (!wasActive || cfg.palette !== CUSTOM) return t.removed(name)
  applyCfg({ palette: 'herbstglut' })
  if (cfg.enabled) await setColors($)
  const r = await writeSettings($, SELF, SETTINGS, { palette: 'herbstglut' }, lang)
  return `${t.removedActive(name)}\n\n${writeNote(r, lang)}`
}

/** Antwort des Werkzeugs an Claude (englisch, Claude liest sie). Wirft nie (SPEC „Werkzeug save_colors“). */
async function saveColors($: EngineInterface, e: Record<string, unknown>): Promise<{ result: string } | { isError: true; result: string }> {
  const fail = (lines: string[]) => ({
    isError: true as const,
    result: ['Nothing saved. Fix these and call save_colors again (at most 3 rounds in all):', ...lines.map((l) => `- ${l}`)].join('\n'),
  })
  const input = parseInput(e)
  if (input.problems.length) return fail(input.problems)
  const { name, set, apply } = input
  const { built, problems } = check(name, set)
  if (problems.length) return fail(problems)

  await loadStore($)
  if (storeError) return fail([`tint could not read its saved sets: ${storeError}`])
  const replaced = own[name] !== undefined
  if (!replaced && Object.keys(own).length >= MAX_SETS) return fail([`tint keeps ${MAX_SETS} own sets at most; ask the person which to remove (/tint remove <name>).`])
  try {
    await $.store.set('sets', { ...own, [name]: set })
    own = { ...own, [name]: set }
  } catch (err) {
    return fail([`saving failed: ${why(err)}`])
  }
  const notes = built.problems.length
  const out = [
    `${replaced ? 'Replaced' : 'Saved'} the color set "${name}" (from ${clean(set.source, 160)}).`,
    `Contrast: ${contrastLine(set)}.`,
    notes ? `${notes} minor notes from the color builder remain (borders, switches, fills); they do not stop the app painting.` : '',
  ]
  if (!apply) {
    out.push(`Not applied (apply: false). The person can choose it with /tint ${name}.`)
    return { result: out.filter(Boolean).join('\n') }
  }
  // Wählen wie /tint <name>; writeSettings läuft darin zuletzt
  const said = await choose($, CUSTOM, name)
  out.push(cfg.enabled ? `Applied in this chat (/tint ${name} chooses it again later).` : 'Not applied: tint is off; the person can turn it on with /tint on.')
  out.push(`tint said: ${said.replace(/\n+/g, ' ')}`)
  return { result: out.filter(Boolean).join('\n') }
}

const TOOL_DESCRIPTION =
  "Save a color set for the Claude Desktop app (Code tab) from the person's own design system, and apply it. " +
  'Load the skill tint:import first; it says how to map design-system colors onto these anchors. You read the design system ' +
  'yourself; tint reads no files. Give six-digit hex colors for light and dark mode (derive dark if the system has none, and say so). ' +
  'tint checks that text-primary is at least 7:1 and text-muted at least 4.5:1 on every surface, and that the app would paint it. ' +
  'On a problem nothing is saved and the result lists each problem with its values; fix them and call again.'

const anchorProps = (extra: boolean) => ({
  type: 'object',
  properties: Object.fromEntries(
    ['surface-0', 'surface-1', 'surface-2', ...(extra ? ['surface-3'] : []), 'text-primary', 'text-secondary', 'text-muted'].map((k) => [k, { type: 'string', description: k === 'surface-0' ? 'page background, the darkest surface of the mode' : undefined }]),
  ),
  required: ['surface-0', 'surface-1', 'surface-2', 'text-primary', 'text-secondary', 'text-muted'],
})

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: `kebab-case name, not one of: ${RESERVED.join(', ')}` },
    source: { type: 'string', description: 'where the colors come from, in a few words (file, URL or design system name)' },
    light: { ...anchorProps(false), description: 'light mode: surface-0 page, surface-1 cards, surface-2 panels (each lighter than surface-0), then text' },
    dark: { ...anchorProps(true), description: 'dark mode: surface-0 page (darkest), surface-1..3 raised surfaces, then text' },
    roles: {
      type: 'object',
      properties: Object.fromEntries(['accent', 'danger', 'success', 'warning', 'pro'].map((r) => [r, { type: 'string' }])),
      required: ['accent'],
      description: 'accent = brand or primary color; danger, success, warning, pro optional (missing ones come from tint’s default set)',
    },
    apply: { type: 'boolean', description: 'apply now (default true)' },
  },
  required: ['name', 'source', 'light', 'dark', 'roles'],
}

export function register(on: On, options: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  applyCfg(readSettings(SETTINGS, options))

  on('session.start', async ($, e, next) => {
    await loadStore($)
    // Kein clear hier: das löschte das Theme eines anderen Mods bei jedem Reload (types@2.1.325:2745-2752)
    if (cfg.enabled) await setColors($)
    else lastSet = 'off'
    // Werkzeug hinter ToolSearch: kostet ohne Bedarf keinen Kontext (types@2.1.325:3284-3299, :15240-15247)
    try {
      await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: true })
    } catch (err) {
      $.ui.log(`tint: tool ${TOOL} not registered: ${why(err)}`, { to: 'debug' })
    }
    // Befehl zuletzt (CLAUDE.md): ein belegter Name wirft, der Rest läuft weiter
    try {
      await $.command.register({ name: CMD, description: T[lang].helpIntro, argumentHint: `${PALETTES.join('|')}|<name> · remove <name> · on|off · language · help` })
    } catch (err) {
      $.ui.log(`/${CMD} not registered: ${why(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  // Beantwortet save_colors; Argumente sind Felder von e (en/api.md:65). Wirft nie: alles liefert ein Ergebnis an Claude.
  on('tool.call', { tool: TOOL_FULL }, async ($, e) => {
    try {
      return await saveColors($, e as unknown as Record<string, unknown>)
    } catch (err) {
      return { isError: true as const, result: `Nothing saved: ${why(err)}` }
    }
    // Zeitlimit (10 s) oder Fehler: Claude bekommt trotzdem eine Antwort (CLAUDE.md „Guards sind fail-closed“)
  }).catch((_$, _e, next) => ({ isError: true as const, result: `Nothing saved: tint failed (${next.error.kind}${next.error.message ? `: ${why(next.error.message)}` : ''}). Try once more, or tell the person.` }))

  on('command.run', { command: CMD }, async ($, e) => {
    // Sprache aller fynn-mods als erste Prüfung (templates/language/README.md Punkt 3)
    if (isLanguage(e.args)) return { text: await languageCommand($, { mod: SELF, cmd: CMD, lang }, e.args) }
    const t = T[lang]
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (args.length === 1 && HELP_WORDS.includes(args[0]!)) {
      await loadStore($)
      const data = helpData()
      return { text: helpMarkdown(data, remember(data)) }
    }
    await loadStore($)
    if (args.length === 0 || (args.length === 1 && STATUS_WORDS.includes(args[0]!))) return { text: status() }

    // Umschalten wirkt sofort in diesem Chat und wird dann gespeichert (Weg 1 lädt neu und setzt dasselbe in session.start)
    if (args.length === 1 && TOGGLE_WORDS.includes(args[0]!)) {
      const want = args[0] === 'on'
      if (cfg.enabled === want) return { text: want ? t.alreadyOn : t.alreadyOff }
      applyCfg({ enabled: want })
      if (want) await setColors($)
      else {
        // Nur hier, auf Wunsch der Person (SPEC „Ein Theme je Session“, interface.md:447)
        try {
          await $.theme.clear()
        } catch (err) {
          $.ui.log(`tint: theme.clear failed: ${why(err)}`, { to: 'debug' })
        }
        lastSet = 'off'
      }
      const r = await writeSettings($, SELF, SETTINGS, { enabled: want }, lang)
      return { text: `${want ? t.turnedOn : t.turnedOff}\n\n${writeNote(r, lang)}` }
    }

    if (args[0] === 'remove') return { text: args.length === 2 ? await remove($, args[1]!) : t.removeUsage }

    // Farbsatz wählen: schreiben und sofort setzen (SPEC „Verhalten“ 3). Ist tint aus, nur speichern und auf /tint on verweisen.
    if (args.length === 1 && isPalette(args[0])) return { text: await choose($, args[0]) }
    if (args.length === 1 && args[0] === CUSTOM) return { text: active && own[active] ? await choose($, CUSTOM, active) : t.noCustom }
    if (args.length === 1 && own[args[0]!]) return { text: await choose($, CUSTOM, args[0]!) }
    if (args.length === 1) return { text: t.bad(e.args.trim(), [list(), ownList()].filter(Boolean).join(', ')) }
    return { text: t.unknown(e.args.trim()) }
  })

  // Hilfe und Status gezeichnet (templates/help/README.md Punkt 4); ein `on` für beides, weil derselbe Matcher (en/events.md:98)
  on('ui.render', { component: 'CommandOutput', props: { command: CMD } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const args = String(e.props.args ?? '').trim().toLowerCase()
    if (HELP_WORDS.includes(args)) {
      const tag = /#[0-9a-z]{5,}/.exec(e.props.text.split('\n')[0] ?? '')?.[0]
      const data = tag ? drawn.get(tag) : undefined
      return data ? helpTree(data, e.viewport?.columns ?? 100, e.surface, ACCENT) : next(e)
    }
    if (args === '' || STATUS_WORDS.includes(args)) return statusTree(e.props.text, SELF, ACCENT) ?? next(e)
    return next(e)
  })
}
