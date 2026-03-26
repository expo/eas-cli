import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import fetch from 'node-fetch';
import { Writable } from 'stream';

import { retry } from './retry';

const MAX_BATCH_BYTES = 200_000;

interface BufferedLogEntry {
  enqueuedAt: number;
  serialized: string;
}

/**
 * A bunyan-compatible writable stream for sending logs over HTTP.
 */
export default class HttpLogStream extends Writable {
  public writable = true;

  private readonly buffer: BufferedLogEntry[] = [];
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly logger: bunyan;
  private readonly maxBatchBytes: number;
  private readonly bufferRetentionMs: number | null;
  private inFlightRequest: Promise<void> | null = null;

  constructor({
    url,
    headers,
    logger,
    maxBatchBytes = MAX_BATCH_BYTES,
    bufferRetentionMs = null,
  }: {
    url: string;
    headers: Record<string, string>;
    logger: bunyan;
    maxBatchBytes?: number;
    bufferRetentionMs?: number | null;
  }) {
    super({ objectMode: true });
    this.url = url;
    this.headers = headers;
    this.logger = logger;
    this.maxBatchBytes = maxBatchBytes;
    this.bufferRetentionMs = bufferRetentionMs;
  }

  public override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (typeof chunk !== 'object' || chunk === null) {
      callback(new Error('Invalid log entry: expected an object'));
      return;
    }

    this.trimExpiredBufferedLogs();
    this.buffer.push({
      enqueuedAt: Date.now(),
      serialized: JSON.stringify(chunk),
    });
    this.flush();
    callback();
  }

  public async cleanUp(): Promise<void> {
    this.writable = false;
    await this.flush({ isCleanup: true });
  }

  private flush({ isCleanup = false }: { isCleanup?: boolean } = {}): Promise<void> | void {
    if (this.inFlightRequest) {
      if (isCleanup) {
        return this.inFlightRequest.then(() => {
          if (this.buffer.length > 0) {
            return this.flush({ isCleanup: true });
          }
        });
      }
      return;
    }

    if (this.buffer.length === 0) {
      return;
    }

    this.trimExpiredBufferedLogs();
    if (this.buffer.length === 0) {
      return;
    }

    const batch = this.takeBatch();
    this.inFlightRequest = this.sendBatch(batch)
      .catch(err => {
        if (!isCleanup) {
          // Keep logs in memory if upload fails so a later flush can retry.
          this.buffer.unshift(...batch);
          this.logger.error({ err }, 'Failed to send logs batch over HTTP');
        }
      })
      .finally(() => {
        this.inFlightRequest = null;
      });

    if (isCleanup) {
      return this.inFlightRequest.then(() => {
        if (this.buffer.length > 0) {
          return this.flush({ isCleanup: true });
        }
      });
    }

    void this.inFlightRequest.then(() => {
      if (this.writable && this.buffer.length > 0) {
        this.flush();
      }
    });
  }

  private takeBatch(): BufferedLogEntry[] {
    const batch: BufferedLogEntry[] = [];
    let batchBytes = 0;

    while (this.buffer.length > 0) {
      const nextEntry = this.buffer[0];
      const nextEntryBytes =
        Buffer.byteLength(nextEntry.serialized) + (batch.length > 0 ? Buffer.byteLength('\n') : 0);

      if (batch.length > 0 && batchBytes + nextEntryBytes > this.maxBatchBytes) {
        break;
      }

      batch.push(this.buffer.shift()!);
      batchBytes += nextEntryBytes;
    }

    return batch;
  }

  private trimExpiredBufferedLogs(): void {
    if (this.bufferRetentionMs === null) {
      return;
    }

    const cutoff = Date.now() - this.bufferRetentionMs;
    while (this.buffer.length > 0 && this.buffer[0].enqueuedAt < cutoff) {
      this.buffer.shift();
    }
  }

  private async sendBatch(logs: BufferedLogEntry[]): Promise<void> {
    await retry(
      async () => {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: {
            ...this.headers,
            'Content-Type': 'application/x-ndjson',
          },
          body: logs.map(log => log.serialized).join('\n'),
        });

        if (!response.ok) {
          const responseText = await asyncResult(response.text());
          throw new Error(
            `Failed to upload logs: status=${response.status} statusText=${
              response.statusText
            } body=${responseText.value ?? '<error reading response body>'}`
          );
        }
      },
      {
        retryOptions: {
          retries: 2,
          retryIntervalMs: 1000,
        },
        logger: this.logger,
      }
    );
  }
}
