// Vertrag von tune-strip für `$.state`. tune-strip liest die Breite der Plätze von limit-bars (10) und clawd-buddy (30) im Band: `band` =
// Breite in Pixeln im Desktop, `null`, wenn der Mod nichts zeichnet (docs/BAND.md „Platzbreite“, Weg A, Fynn 2026-11-03).
// Seit 0.3.0 schreibt tune-strip `tune-strip.playing`: ob gerade Musik läuft (`{ playing }`), `null` ohne Spotify-Sitzung, wenn tune-strip aus ist;
// außerhalb von Windows nie geschrieben (leer). Kein Titel, kein Interpret. clawd-buddy liest ihn und wippt mit (mods/clawd-buddy/types/index.d.ts).
// Seit 0.6.0 zusätzlich `tune-strip.beat` (Takt und Gruppe), ebenfalls für clawd-buddy.
// Jeder Mod darf die Werte eines anderen lesen (types:3308-3313). Ohne Abhängigkeit in plugin.json kennt dieser Vertrag die Verträge
// der anderen nicht; deshalb stehen die Werte hier noch einmal und müssen mit mods/limit-bars/types/index.d.ts und
// mods/clawd-buddy/types/index.d.ts übereinstimmen. `validate` meldet sie als „state of other plugins, not checked“.

declare module 'claude-code' {
  interface PluginState {
    'tune-strip': {
      playing: { playing: boolean } | null
      // 0.6.0: Takt des laufenden Songs, nur aus dem Klang (lokal ausgewertet). `bpm` 60–150 (halbes/doppeltes Tempo schon gefaltet),
      // `at` Unix-ms eines Schlags, wie er zu hören ist (Versatz eingerechnet), `sure` ob Tempo und Schlag tragen, `group` die Gruppe
      // des Songs oder `null`, solange sie offen ist. `null` ohne Takt (Pause, aus, kein Helfer, Stille). Kein Titel, kein Interpret.
      beat: { bpm: number; at: number; sure: boolean; group: 'calm' | 'groove' | 'hard' | 'sad' | null } | null
    }
    'limit-bars': {
      band: { width: number } | null
    }
    'clawd-buddy': {
      band: { width: number } | null
    }
    // 0.7.1: quick-replies meldet, ob seine Pille (Ebene 20) gerade im Band steht; tune-strip setzt danach die Trennlinie
    'quick-replies': {
      band: { shown: true } | null
    }
  }
}
