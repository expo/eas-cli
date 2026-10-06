import { SystemError } from '@expo/eas-build-job';
import fetch, { FetchError, Response } from 'node-fetch';
import promiseRetry from 'promise-retry';
import { FileHandle } from 'node:fs/promises';
import { z } from 'zod';

import { GooglePlayApiError, GooglePlayClient } from './GooglePlayClient';
import { AndroidArtifactType } from './appArtifact';

const UploadResponseZ = z.object({
  versionCode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const CHUNK_SIZE = 8 * 1024 * 1024;
const RETRY_OPTIONS = {
  retries: 5,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: 32_000,
  randomize: true,
};

export namespace GooglePlayResumableUpload {
  export async function createUploadSessionAsync({
    client,
    packageName,
    editId,
    artifactType,
    signal,
    size,
  }: {
    client: GooglePlayClient;
    packageName: string;
    editId: string;
    artifactType: AndroidArtifactType;
    signal?: AbortSignal;
    size: number;
  }): Promise<URL> {
    const resource = artifactType === 'apk' ? 'apks' : 'bundles';
    const response = await promiseRetry(async retry => {
      signal?.throwIfAborted();
      try {
        return await client.requestAsync(
          'POST',
          `/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/${resource}?uploadType=resumable`,
          undefined,
          signal,
          {
            'Content-Length': '0',
            'X-Upload-Content-Length': String(size),
            'X-Upload-Content-Type': getContentTypeFromArtifactType(artifactType),
          }
        );
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof GooglePlayApiError && (error.status === 429 || error.status >= 500)) {
          retry(error);
        }
        throw error;
      }
    }, RETRY_OPTIONS);
    const location = response.headers.get('location');
    if (!location) {
      throw new SystemError('Google did not return an upload session.');
    }
    let session: URL;
    try {
      session = new URL(location);
    } catch {
      // Node's URL error retains the input, which can contain the upload secret.
      throw new SystemError('Google returned an invalid upload URL.');
    }
    if (session.origin !== 'https://androidpublisher.googleapis.com') {
      throw new SystemError(
        `Google returned an unsafe upload URL: expected origin https://androidpublisher.googleapis.com, got ${session.origin}.`
      );
    }
    if (session.username || session.password) {
      throw new SystemError(
        'Google returned an unsafe upload URL containing a username or password. Upload sessions must not send HTTP Basic credentials.'
      );
    }
    return session;
  }

  export async function uploadSessionAsync({
    file,
    size,
    session,
    artifactType,
    signal,
    onProgress,
  }: {
    file: FileHandle;
    size: number;
    session: URL;
    artifactType: AndroidArtifactType;
    signal?: AbortSignal;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }): Promise<z.output<typeof UploadResponseZ>> {
    const contentType = getContentTypeFromArtifactType(artifactType);
    let offset = 0;
    onProgress?.(0, size);

    let checkServerOffset = false;
    // Keep the confirmed offset across retries. Each retry checks the server first.
    return await promiseRetry(async retry => {
      while (offset < size) {
        signal?.throwIfAborted();
        const end = Math.min(offset + CHUNK_SIZE, size);
        let body: Buffer | undefined;
        if (!checkServerOffset) {
          // Only this chunk is held in memory, never the whole file.
          body = Buffer.alloc(end - offset);
          const { bytesRead } = await file.read(body, 0, body.length, offset);
          if (bytesRead !== body.length) {
            throw new SystemError(
              `The Android binary changed during upload: expected ${body.length} bytes at offset ${offset}, got ${bytesRead}.`
            );
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
              'Content-Type': contentType,
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
          const parsed = UploadResponseZ.safeParse(data);
          if (!parsed.success) {
            throw new SystemError('Google completed the upload without a valid version code.');
          }
          onProgress?.(size, size);
          return parsed.data;
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
          offset = next;
          onProgress?.(offset, size);
          checkServerOffset = false;
          continue;
        }
        if (!checkServerOffset) {
          checkServerOffset = true;
          retry(
            new SystemError(
              `Google upload made no progress: confirmed ${offset} of ${size} bytes after sending bytes ${offset}-${end - 1}.`
            )
          );
        }
        // The status check confirmed no new bytes. Send the chunk again.
        checkServerOffset = false;
      }
      throw new SystemError(`Google upload stopped at ${offset} of ${size} bytes.`);
    }, RETRY_OPTIONS);
  }
}

function getContentTypeFromArtifactType(artifactType: AndroidArtifactType): string {
  return artifactType === 'apk'
    ? 'application/vnd.android.package-archive'
    : 'application/octet-stream';
}
