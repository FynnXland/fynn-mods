# sidekick

Checks your message just before it is sent: first with fixed rules, and only where it can pay off, also with a quick model call (Haiku 5.5; in level Auto, Sonnet 5.5 writes the rewritten version). If there is a clearly better move, a blue line appears under your message, or sidekick asks you. Examples of better moves: a new chat with a handoff (always as a question), a clearer version, a skill your message doesn't point to, or a gap only you can fill. If a message clearly belongs to a different project than the chat ("wrong chat?"), sidekick holds it back and recommends cancelling. With the **worklist** mod installed, a long message with several separate tasks can be split into 3–4 to-dos, and `/later` plans text as to-dos without Claude reading it. Five levels, from off to autonomous, and a colored label in the prompt footer show how much sidekick does. sidekick never chats on its own. `/savings` shows what it costs and what it demonstrably saves. Optional and off by default: **Good to know**, a note above the prompt while Claude works, when you likely missed something with consequences.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.295** · Plugin version **0.14.1**

**All commands at a glance:** `/sidekick help` (or `/sidekick ?`) draws a table of every command, the buttons, each feature with its current state and how to change it, and your settings.

**Cost:** sidekick calls Haiku 5.5 and Sonnet 5.5 through your own Claude Code session, so those calls count toward your usage or plan like any other request. With **Good to know** turned on, it also asks your session's own model (see below). All amounts sidekick shows (in its dialogs and in `/savings`) are estimates at API prices.

## Levels and the footer label (since 0.10.0)

| Level | Command | What sidekick checks | What it does | Cost |
|---|---|---|---|---|
| Off | `/sidekick off` | nothing | nothing | 0 |
| Cache | `/sidekick cache` | only trigger (c), by rules, no model call | the cold-cache question with handoff (below); no hint lines, no maintenance hints | 0, only the handoff you choose |
| Guide | `/sidekick guide` | (a), (b) from `threshold` (80k), (c) | everything below: hint lines, questions, maintenance hints (as up to 0.9) | ≈ $0.001 per check |
| Plan | `/sidekick plan` | like Guide, but (b) from half the threshold (40k), plus (d) long messages with worklist | plus the split-into-to-dos question (below); just as strict as Guide | like Guide, plus splits |
| Auto | `/sidekick auto` | like Plan, plus **every** own message from 300 characters | a rewritten version and splitting go out **without asking** (see below); the check may be more critical | ≈ $0.012 per message from 300 characters (Sonnet), ≈ $0.001 for shorter ones |

- `/sidekick on` brings back the last active level (default Guide). `/sidekick` and `/sidekick status` name the level.
- Settings from before 0.10.0: `on` becomes Guide, `off` stays Off. `threshold`, `big`, `long`, `skills` and `ttl` apply in every level.
- Plan and Auto without worklist: the level can be set, splitting and `/later` are simply skipped, and `/sidekick plan` says so.
- **Footer label:** next to the model picker under the prompt, e.g. `🟢 sidekick · Plan` in the terminal; in the desktop app a colored ● with `sidekick · Plan` (the desktop does not show added mode labels, since 0.10.2). 🟠 while sidekick checks, a question is open, or a handoff or split is running; `🔴 sidekick off` when off. Other labels in that footer (e.g. from the orchestrator) stay. Terminal and desktop app only.
- **Auto in detail:**
  - A rewritten version (≤ 600 characters, not for messages under 4 words, never one that reads like Claude's reply) is sent **in your name without a dialog**. Below your message it says "· sidekick: Sonnet's version was sent" with the text actually sent, because the desktop bubble still shows your original. A version more than 40 % shorter than your message is asked about instead, so nothing gets lost.
  - Splitting into to-dos happens without the question; a notice says "Split into 3 to-dos".
  - Still asked, because hard to undo or expensive: new chat, wrong chat, the cold-cache question.
  - The check gets an extra instruction to be more critical: unclear or incomplete messages get a clearer version more often, filled in from the summary, your last messages and the end of Claude's last reply, never invented. A short answer to Claude's own question gets no rewrite (since 0.10.4): Claude knows what it asked.
  - Models (since 0.11.0): a message from 300 characters is checked by Sonnet 5.5 in one call (≈ $0.012, 2–5 s), because Haiku took 6–10 s on long dictated messages. A shorter one is checked by Haiku 5.5; only if Haiku reports that a clearer version pays off, Sonnet 5.5 writes it in a second call (then ≈ 5–7 s).
  - Measured with 10 of the author's real dictated messages: Auto wrote a version for 1 of 10 (Guide: 0), with every point kept; hint lines came about 5 times as often as in Guide.

## `/later <text>` (since 0.10.0)

Plans text as to-dos for later, also while Claude is working. sidekick answers the command with nothing, so Claude doesn't read it; a timer lets Sonnet 5.5 decide on 1 to 4 steps (a short single task becomes one to-do) and queues them with worklist's `/todo`. A notice says "2 to-dos queued for later".

- Works in every level except Off. Without worklist only a notice, with your text; nothing is queued.
- `/later` without text shows a one-line help.
- If writing the to-dos fails, a notice shows your text, and `/sidekick status` keeps it in full.
- **Desktop app:** send `/later` normally with Enter, not with "Send now" (that interrupts Claude). With desktop app 2.1.288 worklist saw its `/todo` held until Claude's turn ends, without ending it; whether `/later` behaves the same is not tested yet. With 2.1.286 such a command ended Claude's turn after the current tool. In the terminal it should run during the work (documented, not tested). If that gets in the way, write the plan as a normal message later.
- **When the to-dos start** (worklist 0.4.0): if Claude is free when they are queued, worklist starts them, even after a question in the chat. If you queued them while Claude was working and that turn ends with a question, the list waits: answer in the chat, or press **Start now** in worklist's sidebar. If a to-do of the list stopped (a question, an interruption), new to-dos wait behind it: answer in the chat, or use **Continue**, **Mark as done** or **Skip** in the sidebar.
- Cost: one Sonnet call, ≈ $0.01.

## What happens when you send

1. **Passes through unchecked** if at least one of these applies:
   - the level is Off (or Cache and the cache is not cold)
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
   - (d) a long message (since 0.9.0): at least `long` characters (default 800) and at most 7,600 (more doesn't fit into 4 to-dos), without attachments or `@file`, **and only when worklist offers `/todo`**. Without worklist, length alone never triggers a check. This trigger only ever leads to the split question, never to a hint line. Order: (c) before (a) before (b) before (d).
3. **Model check** with Haiku 5.5 at effort `medium`, about 3 s and about $0.001 per check (measured 2026-10-07: median 3.1 s, all ordinary cases within 6 s; up to 0.10 Sonnet 5.5 at about $0.012). In level Auto, Sonnet 5.5 checks messages from 300 characters and writes the rewritten versions (see Auto above). The model never sees the full history. It gets:
   - a running summary (≤ 600 characters) that it updates itself
   - your last 3 messages
   - the end of Claude's last reply (up to 1,500 characters; since 0.10.4), so a short answer to Claude's question ("yes, the second one") isn't flagged as unclear
   - the new message
   - facts such as context size, cache state, model and last commit
   - your skill list (name and one line each)

   Since 0.12.0 the check knows that Claude sees the whole history, the files and the same skill list, and that you may be dictating. So it only speaks up with something Claude doesn't have: a gap only you can close (a detail that is nowhere in the chat, or a choice Claude has no yardstick for), or a skill your message doesn't point to. A misheard name ("Heiko" for Haiku) is never a reason on its own.
4. **Result:**
   - *pass*: sent unchanged.
   - *hint*: sent. A blue line `· sidekick: …` stays under your message. It only changes the display, not the stored message. Since 0.12.0 a hint line never talks about the size of the chat or a new chat; a line that does is dropped.
   - *question* (the engine's dialog). A new topic in a large or cold chat always leads to this question, never to a line (since 0.12.0). The recommended answer is option **1** and is marked "(recommended)": without handoff if your message doesn't need the old history; send if resending is cheap (under $0.30); otherwise with handoff. The answers:
     - **New chat with handoff**: Sonnet 5.5 (effort `medium`) writes a handoff from the summary, the beginning and the end of the history (your first two messages, then the newest, up to 100,000 characters together, without tool results; see Known limitations), the project root, the last commit and your new message. Since 0.12.0 its "Next" line is what your message asks for, and a table names the project and the last commit. Then `/clear` runs, and the handoff plus your message go into the new chat. The old chat stays reachable via `/resume`. Not offered when the message has an attachment or `@file`; then there is no new-chat line either, the message just goes through (since 0.12.0).
     - **New chat without handoff**: clears the chat and sends only your message, without a model call. Meant for messages that don't need the old history.
     - **Send Haiku's version** (in level Auto: Sonnet's): the rewritten version is sent. The desktop app still shows your original in the bubble, so below it sidekick shows `· sidekick: Haiku's version was sent` (in level Auto: Sonnet's) in blue, plus a box with the text that was actually sent. With worklist 0.4.0 this counts as your own answer: if a to-do stopped with a question, that to-do continues.
     - **Send anyway**
     - **Cancel**: the message is not sent; your text is shown in the notice.
   - **Split into to-dos** (since 0.9.0, only with worklist): see below.
   - **Wrong chat** (since 0.5.0): if the message clearly belongs to a different project or field than the chat (e.g. a mobile-game chat and a question about a website's CSS), sidekick holds it back with "This doesn't fit this chat at all. … Are you in the wrong chat?". This is more than a change of topic: a new topic in the same project stays a "new chat" question. Answers, in this order: **Cancel** (recommended; nothing is sent and your text is shown for copying, so you can paste it into the right chat; `/savings` counts it as *accepted*, and the message is removed from what the next check compares against), the fitting new chat (usually without handoff, since another field rarely needs the old history), the other new-chat variant, **Send anyway**. With an attachment or `@file`, only Cancel and Send anyway. After "Send anyway" the question stays quiet until +50k context or the next commit. It is never asked on the first message of a chat or for messages under 4 words, and it takes precedence over the cold-cache question (whose cost is then shown in the same dialog). Unlike the other questions, closing this dialog (Esc) does **not** send: the message is held back like Cancel. A new chat started from here books no savings, because without sidekick the message would have gone to another chat, not into this large one.
   - With trigger (c) the question always comes, with the cost of both paths, e.g. "Sending rewrites everything (≈ $2.40)" versus "New chat with handoff: ≈ $0.26" (Opus 5.5, 1-hour cache, about 20k base load in the new chat).
5. A hint type you ignored only comes back once the context has grown by ≥ 50k or a commit happened in between.

**Fail-open:** on error, timeout (6 s per model call; in level Auto a short message can take two calls, so up to about 12 s), an unusable model answer or a closed dialog, the message goes through unchanged. **Exception:** if the handoff fails after "New chat with handoff", sidekick does not silently send into the cold chat; it asks again.

The handoff **never** comes from the main model. On a cold cache, the main model would have to re-read the whole history to write it, including via `/compact` or a handoff skill.

## Splitting a long message into to-dos (since 0.9.0, levels Plan and Auto)

You dictate a long message with several tasks. With **worklist** installed and a message of at least `long` characters (default 800, no attachments, no `@file`), the model check may find three or more separate tasks that can be done one after another. Then sidekick holds the message back and asks:

```text
Your message contains several separate tasks.
  1. limit-bars: ring keeps its last value on start
  2. sidekick: shorten the hint line
  3. worklist: update the README
Sonnet turns them into 3 to-dos with every point of your message; worklist works through them one after another. How do you want to continue?
[Split into 3 to-dos (recommended)] [Send anyway] [Cancel]
```

- **Split into n to-dos**: the message is not sent. A blue box above the prompt reads "sidekick is writing the to-dos … 4 s". Sonnet 5.5 (effort `low`) writes one complete to-do per step, in your voice and language, with every point of your message and nothing added; to-do 1 ends with a line naming the steps that follow, so Claude doesn't start on them early. Each to-do stays under 1,900 characters (worklist cuts at 2,000). sidekick then runs `/todo` once per to-do, in order. worklist works through them as soon as Claude is free, even if Claude's last answer ended with a question (since worklist 0.4.0, queueing while Claude is free counts as your answer). To-dos already in the list come first. If a to-do of the list stopped with a question or an interruption, the new ones wait until you continue it in the chat or the sidebar.
- **Send anyway**: sent as typed. The question rests until +50k context or the next commit.
- **Cancel**: not sent, your text is shown for copying. Closing the dialog sends the message as typed.
- **Not split:** one coherent task with many details, a question or discussion, an answer to Claude's question. During a cold-cache question (c) sidekick never splits; that question comes first. To-dos that worklist sends are never checked again.
- **Nothing is lost:** if writing the to-dos fails, sidekick asks again (*Send anyway* / *Cancel*). If `/todo` fails after k of n, a notice says so, and `/sidekick status` shows the remaining to-dos in full for copying. A message too long for the notice (over 1,800 characters) is shown shortened there and in full in `/sidekick status`. While one split is running, no second one is offered; if the chat changes (`/clear`, `/resume`) before the to-dos are queued, nothing goes into the new chat and the to-dos wait in `/sidekick status`.
- **Cost (measured with 2.1.291):** checking a long message ≈ $0.001 and 3–5 s with Haiku 5.5 (since 0.11.0; in level Auto Sonnet 5.5 checks it, ≈ $0.012 and 2–5 s); writing the to-dos ≈ $0.01 and 4–5 s. About $0.011 per split. Without worklist: nothing, no check, no cost. `/sidekick long off` turns only the splitting off.

## Maintenance hints

Some commands only help if you remember to run them. **Once per chat**, on your first own message, sidekick checks what is due and names at most **one** command as a line under a message. It runs nothing and makes no model call for this; the numbers come from a free local estimate (the `/context` breakdown). If the model check has its own line or question for that message, the check wins, and since 0.12.0 the maintenance hint comes with your next message that has neither. It survives `/reload-plugins`; it is dropped if you run the command in between or turn the hint off. There is no second measurement later in the chat.

| Rank | Rule | Command | Due when … | Quiet period after |
|---|---|---|---|---|
| 1 | `skills-cut` | `/skill-doctor` | the skill list no longer fits the budget: Claude only sees part of your skills | 7 days |
| 2 | `audit` | `/claude-api prompt-audit` | the project's CLAUDE.md files total ≥ 3k tokens and the audit never ran, they grew by ≥ 30 % since, or the model changed | 30 days |
| 3 | `memory` | `/consolidate-memory` | the memory index is ≥ 1k tokens and was never cleaned up or grew by ≥ 40 %; from 5k (close to the load limit) always | 14 days, from 5k 7 days |
| 4 | `skills-heavy` | `/skill-doctor` | skill list ≥ 4k tokens and ≥ 10 skills that can be disabled went unused for 30 days (only after 30 days of counting) | 30 days |
| 5 | `init` | `/init` | the project has no CLAUDE.md of its own and you chatted there on ≥ 3 days | 30 days |

- **Done** is detected when you type the command (or the skill runs). Otherwise: `/sidekick hints done <rule>`. If a hint for it came first, `/savings` counts it as accepted.
- **Project** = project root (`$.session.root`). Worktrees under `.claude/worktrees/<name>` count toward the main project.

## Good to know (since 0.13.0, off by default)

While Claude works on a longer task, sidekick asks at step 6, 12, 18 … of a turn whether there is one thing you should really know and very likely missed: a trade-off Claude made in passing, an assumption the work rests on, a limit with real consequences. Most of the time the answer is "nothing", and nothing appears. Turn it on with **`/sidekick notes on`**.

- **How:** one question to your session's own model over the whole conversation (`$.model.fork`), without tools, mostly served from the prompt cache. Claude is not interrupted and doesn't wait. The same idea as Claude Code's built-in `cc-plugin-you-should-know`, in sidekick's own words and rules; turn the built-in off if you use this (`/plugin disable cc-plugin-you-should-know@builtin`), or you pay twice.
- **What counts:** only something you very likely missed **and** that costs money, time, work, a correct result or a decision you are making right now. Not: what you asked about or already decided, what Claude told you clearly (in its last answer, as its own section or main point), trivia, guesses, and never context size, cost of the chat or a new chat (sidekick handles those itself). Every detail must be in the conversation; guesses are phrased as "if …".
- **Above the prompt:** `✦ Heads up · <one sentence>` (or *Good to know*) with **1: Explain** · **2: Know this** · **0: Later**. *Explain* opens a short explanation (at most about 100 words) with **1: Got it** · **2: Discuss in chat** · **0: Close**. *Discuss in chat* puts the note into the prompt box for you to add your question; it never sends. In the desktop app the box is the app's own, so the button reads **Ask in chat** and sends the note with a short request to explain it, as a message from sidekick (not in your name), once Claude is free.
- **Digits:** 1, 2 and 0 work while Claude is working. After the turn the buttons carry no digits, because a digit typed alone into the empty prompt would press them (say your answer "2" to "option 1 or 2?"), and quick-replies uses the digits then; click the buttons or focus the band (ctrl+x tab).
- **Holding back:** at most one note per turn and one at a time. A note you don't answer disappears with your second message after it. After three ignored notes in a row, sidekick skips the next check, then 2, 4, 8, at most 16; any answer resets that. *Know this* and *Got it* never offer the topic again; the last 50 shown topics aren't repeated either.
- **Cost (measured with 2.1.291, Opus 5.5):** about $0.04 per check at 110–170k context (about 1.5k tokens uncached, 70–500 out, the rest read from the cache), 2–14 s in the background. A long turn of 60 steps makes up to 10 checks. `/savings` lists these costs separately; they are not part of cost and ratio, which measure the message check against its savings.
- **Where:** terminal and desktop app. Not in `claude -p` and other surfaces (no place to show it).

## Commands

| Input | Effect |
|---|---|
| `/sidekick help` or `/sidekick ?` | help table (since 0.14.0): commands, buttons, features with their current state and the command that changes them, settings. Drawn in the terminal and the desktop app with the theme's blue (theme key `ide`, readable in Claude Code's built-in light and dark themes), Markdown elsewhere. The state is the one at the time you run it; run it again after a change. |
| `/sidekick` or `/sidekick status` | settings, cache and context, latest summary, latest hint, latest handoff with message, latest split (to-dos not queued in full) |
| `/sidekick off` · `cache` · `guide` · `plan` · `auto` | set the level (applies to all sessions) |
| `/sidekick on` | back to the last active level |
| `/later <text>` | plan text as 1–4 to-dos with worklist, without Claude reading it |
| `/sidekick threshold 80k` · `big 150k` | trigger (b) or (c) |
| `/sidekick skills on` · `off` | send the skill list to the model check or not |
| `/sidekick long 800` · `off` | trigger (d): characters from which a long message may be split into to-dos (only with worklist); `off` turns only the splitting off |
| `/sidekick ttl 5` · `60` · `auto` | force the cache lifetime. `auto` measures it the way limit-bars does, default 60 min. limit-bars' own setting (`/cache ttl`) does not apply here, because each plugin has its own `$.store`. |
| `/sidekick hints status` | maintenance hints for this project: value per rule, last done and shown, earliest next time |
| `/sidekick hints on` · `off` | all maintenance hints on/off |
| `/sidekick hints <rule> on` · `off` | one rule on/off (`skills-cut`, `audit`, `memory`, `skills-heavy`, `init`) |
| `/sidekick hints done <rule>` | mark as done by hand |
| `/sidekick hints audit-min 2k` | threshold of the audit rule (default 3k) |
| `/sidekick notes` · `notes status` | Good to know: on or off, number of known topics, what it costs |
| `/sidekick notes on` · `off` | Good to know on/off (default off; level Off pauses it too) |
| `/sidekick notes forget` | forget the topics marked *Know this* or *Got it* |
| `/savings [today\|week\|all]` | short balance, default `week`: cost, savings, ratio and the savings items; drawn as a framed card in the terminal and the desktop app (like cost-ledger's `/ledger`), Markdown elsewhere |
| `/savings detail [today\|week\|all]` | everything, default `all`: also how it is computed, models, checks compared per model, by day, hints and counts (`details` works too, words in any order) |
| `/savings help` | points to `/sidekick help` |

An unknown argument to `/sidekick`, `/sidekick hints`, `/sidekick notes` or `/savings` ends with "All commands: `/sidekick help`".

`/savings` shows cost, savings, ratio and the two savings items. `/savings detail` shows all of the following. All amounts are API value; on a subscription the calls count toward your plan's usage.

- **Cost:** all of sidekick's own model calls (check, handoff and split), including cancelled ones, priced from `usage` at the rates of the model actually called, including output.
- **Estimated savings**, calculated conservatively:
  - *Cold start avoided:* first request in the new chat: old context × write price − (read × read price + written × write price), from its measured `usage`.
  - *New chat on a warm large context:* first request: old context × read price − (read × read price + written × write price).
  - For both, from the second request on: (old context − context of the first request) × read price per request, never below 0. Both chats would grow by the same amount from there, so the gap stays. Runs until the new chat reaches the old size, at most 50 requests.
  - The handoff is not subtracted here; it is already in the cost.
  - *Rewritten version, skill, model, split into to-dos:* only counted, not valued in $.
- **Models** (since 0.5.0): sidekick's own calls per model ID (since 0.11.0 a short message in level Auto can count as two checks, one per model), e.g. *Sonnet 5.5*, with a bar for its share of the cost; per role (check, handoff, split) the number of calls, average duration and cost per call, plus tokens in and out. Useful when the model per role changes: old and new model stand side by side. Costs booked before 0.5.0 have no model and appear as *earlier*. Each model also shows the days it was used.
- **Checks compared** (since 0.6.0, from two rows on): per model the number of checks, average price per check (4 decimals), average duration and a factor relative to the cheapest row; below, average tokens and the days used. Tokens are booked per model, not per role: with handoffs they are an average per call (check and handoff). *Earlier* (booked before 0.5.0: Haiku until 0.3, already Sonnet from 0.4) also contains the handoffs of that time, so its price per check is an upper bound (`≤`, rounded up); a factor against it is a lower bound (`≥`, rounded down).
- **By day** (since 0.6.0): per day with activity, newest first (at most 14): cost with a bar, savings, checks and the models used with their calls.
- **Good to know** (since 0.13.0, separate): checks, cost, average duration, and what came of them (shown, explained, known, later, in chat, ignored, no topic, dropped, errors). The short view shows one line when there were checks. The models block lists them under the role *Good to know*.
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
- Lines without a command (e.g. "Unclear which of the three projects is meant.") get no button. Other surfaces (VS Code) show the line as text, without a button.
- If Claude Code refuses the command, it goes into the prompt box at the cursor and a toast says so (Enter sends it). If that is not possible either (a dialog is open) or `/todo` fails, the toast shows the command so you can type it.

## Working with other mods

- **clawd-buddy** shows what sidekick does: while it checks your message, holds it back with a question, or starts a new chat. sidekick writes only the kind of state and a timestamp to `$.state` (`sidekick.buddy`), which clawd-buddy reads. Neither mod needs the other.
- **limit-bars** stays a display. To avoid two dialogs in a row, turn off its cold-cache warning once: **`/cache warn off`** (the German `/cache warnung aus` works too). sidekick's question replaces it.
- Claude Code's built-in plugin **`cc-plugin-you-should-know`** (off by default, availability depends on your organization) does what sidekick's **Good to know** does. Use one of them: with both on, every check runs twice. `/savings` only includes sidekick's own.
- **quick-replies:** its suggestions use the digits 1, 2, 3 … after a turn; a Good-to-know note only carries digits while Claude is working, so they never clash.
- **worklist:** *Ask in chat* is sent as sidekick's message, not in your name, so it doesn't count as your answer to a to-do that stopped with a question.

## Stored data

Everything lives in the plugin's `$.store`:

| Key | Content | Lifetime |
|---|---|---|
| `settings` | `level`, `lastOn`, `threshold`, `big`, `skills`, `ttl`, `long`, `notes` | permanent |
| `cache:<session>` | last activity, TTL, context, model | 7 days |
| `sitzung:<session>` | summary, last 3 messages, ignored hints, hint lines, last commit, a maintenance hint not shown yet, the current Good-to-know note | 7 days |
| `notes:seen`, `notes:known` | Good to know: the last 50 topics shown, and topics marked *Know this* or *Got it* (one sentence each) | permanent (`/sidekick notes forget` clears the known ones) |
| `notes:ignored`, `notes:skip` | Good to know: ignored notes in a row, checks still to skip | until the next answer |
| `bilanz:<session>` | daily values of this session, pending savings booking | until compacted |
| `bilanz:tage` | daily totals of finished sessions (older than 7 days) | permanent |
| `handoff:last`, `basis` | latest handoff with message; measured base load of a new chat | until the next one |
| `wartung:<project>` | per rule: last done (with size and model), last shown; the last 10 chat days | permanent |
| `wartung:nutzung` | skill usage of the last 30 days, read from the balances at most once a day | until the next day |
| `hints` | maintenance hints on/off, disabled rules, audit threshold | permanent |
| `split:last` | latest split: step titles, to-do texts, how many were queued | until the next one |
| `held:last` | a held-back message longer than 1,800 characters, in full (up to 20,000) | until the next one |

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
hooks: session.start, turn.step, tool.call{tool=Bash|PowerShell}, prompt.submit, skill.prompt, ui.render{component=UserMessage}, ui.render{component=AbovePrompt}, command.run{command=sidekick}, command.run{command=later}, ui.render{component=SessionMode}, command.run{command=savings}, ui.render{component=CommandOutput, props has {command=savings}}, ui.render{component=CommandOutput, props has {command=sidekick}}
calls: $.clock.every, $.clock.now, $.command.list, $.command.register, $.command.run, $.model.complete, $.model.fork, $.prompt.fill, $.prompt.read, $.prompt.submit, $.session.id, $.session.messages, $.session.root, $.session.surfaces, $.session.usage, $.state.get, $.state.set, $.store.delete, $.store.get, $.store.keys, $.store.set, $.ui.ask, $.ui.invalidate, $.ui.resolve, $.ui.toast
state writes: sidekick.buddy, sidekick.status
state reads: sidekick.status
```

In plain language:

- `prompt.submit`: reads your message before sending; can hold it back (`drop`) or replace it with the rewritten version, only after you choose so in the dialog (also for splitting into to-dos). **Exception, level Auto** (only after `/sidekick auto`): a rewritten version is sent and a split is made **without asking**. Detects typed maintenance commands as done.
- `turn.step`: reads the token counts of each main-loop request (cache warm/cold, context, savings measurement). Read only. With Good to know on, it also starts the check at step 6, 12, 18 … in the background; the request itself is not changed or delayed.
- `$.model.fork` (Good to know, only after `/sidekick notes on`): one question to your session's own model over its own conversation, with every tool denied, answered as a short JSON. Nothing leaves your session's login; the answer is shown only to you.
- `$.prompt.read`: *Discuss in chat* writes the note only into an empty prompt box; if you have typed something, a notice says so instead.
- `tool.call{tool=Bash|PowerShell}`: after the run, reads `gitOperation.commit` (commit hash). Changes nothing.
- `skill.prompt`: counts which skill ran and detects maintenance skills as done. Changes nothing.
- `ui.render{component=UserMessage}`: appends the hint line to the display of your message, with a button when the line names a command.
- `$.ui.resolve`: builds that button (a button carries its click handler, so it cannot be plain data).
- `$.command.run` (on a click): runs the command shown in the line, as if you typed it. Only commands from plugins, your own commands and skills, and the built-in maintenance commands `/skill-doctor` and `/init`; never MCP prompts, never `/clear`, `/exit`, `/quit`, `/login`, `/logout`, `/rewind`. Or worklist's `/todo`, when worklist is installed and the command is a skill.
- `$.command.run` (to-dos): worklist's `/todo` once per to-do, in order, from a one-off timer (Claude Code refuses it from the send hook). After you chose **Split into n to-dos**, after an automatic split in level Auto, or after `/later`.
- `$.prompt.fill`: as a fallback, when Claude Code refuses the command: puts it into the prompt box at the cursor. Never sends it, never overwrites what you typed. And for *Discuss in chat* (Good to know): puts the note into the empty prompt box, never sends it.
- `ui.render{component=CommandOutput, props has {command=savings}}`: draws the output of `/savings` as a card in the terminal and the desktop app. Only its own command's output; other surfaces and older outputs get the Markdown text.
- `ui.render{component=CommandOutput, props has {command=sidekick}}` (since 0.14.0): draws the output of `/sidekick help` as a table in the terminal and the desktop app. Display only; `/sidekick status`, other outputs and other surfaces stay Markdown.
- `ui.render{component=AbovePrompt}`: only while a new chat is being started or to-dos are being written, a small blue box above the prompt shows progress and seconds; and, with Good to know on, the current note with its buttons. Otherwise the hook passes the band through unchanged to other mods (limit-bars, Clawd).
- `$.model.complete`: Haiku 5.5 for the check (effort `medium`, full ID `claude-haiku-5-5`); Sonnet 5.5 for the check in level Auto from 300 characters and for the rewritten version there (effort `low`), the handoff (effort `medium`) and the to-do texts (effort `low`; it gets the summary, your message and the step titles, or for `/later` only the text): after you chose to split, after an automatic split in level Auto, or after `/later`. The only model calls. Your messages reach the model only through your session's own login.
- `$.session.messages`: beginning and end of the history for the handoff, the end of Claude's last reply for the check, and to detect the first message.
- `$.session.usage`, `$.command.list`: context size, skill names and descriptions; for the maintenance hints, paths and token counts of instruction and memory files (no contents), size of the skill list, model, and whether a command exists.
- `$.session.root`: project root as the key for maintenance hints, and as a fact in the handoff (since 0.12.0). The path only.
- `$.session.surfaces`: detects the desktop app, because there typed messages carry the origin `sdk` like `claude -p`.
- `$.session.id`: detects a new session after `/clear`.
- `$.command.run`, `$.prompt.submit`: for "New chat with handoff" (`/clear`, then send). `$.command.run` also for the button and the to-dos of a split, see above. `$.prompt.submit` also for **Send anyway** after writing the to-dos failed (your message as typed), and for **Ask in chat** in the desktop app (the note and a short request to explain it, as a message from sidekick, only on that click).
- `$.store.*`: settings, summary, cache measurement, balance, latest split.
- `$.ui.ask`, `$.ui.toast`, `$.ui.invalidate`: question dialog, notices, redrawing the line.
- `$.clock.*`: time and a one-off timer for `/clear` and for writing and queuing the to-dos.
- `ui.render{component=SessionMode}`: appends sidekick's label to the footer labels next to the model picker; other labels stay.
- `$.state.get`: reads its own value `sidekick.status` while drawing that label, so the label redraws when the value changes.
- `command.run{command=later}`: `/later`; answers with nothing, so Claude doesn't read the text. A one-off timer then calls Sonnet (`$.model.complete`) for the to-do texts and worklist's `/todo` (`$.command.run`).
- **Level Auto:** `prompt.submit` then sends a rewritten version of your message in your name without asking, and splits a long message into to-dos without asking, but only after you chose `/sidekick auto`.
- `$.state.set`: writes `sidekick.status` (level and whether sidekick is busy, no text) for the footer label, and `sidekick.buddy` for clawd-buddy: only `check`, `stop`, `handoff` or `fresh` and a timestamp, never your message. Writing to-dos sets no extra value.

Explicitly not used: `$.fs`, `$.env`, `$.http`, `$.settings`; no tokens or credentials.

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

**Status and pause:** `/sidekick status` shows the current state and level; `/sidekick off` turns sidekick off without uninstalling it, `/sidekick on` brings it back.

## Known limitations

- **Desktop app** (observed with 2.1.286):
  - `PromptHint` (the line under the prompt) is not triggered there. That's why the hint appears under your message.
  - Typed messages carry `origin` `sdk` there. sidekick recognizes them via `$.session.surfaces()`.
- **VS Code and mobile:** only messages arriving as `composer`/`bridge`, or as `sdk` with the desktop in `$.session.surfaces()`, are checked. Which origin VS Code reports is not documented. By these rules sidekick either doesn't check there or checks only as in the terminal.
- **Accepting hints:** only detectable for skills (the skill runs afterwards) and in the dialog. A line about a version, model or something else counts as ignored with the next message and blocks its type until +50k or the next commit. "Ignored" here means "not detectably accepted".
- **After `/resume`:** the hint lines of the resumed session appear only once something happens again, e.g. the next message or request. Showing them immediately would need an extra right (`classic.SessionStart`).
- **The rewritten version** is only offered if it fits entirely into the dialog (≤ 600 characters). A longer one becomes a line. Messages under 4 words never get a rewritten version. The rewrite always stays your message to the assistant (you as sender); a version that reads like the assistant's reply or a question back to you ("I'm ready – what would you like to do?") is dropped. This is detected in English and German, whatever `language` is set to. The rewrite stays in the language of your message.
- **Commit detection:** a commit made with `git commit -q` goes unnoticed, because the engine parses git's output. Then only the +50k rule applies.
- **Compaction:** without the `session.compact` right, a context that shrank by more than 40 % counts as compaction, not as a cold start.
- The handoff only sees the summary, your first two messages, the end of the history, the project root, the last commit and your new message. In very long chats "first" means the oldest of the newest 4,096 entries Claude Code returns. The model is told not to invent anything and to leave out what it is unsure about; gaps are possible, and open points unrelated to your new message may be left out.
- **Maintenance hints:**
  - `/consolidate-memory` is missing in CLI sessions; the rule stays silent there.
  - A typed `/skill-doctor` is not detected as done in the desktop app. Afterwards run `/sidekick hints done skills-cut`.
  - The check runs on the first own message of a chat. After a change via `/sidekick hints …`, it checks once more on the next message.
  - Messages inserted by the host that start with a tag like `<system-reminder>` don't count as yours.
  - Claude reads the output of `/sidekick hints status` too and sometimes offers the items as tasks.
  - `skills-heavy` only kicks in after 30 days of counting skill usage.
  - The audit rule detects a model change by the model name in the `/context` breakdown; if only its spelling changes, you get an unnecessary hint.
  - Two concurrent chats in the same project can show a hint twice (store not atomic).
- **Wrong chat** is only detected when the model check runs (triggers above). In a small chat below `threshold` nothing is checked, so a message in the wrong small chat goes through. `/sidekick threshold 30k` widens the check, at about $0.001 and 3 s per checked message. sidekick only knows the chat from its running summary, your last 3 messages and the end of Claude's last reply, so a chat that just started has little to compare against.
- **Model alias `haiku` in `/savings`:** priced as Haiku 5.5 (what Claude Code resolves it to since v2.1.293). If you point the alias elsewhere with `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `/savings` does not know; sidekick's own calls always name the full model ID, so this only matters for entries booked under the bare alias.
- **`/savings` card and `/sidekick help` table:** each drawing is kept in memory for the last 10 outputs; after a restart or `/reload-plugins`, older outputs show as Markdown. The help table shows the state at the time it was run and is not redrawn after a change.
- **Splitting into to-dos:** only with worklist. sidekick can't tell a dictated message from a typed one; it only sees length and several tasks. Not offered with an attachment or `@file` (whether worklist resolves `@file` in a to-do is not documented). Messages over 7,600 characters are not offered for splitting (4 to-dos of 1,900 characters); a message close to that may still not fit, then writing fails and sidekick asks again. Only the first 4,000 characters reach the check that proposes the steps.
- **Held-back text and Claude Code's limits:** Claude Code ignores a hold-back reason over 4,096 characters and sends the message anyway, and it shows only about 2,000 characters of a reason (found while building 0.9.0, not documented). sidekick keeps the text in the reason under 1,800 characters and stores longer messages in full for `/sidekick status`.
- **Footer label:** the desktop app does not draw added mode labels; sidekick draws its own ● there (since 0.10.2, checked with desktop app 2.1.288). `/sidekick status` shows whether Claude Code asked for the label at all, on which surface, and whether reading its value failed (since 0.10.1). The engine redraws the label when the state changes (in the terminal, the color depends on the terminal font). Other surfaces show no label.
- **`/later` in the desktop app** ended Claude's turn with desktop app 2.1.286; with 2.1.288 not tested yet (see above).
- **Level Auto:** a rewritten version over 600 characters is not sent (it would not fit into the question either); long dictations come close to that.
- **Cost of question (c):** the "New chat" estimate uses the most recently measured base load of a new chat. Before the first handoff it assumes 20k tokens.
- **Good to know:**
  - It runs on your session's model; sidekick can't pick a cheaper one, because only that model has the conversation in its cache. On a large context each check costs more (estimated ≈ $0.09 at 400k with Opus 5.5).
  - Turns shorter than 6 steps are never checked.
  - How often a note appears was tuned on a handful of real conversations (two rounds, see the SPEC); it may be too quiet or too talkative for you. `/savings detail` shows shown vs. ignored.
  - In the desktop app, *Ask in chat* sends right away, because the app's prompt box can't be filled by a mod.
  - A note found while you already sent your next message is dropped (stale).

## Credits

sidekick's cache logic (`hooks/cache.ts`) is a copy of limit-bars' cache logic, which is modeled on Nate Herk's Cache Keeper (MIT). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
