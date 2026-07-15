---
description: Run the local AI code reviewer (correctness + security agents, consolidated) on your working changes and summarize the findings.
argument-hint: "[--staged | --base <ref> --head <ref>]"
allowed-tools: Bash(bun:*), Bash(cd:*)
---

Run this repo's local AI code reviewer and report its findings. It never touches
GitHub — it reads local git state and prints an advisory review.

1. Run the reviewer (JSON mode so you can parse it):

   ```
   cd tools/reviewer && bun run review --json $ARGUMENTS
   ```

   - It diffs the working tree (or the range in `$ARGUMENTS`) and runs a
     correctness reviewer and a security reviewer in parallel, then consolidates
     them through a coordinator into `{ decision, findings[], summary }`.
   - First run in a fresh checkout may need `bun install` in `tools/reviewer`.
   - Model credentials come from the developer's own OpenCode config. If
     `REVIEWER_MODEL` is set it overrides the model for every agent; otherwise the
     default in `tools/reviewer/opencode.json` is used. If the run fails for lack
     of credentials, tell the user to authenticate their provider in OpenCode and
     set `REVIEWER_MODEL` (e.g. `openai/gpt-5.4-mini-fast`) — there is no shared
     fallback key by design.

2. Present the result grouped by severity (critical → warning → suggestion), each
   with `file:line`, the rationale, and any suggested fix. Lead with the
   `decision` and `summary`.

3. Treat the decision as advisory only — phase 1 never blocks or approves. Note
   that a non-zero exit code means `request_changes` (unless `--no-fail`).
