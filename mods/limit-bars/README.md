# limit-bars

Two slim bars on the left of the band above the prompt show live how much of the 5-hour and the weekly limit is used and when each window resets. Next to them, a ring shows how long this chat's prompt cache stays warm. On top of that comes a cache guard: a question before an expensive cold send, a notice shortly before the cache expires, and the commands `/cache`, `/handoff` and `/keepwarm`. Optionally, a second ring shows how full a drive is, split by file type, with `/disk` for the details (Windows, off by default). Everything fits next to Clawd (clawd-buddy).

Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.295** · Plugin version **0.7.2**

## Display

| Surface | Appearance |
|---|---|
| Desktop app's Code tab (main surface) | One image, 242 × 56 px (ring only: 58 × 56; with the storage ring 302 × 56), left of Clawd and aligned to the bottom. Stacked: on top `5h 71% · in 2 h 14 min`, below it `7d 18% · Mon 09:00`, each with a segmented bar (44 segments). The cache ring sits to the right, the storage ring after it |
| Terminal | 2 lines, both windows side by side, at most 44 columns: the label on top, a bar made of `▄` below. When space gets tight it switches to short forms (`71% 2h14`), then shows only 5h, then nothing. The cache block (`◔ 42m`, `○ cold`) and the storage block (`Storage 114G/801G`) follow if they fit; the storage block goes first, then the cache block |

- **Color** of the fill and the percentage: green below 60 %, yellow from 60 %, red from 85 %. The empty part is dark grey, the `5h`/`7d` tag orange (#D77757).
- **From `highlightAt`** (default 90 %) the tag and percentage turn bold. From 100 % it reads `full` and the bar is all red.
- **After a reset**, until a new measurement arrives: `0% · fresh`, dimmed, with an empty bar.
- **Before Claude Code knows the limits** (new chat, before the first reply), the desktop app shows empty, dimmed bars with `5h –` and `7d –`, and the ring shows `–`. In the terminal the bars only appear once there are values.
- **Data source:** `$.session.usage()` at start and every 10 s, plus every measurement (`session.measure`, after each turn). `usage()` returns the values of the latest API response, so it updates even in the middle of a long turn. The 10 s tick polls but only redraws when a displayed number or color changes (otherwise buttons of other mods in the band flicker); it stops when the band is no longer drawn.

Runs in: the desktop app's Code tab and the terminal. In `claude -p`, the Agent SDK, VS Code and mobile it draws nothing and starts no tick.

## Cache ring

Every message sends the whole conversation. Served from the prompt cache that is cheap; once the cache has expired, the next message writes everything again. Example with Opus 5.5 at 400k context: warm ≈ $0.08, cold ≈ $3.20 (API value; on a subscription it counts against your quota, there is no bill).

- **Ring:** 28 segments; the filled part is the remaining cache time, emptying clockwise from 12 o'clock. In the middle the remaining time (`42m`), below it the context size (`412k`): grey below 80k, orange from 80k, red from "big" (`/cache big`, default 150k). The ring itself only shows the cache state.
- **Colors:** green = warm · yellow = last 5 min (with a 5-minute cache, the last minute) · cold is grey, from "big" (default 150k) all red · `–` before the first request · a small dot in the middle = being kept warm.
- **Cache duration:** default 60 min (measured on a subscription: after a 6.8 min pause the cache was read, not rewritten). The mod re-checks: a cache hit after a pause of more than 5.5 min confirms 60, a rewrite after 5.5 to 60 min indicates 5. Override with `/cache ttl 5|60|auto`.
- **Data source:** every request of the main loop (`turn.step`; subagents don't count), and between turns `$.session.usage()` on the 10 s tick. The state is kept in `$.store` under `cache:<session ID>`, so the ring knows how warm the cache is after a restart. Entries older than 7 days are deleted at start.

## Storage ring

Off by default. Set `storagePath` in `/config` → limit-bars to a drive, for example `E:\`, and a ring appears to the right of the cache ring. **Windows only for now**; on other systems, or with a path without a drive letter, nothing is drawn.

- **Label:** `Storage` above the ring (like `Cache` above the cache ring).
- **Ring in the band:** the whole ring is the used space, split by file type in a fixed order: programs & libraries (blue), media (rose), AI models & data (ochre), code & text (teal), archives & packages (lavender), other (grey). Like the cache ring it is made of 28 segments with small gaps; the colors are soft tones in the style of the bars. In the middle the used space (`114G`), below it the drive size (`/801G`). Sizes are binary, as in Windows Explorer. Before the first scan the ring is grey.
- **`/disk`:** the ring larger and for the whole drive: the file types in color, the free space in grey. Next to it a legend: size and share of the used space per file type, plus free space and its share of the drive, the time of the scan and the number of files. In the terminal it is a bar of `█` with the legend below; in `claude -p` and VS Code it is a Markdown table.
- **Grouping:** by file extension (`.dll`, `.exe` … programs; `.mp4`, `.wav`, `.png` … media; `.pth`, `.gguf`, `.safetensors` … models; `.py`, `.ts`, `.json` … code; `.zip`, `.apk`, `.pack` … archives). Everything else, files without an extension, and what is used but not readable by the scan (system files, recycle bin) count as "other".
- **Data source:** Windows PowerShell (`powershell.exe`, built into Windows) runs two fixed, read-only scripts via `$.process.run`. The drive path is passed only as the environment variable `LB_PATH`, never as part of the script. The quick query (size and free space, about 0.2 s) runs at start and every 10 minutes while the band is drawn. The scan by file type reads every folder of the drive (sizes only, no file contents; about 10 s for 560,000 files) and runs once a day after the first session start in the background, and with `/disk` when the last scan is older than an hour. `/disk refresh` always scans. If another session is scanning right now, `/disk` says so and does not start a second scan. The result is kept in `$.store` under `storage`.

## Customize

Every part of the display can be shown or hidden on its own. **The storage ring is off by default**: it only appears once you set `storagePath`.

| Part | Setting (`/config` → limit-bars) | Command | Default |
|---|---|---|---|
| 5-hour bar | `showFiveHour` | `/bars show 5h on\|off` | on |
| Weekly bar | `showWeekly` | `/bars show week on\|off` | on |
| Cache ring | `showCache` | `/bars show cache on\|off` | on |
| Storage ring | `showStorage` (and `storagePath`) | `/bars show storage on\|off` | off (no `storagePath`) |

- **Two ways, one rule:** a value set with `/bars` wins over the setting. `/bars reset` drops all command values, so the settings apply again. `/bars` alone shows what is on and where each value comes from.
- **`/bars` applies to all open chats** (stored in `$.store`, picked up within 10 s). **Settings** are read when the plugin loads. After changing them under `/plugin` → Configure options, Claude Code runs `/reload-plugins` when you close the panel (if that would invalidate the prompt cache, it asks first and leaves the change pending; `/reload-plugins --force` applies it). After `claude plugin configure`, restart Claude Code. Other open chats keep the old values until they reload.
- **Hiding the cache ring only hides the ring.** The question before a cold send, the notice before expiry, `/cache`, `/handoff` and `/keepwarm` keep working; turn them off with `/cache warn off` and `/cache hints off`.
- **Hiding the storage ring** stops the background queries and scans (no PowerShell). `/disk` still scans when you call it and `storagePath` is set. `/bars show storage on` without `storagePath` tells you where to set it.
- **Everything hidden:** limit-bars draws nothing and keeps no space free in the band; other mods (clawd-buddy, quick-replies) use the full width.
- Short forms and German aliases: `/bars 5h off`, `/bars woche aus`, `/bars speicher an`, `/bars cache aus`.
- `onlyFiveHour` still works (on = weekly bar hidden) but is deprecated; use `showWeekly`.

## Commands

| Command | What it does |
|---|---|
| `/cache` | Everything at a glance: state and remaining time, cache duration and its source, model, context, cost of the next message warm and cold, last request (read/written), cold restarts in this session, session cost, limits, keep-warm, settings |
| `/cache ttl 5`, `ttl 60`, `ttl auto` · `warn on`/`off` · `big 150k` (big threshold) · `hints on`/`off` (notice before expiry) | Settings, stored in `$.store`; they apply immediately in all open chats |
| `/handoff` | Claude writes a short handoff (≤ 400 words) with the skill `uebergabe`, in the language set in `language`. Then the mod asks: **New chat with handoff** clears this chat (`/clear`; the old one stays reachable via `/resume`) and sends the handoff as the first message, so the cache starts small. **Keep working here** leaves everything as it is |
| `/handoff continue` · `/handoff show` | Apply the last handoff afterwards (clear and continue with it), or show it (the last 3 are kept in `$.store`) |
| `/keepwarm [hours]` · `/keepwarm off` | Keep the cache warm, default 2 h, at most 4 h. **Off by default**, because every ping costs quota. `/keepwarm` without a number turns off a running keep-warm |
| `/disk` · `/disk refresh` | Drive usage by file type, as a ring with a legend (see [Storage ring](#storage-ring)). Scans again if the last scan is older than an hour, or always with `refresh` |
| `/bars` · `/bars show 5h\|week\|cache\|storage on\|off` · `/bars reset` | Show or hide parts of the display in all open chats (see [Customize](#customize)) |
| `/bars help` · `/bars ?` | All commands, features and settings at a glance, with their current state and how to switch them. In the terminal and the desktop app a drawn table with headings in the theme's warning color (yellow, follows light and dark); in `claude -p` and VS Code the same as Markdown. It shows the state at the moment you call it; call it again after switching something |
| `/cache help` · `/handoff help` · `/keepwarm help` · `/disk help` | Answer only with "All commands: `/bars help`". `/handoff help` does not start a handoff |

The German arguments of earlier versions still work: `warnung an|aus`, `gross`/`groß`, `hinweise an|aus` (and the older `guard`, `alerts`), `/handoff weiter|zeigen`, `/keepwarm aus`. An unknown argument names the possible ones and points to `/bars help`.

**Question before a cold send:** If the cache is cold and the chat is big (≥ 150k), the next typed message asks **Send anyway** · **Compact first** · **Cancel**, with the cost in the question text. Compacting also reads everything once and saves little with a cold cache; the mod then holds the message back, compacts, and sends it afterwards on its own (this option is not offered with attachments or `@file` in the text, because they would be missing when resent). If you close the dialog, the message goes out unchanged (fail-open). Slash commands, messages during a turn, and messages from plugins never trigger the question.

**Notice shortly before expiry:** When a big chat enters the yellow phase, a notice appears once: keep going right away → just write; stopping → run `/handoff` now while it is cheap; coming back to this chat later → `/keepwarm`. The handoff pays off **before** expiry: with a cold cache, writing the handoff itself already rereads everything.

**Keep-warm and cost:** A ping via `$.model.fork` reads the cache about 8 min before it expires (with a 5-minute cache, 90 s before), i.e. roughly every 52 min. At 400k context that is ≈ $0.08 per ping, over 3 h ≈ $0.30 instead of $3.20 for a rewrite. Useful, for example, when a background render runs longer than 60 min and you continue in the same chat afterwards. If a ping rewrites instead of reading, or gets no reply, keep-warm turns itself off and tells you. The `/cache` settings apply to all chats. After `/clear` or a restart keep-warm is off.

The cache guard is modeled on Cache Keeper by Nate Herk (MIT); the skill `uebergabe` is based on its `session-handoff` skill. It has an English and a German template; `/handoff` passes the language as the skill's argument. See `THIRD-PARTY-NOTICES.md` in this folder.

## Configuration

`/config` → limit-bars:

| Key | Title in `/config` | Meaning | Default |
|---|---|---|---|
| `language` | Language / Sprache | `en`: English · `de`: German. Covers the bars, the ring, `alt` texts, `/cache`, `/handoff`, `/keepwarm`, questions, notices, and the language of the handoff the skill writes | `en` |
| `resetStyle` | Reset display | `mixed`: 5h as a countdown, week as a clock time · `clock`: both as clock times · `countdown`: both as countdowns | `mixed` |
| `highlightAt` | Highlight from (%) | from this percentage the tag and value are bold (50 to 100) | 90 |
| `showFiveHour` | Show 5-hour bar | the bar for the 5-hour limit | on |
| `showWeekly` | Show weekly bar | the bar for the weekly limit | on |
| `showCache` | Show cache ring | the cache ring (the cache guard stays) | on |
| `showStorage` | Show storage ring | the storage ring; only shown with `storagePath` | on |
| `onlyFiveHour` | 5-hour limit only (deprecated) | on: weekly bar hidden; use `showWeekly` instead | off |
| `storagePath` | Storage drive | drive for the storage ring, for example `E:\` (Windows only); empty: no storage ring and no PowerShell | empty |

## Language

- `language` is `en` by default. Set it to `de` in `/config` → limit-bars for German texts (`71 %`, `Mo 09:00`, `≈ 3,30 $`, `/cache` card in German).
- Formats: en `71%`, `Mon 09:00`, `in 2 d 4 h`, `≈ $3.30`, `1.2M`; de `71 %`, `Mo 09:00`, `in 2 T 4 h`, `≈ 3,30 $`, `1,2M`.
- Commands and arguments are English in both languages; the German arguments stay valid as aliases.
- The settings titles in `/config` are English only.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, turn.step, turn.complete, session.compact, prompt.submit, command.run{command=cache}, command.run{command=handoff}, command.run{command=keepwarm}, command.run{command=bars}, command.run{command=disk}, ui.render{component=CommandOutput, props has {command=bars}}, ui.render{component=CommandOutput, props has {command=disk}}, session.measure, ui.render{component=AbovePrompt}
calls: $.clock.every, $.clock.now, $.command.list, $.command.register, $.command.run, $.model.fork, $.process.run, $.prompt.submit, $.session.compact, $.session.id, $.session.usage, $.store.delete, $.store.get, $.store.keys, $.store.set, $.ui.ask, $.ui.invalidate, $.ui.resolve, $.ui.toast
```

No file system access of its own, no network, no environment variables read, no tokens or credentials. The only process is Windows PowerShell for the storage ring, and only when `storagePath` is set. In the terminal band, limit-bars passes on the space it uses to the mods further in (smaller `bodyColumns`).

In plain language:

- `$.session.usage`: limits, context size and session cost at start and on every tick (without `breakdown`, free)
- Hook `session.measure`: takes the percentage and reset time of `five_hour` and `seven_day` after every measurement
- Hook `turn.step`: reads, for every request of the main loop, how much was read from the cache and how much was written; changes nothing
- Hook `turn.complete`: notes the end of a turn and captures the reply of the handoff turn
- Hook `session.compact`: notes a compaction (the first request afterwards does not count as a cold restart)
- Hook `prompt.submit`: the question before a cold send (only for a big chat with a cold cache), otherwise passes through unchanged
- Hooks `command.run` for `cache`, `handoff`, `keepwarm`, `disk`, `bars` and `$.command.register`: the five commands
- `$.process.run`: only with `storagePath` set, `powershell.exe` with the two fixed, read-only scripts of the storage ring (size and free space; sizes by file extension)
- Hook `ui.render` for `CommandOutput` of `disk`: draws the ring with the legend in place of the Markdown row of `/disk`
- Hook `ui.render` for `CommandOutput` of `bars`: draws the help table in place of the Markdown row of `/bars help` (new in 0.7.0); other `/bars` rows stay Markdown
- `$.command.list`, `$.command.run`: find and start the skill `uebergabe` (with the language as its argument); `/clear` for "clear and continue"
- `$.prompt.submit`: the handoff as the first message in the cleared chat, or the held-back message after compacting
- `$.session.compact`: **Compact first** in the question
- `$.model.fork`: only with `/keepwarm` on, the keep-warm ping
- `$.session.id`, `$.store.*`: per-chat state, settings, `/bars` values, last 3 handoffs; cleanup after 7 days
- `$.ui.ask`, `$.ui.toast`: questions and notices
- `$.ui.invalidate`, `$.ui.resolve`: redraw; components `Box`, `Text`, `Svg`
- `$.clock.now`, `$.clock.every`: time of day; 10 s tick while the band is drawn; 30 s tick only while keeping warm; one-shot timers to start commands outside a hook

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install limit-bars@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install limit-bars@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · limit-bars`.

**Update:** `claude plugin update limit-bars@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall limit-bars@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/limit-bars
```

## Working with clawd-buddy

Both mods draw into the same band above the prompt. Claude Code does not define the order in which they run; either way, the bars end up left of Clawd, aligned to the bottom. In the terminal, Clawd gets the width that is left after the bars.

## Known limitations

- **Before the first API response** Claude Code knows no limits; the bars appear with the first response (at most 10 s later). The CLI queries at startup by itself, the desktop app apparently only with the first message.
- **Clawd on the left** (clawd-buddy `side: left`): the bars and Clawd can both end up on the left. There is no separate option for this.
- **Countdown in both windows** (`resetStyle: countdown`): the long forms need up to 46 columns. The terminal then shows the short forms (`2h14`, `2d23h`), the desktop app always the long forms.
- **Commands from hooks:** Claude Code rejects `$.command.run`, `$.prompt.submit` and `$.session.compact` from inside a running hook. `/handoff`, "clear and continue" and **Compact first** therefore run a moment later via a one-shot timer.
- **Notice shortly before expiry** only appears while this chat's band is being drawn (10 s tick). Keep-warm has its own tick and also runs without the band.
- **Cache estimate:** the ring counts from the start of the last main-loop request. If something else reads the same cache, it does not see that.
- **Fixed colors in the desktop image:** the Svg is an image and does not follow the theme. The grey `#9A9A9A` and the level colors are chosen for the dark theme; legibility in the light theme has not been checked yet.
- **Exactly 100 %?** It is not documented whether an exhausted 5-hour or weekly window reports exactly 100. `full` applies from ≥ 100; 99.6 % shows `99%`.
- **Terminal narrower than 53 columns:** no bars.
- **Giving up space in the terminal** relies on observed behavior: Claude Code's type definitions call `bodyColumns` read-only but allow rewriting props, and current Claude Code versions accept it. If a later version rejects it, a single render fails and limit-bars then stacks its 2 lines above the rest (the band gets 2 lines taller).
- **Storage ring on a folder:** `storagePath` is a directory picker. If you pick a folder instead of the drive root, the ring still shows the whole drive; only that folder is scanned, and the rest of the used space counts as "other".
- **Windows folder:** PowerShell is started by its full path `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`. If Windows is installed elsewhere, the storage ring stays empty and `/disk` shows the error.
- **Storage ring and `$.process`:** Claude Code's type definitions mark `$.process` as "CLI only". It ran in the CLI; if a surface refuses it, the storage ring is simply missing and `/disk` reports the error.
- **Scan duration:** about 10 to 20 s for 560,000 files on an SSD. A network drive mapped to a letter is scanned too and can hit the 2-minute limit; after a failed scan, automatic scans pause for 24 h (`/disk refresh` still works).
- **Time zone:** the clock-time display uses the local time of the hooks runtime (`new Date`). Which time zone that is, is not documented; check that `Mon 09:00` matches your own clock.
