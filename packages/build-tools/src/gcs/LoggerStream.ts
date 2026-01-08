import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { Readable, Writable, pipeline } from 'stream';
import assert from 'assert';
import { promisify } from 'util';

import { bunyan } from '@expo/logger';
import fs from 'fs-extra';

import GCS from './client';

type PromiseResolveFn = (value?: void | PromiseLike<void> | undefined) => void;

const pipe = promisify(pipeline);

class GCSLoggerStream extends Writable {
  public writable = true;
  private readonly logger: bunyan;
  private readonly uploadMethod?: GCSLoggerStream.UploadMethod;
  private readonly options: GCSLoggerStream.Options;
  private readonly temporaryLogsPath: string;
  private readonly temporaryCompressedLogsPath: string;
  private readonly compress: string | null;
  private fileHandle?: number;
  private uploadingPromise?: Promise<void>;
  private hasChangesToUpload = false;
  private flushInterval?: NodeJS.Timeout;
  private buffer: string[] = [];
  private writePromise?: Promise<any>;
  private cleanUpCalled: boolean = false;

  constructor({ logger, uploadMethod, options }: GCSLoggerStream.Config) {
    super();
    this.logger = logger;
    this.uploadMethod = uploadMethod;
    this.options = options;
    this.compress = options?.compress ?? this.findNormalizedHeader('contentencoding');
    this.temporaryLogsPath = path.join(os.tmpdir(), `logs-${randomUUID()}`);
    this.temporaryCompressedLogsPath = `${this.temporaryLogsPath}.compressed`;
  }

  private findNormalizedHeader(name: string): string | null {
    if (!this.uploadMethod || 'client' in this.uploadMethod) {
      return null;
    }

    const normalizedName = name.toLowerCase().replace('-', '');
    const fields = this.uploadMethod.signedUrl.headers;
    for (const key in fields) {
      if (key.toLowerCase().replace('-', '') === normalizedName) {
        return fields[key];
      }
    }

    return null;
  }

  public async init(): Promise<string> {
    this.fileHandle = await fs.open(this.temporaryLogsPath, 'w+', 0o660);
    this.flushInterval = setInterval(() => this.flush(), this.options.uploadIntervalMs);
    return (await this.flush(true)) as string;
  }

  public async cleanUp(): Promise<void> {
    if (this.cleanUpCalled) {
      this.logger.info('Cleanup already called');
      return;
    }
    this.cleanUpCalled = true;
    if (!this.fileHandle) {
      throw new Error('You have to init the stream first!');
    }
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }

    await this.safeWriteToFile(true);
    await fs.close(this.fileHandle);
    this.fileHandle = undefined;

    await this.flush(true);

    await fs.remove(this.temporaryLogsPath);
    await fs.remove(this.temporaryCompressedLogsPath);
    this.logger.info('Cleaning up GCS log stream');
  }

  public write(rec: any): boolean {
    if (!this.fileHandle) {
      return true;
    }
    const logLine = `${JSON.stringify(rec)}\n`;
    this.buffer.push(logLine);
    void this.safeWriteToFile();
    return true;
  }

  private async safeWriteToFile(force = false): Promise<void> {
    if (this.writePromise && force) {
      await this.writePromise;
      await this.safeWriteToFile(force);
      return;
    }

    if (!this.fileHandle || Boolean(this.writePromise) || this.buffer.length === 0) {
      return;
    }

    const buffer = this.buffer.slice();
    try {
      this.writePromise = fs.write(this.fileHandle, buffer.join(''));
      await this.writePromise;
      this.buffer = this.buffer.slice(buffer.length);
      this.hasChangesToUpload = true;
    } catch (err) {
      this.logger.error({ err, origin: 'gcs-logger' }, 'Failed to write logs to file');
    } finally {
      this.writePromise = undefined;
    }
  }

  private async flush(force = false): Promise<string | void> {
    if (force || this.hasChangesToUpload) {
      if (this.uploadingPromise) {
        await this.uploadingPromise;
        return await this.flush(force);
      }
      return await this.flushInternal();
    }
  }

  private async flushInternal(): Promise<string | void> {
    await this.safeWriteToFile();

    let resolveFn: PromiseResolveFn;
    this.hasChangesToUpload = false;
    this.uploadingPromise = new Promise((res) => {
      resolveFn = res;
    });
    return await this.upload()
      .then((result) => {
        return result;
      })
      .catch((err) => {
        this.logger.error({ err }, 'Failed to upload logs file to GCS');
      })
      .then((result) => {
        this.uploadingPromise = undefined;
        resolveFn();
        return result;
      });
  }

  private async upload(): Promise<string | void> {
    if (!this.uploadMethod) {
      return;
    }

    const { size } = await fs.stat(this.temporaryLogsPath);
    const srcGeneratorAsync = async (): Promise<Readable> => {
      return await this.createCompressedStream(
        fs.createReadStream(this.temporaryLogsPath, { end: size })
      );
    };

    if ('signedUrl' in this.uploadMethod) {
      return await GCS.uploadWithSignedUrl({
        signedUrl: this.uploadMethod.signedUrl,
        srcGeneratorAsync,
      });
    }

    const { Location } = await this.uploadMethod.client.uploadFile({
      key: this.uploadMethod.key,
      src: await srcGeneratorAsync(),
      streamOptions: {
        metadata: {
          contentType: 'text/plain;charset=utf-8',
          ...(this.compress !== null ? { contentEncoding: this.compress } : {}),
          customTime: this.uploadMethod.customTime,
        },
      },
    });
    return Location;
  }

  private async createCompressedStream(src: Readable): Promise<Readable> {
    if (!this.compress) {
      return src;
    }

    const dst = fs.createWriteStream(this.temporaryCompressedLogsPath);

    const encoder =
      this.compress === 'gzip'
        ? zlib.createGzip()
        : this.compress === 'br'
          ? zlib.createBrotliCompress({
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 0,
              },
            })
          : null;

    assert(encoder, `unknown encoder ${encoder}`);
    await pipe(src, encoder, dst);

    const { size } = await fs.stat(this.temporaryCompressedLogsPath);
    return fs.createReadStream(this.temporaryCompressedLogsPath, { end: size });
  }
}

namespace GCSLoggerStream {
  export enum CompressionMethod {
    GZIP = 'gzip',
    BR = 'br',
  }

  export interface Options {
    uploadIntervalMs: number;
    compress?: CompressionMethod;
  }

  export type UploadMethod =
    | { client: GCS; key: string; customTime: Date | null }
    | { signedUrl: GCS.SignedUrl };

  export interface Config {
    logger: bunyan;
    uploadMethod?: UploadMethod;
    options: Options;
  }
}

export default GCSLoggerStream;
