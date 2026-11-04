import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { Socket } from 'node:net';
import { type Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';

import { Sentry } from '../sentry';
import { type AndroidEmulatorLogSource } from './androidEmulatorLogSources';

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
      const stream = new Writable({
        write: (chunk: Buffer, _encoding, callback) => {
          capture!.bytesSeen += chunk.length;
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
      capture = { source, stream, inputs: new Set(), done: finished(stream), bytesSeen: 0 };
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

  /** Keep logcat separate from emulator stderr without an unbounded intermediate file. */
  async createLogcatPipeAsync(
    filePath: string
  ): Promise<{ path: string; close: () => void; closed: Promise<void> }> {
    const pipePath = `${filePath}.pipe`;
    await promisify(execFile)('mkfifo', ['-m', '600', pipePath]);
    // The sentinel keeps the FIFO open before emulator launch. The reader signals
    // after opening it, so even a failed launch can close the pipe without a race.
    const sentinel = fs.openSync(pipePath, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    let sentinelOpen = true;
    const close = (): void => {
      if (sentinelOpen) {
        sentinelOpen = false;
        fs.closeSync(sentinel);
      }
    };
    const reader = spawn(
      'sh',
      ['-c', 'exec 3<"$1" || exit 1; printf ready >&2; exec cat <&3', 'android-logcat', pipePath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const ready = new Promise<void>((resolve, reject) => {
      reader.once('error', reject);
      reader.once('exit', () =>
        reject(new Error('Android logcat reader exited before opening its pipe.'))
      );
      reader.stderr.once('data', () => resolve());
    });
    this.attach(reader.stdout, filePath, 'device-logcat');
    reader.on('error', err => {
      close();
      Sentry.capture('Failed to read Android logcat pipe', err, { level: 'warning' });
    });
    const closed = new Promise<void>(resolve => {
      reader.once('close', () => {
        close();
        void this.finishFileAsync(filePath)
          .then(() => fs.promises.rm(pipePath, { force: true }))
          .catch(() => {})
          .then(resolve);
      });
    });
    try {
      await ready;
    } catch (err) {
      close();
      reader.kill();
      await closed;
      throw err;
    }
    reader.unref();
    for (const stream of [reader.stdout, reader.stderr]) {
      if (stream instanceof Socket) {
        stream.unref();
      }
    }
    return { path: pipePath, close, closed };
  }
}
