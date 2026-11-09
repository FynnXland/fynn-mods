# sidekick

Checks your message just before it is sent: first with fixed rules, and only where it can pay off, also with a quick model call (Haiku 5.5). If there is a clearly better move, a blue line appears under your message, or sidekick asks you. Examples of better moves: a new chat with a handoff (always as a question), a clearer version, a skill your message doesn't point to, or a gap only you can fill. If a message clearly belongs to a different project than the chat ("wrong chat?"), sidekick holds it back and recommends cancelling. sidekick never changes your words or sends anything without asking: a clearer version only goes out after you choose it in the dialog; the only thing it adds on its own is a short hidden note for Claude when you write a later item while Claude works (Queue, switchable). Three levels, from off to guide, and a colored label in the prompt footer show how much sidekick does. sidekick never chats on its own. `/savings` shows what it costs and what it demonstrably saves. Optional and off by default: **Good to know**, a note above the prompt while Claude works, when you likely missed something with consequences.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.319** · Plugin version **0.25.1**

**New in 0.25.0: Skill catalog.** sidekick knows a small, hand-picked list of good third-party open-source skills. When your message clearly asks for what one of them does ("make the design feel more like Apple"), it asks once per chat before sending: **Send with apple-design (recommended)**, **Send anyway** or **Don't suggest again**. Three plain-Markdown skills by Emil Kowalski ship with sidekick (MIT, with their license); for the rest it only copies the install command from the source's README, it never installs anything itself. See [Skill catalog](#skill-catalog-since-0250).

**Fixed in 0.25.1:** in the desktop app, clicking **Later ✓** a second time made the button disappear; it now goes back to **Later** and stays until Claude's turn ends.

**Fixed in 0.24.2:** the Later button shows its state as text again (**Later ✓**, German **Danach ✓**); the color of 0.24.0 was not drawn by the desktop app's button.

**New in 0.24.0: Queue.** When you write while Claude is still working and the message is clearly a separate, later item ("after that, update the README"), it still goes straight in, but Claude gets a note to finish the running task first and take up your message afterwards; if the task ends with a question to you or an error, Claude asks or reports first and waits for your answer. Under your message, sidekick's grey line says "comes after this task". Corrections, stops and anything that belongs to the running work go in as before, without a note. To decide yourself, click **Later** in the desktop footer while Claude works, or start the message with `later:`. See [Queue](#queue-since-0240).

**Fixed in 0.24.0: checks in chats that started other chats.** In such chats the desktop app puts a hidden status block (`<system-reminder>`, "Linked sessions now …") in front of every message you type. sidekick took the whole message for a note from the app and skipped it. It now removes that block first and handles the rest like any message of yours. So in those chats the message check (hint lines, questions, model tip on the first message), maintenance hints, the retry loop and the repeat detection of saved prompts now run as well. A message that is only such a block, or a notice from another chat or a background task behind it, still goes through unchecked.

**New in 0.23.0: all settings on the desktop settings page.** Level, thresholds, the model tip, the retry loop and the other switches are now `userConfig` fields, so you can change them under Settings → Plugins → sidekick → Settings. The `/sidekick` commands still work and write the same fields. Your old values move over once at the next start. See [Configuration](#configuration).

**New in 0.21.0: Saved prompts.** An instruction you send again and again in different chats can become your own command, say `/p tidy-chats`, that sends it right away; in the desktop app it also gets a small button in the footer, just before "● sidekick". Save one yourself with `/sidekick save <name>`, or let sidekick notice: when you send the same kind of instruction in three chats, it offers to save it under your message. See [Saved prompts](#saved-prompts-since-0210).

**New in 0.20.0: clawd-buddy knows why.** With clawd-buddy 0.13 or later, Clawd now shows *why* sidekick holds a message back (cold cache, wrong chat, model tip, a clearer version, a new topic), lights a bulb when a hint line appears, oils a gear for a maintenance hint, and can freeze in a block of ice while your chat's cache is cold. sidekick only passes the kind and the reason, never your text. See [Working with other mods](#working-with-other-mods).

**New in 0.19.0: Retry loop and compaction count.** When you write the third correction in a row ("still doesn't work"), sidekick asks before sending whether a fresh chat with a handoff or a short nudge to Claude to step back would help more than a fourth attempt. After the second and the fourth compaction of a chat, the new-chat question comes once on your next message, because each compaction loses details. A compaction also no longer triggers a wrong cold-cache question. See [Retry loop](#retry-loop-since-0190).

**New in 0.18.0: Model tip.** On the first message of a chat that runs on Opus or Fable, sidekick asks before sending whether a simple task should run on Sonnet 5.5 or Haiku 5.5. Optionally (`/sidekick tips auto on`, off by default) it also switches subagents and chats that Claude starts to a cheaper model when their task is simple. `/savings` shows the savings as a marked estimate. See [Model tip](#model-tip-since-0180).

**All commands at a glance:** `/sidekick help` (or `/sidekick ?`) draws a table of every command, the buttons, each feature with its current state and how to change it, and your settings.

**Cost:** sidekick calls Haiku 5.5 and Sonnet 5.5 through your own Claude Code session, so those calls count toward your usage or plan like any other request. With **Good to know** turned on, it also asks your session's own model (see below). Since 0.21.0 the repeat detection of **Saved prompts** gives each longer message of yours a short Haiku call in the background (about $0.0004 each, at most 80 a day). All amounts sidekick shows (in its dialogs and in `/savings`) are estimates at API prices.

## Levels and the footer label (since 0.10.0)

| Level | Command | What sidekick checks | What it does | Cost |
|---|---|---|---|---|
| Off | `/sidekick off` | nothing | nothing | 0 |
| Cache | `/sidekick cache` | only trigger (c), by rules, no model call | the cold-cache question with handoff (below); no hint lines, no maintenance hints | 0, only the handoff you choose |
| Guide | `/sidekick guide` | (a), (b) from `threshold` (80k), (c) | everything below: hint lines, questions, maintenance hints | ≈ $0.001 per check |

- `/sidekick on` brings back the last active level (default Guide). `/sidekick` and `/sidekick status` name the level.
- **Removed in 0.15.0:** the levels Plan and Auto, splitting a long message into to-dos, and `/later` (they needed a to-do helper that is gone). A saved level `plan` or `auto` becomes **Guide** at the next start, without a message. `/sidekick plan`, `/sidekick auto` and `/sidekick long` are unknown commands now.
- Settings from before 0.10.0: `on` becomes Guide, `off` stays Off. `threshold`, `big`, `skills` and `ttl` apply in every level.
- **Footer label:** next to the model picker under the prompt, e.g. `🟢 sidekick · Guide` in the terminal; in the desktop app a colored ● with `sidekick · Guide` (the desktop does not show added mode labels, since 0.10.2). 🟠 while sidekick checks, a question is open, or a handoff is running; `🔴 sidekick off` when off. Other labels in that footer (e.g. from the orchestrator) stay. Terminal and desktop app only.

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

   Order: (c) before (a) before (b).
3. **Model check** with Haiku 5.5 at effort `medium`, about 3 s and about $0.001 per check (measured 2026-10-07: median 3.1 s, all ordinary cases within 6 s). The model never sees the full history. It gets:
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
     - **Send Haiku's version**: the rewritten version is sent. This is the only way a rewritten version leaves your computer: sidekick never sends one without this choice, also not in the cold-cache question. The desktop app still shows your original in the bubble, so below it sidekick shows `· sidekick: Haiku's version was sent` in blue, plus a box with the text that was actually sent.
     - **Send anyway**
     - **Cancel**: the message is not sent; your text is shown in the notice.
   - **Wrong chat** (since 0.5.0): if the message clearly belongs to a different project or field than the chat (e.g. a mobile-game chat and a question about a website's CSS), sidekick holds it back with "This doesn't fit this chat at all. … Are you in the wrong chat?". This is more than a change of topic: a new topic in the same project stays a "new chat" question. Answers, in this order: **Cancel** (recommended; nothing is sent and your text is shown for copying, so you can paste it into the right chat; `/savings` counts it as *accepted*, and the message is removed from what the next check compares against), the fitting new chat (usually without handoff, since another field rarely needs the old history), the other new-chat variant, **Send anyway**. With an attachment or `@file`, only Cancel and Send anyway. After "Send anyway" the question stays quiet until +50k context or the next commit. It is never asked on the first message of a chat or for messages under 4 words, and it takes precedence over the cold-cache question (whose cost is then shown in the same dialog). Unlike the other questions, closing this dialog (Esc) does **not** send: the message is held back like Cancel. A new chat started from here books no savings, because without sidekick the message would have gone to another chat, not into this large one.
   - With trigger (c) the question always comes, with the cost of both paths, e.g. "Sending rewrites everything (≈ $2.40)" versus "New chat with handoff: ≈ $0.26" (Opus 5.5, 1-hour cache, about 20k base load in the new chat).
   - **After a compaction** (since 0.19.0): the next request only writes the summary, so there is no cold-cache question for it, also after Claude Code compacted the chat while you were away. After the **second** and the **fourth** compaction of a chat, your next own message (4 words or more) gets the new-chat question once: *This chat has been compacted 2 times already; each time, details get lost.* Its savings are computed with the current, small context, so they are honestly small. `/clear` starts the count again; `/rewind` does not count.
5. A hint type you ignored only comes back once the context has grown by ≥ 50k or a commit happened in between.

**Fail-open:** on error, timeout (6 s per model call), an unusable model answer or a closed dialog, the message goes through unchanged. **Exception:** if the handoff fails after "New chat with handoff", sidekick does not silently send into the cold chat; it asks again.

The handoff **never** comes from the main model. On a cold cache, the main model would have to re-read the whole history to write it, including via `/compact` or a handoff skill.

## Maintenance hints

Some commands only help if you remember to run them. On your first own message in a chat, sidekick checks what is due and names at most **one** command as a line under a message. It runs nothing and makes no model call for this; the numbers come from a free local estimate (the `/context` breakdown). If the model check has its own line or question for that message, the check wins, and since 0.12.0 the maintenance hint comes with your next message that has neither. It survives `/reload-plugins`; it is dropped if you run the command in between or turn the hint off.

Since 0.16.0 there is **one second measurement per chat**: on your next own message after a commit, or after 60 minutes without an own message. So a chat shows at most two maintenance hints.

Next to the line (since 0.16.0):

- **Insert in prompt** puts the command into the empty prompt box; you send it yourself. The line then reads "✓ in prompt". If you have already typed something, nothing is inserted (a slash command only works at the start of a message) and a notice shows the command. In the **desktop app** the button reads **Copy**: the app draws its own prompt box, which a plugin most likely cannot write to (Claude Code's types say so for surfaces with their own prompt box), so sidekick tries the prompt box first and then puts the command on the clipboard (paste with Ctrl+V). Whether the desktop app accepts the clipboard write is not documented and not yet confirmed; if it does not, the notice shows the command to type.
- **?** (desktop app) opens two or three sentences: what the command does, why it is suggested now (with the measured numbers), and what it costs or changes. In the terminal this text always stands under the line. It is fixed text, no model call.

| Rank | Rule | Command | Due when … | Quiet period after |
|---|---|---|---|---|
| 1 | `skills-cut` | `/skill-doctor` | the skill list no longer fits the budget: Claude only sees part of your skills | 3 days |
| 2 | `audit` | `/claude-api prompt-audit` | the project's CLAUDE.md files total ≥ 2k tokens and the audit never ran, they grew by ≥ 20 % since, or the model changed | 14 days |
| 3 | `memory` | `/consolidate-memory` | the memory index is ≥ 500 tokens and was never cleaned up or grew by ≥ 30 %; from 5k (close to the load limit) always | 7 days, from 5k 3 days |
| 4 | `skills-heavy` | `/skill-doctor` | skill list ≥ 4k tokens and ≥ 10 skills that can be disabled went unused for 30 days (only after 30 days of counting) | 14 days |
| 5 | `init` | `/init` | the project has no CLAUDE.md of its own and you chatted there on ≥ 2 days | 14 days |

The values changed in 0.16.0 (before: 7, 30, 14/7, 30 and 30 days; audit from 3k with 30 % growth, memory from 1k with 40 %, init from 3 days), because the hints came too rarely.

- **Done** is detected when you type the command (or the skill runs), also when you send it after **Insert in prompt**; `/doctor prompt-audit` counts for `audit` too. Inserting or copying alone does not count. In the desktop app plugins do not see a typed `/skill-doctor` or `/init`; there, and whenever you ran it some other way, mark it with `/sidekick hints done <rule>`. If a hint for it came first, `/savings` counts it as accepted.
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

## Model tip (since 0.18.0)

Most work does not need the most expensive model. sidekick rates how demanding a task is and suggests (first message) or sets (subagents and chats Claude starts, with a switch) a cheaper model. Effort stays as it is.

| Level | Example | Target |
|---|---|---|
| very simple | only read, search, look up, summarise, give an overview or answer a short question; no file changes | **Haiku 5.5** (with `/sidekick tips haiku off`: Sonnet 5.5) |
| simple | the task says what to do, even across several steps or files: a component or change to a precise spec, a bug whose cause and place are given, docs, translations, a research report, a test run by a fixed procedure | **Sonnet 5.5** |
| medium / hard | judgement where a mistake is costly (debugging without a lead, a review for hidden logic errors, legal or security questions, design with taste), a planning chat, continuing unknown work, building a feature or app | nothing changes |

When in real doubt the higher level applies; without a rating nothing changes.

- **First message (default on):** the check that runs on the first message anyway rates the task too. If your main model is Opus or Fable and the task looks simple, sidekick asks before sending: *Looks simple (reason). With Sonnet 5.5 ≈ 50 % of the price. Send with which model?* Answers, the recommended one first: **Send with Haiku 5.5** (only for very simple tasks) · **Send with Sonnet 5.5** · **Send with Opus 5.5** · **Don't ask again**. Your message always goes out unchanged. If you pick a cheaper model, every main request of this chat runs on it from then on; the footer label shows `→ Sonnet`. The model picker of the app keeps showing your main model, because sidekick changes the model per request and leaves your setting alone (`/model` from a mod would save the model as your default for new sessions). Back to the main model: `/sidekick tips stop`, `/model …`, or picking another model in the picker.
- **Not asked:** at most once per chat and never mid-chat; not for commands, messages under 4 words or with an attachment, not when the check has its own question, not in chats another chat started (sidekick recognises the brief the desktop app puts in front, and long handoffs that start with `# `), and not on levels Off and Cache. Three times **Send with Opus** in a row: the tip pauses for 7 days and a notice says so once.
- **Subagents (off by default, `/sidekick tips auto on`):** before a built-in subagent that takes the main model (`general-purpose`, `Explore`, `Plan`, `claude`, workflow agents) starts on Opus or Fable without a model, Haiku 5.5 rates its task (effort `low`, at most 6 s, about $0.001). For simple tasks sidekick sets `model: sonnet` or `haiku`, and a line in the agent's window says so (*sidekick: Haiku 5.5 instead of Opus 5.5 (reason)*). Forks, resumed agents, teammates, calls that already name a model, built-in agents with a model of their own (`claude-code-guide`, `statusline-setup`), and plugin or user agents (they may have their own model in their file, which sidekick cannot read) stay untouched. If the session forces one model on all subagents, nothing is booked.
- **Chats Claude starts (desktop app, same switch):** the same rating for `start_session` without a model and not as a fork; sidekick passes `claude-sonnet-5-5` or `claude-haiku-5-5`. The new chat then asks no question and books its steps against the original model.
- **Guideline (same switch):** once per chat, Claude gets one short paragraph it reads and you don't see: give the Agent tool `model: "sonnet"` for simple, clearly described tasks and `model: "haiku"` for pure reading. When Claude follows it, `/savings detail` lists that under *Claude chose itself (not counted)*.
- **In `/savings`:** a line *Model tips ≈ $x (estimate) · n runs*, included in the savings total and the ratio. `/savings detail` has a section per way (first chat, subagents, chats by Claude, Claude chose itself) with runs, $ saved, per run and struck runs, plus the ratings (count, cost, average duration, levels), a look back at subagents that stayed on Opus, and the method.
- **How it is computed (estimate):** for each step of a switched run, what the same tokens would have cost on the original model minus what they cost on the target model, with the same price table as sidekick's own bookings. Opus would have used other steps and thinking tokens, so the figure is an order of magnitude, not a measurement. **Check against reality:** going back to Opus or Fable in the same chat, a subagent that ends with an error or is aborted, or the same task started again on Opus within 30 minutes strikes the booking (*back* / *missed*); the share shows in `/savings detail`.
- **Residual risk:** a task rated "simple" by mistake costs rework on a weaker model. The rating only sees the task, not the code. The probe before the build (60 real cases, 2026-11-04) agreed with the owner's own judgement in 16 of 20 and rated 6 of 41 large tasks (over 60 steps or edits in several files) as simple.
- **No effort tip:** lowering the effort for a simple message in a large chat keeps the cache, but a measurement for 0.19.0 (42 runs in a 117k chat, 2026-11-06) saved only 2–4 % of a round's cost: almost all of it is reading the cached history, and the answer itself is a few hundred tokens. sidekick therefore leaves the effort alone.

## Retry loop (since 0.19.0)

After two failed corrections, a fresh start usually lands better than a third one in the same history. sidekick counts your **corrections in a row**: messages that say Claude's last attempt didn't work, such as "still doesn't work", "geht immer noch nicht", "same error", "didn't fix it", "that's wrong". Only fixed rules decide, in German and English, on the first 400 characters (in long dictated lists a "still" usually stands somewhere in passing). Calibrated on 30 hand-labelled real messages: 10 of 11 corrections found, no false alarm. A series ends with a message that is not a correction, a new commit, `/clear`, `/rewind`, `/compact` or any compaction.

On the **third** correction in a row, sidekick asks before sending: *This is the third correction in a row. A fresh start usually lands better than a fourth attempt in the same history.* The text also points to `/rewind` to go back to before the first attempt (sidekick doesn't run it; it opens a picker). Answers, the recommended one first:

- in a large chat (context at or above `threshold`) or with a cold cache: **New chat with handoff** (with its cost) · **Send with a nudge** · **Send unchanged**
- otherwise: **Send with a nudge** · **New chat with handoff** · **Send unchanged**
- with an attachment or `@file`: no new chat

**New chat with handoff** works as usual; the handoff gets an extra section *What didn't work*: the failed attempts and, where the history shows it, why they failed, without new guesses. **Send with a nudge** sends your message unchanged and gives Claude a short paragraph you don't see: *step back, restate the goal, list what was tried and why it failed, check the root cause, then choose an approach.* Closing the dialog sends unchanged.

- **Not annoying:** at most once per series; three times **Send unchanged** in a row and the question pauses for 7 days (a notice says so once); only on level Guide; never in `claude -p`. A wrong-chat question takes precedence; a cold-cache question gets the sentence about the loop instead of a second dialog.
- **`/sidekick loop on` · `off`** (default on), `/sidekick loop` shows the state and the corrections in a row in this chat.
- **In `/savings detail`:** *Retry loop* in the hints (shown, accepted, ignored, cancelled). A new chat from it books its savings like any new chat. The nudge books no amount, because its effect can't be measured; it is counted, together with how often the next message was a correction again.
- **Limit:** the owner's transcripts of 14 days (819 own messages) held 11 corrections and no series of three, so the question will be rare.

## Saved prompts (since 0.21.0)

Some instructions come back in chat after chat, worded differently each time (often dictated): "sort the chats under you by what they are really for and archive the ones we no longer need". sidekick turns such an instruction into a command of your own.

- **Save it yourself:** `/sidekick save <name>` saves your last message in this chat unchanged; `/sidekick save <name> <text>` saves the text. You send it with `/p <name>`, so a name never collides with other commands. Names are `a-z`, `0-9` and `-`, at most 24 characters. Saving under one of your own names replaces it. At most 12 prompts.
- **Send it:** `/p <name>` (the menu lists your names after `/p`; `/p` alone lists them too). It sends the text right away as your message (marked "Prompt from the sidekick plugin" in the transcript), and Claude reads it like anything you type. While Claude is still answering, it goes out after the answer. What the prompt asks for (archiving chats, say) Claude does with its own tools and their permission prompts; sidekick only sends the text.
- **Buttons:** in the desktop app, up to 4 saved prompts get a small button in the footer, just before "● sidekick", in the order you saved them. One click sends, a second click before it went out does not send twice. The terminal has no buttons there; the commands work everywhere except `claude -p`.
- **Repeats noticed (level Guide only, never in `claude -p`):** in the background, Haiku 5.5 gives each longer message of yours (60 characters and 8 words or more, not a slash command) a short intent like "tidy up chats", reusing one it gave before when it is the same kind of request. One-off requests (a specific bug, an answer to a question) are not kept. When the same intent shows up in **three different chats**, a second Haiku call checks whether the messages really give the same recurring instruction and, if so, proposes a name and a general version of it. A line under your message then reads *You send this often. Save it as /p tidy-chats?* with **Save** and **No**. The message itself is never held up. If the line under that message is already taken by the message check, the offer comes under your next message. **No**, or a "not the same" from Haiku, retires that group for good.
- **Manage them:** `/sidekick prompts` lists them (in the terminal and the desktop app with **Send**, **Button on/off** and **Delete** per row), `/sidekick prompts <name>` shows the full text, `/sidekick prompts <name> on|off` switches its button, `/sidekick forget <name>` deletes it. A prompt saved in one chat can be sent with `/p <name>` in other open chats right away; their menu hint and footer buttons catch up with their next start or `/sidekick prompts` there.
- **All chats, all projects:** the set is shared, like sidekick's settings.
- **Cost:** about $0.0004 per intent call, at most 80 a day, and at most 5 proposal calls a day; with about 50 longer messages a day roughly 2 cents a day. `/savings` lists them under the role *Prompts*.
- **How well it finds repeats:** tried on the owner's real messages (1,550 desktop messages over 30 days): a word comparison could not tell dictated rewordings of the same instruction from unrelated messages, so sidekick asks Haiku instead. In that trial 2 of 3 versions of the chat-tidying instruction got the same intent; one borderline message (archive two specific chats) joined the group, which the proposal call or your **No** can still turn down.

## Queue (since 0.24.0)

Claude Code already hands a message you send mid-turn to Claude as soon as the running tool calls finish, inside the same turn. That is right for "no, take the other file", but a separate request like "after that, also update the README" can then pull Claude away from the work it has nothing to do with. sidekick marks such messages for Claude.

- **When:** only on level **Guide**, only for messages you write while a turn runs, never in `claude -p`. A message you send with `ctrl+x enter` (wait its turn) is left to Claude Code's own queue. Messages from other chats, plugins and the app itself never get a note.
- **No note (no model call):** attachments, images, `@file`, slash commands, three words or fewer ("ok", "go on"), a start with a stop, no or correction word (stop, wait, no, don't, instead, cancel; German too), a correction like "still doesn't work", and messages that ask for something now or in parallel ("now", "meanwhile", "in parallel"; German too).
- **Note without a model call:** a message that starts with "after that", "next,", "when you're done", "later", "afterwards" (German: „danach“, „anschließend“, „als Nächstes“, „wenn du fertig bist“, „später“, „zum Schluss“).
- **Otherwise Haiku 5.5 decides** in one short call (about $0.00025), from your new message, the message that started the turn and the end of what Claude wrote so far. It marks a message only when it is clearly a separate, later item, with a confidence of at least 0.7. Any error, a timeout (4 s) or an unclear answer lets the message in without a note.
- **What happens:** the message goes in unchanged and right away, as before. Claude also reads, hidden from you: finish the running task completely without interrupting it; if it ends with a question to the user or an error, ask or report first and take up this item only after the answer; otherwise do it afterwards. Under your message, sidekick's grey line says "comes after this task · reason".
- **Decide yourself:** in the desktop app, while Claude works, a **Later** button (German: **Danach**) sits left in the footer. Click it and your next message in this turn counts as a later item, with no model call (the button then reads **Later ✓**); a second click undoes it, and it expires when the turn ends. Anywhere, also in the terminal: start the message with `later:` or `danach:`; sidekick removes the prefix before sending.
- **Switch:** `/sidekick queue` shows the state, `/sidekick queue on|off` switches it right away (the setting `queue`, on by default). A change on the desktop settings page applies in new chats only. With the queue off there is no button and the prefix stays in your message.
- **How well it works:** tried with 9 cases in a stream like the desktop app's, on Opus 5.5: Claude never interrupted the running task; when the task ended with a question or an error (6 cases), it did not do the later item unasked but said it would after your answer. The decision itself was tried on 40 real messages the owner wrote mid-turn, marked blind: 1 of 40 was marked although it belonged to the running work, and 2 to 3 of the 5 real "later" messages were marked. In doubt sidekick adds no note; a missed "later" just behaves as before.

## Skill catalog (since 0.25.0)

There are good skills out there that Claude only uses if you have them and remember to ask. sidekick carries a short, curated list of them (`hooks/catalog.ts`): name, author, license, source pinned to a commit, risk, a one-line summary and a few keywords. It never searches the web.

- **When:** only on level **Guide**, only for messages you type while Claude is idle, never in `claude -p`. Not for slash commands, messages under 4 words, handoffs or briefs from another chat, and not for a skill you already have installed.
- **Cheap first step:** a keyword filter (no model call) looks for words such as "Apple", "iOS", "GSAP", "ScrollTrigger", "worst case", "playwright" (German too). Only on a hit does Haiku 5.5 judge in one short call (about $0.00024) whether the message itself asks for that skill's task; it needs a confidence of at least 0.7. If the message check runs anyway (first message, large or cold chat), the candidates go into that call instead of a second one. Any error, a timeout (4 s) or an unclear answer lets the message through unchanged.
- **One thing at a time:** if the message check already shows a line or asks a question, the catalog stays quiet. Each entry is offered at most once per chat, and there is at most one catalog question per 10 of your messages.
- **Bundled skill:** "There is *apple-design* by Emil Kowalski for this (MIT, ships with sidekick): … How to send?" **Send with apple-design (recommended)** sends your message as typed, with the skill's text attached for Claude (hidden from you; the message is not held, attachments go along). The question says what that costs in context: about 5.8k tokens for apple-design, 6.9k for emil-design-eng, 3.6k for break-ui (plus about 2k if Claude reads its `CATALOG.md`). Under your message it says "sent with apple-design". You can also run the skill yourself any time: `/sidekick:apple-design <your text>`.
- **Reference:** "There is *gsap-skills* by GreenSock for this (MIT, not installed) …" **Copy the install command, hold the message (recommended)** copies the line from the source's README and holds your message; the reason shown contains your text. Paste the command, confirm it in Claude Code, run `/reload-plugins`, then send again.
- **Heavy reference** (large download, global behaviour change or telemetry): no question, the message goes through; a line under it names the skill with its risk and has a **Copy** button. Shown only at a confidence of 0.9.
- **Don't suggest again** mutes the entry in all chats. `/sidekick catalog` lists all entries with buttons **Copy command** and **Mute/Unmute**; `/sidekick catalog mute|unmute <id>` does the same as text. `/sidekick catalog off` turns the catalog off (setting `catalog`, on by default).

| Entry | Author | License | Way | Command copied |
|---|---|---|---|---|
| apple-design | Emil Kowalski | MIT | bundled | `/sidekick:apple-design` |
| emil-design-eng | Emil Kowalski | MIT | bundled | `/sidekick:emil-design-eng` |
| break-ui | Emil Kowalski | MIT | bundled | `/sidekick:break-ui` |
| animate, review-animations | Emil Kowalski | MIT | reference | `npx skills@latest add emilkowalski/skills` (unpinned) |
| mobile-native | Emil Kowalski | MIT | reference | `npx skills@latest add emilkowalski/skills` (unpinned) |
| impeccable | Paul Bakaus | Apache-2.0 | reference | `/plugin marketplace add pbakaus/impeccable` |
| gsap-skills | GreenSock | MIT | reference | `/plugin marketplace add greensock/gsap-skills` |
| earshot | Leon Lin | MIT | heavy (Python, ≈ 1 GB models) | `uv tool install "earshot[mcp] @ git+https://github.com/Leonxlnx/earshot"` |
| superpowers | Jesse Vincent | MIT | heavy (hooks, changes behaviour everywhere) | `/plugin install superpowers@claude-plugins-official` |
| mattpocock-skills | Matt Pocock | MIT | reference | `claude plugin install mattpocock-skills@claude-plugins-official` |
| playwright | Microsoft ([playwright-mcp](https://github.com/microsoft/playwright-mcp), via claude-plugins-official) | Apache-2.0 | reference (runs `npx @playwright/mcp@latest`, Chromium) | `/plugin install playwright@claude-plugins-official` |
| hyperframes | HeyGen | Apache-2.0 | heavy (telemetry) | `claude plugin marketplace add heygen-com/hyperframes` |

**Origin and licenses.** The three bundled skills are copies from [emilkowalski/skills](https://github.com/emilkowalski/skills) at commit `5206a95` (MIT, Copyright 2026 Emil Kowalski), each folder with the original `LICENSE`. The only change is in the frontmatter: a line naming the source and `disable-model-invocation: true`, so Claude never loads them on its own and their descriptions take no room in the context. sidekick reads these files but runs no code from them. Licenses were read from the GitHub API, install lines from each source's README (checked 2026-11-09). Details in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**How well it works:** tried on 300 real messages of the owner (all keyword hits plus a random sample of about 3,300), marked blind: no unneeded question in three runs; of the two messages that would really have fit, one was found (the other mixed several tasks). The keyword filter fires on about 1 in 100 messages.

## Handoff (since 0.22.0, moved here from limit-bars)

`/handoff` writes a short handoff so a fresh chat can carry on without the old history, then asks: **New chat with handoff (recommended)** or **Keep working here**. A new chat runs `/clear` (the old chat stays reachable via `/resume`) and sends the handoff as its first message ("Handoff from my previous chat: …"). The question names the way it was written, what it cost and its **Next** line.

- **The cheapest good way, chosen per chat:**
  - **From the chat (fork):** while the prompt cache is warm, your main model writes the handoff itself over the whole conversation, tool results included, reading it from the cache (≈ $0.06 for 150k context on Opus 5.5, about 12 s). It runs without tools and without its own effort level, so the cache is read on every model (measured: about 100 % read).
  - **From the history (text):** when the cache is cold or unknown, Sonnet 5.5 writes it from sidekick's running summary and the start and end of the conversation as text (up to 100,000 characters, no tool results, ≈ $0.08). A cold fork would rewrite the whole context (≈ $1.20 for 150k on Opus 5.5 with the 1-hour cache).
  - The rule: fork when it costs at most 3 × the text way, because it sees everything. In practice: warm → fork, cold → text, a cold fork only in very small chats. A fork that fails, gives no handoff or takes over 60 s falls back to the text way. The same choice applies to **New chat with handoff** in sidekick's questions.
  - `/handoff fork` and `/handoff text` force a way (for comparing).
- **Template (fork and skill):** goal, status, **Next** (exactly one step: the agreed next step, otherwise "wait for the user"; from a question: what your held-back message asks for), the user's constraints, done, ruled out, work state (unsaved, verified), read first (at most 5 files), open. At most 350 words, absolute paths, nothing from CLAUDE.md or memory, no secrets.
- **Template (text way):** the shorter one from earlier versions (task, done, read first, open; on the retry loop also *What didn't work*), now with absolute paths. In a test on real chats it kept the user's constraints and ruled-out approaches better when only the text is available.
- Both: sidekick inserts the project root and the last commit of this chat as a table itself.
- **Skill `write-handoff`** (for Claude only, not in the `/` menu): when you ask in the chat for a handoff ("wrap up the chat", „Übergabe“), Claude writes it visibly in that turn; sidekick catches it and asks the same question.
- **Suggestion before the cache expires:** on `cache` and `guide`, in a chat of at least `big` (150k) that is idle in its last 5 minutes of cache (last minute with the 5-minute cache), one line appears above the prompt once per cache window: when the cache expires, what `/handoff` costs now and what the next message would cost after that. Buttons: **/handoff**, **/keepwarm** (only with limit-bars) and **Later**. It disappears on a click, with the next turn or when the cache goes cold, and is drawn only when it appears or disappears. limit-bars' own notice stays quiet meanwhile.
- **Saved:** the last 3 handoffs. `/handoff show` prints the last one, `/handoff continue` starts a new chat with it. `/sidekick status` shows it too.
- **Where:** in every level, also Off (it is an explicit command). In `claude -p` only `show` and `help` work. During an answer it starts after the answer.
- **In `/savings detail`:** handoffs by way (fork and text with their cost, a fork that read less than half of the context from the cache although it was expected warm, the skill only counted) and the suggestion (shown, `/handoff` clicked, ignored).

## Commands

| Input | Effect |
|---|---|
| `/handoff` | write a handoff the cheapest good way, then ask about a new chat (see [Handoff](#handoff-since-0220-moved-here-from-limit-bars)) |
| `/handoff fork` · `text` | force the way |
| `/handoff show` · `continue` | print the last handoff, or start a new chat with it (`zeigen`, `weiter` work too) |
| `/handoff help` | points to `/sidekick help`, starts nothing |
| `/sidekick help` or `/sidekick ?` | help table (since 0.14.0): commands, buttons, features with their current state and the command that changes them, settings. Drawn in the terminal and the desktop app with the theme's blue (theme key `ide`, readable in Claude Code's built-in light and dark themes), Markdown elsewhere. The state is the one at the time you run it; run it again after a change. |
| `/sidekick` or `/sidekick status` | settings, cache and context, latest summary, latest hint, latest handoff with message |
| `/sidekick off` · `cache` · `guide` | set the level (applies now in this chat, in other open chats after `/reload-plugins`) |
| `/sidekick on` | back to the last active level |
| `/sidekick threshold 80k` · `big 150k` | trigger (b) or (c) |
| `/sidekick skills on` · `off` | send the skill list to the model check or not |
| `/sidekick ttl 5` · `60` · `auto` | force the cache lifetime. `auto` measures it the way limit-bars does, default 60 min. limit-bars' own setting (`/cache ttl`) does not apply here; each mod has its own field. |
| `/sidekick hints status` | maintenance hints for this project: value per rule, last done and shown, earliest next time |
| `/sidekick hints on` · `off` | all maintenance hints on/off |
| `/sidekick hints <rule> on` · `off` | one rule on/off (`skills-cut`, `audit`, `memory`, `skills-heavy`, `init`) |
| `/sidekick hints done <rule>` | mark as done by hand |
| `/sidekick hints audit-min 2k` | threshold of the audit rule (default 2k) |
| `/sidekick notes` · `notes status` | Good to know: on or off, number of known topics, what it costs |
| `/sidekick notes on` · `off` | Good to know on/off (default off; level Off pauses it too) |
| `/sidekick notes forget` | forget the topics marked *Know this* or *Got it* |
| `/sidekick tips` · `tips status` | Model tip: switches, this chat, the last 10 switches, savings this week (estimate). After a switch the first line says what changed, or that it was already set (since 0.18.1) |
| `/sidekick tips on` · `off` | ask on the first message (default on) |
| `/sidekick tips auto on` · `off` | switch subagents and chats Claude starts, plus the guideline (default off) |
| `/sidekick tips haiku on` · `off` | Haiku as the target for very simple tasks; off: always Sonnet (default on) |
| `/sidekick tips stop` | this chat back to the main model (the booking is struck) |
| `/sidekick loop` · `loop status` | Retry loop: on or off, corrections in a row in this chat (since 0.19.0) |
| `/sidekick loop on` · `off` | ask on the third correction in a row (default on); `on` also ends a pause |
| `/sidekick save <name> [text]` | save your last message in this chat, or the text, as the command `/p <name>` (since 0.21.0) |
| `/sidekick prompts [name]` | the saved prompts with their buttons; with a name the full text |
| `/sidekick prompts <name> on` · `off` | button for this prompt on or off (at most 4 are shown) |
| `/sidekick forget <name>` | delete a saved prompt |
| `/p <name>` | send a saved prompt right away as your message; during an answer, after it. `/p` alone lists the names |
| `/sidekick catalog` | skill catalog (since 0.25.0): every entry with author, license, bundled or reference, installed or muted, with buttons **Copy command** and **Mute** |
| `/sidekick catalog on` · `off` | suggest fitting third-party skills once per chat before sending (default on) |
| `/sidekick catalog mute <id>` · `unmute <id>` | mute an entry or suggest it again |
| `/sidekick:apple-design`, `/sidekick:emil-design-eng`, `/sidekick:break-ui` `[text]` | run a bundled skill yourself (since 0.25.0; Claude never loads them on its own) |
| `/sidekick language [de\|en]` | switch the language of **all** installed fynn-mods at once (clawd-buddy, cost-ledger, limit-bars, quick-replies, sidekick, tune-strip), one line per mod in the answer; without a value, show each mod's current language (since 0.17.0). Applies right away: Claude Code reloads each mod it changes. In the desktop app and `claude -p`, where Claude Code lists no plugin settings, it goes through `claude plugin configure` instead (since 0.17.1): saved for the next chat, and right away in the current one after `/reload-plugins` |
| `/savings [today\|week\|all]` | short balance, default `week`: cost, savings, ratio and the savings items; drawn as a framed card in the terminal and the desktop app (like cost-ledger's `/ledger`), Markdown elsewhere |
| `/savings detail [today\|week\|all]` | everything, default `all`: also how it is computed, models, checks compared per model, by day, hints and counts (`details` works too, words in any order) |
| `/savings help` | points to `/sidekick help` |

An unknown argument to `/sidekick`, `/sidekick hints`, `/sidekick notes` or `/savings` ends with "All commands: `/sidekick help`".

`/savings` shows cost, savings, ratio and the two savings items. `/savings detail` shows all of the following. All amounts are API value; on a subscription the calls count toward your plan's usage.

- **Cost:** all of sidekick's own model calls (check and handoff), including cancelled ones, priced from `usage` at the rates of the model actually called, including output. Splits written by 0.9 to 0.14 stay in the history.
- **Estimated savings**, calculated conservatively:
  - *Cold start avoided:* first request in the new chat: old context × write price − (read × read price + written × write price), from its measured `usage`.
  - *New chat on a warm large context:* first request: old context × read price − (read × read price + written × write price).
  - For both, from the second request on: (old context − context of the first request) × read price per request, never below 0. Both chats would grow by the same amount from there, so the gap stays. Runs until the new chat reaches the old size, at most 50 requests.
  - The handoff is not subtracted here; it is already in the cost.
  - *Rewritten version, skill:* only counted, not valued in $. The model tip's question is counted under *Model tip*.
  - *Model tips (estimate, since 0.18.0):* see [Model tip](#model-tip-since-0180).
- **Models** (since 0.5.0): sidekick's own calls per model ID, e.g. *Haiku 5.5*, with a bar for its share of the cost; per role (check, handoff; older history may also show split) the number of calls, average duration and cost per call, plus tokens in and out. Useful when the model per role changes: old and new model stand side by side. Costs booked before 0.5.0 have no model and appear as *earlier*. Each model also shows the days it was used.
- **Checks compared** (since 0.6.0, from two rows on): per model the number of checks, average price per check (4 decimals), average duration and a factor relative to the cheapest row; below, average tokens and the days used. Tokens are booked per model, not per role: with handoffs they are an average per call (check and handoff). *Earlier* (booked before 0.5.0: Haiku until 0.3, already Sonnet from 0.4) also contains the handoffs of that time, so its price per check is an upper bound (`≤`, rounded up); a factor against it is a lower bound (`≥`, rounded down).
- **By day** (since 0.6.0): per day with activity, newest first (at most 14): cost with a bar, savings, checks and the models used with their calls.
- **Prompts** (since 0.21.0): the detection's Haiku calls are part of the cost and appear under their own role *Prompts* in the models block; the short view shows one line when there were calls.
- **Queue** (since 0.24.0): the Haiku calls of the queue are part of the cost and appear under the role *Queue*; one line counts how often a message was passed to Claude as a later item. No savings in $, because that cannot be measured.
- **Catalog** (since 0.25.0): the Haiku calls of the skill catalog are part of the cost and appear under the role *Catalog*; one line counts offered, sent with a skill, command copied, sent anyway and muted. No savings in $.
- **Good to know** (since 0.13.0, separate): checks, cost, average duration, and what came of them (shown, explained, known, later, in chat, ignored, no topic, dropped, errors). The short view shows one line when there were checks. The models block lists them under the role *Good to know*.
- The detailed view starts with the date range of the data.
- **Counts:**
  - checks and average wait
  - hints by type (shown, accepted, ignored, cancelled)
  - handoffs and model hints
  - nudges from the retry loop and how often the next message was a correction again (since 0.19.0)
  - saved prompts (since 0.21.0): detection calls with their cost, offered, saved, declined, sent
  - cold starts without a question, with their cost
  - skills used, with a pointer to `/skill-doctor`
  - maintenance hints per rule (shown, accepted)

## Button under the hint line (since 0.7.0, runs directly since 0.8.1)

Maintenance lines have their own buttons since 0.16.0 (**Insert in prompt** / **Copy** and **?**, see [Maintenance hints](#maintenance-hints)). This section is about the lines from the message check: when such a line names a command, a button sits next to it. That is a skill sidekick suggests, or since 0.8.1 a command in the sentence that exists in this session (from a plugin, your own command or skill, or `/skill-doctor` and `/init`; other built-in commands and MCP prompts get no button):

- **Run /command**: the default. The button names the command, one click runs it, as if you had typed it and pressed Enter. If Claude is still working, it runs once the current turn is done. The line then reads "✓ ran"; a maintenance command run this way counts as done.
- **Handoff:** a line that suggests a handoff (`/uebergabe`, `limit-bars:uebergabe`, `sidekick:write-handoff`) shows and runs sidekick's own **`/handoff`** (since 0.22.0).
- Short names are resolved: `/name` finds `plugin:name` when exactly one plugin has it. Unknown or ambiguous names, file paths like `/hooks/hooks.json` or `/init.ts`, and words without a slash get no button. `/clear`, `/exit`, `/quit`, `/login`, `/logout` and `/rewind` never get one.
- What the button says is what it does: the target is decided when the line is drawn.
- Lines without a command (e.g. "Unclear which of the three projects is meant.") get no button. Other surfaces (VS Code) show the line as text, without a button.
- If Claude Code refuses the command, it goes into the prompt box at the cursor and a toast says so (Enter sends it). If that is not possible either (a dialog is open), the toast shows the command so you can type it.

## Working with other mods

- **clawd-buddy** shows what sidekick does: while it checks your message, holds it back with a question, or starts a new chat. sidekick writes only the kind of state and a timestamp to `$.state` (`sidekick.buddy`), which clawd-buddy reads. Neither mod needs the other.
  - Since 0.20.0 (for clawd-buddy 0.13 or later) a question also carries its reason: `cold` (cold-cache question), `wrong` (wrong chat), `model` (model tip), `rewrite` (the question offers the clearer version), `topic` (new chat for a new topic). If several apply, the first in this order wins. The retry loop and the compaction question carry no reason, so Clawd shows the plain stop sign there.
  - Two short moments, also since 0.20.0: `hint` when a hint line appears under your message and `upkeep` when a maintenance hint appears. Both clear after 4 and 5 seconds.
  - `sidekick.status` also says `cold: true` while sidekick's own cache estimate for this chat has run out (last request plus TTL, on `cache` and `guide`; never on `off`, never in a new chat before its first request). It is checked at most once a minute and written only when it changes; the next request of the chat clears it. Clawd may then freeze in a block of ice.
  - An older clawd-buddy ignores the new values, so nothing changes there.
- **limit-bars** stays a display. Since limit-bars 0.14.0 its cold-cache warning steps aside by itself while sidekick runs on `cache` or `guide`, so there are no two dialogs in a row; with an older limit-bars, turn it off once with **`/cache warn off`** (the German `/cache warnung aus` works too). Since sidekick 0.22.0 and limit-bars 0.15.0, `/handoff` lives only in sidekick, and limit-bars' notice before expiry stays quiet while sidekick suggests it. Update both together: with limit-bars 0.14 still installed, whichever plugin loads first owns `/handoff`.
- Claude Code's built-in plugin **`cc-plugin-you-should-know`** (off by default, availability depends on your organization) does what sidekick's **Good to know** does. Use one of them: with both on, every check runs twice. `/savings` only includes sidekick's own.
- **tune-strip** (since 0.15.2): in the desktop app, the handoff box and the Good-to-know note stand above the full tune-strip bar, with a thin blue line below them that disappears with them. In the terminal nothing changed.
- **quick-replies:** its suggestions use the digits 1, 2, 3 … after a turn; a Good-to-know note only carries digits while Claude is working, so they never clash.

## Stored data

Everything lives in the plugin's `$.store`:

| Key | Content | Lifetime |
|---|---|---|
| `runtime` | since 0.23.0: the last level that was on (for `/sidekick on`), model tip and retry loop: answers in a row and pause until. The settings themselves are in `userConfig` (see [Configuration](#configuration)); the `settings` key of 0.22.0 and older is moved there once and then marked `migrated` (kept for chats still running 0.22.0) | permanent |
| `tip:<session>` | model tip of this chat: from, to, when, reason, estimated savings so far | 7 days |
| `spawn:<agent>` | a watched subagent: from, to, reason, description, estimated savings | 2 days |
| `brief:<hash>` | a brief Claude passed to a new chat: its first 200 characters, from and to model | 2 days or until the new chat starts |
| `tips:recent` | the last 10 switches for `/sidekick tips` (time, way, models, task description) | until replaced |
| `cache:<session>` | last activity, TTL, context, model | 7 days |
| `sitzung:<session>` | summary, last 3 messages, ignored hints, hint lines, last commit, a maintenance hint not shown yet, the current Good-to-know note; since 0.19.0 the corrections in a row, compactions of this chat and whether the next request follows one | 7 days |
| `notes:seen`, `notes:known` | Good to know: the last 50 topics shown, and topics marked *Know this* or *Got it* (one sentence each) | permanent (`/sidekick notes forget` clears the known ones) |
| `notes:ignored`, `notes:skip` | Good to know: ignored notes in a row, checks still to skip | until the next answer |
| `bilanz:<session>` | daily values of this session, pending savings booking | until compacted |
| `bilanz:tage` | daily totals of finished sessions (older than 7 days) | permanent |
| `handoffs` | the last 3 handoffs (time, chat, text, way, cost, held-back message); since 0.22.0, the older `handoff:last` is taken over once | the last 3 |
| `basis` | measured base load of a new chat | until the next one |
| `wartung:<project>` | per rule: last done (with size and model), last shown; the last 10 chat days | permanent |
| `wartung:nutzung` | skill usage of the last 30 days, read from the balances at most once a day | until the next day |
| `hints` | disabled maintenance rules (on/off and the audit threshold moved to `userConfig` in 0.23.0) | permanent |
| `catalog:muted` | since 0.25.0: catalog entries you muted (ids only) | until unmuted |
| `offDefaults2` | since 0.24.1: which off switches were already saved as `false` (see the known issue under the settings) | permanent |
| `held:last` | a held-back message longer than 1,800 characters, in full (up to 20,000) | until the next one |
| `prompts:saved` | saved prompts (since 0.21.0): name, text, button on/off, when, saved by you or offered | until deleted (at most 12) |
| `prompts:recent` | repeat detection: your longer messages that got an intent, first 1,000 characters, intent, chat and time | 30 days, at most 300 |
| `prompts:seen` | groups Haiku turned down, you declined or saved, by their entries | at most 100 |
| `prompts:budget`, `prompts:budget-intent` | Haiku calls of the detection today | until the next day |

Each session writes only its own `bilanz:` key, because the store is not atomic. Compaction at startup records compacted sessions in `bilanz:tage.aus`, so a session starting at the same time skips them and nothing is counted twice. A source is deleted only after re-reading shows the entry. **Residual risk:** if two startups overwrite `bilanz:tage` at the same time, usually just one compaction is lost; its source remains and is compacted on the next start. In a very unlikely sequence the first startup has already deleted the source before the second overwrites; those old days are then missing from `/savings`. Nothing is ever counted twice.

## Configuration

Desktop app: **Settings → Plugins → sidekick → Settings**. Terminal: `/config` → sidekick, or `/plugin configure sidekick`. Since 0.23.0 every setting lives here; the `/sidekick` commands write the same fields.

| Key | Title | Meaning | Default | Command |
|---|---|---|---|---|
| `level` | Level | `off`: nothing · `cache`: only the cold-cache question, no model calls · `guide`: all checks and hints | `guide` | `/sidekick off\|cache\|guide` |
| `threshold` | Check from (tokens) | from this context size every message gets a short check (at least 1000) | 80000 | `/sidekick threshold 80k` |
| `bigTokens` | Cold-cache question from (tokens) | asks before a cold send from this context size (at least 1000) | 150000 | `/sidekick big 150k` |
| `cacheTtl` | Cache lifetime (min) | `auto` (measured, otherwise 60), `5` or `60` | `auto` | `/sidekick ttl 5\|60\|auto` |
| `skills` | Suggest skills | sends your skill list along with the check, so it can suggest one | on | `/sidekick skills on\|off` |
| `maintenanceHints` | Maintenance hints | names due maintenance such as `/skill-doctor` or `/init`; single rules stay a command | on | `/sidekick hints on\|off` |
| `auditMin` | Prompt audit from (tokens) | size of your instructions from which the audit hint appears (at least 100) | 2000 | `/sidekick hints audit-min 2k` |
| `notes` | Good to know | a note while Claude works when you likely missed something; asks your main model every 6 steps | off | `/sidekick notes on\|off` |
| `modelTip` | Model tip | on the first message on Opus or Fable, asks whether a cheaper model fits | on | `/sidekick tips on\|off` |
| `modelTipAuto` | Switch subagents automatically | simple subagents and chats Claude starts run on a cheaper model | off | `/sidekick tips auto on\|off` |
| `modelTipHaiku` | Use Haiku for simple tasks | off: Sonnet is the cheapest target | on | `/sidekick tips haiku on\|off` |
| `retryLoop` | Retry loop | on the third correction in a row, offers a new chat or a step back | on | `/sidekick loop on\|off` |
| `queue` | Queue | while Claude works, a message that is clearly a later item still goes straight in, with a note to Claude to finish the running task first; plus the Later button and the `later:` prefix (since 0.24.0) | on | `/sidekick queue on\|off` |
| `catalog` | Skill catalog | when a message fits a skill from the catalog, suggests it once per chat before sending; installs nothing (since 0.25.0) | on | `/sidekick catalog on\|off` |
| `language` | Language / Sprache | `en`, `de`: all texts sidekick shows (hint lines, questions and answers, `/sidekick`, `/savings`, notices, number and date format) and the model's hints, summary and handoff. The rewrite of your message stays in the language you wrote it in. | `en` | `/sidekick language` |

A command applies at once in the chat where you run it. Other open chats pick it up after `/reload-plugins` or in the next chat; up to 0.22.0, a `/sidekick` setting applied in all open chats within seconds. Single maintenance rules (`/sidekick hints <rule> on|off`) and saved prompts stay commands and are kept in `$.store`.

**Updating from 0.22.0 or older:** run `/reload-plugins` in every open chat after the update. The first chat on 0.23.0 copies your old values into these fields; a chat still running 0.22.0 keeps reading the old values and does not see what you change on the settings page.

Known issue: the desktop settings page may show switches that were never saved as on, even when their default is off, and saving the page then turns them on. sidekick stores its off defaults (Good to know, Switch subagents automatically) once at the first start, so the page shows them correctly.

## Language

Texts are English by default. For German, set `language` to `de`, or run `/sidekick language de` in a terminal session to switch all fynn-mods at once. Amounts then read `14,44 $` instead of `$14.44`, dates `06.10.` instead of `Oct 6`. Commands and their arguments are English in both languages. The rules that read text (rewrites that sound like a reply, typed maintenance commands) understand English and German regardless of the setting.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, turn.step, agent.spawn, turn.complete, session.compact, tool.call{tool=Bash|PowerShell|mcp__ccd_session__start_session}, prompt.submit, skill.prompt, command.run{command=handoff}, ui.render{component=UserMessage}, ui.render{component=AbovePrompt}, command.run{command=sidekick}, ui.render{component=SessionMode}, command.run{command=p}, command.run{command=savings}, ui.render{component=CommandOutput, props has {command=savings}}, ui.render{component=CommandOutput, props has {command=sidekick}}
calls: $.clock.every, $.clock.now, $.command.list, $.command.register, $.command.run, $.config.list, $.config.set, $.fs.read, $.model.complete, $.model.fork, $.process.run, $.prompt.fill, $.prompt.read, $.prompt.submit, $.session.id, $.session.messages, $.session.model, $.session.root, $.session.surfaces, $.session.usage, $.state.get, $.state.set, $.store.delete, $.store.get, $.store.keys, $.store.set, $.ui.ask, $.ui.copy, $.ui.invalidate, $.ui.notice, $.ui.resolve, $.ui.toast
state writes: sidekick.buddy, sidekick.prompts, sidekick.status
state reads: sidekick.prompts, sidekick.status
```

In plain language:

- `prompt.submit` (since 0.24.0, no new hook or call): for a message you write while Claude works that is clearly a later item, sidekick adds a hidden note for Claude to the message (only on level Guide, see [Queue](#queue-since-0240)); the message itself goes in unchanged, except that a `later:`/`danach:` prefix you typed is removed. For the decision, Haiku 5.5 gets your new message, the message that started the turn and the end of what Claude wrote so far, through your session's login like the message check. Since 0.24.0 sidekick also reads messages that the desktop app prefixes with a hidden status block (see *Fixed in 0.24.0* above).
- `command.run{command=handoff}` (since 0.22.0): the command `/handoff`, moved here from limit-bars, plus the skill `write-handoff` (Claude only; not named `handoff`, because a skill of that name would hide the command). When the way is the fork, `$.model.fork` now also runs without `/sidekick notes on`: your session's own model writes the handoff over its own conversation, every tool denied; nothing leaves your session's login. `$.command.run` also runs `/handoff` or `/keepwarm` when you click them in the suggestion line, and `/clear` for the new chat, only after you chose it. No new call.
- `command.run{command=p}` (since 0.21.0): the command `/p <name>` sends a saved prompt; `/p` alone lists the names. It sends only when you run it yourself; if another plugin runs `/p`, nothing is sent. One fixed command, because a hook on every command (or on a pattern) would put sidekick's name over every other plugin command's output.
- `prompt.submit` (since 0.21.0): for the repeat detection, keeps your longer messages that got an intent (see [Stored data](#stored-data)), in the background; the message is never held up. Saved prompts are sent with `$.prompt.submit` as your message, only on your command or click.
- `$.state.set`/`$.state.get` `sidekick.prompts` (since 0.21.0): the names of the prompts with a button and, since 0.24.0, whether the Later button is shown and on, so the footer redraws only when that changes. No prompt text.
- `prompt.submit`: reads your message before sending; can hold it back (`drop`) or replace it with the rewritten version, **only after you choose so in the dialog**; since 0.24.0 it also removes a `later:`/`danach:` prefix you typed at the start. Nothing is ever sent without asking; since 0.24.0 it may add a short hidden note for Claude to a message you write while Claude works (see Queue). Detects typed maintenance commands as done.
- `turn.step`: reads the token counts of each main-loop request (cache warm/cold, context, savings measurement). With Good to know on, it also starts the check at step 6, 12, 18 … in the background; the request itself is not delayed. Since 0.18.0 it changes one thing, and only in a chat where you picked a cheaper model in the model tip's question: the model of each main request (`→ Sonnet`). For subagents it reads the token counts of watched runs to estimate the savings.
- `agent.spawn` (since 0.18.0, only with `/sidekick tips auto on`): sets the model of a built-in subagent without a model to Sonnet or Haiku when Haiku rated its task simple; everything else starts unchanged.
- `turn.complete` (since 0.18.0): the end of a subagent's run, to book or strike its estimated savings. Read only.
- `session.compact` (since 0.19.0): read only. Counts the compactions of the main chat (`/compact` and automatic ones, including the one while you are away; not the background precompute, not a subagent's), notes the size afterwards and that the next request follows a compaction. Passes every compaction through unchanged: no skip, no other instructions.
- `prompt.submit` also attaches the retry loop's nudge (since 0.19.0, only after you pick **Send with a nudge**) as context Claude reads and you don't see; the handoff from the loop gets the section *What didn't work*.
- `tool.call{…|mcp__ccd_session__start_session}` (since 0.18.0, only with `/sidekick tips auto on`): for a chat Claude starts without a model and not as a fork, passes `claude-sonnet-5-5` or `claude-haiku-5-5` when its task was rated simple, and remembers the first 200 characters of the brief for two days. The tool's name comes from the desktop app; if it changes, the hook silently stops firing.
- `$.session.model` (since 0.18.0): your main model, so the check knows it on the first message and the tip only appears on Opus or Fable.
- `$.ui.notice` (since 0.18.0): one line in the agent's window when sidekick switched a subagent or a new chat.
- `$.model.fork` (Good to know, only after `/sidekick notes on`): one question to your session's own model over its own conversation, with every tool denied, answered as a short JSON. Nothing leaves your session's login; the answer is shown only to you.
- `$.prompt.read`: *Discuss in chat* and **Insert in prompt** write only into an empty prompt box; if you have typed something, a notice says so instead.
- `tool.call{tool=Bash|PowerShell}`: after the run, reads `gitOperation.commit` (commit hash). Changes nothing.
- `skill.prompt`: counts which skill ran and detects maintenance skills as done. Changes nothing.
- `ui.render{component=UserMessage}`: appends the hint line to the display of your message, with a button when the line names a command.
- `$.ui.resolve`: builds that button (a button carries its click handler, so it cannot be plain data).
- `$.command.run` (on a click): runs the command shown in the line, as if you typed it. Only commands from plugins, your own commands and skills, and the built-in maintenance commands `/skill-doctor` and `/init`; never MCP prompts, never `/clear`, `/exit`, `/quit`, `/login`, `/logout`, `/rewind`. Since 0.15.0 this is the only thing a click does.
- `$.prompt.fill`: **Insert in prompt** on a maintenance line (since 0.16.0): puts the command into the empty prompt box, never sends it. As a fallback, when Claude Code refuses a command from the check's line: puts it into the prompt box at the cursor. Never sends it, never overwrites what you typed. And for *Discuss in chat* (Good to know): puts the note into the empty prompt box, never sends it.
- `$.ui.copy` (since 0.16.0, only after a click on **Copy** or **Insert in prompt**, and only when the prompt box refused the text): puts the maintenance command of that line on the clipboard of the surface you clicked on. Nothing else is copied.
- `ui.render{component=CommandOutput, props has {command=savings}}`: draws the output of `/savings` as a card in the terminal and the desktop app. Only its own command's output; other surfaces and older outputs get the Markdown text.
- `ui.render{component=CommandOutput, props has {command=sidekick}}` (since 0.14.0): draws the output of `/sidekick help` as a table in the terminal and the desktop app. Display only; `/sidekick status`, other outputs and other surfaces stay Markdown.
- `ui.render{component=AbovePrompt}`: only while a new chat is being started, a small blue box above the prompt shows progress and seconds; and, with Good to know on, the current note with its buttons. Otherwise the hook passes the band through unchanged to other mods (limit-bars, Clawd).
- `$.model.complete`: since 0.21.0 also Haiku 5.5 (effort `low`) for the repeat detection: for the intent, the single new message (up to 1,000 characters) together with the short intents sidekick already knows (no texts from other chats); for a proposal, the messages of that group (at most 4, up to 1,000 characters each). Haiku 5.5 for the check (effort `medium`, full ID `claude-haiku-5-5`), Haiku 5.5 for the model tip's rating of a subagent's or new chat's task (effort `low`, since 0.18.0) and Sonnet 5.5 for the handoff (effort `medium`). The only `$.model.complete` calls. Your messages and those tasks reach the model only through your session's own login; the rating prompt tells the model to judge the task and never follow instructions in it.
- `prompt.submit` also attaches the model tip's guideline (since 0.18.0, only with `/sidekick tips auto on`, once per chat) as context the model reads and you don't see.
- `$.session.messages`: beginning and end of the history for the handoff, the end of Claude's last reply for the check, and to detect the first message.
- `$.session.usage`, `$.command.list`: context size, skill names and descriptions; for the maintenance hints, paths and token counts of instruction and memory files (no contents), size of the skill list, model, and whether a command exists.
- `$.session.root`: project root as the key for maintenance hints, and as a fact in the handoff (since 0.12.0). The path only.
- `$.session.surfaces`: detects the desktop app, because there typed messages carry the origin `sdk` like `claude -p`.
- `$.session.id`: detects a new session after `/clear`.
- `$.command.run`, `$.prompt.submit`: for "New chat with handoff" (`/clear`, then send). `$.command.run` also for the button, see above. `$.prompt.submit` also for **Send anyway** after writing the handoff failed (your message as typed), and for **Ask in chat** in the desktop app (the note and a short request to explain it, as a message from sidekick, only on that click).
- `$.store.*`: summary, cache measurement, balance, disabled maintenance rules, the counters of model tip and retry loop.
- `$.config.list`, `$.config.set`: for `/sidekick language` (since 0.17.0) and, since 0.23.0, for sidekick's own fields when you change one with a `/sidekick` command. Reads the settings rows and changes only the `language` field of the six fynn-mods and sidekick's own fields; other plugins are left alone.
- `$.process.run`: for `/sidekick language` in the desktop app and `claude -p` (since 0.17.1), and only these commands: `claude plugin list --json` (which fynn-mods are installed and on) and `claude plugin configure <mod>@fynn-mods` with `--json` (read the current language) or `--values-stdin --json` with `{"language":"de"}` or `"en"`, for the six fynn-mods only, and since 0.23.0 with sidekick's own fields for sidekick only. Needs the `claude` CLI on the PATH of the app. It saves the settings of `sidekick@fynn-mods`; if your desktop app loads the mod under another plugin ID (such as `sidekick@inline`), that copy keeps its language. An organization policy that blocks `$.process.run` refuses the whole mod. Settings commands save through `claude plugin configure` only when this is the installed copy (its folder is the `readFromFolder` or `installPath` that `claude plugin list` reports); a copy loaded with `--plugin-dir` answers “Not saved: this copy is loaded from another folder …” and changes nothing. Once per new off switch (store key `offDefaults2`), the installed copy also reads its own unset fields with `claude plugin configure sidekick@fynn-mods --json` and saves those whose default is off as `false`. Since 0.24.1 a settings command reads the value back after saving; if another mod overwrote it at the same moment, it saves once more, otherwise it answers “Not saved”.
- `$.ui.ask`, `$.ui.toast`, `$.ui.invalidate`: question dialog, notices, redrawing the line.
- `$.clock.*`: time, and timers only: the seconds in the handoff box, a one-off timer for `/clear` and for writing the handoff, and since 0.20.0 the `cold` check once a minute and clearing `hint` and `upkeep` after a few seconds.
- `ui.render{component=SessionMode}`: appends sidekick's label to the footer labels next to the model picker; other labels stay.
- `$.state.get`: reads its own value `sidekick.status` while drawing that label, so the label redraws when the value changes.
- `$.state.set`: writes `sidekick.status` (level, whether sidekick is busy, since 0.18.0 the name of the tip's target model, since 0.20.0 `cold: true` while the chat's cache estimate has run out; no text) for the footer label and clawd-buddy, and `sidekick.buddy` for clawd-buddy: only `check`, `stop`, `handoff`, `fresh`, and since 0.20.0 `hint` and `upkeep`, a timestamp, and for `stop` the reason of the question (`cold`, `wrong`, `model`, `rewrite`, `topic`), never your message.
- `$.fs.read` (since 0.25.0): after you click **Send with …**, reads exactly one file, the `SKILL.md` of that bundled skill inside sidekick's own folder, and attaches its text to your message for Claude. No other path, no writing.
- `prompt.submit`, `$.ui.ask`, `$.ui.copy`, `$.model.complete` (since 0.25.0, skill catalog): Haiku 5.5 gets your new message, the chat's short summary and the one to three catalog candidates the keyword filter found. **Copy the install command** puts the line from the source's README on your clipboard and holds the message (`drop`, with your text in the reason). sidekick never runs an install command and changes no settings.

Explicitly not used: `$.fs` beyond the one read above, `$.env`, `$.http`, `$.settings`; no tokens or credentials.

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

**If you also use limit-bars:** with limit-bars 0.14.0 or later there is nothing to do; with an older one, run `/cache warn off` once (see above).

**Status and pause:** `/sidekick status` shows the current state and level; `/sidekick off` turns sidekick off without uninstalling it, `/sidekick on` brings it back.

## Known limitations

- **Skill catalog (0.25.0):**
  - The bundled copies are frozen at commit `5206a95` of emilkowalski/skills. They go stale until someone updates the pinned commit by hand (new copy, `node scripts/check-bundled-skills.mjs <source>` in the project repo checks it).
  - The catalog is small and hand-picked; licenses and install lines were checked on 2026-11-09 and may have changed since. A reference's install command comes from its README as is; for `npx skills@latest …` it is unpinned.
  - **Copy the install command** holds the message with `drop`: the desktop app shows that as a red "Prompt blocked by a hook" notice and keeps the bubble; in the terminal your text comes back into the prompt box.
  - "Send with …" attaches the skill's text to your message instead of running the skill as a command, so the transcript shows no `/sidekick:…` line and the skill counts as used only in sidekick's own balance.
  - The keyword filter decides what reaches Haiku: a message that fits but uses none of the keywords gets no suggestion. In the trial on 300 messages only 2 fitted, so the hit rate is measured on very few cases.
  - With an add-marketplace line (impeccable, gsap-skills, hyperframes) you still install the plugin from the `/plugin` panel afterwards.
  - "Installed" is detected from the commands Claude Code lists (a skill, a plugin skill or a plugin command). A tool set up only as an MCP server, without a skill or command, is not detected and may still be named.
  - A reference's question shows its risk note (for example "npx, unpinned"); the commands with `npx`, `uv` or `claude plugin` belong in a terminal, not in Claude's prompt box, and sidekick says so when it copies them.
- **Queue (0.24.0):**
  - Claude Code hands a mid-turn message to plugins only when the running tool calls finish, not when you press Enter. While Haiku decides (median 1.6 s, at most about 4 s), the running turn waits at that point. The rules decide without delay.
  - The note asks Claude to finish first; it does not force it. In the trial Claude followed it in all 9 cases, but that is a small sample.
  - The later item is done in the same turn, right after the running task, not in a turn of its own.
  - The grey line under your message appears only where sidekick draws lines (terminal and desktop app). The Later button exists only in the desktop app's footer and only while a turn runs; elsewhere use the `later:` prefix.
  - Whether the desktop app shows and accepts a footer button while a turn runs was not yet checked in the app; if not, the prefix still works.
- **Handoff (0.22.0):**
  - The saved handoffs are shared by all projects: `/handoff show` and `continue` take the newest, even if it comes from another project. The handoff's table names its project.
  - The question shows the **Next** line, not the whole handoff; it goes into the new chat as your message. `/handoff show` prints it first if you want to read it. A fork also sees tool results (e.g. fetched web pages); the template tells the model never to take instructions from quoted text.
  - A fork cannot be cancelled. After 60 s sidekick falls back to the text way; if the fork still answers later, its cost is booked but the result is not used.
  - With the model tip active in a chat, sidekick assumes the fork runs on the tip's model (the fork repeats the main loop's last request with its model); this is not measured.
  - `/handoff continue` clears the chat only when you type it yourself, not when another plugin runs it.
  - Shortly before expiry, the suggestion's time is fixed when it appears; a chat kept warm with limit-bars' `/keepwarm` still gets the suggestion once.
- **Saved prompts (0.21.0):**
  - The repeat detection finds the same instruction only when Haiku gives its versions the same intent; in the trial that worked for 2 of 3 dictated versions. It can also group a related one-off request; then the proposal call or your **No** turns it down.
  - Only messages of the last 30 days count, at most 300 kept, and only those with an intent.
  - Buttons only in the desktop app's footer (checked by clicking a test button on 2026-11-06). Whether the buttons in the `/sidekick prompts` table can be clicked in the desktop app is not confirmed; the commands under the table do the same.
  - `/p <name>` does not work in `claude -p` (Claude Code binds no session there; the command says so). It sends 0.1 s after the command, because Claude Code refuses a prompt sent from inside the command itself.
  - `/sidekick save <name>` without text takes the last user message in the history; Claude Code doesn't say who sent it, so a message a plugin sent as you (a saved prompt, a handoff) can be the one saved. Check with `/sidekick prompts <name>`.
  - Before you click **Save** on an offer you see the first 80 characters of the version Haiku wrote; `/sidekick prompts <name>` shows all of it, and that is what the command sends as your message.
  - The offer under a message is bound by the message text; two identical messages in a row can put it under the other one.
  - In the terminal the offer's **Save** and **No** are buttons in the transcript; whether those can be reached there is not confirmed (the same holds for the hint-line buttons since 0.7.0). `/sidekick save <name> <text>` saves by hand.

- **Cold cache after `/resume`** (since 0.20.0): after resuming a chat whose cache has run out, `cold` for clawd-buddy appears with the next once-a-minute check, so up to a minute late. Doing it at once would need the `classic.SessionStart` hook, a new right.

- **Model tip (0.18.0):**
  - Picking the same Opus again in the desktop app's model picker is not visible to a mod; to go back, use `/sidekick tips stop` or type `/model`.
  - Chats Claude starts: the tool name `mcp__ccd_session__start_session` and the brief the app puts in front come from the desktop app, not from Claude Code's documentation. Whether the hook fires there and the agent-window line shows is not confirmed yet; if not, nothing is switched and nothing booked.
  - A subagent's steps that run while the mod reloads (e.g. after `/sidekick language`) are not counted.
  - On the first message the check gets slow when the API is busy (measured 2026-11-04: 13 to 28 of 30 long first messages within 6 s). Then it times out and the message goes through without a tip, as before 0.18.0.
- **Desktop app** (observed with 2.1.286):
  - `PromptHint` (the line under the prompt) is not triggered there. That's why the hint appears under your message.
  - Typed messages carry `origin` `sdk` there. sidekick recognizes them via `$.session.surfaces()`.
- **VS Code and mobile:** only messages arriving as `composer`/`bridge`, or as `sdk` with the desktop in `$.session.surfaces()`, are checked. Which origin VS Code reports is not documented. By these rules sidekick either doesn't check there or checks only as in the terminal.
- **Accepting hints:** only detectable for skills (the skill runs afterwards) and in the dialog. A line about a version, model or something else counts as ignored with the next message and blocks its type until +50k or the next commit. "Ignored" here means "not detectably accepted".
- **After `/resume`:** the hint lines of the resumed session appear only once something happens again, e.g. the next message or request. Showing them immediately would need an extra right (`classic.SessionStart`).
- **The rewritten version** is only offered if it fits entirely into the dialog (≤ 600 characters). A longer one becomes a line. Messages under 4 words never get a rewritten version. The rewrite always stays your message to the assistant (you as sender); a version that reads like the assistant's reply or a question back to you ("I'm ready – what would you like to do?") is dropped. This is detected in English and German, whatever `language` is set to. The rewrite stays in the language of your message.
- **Commit detection:** a commit made with `git commit -q` goes unnoticed, because the engine parses git's output. Then only the +50k rule applies.
- **Compaction:** since 0.19.0 sidekick hears about each compaction through `session.compact`. A context that shrank by more than 40 % without one (for example after `/rewind`) still counts as compaction, not as a cold start. The idle compaction is assumed to arrive as `auto` (documented for the classic hooks); this was not reproduced, because it needs an interactive session idle for about an hour.
- The handoff only sees the summary, your first two messages, the end of the history, the project root, the last commit and your new message. In very long chats "first" means the oldest of the newest 4,096 entries Claude Code returns. The model is told not to invent anything and to leave out what it is unsure about; gaps are possible, and open points unrelated to your new message may be left out.
- **Maintenance hints:**
  - `/consolidate-memory` is missing in CLI sessions; the rule stays silent there.
  - A typed `/skill-doctor` is not detected as done in the desktop app. Afterwards run `/sidekick hints done skills-cut`.
  - The check runs on the first own message of a chat, and since 0.16.0 once more after a commit or a 60-minute pause. After a change via `/sidekick hints …`, the first check runs again on the next message.
  - Messages inserted by the host that start with a tag like `<system-reminder>` don't count as yours.
  - Claude reads the output of `/sidekick hints status` too and sometimes offers the items as tasks.
  - `skills-heavy` only kicks in after 30 days of counting skill usage.
  - The audit rule detects a model change by the model name in the `/context` breakdown; if only its spelling changes, you get an unnecessary hint.
  - Two concurrent chats in the same project can show a hint twice (store not atomic).
- **Wrong chat** is only detected when the model check runs (triggers above). In a small chat below `threshold` nothing is checked, so a message in the wrong small chat goes through. `/sidekick threshold 30k` widens the check, at about $0.001 and 3 s per checked message. sidekick only knows the chat from its running summary, your last 3 messages and the end of Claude's last reply, so a chat that just started has little to compare against.
- **Model alias `haiku` in `/savings`:** priced as Haiku 5.5 (what Claude Code resolves it to since v2.1.293). If you point the alias elsewhere with `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `/savings` does not know; sidekick's own calls always name the full model ID, so this only matters for entries booked under the bare alias.
- **`/savings` card and `/sidekick help` table:** each drawing is kept in memory for the last 10 outputs; after a restart, `/reload-plugins` or `/sidekick language`, older outputs show as Markdown. The help table shows the state at the time it was run and is not redrawn after a change.
- **After the mod reloads** (`/sidekick language`, `/reload-plugins`, settings changed): level, settings, the open hint and the Good-to-know note stay, since they are stored. Only things kept in memory reset: opened **?** explanations close, and a Good-to-know check running at that moment is dropped.
- **Held-back text and Claude Code's limits:** Claude Code ignores a hold-back reason over 4,096 characters and sends the message anyway, and it shows only about 2,000 characters of a reason (found while building 0.9.0, not documented). sidekick keeps the text in the reason under 1,800 characters and stores longer messages in full for `/sidekick status`.
- **Footer label:** the desktop app does not draw added mode labels; sidekick draws its own ● there (since 0.10.2, checked with desktop app 2.1.288). `/sidekick status` shows whether Claude Code asked for the label at all, on which surface, and whether reading its value failed (since 0.10.1). The engine redraws the label when the state changes (in the terminal, the color depends on the terminal font). Other surfaces show no label.
- **Rewritten version:** a version over 600 characters is not offered (it would not fit into the question either); long dictations come close to that.
- **Cost of question (c):** the "New chat" estimate uses the most recently measured base load of a new chat. Before the first handoff it assumes 20k tokens.
- **Good to know:**
  - It runs on your session's model; sidekick can't pick a cheaper one, because only that model has the conversation in its cache. On a large context each check costs more (estimated ≈ $0.09 at 400k with Opus 5.5).
  - Turns shorter than 6 steps are never checked.
  - How often a note appears was tuned on a handful of real conversations (two rounds, see the SPEC); it may be too quiet or too talkative for you. `/savings detail` shows shown vs. ignored.
  - In the desktop app, *Ask in chat* sends right away, because the app's prompt box can't be filled by a mod.
  - A note found while you already sent your next message is dropped (stale).

## Credits

sidekick's cache logic (`hooks/cache.ts`) is a copy of limit-bars' cache logic, which is modeled on Nate Herk's Cache Keeper (MIT). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
