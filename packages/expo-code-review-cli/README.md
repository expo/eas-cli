# expo-code-review

A config-driven, multi-agent AI code reviewer. Specialist agents review a diff in
parallel; a coordinator consolidates their findings into one structured review.
Runs the same engine locally (advisory) and in CI (posts a PR comment).

> **Status: experimental.** Phase 1 is **comment-only and non-blocking** — it
> never blocks a merge and never auto-approves. The package is incubated inside
> `eas-cli` for fast iteration and is intended to graduate into its own repo; see
> [`ROADMAP.md`](./ROADMAP.md).

The CLI is the **engine**. Each repo supplies its own agents and settings under
`.expo-code-review/`, so behavior is configured per-repo, not baked in.

## How it works

```
diff source ─▶ noise filter ─▶ chunk ─▶ agents (parallel) ─▶ coordinator ─▶ reporter
(git / gh)     drop lockfiles,  by       each agent reviews    dedupe,        one PR comment
               generated,       changed  every chunk +         re-judge,      (CI) or terminal
               binary files     lines    a cross-cutting pass   decide         output (local)
```

- **Source** — local git (working tree, staged, or a ref range) or a GitHub PR
  (diff + metadata fetched over the `gh` API).
- **Noise filter** — drops lockfiles, generated bundles/maps, snapshots, files
  matching the repo's `additionalIgnores`, and binary files (no textual diff to
  review). Filtered files are recorded, not silently dropped.
- **Chunking** — small PRs run in a single pass; large PRs are split into chunks
  bounded by changed lines, plus one **cross-cutting pass** per agent that looks
  for issues spanning multiple changed files.
- **Agents** — every `.md` file in `.expo-code-review/agents/` is an agent. They
  run in parallel with read-only repo tools (`read`/`grep`/`glob`/`list`).
- **Coordinator** — a single pass that dedupes, re-judges severity, and produces
  the final `{ decision, findings, summary }`.
- **Reporter** — posts/updates a single fingerprinted PR comment (CI), or prints
  a grouped summary (local). Findings below the configured severity floor are
  suppressed.

Built on the [OpenCode](https://opencode.ai) SDK, which spawns the model provider
and applies Anthropic prompt caching automatically.

## Commands

Run via the workspace during incubation (`yarn workspace expo-code-review dev …`),
or as the `ecr` / `expo-code-review` binary once built/installed.

| Command | What it does |
| --- | --- |
| `ecr review [options]` | Review local changes and print an advisory review (default command). |
| `ecr ci` | Review the current GitHub PR and post/update a comment. For GitHub Actions. |
| `ecr init [--with-workflow] [--force]` | Scaffold `.expo-code-review/` (config, agents, prompts) in this repo. |
| `ecr doctor` | Check environment, config, and model credentials. |

### `ecr review` options

```
--base <ref>     Base ref to diff against (default: merge-base with default branch)
--head <ref>     Head ref to diff (default: working tree, incl. uncommitted changes)
--staged         Review only staged changes
--agents <a,b>   Run only these agents (comma-separated ids); default: all
--route          Let an LLM router pick the relevant agents from the diff
--json           Emit machine-readable JSON on stdout
--no-fail        Always exit 0 (otherwise a request_changes decision exits non-zero)
-h, --help       Show help
```

## Configuration — `.expo-code-review/`

```
.expo-code-review/
  config.jsonc        # model, policy, noise, auth, break-glass, comment tag
  shared.md           # instructions prepended to every agent (optional)
  coordinator.md      # the consolidation prompt (required)
  agents/
    correctness.md    # each .md here is an agent (id = filename)
    security.md
    consistency.md
```

`shared.md` and `coordinator.md` are reserved names; every other `.md` in
`agents/` becomes an agent. Per-agent overrides go in each file's frontmatter:

```markdown
---
description: One line the router uses to decide relevance.
alwaysRun: true        # run even when the router would skip this agent
model: anthropic/claude-sonnet-4-5   # override the default model
temperature: 0.1
---

# Agent instructions in Markdown…
```

### `config.jsonc`

```jsonc
{
  "model": "anthropic/claude-sonnet-4-5",     // default model for all agents
  "policy": { "includeSuggestions": false },  // suppress suggestion-severity findings
  "chunk": { "maxChangedLines": 1000, "maxFiles": 20, "concurrency": 4 },
  "noise": { "additionalIgnores": ["packages/*/build/**"] },
  "breakGlass": { "marker": "/skip-review" }, // PR body marker that skips the review
  "commentTag": "expo-ai-code-reviewer",      // hidden tag used to find/update the comment
  "auth": { "mode": "oauth", "provider": "anthropic",
            "tokenEnv": "DO_NOT_USE_EXPERIMENTAL_ANTHROPIC_API_KEY" }
}
```

JSONC (comments + trailing commas) is supported.

## Authentication

Model credentials come from OpenCode. Two modes, set in `config.auth`:

- **`api-key`** — the token in `tokenEnv` is copied into the provider's API-key
  env var (e.g. `ANTHROPIC_API_KEY`).
- **`oauth`** — a Claude Pro/Max token (from `claude setup-token`, an
  `sk-ant-oat…` token, *not* an x-api-key) is written into an isolated OpenCode
  `auth.json` as a bearer credential, so it uses the native subscription path.

Set **`REVIEWER_MODEL`** to override the model for every agent and use your own
OpenCode login instead of the repo's configured credentials — handy locally
(e.g. `REVIEWER_MODEL=openai/gpt-5.4-mini-fast`). There is no shared fallback key;
if a run fails for lack of credentials, authenticate a provider in OpenCode.

Run `ecr doctor` to diagnose setup.

## Reliability

A review must never hang or silently produce nothing:

- **Per-task time caps** — focused chunk passes get 8 min; the cross-cutting pass
  gets 15 min (it legitimately does more work).
- **Soft landing on timeout** — at the cap, the run is interrupted and the agent
  is asked to return the findings it already has, rather than discarding its work.
- **No retry on a timeout** — retrying just repeats a non-convergent run; the task
  is abandoned instead. (Parse failures *are* retried — first in the same session,
  then once in a fresh one.)
- **Coverage notes** — if any pass is cut short or skipped, the review output says
  so, so a partial review is never presented as complete.

## CI usage

`ecr init --with-workflow` scaffolds a `pull_request` workflow. In this repo the
reviewer runs via two workflows:

- **`expo-code-review.yml`** — auto-reviews a PR on every push, gated on the
  `ai-review` label (continuous mode).
- **`expo-code-review-command.yml`** — maintainer comment commands:
  - `/review` — run now (router picks agents) and enable continuous review
  - `/review all` — run now with every agent
  - `/review correctness security` — run now with just those agents
  - `/review-once [agents…]` — run once; do **not** enable continuous review

Both are comment-only and never fail the PR's checks. For security, the command
workflow builds/runs only the trusted base ref (never the PR head) — see the
comment at the top of that file.

## Run logs

Each run appends a JSON line to `.expo-code-review/.runs/reviews.jsonl` with the
inputs, decision, finding count, duration, per-agent cost, and aggregate token
usage (including prompt-cache read/write counts) — for auditing and measuring
cost/latency/cache reuse over time.
