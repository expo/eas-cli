import fs from 'node:fs';
import { type FileHandle } from 'node:fs/promises';
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

/**
 * One file is a ring of `maxBytes` bytes: `writePos` wraps and the newest
 * `retained` bytes end at it. Sealing rewrites the file in log order.
 */
type Capture = {
  source: AndroidEmulatorLogSource;
  file: Promise<FileHandle>;
  stream: Writable;
  inputs: Set<Readable>;
  done: Promise<void>;
  report: (err: unknown) => void;
  bytesSeen: number;
  writePos: number;
  retained: number;
  idle: boolean;
};

/**
 * One budget per workflow, shared by all emulator launches and retries.
 *
 * A source keeps the last `maxBytes` bytes it produced, across files. The
 * oldest bytes go first, so an earlier launch gives up its head to a later
 * one and the final attempt always keeps its tail, where failures explain
 * themselves. Files are ordered by attach time; simultaneous captures evict
 * in that order rather than by exact write time.
 */
export class AndroidEmulatorLogCapture {
  private readonly sources = new Map<AndroidEmulatorLogSource, Capture[]>();
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
      capture = this.open(filePath, source);
      this.captures.set(filePath, capture);
      const list = this.sources.get(source) ?? [];
      list.push(capture);
      this.sources.set(source, list);
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
    await Promise.all([...this.captures.values()].map(capture => this.sealAsync(capture)));
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

  private open(filePath: string, source: AndroidEmulatorLogSource): Capture {
    const file = fs.promises.open(filePath, 'w+');
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
    const record = {
      source,
      file,
      inputs: new Set<Readable>(),
      report,
      bytesSeen: 0,
      writePos: 0,
      retained: 0,
      idle: false,
    };
    const stream = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        record.bytesSeen += chunk.length;
        if (failed) {
          callback();
          return;
        }
        const max = this.maxBytes;
        const data = chunk.length > max ? chunk.subarray(chunk.length - max) : chunk;
        const position = record.writePos;
        const head = Math.min(data.length, max - position);
        // Account before awaiting I/O so concurrent launches share the same cap.
        record.writePos = (position + data.length) % max;
        record.retained = Math.min(record.retained + data.length, max);
        this.evict(source);
        void file
          .then(async handle => {
            await writeAtAsync(handle, data.subarray(0, head), position);
            await writeAtAsync(handle, data.subarray(head), 0);
          })
          .catch(report)
          .then(() => callback());
      },
      final: callback => {
        record.idle = true;
        callback();
      },
    });
    return Object.assign(record, { stream, done: finished(stream) });
  }

  /** Drop the oldest bytes of a source until its files fit the budget together. */
  private evict(source: AndroidEmulatorLogSource): void {
    const list = this.sources.get(source) ?? [];
    let excess = list.reduce((sum, capture) => sum + capture.retained, 0) - this.maxBytes;
    for (const capture of list) {
      if (excess <= 0) {
        return;
      }
      const dropped = Math.min(capture.retained, excess);
      capture.retained -= dropped;
      excess -= dropped;
      if (capture.retained === 0 && capture.idle) {
        // Nothing of this file survives and no write is in flight: free the disk now.
        void capture.file.then(handle => handle.truncate(0)).catch(capture.report);
      }
    }
  }

  /** Rewrite the ring in log order, drop evicted bytes, and close the file. */
  private async sealAsync(capture: Capture): Promise<void> {
    try {
      const handle = await capture.file;
      const { retained } = capture;
      let start = capture.writePos - retained;
      if (start < 0) {
        start += this.maxBytes;
      }
      if (start > 0) {
        const tail = Buffer.alloc(retained);
        const head = Math.min(retained, this.maxBytes - start);
        await readAtAsync(handle, tail.subarray(0, head), start);
        await readAtAsync(handle, tail.subarray(head), 0);
        await writeAtAsync(handle, tail, 0);
      }
      await handle.truncate(retained);
      await handle.close();
    } catch (err) {
      capture.report(err);
    }
  }
}

async function writeAtAsync(handle: FileHandle, data: Buffer, position: number): Promise<void> {
  for (let offset = 0; offset < data.length; ) {
    const { bytesWritten } = await handle.write(
      data,
      offset,
      data.length - offset,
      position + offset
    );
    offset += bytesWritten;
  }
}

async function readAtAsync(handle: FileHandle, into: Buffer, position: number): Promise<void> {
  for (let offset = 0; offset < into.length; ) {
    const { bytesRead } = await handle.read(into, offset, into.length - offset, position + offset);
    if (bytesRead === 0) {
      throw new Error(`Android diagnostic log ended before offset ${position + into.length}`);
    }
    offset += bytesRead;
  }
}
