import {
  type SandboxDaemonCommandParams,
  type SandboxDaemonCommandResult,
  type SandboxDaemonMethod,
} from '@expo/eas-build-job';
import { performance } from 'node:perf_hooks';

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
    },
    stoppedPromise: sessions.stoppedPromise,
  };
}
