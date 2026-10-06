import {
  type SandboxDaemonCommandParams,
  type SandboxDaemonCommandResult,
  type SandboxDaemonMethod,
} from '@expo/eas-build-job';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { readBytesAsync, readTextAsync } from '../../utils/files';
import { detectFileType } from '../../utils/files/filetypes';
import { ShellSessionManager } from './shellSessionManager';

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
const DEFAULT_WRITE_YIELD_TIME_MS = 250;

export type SandboxDaemonCommandImplementations = {
  [Method in SandboxDaemonMethod]: (
    params: SandboxDaemonCommandParams<Method>
  ) => Promise<SandboxDaemonCommandResult<Method>>;
};

export function createSandboxCommandImplementations({
  workingDirectory,
  env,
  signal,
}: {
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}): {
  commandImplementations: SandboxDaemonCommandImplementations;
  stoppedPromise: Promise<void>;
} {
  const sessions = new ShellSessionManager({ workingDirectory, env, signal });
  return {
    commandImplementations: {
      async execCommand(params) {
        const callStartedAt = performance.now();
        const sessionId = await sessions.startAsync({
          cmd: params.cmd,
          workdir: params.workdir,
          tty: params.tty,
        });
        const result = await sessions.readAsync(
          sessionId,
          params.yieldTimeMs ?? DEFAULT_EXEC_YIELD_TIME_MS
        );
        return { ...result, wallTimeSeconds: (performance.now() - callStartedAt) / 1_000 };
      },
      async writeStdin(params) {
        const callStartedAt = performance.now();
        if (params.chars !== undefined) {
          sessions.write(params.sessionId, params.chars);
        }
        const result = await sessions.readAsync(
          params.sessionId,
          params.yieldTimeMs ?? DEFAULT_WRITE_YIELD_TIME_MS
        );
        return { ...result, wallTimeSeconds: (performance.now() - callStartedAt) / 1_000 };
      },
      async readFile(params) {
        const filePath = path.resolve(workingDirectory, params.path);
        const file = await fs.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        try {
          const stats = await file.stat();
          if (!stats.isFile()) {
            throw new Error(`${filePath} is not a regular file.`);
          }
          const mimeType = await detectFileType(file);

          if (mimeType === null) {
            const truncated = stats.size > params.maxTextBytes;
            const text = await readTextAsync(
              file,
              Math.min(stats.size, params.maxTextBytes),
              truncated
            );
            if (text === null) {
              return { kind: 'binary', size: stats.size };
            }
            return { kind: 'text', text, size: stats.size, truncated };
          }

          if (stats.size > params.maxImageBytes) {
            return { kind: 'image', mimeType, size: stats.size, error: 'tooLarge' };
          }
          const data = await readBytesAsync(file, stats.size);
          return { kind: 'image', mimeType, data: data.toString('base64') };
        } finally {
          await file.close();
        }
      },
    },
    stoppedPromise: sessions.stoppedPromise,
  };
}
