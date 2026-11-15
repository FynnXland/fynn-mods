// custom.ts: eigene Farbsätze aus Design-Systemen (SPEC „Ausbau 0.2.0“). Claude liest das Design-System selbst und übergibt die
// Anker an das Werkzeug save_colors; hier wird nur geprüft und in eine makeColors-Definition übersetzt. Ohne `$`, ohne Zustand.
// Gespeichert wird in $.store (`sets`, `active`, docs/CHEATSHEET.md:54) von register.ts.
import { makeColors } from './make-colors.js'
import { PALETTES, SETS, unpainted } from './palettes.js'
import type { Built, Swatches } from './palettes.js'

type Definition = Parameters<typeof makeColors>[0]
/** Form der Anker, wie make-colors.d.ts sie verlangt; parseInput sorgt dafür, dass alle sechs da sind. */
type GrayAnchors = { 'surface-0': string; 'text-primary': string } & Anchors

export const ANCHORS = ['surface-0', 'surface-1', 'surface-2', 'text-primary', 'text-secondary', 'text-muted'] as const
/** Nur im Dunkeln optional (SPEC „Werkzeug save_colors“). */
export const DARK_EXTRA = 'surface-3'
export const ROLES = ['accent', 'danger', 'success', 'warning', 'pro'] as const
type Role = (typeof ROLES)[number]
type Mode = 'light' | 'dark'

/** Namen, die ein Befehl von /tint schon belegt (SPEC „Werkzeug save_colors“). */
export const RESERVED: readonly string[] = [...PALETTES, 'custom', 'on', 'off', 'remove', 'help', 'language', 'status']
export const MAX_SETS = 20
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MAX_NAME = 32
const MAX_SOURCE = 160

export type Anchors = Record<string, string>
/** Ein eigener Satz, wie er in $.store `sets` steht. */
export type OwnSet = { source: string; light: Anchors; dark: Anchors; roles: Partial<Record<Role, string>> }
export type OwnSets = Record<string, OwnSet>

/** `#RGB` oder `#RRGGBB`, klein geschrieben als `#rrggbb`; sonst undefined. */
export function hex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`
  return undefined
}

const shown = (v: unknown) => (typeof v === 'string' ? `"${v.slice(0, 40)}"` : v === undefined ? 'missing' : JSON.stringify(v)?.slice(0, 40) ?? String(v))
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Ein Text aus dem Werkzeug, eine Zeile, ohne Markdown-Zeichen, die den Status verbiegen. */
export const clean = (v: string, max: number) => v.replace(/[\r\n\t`*_|<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function nameProblem(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return 'name is missing: give a short kebab-case name, like "acme" or "acme-brand".'
  const n = raw.trim().toLowerCase()
  if (n.length > MAX_NAME || !NAME.test(n)) return `name ${shown(raw)} is not kebab-case (a-z, 0-9 and hyphens, starting with a letter, ${MAX_NAME} characters at most).`
  if (RESERVED.includes(n)) return `name "${n}" is taken by tint (${RESERVED.join(', ')}); choose another.`
  return undefined
}

function anchorsOf(mode: Mode, raw: unknown, problems: string[]): Anchors {
  const out: Anchors = {}
  if (!isObj(raw)) {
    problems.push(
      mode === 'dark'
        ? 'dark is missing. If the design system has no dark mode, derive one: darkest neutrals as surfaces (surface-0 darkest), light text, the same hues; then tell the person the dark mode is derived.'
        : 'light is missing. If the design system has no light mode, derive one from its light neutrals and dark text, and tell the person.',
    )
    return out
  }
  const allowed: readonly string[] = mode === 'dark' ? [...ANCHORS, DARK_EXTRA] : ANCHORS
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) problems.push(`${mode}.${key} is not an anchor; use ${allowed.join(', ')}.`)
  for (const key of allowed) {
    const v = raw[key]
    if (v === undefined && key === DARK_EXTRA) continue
    const h = hex(v)
    if (h) out[key] = h
    else problems.push(`${mode}.${key} is ${shown(v)}; give a hex color like #1e1e2e.`)
  }
  return out
}

/** Eingabe von save_colors prüfen (Form, Hex, Name). Kontraste prüft `check`. Wirft nie. */
export function parseInput(e: Record<string, unknown>): { name: string; set: OwnSet; apply: boolean; problems: string[] } {
  const problems: string[] = []
  const np = nameProblem(e.name)
  if (np) problems.push(np)
  const name = typeof e.name === 'string' ? e.name.trim().toLowerCase() : ''
  const source = typeof e.source === 'string' ? clean(e.source, MAX_SOURCE) : ''
  if (!source) problems.push('source is missing: say in a few words where the colors come from (file, URL or design system name).')
  const light = anchorsOf('light', e.light, problems)
  const dark = anchorsOf('dark', e.dark, problems)
  const roles: OwnSet['roles'] = {}
  if (!isObj(e.roles)) problems.push('roles is missing: give at least roles.accent (the brand or primary color).')
  else {
    for (const key of Object.keys(e.roles)) if (!(ROLES as readonly string[]).includes(key)) problems.push(`roles.${key} is not a role; use ${ROLES.join(', ')}.`)
    for (const r of ROLES) {
      const v = e.roles[r]
      if (v === undefined && r !== 'accent') continue
      const h = hex(v)
      if (h) roles[r] = h
      else problems.push(`roles.${r} is ${shown(v)}; give a hex color like #b8501f.`)
    }
  }
  if (e.apply !== undefined && typeof e.apply !== 'boolean') problems.push(`apply is ${shown(e.apply)}; use true or false.`)
  return { name, set: { source, light, dark, roles }, apply: e.apply !== false, problems }
}

/** Ein gespeicherter Satz in Ordnung? (Store kann von Hand oder von einer älteren Fassung verändert sein.) */
export function isOwnSet(v: unknown): v is OwnSet {
  if (!isObj(v) || typeof v.source !== 'string' || !isObj(v.roles) || !hex(v.roles.accent)) return false
  const problems: string[] = []
  anchorsOf('light', v.light, problems)
  anchorsOf('dark', v.dark, problems)
  return problems.length === 0
}

/** Inhalt von $.store `sets`: nur gültige Einträge mit gültigem Namen. */
export function readOwnSets(raw: unknown): OwnSets {
  const out: OwnSets = {}
  if (!isObj(raw)) return out
  // Durch dieselbe Prüfung wie das Werkzeug: Hex klein und sechsstellig, source bereinigt (ein von Hand geänderter Store)
  for (const [n, v] of Object.entries(raw)) {
    if (nameProblem(n) || !isOwnSet(v)) continue
    const p = parseInput({ ...v, name: n })
    if (!p.problems.length) out[n] = p.set
  }
  return out
}

/** Fehlende Rollen kommen von Herbstglut (SPEC „Werkzeug save_colors“). */
export function rolesOf(set: OwnSet): Record<Role, string> {
  const base = SETS.herbstglut.definition.roles as Record<Role, string>
  return { ...base, ...set.roles }
}

export function definitionOf(name: string, set: OwnSet): Definition {
  return {
    label: name,
    roles: rolesOf(set),
    light: { gray: { anchors: set.light as GrayAnchors } },
    dark: { gray: { anchors: set.dark as GrayAnchors } },
  }
}

export function swatchesOf(set: OwnSet): { light: Swatches; dark: Swatches } {
  const r = rolesOf(set)
  const mode = (a: Anchors): Swatches => ({ surface: a['surface-0']!, text: a['text-primary']!, ...r })
  return { light: mode(set.light), dark: mode(set.dark) }
}

/** WCAG-Kontrast zweier `#rrggbb`. */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

const ratio = (n: number) => `${(Math.floor(n * 100) / 100).toFixed(2)}:1`

/** Kleinste Kontraste je Modus, für das Ergebnis an Claude und den Status. */
export function minContrasts(set: OwnSet): Record<Mode, { primary: number; muted: number }> {
  const one = (a: Anchors) => {
    const surfaces = Object.keys(a).filter((k) => k.startsWith('surface-'))
    return {
      primary: Math.min(...surfaces.map((s) => contrast(a['text-primary']!, a[s]!))),
      muted: Math.min(...surfaces.map((s) => contrast(a['text-muted']!, a[s]!))),
    }
  }
  return { light: one(set.light), dark: one(set.dark) }
}

export const contrastLine = (set: OwnSet) => {
  const m = minContrasts(set)
  return `light: text-primary ≥ ${ratio(m.light.primary)}, text-muted ≥ ${ratio(m.light.muted)} · dark: text-primary ≥ ${ratio(m.dark.primary)}, text-muted ≥ ${ratio(m.dark.muted)}`
}

/**
 * Kontraste (text-primary ≥ 7:1, text-muted ≥ 4.5:1 auf jeder Fläche) und makeColors (wirft nicht, keine Zeile „Desktop won't
 * paint“). Liefert den gebauten Satz und alle Probleme mit Werten. Wirft nie.
 */
export function check(name: string, set: OwnSet): { built: Built; problems: string[] } {
  const problems: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const a = set[mode]
    for (const s of Object.keys(a).filter((k) => k.startsWith('surface-'))) {
      const p = contrast(a['text-primary']!, a[s]!)
      if (p < 7) problems.push(`${mode}: text-primary ${a['text-primary']} on ${s} ${a[s]} is ${ratio(p)}, needs 7:1.`)
      const m = contrast(a['text-muted']!, a[s]!)
      if (m < 4.5) problems.push(`${mode}: text-muted ${a['text-muted']} on ${s} ${a[s]} is ${ratio(m)}, needs 4.5:1.`)
    }
  }
  let built: Built
  try {
    const { theme, problems: notes } = makeColors(definitionOf(name, set))
    built = { theme, problems: notes }
  } catch (err) {
    built = { theme: undefined, problems: [], error: err instanceof Error ? err.message : String(err) }
  }
  if (built.error) problems.push(`The color builder refused it: ${built.error}`)
  problems.push(...unpainted(built))
  return { built, problems }
}
