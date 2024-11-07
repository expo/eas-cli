import FormData from 'form-data';
import fs from 'fs-extra';
import { Response } from 'node-fetch';
import promiseRetry from 'promise-retry';

import { ExpoGraphqlClient } from './commandUtils/context/contextUtils/createGraphqlClient';
import fetch from './fetch';
import { AccountUploadSessionType, UploadSessionType } from './graphql/generated';
import { SignedUrl, UploadSessionMutation } from './graphql/mutations/UploadSessionMutation';
import { ProgressHandler } from './utils/progress';

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export async function uploadFileAtPathToGCSAsync(
  graphqlClient: ExpoGraphqlClient,
  type: UploadSessionType,
  path: string,
  handleProgressEvent: ProgressHandler = () => {}
): Promise<string> {
  const signedUrl = await UploadSessionMutation.createUploadSessionAsync(graphqlClient, type);

  await uploadWithSignedUrlWithProgressAsync(path, signedUrl, handleProgressEvent);
  return signedUrl.bucketKey;
}

export async function uploadAccountScopedFileAtPathToGCSAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    type,
    accountId,
    path,
    handleProgressEvent,
  }: {
    type: AccountUploadSessionType;
    accountId: string;
    path: string;
    handleProgressEvent: ProgressHandler;
  }
): Promise<string> {
  const signedUrl = await UploadSessionMutation.createAccountScopedUploadSessionAsync(
    graphqlClient,
    { type, accountID: accountId }
  );

  await uploadWithSignedUrlWithProgressAsync(path, signedUrl, handleProgressEvent);
  return signedUrl.bucketKey;
}

export async function uploadWithPresignedPostWithRetryAsync(
  file: string,
  presignedPost: PresignedPost,
  onAssetUploadBegin: () => void
): Promise<Response> {
  return await promiseRetry(
    async retry => {
      // retry fetch errors (usually connection or DNS errors)
      let response: Response;
      try {
        onAssetUploadBegin();
        response = await uploadWithPresignedPostAsync(file, presignedPost);
      } catch (e: any) {
        return retry(e);
      }

      // retry 408, 429, 5xx as suggested by google
      if (
        response.status === 408 ||
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599)
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

async function uploadWithSignedUrlWithProgressAsync(
  file: string,
  signedUrl: SignedUrl,
  handleProgressEvent: ProgressHandler
): Promise<Response> {
  const fileStat = await fs.stat(file);
  const fileSize = fileStat.size;

  const readStream = fs.createReadStream(file);
  const uploadPromise = fetch(signedUrl.url, {
    method: 'PUT',
    body: readStream,
    headers: {
      ...signedUrl.headers,
    },
  });

  let currentSize = 0;
  readStream.addListener('data', (chunk: Buffer) => {
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
