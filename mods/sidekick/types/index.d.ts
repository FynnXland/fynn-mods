// $.state-Werte von sidekick (docs/raw/en/interface.md:714-769). Jeder Mod darf sie lesen, nur sidekick schreibt (types:3308-3313).
// `buddy` ist die Schnittstelle zu clawd-buddy: was sidekick gerade tut, damit Clawd es zeigt. clawd-buddy deklariert denselben
// Wert in seinem eigenen Vertrag (mods/clawd-buddy/types/index.d.ts); dort genügt eine Teilmenge, die gelesenen Felder müssen gleich bleiben.
//   check   = prüft die Nachricht mit dem Modell
//   stop    = hält die Nachricht an, der Dialog ist offen; `why` (Ausbau 0.20.0) nennt den Grund:
//             cold = Kalt-Cache-Frage, wrong = falscher Chat, model = Modell-Tipp, rewrite = Fassung angeboten,
//             topic = neuer Chat zu einem neuen Thema. Ohne `why`: Korrektur-Schleife und die Frage nach Zusammenfassungen
//   handoff = baut einen neuen Chat (Übergabe schreiben, leeren)
//   fresh   = der neue Chat ist eben gestartet (`at` zählt; Clawd zeigt es nur kurz danach)
//   hint    = eine Hinweiszeile der Prüfung steht unter der Nachricht (0.20.0; nach 4 s wieder `null`)
//   upkeep  = ein Wartungshinweis steht unter der Nachricht (0.20.0; nach 5 s wieder `null`)
// `at` = Zeitpunkt (ms, $.clock.now). /clear setzt den Wert zurück (undefined).
//
// `status` (Nachtrag 0.10.0) speist die Anzeige in der Fußzeile (SessionMode): die eingestellte Stufe und ob sidekick gerade
// arbeitet (Prüfung, offene Rückfrage oder Übergabe). Der Zeichen-Hook liest ihn und wird so bei jedem Schreiben neu
// gezeichnet, ohne $.ui.invalidate. Keine Texte aus dem Chat. `tip` (Ausbau 0.18.0): Kurzname des Zielmodells („Sonnet“, „Haiku“),
// solange sidekick in diesem Chat nach einem angenommenen Modell-Tipp umstellt; fehlt sonst. `cold` (Ausbau 0.20.0): `true`, solange
// die Cache-Schätzung dieses Chats abgelaufen ist (letzte Anfrage + TTL), nur auf den Stufen cache und guide; fehlt sonst.

declare module 'claude-code' {
  interface PluginState {
    sidekick: {
      buddy: { kind: 'check' | 'stop' | 'handoff' | 'fresh' | 'hint' | 'upkeep'; at: number; why?: 'cold' | 'wrong' | 'model' | 'rewrite' | 'topic' } | null
      status: { level: 'off' | 'cache' | 'guide'; busy: boolean; tip?: string; cold?: true } | null
      // Nachtrag 0.21.0: Namen der gespeicherten Prompts mit Knopf (höchstens 4, Reihenfolge des Speicherns). Nur sidekick liest ihn;
      // der Knopf-Baum wird so nur neu gezeichnet, wenn sich die Liste ändert, ohne $.ui.invalidate. Keine Prompt-Texte.
      // Ausbau 0.24.0: `later` = Knopf „Danach“ während einer Runde (`on`), nach einem Klick `armed`; fehlt sonst. Keine Texte
      prompts: { buttons: string[]; later?: 'on' | 'armed' } | null
    }
  }
}
