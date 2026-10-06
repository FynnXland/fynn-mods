# worklist

A to-do list as a sidebar next to the chat. You queue tasks, even while Claude is working. When Claude is **certainly** done, the running to-do is struck through, moves to the project-wide history, and the next one starts on its own. When that isn't certain (a question, an interruption, an error, helpers still running, background work, an open plan), the list stops, reports the reason in a toast, and shows **Continue**, **Mark as done** and **Send again** in the sidebar.

Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.290** (desktop app: 2.1.286) · Plugin version **0.3.0**

**Cost:** when the rules can't decide whether Claude is done, worklist asks Haiku (measured at about 0.05 US cents per case). These calls run through your session and count toward your usage. You can switch this off with the `haiku` option (see [Configuration](#configuration)); the list then stops in those cases instead.

## Usage

| Input | Effect |
|---|---|
| `/todo <task>` | queue a task (everything after `/todo` is the task); confirmed by a toast only, so Claude doesn't read it |
| `/todo` · `/todos` | open the sidebar |
| `/todos pause` · `/todos resume` | pause or resume the list (with an open notice, `resume` acts like **Continue**) |
| `/todos done` | mark the running or stopped to-do as done by hand |
| `/todos skip` | move the running to-do back to the end of the list |
| `/todos clear` | delete open to-dos; the history stays |
| `/todos history` | show the history (last 30) |
| `/todos status` | check state, last decision with reason, Haiku cost |
| `/todos close` | close the sidebar |

**What Claude receives** is exactly your to-do text, nothing added to the message. With the `doneLine` option on (default), worklist also passes Claude a hidden closing hint beside it (see [below](#when-it-continues-the-certainly-free-check)).

**In the chat transcript** a sent to-do appears as an orange line `· worklist: to-do 2/5 sent` with an orange box ("sent:" and the text); Claude's answer follows below. worklist recognizes its to-dos by their exact text, remembered per chat, so the box stays after a restart or `--resume`.

**Commands as to-dos:** a to-do that starts with `/name` (for example `/review` or `/my-plugin:skill some arguments`) runs as that slash command instead of being sent as text. worklist first checks that the command exists in this session; if it doesn't, the list stops with a notice and nothing is sent. A command that starts a turn for Claude (a skill, a prompt command) counts as done when that turn passes the usual check; a command that runs locally without a turn (such as `/cost`) counts as done once it has run. worklist's own `/todo` and `/todos` can't be queued.

**In the sidebar:**

- **NOW**: what Claude is working on (to-do n/m or "from the chat"), elapsed time, what Claude is doing right now, and Claude's own plan (TaskCreate/TodoWrite) with a progress bar. When idle: "◇ free", with the reason if the list is waiting.
- **NOTICE** (only when stopped): the reason in one sentence, and the buttons **Continue** (moves the stopped to-do to the end and starts the next one; if nothing else is open, the list pauses and nothing is sent), **Mark as done**, **Send again** (sends the same to-do again).
- **NEXT**: the queue with ↑ ↓ ✕, an input field "new to-do, Enter", and **Pause** / **Start** / **Start now**.
- **HISTORY** (collapsible): project-wide, grouped by day, struck through with duration and a short result (the first sentence of Claude's answer).

Runs in: the desktop app (sidebar on the right, main surface) and the terminal (pane above the prompt). On mobile there is no input field; use `/todo <task>` there. In `claude -p` the commands work; the list keeps working as long as the session is open. `/todo <task>` prints nothing there (its confirmation is a toast); check with `/todos status`.

**While Claude is working:**

- **Desktop app:** queue tasks via the sidebar's **input field**. Don't use `/todo` there while Claude works: even when queued normally (not "send directly"), the desktop app holds it until Claude's current step ends and then ends Claude's turn. A normal chat message such as "todo: …" reaches Claude during the turn, so Claude reads it.
- **Terminal:** `/todo <task>` is registered with `immediate`, so per the docs it runs while Claude is working (not tested in the terminal). The input field in the pane works as well.

## When it continues: the "certainly free" check

After every turn end (including after your own chat messages) these stages run; the first decision wins. The detection always understands English and German, whatever `language` is set to.

1. Interrupted → **stop** (to-do goes back into the list, notice)
2. Error, refusal → **stop**
3. Background work or scheduled wake-ups (`classic.Stop`) → **wait** until the next turn end
4. A helper (subagent) is still running (`$.agent.list()`) → **wait**
5. Claude's plan has open steps → **ask**
6. A question in the last paragraph (`?` at the end, "Shall I", "Do you want", "Soll ich" …, options with a question; code doesn't count; a standalone "Done." below doesn't hide it) → **ask**
7. A problem ("failed", "couldn't", "konnte nicht" …), the last tool ended with an error, or an empty answer → **ask**
8. The last sentence is itself "Done.", "Done, …", "All done." (or German "Fertig.", "Erledigt.") → **continue**. "Done" in the middle of a sentence or with a restriction ("Done, except …") doesn't count.
9. Otherwise Haiku (only the end of the answer and the to-do): only "done" with confidence ≥ 0.85 → **continue**, anything else → **ask**
10. Before sending, a 3 s settle time, then check again: no new turn, no new helper, same chat, not paused

When in doubt, nothing is sent. After your own chat message, the list stops quietly on "ask" (no toast); **Start now** resumes it deliberately. The same applies to a to-do you queue while the list is empty: if Claude's last answer ended with a question or background work is running, it doesn't start on its own. If the last answer was merely unclear, Haiku checks briefly before the start. **Loop guard:** if the same to-do stops twice in a row without you replying in the chat, only a button or command continues it. After `maxAutoRun` to-dos in a row without your intervention, the list also stops.

With every sent to-do (not with commands) Claude gets this hint, invisibly, as hook context beside your text (in German with "Fertig." when `language` is `de`):

> This message is a task from the user's to-do list (worklist). If anything is unclear, end your answer with a clear question and don't write "Done.". Otherwise finish the task completely and end your answer with "Done." on a line of its own.

It isn't part of your message and isn't shown in the chat; `/todos status` shows whether it was attached to the last to-do. Switch it off with `doneLine`; detection then relies on the rules and Haiku alone. A standalone "Done." (or "Fertig.") as the last line of an answer is hidden in the transcript. worklist adds nothing to your own messages.

## Language

`/config` → worklist → `language`: `en` (default) or `de`. It switches the sidebar, buttons, toasts, the line in the chat, the output of `/todo` and `/todos`, date and time formats, the hidden closing hint sent with each to-do, and the language of Haiku's short reason. Commands and their arguments are English in both languages.

## Stored data

- **Queue per chat** in `$.store` under `queue:<session-id>`. Another chat in the same project doesn't see or start it. After `/clear` the old list belongs to the old chat; the new one starts empty.
- **History per project** under `history:<project-folder>`, at most 300 entries.
- **Haiku cost** per project under `cost:<project-folder>`.
- **Sent to-dos per chat** under `sent:<session-id>`: the last 50, only a checksum of the text plus the number, so the orange box in the transcript stays after a restart.
- Restart or `--resume`: a running to-do goes back into the list and the list is paused. After `/reload-plugins` it keeps running (run state in `$.state`).

## Configuration

`/config` → worklist's plugin options:

| Key | Default | Meaning |
|---|---|---|
| `language` | `en` | Language of the texts: `en` or `de`. |
| `haiku` | on | Ask Haiku in unclear cases (measured at about 0.05 US cents per case). Off: the list stops in those cases. |
| `doneLine` | on | Hidden closing hint with every sent to-do (not shown in the chat); makes detection more reliable. |
| `settleSeconds` | 3 | Settle time before sending the next to-do (1–30 s), after which worklist checks again that Claude is free. |
| `maxAutoRun` | 15 | Maximum to-dos in a row without your intervention (1–100); then the list stops. |

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, command.run{command=todo}, command.run{command=todos}, prompt.submit, classic.UserPromptSubmit, turn.start, tool.call, tool.call{tool=TaskCreate}, tool.call{tool=TaskUpdate}, tool.call{tool=TodoWrite}, classic.Stop, classic.StopFailure, turn.complete, ui.render{component=UserMessage}, ui.render{component=AssistantMessage}, ui.render{component=Pane}
calls: $.agent.list, $.clock.every, $.clock.now, $.command.list, $.command.register, $.command.run, $.model.complete, $.prompt.submit, $.session.id, $.session.root, $.state.get, $.state.set, $.store.delete, $.store.get, $.store.set, $.ui.close, $.ui.focus, $.ui.log, $.ui.open, $.ui.resolve, $.ui.toast
state writes: worklist.paint, worklist.rt
state reads: worklist.paint, worklist.rt
```

In plain language:

- `$.prompt.submit` (as your message): sends the next to-do, only after a passed check or when you press a button.
- `$.command.list`, `$.command.run`: a to-do starting with `/name` runs as that command, after checking it exists.
- `classic.UserPromptSubmit`: attaches the hidden closing hint, only to the to-do worklist just sent (switch off with `doneLine`); every other message passes unchanged.
- `$.model.complete`: Haiku, only in stage 9, and it can be switched off.
- `$.agent.list`: reads whether helpers are still running (stage 4).
- `$.session.id`, `$.session.root`: list per chat, history per project.
- `$.store`, `$.state`: list, history, cost, run state, and a redraw counter for the sidebar. `$.store.delete` only deletes this chat's list once it has become empty.
- `$.ui.*`, `$.clock.*`, `$.command.register`: sidebar, toast, clock, `/todo` and `/todos`.
- `ui.render{component=AssistantMessage}`: hides a standalone "Done." or "Fertig." at the end of Claude's answers (display only; the stored answer stays unchanged). This applies in every session where worklist is loaded, not only for to-dos.
- `ui.render{component=UserMessage}`: shows a sent to-do in the transcript as an orange line with a box instead of the speech bubble (display only; your own messages stay unchanged).
- Apart from the hidden hint on worklist's own to-dos and the display-only changes above, the hooks only observe and pass everything through unchanged. No file system, no processes, no network.

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

- **Hover flicker in the desktop app** over buttons and the input field: not caused by worklist (it persists even without any redraw from worklist), probably caused by frequent redraws from other mods (clawd-buddy).
- **Cursor in the input field:** `/todo` or `/todos` puts focus into the field, but the desktop app (2.1.286) doesn't show the cursor there. Click into the field once.
- **`/todo …` during a turn in the desktop app** ends Claude's turn, whether queued normally or sent with "send directly" (desktop app 2.1.286, see Usage). Use the input field instead.
- **Commands as to-dos:** if a command starts no turn within a few seconds, worklist counts it as done once it has run. The command list Claude Code offers to mods is incomplete (`/cost` is missing but runs), so whether a command exists is decided by running it.
- The rules of stages 6–8 are text patterns; unusual wording ends up with Haiku or leads to "ask", never to an unchecked continue.
- A scheduled wake-up (`/loop`, CronCreate) keeps the list waiting as long as it exists.
- The elapsed-time clock only ticks while the sidebar is visible and Claude is working.
- **Storage:** all of worklist's data shares 4 MiB. The history is limited to 300 entries per project (text cut to 200 characters); each project folder and worktree has its own. Empty lists are deleted; unfinished lists of old chats remain, and so do the sent-to-do checksums of every chat that sent a to-do (at most 50 small entries per chat). If saving fails, a toast appears and the list keeps running in memory only.
- **Project folder** is read at startup; after a worktree switch or `/cd` in the same session, the history still goes to the old project.
- **After `/clear`** worklist detects the new chat on the next redraw, command, button press or turn (via the session ID), not immediately.
- Changing `language` affects new texts; reasons already shown in an open notice stay in the old language until the next decision. The descriptions of `/todo` and `/todos` in the command menu follow the language set when the session started.

## Credits

Ideas and workflows are modeled on `arbeitsliste` from nikisge/niklas-mods (no license; no code taken).
