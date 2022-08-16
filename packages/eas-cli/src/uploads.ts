import assert from 'assert';
import FormData from 'form-data';
import fs from 'fs-extra';
import { Response } from 'node-fetch';
import nullthrows from 'nullthrows';
import promiseRetry from 'promise-retry';
import { URL } from 'url';

import fetch from './fetch';
import { UploadSessionType } from './graphql/generated';
import { PresignedPost, UploadSessionMutation } from './graphql/mutations/UploadSessionMutation';
import { ProgressHandler } from './utils/progress';

export async function uploadFileAtPathToS3Async(
  type: UploadSessionType,
  path: string,
  handleProgressEvent: ProgressHandler
): Promise<{ url: string; bucketKey: string }> {
  const presignedPost = await UploadSessionMutation.createUploadSessionAsync(type);
  assert(presignedPost.fields.key, 'key is not specified in in presigned post');

  const response = await uploadWithPresignedPostWithProgressAsync(
    path,
    presignedPost,
    handleProgressEvent
  );
  const location = nullthrows(
    response.headers.get('location'),
    `location does not exist in response headers (make sure you're uploading to AWS S3)`
  );
  const url = fixS3Url(location);
  return { url, bucketKey: presignedPost.fields.key };
}

export async function uploadWithPresignedPostWithRetryAsync(
  file: string,
  presignedPost: PresignedPost
): Promise<Response> {
  return await promiseRetry(
    async retry => {
      // retry fetch errors (usually connection or DNS errors)
      let response: Response;
      try {
        response = await uploadWithPresignedPostAsync(file, presignedPost);
      } catch (e: any) {
        return retry(e);
      }

      // retry 408, 429, 5xx as suggested by google
      if (
        response.status === 408 ||
        response.status === 429 ||
        Math.floor(response.status / 100) === 5 // 5xx errors
      ) {
        return retry(new Error(`Presigned upload responded with a ${response.status} status`));
      }

      // don't retry other errors
      if (!response.ok) {
        throw new Error(`Presigned upload responded with a ${response.status} status`);
      }

      return response;
    },
    // retry parameters match google suggested defaults: https://cloud.google.com/storage/docs/retry-strategy#node.js
    {
      retries: 3,
      factor: 2,
    }
  );
}

async function uploadWithPresignedPostAsync(
  file: string,
  presignedPost: PresignedPost
): Promise<Response> {
  const fileStat = await fs.stat(file);
  const fileSize = fileStat.size;
  const form = new FormData();
  for (const [fieldKey, fieldValue] of Object.entries(presignedPost.fields)) {
    form.append(fieldKey, fieldValue);
  }
  form.append('file', fs.createReadStream(file), { knownLength: fileSize });
  const formHeaders = form.getHeaders();

  return await fetch(presignedPost.url, {
    method: 'POST',
    body: form,
    headers: {
      ...formHeaders,
    },
  });
}

async function uploadWithPresignedPostWithProgressAsync(
  file: string,
  presignedPost: PresignedPost,
  handleProgressEvent: ProgressHandler
): Promise<Response> {
  const fileStat = await fs.stat(file);
  const fileSize = fileStat.size;
  const form = new FormData();
  for (const [fieldKey, fieldValue] of Object.entries(presignedPost.fields)) {
    form.append(fieldKey, fieldValue);
  }
  form.append('file', fs.createReadStream(file), { knownLength: fileSize });
  const formHeaders = form.getHeaders();
  const uploadPromise = fetch(presignedPost.url, {
    method: 'POST',
    body: form,
    headers: {
      ...formHeaders,
    },
  });

  let currentSize = 0;
  form.addListener('data', (chunk: Buffer) => {
    currentSize += Buffer.byteLength(chunk);
    handleProgressEvent({
      progress: {
        total: fileSize,
        percent: currentSize / fileSize,
        transferred: currentSize,
      },
    });
  });
  try {
    const response = await uploadPromise;
    handleProgressEvent({ isComplete: true });
    return response;
  } catch (error: any) {
    handleProgressEvent({ isComplete: true, error });
    throw error;
  }
}

/**
 * S3 returns broken URLs, sth like:
 * https://submission-service-archives.s3.amazonaws.com/production%2Fdc98ca84-1473-4cb3-ae81-8c7b291cb27e%2F4424aa95-b985-4e2f-8755-9507b1037c1c
 * This function replaces %2F with /.
 */
export function fixS3Url(archiveUrl: string): string {
  const parsed = new URL(archiveUrl);
  parsed.pathname = decodeURIComponent(parsed.pathname);
  return parsed.toString();
}
