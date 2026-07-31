import spawnAsync from '@expo/spawn-async';
import path from 'path';

export async function isGitInstalledAsync(): Promise<boolean> {
  try {
    await spawnAsync('git', ['--help']);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return true;
}

export async function doesGitRepoExistAsync(cwd: string | undefined): Promise<boolean> {
  try {
    await spawnAsync('git', ['rev-parse', '--git-dir'], {
      cwd,
    });
    return true;
  } catch {
    return false;
  }
}

interface GitStatusOptions {
  showUntracked: boolean;
  cwd: string | undefined;
}

export async function gitStatusAsync({ showUntracked, cwd }: GitStatusOptions): Promise<string> {
  return (
    await spawnAsync('git', ['status', '-s', showUntracked ? '-uall' : '-uno'], {
      cwd,
    })
  ).stdout;
}

/**
 * Lists the paths Git considers ignored, following all of the standard exclude
 * sources: `.gitignore` files, `$GIT_DIR/info/exclude` and `core.excludesFile`.
 *
 * Directories that are ignored as a whole are returned as a single entry with a
 * trailing slash, so Git does not have to walk their contents.
 */
export async function getIgnoredPathsAsync(cwd: string): Promise<string[]> {
  const ignoredPaths = await listIgnoredPathsAsync(cwd);

  // `git ls-files` does not descend into submodules, so each one has to be
  // asked separately for the paths it ignores.
  for (const submodulePath of await getSubmodulePathsAsync(cwd)) {
    const submoduleIgnoredPaths = await listIgnoredPathsAsync(path.join(cwd, submodulePath));
    ignoredPaths.push(...submoduleIgnoredPaths.map(entry => `${submodulePath}/${entry}`));
  }

  return ignoredPaths;
}

async function listIgnoredPathsAsync(cwd: string): Promise<string[]> {
  const { stdout } = await spawnAsync(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
    { cwd }
  );
  return stdout.split('\0').filter(entry => entry !== '');
}

/** Paths of the initialized submodules, relative to `cwd`, nested ones included. */
async function getSubmodulePathsAsync(cwd: string): Promise<string[]> {
  const { stdout } = await spawnAsync(
    'git',
    ['submodule', 'foreach', '--recursive', '--quiet', 'echo "$displaypath"'],
    { cwd }
  );
  return stdout.split('\n').filter(entry => entry !== '');
}

export async function getGitDiffOutputAsync(cwd: string | undefined): Promise<string> {
  return (
    await spawnAsync('git', ['--no-pager', 'diff'], {
      cwd,
    })
  ).stdout;
}

export async function gitDiffAsync({
  withPager = false,
  cwd,
}: {
  withPager?: boolean;
  cwd: string | undefined;
}): Promise<void> {
  const options = withPager ? [] : ['--no-pager'];
  try {
    await spawnAsync('git', [...options, 'diff'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd,
    });
  } catch (error: any) {
    if (typeof error.message === 'string' && error.message.includes('SIGPIPE')) {
      // This error is thrown when the user exits the pager with `q`.
      // do nothing
      return;
    }
    throw error;
  }
}
