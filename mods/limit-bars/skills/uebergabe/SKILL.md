---
name: uebergabe
description: Short handoff at the end of a chat, so a fresh chat can continue without the old history. Use for "handoff", "wrap up the chat", "summarize before I clear", „Übergabe“, „Chat abschließen“, „zusammenfassen bevor ich leere“, or when /handoff from limit-bars triggers it.
---

<!-- Based on the skill "session-handoff" from Nate Herk's Cache Keeper (MIT, Copyright (c) 2026 Nate Herk),
     docs/vorlagen/nateherk-cache-keeper/skills/session-handoff/SKILL.md; shortened, with an English and a German template. -->

# Handoff

Write a handoff that lets a new instance of you continue seamlessly after `/clear`, without the old history. The reader is the next instance, not a human: brief, concrete, no praise.

## Language

Language code: `$ARGUMENTS`

- `en`: write the handoff in English and use the English template.
- `de`: write the handoff in German and use the German template (Vorlage).
- Empty or anything else: use the language of this conversation; for German use the German template, otherwise the English one.

## Steps

1. Go through the **whole** history of this chat, not just the last messages.
2. Summarize only what happened in this chat. No `git log`, no searching the file system.
3. Output in the chat only. Write no file, change no memory.
4. **At most 400 words.** Invent nothing: if a section has no content, write "none" (German: „keine“).
5. Always absolute paths. Background processes with their ID and how to stop them.

## Template, English (exactly this structure)

Easy to skim: the summary on top as a quote, key data as a table, bold only for the keyword at the start of a line, open items as a checklist. No emojis.

````
# Handoff: <one line, what it was about>

> **Status:** <one sentence, where the work stands>
> **Next:** <one sentence, the most likely next step>

| | |
|---|---|
| **Project** | `<absolute path>` |
| **Branch / worktree** | `<name>` or none |
| **Still running** | <background process with ID and how to stop it, server with URL> or nothing |

## Task
<1–2 sentences: what was asked, important constraints>

## Done
- **<keyword>**: <what and why> (`<absolute path>`)

## Read first
1. `<absolute path>`: <why>

## Open
- [ ] <task or question>: <context>

## Check
```
<command>
```
<expected result>
````

## Vorlage, Deutsch (genau diese Struktur)

````
# Übergabe: <eine Zeile, worum es ging>

> **Stand:** <ein Satz, wo die Arbeit steht>
> **Weiter mit:** <ein Satz, der wahrscheinlichste nächste Schritt>

| | |
|---|---|
| **Projekt** | `<absoluter Pfad>` |
| **Branch / Worktree** | `<Name>` oder keine |
| **Läuft noch** | <Hintergrundprozess mit ID und wie beenden, Server mit URL> oder nichts |

## Auftrag
<1–2 Sätze: was gewünscht war, wichtige Vorgaben>

## Erledigt
- **<Stichwort>**: <was und warum> (`<absoluter Pfad>`)

## Zuerst lesen
1. `<absoluter Pfad>`: <warum>

## Offen
- [ ] <Aufgabe oder Frage>: <Kontext>

## Prüfen
```
<Befehl>
```
<erwartetes Ergebnis>
````

If a section has no content, write "none" („keine“); the table rows always stay.
