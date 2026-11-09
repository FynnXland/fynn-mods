# clawd-buddy

An animated pixel mascot ("Clawd") sits to the right above the prompt. It reacts to the time of day, Claude's work, waiting times, idle phases, your typing, the mouse, and a mood that builds up over the session.

> Texts are English by default; set `language` to `de` for German.

Tested with Claude Code **v2.1.319** (terminal) and in the desktop app · Plugin version **0.14.5**

## What it does

Clawd runs on his own. What he does depends on what is happening:

| Situation | What he does (examples) |
|---|---|
| Claude reads, writes, uses the shell (own animations for commit/push and tests/checks), the web, or subagents. Each running subagent (background ones too) gets a small helper in a lighter Claude color standing next to him (from 7 on, in a second row). They mostly work quietly side by side, think, report and talk things over; a wave or fist bump is rare. When a subagent finishes, its helper hands over the result (a note, a stack, a folder, an envelope, or a present) or they high-five | magnifying glass, laptop (types slowly to fast), terminal and log windows, floppy disk, upload cloud, clipboard, test tube, globe |
| A tool runs longer than 10 s or 60 s | taps his foot, clock, hourglass, sits or lies down |
| Claude compacts the conversation (`/compact` or automatically) | squashes a paper stack into a tied package or crumples sheets into a box |
| A skill starts | briefly opens a book or grabs a wrench from a toolbox |
| With **sidekick** installed: it checks your message, holds it back with a question, or starts a new chat with a handoff | holds the magnifying glass to the input; holds up a stop sign; writes a letter and sends it off, then opens it in the new chat and waves |
| With **sidekick 0.20.0 or later**: the question has a reason, or sidekick sets a hint or an upkeep note | cold cache: shivers with chattering teeth or stomps and blows into his hands; wrong chat: turns a map around, puzzled; model tip: weighs it up on a small scale; shorter version offered: holds up two notes (scribbled, ticked) and compares; new topic: turns the page and points at a blank sheet; hint line: a light bulb goes on and he points up at it; upkeep: oils the input from a small oil can or sweeps it with a little broom. Questions without a known reason keep the stop sign |
| **Cold cache or a new chat, now and then** (about every third time, at most once per chat): a new chat (also after `/clear`), a resumed or forked chat whose prompt cache has expired (since 0.13.1; resuming a chat with a warm cache is not a cold moment), sidekick reports the cache as cold, or, without sidekick, 60 minutes after Claude's last turn | frost creeps up from the line, he shivers and rubs his arms, and a block of ice closes around him. He stands frozen (a glint wanders over the edge; at night he falls asleep in the ice). Typing cracks the ice, one stage per burst of typing (up to three). Sending breaks it: shards fall behind the line, he shakes himself like a dog, sneezes and rubs himself warm; about one time in four it melts instead, into a puddle that seeps away. Never while Claude works, and no new freezing while music plays. A question from Claude, a usage limit and compacting come first. With reduced motion the ice forms and melts calmly |
| Claude is waiting for you (question, permission) | waves with a question mark, holds up a sign, points at the input, asks with a speech bubble; if the question is open for more than 45 s, he knocks on the input |
| Turn finished or aborted | jumps for joy or shrugs; every 5 successes in a row a trophy or medal; after a long turn (5 min or more) a big "phew" or a finish flag |
| The context window is getting full (70 % and again at 85 %, shown once at the end of the turn) | a box of paper that won't close, or a wobbly paper stack: time for `/compact` or a new chat |
| You are typing | reads along, takes notes, rubs his hands |
| Idle | pastimes by time of day: whistling and a little dance in the morning, juggling, soap bubbles, a flower at midday, calmer in the evening; at night a tea light, counting sheep, stargazing, then sleep |
| Birthday (setting) or New Year's Eve | cake with candles, party hat; fireworks, sparkler |
| Usage limit reached (5-hour or weekly) | 5 h: turns the hourglass, dozes with an alarm clock, spins a top, is annoyed or sad (can't keep working); weekly: sits on a suitcase, goes fishing, tends a potted plant, paints, knits a scarf, builds a sandcastle. After the reset: a jump for joy or a confetti cannon (always plays to the end) |
| Night (default 23:00 to 6:00) | yawns, nods off, sleeps with a nightcap |
| Music is playing in Spotify (needs the [tune-strip](../tune-strip/README.md) mod, Windows only) and he has time (idle, while you type, long waits) | bobs to the beat with little notes, puts on headphones from his bag (takes them off again when the music stops), and, with tune-strip 0.6.0, moves **in time with the song**: he nods on the actual beat and picks his moves by the kind of song, from the sound only. Calm songs: more swaying and bobbing. Groove and hip-hop: a laid-back nod with a finger snap. Hard songs: air guitar and a short headbang (only then, and not when he is grumpy). Sad songs (tune-strip 0.7.0): he waves a lighter, rests his chin on his hand (with a small tear now and then) or sways with his arms crossed. At night he only nods quietly, on every second beat, and does not fall asleep while the music plays. Without a sure beat (older tune-strip, ballads, the first seconds of a song) he bobs at his own fixed tempo |
| You come back after at least 2 h (first input, or the desktop session becomes visible again), at any time of day | gets up or rubs his eyes, then stretches, has a coffee, brushes his teeth, does jumping jacks or waters a flower |
| Claude switches between tools within seconds | at most two animations in a row are cut short; the third one stays at least about 8 s, so he does not flip back and forth; a question for you ("waiting for you") is exempt and usually shows within about 2–4 s; only if two questions come within about 8 s while he is switching quickly can the second take up to about 8 s |
| Mood | Piling errors make him irritable (facepalm, stomping, steam); successes in a row put him in a good mood; long stretches of work make him tired. Everything wears off again. |

| Input | Effect |
|---|---|
| `/clawd` or `/clawd status` | on/off, mood, tiredness, annoyance, the beat from tune-strip (tempo, group, sure or not), one line about the ice (source of the last cold moment, whether the dice were rolled, the result or the planned time, and whether he froze in this chat already); in the desktop app also measurements since the last call (draws per minute, animation length and frame changes, size, compute and drawing time, how often it redrew because the band layout changed or the session was shown again, and how many events needed no redraw) |
| `/clawd on` / `/clawd off` | show or hide him (setting `enabled`) |
| `/clawd list` | all animations by group |
| `/clawd demo <name>` | play one animation, e.g. `/clawd demo type_laptop` (shows him for this session if he was off) |
| `/clawd nap` | sends him to sleep |
| `/clawd boop` | pokes him |
| `/clawd freeze` | freezes him in a block of ice right away (no dice, does not count as the chat's one freeze): type to crack the ice, send to break it |
| `/clawd help` or `/clawd ?` | a table of all commands, the mouse controls, what is on or off right now and your settings with their values (drawn in the terminal and the desktop app, plain text elsewhere) |
| `/clawd flicker` | desktop app only: a 20-second test in two parts (number top left): Clawd is redrawn every 2 s, first as an image (as in normal operation), then in a frame as up to 0.6.5, for comparison; afterwards he continues normally |
| `/clawd language [de\|en]` | switch the language of **all** installed fynn-mods at once (clawd-buddy, cost-ledger, limit-bars, quick-replies, sidekick, tune-strip), one line per mod in the answer; without a value, show each mod's current language. Applies right away: Claude Code reloads each mod it changes. In the desktop app and `claude -p`, where Claude Code lists no plugin settings, it goes through `claude plugin configure` instead (since 0.10.1): saved for the next chat, and right away in the current one after `/reload-plugins` |
| Mouse (terminal): click | giggles; many clicks in a row make him annoyed, then offended |
| Mouse (terminal): drag an arm | the arm follows briefly and snaps back |
| Mouse (terminal): hold the body for ~0.7 s, then drag | he hangs from the pointer, falls when you let go, and walks back |

Runs in: the terminal (half-block pixels, with mouse) and the desktop app's Code tab (as an animated image, without mouse). In `claude -p`, the Agent SDK, VS Code and mobile he draws nothing.

## Configuration

Desktop app: **Settings → Plugins → clawd-buddy → Settings**. Terminal: `/config` → clawd-buddy, or `/plugin configure clawd-buddy`.

| Key | Title | Meaning | Default |
|---|---|---|---|
| `enabled` | Show Clawd | Show or hide him; also `/clawd on\|off` | on |
| `side` | Side | `right` or `left` above the prompt | `right` |
| `reducedMotion` | Reduced motion | Only the base pose and calm variants, no pastimes | off |
| `idleSeconds` | Idle time before pastimes (s) | Seconds without activity before he starts a pastime (10 to 600) | 45 |
| `nightStart` | Night starts (hour) | Hour (0 to 23) from which he gets tired and falls asleep when idle | 23 |
| `nightEnd` | Night ends (hour) | Hour (0 to 23) until which it counts as night; if it is before the start, the night spans midnight | 6 |
| `iceWhenCold` | Ice when the cache is cold | Now and then he freezes in a block of ice while the prompt cache is cold; off: never (`/clawd freeze` still works) | on |
| `birthday` | Birthday (DD.MM.) | Day on which he celebrates with you; empty = off. New Year's Eve is always on | empty (since 0.14.0; before `05.01.`) |
| `language` | Language / Sprache | Language of the mod's texts: `en` English, `de` German; also `/clawd language de\|en` | `en` |

Since 0.14.0 `/clawd on|off` and the settings page change the same setting. In a terminal session the command applies at once (Claude Code reloads the mod). In the desktop app and `claude -p` it applies in the current chat at once and in other open chats after `/reload-plugins` or in the next chat. An on/off value saved by an earlier version is moved over once at the next start. After an update, run `/reload-plugins` in chats that are already open; until then they keep running the old version with its old values.

Known issue: the desktop settings page may show switches that were never saved as on, even when their default is off, and saving the page then turns them on. This plugin stores its off defaults once at the first start, so the page shows them correctly.

## Language

Texts are English by default; set `language` to `de` for German (settings page or `/config` → clawd-buddy → Language / Sprache), or run `/clawd language de` in a terminal session to switch all fynn-mods at once. This covers everything the mod writes: the output of `/clawd` (status, help, list, demo, nap, errors), the animation names and the image's alt text. Clawd himself shows no text. `/clawd demo` finds animations by their English and German names in both languages. Commands and arguments are English either way.

## Rights

`claude plugin validate` shows:

```text
hooks: classic.SessionStart{source=clear|resume|fork}, session.start, session.measure, turn.start, turn.complete, tool.call, tool.check, session.compact, skill.prompt, prompt.edit, ui.message, command.run{command=clawd}, ui.render{component=CommandOutput, props has {command=clawd}}, ui.render{component=AbovePrompt}
calls: $.clock.every, $.clock.now, $.command.register, $.config.list, $.config.set, $.process.run, $.state.get, $.state.set, $.store.get, $.store.set, $.ui.invalidate, $.ui.log, $.ui.resolve
state reads: sidekick.buddy, sidekick.status, tune-strip.beat, tune-strip.playing
state writes: clawd-buddy.band
```

Apart from drawing the `/clawd help` table (see below), all event hooks **only observe** and pass everything through unchanged. No file system, no network, no model calls. The only process is the `claude` CLI (`claude plugin list` / `claude plugin configure`) for `/clawd language` in the desktop app and `claude -p`.

In plain language:

- `$.command.register`: registers the `/clawd` command.
- `$.store.get` / `$.store.set`: stores only the annoyance counter and when you were last around (since 0.14.0 on/off lives in the settings; an old on/off value is moved there once) (one timestamp, written at most every 5 min, for the welcome after a break). The plugin's own storage. Since this version also the key `offDefaults2`: which off switches were already saved as `false` (see the known issue under the settings).
- `$.ui.invalidate`: redraws the band when something changes (turn, tool, typing at most once per second; in the desktop app typing at most every 3 s, plus once before each animation runs out, usually every 15 to 30 s; 2 to 3 times a minute when idle).
- `$.ui.resolve`: fetches the drawing components (Box, Client, Svg).
- Hook `ui.render` on `CommandOutput` (only `/clawd`): draws the answer of `/clawd help` as a table in place of the text. It reads only the reference mark in its own command output; every other output of `/clawd` stays plain text.
- `$.clock.now`: time of day for day/night, waiting times, mood, and the break before the welcome.
- Hook `classic.SessionStart` (only after `/clear`, `/resume`, `/branch`): writes the slot width above again, because those commands reset it. Reads only `source` and, on resume or fork, `prompt_cache_likely_expired` from the event: after `/clear` a new chat begins, which is a cold moment for the ice (since 0.13.0); a resumed or forked chat is a cold moment only if Claude Code reports its prompt cache as likely expired (since 0.13.1).
- Hook `session.measure`: reads only the percentage and reset time of the 5-hour and weekly limits (for the limit animations) and the fill percentage of the context window (for the "context almost full" hint); never the conversation itself.
- `$.clock.every`: a watcher (every 250 ms, no drawing of its own) **only in the desktop app**, while it draws the band and Clawd is on; it asks for the next animation shortly before the current one ends, or shortly before new facts would change what is shown. In the terminal the client ticks on its own.
- `$.ui.log`: error messages to the debug log.
- Hook `session.compact`: notices only that the main conversation is being compacted and when it ends. Never reads the conversation.
- Hook `skill.prompt`: notices only that a skill starts. Never reads the skill's text.
- `$.state.get` (`sidekick.buddy`): reads what the sidekick mod is doing right now (check, question, new chat; since 0.13.0 also hint and upkeep, and the reason of a question as one word such as `cold` or `wrong`), a kind and a timestamp, no texts. Anything unknown is ignored. Without sidekick it stays empty. sidekick does not need to be installed.
- `$.state.get` (`sidekick.status`, since 0.13.0): reads only `level` (off, cache, guide) and `cold` (true while sidekick's own cache estimate has run out), for the ice. Nothing else from this value. Without sidekick, or with `level` off, Clawd estimates on his own.
- `$.state.get` (`tune-strip.playing`): reads only whether the tune-strip mod is playing music right now (true/false), no title or artist. Without tune-strip he never bobs along. Since 0.13.0 also read once at session start, so that he does not freeze while music is already playing.
- `$.state.get` (`tune-strip.beat`, since 0.11.0): reads the tempo, the time of a beat, whether the beat is sure, and the group of the song (calm, groove, hard, sad) from tune-strip; no title or artist. Anything malformed counts as no beat.
- `$.state.set` (`clawd-buddy.band`): publishes only the pixel width of his band slot in the desktop app (400, or null when he is off or in the terminal), so tune-strip can make room. No other data. Written at session start, on `/clawd on|off`, and again right after `/clear`, `/resume` or `/branch` (which reset it).
- `$.config.list`, `$.config.set`: for `/clawd language` (since 0.10.0), which changes nothing but the `language` field of the six fynn-mods, and since 0.14.0 for `/clawd on|off`, which changes only clawd-buddy's own `enabled` field. Other plugins are left alone.
- `$.process.run`: in the desktop app and `claude -p`, for `/clawd language` (since 0.10.1) and for clawd-buddy's own `enabled` field (since 0.14.0: `claude plugin configure clawd-buddy@fynn-mods --values-stdin --json`), and only these commands: `claude plugin list --json` (which fynn-mods are installed and on) and `claude plugin configure <mod>@fynn-mods` with `--json` (read the current language) or `--values-stdin --json` with `{"language":"de"}` or `"en"` for the six fynn-mods, and with this mod's own fields for this mod only. Needs the `claude` CLI on the PATH of the app. It saves the settings of `clawd-buddy@fynn-mods`; if your desktop app loads the mod under another plugin ID (such as `clawd-buddy@inline`), that copy keeps its language. An organization policy that blocks `$.process.run` refuses the whole mod. Since 0.14.5 a settings command reads the value back after saving; if another mod overwrote it at the same moment, it saves once more, otherwise it answers “Not saved”. Once per new off switch (store key `offDefaults2`), the installed copy also reads its own unset fields with `claude plugin configure <mod>@fynn-mods --json` and saves those whose default is off as `false` (see the known issue under the settings). Settings commands save through `claude plugin configure` only when this is the installed copy (its folder is the `readFromFolder` or `installPath` that `claude plugin list` reports); a copy loaded with `--plugin-dir` answers “Not saved: this copy is loaded from another folder …” and changes nothing.

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

- **Desktop app:** The client frame does not load there. The hooks module computes up to the next 30 seconds ahead and sends them as one SVG with SMIL animation, which the app draws as an image (without `isInteractive`). Pastimes with many different frames get shorter animations, down to about 5 s. The band is redrawn only when an event (turn, tool, question, typing) changes what he shows, and shortly before the animation runs out; an event that changes nothing in the current animation does not redraw the band at all. If the band is redrawn for another mod (for example tune-strip, then called spotify, while a song plays: every second up to 0.1.2, every 5 s since 0.2.0), the app starts the SMIL animation from its beginning again. Up to 0.8.0 Clawd passed on the same SVG in that case, so he jumped back to its start and repeated a few seconds. Since 0.8.1 every redraw computes the animation anew from the frame currently on screen (about 5 ms), so a restart shows exactly the frame that was due. `/clawd status` shows how many redraws were only for other mods. Up to 0.6.5 the SVG ran in a script-less frame (`isInteractive`), which went blank for a moment on every new animation, so the figure blinked; an image keeps showing the old picture until the new one is ready. Every redraw of the band makes the app also re-request the rows other mods hook (for example your own messages with sidekick), which made their hover bar flicker in 0.4.1 at about 5 redraws per second. While Claude works, tool calls still redraw the band now and then. No mouse (clicking, dragging) in the desktop app; `/clawd boop|demo|nap` work. The app draws the dark area behind the band itself and it cannot be hidden, so he does not sit quite flush on the input. In very narrow windows the 400 px wide image may be cut off. Since 0.12.1 his 400 px stage lies **behind** the row of the band instead of taking its own room: other mods in the row (such as the wider limit-bars of 0.13.0) no longer push him aside; where they overlap he walks behind them (limit-bars 0.13.1 and tune-strip 0.8.1 or later draw on top). This applies on the right side only: with `side: left`, and while the app shows a survey in the band, he keeps his own place as before.
- **Mouse in the terminal** only works where the terminal delivers mouse events (fullscreen). After a click on the figure it may keep the keyboard focus until you press Esc.
- **After a hidden desktop session is shown again**, Clawd keeps playing without a visible restart (checked in the desktop app with 0.6.12). How the app treats the image while the session is hidden is not documented, so this may change with an app update.
- **After the mod reloads** (settings changed, for example with `/clawd language`, or `/reload-plugins`), his mood, the helpers of running subagents, an open question and the counters in `/clawd status` start over; in the desktop app the current animation starts anew. On/off, the annoyance counter and when you were last around are stored and stay.
- **Mood** is per Claude Code process and is not saved. "Working on the same feature for a long time" is approximated by the time spent working in one stretch (the mod cannot see what the work is about).
- **Ice (since 0.13.0):** No mod event tells whether the prompt cache is cold before you send. With sidekick 0.20.0 or later Clawd uses sidekick's estimate; without it he assumes the cache is cold 60 minutes after Claude's last turn in this process. After a restart or a reload of the mod he does not know that time, so only a new chat counts then. Whether he freezes is decided once per cold moment and kept in memory only: after a reload of the mod (settings changed, `/reload-plugins`) he may roll again in the same chat. In the desktop app typing arrives at most every 3 seconds, so the cracks come in coarser steps. The reasons for sidekick's questions, the hint and the upkeep moments, and sidekick's cold report need sidekick 0.20.0; with an older sidekick he shows the stop sign as before and estimates the cache on his own. Since 0.13.1 a resumed or forked chat (`claude --resume`, `/resume`, `/branch`) uses Claude Code's own estimate whether its prompt cache has expired; if Claude Code does not report it (an older version, or the resumed chat has no answer from Claude yet), the chat counts as a new chat on start and an in-session `/resume` changes nothing, as in 0.13.0.
- **Voice input:** There is no mod event for "recording in progress", and `prompt.edit` only reports a person as the source. Dictated text counts like typing ("reads along"). Dedicated recording animations will follow once Claude Code offers a signal for it.

## Credits

The figure is a fan homage to Clawd, the Claude Code mascot. The pixels are drawn by hand. Laptop typing motion after a reference GIF by Fynn Hansen. This is an unofficial project and is not affiliated with Anthropic.
