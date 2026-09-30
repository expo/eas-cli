---
description: Run the local AI code reviewer on your working changes or a specific GitHub PR, summarize the findings here, and optionally post them to the PR. Optionally pick which agents run.
argument-hint: "[all | <agent...>] [<pr-number-or-url>] [--post] [--staged | --base <ref> --head <ref>]"
allowed-tools: Bash(npx:*), Bash(bun:*), Bash(node:*), Bash(cd:*)
---

Run this repo's AI code reviewer and report its findings. It prints an advisory
review; it only touches GitHub if you explicitly ask it to post. The engine is the
published `@expo/code-review-cli` package (run via `npx`); this repo's agents live
in `.expo-code-review/`.

First interpret `$ARGUMENTS`:

**Which changes to review (pick the one that matches):**
- **A PR number** (e.g. `4057`) or a **PR URL** (e.g. `https://github.com/expo/eas-cli/pull/4057`)
  → review that PR by number: pass `--pr <n>` (extract `<n>` from the URL's
  `/pull/<n>`). This fetches the PR diff via `gh` — no checkout needed. Do NOT
  combine with `--staged`/`--base`/`--head`.
- **`--staged`, `--base <ref>`, `--head <ref>`** → local review of that range,
  passed through unchanged.
- **Otherwise** → local review of the working tree (the default).

**Which agents:**
- **Bare words** naming agents (match files in `.expo-code-review/agents/`, e.g.
  `correctness`, `security`, `consistency`) → run only those: `--agents <comma,separated>`.
- **`all`** → run every agent (pass neither `--agents` nor `--route`).
- **No agent words** → let the router pick: pass `--route`.

**Posting (outward-facing — default is OFF):**
- By default, **only preview here — never pass `--post`.**
- Add `--post` **only when the user explicitly asks to post/publish to the PR**
  (and only with `--pr`). This upserts the reviewer's single PR comment.
- Good practice: preview first (no `--post`), show the user, and add `--post` on a
  follow-up run only after they approve.

Then run (adding flags only as interpreted above):

```
npx --yes -p @expo/code-review-cli ecr review --json [--pr <n>] [--agents <ids>] [--post] [other flags]
```

(If you're developing the CLI itself, run your local build instead:
`node ~/code/expo-code-review-cli/build/cli.js review …`.)

Notes:
- `--pr` uses the PR's diff (authoritative) but reads your checked-out files for
  surrounding context. For full fidelity on a PR, suggest `gh pr checkout <n>`
  first and then a plain local review.
- Model credentials come from the developer's OpenCode config. If the run fails
  for lack of credentials, tell the user to authenticate a provider in OpenCode
  and set `REVIEWER_MODEL` (e.g. `openai/gpt-5.4-mini-fast`) — there is no shared
  fallback key. `--post` additionally needs `gh` authenticated.
- If setup looks off, `npx --yes -p @expo/code-review-cli ecr doctor` diagnoses it.

Then present the result grouped by severity (critical → warning → suggestion),
each with `file:line`, the rationale, and any suggested fix. Lead with the
`decision` and `summary`, and surface any coverage note (passes that were cut
short). Treat the decision as advisory only — the reviewer never blocks or
approves; a non-zero exit code means `request_changes` (unless `--no-fail`). If you
posted, confirm the PR it was posted to.
