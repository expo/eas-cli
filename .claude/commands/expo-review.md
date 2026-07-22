---
description: Run the local AI code reviewer on your working changes and summarize the findings. Optionally pick which agents run.
argument-hint: "[all | <agent...>] [--staged | --base <ref> --head <ref>]"
allowed-tools: Bash(yarn:*), Bash(bun:*), Bash(node:*), Bash(cd:*)
---

Run this repo's AI code reviewer and report its findings. It never touches
GitHub — it reads local git state and prints an advisory review. The engine lives
in `packages/expo-code-review-cli`; this repo's agents live in `.expo-code-review/`.

First interpret `$ARGUMENTS`:

- **Bare words** naming agents (they match files in `.expo-code-review/agents/`,
  e.g. `correctness`, `security`, `consistency`) → run only those. Pass them as
  `--agents <comma,separated>`.
- **`all`** or **no agent words** → run every agent (omit `--agents`).
- **`--flags`** (`--staged`, `--base <ref>`, `--head <ref>`, `--json`,
  `--no-fail`) → pass through unchanged.
- (There is no once-vs-continuous distinction locally; a local run is always
  one-shot. That only matters for CI.)

Then run (adding `--agents …` only when specific agents were named):

```
yarn workspace expo-code-review dev review --json [--agents <ids>] [passthrough flags]
```

Notes:
- It diffs the working tree (or the range in the flags), runs the selected agents,
  and consolidates into `{ decision, findings[], summary }`.
- Model credentials come from the developer's OpenCode config. If the run fails
  for lack of credentials, tell the user to authenticate a provider in OpenCode
  and set `REVIEWER_MODEL` (e.g. `openai/gpt-5.4-mini-fast`) — there is no shared
  fallback key.
- If setup looks off, `yarn workspace expo-code-review dev doctor` diagnoses it.

Then present the result grouped by severity (critical → warning → suggestion),
each with `file:line`, the rationale, and any suggested fix. Lead with the
`decision` and `summary`. Treat the decision as advisory only — phase 1 never
blocks or approves; a non-zero exit code means `request_changes` (unless
`--no-fail`).
