// $.state-Werte von sidekick (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur sidekick schreibt (types:3308-3313).
// `buddy` ist die Schnittstelle zu clawd-buddy: was sidekick gerade tut, damit Clawd es zeigt. clawd-buddy deklariert denselben
// Wert in seinem eigenen Vertrag (mods/clawd-buddy/types/index.d.ts); beide Fassungen müssen gleich bleiben.
//   check   = prüft die Nachricht mit dem Modell
//   stop    = hält die Nachricht an, der Dialog ist offen
//   handoff = baut einen neuen Chat (Übergabe schreiben, leeren)
//   fresh   = der neue Chat ist eben gestartet (`at` zählt; Clawd zeigt es nur kurz danach)
// `at` = Zeitpunkt (ms, $.clock.now). /clear setzt den Wert zurück (undefined).
//
// `status` (Nachtrag 0.10.0) speist die Anzeige in der Fußzeile (SessionMode): die eingestellte Stufe und ob sidekick gerade
// arbeitet (Prüfung, offene Rückfrage oder Übergabe). Der Zeichen-Hook liest ihn und wird so bei jedem Schreiben neu
// gezeichnet, ohne $.ui.invalidate. Keine Texte aus dem Chat. `tip` (Ausbau 0.18.0): Kurzname des Zielmodells („Sonnet“, „Haiku“),
// solange sidekick in diesem Chat nach einem angenommenen Modell-Tipp umstellt; fehlt sonst.

declare module 'claude-code' {
  interface PluginState {
    sidekick: {
      buddy: { kind: 'check' | 'stop' | 'handoff' | 'fresh'; at: number } | null
      status: { level: 'off' | 'cache' | 'guide'; busy: boolean; tip?: string } | null
    }
  }
}
