import * as https from 'https';
import createHttpsProxyAgent from 'https-proxy-agent';
import fetch, { BodyInit, Headers, HeadersInit, RequestInit, Response } from 'node-fetch';
import fs from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import promiseRetry from 'promise-retry';

import { AssetFileEntry } from './assets';
import { createMultipartBodyFromFilesAsync, multipartContentType } from './utils/multipart';

const MAX_CONCURRENCY = Math.min(10, Math.max(os.availableParallelism() * 2, 20));
const MAX_RETRIES = 4;

export type UploadPayload =
  | { filePath: string }
  | { asset: AssetFileEntry }
  | { multipart: AssetFileEntry[] };

export interface UploadRequestInit {
  baseURL: string | URL;
  method?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface UploadResult {
  payload: UploadPayload;
  response: Response;
}

let sharedAgent: https.Agent | undefined;
const getAgent = (): https.Agent => {
  if (sharedAgent) {
    return sharedAgent;
  } else if (process.env.https_proxy) {
    return (sharedAgent = createHttpsProxyAgent(process.env.https_proxy));
  } else {
    return (sharedAgent = new https.Agent({
      keepAlive: true,
      maxSockets: MAX_CONCURRENCY,
      maxTotalSockets: MAX_CONCURRENCY,
      scheduling: 'lifo',
      timeout: 4_000,
    }));
  }
};

export async function uploadAsync(
  init: UploadRequestInit,
  payload: UploadPayload
): Promise<UploadResult> {
  return await promiseRetry(
    async retry => {
      const headers = new Headers(init.headers);

      const url = new URL(`${init.baseURL}`);
      let errorPrefix: string;
      let body: BodyInit | undefined;
      let method = init.method || 'POST';
      if ('asset' in payload) {
        const { asset } = payload;
        errorPrefix = `Upload of "${asset.normalizedPath}" failed`;
        if (asset.type) {
          headers.set('content-type', asset.type);
        }
        if (asset.size) {
          headers.set('content-length', `${asset.size}`);
        }
        method = 'POST';
        url.pathname = `/asset/${asset.sha512}`;
        body = fs.createReadStream(asset.path);
      } else if ('filePath' in payload) {
        const { filePath } = payload;
        errorPrefix = 'Worker deployment failed';
        body = fs.createReadStream(filePath);
      } else if ('multipart' in payload) {
        const { multipart } = payload;
        errorPrefix = `Upload of ${multipart.length} assets failed`;
        headers.set('content-type', multipartContentType);
        method = 'PATCH';
        url.pathname = '/asset/batch';
        const iterator = createMultipartBodyFromFilesAsync(
          multipart.map(asset => ({
            name: asset.sha512,
            filePath: asset.path,
            contentType: asset.type,
            contentLength: asset.size,
          }))
        );
        body = Readable.from(iterator);
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          body,
          headers,
          agent: getAgent(),
          signal: init.signal as any,
        });
      } catch (error) {
        return retry(error);
      }

      const getErrorMessageAsync = async (): Promise<string> => {
        const rayId = response.headers.get('cf-ray');
        const contentType = response.headers.get('Content-Type');
        if (contentType?.startsWith('text/html')) {
          // NOTE(@kitten): We've received a CDN error most likely. There's not much we can do
          // except for quoting the Request ID, so a user can send it to us. We can check
          // why a request was blocked by looking up a WAF event via the "Ray ID" here:
          // https://dash.cloudflare.com/e6f39f67f543faa6038768e8f37e4234/expo.app/security/events
          let message = `CDN firewall has aborted the upload with ${response.statusText}.`;
          if (rayId) {
            message += `\nReport this error quoting Request ID ${rayId}`;
          }
          return `${errorPrefix}: ${message}`;
        } else {
          const json = await response.json().catch(() => null);
          return json?.error ?? `${errorPrefix}: ${response.statusText}`;
        }
      };

      if (
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599)
      ) {
        return retry(new Error(await getErrorMessageAsync()));
      } else if (response.status === 413) {
        const message = `${errorPrefix!}: File size exceeded the upload limit`;
        throw new Error(message);
      } else if (!response.ok) {
        throw new Error(await getErrorMessageAsync());
      }

      return {
        payload,
        response,
      };
    },
    {
      retries: MAX_RETRIES,
      minTimeout: 50,
      randomize: false,
    }
  );
}

export async function callUploadApiAsync(url: string | URL, init?: RequestInit): Promise<unknown> {
  return await promiseRetry(async retry => {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        agent: getAgent(),
      });
    } catch (error) {
      return retry(error);
    }
    if (response.status >= 500 && response.status <= 599) {
      retry(new Error(`Deployment failed: ${response.statusText}`));
    }
    try {
      return await response.json();
    } catch (error) {
      retry(error);
    }
  });
}

export interface UploadPending {
  payload: UploadPayload;
}

export type BatchUploadSignal = UploadResult | UploadPending;

export async function* batchUploadAsync(
  init: UploadRequestInit,
  payloads: UploadPayload[]
): AsyncGenerator<BatchUploadSignal> {
  const controller = new AbortController();
  const queue = new Set<Promise<UploadResult>>();
  const initWithSignal = { ...init, signal: controller.signal };
  try {
    let index = 0;
    while (index < payloads.length || queue.size > 0) {
      while (queue.size < MAX_CONCURRENCY && index < payloads.length) {
        const payload = payloads[index++];
        let uploadPromise: Promise<UploadResult>;
        queue.add(
          (uploadPromise = uploadAsync(initWithSignal, payload).finally(() => {
            queue.delete(uploadPromise);
          }))
        );
        yield { payload };
      }
      yield await Promise.race(queue);
    }

    if (queue.size > 0) {
      controller.abort();
    }
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      throw error;
    }
  }
}
