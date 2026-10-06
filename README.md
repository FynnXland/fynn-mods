# fynn-mods

**English** | [Deutsch](README.de.md)

My daily-driver set of [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview): an animated mascot, usage-limit
bars, a pre-send sidekick, quick replies, a to-do worklist and a cost ledger. The mods are tuned to work side by side,
but each one is a separate plugin you can install on its own.

This repository is a Claude Code plugin marketplace named `fynn-mods`.

> **English or German.** Every mod speaks English by default: buttons, messages, dialogs and the answers of the model
> calls some mods make. Each mod has a `language` option (`en` or `de`); set it to `de` for German with
> `/plugin configure <mod>@fynn-mods` in a session. The screenshots below show the German setting.

| Mod | In one line |
|---|---|
| [clawd-buddy](#clawd-buddy) | Animated pixel mascot above the prompt that reacts to what Claude is doing |
| [limit-bars](#limit-bars) | 5-hour and weekly limit bars, plus a ring showing how long the prompt cache stays warm |
| [sidekick](#sidekick) | Checks your message before it is sent and suggests a better move when there clearly is one |
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

- **sidekick** asks Haiku when a check can pay off (first message of a chat, large context, cold cache): about
  $0.005 per check (API value). Turn it off with `/sidekick off`.
- **worklist** asks Haiku only when its rules can't tell whether Claude is done: about $0.0005 per case. Turn it off
  with the `haiku` setting in `/config`; the list then pauses in those cases.
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

- **Commands:** `/cache` (overview and settings), `/handoff [continue|show]` (write a handoff and continue in a fresh
  chat), `/keepwarm [hours|off]`
- **Rights in short:** reads limits, context size and cache statistics; can hold a message back to ask you first; runs
  `/clear` and `/compact` and sends a handoff only after you choose so; `$.model.fork` only while `/keepwarm` runs.
  No files, processes, network or environment variables.
- **Details:** [mods/limit-bars](mods/limit-bars/README.md)

### sidekick

![sidekick](assets/sidekick.png)

Looks at your message just before it is sent: first with fixed rules, and only where it can pay off, briefly with
Haiku. If there's a clearly better move, such as starting a fresh chat with a handoff instead of paying for a cold
cache, using a matching skill or sending a clearer version, it adds a grey hint under your message or asks you. Once
per chat it also points out due maintenance (`/skill-doctor`, prompt audit, memory consolidation, `/init`).

- **Commands:** `/sidekick` (status and settings), `/sidekick on|off`, `/savings [today|week|all]`
- **Rights in short:** reads your message before it is sent; holds it back or replaces it only after your choice in
  the dialog; Haiku via `$.model.complete` with a short summary and your last messages, never the whole history; reads
  the project root path. No files, environment, network or settings.
- **Details:** [mods/sidekick](mods/sidekick/README.md)

### quick-replies

![quick-replies](assets/quick-replies.png)

Claude Code often suggests your next message as grey text in the prompt. quick-replies turns it into a button in its
own pill above Clawd. Click it, or type `1` into the empty prompt, and it's sent as your message. With
`/replies more on` a fork of the session adds up to three more suggestions on `2`–`4`.

- **Commands:** `/replies` (status), `/replies on|off`, `/replies more on|off`
- **Rights in short:** reads Claude Code's suggestion; sends a suggestion as your message only on click or key, never
  automatically; `$.model.fork` only with `more` on. No files, processes or network.
- **Details:** [mods/quick-replies](mods/quick-replies/README.md)

### worklist

![worklist](assets/worklist.png)

A to-do sidebar next to the chat. Queue tasks, even while Claude is working. When Claude is **clearly** done, the
running to-do is checked off and the next one is sent. When it isn't (a question, an error, running subagents,
background work, an open plan), the list pauses and tells you why, with buttons to continue, check off or resend.
History is kept per project.

- **Commands:** `/todo <task>`, `/todos` (sidebar), `/todos pause|resume|done|skip|clear|history|status|close`
- **Rights in short:** sends the next to-do as your message only after its check passes or on your click; Haiku for
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
- **cost-ledger books the others.** Model calls of sidekick, worklist, quick-replies and limit-bars don't show up in
  `/cost`; cost-ledger records them separately, so `/ledger` shows what each mod costs.

## Rights and trust

A mod is code that runs inside Claude Code with your permissions. Every mod here declares what it hooks into and which
API calls it makes; `claude plugin validate mods/<mod>` prints the exact list, and each README explains every entry
in plain language. None of these mods reads or stores login data or tokens, and none touches files outside its own
plugin store.

## Disclaimer

This is an unofficial hobby project. It is not made, endorsed or supported by Anthropic. clawd-buddy is a fan homage
to Clawd, the Claude Code mascot; the pixels are drawn by hand. If Anthropic objects to it, it will be removed.

## License

[MIT License](LICENSE), Copyright (c) 2026 Fynn Hansen.

limit-bars is modeled on Cache Keeper by Nate Herk (MIT); sidekick reuses limit-bars' cache logic. See the
`THIRD-PARTY-NOTICES.md` in both mods.
