# Security policy

## Supported versions

Only the latest version of each mod gets security fixes. `claude plugin marketplace update fynn-mods` followed by
`claude plugin update <mod>@fynn-mods` brings a mod up to date; `/plugin` shows the installed version.

## Reporting a vulnerability

**Please don't open a public issue.** Report privately via GitHub:
[**Report a vulnerability**](https://github.com/FynnXland/fynn-mods/security/advisories/new) (also on the *Security*
tab).

Please include the mod and its version, `claude --version`, terminal or desktop app, the impact, steps to reproduce
(ideally a minimal proof of concept), and whether you'd like to be credited. Leave out real personal data, even in a
private report.

fynn-mods is maintained by one person in their spare time; expect an acknowledgement within 7 days. Once a fix is
released, the advisory is published and you are credited if you wish.

## What a mod can do

A mod runs inside the Claude Code process with your permissions; there is no sandbox. That is why every mod here
declares the events it hooks into and the API calls it makes, `claude plugin validate mods/<mod>` prints that list, and
each mod's README explains what they are for. These declarations and what the code does with them are the scope of this
policy:

- **Holding back or sending messages:** sidekick, limit-bars, worklist and quick-replies can hold a message back or
  send one in your name, as their READMEs describe (for example only after your choice in a dialog, or after a to-do
  check passes). A message sent or changed without that condition is a vulnerability.
- **Model calls on your account:** sidekick, worklist, quick-replies (`/replies more on`) and limit-bars (`/keepwarm`).
  What they send is listed in each README; anything beyond that is in scope.
- **Running commands:** sidekick and limit-bars run Claude Code commands only on your click or choice, from the set
  described in their READMEs; worklist runs a to-do that starts with `/name` as that command.
- **Processes:** only limit-bars, only with `storagePath` set, starts Windows PowerShell with two fixed, read-only
  scripts. The drive path is passed as an environment variable, never as part of the script.
- **Stored data:** each mod keeps its data in its own plugin store, a JSON file under `~/.claude/plugins/store/` on
  your machine. No mod has network access of its own, and none reads or stores login data or tokens.

## Out of scope

- Vulnerabilities in Claude Code itself or in its mods API (report them to Anthropic)
- Behavior that a mod's README documents and that needs your own choice, such as level `auto` in sidekick
- Attacks that require an attacker who already controls your user account or your Claude Code configuration
