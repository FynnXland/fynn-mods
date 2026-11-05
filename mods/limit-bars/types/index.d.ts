// $.state-Werte von limit-bars (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur limit-bars schreibt (types:3308-3313).
// `band` (seit 0.9.0) meldet die Breite des Platzes 10 im Band an spotify (docs/BAND.md „Platzbreite“): `width` in Pixeln im
// Desktop, `null`, wenn limit-bars nichts zeichnet. Geschrieben wird beim Sitzungsstart und bei jeder Änderung der Anzeige,
// nie beim Zeichnen. spotify deklariert denselben Wert in seinem eigenen Vertrag (mods/spotify/types/index.d.ts); beide Fassungen
// müssen gleich bleiben.
// Seit 0.12.0 liest limit-bars `cost-ledger.here` für den Kostenring (SPEC Ausbau 0.12.0). Ohne Abhängigkeit in plugin.json kennt
// dieser Vertrag den von cost-ledger nicht; deshalb steht der Wert hier noch einmal und muss mit mods/cost-ledger/types/index.d.ts
// übereinstimmen. `validate` meldet ihn als „state of other plugins, not checked“.
// Seit 0.14.0 liest limit-bars auch `sidekick.status` (Stufe von sidekick): Fragt sidekick selbst vor kaltem Senden (`cache`,
// `guide`), schweigt die Cache-Wache von limit-bars. Kopie aus mods/sidekick/types/index.d.ts, muss gleich bleiben.

declare module 'claude-code' {
  interface PluginState {
    'limit-bars': {
      band: { width: number } | null
    }
    sidekick: {
      buddy: { kind: 'check' | 'stop' | 'handoff' | 'fresh'; at: number } | null
      status: { level: 'off' | 'cache' | 'guide'; busy: boolean; tip?: string } | null
    }
    'cost-ledger': {
      here: {
        chatUsd: number
        projectUsd: number | null
        project: string | null
        since: string
        devices: number
      } | null
    }
  }
}
