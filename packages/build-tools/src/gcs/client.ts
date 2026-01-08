import { promisify } from 'node:util';
import stream from 'node:stream';
import { Readable } from 'stream';
import { URL } from 'url';

import fs from 'fs-extra';
import { CreateWriteStreamOptions, File, Storage } from '@google-cloud/storage';
import fetch, { FetchError } from 'node-fetch';

import { RetryOptions, retryOnGCSUploadFailure } from './retry';

const pipeline = promisify(stream.pipeline);

interface SignedUrlParams {
  key: string;
  expirationTime: number;
  contentType?: string;
  extensionHeaders?: { [key: string]: number | string | string[] };
}

interface UploadWithSignedUrlParams {
  signedUrl: GCS.SignedUrl;
  srcGeneratorAsync: () => Promise<Readable>;
  retryIntervalMs?: RetryOptions['retryIntervalMs'];
  retries?: RetryOptions['retries'];
}

class GCS {
  private readonly client = new Storage();

  constructor(private readonly bucket: string) {
    this.bucket = bucket;
  }

  public static async uploadWithSignedUrl({
    signedUrl,
    srcGeneratorAsync,
    retries = 2,
    retryIntervalMs = 30_000,
  }: UploadWithSignedUrlParams): Promise<string> {
    let resp;
    try {
      resp = await retryOnGCSUploadFailure(
        async () => {
          const src = await srcGeneratorAsync();
          return await fetch(signedUrl.url, {
            method: 'PUT',
            headers: signedUrl.headers,
            body: src,
          });
        },
        {
          retries,
          retryIntervalMs,
        }
      );
    } catch (err: any) {
      if (err instanceof FetchError) {
        throw new Error(`Failed to upload the file, reason: ${err.code}`);
      } else {
        throw err;
      }
    }
    if (!resp.ok) {
      let body: string | undefined;
      try {
        body = await resp.text();
      } catch {}
      throw new Error(
        `Failed to upload file: status: ${resp.status} status text: ${resp.statusText}, body: ${body}`
      );
    }
    const url = new URL(signedUrl.url);
    return `${url.protocol}//${url.host}${url.pathname}`; // strip query string
  }

  public formatHttpUrl(key: string): string {
    return this.client.bucket(this.bucket).file(key).publicUrl();
  }

  public async uploadFile({
    key,
    src,
    streamOptions,
  }: {
    key: string;
    src: Readable;
    streamOptions?: CreateWriteStreamOptions;
  }): Promise<{ Location: string }> {
    const file = this.client.bucket(this.bucket).file(key);
    await new Promise<void>((res, rej) => {
      src.pipe(
        file
          .createWriteStream(streamOptions)
          .on('error', (err) => {
            rej(err);
          })
          .on('finish', () => {
            res();
          })
      );
    });
    return { Location: file.publicUrl() };
  }

  public async deleteFile(key: string): Promise<void> {
    try {
      await this.client.bucket(this.bucket).file(key).delete();
    } catch (err: any) {
      if (err.response?.statusCode === 404) {
        return;
      }
      throw err;
    }
  }

  public async createSignedUploadUrl({
    key,
    expirationTime,
    contentType,
    extensionHeaders = {},
  }: SignedUrlParams): Promise<GCS.SignedUrl> {
    const config = {
      version: 'v4' as const,
      action: 'write' as const,
      expires: Date.now() + expirationTime,
      contentType,
      extensionHeaders,
    };

    const [url] = await this.client.bucket(this.bucket).file(key).getSignedUrl(config);

    return {
      url,
      headers: {
        ...(contentType ? { 'content-type': contentType } : {}),
        ...extensionHeaders,
      },
    };
  }

  public async createSignedDownloadUrl({
    key,
    expirationTime,
  }: {
    key: string;
    expirationTime: number;
  }): Promise<string> {
    const options = {
      version: 'v4' as const,
      action: 'read' as const,
      expires: Date.now() + expirationTime,
    };

    const [url] = await this.client.bucket(this.bucket).file(key).getSignedUrl(options);

    return url;
  }

  public async checkIfFileExists(key: string, fileHash?: string): Promise<boolean> {
    let metadata;
    try {
      [metadata] = await this.client.bucket(this.bucket).file(key).getMetadata();
    } catch (error: any) {
      if (error.code === 404) {
        return false;
      }
      throw error;
    }

    return fileHash ? metadata.etag === fileHash : true;
  }

  public async listDirectory(prefix: string): Promise<string[]> {
    const [files] = await this.client.bucket(this.bucket).getFiles({ prefix });
    return files.map((x) => this.formatHttpUrl(x.name));
  }

  public async moveFile(src: string, dest: string): Promise<void> {
    await this.client.bucket(this.bucket).file(src).move(dest);
  }

  public async deleteFiles(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.deleteFile(key)));
  }

  public async downloadFile(key: string, destinationPath: string): Promise<void> {
    const stream = this.client.bucket(this.bucket).file(key).createReadStream();
    await pipeline(stream, fs.createWriteStream(destinationPath));
  }

  public getFile(key: string): File {
    return this.client.bucket(this.bucket).file(key);
  }
}

namespace GCS {
  export interface SignedUrl {
    url: string;
    headers: { [key: string]: string };
  }

  export interface Config {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
  }
}

export default GCS;
