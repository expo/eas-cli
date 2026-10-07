import {
  type SandboxDaemonCommandParams,
  type SandboxDaemonCommandResult,
  SandboxDaemonError,
  SandboxDaemonErrorCode,
  type SandboxDaemonMethod,
} from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { type Client } from '@urql/core';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { readBytesAsync, readTextAsync } from '../../utils/files';
import { detectFileType } from '../../utils/files/filetypes';
import { SandboxArtifactUploadManager } from './sandboxArtifacts';
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
  graphqlClient,
  sandboxId,
  logger,
}: {
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  graphqlClient: Client;
  sandboxId: string;
  logger: bunyan;
}): {
  commandImplementations: SandboxDaemonCommandImplementations;
  stoppedPromise: Promise<void>;
} {
  const sessions = new ShellSessionManager({ workingDirectory, env, signal });
  const artifactUploads = new SandboxArtifactUploadManager({
    graphqlClient,
    sandboxId,
    logger,
    signal,
  });
  const stoppedPromise = Promise.all([
    sessions.stoppedPromise,
    artifactUploads.stoppedPromise,
  ]).then(() => {});
  stoppedPromise.catch(() => {});
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
        const file = await openFileAsync(filePath);
        try {
          const stats = await file.stat();
          if (!stats.isFile()) {
            throw new SandboxDaemonError(
              SandboxDaemonErrorCode.BAD_REQUEST,
              `${filePath} is not a regular file.`
            );
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
      async uploadArtifact(params) {
        const id = await artifactUploads.startAsync({
          filePath: path.resolve(workingDirectory, params.path),
          name: params.name,
        });
        return { id };
      },
    },
    stoppedPromise,
  };
}

async function openFileAsync(filePath: string): Promise<FileHandle> {
  try {
    return await fs.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new SandboxDaemonError(
        SandboxDaemonErrorCode.BAD_REQUEST,
        `File does not exist: ${filePath}`
      );
    }
    if (error?.code === 'EACCES') {
      throw new SandboxDaemonError(
        SandboxDaemonErrorCode.BAD_REQUEST,
        `File is not accessible: ${filePath}`
      );
    }
    throw error;
  }
}
