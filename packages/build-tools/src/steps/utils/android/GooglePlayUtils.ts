import { Response } from 'node-fetch';
import fs from 'node:fs/promises';

import { GooglePlayApiError, GooglePlayClient } from './GooglePlayClient';
import { AndroidArtifactType } from './appArtifact';

const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_RETRIES = 5;

export namespace GooglePlayUtils {
  export function editPath(packageName: string, editId?: string): string {
    return `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits${editId ? `/${encodeURIComponent(editId)}` : ''}`;
  }

  export async function uploadAsync({
    client,
    packageName,
    editId,
    artifactPath,
    artifactType,
    signal,
    onProgress,
  }: {
    client: GooglePlayClient;
    packageName: string;
    editId: string;
    artifactPath: string;
    artifactType: AndroidArtifactType;
    signal?: AbortSignal;
    onProgress: (uploadedBytes: number, totalBytes: number) => void;
  }): Promise<number> {
    const file = await fs.open(artifactPath, 'r');
    try {
      const { size } = await file.stat();
      if (!Number.isSafeInteger(size) || size <= 0) {
        throw new Error('Cannot upload an empty or invalid Android binary.');
      }
      const contentType =
        artifactType === 'apk'
          ? 'application/vnd.android.package-archive'
          : 'application/octet-stream';
      const uploadUrl = `/upload${editPath(packageName, editId)}/${artifactType === 'apk' ? 'apks' : 'bundles'}?uploadType=resumable`;
      // An expired session can be restarted. An ambiguous commit cannot.
      for (let restart = 0; restart <= 2; restart++) {
        const response = await client.retryAsync(
          () =>
            client.requestRawAsync(uploadUrl, {
              method: 'POST',
              headers: {
                'Content-Length': '0',
                'X-Upload-Content-Length': String(size),
                'X-Upload-Content-Type': contentType,
              },
              signal,
            }),
          signal
        );
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Google did not return an upload session.');
        }
        let session: URL;
        try {
          session = new URL(location);
        } catch {
          throw new Error('Google returned an invalid upload URL.');
        }
        try {
          let offset = 0;
          let failures = 0;
          let queryStatus = false;
          onProgress(0, size);
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
              uploaded = await client.requestRawAsync(
                session,
                {
                  method: 'PUT',
                  headers: {
                    'Content-Length': String(body?.length ?? 0),
                    'Content-Range': queryStatus
                      ? `bytes */${size}`
                      : `bytes ${offset}-${end - 1}/${size}`,
                    'Content-Type': contentType,
                  },
                  body,
                  signal,
                },
                true
              );
            } catch (error) {
              if (!client.isRetryable(error) || failures >= MAX_RETRIES) {
                throw error;
              }
              await client.waitAsync(failures++, signal);
              queryStatus = true;
              continue;
            }
            if (uploaded.status === 200 || uploaded.status === 201) {
              let result: { versionCode?: number };
              try {
                result = await client.readJsonAsync(uploaded);
              } catch (error) {
                if (failures >= MAX_RETRIES) {
                  throw error;
                }
                await client.waitAsync(failures++, signal);
                queryStatus = true;
                continue;
              }
              if (!Number.isSafeInteger(result?.versionCode) || result?.versionCode! <= 0) {
                throw new Error('Google completed the upload without a valid version code.');
              }
              onProgress(size, size);
              return result?.versionCode!;
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
              await client.waitAsync(failures++, signal);
            } else if (next > offset) {
              failures = 0;
            }
            offset = next;
            queryStatus = false;
            onProgress(offset, size);
          }
        } catch (error) {
          if (
            !(error instanceof GooglePlayApiError) ||
            ![404, 410].includes(error.status) ||
            restart === 2
          ) {
            throw error;
          }
        }
      }
      throw new Error('Google upload could not be completed.');
    } finally {
      await file.close();
    }
  }
}
