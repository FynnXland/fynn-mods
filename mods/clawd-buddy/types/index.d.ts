// Vertrag von clawd-buddy für `$.state`. clawd-buddy liest den Wert `sidekick.buddy` des Mods sidekick (Schnittstelle: was sidekick
// gerade tut), seit 0.9.0 `tune-strip.playing` des Mods tune-strip (läuft gerade Musik? nur `{ playing }`, kein Titel; mods/tune-strip/types)
// und schreibt seit 0.8.0 `clawd-buddy.band`: die Breite seines Platzes 30 im Band in Pixeln im Desktop (`null`, wenn Clawd
// aus ist oder nicht im Desktop läuft), für tune-strip (docs/BAND.md „Platzbreite“; tune-strip deklariert denselben Wert). Jeder Mod darf
// die Werte eines anderen lesen (types:3308-3313). Ohne Abhängigkeit in plugin.json kennt dieser Vertrag die der anderen nicht;
// deshalb stehen ihre Werte hier noch einmal und müssen mit mods/sidekick/types/index.d.ts und mods/tune-strip/types/index.d.ts
// übereinstimmen. `validate` meldet sie als „state of other plugins, not checked“.

declare module 'claude-code' {
  interface PluginState {
    sidekick: {
      buddy: { kind: 'check' | 'stop' | 'handoff' | 'fresh'; at: number } | null
    }
    'tune-strip': {
      playing: { playing: boolean } | null
    }
    'clawd-buddy': {
      band: { width: number } | null
    }
  }
}
