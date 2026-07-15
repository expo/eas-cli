#!/usr/bin/env bun
import { reviewChanges } from '../core.ts';
import { repoRoot } from '../exec.ts';
import { LocalGitSource } from '../sources/local-git.ts';
import type { LocalGitOptions } from '../sources/local-git.ts';
import { TerminalReporter } from '../reporters/terminal.ts';

interface CliArgs {
  base?: string;
  head?: string;
  staged: boolean;
  json: boolean;
  noFail: boolean;
  help: boolean;
}

const USAGE = `eas-review — local AI code review (no GitHub involvement)

Usage:
  bun run review [options]

Options:
  --base <ref>   Base ref to diff against (default: merge-base with default branch)
  --head <ref>   Head ref to diff (default: working tree, incl. uncommitted changes)
  --staged       Review only staged changes
  --json         Emit machine-readable JSON on stdout
  --no-fail      Always exit 0, even on request-changes
  -h, --help     Show this help

Exit codes: 0 approve / approve-with-comments, 1 request-changes, 2 error.
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { staged: false, json: false, noFail: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--base':
        args.base = argv[++i];
        break;
      case '--head':
        args.head = argv[++i];
        break;
      case '--staged':
        args.staged = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--no-fail':
        args.noFail = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  // The OpenCode server roots at process.cwd(); run from the repo root so agents
  // can read the whole checkout and diff paths resolve correctly.
  const root = await repoRoot();
  if (root && root !== process.cwd()) {
    process.chdir(root);
  }

  const sourceOptions: LocalGitOptions = {
    base: args.base,
    head: args.head,
    staged: args.staged,
    cwd: process.cwd(),
  };
  const source = new LocalGitSource(sourceOptions);
  const reporter = new TerminalReporter({ json: args.json, noFail: args.noFail });

  try {
    const review = await reviewChanges(source, {
      mode: 'local',
      // Progress to stderr so --json stdout stays clean.
      onProgress: message => process.stderr.write(`${message}\n`),
    });
    await reporter.report(review);
  } catch (error) {
    process.stderr.write(`AI review failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

void main();
