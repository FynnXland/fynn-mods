# clawd-buddy

An animated pixel mascot ("Clawd") sits to the right above the prompt. It reacts to the time of day, Claude's work, waiting times, idle phases, your typing, the mouse, and a mood that builds up over the session.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.290** · Plugin version **0.4.1**

## What it does

Clawd runs on his own. What he does depends on what is happening:

| Situation | What he does (examples) |
|---|---|
| Claude reads, writes, uses the shell (own animations for commit/push and tests/checks), the web, or subagents. Each running subagent (background ones too) gets a small helper standing next to him (from 7 on, in a second row). They mostly work quietly side by side and chat now and then. When a subagent finishes, its helper hands over the result (a note, a stack, a folder, an envelope, or a present) | magnifying glass, laptop (types slowly to fast), terminal and log windows, floppy disk, upload cloud, clipboard, test tube, globe |
| A tool runs longer than 10 s or 60 s | taps his foot, clock, hourglass, sits or lies down |
| Claude is waiting for you (question, permission) | waves with a question mark, holds up a sign; if the question is open for more than 45 s, he knocks on the input |
| Turn finished or aborted | jumps for joy or shrugs; every 5 successes in a row a trophy or medal |
| You are typing | reads along, takes notes, rubs his hands |
| Idle | pastimes by time of day: whistling and a little dance in the morning, juggling, soap bubbles, a flower at midday, calmer in the evening; at night a tea light, counting sheep, stargazing, then sleep |
| Birthday (setting) or New Year's Eve | cake with candles, party hat; fireworks, sparkler |
| Usage limit reached (5-hour or weekly) | 5 h: turns the hourglass, dozes with an alarm clock, spins a top, is annoyed or sad (can't keep working); weekly: sits on a suitcase, goes fishing, tends a potted plant. After the reset: a jump for joy or a confetti cannon (always plays to the end) |
| Night (default 23:00 to 6:00) | yawns, nods off, sleeps with a nightcap |
| You come back after at least 2 h (first input, or the desktop session becomes visible again), at any time of day | gets up or rubs his eyes, then stretches, has a coffee or brushes his teeth |
| Mood | Piling errors make him irritable (facepalm, stomping, steam); successes in a row put him in a good mood; long stretches of work make him tired. Everything wears off again. |

| Input | Effect |
|---|---|
| `/clawd` or `/clawd status` | on/off, mood, tiredness, annoyance; in the desktop app also tick measurements since the last call (ticks/s, largest gap, frame changes/s, drawings/s, drawing time) |
| `/clawd on` / `/clawd off` | show or hide him (persists) |
| `/clawd list` | all animations by group |
| `/clawd demo <name>` | play one animation, e.g. `/clawd demo type_laptop` |
| `/clawd nap` | sends him to sleep |
| `/clawd boop` | pokes him |
| Mouse (terminal): click | giggles; many clicks in a row make him annoyed, then offended |
| Mouse (terminal): drag an arm | the arm follows briefly and snaps back |
| Mouse (terminal): hold the body for ~0.7 s, then drag | he hangs from the pointer, falls when you let go, and walks back |

Runs in: the terminal (half-block pixels, with mouse) and the desktop app's Code tab (as an image, without mouse). In `claude -p`, the Agent SDK, VS Code and mobile he draws nothing.

## Configuration

`/config` → clawd-buddy:

| Key | Title in `/config` | Meaning | Default |
|---|---|---|---|
| `nightStart` | Night starts (hour) | Hour (0 to 23) from which he gets tired and falls asleep when idle | 23 |
| `nightEnd` | Night ends (hour) | Hour (0 to 23) until which it counts as night; if it is before the start, the night spans midnight | 6 |
| `idleSeconds` | Idle time before pastimes (seconds) | Seconds without activity before he starts a pastime (10 to 600) | 45 |
| `reducedMotion` | Reduced motion | Only the base pose and calm variants, no pastimes | off |
| `side` | Position in the band | `right` or `left` above the prompt | `right` |
| `birthday` | Birthday (DD.MM.) | Day (DD.MM.) on which he celebrates with you; empty = off. New Year's Eve is always on | `05.01.` |
| `language` | Language / Sprache | Language of the mod's texts: `en` English, `de` German | `en` |

## Language

Texts are English by default; set `language` to `de` for German (`/config` → clawd-buddy → Language / Sprache). This covers everything the mod writes: the output of `/clawd` (status, list, demo, nap, errors), the animation names and the image's alt text. Clawd himself shows no text. `/clawd demo` finds animations by their English and German names in both languages. Commands and arguments are English either way.

## Rights

`claude plugin validate` shows:

```text
hooks: session.start, session.measure, turn.start, turn.complete, tool.call, tool.check, prompt.edit, ui.message, command.run{command=clawd}, ui.render{component=AbovePrompt}
calls: $.command.register, $.store.get, $.store.set, $.ui.invalidate, $.ui.resolve, $.clock.now, $.clock.every, $.ui.log
```

All event hooks **only observe** and pass everything through unchanged. No file system, no processes, no network, no model calls.

In plain language:

- `$.command.register`: registers the `/clawd` command.
- `$.store.get` / `$.store.set`: stores only on/off, the annoyance counter, and when you were last around (one timestamp, written at most every 5 min, for the welcome after a break). The plugin's own storage.
- `$.ui.invalidate`: redraws the band when something changes (turn, tool, typing at most once per second; in the desktop app at the frame rate).
- `$.ui.resolve`: fetches the drawing components (Box, Client, Svg).
- `$.clock.now`: time of day for day/night, waiting times, mood, and the break before the welcome.
- Hook `session.measure`: reads only the percentage and reset time of the 5-hour and weekly limits (for the limit animations).
- `$.clock.every`: frame tick (75 ms) **only in the desktop app**, while it draws the band and Clawd is on; in the terminal the client ticks on its own.
- `$.ui.log`: error messages to the debug log.

From tool results he reads only the "error" (`isError`) and "denied" (`deny`) flags, never contents or texts.

## Installation

Add the marketplace once, then install the mod:

```bash
claude plugin marketplace add FynnXland/fynn-mods
claude plugin install clawd-buddy@fynn-mods
```

Inside a session the same works with `/plugin marketplace add FynnXland/fynn-mods` and `/plugin install clawd-buddy@fynn-mods`.
The mod loads in the next session, or after `/reload-plugins`.

**Check:** `/plugin` shows `… mod active · clawd-buddy`.

**Update:** `claude plugin update clawd-buddy@fynn-mods`, or turn on auto-update for `fynn-mods` under **Marketplaces** in `/plugin`.

**Remove:** disable it under **Installed** in `/plugin`, or run `claude plugin uninstall clawd-buddy@fynn-mods`.

**Try it for one session without installing** (from a clone of the repo):

```bash
claude --plugin-dir <path-to-clone>/mods/clawd-buddy
```

To just hide him without uninstalling, use `/clawd off`.

## Known limitations

- **Desktop app:** The client frame does not load there; Clawd is an image that the hooks module redraws on a tick. No mouse (clicking, dragging) in the desktop app; `/clawd boop|demo|nap` work. The app draws the dark area behind the band itself and it cannot be hidden, so he does not sit quite flush on the input. In very narrow windows the 400 px wide image may be cut off.
- **Desktop tick:** The tick runs at about 13 per second, but he only redraws when Clawd's image changes. Sitting still that is only a few redraws per second, more during animations. Whether the app allows more than 10 redraws per second in the band is not documented. If it stutters, please report it.
- **Mouse in the terminal** only works where the terminal delivers mouse events (fullscreen). After a click on the figure it may keep the keyboard focus until you press Esc.
- **After a hidden desktop session is shown again**, the figure may stand still until the next event (turn, tool, typing) if the app reuses the last drawing.
- **Mood** is per Claude Code process and is not saved. "Working on the same feature for a long time" is approximated by the time spent working in one stretch (the mod cannot see what the work is about).
- **Voice input:** There is no mod event for "recording in progress", and `prompt.edit` only reports a person as the source. Dictated text counts like typing ("reads along"). Dedicated recording animations will follow once Claude Code offers a signal for it.
- `tools/` and `showcase/` are developer tools (Node) and are not loaded by the mod. To see all animations, open `showcase/index.html` in a browser (a developer tool, German only). `node tools/gif.mjs <clip>...` renders clips as an animated GIF.

## Credits

The figure is a fan homage to Clawd, the Claude Code mascot. The pixels are drawn by hand. Laptop typing motion after a reference GIF by Fynn Hansen. This is an unofficial project and is not affiliated with Anthropic.
