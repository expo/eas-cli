import assert from 'assert';
import FormData from 'form-data';
import fs from 'fs';
import got, { Progress } from 'got';
import md5File from 'md5-file';
import { Readable } from 'stream';

import { apiClient } from './api';

export enum UploadType {
  TURTLE_PROJECT_SOURCES = 'turtle-project-sources',
  SUBMISSION_APP_ARCHIVE = 'submission-app-archive',
}

type ProgressHandler = (props: {
  progress?: Progress;
  isComplete?: boolean;
  error?: Error;
}) => void;

export async function uploadAsync(
  uploadType: UploadType,
  path: string,
  handleProgressEvent: ProgressHandler
): Promise<{ url: string; bucketKey: string }> {
  const presignedPost = await obtainS3PresignedPostAsync(uploadType, path);
  const url = await uploadWithPresignedPostAsync(
    fs.createReadStream(path),
    presignedPost,
    handleProgressEvent
  );
  assert(presignedPost.fields.key, 'key is not specified in in presigned post');
  return { url, bucketKey: presignedPost.fields.key };
}

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

async function obtainS3PresignedPostAsync(
  uploadType: UploadType,
  filePath: string
): Promise<PresignedPost> {
  const fileHash = await md5File(filePath);
  const { data } = await apiClient
    .post('upload-sessions', {
      json: {
        type: uploadType,
        checksum: fileHash,
      },
    })
    .json();
  return data.presignedUrl;
}

export async function uploadWithPresignedPostAsync(
  stream: Readable | Buffer,
  presignedPost: PresignedPost,
  handleProgressEvent: ProgressHandler
) {
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
  }
  try {
    const response = await uploadPromise;
    handleProgressEvent({ isComplete: true });
    return String(response.headers.location);
  } catch (error) {
    handleProgressEvent({ isComplete: true, error });
    throw error;
  }
}
