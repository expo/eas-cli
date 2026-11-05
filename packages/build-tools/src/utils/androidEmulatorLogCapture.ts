import fs from 'node:fs';
import { type Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { Sentry } from '../sentry';
import { type AndroidEmulatorLogSource } from './androidEmulatorLogSources';
import { createAndroidLogcatPipeAsync } from './androidLogcatPipe';

export const MAX_ANDROID_LOG_BYTES_PER_SOURCE = 20 * 1024 * 1024;

export type FinalizedAndroidEmulatorLog = {
  readonly filePath: string;
  readonly source: AndroidEmulatorLogSource;
  readonly bytesSeen: number;
};

type Capture = {
  source: AndroidEmulatorLogSource;
  stream: Writable;
  inputs: Set<Readable>;
  done: Promise<void>;
  bytesSeen: number;
};

/** One budget per workflow, shared by all emulator launches and retries. */
export class AndroidEmulatorLogCapture {
  private readonly bytes = new Map<AndroidEmulatorLogSource, number>();
  private readonly captures = new Map<string, Capture>();
  private finishing = false;

  constructor(private readonly maxBytes = MAX_ANDROID_LOG_BYTES_PER_SOURCE) {}

  attach(input: Readable, filePath: string, source: AndroidEmulatorLogSource): void {
    if (this.finishing) {
      input.resume();
      return;
    }
    let capture = this.captures.get(filePath);
    if (!capture) {
      const file = fs.promises.open(filePath, 'a');
      // Handle open errors even if the process never produces output.
      void file.catch(() => {});
      let failed = false;
      const report = (err: unknown): void => {
        if (!failed) {
          failed = true;
          Sentry.capture(
            'Failed to write Android diagnostic log',
            err instanceof Error ? err : new Error(String(err)),
            {
              level: 'warning',
              extras: { filePath, source },
            }
          );
        }
      };
      const record = { source, inputs: new Set<Readable>(), bytesSeen: 0 };
      const stream = new Writable({
        write: (chunk: Buffer, _encoding, callback) => {
          record.bytesSeen += chunk.length;
          const used = this.bytes.get(source) ?? 0;
          const length = Math.min(chunk.length, this.maxBytes - used);
          if (failed || length <= 0) {
            callback();
            return;
          }
          // Reserve before awaiting I/O so concurrent launches share the same cap.
          this.bytes.set(source, used + length);
          void file
            .then(handle => handle.writeFile(chunk.subarray(0, length)))
            .catch(report)
            .then(() => callback());
        },
        final: callback => {
          void file
            .then(handle => handle.close())
            .catch(report)
            .then(() => callback());
        },
      });
      capture = Object.assign(record, { stream, done: finished(stream) });
      this.captures.set(filePath, capture);
    }
    capture.inputs.add(input);
    input.pipe(capture.stream, { end: false });
  }

  async finishFileAsync(filePath: string): Promise<void> {
    const capture = this.captures.get(filePath);
    if (!capture) {
      return;
    }
    for (const input of capture.inputs) {
      input.unpipe(capture.stream);
      // Keep draining: closing a full log must never block or break the emulator.
      input.resume();
    }
    capture.inputs.clear();
    capture.stream.end();
    await capture.done;
  }

  async finishAsync(): Promise<readonly FinalizedAndroidEmulatorLog[]> {
    this.finishing = true;
    await Promise.all([...this.captures.keys()].map(file => this.finishFileAsync(file)));
    // Every writer is closed, so uploads can reopen these files on each retry.
    return [...this.captures].map(([filePath, { source, bytesSeen }]) => ({
      filePath,
      source,
      bytesSeen,
    }));
  }

  /** Select the output transport without exposing the capture budget to emulator launch. */
  async prepareLogcatOutputAsync(
    filePath: string
  ): Promise<{ path: string; close: () => void; closed: Promise<void> }> {
    // Ordinary builds retain the emulator's direct, uncapped logcat file writer.
    if (!Number.isFinite(this.maxBytes)) {
      return { path: filePath, close: () => {}, closed: Promise.resolve() };
    }
    const pipe = await createAndroidLogcatPipeAsync(`${filePath}.pipe`);
    this.attach(pipe.stream, filePath, 'device-logcat');
    const closed = pipe.closed.then(() => this.finishFileAsync(filePath)).catch(() => {});
    return { path: pipe.path, close: pipe.close, closed };
  }
}
