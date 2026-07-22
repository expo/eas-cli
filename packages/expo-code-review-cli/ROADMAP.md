# expo-code-review — roadmap / next steps

Working notes for the experimental reviewer. This package is incubated in
`eas-cli` for fast iteration and is intended to graduate into its own repo. Items
are roughly ordered by priority.

## Recently shipped

- Auto-discovered agents from `.expo-code-review/agents/*.md` + frontmatter.
- Adaptive-hybrid chunking (per-chunk + cross-cutting pass), chunk retry.
- LLM router (`--route`) and comment-command rollout (`/review`, `/review-once`).
- Noise filtering (lockfiles, generated markers, repo `additionalIgnores`).
- **Binary-diff blind-spot fix** — the parser now flags `Binary files … differ`
  entries and noise-filters them instead of handing agents an empty patch; and
  `noise.ts` no longer stashes a literal NUL byte as a glob sentinel (which had
  made git classify that source file as binary, hiding it from every reviewer).
- **Command-workflow hardening** — `expo-code-review-command.yml` no longer
  `gh pr checkout`s the PR head; it builds/runs only the trusted base ref. See
  "Reliability & security" below for the residual work.
- **Failure-path hardening (audit 2026-07-22)** — a failed/timed-out run never
  renders as a clean "Approve"; the coordinator has its own 5-min cap +
  soft-landing and a deterministic local-merge fallback (a coordinator hiccup no
  longer discards all findings); CI always posts a terminal state on failure;
  coverage notes now include filtered (binary/generated/ignored) files; the
  per-task retry explosion (up to ~9 model runs/task) was removed.
- **Cross-cutting collapsed to ONE combined pass** (was one per agent — 3
  redundant full-diff passes), the biggest large-PR latency win.
- **Cross-file pass no longer wanders the whole repo** — the collapsed pass ran
  under an *undefined* agent id, so OpenCode fell back to a default agent with
  full tools and it crawled unrelated packages until its 15-min cap (contributing
  nothing). Now defined as a real agent with a restricted tool set (`read`+`grep`,
  no `glob`/`list` crawling), so it converges instead of burning its budget.
- **Speed knobs** — longest-processing-time-first task scheduling;
  `maxChangedLines` 1000→1500, `concurrency` 4→6; CI job timeout 20→30 min (so the
  worst-case internal cap chain fits with headroom).
- **Inlined chunk diffs** — the reviewer task now embeds the assigned files' diffs
  (fenced as untrusted) instead of making the agent `read` each patch file, cutting
  per-pass tool round-trips. (Other files + cross-cutting still read on demand.)
- **Extended caps** — chunk 8→15m, cross-cutting 15→25m, coordinator 5→10m, CI job
  30→50m (kept the invariant: worst-case serial chain < job timeout). Gives
  slow-but-progressing passes room to converge instead of finalizing partial;
  cost is longer max runs + more tokens. Still model-generation-bound on the
  largest PRs — see §3 size guard / faster-model levers.

## 1. Post a real PR review with inline comments (not one bottom comment)

Today the reporter posts a single consolidated issue comment. Move to a formal
review (`POST /pulls/{n}/reviews`) so findings land on the diff where the reader
is — matching what the Claude GitHub bot does.

Design:
- `event: COMMENT` (never `REQUEST_CHANGES`/`APPROVE`) to stay non-blocking in
  phase 1.
- Review **body** carries `decision` + `summary` + any finding whose `file:line`
  is not part of the diff (GitHub rejects inline comments off the diff). This is
  also the home for cross-cutting findings (e.g. a CI/workflow supply-chain
  issue that reasons across files).
- Findings whose `file:line` IS in the diff become inline comments, each with an
  embedded per-comment fingerprint (`<!-- ecr-fp:… -->`) so re-runs update in
  place instead of duplicating — same idea as today's single-comment fingerprint,
  applied per thread.
- Graceful fallback: any finding that fails to anchor inline drops into the body
  list rather than erroring the whole post.
- Keep the existing single-comment reporter as a fallback path / for hosts
  without a PR context (local runs already print, don't post).

Open question: dedup/cleanup of stale inline threads across pushes (resolve vs.
leave). The bot leaves them; simplest is to leave + update-by-fingerprint.

## 2. Unblocked integration (institutional context)

Prior research (see conversation + memory). The `unblocked` MCP/CLI exposes:
`context_get_rules` (structured repo rules w/ severity/task/paths),
`context_research` (why/who/when synthesis), `context_get_urls`.

- **Mode A (recommended first step, low-risk):** at review start, call
  `context_get_rules` for the repo and inject the returned rules into the
  `shared.md` / consistency-agent prompt as additional, authoritative
  conventions. Cheap, deterministic, directly improves the `consistency` agent.
- **Mode B (later):** give agents a research tool (wire `context_research` as an
  OpenCode tool) so they can pull the *why* behind a changed area on demand.
  More powerful, but adds latency + nondeterminism and a network dependency in
  CI — gate behind config and a timeout.
- Prereq: Unblocked auth in CI. Interactive-auth MCP servers may be absent in
  headless runs; needs a service token or a documented skip.

## 3. Reliability & security — "never hang / never silently fail"

Motivating incident: on the 49-file self-PR the review step ran ~28 min and was
killed. Root cause (confirmed from the run log, NOT rate-limiting): the 4 chunk
passes and two of the three cross-cutting passes completed fine; the single
`correctness [cross-file]` pass never converged. `buildCrossCuttingTask` lists
all changed files and lets the agent "read the surrounding source as needed" with
`read`/`grep`/`glob`/`list` over the whole repo, so on a 49-file diff it wandered
the entire monorepo (even unrelated packages) and could not emit its JSON within
the 8-min per-attempt cap. **Retry-on-timeout then made it 3× worse**: each retry
restarts the same unbounded wander (8 min × 3 = 24 min on that one task). There is
also **no global wall-clock budget**, so nothing bounded the total.

Guarantees (priority order; ✅ = shipped in the 2026-07-22 audit follow-up):

1. ✅ **Don't retry on timeout**, and removed the per-task 3× retry wrapper (it
   compounded with promptAndParse's internal retries into ~9 runs/task).
2. ✅ **Bound the cross-cutting pass** — collapsed to one combined pass and
   tightened its prompt to stay within the changed files. *(Still open: split/skip
   above a hard size threshold — see "size guard" below.)*
3. ✅ **Always post a result** — a failed run reports "could not complete"; CI
   posts a terminal state on any failure; the coordinator has a deterministic
   fallback so its failure can't discard findings; and a failed/timed-out run
   never renders as a clean "Approve".
4. **Global time budget.** *(Open — deprioritized.)* We now use per-task caps +
   an aligned job cap instead (per-task caps: chunk 15m, cross-cutting 25m,
   coordinator 10m; CI `timeout-minutes: 50`). A single `maxTotalMs` that stops scheduling
   new work when exhausted is still a cleaner backstop.
5. **Size guard / degraded mode.** *(Partial.)* Filtered files now appear in the
   coverage note. Still open: a hard "diff too large → skip / review only the
   highest-signal subset" ceiling.
6. ✅ **Bound the coordinator** — 5-min cap + soft-landing + deterministic fallback.
7. ✅ **Concurrency** default raised 4→6 (quality-neutral within rate limits).
8. **Publish + run via `npx` (both workflows).** The `init` template already runs
   the *published* package via `npx` (only the diff is PR-controlled) — strictly
   safer than our in-repo workflows that `yarn build` from source. Once published,
   switch both in-repo workflows to the published binary and stop building from a
   checkout. Also revisit the `pull_request` auto-workflow: it builds/runs the PR
   merge ref; fork PRs are protected (GitHub withholds secrets) but same-repo PRs
   run with secrets — acceptable for now (push access implies trust + label gate),
   but the npx switch removes the concern entirely.

## 4. Caching (LLM cost / quota / latency)

Investigated 2026-07-21. Baseline finding: **OpenCode already applies Anthropic
prompt caching automatically** — the installed binary (1.18.1) adds
`cacheControl: {type: "ephemeral"}` (5-min TTL, hardcoded) to the first 2 system
messages and the last 2 non-system messages on every anthropic/bedrock/openrouter
request. So the expensive part — the per-session tool loop resending the whole
conversation each turn — is already incrementally cached; we should not add
`cache_control` markers ourselves. Under Claude Max OAuth, caching buys **quota
headroom and latency**, not dollars (`cost` is ~0 there anyway).

**Quality impact:** prompt caching replays byte-identical prefix tokens — the
model's output is unchanged, so items 1–3 below are quality-neutral by
construction (item 2 is arguably a small recall *gain*). Item 4 is the only one
that trades quality for cost — treat it as a product decision, not just an
engineering task.

What's left is at our layer, in suggested order:

1. **Log cache metrics (measure first).** OpenCode's assistant message info
   carries `tokens: {input, output, reasoning, cache: {read, write}}`; we already
   poll that object in `promptAgent` but only extract `cost`. Add `tokens` to
   `PromptResult` and the `.runs/reviews.jsonl` record. This also answers an open
   question we couldn't settle statically: whether our per-prompt `system` param
   lands inside OpenCode's "first 2 system messages" breakpoints (cross-session
   prefix reuse) or outside them.
   - *Caveat:* the `tokens` object likely reflects the most recent model request
     in the tool loop, not the cumulative session total — verify how OpenCode
     accumulates it before reading it as a per-task total. Fine either way for
     answering the breakpoint-placement question.
2. **Retry in the same session, not a fresh one.** `promptAndParse` retries a
   JSON-parse failure by replaying `text + CORRECTIVE` in a **new session**,
   discarding the first attempt's entire tool-call context (all the patch reads).
   Sending the corrective as a follow-up message in the same session makes the
   prior conversation a cache read and the model already holds the file context —
   cheaper, and better for recall: today's fresh-session retry re-investigates
   from scratch and may do so less thoroughly, whereas the common failure
   (truncated/malformed JSON after a sound investigation) just needs a clean
   re-emit. Shape: same-session for the first corrective retry, fresh session as
   the last resort (clean slate for a genuinely confused attempt). Timeouts stay
   fresh-session (we abort the stalled one — and see reliability item: don't
   retry timeouts at all).
   - *Implementation trap:* `promptAgent`'s poll loop returns "the last assistant
     message with a completed timestamp" — after a follow-up prompt, the first
     attempt's message is already completed and would be returned instantly as
     stale text. The retry path must snapshot existing message IDs and wait for a
     *new* assistant message.
   - *Verify:* whether re-sending the `system` param on a follow-up prompt
     appends a duplicate system message (perturbing the cached prefix).
3. **Interleave tasks chunk-major, not agent-major (contingent on #1).** A cache
   entry is readable only after the first response starts streaming, so N
   parallel same-prefix requests all pay full write price. Tasks are currently
   built agent-major, so the first concurrency-4 wave is often 4 identical-prefix
   requests for one agent. Chunk-major order (agent 1 chunk 0, agent 2 chunk 0,
   …) writes each agent's prefix once and lets its later chunks read it.
   - *May be worth ~nothing:* most PRs fit in one chunk (`maxChangedLines:
     1000`), so there's one task per agent and ordering changes nothing; and the
     benefit assumes the agent-specific system prompt is inside OpenCode's
     first-2-system-messages breakpoints — if it lands third, the only reusable
     prefix is the base prompt + tools, identical across all agents regardless of
     order. Do this only if #1's measurements show agent-prefix reuse is real.
4. **Result-level caching across runs (biggest saver; the one with a real
   quality cost).** The 5-min server-side TTL means Anthropic's cache is cold by
   the next push to a PR, but most chunks are usually unchanged. Cache reviewer
   output keyed by `(agent id, model, prompt-version hash, chunk content hash)` —
   hash the patch *contents* + file list, not paths (patch paths embed the
   timestamped `runId`). On re-review, unchanged chunks reuse prior findings.
   Persist under `.runs/` locally; in CI needs `actions/cache` or an artifact
   keyed by PR number. Two design problems to settle **before** building:
   - *Chunk boundaries are unstable.* Chunking is greedy by changed lines over
     the whole file list, so one modified file in a new push can reshuffle every
     downstream chunk → different hashes → cache miss on everything. Needs either
     per-file caching (murky finding attribution — findings are per-chunk) or
     deterministic chunk assignment that's stable under small edits.
   - *Findings depend on more than the chunk — this is the recall trade.*
     Reviewers read the surrounding repo, and sibling changes can invalidate an
     "unchanged" chunk's conclusions (push 2 changes a signature in chunk B;
     chunk A's byte-identical caller reuses its cached "no findings"; the pass
     that would have caught the broken call never runs). Mitigations: always
     rerun the cross-cutting pass (the backstop — but it only exists on
     multi-chunk diffs and is currently the least reliable pass; see
     reliability); consider reusing only when the *rest* of the PR is also
     unchanged (rebase / comment-only push — safer, reuses less). Including base
     SHA in the key kills nearly all reuse; excluding it accepts staleness.
     Since the tool's value proposition is recall, decide how much staleness a
     re-review may tolerate before implementing.

Not worth pursuing: 1-hour TTL (hardcoded in OpenCode's transform, and cross-run
prompt caching is low-value since diff content dominates); padding prompts for
cacheability (tool schemas + base prompt + system already clear Sonnet 4.5's
1024-token minimum); router-call caching (one small call per run).

## 5. Improving the review process to catch bugs like #1 / #2 in the future

The Claude bot caught two things we missed. Why, and what to change:

**#1 — critical CI supply-chain (issue_comment + secrets RCE).** We missed it
partly because our only completed run predated that workflow (later runs stalled),
and partly because our `security` agent is primed for code-level vulns, not
GitHub-Actions threat modeling. Improvements:
- Add an explicit **CI/workflow-security** checklist to `security.md` (or a
  dedicated agent): trigger fork-restriction semantics (`pull_request` vs
  `issue_comment` vs `workflow_run`), `gh pr checkout` + secrets, `permissions:`
  scope, unpinned actions, install-time script execution, `pull_request_target`.
- Treat any change under `.github/workflows/**` as **always-review** (bypass
  chunking/routing so a workflow file is never the file that got skipped) and
  raise its severity floor.
- Never trust PR-description claims of mitigation (already policy) — verify which
  workflow a "mitigated for forks" note actually applies to.

**#2 — binary/NUL blind spot.** This was a *structural* miss: git marked the file
binary, our parser handed agents an empty patch, so the reviewer literally could
not see the file with the bug. The bot found it by doing its own working-tree
archaeology (`git show`/`od`), not by trusting the unified diff. Improvements:
- **Fixed** the immediate bug (parser flags binary; noise filters it).
- **Surface skipped/unreviewable files** in the review output ("N files not
  reviewed: binary/generated/too-large") so a coverage gap is visible, never
  silent. A finding we can't make is still information.
- Give agents (or a pre-pass) the ability to read the **working tree**, not only
  the unified diff, for files git can't diff cleanly — the bot's edge was exactly
  this.
- **Test infrastructure (currently none in this package).** Add a lightweight
  suite with regression fixtures for: NUL-byte source stays text/diffable; binary
  marker → filtered; glob matcher parity; fingerprint dedup. These two bugs are
  precisely the kind a fixture locks down cheaply.

**Cross-cutting: self-review coverage.** The reviewer should be reliably run
against its own PRs at a size it can handle (the 49-file mega-PR defeated it —
see reliability items). A completed, non-degraded self-review would likely have
surfaced at least #2 once the parser/working-tree gaps above are closed.

## Audit follow-ups (2026-07-22) — remaining items

Three parallel audits (reliability / UX / speed) ran on 2026-07-22. The
failure-path cluster (never-approve-on-failure, coordinator fallback, always-post,
cross-cutting collapse, retry-explosion removal, LPT scheduling, timeout
alignment, concurrency + maxChangedLines bumps) shipped — see "Recently shipped"
and §3. What remains, by tier:

### Correctness bugs — ✅ shipped (2026-07-22)
- ✅ **GitHub comment lookup** now paginates all comments (manual paging; the
  issue-comments endpoint ignores `sort`/`direction` and returns oldest-first) and
  keeps the **newest** marked comment. Fixes duplicate reviewer comments and missed
  `/skip-review` on PRs with >100 comments. `reporters/github.ts`
- ✅ **Temp-dir leak** in `withBodyFile` fixed — try/finally `rm` of the `mkdtemp`
  dir, matching `auth.ts`. `reporters/github.ts`
- ✅ **Cost/token metrics** now capture the in-progress assistant's `cost`/`tokens`
  on timeout (threaded through `DeadlineReached` → the finalize result or
  `AgentTimeoutError`), so abandoned/finalized tasks contribute their spend.
  `opencode.ts`, `review.ts`

### Speed — ✅ shipped (2026-07-22)
- ✅ **CI fixed cost**: `fetch-depth: 1` + `cache: yarn` in both workflows.
- ✅ **`POLL_INTERVAL_MS`** 2s→1s.
- **Faster coordinator model** — *(left to config, not hardcoded)*: set
  `model:` in `coordinator.md` frontmatter (it uses no repo tools). Not forced so
  repos keep one model unless they opt in. *(Open: OpenCode event-stream instead
  of polling — larger change, deferred.)*

### UX — ✅ mostly shipped (2026-07-22)
- ✅ **Report → stdout, progress → stderr** (`ecr review > out.txt` now works).
- ✅ **Terminal: per-severity headers + counts + a one-line tally.**
- ✅ **Progress heartbeat** during silent model "thinking" (poll loop emits
  "still working… Ns elapsed" after 45s idle).
- ✅ **`doctor` checks `gh` + `gh auth status`**; **`ci --help`** added.
- **Clickable `file:line`** — *(deferred, folded into §1 inline comments)*: robust
  links need the PR head SHA threaded into the renderer (branch links 404 for
  forks); the inline-comment work solves locations properly, so do it there.
- **Auth-shaped (401/403) agent errors → one actionable message** — still open.
- **Minor**: README uses `ecr` though unpublished (note once that real invocation
  is `yarn workspace expo-code-review dev …`); `init` next-steps vs scaffolded
  `auth.mode`; warn when `--staged` is combined with `--base`/`--head`.

## On extraction to its own repo (deferred cleanup)

The package is intentionally standalone ESM/NodeNext (with `.js` import specifiers)
and is deliberately excluded from this monorepo's oxlint/oxfmt during incubation
(see the rationale comment in `tsconfig.json`). That trades away lint/format
coverage for the package right now — an accepted, temporary gap. Resolve it at
extraction time rather than bending the monorepo around an experimental package:

- **Give the extracted repo its own lint + format setup** (oxlint/oxfmt or ESLint
  + Prettier) and wire it into that repo's CI. This closes the current "no lint
  coverage" gap, and the ESM/NodeNext choice stops being a *divergence* (it's just
  the new repo's standard).
- **Remove the monorepo exclusions** once the code no longer lives here
  (`.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig.oxlint.json` all list it).
- **Publish + run via `npx`** (see §3.8) and drop the in-repo `yarn build`-from-
  source workflows.
- Net: the reviewer's own "NodeNext vs commonjs / no oxlint coverage" warning on
  its PR is an artifact of incubating an ESM package inside a commonjs monorepo,
  and disappears on extraction — no CommonJS refactor needed.

## Model selection & fallback

Current: `config.jsonc` `model` is the default; per-agent and `coordinator.md`
frontmatter `model:` override it; `REVIEWER_MODEL` env is a global override.
Precedence: env > frontmatter > config default. In use: Sonnet 5 for the
specialists + cross-file pass, Haiku for the coordinator.

**Decision (2026-07-22): do NOT auto-map to a cross-provider "equivalent"** (e.g.
silently swapping `anthropic/claude-sonnet-5` for an OpenAI model when only OpenAI
is authed). Reasons: "equivalent" is subjective and drifts with every lineup
change (an ongoing, frequently-wrong mapping table); and silently running a review
on a different model than configured hides *why* findings changed — for a review
tool, a clear failure beats an invisible substitution. Explicit overrides
(`REVIEWER_MODEL`, frontmatter `model:`) are the portability primitive.

Wanted instead:
- **Fail-fast provider-auth check** (in `doctor` and at run start): if the
  configured model's provider isn't authenticated, say so up front ("configured
  `anthropic/…` but only OpenAI is logged in — set `REVIEWER_MODEL` or
  authenticate Anthropic") instead of surfacing as N failed passes mid-run. This
  removes most of the perceived need for a fallback. Small, clearly good.
- **Optional, opt-in `fallbackModel`** for availability only: fires ONLY on the
  primary being unavailable / rate-limited / errored, and is **surfaced in the
  review output** ("primary X unavailable; this pass ran on fallback Y") — never
  silent. Would need to be tier-aware given the mixed-model setup (a single global
  fallback would flatten the specialist-vs-coordinator model distinction).
