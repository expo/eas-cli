import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';

import { commands, stopProcessAndDescendantsAsync } from '../../utils/processes';

export async function startOwnedWrapperAsync() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-owned-wrapper-'));
  const readyPath = path.join(directory, 'ready.json');
  const job = commands.start(
    process.execPath,
    [path.join(__dirname, 'stop-wrapper.cjs'), path.join(__dirname, 'stop-leaf.cjs'), readyPath],
    { captureStdout: true, detached: true }
  );
  const realKill = process.kill.bind(process);
  const stop = stopProcessAndDescendantsAsync;
  let confirmed = false;
  let stopping: Promise<void> | undefined;
  const cleanupAsync = async () => {
    if (!confirmed && job.child.pid) {
      try {
        realKill(-job.child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    await job.resultPromise.catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  };
  try {
    let leaves: number[] = [];
    const deadline = Date.now() + 5_000;
    while (!leaves.length) {
      const ready = await fs.readFile(readyPath, 'utf8').catch(() => undefined);
      if (ready) leaves = JSON.parse(ready);
      else {
        if (Date.now() >= deadline) throw new Error('The disposable wrapper did not become ready.');
        await sleepAsync(10);
      }
    }
    return {
      job,
      leaves,
      realKill,
      cleanupAsync,
      stopAsync: () =>
        (stopping ??= stop(job).then(() => {
          confirmed = true;
        })),
    };
  } catch (error) {
    await cleanupAsync();
    throw error;
  }
}
