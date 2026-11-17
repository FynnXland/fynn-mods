# Third-party notices

sidekick's own features are original work. Its cache logic in `hooks/cache.ts` (cache states, TTL measurement, price
table and cost estimates) is a copy of the cache logic of limit-bars, which is modeled on **Cache Keeper** from Nate
Herk's `claude-code-mods`.

Since 0.22.0 the handoff (`/handoff`, the skill `skills/write-handoff/SKILL.md` and `handoffSystem` in `hooks/logic.ts`) keeps parts
of the structure of Cache Keeper's `session-handoff` skill (it came over from limit-bars). A few ideas of the template (a
section for the user's constraints, "ruled out", verified/unverified, nothing from AGENTS.md, separating facts from
guesses) come from OpenCode (MIT) and Cline (Apache-2.0); they are reworded, no text was taken over.

## Bundled skills (since 0.25.0)

`skills/apple-design/`, `skills/emil-design-eng/` and `skills/break-ui/` (with its `CATALOG.md`) are copies of skills by
**Emil Kowalski** from [emilkowalski/skills](https://github.com/emilkowalski/skills) at commit
`5206a950b715e0cabe7043ea0b2304332b91494e` (checked 2026-11-09), licensed under the MIT License (SPDX `MIT`, read from the
GitHub API). The only change is in the frontmatter of each `SKILL.md`: a comment line naming the source and
`disable-model-invocation: true`, so Claude never loads them on its own and their descriptions stay out of the context.
Each folder carries the original `LICENSE` file (Copyright (c) 2026 Emil Kowalski). sidekick only reads these files; it
runs no code from them.

## References

The other entries of the skill catalog (`hooks/catalog.ts`) are references only: name, author, license, source URL and
the install line from the source's README. Nothing of them is copied or installed by sidekick. When the original of a
reference is installed, sidekick can start it with the user's message (`$.command.run`, only after a click).

Until 0.30.0 sidekick also bundled copies of `systematic-debugging`, `verification-before-completion` and
`receiving-code-review` (obra/superpowers, MIT, Copyright (c) 2025 Jesse Vincent), `fixing-metadata` (ibelick/ui-skills,
MIT, Copyright (c) 2026 Julien Thibeaut) and `grilling` (mattpocock/skills, MIT, Copyright (c) 2026 Matt Pocock). Since
0.31.0 the first three and `grilling` are references to the originals; `fixing-metadata` is no longer in the catalog,
because its README names no install line for Claude Code. Thanks to the authors.

## Cache Keeper

Cache Keeper is licensed under the MIT License:

```text
MIT License

Copyright (c) 2026 Nate Herk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
