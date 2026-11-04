# spotify

**Windows only.** A Spotify player in the band above the prompt: album cover, title, artist, position and clickable controls (restart/previous, play/pause, next). It reads and controls Spotify through the **Windows media controls**. No login, no token, no network, no Spotify API. Only the Spotify session is touched; browsers and other players that show up in the media controls are ignored.

Texts are English by default; set `language` to `de` for German.

Spotify is a trademark of Spotify AB. This is an unofficial hobby mod, not made or endorsed by Spotify; it only talks to the Spotify desktop app through Windows.

Tested with Claude Code **v2.1.295** · Plugin version **0.3.1** · Windows only

## Display

| Surface | Look |
|---|---|
| Desktop Code tab | `full`: its own bar above all other band mods, in the style of the limit-bars (monospace text, orange title, segmented green position bar with the time), three large buttons on the right (restart/previous, play/pause as a white pill in the middle, next; symbols only) and an orange separator line below. Hovering a button names its action in the line above the buttons. With `extraButtons` the bar also shows −15 s, +15 s and, after a gap, shuffle and repeat. `compact`/`mini`: a small place in the band row |
| Terminal | One line, e.g. `♪ Title – Artist 1:23/3:45 ⏮ ⏯ ⏭`, shortened when the window is narrow |

- **Sizes:** `full` (cover, title, position bar, all buttons), `compact` (cover, title, previous/play/next), `mini` (cover and play/pause), `off`. In the terminal `auto` picks the largest size that fits next to the other band mods; Spotify always yields first.
- **Desktop:** the bar (`full`) takes no room from the other mods because it has its own row above them (level 40, above quick-replies and sidekick). `auto` uses the bar, and only the compact size in the row when the room is known and enough. The window width in pixels is not measured yet, so for now `auto` means the bar. `/spotify size compact` or `mini` puts a small version in the band row instead (slot 20, between limit-bars and Clawd; the title is cut to a fixed width).
- **Terminal:** always one slot in the band row (slot 20). Without the other mods it stands alone at the left edge.
- **Nothing to show:** if Spotify is not running, nothing is drawn and no background process runs for it more often than every 15 s.
- **Position:** between two reads the time keeps counting by itself and stops on pause. The bar redraws at most every 5 s (more often it flickers and swallows clicks).
- **Back button:** over 3 s into a track it restarts the track; pressed again right away (position 0) it goes to the previous track, like Spotify's own button. `/spotify prev` always goes to the previous track.
- **Speed:** a click is shown at once (pause, restart, shuffle, repeat), then Windows is asked and the real state corrects it. Control and the read that follows run in one PowerShell start (about 0.8 s); after next or previous the bar jumps back to 0 at once and the script waits only until the new title shows up.

**Runs in:** terminal and the desktop Code tab on Windows. In `claude -p`, the Agent SDK, VS Code and mobile it draws nothing.

## Commands

| Command | Effect |
|---|---|
| `/spotify` | Current track, state and position |
| `/spotify play` · `pause` · `toggle` | Play, pause, switch |
| `/spotify next` · `prev` | Next / previous track |
| `/spotify back` · `forward` | −15 s / +15 s |
| `/spotify shuffle [on\|off]` | Shuffle |
| `/spotify repeat [off\|all\|track]` | Repeat |
| `/spotify size auto\|full\|compact\|mini` | Size, applies in all open chats |
| `/spotify on` · `off` | Show or hide the band |
| `/spotify help` | Help as a table: commands, buttons, state and your settings |

Commands and arguments are English in both languages. `size`, `on` and `off` are saved in the mod's plugin store and override the `userConfig` defaults.

## Configuration

`/config` → spotify:

| Key | Title in `/config` | Meaning | Default |
|---|---|---|---|
| `language` | Language / Sprache | `en` English, `de` Deutsch | `en` |
| `size` | Size | `auto`, `full`, `compact`, `mini`, `off` | `auto` |
| `pollSeconds` | Poll every (seconds) | How often the media controls are read while the band is on screen (3–10) | 4 |
| `extraButtons` | Extra buttons | In the desktop bar also show −15 s, +15 s, shuffle and repeat. The commands work either way | off |

## Rights

`claude plugin validate` shows:

```text
hooks: classic.SessionStart{source=clear|resume|fork}, session.start, command.run{command=spotify}, ui.render{component=CommandOutput, props has {command=spotify}}, ui.render{component=AbovePrompt}
calls: $.clock.every, $.clock.now, $.command.register, $.process.run, $.state.get, $.state.set, $.store.get, $.store.set, $.ui.invalidate, $.ui.resolve
state reads: clawd-buddy.band, limit-bars.band, spotify.playing
state writes: spotify.playing
```

In plain language:

- `$.process.run`: starts Windows PowerShell 5.1 with two fixed scripts, one that reads the Spotify session of the Windows media controls (title, artist, state, position, shuffle, repeat, cover) and one that sends a control command and then reads the same state in the same process. Command, number of seconds and the wait before reading go in only as environment variables, never as script text. The scripts write no files and open no connections.
- `$.state.get`: reads the width that limit-bars and clawd-buddy report for their slot, so Spotify knows how much room is left; and its own `spotify.playing` every 30 s as a fallback check.
- Hook `classic.SessionStart` (only after `/clear`, `/resume`, `/branch`): writes `spotify.playing` again right away, because those commands reset it. Reads nothing from the event.
- `$.state.set` (`spotify.playing`, since 0.3.0): publishes only whether music is playing right now (`{ playing: true | false }`, or null without a Spotify session or when Spotify is off). No title, no artist. clawd-buddy reads it and bobs along. Written from the tick (at most once a second, only on change) and on `/spotify on|off`, never while drawing.
- `$.store.get`, `$.store.set`: the size and on/off settings.
- `$.clock.every`, `$.clock.now`: the poll interval and the running position.
- `$.ui.resolve`, `$.ui.invalidate`: draw and redraw the band. `$.command.register`: `/spotify`.
- Hook `ui.render` for `AbovePrompt`: adds the player to the band and leaves everything else in it as it was. Hook `ui.render` for `CommandOutput`: draws `/spotify help` as a table.

No file system, no network, no tokens or credentials, no environment variables read. Errors in its own drawing leave the band as it was.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install spotify@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install spotify@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · spotify`.

**Update:** `claude plugin update spotify@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall spotify@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/spotify
```

## Known limitations

- Windows only (Windows media controls). Elsewhere `/spotify` says so and nothing is drawn.
- Needs the Spotify desktop app; the web player is not recognized as Spotify.
- Volume, playlists, search and likes are not possible without a Spotify login and are not part of this mod.
- Spotify reports the position only on events, so it is read every few seconds and counted forward in between.
- In the desktop app the band does not choose the compact row size by itself yet (see Display); `auto` uses the bar.
