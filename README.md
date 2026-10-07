# fynn-mods

**Six mods for Claude Code: an animated mascot, usage-limit bars, a pre-send sidekick, quick replies, a to-do
worklist and a cost ledger.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-v2.1.290_tested-D97757)](https://code.claude.com/docs/en/plugins/mods/overview)
[![Mods](https://img.shields.io/badge/mods-6-555)](#the-mods)
[![Languages](https://img.shields.io/badge/UI-English_%7C_German-555)](#the-mods)

**English** | [Deutsch](README.de.md)

My daily-driver set of [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview), the plugins that
draw into Claude Code's own interface in the terminal and in the desktop app. They keep an eye on usage limits, the
prompt cache and costs, check messages before they go out and queue the next tasks. The mods are tuned to work side
by side, but each one is a separate plugin you can install on its own.

This repository is a Claude Code plugin marketplace named `fynn-mods`.

> **English or German.** Every mod speaks English by default: buttons, messages, dialogs and the answers of the model
> calls some mods make. Each mod has a `language` option (`en` or `de`); set it to `de` for German with
> `/plugin configure <mod>@fynn-mods` in a session. The screenshots below show the German setting.

| Mod | In one line |
|---|---|
| [clawd-buddy](#clawd-buddy) | Animated pixel mascot above the prompt that reacts to what Claude is doing |
| [limit-bars](#limit-bars) | 5-hour and weekly limit bars, plus a ring showing how long the prompt cache stays warm |
| [sidekick](#sidekick) | Checks your message before it is sent: cold-cache costs, wrong chat, better wording, due maintenance |
| [quick-replies](#quick-replies) | Claude Code's next-message suggestion as a one-click button |
| [worklist](#worklist) | To-do sidebar that feeds Claude one task after another, only when it's clearly done |
| [cost-ledger](#cost-ledger) | Cost ledger across all chats, by day, project, chat and model |

## Requirements

- Claude Code with mods. Mods need **v2.1.287 or later**; this set is tested with **v2.1.290**. Check with
  `claude --version`.
- Runs in the terminal and in the Code tab of the Claude desktop app. In `claude -p`, the Agent SDK, VS Code and on
  mobile most mods draw nothing; see each mod's README.
- The mods API can change between Claude Code releases. If a mod breaks after an update, please open an issue.

## Installation

Add the marketplace once:

```bash
claude plugin marketplace add FynnXland/fynn-mods
```

Then install the mods you want, one by one:

```bash
claude plugin install clawd-buddy@fynn-mods
claude plugin install limit-bars@fynn-mods
claude plugin install sidekick@fynn-mods
claude plugin install quick-replies@fynn-mods
claude plugin install worklist@fynn-mods
claude plugin install cost-ledger@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install <mod>@fynn-mods`.
A newly installed mod loads in the next session, or after `/reload-plugins`. `/plugin` lists it as `mod active`.

**Updates:** Every published change bumps the mod's version. Auto-update is off for third-party marketplaces by default.
Either turn it on for `fynn-mods` under **Marketplaces** in `/plugin`, or update by hand:

```bash
claude plugin marketplace update fynn-mods
claude plugin update <mod>@fynn-mods
```

**Remove:** disable a mod under **Installed** in `/plugin`, or run `claude plugin uninstall <mod>@fynn-mods`.

**Try without installing:** clone this repo and start a session with `claude --plugin-dir <path-to-clone>/mods/<mod>`.

## Costs

Three mods make model calls **on your account** (on a subscription they count toward your usage limits):

- **sidekick** asks Sonnet 5.5 (effort `low`) only when a check can pay off (first message of a chat, large context,
  cold cache): about $0.01 and 2 seconds per check (API value). A handoff to a new chat is one larger Sonnet call,
  made only when you choose it. In level `plan` or `auto` with worklist installed, a long message (800+ characters) is
  checked too, and splitting it into to-dos or `/later` costs about $0.01 more. Level `auto` checks every message from
  300 characters (about $0.01 each); level `cache` makes no model call at all. `/savings` sets both against the measured
  savings. Turn it off with `/sidekick off`.
- **worklist** asks Haiku only when its rules can't tell whether Claude is done: about $0.0005 per case. Turn it off
  with the `haiku` setting in `/config`; the list then stops in those cases and waits for you.
- **quick-replies** forks the session after each answer **only with `/replies more on`** (off by default): roughly
  the cost of one short answer, mostly from the prompt cache.

limit-bars makes a call only while you have `/keepwarm` running (off by default). clawd-buddy and cost-ledger make no
model calls. cost-ledger records the calls of the other mods, so you can see what they cost.

## The mods

### clawd-buddy

![clawd-buddy](assets/clawd-buddy.gif)

Clawd, a little pixel crab, sits on top of the prompt box and reacts to what's going on: he reads along, types on a
laptop while Claude edits, waits with an hourglass during long tool runs, celebrates finished turns and gets visibly
grumpy when errors pile up. When idle he passes the time depending on the hour, and at night he falls asleep.
Subagents show up as small helpers next to him.

- **Commands:** `/clawd` (status), `/clawd on|off`, `/clawd list`, `/clawd demo <name>`, `/clawd nap`, `/clawd boop`
- **Rights in short:** observes events only and passes them on unchanged; remembers on/off and a few counters in its
  own plugin store. No files, processes, network or model calls.
- **Details:** [mods/clawd-buddy](mods/clawd-buddy/README.md)

### limit-bars

![limit-bars](assets/limit-bars.svg)

Two slim bars left of Clawd show how much of the 5-hour and the weekly limit you've used and when each resets. A ring
next to them shows how long this chat's prompt cache stays warm, and the context size. The cache guard asks before
you send into a large chat with a cold cache, which would re-write the whole context.

An optional third ring shows how full a drive is, split by file type (programs, media, AI models, code …), with
`/disk` for the details. It is **off by default** and Windows only for now: set `storagePath` in `/config` to turn it on.

**Make it yours:** every part (5-hour bar, weekly bar, cache ring, storage ring) can be hidden on its own, with
`/bars show cache off` (applies to all open chats right away) or permanently with `showFiveHour`, `showWeekly`,
`showCache` and `showStorage` in `/config`. Hiding the cache ring keeps the cold-send question; turn that off with
`/cache warn off`.

- **Commands:** `/cache` (overview and settings), `/handoff [continue|show]` (write a handoff and continue in a fresh
  chat), `/keepwarm [hours|off]`, `/disk [refresh]`, `/bars [show <part> on|off | reset]`
- **Rights in short:** reads limits, context size and cache statistics; can hold a message back to ask you first; runs
  `/clear` and `/compact` and sends a handoff only after you choose so; `$.model.fork` only while `/keepwarm` runs;
  only with `storagePath` set, runs Windows PowerShell with two fixed, read-only scripts (drive size, sizes by file
  extension). No files, network or environment variables.
- **Details:** [mods/limit-bars](mods/limit-bars/README.md)

### sidekick

![sidekick](assets/sidekick.png)

A second pair of eyes on every message, right before it is sent. Fixed rules decide first, at no cost. Only where a
check can pay off (the first message of a chat, a large context, a cold cache) a quick Sonnet 5.5 call looks at it
too. sidekick never chats on its own: it stays quiet, adds a blue hint line under your message, or asks you.

- **Cold cache in a large chat:** before you resend a big context that has gone cold, it shows both prices, e.g.
  "sending rewrites everything (≈ $2.40)" versus "new chat with handoff (≈ $0.26)". With *new chat with handoff*,
  Sonnet writes the handoff, the chat is cleared and your message continues in the fresh one; the old chat stays
  available in `/resume`.
- **A better move:** points to a matching skill, suggests a fresh chat when the topic has changed, or offers a clearer
  version of your message that you can send with one click.
- **Wrong chat:** if a message clearly belongs to a different project than the chat, sidekick holds it back and asks
  whether you're in the wrong chat, before it lands in (and pays for) the wrong context.
- **Long message, several tasks:** with worklist installed, a long message (e.g. dictated) that holds three or more
  separate tasks can be split into 3–4 to-dos. sidekick shows the steps and asks; Sonnet then writes the to-dos with
  every point of your message, and worklist works through them one after another.
- **Five levels:** `/sidekick off`, `cache` (only the cold-cache question, no model call), `guide` (the default),
  `plan` (checks earlier and splits long messages) and `auto` (checks every message from 300 characters and sends a
  clearer version or a split without asking; new chat and wrong chat still ask). A label in the prompt footer next to the
  model picker shows the level: 🟢 ready, 🟠 working or asking, 🔴 off.
- **`/later <text>`:** plans text as 1–4 to-dos with worklist, also while Claude works, without Claude reading it. In the
  desktop app the command ends Claude's current turn.
- **Due maintenance:** once per chat it names at most one due command (`/skill-doctor`, prompt audit, memory
  consolidation, `/init`), based on a free local estimate. A button next to the line (also for a command a hint names, e.g.
  `/handoff`) runs it with one click or, with worklist installed, queues a skill as a to-do.
- **Savings you can check:** `/savings` shows what sidekick cost and what it measurably saved; `/savings detail` adds
  the calculation, a model comparison and a day-by-day history.

If a check fails or times out, your message goes through unchanged.

- **Commands:** `/sidekick` (status and settings), `/sidekick off|cache|guide|plan|auto|on`, `/sidekick long 800|off`,
  `/sidekick hints …`, `/later <text>`, `/savings [today|week|all]`, `/savings detail`
- **Rights in short:** reads your message before it is sent; holds it back or replaces it only after your choice in
  the dialog (in level `auto` also without asking: a rewritten version or a split); Sonnet via `$.model.complete` with a short running summary, your last 3 messages and the end of Claude's last reply, never the whole
  history; on a button click it runs the command shown in the line (plugin and your own commands, `/skill-doctor`,
  `/init`; never MCP prompts, `/clear`, `/exit`, `/quit`, `/login`, `/logout`, `/rewind`) or worklist's `/todo` (also for
  the to-dos of a split or `/later`); in level `auto` it sends a rewritten version in your name without asking, only
  after you chose that level; draws its label in the prompt footer; and fills
  the prompt if the command is refused; reads the project root path; tells clawd-buddy via `$.state` only the kind of
  event and the time, never your message. No files, environment, network or settings.
- **Details:** [mods/sidekick](mods/sidekick/README.md)

### quick-replies

![quick-replies](assets/quick-replies.png)

Claude Code often suggests your next message as grey text in the prompt. quick-replies turns it into a button in its
own pill above Clawd. Click it, or type `1` into the empty prompt, and it's sent as your message. With
`/replies more on` a fork of the session fills up to four places in total; Claude Code's own stays on `1`.

- **Commands:** `/replies` (status), `/replies on|off`, `/replies more on|off`
- **Rights in short:** reads Claude Code's suggestion; sends a suggestion as your message only on click or key, never
  automatically; `$.model.fork` only with `more` on. No files, processes or network.
- **Details:** [mods/quick-replies](mods/quick-replies/README.md)

### worklist

![worklist](assets/worklist.png)

A to-do sidebar next to the chat. Queue tasks, even while Claude is working. When Claude is **clearly** done, the
running to-do is checked off and the next one starts on its own; while subagents or background work still run, it
waits. The list never pauses on its own: if Claude isn't clearly done (a question, an interruption, an error, an open
plan), it stops at that to-do, tells you why and offers **Continue**, **Mark as done** and **Skip**; answering Claude's
question in the chat continues it as well. Queueing while Claude is free starts the list even after a question.
History is kept per project.

- **Commands:** `/todo <task>`, `/todos` (sidebar), `/todos pause|resume|done|skip|retry|clear|history|status|close`
- **Rights in short:** sends the next to-do (or the continuation of a stopped one) as your message only after its
  check passes or on your click; Haiku for
  unclear cases (can be turned off); reads whether subagents are still running. In the chat it shows sent to-dos as an
  orange line and hides a standalone "Done." / „Fertig.“ at the end of answers (display only). No files, processes or network.
- **Details:** [mods/worklist](mods/worklist/README.md)

### cost-ledger

![cost-ledger](assets/cost-ledger.png)

After every answer cost-ledger books what the chat has cost so far (the same figure as `/cost`), the tokens per model
and the model calls made by other mods. `/ledger` shows today, 7 and 30 days and the total, a history split by model,
your projects and the most expensive chats, drawn in Claude Code's own style.

- **Commands:** `/ledger`, `/ledger weeks`, `/ledger chats|projects|models [7|30|all]`, `/ledger reset`, `/ledger help`
- **Rights in short:** reads the session's cost and usage; observes other mods' model calls and passes them on
  unchanged; stores the project name, the git remote as `host/owner/repo` and the first 50 characters of a chat's first
  message in its local plugin store. Makes no model calls; no files, processes or network.
- **Details:** [mods/cost-ledger](mods/cost-ledger/README.md)

## How they work together

- **One band above the prompt.** clawd-buddy, limit-bars, quick-replies and sidekick all draw into the band above the
  prompt and share a small layout convention: the limit bars and cache ring sit left of Clawd, the quick-replies pill
  sits above both, and sidekick's progress box appears there only while it starts a new chat. Each mod also works
  alone.
- **limit-bars and sidekick both guard against cold sends.** If you use both, turn off limit-bars' warning once with
  `/cache warn off`, so you don't get two dialogs in a row; sidekick's question replaces it.
- **sidekick hands tasks to worklist.** With both installed, the button next to a maintenance hint queues the command
  as a to-do; worklist sends it once the current task is done. A long message with several tasks can be split into
  to-dos the same way. Without worklist, sidekick never offers this and doesn't check long messages for it.
- **Clawd acts out what sidekick does.** With both installed, Clawd holds a magnifying glass to the input while
  sidekick checks, holds up a stop sign when it asks, and writes a letter when it starts a new chat with a handoff.
- **cost-ledger books the others.** Model calls of sidekick, worklist, quick-replies and limit-bars don't show up in
  `/cost`; cost-ledger records them separately, so `/ledger` shows what each mod costs.

## Rights and trust

A mod is code that runs inside Claude Code with your permissions. Every mod here declares what it hooks into and which
API calls it makes; `claude plugin validate mods/<mod>` prints the exact list, and each README explains every entry
in plain language. None of these mods reads or stores login data or tokens, and none touches files outside its own
plugin store.

## Feedback

Bug reports and ideas are welcome as [issues](https://github.com/FynnXland/fynn-mods/issues). Please include the mod's
version (`/plugin`), `claude --version`, and whether it happened in the terminal or the desktop app.

## Disclaimer

This is an unofficial hobby project. It is not made, endorsed or supported by Anthropic. clawd-buddy is a fan homage
to Clawd, the Claude Code mascot; the pixels are drawn by hand. If Anthropic objects to it, it will be removed.

## License

[MIT License](LICENSE), Copyright (c) 2026 Fynn Hansen.

limit-bars is modeled on Cache Keeper by Nate Herk (MIT); sidekick reuses limit-bars' cache logic. See the
`THIRD-PARTY-NOTICES.md` in both mods.
