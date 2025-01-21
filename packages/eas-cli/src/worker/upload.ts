import mime from 'mime';
import { Gzip } from 'minizlib';
import fs, { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import promiseRetry from 'promise-retry';
import {
  Agent,
  type Dispatcher,
  Headers,
  type HeadersInit,
  type RequestInit,
  type Response,
  fetch,
} from 'undici';

import { sharedProxyAgent } from '../fetch';

const MAX_RETRIES = 4;
const MAX_CONCURRENCY = 10;
const MIN_RETRY_TIMEOUT = 100;
const MAX_UPLOAD_SIZE = 5e8; // 5MB
const MIN_COMPRESSION_SIZE = 5e4; // 50kB

const isCompressible = (contentType: string | null, size: number): boolean => {
  if (size < MIN_COMPRESSION_SIZE) {
    // Don't compress small files
    return false;
  } else if (contentType && /^(?:audio|video|image)\//i.test(contentType)) {
    // Never compress images, audio, or videos as they're presumably precompressed
    return false;
  } else if (contentType && /^application\//i.test(contentType)) {
    // Only compress `application/` files if they're marked as XML/JSON/JS
    return /(?:xml|json5?|javascript)$/i.test(contentType);
  } else {
    return true;
  }
};

export interface UploadParams extends Omit<RequestInit, 'signal' | 'body'> {
  filePath: string;
  compress?: boolean;
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: undefined;
  signal?: AbortSignal;
}

export interface UploadResult {
  params: UploadParams;
  response: Response;
}

let sharedDispatcher: Dispatcher | null = null;
const getDispatcher = (): Dispatcher => {
  if (sharedDispatcher) {
    return sharedDispatcher;
  } else if (sharedProxyAgent) {
    return (sharedDispatcher = sharedProxyAgent);
  } else {
    return (sharedDispatcher = new Agent({ pipelining: 0 }));
  }

  // if (sharedAgent) return sharedAgent;
  // if (sharedProxyAgent) return (sharedAgent = sharedProxyAgent);
  // return (sharedAgent = )

  // if (sharedAgent) {
  //   return sharedAgent;
  // } else if (process.env.https_proxy) {
  //   return (sharedAgent = createHttpsProxyAgent(process.env.https_proxy));
  // } else {
  //   return (sharedAgent = new https.Agent({
  //     keepAlive: true,
  //     maxSockets: MAX_CONCURRENCY,
  //     maxTotalSockets: MAX_CONCURRENCY,
  //     scheduling: 'lifo',
  //     timeout: 4_000,
  //   }));
  // }
};

export async function uploadAsync(params: UploadParams): Promise<UploadResult> {
  const {
    filePath,
    signal,
    compress,
    method = 'POST',
    url,
    headers: headersInit,
    ...requestInit
  } = params;
  const stat = await fs.promises.stat(params.filePath);
  if (stat.size > MAX_UPLOAD_SIZE) {
    throw new Error(
      `Upload of "${params.filePath}" aborted: File size is greater than the upload limit (>500MB)`
    );
  }

  const contentType = mime.getType(path.basename(params.filePath));
  return await promiseRetry(
    async retry => {
      const headers = new Headers(headersInit);
      if (contentType) {
        headers.set('content-type', contentType);
      }

      let bodyStream = createReadStream(filePath);
      if (compress && isCompressible(contentType, stat.size)) {
        const gzip = new Gzip({ portable: true });
        bodyStream.on('error', error => gzip.emit('error', error));
        // @ts-expect-error
        bodyStream = bodyStream.pipe(gzip); // TODO: validate this works!
        headers.set('content-encoding', 'gzip');
      }

      let response: Response;
      try {
        response = await fetch(params.url, {
          ...requestInit,
          method,
          body: Readable.toWeb(bodyStream),
          headers,
          dispatcher: getDispatcher(),
          signal,
          duplex: 'half',
        });
      } catch (error) {
        return retry(error);
      }

      const getErrorMessageAsync = async (): Promise<string> => {
        const body: any = await response.json().catch(() => null); // TODO: remove any
        return body?.error ?? `Upload of "${filePath}" failed: ${response.statusText}`;
      };

      if (
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599)
      ) {
        return retry(new Error(await getErrorMessageAsync()));
      } else if (response.status === 413) {
        const message = `Upload of "${filePath}" failed: File size exceeded the upload limit`;
        throw new Error(message);
      } else if (!response.ok) {
        throw new Error(await getErrorMessageAsync());
      }

      return {
        params,
        response,
      };
    },
    {
      retries: MAX_RETRIES,
      minTimeout: MIN_RETRY_TIMEOUT,
      randomize: true,
      factor: 2,
    }
  );
}

export async function callUploadApiAsync(url: string | URL, init?: RequestInit): Promise<unknown> {
  return await promiseRetry(async retry => {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        dispatcher: getDispatcher(),
      });
    } catch (error) {
      return retry(error);
    }
    if (response.status >= 500 && response.status <= 599) {
      return retry(new Error(`Deployment failed: ${response.statusText}`));
    }
    try {
      return await response.json();
    } catch (error) {
      return retry(error);
    }
  });
}

export interface UploadPending {
  params: UploadParams;
}

export type BatchUploadSignal = UploadResult | UploadPending;

export async function* batchUploadAsync(
  uploads: readonly UploadParams[]
): AsyncGenerator<BatchUploadSignal> {
  const controller = new AbortController();
  const queue = new Set<Promise<UploadResult>>();
  try {
    let index = 0;
    while (index < uploads.length || queue.size > 0) {
      while (queue.size < MAX_CONCURRENCY && index < uploads.length) {
        const uploadParams = uploads[index++];
        let uploadPromise: Promise<UploadResult>;
        queue.add(
          (uploadPromise = uploadAsync({ ...uploadParams, signal: controller.signal }).finally(() =>
            queue.delete(uploadPromise)
          ))
        );
        yield { params: uploadParams };
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
