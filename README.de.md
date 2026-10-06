# fynn-mods

[English](README.md) | **Deutsch**

Mein Alltags-Set an [Claude-Code-Mods](https://code.claude.com/docs/de/plugins/mods/overview): ein animiertes
Maskottchen, Balken für die Nutzungslimits, ein Sidekick, der vor dem Senden mitdenkt, Schnellantworten, eine
To-do-Liste und ein Kostenbuch. Die Mods sind aufeinander abgestimmt, aber jeder ist ein eigenes Plugin und einzeln
installierbar.

Dieses Repository ist ein Claude-Code-Plugin-Marketplace mit dem Namen `fynn-mods`.

> **Englisch oder Deutsch.** Alle Mods sprechen standardmäßig Englisch: Knöpfe, Meldungen, Dialoge und die Antworten
> der Modellaufrufe, die manche Mods machen. Jeder Mod hat die Option `language` (`en` oder `de`). Für Deutsch in einer
> Session `/plugin configure <mod>@fynn-mods` aufrufen und `de` wählen. Die Bilder unten zeigen die deutsche Einstellung.
> Die Mod-READMEs unter `mods/` sind englisch.

| Mod | In einem Satz |
|---|---|
| [clawd-buddy](#clawd-buddy) | Animiertes Pixel-Maskottchen über dem Prompt, das auf Claudes Arbeit reagiert |
| [limit-bars](#limit-bars) | Balken für das 5-Stunden- und das Wochenlimit, dazu ein Ring, wie lange der Prompt-Cache noch warm ist |
| [sidekick](#sidekick) | Prüft deine Nachricht vor dem Senden und schlägt einen besseren Weg vor, wenn es klar einen gibt |
| [quick-replies](#quick-replies) | Der Vorschlag von Claude Code für die nächste Nachricht als Knopf |
| [worklist](#worklist) | To-do-Seitenleiste, die Claude eine Aufgabe nach der anderen gibt, aber nur, wenn es sicher fertig ist |
| [cost-ledger](#cost-ledger) | Kostenbuch über alle Chats, nach Tag, Projekt, Chat und Modell |

## Voraussetzungen

- Claude Code mit Mods. Mods brauchen **v2.1.287 oder neuer**; dieses Set ist mit **v2.1.290** getestet. Prüfen mit
  `claude --version`.
- Läuft im Terminal und im Code-Tab der Claude-Desktop-App. In `claude -p`, im Agent SDK, in VS Code und mobil zeichnen
  die meisten Mods nichts; Details in der README des jeweiligen Mods.
- Die Mods-API kann sich zwischen Claude-Code-Versionen ändern. Funktioniert ein Mod nach einem Update nicht mehr,
  bitte ein Issue anlegen.

## Installation

Einmal den Marketplace hinzufügen:

```bash
claude plugin marketplace add FynnXland/fynn-mods
```

Dann die gewünschten Mods einzeln installieren:

```bash
claude plugin install clawd-buddy@fynn-mods
claude plugin install limit-bars@fynn-mods
claude plugin install sidekick@fynn-mods
claude plugin install quick-replies@fynn-mods
claude plugin install worklist@fynn-mods
claude plugin install cost-ledger@fynn-mods
```

In einer Session geht dasselbe mit `/plugin marketplace add FynnXland/fynn-mods` und `/plugin install <mod>@fynn-mods`.
Ein neu installierter Mod lädt in der nächsten Session oder nach `/reload-plugins`. `/plugin` zeigt ihn als
`mod active`.

**Updates:** Jede veröffentlichte Änderung erhöht die Version des Mods. Auto-Update ist für Marketplaces von Dritten
standardmäßig aus. Entweder in `/plugin` unter **Marketplaces** für `fynn-mods` einschalten oder von Hand
aktualisieren:

```bash
claude plugin marketplace update fynn-mods
claude plugin update <mod>@fynn-mods
```

**Entfernen:** in `/plugin` unter **Installed** abschalten oder `claude plugin uninstall <mod>@fynn-mods`.

**Ohne Installation ausprobieren:** das Repo klonen und eine Session mit
`claude --plugin-dir <pfad-zum-klon>/mods/<mod>` starten.

## Kosten

Drei Mods lösen Modellaufrufe **über dein Konto** aus (im Abo zählen sie auf deine Nutzungslimits):

- **sidekick** fragt Haiku, wenn sich eine Prüfung lohnen kann (erste Nachricht eines Chats, großer Kontext, kalter
  Cache): etwa 0,005 $ je Prüfung (API-Wert). Abschalten mit `/sidekick off`.
- **worklist** fragt Haiku nur, wenn die Regeln nicht sicher erkennen, ob Claude fertig ist: etwa 0,0005 $ je Fall.
  Abschalten mit der Option `haiku` in `/config`; die Liste hält dann in diesen Fällen an.
- **quick-replies** forkt die Session nach jeder Antwort **nur mit `/replies more on`** (standardmäßig aus): etwa so
  viel wie eine kurze Antwort, großteils aus dem Prompt-Cache.

limit-bars macht nur einen Aufruf, solange `/keepwarm` läuft (standardmäßig aus). clawd-buddy und cost-ledger machen
keine Modellaufrufe. cost-ledger bucht die Aufrufe der anderen Mods, so siehst du, was sie kosten.

## Die Mods

### clawd-buddy

![clawd-buddy](assets/clawd-buddy.gif)

Clawd, eine kleine Pixel-Krabbe, sitzt auf der Eingabebox und reagiert auf das, was passiert: Er liest mit, tippt auf
dem Laptop, während Claude Dateien bearbeitet, wartet mit der Sanduhr bei langen Tool-Läufen, jubelt über fertige
Turns und wird sichtbar grantig, wenn sich Fehler häufen. Im Leerlauf vertreibt er sich je nach Tageszeit die Zeit,
nachts schläft er ein. Subagenten erscheinen als kleine Helfer neben ihm.

- **Befehle:** `/clawd` (Status), `/clawd on|off`, `/clawd list`, `/clawd demo <name>`, `/clawd nap`, `/clawd boop`
- **Rechte kurz:** beobachtet nur Ereignisse und gibt sie unverändert weiter; merkt sich an/aus und ein paar Zähler im
  eigenen Plugin-Speicher. Keine Dateien, Prozesse, kein Netzwerk, keine Modellaufrufe.
- **Details:** [mods/clawd-buddy](mods/clawd-buddy/README.md) (englisch)

### limit-bars

![limit-bars](assets/limit-bars.svg)

Zwei schmale Balken links neben Clawd zeigen, wie viel vom 5-Stunden- und vom Wochenlimit verbraucht ist und wann sie
zurückgesetzt werden. Ein Ring daneben zeigt, wie lange der Prompt-Cache dieses Chats noch warm ist, dazu die
Kontextgröße. Die Cache-Wache fragt nach, bevor du in einen großen Chat mit kaltem Cache sendest und damit den ganzen
Kontext neu schreiben würdest.

- **Befehle:** `/cache` (Überblick und Einstellungen), `/handoff [continue|show]` (Übergabe schreiben und in einem
  frischen Chat weitermachen), `/keepwarm [stunden|off]`
- **Rechte kurz:** liest Limits, Kontextgröße und Cache-Werte; kann eine Nachricht für eine Rückfrage anhalten; führt
  `/clear` und `/compact` aus und sendet eine Übergabe nur auf deine Wahl; `$.model.fork` nur, solange `/keepwarm`
  läuft. Keine Dateien, Prozesse, kein Netzwerk, keine Umgebungsvariablen.
- **Details:** [mods/limit-bars](mods/limit-bars/README.md) (englisch)

### sidekick

![sidekick](assets/sidekick.png)

Schaut sich deine Nachricht kurz vor dem Senden an: zuerst mit festen Regeln und nur dort, wo es sich lohnen kann, kurz
mit Haiku. Gibt es einen klar besseren Weg, etwa einen frischen Chat mit Übergabe statt teurem kaltem Cache, einen
passenden Skill oder eine klarere Fassung, steht ein Hinweis unter deiner Nachricht oder sidekick fragt nach. Einmal
pro Chat nennt er außerdem fällige Wartung (`/skill-doctor`, Prompt-Audit, Memory aufräumen, `/init`).

- **Befehle:** `/sidekick` (Status und Einstellungen), `/sidekick on|off`, `/savings [today|week|all]`
- **Rechte kurz:** liest deine Nachricht vor dem Senden; hält sie nur an oder ersetzt sie nur nach deiner Wahl im
  Dialog; Haiku über `$.model.complete` mit einer Kurzfassung und deinen letzten Nachrichten, nie dem ganzen Verlauf;
  liest den Pfad der Projektwurzel. Keine Dateien, Umgebung, kein Netzwerk, keine Einstellungen.
- **Details:** [mods/sidekick](mods/sidekick/README.md) (englisch)

### quick-replies

![quick-replies](assets/quick-replies.png)

Claude Code schlägt oft deine nächste Nachricht als grauen Text im Prompt vor. quick-replies macht daraus einen Knopf
in einer eigenen Pille über Clawd. Ein Klick oder die Taste `1` im leeren Prompt schickt ihn als deine Nachricht ab.
Mit `/replies more on` kommen aus einem Fork der Session bis zu drei weitere Vorschläge auf `2`–`4` dazu.

- **Befehle:** `/replies` (Status), `/replies on|off`, `/replies more on|off`
- **Rechte kurz:** liest den Vorschlag von Claude Code; sendet einen Vorschlag nur auf Klick oder Taste als deine
  Nachricht, nie automatisch; `$.model.fork` nur mit `more` an. Keine Dateien, Prozesse, kein Netzwerk.
- **Details:** [mods/quick-replies](mods/quick-replies/README.md) (englisch)

### worklist

![worklist](assets/worklist.png)

Eine To-do-Seitenleiste neben dem Chat. Aufgaben einreihen, auch während Claude arbeitet. Ist Claude **sicher** fertig,
wird das laufende To-do abgehakt und das nächste gesendet. Wenn nicht (Rückfrage, Fehler, laufende Subagenten,
Hintergrundarbeit, offener Plan), hält die Liste an, nennt den Grund und bietet Knöpfe zum Weitermachen, Abhaken oder
erneut Senden. Der Verlauf gilt pro Projekt.

- **Befehle:** `/todo <aufgabe>`, `/todos` (Seitenleiste), `/todos pause|resume|done|skip|clear|history|status|close`
- **Rechte kurz:** sendet das nächste To-do nur nach bestandener Prüfung oder auf deinen Klick als deine Nachricht;
  Haiku für unklare Fälle (abschaltbar); liest, ob noch Subagenten laufen. Im Chat zeigt es gesendete To-dos als orange
  Zeile und blendet ein alleinstehendes „Fertig.“ / "Done." am Ende von Antworten aus (nur Anzeige). Keine Dateien,
  Prozesse, kein Netzwerk.
- **Details:** [mods/worklist](mods/worklist/README.md) (englisch)

### cost-ledger

![cost-ledger](assets/cost-ledger.png)

Nach jeder Antwort bucht cost-ledger, was der Chat bisher gekostet hat (derselbe Wert wie `/cost`), die Tokens je
Modell und die Modellaufrufe anderer Mods. `/ledger` zeigt heute, 7 und 30 Tage und gesamt, einen Verlauf nach Modell,
deine Projekte und die teuersten Chats, gezeichnet im Stil von Claude Code.

- **Befehle:** `/ledger`, `/ledger weeks`, `/ledger chats|projects|models [7|30|all]`, `/ledger reset`, `/ledger help`
- **Rechte kurz:** liest Kosten und Verbrauch der Session; beobachtet die Modellaufrufe anderer Mods und gibt sie
  unverändert weiter; speichert Projektname, Git-Remote als `host/owner/repo` und die ersten 50 Zeichen der ersten
  Nachricht eines Chats im lokalen Plugin-Speicher. Keine Modellaufrufe, keine Dateien, Prozesse, kein Netzwerk.
- **Details:** [mods/cost-ledger](mods/cost-ledger/README.md) (englisch)

## Zusammenspiel

- **Ein Band über dem Prompt.** clawd-buddy, limit-bars, quick-replies und sidekick zeichnen alle ins Band über dem
  Prompt und folgen einer kleinen gemeinsamen Absprache: Limit-Balken und Cache-Ring stehen links neben Clawd, die
  quick-replies-Pille darüber, und die Fortschrittsbox von sidekick erscheint dort nur, während er einen neuen Chat
  startet. Jeder Mod funktioniert auch allein.
- **limit-bars und sidekick warnen beide vor kaltem Senden.** Nutzt du beide, schalte die Warnung von limit-bars
  einmal mit `/cache warn off` ab, damit nicht zwei Dialoge hintereinander kommen; die Rückfrage von sidekick ersetzt
  sie.
- **cost-ledger bucht die anderen.** Modellaufrufe von sidekick, worklist, quick-replies und limit-bars stehen nicht in
  `/cost`; cost-ledger bucht sie getrennt, so zeigt `/ledger`, was jeder Mod kostet.

## Rechte und Vertrauen

Ein Mod ist Code, der in Claude Code mit deinen Rechten läuft. Jeder Mod hier legt offen, an welche Ereignisse er sich
hängt und welche API-Aufrufe er macht; `claude plugin validate mods/<mod>` zeigt die genaue Liste, und jede README
erklärt jeden Eintrag in Klartext. Keiner dieser Mods liest oder speichert Anmeldedaten oder Tokens, und keiner fasst
Dateien außerhalb seines eigenen Plugin-Speichers an.

## Hinweis

Das ist ein inoffizielles Hobbyprojekt, nicht von Anthropic erstellt, unterstützt oder geprüft. clawd-buddy ist eine
Fan-Hommage an Clawd, das Maskottchen von Claude Code; die Pixel sind von Hand gezeichnet. Hat Anthropic Einwände, wird
der Mod entfernt.

## Lizenz

[MIT-Lizenz](LICENSE), Copyright (c) 2026 Fynn Hansen. Rechtlich maßgeblich ist der englische Lizenztext.

limit-bars ist nach Cache Keeper von Nate Herk gebaut (MIT); sidekick übernimmt die Cache-Logik von limit-bars. Siehe
die `THIRD-PARTY-NOTICES.md` in beiden Mods.
