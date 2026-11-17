// prompt-deck: gespeicherte Prompts als Knöpfe über dem Eingabefeld (SPEC mods/prompt-deck/SPEC.md). Die Funktionen stammen „so wie sie
// sind“ aus sidekick 0.28.1 (Nachtrag 0.21.0, Ausbau 0.24.0/0.27.0/0.28.1); die Erkennung wiederholter Prompts bleibt dort (E6).
// Absprachen mit sidekick nur über $.state (SPEC „Absprachen“, types/index.d.ts). Belege `types:N` = docs/types-snapshots/2.1.325.
import type { EngineInterface, On, RenderElement, RenderNode } from 'claude-code'
import { LEVEL, arrange, layer } from './band.js'
import {
  BUTTON_KINDS,
  DECK_CMD,
  P_CMD,
  SAVED_MAX,
  SAVE_MAX,
  SIDEKICK,
  buttonLabel,
  buttonNames,
  buttonRows,
  buttonTarget,
  buttonsArg,
  buttonsMarkdown,
  checkName,
  cleanSaved,
  cmdOf,
  freeName,
  kindTitle,
  lastOwnText,
  laterAllowed,
  listMarkdown,
  normName,
  pHint,
  preview,
  saveArgs,
  savedState,
  shownPrompts,
  switchOn,
  upsert,
} from './deck.js'
import type { ButtonFacts, ButtonKind, NameCheck, Saved } from './deck.js'
import { SETTINGS } from './fields.js'
import { helpMarkdown, helpTree } from './help.js'
import type { HelpData } from './help.js'
import { lang, setLang, t } from './i18n.js'
import { isLanguage, languageCommand, languageHelp } from './language.js'
import { readSettings, writeNote, writeSettings } from './settings.js'
import type { Values, WriteResult } from './settings.js'

const SELF = 'prompt-deck'
/** Akzent der Prompt-Namen in Tabellen (wie sidekick) und der Hilfe als Theme-Key (docs/HELP-SPEC.md §4). */
const ACCENT = '#6CB6FF'
const HELP_ACCENT = 'ide'
/** Hilfe-Wörter (HELP-SPEC §2), nur als einziges Wort. */
export const HELP_WORDS: readonly string[] = ['help', '?']
/** Wörter für die Liste: `/deck`, `/deck list`, `/deck prompts` (Name aus sidekick). */
export const LIST_WORDS: readonly string[] = ['list', 'prompts']
/** Abstand zwischen `/p <name>` und dem Senden (sidekick Bau 0.21.0: aus command.run lehnt die Engine `$.prompt.submit` ab). */
const SUBMIT_DELAY_MS = 100

let cfg: Values = readSettings(SETTINGS, undefined)
/** Gespeicherte Prompts, frisch gelesen bei session.start, Befehlen und Senden: eine andere Session kann sie geändert haben. */
let saved: Saved[] = []
/** Gesendet, aber noch nicht als Nachricht angekommen: ein zweiter Klick sendet nicht doppelt. */
const sendingNames = new Set<string>()
/** Arbeitet Claude gerade? Aus `e.props.isWorking` der letzten Zeichnung (types:11397); nur für den Toast „kommt danach“. */
let working = false
/** `sidekick.status`, wie zuletzt beim Zeichnen gelesen (für `/deck buttons` und die Hilfe). */
let skStatus: ButtonFacts['sidekick'] = undefined
/** Knopf „Danach“ geklickt: Zeitpunkt des Klicks, sonst null. Zustand aus dem Speicher (sidekick Patch 0.25.1), `$.state` für sidekick. */
let laterAt: number | null = null
let clearing = false
/** Erste Zeichnung seit dem Laden der Mod (Review S2). */
let fresh = true
let chain: Promise<unknown> = Promise.resolve()
let savedLast: string | undefined = undefined

const msg = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 140)
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function el(type: 'Box' | 'Text', props: Record<string, string | number | boolean>, children: RenderNode[]): RenderElement {
  return { type, props, children }
}

function viewportCols(e: unknown): number {
  const c = (e as { viewport?: { columns?: unknown } } | null)?.viewport?.columns
  return typeof c === 'number' ? c : 100
}

/** Einmaliger Timer über `$.clock.every` (kein setTimeout, CLAUDE.md); der einzige Aufruf davon. */
function later($: EngineInterface, ms: number, fn: () => void) {
  const timer = $.clock.every(ms, () => {
    timer.cancel()
    fn()
  })
}

const facts = (): ButtonFacts => ({ cfg, sidekick: skStatus, saved })

// ---------- Speicher ----------

async function loadSaved($: EngineInterface): Promise<Saved[]> {
  saved = cleanSaved(await $.store.get('saved'))
  return saved
}

/** `saved` frisch lesen, ändern, schreiben; nacheinander mit allen anderen Änderungen dieser Session. */
function updateSaved<R>($: EngineInterface, fn: (list: Saved[]) => { list: Saved[]; r: R }): Promise<R> {
  const run = chain.then(async () => {
    const { list, r } = fn(cleanSaved(await $.store.get('saved')))
    await $.store.set('saved', list)
    saved = list
    return r
  })
  chain = run.catch(() => {})
  return run
}

/**
 * `prompt-deck.saved` schreiben (nur bei Änderung): Namen und Wortmengen für sidekick (SPEC „Absprachen“). Ein Schreiben zeichnet die
 * Leser neu (types:3654-3659); prompt-deck selbst liest den Wert nicht. Nach `/clear` ist er leer (en/interface.md:942), bis zur nächsten
 * Änderung oder dem nächsten Start; sidekick bietet in der Zeit nichts an.
 */
function pushSaved($: EngineInterface, force = false) {
  const value = savedState(saved)
  const key = JSON.stringify(value)
  if (!force && key === savedLast) return
  savedLast = key
  try {
    $.state.set({ plugin: 'prompt-deck', key: 'saved' }, value).catch(() => {
      if (savedLast === key) savedLast = undefined
    })
  } catch {
    if (savedLast === key) savedLast = undefined
  }
}

/** Den festen Befehl `/p` anmelden; der Hinweis nennt die Namen. „Registering a name again replaces it“ (types:3327-3333). */
async function registerP($: EngineInterface) {
  try {
    await $.command.register({ name: P_CMD, description: t().pr.cmdP, argumentHint: pHint(saved) })
  } catch {
    // ohne /p; die Knöpfe senden trotzdem
  }
}

// ---------- Senden ----------

/**
 * Einen gespeicherten Prompt senden: `$.prompt.submit({ text, asUser: true })` als Nachricht des Nutzers; ein Plugin-Prompt läuft,
 * sobald die Session frei ist (types:3151-3163), also während einer Antwort danach. Nicht abgewartet.
 */
async function runPrompt($: EngineInterface, name: string, via: 'cmd' | 'button'): Promise<string> {
  const x = t().pr
  // In `-p` ist keine Session gebunden (sidekick Smoke-Test 2026-11-06): `surfaces()` ist dort leer
  if (!(await $.session.surfaces()).length) return x.noSession(name)
  const p = (await loadSaved($)).find((s) => s.name === name)
  if (!p) return x.unknownName(name)
  if (sendingNames.has(name)) return x.already(name)
  sendingNames.add(name)
  const busyNow = working
  const done = () => sendingNames.delete(name)
  const fire = () => {
    try {
      $.prompt
        .submit({ text: p.text, asUser: true })
        .then((r) => {
          done()
          if (r && 'drop' in r && typeof r.drop === 'string') $.ui.toast(x.submitFailed(name, cut(r.drop, 140)), { timeoutMs: 10000 })
        })
        .catch((err) => {
          done()
          $.ui.toast(x.submitFailed(name, msg(err)), { timeoutMs: 10000 })
        })
    } catch (err) {
      done()
      $.ui.toast(x.submitFailed(name, msg(err)), { timeoutMs: 10000 })
    }
  }
  // Aus einem `command.run`-Hook lehnt die Engine den Aufruf ab („it would wait on the turn this hook is holding“, sidekick Bau 0.21.0):
  // erst nach dem Befehl über einen einmaligen Timer. Ein Knopf ist kein Hook und sendet sofort.
  try {
    if (via === 'cmd') later($, SUBMIT_DELAY_MS, fire)
    else fire()
  } catch (err) {
    done()
    return x.submitFailed(name, msg(err))
  }
  if (busyNow && via === 'button') return x.queued(name)
  return x.sent(name)
}

/** Ein Knopf: senden; ein Toast nur, wenn es nicht gleich losgeht oder nicht geht. */
async function pressPrompt($: EngineInterface, name: string) {
  try {
    const r = await runPrompt($, name, 'button')
    if (r !== t().pr.sent(name)) $.ui.toast(r, { timeoutMs: 8000 })
  } catch (err) {
    $.ui.toast(t().pr.submitFailed(name, msg(err)), { timeoutMs: 10000 })
  }
}

// ---------- Knopf „Danach“ ----------

/** `prompt-deck.later` schreiben: armiert mit Zeitpunkt oder `null`. */
function writeLater($: EngineInterface, at: number | null) {
  try {
    $.state.set({ plugin: 'prompt-deck', key: 'later' }, at === null ? null : { armed: true, at }).catch(() => {})
  } catch {
    // sidekick sieht die Markierung dann nicht
  }
}

/** Klick auf „Danach“: an oder zurück (sidekick 0.24.0/0.24.2). Danach einmal neu zeichnen (0.24.2: wie die Desktop-Probe `btn-probe`). */
async function pressLater($: EngineInterface) {
  if (!laterAllowed(facts())) return
  if (laterAt === null) laterAt = await $.clock.now()
  else laterAt = null
  writeLater($, laterAt)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // das Abo von `prompt-deck.later` zeichnet ohnehin neu
  }
}

/**
 * Fällt `sidekick.status.later` weg (Zug vorbei, Stufe, `queue` aus) oder hat sidekick die Markierung verbraucht (`laterUsed`), gilt sie
 * nicht mehr (SPEC „Absprachen“). Beim Zeichnen wird nichts geschrieben (ui.render darf $.state nur lesen, „Refused while a ui.render hook draws“, types:3632-3634):
 * das Löschen läuft über einen Timer danach.
 */
function dropLater($: EngineInterface) {
  laterAt = null
  if (clearing) return
  clearing = true
  try {
    later($, 50, () => {
      clearing = false
      if (laterAt === null) writeLater($, null)
    })
  } catch {
    clearing = false
  }
}

/** Die Knöpfe der Zeile: „Danach“ (wenn erlaubt) und bis zu 4 Prompt-Knöpfe, je mit festem `key`. */
async function rowButtons($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]): Promise<RenderNode[]> {
  // Abo: Lesen in ui.render zeichnet bei jedem Schreiben neu (docs/BAND-PROBE-2.1.325.md §4, types:3654-3659)
  try {
    const { value } = await $.state.get({ plugin: 'sidekick', key: 'status' })
    skStatus = value ?? undefined
  } catch {
    skStatus = undefined
  }
  let stateAt: number | null = null
  try {
    const { value } = await $.state.get({ plugin: 'prompt-deck', key: 'later' })
    stateAt = value?.armed === true && typeof value.at === 'number' ? value.at : null
  } catch {
    stateAt = null
  }
  const f = facts()
  const allowed = laterAllowed(f)
  // Nach einem Neuladen mitten im Zug ist der Speicher leer, der Wert in $.state überlebt (types:3629-3630): übernehmen (Review S2)
  // Nur bei der ersten Zeichnung nach dem Laden: später kann ein Lesen noch den alten Stand liefern (sidekick Patch 0.25.1)
  if (fresh && allowed && laterAt === null && stateAt !== null && stateAt !== skStatus?.laterUsed) laterAt = stateAt
  fresh = false
  if (!allowed && (laterAt !== null || stateAt !== null)) dropLater($)
  else if (laterAt !== null && skStatus?.laterUsed === laterAt) dropLater($)
  const ui = $.ui.resolve(e)
  const names = shownPrompts(f)
  const first = allowed ? [ui.Button({ key: 'prompt-deck-later', label: t().q.btn(laterAt !== null), onPress: () => void pressLater($) }) as RenderNode] : []
  return [...first, ...names.map((n) => ui.Button({ key: `prompt-deck-p-${n}`, label: buttonLabel(n), dimColor: true, onPress: () => void pressPrompt($, n) }) as RenderNode)]
}

// ---------- Einstellungen ----------

async function writeCfg($: EngineInterface, patch: Values): Promise<WriteResult> {
  const r = await writeSettings($, SELF, SETTINGS, patch, lang())
  if (r.ok) cfg = { ...cfg, ...patch }
  return r
}

// ---------- /deck ----------

/** Text zur Ablehnung eines Namens. */
function nameRefusal(c: Extract<NameCheck, { ok: false }>): string {
  const x = t().pr
  return c.why === 'invalid' ? x.nameInvalid(c.name, c.suggest) : x.nameOwn(c.name, c.suggest)
}

/**
 * Einen Prompt speichern. Vom Nutzer (`manual`): ein eigener Name wird überschrieben. Von sidekick (`plugin`): nie überschreiben, bei
 * belegtem Name ein freier (`freeName`), Antwort mit maschinenlesbarer erster Zeile (`saved <name>`, `full`, `refused <grund>`).
 */
async function saveCommand($: EngineInterface, rest: string, by: 'user' | 'sidekick', messages: () => Promise<readonly { role: string; text?: string }[]>): Promise<string> {
  const x = t().pr
  const a = saveArgs(rest)
  if (by === 'sidekick') {
    if (!a.name) return 'refused no-name'
    if (!a.text) return 'refused no-text'
    await loadSaved($)
    const taken = new Set(saved.map((s) => s.name))
    const c = checkName(a.name, [...taken], false)
    const name = c.ok ? c.name : c.why === 'own' ? c.suggest : ''
    if (!name) return `refused invalid-name\n${nameRefusal(c as Extract<NameCheck, { ok: false }>)}`
    const now = await $.clock.now()
    const u = await updateSaved($, (list) => {
      const free = list.some((s) => s.name === name) ? freeName(name, new Set(list.map((s) => s.name))) : name
      const r = free ? upsert(list, { name: free, text: a.text.slice(0, SAVE_MAX), button: !a.off, at: now, from: a.manual ? 'manual' : 'auto' }) : ({ list, kind: 'full' } as const)
      return { list: r.list, r: { kind: r.kind, name: free } }
    })
    if (u.kind === 'full') return `full\n${x.full(SAVED_MAX)}`
    pushSaved($)
    await registerP($)
    return `saved ${u.name}\n${x.savedFrom(u.name, buttonNames(saved).includes(u.name))}`
  }
  if (!a.name) return x.saveUsage
  const text = a.text || lastOwnText(await messages())
  if (!text) return x.noLast
  await loadSaved($)
  const c = checkName(a.name, saved.map((s) => s.name), true)
  if (!c.ok) return nameRefusal(c)
  const now = await $.clock.now()
  const u = await updateSaved($, (list) => {
    const r = upsert(list, { name: c.name, text: text.slice(0, SAVE_MAX), button: !a.off, at: now, from: 'manual' })
    return { list: r.list, r }
  })
  if (u.kind === 'full') return x.full(SAVED_MAX)
  pushSaved($)
  await registerP($)
  return x.savedCmd(c.name, u.kind === 'replaced', buttonNames(saved).includes(c.name))
}

async function setButton($: EngineInterface, name: string, on: boolean) {
  await updateSaved($, (list) => ({ list: list.map((s) => (s.name === name ? { ...s, button: on } : s)), r: null }))
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // die Zeile zeichnet mit der nächsten Änderung neu
  }
}

async function forget($: EngineInterface, raw: string): Promise<string> {
  const x = t().pr
  if (!raw) return x.unknownName('')
  const n = normName(raw)
  const had = await updateSaved($, (list) => ({ list: list.filter((s) => s.name !== n), r: list.some((s) => s.name === n) }))
  if (!had) return x.unknownName(n)
  pushSaved($)
  await registerP($)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // Beiwerk
  }
  return x.forgotten(n)
}

// Die letzten `/deck list`-Ausgaben (höchstens 10), über die Kennung gefunden (templates/help/README.md Punkt 3)
const lists = new Map<string, Saved[]>()
const btnLists = new Set<string>()
const helps = new Map<string, HelpData>()
let tagNo = 0

function newTag(now: number): string {
  return `#${(++tagNo).toString(36)}${now.toString(36).slice(-5)}`
}
function keep<V>(m: Map<string, V>, tag: string, v: V) {
  m.set(tag, v)
  while (m.size > 10) m.delete(m.keys().next().value as string)
}

async function listCommand($: EngineInterface): Promise<string> {
  const list = await loadSaved($)
  pushSaved($)
  const tag = list.length ? newTag(await $.clock.now()) : ''
  if (tag) keep(lists, tag, list)
  return listMarkdown(list, tag)
}

async function showCommand($: EngineInterface, raw: string): Promise<string> {
  const x = t().pr
  if (!raw) return x.showUsage
  const n = normName(raw)
  const p = (await loadSaved($)).find((s) => s.name === n)
  if (!p) return x.unknownName(n)
  return [x.detail(p.name, p.button, p.from), '', '```text', p.text, '```'].join('\n')
}

type BtnTarget = { kind: 'switch'; k: ButtonKind } | { kind: 'prompt'; name: string }

/** Titel einer Knopfart wie auf der Einstellungsseite („Danach-Knopf“). */
const switchTitle = (k: ButtonKind) => (t().help.settings as Readonly<Record<string, string>>)[k.field] ?? kindTitle(k)

/** Einen Schalter umlegen; zurück kommt der Text für Befehl bzw. Toast. */
async function applyButton($: EngineInterface, tg: BtnTarget, want: boolean): Promise<string> {
  const x = t().bt
  if (tg.kind === 'prompt') {
    await setButton($, tg.name, want)
    const out = t().pr.buttonSet(tg.name, want, buttonNames(saved).includes(tg.name))
    return want && !switchOn(facts(), 'promptButtons') ? `${out} ${x.promptsOffNote}` : out
  }
  const title = switchTitle(tg.k)
  if (switchOn(facts(), tg.k.field) === want) return x.already(title, want)
  const w = await writeCfg($, { [tg.k.field]: want })
  if (!w.ok) return writeNote(w, lang())
  // Ohne Knopf verfällt auch eine Markierung dieser Runde (sidekick 0.27.0 Abweichung 1)
  if (tg.k.id === 'later' && !want && laterAt !== null) {
    laterAt = null
    writeLater($, null)
  }
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // nach einem Neuladen (Weg 1) zeichnet die neue Instanz
  }
  const hint = tg.k.id === 'later' ? (want && !laterAllowed(facts()) ? x.laterHint : '') : tg.k.id === 'prompts' ? x.promptsHint(want) : ''
  return [[x.set(title, want), hint].filter(Boolean).join(' '), writeNote(w, lang())].filter(Boolean).join('\n')
}

/** `/deck buttons [later|prompts|<name> on|off]`. */
async function buttonsCommand($: EngineInterface, rest: string): Promise<string> {
  const x = t().bt
  await loadSaved($)
  const a = buttonsArg(rest)
  if (a.kind === 'usage') return x.usage
  if (a.kind === 'set') {
    const tg = buttonTarget(a.target, saved)
    if (!tg) return x.unknown(a.target, BUTTON_KINDS.map((k) => `\`${k.id}\``).join(', '))
    return applyButton($, tg, a.on)
  }
  const tag = newTag(await $.clock.now())
  btnLists.add(tag)
  while (btnLists.size > 10) btnLists.delete(btnLists.values().next().value as string)
  return buttonsMarkdown(facts(), tag)
}

/** `/deck <name> on|off` (sidekick `/sidekick prompts <name> on|off`). */
async function nameSwitch($: EngineInterface, raw: string, on: boolean): Promise<string> {
  const n = normName(raw)
  if (!(await loadSaved($)).some((s) => s.name === n)) return t().pr.unknownName(n)
  return applyButton($, { kind: 'prompt', name: n }, on)
}

async function helpCommand($: EngineInterface): Promise<string> {
  const x = t().help
  const L = lang()
  const list = await loadSaved($)
  try {
    const { value } = await $.state.get({ plugin: 'sidekick', key: 'status' })
    skStatus = value ?? undefined
  } catch {
    // Stand der letzten Zeichnung
  }
  const on = (v: boolean) => ({ kind: v ? ('on' as const) : ('off' as const) })
  const data: HelpData = {
    mod: SELF,
    lang: L,
    intro: x.intro,
    commands: [
      { cmd: '/deck', does: x.list },
      { cmd: '/deck list', does: x.list },
      { cmd: '/deck save <name> [text]', does: x.save },
      { cmd: '/deck show <name>', does: x.show },
      { cmd: '/deck <name> on|off', does: x.button },
      { cmd: '/deck forget <name>', does: x.forget },
      { cmd: '/deck buttons', does: x.bList },
      { cmd: '/deck buttons later|prompts|<name> on|off', does: x.bSet },
      { cmd: '/p <name>', does: x.run },
      languageHelp(DECK_CMD, L),
      { cmd: '/deck help', does: x.help },
    ],
    notes: [x.aliases],
    controls: [
      { cmd: x.cPromptBtn, does: x.cPromptBtnDoes },
      { cmd: t().q.btn(false), does: x.cLaterDoes },
      { cmd: x.cButtons, does: x.cButtonsDoes },
    ],
    features: [
      { name: x.fPrompts, state: { kind: 'value', text: x.promptsState(list.length, buttonNames(list).length) }, toggle: '/deck list' },
      ...BUTTON_KINDS.map((k) => ({ name: kindTitle(k), state: on(switchOn(facts(), k.field)), toggle: `/deck buttons ${k.id} ${switchOn(facts(), k.field) ? 'off' : 'on'}` })),
      { name: x.fSidekick, state: skStatus ? { kind: 'on' as const, text: x.sidekickOn } : { kind: 'off' as const, text: x.sidekickOff }, toggle: '–' },
    ],
    settings: Object.keys(SETTINGS).map((field) => {
      const v = cfg[field]
      return { title: (x.settings as Readonly<Record<string, string>>)[field] ?? field, value: typeof v === 'boolean' ? (v ? t().pr.on : t().pr.off) : String(v), isDefault: v === SETTINGS[field]!.default }
    }),
    footer: { terminal: x.footerTerminal, desktop: x.footerDesktop },
  }
  const tag = newTag(await $.clock.now())
  keep(helps, tag, data)
  return helpMarkdown(data, tag)
}

// ---------- Bäume ----------

/** `/deck list` gezeichnet: je Prompt Name, Anfang und die Knöpfe Senden, Knopf an/aus, Löschen (sidekick `promptsTree`). */
function listTree($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], snap: readonly Saved[]): RenderElement {
  const x = t().pr
  const ui = $.ui.resolve(e)
  const Button = (p: { key: string; label: string; onPress: () => void }) => ui.Button(p) as RenderNode
  const shown = new Set(buttonNames(saved))
  const after = (fn: () => Promise<unknown>) => () =>
    void fn()
      .catch((err) => $.ui.toast(msg(err), { timeoutMs: 8000 }))
      .then(() => $.ui.invalidate('ui.render'))
  const cols = viewportCols(e)
  const rows: RenderNode[] = snap.map((s0) => {
    const s = saved.find((y) => y.name === s0.name)
    const name = el('Box', { width: Math.max(10, Math.min(26, Math.floor(cols / 3))), flexShrink: 0 }, [el('Text', { color: ACCENT }, [`/${cmdOf(s0.name)}`])])
    if (!s) return el('Box', { key: `prompt-deck-pr-${s0.name}`, flexDirection: 'row' }, [name, el('Text', { dimColor: true }, [x.deleted(s0.name).split('.')[0] ?? ''])])
    const state = s.button ? (shown.has(s.name) ? x.on : `${x.on} (5+)`) : x.off
    return el('Box', { key: `prompt-deck-pr-${s.name}`, flexDirection: 'column' }, [
      el('Box', { flexDirection: 'row', columnGap: 1, flexWrap: 'wrap' }, [
        name,
        Button({ key: `prompt-deck-pr-send-${s.name}`, label: x.btnSend, onPress: () => void pressPrompt($, s.name) }),
        Button({ key: `prompt-deck-pr-btn-${s.name}`, label: s.button ? x.btnButtonOff : x.btnButtonOn, onPress: after(() => setButton($, s.name, !s.button)) }),
        Button({ key: `prompt-deck-pr-del-${s.name}`, label: x.btnDelete, onPress: after(() => forget($, s.name)) }),
        el('Text', { dimColor: true }, [`${x.listCols.split('|')[3]?.trim() ?? ''}: ${state}`]),
      ]),
      el('Box', { paddingLeft: 2 }, [el('Text', { dimColor: true }, [preview(s.text, 90)])]),
    ])
  })
  return el('Box', { key: 'prompt-deck-list', flexDirection: 'column', rowGap: 0 }, [
    el('Text', { bold: true }, [x.listHead(saved.length, SAVED_MAX).replace(/\*\*/g, '')]),
    ...rows,
    el('Box', { marginTop: 1 }, [el('Text', { dimColor: true }, [x.listFoot.replace(/`/g, '')])]),
  ])
}

/** Klick auf An/Aus in `/deck buttons`; Knopfarten sagen per Toast, ob und wo es gilt. Danach einmal neu zeichnen. */
async function pressButtonRow($: EngineInterface, tg: BtnTarget, want: boolean) {
  try {
    const out = await applyButton($, tg, want)
    if (tg.kind === 'switch') $.ui.toast(out.replace(/`/g, ''), { timeoutMs: 8000 })
  } catch (err) {
    try {
      $.ui.toast(msg(err), { timeoutMs: 8000 })
    } catch {
      // nach einem Neuladen (Weg 1) ist die alte Instanz fort
    }
  }
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // die neue Instanz zeichnet
  }
}

/** `/deck buttons` gezeichnet (Terminal und Desktop): je Zeile Titel, Knopf An/Aus und der Zustand (sidekick `buttonsTree`). */
function buttonsTree($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]): RenderElement {
  const x = t().bt
  const ui = $.ui.resolve(e)
  const f = facts()
  const width = Math.max(10, Math.min(26, Math.floor(viewportCols(e) / 3)))
  const rows: RenderNode[] = buttonRows(f).map((r) => {
    const key = r.kind === 'switch' ? `prompt-deck-bt-${r.id}` : `prompt-deck-bt-p-${r.id}`
    const k = BUTTON_KINDS.find((y) => y.id === r.id)
    const tg: BtnTarget = r.kind === 'switch' && k ? { kind: 'switch', k } : { kind: 'prompt', name: r.id }
    return el('Box', { key: `${key}-row`, flexDirection: 'row', columnGap: 1, flexWrap: 'wrap' }, [
      el('Box', { width, flexShrink: 0 }, [el('Text', r.kind === 'prompt' ? { color: ACCENT } : {}, [r.title])]),
      ui.Button({ key, label: r.on ? x.btnOff : x.btnOn, onPress: () => void pressButtonRow($, tg, !r.on) }) as RenderNode,
      el('Text', { dimColor: true }, [r.state]),
    ])
  })
  return el('Box', { key: 'prompt-deck-buttons', flexDirection: 'column' }, [
    el('Text', { bold: true }, [x.head.replace(/\*\*/g, '')]),
    ...rows,
    ...(f.saved.length ? [] : [el('Text', { dimColor: true }, [x.noPrompts.replace(/`/g, '')])]),
    el('Box', { marginTop: 1 }, [el('Text', { dimColor: true }, [x.footTree])]),
  ])
}

/**
 * Kam der Befehl von Fynn selbst? Eingabefeld (`composer`), Fernbedienung (`bridge`) oder der Desktop, der getippte Nachrichten als
 * `sdk` stempelt (sidekick Bau 0.24.0 P1). Plugins, andere Sessions, Zeitpläne und Kanäle nicht (PromptOrigin, types:9772-9870).
 * Ohne `origin` (ältere Aufrufer im Test-Kit): wie getippt.
 */
function byPerson(origin: { kind?: string } | undefined): boolean {
  const k = origin?.kind
  return k === undefined || k === 'composer' || k === 'bridge' || k === 'sdk'
}

const tagOf = (text: string) => /#[0-9a-z]{5,}/.exec(text.split('\n')[0] ?? '')?.[0]

export function register(on: On, options?: Readonly<Record<string, string | number | boolean | readonly string[]>>) {
  setLang(options?.language)
  cfg = readSettings(SETTINGS, options)

  on('session.start', async ($, e, next) => {
    try {
      await loadSaved($)
      savedLast = undefined
      pushSaved($, true)
    } catch {
      // ohne gespeicherte Prompts
    }
    laterAt = null
    fresh = true
    // Befehle zuletzt, jeder für sich (CLAUDE.md)
    try {
      await $.command.register({ name: DECK_CMD, description: t().cmdDeck, argumentHint: '[list|save <name> [text]|show <name>|<name> on|off|forget <name>|buttons …|language|help]' })
    } catch {
      // ohne /deck
    }
    await registerP($)
    return next(e)
  })

  // Eigene Zeile `layer:10:prompt-deck` über der Grundzeile (BAND-SPEC-2 §11), nur im Desktop (SPEC Verhalten 2). Nichts zu zeigen,
  // Umfrage, Terminal oder andere Oberfläche: `next(e)` = keine Zeile (en/interface.md:200-204).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    working = e.props.isWorking === true
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    let btns: RenderNode[] = []
    try {
      btns = await rowButtons($, e)
    } catch {
      btns = []
    }
    if (!btns.length) return next(e)
    try {
      return layer(LEVEL.promptDeck, SELF, [el('Box', { key: 'prompt-deck-row', flexDirection: 'row', columnGap: 1, flexWrap: 'wrap' }, btns)])
    } catch {
      return next(e)
    }
  })

  // Anordnung des ganzen Bands, in jeder Band-Mod derselbe Hook (templates/band/README.md); idempotent
  on('ui.render', { component: 'AbovePromptList' }, async (_$, e, next) => arrange(e, next))

  // `/p <name>` sendet (sidekick Bau 0.21.0/0.22.0: fester Befehl, kein Muster)
  on('command.run', { command: 'p' }, async ($, e) => {
    // Nur auf Fynns eigenen Befehl: ruft ein anderes Plugin `/p`, sendet prompt-deck nicht als seine Worte (origin, types:1869-1876)
    if (!byPerson(e.origin)) return { text: t().pr.notByPlugin }
    const name = normName(e.args.trim().split(/\s+/)[0] ?? '')
    if (!name) return { text: t().pr.pUsage((await loadSaved($)).map((s) => s.name)) }
    return { text: await runPrompt($, name, 'cmd') }
  })

  on('command.run', { command: 'deck' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', ...restWords] = args.split(/\s+/)
    const v = verb.toLowerCase()
    // Andere Plugins: nur `save` von sidekick (SPEC Verhalten 5); erste Zeile maschinenlesbar
    if (e.origin?.kind === 'plugin') {
      const who = String((e.origin as { name?: unknown }).name ?? '')
      if (who !== SIDEKICK || v !== 'save') return { text: `refused not-allowed\n${t().pr.refusedPlugin(who || '?')}` }
      return { text: await saveCommand($, e.args.replace(/^\s*\S+/, ''), 'sidekick', () => $.session.messages()) }
    }
    // Andere Herkünfte als Fynn selbst (peer, coordinator, scheduled-trigger …, types:9772-9870): nichts ändern (Review K1)
    if (!byPerson(e.origin)) return { text: `refused not-allowed\n${t().pr.refusedPlugin(String(e.origin?.kind ?? '?'))}` }
    // Sprache aller fynn-mods (docs/LANGUAGE-SPEC.md §6 Punkt 2) vor allem anderen
    if (isLanguage(args)) return { text: await languageCommand($, { mod: SELF, cmd: DECK_CMD, lang: lang() }, args) }
    if (HELP_WORDS.includes(v) && !restWords.length) return { text: await helpCommand($) }
    if (!args || (LIST_WORDS.includes(v) && !restWords.length)) return { text: await listCommand($) }
    if (v === 'save') return { text: await saveCommand($, e.args.replace(/^\s*\S+/, ''), 'user', () => $.session.messages()) }
    if (v === 'show') return { text: await showCommand($, restWords[0] ?? '') }
    if (v === 'forget') return { text: await forget($, restWords[0] ?? '') }
    if (v === 'buttons') return { text: await buttonsCommand($, restWords.join(' ')) }
    const sw = (restWords[0] ?? '').toLowerCase()
    if (restWords.length === 1 && (sw === 'on' || sw === 'off')) return { text: await nameSwitch($, verb, sw === 'on') }
    return { text: t().unknownArg(args) }
  })

  // `/deck list`, `/deck buttons` und `/deck help` gezeichnet (Terminal und Desktop); sonst Markdown der Engine (SPEC Verhalten 6)
  on('ui.render', { component: 'CommandOutput', props: { command: 'deck' } }, async ($, e, next) => {
    if (e.props.isErrored || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const a = String(e.props.args ?? '').trim().toLowerCase()
    const tag = tagOf(e.props.text)
    if (!tag) return next(e)
    try {
      if (a === '' || LIST_WORDS.includes(a)) {
        const snap = lists.get(tag)
        return snap ? listTree($, e, snap) : next(e)
      }
      if (/^buttons(\s+status)?$/.test(a)) return btnLists.has(tag) ? buttonsTree($, e) : next(e)
      // Nur die Zeile der Hilfe: `/deck #<Kennung>` trägt die Kennung auch in Zeile 1 (templates/help/README.md Punkt 4)
      if (!HELP_WORDS.includes(a)) return next(e)
      const data = helps.get(tag)
      return data ? helpTree(data, e.viewport?.columns ?? 100, e.surface, HELP_ACCENT) : next(e)
    } catch {
      return next(e)
    }
  })
}
