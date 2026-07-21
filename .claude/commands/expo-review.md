---
description: Run the local AI code reviewer (correctness + security agents, consolidated) on your working changes and summarize the findings.
argument-hint: "[--staged | --base <ref> --head <ref>]"
allowed-tools: Bash(yarn:*), Bash(bun:*), Bash(node:*), Bash(cd:*)
---

Run this repo's AI code reviewer and report its findings. It never touches
GitHub — it reads local git state and prints an advisory review. The engine lives
in `packages/expo-code-review-cli`; this repo's agents live in `.expo-code-review/`.

1. Run the reviewer (JSON mode so you can parse it):

   ```
   yarn workspace expo-code-review dev review --json $ARGUMENTS
   ```

   - It diffs the working tree (or the range in `$ARGUMENTS`), runs the agents
     defined in `.expo-code-review/config.jsonc` in parallel, and consolidates
     them into `{ decision, findings[], summary }`.
   - Model credentials come from the developer's OpenCode config. If the run
     fails for lack of credentials, tell the user to authenticate a provider in
     OpenCode and set `REVIEWER_MODEL` (e.g. `openai/gpt-5.4-mini-fast`) — there
     is no shared fallback key.
   - If setup looks off, `yarn workspace expo-code-review dev doctor` diagnoses it.

2. Present the result grouped by severity (critical → warning → suggestion), each
   with `file:line`, the rationale, and any suggested fix. Lead with the
   `decision` and `summary`.

3. Treat the decision as advisory only — phase 1 never blocks or approves. A
   non-zero exit code means `request_changes` (unless `--no-fail`).
