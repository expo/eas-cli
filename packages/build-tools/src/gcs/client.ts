import fetch, { FetchError } from 'node-fetch';
import { Readable } from 'stream';
import { URL } from 'url';

import { retryOnGCSUploadFailure } from './retry';

interface UploadWithSignedUrlParams {
  signedUrl: GCS.SignedUrl;
  srcGeneratorAsync: () => Promise<Readable>;
  retryIntervalMs?: number;
  retries?: number;
}

export namespace GCS {
  export type SignedUrl = {
    url: string;
    headers: Record<string, string>;
  };

  export async function uploadWithSignedUrl({
    signedUrl,
    srcGeneratorAsync,
    retries = 2,
    retryIntervalMs = 30_000,
  }: UploadWithSignedUrlParams): Promise<string> {
    let resp;
    try {
      resp = await retryOnGCSUploadFailure(
        async () => {
          const src = await srcGeneratorAsync();
          return await fetch(signedUrl.url, {
            method: 'PUT',
            headers: signedUrl.headers,
            body: src,
          });
        },
        { retries, retryIntervalMs }
      );
    } catch (err: unknown) {
      if (err instanceof FetchError) {
        throw new Error(`Failed to upload the file, reason: ${err.code}`);
      }
      throw err;
    }

    if (!resp.ok) {
      let body: string | undefined;
      try {
        body = await resp.text();
      } catch {}
      throw new Error(
        `Failed to upload file: status: ${resp.status} status text: ${resp.statusText}, body: ${body}`
      );
    }

    const url = new URL(signedUrl.url);
    return `${url.protocol}//${url.host}${url.pathname}`;
  }
}
