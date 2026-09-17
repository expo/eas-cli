import { type bunyan } from '@expo/logger';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const FINAL_UPLOAD_TIMEOUT_MS = 30_000;

export async function startAgentDeviceAppLogCollectionAsync({
  ctx,
  deviceRunSessionId,
  stateDir,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  stateDir: string;
  logger: bunyan;
}): Promise<{ stopAsync: () => Promise<void> }> {
  const sessionsDir = path.join(stateDir, 'sessions');
  let existingSessions: Set<string>;
  const report = (err: unknown): void => {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error }, 'Could not preserve agent-device app logs.');
    Sentry.capture('Could not preserve agent-device app logs', error, {
      level: 'warning',
      extras: { deviceRunSessionId },
    });
  };
  try {
    existingSessions = new Set(await listSessionDirectoriesAsync(sessionsDir));
  } catch (err) {
    report(err);
    return { stopAsync: async () => {} };
  }

  let completion: Promise<void> | undefined;
  return {
    stopAsync: () => (completion ??= finishAsync().catch(report)),
  };

  async function finishAsync(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FINAL_UPLOAD_TIMEOUT_MS);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(new Error('App log upload exceeded the 30-second shutdown budget.'));
        },
        { once: true }
      );
    });
    try {
      await Promise.race([uploadLogsAsync(), aborted]);
    } finally {
      clearTimeout(timer);
    }

    async function uploadLogsAsync(): Promise<void> {
      let remainingBytes = MAX_LOG_BYTES;
      const sessions = await listSessionDirectoriesAsync(sessionsDir);
      if (!sessions.length) {
        return;
      }
      const canonicalSessionsDir = await realpath(sessionsDir);
      for (const session of sessions) {
        controller.signal.throwIfAborted();
        if (existingSessions.has(session)) {
          continue;
        }
        try {
          const sessionDir = path.join(canonicalSessionsDir, session);
          if ((await realpath(sessionDir)) !== sessionDir) {
            throw new Error('Skipping app log outside the expected session directory.');
          }
          const file = await open(
            path.join(sessionDir, 'app.log'),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          );
          let contents: Uint8Array;
          try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.size === 0) {
              continue;
            }
            if (stat.size > remainingBytes) {
              throw new Error('Skipping app log that exceeds the 10 MiB per-run upload budget.');
            }
            const buffer = new Uint8Array(stat.size);
            let offset = 0;
            while (offset < buffer.length) {
              const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
              if (bytesRead === 0) {
                break;
              }
              offset += bytesRead;
            }
            contents = buffer.subarray(0, offset);
          } finally {
            await file.close();
          }
          controller.signal.throwIfAborted();
          if (!contents.length) {
            continue;
          }
          remainingBytes -= contents.length;
          const stream = Readable.from([contents]);
          try {
            await uploadDeviceRunSessionArtifactAsync(ctx, {
              deviceRunSessionId,
              artifactId: `app-log:${session}`,
              name: `App log (${session})`,
              filename: `${session}-app.log`,
              kind: 'native-app-log',
              size: contents.length,
              stream,
              signal: controller.signal,
            });
          } finally {
            stream.destroy();
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            report(err);
          }
        }
      }
    }
  }
}

async function listSessionDirectoriesAsync(sessionsDir: string): Promise<string[]> {
  try {
    if (!(await lstat(sessionsDir)).isDirectory()) {
      throw new Error('Expected a real agent-device sessions directory.');
    }
    return (await readdir(sessionsDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}
