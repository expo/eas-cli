import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

import {
  type ChildProcessHandle,
  commands,
  isProcessOwnedByServiceAsync,
  stopProcessAndDescendantsAsync,
} from './processes';
import { type WarmTool } from './tools';

const packageSpec = (): string => `@swmansion/argent@${process.env.ARGENT_VERSION || 'latest'}`;

const ArgentStateSchema = z.object({
  pid: z.number().int().min(2),
  port: z.literal(3201),
  token: z.string().min(1),
});
const ToolsSchema = z.object({ tools: z.array(z.unknown()) });

export function createArgentTool(onUnexpectedExit: (error: unknown) => void): WarmTool {
  process.env.ARGENT_EVENT_LOG ||= path.join(os.homedir(), '.argent/tool-server-events.jsonl');
  process.env.ARGENT_EMULATOR_NO_WINDOW ||= '1';
  let serverProcess: ChildProcessHandle | undefined;
  let stopping = false;
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
      stopping = false;
      serverProcess = commands.start(
        'bunx',
        [
          packageSpec(),
          'server',
          'start',
          '--host',
          '127.0.0.1',
          '--port',
          '3201',
          '--idle-timeout',
          '0',
        ],
        undefined,
        false,
        /* detached */ true
      );
      const server = serverProcess;
      let ready = false;
      let failure: Error | undefined;
      const recordExit = (cause?: unknown): void => {
        if (failure) {
          return;
        }
        failure = new Error(
          ready
            ? 'Argent server exited unexpectedly.'
            : 'Argent exited before its server became ready.',
          { cause }
        );
        if (ready && !stopping && !signal.aborted) {
          onUnexpectedExit(failure);
        }
      };
      server.child.once('exit', () => recordExit());
      server.child.once('error', recordExit);
      void server.resultPromise.then(() => recordExit(), recordExit);
      const stateDirectory = path.join(os.homedir(), '.argent');
      const deadline = Date.now() + 120_000;
      for (;;) {
        signal.throwIfAborted();
        if (failure) {
          throw failure;
        }
        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for the Argent server on port 3201 to become ready.');
        }
        const entries = await fs.readdir(stateDirectory).catch(() => []);
        for (const entry of entries) {
          if (!/^tool-server.*\.json$/.test(entry)) {
            continue;
          }
          const state = await fs
            .readFile(path.join(stateDirectory, entry), 'utf8')
            .then(contents => ArgentStateSchema.parse(JSON.parse(contents)))
            .catch(() => undefined);
          if (!state || !(await isProcessOwnedByServiceAsync(state.pid, server.child, signal))) {
            continue;
          }
          const tools = await fetch('http://127.0.0.1:3201/tools', {
            headers: { Authorization: `Bearer ${state.token}` },
            signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
          })
            .then(async response =>
              response.ok ? ToolsSchema.safeParse(await response.json()).success : false
            )
            .catch(() => false);
          signal.throwIfAborted();
          if (failure) {
            throw failure;
          }
          if (tools && (await isProcessOwnedByServiceAsync(state.pid, server.child, signal))) {
            signal.throwIfAborted();
            if (failure) {
              throw failure;
            }
            ready = true;
            return;
          }
        }
        await sleepAsync(250, undefined, { signal });
      }
    },
    async stopAsync() {
      stopping = true;
      if (serverProcess) {
        await stopProcessAndDescendantsAsync(serverProcess);
        serverProcess = undefined;
      }
    },
  };
}
