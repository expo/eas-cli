import { loadReviewConfig } from '../config/load.js';
import { repoRoot } from '../core/exec.js';
import { runReview } from '../core/review.js';
import { LocalGitSource } from '../sources/local-git.js';
import type { LocalGitOptions } from '../sources/local-git.js';
import { TerminalReporter } from '../reporters/terminal.js';

const USAGE = `ecr review — local AI code review (no GitHub involvement)

Usage:
  ecr review [options]

Options:
  --base <ref>   Base ref to diff against (default: merge-base with default branch)
  --head <ref>   Head ref to diff (default: working tree, incl. uncommitted changes)
  --staged       Review only staged changes
  --json         Emit machine-readable JSON on stdout
  --no-fail      Always exit 0, even on request-changes
  -h, --help     Show this help

Exit codes: 0 approve / approve-with-comments, 1 request-changes, 2 error.
`;

interface ReviewArgs {
  base?: string;
  head?: string;
  staged: boolean;
  json: boolean;
  noFail: boolean;
  help: boolean;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[]): ReviewArgs {
  const args: ReviewArgs = { staged: false, json: false, noFail: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--base':
        args.base = requireValue(arg, argv[++i]);
        break;
      case '--head':
        args.head = requireValue(arg, argv[++i]);
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

export async function reviewCommand(argv: string[]): Promise<void> {
  let args: ReviewArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${USAGE}`);
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

  try {
    const config = await loadReviewConfig(process.cwd());
    const sourceOptions: LocalGitOptions = {
      base: args.base,
      head: args.head,
      staged: args.staged,
      cwd: process.cwd(),
    };
    const review = await runReview(new LocalGitSource(sourceOptions), {
      config,
      mode: 'local',
      onProgress: message => process.stderr.write(`${message}\n`),
    });
    await new TerminalReporter({ json: args.json, noFail: args.noFail }).report(review);
  } catch (error) {
    process.stderr.write(`AI review failed: ${errorMessage(error)}\n`);
    process.exitCode = 2;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
