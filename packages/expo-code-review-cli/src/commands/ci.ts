import { readFile } from 'node:fs/promises';

import { loadReviewConfig } from '../config/load.js';
import { repoRoot } from '../core/exec.js';
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

export async function ciCommand(argv: string[] = []): Promise<void> {
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
    // A reviewer failure must never fail the PR's checks.
    process.stderr.write(`CI reviewer: run failed (non-blocking): ${errorMessage(error)}\n`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parse `--agents a,b,c` from argv (undefined = all agents). */
function parseAgents(argv: string[]): string[] | undefined {
  const index = argv.indexOf('--agents');
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value) {
    return undefined;
  }
  return value
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}
