import { readFile } from 'node:fs/promises';

import { loadReviewConfig } from '../config/load.js';
import { repoRoot } from '../core/exec.js';
import { errorMessage } from '../core/util.js';
import { runReview } from '../core/review.js';
import { GitHubPRSource } from '../sources/github-pr.js';
import { GitHubReporter } from '../reporters/github.js';

/** Resolve the PR number from the Actions event payload or GITHUB_REF. */
async function resolvePrNumber(): Promise<number | null> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
        pull_request?: { number?: number };
        // issue_comment events carry the PR number under issue.number.
        issue?: { number?: number };
        number?: number;
      };
      const number = event.pull_request?.number ?? event.issue?.number ?? event.number;
      if (typeof number === 'number') {
        return number;
      }
    } catch {
      // fall through
    }
  }
  const match = (process.env.GITHUB_REF ?? '').match(/refs\/pull\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

const CI_USAGE = `ecr ci — review the current GitHub PR and post/update one comment.

For GitHub Actions: reads the PR number + repo from the event/env, gets the diff
via \`gh pr diff\`, runs the reviewer, and upserts a single PR comment. Comment-only
and non-blocking (a reviewer failure never fails the PR's checks).

Options:
  --agents <a,b>   Run only these agents (comma-separated ids); default: all
  --route          Let the router pick relevant agents from the diff
  -h, --help       Show this help

Env: GITHUB_REPOSITORY, GITHUB_EVENT_PATH/GITHUB_REF (PR number), GH_TOKEN,
and model credentials per .expo-code-review/config.jsonc (or REVIEWER_MODEL).
`;

export async function ciCommand(argv: string[] = []): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(CI_USAGE);
    return;
  }
  const agents = parseAgents(argv);
  const route = argv.includes('--route');
  const root = await repoRoot();
  if (root && root !== process.cwd()) {
    process.chdir(root);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = await resolvePrNumber();

  if (!repo || prNumber == null) {
    process.stderr.write(
      'CI reviewer: could not determine repository or PR number from the environment. Skipping.\n'
    );
    return;
  }

  let config;
  try {
    config = await loadReviewConfig(process.cwd());
  } catch (error) {
    process.stderr.write(`CI reviewer: ${errorMessage(error)}\n`);
    return;
  }

  const reporter = new GitHubReporter({
    prNumber,
    repo,
    commentTag: config.commentTag,
    breakGlassMarker: config.breakGlassMarker,
    cwd: process.cwd(),
  });

  try {
    if (await reporter.checkBreakGlass()) {
      process.stderr.write(`CI reviewer: ${config.breakGlassMarker} detected; skipping.\n`);
      await reporter.postSkipNote();
      return;
    }
  } catch (error) {
    process.stderr.write(`CI reviewer: break-glass check failed (continuing): ${errorMessage(error)}\n`);
  }

  try {
    const review = await runReview(new GitHubPRSource({ prNumber, repo, cwd: process.cwd() }), {
      config,
      mode: 'ci',
      agents,
      route,
      onProgress: message => process.stderr.write(`${message}\n`),
    });
    await reporter.report(review);
    process.stderr.write(`CI reviewer: posted review (${review.decision}).\n`);
  } catch (error) {
    // A reviewer failure must never fail the PR's checks — but it must also not be
    // silent. Post a terminal state to the PR so the maintainer who triggered it
    // (e.g. a `/review` with a typo'd agent name, or a crash) gets feedback
    // instead of a stuck 👀 reaction and nothing else.
    const reason = errorMessage(error);
    process.stderr.write(`CI reviewer: run failed (non-blocking): ${reason}\n`);
    try {
      await reporter.report({
        decision: 'approve_with_comments',
        findings: [],
        summary: `⚠️ The AI reviewer failed to run, so this change was **not** reviewed:\n\n> ${reason}`,
        incomplete: [],
      });
    } catch (postError) {
      process.stderr.write(`CI reviewer: also failed to post the failure notice: ${errorMessage(postError)}\n`);
    }
  }
}


/** Parse `--agents a,b,c` from argv (undefined = all agents). */
function parseAgents(argv: string[]): string[] | undefined {
  const index = argv.indexOf('--agents');
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  // A missing value, or the next token being another flag (e.g. `--agents --route`),
  // means no agent list was given — treat as "all" rather than misparsing `--route`
  // as an agent id. Mirrors review.ts's requireValue.
  if (!value || value.startsWith('--')) {
    return undefined;
  }
  return value
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}
