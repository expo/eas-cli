import assert from 'assert';
import FormData from 'form-data';
import fs from 'fs-extra';

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
      return String(response.headers.get('location'));
    } catch (error: any) {
      handleProgressEvent({ isComplete: true, error });
      throw error;
    }
  } else {
    const response = await uploadPromise;
    return String(response.headers.get('location'));
  }
}
