import spawnAsync from '@expo/spawn-async';

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
