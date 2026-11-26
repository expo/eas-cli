jest.mock('node-fetch', () => {
  const actual = jest.requireActual('node-fetch');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(),
  };
});

import fetch, { FetchError, Response } from 'node-fetch';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  fireBackoffTimersAsync,
  useFakeBackoffTimers,
  waitForBackoffTimerAsync,
} from '../../__tests__/utils/backoffTimers';
import { Datadog } from '../../datadog';
import { DownloadApiError, DownloadNetworkError, downloadToFileAsync } from '../downloadToFile';

const DOWNLOAD_URL = 'https://storage.example.test/bucket/file.zip?signature=secret';
const OPERATION = 'test.file_download';

function createSuccessfulResponse(body: string | Readable, url = DOWNLOAD_URL): Response {
  return {
    ok: true,
    status: 200,
    url,
    body: body instanceof Readable ? body : Readable.from(body),
  } as unknown as Response;
}

function createErrorResponse(status: number, text: string): Response {
  return { ok: false, status, statusText: 'Status Text', text: async () => text } as Response;
}

function createSocketFetchError(code: string): FetchError {
  return new FetchError(`request to ${DOWNLOAD_URL} failed, reason: connect ${code}`, 'system', {
    code,
  } as any);
}

function createBrokenBody(code: string): Readable {
  return Readable.from(
    (async function* () {
      yield Buffer.from('he');
      throw Object.assign(new Error(`body failed with ${code}`), { code });
    })()
  );
}

let destinationPath: string;

beforeEach(() => {
  useFakeBackoffTimers();
  destinationPath = path.join(os.tmpdir(), 'file.zip');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.mocked(fetch).mockReset();
});

describe(downloadToFileAsync, () => {
  it('downloads the URL to the destination path', async () => {
    jest.mocked(fetch).mockResolvedValue(createSuccessfulResponse('file content'));
    const signal = new AbortController().signal;
    const headers = { Authorization: 'Bearer token' };

    const filePath = await downloadToFileAsync(
      { url: DOWNLOAD_URL, headers, destinationPath },
      { operation: OPERATION, signal }
    );

    expect(filePath).toBe(destinationPath);
    expect(await fs.promises.readFile(filePath, 'utf8')).toBe('file content');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(DOWNLOAD_URL, { headers, signal });
  });

  it('resolves the destination path from the response', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValue(
        createSuccessfulResponse('file content', 'https://cdn.example.test/redirected.zip')
      );

    const filePath = await downloadToFileAsync(
      {
        url: DOWNLOAD_URL,
        destinationPath: response =>
          path.join(os.tmpdir(), path.basename(new URL(response.url).pathname)),
      },
      { operation: OPERATION }
    );

    expect(filePath).toBe(path.join(os.tmpdir(), 'redirected.zip'));
    expect(await fs.promises.readFile(filePath, 'utf8')).toBe('file content');
  });

  it.each([400, 403, 404, 410, 501])(
    'throws DownloadApiError without a retry on HTTP %s',
    async status => {
      jest.mocked(fetch).mockResolvedValue(createErrorResponse(status, 'AccessDenied'));

      const error = await downloadToFileAsync(
        { url: DOWNLOAD_URL, destinationPath },
        { operation: OPERATION }
      ).catch(error => error);

      expect(error).toBeInstanceOf(DownloadApiError);
      expect(error).toMatchObject({
        status,
        statusText: 'Status Text',
        responseText: 'AccessDenied',
        message: `Download failed: HTTP ${status} Status Text.`,
      });
      // Callers tell a cache miss from a failure by `error.response.status`.
      expect(error).not.toHaveProperty('response');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(destinationPath)).toBe(false);
    }
  );

  it.each([408, 429, 500, 502, 503, 504])('downloads again after HTTP %s', async status => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(createErrorResponse(status, 'try again'))
      .mockResolvedValueOnce(createSuccessfulResponse('file content'));

    const download = downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION }
    );
    await fireBackoffTimersAsync(1);

    expect(await fs.promises.readFile(await download, 'utf8')).toBe('file content');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws DownloadApiError when a retryable HTTP status persists', async () => {
    jest.mocked(fetch).mockResolvedValue(createErrorResponse(503, 'Service Unavailable'));
    const datadogLog = jest.spyOn(Datadog, 'log');

    const download = downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION }
    );
    const settled = download.catch(error => error);
    await fireBackoffTimersAsync(5);
    const error = await settled;

    expect(error).toBeInstanceOf(DownloadApiError);
    expect(error).toMatchObject({ status: 503, responseText: 'Service Unavailable' });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(datadogLog).toHaveBeenCalledWith(
      `${OPERATION} failed on attempt 6`,
      expect.objectContaining({ operation: OPERATION, outcome: 'failed' })
    );
  });

  it('downloads again after a socket error before the headers', async () => {
    jest
      .mocked(fetch)
      .mockRejectedValueOnce(createSocketFetchError('ECONNRESET'))
      .mockResolvedValueOnce(createSuccessfulResponse('file content'));
    const datadogLog = jest.spyOn(Datadog, 'log');

    const download = downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION }
    );
    await fireBackoffTimersAsync(1);

    expect(await fs.promises.readFile(await download, 'utf8')).toBe('file content');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(datadogLog).toHaveBeenCalledWith(
      `${OPERATION} recovered on attempt 2`,
      expect.objectContaining({ outcome: 'recovered', code: 'ECONNRESET' })
    );
  });

  it.each(['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET'])(
    'downloads again when the body breaks off with %s after the headers arrived',
    async code => {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(createSuccessfulResponse(createBrokenBody(code)))
        .mockResolvedValueOnce(createSuccessfulResponse('hello'));

      const download = downloadToFileAsync(
        { url: DOWNLOAD_URL, destinationPath },
        { operation: OPERATION }
      );
      await fireBackoffTimersAsync(1);

      expect(await fs.promises.readFile(await download, 'utf8')).toBe('hello');
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  );

  it('throws DownloadNetworkError without the URL when the transfer keeps failing', async () => {
    jest.mocked(fetch).mockRejectedValue(createSocketFetchError('ETIMEDOUT'));

    const download = downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION }
    );
    const settled = download.catch(error => error);
    await fireBackoffTimersAsync(5);
    const error = await settled;

    expect(error).toBeInstanceOf(DownloadNetworkError);
    expect(error).toMatchObject({
      code: 'ETIMEDOUT',
      reason: 'ETIMEDOUT',
      message: 'Download failed: ETIMEDOUT.',
    });
    expect(error.cause).toBeUndefined();
    expect(error).not.toHaveProperty('response');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('removes the partial file when the body keeps breaking off', async () => {
    jest
      .mocked(fetch)
      .mockImplementation(async () => createSuccessfulResponse(createBrokenBody('ECONNRESET')));

    const download = downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION }
    );
    const settled = download.catch(error => error);
    await fireBackoffTimersAsync(5);
    const error = await settled;

    expect(error).toBeInstanceOf(DownloadNetworkError);
    expect(error.message).toBe('Download failed: ECONNRESET.');
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fs.existsSync(destinationPath)).toBe(false);
  });

  it('throws DownloadNetworkError without a retry on a node-fetch error that is not a transfer failure', async () => {
    jest
      .mocked(fetch)
      .mockRejectedValue(
        new FetchError(`maximum redirect reached at: ${DOWNLOAD_URL}`, 'max-redirect')
      );

    const error = await downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION }
    ).catch(error => error);

    expect(error).toBeInstanceOf(DownloadNetworkError);
    expect(error).toMatchObject({ code: undefined, message: 'Download failed: network error.' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rethrows an error that is not a network failure', async () => {
    const failure = new TypeError('Only absolute URLs are supported');
    jest.mocked(fetch).mockRejectedValue(failure);

    await expect(
      downloadToFileAsync({ url: 'not-a-url', destinationPath }, { operation: OPERATION })
    ).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the given number of retries and the given first wait', async () => {
    jest.mocked(fetch).mockRejectedValue(createSocketFetchError('ECONNRESET'));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const download = downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION, retries: 3, minTimeoutMs: 100 }
    );
    const settled = download.catch(error => error);
    await fireBackoffTimersAsync(3);
    const error = await settled;

    expect(error).toBeInstanceOf(DownloadNetworkError);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(setTimeoutSpy.mock.calls.map(([, delayMs]) => delayMs)).toEqual([100, 200, 400]);
  });

  it('does not start the request when already aborted', async () => {
    const reason = new Error('step timed out');

    await expect(
      downloadToFileAsync(
        { url: DOWNLOAD_URL, destinationPath },
        { operation: OPERATION, signal: AbortSignal.abort(reason) }
      )
    ).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not start another attempt after an abort during the backoff', async () => {
    jest.mocked(fetch).mockRejectedValueOnce(createSocketFetchError('ECONNRESET'));
    const controller = new AbortController();
    const reason = new Error('step timed out');

    const download = downloadToFileAsync(
      { url: DOWNLOAD_URL, destinationPath },
      { operation: OPERATION, signal: controller.signal }
    );
    const rejection = expect(download).rejects.toBe(reason);
    await waitForBackoffTimerAsync();
    controller.abort(reason);
    await jest.advanceTimersToNextTimerAsync();

    await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
