import fs from 'node:fs';
import { type Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { Sentry } from '../sentry';
import {
  type AndroidEmulatorLogCapture,
  type AndroidLogcatOutput,
  type FinalizedAndroidEmulatorLog,
} from './androidEmulatorLogCapture';
import { type AndroidEmulatorLogSource } from './androidEmulatorLogSources';

type LaunchFile = { stream: fs.WriteStream; inputs: Set<Readable> };

/**
 * Ordinary builds: one plain file per launch, appended without a budget and
 * closed when the launch ends. The emulator writes logcat to its file directly.
 * Nothing is finalized or uploaded.
 */
export class AndroidEmulatorLogFiles implements AndroidEmulatorLogCapture {
  readonly sources: readonly AndroidEmulatorLogSource[];
  private readonly files = new Map<string, LaunchFile>();

  constructor({ sources }: { sources: readonly AndroidEmulatorLogSource[] }) {
    this.sources = sources;
  }

  attach(input: Readable, filePath: string, source: AndroidEmulatorLogSource): void {
    let file = this.files.get(filePath);
    if (!file) {
      const inputs = new Set<Readable>();
      const stream = fs.createWriteStream(filePath, { flags: 'a' });
      stream.once('error', err => {
        Sentry.capture('Failed to write Android diagnostic log', err, {
          level: 'warning',
          extras: { filePath, source },
        });
        // The pipe detaches on error; keep draining so the emulator never blocks.
        for (const attached of inputs) {
          attached.resume();
        }
      });
      file = { stream, inputs };
      this.files.set(filePath, file);
    }
    file.inputs.add(input);
    input.pipe(file.stream, { end: false });
  }

  async finishFileAsync(filePath: string): Promise<void> {
    const file = this.files.get(filePath);
    if (!file) {
      return;
    }
    for (const input of file.inputs) {
      input.unpipe(file.stream);
      input.resume();
    }
    file.inputs.clear();
    file.stream.end();
    // A write error was reported when it happened.
    await finished(file.stream).catch(() => {});
  }

  async finishAsync(): Promise<readonly FinalizedAndroidEmulatorLog[]> {
    await Promise.all([...this.files.keys()].map(file => this.finishFileAsync(file)));
    return [];
  }

  async prepareLogcatOutputAsync(filePath: string): Promise<AndroidLogcatOutput> {
    await fs.promises.writeFile(filePath, '');
    return { path: filePath, close: () => {}, closed: Promise.resolve() };
  }
}
