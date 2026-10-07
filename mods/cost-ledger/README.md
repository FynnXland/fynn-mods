# cost-ledger

A cost ledger across all your chats. After every answer, cost-ledger records what the chat has cost so far (the same value as `/cost`), plus the model calls made by other mods (sidekick, quick-replies …). `/ledger` shows today, 7 days, 30 days and all time, the history of the last 14 days, your projects and your most expensive chats in an overview styled like Claude Code (theme colors). The history shows 14 days or 14 weeks, each bar split by model; model calls by other mods appear as their own parts (e.g. “Sonnet 5.5 · mods”). It is a pure observer: no budget, no intervention, no model calls of its own.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.291** · Plugin version **0.4.3** · Requires Claude Code v2.1.271 or later (setting options)

## Usage

| Input | Effect |
|---|---|
| `/ledger` | Overview: today, 7 days, 30 days, all time; history of the last 14 days, each bar split by model (with legend, chat and mod calls separate); projects, most expensive chats, mods |
| `/ledger weeks` | The same overview with the last 14 calendar weeks instead of days |
| `/ledger chats [7\|30\|all]` | The 20 most expensive chats in the period (default 30 days) |
| `/ledger projects [7\|30\|all]` | All projects in the period |
| `/ledger models [7\|30\|all]` | Models: share of the estimated API value, answers, input, output and cache tokens (including subagents and mod calls) |
| `/ledger reset` | Delete everything, after a confirmation (**Cancel** is recommended and listed first) |
| `/ledger help` | Short help |

Older German arguments still work as aliases: `hilfe` for `help`, `alle` for `all`.

**What gets counted:**

- **Chats:** after every turn, the difference in `usage().cost.usd`, booked to today. Subagents are included (verified). Remaining costs are booked at session end and before `/ledger`.
- **Mods:** every `$.model.complete` / `fork` / `classify` call by another mod, with count and amount, priced with cost-ledger's own price table (Haiku 5.5 and Sonnet 5.5 as of 2026-10-07, the other models as of 2026-09-25). `classify` only counts the number of calls. These costs are **not** part of `/cost` and are added on top (verified).
- **Project:** the repo name, otherwise the folder; worktrees under `.claude/worktrees/` count toward the main folder. Runs with `claude -p` are listed as **Script runs**.
- **Chat name:** the session title if Claude Code reports one (the desktop app does not), otherwise the start of your first message (at most 50 characters, without commands; not for `-p` script runs). These 50 characters are kept in the local plugin store. Chats without a message are called **Chat from Oct 6 14:05** (date and time of the first booking).
- **Collected in advance** (not all shown yet, so later reports have data from today on): per chat and day the number of answers and subagent turns, working time, aborts and errors, most expensive answer, highest context fill, cost per hour, peak of the 5-hour and weekly limits; tokens per mod; the project's Git remote (only `host/owner/repo`).
- **Refreshing:** there is no button (it would need additional rights). The top right shows the timestamp and the command to reload.
- **Models:** tokens of every answer (including subagents) and every mod call, per model. The amount per model is an estimate from the price table; the chat totals above remain the real `/cost` value. Not included in the model view: compaction and Claude Code's internal calls, so the sum over models is slightly below `/cost`.

All amounts are API values. On a subscription they count toward your usage limits, not toward a bill.

**Runs in:** terminal and the desktop Code tab (its own rendering at the command line, colors from the theme). Terminal verified with 0.3.x; desktop verified with 0.3.1 on 2026-10-06 (0.3.0 fell back to the Markdown summary there, fixed in 0.3.1). In `claude -p` and other surfaces you get the Markdown summary. Claude only reads that summary (at most 10 lines), not the rendering.

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
calls: $.clock.now, $.command.register, $.session.repo, $.session.root, $.session.surfaces, $.session.usage, $.store.delete, $.store.get, $.store.keys, $.store.set, $.ui.ask, $.ui.log
```

In plain language:

- `$.command.register`: registers `/ledger`.
- `$.session.usage`: reads the chat's cost, without `breakdown`, so no extra request.
- `$.session.surfaces`: tells desktop, terminal and script runs apart.
- `$.session.repo`, `$.session.root`: the chat's project name; also the Git remote, stored only as `host/owner/repo`, never with credentials.
- `$.store.get/set/keys/delete`: the ledger in the mod's own plugin store, one entry per chat; cleanup and reset.
- `$.ui.ask`: confirmation before `/ledger reset`.
- `$.ui.log`: errors go to the debug log (`{to:'debug'}`), never into the transcript.
- `$.clock.now`: current date and timestamps.

The `model.*` hooks only read the result of a call (usage, origin) and pass it on unchanged. No model calls, no files, processes or network targets.

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
- **Haiku 5.5 as the chat model:** the chat amount is Claude Code's own `/cost` value. Claude Code v2.1.291 does not know Haiku 5.5 yet and prices it like Haiku 4.5, so such a chat shows about ten times too much until Claude Code is updated. Mod calls on Haiku 5.5 and the per-model view use cost-ledger's own prices instead (see the previous point).
- **Retention needs use:** Claude Code deletes a plugin's store if no session reads or writes it within `cleanupPeriodDays`. A 365-day retention assumes chats with the mod loaded keep running.
- **Storage:** `$.store` has 4 MiB in total. With the data collected, a chat needs about 0.5–0.8 KB per day on which it runs. That is enough for roughly 5,000–8,000 chat-days; with very many `-p` runs, lower `keepDays`. `/ledger` warns from 75 % and reports a write error.
- **Old `/ledger` lines** only show the Markdown summary after the session restarts (the rendering's data lives only in the process memory).
- **Two ledgers:** if the same mod is loaded both by path (`--plugin-dir`) and from the marketplace, each copy keeps its own ledger, because the plugin store is tied to the plugin ID. Chats recorded by one copy do not appear in the other.
- **Chat names in the desktop app:** the desktop app does not report the sidebar title to mods, so cost-ledger uses the start of the first message.
- **Model per turn:** if a turn uses several models, its tokens count toward the model of the last request (that is how `turn.complete` reports it).
