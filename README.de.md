# fynn-mods

**Sechs Mods für Claude Code: ein animiertes Maskottchen, Balken für die Nutzungslimits, ein Sidekick, der vor dem
Senden mitdenkt, Schnellantworten, eine Musikleiste für Spotify (Windows) und ein Kostenbuch.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Checks](https://github.com/FynnXland/fynn-mods/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/FynnXland/fynn-mods/actions/workflows/checks.yml)
[![Claude Code](https://img.shields.io/badge/Claude_Code-v2.1.319_tested-D97757)](https://code.claude.com/docs/de/plugins/mods/overview)
[![Mods](https://img.shields.io/badge/mods-6-555)](#die-mods)
[![Languages](https://img.shields.io/badge/UI-English_%7C_German-555)](#die-mods)

[Installation](#installation) · [Die Mods](#die-mods) · [Fehlerbehebung](#fehlerbehebung) · [Website](https://fynn.land/fynn-mods/) · [English](README.md) · **Deutsch**

<p align="center">
  <img src="assets/hero.gif" width="790" alt="Der Prompt von Claude Code in der Desktop-App mit fünf Mods: oben eine Musik-Leiste mit einem erfundenen Titel, Cover, Positionsbalken und Knöpfen; darunter vier Antwortvorschläge mit den Nummern 1 bis 4, die Balken für das 5-Stunden- und das Wochenlimit, der Cache-Ring und der Speicher-Ring und Clawd, die Pixel-Krabbe, die auf dem Laptop tippt und vor Freude springt; in der Fußzeile die sidekick-Stufe Guide.">
  <br><i>tune-strip, quick-replies, limit-bars und clawd-buddy teilen sich das Band über dem Prompt; sidekick zeigt seine
  Stufe in der Fußzeile. Nachgebaut mit erfundenen Daten. Vier Vorschläge gibt es mit <code>/replies more on</code>; der
  Speicher-Ring ist optional.</i>
</p>

Mein Alltags-Set an [Claude-Code-Mods](https://code.claude.com/docs/de/plugins/mods/overview), also Plugins, die in
die Oberfläche von Claude Code selbst zeichnen, im Terminal und in der Desktop-App. Sie behalten Nutzungslimits,
Prompt-Cache und Kosten im Blick, prüfen Nachrichten vor dem Senden und holen deinen Musik-Player über den Prompt. Die
Mods sind aufeinander abgestimmt, aber jeder ist ein eigenes Plugin und einzeln installierbar.

Dieses Repository ist ein Claude-Code-Plugin-Marketplace mit dem Namen `fynn-mods`.

> **Englisch oder Deutsch.** Alle Mods sprechen standardmäßig Englisch: Knöpfe, Meldungen, Dialoge und die Antworten
> der Modellaufrufe, die manche Mods machen. Jeder Mod hat die Option `language` (`en` oder `de`). `/clawd language de`
> (oder dasselbe mit `/bars`, `/sidekick`, `/replies`, `/tune`, `/ledger`) stellt alle installierten fynn-mods auf
> einmal um; für einen einzelnen Mod `/plugin configure <mod>@fynn-mods`. Die Bilder unten zeigen die englische
> Standardeinstellung. Sie sind aus dem Zeichencode der Mods nachgebaut, mit einem erfundenen Beispielprojekt: keine
> echten Chats, Pfade oder Kosten.
> Die Mod-READMEs unter `mods/` sind englisch.

| Mod | In einem Satz |
|---|---|
| [clawd-buddy](#clawd-buddy) | Animiertes Pixel-Maskottchen über dem Prompt, das auf Claudes Arbeit reagiert |
| [limit-bars](#limit-bars) | Balken für das 5-Stunden- und das Wochenlimit, ein Ring, wie lange der Prompt-Cache noch warm ist, optional Kostenring und Systemwerte |
| [sidekick](#sidekick) | Prüft deine Nachricht vor dem Senden: Kosten bei kaltem Cache, falscher Chat, klarere Fassung, fällige Wartung; dazu gespeicherte Prompts, eine Nachrichten-Warteschlange, Übergaben und Skill-Vorschläge |
| [quick-replies](#quick-replies) | Der Vorschlag von Claude Code für die nächste Nachricht als Knopf |
| [tune-strip](#tune-strip) | Musikleiste für Spotify über dem Prompt mit Cover, Position und Knöpfen (nur Windows) |
| [cost-ledger](#cost-ledger) | Kostenbuch über alle Chats, nach Tag, Projekt, Chat und Modell |

**Hilfe in jedem Mod:** `/<befehl> help` (`/clawd`, `/bars`, `/sidekick`, `/replies`, `/tune`, `/ledger`) zeichnet
eine Tabelle mit allen Befehlen, was gerade an oder aus ist und wie man es umschaltet, und den Einstellungen des Mods
mit ihren Werten. In `claude -p` und VS Code kommt dasselbe als kurzer Text.

**Einstellungen:** Alle Einstellungen aller Mods stehen auf der Plugin-Einstellungsseite von Claude Code (Desktop-App:
Einstellungen → Plugins → der Mod → Einstellungen; Terminal: `/plugin configure <mod>@fynn-mods`). Die
Slash-Befehle ändern dieselben Einstellungen, und von früheren Versionen gespeicherte Werte ziehen einmalig um.

## Voraussetzungen

- Claude Code **v2.1.309 oder neuer** (ältere Versionen laden diese Mods nicht); getestet mit **v2.1.319**. Prüfen mit
  `claude --version`.
- Läuft im Terminal und im Code-Tab der Claude-Desktop-App. In `claude -p`, im Agent SDK, in VS Code und mobil zeichnen
  die meisten Mods nichts; Details in der README des jeweiligen Mods.
- tune-strip braucht Windows und die Spotify-Desktop-App. Die anderen fünf sind an kein System gebunden (täglich unter
  Windows im Einsatz, in der CI unter Linux getestet); nur der optionale Speicher-Ring und die Systemwerte von
  limit-bars laufen nur unter Windows.
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
claude plugin install tune-strip@fynn-mods     # nur Windows
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

- **sidekick** fragt Haiku 5.5 (Effort `medium`) nur, wenn sich eine Prüfung lohnen kann (erste Nachricht eines Chats,
  großer Kontext, kalter Cache): etwa 0,001 $ und 3 Sekunden je Prüfung (API-Wert). Eine Übergabe in einen neuen Chat
  ist ein größerer Aufruf, nur wenn du ihn wählst: das Modell deiner Session aus dem warmen Cache (etwa 0,06 $ bei 150k
  Kontext mit Opus 5.5) oder, bei kaltem Cache, Sonnet 5.5 aus dem Verlauf (etwa 0,08 $). Gespeicherte Prompts, die
  Warteschlange und der Skill-Katalog kommen mit winzigen Haiku-Aufrufen aus (ein Bruchteil eines Cents). Die Stufe
  `cache` ruft gar kein Modell auf. `/savings`
  stellt beides der gemessenen Ersparnis gegenüber. Abschalten mit `/sidekick off`. *Gut zu wissen* (standardmäßig
  aus, `/sidekick notes on`) fragt bei längeren Aufgaben das Modell deiner Session, großteils aus dem Cache: etwa
  0,04 $ je Prüfung bei 150k Kontext mit Opus 5.5.
- **quick-replies** forkt die Session nach jeder Antwort **nur mit `/replies more on`** (standardmäßig aus): etwa so
  viel wie eine kurze Antwort, großteils aus dem Prompt-Cache.

limit-bars macht nur einen Aufruf, solange `/keepwarm` läuft (standardmäßig aus). clawd-buddy, tune-strip und cost-ledger
machen keine Modellaufrufe. cost-ledger bucht die Aufrufe der anderen Mods, so siehst du, was sie kosten.

## Die Mods

### clawd-buddy

![Clawd, eine Pixel-Krabbe, tippt auf dem Laptop, klatscht einen kleinen Subagenten-Helfer ab, bekommt von ihm ein Geschenk, springt vor Freude und jongliert bunte Klötze.](assets/clawd-buddy.gif)

Clawd, eine kleine Pixel-Krabbe, sitzt auf der Eingabebox und reagiert auf das, was passiert: Er liest mit, tippt auf
dem Laptop, während Claude Dateien bearbeitet, wartet mit der Sanduhr bei langen Tool-Läufen, jubelt über fertige
Turns und wird sichtbar grantig, wenn sich Fehler häufen. Im Leerlauf vertreibt er sich je nach Tageszeit die Zeit,
nachts schläft er ein. Subagenten erscheinen als kleine Helfer neben ihm.

Läuft [tune-strip](#tune-strip), nickt er auf den echten Takt des Songs und wählt seine Bewegungen nach dem Klang: Zu
ruhigen Songs wiegt er sich, zu Groove und Hip-Hop schnippt er mit den Fingern, zu harten Songs spielt er Luftgitarre,
zu traurigen Balladen schwenkt er ein Feuerzeug. In der Desktop-App läuft er hinter der Zeile des Bands, breite
Limit-Balken schieben ihn also nicht mehr zur Seite.

Ab und zu friert ihn ein kalter Cache oder ein neuer Chat in einen Eisklumpen ein (höchstens einmal pro Chat): Tippen
lässt das Eis reißen, Senden bricht es auf, manchmal schmilzt es. In den Einstellungen lässt sich das Eis abschalten (`/clawd freeze` geht
weiterhin).

- **Befehle:** `/clawd` (Status), `/clawd on|off`, `/clawd list`, `/clawd demo <name>`, `/clawd nap`, `/clawd boop`,
  `/clawd freeze`, `/clawd language de|en`, `/clawd help`
- **Rechte kurz:** beobachtet Ereignisse und gibt sie unverändert weiter; zeichnet nur seine eigene Tabelle zu
  `/clawd help`; merkt sich ein paar Zähler im eigenen Plugin-Speicher (an/aus ist eine Einstellung); liest von
  tune-strip, ob Musik läuft, das Tempo und die Gruppe des Songs, nie den Titel; liest von sidekick nur, was er gerade
  tut, warum er fragt, seine Stufe und ob der Cache kalt ist. Sonst nur die [Einstellungsbefehle](#rechte-und-vertrauen).
  Keine Dateien, kein Netzwerk, keine Modellaufrufe.
- **Details:** [mods/clawd-buddy](mods/clawd-buddy/README.md) (englisch)

### limit-bars

![limit-bars: der Balken für das 5-Stunden-Limit bei 42 %, zurückgesetzt in 2 h 14 min, der Wochenbalken bei 18 %, zurückgesetzt Montag 09:00, ein grüner Cache-Ring mit 42 Minuten Rest bei 212k Tokens Kontext und der Speicher-Ring für Laufwerk E: mit 419 von 931 GB belegt.](assets/limit-bars.svg)

![limit-bars mit /bars style ring: vier Ringe für das 5-Stunden-Limit bei 42 %, das Wochenlimit bei 18 %, den Cache mit 42 Minuten Rest und 212k Tokens und den Speicher-Ring mit 419 von 931 GB belegt.](assets/limit-bars-rings.svg)

Zwei schmale Balken links neben Clawd zeigen, wie viel vom 5-Stunden- und vom Wochenlimit verbraucht ist und wann sie
zurückgesetzt werden; in der Desktop-App zeichnet `/bars style ring` sie stattdessen als Ringe. Ein Ring daneben zeigt,
wie lange der Prompt-Cache dieses Chats noch warm ist, dazu die Kontextgröße. Bei Abos, die nur ein Wochenlimit melden,
zeigt die obere Zeile stattdessen dein Wochentempo (`5h ∞ · +12% Tempo`, `reicht bis Fr 14:00`), und ein Strich auf
dem Wochenbalken markiert den gleichmäßigen Verbrauch. Die Cache-Wache fragt nach, bevor du in einen großen Chat mit kaltem Cache sendest und damit den ganzen
Kontext neu schreiben würdest.

Ein optionaler dritter Ring zeigt, wie voll ein Laufwerk ist, aufgeteilt nach Dateiart (Programme, Medien, KI-Modelle,
Code …); `/disk` zeigt die Einzelheiten. Er ist **standardmäßig aus** und läuft bisher nur unter Windows: Zum
Einschalten `storagePath` in den Einstellungen setzen.

Ist [cost-ledger](#cost-ledger) installiert, zeigt ein Kostenring, was dieser Chat als Anteil am ganzen Projekt
gekostet hat, als API-Wert. `/bars show cpu on` ergänzt live Systemwerte (CPU, RAM, GPU-Last und Grafikspeicher, eine
Messung je Sekunde, jeweils mit Trendpfeil); sie sind **standardmäßig aus** und laufen nur unter Windows. Die GPU-Last
klappt mit jeder Karte, deren Treiber die Windows-GPU-Zähler liefert; der Grafikspeicher braucht eine NVIDIA-Karte.

**Nach deinem Geschmack:** Jeder Teil (5-Stunden-Balken, Wochen-Balken, Cache-Ring, Speicher-Ring, Kostenring,
Systemwerte) lässt sich einzeln ausblenden, mit `/bars show cache off` (wirkt sofort in allen offenen Chats) oder
dauerhaft über `showFiveHour`, `showWeekly`, `showCache`, `showStorage`, `showCost` und `showSystem` auf der Einstellungsseite. Ohne Cache-Ring bleibt die Rückfrage vor kaltem Senden an;
die schaltest du mit `/cache warn off` ab.

Alle offenen Chats auf demselben Rechner teilen sich den neuesten Limit-Stand und prüfen ihn alle 2 s, die Balken laufen also
ohne Flackern mit.

- **Befehle:** `/cache` (Überblick und Einstellungen), `/keepwarm [stunden|off]`, `/disk [refresh]`, `/bars [show <teil> on|off | style bar|ring | reset]`,
  `/bars language de|en`, `/bars help`
- **Rechte kurz:** liest Limits, Kontextgröße und Cache-Werte; kann eine Nachricht für eine Rückfrage anhalten; führt
  `/compact` nur auf deine Wahl aus; `$.model.fork` nur, solange `/keepwarm`
  läuft; nur mit gesetztem `storagePath` startet er Windows PowerShell mit zwei festen, nur lesenden Skripten
  (Laufwerksgröße, Größen nach Dateiendung); nur mit eingeschalteten Systemwerten einen Windows-PowerShell-Prozess mit
  festem, nur lesendem Skript (und `nvidia-smi`); liest die Chat- und Projektkosten von cost-ledger und die Stufe von
  sidekick und teilt tune-strip über `$.state` nur mit, wie breit die Balken sind. Sonst nur die [Einstellungsbefehle](#rechte-und-vertrauen). Keine
  Dateien, kein Netzwerk, keine Umgebungsvariablen.
- **Übergabe:** `/handoff` ist zu [sidekick](#sidekick) umgezogen (limit-bars 0.15.0, sidekick 0.22.0); es braucht
  sidekick.
- **Details:** [mods/limit-bars](mods/limit-bars/README.md) (englisch)

### sidekick

![sidekick in der Desktop-App: unter einer Nachricht schlägt eine blaue sidekick-Zeile /claude-api prompt-audit vor, mit den Knöpfen Copy und ?, die aufgeklappte Erklärung sagt, was das Audit tut und warum es fällig ist; darunter sidekicks Rückfrage bei einer Nachricht in einen kalten, großen Chat: Senden schreibt alles neu für etwa 2,40 $, ein neuer Chat mit Übergabe kostet etwa 0,26 $, mit den Optionen Neuer Chat mit Übergabe, Neuer Chat ohne Übergabe, Trotzdem senden und Abbrechen (englische Einstellung).](assets/sidekick.png)

Ein zweiter Blick auf jede Nachricht, kurz bevor sie rausgeht. Zuerst entscheiden feste Regeln, ohne Kosten. Nur wo
sich eine Prüfung lohnen kann (erste Nachricht eines Chats, großer Kontext, kalter Cache), schaut zusätzlich kurz
Haiku 5.5 drauf. sidekick chattet nie von sich aus: Er bleibt still, setzt eine blaue Hinweiszeile unter deine
Nachricht oder fragt nach.

- **Kalter Cache im großen Chat:** Bevor du einen großen, kalt gewordenen Kontext neu sendest, zeigt er beide Preise,
  etwa „Senden schreibt alles neu (≈ 2,40 $)“ gegenüber „Neuer Chat mit Übergabe (≈ 0,26 $)“. Mit *Neuer Chat mit
  Übergabe* wird die Übergabe auf dem günstigsten guten Weg geschrieben, der Chat wird geleert und deine Nachricht geht
  im frischen Chat weiter; der alte bleibt über `/resume` erreichbar. `/handoff` macht dasselbe auf Wunsch (siehe
  unten).
- **Ein besserer Weg:** verweist auf einen passenden Skill, schlägt bei neuem Thema einen frischen Chat vor oder bietet
  eine klarere Fassung deiner Nachricht an, die du mit einem Klick sendest.
- **Falscher Chat:** Gehört eine Nachricht klar zu einem anderen Projekt als der Chat, hält sidekick sie an und fragt,
  ob du im falschen Chat bist, bevor sie im falschen Kontext landet (und dort Kosten verursacht).
- **Drei Stufen:** `/sidekick off`, `cache` (nur die Kalt-Rückfrage, kein Modellaufruf) und `guide` (Begleiter, der
  Standard). Ein Label in der Fußzeile neben der Modellauswahl zeigt die Stufe: 🟢 bereit, 🟠 arbeitet oder fragt, 🔴 aus.
  sidekick sendet nie etwas von selbst: Eine klarere Fassung geht nur raus, wenn du sie im Dialog wählst.
- **Fällige Wartung:** Bis zu zweimal pro Chat nennt er einen fälligen Befehl (`/skill-doctor`, Prompt-Audit, Memory
  aufräumen, `/init`), auf Grundlage einer kostenlosen lokalen Schätzung. *In Prompt einfügen* (in der Desktop-App
  *Kopieren*) gibt dir den Befehl zum selbst Senden, und **?** erklärt, warum er gerade fällig ist und was er kostet.
  Nennt eine Hinweiszeile der Nachrichtenprüfung einen Befehl (z. B. `/handoff`), führt ihn ein Knopf mit einem Klick aus.
- **Nachprüfbare Ersparnis:** `/savings` zeigt, was sidekick gekostet und was er messbar gespart hat;
  `/savings detail` ergänzt Rechenweg, Modellvergleich und Verlauf je Tag.
- **Gut zu wissen (optional, standardmäßig aus):** Mit `/sidekick notes on` fragt sidekick bei einer längeren Aufgabe,
  ob du sehr wahrscheinlich etwas mit Folgen übersehen hast, und zeigt es über dem Prompt mit *Erklären*, *Weiß ich schon*
  und *Später*. Meist erscheint nichts.
- **Modell-Tipp:** Bei der ersten Nachricht eines Chats auf Opus oder Fable fragt sidekick, ob eine einfache Aufgabe auf
  Sonnet 5.5 oder Haiku 5.5 laufen soll. Mit `/sidekick tips auto on` (standardmäßig aus) stellt er auch eingebaute
  Subagenten und Chats, die Claude startet, um, wenn Haiku ihren Auftrag als einfach einstuft. `/savings` zeigt die
  Ersparnis als gekennzeichnete Schätzung.
- **Korrektur-Schleife:** Bei der dritten Korrektur in Folge („geht immer noch nicht“) bietet er einen neuen Chat mit
  einer Übergabe dessen an, was nicht geklappt hat, oder einen kurzen Anstoß an Claude, einen Schritt zurückzutreten.
  Nach der zweiten und vierten Zusammenfassung (Compaction) eines Chats bietet er einmal einen neuen Chat an.
- **Übergabe:** `/handoff` (von limit-bars hierher umgezogen) schreibt eine kurze Übergabe und fragt, ob du in einem
  frischen Chat weitermachen willst. Solange der Prompt-Cache warm ist, schreibt sie das Modell deiner Session aus dem
  Cache; bei kaltem Cache schreibt Sonnet 5.5 sie aus dem Verlauf. Eine Zeile über dem Prompt kann sie kurz vor Ablauf
  des Caches eines großen Chats vorschlagen.
- **Gespeicherte Prompts:** Eine Anweisung, die du immer wieder schickst, kann dein eigener Befehl werden, z. B.
  `/p tidy-chats`, in der Desktop-App mit einem Knopf in der Fußzeile. Speichern mit `/sidekick save <name>` oder
  indem du das Angebot von sidekick annimmst, nachdem dieselbe Art Anweisung in drei Chats vorkam.
- **Warteschlange:** Schreibst du, während Claude noch arbeitet, einen klar getrennten späteren Punkt, geht er direkt
  rein, mit einem Hinweis an Claude, erst die laufende Aufgabe fertig zu machen. Selbst entscheiden: in der
  Desktop-Fußzeile auf **Danach** klicken oder die Nachricht mit `later:` beginnen.
- **Skill-Katalog:** Verlangt eine Nachricht klar das, was ein handverlesener Skill von Dritten tut, fragt sidekick vor
  dem Senden einmal pro Chat nach. Drei reine Markdown-Skills von Emil Kowalski liegen sidekick bei (MIT, mit ihrer
  Lizenz); bei den übrigen kopiert er nur den Installationsbefehl und installiert nie etwas.
- **Gemeinsame Gründe:** Ist clawd-buddy installiert, zeigt Clawd, warum sidekick eine Nachricht anhält.

Scheitert eine Prüfung oder dauert sie zu lange, geht deine Nachricht unverändert raus.

- **Befehle:** `/sidekick` (Status und Einstellungen), `/sidekick off|cache|guide|on`,
  `/sidekick hints …`, `/sidekick notes on|off`, `/sidekick tips …`, `/sidekick loop on|off`,
  `/sidekick queue on|off`, `/sidekick catalog …`, `/sidekick save|prompts|forget …`, `/p <name>`,
  `/handoff [fork|text|show|continue]`, `/sidekick language de|en`, `/sidekick help`, `/savings [today|week|all]`,
  `/savings detail`
- **Rechte kurz:** liest deine Nachricht vor dem Senden; hält sie nur an oder ersetzt sie nur nach deiner Wahl im
  Dialog; Haiku 5.5 und Sonnet 5.5 über `$.model.complete` mit einer laufenden Kurzfassung, deinen letzten 3 Nachrichten und dem Ende von Claudes letzter Antwort, nie dem
  ganzen Verlauf; `$.model.fork` an das Modell deiner Session über den Gesprächsverlauf, mit allen Tools gesperrt, nur
  mit Gut zu wissen an oder um eine Übergabe aus dem warmen Cache zu schreiben; gespeicherte Prompts und Übergaben werden (`$.prompt.submit`) nur auf deinen Befehl oder Klick gesendet; bei einer Nachricht, die du schreibst, während Claude arbeitet, kann er einen versteckten Hinweis an Claude anfügen (Warteschlange) oder, nachdem du „Mit … senden“ gewählt hast, den Text eines mitgelieferten Skills; auf Knopfdruck führt er den Befehl der Zeile aus (Befehle aus Plugins und eigene, `/skill-doctor`, `/init`;
  nie MCP-Prompts, `/clear`, `/exit`, `/quit`, `/login`, `/logout`, `/rewind`); zeichnet sein Label in die Fußzeile; füllt
  das leere Eingabefeld mit einem Wartungsbefehl bei *In Prompt einfügen* oder wenn ein Befehl abgelehnt wird; legt ihn
  bei *Kopieren* in die Zwischenablage (`$.ui.copy`);
  liest den Pfad der Projektwurzel; teilt clawd-buddy über `$.state` nur die Art des Ereignisses und die Uhrzeit mit,
  nie deine Nachricht. Für den Modell-Tipp liest er das Hauptmodell (`$.session.model`), ändert das Modell je Anfrage
  nur in einem Chat, in dem du ein günstigeres gewählt hast, und setzt mit `tips auto` das Modell eingebauter Subagenten
  (`agent.spawn`) und von `start_session` und zeigt dazu eine Zeile im Agent-Fenster (`$.ui.notice`). Sonst nur der
  [Einstellungsbefehle](#rechte-und-vertrauen). Kein Netzwerk, keine Umgebung; Dateien nur, um nach deinem Klick die
  `SKILL.md` eines mitgelieferten Skills zu lesen, geschrieben wird nichts.
- **Details:** [mods/sidekick](mods/sidekick/README.md) (englisch)

### quick-replies

![quick-replies in der Desktop-App: Nach Claudes Antwort bietet eine Pille über den Limit-Balken und Clawd vier nummerierte Antwortvorschläge an (englische Einstellung).](assets/quick-replies.png)

Claude Code schlägt oft deine nächste Nachricht als grauen Text im Prompt vor. quick-replies macht daraus einen Knopf
in einer eigenen Pille über Clawd. Ein Klick oder die Taste `1` im leeren Prompt schickt ihn als deine Nachricht ab.
Mit `/replies more on` füllt ein Fork der Session bis zu vier Plätze; Claude Codes eigener Vorschlag bleibt auf `1`.

- **Befehle:** `/replies` (Status), `/replies on|off`, `/replies more on|off`, `/replies language de|en`,
  `/replies help`
- **Rechte kurz:** liest den Vorschlag von Claude Code; sendet einen Vorschlag nur auf Klick oder Taste als deine
  Nachricht, nie automatisch; `$.model.fork` nur mit `more` an; teilt tune-strip über `$.state` nur mit, ob die Pille
  steht, nie ihren Text. Sonst nur die [Einstellungsbefehle](#rechte-und-vertrauen). Keine Dateien, kein Netzwerk.
- **Details:** [mods/quick-replies](mods/quick-replies/README.md) (englisch)

### tune-strip

![tune-strip in der Desktop-App: eine Player-Leiste ganz oben im Band mit einem erfundenen Titel, Recipe for Rain von Juniper Static, einem abstrakten Sonnenuntergangs-Cover, einem grünen Positionsbalken bei 1:23 von 3:34 und den Knöpfen zurück, Pause und weiter; darunter die Limit-Balken, Cache- und Speicher-Ring und Clawd.](assets/tune-strip.png)

**Nur Windows.** Eine Musikleiste für Spotify im Band über dem Prompt: Albumcover, Titel und Interpret, ein Positionsbalken im
Stil der Limit-Balken und Knöpfe für Neustart/zurück, Abspielen/Pause und weiter. Er liest und steuert die
Spotify-Desktop-App über die Windows-Mediensteuerung: keine Anmeldung, kein Token, kein Netzwerk, keine Spotify-API.
Browser und andere Player bleiben außen vor. In der Desktop-App bekommt er eine eigene Leiste ganz oben im Band, im
Terminal ist er eine Zeile (`♪ Titel – Interpret 1:23/3:45 ⏮ ⏯ ⏭`), die bei schmalem Fenster schrumpft. Mit
`extraButtons` kommen −15 s, +15 s, Zufall und Wiederholen dazu.

**Takt für Clawd:** Während Spotify spielt, findet tune-strip Tempo und Schläge des Songs und ob er ruhig,
Groove/Hip-Hop, hart oder traurig klingt, damit [Clawd](#clawd-buddy) im Takt mitgehen kann. Gehört wird nur der Ton
von Spotify selbst (Windows-Prozess-Loopback), nie der übrige Systemton. **Er wird lokal nur auf das Tempo hin
ausgewertet; nichts wird aufgenommen, gespeichert oder gesendet.** `/tune beat off` schaltet das ab,
`/tune beat offset <ms>` verschiebt den Takt für Kopfhörer.

- **Befehle:** `/tune` (läuft gerade), `/tune play|pause|toggle|next|prev`, `/tune back|forward`,
  `/tune shuffle [on|off]`, `/tune repeat [off|all|track]`, `/tune size auto|full|compact|mini`,
  `/tune on|off`, `/tune beat [on|off|offset <ms>]`, `/tune language de|en`, `/tune help`
- **Rechte kurz:** startet Windows PowerShell 5.1 mit zwei festen Skripten (Spotify-Sitzung lesen; Steuerbefehl
  senden), der Befehl geht nur als Umgebungsvariable hinein; solange Spotify spielt und das Band zu sehen ist, einen
  Takt-Helfer (PowerShell mit festem Text, gibt nur Zahlen aus); teilt clawd-buddy über `$.state` mit, ob Musik läuft,
  Tempo, Schlagzeit und Gruppe, ohne Titel oder Interpret; liest, wie breit limit-bars und Clawd sind und ob
  quick-replies seine Pille zeigt. Sonst nur die [Einstellungsbefehle](#rechte-und-vertrauen). Keine Dateien, kein
  Netzwerk, keine Tokens, keine Modellaufrufe.
- **Umbenannt:** Bis 0.3.1 hieß der Mod `spotify` mit dem Befehl `/spotify`. Zum Umstieg
  `claude plugin marketplace update fynn-mods` und danach einmal `claude plugin install tune-strip@fynn-mods`; der
  Marketplace ordnet den alten Namen dem neuen zu, deine Einstellungen ziehen mit um.
- **Details:** [mods/tune-strip](mods/tune-strip/README.md) (englisch)

### cost-ledger

![Die Übersicht /ledger von cost-ledger mit erfundenen Daten: Summen für heute, 7 Tage, 30 Tage und gesamt, die Abo- und Limitzeile, ein Verlauf über 14 Tage, Kosten je Projekt, die teuersten Chats, die enthaltenen Modellaufrufe der Mods und der Anteil dieses Chats an seinem Projekt (englische Einstellung).](assets/cost-ledger.png)

Nach jeder Antwort bucht cost-ledger, was der Chat bisher gekostet hat (derselbe Wert wie `/cost`), die Tokens je
Modell und die Modellaufrufe anderer Mods. `/ledger` zeigt heute, 7 und 30 Tage und gesamt, einen Verlauf nach Modell,
deine Projekte und die teuersten Chats, gezeichnet im Stil von Claude Code. `/ledger here` zeigt, was dieses Projekt
gekostet hat und welchen Anteil dieser Chat daran hat, in der Desktop-App als Ring. Im Abo zeigt `/ledger limits`, wie viel
API-Wert ins aktuelle 5-Stunden- und Wochenfenster und in deinen Abo-Monat geflossen ist; dein Abo trägst du einmal mit
`/ledger plan` (Pro, Max, Ultra, Team oder Enterprise) oder auf der Einstellungsseite ein. Dazu schätzt es, wie viel von jedem Fenster außerhalb des Ledgers verbraucht wurde (claude.ai, Handy-App, Chats ohne den Mod).

**Mehrere Rechner:** Der Sync ist standardmäßig aus. So siehst du PC und Laptop zusammen in einem `/ledger`:

1. Lege im Cloud-Laufwerk (OneDrive, Dropbox, iCloud Drive, Syncthing …) einen neuen Ordner fest, z. B. `cost-ledger`. Sein Pfad darf auf jedem Rechner anders sein.
2. Auf dem PC: `/ledger sync <vollständiger Pfad zu diesem Ordner>`, danach `/ledger sync name PC`.
3. Sobald das Cloud-Laufwerk den Ordner abgeglichen hat, auf dem Laptop: `/ledger sync <sein Pfad zum selben Ordner>`, danach `/ledger sync name Laptop`.
4. Prüfen: `/ledger sync` listet das andere Gerät, `/ledger` zeigt oben „2 Geräte“.

Der Pfad muss absolut sein, unter Windows mit Laufwerksbuchstaben (z. B. `D:\OneDrive\cost-ledger`; im Explorer per Rechtsklick → **Als Pfad kopieren**);
Netzwerkpfade gehen nicht. In den Ordner kommen nur Zahlen und je Projekt der Ordnername, keine Pfade oder Chat-Titel. Ausführliche
Anleitung mit Pfaden je System und Fehlerhilfe: [Sync between devices](mods/cost-ledger/README.md#sync-between-devices) (englisch).

- **Befehle:** `/ledger`, `/ledger here`, `/ledger weeks`, `/ledger chats|projects|models [7|30|all]`, `/ledger limits`,
  `/ledger plan <abo> <tag|today> [preis]`, `/ledger sync [<ordner>|name <name>|off]`, `/ledger reset`,
  `/ledger language de|en`, `/ledger help`
- **Rechte kurz:** liest Kosten, Verbrauch und Limitfenster der Session; beobachtet die Modellaufrufe anderer Mods und
  gibt sie unverändert weiter; speichert Projektname, Git-Remote als `host/owner/repo`, die ersten 50 Zeichen der ersten
  Nachricht eines Chats im lokalen Plugin-Speicher (Abo, Sync-Ordner und Gerätename sind Plugin-Einstellungen); teilt limit-bars über `$.state` die Kosten
  dieses Chats und Projekts mit (nur Beträge und der Ordnername). Sonst nur die [Einstellungsbefehle](#rechte-und-vertrauen).
  Keine Modellaufrufe oder Netzwerkzugriffe. Dateien nur für den optionalen Sync (`$.fs`, begrenzt auf den gewählten Ordner und die eigene Datei `cost-ledger-<id>.json`).
- **Details:** [mods/cost-ledger](mods/cost-ledger/README.md) (englisch)

## Zusammenspiel

- **Ein Band über dem Prompt.** clawd-buddy, limit-bars, quick-replies, tune-strip und sidekick zeichnen alle ins Band
  über dem Prompt und folgen einer kleinen gemeinsamen Absprache: Limit-Balken und Cache-Ring stehen links neben Clawd,
  die quick-replies-Pille darüber, die tune-strip-Leiste in der Desktop-App ganz oben (im Terminal ein Platz zwischen den
  Balken und Clawd), und die Boxen von sidekick erscheinen dort nur, solange er etwas zu zeigen hat. In der Desktop-App
  läuft Clawd hinter der Zeile, Balken und tune-strip liegen über ihm. Jeder Mod funktioniert auch allein.
- **Clawd bewegt sich zur Musik.** Läuft tune-strip, nickt Clawd auf den Takt des Songs, wenn er Zeit hat, wählt seine
  Bewegungen nach dem Klang und setzt manchmal Kopfhörer auf. tune-strip verrät ihm nur, dass Musik läuft, das Tempo
  und die Gruppe (ruhig, Groove, hart, traurig), nie was läuft.
- **cost-ledger beliefert limit-bars.** Sind beide installiert, zeichnet limit-bars einen Kostenring mit dem, was dieser
  Chat und dieses Projekt gekostet haben, dieselben Zahlen wie `/ledger here all`.
- **Ein Sprachschalter für alle.** `/<befehl> language de|en` in einem der sechs Mods stellt alle installierten
  fynn-mods auf einmal um.
- **limit-bars lässt sidekick den Vortritt.** Beide können vor kaltem Senden fragen. Läuft sidekick auf `cache` oder
  `guide`, schweigt limit-bars von selbst (`/cache` zeigt „an (übernimmt gerade sidekick)“), damit nie zwei Dialoge
  hintereinander kommen. `/handoff` wohnt in sidekick.
- **Clawd spielt sidekick mit.** Sind beide installiert, hält Clawd die Lupe ans Eingabefeld, während sidekick prüft,
  zeigt bei einer Rückfrage ein Stoppschild und schreibt einen Brief, wenn sidekick einen neuen Chat mit Übergabe
  startet. Sie zeigt auch, warum sidekick fragt (kalter Cache, falscher Chat, Modell-Tipp, klarere Fassung, neues
  Thema).
- **cost-ledger bucht die anderen.** Modellaufrufe von sidekick, quick-replies und limit-bars stehen nicht in
  `/cost`; cost-ledger bucht sie getrennt, so zeigt `/ledger`, was jeder Mod kostet.

## Rechte und Vertrauen

Ein Mod ist Code, der in Claude Code mit deinen Rechten läuft. Jeder Mod hier legt offen, an welche Ereignisse er sich
hängt und welche API-Aufrufe er macht; `claude plugin validate mods/<mod>` zeigt die genaue Liste, und jede README
erklärt in Klartext, wofür sie da sind. Keiner dieser Mods liest oder speichert Anmeldedaten oder Tokens, keiner hat einen
eigenen Netzwerkzugang, und keiner schreibt irgendwohin außer in seinen eigenen Plugin-Speicher und seine
Plugin-Einstellungen, mit zwei Ausnahmen: cost-ledger schreibt seine eigene Datei in den Ordner, den du wählst, aber
nur, wenn du `/ledger sync` einschaltest; und der Sprachschalter ändert die Einstellung `language` der sechs
fynn-mods, sonst nichts.

**Einstellungsbefehle:** `/<befehl> language de|en` liest die Plugin-Einstellungen und ändert nur das Feld `language`
der sechs fynn-mods (`$.config`). Die Befehle, die eine Einstellung spiegeln (`/clawd on|off`, `/replies on|off`,
`/tune size`, `/ledger plan`, `/sidekick cache` und so weiter), ändern nur die Felder ihres eigenen Mods. In der
Desktop-App und in `claude -p`, wo Claude Code keine Plugin-Einstellungen auflistet, rufen sie stattdessen die
`claude`-CLI auf, nur `claude plugin list --json` und `claude plugin configure <mod>@fynn-mods` (für die sechs
fynn-mods, nur eigene Felder). Das ist der einzige Prozess, den clawd-buddy, cost-ledger, quick-replies und sidekick
je starten.

**Weitere Prozesse,** alle Windows PowerShell mit festen Skripten: tune-strip, um die Spotify-Sitzung der
Windows-Mediensteuerung zu lesen und zu steuern und für den Takt nur den Ton von Spotify zu hören (nur das Tempo,
nichts wird aufgenommen, keine Dateien, kein Netzwerk); limit-bars nur für den optionalen Speicher-Ring und die
Systemwerte. Der Speicher-Ring ist auch das Einzige, was auf dein Laufwerk schaut: Er liest Größen, nie Dateiinhalte.
Sicherheitsproblem gefunden? Siehe [SECURITY.md](SECURITY.md) (englisch).

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Ein Mod zeichnet nichts | `claude --version` prüfen (diese Mods brauchen v2.1.309 oder neuer) und ob `/plugin` den Mod als `mod active` zeigt. Ein neu installierter Mod lädt in der nächsten Session oder nach `/reload-plugins`. In `claude -p`, im Agent SDK, in VS Code und mobil zeichnen die meisten Mods nichts. |
| Nach einem Claude-Code-Update geht ein Mod nicht mehr | Die Mods aktualisieren (`claude plugin marketplace update fynn-mods`, dann `claude plugin update <mod>@fynn-mods`). Hilft das nicht, bitte ein Issue anlegen. |
| Zwei Rückfragen hintereinander vor dem Senden mit kaltem Cache | limit-bars auf 0.14.0 oder neuer aktualisieren; dann überlässt es sidekick die Frage. Bei älterem limit-bars die Rückfrage mit `/cache warn off` abschalten. |
| Alles ist englisch | `/clawd language de` (oder der Befehl eines anderen Mods) stellt alle fynn-mods um; für einen einzelnen Mod die Option `language` mit `/plugin configure <mod>@fynn-mods` auf `de` stellen. In der Desktop-App wirkt das ab dem nächsten Chat oder sofort nach `/reload-plugins`. |
| tune-strip zeigt nichts | Er läuft nur unter Windows und braucht die Spotify-Desktop-App (der Web-Player wird nicht erkannt). Ist Spotify geschlossen, zeichnet er nichts; `/tune` sagt, was er sieht. Falls ausgeschaltet: `/tune on`. |
| Der Speicher-Ring fehlt oder bleibt leer | Er läuft nur unter Windows und ist standardmäßig aus: `storagePath` (z. B. `D:\`) in den Einstellungen von limit-bars setzen und prüfen, ob `/bars show storage on` gilt. Bleibt er leer, zeigt `/disk` den Fehler. |
| cost-ledger zeigt einen Chat mit Haiku 5.5 etwa zehnfach zu teuer an | Claude Code v2.1.291 berechnete Haiku 5.5 in `/cost` wie Haiku 4.5, und cost-ledger bucht diesen Wert für den Chat. Claude Code aktualisieren; v2.1.295 rechnet richtig. Modellaufrufe der Mods rechnet cost-ledger mit eigenen Preisen. |

Warum ein Mod nichts tut, zeigt das Debug-Log: Claude Code mit `claude --debug-file mod-debug.log` starten und die
Datei nach dem Namen des Mods durchsuchen ([Doku von Claude Code](https://code.claude.com/docs/de/plugins/mods/troubleshoot)).

## Feedback

Fehlerberichte und Ideen gern als [Issue](https://github.com/FynnXland/fynn-mods/issues), gern auch auf Deutsch; das
Formular fragt nach der Version des Mods (`/plugin`), `claude --version` und Terminal oder Desktop-App. Bevor du einen
Pull Request anfängst, lies bitte [CONTRIBUTING.md](CONTRIBUTING.md) (englisch).

## Hinweis

Das ist ein inoffizielles Hobbyprojekt, nicht von Anthropic erstellt, unterstützt oder geprüft. clawd-buddy ist eine
Fan-Hommage an Clawd, das Maskottchen von Claude Code; die Pixel sind von Hand gezeichnet. Hat Anthropic Einwände, wird
der Mod entfernt. Spotify ist eine Marke der Spotify AB; der Mod tune-strip stammt nicht von Spotify und spricht nur über
Windows mit der Spotify-Desktop-App.

## Lizenz

[MIT-Lizenz](LICENSE), Copyright (c) 2026 Fynn Hansen. Rechtlich maßgeblich ist der englische Lizenztext. Sofern du
nicht ausdrücklich etwas anderes angibst, steht jeder Beitrag, den du zur Aufnahme in dieses Projekt einreichst, unter
der MIT-Lizenz, ohne zusätzliche Bedingungen.

limit-bars ist nach Cache Keeper von Nate Herk gebaut (MIT); sidekick übernimmt die Cache-Logik von limit-bars. Siehe
die `THIRD-PARTY-NOTICES.md` in beiden Mods.
