import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import fetch from 'node-fetch';
import { Writable } from 'stream';
import { uuidv7 } from 'uuidv7';

import { RetryOptions, retry } from './retry';

const MAX_BATCH_SIZE = 100;

export default class HttpLogStream extends Writable {
  public writable = true;

  private readonly buffer: unknown[] = [];
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly logger?: bunyan;
  private readonly retryOptions: RetryOptions;
  private inFlightRequest?: Promise<void>;

  constructor({
    url,
    headers,
    logger,
    retryOptions = { retries: 2, retryIntervalMs: 1000 },
  }: {
    url: string;
    headers?: Record<string, string>;
    logger?: bunyan;
    retryOptions?: RetryOptions;
  }) {
    super({ objectMode: true });
    this.url = url;
    this.headers = {
      'Content-Type': 'application/x-ndjson',
      ...headers,
    };
    this.logger = logger;
    this.retryOptions = retryOptions;
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

    this.buffer.push({ ...chunk, log_id: uuidv7() });
    this.flush();
    callback();
  }

  public async cleanUp(): Promise<void> {
    this.writable = false;
    await this.flush(true);
  }

  private flush(force = false): Promise<void> | void {
    if (this.inFlightRequest) {
      if (force) {
        return this.inFlightRequest.then(() => this.flush(true));
      }
      return;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const batch = this.buffer.splice(0, MAX_BATCH_SIZE);
    this.inFlightRequest = this.sendBatch(batch)
      .catch(err => {
        // Keep logs in memory if upload fails so cleanup can retry.
        this.buffer.unshift(...batch);
        this.logger?.error({ err }, 'Failed to send logs batch over HTTP');
      })
      .finally(() => {
        this.inFlightRequest = undefined;
      });

    if (force) {
      return this.inFlightRequest.then(() => this.flush(true));
    }

    this.inFlightRequest.then(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    });
  }

  private async sendBatch(logs: unknown[]): Promise<void> {
    await retry(
      async () => {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: this.headers,
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
        retryOptions: this.retryOptions,
        logger: this.logger,
      }
    );
  }
}
