import fetch, { FetchError } from 'node-fetch';
import { Readable } from 'stream';
import { URL } from 'url';

import { RetryOptions, retryOnUploadFailure } from './retry';

export type SignedUrl = {
  url: string;
  headers: Record<string, string>;
};

export type UploadWithSignedUrlParams = {
  signedUrl: SignedUrl;
  srcGeneratorAsync: () => Promise<Readable>;
  contentLength?: number;
  retryIntervalMs?: RetryOptions['retryIntervalMs'];
  retries?: RetryOptions['retries'];
};

export async function uploadWithSignedUrl({
  signedUrl,
  srcGeneratorAsync,
  contentLength,
  retries = 2,
  retryIntervalMs = 30_000,
}: UploadWithSignedUrlParams): Promise<string> {
  let response;
  try {
    response = await retryOnUploadFailure(
      async () => {
        const src = await srcGeneratorAsync();
        return await fetch(signedUrl.url, {
          method: 'PUT',
          headers: {
            ...signedUrl.headers,
            ...(contentLength !== undefined ? { 'Content-Length': contentLength.toString() } : {}),
          },
          body: src,
        });
      },
      {
        retries,
        retryIntervalMs,
      }
    );
  } catch (error: unknown) {
    if (error instanceof FetchError) {
      throw new Error(`Failed to upload the file, reason: ${error.code}`);
    }
    throw error;
  }

  if (!response.ok) {
    let body: string | undefined;
    try {
      body = await response.text();
    } catch {}
    throw new Error(
      `Failed to upload file: status: ${response.status} status text: ${response.statusText}, body: ${body}`
    );
  }

  const url = new URL(signedUrl.url);
  return `${url.protocol}//${url.host}${url.pathname}`;
}
