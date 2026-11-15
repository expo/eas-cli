import { Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';

import { DeviceRunSessionStatus } from '../graphql/generated';

export const CONTROL_CONNECTION_VERSION = 3;
export const DEFAULT_CONTROL_IDLE_TIMEOUT_MS = 120_000;
export const CONTROL_SETUP_TIMEOUT_MS = 10_000;
export const CONTROL_BOOTSTRAP_TIMEOUT_MS = 240_000;
export const CONTROL_REQUEST_TIMEOUT_MS = 145_000;
export const CONTROL_LEASE_WAIT_TIMEOUT_MS = 30_000;
// Preserve replies supported by the remote WebSocket's 100 MiB payload limit.
export const MAX_CONTROL_FRAME_BYTES = 128 * 1024 * 1024;

export const ControlSessionSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  project: z.string(),
  status: z.enum(DeviceRunSessionStatus),
  device: z.object({
    udid: z.string().min(1),
    name: z.string().optional(),
    runtime: z.string().optional(),
  }),
});
export type ControlSession = z.infer<typeof ControlSessionSchema>;

export const ConnectionInfoSchema = z.object({
  version: z.literal(CONTROL_CONNECTION_VERSION),
  pid: z.number().int().positive(),
  session: ControlSessionSchema,
  idleTimeoutMs: z.number().int().positive(),
  idleDeadline: z.number().nullable(),
  busy: z.boolean(),
});
export type ControlConnectionInfo = z.infer<typeof ConnectionInfoSchema>;

export const ConnectionOperationSchema = z.strictObject({
  operation: z.enum(['lease', 'status', 'close']),
  idleTimeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
});
export type ConnectionOperation = z.infer<typeof ConnectionOperationSchema>;

// Pull one bounded JSON frame at a time. Closing a client discards queued input,
// so disconnected callers cannot leave another action waiting to execute.
export class ControlConnectionChannel {
  private readonly decoder = new StringDecoder('utf8');
  private fragments: string[] = [];
  private frameBytes = 0;
  private queued: unknown[] = [];
  private failure: Error | undefined;
  private reader: { resolve(value: unknown): void; reject(error: Error): void } | undefined;

  constructor(readonly socket: Socket) {
    socket.on('data', chunk => {
      try {
        const text = this.decoder.write(chunk);
        let start = 0;
        while (start < text.length) {
          const newline = text.indexOf('\n', start);
          const fragment = text.slice(start, newline === -1 ? text.length : newline);
          this.frameBytes += Buffer.byteLength(fragment);
          if (this.frameBytes > MAX_CONTROL_FRAME_BYTES) {
            throw new Error('Local control message is too large.');
          }
          this.fragments.push(fragment);
          if (newline === -1) {
            break;
          }
          const value: unknown = JSON.parse(this.fragments.join(''));
          this.fragments = [];
          this.frameBytes = 0;
          start = newline + 1;
          if (this.reader) {
            const reader = this.reader;
            this.reader = undefined;
            reader.resolve(value);
          } else {
            if (this.queued.length >= 8) {
              throw new Error('Too many pending local control messages.');
            }
            this.queued.push(value);
          }
        }
      } catch {
        this.destroy(new Error('Invalid or oversized local control message.'));
      }
    });
    socket.on('error', error => {
      this.fail(error);
    });
    socket.on('end', () => {
      this.destroy(new Error('Local control caller disconnected.'));
    });
    socket.on('close', () => {
      this.fail(
        new Error('Local control connection closed. An action already sent may still have run.')
      );
    });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.fragments = [];
    this.frameBytes = 0;
    this.queued = [];
    this.reader?.reject(this.failure);
    this.reader = undefined;
  }

  destroy(error = new Error('Local control connection closed.')): void {
    this.fail(error);
    this.socket.destroy();
  }

  async readAsync(
    timeoutMs = CONTROL_SETUP_TIMEOUT_MS,
    timeoutMessage = 'Local control connection timed out. An action already sent may still have run.'
  ): Promise<unknown> {
    if (this.failure) {
      throw this.failure;
    }
    if (this.queued.length) {
      return this.queued.shift();
    }
    if (this.reader) {
      throw new Error('A local control reply is already pending.');
    }
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.destroy(new Error(timeoutMessage));
      }, timeoutMs);
      this.reader = {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  async writeAsync(value: unknown): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    const text = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(text) > MAX_CONTROL_FRAME_BYTES) {
      throw new Error('Local control message is too large.');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(
          'Local control write timed out. An action already sent may still have run.'
        );
        this.destroy(error);
        reject(error);
      }, CONTROL_SETUP_TIMEOUT_MS);
      this.socket.write(text, error => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      });
    });
  }
}
