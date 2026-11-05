# tune-strip

**Windows only.** A music bar for Spotify in the band above the prompt: album cover, title, artist, position and clickable controls (restart/previous, play/pause, next). It reads and controls Spotify through the **Windows media controls**. No login, no token, no network, no Spotify API. Only the Spotify session is touched; browsers and other players that show up in the media controls are ignored.

Texts are English by default; set `language` to `de` for German, or run `/tune language de` in a terminal session to switch all fynn-mods at once.

Spotify is a trademark of Spotify AB. This is an unofficial hobby mod, not made or endorsed by Spotify; it only talks to the Spotify desktop app through Windows.

Since 0.6.0 it also finds the **beat** of the song (tempo, where the beats fall, and whether the song is calm, groove/hip-hop, hard or sad) so that clawd-buddy can nod along in time. **Spotify's audio is analysed locally for tempo only; nothing is recorded, stored or sent.** Only Spotify is listened to, never the rest of your system sound. Turn it off with `/tune beat off`.

Tested with Claude Code **v2.1.318** · Plugin version **0.8.1** · Windows only

## Display

| Surface | Look |
|---|---|
| Desktop Code tab | `full`: its own bar above all other band mods, in the style of the limit-bars (monospace text, orange title, segmented green position bar with the time), three large buttons on the right (restart/previous, play/pause as a white pill in the middle, next; symbols only) and an orange separator line below. Hovering a button names its action in the line above the buttons. With `extraButtons` the bar also shows −15 s, +15 s and, after a gap, shuffle and repeat. `compact`/`mini`: a small place in the band row |
| Terminal | One line, e.g. `♪ Title – Artist 1:23/3:45 ⏮ ⏯ ⏭`, shortened when the window is narrow |

- **Sizes:** `full` (cover, title, position bar, all buttons), `compact` (cover, title, previous/play/next), `mini` (cover and play/pause), `off`. In the terminal `auto` picks the largest size that fits next to the other band mods; tune-strip always yields first.
- **Desktop:** the bar (`full`) takes no room from the other mods because it has its own row above them (level 40, above quick-replies and sidekick). `auto` uses the bar, and only the compact size in the row when the room is known and enough. The window width in pixels is not measured yet, so for now `auto` means the bar. `/tune size compact` or `mini` puts a small version in the band row instead (slot 20, between limit-bars and Clawd; the title is cut to a fixed width).
- **Terminal:** always one slot in the band row (slot 20). Without the other mods it stands alone at the left edge.
- **Nothing to show:** if Spotify is not running, nothing is drawn and no background process runs for it more often than every 15 s.
- **Position:** between two reads the time keeps counting by itself and stops on pause. The bar redraws at most every 5 s (more often it flickers and swallows clicks); in between, the image itself counts on: the time ticks every full second and the bar fills segment by segment (SMIL, up to 15 s ahead, no extra redraws).
- **Back button:** over 3 s into a track it restarts the track; pressed again right away (position 0) it goes to the previous track, like Spotify's own button. `/tune prev` always goes to the previous track.
- **Speed:** a click is shown at once (pause, restart, shuffle, repeat), then Windows is asked and the real state corrects it. Control and the read that follows run in one PowerShell start (about 0.8 s); after next or previous the bar jumps back to 0 at once and the script waits only until the new title shows up.

**Runs in:** terminal and the desktop Code tab on Windows. In `claude -p`, the Agent SDK, VS Code and mobile it draws nothing.

## Beat (for clawd-buddy)

- **What it does:** while Spotify plays and the band is on screen, a small helper (Windows PowerShell 5.1 with a fixed C# text that ships inside the mod) listens to **Spotify's own audio only** through Windows process loopback (Windows 10 version 2004 or later). Every 2.5 s it reports a line of numbers: tempo, the time of the last beat and a few sound features (bass and treble share, brightness, how dense the attacks are). From these the mod works out the tempo (60–150 bpm; faster songs count at half speed), where the beats fall, and the group of the song: `calm`, `groove` (groove and hip-hop), `hard` or `sad` (since 0.7.0; in practice slow ballads with a soft beat).
- **What it shares:** `tune-strip.beat` = `{ bpm, at, sure, group }`, or `null` without a beat. No title, no artist, no raw numbers. clawd-buddy reads it; the group `sad` (0.7.0) needs **clawd-buddy 0.12.0**, so update both together (0.11.0 would ignore the whole value).
- **Nothing kept:** the helper holds at most the last 20 s of numbers in memory (and 1024 audio samples for the analysis). It writes no file of its own, opens no connection and records nothing. (When it starts, Windows PowerShell compiles the C# text with the C# compiler built into Windows, which briefly uses temporary files for that code; no audio is ever written.) If listening to Spotify alone is not possible, there is simply no beat; it never falls back to the whole system sound.
- **When it runs:** only on Windows, only while Spotify plays and tune-strip draws its band, and only with beat detection on (default). It stops at the latest 15 s after a pause, after the band is no longer drawn, and within a few seconds after `/tune off` or `/tune beat off`; it always ends with the session. If it breaks, it is restarted at most three times (after 5, 20 and 60 s), then only with the next track. Each visible chat runs its own helper. Measured: about 1.5 % of one CPU core.
- **After a track change** the beat is gone for a moment and comes back after about 6–9 s; the group is decided after about 15 s of a song and only changes when another group holds for 30 s (a calm intro before the drop).
- **Headphones:** Bluetooth headphones play the sound later than Windows hands it over (often 150–250 ms). If Clawd nods too early, shift the beat with `/tune beat offset 200` (positive = later, −400 to 400 ms).

## Commands

| Command | Effect |
|---|---|
| `/tune` | Current track, state and position |
| `/tune play` · `pause` · `toggle` | Play, pause, switch |
| `/tune next` · `prev` | Next / previous track |
| `/tune back` · `forward` | −15 s / +15 s |
| `/tune shuffle [on\|off]` | Shuffle |
| `/tune repeat [off\|all\|track]` | Repeat |
| `/tune size auto\|full\|compact\|mini` | Size, applies in all open chats |
| `/tune on` · `off` | Show or hide the band |
| `/tune beat` | One line about the beat detection: state, tempo, sure or not, group, clarity, offset |
| `/tune beat on` · `off` | Beat detection on or off (applies in all open chats) |
| `/tune beat offset <ms>` | Shift the beat for headphones, −400 to 400 ms (positive = later; applies in all open chats) |
| `/tune language [de\|en]` | Switch the language of **all** installed fynn-mods at once (clawd-buddy, cost-ledger, limit-bars, quick-replies, sidekick, tune-strip), one line per mod in the answer; without a value, show each mod's current language. Applies right away: Claude Code reloads each mod it changes. In the desktop app and `claude -p`, where Claude Code lists no plugin settings, it goes through `claude plugin configure` instead (since 0.5.1): saved for the next chat, and right away in the current one after `/reload-plugins`. Works on any system, since it does not touch Spotify |
| `/tune help` | Help as a table: commands, buttons, state and your settings |

Commands and arguments are English in both languages. `size`, `on`, `off`, `beat on|off` and the offset are saved in the mod's plugin store and override the `userConfig` defaults.

## Configuration

`/config` → tune-strip:

| Key | Title in `/config` | Meaning | Default |
|---|---|---|---|
| `language` | Language / Sprache | `en` English, `de` Deutsch | `en` |
| `size` | Size | `auto`, `full`, `compact`, `mini`, `off` | `auto` |
| `pollSeconds` | Poll every (seconds) | How often the media controls are read while the band is on screen (3–10) | 4 |
| `extraButtons` | Extra buttons | In the desktop bar also show −15 s, +15 s, shuffle and repeat. The commands work either way | off |

## Rights

`claude plugin validate` shows:

```text
hooks: classic.SessionStart{source=clear|resume|fork}, session.start, command.run{command=tune}, ui.render{component=CommandOutput, props has {command=tune}}, ui.render{component=AbovePrompt}
calls: $.clock.every, $.clock.now, $.command.register, $.config.list, $.config.set, $.process.run, $.process.spawn, $.state.get, $.state.set, $.store.get, $.store.set, $.ui.invalidate, $.ui.resolve
state reads: clawd-buddy.band, limit-bars.band, quick-replies.band, tune-strip.beat, tune-strip.playing
state writes: tune-strip.beat, tune-strip.playing
```

In plain language:

- `$.process.run`: starts Windows PowerShell 5.1 with two fixed scripts, one that reads the Spotify session of the Windows media controls (title, artist, state, position, shuffle, repeat, cover, and the process id of the Spotify app) and one that sends a control command and then reads the same state in the same process. Command, number of seconds and the wait before reading go in only as environment variables, never as script text. The scripts write no files and open no connections.
- `$.process.spawn` (since 0.6.0): the beat helper, `powershell.exe -MTA` with one fixed start line; the fixed C# text goes in through standard input, the Spotify process id only as an environment variable (checked to be a number). It listens to the Spotify process tree only and prints only numbers. **Spotify's audio is analysed locally for tempo only; nothing is recorded, stored or sent.**
- `$.state.set`, `$.state.get` (`tune-strip.beat`, since 0.6.0): tempo, beat time, sure or not, and the group for clawd-buddy; no title. Written outside drawing, only on a clear change (tempo by more than 1 %, beat by more than 40 ms, sure or group different), otherwise at most every 15 s.
- `$.state.get`: reads the width that limit-bars and clawd-buddy report for their slot, so tune-strip knows how much room is left, and whether quick-replies shows its pill (`quick-replies.band`, since 0.7.1) for the separator line; and its own `tune-strip.playing` every 30 s as a fallback check.
- Hook `classic.SessionStart` (only after `/clear`, `/resume`, `/branch`): writes `tune-strip.playing` again right away, because those commands reset it. Reads nothing from the event.
- `$.state.set` (`tune-strip.playing`, since 0.3.0): publishes only whether music is playing right now (`{ playing: true | false }`, or null without a Spotify session or when tune-strip is off). No title, no artist. clawd-buddy reads it and bobs along. Written from the tick (at most once a second, only on change) and on `/tune on|off`, never while drawing.
- `$.store.get`, `$.store.set`: the size, on/off, beat on/off and offset settings.
- `$.clock.every`, `$.clock.now`: the poll interval and the running position.
- `$.ui.resolve`, `$.ui.invalidate`: draw and redraw the band. `$.command.register`: `/tune`.
- `$.config.list`, `$.config.set`: only for `/tune language` (since 0.5.0). Reads the settings rows and changes nothing but the `language` field of the six fynn-mods; other plugins and other fields are left alone.
- `$.process.run` (also): for `/tune language` in the desktop app and `claude -p` (since 0.5.1), and only these commands: `claude plugin list --json` (which fynn-mods are installed and on) and `claude plugin configure <mod>@fynn-mods` with `--json` (read the current language) or `--values-stdin --json` with `{"language":"de"}` or `"en"`, for the six fynn-mods only. Needs the `claude` CLI on the PATH of the app. It saves the settings of `tune-strip@fynn-mods`; if your desktop app loads the mod under another plugin ID (such as `tune-strip@inline`), that copy keeps its language. An organization policy that blocks `$.process.run` refuses the whole mod.
- Hook `ui.render` for `AbovePrompt`: adds the player to the band and leaves everything else in it as it was. Hook `ui.render` for `CommandOutput`: draws `/tune help` as a table.

No file system, no network, no tokens or credentials, no environment variables read. Errors in its own drawing leave the band as it was.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install tune-strip@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install tune-strip@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · tune-strip`.

**Coming from `spotify`:** up to 0.3.1 this mod was called `spotify` and its command was `/spotify`. The marketplace maps the old name to the new one, so your settings move over. To switch, run `claude plugin marketplace update fynn-mods` and then once `claude plugin install tune-strip@fynn-mods` (for a marketplace added from GitHub, Claude Code needs this one install to fetch the renamed plugin). If `spotify` still shows up in `/plugin` afterwards, remove it there. The command is now `/tune`; if a size or `off` set with `/spotify size` is gone, set it again with `/tune size` or `/tune off`.

**Update:** `claude plugin update tune-strip@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall tune-strip@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/tune-strip
```

## Known limitations

- Windows only (Windows media controls). Elsewhere `/tune` says so and nothing is drawn; only `/tune language` works there.
- **After the mod reloads** (settings changed, `/tune language`), the bar stays empty until the first read of the media controls is back, then it is drawn again.
- Needs the Spotify desktop app; the web player is not recognized as Spotify.
- Volume, playlists, search and likes are not possible without a Spotify login and are not part of this mod.
- Spotify reports the position only on events, so it is read every few seconds and counted forward in between.
- In the desktop app the band does not choose the compact row size by itself yet (see Display); `auto` uses the bar.
- **Beat:** needs Windows 10 version 2004 or later. Ballads and songs without a clear beat are often reported as not sure; then Clawd bobs at his own fixed tempo. Very fast songs count at half speed. The groups are tuned on 57 songs and can be wrong for a song in between; calm and sad are the hardest to tell apart: in the test set 12 of 16 sad songs were found, and one gentle happy song counted as sad. Since 0.7.2 a song only counts as sad when it also sounds soft, so rap with a weak beat no longer gets the sad moves.
