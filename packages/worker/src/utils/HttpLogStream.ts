import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import fetch from 'node-fetch';
import { Writable } from 'stream';

import { retry } from './retry';

const MAX_BATCH_SIZE = 100;

/**
 * A bunyan-compatible writable stream for sending logs over HTTP.
 */
export default class HttpLogStream extends Writable {
  public writable = true;

  private readonly buffer: unknown[] = [];
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly logger?: bunyan;
  private inFlightRequest: Promise<void> | null = null;

  constructor({
    url,
    headers,
    logger,
  }: {
    url: string;
    headers: Record<string, string>;
    logger: bunyan;
  }) {
    super({ objectMode: true });
    this.url = url;
    this.headers = headers;
    this.logger = logger;
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

    this.buffer.push(chunk);
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

    const batch = this.buffer.splice(0, MAX_BATCH_SIZE);
    this.inFlightRequest = this.sendBatch(batch)
      .catch(err => {
        if (!isCleanup) {
          // Keep logs in memory if upload fails so a later flush can retry.
          this.buffer.unshift(...batch);
          this.logger?.error({ err }, 'Failed to send logs batch over HTTP');
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

  private async sendBatch(logs: unknown[]): Promise<void> {
    await retry(
      async () => {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: {
            ...this.headers,
            'Content-Type': 'application/x-ndjson',
          },
          body: logs.map(log => JSON.stringify(log)).join('\n'),
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
