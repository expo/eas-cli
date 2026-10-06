import { UserError } from '@expo/eas-build-job';
import fs from 'node:fs/promises';
import promiseRetry from 'promise-retry';

import { GooglePlayApiError, GooglePlayClient } from './GooglePlayClient';
import { GooglePlayResumableUpload } from './GooglePlayResumableUpload';
import { AndroidArtifactType } from './appArtifact';

export namespace GooglePlayUtils {
  export async function uploadApplicationAsync(options: {
    client: GooglePlayClient;
    packageName: string;
    editId: string;
    artifactPath: string;
    artifactType: AndroidArtifactType;
    signal?: AbortSignal;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }): Promise<{ versionCode: number }> {
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
      return await promiseRetry(
        async retry => {
          const session = await GooglePlayResumableUpload.createUploadSessionAsync({
            ...options,
            size,
          });
          try {
            return await GooglePlayResumableUpload.uploadSessionAsync({
              ...options,
              file,
              size,
              session,
            });
          } catch (error) {
            options.signal?.throwIfAborted();
            // 404/410 from an existing session mean it is gone; other failures
            // must not restart the whole file upload.
            if (error instanceof GooglePlayApiError && [404, 410].includes(error.status)) {
              retry(error);
            }
            throw error;
          }
        },
        { retries: 2, factor: 2, minTimeout: 1000, maxTimeout: 32_000, randomize: true }
      );
    } finally {
      await file.close();
    }
  }
}
