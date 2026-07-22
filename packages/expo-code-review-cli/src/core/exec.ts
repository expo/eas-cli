import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOptions {
  cwd?: string;
  maxBuffer?: number;
  /** When false, a non-zero exit returns the result instead of throwing. */
  check?: boolean;
}

/**
 * Run a command capturing stdout/stderr. Never interpolates a shell, so
 * arguments are passed verbatim and are not subject to shell injection.
 */
export async function run(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const check = options.check ?? true;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string; code?: number };
    if (!check) {
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
    }
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${err.stderr ?? err.message ?? ''}`.trim()
    );
  }
}

export async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run('git', args, { cwd });
  return stdout;
}

/** Resolve owner/repo from the current checkout via gh (for PR-targeting commands). */
export async function resolveRepo(cwd?: string): Promise<string> {
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
  throw new Error('Could not determine the repository; pass --repo owner/repo.');
}

/** Absolute path of the git working-tree root, or null if not in a repo. */
export async function repoRoot(cwd?: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--show-toplevel'], cwd)).trim() || null;
  } catch {
    return null;
  }
}

/** Whether an executable is resolvable on PATH. */
export async function onPath(command: string): Promise<boolean> {
  const { code } = await run(process.platform === 'win32' ? 'where' : 'which', [command], {
    check: false,
  });
  return code === 0;
}
