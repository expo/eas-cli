import assert from 'assert';
import FormData from 'form-data';
import fs from 'fs-extra';
import { URL } from 'url';

import fetch from './fetch';
import { UploadSessionType } from './graphql/generated';
import { PresignedPost, UploadSessionMutation } from './graphql/mutations/UploadSessionMutation';
import { ProgressHandler } from './utils/progress';

export async function uploadAsync(
  type: UploadSessionType,
  path: string,
  handleProgressEvent: ProgressHandler
): Promise<{ url: string; bucketKey: string }> {
  const presignedPost = await UploadSessionMutation.createUploadSessionAsync(type);
  const url = await uploadWithPresignedPostAsync(path, presignedPost, handleProgressEvent);
  assert(presignedPost.fields.key, 'key is not specified in in presigned post');
  return { url, bucketKey: presignedPost.fields.key };
}

export async function uploadWithPresignedPostAsync(
  file: string,
  presignedPost: PresignedPost,
  handleProgressEvent?: ProgressHandler
): Promise<string> {
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
  if (handleProgressEvent) {
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
      return fixArchiveUrl(String(response.headers.get('location')));
    } catch (error: any) {
      handleProgressEvent({ isComplete: true, error });
      throw error;
    }
  } else {
    const response = await uploadPromise;
    return fixArchiveUrl(String(response.headers.get('location')));
  }
}

/**
 * S3 returns broken URLs, sth like:
 * https://submission-service-archives.s3.amazonaws.com/production%2Fdc98ca84-1473-4cb3-ae81-8c7b291cb27e%2F4424aa95-b985-4e2f-8755-9507b1037c1c
 * This function replaces %2F with /.
 */
export function fixArchiveUrl(archiveUrl: string): string {
  const parsed = new URL(archiveUrl);
  parsed.pathname = decodeURIComponent(parsed.pathname);
  return parsed.toString();
}
