// look.ts: der Farbsatz „Poly World“ für die Desktop-App (SPEC „Farbsatz“). Nur über makeColors (make-colors.js unverändert aus dem
// Skill plugin-authoring 2.1.325; docs/raw/en/interface.md:449-535). Grautöne aus dem Himmel der Insel: hell Morgenblau auf Papier,
// dunkel Laternenlicht auf Nachtblau (warme Schrift auf kühlem Grund, keine Umkehrung). Rollen zur Insel hin getönt: Himmel, Ziegel,
// Gras, Laterne, Abendviolett.
import type { ThemeColors, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

export const LABEL = 'Poly World'

/** Ergebnis von makeColors; `theme` fehlt, wenn makeColors geworfen hat (dann nur die Szene). */
export type Palette = { theme: ThemeColors | undefined; problems: readonly string[]; error?: string }

export function palette(): Palette {
  try {
    const { theme, problems } = makeColors({
      label: LABEL,
      roles: { accent: '#3a78b8', danger: '#bf4636', success: '#4b9645', warning: '#c48419', pro: '#7656a8' },
      light: {
        gray: {
          anchors: {
            'surface-0': '#e4ebf2',
            'surface-1': '#ecf1f6',
            'surface-2': '#f4f7fa',
            'text-primary': '#141c27',
            'text-secondary': '#36424f',
            'text-muted': '#515d6b',
          },
        },
      },
      dark: {
        roles: { accent: '#78ade6', warning: '#e0a24a' },
        gray: {
          anchors: {
            'surface-0': '#0d1324',
            'surface-1': '#131a2d',
            'surface-2': '#182036',
            'surface-3': '#1d263d',
            'text-primary': '#f3eee4',
            'text-secondary': '#d2cabb',
            'text-muted': '#a9a191',
          },
        },
      },
    })
    return { theme, problems }
  } catch (err) {
    return { theme: undefined, problems: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/** Zeilen, wegen derer der Desktop das ganze Theme nicht malt (look.md „colors“). */
export const unpainted = (p: Palette) => p.problems.filter((line) => line.startsWith("Desktop won't paint"))

export const SCENE = 'island'

/**
 * Das ganze Theme in einem Aufruf (ein Theme je Session, look.md). Farben nur, wenn an und malbar. Ohne `glass`: das Milchglas der
 * Surface (blur 16, opacity 0.6, types@2.1.325:14183-14200); eigene Werte erst nach Fynns Desktop-Abnahme (PROBE.md §2).
 */
export function look(p: Palette, withColors: boolean): ThemeSetArgs {
  const args: ThemeSetArgs = { backdrop: { scene: SCENE } }
  if (withColors && p.theme && !unpainted(p).length) args.colors = p.theme
  return args
}
