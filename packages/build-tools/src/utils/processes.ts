import spawn from '@expo/turtle-spawn';

async function getChildrenPidsAsync(parentPids: number[]): Promise<number[]> {
  try {
    const result = await spawn('pgrep', ['-P', parentPids.join(',')], {
      stdio: 'pipe',
    });
    return result.stdout
      .toString()
      .split('\n')
      .map(i => Number(i.trim()))
      .filter(i => i);
  } catch {
    return [];
  }
}

export async function getParentAndDescendantProcessPidsAsync(ppid: number): Promise<number[]> {
  const children = new Set<number>([ppid]);
  let shouldCheckAgain = true;
  while (shouldCheckAgain) {
    const pids = await getChildrenPidsAsync([...children]);
    shouldCheckAgain = false;
    for (const pid of pids) {
      if (!children.has(pid)) {
        shouldCheckAgain = true;
        children.add(pid);
      }
    }
  }
  return [...children];
}

export async function isProcessDescendantOfAsync(
  pid: number,
  ancestorPid: number
): Promise<boolean> {
  let currentPid = pid;
  while (currentPid > 0) {
    if (currentPid === ancestorPid) {
      return true;
    }

    try {
      const result = await spawn('ps', ['-p', String(currentPid), '-o', 'ppid='], {
        stdio: 'pipe',
      });
      const parentPid = Number(result.stdout.toString().trim());
      if (!Number.isInteger(parentPid) || parentPid <= 0 || parentPid === currentPid) {
        return false;
      }
      currentPid = parentPid;
    } catch {
      return false;
    }
  }
  return false;
}
