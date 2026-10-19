# cost-ledger

A cost ledger across all your chats. After every answer, cost-ledger records what the chat has cost so far (the same value as `/cost`), plus the model calls made by other mods (sidekick, quick-replies …). `/ledger` shows today, 7 days, 30 days and all time, the history of the last 14 days, your projects and your most expensive chats in an overview styled like Claude Code (theme colors). The history shows 14 days or 14 weeks, each bar split by model; model calls by other mods appear as their own parts (e.g. “Sonnet 5.5 · mods”). On a subscription, `/ledger limits` shows how much API value went into the current 5-hour and weekly window and into your subscription month, and estimates how much of the window you used outside the ledger (claude.ai, the mobile app, chats without cost-ledger). With `/ledger sync <folder>` on each of your computers, `/ledger` shows all of them together through a folder they share, such as one in a cloud drive. It is a pure observer: no budget, no intervention, no model calls of its own.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.295** · Plugin version **0.7.0** · Requires Claude Code v2.1.271 or later (setting options)

## Usage

| Input | Effect |
|---|---|
| `/ledger` | Overview: today, 7 days, 30 days, all time; history of the last 14 days, each bar split by model (with legend, chat and mod calls separate); projects, most expensive chats, mods |
| `/ledger weeks` | The same overview with the last 14 calendar weeks instead of days |
| `/ledger chats [7\|30\|all]` | The 20 most expensive chats in the period (default 30 days; any number of days from 1 to 3650 works) |
| `/ledger projects [7\|30\|all]` | All projects in the period |
| `/ledger models [7\|30\|all]` | Models: share of the estimated API value, answers, input, output and cache tokens (including subagents and mod calls) |
| `/ledger limits` | Subscription limits: the current 5-hour and weekly window (% used, API value, reset time with countdown, projection “100 % ≈ $X”), your subscription month (API value against the plan price, factor, next renewal) and the last 10 five-hour windows with their average. Each window also shows the estimated share used outside the ledger (see below) |
| `/ledger plan <plan> <day\|today> [price]` | Set your plan and billing day: `pro`, `max5` (`5x`), `max20` (`20x`), `team` or `enterprise`; day 1–31, or `today` if your plan renewed today; monthly price in $ (comma or dot). Without a price, the list price is used: Pro $20, Max 5x $100, Max 20x $200; Team and Enterprise have none. Example: `/ledger plan max20 14` |
| `/ledger plan` | Show the plan setting and the syntax; `/ledger plan off` deletes it |
| `/ledger sync <folder>` | Turn on sync between your computers through a shared folder (absolute path, spaces allowed), e.g. `/ledger sync <your cloud folder>/cost-ledger`. Run it on every computer with the same folder |
| `/ledger sync` | Sync state: folder, this device's name and ID, the other devices with the time of their last update |
| `/ledger sync name <name>` | Name this device (up to 30 characters); the other devices show its chats under this name. Default: “Device 1a2b” from a random ID |
| `/ledger sync off` | Turn sync off. This device's file stays in the folder; cost-ledger never deletes files |
| `/ledger reset` | Delete everything on this device, after a confirmation (**Cancel** is recommended and listed first). The plan and sync settings stay; other devices keep their entries |
| `/ledger help` | Help as a table: all commands, the current state (plan, sync, storage used, recording since) and your settings with their values, plus how to change them and how to turn the mod off. Also `/ledger ?` |

Older German arguments still work as aliases: `hilfe` for `help`, `alle` for `all`, `heute` for `today`, `aus` for `off`. An unknown command word (the first word after `/ledger`) answers with a pointer to `/ledger help`. `/ledger days` is gone; it only showed the overview.

**Help:** `/ledger help` draws a table in the terminal and the desktop app (accent green), with the state as of the moment you ran it. Run it again to see a change. Elsewhere (`claude -p`, VS Code) you get a short Markdown version, which is also what Claude reads.

On a subscription, `/ledger` also shows a compact line at the top: `5 h 62 % · $18.40 · reset 18:00 │ week 98 % · $212.10 │ plan $812.40 = 4.1× · /ledger limits`. It is left out when there is neither a limit window nor a plan.

**Why `/ledger plan`?** Claude Code does not tell mods which plan you have or when it renews, and cost-ledger never reads your login data. So you set it once. Until then the subscription month shows “Plan not set”.

**What gets counted:**

- **Chats:** after every turn, the difference in `usage().cost.usd`, booked to today. Subagents are included (verified). Remaining costs are booked at session end and before `/ledger`.
- **Mods:** every `$.model.complete` / `fork` / `classify` call by another mod, with count and amount, priced with cost-ledger's own price table (Haiku 5.5 and Sonnet 5.5 as of 2026-10-07, the other models as of 2026-09-25). `classify` only counts the number of calls. These costs are **not** part of `/cost` and are added on top (verified).
- **Project:** the folder the chat was started in (Claude Code only reports a repository name for repositories on its own allowlist); worktrees under `.claude/worktrees/` count toward the main folder. Runs with `claude -p` are listed as **Script runs**.
- **Chat name:** the session title if Claude Code reports one (the desktop app does not), otherwise the start of your first message (at most 50 characters, without commands; not for `-p` script runs). These 50 characters are kept in the local plugin store. Chats without a message are called **Chat from Oct 6 14:05** (date and time of the first booking).
- **Limit windows:** every answer and every mod call is also credited to the current 5-hour and weekly window, as Claude Code reports them (`usage().rateLimits`: % used and reset time). A window is identified by its reset time. If the window has already reset and no new answer has reported the next one, the amount waits and goes into the next window. `% used` is the highest value seen in the window.
- **Subscription month:** chat and mod costs since the last billing day (from `/ledger plan`), only from chats that saw subscription limits (runs with an API key are left out). Factor = API value ÷ plan price.
- **Collected in advance** (not all shown yet, so later reports have data from today on): per chat and day the number of answers and subagent turns, working time, aborts and errors, most expensive answer, highest context fill, cost per hour, peak of the 5-hour and weekly limits; tokens per mod; the project's Git remote (only `host/owner/repo`).
- **Refreshing:** there is no button (it would need additional rights). The top right shows the timestamp and the command to reload.
- **Models:** tokens of every answer (including subagents) and every mod call, per model. The amount per model is an estimate from the price table; the chat totals above remain the real `/cost` value. Not included in the model view: compaction and Claude Code's internal calls, so the sum over models is slightly below `/cost`.

All amounts are API values. On a subscription they count toward your usage limits, not toward a bill.

## Sync between devices

The plugin store lives on one computer. To see your PC and your laptop together, give both the same folder that your cloud drive (OneDrive, Dropbox, Syncthing …) keeps in sync:

```text
/ledger sync <your cloud folder>/cost-ledger
```

- **One file per device:** each computer writes only its own file `cost-ledger-<id>.json` into that folder and reads the others. It writes when you run `/ledger …` and after answers at most every 15 minutes; it reads the other files only when you run `/ledger …`.
- **What the file contains:** amounts per day, limit windows, models and tokens, the total of all mod calls per day (without mod names), and what merging needs: each chat's session ID, the time of its last booking and the hour of its first, the times of the first and last booking in each limit window, and whether it ran in the desktop app, the terminal or a script; plus the device's name and ID. **No paths, no project, folder or mod names, no Git remote, no chat titles or messages.** Model IDs that are not plain names (a Bedrock ARN, a custom deployment name) are written as “other”. The breakdown by project therefore stays local: chats and mod calls from another device appear as one group, “Laptop (other device)”, and chats without a title (“Chat from …”).
- **No double counting:** chats are merged by their session ID; if the same chat appears twice (for example from a restored backup), only the newest version counts.
- **Nothing gets lost:** if the folder is missing (drive disconnected) or a file is half-synced, `/ledger` shows your local ledger with a note and uses the last good copy of the other device. cost-ledger never deletes a file and only writes its own.
- **Local folders only:** a network path (`\\server\…`) is rejected; use a folder your sync client keeps on disk. On Windows the folder needs a drive letter (`D:\…`), and a drive root is not accepted.
- **Per device:** `/ledger reset` clears only this device and rewrites its (now empty) file. The plan setting from `/ledger plan` also stays per device.

## Usage outside the ledger

`% used` covers your whole account, while the dollar amounts only come from chats with cost-ledger. `/ledger limits` estimates the gap: cost-ledger takes the completed, fully recorded window with at least 20 % where the most API value per percent went through the ledger, as “how much one percent costs”. For every window it then shows “outside the ledger ≈ 12 % of 40 %” (a percentage-point estimate) and marks past windows with “outside 12 %”. Until there is such a window, it says when the estimate starts.

**Runs in:** terminal and the desktop Code tab (its own rendering at the command line, colors from the theme). Terminal verified with 0.3.x; desktop verified with 0.3.1 on 2026-10-06 (0.3.0 fell back to the Markdown summary there, fixed in 0.3.1). The 0.5.0 views (`/ledger limits`, the limit line) are covered by rendering tests for both surfaces; a visual check is pending. The help table (0.6.0) was checked in the terminal. Sync (0.7.0) was verified with `claude -p` in a real session; its views are covered by rendering tests for both surfaces. In `claude -p` and other surfaces you get the Markdown summary. Claude only reads that summary (at most 10 lines for the views, about 15 for the help), not the rendering.

## Configuration

`/plugin` → cost-ledger → settings (`userConfig`):

| Key | Title in `/config` | Meaning | Default |
|---|---|---|---|
| `language` | Language / Sprache | Language of the overview, summary, help and confirmation: `en` or `de` | `en` |
| `keepDays` | Retention (days) | Chats with no new bookings for this long are deleted by cost-ledger on the next `/ledger` | 365 |
| `dayYellow` | Daily amount yellow from ($) | Daily amount (chat + mods) from which the day's value in the history turns yellow | 3 |
| `dayRed` | Daily amount red from ($) | Daily amount from which it turns red | 8 |

## Language

`language` switches all texts the mod shows: the `/ledger` overview and its views, the Markdown summary Claude reads, the help, the reset confirmation, and the formats (`en`: `$14.44`, `Oct 6`, `W41`; `de`: `14,44 $`, `06.10.`, `KW 41`). The default is `en`; set it to `de` for German. A change applies to the next `/ledger`. Stored data does not depend on the language.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, classic.SessionStart, classic.UserPromptSubmit, turn.complete, model.complete, model.fork, model.classify, session.end, command.run{command=ledger}, ui.render{component=CommandOutput, props has {command=ledger}}
calls: $.clock.now, $.command.register, $.fs.list, $.fs.read, $.fs.write, $.session.repo, $.session.root, $.session.surfaces, $.session.usage, $.store.delete, $.store.get, $.store.keys, $.store.set, $.ui.ask, $.ui.log
```

In plain language, the hooks:

- `session.start`: sets the starting point of the chat's cost counter, reads the project, registers `/ledger`.
- `classic.SessionStart`: the chat's ID and title; `/clear`, `/resume` and branching switch the chat without a new start.
- `classic.UserPromptSubmit`: names a chat after the start of your first own message when Claude Code reports no title (at most 50 characters, not for commands or `-p` runs), and finds the chat's ID again after the mod reloads. The prompt itself is neither changed nor stored beyond those 50 characters.
- `turn.complete`: books the chat's cost after every answer.
- `model.complete`, `model.fork`, `model.classify`: see the calls other mods make, to count them (below).
- `session.end`: books the rest when the chat ends.
- `command.run{command=ledger}`: the `/ledger` command.
- `ui.render{component=CommandOutput, props has {command=ledger}}`: draws the overview, the other views and the help in place of the command's text line.

And the calls:

- `$.command.register`: registers `/ledger`.
- `$.session.usage`: reads the chat's cost, without `breakdown`, so no extra request; from the same call the context fill and the rate-limit windows (% used, reset time) for `/ledger limits`. Mod calls use the last reading and do not call it again.
- `$.session.surfaces`: tells desktop, terminal and script runs apart.
- `$.session.repo`, `$.session.root`: the chat's project name; also the Git remote, stored only as `host/owner/repo`, never with credentials.
- `$.store.get/set/keys/delete`: the ledger in the mod's own plugin store, one entry per chat; cleanup and reset; the plan setting from `/ledger plan` (plan, billing day, price). `/ledger help` only reads it (storage used, plan, recording since).
- `$.ui.ask`: confirmation before `/ledger reset`.
- `$.ui.log`: errors go to the debug log (`{to:'debug'}`), never into the transcript.
- `$.clock.now`: current date and timestamps.
- `$.fs.list`, `$.fs.read`, `$.fs.write`: sync between devices (since 0.7.0). Only inside the folder you set with `/ledger sync <folder>`, and only files named `cost-ledger-<id>.json`: it lists that folder, reads the other devices' files and writes its own. Nothing happens with these rights until you turn sync on. Claude Code cannot restrict these rights to a folder, so cost-ledger enforces it itself, and tests check every path.

The `model.*` hooks only read the result of a call (usage, origin) and pass it on unchanged. No model calls, no processes or network targets; files only for sync, as above.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install cost-ledger@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install cost-ledger@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · cost-ledger`.

**Update:** `claude plugin update cost-ledger@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall cost-ledger@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/cost-ledger
```

**Install in user scope** (the default), so the mod records in every project. It only books chats in which it is loaded, and only chats started after installation.

**The plugin store is tied to the plugin ID.** What gets recorded while the mod is loaded via `--plugin-dir` (`cost-ledger_inline-…`) is not visible to the marketplace install (`cost-ledger_fynn-mods-…`), and vice versa.

## Known limitations

- **Only numbers from installation on.** Older chats are missing.
- **If the desktop app closes a chat hard** (without `session.end`), the remainder since the last answer is missing. If the chat is resumed later, cost-ledger books that remainder then.
- **`/resume` in the middle of a session** is only covered by a test, not verified in a real session (it cannot be triggered in `-p`). Assumption: `usage().cost` afterwards reflects the resumed chat (as when starting with `--resume`, which is verified). If the counter instead kept running per process, the previous chat's cost would be booked twice onto the resumed one.
- **After the mod reloads** (a module file saved, settings changed), cost-ledger only recognizes the session again with the next prompt. Costs in between are booked then; mod calls from that window are missing.
- **Mod amounts are estimates:** tokens × price table; cache writes are priced as 5-minute TTL. Calls that are denied (`deny`) do not count. Haiku 5.5 is priced by prompt length: above 100,000 prompt tokens (input + cache reads + cache writes) the whole call costs five times as much. cost-ledger applies this only to single mod calls (`model.complete`). A chat turn and a `fork` report their responses summed, so their per-model estimate always uses the lower Haiku 5.5 rate and can be too low when a single request in them was over 100,000 tokens.
- **The alias `haiku`:** a mod that calls `$.model.complete({ model: 'haiku' })` gets Claude Haiku 5.5 on Claude Code v2.1.293 and later (verified with v2.1.295), Haiku 4.5 before. The call's result does not say which model answered, so cost-ledger prices `haiku` as Haiku 5.5. On an older Claude Code such calls are booked about ten times too low, and if you point `haiku` elsewhere with `ANTHROPIC_DEFAULT_HAIKU_MODEL`, they are still priced as Haiku 5.5.
- **Haiku 5.5 as the chat model:** the chat amount is Claude Code's own `/cost` value. Claude Code v2.1.291 still priced Haiku 5.5 like Haiku 4.5 (about ten times too much); v2.1.295 prices it correctly.
- **Retention needs use:** Claude Code deletes a plugin's store if no session reads or writes it within `cleanupPeriodDays`. A 365-day retention assumes chats with the mod loaded keep running.
- **Storage:** `$.store` has 4 MiB in total. With the data collected (including the limit windows since 0.5.0), a chat needs about 0.7–1.1 KB per day on which it runs. That is enough for roughly 4,000–6,000 chat-days; with very many `-p` runs, lower `keepDays`. `/ledger` warns from 75 % and reports a write error.
- **Old `/ledger` lines** only show the Markdown summary after the session restarts (the rendering's data lives only in the process memory).
- **Two ledgers:** if the same mod is loaded both by path (`--plugin-dir`) and from the marketplace, each copy keeps its own ledger, because the plugin store is tied to the plugin ID. Chats recorded by one copy do not appear in the other.
- **Chat names in the desktop app:** the desktop app does not report the sidebar title to mods, so cost-ledger uses the start of the first message.
- **Model per turn:** if a turn uses several models, its tokens count toward the model of the last request (that is how `turn.complete` reports it).
- **Limits are per account, dollars are per ledger.** `% used` covers your whole account, including claude.ai, the mobile app and chats where cost-ledger is not loaded. The dollar amounts only come from chats with cost-ledger. The projection “100 % ≈ $X” (API value ÷ % used × 100) and the average over past windows are therefore **estimates**: they come out too low when you also use Claude elsewhere.
- **The first windows are incomplete.** Windows that began before cost-ledger 0.5.0 recorded its first window are marked “from …”. They get no projection and do not count toward the average. The 5-hour history starts with 0.5.0; older days only kept the daily peak of `% used`.
- **Window start is derived.** The start of a window (for labels like “13–18” and for “incomplete”) is the reset time minus 5 hours or 7 days, taken from the window names. The amounts do not depend on it.
- **Mod calls count toward the windows** on the assumption that they use the same login and therefore the same limits. This is not documented.
- **The limits only update with an answer.** Claude Code reports the windows with each API response. After a reset, `/ledger limits` shows “reset passed” until the next answer. Countdowns are as of the moment you ran the command; the view does not refresh by itself.
- **Waiting amounts live in memory.** An amount that waits for the next window (the window had reset, no answer had reported the new one yet) is kept only while the chat runs. If the chat ends first, it is missing from the windows; the daily totals still have it.
- **“Outside the ledger” is a rough estimate and can be off either way.** It assumes one percent costs about the same in every window; a different model mix (Haiku vs. Opus) shifts it. Even the best window contains some usage outside the ledger (the estimate comes out low), while a single unusually cheap-looking window or mod calls booked between two readings of `% used` push it up. Chats from a computer that is not synced count as “outside”.
- **Sync is as fresh as your cloud drive.** The other device's numbers are as of its last write (at most 15 minutes after its last answer, or its last `/ledger`) plus your sync client's delay. `/ledger sync` shows the time of each device's last update.
- **Sync in the desktop app** uses the same file access as the terminal; it is verified in the terminal (`claude -p`) with 0.7.0, a check in the desktop app is pending. Cloud sessions were not tested.
- **Copied plugin store:** if you copy the plugin store from one computer to another, both start with the same device ID. The device that notices it switches to a new ID; the old file then belongs to the other device. In rare cases a leftover file of this device stays in the folder: it adds to the device count, its chats are not counted twice, but after `/ledger reset` they show up again. Delete such a file by hand (`/ledger sync` lists each device with its last update); cost-ledger never deletes files.
- **Mapped network drives:** whether Claude Code treats a drive letter that points to a network share as a network location is not documented. Use a folder your sync client keeps on a local disk.
- **Plan and price are what you set.** cost-ledger does not know your real plan or price; list prices are from Anthropic's pricing pages as of 2026-10-08. Mobile app subscriptions can cost more.
