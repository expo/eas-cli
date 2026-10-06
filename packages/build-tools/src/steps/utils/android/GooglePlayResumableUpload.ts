import { SystemError, UserError } from '@expo/eas-build-job';
import fetch, { FetchError, Response } from 'node-fetch';
import promiseRetry from 'promise-retry';
import fs, { FileHandle } from 'node:fs/promises';
import { z } from 'zod';

import { GooglePlayApiError, GooglePlayClient } from './GooglePlayClient';
import { AndroidArtifactType } from './appArtifact';

const CHUNK_SIZE = 8 * 1024 * 1024;
const RETRY_OPTIONS = {
  retries: 5,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: 32_000,
  randomize: true,
};

type UploadOptions = {
  artifactPath: string;
  client: GooglePlayClient;
  packageName: string;
  editId: string;
  artifactType: AndroidArtifactType;
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
};

export namespace GooglePlayResumableUpload {
  export async function uploadAsync(options: UploadOptions): Promise<number> {
    options.signal?.throwIfAborted();
    const file = await fs.open(options.artifactPath, 'r');
    try {
      const { size } = await file.stat();
      if (!Number.isSafeInteger(size) || size <= 0) {
        throw new UserError(
          'EAS_GOOGLE_PLAY_INVALID_BINARY',
          'Cannot upload an empty or invalid Android binary.'
        );
      }
      for (let restart = 0; ; restart++) {
        const response = await promiseRetry(async retry => {
          options.signal?.throwIfAborted();
          try {
            return await options.client.postAsync(
              '/upload/androidpublisher/v3/applications/:packageName/edits/:editId/:resource',
              undefined,
              {
                packageName: options.packageName,
                editId: options.editId,
                resource: options.artifactType === 'apk' ? 'apks' : 'bundles',
              },
              {
                query: { uploadType: 'resumable' },
                headers: {
                  'Content-Length': '0',
                  'X-Upload-Content-Length': String(size),
                  'X-Upload-Content-Type': contentType(options.artifactType),
                },
                signal: options.signal,
              }
            );
          } catch (error) {
            options.signal?.throwIfAborted();
            if (
              error instanceof GooglePlayApiError &&
              (error.status === 429 || error.status >= 500)
            ) {
              retry(error);
            }
            throw error;
          }
        }, RETRY_OPTIONS);
        let session: URL;
        try {
          session = new URL(response.location);
        } catch {
          throw new SystemError('Google returned an invalid upload URL.');
        }
        if (
          session.origin !== 'https://androidpublisher.googleapis.com' ||
          session.username ||
          session.password
        ) {
          throw new SystemError('Google returned an unsafe upload URL.');
        }
        try {
          return await uploadSessionAsync(file, size, session, options);
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

  async function uploadSessionAsync(
    file: FileHandle,
    size: number,
    session: URL,
    { artifactType, signal, onProgress }: UploadOptions
  ): Promise<number> {
    let offset = 0;
    onProgress?.(0, size);

    while (offset < size) {
      let checkServerOffset = false;
      const result = await promiseRetry(async retry => {
        // A retry checks the server before it sends any bytes again.
        while (true) {
          signal?.throwIfAborted();
          const end = Math.min(offset + CHUNK_SIZE, size);
          let body: Buffer | undefined;
          if (!checkServerOffset) {
            // Only this chunk is held in memory, never the whole file.
            body = Buffer.alloc(end - offset);
            const { bytesRead } = await file.read(body, 0, body.length, offset);
            if (bytesRead !== body.length) {
              throw new SystemError('The Android binary changed during upload.');
            }
          }

          let response: Response;
          try {
            response = await fetch(session.toString(), {
              method: 'PUT',
              redirect: 'manual',
              headers: {
                'Content-Length': String(body?.length ?? 0),
                'Content-Range': checkServerOffset
                  ? `bytes */${size}`
                  : `bytes ${offset}-${end - 1}/${size}`,
                'Content-Type': contentType(artifactType),
              },
              body,
              signal,
            });
          } catch (error) {
            signal?.throwIfAborted();
            const failure = new SystemError(
              'Google Play upload failed before a response was received.'
            );
            if (error instanceof FetchError && error.type === 'system') {
              checkServerOffset = true;
              retry(failure);
            }
            throw failure;
          }

          if (!response.ok && response.status !== 308) {
            const error = new GooglePlayApiError(response.status, '', []);
            if (response.status === 429 || response.status >= 500) {
              checkServerOffset = true;
              retry(error);
            }
            throw error;
          }

          if (response.status === 200 || response.status === 201) {
            let data: unknown;
            try {
              data = await response.json();
            } catch {
              signal?.throwIfAborted();
              checkServerOffset = true;
              return retry(new SystemError('Could not read the Google Play upload response.'));
            }
            const parsed = z
              .object({ versionCode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
              .safeParse(data);
            if (!parsed.success) {
              throw new SystemError('Google completed the upload without a valid version code.');
            }
            return { versionCode: parsed.data.versionCode };
          }
          if (response.status !== 308) {
            throw new SystemError(`Unexpected Google upload status: ${response.status}.`);
          }

          const range = response.headers.get('range');
          const match = range ? /^bytes=0-(\d+)$/.exec(range) : undefined;
          const next = range ? (match ? Number(match[1]) + 1 : NaN) : 0;
          if (
            !Number.isSafeInteger(next) ||
            next < offset ||
            next >= size ||
            (!checkServerOffset && next > end)
          ) {
            throw new SystemError('Google returned an invalid upload range.');
          }
          if (next > offset) {
            return { offset: next };
          }
          if (!checkServerOffset) {
            checkServerOffset = true;
            retry(new SystemError('Google upload made no progress.'));
          }
          // The status check confirmed no new bytes. Send the chunk again.
          checkServerOffset = false;
        }
      }, RETRY_OPTIONS);

      if (result.versionCode !== undefined) {
        onProgress?.(size, size);
        return result.versionCode;
      }
      offset = result.offset;
      onProgress?.(offset, size);
    }
    throw new SystemError('Google upload could not be completed.');
  }
}

function contentType(artifactType: AndroidArtifactType): string {
  return artifactType === 'apk'
    ? 'application/vnd.android.package-archive'
    : 'application/octet-stream';
}
