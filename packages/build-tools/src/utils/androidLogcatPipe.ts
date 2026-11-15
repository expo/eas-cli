import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { Socket } from 'node:net';
import { type Readable } from 'node:stream';
import { promisify } from 'node:util';

import { Sentry } from '../sentry';

/** Bridge the emulator's path-based logcat output to a readable stream. */
export async function createAndroidLogcatPipeAsync(
  pipePath: string
): Promise<{ path: string; stream: Readable; close: () => void; closed: Promise<void> }> {
  await promisify(execFile)('mkfifo', ['-m', '600', pipePath]);
  // The sentinel keeps the FIFO open before emulator launch. The reader signals
  // after opening it, so even a failed launch can close the pipe without a race.
  const sentinel = fs.openSync(pipePath, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
  let sentinelOpen = true;
  const close = (): void => {
    if (sentinelOpen) {
      sentinelOpen = false;
      fs.closeSync(sentinel);
    }
  };
  const reader = spawn(
    'sh',
    ['-c', 'exec 3<"$1" || exit 1; printf ready >&2; exec cat <&3', 'android-logcat', pipePath],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const ready = new Promise<void>((resolve, reject) => {
    reader.once('error', reject);
    reader.once('exit', () =>
      reject(new Error('Android logcat reader exited before opening its pipe.'))
    );
    reader.stderr.once('data', () => resolve());
  });
  reader.on('error', err => {
    close();
    Sentry.capture('Failed to read Android logcat pipe', err, { level: 'warning' });
  });
  const closed = new Promise<void>(resolve => {
    reader.once('close', () => {
      close();
      void fs.promises
        .rm(pipePath, { force: true })
        .catch(() => {})
        .then(resolve);
    });
  });
  try {
    await ready;
  } catch (err) {
    close();
    reader.kill();
    await closed;
    throw err;
  }
  reader.unref();
  for (const stream of [reader.stdout, reader.stderr]) {
    if (stream instanceof Socket) {
      stream.unref();
    }
  }
  return { path: pipePath, stream: reader.stdout, close, closed };
}
