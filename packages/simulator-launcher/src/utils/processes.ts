import { type ChildProcess, spawn } from 'node:child_process';
import { setTimeout as sleepAsync } from 'node:timers/promises';

export type ChildProcessHandle = { child: ChildProcess; resultPromise: Promise<string> };
let commandCloseDrainError: Error | undefined;

export const commands = {
  start(
    file: string,
    args: string[],
    signal?: AbortSignal,
    captureStdout = false,
    /** Lead a new process group, so terminateProcessGroupAsync can signal the whole tree. */
    detached = false
  ): ChildProcessHandle {
    const child = spawn(file, args, {
      stdio: captureStdout ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      signal,
      detached,
    });
    let stdout = '';
    let error: Error | undefined;
    let closeDrainTimer: NodeJS.Timeout | undefined;
    const resultPromise = new Promise<string>((resolve, reject) => {
      const startCloseDrainTimeout = (): void => {
        closeDrainTimer ??= setTimeout(() => {
          commandCloseDrainError ||= new Error(
            `${file} did not finish closing within 130 seconds after exit or error; Simulator cleanup could not be confirmed.`,
            {
              cause: error,
            }
          );
          try {
            child.kill('SIGKILL');
          } catch {
            /* Teardown remains failed. */
          }
          child.stdout?.destroy();
          child.unref();
          reject(error ?? commandCloseDrainError);
        }, 130_000);
      };
      child.stdout?.on('data', data => {
        stdout += data;
      });
      child.once('error', failure => {
        error = failure;
        startCloseDrainTimeout();
      });
      child.once('exit', (code, signal) => {
        if (code !== 0) {
          error ||= Object.assign(new Error(`${file} exited with ${signal ?? code}.`), { code });
        }
        startCloseDrainTimeout();
      });
      child.once('close', () => {
        clearTimeout(closeDrainTimer);
        error ? reject(error) : resolve(stdout);
      });
    });
    void resultPromise.catch(() => {}); // Observe long-lived launches before startup joins or cleanup await them.
    return { child, resultPromise };
  },
  async runAsync(file: string, args: string[], signal?: AbortSignal): Promise<string> {
    return await commands.start(file, args, signal, /* captureStdout */ true).resultPromise;
  },
  throwIfCommandCloseTimedOut(): void {
    if (commandCloseDrainError) {
      throw commandCloseDrainError;
    }
  },
};

/** EPERM means the process exists but cannot be signalled, as for an exited one awaiting reap. */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    if (code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

/** Signals a process; false when it is gone, true when it was signalled or cannot be. */
function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    if (code !== 'EPERM') {
      throw error;
    }
  }
  return true;
}

/**
 * macOS reports EPERM for a group whose only members have exited and await reaping, so EPERM
 * is resolved by checking for a member that is not a zombie.
 */
async function isProcessGroupRunningAsync(groupId: number): Promise<boolean> {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    if (code !== 'EPERM') {
      throw error;
    }
  }
  const members = await commands.runAsync('ps', ['-A', '-o', 'pgid=,stat=']);
  return members
    .trim()
    .split('\n')
    .some(line => {
      const [pgid, stat = ''] = line.trim().split(/\s+/);
      return Number(pgid) === groupId && !stat.startsWith('Z');
    });
}

async function stopProcessTreeAsync(
  pid: number,
  deadlineMs: number,
  ownedChildProcess?: ChildProcess
): Promise<void> {
  const children = await commands.runAsync('pgrep', ['-P', String(pid)]).catch(error => {
    if (error.code !== 1) {
      throw error;
    }
    return '';
  });
  if (
    ownedChildProcess &&
    (ownedChildProcess.exitCode != null || ownedChildProcess.signalCode != null)
  ) {
    throw new Error(
      'A Simulator service launcher exited before its child processes could be identified; cleanup could not be confirmed.'
    );
  }
  for (const child of children.trim().split(/\s+/).filter(Boolean)) {
    await stopProcessTreeAsync(Number(child), deadlineMs);
  }
  if (
    ownedChildProcess &&
    (ownedChildProcess.exitCode != null || ownedChildProcess.signalCode != null)
  ) {
    // Stopping a descendant can make its wrapper exit normally. Never probe that PID again.
    if (ownedChildProcess.exitCode === 0) {
      return;
    }
    throw new Error(
      'A Simulator service launcher exited unexpectedly while its child processes were stopping; cleanup could not be confirmed.'
    );
  }
  if (!isProcessRunning(pid)) {
    return;
  }
  try {
    if (ownedChildProcess) {
      if (!ownedChildProcess.kill('SIGTERM')) {
        throw new Error(
          'A Simulator service launcher exited before it could be stopped safely; cleanup could not be confirmed.'
        );
      }
    } else if (!signalProcess(pid, 'SIGTERM')) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
    return;
  }
  while (isProcessRunning(pid)) {
    const state = await commands
      .runAsync('ps', ['-p', String(pid), '-o', 'state='])
      .catch(error => {
        if (error.code === 1 && !isProcessRunning(pid)) {
          return '';
        }
        throw error;
      });
    if (state.trim().startsWith('Z') || !isProcessRunning(pid)) {
      return;
    }
    if (Date.now() >= deadlineMs) {
      throw new Error(
        `Simulator service process ${pid} is still running; cleanup could not be confirmed.`
      );
    }
    await sleepAsync(100);
  }
}

export async function stopProcessAndDescendantsAsync(
  processHandle: ChildProcessHandle,
  allowCompletedProcess = false
): Promise<void> {
  const { child } = processHandle;
  if (child.pid && child.exitCode == null && child.signalCode == null) {
    await stopProcessTreeAsync(child.pid, Date.now() + 130_000, child);
  } else if (child.pid && !allowCompletedProcess) {
    // Never inspect a reused wrapper PID or infer that its descendants have also exited.
    throw new Error(
      'A Simulator service exited before its child processes could be stopped; cleanup could not be confirmed.'
    );
  }
  await processHandle.resultPromise.catch(() => {});
  commands.throwIfCommandCloseTimedOut();
}

/**
 * Stops a process group that has nothing to finalize. The handle must lead its own group
 * (`commands.start(..., detached)`), so children spawned or respawned during the stop are
 * signalled too, and the group ID cannot be reused while any member is alive.
 */
export async function terminateProcessGroupAsync(
  processHandle: ChildProcessHandle,
  graceMs = 5_000
): Promise<void> {
  const groupId = processHandle.child.pid;
  if (!groupId) {
    throw new Error('A Simulator service has no process group; cleanup could not be confirmed.');
  }
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    if (!(await isProcessGroupRunningAsync(groupId)) || !signalProcess(-groupId, signal)) {
      break;
    }
    const deadline = Date.now() + graceMs;
    while ((await isProcessGroupRunningAsync(groupId)) && Date.now() < deadline) {
      await sleepAsync(100);
    }
  }
  if (await isProcessGroupRunningAsync(groupId)) {
    throw new Error(
      `Simulator service process group ${groupId} is still running; cleanup could not be confirmed.`
    );
  }
  await processHandle.resultPromise.catch(() => {});
  commands.throwIfCommandCloseTimedOut();
}
