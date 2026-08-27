import cliProgress from 'cli-progress';
import fetch, { Headers, Response } from 'node-fetch';

import Log from '../../log';
import { AssetFileEntry } from '../assets';
import {
  UploadPayload,
  batchUploadAsync,
  callUploadApiAsync,
  createProgressBar,
  uploadAsync,
} from '../upload';

jest.mock('node-fetch', () => ({
  ...jest.requireActual('node-fetch'),
  __esModule: true,
  default: jest.fn(),
}));

const mockedFetch = jest.mocked(fetch);

const asset: AssetFileEntry = {
  normalizedPath: 'index.html',
  path: __filename,
  size: 123,
  sha512: 'a'.repeat(128),
  type: 'text/html',
};

const response = (status = 200, body: unknown = { success: true }): Response =>
  new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Request failed',
    headers: { 'content-type': 'application/json' },
  });

async function runTimersAndExpectRejection(
  promise: Promise<unknown>,
  expected: string | RegExp
): Promise<void> {
  const expectation = expect(promise).rejects.toThrow(expected);
  await jest.runAllTimersAsync();
  await expectation;
}

describe(uploadAsync, () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    mockedFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uploads an individual asset with its hash and metadata', async () => {
    mockedFetch.mockResolvedValue(response());

    const result = await uploadAsync({ baseURL: 'https://eas.expo.app/?token=secret' }, { asset });

    expect(result.payload).toEqual({ asset });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0];
    expect(String(url)).toBe(`https://eas.expo.app/asset/${asset.sha512}?token=secret`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Headers).get('content-type')).toBe('text/html');
    expect((init?.headers as Headers).get('content-length')).toBe('123');
    expect(init?.body).toBeDefined();
  });

  it('uploads a worker deployment file without changing the URL', async () => {
    mockedFetch.mockResolvedValue(response());

    await uploadAsync({ baseURL: 'https://eas.expo.app/deploy' }, { filePath: __filename });

    const [url, init] = mockedFetch.mock.calls[0];
    expect(String(url)).toBe('https://eas.expo.app/deploy');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeDefined();
  });

  it('uploads multipart assets to the batch endpoint and reports progress', async () => {
    mockedFetch.mockResolvedValue(response());
    const onProgress = jest.fn();

    await uploadAsync(
      { baseURL: 'https://eas.expo.app/asset/?token=secret' },
      { multipart: [asset, { ...asset, sha512: 'b'.repeat(128) }] },
      onProgress
    );

    const [url, init] = mockedFetch.mock.calls[0];
    expect(String(url)).toBe('https://eas.expo.app/asset/batch?token=secret');
    expect(init?.method).toBe('PATCH');
    expect((init?.headers as Headers).get('content-type')).toMatch(/^multipart\/form-data;/);
    expect(onProgress).toHaveBeenNthCalledWith(1, 0);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it.each([408, 409, 429, 500, 503])('retries HTTP %s responses', async status => {
    mockedFetch.mockImplementation(async () => response(status, { error: `status ${status}` }));

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset });
    await runTimersAndExpectRejection(promise, `status ${status}`);

    expect(mockedFetch).toHaveBeenCalledTimes(5);
  });

  it('does not retry a terminal HTTP response', async () => {
    mockedFetch.mockResolvedValue(response(400, { error: 'invalid upload' }));

    await expect(uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset })).rejects.toThrow(
      'invalid upload'
    );
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('reports payload-too-large responses without retrying', async () => {
    mockedFetch.mockResolvedValue(response(413));

    await expect(uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset })).rejects.toThrow(
      'File size exceeded the upload limit'
    );
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('reports CDN HTML errors with the request ID', async () => {
    mockedFetch.mockResolvedValue(
      new Response('<html></html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html', 'cf-ray': 'ray-id' },
      })
    );

    await expect(uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset })).rejects.toThrow(
      'Request ID ray-id'
    );
  });

  it('switches to network mode and preserves the original network error', async () => {
    const networkError = Object.assign(new Error('getaddrinfo ENOTFOUND eas.expo.app'), {
      code: 'ENOTFOUND',
    });
    mockedFetch.mockRejectedValue(networkError);

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset });
    await runTimersAndExpectRejection(promise, networkError.message);

    expect(mockedFetch).toHaveBeenCalledTimes(8);
    expect(Log.warn).toHaveBeenCalledTimes(1);
    expect(Log.warn).toHaveBeenCalledWith(
      `The upload encountered an error but is still retrying: ${networkError.message}`
    );
  });

  it('smoothly increases retries based on the total request count', async () => {
    mockedFetch.mockImplementation(async () => response(503, { error: 'overloaded' }));

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset }, undefined, {
      totalRequests: 32,
    });
    await runTimersAndExpectRejection(promise, 'overloaded');

    // log10(32) / 3 results in six retries, plus the initial request.
    expect(mockedFetch).toHaveBeenCalledTimes(7);
  });

  it('caps request-count scaling at 1,000 requests', async () => {
    mockedFetch.mockImplementation(async () => response(503, { error: 'overloaded' }));

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset }, undefined, {
      totalRequests: 1_000_000,
    });
    await runTimersAndExpectRejection(promise, 'overloaded');

    // The scaled 40s ceiling cuts the last attempt the backoff schedule would have allowed.
    expect(mockedFetch).toHaveBeenCalledTimes(8);
  });

  it('keeps the retry state when it switches to network mode', async () => {
    let calls = 0;
    mockedFetch.mockImplementation(async () => {
      if (++calls <= 7) {
        return response(503, { error: 'overloaded' });
      }
      throw new Error('socket disconnected');
    });

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset }, undefined, {
      totalRequests: 1_000,
    });
    await runTimersAndExpectRejection(promise, 'socket disconnected');

    // The warning must not repeat once the network-mode attempts take over.
    expect(Log.warn).toHaveBeenCalledTimes(1);
    expect(Log.warn).toHaveBeenCalledWith(
      'The upload encountered an error but is still retrying: overloaded'
    );
  });

  it('warns before a short retry budget is exhausted', async () => {
    mockedFetch.mockImplementation(async () => response(503, { error: 'overloaded' }));

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset });
    await runTimersAndExpectRejection(promise, 'overloaded');

    expect(Log.warn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying at the scaled upload ceiling', async () => {
    mockedFetch.mockImplementation(async () => response(503, { error: 'overloaded' }));

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset }, undefined, {
      totalRequests: 1_000,
    });
    await runTimersAndExpectRejection(promise, 'overloaded');

    // The ceiling stops the next retry from being scheduled, so the last attempt already in
    // flight can overshoot it by up to one maxTimeout (10s at this scale).
    expect(Date.now()).toBeLessThanOrEqual(40_000 + 10_000);
  });

  it('clears the retry clock and the network flag after a success', async () => {
    const state = { hasSeenNetworkError: false, hasWarned: false, firstRetryAt: undefined };
    mockedFetch.mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response());

    const promise = uploadAsync({ baseURL: 'https://eas.expo.app' }, { asset }, undefined, {
      state,
    });
    await jest.runAllTimersAsync();
    await promise;

    expect(state.firstRetryAt).toBeUndefined();
    expect(state.hasSeenNetworkError).toBe(false);
  });

  it('does not retry or enter network mode after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    mockedFetch.mockRejectedValue(abortError);

    await expect(
      uploadAsync({ baseURL: 'https://eas.expo.app', signal: controller.signal }, { asset })
    ).rejects.toBe(abortError);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(Log.warn).not.toHaveBeenCalled();
  });
});

describe(callUploadApiAsync, () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    mockedFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns a successful JSON response', async () => {
    mockedFetch.mockResolvedValue(response(200, { result: 'complete' }));

    await expect(callUploadApiAsync('https://eas.expo.app/finalize')).resolves.toEqual({
      result: 'complete',
    });
  });

  it('retries server errors and passes through the final error', async () => {
    mockedFetch.mockResolvedValue(response(503));

    const promise = callUploadApiAsync('https://eas.expo.app/finalize');
    await runTimersAndExpectRejection(promise, 'Deployment failed: Request failed');
    // Deploy API calls get a somewhat larger retry budget than a single asset upload.
    expect(mockedFetch).toHaveBeenCalledTimes(7);
  });

  it('retries invalid JSON responses', async () => {
    mockedFetch
      .mockResolvedValueOnce(new Response('invalid JSON'))
      .mockResolvedValueOnce(response(200, { success: true }));

    const promise = callUploadApiAsync('https://eas.expo.app/finalize');
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ success: true });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('uses network retries for fetch errors', async () => {
    const networkError = new Error('socket disconnected');
    mockedFetch.mockRejectedValue(networkError);

    const promise = callUploadApiAsync('https://eas.expo.app/finalize');
    await runTimersAndExpectRejection(promise, networkError.message);
    // Network mode adds attempts but shares the 30s deadline, so it cannot double the wait.
    expect(mockedFetch).toHaveBeenCalledTimes(10);
  });

  it('stops retrying at the 30s ceiling', async () => {
    mockedFetch.mockResolvedValue(response(503));

    const promise = callUploadApiAsync('https://eas.expo.app/finalize');
    await runTimersAndExpectRejection(promise, 'Deployment failed: Request failed');

    expect(Date.now()).toBeLessThanOrEqual(30_000);
  });

  it('shares the ceiling with the network-mode attempts', async () => {
    mockedFetch.mockRejectedValue(new Error('socket disconnected'));

    const promise = callUploadApiAsync('https://eas.expo.app/finalize');
    await runTimersAndExpectRejection(promise, 'socket disconnected');

    expect(Date.now()).toBeLessThanOrEqual(30_000 + 5_000);
  });

  it('does not retry an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    mockedFetch.mockRejectedValue(abortError);

    await expect(
      callUploadApiAsync('https://eas.expo.app/finalize', { signal: controller.signal as any })
    ).rejects.toBe(abortError);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe(batchUploadAsync, () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads every payload and reports aggregate progress', async () => {
    mockedFetch.mockResolvedValue(response());
    const payloads: UploadPayload[] = [
      { asset },
      { asset: { ...asset, sha512: 'b'.repeat(128) } },
      { asset: { ...asset, sha512: 'c'.repeat(128) } },
    ];
    const progress = jest.fn();

    const results = [];
    for await (const result of batchUploadAsync(
      { baseURL: 'https://eas.expo.app' },
      payloads,
      progress
    )) {
      results.push(result);
    }

    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(results.at(-1)?.progress).toBe(1);
    expect(progress).toHaveBeenLastCalledWith(1);
  });

  it('accepts an empty upload queue', async () => {
    const results = [];
    for await (const result of batchUploadAsync({ baseURL: 'https://eas.expo.app' }, [])) {
      results.push(result);
    }

    expect(results).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('aborts sibling requests after the first upload failure', async () => {
    mockedFetch.mockImplementation(async (url, init) => {
      if (String(url).includes(asset.sha512)) {
        return response(400, { error: 'terminal failure' });
      }
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });

    const iterator = batchUploadAsync({ baseURL: 'https://eas.expo.app' }, [
      { asset },
      { asset: { ...asset, sha512: 'b'.repeat(128) } },
    ]);

    await iterator.next();
    await iterator.next();
    await expect(iterator.next()).rejects.toThrow('terminal failure');
  });
});

describe(createProgressBar, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts, updates, and stops the upload progress bar', () => {
    const start = jest.spyOn(cliProgress.SingleBar.prototype, 'start').mockImplementation(() => {});
    const update = jest
      .spyOn(cliProgress.SingleBar.prototype, 'update')
      .mockImplementation(() => {});
    const stop = jest.spyOn(cliProgress.SingleBar.prototype, 'stop').mockImplementation(() => {});

    const progressBar = createProgressBar('Uploading 3 assets');
    progressBar.update(0.5);
    progressBar.stop();

    expect(start).toHaveBeenCalledWith(1, 0);
    expect(update).toHaveBeenCalledWith(0.5);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
