// $.state-Werte von quick-replies (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur quick-replies schreibt (types:3308-3313).
// `band` (seit 0.6.2) meldet an tune-strip und sidekick, ob die Pille (Ebene 20) im Band steht: `{ shown: true }`, sonst `null` (docs/BAND.md
// „Absprachen über $.state“). Geschrieben wird beim Sitzungsstart und bei jeder Änderung des Zustands, nie beim Zeichnen. tune-strip deklariert
// denselben Wert in seinem eigenen Vertrag (mods/tune-strip/types/index.d.ts); beide Fassungen müssen gleich bleiben.
// Seit 0.8.0 (Band 2) liest quick-replies `sidekick.status`: Solange `handoff === true` ist (sidekick startet einen neuen Chat), zeichnet
// quick-replies keine Zeile (docs/BAND-SPEC-2.md §4). Kopie aus mods/sidekick/types/index.d.ts, gleich wie in mods/limit-bars und
// mods/clawd-buddy; muss gleich bleiben. `validate` meldet ihn als „state of other plugins, not checked“.

declare module 'claude-code' {
  interface PluginState {
    'quick-replies': {
      band: { shown: true } | null
    }
    sidekick: {
      status: { level: 'off' | 'cache' | 'guide'; busy: boolean; tip?: string; cold?: true; handoff?: true } | null
    }
  }
}
