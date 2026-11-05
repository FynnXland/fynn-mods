// $.state-Werte von cost-ledger (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur cost-ledger schreibt (types:3530-3563).
// `here` (seit 0.10.0, SPEC Nachtrag 0.10.0) liefert limit-bars die Zahlen für den Kostenring im Band, dieselben wie `/ledger here all`:
// `chatUsd` dieser Chat samt seiner Mod-Aufrufe, `projectUsd` dieses Projekt seit Beginn der Aufzeichnung samt Sync-Datensätzen
// (`null` = Projekt unbekannt, z. B. Skript-Lauf), `project` nur der letzte Ordnername (wie das Sync-Feld `proj`, nichts sonst vom
// Pfad), `since` erster Tag der Aufzeichnung (YYYY-MM-DD), `devices` 1 = nur dieses Gerät, 2+ = mit Sync. `null`, wenn cost-ledger
// nichts weiß (z. B. `-p` ohne Session-ID). Geschrieben nach jeder Buchung und beim Start, nie beim Zeichnen.
// limit-bars deklariert denselben Wert in seinem eigenen Vertrag (mods/limit-bars/types/index.d.ts); beide Fassungen müssen gleich bleiben.

declare module 'claude-code' {
  interface PluginState {
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
