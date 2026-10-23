import os from 'node:os';
import path from 'node:path';

import { type ChildProcessHandle, commands } from './processes';

export function setArgentEnvironmentDefaults(): void {
  process.env.ARGENT_EVENT_LOG ||= path.join(os.homedir(), '.argent/tool-server-events.jsonl');
  process.env.ARGENT_EMULATOR_NO_WINDOW ||= '1';
}

export async function prepareArgentEnvironmentAsync(signal: AbortSignal): Promise<void> {
  const argentPackage = `@swmansion/argent@${process.env.ARGENT_VERSION || 'latest'}`;

  signal.throwIfAborted();
  try {
    await commands.runAsync('ffmpeg', ['-version'], signal).catch(async error => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      signal.throwIfAborted();
      await commands.runAsync(
        '/usr/bin/env',
        ['HOMEBREW_NO_AUTO_UPDATE=1', 'brew', 'install', 'ffmpeg'],
        signal
      );
      signal.throwIfAborted();
      await commands.runAsync('ffmpeg', ['-version'], signal);
    });
  } catch (error) {
    signal.throwIfAborted();
    process.stderr.write(`Could not prepare ffmpeg; video tools may be unavailable: ${error}\n`);
  }
  commands.throwIfCommandCloseTimedOut();

  for (const [verb, flag] of [
    ['enable', 'artifacts-list-endpoint'],
    ['enable', 'tool-server-event-log'],
    ['disable', 'video-watermark'],
  ]) {
    signal.throwIfAborted();
    await commands.runAsync('bunx', [argentPackage, verb, flag], signal).catch(error => {
      if (verb !== 'disable') {
        throw error;
      }
    });
  }
  signal.throwIfAborted();
}

export function startArgentServer(signal: AbortSignal): ChildProcessHandle {
  signal.throwIfAborted();
  return commands.start('bunx', [
    `@swmansion/argent@${process.env.ARGENT_VERSION || 'latest'}`,
    'server',
    'start',
    '--host',
    '127.0.0.1',
    '--port',
    '3201',
    '--idle-timeout',
    '0',
  ]);
}
