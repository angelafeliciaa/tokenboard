# @tokenboard/cli

A leaderboard for your agentic-coding token usage — race your friends, not strangers.

> **Status:** early release. `npx @tokenboard/cli` previews locally with no
> login; `claim` + `sync` land you on the public board at
> [tokenboard.sh](https://tokenboard.sh).

```bash
npx @tokenboard/cli            # local preview: your token usage + a rough $ estimate
tokenboard claim               # sign in with GitHub and claim this machine
tokenboard sync                # push usage now
tokenboard service install     # sync once a day in the background
tokenboard show-data           # dry-run: exactly what a sync would upload
```

## What it does today

- Parses your local **Claude Code** session logs (`~/.claude/projects`) and shells
  out to [`ccusage`](https://github.com/ryoppippi/ccusage) for the long tail (Codex,
  Gemini, Goose, …) — **counts only**, never prompts, code, or file paths.
- Prints your total tokens and a **labeled `~$` estimate** computed offline from a
  bundled [LiteLLM](https://github.com/BerriAI/litellm) price snapshot. The estimate
  is cosmetic — the server is authoritative once syncing exists.

## Privacy

The bare `npx @tokenboard/cli` preview runs **fully offline** — nothing is uploaded
and no account is created. Only after you `claim` + `sync` (manually or via the daily
`service`) does it upload **aggregate token counts** per `(day, tool, model)` — never
prompts, code, file paths, or repo names. Run `show-data` to see the exact payload first.

MIT licensed. Credits [ccusage](https://github.com/ryoppippi/ccusage) and
[LiteLLM](https://github.com/BerriAI/litellm) — see `NOTICES.md`.
