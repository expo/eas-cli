import assert from 'assert';
import FormData from 'form-data';
import fs from 'fs';
import got, { Progress } from 'got';
import { Readable } from 'stream';

import { UploadSessionType } from './graphql/generated';
import { PresignedPost, UploadSessionMutation } from './graphql/mutations/UploadSessionMutation';

type ProgressHandler = (props: {
  progress?: Progress;
  isComplete?: boolean;
  error?: Error;
}) => void;

export async function uploadAsync(
  type: UploadSessionType,
  path: string,
  handleProgressEvent: ProgressHandler
): Promise<{ url: string; bucketKey: string }> {
  const presignedPost = await obtainS3PresignedPostAsync(type);
  const url = await uploadWithPresignedPostAsync(
    fs.createReadStream(path),
    presignedPost,
    handleProgressEvent
  );
  assert(presignedPost.fields.key, 'key is not specified in in presigned post');
  return { url, bucketKey: presignedPost.fields.key };
}

async function obtainS3PresignedPostAsync(type: UploadSessionType): Promise<PresignedPost> {
  return await UploadSessionMutation.createUploadSession(type);
}

export async function uploadWithPresignedPostAsync(
  stream: Readable | Buffer,
  presignedPost: PresignedPost,
  handleProgressEvent?: ProgressHandler
): Promise<string> {
  const form = new FormData();
  for (const [fieldKey, fieldValue] of Object.entries(presignedPost.fields)) {
    form.append(fieldKey, fieldValue);
  }
  form.append('file', stream);
  const formHeaders = form.getHeaders();
  let uploadPromise = got.post(presignedPost.url, { body: form, headers: { ...formHeaders } });

  if (handleProgressEvent) {
    uploadPromise = uploadPromise.on('uploadProgress', progress =>
      handleProgressEvent({ progress })
    );
    try {
      const response = await uploadPromise;
      handleProgressEvent({ isComplete: true });
      return String(response.headers.location);
    } catch (error) {
      handleProgressEvent({ isComplete: true, error });
      throw error;
    }
  }

  const response = await uploadPromise;
  return String(response.headers.location);
}
