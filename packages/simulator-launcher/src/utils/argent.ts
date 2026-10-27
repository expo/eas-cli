import os from 'node:os';
import path from 'node:path';

import { type ChildProcessHandle, commands, stopProcessAndDescendantsAsync } from './processes';
import { type WarmTool } from './tools';

const packageSpec = (): string => `@swmansion/argent@${process.env.ARGENT_VERSION || 'latest'}`;

export function createArgentTool(): WarmTool {
  process.env.ARGENT_EVENT_LOG ||= path.join(os.homedir(), '.argent/tool-server-events.jsonl');
  process.env.ARGENT_EMULATOR_NO_WINDOW ||= '1';
  let serverProcess: ChildProcessHandle | undefined;
  return {
    name: 'argent',
    async prepareAsync(signal) {
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
        await commands.runAsync('bunx', [packageSpec(), verb, flag], signal).catch(error => {
          if (verb !== 'disable') {
            throw error;
          }
        });
      }
      signal.throwIfAborted();
    },
    async startAsync(_udid, signal) {
      signal.throwIfAborted();
      serverProcess = commands.start('bunx', [
        packageSpec(),
        'server',
        'start',
        '--host',
        '127.0.0.1',
        '--port',
        '3201',
        '--idle-timeout',
        '0',
      ]);
    },
    async stopAsync() {
      if (serverProcess) {
        await stopProcessAndDescendantsAsync(serverProcess);
        serverProcess = undefined;
      }
    },
  };
}
