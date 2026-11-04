// $.state-Werte von limit-bars (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur limit-bars schreibt (types:3308-3313).
// `band` (seit 0.9.0) meldet die Breite des Platzes 10 im Band an spotify (docs/BAND.md „Platzbreite“): `width` in Pixeln im
// Desktop, `null`, wenn limit-bars nichts zeichnet. Geschrieben wird beim Sitzungsstart und bei jeder Änderung der Anzeige,
// nie beim Zeichnen. spotify deklariert denselben Wert in seinem eigenen Vertrag (mods/spotify/types/index.d.ts); beide Fassungen
// müssen gleich bleiben.

declare module 'claude-code' {
  interface PluginState {
    'limit-bars': {
      band: { width: number } | null
    }
  }
}
