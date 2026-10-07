# quick-replies

After Claude answers, Claude Code often suggests your next message itself (the grey text in the prompt). quick-replies turns that suggestion into a button in its own pill above Clawd, in the band above the prompt. A click, typing its digit as the first character in an empty prompt, or sending just its digit as a message sends it immediately as your message. Nothing is ever sent automatically. On request (`/replies more on`) a fork of the session fills up to four places in total; Claude Code's own suggestion stays on `1`. Handy for development and debugging, where the answer is often just "yes, do that".

Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.291** · Plugin version **0.4.1**

## Display

| Surface | Look |
|---|---|
| Desktop Code tab | Its own pill with a dimmed rounded border and one blank line above Clawd, the limit bars and the cache ring, which stay unchanged below |
| Terminal | Compact, without border or spacing, above the rest of the band |

- **Layout:** a single suggestion stands alone in its row. From two suggestions on, **2 × 2** (left `1`/`3`, right `2`/`4`) if the longest label fits into half the width, otherwise one per row. The `layout` setting can force either.
- **Labels** are at most 40 characters, shortened with `…`. That only affects Claude Code's own suggestion, which is shown in full as grey text in the prompt and is sent in full.
- **The pill only shows** when a turn has finished since your last message, at least one suggestion exists, the prompt is empty and the mod is on. It disappears while Claude is working, while you type, during a survey in the band, while a subagent transcript is open, and after `/clear` until the next answer. Without a pill the band keeps its height; quick-replies never moves Clawd or the bars.
- **Stability:** if suggestions are already shown and you typed or clicked within the last 2 s, newly arriving suggestions wait until 2 s of quiet. If nothing is shown yet, a new suggestion appears at once.
- While sidekick shows its own row in the band (starting a new chat), the pill is hidden.

**Runs in:** terminal and the desktop Code tab. In `claude -p`, the Agent SDK, VS Code and mobile it draws nothing and makes no model calls.

## Sending

- **Click** a suggestion, or **type its digit** (`1`–`4`) as the first character in an empty prompt: the suggestion is sent right away as your own message. The digit does not end up in the prompt. The digits also work as the band's hotkeys.
- **Send just the digit** (`1`–`4`, nothing else) as a message, e.g. when the digit stayed in the prompt: instead of the digit, the suggestion with that number is sent, and the transcript shows its text. This works only for a suggestion the pill has shown since Claude's last answer, while the mod is on, and never for a message typed while Claude is working, with attachments, or from another source (Remote Control, plugins, other sessions). Otherwise the digit is sent as typed. If another hook stops the message, the pill comes back.
- Only on click or key, **never automatically**. A suggestion is sent at most once per turn (click and digit in quick succession send once).
- After `/clear`, a suggestion from the old chat is never sent into the new one.
- If sending fails, a toast shows **Sending failed. Please send it yourself: …** with the text, and the pill comes back.

## Sources

1. **Claude Code's own suggestion** (one per turn) is always on `1`. quick-replies only reads it; the grey suggestion in the prompt stays as it is. Without it (and with `more` off) there is no pill.
2. **More suggestions from a fork** (only with `more` on): after each answer of the main session, quick-replies asks a fork of the session (full chat context, the session's model and prompt cache) for up to four likely next messages. Claude Code's own suggestion always takes place `1`; the fork's move down one place and the fourth is dropped (if it repeats one of them, the fourth stays). If the fork answers first, its four are shown and shift when Claude Code's suggestion arrives (not within 2 s of your last input). A message that starts with `/` runs as a slash command (observed, not documented), so the fork is told to start a suggestion with `/` only when it means to run that command; when a suggestion only talks about a command, the command is put in quotes (“/replies” in `en`, „/replies“ in `de`). The fork is asked to write them in the configured language (`language`), in your voice, short and concrete. Suggestions longer than 40 characters are dropped, not shortened, so nothing is sent that the button does not show. Duplicates are removed (ignoring case and punctuation), and model output is cleaned (control sequences and invisible characters removed; text with hidden Unicode tag characters is dropped). If the fork fails, gives no answer or returns nothing usable, only Claude Code's suggestion remains, without a toast.

The fork only runs after a normal answer of at least 40 characters, not for subagents, aborted or failed turns, and only where the band is drawn. If a new turn starts first, the pending fork is skipped.

**Cost:** `more` is **off by default**. When it is on, every answer triggers one `$.model.fork` of the session, roughly the cost of one short answer, mostly read from the prompt cache. It counts toward your own usage (on a subscription, toward your usage limits). `/replies status` shows what the fork used in the current chat: calls, tokens, the share read from the cache, and an estimate in dollars at API prices (price table copied from cost-ledger, unknown models priced like Opus 5.5). On a subscription that dollar figure is only a yardstick. The count starts over after `/clear`.

## Command

| Command | Effect |
|---|---|
| `/replies` or `/replies status` | On/off, `more` on/off, the current suggestions with their source, fork state, the fork calls in this chat with their estimated cost, how often Claude Code supplied a suggestion in this session, surface, band width, layout and position in the band |
| `/replies on` · `/replies off` | Turn the mod on or off |
| `/replies more on` · `/replies more off` | Turn the extra fork suggestions on or off |

`on`/`off` and `more on|off` are saved in the mod's plugin store, so they apply in all projects and sessions. Every session rereads them after each answer, so a change takes effect everywhere from the next answer on. They override the `userConfig` defaults.

## Configuration

`/config` → quick-replies:

| Key | Title in `/config` | Meaning | Default |
|---|---|---|---|
| `language` | Language / Sprache | Language of the mod's texts and of the fork's suggestions: `en` English, `de` German | `en` |
| `more` | More suggestions via fork | Besides Claude Code's suggestion, ask a fork of the session for suggestions after every answer, up to four in total; Claude Code's own stays first. Costs roughly one short answer per answer, mostly from the cache. `/replies more on\|off` overrides it for all sessions | off |
| `layout` | Layout | `auto`: 2 × 2 if the labels fit, otherwise one per row. `grid`: always 2 × 2. `list`: always one per row | `auto` |

### Language

`language` switches everything the mod writes: the `/replies` output, the command description and the toast. With `more` on, it also sets the language the fork writes its suggestions in. The fork's question itself is always English. Claude Code's own suggestion is not affected; it comes in whatever language Claude Code uses. Default is `en`; set `de` for German, e.g. in `/config` → quick-replies. Commands and arguments (`on`, `off`, `more on|off`, `status`) are English in both languages.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, turn.start, turn.complete, prompt.suggest, prompt.edit, prompt.submit, command.run{command=replies}, ui.render{component=AbovePrompt}
calls: $.clock.every, $.command.register, $.model.fork, $.prompt.submit, $.session.id, $.store.get, $.store.set, $.ui.invalidate, $.ui.log, $.ui.resolve, $.ui.toast
```

In plain language:

- Hook `prompt.suggest`: reads Claude Code's own suggestion and passes it on unchanged.
- Hook `prompt.edit`: notices whether you are typing; a single digit typed into the empty prompt while the pill shows sends that suggestion. Any other input passes through unchanged.
- Hook `prompt.submit`: this hook sees every message you send and could change it. quick-replies only replaces a message that is just a digit `1`–`4` with the suggestion shown under that number, before the turn starts. Every other message passes through unchanged and is not stored or logged.
- Hooks `turn.start`, `turn.complete`: clear the suggestions when you send, mark when an answer is finished.
- Hook `ui.render` for `AbovePrompt`: draws the pill above the rest of the band.
- Hook `command.run` and `$.command.register`: the `/replies` command.
- `$.prompt.submit` (as your message): sends a suggestion, only on click or key.
- `$.model.fork`: the extra suggestions, only with `more` on (off by default).
- `$.clock.every`: one-shot timers to start the fork outside the hook and for the 2-s quiet period after input.
- `$.session.id`: suggestions per session; detects `/clear`.
- `$.store.get`, `$.store.set`: the on/off settings.
- `$.ui.resolve`, `$.ui.invalidate`: draw and redraw the pill. `$.ui.toast`: message when sending fails. `$.ui.log`: errors to the debug log.

No file system, no processes, no network, no environment variables, no tokens or credentials. Every event hook passes the result of the chain on unchanged; errors in its own drawing leave the band as it was.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install quick-replies@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install quick-replies@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · quick-replies`.

**Update:** `claude plugin update quick-replies@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall quick-replies@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/quick-replies
```

## Known limitations

- **No suggestion, no pill.** Claude Code does not always provide a suggestion (for example on the first turn or with a cold cache). Then there is no pill, unless `more` is on and the fork delivers something. `/replies status` shows how often Claude Code supplied one in this session.
- **Language switch and the command description:** after changing `language` in `/config`, the `/replies` output and the toast switch right away; the description of `/replies` in the command list may only switch in the next session.
- **Messages starting with a digit:** while the pill shows, a message cannot start with a digit from `1` to the number of suggestions; typing it sends the suggestion instead. A digit after other text, a higher digit, or a digit pasted together with more text stays normal text. Likewise, a message that is only such a digit is sent as the suggestion, not as the digit; this also applies when Claude offered numbered options in its answer. Write `1.` or `option 1` to send the number itself.
- **Order in the band is not documented.** Claude Code does not define in which order mods that draw into the band run, and with marketplace installs the order is not guaranteed. The pill sits above Clawd when quick-replies runs as the outer band mod. The other band mods from fynn-mods (clawd-buddy, limit-bars, sidekick) share a small layout protocol that keeps the pill on top in either order. With other band mods that do not know it, quick-replies may end up inside them, and the buttons then appear squeezed next to their content (e.g. next to Clawd). quick-replies cannot prevent that from inside. `/replies status` shows the position.
- **Hover flicker in the desktop app:** next to animated mods in the band (e.g. clawd-buddy's Clawd), the buttons can flicker under the mouse. Clicks still work.

## Credits

The idea of forking the session to ask for more next-message suggestions comes from the community plugin `next-steps` (anthropics/claude-plugins-community). The prompt, output cleaning and everything else are an independent implementation; no code was taken from it.
