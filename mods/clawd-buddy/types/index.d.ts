// Vertrag von clawd-buddy für `$.state`. clawd-buddy schreibt keine eigenen Werte; er liest nur den Wert `sidekick.buddy` des Mods
// sidekick (Schnittstelle: was sidekick gerade tut). Jeder Mod darf die Werte eines anderen lesen (types:3308-3313). Ohne
// Abhängigkeit in plugin.json kennt dieser Vertrag sidekicks eigenen nicht; deshalb steht der Wert hier noch einmal und muss mit
// mods/sidekick/types/index.d.ts übereinstimmen. `validate` meldet ihn als „state of other plugins, not checked“.

declare module 'claude-code' {
  interface PluginState {
    sidekick: {
      buddy: { kind: 'check' | 'stop' | 'handoff' | 'fresh'; at: number } | null
    }
  }
}
