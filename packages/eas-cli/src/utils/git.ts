import spawnAsync from '@expo/spawn-async';

interface GitStatusOptions {
  showUntracked?: boolean;
}

export async function gitStatusAsync({ showUntracked }: GitStatusOptions = {}): Promise<string> {
  return (await spawnAsync('git', ['status', '-s', showUntracked ? '-uall' : '-uno'])).stdout;
}

export async function gitDiffAsync({ withPager = false }: { withPager?: boolean } = {}): Promise<
  void
> {
  const options = withPager ? [] : ['--no-pager'];
  await spawnAsync('git', [...options, 'diff'], { stdio: ['ignore', 'inherit', 'inherit'] });
}

export async function getGitDiffOutputAsync(): Promise<string> {
  return (await spawnAsync('git', ['--no-pager', 'diff'])).stdout;
}

export async function gitAddAsync(
  file: string,
  options?: { intentToAdd?: boolean }
): Promise<void> {
  if (options?.intentToAdd) {
    await spawnAsync('git', ['add', '--intent-to-add', file]);
  } else {
    await spawnAsync('git', ['add', file]);
  }
}

export async function gitRootDirectoryAsync(): Promise<string> {
  return (await spawnAsync('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
}

export async function doesGitRepoExistAsync(): Promise<boolean> {
  try {
    await spawnAsync('git', ['rev-parse', '--git-dir']);
    return true;
  } catch (err) {
    return false;
  }
}

export async function gitCommitHashAsync(): Promise<string | undefined> {
  try {
    return await (await spawnAsync('git', ['rev-parse', 'HEAD'])).stdout.trim();
  } catch (err) {
    return undefined;
  }
}

export async function isGitInstalledAsync(): Promise<boolean> {
  try {
    await spawnAsync('git', ['--help']);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return true;
}

export async function getBranchNameAsync(): Promise<string | null> {
  try {
    return (await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  } catch (e) {
    return null;
  }
}

export async function getLastCommitMessageAsync(): Promise<string | null> {
  try {
    return (await spawnAsync('git', ['--no-pager', 'log', '-1', '--pretty=%B'])).stdout.trim();
  } catch (e) {
    return null;
  }
}
