# prompt-deck

Saves the prompts you send again and again and puts them as buttons above the prompt box in the **Claude Desktop app**: one click sends the prompt as your own message. In any session, `/p <name>` sends it by name, and `/deck` lists, saves, shows and deletes your prompts. One set of saved prompts is shared by all your chats and projects.

With [sidekick](../sidekick/README.md) installed you also get the **Later** button (your next message during a running task counts as a later item) and sidekick's offer "You send this often, save it as a button?". prompt-deck works without sidekick; only those two parts need it.

Texts are English by default; set `language` to `de` for German, or run `/deck language de`.

Requires Claude Code **2.1.323 or later** · Tested with Claude Code **v2.1.325** · Plugin version **0.1.1**

## Where it shows

| Surface | What you see |
|---|---|
| Desktop app, Code tab | A row of up to 4 buttons directly above limit-bars and Clawd (the base row of the band above the prompt), left-aligned. While Claude works and sidekick allows it, **Later** comes first. No buttons, no row |
| Terminal | No buttons. `/p <name>` and `/deck` work, `/deck list` and `/deck buttons` are tables with buttons |
| VS Code, `claude -p` | `/deck` answers as text. `/p` does not send in `-p` (there is no running session to send into) and says so |

Order of the band from the top: sidekick's hint, the music bar (tune-strip), the quick-replies pill, the prompt-deck buttons, then limit-bars and Clawd. Mods you don't have simply drop out.

## Commands

| Command | Effect |
|---|---|
| `/deck` · `/deck list` | Table of all saved prompts with **Send**, **Button on/off** and **Delete** per row |
| `/deck save <name>` | Saves your last own message in this chat under `<name>` (a–z, 0–9 and `-`, up to 24 characters). An existing prompt of yours with that name is replaced, its button setting stays |
| `/deck save <name> <text>` | Saves exactly this text, line breaks included |
| `/deck show <name>` | The full text of a prompt |
| `/deck <name> on\|off` | Button for this prompt on or off |
| `/deck forget <name>` | Deletes a prompt |
| `/deck buttons` | Table of the buttons above the prompt: Later, Prompt buttons and every saved prompt with its state (shown, not shown because only 4 slots, off), with On/Off per row |
| `/deck buttons later\|prompts\|<name> on\|off` | Turns one of them on or off; applies right away |
| `/p <name>` | Sends the saved prompt right away as your message; during an answer it goes out after it. `/p` alone lists the names |
| `/deck language [de\|en]` | Switches the language of all installed fynn-mods |
| `/deck help` | Help as a table |

At most 12 saved prompts and 4 visible buttons, in the order you saved them. Buttons are labelled with the name, cut at 14 characters. A second click on a button before the prompt has gone out does not send it twice.

## Configuration

Settings → Plugins → prompt-deck → Settings in the desktop app, or `/plugin configure prompt-deck` in a terminal session. Changes on the settings page apply in new chats; the `/deck buttons …` commands apply right away.

| Field | Default | Effect |
|---|---|---|
| `laterButton` (Later button) | on | Shows Later while Claude works. Needs sidekick with its Queue on, on the Guide level |
| `promptButtons` (Prompt buttons) | on | Shows the buttons of saved prompts. Off hides all of them; each prompt keeps its own on/off |
| `language` (Language / Sprache) | `en` | `en` or `de` |

## With sidekick

prompt-deck and sidekick talk only through `$.state` values, never through each other's files:

- **`prompt-deck.saved`** (written by prompt-deck): the names and the word sets of your saved prompts, no full texts. sidekick does not offer to save something that is already saved.
- **`prompt-deck.later`** (written by prompt-deck): you clicked Later, with the time of the click. sidekick treats your next message in this turn as a later item.
- **`sidekick.status.later`** (written by sidekick): Later may show right now (Claude works, Guide level, Queue on).
- **Saving from sidekick's offer:** sidekick runs `/deck save <name> <text>` for you. prompt-deck takes `save` from sidekick only, never from other plugins, and never overwrites: if the name is taken, it picks a free one (`name-2`).
- **Moving from sidekick 0.28 or older:** sidekick 0.29.0 hands over the prompts it had saved, once, with the same button settings. sidekick keeps its old list as a backup.

Without sidekick: no Later button and no save offer; everything else works.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, command.run{command=deck}, command.run{command=p}, ui.render{component=AbovePrompt}, ui.render{component=AbovePromptList}, ui.render{component=CommandOutput, props has {command=deck}}
calls: $.clock.every, $.clock.now, $.command.register, $.config.list, $.config.set, $.process.run, $.prompt.submit, $.session.messages, $.session.surfaces, $.state.get, $.state.set, $.store.get, $.store.set, $.ui.invalidate, $.ui.resolve, $.ui.toast
state writes: prompt-deck.later, prompt-deck.saved
state reads: prompt-deck.later, sidekick.status
```

In plain words:

- **Draws** one row above the prompt (`AbovePrompt`) and joins in arranging the band (`AbovePromptList`, the same code in every band mod). Draws the `/deck` tables and help (`CommandOutput`).
- **Sends** a saved prompt as your message (`$.prompt.submit`) only when you click a button or type `/p` yourself. A `/p` run by another plugin sends nothing. `$.clock.every` is a one-shot timer: Claude Code refuses to send from inside a command, so `/p` sends 100 ms later. `$.session.surfaces` tells `-p` apart.
- **Reads your last message** (`$.session.messages`) only for `/deck save <name>` without a text.
- **Stores** your saved prompts in its own plugin store (`$.store`), on this computer only.
- **Settings** (`$.config.*`, `$.process.run`): writes only its own fields, and with `/deck language` the `language` field of the fynn-mods, through `claude plugin list` and `claude plugin configure`. Nothing else.
- Makes **no model calls** and no network calls of its own.

## Installation

From the fynn-mods marketplace:

```bash
claude plugin marketplace add FynnXland/fynn-mods
```

```bash
claude plugin install prompt-deck@fynn-mods --scope user
```

Then `/reload-plugins` in a running session, or start a new one. Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install prompt-deck@fynn-mods`.

Update: `claude plugin update prompt-deck@fynn-mods`. Remove: `claude plugin uninstall prompt-deck@fynn-mods` (your saved prompts stay in the plugin store until you delete them). To try a local copy of the folder: `claude --plugin-dir <folder>`.

## Known limitations

- Buttons only in the desktop app. The terminal has the commands and the tables.
- A prompt saved in another chat is sendable there at once with `/p`, but its name shows up in the `/p` hint of the command menu only from the next start of this chat.
- After `/clear`, `prompt-deck.saved` is empty until your next change or the next start; in that time sidekick makes no save offer.
- If you use sidekick, update it to 0.29.0 or later first: older versions also serve `/p` with their own list. Later needs sidekick 0.29.0 or later.
- When sidekick saves a prompt for you, its `/deck save <name> <text>` shows in the chat with the full text, and Claude reads that line like any command line.
- Only your own commands count: `/p` and `/deck` refuse runs from other plugins, other sessions, schedules and channels (`save` from sidekick is the one exception). The check uses the plugin name `sidekick` without the marketplace.

## Changelog

- **0.1.1**: band.ts: in the desktop app the empty line between band rows is gone (about 12 px, for example between sidekick's hint and tune-strip's bar). Each row now goes through the engine on its own, and the band keeps a small gap, `rowGap: 'xs'`: 8 px in the desktop app, 0 rows in the terminal and VS Code, so those look as before. Update the band mods together (clawd-buddy 0.16.4, limit-bars 0.17.5, prompt-deck 0.1.1, quick-replies 0.8.6, sidekick 0.31.2, tune-strip 0.12.5). No other change.
- **0.1.0** (2026-11-17): first version. The saved prompts, `/p`, the buttons and the Later button move here from sidekick 0.28.1, as they were, with their own row above limit-bars instead of sidekick's footer. Commands `/deck …` replace `/sidekick save|prompts|forget|buttons`.

## License

MIT
