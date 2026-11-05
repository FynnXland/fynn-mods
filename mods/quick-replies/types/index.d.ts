// $.state-Werte von quick-replies (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur quick-replies schreibt (types:3308-3313).
// `band` (seit 0.6.2) meldet an tune-strip, ob die Pille (Ebene 20) im Band steht: `{ shown: true }`, sonst `null` (docs/BAND.md „Pille“).
// Geschrieben wird beim Sitzungsstart und bei jeder Änderung des Zustands, nie beim Zeichnen. tune-strip deklariert denselben Wert in
// seinem eigenen Vertrag (mods/tune-strip/types/index.d.ts); beide Fassungen müssen gleich bleiben.

declare module 'claude-code' {
  interface PluginState {
    'quick-replies': {
      band: { shown: true } | null
    }
  }
}
