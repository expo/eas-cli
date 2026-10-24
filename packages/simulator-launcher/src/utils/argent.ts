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
  // The VM image provides ffmpeg; installing it here would delay every warm session.
  await commands.runAsync('ffmpeg', ['-version'], signal).catch(error => {
    signal.throwIfAborted();
    process.stderr.write(`ffmpeg is unavailable; Argent video tools may not work: ${error}\n`);
  });
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
