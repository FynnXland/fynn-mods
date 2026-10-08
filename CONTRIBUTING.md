# Contributing to fynn-mods

Thanks for taking a look. fynn-mods is a one-person hobby project, so here is what helps most and how it works.
English and German are equally welcome, in issues and in pull requests.

- **Bug reports and ideas:** open an [issue](https://github.com/FynnXland/fynn-mods/issues/new/choose). The forms ask
  for what's needed to reproduce a problem.
- **Pull requests:** please open an issue first and wait for a reply before you start on a larger change. Small fixes
  (a typo, a wrong command in a README) are fine without one.
- **Security problems** never go into a public issue; see [SECURITY.md](SECURITY.md).

## How changes get published

The mods are developed in the maintainer's own working copy and published to this repository from there. An accepted
pull request is therefore usually applied there by hand and comes out with the next version of the mod, with you
credited as co-author in the commit. Don't be surprised if your pull request is closed with a link to that commit
instead of being merged.

## Setup

You need Claude Code v2.1.287 or later (`claude --version`); mods run in the terminal and in the Code tab of the
desktop app. There is nothing to install: Claude Code runs the TypeScript hooks itself.

```bash
git clone https://github.com/FynnXland/fynn-mods.git
cd fynn-mods
claude --plugin-dir mods/<mod>
```

The mod loads from your clone and reloads when you save a file. If you have the same mod installed from the
marketplace, the clone replaces it for that session.

Each time Claude Code loads a mod this way, it writes type definitions for your Claude Code version into
`mods/<mod>/.claude-plugin/types/` (ignored by git). They are the reference for events and API calls when they
disagree with any documentation. The [mods documentation](https://code.claude.com/docs/en/plugins/mods/overview)
explains the rest.

## Checks

Run both for every mod you change:

```bash
claude plugin validate mods/<mod> --strict
claude plugin test mods/<mod>
```

The same checks run on GitHub for every pull request and every push to `main`. `validate` prints the mod's `hooks:` and
`calls:` lines. The tests live in `mods/<mod>/tests/` and use Claude Code's
test kit (`claude-code/testing`), so they run without a real session, model calls or network. New behavior needs a
test; a bug fix needs a test that fails without the fix. If your change draws something, check it in the terminal and
in the desktop app, or say which one you couldn't test.

## Conventions

- **Hooks module:** `hooks/register.ts`, ES modules, only relative imports and `claude-code`. Everything a mod does
  goes through the mods API.
- **Rights:** if your change adds a hook or an API call, the `hooks:` / `calls:` lines change. Each mod's README has a
  section that explains every entry in plain language; update it in the same pull request.
- **Language:** every text a user sees exists in English and German (the `language` option); READMEs and descriptions
  are in English.
- **Version and release notes** are the maintainer's job. In the pull request, describe in one or two sentences what
  changes for users.
- **New dependency or borrowed code:** mods bundle no packages. If you reuse code from elsewhere, name it and its
  license in the pull request; it goes into the mod's `THIRD-PARTY-NOTICES.md`.

## Privacy

Everything committed here is public for good. Never commit API keys or tokens, your user name in paths, real chat
content, or screenshots of your own sessions. Use invented sample data in tests and screenshots.

## AI agents

The mods are built with the help of Claude Code. You're welcome to use AI tools too; you are responsible for what you
submit and for having checked it.

## License

Unless you explicitly state otherwise, any contribution you submit for inclusion in this project is licensed under the
[MIT License](LICENSE), without additional terms or conditions.
