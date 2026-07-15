#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';

import { reviewChanges } from '../core.ts';
import { repoRoot } from '../exec.ts';
import { GitHubPRSource } from '../sources/github-pr.ts';
import { GitHubReporter } from '../reporters/github.ts';

/** Resolve the PR number from the Actions event payload or GITHUB_REF. */
async function resolvePrNumber(): Promise<number | null> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
        pull_request?: { number?: number };
        number?: number;
      };
      const number = event.pull_request?.number ?? event.number;
      if (typeof number === 'number') {
        return number;
      }
    } catch {
      // fall through
    }
  }
  // refs/pull/<n>/merge
  const match = (process.env.GITHUB_REF ?? '').match(/refs\/pull\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

async function main(): Promise<void> {
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

  const reporter = new GitHubReporter({ prNumber, repo, cwd: process.cwd() });

  // Break-glass short-circuit before spending anything on agents.
  try {
    if (await reporter.checkBreakGlass()) {
      process.stderr.write('CI reviewer: /skip-review detected; skipping.\n');
      await reporter.postSkipNote();
      return;
    }
  } catch (error) {
    process.stderr.write(
      `CI reviewer: break-glass check failed (continuing): ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }

  const source = new GitHubPRSource({ prNumber, repo, cwd: process.cwd() });

  try {
    const review = await reviewChanges(source, {
      mode: 'ci',
      onProgress: message => process.stderr.write(`${message}\n`),
    });
    await reporter.report(review);
    process.stderr.write(`CI reviewer: posted review (${review.decision}).\n`);
  } catch (error) {
    // Phase 1: a reviewer failure must never fail the PR's checks.
    process.stderr.write(
      `CI reviewer: run failed (non-blocking): ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }
}

void main();
