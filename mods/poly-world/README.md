# poly-world

A floating low-poly island behind the chat in the **Claude Desktop app** (Code tab) and the **mobile app**: a hut, trees and a small waterfall hanging in the sky at the top right, away from your messages and the prompt. The sky and the light follow the real time of day (night, morning, day, evening, with soft transitions), and a matching color set tints the app in light and dark mode.

The island also reacts quietly:

- **Smoke** rises from the chimney while Claude is working.
- **Lanterns** light up while music plays (needs [tune-strip](../tune-strip/README.md)).
- **The window lights up** when Clawd is tired (needs a clawd-buddy version that shares its mood; until then, and without clawd-buddy, the light follows the clock: on from 20:00 to 00:30).
- At night, while Claude works, a **laptop glows blue** in the window.

All art is drawn by the mod itself (SVG with CSS animation, no script, nothing loaded from the network). Texts are English by default; set `language` to `de` for German, or run `/world language de`.

Requires Claude Code **2.1.323 or later** · Tested with Claude Code **v2.1.325** · Plugin version **0.1.0**

## Where it shows

| Surface | What you see |
|---|---|
| Desktop app, Code tab | The scene behind the conversation, under the app's frosted panels, plus the color set "Poly World" (light: morning blue on paper; dark: lantern-warm text on night blue). App colors need Claude Code 2.1.324 or later in the Code tab |
| Mobile app | The scene under the app's veil. Colors as far as the app paints them |
| Terminal, VS Code | No scene and no colors (they draw no theme). `/world` says why |
| `claude -p`, Agent SDK | Nothing drawn; `/world` answers with the status |

**One theme per session.** Claude Code keeps one theme for each session, whichever mod set it last. poly-world sets its theme when a session starts and on its own commands, and clears it only on `/world off`. If you use another mod that sets a theme, only one of them shows; turn the other one off, or poly-world with `/world off`.

**Time of day:** the sky runs as one 24-hour CSS animation that starts at the current time, so it moves on by itself without redrawing. The mod redraws only when something changes (Claude starts or stops working, music, Clawd's mood, or the window light by the clock). The clock is your computer's local time.

## Commands

| Command | Effect |
|---|---|
| `/world` (or `/world status`) | Status: island and colors on or off, time of day, whether a client draws the look, and what the island reacts to right now |
| `/world on` · `off` | Turn the island (scene and colors) on or off. `off` removes the session's theme |
| `/world colors on` · `off` | Turn the matching app colors on or off; the scene stays |
| `/world time <HH:MM>` · `now` | Preview a time of day (the sky stands still at that time) until `now` or the next chat |
| `/world language [de\|en]` | Switch the language of all installed fynn-mods at once (one line per mod); without a value, show each mod's language |
| `/world help` (or `/world ?`) | Help as a table: commands, state and your settings |

Commands and arguments are English in both languages. `on|off` and `colors on|off` apply in the current chat right away and save the setting (`pluginConfigs` in your user settings). In a terminal session Claude Code reloads the mod with the new value; in the desktop app and `claude -p` the setting is saved through `claude plugin configure poly-world@fynn-mods` and applies in other open chats after `/reload-plugins` or in the next chat. A copy loaded with `--plugin-dir` changes only the current chat and answers "Not saved".

## Configuration

Desktop app: **Settings → Plugins → poly-world → Settings**. Terminal: `/config` → poly-world, or `/plugin configure poly-world`.

| Key | Title | Meaning | Default | Command |
|---|---|---|---|---|
| `enabled` | Show the island | Off removes scene and colors | on | `/world on\|off` |
| `colors` | App colors | Tint the Desktop app to match the island | on | `/world colors on\|off` |
| `language` | Language / Sprache | `en` English, `de` Deutsch | `en` | `/world language de\|en` |

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, turn.start, turn.complete, command.run{command=world}, ui.render{component=CommandOutput, props has {command=world}}, ui.render{component=Backdrop}
calls: $.clock.every, $.clock.now, $.command.register, $.config.list, $.config.set, $.process.run, $.state.get, $.theme.clear, $.theme.set, $.ui.invalidate, $.ui.log, $.ui.resolve
state reads: clawd-buddy.mood, tune-strip.playing
```

In plain language:

- `$.theme.set`: sets the scene and, when on, the colors, in one call, at session start and on `/world on` and `/world colors on|off`. `$.theme.clear`: only on `/world off`, because a clear removes any mod's theme.
- Hook `ui.render` for `Backdrop`: draws the island as an SVG, only for poly-world's own scene (any other mod's backdrop is left alone), only in the desktop and mobile apps.
- Hooks `turn.start`, `turn.complete`: only notice whether Claude (not a subagent) is working, for the smoke. They change nothing.
- `$.state.get`: reads `tune-strip.playing` (whether music plays; no title) and `clawd-buddy.mood` (how tired Clawd is, 0 to 1). Never writes another mod's values. Without these mods the reactions fall away.
- `$.clock.every`, `$.clock.now`: the time of day; a check once a minute redraws only when the phase or the window light changes.
- `$.ui.resolve`, `$.ui.invalidate`, `$.ui.log`: draw, redraw, and write errors to the debug log. `$.command.register`: `/world`. Hook `ui.render` for `CommandOutput`: draws `/world help` as a table.
- `$.config.list`, `$.config.set`: for `/world language`, which changes nothing but the `language` field of the fynn-mods, and for poly-world's own fields (`enabled`, `colors`). Other plugins are left alone.
- `$.process.run`: in the desktop app and `claude -p`, where Claude Code lists no plugin settings, and only these commands: `claude plugin list --json` and `claude plugin configure <mod>@fynn-mods` with `--json` or `--values-stdin --json` (the `language` field of the fynn-mods, or poly-world's own fields). Needs the `claude` CLI on the PATH of the app.

No file system, no network, no model calls (it costs no usage), no tokens or credentials, no environment variables read. An error while drawing leaves the background empty instead of broken.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install poly-world@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install poly-world@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · poly-world`, and in the Desktop app the island appears behind the chat of a new session.

**Update:** `claude plugin update poly-world@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin` (Desktop: **+ → Plugins → Manage plugins**), or run `claude plugin uninstall poly-world@fynn-mods`, then start a new session. If colors stay in the Desktop app, see "Remove mod colors" in the Claude Code mods docs.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/poly-world
```

## Known limitations

- Only the desktop and mobile apps draw the scene; the terminal and VS Code keep their own look.
- One theme per session: another mod that sets a theme replaces poly-world's (and the other way round).
- `--resume` brings no theme back by itself; poly-world sets it again when the session starts.
- The window light from Clawd's mood needs a clawd-buddy version that shares `clawd-buddy.mood`; until then it follows the clock.
- Seasons (snow, blossoms) and Clawd jumping into the scene are planned for a later version.

## Third-party files

`hooks/make-colors.js` and `hooks/make-colors.d.ts` are copied unchanged from the `plugin-authoring` skill that ships with Claude Code, as the [mods documentation](https://code.claude.com/docs/en/plugins/mods/interface#change-the-colors-of-the-desktop-app) tells mod authors to do. They are not written by this project and are not covered by its MIT license.
