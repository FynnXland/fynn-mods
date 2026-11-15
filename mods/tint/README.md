# tint

A calm color set for the **Claude Desktop app** (Code tab), in light and dark mode. Colors only: no background, no scene, nothing that moves. Choose one of three sets, or [take the colors of your own design system](#use-your-own-design-system):

| Set | Light | Dark | Accent |
|---|---|---|---|
| `herbstglut` (default) | warm paper with wood-brown text | lantern-warm text on night blue | maple orange |
| `rose-pine` | Rosé Pine **Dawn** | Rosé Pine **Moon** | Iris |
| `nord` | Nord **Snow Storm** with Polar Night text | Nord **Polar Night** with Snow Storm text | Frost |

Every set keeps the main text at 7:1 or better and muted text at 4.5:1 or better on every surface, in both modes. Texts are English by default; set `language` to `de` for German, or run `/tint language de`.

Requires Claude Code **2.1.324 or later** · Tested with Claude Code **v2.1.325** · Plugin version **0.2.1**

## Use your own design system

Tell Claude where your design system is, in any session with tint installed:

> Take the colors from my design system in `design/tokens.json` into the app.

It can be a Tailwind config, CSS variables, a Figma or design-token export, a brand guide, a URL, or a design system on claude.ai (if the session has a tool that reads it). Claude reads it with its own tools, maps its colors onto tint's anchors (page, cards, panels, three text tones, accent and status colors) and hands them to tint's tool `save_colors`. The skill `tint:import` tells it how.

- tint checks every set like its built-in ones: main text 7:1 or better and muted text 4.5:1 or better on every surface, and nothing the app would refuse to paint. If something fails, nothing is saved and Claude gets the list with the values; it fixes them, at most three rounds.
- If the design system has no dark mode, Claude derives one from its darkest neutrals and says so.
- Claude takes only colors from the design system and tells you at the end which color came from where.
- The set is saved under its name and applied right away. Choose it later with `/tint <name>`, delete it with `/tint remove <name>`. You can keep up to 20 own sets.
- In the settings, `palette` = `custom` means "the own set chosen last"; the settings list cannot show your own names.

## Where it shows

| Surface | What you see |
|---|---|
| Desktop app, Code tab | The chosen color set, following the app's light or dark mode |
| Mobile app | The colors, as far as the app paints them |
| Terminal, VS Code | Their own colors (they draw no theme). `/tint` says why |
| `claude -p`, Agent SDK | Nothing; `/tint` answers with the status |

**One theme per session.** Claude Code keeps one theme for each session, whichever mod set it last. tint sets its colors when a session starts and on its own commands, and clears them only on `/tint off`. If another mod sets a theme, only one of them shows; turn the other one off, or tint with `/tint off`.

## Commands

| Command | Effect |
|---|---|
| `/tint` (or `/tint status`) | Status: color set, on or off, whether a client that draws themes is attached (or why not), color samples for light and dark, and your own sets with their source |
| `/tint herbstglut` · `rose-pine` · `nord` | Choose a color set; applies in this chat right away and is saved |
| `/tint <name>` · `/tint custom` | Choose one of your own sets (`custom` = the one chosen last) |
| `/tint remove <name>` | Delete one of your own sets; if it was in use, Herbstglut applies |
| `/tint on` · `off` | Apply the colors, or go back to the app's own (`off` clears the session's theme) |
| `/tint language [de\|en]` | Switch the language of **all** installed fynn-mods at once (clawd-buddy, cost-ledger, limit-bars, quick-replies, sidekick, tint, tune-strip), one line per mod in the answer; without a value, show each mod's language |
| `/tint help` (or `/tint ?`) | Help as a table: commands, state and your settings |

Commands and arguments are English in both languages. A choice saves the setting (`pluginConfigs` in your user settings). In a terminal session Claude Code reloads the mod with the new value; in the desktop app and `claude -p` the setting is saved through `claude plugin configure tint@fynn-mods` and applies in other open chats after `/reload-plugins` or in the next chat. A copy loaded with `--plugin-dir` changes only the current chat and answers "Not saved". Choosing a set while tint is off saves it and applies it with `/tint on`.

## Configuration

Desktop app: **Settings → Plugins → tint → Settings**. Terminal: `/config` → tint, or `/plugin configure tint`. A change there applies from the next chat; `/tint <name>` applies now.

| Key | Title | Meaning | Default | Command |
|---|---|---|---|---|
| `enabled` | Apply colors | Off leaves the app's own colors | on | `/tint on\|off` |
| `palette` | Color set | `herbstglut`, `rose-pine`, `nord`, or `custom` (your own set chosen last) | `herbstglut` | `/tint <name>` |
| `language` | Language / Sprache | `en` English, `de` Deutsch | `en` | `/tint language de\|en` |

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, tool.call{tool=mcp__tint__save_colors}, command.run{command=tint}, ui.render{component=CommandOutput, props has {command=tint}}
calls: $.command.register, $.config.list, $.config.set, $.process.run, $.store.delete, $.store.get, $.store.set, $.theme.clear, $.theme.set, $.tool.register, $.ui.log
```

In plain language:

- `$.theme.set`: sets the colors of the chosen set (never a background), at session start, on `/tint on` and on `/tint <name>`. `$.theme.clear`: only on `/tint off`, because a clear removes any mod's theme.
- `$.tool.register` and hook `tool.call` on `mcp__tint__save_colors`: the tool Claude hands a design system's colors to. It waits behind ToolSearch, so it costs no context until it is needed. tint checks and saves what it gets, and answers every call.
- `$.store.get`, `$.store.set`, `$.store.delete`: your own sets (`sets`) and the one chosen (`active`), in tint's own store, shared by all sessions.
- `$.command.register`: `/tint`. Hook `ui.render` for `CommandOutput`: draws `/tint` (with color samples) and `/tint help` in the terminal and the desktop app.
- `$.config.list`, `$.config.set`: for `/tint language`, which changes nothing but the `language` field of the fynn-mods, and for tint's own fields (`enabled`, `palette`). Other plugins are left alone.
- `$.process.run`: in the desktop app and `claude -p`, where Claude Code lists no plugin settings, and only these commands: `claude plugin list --json` and `claude plugin configure <mod>@fynn-mods` with `--json` or `--values-stdin --json` (the `language` field of the fynn-mods, or tint's own fields). Needs the `claude` CLI on the PATH of the app.
- `$.ui.log`: errors go to the debug log.

No file system, no network, no model calls (it costs no usage), no tokens or credentials, no environment variables read, no other mod's state.

## Privacy

tint reads no files and opens no network connection. When you import a design system, Claude reads it with its own tools, under the session's permissions, as with any other request. tint only gets the hex colors, the set's name and a short note on the source, and keeps them in its store in your Claude Code configuration directory. Nothing leaves your computer through tint.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install tint@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install tint@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · tint`, and in the Desktop app a new session takes the colors of the chosen set.

**Update:** `claude plugin update tint@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** run `/tint off` first, then disable it under **Installed** in `/plugin` (Desktop: **+ → Plugins → Manage plugins**), or run `claude plugin uninstall tint@fynn-mods`, then start a new session. If colors stay in the Desktop app, see "Remove mod colors" in the Claude Code mods docs.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/tint
```

## Known limitations

- Only the desktop and mobile apps paint the colors; the terminal and VS Code keep their own.
- One theme per session: another mod that sets a theme replaces tint's (and the other way round).
- An own set has one accent and one set of status colors for both modes; tint derives the light and dark shades from them.
- Rosé Pine and Nord also name their code highlighting themes (`rose-pine-dawn`, `rose-pine-moon`, `nord` for dark). The app uses them only if it offers a theme by that name; otherwise code is colored from the set's roles.
- A few minor contrasts (borders, switches, filled buttons, the yellow fill in light mode, diff text on its tinted diff background) stay under the design system's own values. Body text is not affected. In dark mode Rosé Pine and Nord color diffs from their own palette, so diff text stays readable on their lighter dark surfaces.

## Palettes and licenses

- **Rosé Pine**: colors from the official palette, [rose-pine/palette](https://github.com/rose-pine/palette) (`palette.json`, variants Dawn and Moon; see also [rosepinetheme.com](https://rosepinetheme.com/palette/)). MIT License, Copyright (c) mvllow.
- **Nord**: colors from the official palette, [nordtheme.com](https://www.nordtheme.com/docs/colors-and-palettes) ([nordtheme/nord](https://github.com/nordtheme/nord)). MIT License, Copyright (c) 2016-present Sven Greb.
- **Herbstglut** is this project's own color set.

tint uses the palettes' hex values, not their code. To keep text readable, a few tones in between are mixed from palette colors (for example muted text in Rosé Pine, and muted text plus light red and violet text in dark Nord); `hooks/palettes.ts` names each one.

## Third-party files

`hooks/make-colors.js` and `hooks/make-colors.d.ts` are copied unchanged from the `plugin-authoring` skill that ships with Claude Code, as the [mods documentation](https://code.claude.com/docs/en/plugins/mods/interface#change-the-colors-of-the-desktop-app) tells mod authors to do. They are not written by this project and are not covered by its MIT license.
