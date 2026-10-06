# clawd-buddy

An animated pixel mascot ("Clawd") sits to the right above the prompt. It reacts to the time of day, Claude's work, waiting times, idle phases, your typing, the mouse, and a mood that builds up over the session.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.291** (terminal and desktop app) · Plugin version **0.6.5**

## What it does

Clawd runs on his own. What he does depends on what is happening:

| Situation | What he does (examples) |
|---|---|
| Claude reads, writes, uses the shell (own animations for commit/push and tests/checks), the web, or subagents. Each running subagent (background ones too) gets a small helper in a lighter Claude color standing next to him (from 7 on, in a second row). They mostly work quietly side by side, think, report and talk things over; a wave or fist bump is rare. When a subagent finishes, its helper hands over the result (a note, a stack, a folder, an envelope, or a present) or they high-five | magnifying glass, laptop (types slowly to fast), terminal and log windows, floppy disk, upload cloud, clipboard, test tube, globe |
| A tool runs longer than 10 s or 60 s | taps his foot, clock, hourglass, sits or lies down |
| Claude compacts the conversation (`/compact` or automatically) | squashes a paper stack into a tied package or crumples sheets into a box |
| A skill starts | briefly opens a book or grabs a wrench from a toolbox |
| With **sidekick** installed: it checks your message, holds it back with a question, or starts a new chat with a handoff | holds the magnifying glass to the input; holds up a stop sign; writes a letter and sends it off, then opens it in the new chat and waves |
| Claude is waiting for you (question, permission) | waves with a question mark, holds up a sign, points at the input, asks with a speech bubble; if the question is open for more than 45 s, he knocks on the input |
| Turn finished or aborted | jumps for joy or shrugs; every 5 successes in a row a trophy or medal; after a long turn (5 min or more) a big "phew" or a finish flag |
| The context window is getting full (70 % and again at 85 %, shown once at the end of the turn) | a box of paper that won't close, or a wobbly paper stack: time for `/compact` or a new chat |
| You are typing | reads along, takes notes, rubs his hands |
| Idle | pastimes by time of day: whistling and a little dance in the morning, juggling, soap bubbles, a flower at midday, calmer in the evening; at night a tea light, counting sheep, stargazing, then sleep |
| Birthday (setting) or New Year's Eve | cake with candles, party hat; fireworks, sparkler |
| Usage limit reached (5-hour or weekly) | 5 h: turns the hourglass, dozes with an alarm clock, spins a top, is annoyed or sad (can't keep working); weekly: sits on a suitcase, goes fishing, tends a potted plant, paints, knits a scarf, builds a sandcastle. After the reset: a jump for joy or a confetti cannon (always plays to the end) |
| Night (default 23:00 to 6:00) | yawns, nods off, sleeps with a nightcap |
| You come back after at least 2 h (first input, or the desktop session becomes visible again), at any time of day | gets up or rubs his eyes, then stretches, has a coffee, brushes his teeth, does jumping jacks or waters a flower |
| Claude switches between tools within seconds | at most two animations in a row are cut short; the third one stays at least about 8 s, so he does not flip back and forth |
| Mood | Piling errors make him irritable (facepalm, stomping, steam); successes in a row put him in a good mood; long stretches of work make him tired. Everything wears off again. |

| Input | Effect |
|---|---|
| `/clawd` or `/clawd status` | on/off, mood, tiredness, annoyance; in the desktop app also measurements since the last call (draws per minute, animation length and frame changes, size, compute and drawing time, how many animations were swapped with or without handover and why) |
| `/clawd on` / `/clawd off` | show or hide him (persists) |
| `/clawd list` | all animations by group |
| `/clawd demo <name>` | play one animation, e.g. `/clawd demo type_laptop` |
| `/clawd nap` | sends him to sleep |
| `/clawd boop` | pokes him |
| `/clawd flicker` | desktop app only: a 30-second test in three parts (number top left) to find out where a blink on frame changes comes from; afterwards he continues normally |
| Mouse (terminal): click | giggles; many clicks in a row make him annoyed, then offended |
| Mouse (terminal): drag an arm | the arm follows briefly and snaps back |
| Mouse (terminal): hold the body for ~0.7 s, then drag | he hangs from the pointer, falls when you let go, and walks back |

Runs in: the terminal (half-block pixels, with mouse) and the desktop app's Code tab (as an animated image, without mouse). In `claude -p`, the Agent SDK, VS Code and mobile he draws nothing.

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
hooks: session.start, session.measure, turn.start, turn.complete, tool.call, tool.check, session.compact, skill.prompt, prompt.edit, ui.message, command.run{command=clawd}, ui.render{component=AbovePrompt}
calls: $.command.register, $.store.get, $.store.set, $.ui.invalidate, $.ui.resolve, $.clock.now, $.clock.every, $.ui.log, $.state.get
state reads: sidekick.buddy
```

All event hooks **only observe** and pass everything through unchanged. No file system, no processes, no network, no model calls.

In plain language:

- `$.command.register`: registers the `/clawd` command.
- `$.store.get` / `$.store.set`: stores only on/off, the annoyance counter, and when you were last around (one timestamp, written at most every 5 min, for the welcome after a break). The plugin's own storage.
- `$.ui.invalidate`: redraws the band when something changes (turn, tool, typing at most once per second; in the desktop app typing at most every 3 s, plus once before each animation runs out, usually every 15 to 30 s; 2 to 3 times a minute when idle).
- `$.ui.resolve`: fetches the drawing components (Box, Client, Svg).
- `$.clock.now`: time of day for day/night, waiting times, mood, and the break before the welcome.
- Hook `session.measure`: reads only the percentage and reset time of the 5-hour and weekly limits (for the limit animations) and the fill percentage of the context window (for the "context almost full" hint); never the conversation itself.
- `$.clock.every`: a watcher (every 250 ms, no drawing of its own) **only in the desktop app**, while it draws the band and Clawd is on; it asks for the next animation shortly before the current one ends, or shortly before new facts would change what is shown, and once about half a second after each new animation, to clear the frame of the previous one. In the terminal the client ticks on its own.
- `$.ui.log`: error messages to the debug log.
- Hook `session.compact`: notices only that the main conversation is being compacted and when it ends. Never reads the conversation.
- Hook `skill.prompt`: notices only that a skill starts. Never reads the skill's text.
- `$.state.get` (`sidekick.buddy`): reads what the sidekick mod is doing right now (check, question, new chat), a kind and a timestamp, no texts. Without sidekick it stays empty. sidekick does not need to be installed.

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

- **Desktop app:** The client frame does not load there. The hooks module computes up to the next 30 seconds ahead and sends them as one SVG with SMIL animation, which the app plays in a script-less frame (`isInteractive`). Pastimes with many different frames get shorter animations, down to about 5 s. The band is redrawn only on events (turn, tool, question, typing) and shortly before the animation runs out. If the band is redrawn for another mod, or an event changes nothing in what is currently shown, the same SVG is passed on unchanged, so the frame does not reload (a reload made the figure blink briefly); a new animation is computed only shortly before something actually changes. `/clawd status` shows how often that happened. A new animation does not replace the old one in place: there are two frames on top of each other, the new one loads in the free frame while the old one keeps playing, and about half a second later the old frame is cleared. For that overlap the new animation first continues exactly what the old one shows (up to 0.75 s), so a new event or `/clawd boop|demo|nap` may show up to 0.75 s later. Every redraw of the band makes the app also re-request the rows other mods hook (for example your own messages with sidekick), which made their hover bar flicker in 0.4.1 at about 5 redraws per second. While Claude works, tool calls still redraw the band now and then. No mouse (clicking, dragging) in the desktop app; `/clawd boop|demo|nap` work. The app draws the dark area behind the band itself and it cannot be hidden, so he does not sit quite flush on the input. In very narrow windows the 400 px wide image may be cut off.
- **Mouse in the terminal** only works where the terminal delivers mouse events (fullscreen). After a click on the figure it may keep the keyboard focus until you press Esc.
- **After a hidden desktop session is shown again**, the figure may stand still (last frame of the animation) until the next event (turn, tool, typing) if the app reuses the last drawing.
- **Mood** is per Claude Code process and is not saved. "Working on the same feature for a long time" is approximated by the time spent working in one stretch (the mod cannot see what the work is about).
- **Voice input:** There is no mod event for "recording in progress", and `prompt.edit` only reports a person as the source. Dictated text counts like typing ("reads along"). Dedicated recording animations will follow once Claude Code offers a signal for it.
- `tools/` and `showcase/` are developer tools (Node) and are not loaded by the mod. To see all animations, open `showcase/index.html` in a browser (a developer tool, German only). `node tools/gif.mjs <clip>...` renders clips as an animated GIF.

## Credits

The figure is a fan homage to Clawd, the Claude Code mascot. The pixels are drawn by hand. Laptop typing motion after a reference GIF by Fynn Hansen. This is an unofficial project and is not affiliated with Anthropic.
