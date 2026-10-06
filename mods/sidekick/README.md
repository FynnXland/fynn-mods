# sidekick

Checks your message just before it is sent: first with fixed rules, and only where it can pay off, also with a quick model call (Sonnet 5.5). If there is a clearly better move, a blue line appears under your message, or sidekick asks you. Examples of better moves: a new chat with a handoff, a matching skill, or a clearer wording. If a message clearly belongs to a different project than the chat ("wrong chat?"), sidekick holds it back and recommends cancelling. sidekick never chats on its own. `/savings` shows what it costs and what it demonstrably saves.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.290** · Plugin version **0.8.1**

**Cost:** sidekick calls Sonnet 5.5 through your own Claude Code session, so those calls count toward your usage or plan like any other request. All amounts sidekick shows (in its dialogs and in `/savings`) are estimates at API prices.

## What happens when you send

1. **Passes through unchecked** if at least one of these applies:
   - sidekick is off
   - it is a command (`/…`)
   - a turn is currently running
   - the message is not from you (plugin, notification)
   - the run is `claude -p`
   - none of the triggers below applies

   In these cases there is no cost and no delay.
2. **Triggers:**
   - (a) the first message of a chat
   - (b) context at or above `threshold` (default 80k)
   - (c) cold cache and context at or above `big` (default 150k). If sidekick sees a large chat for the first time (e.g. after `/reload-plugins` in an old chat), it doesn't know the cache state and asks once as a precaution.
3. **Model check** with Sonnet 5.5 at effort `low`, about 1.8 s and about $0.01 per check (measured; at most 2.0 s in 20 calls). The model never sees the full history. It gets:
   - a running summary (≤ 600 characters) that it updates itself
   - your last 3 messages
   - the new message
   - facts such as context size, cache state, model and last commit
   - your skill list (name and one line each)
4. **Result:**
   - *pass*: sent unchanged.
   - *hint*: sent. A blue line `· sidekick: …` stays under your message. It only changes the display, not the stored message.
   - *question* (the engine's dialog). The recommended answer is option **1** and is marked "(recommended)": without handoff if your message doesn't need the old history; send if resending is cheap (under $0.30); otherwise with handoff. The answers:
     - **New chat with handoff**: Sonnet 5.5 (effort `medium`) writes a handoff from the summary and the end of the history (up to 100,000 characters, without tool results). Then `/clear` runs, and the handoff plus your message go into the new chat. The old chat stays reachable via `/resume`. Not offered when the message has an attachment or `@file`.
     - **New chat without handoff**: clears the chat and sends only your message, without a model call. Meant for messages that don't need the old history.
     - **Send Sonnet's version**: the rewritten version is sent. The desktop app still shows your original in the bubble, so below it sidekick shows `· sidekick: Sonnet's version was sent` in blue, plus a box with the text that was actually sent.
     - **Send anyway**
     - **Cancel**: the message is not sent; your text is shown in the notice.
   - **Wrong chat** (since 0.5.0): if the message clearly belongs to a different project or field than the chat (e.g. a mobile-game chat and a question about a website's CSS), sidekick holds it back with "This doesn't fit this chat at all. … Are you in the wrong chat?". This is more than a change of topic: a new topic in the same project stays a "new chat" hint. Answers, in this order: **Cancel** (recommended; nothing is sent and your text is shown for copying, so you can paste it into the right chat; `/savings` counts it as *accepted*, and the message is removed from what the next check compares against), the fitting new chat (usually without handoff, since another field rarely needs the old history), the other new-chat variant, **Send anyway**. With an attachment or `@file`, only Cancel and Send anyway. After "Send anyway" the question stays quiet until +50k context or the next commit. It is never asked on the first message of a chat or for messages under 4 words, and it takes precedence over the cold-cache question (whose cost is then shown in the same dialog). Unlike the other questions, closing this dialog (Esc) does **not** send: the message is held back like Cancel. A new chat started from here books no savings, because without sidekick the message would have gone to another chat, not into this large one.
   - With trigger (c) the question always comes, with the cost of both paths, e.g. "Sending rewrites everything (≈ $2.40)" versus "New chat with handoff: ≈ $0.26" (Opus 5.5, 1-hour cache, about 20k base load in the new chat).
5. A hint type you ignored only comes back once the context has grown by ≥ 50k or a commit happened in between.

**Fail-open:** on error, timeout (6 s), an unusable model answer or a closed dialog, the message goes through unchanged. **Exception:** if the handoff fails after "New chat with handoff", sidekick does not silently send into the cold chat; it asks again.

The handoff **never** comes from the main model. On a cold cache, the main model would have to re-read the whole history to write it, including via `/compact` or a handoff skill.

## Maintenance hints

Some commands only help if you remember to run them. **Once per chat**, on your first own message, sidekick names at most **one** due command as a line under the message. It runs nothing and makes no model call for this; the numbers come from a free local estimate (the `/context` breakdown). If the model check has its own hint or question for the same message, the check wins.

| Rank | Rule | Command | Due when … | Quiet period after |
|---|---|---|---|---|
| 1 | `skills-cut` | `/skill-doctor` | the skill list no longer fits the budget: Claude only sees part of your skills | 7 days |
| 2 | `audit` | `/claude-api prompt-audit` | the project's CLAUDE.md files total ≥ 3k tokens and the audit never ran, they grew by ≥ 30 % since, or the model changed | 30 days |
| 3 | `memory` | `/consolidate-memory` | the memory index is ≥ 1k tokens and was never cleaned up or grew by ≥ 40 %; from 5k (close to the load limit) always | 14 days, from 5k 7 days |
| 4 | `skills-heavy` | `/skill-doctor` | skill list ≥ 4k tokens and ≥ 10 skills that can be disabled went unused for 30 days (only after 30 days of counting) | 30 days |
| 5 | `init` | `/init` | the project has no CLAUDE.md of its own and you chatted there on ≥ 3 days | 30 days |

- **Done** is detected when you type the command (or the skill runs). Otherwise: `/sidekick hints done <rule>`. If a hint for it came first, `/savings` counts it as accepted.
- **Project** = project root (`$.session.root`). Worktrees under `.claude/worktrees/<name>` count toward the main project.

## Commands

| Input | Effect |
|---|---|
| `/sidekick` or `/sidekick status` | settings, cache and context, latest summary, latest hint, latest handoff with message |
| `/sidekick on` · `off` | sidekick on/off (applies to all sessions) |
| `/sidekick threshold 80k` · `big 150k` | trigger (b) or (c) |
| `/sidekick skills on` · `off` | send the skill list to the model check or not |
| `/sidekick ttl 5` · `60` · `auto` | force the cache lifetime. `auto` measures it the way limit-bars does, default 60 min. limit-bars' own setting (`/cache ttl`) does not apply here, because each plugin has its own `$.store`. |
| `/sidekick hints status` | maintenance hints for this project: value per rule, last done and shown, earliest next time |
| `/sidekick hints on` · `off` | all maintenance hints on/off |
| `/sidekick hints <rule> on` · `off` | one rule on/off (`skills-cut`, `audit`, `memory`, `skills-heavy`, `init`) |
| `/sidekick hints done <rule>` | mark as done by hand |
| `/sidekick hints audit-min 2k` | threshold of the audit rule (default 3k) |
| `/savings [today\|week\|all]` | short balance, default `week`: cost, savings, ratio and the savings items; drawn as a framed card in the terminal and the desktop app (like cost-ledger's `/ledger`), Markdown elsewhere |
| `/savings detail [today\|week\|all]` | everything, default `all`: also how it is computed, models, checks compared per model, by day, hints and counts (`details` works too, words in any order) |

`/savings` shows cost, savings, ratio and the two savings items. `/savings detail` shows all of the following. All amounts are API value; on a subscription the calls count toward your plan's usage.

- **Cost:** all of sidekick's own model calls (check and handoff), including cancelled ones, priced from `usage` at the rates of the model actually called, including output.
- **Estimated savings**, calculated conservatively:
  - *Cold start avoided:* first request in the new chat: old context × write price − (read × read price + written × write price), from its measured `usage`.
  - *New chat on a warm large context:* first request: old context × read price − (read × read price + written × write price).
  - For both, from the second request on: (old context − context of the first request) × read price per request, never below 0. Both chats would grow by the same amount from there, so the gap stays. Runs until the new chat reaches the old size, at most 50 requests.
  - The handoff is not subtracted here; it is already in the cost.
  - *Rewritten version, skill, model:* only counted, not valued in $.
- **Models** (since 0.5.0): sidekick's own calls per model ID, e.g. *Sonnet 5.5*, with a bar for its share of the cost; per role (check, handoff) the number of calls, average duration and cost per call, plus tokens in and out. Useful when the model per role changes: old and new model stand side by side. Costs booked before 0.5.0 have no model and appear as *earlier*. Each model also shows the days it was used.
- **Checks compared** (since 0.6.0, from two rows on): per model the number of checks, average price per check (4 decimals), average duration and a factor relative to the cheapest row; below, average tokens and the days used. Tokens are booked per model, not per role: with handoffs they are an average per call (check and handoff). *Earlier* (booked before 0.5.0: Haiku until 0.3, already Sonnet from 0.4) also contains the handoffs of that time, so its price per check is an upper bound (`≤`, rounded up); a factor against it is a lower bound (`≥`, rounded down).
- **By day** (since 0.6.0): per day with activity, newest first (at most 14): cost with a bar, savings, checks and the models used with their calls.
- The detailed view starts with the date range of the data.
- **Counts:**
  - checks and average wait
  - hints by type (shown, accepted, ignored, cancelled)
  - handoffs and model hints
  - cold starts without a question, with their cost
  - skills used, with a pointer to `/skill-doctor`
  - maintenance hints per rule (shown, accepted)

## Button under the hint line (since 0.7.0, runs directly since 0.8.1)

When a blue line under your message names a command, a button sits next to it. That is a maintenance hint such as `/claude-api prompt-audit`, `/skill-doctor`, `/init`, `/consolidate-memory`, a skill sidekick suggests, or since 0.8.1 a command in the sentence that exists in this session (from a plugin, your own command or skill, or `/skill-doctor` and `/init`; other built-in commands and MCP prompts get no button):

- **Run /command**: the default. The button names the command, one click runs it, as if you had typed it and pressed Enter. If Claude is still working, it runs once the current turn is done. The line then reads "✓ ran"; a maintenance hint counts as done.
- **Add as to-do**: when the **worklist** mod offers `/todo` and the command is a skill Claude can run itself. sidekick runs `/todo Run <command>.`; worklist queues it and sends it to Claude once the current task is done. The line then reads "✓ queued as to-do". Built-in commands like `/skill-doctor` and `/init` always use **Run**, because Claude cannot run them itself.
- **Handoff:** a line that suggests the handoff skill (`/uebergabe`, `limit-bars:uebergabe`) shows and runs limit-bars' **`/handoff`** instead: the skill writes the handoff, then you are asked whether to start a new chat with it. Without `/handoff` the full skill name is used.
- Short names are resolved: `/uebergabe` finds `limit-bars:uebergabe` when exactly one plugin has it. Unknown or ambiguous names, file paths like `/hooks/hooks.json` or `/init.ts`, and words without a slash get no button. `/clear`, `/exit`, `/quit`, `/login`, `/logout` and `/rewind` never get one.
- What the button says is what it does: the target is decided when the line is drawn.
- Lines without a command (e.g. "new topic, a fresh chat would be cheaper") get no button. Other surfaces (VS Code) show the line as text, without a button.
- If Claude Code refuses the command, it goes into the prompt box at the cursor and a toast says so (Enter sends it). If that is not possible either (a dialog is open) or `/todo` fails, the toast shows the command so you can type it.

## Working with other mods

- **clawd-buddy** shows what sidekick does: while it checks your message, holds it back with a question, or starts a new chat. sidekick writes only the kind of state and a timestamp to `$.state` (`sidekick.buddy`), which clawd-buddy reads. Neither mod needs the other.
- **limit-bars** stays a display. To avoid two dialogs in a row, turn off its cold-cache warning once: **`/cache warn off`** (the German `/cache warnung aus` works too). sidekick's question replaces it.
- Claude Code's built-in plugin **`cc-plugin-you-should-know`** (off by default, availability depends on your organization) complements sidekick: it watches Claude's work, not your messages. `/savings` does **not** include its costs.

## Stored data

Everything lives in the plugin's `$.store`:

| Key | Content | Lifetime |
|---|---|---|
| `settings` | `on`, `threshold`, `big`, `skills`, `ttl` | permanent |
| `cache:<session>` | last activity, TTL, context, model | 7 days |
| `sitzung:<session>` | summary, last 3 messages, ignored hints, hint lines, last commit | 7 days |
| `bilanz:<session>` | daily values of this session, pending savings booking | until compacted |
| `bilanz:tage` | daily totals of finished sessions (older than 7 days) | permanent |
| `handoff:last`, `basis` | latest handoff with message; measured base load of a new chat | until the next one |
| `wartung:<project>` | per rule: last done (with size and model), last shown; the last 10 chat days | permanent |
| `wartung:nutzung` | skill usage of the last 30 days, read from the balances at most once a day | until the next day |
| `hints` | maintenance hints on/off, disabled rules, audit threshold | permanent |

Each session writes only its own `bilanz:` key, because the store is not atomic. Compaction at startup records compacted sessions in `bilanz:tage.aus`, so a session starting at the same time skips them and nothing is counted twice. A source is deleted only after re-reading shows the entry. **Residual risk:** if two startups overwrite `bilanz:tage` at the same time, usually just one compaction is lost; its source remains and is compacted on the next start. In a very unlikely sequence the first startup has already deleted the source before the second overwrites; those old days are then missing from `/savings`. Nothing is ever counted twice.

## Configuration

`userConfig` (set under `/plugin` → sidekick → configure, or `/config`):

| Option | Values | Default | Effect |
|---|---|---|---|
| `language` | `en`, `de` | `en` | Language of all texts sidekick shows (hint lines, questions and answers, `/sidekick`, `/savings`, notices, number and date format) and of the model's hints, summary and handoff. The rewrite of your message stays in the language you wrote it in. |

Everything else goes through `/sidekick` and is stored in `$.store` (`settings`).

## Language

Texts are English by default. For German, set `language` to `de`. Amounts then read `14,44 $` instead of `$14.44`, dates `06.10.` instead of `Oct 6`. Commands and their arguments are English in both languages. The rules that read text (rewrites that sound like a reply, typed maintenance commands) understand English and German regardless of the setting.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, turn.step, tool.call{tool=Bash|PowerShell}, prompt.submit, skill.prompt, ui.render{component=UserMessage}, ui.render{component=AbovePrompt}, command.run{command=sidekick}, command.run{command=savings}, ui.render{component=CommandOutput, props has {command=savings}}
calls: $.clock.every, $.clock.now, $.command.list, $.command.register, $.command.run, $.model.complete, $.prompt.fill, $.prompt.submit, $.session.id, $.session.messages, $.session.root, $.session.surfaces, $.session.usage, $.state.set, $.store.delete, $.store.get, $.store.keys, $.store.set, $.ui.ask, $.ui.invalidate, $.ui.resolve, $.ui.toast
state writes: sidekick.buddy
```

In plain language:

- `prompt.submit`: reads your message before sending; can hold it back (`drop`) or replace it with the rewritten version, but only after you choose so in the dialog. Detects typed maintenance commands as done.
- `turn.step`: reads the token counts of each main-loop request (cache warm/cold, context, savings measurement). Read only.
- `tool.call{tool=Bash|PowerShell}`: after the run, reads `gitOperation.commit` (commit hash). Changes nothing.
- `skill.prompt`: counts which skill ran and detects maintenance skills as done. Changes nothing.
- `ui.render{component=UserMessage}`: appends the hint line to the display of your message, with a button when the line names a command.
- `$.ui.resolve`: builds that button (a button carries its click handler, so it cannot be plain data).
- `$.command.run` (on a click): runs the command shown in the line, as if you typed it. Only commands from plugins, your own commands and skills, and the built-in maintenance commands `/skill-doctor` and `/init`; never MCP prompts, never `/clear`, `/exit`, `/quit`, `/login`, `/logout`, `/rewind`. Or worklist's `/todo`, when worklist is installed and the command is a skill.
- `$.prompt.fill`: only as a fallback, when Claude Code refuses the command: puts it into the prompt box at the cursor. Never sends it, never overwrites what you typed.
- `ui.render{component=CommandOutput, props has {command=savings}}`: draws the output of `/savings` as a card in the terminal and the desktop app. Only its own command's output; other surfaces and older outputs get the Markdown text.
- `ui.render{component=AbovePrompt}`: only while a new chat is being started, a small blue box above the prompt shows progress and seconds. Otherwise the hook passes the band through unchanged to other mods (limit-bars, Clawd).
- `$.model.complete`: Sonnet 5.5 for the check (effort `low`) and the handoff (effort `medium`), the only model calls. Your messages reach the model only through your session's own login.
- `$.session.messages`: end of the history for the handoff and to detect the first message.
- `$.session.usage`, `$.command.list`: context size, skill names and descriptions; for the maintenance hints, paths and token counts of instruction and memory files (no contents), size of the skill list, model, and whether a command exists.
- `$.session.root`: project root as the key for maintenance hints. The path only.
- `$.session.surfaces`: detects the desktop app, because there typed messages carry the origin `sdk` like `claude -p`.
- `$.session.id`: detects a new session after `/clear`.
- `$.command.run`, `$.prompt.submit`: for "New chat with handoff" (`/clear`, then send). `$.command.run` also for the button, see above.
- `$.store.*`: settings, summary, cache measurement, balance.
- `$.ui.ask`, `$.ui.toast`, `$.ui.invalidate`: question dialog, notices, redrawing the line.
- `$.clock.*`: time and a one-off timer for `/clear`.
- `$.state.set`: writes `sidekick.buddy` for clawd-buddy: only `check`, `stop`, `handoff` or `fresh` and a timestamp, never your message.

Explicitly not used: `$.fs`, `$.env`, `$.http`, `$.settings`, `$.model.fork`; no tokens or credentials.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install sidekick@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install sidekick@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · sidekick`.

**Update:** `claude plugin update sidekick@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall sidekick@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/sidekick
```

**If you also use limit-bars:** run `/cache warn off` once (see above).

**Status and pause:** `/sidekick status` shows the current state; `/sidekick off` turns sidekick off without uninstalling it.

## Known limitations

- **Desktop app** (observed with 2.1.286):
  - `PromptHint` (the line under the prompt) is not triggered there. That's why the hint appears under your message.
  - Typed messages carry `origin` `sdk` there. sidekick recognizes them via `$.session.surfaces()`.
- **VS Code and mobile:** only messages arriving as `composer`/`bridge`, or as `sdk` with the desktop in `$.session.surfaces()`, are checked. Which origin VS Code reports is not documented. By these rules sidekick either doesn't check there or checks only as in the terminal.
- **Accepting hints:** only detectable for skills (the skill runs afterwards) and in the dialog. A line about a version, model, something else or a new chat counts as ignored with the next message and blocks its type until +50k or the next commit. "Ignored" here means "not detectably accepted".
- **After `/resume`:** the hint lines of the resumed session appear only once something happens again, e.g. the next message or request. Showing them immediately would need an extra right (`classic.SessionStart`).
- **The rewritten version** is only offered if it fits entirely into the dialog (≤ 600 characters). A longer one becomes a line. Messages under 4 words never get a rewritten version. The rewrite always stays your message to the assistant (you as sender); a version that reads like the assistant's reply or a question back to you ("I'm ready – what would you like to do?") is dropped. This is detected in English and German, whatever `language` is set to. The rewrite stays in the language of your message.
- **Commit detection:** a commit made with `git commit -q` goes unnoticed, because the engine parses git's output. Then only the +50k rule applies.
- **Compaction:** without the `session.compact` right, a context that shrank by more than 40 % counts as compaction, not as a cold start.
- The handoff only sees the summary and the end of the history. The model is told not to invent anything; gaps are possible.
- **Maintenance hints:**
  - `/consolidate-memory` is missing in CLI sessions; the rule stays silent there.
  - A typed `/skill-doctor` is not detected as done in the desktop app. Afterwards run `/sidekick hints done skills-cut`.
  - The check runs on the first own message of a chat. After a change via `/sidekick hints …`, it checks once more on the next message.
  - Messages inserted by the host that start with a tag like `<system-reminder>` don't count as yours.
  - Claude reads the output of `/sidekick hints status` too and sometimes offers the items as tasks.
  - `skills-heavy` only kicks in after 30 days of counting skill usage.
  - The audit rule detects a model change by the model name in the `/context` breakdown; if only its spelling changes, you get an unnecessary hint.
  - Two concurrent chats in the same project can show a hint twice (store not atomic).
- **Wrong chat** is only detected when the model check runs (triggers above). In a small chat below `threshold` nothing is checked, so a message in the wrong small chat goes through. `/sidekick threshold 30k` widens the check, at about $0.01 and 2 s per checked message. sidekick only knows the chat from its running summary and your last 3 messages, so a chat that just started has little to compare against.
- **`/savings` card:** the drawing is kept in memory for the last 10 outputs; after a restart or `/reload-plugins`, older `/savings` outputs show as Markdown.
- **Cost of question (c):** the "New chat" estimate uses the most recently measured base load of a new chat. Before the first handoff it assumes 20k tokens.

## Credits

sidekick's cache logic (`hooks/cache.ts`) is a copy of limit-bars' cache logic, which is modeled on Nate Herk's Cache Keeper (MIT). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
