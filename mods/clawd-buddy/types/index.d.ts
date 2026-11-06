// Vertrag von clawd-buddy für `$.state`. clawd-buddy liest den Wert `sidekick.buddy` des Mods sidekick (Schnittstelle: was sidekick
// gerade tut; seit 0.13.0 auch `sidekick.status`), seit 0.9.0 `tune-strip.playing` des Mods tune-strip (läuft gerade Musik? nur `{ playing }`, kein Titel; mods/tune-strip/types),
// seit 0.11.0 `tune-strip.beat` (Takt und Gruppe des Songs, kein Titel)
// und schreibt seit 0.8.0 `clawd-buddy.band`: die Breite seines Platzes 30 im Band in Pixeln im Desktop (`null`, wenn Clawd
// aus ist oder nicht im Desktop läuft), für tune-strip (docs/BAND.md „Platzbreite“; tune-strip deklariert denselben Wert). Jeder Mod darf
// die Werte eines anderen lesen (types:3308-3313). Ohne Abhängigkeit in plugin.json kennt dieser Vertrag die der anderen nicht;
// deshalb stehen ihre Werte hier noch einmal und müssen mit mods/sidekick/types/index.d.ts und mods/tune-strip/types/index.d.ts
// übereinstimmen. `validate` meldet sie als „state of other plugins, not checked“.

declare module 'claude-code' {
  interface PluginState {
    // 0.13.0 (SPEC „Ausbau 0.13.0“ Teil C): neue Arten `hint`/`upkeep`, Grund `why` einer Rückfrage, `status` (gelesen werden nur `level`
    // und `cold`). clawd-buddy deklariert diese Fassung schon jetzt; sidekick zieht mit 0.20.0 nach, bis dahin weichen beide ab.
    sidekick: {
      buddy: { kind: 'check' | 'stop' | 'handoff' | 'fresh' | 'hint' | 'upkeep'; at: number; why?: 'cold' | 'wrong' | 'model' | 'rewrite' | 'topic' } | null
      status: { level: 'off' | 'cache' | 'guide'; busy: boolean; tip?: string; cold?: true } | null
    }
    'tune-strip': {
      playing: { playing: boolean } | null
      // 0.11.0: Takt des laufenden Songs, nur aus dem Klang (lokal ausgewertet). `bpm` 60–150 (halbes/doppeltes Tempo schon gefaltet),
      // `at` Unix-ms eines Schlags, wie er zu hören ist (Versatz eingerechnet), `sure` ob Tempo und Schlag tragen, `group` die Gruppe
      // des Songs oder `null`, solange sie offen ist. `null` ohne Takt (Pause, aus, kein Helfer, Stille). Kein Titel, kein Interpret.
      beat: { bpm: number; at: number; sure: boolean; group: 'calm' | 'groove' | 'hard' | 'sad' | null } | null
    }
    'clawd-buddy': {
      band: { width: number } | null
    }
  }
}
