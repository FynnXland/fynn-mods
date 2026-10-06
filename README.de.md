# fynn-mods

**Sechs Mods für Claude Code: ein animiertes Maskottchen, Balken für die Nutzungslimits, ein Sidekick, der vor dem
Senden mitdenkt, Schnellantworten, eine To-do-Liste und ein Kostenbuch.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-v2.1.290_tested-D97757)](https://code.claude.com/docs/de/plugins/mods/overview)
[![Mods](https://img.shields.io/badge/mods-6-555)](#die-mods)
[![Languages](https://img.shields.io/badge/UI-English_%7C_German-555)](#die-mods)

[English](README.md) | **Deutsch**

Mein Alltags-Set an [Claude-Code-Mods](https://code.claude.com/docs/de/plugins/mods/overview), also Plugins, die in
die Oberfläche von Claude Code selbst zeichnen, im Terminal und in der Desktop-App. Sie behalten Nutzungslimits,
Prompt-Cache und Kosten im Blick, prüfen Nachrichten vor dem Senden und reihen die nächsten Aufgaben ein. Die Mods
sind aufeinander abgestimmt, aber jeder ist ein eigenes Plugin und einzeln installierbar.

Dieses Repository ist ein Claude-Code-Plugin-Marketplace mit dem Namen `fynn-mods`.

> **Englisch oder Deutsch.** Alle Mods sprechen standardmäßig Englisch: Knöpfe, Meldungen, Dialoge und die Antworten
> der Modellaufrufe, die manche Mods machen. Jeder Mod hat die Option `language` (`en` oder `de`). Für Deutsch in einer
> Session `/plugin configure <mod>@fynn-mods` aufrufen und `de` wählen. Die Bilder unten zeigen die deutsche Einstellung.
> Die Mod-READMEs unter `mods/` sind englisch.

| Mod | In einem Satz |
|---|---|
| [clawd-buddy](#clawd-buddy) | Animiertes Pixel-Maskottchen über dem Prompt, das auf Claudes Arbeit reagiert |
| [limit-bars](#limit-bars) | Balken für das 5-Stunden- und das Wochenlimit, dazu ein Ring, wie lange der Prompt-Cache noch warm ist |
| [sidekick](#sidekick) | Prüft deine Nachricht vor dem Senden: Kosten bei kaltem Cache, falscher Chat, klarere Fassung, fällige Wartung |
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

- **sidekick** fragt Sonnet 5.5 (Effort `low`) nur, wenn sich eine Prüfung lohnen kann (erste Nachricht eines Chats,
  großer Kontext, kalter Cache): etwa 0,01 $ und 2 Sekunden je Prüfung (API-Wert). Eine Übergabe in einen neuen Chat
  ist ein größerer Sonnet-Aufruf, nur wenn du ihn wählst. In der Stufe `plan` oder `auto` mit worklist prüft er auch
  eine lange Nachricht (ab 800 Zeichen), und das Aufteilen in To-dos oder `/later` kostet etwa 0,01 $ mehr. Die Stufe
  `auto` prüft jede Nachricht ab 300 Zeichen (je etwa 0,01 $); die Stufe `cache` ruft gar kein Modell auf. `/savings`
  stellt beides der gemessenen Ersparnis gegenüber. Abschalten mit `/sidekick off`.
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

Ein optionaler dritter Ring zeigt, wie voll ein Laufwerk ist, aufgeteilt nach Dateiart (Programme, Medien, KI-Modelle,
Code …); `/disk` zeigt die Einzelheiten. Er ist **standardmäßig aus** und läuft bisher nur unter Windows: Zum
Einschalten `storagePath` in `/config` setzen.

**Nach deinem Geschmack:** Jeder Teil (5-Stunden-Balken, Wochen-Balken, Cache-Ring, Speicher-Ring) lässt sich einzeln
ausblenden, mit `/bars show cache off` (wirkt sofort in allen offenen Chats) oder dauerhaft über `showFiveHour`,
`showWeekly`, `showCache` und `showStorage` in `/config`. Ohne Cache-Ring bleibt die Rückfrage vor kaltem Senden an;
die schaltest du mit `/cache warn off` ab.

- **Befehle:** `/cache` (Überblick und Einstellungen), `/handoff [continue|show]` (Übergabe schreiben und in einem
  frischen Chat weitermachen), `/keepwarm [stunden|off]`, `/disk [refresh]`, `/bars [show <teil> on|off | reset]`
- **Rechte kurz:** liest Limits, Kontextgröße und Cache-Werte; kann eine Nachricht für eine Rückfrage anhalten; führt
  `/clear` und `/compact` aus und sendet eine Übergabe nur auf deine Wahl; `$.model.fork` nur, solange `/keepwarm`
  läuft; nur mit gesetztem `storagePath` startet er Windows PowerShell mit zwei festen, nur lesenden Skripten
  (Laufwerksgröße, Größen nach Dateiendung). Keine Dateien, kein Netzwerk, keine Umgebungsvariablen.
- **Details:** [mods/limit-bars](mods/limit-bars/README.md) (englisch)

### sidekick

![sidekick](assets/sidekick.png)

Ein zweiter Blick auf jede Nachricht, kurz bevor sie rausgeht. Zuerst entscheiden feste Regeln, ohne Kosten. Nur wo
sich eine Prüfung lohnen kann (erste Nachricht eines Chats, großer Kontext, kalter Cache), schaut zusätzlich kurz
Sonnet 5.5 drauf. sidekick chattet nie von sich aus: Er bleibt still, setzt eine blaue Hinweiszeile unter deine
Nachricht oder fragt nach.

- **Kalter Cache im großen Chat:** Bevor du einen großen, kalt gewordenen Kontext neu sendest, zeigt er beide Preise,
  etwa „Senden schreibt alles neu (≈ 2,40 $)“ gegenüber „Neuer Chat mit Übergabe (≈ 0,26 $)“. Mit *Neuer Chat mit
  Übergabe* schreibt Sonnet die Übergabe, der Chat wird geleert und deine Nachricht geht im frischen Chat weiter; der
  alte bleibt über `/resume` erreichbar.
- **Ein besserer Weg:** verweist auf einen passenden Skill, schlägt bei neuem Thema einen frischen Chat vor oder bietet
  eine klarere Fassung deiner Nachricht an, die du mit einem Klick sendest.
- **Falscher Chat:** Gehört eine Nachricht klar zu einem anderen Projekt als der Chat, hält sidekick sie an und fragt,
  ob du im falschen Chat bist, bevor sie im falschen Kontext landet (und dort Kosten verursacht).
- **Lange Nachricht, mehrere Aufträge:** Ist worklist installiert, lässt sich eine lange (z. B. diktierte) Nachricht mit
  drei oder mehr getrennten Aufträgen in 3–4 To-dos aufteilen. sidekick zeigt die Schritte und fragt; Sonnet schreibt
  dann die To-dos mit allen Punkten deiner Nachricht, und worklist arbeitet sie nacheinander ab.
- **Fünf Stufen:** `/sidekick off`, `cache` (nur die Kalt-Rückfrage, kein Modellaufruf), `guide` (Begleiter, der
  Standard), `plan` (prüft früher und teilt lange Nachrichten auf) und `auto` (prüft jede Nachricht ab 300 Zeichen und
  sendet eine klarere Fassung oder eine Aufteilung ohne Rückfrage; neuer Chat und falscher Chat fragen weiter). Ein Label
  in der Fußzeile neben der Modellauswahl zeigt die Stufe: 🟢 bereit, 🟠 arbeitet oder fragt, 🔴 aus.
- **`/later <Text>`:** plant Text als 1–4 To-dos mit worklist ein, auch während Claude arbeitet, ohne dass Claude ihn
  liest. In der Desktop-App beendet der Befehl Claudes laufenden Turn.
- **Fällige Wartung:** Einmal pro Chat nennt er höchstens einen fälligen Befehl (`/skill-doctor`, Prompt-Audit, Memory
  aufräumen, `/init`), auf Grundlage einer kostenlosen lokalen Schätzung. Ein Knopf neben der Zeile (auch für einen Befehl,
  den ein Hinweis nennt, z. B. `/handoff`) führt ihn mit einem Klick aus oder reiht einen Skill, wenn worklist installiert
  ist, als To-do ein.
- **Nachprüfbare Ersparnis:** `/savings` zeigt, was sidekick gekostet und was er messbar gespart hat;
  `/savings detail` ergänzt Rechenweg, Modellvergleich und Verlauf je Tag.

Scheitert eine Prüfung oder dauert sie zu lange, geht deine Nachricht unverändert raus.

- **Befehle:** `/sidekick` (Status und Einstellungen), `/sidekick off|cache|guide|plan|auto|on`, `/sidekick long 800|off`,
  `/sidekick hints …`, `/later <Text>`,
  `/savings [today|week|all]`, `/savings detail`
- **Rechte kurz:** liest deine Nachricht vor dem Senden; hält sie nur an oder ersetzt sie nur nach deiner Wahl im
  Dialog (in der Stufe `auto` auch ohne Rückfrage: eine Fassung oder eine Aufteilung); Sonnet über `$.model.complete` mit einer laufenden Kurzfassung und deinen letzten 3 Nachrichten, nie dem
  ganzen Verlauf; auf Knopfdruck führt er den Befehl der Zeile aus (Befehle aus Plugins und eigene, `/skill-doctor`, `/init`;
  nie MCP-Prompts, `/clear`, `/exit`, `/quit`, `/login`, `/logout`, `/rewind`) oder ruft `/todo` von worklist auf (auch
  für die To-dos einer Aufteilung oder von `/later`); in der Stufe `auto` sendet er eine umformulierte Nachricht ohne
  Rückfrage in deinem Namen, nur wenn du diese Stufe gewählt hast; zeichnet sein Label in die Fußzeile; und
  füllt das Eingabefeld, wenn der Befehl abgelehnt wird;
  liest den Pfad der Projektwurzel; teilt clawd-buddy über `$.state` nur die Art des Ereignisses und die Uhrzeit mit,
  nie deine Nachricht. Keine Dateien, Umgebung, kein Netzwerk, keine Einstellungen.
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
wird das laufende To-do abgehakt und das nächste startet von selbst; solange Subagenten oder Hintergrundarbeit laufen,
wartet sie. Die Liste pausiert nie von selbst: Ist Claude nicht sicher fertig (Rückfrage, Unterbrechung, Fehler,
offener Plan), hält sie bei diesem To-do an, nennt den Grund und bietet **Fortsetzen**, **Abhaken** und
**Überspringen**; auch deine Antwort auf Claudes Rückfrage im Chat setzt es fort. Einreihen bei freiem Claude startet
die Liste auch nach einer Rückfrage. Der Verlauf gilt pro Projekt.

- **Befehle:** `/todo <aufgabe>`, `/todos` (Seitenleiste), `/todos pause|resume|done|skip|retry|clear|history|status|close`
- **Rechte kurz:** sendet das nächste To-do (oder die Fortsetzung eines angehaltenen) nur nach bestandener Prüfung
  oder auf deinen Klick als deine Nachricht;
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
- **sidekick gibt Aufgaben an worklist.** Sind beide installiert, reiht der Knopf neben einem Wartungshinweis den
  Befehl als To-do ein; worklist sendet ihn, sobald die laufende Aufgabe fertig ist. Genauso lässt sich eine lange
  Nachricht mit mehreren Aufträgen in To-dos aufteilen. Ohne worklist bietet sidekick das nie an und prüft lange
  Nachrichten dafür auch nicht.
- **Clawd spielt sidekick mit.** Sind beide installiert, hält Clawd die Lupe ans Eingabefeld, während sidekick prüft,
  zeigt bei einer Rückfrage ein Stoppschild und schreibt einen Brief, wenn sidekick einen neuen Chat mit Übergabe
  startet.
- **cost-ledger bucht die anderen.** Modellaufrufe von sidekick, worklist, quick-replies und limit-bars stehen nicht in
  `/cost`; cost-ledger bucht sie getrennt, so zeigt `/ledger`, was jeder Mod kostet.

## Rechte und Vertrauen

Ein Mod ist Code, der in Claude Code mit deinen Rechten läuft. Jeder Mod hier legt offen, an welche Ereignisse er sich
hängt und welche API-Aufrufe er macht; `claude plugin validate mods/<mod>` zeigt die genaue Liste, und jede README
erklärt jeden Eintrag in Klartext. Keiner dieser Mods liest oder speichert Anmeldedaten oder Tokens, und keiner fasst
Dateien außerhalb seines eigenen Plugin-Speichers an.

## Feedback

Fehlerberichte und Ideen gern als [Issue](https://github.com/FynnXland/fynn-mods/issues), gern auch auf Deutsch.
Bitte die Version des Mods (`/plugin`), `claude --version` und Terminal oder Desktop-App angeben.

## Hinweis

Das ist ein inoffizielles Hobbyprojekt, nicht von Anthropic erstellt, unterstützt oder geprüft. clawd-buddy ist eine
Fan-Hommage an Clawd, das Maskottchen von Claude Code; die Pixel sind von Hand gezeichnet. Hat Anthropic Einwände, wird
der Mod entfernt.

## Lizenz

[MIT-Lizenz](LICENSE), Copyright (c) 2026 Fynn Hansen. Rechtlich maßgeblich ist der englische Lizenztext.

limit-bars ist nach Cache Keeper von Nate Herk gebaut (MIT); sidekick übernimmt die Cache-Logik von limit-bars. Siehe
die `THIRD-PARTY-NOTICES.md` in beiden Mods.
