// palettes.ts: die drei Farbsätze von tint (SPEC „Farbsätze“, Zuordnung begründet unter „Bau 0.1.0“). Farben nur über makeColors
// (make-colors.js unverändert aus dem Skill plugin-authoring 2.1.325; docs/raw/en/interface.md:449-509). Nur `colors`, nie `backdrop`.
// Quellen der Paletten: Rosé Pine github.com/rose-pine/palette palette.json (MIT), Nord nordtheme.com/docs/colors-and-palettes (MIT).
import type { ThemeColors } from 'claude-code'

import { makeColors } from './make-colors.js'

export const PALETTES = ['herbstglut', 'rose-pine', 'nord'] as const
export type PaletteName = (typeof PALETTES)[number]
export const isPalette = (v: unknown): v is PaletteName => typeof v === 'string' && (PALETTES as readonly string[]).includes(v)

/** Rollen, wie /tint sie als Farbmuster zeigt (die Grundfarben des Satzes, nicht die abgeleiteten Stufen). */
export const SWATCH_ROLES = ['surface', 'text', 'accent', 'danger', 'success', 'warning', 'pro'] as const
export type SwatchRole = (typeof SWATCH_ROLES)[number]
export type Swatches = Readonly<Record<SwatchRole, string>>

type Definition = Parameters<typeof makeColors>[0]

/** Rosé Pine Dawn (hell) und Moon (dunkel), palette.json von rose-pine/palette. */
const DAWN = { base: '#faf4ed', surface: '#fffaf3', subtle: '#797593', text: '#464261', love: '#b4637a', gold: '#ea9d34', rose: '#d7827e', pine: '#286983', iris: '#907aa9' }
const MOON = { base: '#232136', surface: '#2a273f', subtle: '#908caa', text: '#e0def4', love: '#eb6f92', gold: '#f6c177', rose: '#ea9a97', foam: '#9ccfd8', iris: '#c4a7e7' }

/** Nord nord0 … nord15 (nordtheme.com/docs/colors-and-palettes): Polar Night 0-3, Snow Storm 4-6, Frost 7-10, Aurora 11-15. */
const NORD = ['#2e3440', '#3b4252', '#434c5e', '#4c566a', '#d8dee9', '#e5e9f0', '#eceff4', '#8fbcbb', '#88c0d0', '#81a1c1', '#5e81ac', '#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#b48ead'] as const
const nord = (i: number) => NORD[i]!

type Set = { label: string; definition: Definition; swatches: { light: Swatches; dark: Swatches } }

export const SETS: Readonly<Record<PaletteName, Set>> = {
  // Werte genau wie poly-world hooks/look.ts 0.2.0 (SPEC „Farbsätze“); nur das Label ist hier „Herbstglut“
  herbstglut: {
    label: 'Herbstglut',
    definition: {
      label: 'Herbstglut',
      roles: { accent: '#b8501f', danger: '#b93a2b', success: '#4b8a3a', warning: '#b07a12', pro: '#7a4f9a' },
      light: {
        gray: {
          anchors: {
            'surface-0': '#f1e8da',
            'surface-1': '#f6efe3',
            'surface-2': '#fbf7ee',
            'text-primary': '#281b12',
            'text-secondary': '#4d3b2c',
            'text-muted': '#69543f',
          },
        },
      },
      dark: {
        gray: {
          anchors: {
            'surface-0': '#091024',
            'surface-1': '#0e172e',
            'surface-2': '#131d38',
            'surface-3': '#182340',
            'text-primary': '#f7ecda',
            'text-secondary': '#d8cab2',
            'text-muted': '#b0a28a',
          },
        },
      },
    },
    swatches: {
      light: { surface: '#f1e8da', text: '#281b12', accent: '#b8501f', danger: '#b93a2b', success: '#4b8a3a', warning: '#b07a12', pro: '#7a4f9a' },
      dark: { surface: '#091024', text: '#f7ecda', accent: '#b8501f', danger: '#b93a2b', success: '#4b8a3a', warning: '#b07a12', pro: '#7a4f9a' },
    },
  },
  // Dawn: Seite base, Karten und Panels surface (heller als base, wie makeColors es im Hellen verlangt). Schrift text; Muted ist
  // Subtle mit 30 % Text (Dawn-Muted #9893a5 läge bei 2,7:1), Secondary Subtle mit 60 % Text. Moon: Seite base, alles darüber
  // surface (Overlay #393552 ist für Muted-Schrift zu hell). Muted ist Subtle mit 12 % Text (Moon-Muted #6e6a86 läge bei 3:1).
  // Akzent Iris, Pro Rose, Love danger, Pine (hell) bzw. Foam (dunkel) success, Gold warning.
  'rose-pine': {
    label: 'Rosé Pine',
    definition: {
      label: 'Rosé Pine',
      light: {
        roles: { accent: DAWN.iris, danger: DAWN.love, success: DAWN.pine, warning: DAWN.gold, pro: DAWN.rose },
        gray: {
          anchors: {
            'surface-0': DAWN.base,
            'surface-1': DAWN.surface,
            'surface-2': DAWN.surface,
            'text-primary': DAWN.text,
            'text-secondary': '#5a5675',
            'text-muted': '#6a6684',
          },
        },
      },
      dark: {
        // Foam als Schriftstufe 400 (text-success im Dunkeln): die abgeleitete Stufe lag auf surface bei 4,1:1
        roles: { accent: MOON.iris, danger: MOON.love, success: { seed: MOON.foam, stops: { 400: MOON.foam } }, warning: MOON.gold, pro: MOON.rose },
        gray: {
          anchors: {
            'surface-0': MOON.base,
            'surface-1': MOON.surface,
            'surface-2': MOON.surface,
            'surface-3': MOON.surface,
            'text-primary': MOON.text,
            'text-secondary': '#b8b5cf',
            'text-muted': '#9a96b3',
          },
        },
        // Diff-Farben aus Moon statt der Standardwerte (die lagen auf surface teils unter 4,5:1); hell bleiben die der App
        git: { added: MOON.foam, removed: MOON.love, modified: MOON.gold, merged: MOON.iris, closed: MOON.love, conflicting: MOON.rose, draft: '#9a96b3' },
      },
      // Eine Surface ohne diesen Namen behält ihren eigenen (types@2.1.325:14276-14283)
      codeTheme: { light: 'rose-pine-dawn', dark: 'rose-pine-moon' },
    },
    swatches: {
      light: { surface: DAWN.base, text: DAWN.text, accent: DAWN.iris, danger: DAWN.love, success: DAWN.pine, warning: DAWN.gold, pro: DAWN.rose },
      dark: { surface: MOON.base, text: MOON.text, accent: MOON.iris, danger: MOON.love, success: MOON.foam, warning: MOON.gold, pro: MOON.rose },
    },
  },
  // Hell: Seite nord5, Karten und Panels nord6 (Snow Storm), Schrift nord0, Secondary nord2, Muted nord3 (Polar Night). Dunkel:
  // Seite nord0, darüber nord1 (nord2/nord3 sind für Rollen-Schrift zu hell), Schrift nord6, Secondary nord4, Muted nord3 mit
  // 72 % nord4 (Nord hat keinen Grauton dazwischen). Akzent Frost nord10 (hell) bzw. nord8 (dunkel), Aurora: nord11 danger,
  // nord14 success, nord13 warning, nord15 pro. Im Dunkeln stehen die Schriftstufen der Rollen auf den Nord-Farben selbst
  // (Frost, Grün, Gelb) bzw. Rot und Violett zu nord6 aufgehellt, weil die abgeleiteten auf nord1 unter 4,5:1 lagen.
  nord: {
    label: 'Nord',
    definition: {
      label: 'Nord',
      light: {
        roles: { accent: nord(10), danger: nord(11), success: nord(14), warning: nord(13), pro: nord(15) },
        gray: {
          anchors: {
            'surface-0': nord(5),
            'surface-1': nord(6),
            'surface-2': nord(6),
            'text-primary': nord(0),
            'text-secondary': nord(2),
            'text-muted': nord(3),
          },
        },
      },
      dark: {
        roles: {
          accent: { seed: nord(8), stops: { 300: nord(8) } },
          danger: { seed: nord(11), stops: { 300: '#d4a4ab' } },
          success: { seed: nord(14), stops: { 400: nord(14) } },
          warning: { seed: nord(13), stops: { 300: nord(13) } },
          pro: { seed: nord(15), stops: { 300: '#c3a8c0' } },
        },
        gray: {
          anchors: {
            'surface-0': nord(0),
            'surface-1': nord(1),
            'surface-2': nord(1),
            'surface-3': nord(1),
            'text-primary': nord(6),
            'text-secondary': nord(4),
            'text-muted': '#b1b8c5',
          },
        },
        // Diff-Farben aus Aurora (Rot, Violett, Orange zu nord6 aufgehellt); die Standardwerte lagen auf nord1 bei 2,75:1 (removed)
        git: { added: nord(14), removed: '#d4a4ab', modified: nord(13), merged: '#c3a8c0', closed: '#d4a4ab', conflicting: '#d8a698', draft: nord(4) },
      },
      codeTheme: { dark: 'nord' },
    },
    swatches: {
      light: { surface: nord(5), text: nord(0), accent: nord(10), danger: nord(11), success: nord(14), warning: nord(13), pro: nord(15) },
      dark: { surface: nord(0), text: nord(6), accent: nord(8), danger: nord(11), success: nord(14), warning: nord(13), pro: nord(15) },
    },
  },
}

/** Ergebnis von makeColors; `theme` fehlt, wenn makeColors geworfen hat. */
export type Built = { theme: ThemeColors | undefined; problems: readonly string[]; error?: string }

export function build(name: PaletteName): Built {
  try {
    const { theme, problems } = makeColors(SETS[name].definition)
    return { theme, problems }
  } catch (err) {
    return { theme: undefined, problems: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/** Zeilen, wegen derer der Desktop das ganze Theme nicht malt (interface.md:505, look.md „colors“). */
export const unpainted = (b: Built) => b.problems.filter((line) => line.startsWith("Desktop won't paint"))

/** Warum ein Farbsatz nicht gesetzt wird, sonst undefined. */
export const blocked = (b: Built): string | undefined => b.error ?? unpainted(b)[0]

/** Der Farbsatz, dessen Label in einer Zeile steht (für das gezeichnete Farbmuster aus dem Status-Text). */
export function paletteIn(line: string): PaletteName | undefined {
  return PALETTES.find((p) => line.includes(SETS[p].label))
}
