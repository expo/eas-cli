import { loadReviewConfig } from '../config/load.js';
import { repoRoot, run } from '../core/exec.js';
import { runReview } from '../core/review.js';
import { LocalGitSource } from '../sources/local-git.js';
import { GitHubPRSource } from '../sources/github-pr.js';
import type { ReviewSource } from '../sources/source.js';
import { TerminalReporter } from '../reporters/terminal.js';
import { GitHubReporter } from '../reporters/github.js';

const USAGE = `ecr review — AI code review, printed to your terminal

Usage:
  ecr review [options]                 review local changes
  ecr review --pr <n> [--post]         review a GitHub PR by number

Source (pick one):
  (default)          diff the working tree against the merge-base
  --base <ref>       base ref to diff against
  --head <ref>       head ref to diff
  --staged           review only staged changes
  --pr <n>           review GitHub PR #n by number (diff fetched via \`gh\`, no
                     checkout needed); can't be combined with --base/--head/--staged

Options:
  --repo <owner/repo>  repo for --pr (default: inferred from the current checkout)
  --post               with --pr: also post the result as the PR comment (needs
                       \`gh\` auth). Omit to only preview here; re-run with --post
                       to publish.
  --agents <a,b>       run only these agents (comma-separated ids); default: all
  --route              let the router pick relevant agents from the diff
  --json               emit machine-readable JSON on stdout
  --no-fail            always exit 0, even on request-changes
  -h, --help           show this help

Note: agents read the local working tree for surrounding context, so --pr uses the
PR's diff (authoritative) but your checked-out files for context. For full fidelity
on a PR, \`gh pr checkout <n>\` first, then run a plain \`ecr review\`.

Exit codes: 0 approve / approve-with-comments, 1 request-changes, 2 error.
`;

interface ReviewArgs {
  base?: string;
  head?: string;
  staged: boolean;
  pr?: number;
  repo?: string;
  post: boolean;
  agents?: string[];
  route: boolean;
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
  const args: ReviewArgs = {
    staged: false,
    post: false,
    route: false,
    json: false,
    noFail: false,
    help: false,
  };
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
      case '--pr': {
        const value = requireValue(arg, argv[++i]);
        const number = Number(value);
        if (!Number.isInteger(number) || number <= 0) {
          throw new Error(`--pr requires a positive PR number (got "${value}")`);
        }
        args.pr = number;
        break;
      }
      case '--repo':
        args.repo = requireValue(arg, argv[++i]);
        break;
      case '--post':
        args.post = true;
        break;
      case '--agents':
        args.agents = requireValue(arg, argv[++i])
          .split(',')
          .map(id => id.trim())
          .filter(Boolean);
        break;
      case '--route':
        args.route = true;
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

  try {
    validateArgs(args);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${USAGE}`);
    process.exitCode = 2;
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
    const cwd = process.cwd();
    const source: ReviewSource =
      args.pr != null
        ? new GitHubPRSource({ prNumber: args.pr, repo: args.repo, cwd })
        : new LocalGitSource({ base: args.base, head: args.head, staged: args.staged, cwd });

    const review = await runReview(source, {
      config,
      mode: 'local',
      agents: args.agents,
      route: args.route,
      onProgress: message => process.stderr.write(`${message}\n`),
    });

    // Always print the result here first.
    await new TerminalReporter({ json: args.json, noFail: args.noFail }).report(review);

    // Then, only if asked, publish the same result to the PR.
    if (args.post && args.pr != null) {
      const repo = args.repo ?? (await resolveRepo(cwd));
      await new GitHubReporter({
        prNumber: args.pr,
        repo,
        commentTag: config.commentTag,
        breakGlassMarker: config.breakGlassMarker,
        cwd,
      }).report(review);
      process.stderr.write(`\nPosted review to ${repo}#${args.pr}.\n`);
    }
  } catch (error) {
    process.stderr.write(`AI review failed: ${errorMessage(error)}\n`);
    process.exitCode = 2;
  }
}

/** Reject flag combinations that don't make sense together. */
function validateArgs(args: ReviewArgs): void {
  if (args.pr != null && (args.base || args.head || args.staged)) {
    throw new Error('--pr reviews a PR by its diff and cannot be combined with --base/--head/--staged.');
  }
  if (args.pr == null && (args.repo || args.post)) {
    throw new Error('--repo/--post only apply together with --pr.');
  }
}

/** Resolve owner/repo from the current checkout via gh (for --post). */
async function resolveRepo(cwd: string): Promise<string> {
  try {
    const { stdout } = await run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
      cwd,
    });
    const repo = stdout.trim();
    if (repo) {
      return repo;
    }
  } catch {
    // fall through to a clear error
  }
  throw new Error('Could not determine the repository for --post; pass --repo owner/repo.');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
