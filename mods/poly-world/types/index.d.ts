// Vertrag von poly-world für `$.state`. poly-world schreibt keine eigenen Werte, es liest nur zwei fremde:
// - `tune-strip.playing`: läuft gerade Musik? `{ playing }`, `null` ohne Spotify-Sitzung (Vertrag aus mods/tune-strip/types/index.d.ts).
// - `clawd-buddy.mood`: wie müde Clawd ist, `tired` 0–1, `null`, wenn clawd-buddy nichts meldet. Gibt es noch nicht; kommt als kleiner
//   clawd-buddy-Patch (mods/poly-world/SPEC.md „Offene Punkte“). Bis dahin leer, dann Fensterlicht nach Uhrzeit.
// Jeder Mod darf die Werte eines anderen lesen (types@2.1.325:3636-3640). Ohne Abhängigkeit in plugin.json kennt dieser Vertrag die
// Verträge der anderen nicht; deshalb stehen die Werte hier noch einmal und müssen mit denen der Besitzer übereinstimmen.
// `validate` meldet sie als „state of other plugins, not checked“.

declare module 'claude-code' {
  interface PluginState {
    'tune-strip': {
      playing: { playing: boolean } | null
    }
    'clawd-buddy': {
      mood: { tired: number } | null
    }
  }
}
