import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { createProcessOutput } from './processOutput';

const readAsync = promisify(fs.read);
const closeAsync = promisify(fs.close);

export function followWarmLog({
  file,
  logger,
  secrets,
}: {
  file: string;
  logger: bunyan;
  secrets: string[];
}) {
  const output = createProcessOutput(logger, secrets);
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  let offset: number;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error('The warm log is not a regular file.');
    }
    // Set the offset before the caller can adopt the service. Keep reading the same inode.
    offset = stat.size;
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }

  let timer: NodeJS.Timeout | undefined;
  let reading: Promise<void>;
  let stopping: Promise<void> | undefined;
  let readFailed = false;

  async function drainAsync(): Promise<void> {
    // Take a snapshot so draining still finishes if a service keeps writing during cleanup.
    const { size } = fs.fstatSync(fd);
    if (size < offset) {
      throw new Error('The warm log was truncated while forwarding.');
    }
    while (offset < size) {
      const { bytesRead } = await readAsync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, size - offset),
        offset
      );
      if (bytesRead === 0) {
        return;
      }
      offset += bytesRead;
      output.stdout.append(buffer.subarray(0, bytesRead));
    }
  }

  function poll(): void {
    reading = drainAsync().then(
      () => {
        if (!stopping) {
          timer = setTimeout(poll, 250).unref();
        }
      },
      err => {
        readFailed = true;
        logger.warn({ err }, 'Could not read the warm service log.');
      }
    );
  }

  poll();
  return {
    getOutput: output.getOutput,
    stopAsync(): Promise<void> {
      clearTimeout(timer);
      return (stopping ??= (async () => {
        try {
          await reading;
          if (!readFailed) {
            await drainAsync();
          }
        } finally {
          try {
            output.finish();
          } finally {
            await closeAsync(fd);
          }
        }
      })());
    },
  };
}
