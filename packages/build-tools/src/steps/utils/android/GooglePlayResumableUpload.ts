import { SystemError } from '@expo/eas-build-job';
import fetch, { Response } from 'node-fetch';
import fs, { FileHandle } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { GooglePlayApiError } from './GooglePlayClient';

const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_RETRIES = 5;

type UploadOptions = {
  artifactPath: string;
  startSessionAsync: (size: number) => Promise<URL>;
  contentType: string;
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
};

export class GooglePlayResumableUpload {
  async uploadAsync(options: UploadOptions): Promise<unknown> {
    options.signal?.throwIfAborted();
    const file = await fs.open(options.artifactPath, 'r');
    try {
      const { size } = await file.stat();
      if (!Number.isSafeInteger(size) || size <= 0) {
        throw new Error('Cannot upload an empty or invalid Android binary.');
      }
      for (let restart = 0; ; restart++) {
        const session = await retryAsync(() => options.startSessionAsync(size), options.signal);
        try {
          return await this.uploadSessionAsync(file, size, session, options);
        } catch (error) {
          if (
            !(error instanceof GooglePlayApiError) ||
            ![404, 410].includes(error.status) ||
            restart >= 2
          ) {
            throw error;
          }
        }
      }
    } finally {
      await file.close();
    }
  }

  private async uploadSessionAsync(
    file: FileHandle,
    size: number,
    session: URL,
    { contentType, signal, onProgress }: UploadOptions
  ): Promise<unknown> {
    let offset = 0;
    let failures = 0;
    let queryStatus = false;
    onProgress?.(0, size);

    while (offset < size) {
      signal?.throwIfAborted();
      const end = Math.min(offset + CHUNK_SIZE, size);
      // File errors must not enter the network retry loop.
      let body: Buffer | undefined;
      if (!queryStatus) {
        body = Buffer.alloc(end - offset);
        const { bytesRead } = await file.read(body, 0, body.length, offset);
        if (bytesRead !== body.length) {
          throw new Error('The Android binary changed during upload.');
        }
      }

      let uploaded: Response;
      try {
        uploaded = await fetch(session.toString(), {
          method: 'PUT',
          redirect: 'manual',
          headers: {
            'Content-Length': String(body?.length ?? 0),
            'Content-Range': queryStatus ? `bytes */${size}` : `bytes ${offset}-${end - 1}/${size}`,
            'Content-Type': contentType,
          },
          body,
          signal,
        });
        if (!uploaded.ok && uploaded.status !== 308) {
          throw new GooglePlayApiError(uploaded.status, '', []);
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof GooglePlayApiError)) {
          error = new SystemError('Google Play upload failed before a response was received.');
        }
        if (!isRetryable(error) || failures >= MAX_RETRIES) {
          throw error;
        }
        await waitAsync(failures++, signal);
        queryStatus = true;
        continue;
      }

      if (uploaded.status === 200 || uploaded.status === 201) {
        let result: unknown;
        try {
          result = await uploaded.json();
        } catch {
          if (failures >= MAX_RETRIES) {
            throw new SystemError('Could not read the Google Play upload response.');
          }
          await waitAsync(failures++, signal);
          queryStatus = true;
          continue;
        }
        onProgress?.(size, size);
        return result;
      }

      if (uploaded.status !== 308) {
        throw new Error(`Unexpected Google upload status: ${uploaded.status}.`);
      }

      const range = uploaded.headers.get('range');
      const match = range ? /^bytes=0-(\d+)$/.exec(range) : undefined;
      const next = range ? (match ? Number(match[1]) + 1 : NaN) : 0;
      if (
        !Number.isSafeInteger(next) ||
        next < offset ||
        next >= size ||
        (!queryStatus && next > end)
      ) {
        throw new Error('Google returned an invalid upload range.');
      }
      if (next === offset && !queryStatus) {
        if (failures >= MAX_RETRIES) {
          throw new Error('Google upload made no progress.');
        }
        await waitAsync(failures++, signal);
      } else if (next > offset) {
        failures = 0;
      }

      offset = next;
      queryStatus = false;
      onProgress?.(offset, size);
    }
    throw new Error('Google upload could not be completed.');
  }
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof SystemError ||
    (error instanceof GooglePlayApiError && (error.status === 429 || error.status >= 500))
  );
}

async function waitAsync(attempt: number, signal?: AbortSignal): Promise<void> {
  await delay(Math.min(2 ** attempt * 1000, 32_000) + Math.floor(Math.random() * 1000), undefined, {
    signal,
  });
}

async function retryAsync<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await request();
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      await waitAsync(attempt, signal);
    }
  }
}
