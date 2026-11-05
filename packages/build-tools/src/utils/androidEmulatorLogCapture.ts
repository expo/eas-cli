import fs from 'node:fs';
import { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
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
 * One output file. Capped, it is a ring of `maxBytes` bytes: `writePos` wraps
 * and the newest `retained` bytes end at it. Uncapped, it is a plain append.
 */
type Output = {
  filePath: string;
  source: AndroidEmulatorLogSource;
  /** Runs one file operation after every earlier one on the same handle. */
  run: (operation: (handle: FileHandle) => Promise<void>) => Promise<void>;
  sealed?: Promise<void>;
  bytesSeen: number;
  writePos: number;
  retained: number;
};

/** One emulator launch. Launches of a source can overlap: clones, or a late exit. */
type Launch = {
  output: Output;
  stream: Writable;
  inputs: Set<Readable>;
  done: Promise<void>;
};

/**
 * One budget per workflow, shared by all emulator launches and retries.
 *
 * Sessions (capped) keep one ring file per source, `<source>.log` beside the
 * launch files, so the last `maxBytes` bytes of a source survive across
 * launches and the tail of the final attempt is always kept. A marker line
 * names each launch that produced output. Overlapping launches share the ring,
 * so their lines can interleave.
 *
 * Ordinary builds (uncapped) keep one plain file per launch, closed when the
 * launch ends, and never finalize anything.
 */
export class AndroidEmulatorLogCapture {
  readonly sources: readonly AndroidEmulatorLogSource[];
  private readonly maxBytes: number;
  /** Keyed by source when capped, by launch file otherwise. */
  private readonly outputs = new Map<string, Output>();
  private readonly launches = new Map<string, Launch>();
  private finishing = false;

  constructor({
    sources,
    maxBytes = MAX_ANDROID_LOG_BYTES_PER_SOURCE,
  }: {
    sources: readonly AndroidEmulatorLogSource[];
    maxBytes?: number;
  }) {
    this.sources = sources;
    this.maxBytes = maxBytes;
  }

  private get capped(): boolean {
    return Number.isFinite(this.maxBytes);
  }

  attach(input: Readable, filePath: string, source: AndroidEmulatorLogSource): void {
    if (this.finishing) {
      input.resume();
      return;
    }
    let launch = this.launches.get(filePath);
    if (!launch) {
      launch = this.startLaunch(filePath, this.outputFor(filePath, source));
      this.launches.set(filePath, launch);
    }
    launch.inputs.add(input);
    input.pipe(launch.stream, { end: false });
  }

  async finishFileAsync(filePath: string): Promise<void> {
    const launch = this.launches.get(filePath);
    if (!launch) {
      return;
    }
    for (const input of launch.inputs) {
      input.unpipe(launch.stream);
      // Keep draining: closing a full log must never block or break the emulator.
      input.resume();
    }
    launch.inputs.clear();
    launch.stream.end();
    await launch.done;
    // An uncapped output belongs to this launch alone: release it now.
    if (!this.capped) {
      await this.sealAsync(launch.output);
    }
  }

  async finishAsync(): Promise<readonly FinalizedAndroidEmulatorLog[]> {
    this.finishing = true;
    await Promise.all([...this.launches.keys()].map(file => this.finishFileAsync(file)));
    await Promise.all([...this.outputs.values()].map(output => this.sealAsync(output)));
    if (!this.capped) {
      return [];
    }
    // Every writer is closed, so uploads can reopen these files on each retry.
    return [...this.outputs.values()].map(({ filePath, source, bytesSeen }) => ({
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
    if (!this.capped) {
      await fs.promises.writeFile(filePath, '');
      return { path: filePath, close: () => {}, closed: Promise.resolve() };
    }
    const pipe = await createAndroidLogcatPipeAsync(`${filePath}.pipe`);
    this.attach(pipe.stream, filePath, 'device-logcat');
    const closed = pipe.closed.then(() => this.finishFileAsync(filePath)).catch(() => {});
    return { path: pipe.path, close: pipe.close, closed };
  }

  private outputFor(filePath: string, source: AndroidEmulatorLogSource): Output {
    const key = this.capped ? source : filePath;
    let output = this.outputs.get(key);
    if (!output) {
      const outputPath = this.capped
        ? path.join(path.dirname(filePath), `${source}.log`)
        : filePath;
      output = this.open(outputPath, source);
      this.outputs.set(key, output);
    }
    return output;
  }

  private open(filePath: string, source: AndroidEmulatorLogSource): Output {
    const file = fs.promises.open(filePath, this.capped ? 'w+' : 'a');
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
    let queue: Promise<void> = Promise.resolve();
    const run = (operation: (handle: FileHandle) => Promise<void>): Promise<void> => {
      queue = queue
        .then(() => file)
        .then(operation)
        .catch(report);
      return queue;
    };
    return { filePath, source, run, bytesSeen: 0, writePos: 0, retained: 0 };
  }

  private startLaunch(filePath: string, output: Output): Launch {
    let marked = !this.capped;
    const stream = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        if (!marked) {
          marked = true;
          // Written before the first chunk only, so a silent launch leaves no trace.
          const name = path.basename(filePath, '.log');
          const marker = `==== ${name} ${new Date().toISOString()} ====\n`;
          void this.write(output, Buffer.from(output.bytesSeen > 0 ? `\n${marker}` : marker));
        }
        void this.write(output, chunk).then(() => callback());
      },
    });
    return { output, stream, inputs: new Set(), done: finished(stream) };
  }

  /** Account synchronously, then queue the I/O, so overlapping launches share one ring consistently. */
  private write(output: Output, chunk: Buffer): Promise<void> {
    output.bytesSeen += chunk.length;
    if (!this.capped) {
      return output.run(handle => handle.writeFile(chunk));
    }
    const max = this.maxBytes;
    const data = chunk.length > max ? chunk.subarray(chunk.length - max) : chunk;
    const position = output.writePos;
    const head = Math.min(data.length, max - position);
    output.writePos = (position + data.length) % max;
    output.retained = Math.min(output.retained + data.length, max);
    return output.run(async handle => {
      await writeAtAsync(handle, data.subarray(0, head), position);
      await writeAtAsync(handle, data.subarray(head), 0);
    });
  }

  /** Rewrite a ring in log order, drop the overwritten bytes, and close the file. */
  private sealAsync(output: Output): Promise<void> {
    output.sealed ??= output.run(async handle => {
      try {
        if (this.capped) {
          const { retained } = output;
          let start = output.writePos - retained;
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
        }
      } finally {
        await handle.close();
      }
    });
    return output.sealed;
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
