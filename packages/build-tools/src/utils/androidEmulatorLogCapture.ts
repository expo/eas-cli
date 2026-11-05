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

export type AndroidLogcatOutput = {
  /** Where the emulator writes its logcat: a FIFO for sessions, the file itself for builds. */
  path: string;
  close: () => void;
  /**
   * Resolves once the pipe reader exited and the FIFO is removed. Emulator
   * launch does not wait for it, because the emulator can outlive log
   * collection; tests use it to observe the cleanup.
   */
  closed: Promise<void>;
};

/** Records emulator output per launch file; `getAndroidEmulatorLogCapture` picks the writer. */
export type AndroidEmulatorLogCapture = {
  readonly sources: readonly AndroidEmulatorLogSource[];
  attach(input: Readable, filePath: string, source: AndroidEmulatorLogSource): void;
  finishFileAsync(filePath: string): Promise<void>;
  finishAsync(): Promise<readonly FinalizedAndroidEmulatorLog[]>;
  prepareLogcatOutputAsync(filePath: string): Promise<AndroidLogcatOutput>;
};

/** One ring of `maxBytes` bytes: `writePos` wraps and the newest `retained` bytes end at it. */
type Ring = {
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
  ring: Ring;
  stream: Writable;
  inputs: Set<Readable>;
  done: Promise<void>;
};

/**
 * One budget per session, shared by all emulator launches and retries.
 *
 * Each source has one ring file, `<source>.log` beside the launch files, so
 * the last `maxBytes` bytes of a source survive across launches and the tail
 * of the final attempt is always kept. A marker line names each launch that
 * produced output. Overlapping launches share the ring, so their lines can
 * interleave. Logcat arrives through a named pipe so the budget applies to it.
 */
export class AndroidEmulatorLogRing implements AndroidEmulatorLogCapture {
  readonly sources: readonly AndroidEmulatorLogSource[];
  private readonly maxBytes: number;
  private readonly rings = new Map<AndroidEmulatorLogSource, Ring>();
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

  attach(input: Readable, filePath: string, source: AndroidEmulatorLogSource): void {
    if (this.finishing) {
      input.resume();
      return;
    }
    let launch = this.launches.get(filePath);
    if (!launch) {
      launch = this.startLaunch(filePath, this.ringFor(filePath, source));
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
  }

  async finishAsync(): Promise<readonly FinalizedAndroidEmulatorLog[]> {
    this.finishing = true;
    await Promise.all([...this.launches.keys()].map(file => this.finishFileAsync(file)));
    await Promise.all([...this.rings.values()].map(ring => this.sealAsync(ring)));
    // Every writer is closed, so uploads can reopen these files on each retry.
    return [...this.rings.values()].map(({ filePath, source, bytesSeen }) => ({
      filePath,
      source,
      bytesSeen,
    }));
  }

  async prepareLogcatOutputAsync(filePath: string): Promise<AndroidLogcatOutput> {
    const pipe = await createAndroidLogcatPipeAsync(`${filePath}.pipe`);
    this.attach(pipe.stream, filePath, 'device-logcat');
    const closed = pipe.closed.then(() => this.finishFileAsync(filePath)).catch(() => {});
    return { path: pipe.path, close: pipe.close, closed };
  }

  private ringFor(filePath: string, source: AndroidEmulatorLogSource): Ring {
    let ring = this.rings.get(source);
    if (!ring) {
      ring = this.open(path.join(path.dirname(filePath), `${source}.log`), source);
      this.rings.set(source, ring);
    }
    return ring;
  }

  private open(filePath: string, source: AndroidEmulatorLogSource): Ring {
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

  private startLaunch(filePath: string, ring: Ring): Launch {
    let marked = false;
    const stream = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        if (!marked) {
          marked = true;
          // Written before the first chunk only, so a silent launch leaves no trace.
          const name = path.basename(filePath, '.log');
          const marker = `==== ${name} ${new Date().toISOString()} ====\n`;
          void this.write(ring, Buffer.from(ring.bytesSeen > 0 ? `\n${marker}` : marker));
        }
        void this.write(ring, chunk).then(() => callback());
      },
    });
    return { ring, stream, inputs: new Set(), done: finished(stream) };
  }

  /** Account synchronously, then queue the I/O, so overlapping launches share one ring consistently. */
  private write(ring: Ring, chunk: Buffer): Promise<void> {
    const max = this.maxBytes;
    ring.bytesSeen += chunk.length;
    const data = chunk.length > max ? chunk.subarray(chunk.length - max) : chunk;
    const position = ring.writePos;
    const head = Math.min(data.length, max - position);
    ring.writePos = (position + data.length) % max;
    ring.retained = Math.min(ring.retained + data.length, max);
    return ring.run(async handle => {
      await writeAtAsync(handle, data.subarray(0, head), position);
      await writeAtAsync(handle, data.subarray(head), 0);
    });
  }

  /** Rewrite the ring in log order, drop the overwritten bytes, and close the file. */
  private sealAsync(ring: Ring): Promise<void> {
    ring.sealed ??= ring.run(async handle => {
      try {
        const { retained } = ring;
        let start = ring.writePos - retained;
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
      } finally {
        await handle.close();
      }
    });
    return ring.sealed;
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
