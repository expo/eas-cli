import cliProgress from 'cli-progress';
import * as https from 'https';
import createHttpsProxyAgent from 'https-proxy-agent';
import fetch, { BodyInit, Headers, HeadersInit, RequestInit, Response } from 'node-fetch';
import fs from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import promiseRetry from 'promise-retry';

import Log from '../log';
import { AssetFileEntry } from './assets';
import {
  createMultipartBodyFromFilesAsync,
  createReadStreamAsync,
  multipartContentType,
} from './utils/multipart';

const MAX_CONCURRENCY = Math.min(10, Math.max(os.availableParallelism() * 2, 20));
const MAX_RETRY_WARNING_DELAY_MS = 30_000;

const UPLOAD_RETRY_LIMITS: RetryLimits = { retries: 4, maxTimeout: 5_000, maxRetryTime: 20_000 };
const API_RETRY_LIMITS: RetryLimits = { retries: 6, maxTimeout: 5_000, maxRetryTime: 30_000 };

interface RetryState {
  firstRetryAt?: number;
  hasSeenNetworkError: boolean;
  hasWarned: boolean;
}

interface UploadRetryOptions {
  totalRequests?: number;
  state?: RetryState;
  deadlineAt?: number;
}

interface RetryLimits {
  retries: number;
  maxTimeout: number;
  maxRetryTime: number;
}

interface RetryOptions {
  retries: number;
  factor: number;
  minTimeout: number;
  maxTimeout: number;
  maxRetryTime: number;
  randomize: boolean;
}

interface RetryWarningContext {
  state: RetryState;
  warningDelayMs: number;
  subject: string;
}

const getRetryScale = (totalRequests: number): number =>
  Math.min(1, Math.log10(Math.max(1, totalRequests)) / 3);

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getRetryOptions = (
  limits: RetryLimits,
  totalRequests: number,
  networkMode: boolean
): RetryOptions => {
  const scale = getRetryScale(totalRequests);
  return {
    retries: Math.round(limits.retries * (1 + scale)) + (networkMode ? 2 : 0),
    factor: 2,
    minTimeout: 1_000,
    maxTimeout: Math.round(limits.maxTimeout * (1 + scale)),
    maxRetryTime: Math.round(limits.maxRetryTime * (1 + scale)),
    randomize: true,
  };
};

const getRetryWarningDelay = (maxRetryTime: number): number =>
  Math.min(MAX_RETRY_WARNING_DELAY_MS, Math.round(maxRetryTime / 2));

const retryWithWarning = (
  retry: (error: unknown) => never,
  error: unknown,
  attempt: number,
  { state, warningDelayMs, subject }: RetryWarningContext
): never => {
  state.firstRetryAt ??= Date.now();
  if (!state.hasWarned && attempt > 1 && Date.now() - state.firstRetryAt >= warningDelayMs) {
    state.hasWarned = true;
    Log.warn(`${subject} encountered an error but is still retrying: ${getErrorMessage(error)}`);
  }
  return retry(error);
};

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

type OnProgressUpdateCallback = (progress: number) => void;

export async function uploadAsync(
  init: UploadRequestInit,
  payload: UploadPayload,
  onProgressUpdate?: OnProgressUpdateCallback,
  retryOptions: UploadRetryOptions = {},
  networkMode = retryOptions.state?.hasSeenNetworkError ?? false
): Promise<UploadResult> {
  const state = retryOptions.state ?? {
    firstRetryAt: undefined,
    hasSeenNetworkError: false,
    hasWarned: false,
  };
  const retryOptionsForAttempts = getRetryOptions(
    UPLOAD_RETRY_LIMITS,
    retryOptions.totalRequests ?? 1,
    networkMode
  );
  const warningDelayMs = getRetryWarningDelay(retryOptionsForAttempts.maxRetryTime);
  const deadlineAt = retryOptions.deadlineAt ?? Date.now() + retryOptionsForAttempts.maxRetryTime;
  retryOptionsForAttempts.maxRetryTime = Math.max(0, deadlineAt - Date.now());
  const warningContext: RetryWarningContext = { state, warningDelayMs, subject: 'The upload' };
  return await promiseRetry(async (retry, attempt) => {
    if (onProgressUpdate) {
      onProgressUpdate(0);
    }

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
      body = Readable.from(createReadStreamAsync(asset), { objectMode: false });
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
      body = Readable.from(createMultipartBodyFromFilesAsync(multipart, onProgressUpdate), {
        objectMode: false,
      });
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
      if (init.signal?.aborted) {
        throw error;
      }
      if (!networkMode) {
        state.hasSeenNetworkError = true;
        return await uploadAsync(
          init,
          payload,
          onProgressUpdate,
          { ...retryOptions, state, deadlineAt },
          true
        );
      }
      return retryWithWarning(retry, error, attempt, warningContext);
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
      return retryWithWarning(
        retry,
        new Error(await getErrorMessageAsync()),
        attempt,
        warningContext
      );
    } else if (response.status === 413) {
      const message = `${errorPrefix!}: File size exceeded the upload limit`;
      throw new Error(message);
    } else if (!response.ok) {
      throw new Error(await getErrorMessageAsync());
    } else if (onProgressUpdate) {
      onProgressUpdate(1);
    }

    state.firstRetryAt = undefined;
    state.hasSeenNetworkError = false;

    return {
      payload,
      response,
    };
  }, retryOptionsForAttempts);
}

async function callUploadApiWithRetryAsync(
  url: string | URL,
  init: RequestInit | undefined,
  networkMode = false,
  state: RetryState = { hasSeenNetworkError: false, hasWarned: false },
  deadlineAt?: number
): Promise<unknown> {
  const retryOptions = getRetryOptions(API_RETRY_LIMITS, 1, networkMode);
  const warningDelayMs = getRetryWarningDelay(retryOptions.maxRetryTime);
  const retryDeadlineAt = deadlineAt ?? Date.now() + retryOptions.maxRetryTime;
  retryOptions.maxRetryTime = Math.max(0, retryDeadlineAt - Date.now());
  const warningContext: RetryWarningContext = {
    state,
    warningDelayMs,
    subject: 'The deployment',
  };
  return await promiseRetry(async (retry, attempt) => {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        agent: getAgent(),
      });
    } catch (error) {
      if (init?.signal?.aborted) {
        throw error;
      }
      if (!networkMode) {
        state.hasSeenNetworkError = true;
        return await callUploadApiWithRetryAsync(url, init, true, state, retryDeadlineAt);
      }
      return retryWithWarning(retry, error, attempt, warningContext);
    }
    if (response.status >= 500 && response.status <= 599) {
      retryWithWarning(
        retry,
        new Error(`Deployment failed: ${response.statusText}`),
        attempt,
        warningContext
      );
    }
    try {
      return await response.json();
    } catch (error) {
      return retryWithWarning(retry, error, attempt, warningContext);
    }
  }, retryOptions);
}

export async function callUploadApiAsync(url: string | URL, init?: RequestInit): Promise<unknown> {
  return await callUploadApiWithRetryAsync(url, init);
}

export interface UploadPending {
  payload: UploadPayload;
  progress: number;
}

export async function* batchUploadAsync(
  init: UploadRequestInit,
  payloads: UploadPayload[],
  onProgressUpdate?: OnProgressUpdateCallback
): AsyncGenerator<UploadPending> {
  const progressTracker = new Array(payloads.length).fill(0);
  const controller = new AbortController();
  const retryState: RetryState = { hasSeenNetworkError: false, hasWarned: false };
  const queue = new Set<Promise<UploadResult>>();
  const initWithSignal = { ...init, signal: controller.signal };
  const getProgressValue = (): number => {
    const progress = progressTracker.reduce((acc, value) => acc + value, 0);
    return progress / payloads.length;
  };
  const sendProgressUpdate =
    onProgressUpdate &&
    (() => {
      onProgressUpdate(getProgressValue());
    });
  let firstError: unknown = null;
  try {
    let index = 0;
    while (index < payloads.length || queue.size > 0) {
      while (queue.size < MAX_CONCURRENCY && index < payloads.length) {
        const currentIndex = index++;
        const payload = payloads[currentIndex];
        const onChildProgressUpdate =
          sendProgressUpdate &&
          ((progress: number) => {
            progressTracker[currentIndex] = progress;
            sendProgressUpdate();
          });
        const uploadPromise = uploadAsync(initWithSignal, payload, onChildProgressUpdate, {
          totalRequests: payloads.length,
          state: retryState,
        }).then(
          result => {
            queue.delete(uploadPromise);
            progressTracker[currentIndex] = 1;
            return result;
          },
          error => {
            queue.delete(uploadPromise);
            firstError ??= error;
            controller.abort();
            throw error;
          }
        );
        queue.add(uploadPromise);
        yield { payload, progress: getProgressValue() };
      }
      if (firstError) {
        break;
      }
      yield {
        ...(await Promise.race(queue)),
        progress: getProgressValue(),
      };
    }
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      firstError ??= error;
    }
  }
  if (firstError) {
    throw firstError;
  }
}

interface UploadProgressBar {
  update(progress: number): void;
  stop(): void;
}

export function createProgressBar(label = 'Uploading assets'): UploadProgressBar {
  const queueProgressBar = new cliProgress.SingleBar(
    { format: `|{bar}| {percentage}% ${label}` },
    cliProgress.Presets.rect
  );
  queueProgressBar.start(1, 0);
  return {
    update(progress: number) {
      queueProgressBar.update(progress);
    },
    stop() {
      queueProgressBar.stop();
    },
  };
}
