// Vertrag von tune-strip für `$.state`. tune-strip liest die Breite der Plätze von limit-bars (10) und clawd-buddy (30) im Band: `band` =
// Breite in Pixeln im Desktop, `null`, wenn der Mod nichts zeichnet (docs/BAND.md „Platzbreite“, Weg A, Fynn 2026-11-03).
// Seit 0.3.0 schreibt tune-strip `tune-strip.playing`: ob gerade Musik läuft (`{ playing }`), `null` ohne Spotify-Sitzung, wenn tune-strip aus ist;
// außerhalb von Windows nie geschrieben (leer). Kein Titel, kein Interpret. clawd-buddy liest ihn und wippt mit (mods/clawd-buddy/types/index.d.ts).
// Jeder Mod darf die Werte eines anderen lesen (types:3308-3313). Ohne Abhängigkeit in plugin.json kennt dieser Vertrag die Verträge
// der anderen nicht; deshalb stehen die Werte hier noch einmal und müssen mit mods/limit-bars/types/index.d.ts und
// mods/clawd-buddy/types/index.d.ts übereinstimmen. `validate` meldet sie als „state of other plugins, not checked“.

declare module 'claude-code' {
  interface PluginState {
    'tune-strip': {
      playing: { playing: boolean } | null
    }
    'limit-bars': {
      band: { width: number } | null
    }
    'clawd-buddy': {
      band: { width: number } | null
    }
  }
}
