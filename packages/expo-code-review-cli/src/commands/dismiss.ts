import { loadReviewConfig } from '../config/load.js';
import { repoRoot, resolveRepo } from '../core/exec.js';
import { errorMessage } from '../core/util.js';
import { GitHubReporter } from '../reporters/github.js';

const USAGE = `ecr dismiss / undismiss — hide (or restore) a finding on a PR

Usage:
  ecr dismiss   --pr <n> [--repo <owner/repo>] <id...> [--reason <text>] [--by <user>]
  ecr undismiss --pr <n> [--repo <owner/repo>] <id...>

<id> is a finding's short id (shown as \`id:...\` in the reviewer comment). Dismissed
findings move to a collapsed "Dismissed on this PR" section and stay there across
re-reviews; the review still runs — this only affects display.
`;

interface DismissArgs {
  pr?: number;
  repo?: string;
  reason?: string;
  by?: string;
  ids: string[];
}

function parseArgs(argv: string[]): DismissArgs {
  const args: DismissArgs = { ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--pr':
        args.pr = Number(argv[++i]);
        break;
      case '--repo':
        args.repo = argv[++i];
        break;
      case '--reason':
        args.reason = argv[++i];
        break;
      case '--by':
        args.by = argv[++i];
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        // Bare arg = a finding id. Sanitize to the fingerprint alphabet.
        args.ids.push(arg.replace(/[^a-f0-9]/g, ''));
    }
  }
  args.ids = args.ids.filter(Boolean);
  return args;
}

export async function dismissCommand(argv: string[], mode: 'add' | 'remove'): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }

  let args: DismissArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  if (args.pr == null || !Number.isInteger(args.pr) || args.pr <= 0) {
    process.stderr.write('dismiss: --pr <number> is required.\n');
    process.exitCode = 2;
    return;
  }
  if (args.ids.length === 0) {
    process.stderr.write('dismiss: provide at least one finding id.\n');
    process.exitCode = 2;
    return;
  }

  const root = await repoRoot();
  if (root && root !== process.cwd()) {
    process.chdir(root);
  }
  const cwd = process.cwd();

  try {
    const config = await loadReviewConfig(cwd);
    const repo = args.repo ?? (await resolveRepo(cwd));
    const reporter = new GitHubReporter({
      prNumber: args.pr,
      repo,
      commentTag: config.commentTag,
      breakGlassMarker: config.breakGlassMarker,
      cwd,
    });
    const result = await reporter.applyDismissal(
      mode === 'add' ? args.ids : [],
      mode === 'remove' ? args.ids : [],
      args.by,
      args.reason
    );
    if (mode === 'add') {
      process.stderr.write(
        `Dismissed ${result.matched.length} finding(s) on ${repo}#${args.pr}.\n`
      );
    } else {
      process.stderr.write(`Restored finding(s) on ${repo}#${args.pr}.\n`);
    }
    if (result.unmatched.length > 0) {
      process.stderr.write(`Unknown id(s) (no matching finding): ${result.unmatched.join(', ')}\n`);
    }
  } catch (error) {
    process.stderr.write(`dismiss failed: ${errorMessage(error)}\n`);
    process.exitCode = 2;
  }
}
