import os from 'node:os';
import path from 'node:path';

import { type ChildProcessHandle, commands } from './processes';

export function setAgentDeviceEnvironmentDefaults(): void {
  process.env.AGENT_DEVICE_STATE_DIR ||= path.join(
    os.homedir(),
    'Library/Caches/expo-simulator-startup/agent-device'
  );
  process.env.AGENT_DEVICE_RETAIN_ARTIFACTS ||= '1';
  process.env.AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS ||= '0';
  process.env.AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS ||= '0';
  process.env.AGENT_DEVICE_IOS_RUNNER_DETACH ||= '0';
}

export function startAgentDevicePreparation(udid: string, signal: AbortSignal): ChildProcessHandle {
  signal.throwIfAborted();
  return commands.start('bunx', [
    `agent-device@${process.env.AGENT_DEVICE_VERSION || 'latest'}`,
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
  ]);
}

export async function stopAgentDeviceDaemonAsync(): Promise<void> {
  await commands.runAsync('bunx', [
    `agent-device@${process.env.AGENT_DEVICE_VERSION || 'latest'}`,
    'daemon',
    'stop',
    '--clean',
    '--state-dir',
    process.env.AGENT_DEVICE_STATE_DIR!,
  ]);
}
