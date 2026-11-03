import os from 'node:os';
import path from 'node:path';

import { type ChildProcessHandle, commands, stopProcessAndDescendantsAsync } from './processes';
import { type WarmTool, untilAbortedAsync } from './tools';

const packageSpec = (): string => `agent-device@${process.env.AGENT_DEVICE_VERSION || 'latest'}`;

/** `prepare ios-runner` builds and starts the runner and its daemon; it exits once both are up. */
export function createAgentDeviceTool(): WarmTool {
  const stateDir = (process.env.AGENT_DEVICE_STATE_DIR ||= path.join(
    os.homedir(),
    'Library/Caches/expo-simulator-startup/agent-device'
  ));
  process.env.AGENT_DEVICE_RETAIN_ARTIFACTS ||= '1';
  process.env.AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS ||= '0';
  process.env.AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS ||= '0';
  process.env.AGENT_DEVICE_IOS_RUNNER_DETACH ||= '0';
  let prepareProcess: ChildProcessHandle | undefined;
  return {
    name: 'agent-device',
    async startAsync(udid, signal) {
      signal.throwIfAborted();
      prepareProcess = commands.start(
        'bunx',
        [
          packageSpec(),
          'prepare',
          'ios-runner',
          '--platform',
          'ios',
          '--udid',
          udid,
          '--daemon-server-mode',
          'http',
          '--daemon-transport',
          'http',
          '--timeout',
          '240000',
          '--json',
        ],
        { detached: true }
      );
      await untilAbortedAsync(prepareProcess.resultPromise, signal);
    },
    async stopAsync() {
      const errors: unknown[] = [];
      if (prepareProcess) {
        await stopProcessAndDescendantsAsync(prepareProcess, /* allowCompletedProcess */ true).then(
          () => (prepareProcess = undefined),
          error => errors.push(error)
        );
      }
      // The daemon outlives the prepare process, so it stops even if the prepare stop failed.
      // A stop that cannot finish fails instead of blocking cleanup forever.
      await commands
        .runAsync(
          'bunx',
          [packageSpec(), 'daemon', 'stop', '--clean', '--state-dir', stateDir],
          AbortSignal.timeout(120_000)
        )
        .catch(error => errors.push(error));
      if (errors.length > 1) {
        throw new AggregateError(errors, 'agent-device could not be stopped.');
      }
      if (errors.length) {
        throw errors[0];
      }
    },
  };
}
