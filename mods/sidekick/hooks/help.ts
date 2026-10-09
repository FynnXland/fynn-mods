// help.ts: die gezeichnete Hilfe-Tabelle für `/<befehl> help` (docs/HELP-SPEC.md §3-§4). Allgemein gehalten: Eine Mod
// liefert nur `HelpData` und ihre Akzentfarbe; Aufbau, Spalten, Farben der Schalter und die Markdown-Fassung stehen hier.
// Vorlage für alle Mods: templates/help/ (README dort). Ohne `$`, nur Daten → Baum bzw. Text, deshalb ohne Engine testbar.
//
// Baum aus reinen Daten {type, props, children} (types RenderElement), nur Box und Text mit erlaubten Props. Desktop:
// Spaltenbreiten nur als ganzzahlige Prozent, sonst verwirft er den ganzen Baum (cost-ledger 0.3.1). Unter 60 Spalten
// stehen die Spalten untereinander.
import type { RenderElement, RenderNode } from 'claude-code'

export type HelpLang = 'en' | 'de'
export type HelpSurface = 'terminal' | 'desktop'

/** Eine Zeile unter BEFEHLE bzw. BEDIENUNG: Befehl oder Bedienelement (Akzentfarbe) und seine Wirkung. */
export type HelpCommand = { cmd: string; does: string }
/**
 * Zustand einer Funktion: Schalter (`on` → „● an“ in `success`, `off` → „○ aus“ in `inactive`) oder ein Wert als Text, mit
 * „(Standard)“, wenn `isDefault`. `text` ersetzt „an“/„aus“; bei `on` steht er dann in der normalen Schriftfarbe (lange
 * Texte bleiben lesbar), nur der Punkt ist grün.
 */
export type HelpState = { kind: 'on' | 'off'; text?: string } | { kind: 'value'; text: string; isDefault?: boolean }
/** Eine Zeile unter FUNKTIONEN; `toggle` ist der Befehl, der den Zustand ändert, sonst z. B. „Einstellung“ oder „nur Info“. */
export type HelpFeature = { name: string; state: HelpState; toggle: string }
/** Eine Zeile unter EINSTELLUNGEN: Titel des userConfig-Felds (übersetzt) und sein aktueller Wert. */
export type HelpSetting = { title: string; value: string; isDefault?: boolean }
/** Schnappschuss beim Aufruf von `help`; die Zeichnung schreibt sich danach nicht um (HELP-SPEC §3 Punkt 3). */
export type HelpData = {
  /** Name der Mod im Titel */
  mod: string
  lang: HelpLang
  /** Ein Satz, was die Mod macht */
  intro: string
  commands: HelpCommand[]
  /** Gedimmte Zeilen unter den Befehlen (z. B. Aliase) */
  notes?: string[]
  /** BEDIENUNG: nur, wenn es Klicks oder Tasten gibt */
  controls?: HelpCommand[]
  features: HelpFeature[]
  settings: HelpSetting[]
  /** Weg zum Ändern der Einstellungen und zum Abschalten der Mod; Terminal und Desktop brauchen verschiedene Wege */
  footer: { terminal: string; desktop: string }
}

const LABELS = {
  en: {
    help: 'Help',
    commands: 'COMMANDS',
    controls: 'CONTROLS',
    features: 'FEATURES',
    status: 'STATUS',
    toggle: 'TOGGLE',
    settings: 'SETTINGS (/plugin)',
    value: 'VALUE',
    on: 'on',
    off: 'off',
    isDefault: '(default)',
  },
  de: {
    help: 'Hilfe',
    commands: 'BEFEHLE',
    controls: 'BEDIENUNG',
    features: 'FUNKTIONEN',
    status: 'STATUS',
    toggle: 'UMSCHALTEN',
    settings: 'EINSTELLUNGEN (/plugin)',
    value: 'WERT',
    on: 'an',
    off: 'aus',
    isDefault: '(Standard)',
  },
} as const

export function helpLabels(lang: HelpLang) {
  return LABELS[lang]
}

type Props = Record<string, string | number | boolean>
const el = (type: 'Box' | 'Text', props: Props, children: RenderNode[]): RenderElement => ({ type, props, children })
const text = (s: string, props: Props = {}) => el('Text', props, [s])
const dim = (s: string) => text(s, { dimColor: true })
const row = (props: Props, kids: RenderNode[]) => el('Box', { flexDirection: 'row', ...props }, kids)
const col = (props: Props, kids: RenderNode[]) => el('Box', { flexDirection: 'column', ...props }, kids)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Zustand als Text (für die Markdown-Fassung und zum Messen der Spaltenbreite). */
export function stateText(s: HelpState, lang: HelpLang): string {
  const L = LABELS[lang]
  if (s.kind === 'value') return s.isDefault ? `${s.text} ${L.isDefault}` : s.text
  return `${s.kind === 'on' ? '●' : '○'} ${s.text ?? (s.kind === 'on' ? L.on : L.off)}`
}

/**
 * Zustand gezeichnet: „● an“ in `success`, „○ aus“ in `inactive`; mit eigenem Text bei `on` nur der Punkt grün. Werte in
 * der normalen Schriftfarbe, „(Standard)“ gedimmt.
 */
function stateNode(s: HelpState, lang: HelpLang): RenderElement {
  const L = LABELS[lang]
  if (s.kind === 'value') return el('Text', {}, [text(s.text), ...(s.isDefault ? [dim(` ${L.isDefault}`)] : [])])
  const on = s.kind === 'on'
  const label = s.text ?? (on ? L.on : L.off)
  const labelProps: Props = on ? (s.text === undefined ? { color: 'success' } : {}) : { color: 'inactive' }
  return el('Text', {}, [text(on ? '● ' : '○ ', { color: on ? 'success' : 'inactive' }), text(label, labelProps)])
}

/**
 * Spalten einer Zeile. Terminal: feste Zellen, die letzte füllt den Rest. Desktop: ganzzahlige Prozent mit Summe 100
 * (`share` = gewünschte Breite in Zeichen, daraus die Anteile).
 */
function columns(sf: HelpSurface, inner: number, widths: number[], kids: RenderNode[], props: Props = {}): RenderElement {
  if (sf === 'desktop') {
    const pct = widths.slice(0, -1).map((w) => clamp(Math.round((w / inner) * 100), 10, 60))
    const rest = Math.max(10, 100 - pct.reduce((a, b) => a + b, 0))
    const all = [...pct, rest]
    // Summe genau 100: Überhang vom größten Anteil abziehen
    const over = all.reduce((a, b) => a + b, 0) - 100
    if (over > 0) all[all.indexOf(Math.max(...all))]! -= over
    return row(props, kids.map((k, i) => el('Box', { width: `${all[i]}%`, paddingRight: 1 }, [k])))
  }
  return row(
    props,
    kids.map((k, i) => (i < kids.length - 1 ? el('Box', { width: widths[i]!, flexShrink: 0 }, [k]) : el('Box', { flexGrow: 1, flexShrink: 1 }, [k]))),
  )
}

const heading = (s: string, accent: string) => text(s, { color: accent, bold: true })

/**
 * Der ganze Baum für eine `CommandOutput`-Zeile. `columns` ist `e.viewport?.columns` (begrenzt auf 30-140), `accent` die
 * Akzentfarbe der Mod (Hex oder Theme-Key), nur für Titel, Überschriften und Befehle.
 */
export function helpTree(d: HelpData, columnsHint: number, surface: HelpSurface, accent: string): RenderElement {
  const L = LABELS[d.lang]
  const cols = clamp(columnsHint || 100, 30, 140)
  const inner = cols - 4 // Rahmen und paddingX
  const narrow = cols < 60
  const kids: RenderNode[] = [heading(`${d.mod} · ${L.help}`, accent), text(d.intro)]

  const commandRows = (title: string, list: HelpCommand[]) => {
    if (!list.length) return
    kids.push(el('Box', { marginTop: 1 }, [heading(title, accent)]))
    const cmdW = clamp(Math.max(...list.map((c) => c.cmd.length)) + 2, 12, Math.floor(inner * 0.5))
    for (const c of list)
      kids.push(
        narrow
          ? col({}, [text(c.cmd, { color: accent }), el('Box', { paddingLeft: 2 }, [text(c.does)])])
          : columns(surface, inner, [cmdW, inner - cmdW], [text(c.cmd, { color: accent }), text(c.does)]),
      )
  }
  commandRows(L.commands, d.commands)
  for (const n of d.notes ?? []) kids.push(dim(n))
  commandRows(L.controls, d.controls ?? [])

  if (d.features.length) {
    const nameW = clamp(Math.max(L.features.length, ...d.features.map((f) => f.name.length)) + 2, 12, Math.floor(inner * 0.34))
    const stateW = clamp(Math.max(L.status.length, ...d.features.map((f) => stateText(f.state, d.lang).length)) + 2, 10, Math.floor(inner * 0.4))
    if (narrow) {
      kids.push(el('Box', { marginTop: 1 }, [heading(L.features, accent)]))
      // Zustand und Umschalten in einem Text, damit sie als ein Absatz umbrechen statt als zwei schmale Spalten
      for (const f of d.features)
        kids.push(col({}, [text(f.name), el('Box', { paddingLeft: 2 }, [el('Text', {}, [stateNode(f.state, d.lang), dim(` · ${f.toggle}`)])])]))
    } else {
      const widths = [nameW, stateW, inner - nameW - stateW]
      kids.push(columns(surface, inner, widths, [heading(L.features, accent), heading(L.status, accent), heading(L.toggle, accent)], { marginTop: 1 }))
      for (const f of d.features) kids.push(columns(surface, inner, widths, [text(f.name), stateNode(f.state, d.lang), dim(f.toggle)]))
    }
  }

  if (d.settings.length) {
    const titleW = clamp(Math.max(L.settings.length, ...d.settings.map((s) => s.title.length)) + 2, 12, Math.floor(inner * 0.5))
    const value = (s: HelpSetting) => stateNode({ kind: 'value', text: s.value, isDefault: s.isDefault }, d.lang)
    if (narrow) {
      kids.push(el('Box', { marginTop: 1 }, [heading(L.settings, accent)]))
      for (const s of d.settings) kids.push(col({}, [text(s.title), el('Box', { paddingLeft: 2 }, [value(s)])]))
    } else {
      const widths = [titleW, inner - titleW]
      kids.push(columns(surface, inner, widths, [heading(L.settings, accent), heading(L.value, accent)], { marginTop: 1 }))
      for (const s of d.settings) kids.push(columns(surface, inner, widths, [text(s.title), value(s)]))
    }
  }

  kids.push(el('Box', { marginTop: 1 }, [dim(surface === 'desktop' ? d.footer.desktop : d.footer.terminal)]))
  return col({ borderStyle: 'round', borderDimColor: true, paddingX: 1, width: '100%', key: `${d.mod}-help` }, kids)
}

/**
 * Kompakte Markdown-Fassung: was Claude mitliest und was `-p`, das SDK und VS Code zeigen. `tag` (Kennung `#…`) steht in
 * der ersten Zeile, darüber findet der Render-Hook den Schnappschuss. Fußzeile mit dem Terminal-Weg. Leerzeilen zwischen
 * den Blöcken: Sonst hängt Markdown (CommonMark) alles nach einer Liste an deren letzten Punkt.
 */
export function helpMarkdown(d: HelpData, tag: string): string {
  const L = LABELS[d.lang]
  const lines = [`**${d.mod} · ${L.help}**${tag ? ` · ${tag}` : ''}`, '', d.intro]
  const list = (title: string, items: HelpCommand[]) => {
    if (!items.length) return
    lines.push('', `**${title}**`, ...items.map((c) => `- \`${c.cmd}\`: ${c.does}`))
  }
  list(L.commands, d.commands)
  if (d.notes?.length) lines.push('', ...d.notes)
  list(L.controls, d.controls ?? [])
  if (d.features.length) lines.push('', `**${L.features}:** ${d.features.map((f) => `${f.name} ${stateText(f.state, d.lang)} (${f.toggle})`).join(' · ')}`)
  if (d.settings.length)
    lines.push('', `**${L.settings}:** ${d.settings.map((s) => `${s.title} ${s.value}${s.isDefault ? ` ${L.isDefault}` : ''}`).join(' · ')}`)
  lines.push('', d.footer.terminal)
  return lines.join('\n')
}
