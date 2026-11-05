# limit-bars

Two slim bars on the left of the band above the prompt show live how much of the 5-hour and the weekly limit is used and when each window resets. Next to them, a ring shows how long this chat's prompt cache stays warm. On top of that comes a cache guard: a question before an expensive cold send, a notice shortly before the cache expires, and the commands `/cache`, `/handoff` and `/keepwarm`. Optionally, a second ring shows how full a drive is, split by file type, with `/disk` for the details (Windows, off by default). With [cost-ledger](../cost-ledger/README.md) installed, a cost ring shows what this chat and the whole project cost in API value. Optional system values show CPU, RAM, GPU load and GPU memory live, each with a trend arrow (Windows, off by default). Everything fits next to Clawd (clawd-buddy).

Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.318** · Plugin version **0.14.0**

## Display

| Surface | Appearance |
|---|---|
| Desktop app's Code tab (main surface) | One image, 242 × 56 px (ring only: 58 × 56; with the storage ring 302 × 56), left of Clawd and aligned to the bottom. Since 0.13.1 it is drawn on top of Clawd where the two overlap (clawd-buddy 0.12.1 or later walks behind the row instead of being pushed aside). Stacked: on top `5h 71% · in 2 h 14 min`, below it `7d 18% · Mon 09:00`, each with a segmented bar (44 segments). The cache ring sits to the right, then the storage ring, the cost ring and the system values (bars, cache, cost and system values 385 × 56; rings, cost and system values 297 × 56). The percentage sits right after the number (`41%`); the `·` behind it stays in the same place from `5%` to `100%`/`full` |
| Terminal | 2 lines, both windows side by side, at most 44 columns: the label on top, a bar made of `▄` below. When space gets tight it switches to short forms (`71% 2h14`), then shows only 5h, then nothing. The cache block (`◔ 42m`, `○ cold`), the storage block (`Storage 114G/801G`), the cost block (`Cost $14/$883`) and the system values (two columns, `CPU   34%▲` above `GPU    6%`, `RAM   61%` above `VRAM  57%`) follow if they fit within the 44 columns. When space gets tight, the system values go first, then storage, then cost, then cache; only after that do the bars shorten |

- **Color** of the fill and the percentage: green below 60 %, yellow from 60 %, red from 85 %. The empty part is dark grey, the `5h`/`7d` tag orange (#D77757).
- **From `highlightAt`** (default 90 %) the tag and percentage turn bold. From 100 % it reads `full` and the bar is all red.
- **After a reset**, until a new measurement arrives: `0% · fresh`, dimmed, with an empty bar.
- **Before Claude Code knows the limits** (new chat, before the first reply), the desktop app shows empty, dimmed bars with `5h –` and `7d –`, and the ring shows `–`. In the terminal the bars only appear once there are values.
- **Data source:** `$.session.usage()` at start and every 2 s, plus every measurement (`session.measure`, after each turn). `usage()` returns the values of the latest API response, so it updates even in the middle of a long turn. The 2 s tick polls but only redraws when a displayed number or color changes (otherwise buttons of other mods in the band flicker); it stops when the band is no longer drawn.
- **No 5-hour limit:** some plans report only the weekly window. After two readings in a row without a 5-hour window (one is not enough: single readings without it also happened while the window was running), the top line shows the **weekly pace** instead of an empty bar: `5h ∞ · +12% pace`, below it `lasts until Fri 14:00` (when 100 % would be reached at the current pace, rounded down to 15 min) or `forecast 78%` (the share at the reset). In the first 6 hours of a week it reads `week fresh`. A line on the weekly bar marks even use (where you would be if you spread the week evenly): orange while your usage is below it, red once it has reached it. In the desktop app it has a thin edge in a darker shade of the same color and reaches well above the bar and a little below it. Colors: grey up to 5 points over even use (and below it), orange above, red when 100 % would be reached more than a day before the reset. The 5-hour bar returns as soon as a reading contains the window again. The `5h` switch (`/bars show 5h off`) hides the pace line as well. The count is shared between chats (`limits.miss` in `$.store`), so new chats show the pace right away.
- **Shared between chats:** `usage()` only knows this chat's latest API response. When it changes, the chat stores the reading with its time in `$.store` under `limits`; every chat on this computer takes the newest reading on its next tick. Usage in one Claude Code chat therefore shows up in all open chats within about 2 s. Usage on claude.ai or another device shows up only with this chat's next response.

Runs in: the desktop app's Code tab and the terminal. In `claude -p`, the Agent SDK, VS Code and mobile it draws nothing and starts no tick.

## Cache ring

Every message sends the whole conversation. Served from the prompt cache that is cheap; once the cache has expired, the next message writes everything again. Example with Opus 5.5 at 400k context: warm ≈ $0.08, cold ≈ $3.20 (API value; on a subscription it counts against your quota, there is no bill).

- **Ring:** 28 segments; the filled part is the remaining cache time, emptying clockwise from 12 o'clock. In the middle the remaining time (`42m`), below it the context size (`412k`): grey below 80k, orange from 80k, red from "big" (`/cache big`, default 150k). The ring itself only shows the cache state.
- **Colors:** green = warm · yellow = last 5 min (with a 5-minute cache, the last minute) · cold is grey, from "big" (default 150k) all red · `–` before the first request · a small dot in the middle = being kept warm.
- **Cache duration:** default 60 min (measured on a subscription: after a 6.8 min pause the cache was read, not rewritten). The mod re-checks: a cache hit after a pause of more than 5.5 min confirms 60, a rewrite after 5.5 to 60 min indicates 5. Override with `/cache ttl 5|60|auto`.
- **Data source:** every request of the main loop (`turn.step`; subagents don't count), and between turns `$.session.usage()` on the 2 s tick. The state is kept in `$.store` under `cache:<session ID>`, so the ring knows how warm the cache is after a restart. Entries older than 7 days are deleted at start.

## Storage ring

Off by default. Set `storagePath` in `/config` → limit-bars to a drive, for example `E:\`, and a ring appears to the right of the cache ring. **Windows only for now**; on other systems, or with a path without a drive letter, nothing is drawn.

- **Label:** `Storage` above the ring (like `Cache` above the cache ring).
- **Ring in the band:** the whole ring is the used space, split by file type in a fixed order: programs & libraries (blue), media (rose), AI models & data (ochre), code & text (teal), archives & packages (lavender), other (grey). Like the cache ring it is made of 28 segments with small gaps; the colors are soft tones in the style of the bars. In the middle the used space (`114G`), below it the drive size (`/801G`). Sizes are binary, as in Windows Explorer. Before the first scan the ring is grey.
- **`/disk`:** the ring larger and for the whole drive: the file types in color, the free space in grey. Next to it a legend: size and share of the used space per file type, plus free space and its share of the drive, the time of the scan and the number of files. In the terminal it is a bar of `█` with the legend below; in `claude -p` and VS Code it is a Markdown table.
- **Grouping:** by file extension (`.dll`, `.exe` … programs; `.mp4`, `.wav`, `.png` … media; `.pth`, `.gguf`, `.safetensors` … models; `.py`, `.ts`, `.json` … code; `.zip`, `.apk`, `.pack` … archives). Everything else, files without an extension, and what is used but not readable by the scan (system files, recycle bin) count as "other".
- **Data source:** Windows PowerShell (`powershell.exe`, built into Windows) runs two fixed, read-only scripts via `$.process.run`. The drive path is passed only as the environment variable `LB_PATH`, never as part of the script. The quick query (size and free space, about 0.2 s) runs at start and every 10 minutes while the band is drawn. The scan by file type reads every folder of the drive (sizes only, no file contents; about 10 s for 560,000 files) and runs once a day after the first session start in the background, and with `/disk` when the last scan is older than an hour. `/disk refresh` always scans. If another session is scanning right now, `/disk` says so and does not start a second scan. The result is kept in `$.store` under `storage`.

## Cost ring

Shows what this chat cost compared with the whole project, as API value. The numbers come from [cost-ledger](../cost-ledger/README.md), the same as `/ledger here all`; without cost-ledger, or before it has a value, there is no ring and no space is kept free.

- **Ring:** 28 segments like the cache ring, `Cost` on top. Filled in Claude orange is this chat's share of the project, clockwise from 12 o'clock; below 1 % one segment stays visible so the ring is never empty while the chat has cost something. In the middle this chat's amount (`$0.40`, `$14`, from 1,000 `$1.2k`), below it the project total (`/$883`). German: `0,40$`, `/883$`.
- **Project unknown** (a script run, or no folder): grey ring, the chat amount in the middle, `–` below.
- **Honest label:** the image's `alt` text and `/bars` say "API value", since when it is recorded and, with sync, on how many devices. On a subscription this counts against your quota; it is not a bill.
- **Data source:** the session value `cost-ledger.here` (`$.state`), read while drawing. Whenever cost-ledger writes it (after every answer and mod call, at most once per cent of change), the band redraws. Same ring in both styles (`bar` and `ring`).

## System values

Off by default. `/bars show cpu on` (or `showSystem`) shows up to four lines to the right of the other rings: `CPU`, `RAM`, `GPU` (load) and `VRAM` (GPU memory in use). **Windows only for now**; elsewhere nothing is drawn and `/bars show cpu on` says so. The `GPU` line works with any graphics card whose driver provides the Windows GPU counters (NVIDIA, AMD, Intel); `VRAM` needs an NVIDIA card (`nvidia-smi`) and is missing otherwise.

- **Lines:** the tag in orange, the percentage right-aligned so all numbers line up, and a grey arrow: `▲` when the value rose by at least 2 points since the reading a second earlier, `▼` when it fell. Colors like the limit bars: green below 60 %, yellow from 60 %, red from 85 %. GPU memory matters because a full card spills into RAM.
- **Live:** one reading every second. The band redraws as soon as a whole percentage or an arrow changes, and not otherwise. There is no animation between readings: it would need the next reading and so lag a second behind.
- **Terminal:** two columns of two lines, `CPU` above `GPU` and `RAM` above `VRAM`, numbers in the same column.
- **Data source:** one Windows PowerShell process per chat (`$.process.spawn`) with one fixed, read-only script and no arguments or environment from outside. It writes a line every second: CPU as processor time between two raw readings (`Win32_PerfRawData_PerfOS_Processor`), RAM as used share of visible memory (`Win32_PerfRawData_PerfOS_Memory`), GPU load as Task Manager computes it (since 0.13.2): busy time from the raw counters `Win32_PerfRawData_GPUPerformanceCounters_GPUEngine`, summed over all processes per physical engine, the busiest engine wins. `nvidia-smi` (fixed path) only supplies GPU memory, because its own load figure measures something else (about 30 % when Task Manager showed 75 %). WMI class names are the same in every Windows language. It costs about 1–3 % of one CPU core (the PowerShell process about 13 ms per second; the Windows WMI service adds a little).
- **Lifetime:** the process runs only while the band is drawn and the system values are on, and ends with `/bars show cpu off`, when the band has not been drawn for 15 s (hidden chat), or after 30 minutes (the next tick starts a new one).
- **Errors:** `/bars` shows the latest reading and the last failure. A process that ends without a reading counts as a failed start; the next try comes after a minute, and after three in a row measuring pauses for an hour.

## Customize

Every part of the display can be shown or hidden on its own. **The storage ring is off by default**: it only appears once you set `storagePath`.

| Part | Setting (`/config` → limit-bars) | Command | Default |
|---|---|---|---|
| 5-hour bar | `showFiveHour` | `/bars show 5h on\|off` | on |
| Weekly bar | `showWeekly` | `/bars show week on\|off` | on |
| Cache ring | `showCache` | `/bars show cache on\|off` | on |
| Storage ring | `showStorage` (and `storagePath`) | `/bars show storage on\|off` | off (no `storagePath`) |
| Cost ring | `showCost` | `/bars show cost on\|off` | on (only with cost-ledger) |
| System values | `showSystem` | `/bars show cpu on\|off` | off |
| Style: bars or rings | `style` | `/bars style bar\|ring` | bar |

- **Two ways, one rule:** a value set with `/bars` wins over the setting. `/bars reset` drops all command values, so the settings apply again. `/bars` alone shows what is on and where each value comes from.
- **`/bars` applies to all open chats** (stored in `$.store`, picked up within 2 s). **Settings** are read when the plugin loads. After changing them under `/plugin` → Configure options, Claude Code runs `/reload-plugins` when you close the panel (if that would invalidate the prompt cache, it asks first and leaves the change pending; `/reload-plugins --force` applies it). After `claude plugin configure`, restart Claude Code. Other open chats keep the old values until they reload.
- **Hiding the cache ring only hides the ring.** The question before a cold send, the notice before expiry, `/cache`, `/handoff` and `/keepwarm` keep working; turn them off with `/cache warn off` and `/cache hints off`.
- **Hiding the storage ring** stops the background queries and scans (no PowerShell). `/disk` still scans when you call it and `storagePath` is set. `/bars show storage on` without `storagePath` tells you where to set it.
- **Everything hidden:** limit-bars draws nothing and keeps no space free in the band; other mods (clawd-buddy, quick-replies) use the full width.
- **Rings** (`style: ring`, desktop app only): one ring per limit in the style of the cache ring, `5h` and `7d` in orange on top, the percentage in the middle, the reset in small type below. Without a 5-hour limit: `5h ∞` with the pace as text, then the weekly ring with a small notch at even use. Rings take less width than the bars (5h, week and cache: 154 × 56 px). The terminal always keeps the bars; `/bars style ring` there saves the value and says so.
- **Hiding the system values** ends their PowerShell process.
- Short forms and aliases: `/bars 5h off`, `/bars woche aus`, `/bars speicher an`, `/bars cache aus`, `/bars kosten aus`, `/bars system on`, `/bars ram on`, `/bars style kreis`, `/bars style balken`.
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
| `/bars` · `/bars show 5h\|week\|cache\|storage\|cost\|cpu on\|off` · `/bars style bar\|ring` · `/bars reset` | Show or hide parts of the display in all open chats (see [Customize](#customize)) |
| `/bars language [de\|en]` | Switch the language of **all** installed fynn-mods at once (clawd-buddy, cost-ledger, limit-bars, quick-replies, sidekick, tune-strip), one line per mod in the answer; without a value, show each mod's current language. Applies right away: Claude Code reloads each mod it changes (see [Known limitations](#known-limitations) for what a reload resets). In the desktop app and `claude -p`, where Claude Code lists no plugin settings, it goes through `claude plugin configure` instead (since 0.11.1): saved for the next chat, and right away in the current one after `/reload-plugins` |
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
| `showCost` | Show cost ring | the cost ring; only shown with cost-ledger | on |
| `showSystem` | Show system values | CPU, RAM, GPU load and GPU memory (Windows only) | off |
| `style` | Style | `bar`: bars · `ring`: one ring per limit (desktop app only; the terminal keeps the bars) | `bar` |
| `onlyFiveHour` | 5-hour limit only (deprecated) | on: weekly bar hidden; use `showWeekly` instead | off |
| `storagePath` | Storage drive | drive for the storage ring, for example `E:\` (Windows only); empty: no storage ring and no PowerShell | empty |

## Language

- `language` is `en` by default. Set it to `de` in `/config` → limit-bars for German texts (`Mo 09:00`, `Mo 09:00`, `≈ 3,30 $`, `/cache` card in German), or run `/bars language de` in a terminal session to switch all fynn-mods at once.
- Formats: en `71%`, `Mon 09:00`, `in 2 d 4 h`, `≈ $3.30`, `1.2M`; de `71%` (limits; since 0.13.0 without a space in both languages), `Mo 09:00`, `in 2 T 4 h`, `≈ 3,30 $`, `1,2M`.
- Commands and arguments are English in both languages; the German arguments stay valid as aliases.
- The settings titles in `/config` are English only.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, turn.step, turn.complete, session.compact, prompt.submit, command.run{command=cache}, command.run{command=handoff}, command.run{command=keepwarm}, command.run{command=bars}, command.run{command=disk}, ui.render{component=CommandOutput, props has {command=bars}}, ui.render{component=CommandOutput, props has {command=disk}}, session.measure, ui.render{component=AbovePrompt}
calls: $.clock.every, $.clock.now, $.command.list, $.command.register, $.command.run, $.config.list, $.config.set, $.model.fork, $.process.run, $.process.spawn, $.prompt.submit, $.session.compact, $.session.id, $.session.usage, $.state.get, $.state.set, $.store.delete, $.store.get, $.store.keys, $.store.set, $.ui.ask, $.ui.invalidate, $.ui.resolve, $.ui.toast
state reads: cost-ledger.here, sidekick.status
state writes: limit-bars.band
```

No file system access of its own (no `$.fs`), no network, no environment variables read, no tokens or credentials. Processes: Windows PowerShell for the storage ring, only when `storagePath` is set, and for the system values, only while they are on and the band is drawn; and the `claude` CLI (`claude plugin list` / `claude plugin configure`) for `/bars language` in the desktop app and `claude -p`. That scan does walk the whole drive you named and reads sizes and file extensions (never file contents). In the terminal band, limit-bars passes on the space it uses to the mods further in (smaller `bodyColumns`).

In plain language:

- `$.state.set`: tells the tune-strip mod how wide the bars are (`limit-bars.band`, a width in pixels), so tune-strip can make room for them. Written at session start and when the display changes, never while drawing. Nothing else reads it.
- `$.state.get` (`state reads: cost-ledger.here`, since 0.12.0): reads the chat and project cost that cost-ledger provides, for the cost ring. Amounts, the first day of recording, the number of devices and the project's folder name; nothing is written back.
- `$.session.usage`: limits, context size and session cost at start and on every tick (without `breakdown`, free)
- Hook `session.measure`: takes the percentage and reset time of `five_hour` and `seven_day` after every measurement
- Hook `turn.step`: reads, for every request of the main loop, how much was read from the cache and how much was written; changes nothing
- Hook `turn.complete`: notes the end of a turn and captures the reply of the handoff turn
- Hook `session.compact`: notes a compaction (the first request afterwards does not count as a cold restart)
- Hook `prompt.submit`: the question before a cold send (only for a big chat with a cold cache), otherwise passes through unchanged
- Hooks `command.run` for `cache`, `handoff`, `keepwarm`, `disk`, `bars` and `$.command.register`: the five commands
- `$.process.run`: only with `storagePath` set, `powershell.exe` with the two fixed, read-only scripts of the storage ring (size and free space; sizes by file extension)
- `$.process.spawn` (since 0.13.0): only with the system values on and on Windows, one long-running `powershell.exe` by its full path with one fixed, read-only script (processor time, used memory, GPU engine busy time, and `nvidia-smi` at its fixed path for GPU memory), one line per second; ended as described under [System values](#system-values)
- Hook `ui.render` for `CommandOutput` of `disk`: draws the ring with the legend in place of the Markdown row of `/disk`
- Hook `ui.render` for `CommandOutput` of `bars`: draws the help table in place of the Markdown row of `/bars help` (new in 0.7.0); other `/bars` rows stay Markdown
- `$.state.get` (also `state reads: sidekick.status`, since 0.14.0): reads sidekick's level (`off`, `cache`, `guide`) when the cache guard is about to ask; nothing else of sidekick's.
- `$.command.list`, `$.command.run`: find and start the skill `uebergabe` (with the language as its argument); `/clear` for "clear and continue"; since 0.14.0 also whether `/sidekick` can be run right now (sidekick loaded)
- `$.config.list`, `$.config.set`: only for `/bars language` (since 0.11.0). Reads the settings rows and changes nothing but the `language` field of the six fynn-mods; other plugins and other fields are left alone
- `$.process.run` (also): for `/bars language` in the desktop app and `claude -p` (since 0.11.1), and only these commands: `claude plugin list --json` (which fynn-mods are installed and on) and `claude plugin configure <mod>@fynn-mods` with `--json` (read the current language) or `--values-stdin --json` with `{"language":"de"}` or `"en"`, for the six fynn-mods only. Needs the `claude` CLI on the PATH of the app. It saves the settings of `limit-bars@fynn-mods`; if your desktop app loads the mod under another plugin ID (such as `limit-bars@inline`), that copy keeps its language. An organization policy that blocks `$.process.run` refuses the whole mod.
- `$.prompt.submit`: the handoff as the first message in the cleared chat, or the held-back message after compacting
- `$.session.compact`: **Compact first** in the question
- `$.model.fork`: only with `/keepwarm` on, the keep-warm ping
- `$.session.id`, `$.store.*`: per-chat state, settings, `/bars` values, last 3 handoffs, the newest limit reading shared between chats; cleanup after 7 days
- `$.ui.ask`, `$.ui.toast`: questions and notices
- `$.ui.invalidate`, `$.ui.resolve`: redraw; components `Box`, `Text`, `Svg`
- `$.clock.now`, `$.clock.every`: time of day; 2 s tick while the band is drawn; 30 s tick only while keeping warm; one-shot timers to start commands outside a hook

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

## Working with sidekick

Since 0.14.0 the cache guard steps aside for [sidekick](../sidekick/README.md): when sidekick runs on a level where it asks before a cold send itself (`cache` or `guide`), limit-bars does not ask as well, so you never get two dialogs in a row. `/cache` and `/bars help` then show the guard as "on (sidekick is asking right now)".

- limit-bars only checks this right before it would ask (big chat, cold cache): sidekick's level from `sidekick.status`, and whether `/sidekick` is available right now. That second check matters because the level may stay in the session after sidekick is turned off.
- No level, `off`, sidekick not loaded, or any read error: limit-bars asks as before.
- Your own setting is never changed. If you turned the guard off with `/cache warn off`, it stays off, with or without sidekick.
- limit-bars checks that sidekick is set to ask, not that sidekick asks for this very message. Known gaps where nobody asks:
  - The two mods have separate settings: "big" (`/cache big` here, sidekick's own; both default 150k) and the cache lifetime (`/cache ttl` here, sidekick's `/sidekick ttl`; both default 60 min). If limit-bars' values are lower, nobody asks in between.
  - You change sidekick's level in another session: the first cold message in this one may still go through without a question.
  - sidekick's hook is skipped or sidekick's module fails alone while `/sidekick` stays listed.

## Working with clawd-buddy

Both mods draw into the same band above the prompt. Claude Code does not define the order in which they run; either way, the bars end up left of Clawd, aligned to the bottom. In the terminal, Clawd gets the width that is left after the bars.

## Known limitations

- **Before the first API response** Claude Code knows no limits; the bars appear with the first response (at most 2 s later), or right away with the newest reading of another chat on this computer. The CLI queries at startup by itself, the desktop app apparently only with the first message.
- **Clawd on the left** (clawd-buddy `side: left`): the bars and Clawd can both end up on the left. There is no separate option for this.
- **Countdown in both windows** (`resetStyle: countdown`): the long forms need up to 46 columns. The terminal then shows the short forms (`2h14`, `2d23h`), the desktop app always the long forms.
- **Commands from hooks:** Claude Code rejects `$.command.run`, `$.prompt.submit` and `$.session.compact` from inside a running hook. `/handoff`, "clear and continue" and **Compact first** therefore run a moment later via a one-shot timer.
- **Notice shortly before expiry** only appears while this chat's band is being drawn (2 s tick). Keep-warm has its own tick and also runs without the band.
- **After the mod reloads** (`/bars language` or another mod's language command, `/reload-plugins`, changed settings), a running `/keepwarm` picks up again: its end time and ping count are kept in the mod's store (since 0.11.0), so it also continues when you resume the chat before that end time. If you open the same chat in a second window while the first is still running, both send keep-warm pings; `/keepwarm off` stops it only in the window where you run it. The cold-restart count and the last request on the `/cache` card start over, and the notice before expiry can come once more. The cache ring's state, the `/bars` and `/cache` settings, the limits and the storage reading are kept.
- **Cache estimate:** the ring counts from the start of the last main-loop request. If something else reads the same cache, it does not see that.
- **Fixed colors in the desktop image:** the Svg is an image and does not follow the theme. The grey `#9A9A9A` and the level colors are chosen for the dark theme; legibility in the light theme has not been checked yet.
- **Exactly 100 %?** It is not documented whether an exhausted 5-hour or weekly window reports exactly 100. `full` applies from ≥ 100; 99.6 % shows `99%`.
- **Terminal narrower than 53 columns:** no bars.
- **Giving up space in the terminal** relies on observed behavior: Claude Code's type definitions call `bodyColumns` read-only but allow rewriting props, and current Claude Code versions accept it. If a later version rejects it, a single render fails and limit-bars then stacks its 2 lines above the rest (the band gets 2 lines taller).
- **Storage ring on a folder:** `storagePath` is a directory picker. If you pick a folder instead of the drive root, the ring still shows the whole drive; only that folder is scanned, and the rest of the used space counts as "other".
- **Windows folder:** PowerShell is started by its full path `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`. If Windows is installed elsewhere, the storage ring stays empty and `/disk` shows the error.
- **Storage ring and `$.process`:** Claude Code's type definitions mark `$.process` as "CLI only". It ran in the CLI; if a surface refuses it, the storage ring is simply missing and `/disk` reports the error. The system values depend on it the same way: if `$.process.spawn` is refused, the lines show `–`, `/bars` shows the error, and after three failed starts measuring pauses for an hour.
- **Scan duration:** about 10 to 20 s for 560,000 files on an SSD. A network drive mapped to a letter is scanned too and can hit the 2-minute limit; after a failed scan, automatic scans pause for 24 h (`/disk refresh` still works).
- **Cost ring and cost-ledger:** the ring needs cost-ledger 0.10.0 or later. In a fresh chat it appears once cost-ledger has read its ledger in the background (a few seconds with many chats); costs of other chats on this computer reach the project total within 15 minutes.
- **System values measuring themselves:** the PowerShell process uses about 3 % of one CPU core; its start (once per 30 minutes, or when the band shows again) is a short spike in Task Manager. CPU is processor time, which matched Task Manager on Windows 11 within about 5 points (checked 2026-11-04); the higher "Processor Utility" counter is not used.
- **Cost and system values in the terminal:** everything limit-bars draws in the terminal shares the same 44 columns (Clawd reserves the rest). Next to the long form of both limits there is no room left, so cost and the system values appear in the terminal only when the limit texts happen to be shorter (for example `0% · fresh` or `resetStyle: clock`) or a limit is hidden. The bars never switch to their short forms to make room for them. The desktop app always shows them. The percentages in the terminal are not padded: the extra column would push both limits into their short forms.
- **Time zone:** the clock-time display uses the local time of the hooks runtime (`new Date`). Which time zone that is, is not documented; check that `Mon 09:00` matches your own clock.
