import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { promisify } from 'node:util';

import { getVmStateDirectory } from '../utils/state';

const STARTUP_DIRECTORY = '/Volumes/My Shared Files/expo-startup';
const STARTUP_SCRIPT = 'startup.sh';
const execFilePromise = promisify(execFile);

export async function runStartupScriptOncePerBootAsync(
  directory = STARTUP_DIRECTORY
): Promise<number> {
  const controller = new AbortController();
  let child: ReturnType<typeof spawn> | undefined;
  const stop = (signal: NodeJS.Signals): void => {
    controller.abort(new Error('VM startup was interrupted.'));
    child?.kill(signal);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    const script = path.join(directory, STARTUP_SCRIPT);
    while (true) {
      controller.signal.throwIfAborted();
      try {
        if (!(await fs.stat(script)).isFile()) {
          throw new Error('The mounted VM startup.sh is not a regular file.');
        }
        break;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw error;
        }
      }
      await sleepAsync(100, undefined, { signal: controller.signal });
    }
    const { stdout } = await execFilePromise('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']);
    const boot = stdout.trim();
    if (!boot) {
      throw new Error(
        'Could not read the VM boot identifier (kern.bootsessionuuid); startup cannot continue.'
      );
    }
    await fs.mkdir(getVmStateDirectory(), { recursive: true });
    const marker = path.join(getVmStateDirectory(), `started-${boot}`);
    try {
      await fs.mkdir(marker);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return 0;
      }
      throw error;
    }
    if (controller.signal.aborted) {
      // Nothing ran yet, so release this boot for a later invocation.
      await fs.rmdir(marker);
      controller.signal.throwIfAborted();
    }
    child = spawn('/bin/bash', [script], { stdio: 'inherit' });
    return await new Promise<number>((resolve, reject) => {
      child!.once('error', reject);
      child!.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
