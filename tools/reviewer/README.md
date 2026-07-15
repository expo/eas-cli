# AI code reviewer (phase 1)

A minimal two-agent AI code reviewer for `eas-cli`. It runs a **correctness &
code-quality** reviewer and a **security & secrets** reviewer in parallel,
consolidates their findings through a **coordinator**, and reports one structured
review. See [`opencode-reviewer-phase-1.md`](../../) for the full spec.

It runs in two modes off the same core (`src/core.ts`):

- **CI mode** (`src/entrypoints/ci.ts`) — triggered by a PR, posts one comment.
  Comment-only: never blocks a merge, never auto-approves.
- **Local mode** (`src/entrypoints/cli.ts`) — runs against your working tree or a
  ref range, prints to the terminal, no GitHub involvement.

## Isolation

This tool is **Bun**-based and fully separate from eas-cli's yarn/lerna toolchain:
its own `package.json` and dependencies, excluded from the root oxlint/oxfmt/
tsconfig, and it never imports from `packages/` — it only reads the repo as text.

## Local usage

Run from the repo root (the tool chdirs to the git root automatically):

```bash
cd tools/reviewer && bun install        # first time only

# review uncommitted working-tree changes vs the merge-base with the default branch
bun run --cwd tools/reviewer review

# only staged changes
bun run --cwd tools/reviewer review --staged

# an explicit range
bun run --cwd tools/reviewer review --base main --head HEAD

# machine-readable output
bun run --cwd tools/reviewer review --json
```

Exit codes: `0` approve / approve-with-comments, `1` request-changes
(overridable with `--no-fail`), `2` error.

Model credentials come from your own environment / OpenCode config (e.g.
`ANTHROPIC_API_KEY`). Override the model for every agent with `REVIEWER_MODEL`
(e.g. `REVIEWER_MODEL=anthropic/claude-sonnet-4-5`). There is no shared fallback
key — if none is configured the run fails with a clear message.

## Run logs

Every run appends a JSON line to `tools/reviewer/.runs/reviews.jsonl` (inputs,
filtered files, findings, decision, cost, duration) and writes its per-file patch
workspace under `tools/reviewer/.runs/<runId>/`. The `.runs` directory is
gitignored.
