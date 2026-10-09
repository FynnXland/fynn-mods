# worklist

A to-do list as a sidebar next to the chat. You queue tasks, even while Claude is working. When Claude is **certainly** done, the running to-do is struck through, moves to the project-wide history, and the next one starts on its own. When that isn't certain (a question, an interruption, an error, an open plan), the list stops, reports the reason in a toast, and shows **Continue**, **Mark as done** and **Skip** in the sidebar.

The list runs by default: worklist never pauses on its own (only you do), nothing is skipped unless you press **Skip**, and the order you queued stays the order things run in.

Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.295** · Plugin version **0.7.2**

**Cost:** when the rules can't decide whether Claude is done, worklist asks Haiku 5.5 (`claude-haiku-5-5`, effort `high`; measured at about 0.01 US cents per case). These calls run through your session and count toward your usage. You can switch this off with the `haiku` option (see [Configuration](#configuration)); the list then stops in those cases instead.

## Usage

| Input | Effect |
|---|---|
| `/todo <task>` | queue a task (everything after `/todo` is the task); confirmed by a toast only, so Claude doesn't read it |
| `/todo` · `/todos` | open the sidebar |
| `/todos pause` · `/todos resume` | pause the list, or continue it (with an open notice, `resume` acts like **Continue**) |
| `/todos done` | mark the running or stopped to-do as done by hand |
| `/todos skip` | skip the stopped to-do: it moves to the end, marked "skipped", and the next one starts |
| `/todos retry` | send the stopped to-do again, in full |
| `/todos clear` | delete open to-dos; the history stays |
| `/todos history` | show the history (last 30) |
| `/todos status` | check state, last decision with reason, Haiku cost |
| `/todos close` | close the sidebar |
| `/todos help` · `/todos ?` | all commands, the sidebar's buttons, each feature with its current state and how to change it, and your settings, drawn as a table (terminal and desktop app; Markdown elsewhere). The state is the one at the time you run it. `/todo help` queues a to-do "help". |

**What Claude receives** is exactly your to-do text, nothing added to the message. With the `doneLine` option on (default), worklist also passes Claude a hidden closing hint beside it (see [below](#when-it-continues-the-certainly-free-check)).

**In the chat transcript** a sent to-do appears as an orange line `· worklist: to-do 2/5 sent` with an orange box ("sent:" and the text); Claude's answer follows below. worklist recognizes its to-dos by their exact text, remembered per chat, so the box stays after a restart or `--resume`.

**Commands as to-dos:** a to-do that starts with `/name` (for example `/review` or `/my-plugin:skill some arguments`) runs as that slash command instead of being sent as text. worklist first checks that the command exists in this session; if it doesn't, the list stops with a notice and nothing is sent. A command that starts a turn for Claude (a skill, a prompt command) counts as done when that turn passes the usual check; a command that runs locally without a turn (such as `/cost`) counts as done once it has run. worklist's own `/todo` and `/todos` can't be queued.

**In the sidebar:**

- **Status line** at the top: one symbol and one sentence on what applies and what happens next, for example `● running · to-do 2/5 · 1:24`, `◐ waiting for your answer in the chat`, `◌ waiting for background work (2 helpers)`, `◇ free · next one starts shortly`, `◇ free · list empty`, `⏸ paused`. Below it a bar with the progress of the list (done/total in this chat).
- **NOW** (only while something runs): what Claude is working on (to-do n/m or "from the chat"), elapsed time, what Claude is doing right now, and Claude's own plan (TaskCreate/TodoWrite) with a progress bar.
- **NOTICE** (only when the list stops): the reason in one sentence and the buttons, recommended one first:
  - **Continue** (highlighted): keeps the order. If Claude asked a question, worklist sends a short continuation for the **same** to-do ("Continue with this to-do; decide open points sensibly yourself."), shown as `to-do n/m · continued`. After an interruption or error, the same to-do is sent again in full, first in line. Never pauses the list.
  - **Mark as done**: checks the to-do off by hand; the next one starts.
  - **Skip** (small, set apart): the to-do moves to the end, marked "skipped"; the next one starts. If it's the only one, nothing is sent; it starts after your next message or with **Start now**.
  - With a question, a line above the buttons says: "Just answer in the chat, then this to-do continues."
  - If the same to-do stops twice in a row without your answer (loop guard), **Continue** is gone; answer in the chat, mark it as done or skip it.
- **NEXT**: the input field "new to-do, Enter" at the top, below it the queue with ↑ ↓ ✕, and **Pause** / **Start** / **Start now** at the right of the header.
- **HISTORY** (collapsible): project-wide, grouped by day, struck through with duration and a short result (the first sentence of Claude's answer).

Runs in: the desktop app (sidebar on the right, main surface) and the terminal (pane above the prompt). On mobile there is no input field; use `/todo <task>` there. In `claude -p` the commands work; the list keeps working as long as the session is open. `/todo <task>` prints nothing there (its confirmation is a toast); check with `/todos status`.

**While Claude is working:**

- **Desktop app:** send `/todo <task>` **normally with Enter**. The desktop app holds it in its queue while Claude works; Claude keeps working, and when the turn ends the to-do is queued (toast) and checked like everything else (tested with desktop app 2.1.288, also across 30 single steps). Don't press "Send now" on it: that interrupts Claude's turn. The sidebar's input field works as well and queues immediately.
- **Terminal:** `/todo <task>` is registered with `immediate`, so per the docs it runs while Claude is working (not tested in the terminal). The input field in the pane works as well.

**Queueing while Claude is free counts as your answer:** if Claude's last answer ended with a question and you queue a to-do (input field, `/todo`, or a mod such as sidekick splitting a long message into to-dos), it starts after the settle time. If you queued it while Claude was still working (a `/todo` that the desktop app delivers right at the end of the turn counts as that), the normal check of that turn applies: after a question, it waits.

**Answers through other mods count as yours:** a message another mod sends on your click as your own words (for example sidekick's rewritten version or a quick-replies suggestion) counts like a message you typed: it answers a stopped to-do's question, and that to-do continues.

## When it continues: the "certainly free" check

After every turn end (including after your own chat messages) these stages run; the first decision wins. The detection always understands English and German, whatever `language` is set to.

1. Interrupted → **stop** (to-do goes back into the list, notice)
2. Error, refusal → **stop**
3. Background work or scheduled wake-ups (`classic.Stop`) → **wait** (see [Waiting, with a limit](#waiting-with-a-limit))
4. A helper (subagent) is still running (`$.agent.list()`) → **wait**
5. Claude's plan has open steps → **ask**
6. A question in the last paragraph (`?` at the end, "Shall I", "Do you want", "Soll ich" …, options with a question; code doesn't count; a standalone "Done." below doesn't hide it) → **ask**
7. A problem ("failed", "couldn't", "konnte nicht" …), the last tool ended with an error, or an empty answer → **ask**
8. The last sentence is itself "Done.", "Done, …", "All done." (or German "Fertig.", "Erledigt.") → **continue**. "Done" in the middle of a sentence or with a restriction ("Done, except …") doesn't count.
9. Otherwise Haiku 5.5 (only the end of the answer and the to-do; model `claude-haiku-5-5`, effort `high`, at most 1500 tokens and 10 s): only "done" with confidence ≥ 0.85 → **continue**, anything else (including no answer or a timeout) → **ask**
10. Before sending, a 3 s settle time, then check again: no new turn, no new helper, same chat, not paused

When in doubt, nothing is sent. After your own chat message, the list stops quietly on "ask" (no toast); queueing a to-do or **Start now** continues it. **Loop guard:** if the same to-do stops twice in a row without you replying in the chat, **Continue** disappears; your answer in the chat, **Mark as done** or **Skip** continue it. **Continue** counts toward the loop guard. After `maxAutoRun` to-dos in a row without your intervention, the list also stops.

**After a restart, `--resume` or a chat switch** the list is not paused (unless you paused it yourself). A to-do that was running goes back to its place at the front. Nothing is sent right away: the list starts after your next message ends cleanly, when you press **Start now**, or when you queue something.

### Waiting, with a limit

- **Helpers and workflows** (stages 3 and 4): worklist waits and checks every 10 seconds whether they are still busy (`$.agent.list()`). Once none is busy, it checks the last turn end again; no new turn is needed.
- **Background shells, monitors, scheduled wake-ups** (stage 3): after **2 minutes** without a new turn, a notice asks once per waiting phase: "Still running in the background: npm run dev. Stop waiting?" **Don't wait** (recommended) checks again without these tasks; they stay ignored in this chat (a dev server can keep running). **Keep waiting** waits on.

### Hidden hints

With every sent to-do (not with commands) and with **Continue**, Claude gets this hint, invisibly, as hook context beside the text (in German with "Fertig." when `language` is `de`):

> This message is a task from the user's to-do list (worklist). If you need a decision from the user and the AskUserQuestion tool is available, ask with it and carry on after the answer; otherwise end your answer with a clear question and don't write "Done.". Write "Done." on a line of its own only when this to-do is completely finished.

When a to-do stopped with a question and you answer in the chat (or through another mod, see above), your answer gets one hint as well:

> This message answers your question about the to-do "…" (worklist). If this to-do is then completely finished, end with "Done." on a line of its own; if something is still open or unclear, ask.

Neither is part of your message or shown in the chat; `/todos status` shows whether the hint was attached to the last to-do. `doneLine` switches both off; detection then relies on the rules and Haiku alone. A standalone "Done." (or "Fertig.") as the last line of an answer is hidden in the transcript. All your other messages get nothing.

## Language

`/config` → worklist → `language`: `en` (default) or `de`. It switches the sidebar, buttons, toasts, the line in the chat, the output of `/todo` and `/todos`, date and time formats, the hidden closing hint sent with each to-do, and the language of Haiku's short reason. Commands and their arguments are English in both languages.

## Stored data

- **Queue per chat** in `$.store` under `queue:<session-id>`. Another chat in the same project doesn't see or start it. After `/clear` the list moves to the cleared chat (it is the same workplace, e.g. after a handoff); `/resume` and `/branch` keep separate lists.
- **History per project** under `history:<project-folder>`, at most 300 entries.
- **Haiku cost** per project under `cost:<project-folder>`.
- **Sent to-dos per chat** under `sent:<session-id>`: the last 50, only a checksum of the text plus the number, so the orange box in the transcript stays after a restart.
- `/clear`: open to-dos and the pause move along, and the list starts after your next message (usually the start prompt). A to-do that was running stops the list with a notice (Continue / Mark as done / Skip): your start prompt often carries that work on already, so worklist doesn't resend it on its own. The old chat's key is deleted once the new one is saved. After a restart or `--resume` that notice is gone, like every notice: the to-do is open again and starts after your next message.
- Restart or `--resume`: a running to-do goes back to its place; the list stays as it was (paused only if you paused it) and starts after your next message. After `/reload-plugins` it keeps running (run state in `$.state`).

## Configuration

`/config` → worklist's plugin options:

| Key | Default | Meaning |
|---|---|---|
| `language` | `en` | Language of the texts: `en` or `de`. |
| `haiku` | on | Ask Haiku 5.5 in unclear cases (measured at about 0.01 US cents per case). Off: the list stops in those cases. |
| `doneLine` | on | Hidden hints with every sent to-do and with your answer to a to-do's question (not shown in the chat); makes detection more reliable. |
| `settleSeconds` | 3 | Settle time before sending the next to-do (1–30 s), after which worklist checks again that Claude is free. |
| `maxAutoRun` | 15 | Maximum to-dos in a row without your intervention (1–100); then the list stops. |

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, classic.SessionStart{source=clear}, command.run{command=todo}, command.run{command=todos}, prompt.submit, classic.UserPromptSubmit, turn.start, tool.call, tool.call{tool=TaskCreate}, tool.call{tool=TaskUpdate}, tool.call{tool=TodoWrite}, classic.Stop, classic.StopFailure, turn.complete, ui.render{component=UserMessage}, ui.render{component=AssistantMessage}, ui.render{component=Pane}, ui.render{component=CommandOutput, props has {command=todos}}
calls: $.agent.list, $.clock.every, $.clock.now, $.command.list, $.command.register, $.command.run, $.model.complete, $.prompt.submit, $.session.id, $.session.root, $.state.get, $.state.set, $.store.delete, $.store.get, $.store.set, $.ui.close, $.ui.focus, $.ui.log, $.ui.open, $.ui.resolve, $.ui.toast
state writes: worklist.paint, worklist.rt
state reads: worklist.paint, worklist.rt
```

In plain language:

- `$.prompt.submit` (as your message): sends the next to-do or the continuation of a stopped one, only after a passed check or when you press a button.
- `$.command.list`, `$.command.run`: a to-do starting with `/name` runs as that command, after checking it exists.
- `prompt.submit`: only observes where a message comes from (you, another mod on your behalf, or something else); it never changes, drops or extends a message.
- `classic.SessionStart` (only `source: clear`): observes `/clear` and passes it on unchanged; afterwards the list moves to the cleared chat.
- `classic.UserPromptSubmit`: attaches the hidden hints, only to the to-do worklist just sent (or its continuation) and to your answer to a stopped to-do's question (switch off with `doneLine`); every other message passes unchanged.
- `$.model.complete`: Haiku 5.5 (fixed model id `claude-haiku-5-5`, effort `high`), only in stage 9, and it can be switched off.
- `$.agent.list`: reads whether helpers are still running (stage 4, and every 10 s while waiting).
- `$.session.id`, `$.session.root`: list per chat, history per project.
- `$.store`, `$.state`: list, history, cost, run state, and a redraw counter for the sidebar. `$.store.delete` only deletes worklist's own lists: this chat's list once it has become empty, and after `/clear` the old chat's list once it has been saved under the cleared chat.
- `$.ui.*`, `$.clock.*`, `$.command.register`: sidebar, toast, clock, `/todo` and `/todos`.
- `ui.render{component=AssistantMessage}`: hides a standalone "Done." or "Fertig." at the end of Claude's answers (display only; the stored answer stays unchanged). This applies in every session where worklist is loaded, not only for to-dos.
- `ui.render{component=CommandOutput, props has {command=todos}}`: draws the output of `/todos help` as a table (display only; every other `/todos` output stays as the engine draws it).
- `ui.render{component=UserMessage}`: shows a sent to-do in the transcript as an orange line with a box instead of the speech bubble (display only; your own messages stay unchanged).
- Apart from the hidden hints and the display-only changes above, the hooks only observe and pass everything through unchanged. No file system, no processes, no network.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install worklist@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install worklist@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · worklist`.

**Update:** `claude plugin update worklist@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall worklist@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/worklist
```

## Known limitations

- **`/todos help`** keeps its drawn table only while the session runs: after a restart, `--resume` or `/reload-plugins`, older `/todos help` lines in the transcript show the Markdown version. Run it again for the table.

- **Hover flicker in the desktop app** over buttons and the input field: not caused by worklist (it persists even without any redraw from worklist), probably caused by frequent redraws from other mods (clawd-buddy).
- **Cursor in the input field:** `/todo` or `/todos` puts focus into the field, but the desktop app (2.1.286) doesn't show the cursor there. Click into the field once.
- **`/todo …` during a turn in the desktop app** is confirmed only when Claude's turn ends (the app holds it until then). "Send now" on it interrupts the turn. With the older desktop app 2.1.286, even a normally queued `/todo` ended the turn after the current step; use the input field there.
- **After `/reload-plugins` while waiting** for background work, worklist no longer knows the facts of the last turn end; the list then waits for you (**Start now**) instead of checking on its own.
- **Waiting:** a scheduled wake-up (`/loop`, CronCreate) or a background shell keeps the list waiting until you answer "Don't wait" (asked after 2 minutes) or a new turn starts.
- **Commands as to-dos:** if a command starts no turn within a few seconds, worklist counts it as done once it has run. The command list Claude Code offers to mods is incomplete (`/cost` is missing but runs), so whether a command exists is decided by running it.
- **Haiku 5.5 with Claude Code 2.1.291:** that version doesn't know the model id yet and logs `[claude-code:unrecognized_model]` (visible in `claude -p` output); the call works and `effort` is applied. worklist uses the fixed id on purpose: Haiku 5.5 thinks before answering, which counts against the token limit, so a future switch of the `haiku` alias won't silently break stage 9.
- **Model allowlist or third-party provider:** stage 9 calls the fixed id `claude-haiku-5-5`, not the `haiku` alias, so `ANTHROPIC_DEFAULT_HAIKU_MODEL` doesn't apply. If your organization's model allowlist (`availableModels`) excludes that id, or a provider (Bedrock, Vertex, Foundry) doesn't resolve it, the call is refused and every unclear case stops the list (never an unchecked continue). Allow the id, or switch `haiku` off.
- The rules of stages 6–8 are text patterns; unusual wording ends up with Haiku or leads to "ask", never to an unchecked continue.
- The elapsed-time clock only ticks while the sidebar is visible and Claude is working.
- **Storage:** all of worklist's data shares 4 MiB. The history is limited to 300 entries per project (text cut to 200 characters); each project folder and worktree has its own. Empty lists are deleted; unfinished lists of old chats remain, and so do the sent-to-do checksums of every chat that sent a to-do (at most 50 small entries per chat). If saving fails, a toast appears and the list keeps running in memory only.
- **Project folder** is read at startup; after a worktree switch or `/cd` in the same session, the history still goes to the old project.
- **`/clear`** relies on the `SessionStart` hook with source `clear`; tested in the CLI and the desktop app.
- **After `/resume` or `/branch`** worklist detects the other chat on the next redraw, command, button press or turn (via the session ID), not immediately.
- Changing `language` affects new texts; reasons already shown in an open notice stay in the old language until the next decision. The descriptions of `/todo` and `/todos` in the command menu follow the language set when the session started.

## Credits

Ideas and workflows are modeled on `arbeitsliste` from nikisge/niklas-mods (no license; no code taken).
