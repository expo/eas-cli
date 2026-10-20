import { SystemError, UserError } from '@expo/eas-build-job';
import { createLogger } from '@expo/logger';
import { Client, CombinedError } from '@urql/core';
import fetch, { Response } from 'node-fetch';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as tar from 'tar';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { Datadog } from '../../../datadog';
import * as files from '../../../utils/files';
import { createDownloadBuildFunction, downloadBuildAsync } from '../downloadBuild';

// contains a 'TestApp.app/TestApp' file with 'i am executable' content
const APP_TAR_GZ_BUFFER = Buffer.from(
  'H4sIAMK9HGgAA+2SWwrDIBBF/e4qXIEZjY/v7qEbsMHQlASkGujyI40UWvqgEFNK5/xcYUSvHFlFigMARil6ST0nCDlnhnKVhrzWOg2Ai1pwQlX5aoSMIdpTqhKOzWHoXG+f7Evb2vbFOfkd1/wRWLVzIW69Z9b7Qn/hI/8Gkn8pNfpfhVv/eb3wHW/9i3v/yihDKCzc4yF/7r+jdqDu7Jox2n3vNt/ugyAIgqzDBKNW1bQAD' +
    Array.from({ length: 442 }, () => 'A') +
    '=',
  'base64'
);

const FLAT_APP_INFO_PLIST_BASE64 =
  'YnBsaXN0MDDSAQIDBF8QEkNGQnVuZGxlRXhlY3V0YWJsZV8QE0NGQnVuZGxlUGFja2FnZVR5cGVXVGVzdEFwcFRBUFBMCA0iOEAAAAAAAAABAQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAARQ==';

const APPLICATION_ARCHIVE_URL = `https://expo.dev/artifacts/eas/${randomUUID()}.tar.gz`;

function createMockGraphqlClient({
  applicationArchiveUrl,
  error,
  transientError,
}: {
  applicationArchiveUrl?: string | null;
  error?: Error;
  transientError?: Error;
}): Client {
  const toPromise = jest.fn();
  if (transientError) {
    toPromise.mockResolvedValueOnce({ error: transientError, data: undefined });
  }
  toPromise.mockResolvedValue(
    error
      ? { error, data: undefined }
      : {
          data: {
            builds: {
              byId: {
                id: randomUUID(),
                platform: 'IOS',
                artifacts: {
                  applicationArchiveUrl: applicationArchiveUrl ?? null,
                },
              },
            },
          },
        }
  );

  return {
    query: jest.fn().mockReturnValue({ toPromise }),
  } as unknown as Client;
}

function createSuccessfulResponse({
  body,
  url,
  headers,
}: {
  body: Buffer | Readable;
  url: string;
  headers?: Record<string, string>;
}): Response {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
  );

  return {
    ok: true,
    body: body instanceof Readable ? body : Readable.from(body),
    url,
    headers: {
      get: (name: string): string | null => normalizedHeaders[name.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

function createUndiciNetworkError(code: string): CombinedError {
  return new CombinedError({
    networkError: Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(`read ${code}`), { code }),
    }),
  });
}

const { FetchError: ActualFetchError } = jest.requireActual(
  'node-fetch'
) as typeof import('node-fetch');

function createSocketFetchError(url: string, code: string): Error {
  return new ActualFetchError(`request to ${url} failed, reason: connect ${code}`, 'system', {
    code,
  } as any);
}

function useFakeBackoffTimers(): void {
  // Streams and fs callbacks need the real nextTick and setImmediate; only the backoff timers are faked.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
}

const MAX_IO_TURNS_BEFORE_BACKOFF = 1000;

async function waitForBackoffTimerAsync(): Promise<void> {
  for (let turns = 0; jest.getTimerCount() === 0; turns++) {
    if (turns === MAX_IO_TURNS_BEFORE_BACKOFF) {
      throw new Error('No backoff timer was scheduled.');
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function fireBackoffTimersAsync(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await waitForBackoffTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
  }
}

async function createFlatAppTarGzBufferAsync(): Promise<Buffer> {
  const sourceDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flat-app-source-'));
  const archivePath = path.join(os.tmpdir(), `${randomUUID()}.tar.gz`);

  try {
    await Promise.all([
      fs.promises.writeFile(path.join(sourceDirectory, 'Info.plist'), FLAT_APP_INFO_PLIST_BASE64, {
        encoding: 'base64',
      }),
      fs.promises.writeFile(path.join(sourceDirectory, 'TestApp'), 'i am executable\n'),
    ]);
    await tar.create(
      {
        cwd: sourceDirectory,
        file: archivePath,
        gzip: true,
      },
      ['Info.plist', 'TestApp']
    );
    return await fs.promises.readFile(archivePath);
  } finally {
    await Promise.all([
      fs.promises.rm(sourceDirectory, { recursive: true, force: true }),
      fs.promises.rm(archivePath, { force: true }),
    ]);
  }
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('downloadBuild', () => {
  it.each([404, 410])('identifies the unavailable build on HTTP %s', async status => {
    const buildId = randomUUID();
    const { Response: ActualResponse } =
      jest.requireActual<typeof import('node-fetch')>('node-fetch');
    jest
      .mocked(fetch)
      .mockResolvedValue(new ActualResponse('<Error>NoSuchKey</Error>', { status }));

    await expect(
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        buildId,
        graphqlClient: createMockGraphqlClient({ applicationArchiveUrl: APPLICATION_ARCHIVE_URL }),
        robotAccessToken: null,
        extensions: ['app'],
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_BUILD_ARCHIVE_UNAVAILABLE',
      message:
        `Failed to download the application archive for build ${buildId} (HTTP ${status}). ` +
        'The archive is no longer available; it may have expired or been deleted. ' +
        'Select another build or provide an available application archive URL.',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([404, 500])(
    'identifies the application URL without credentials on HTTP %s',
    async status => {
      const { Response: ActualResponse } =
        jest.requireActual<typeof import('node-fetch')>('node-fetch');
      jest.mocked(fetch).mockResolvedValue(new ActualResponse('download failed', { status }));

      const download = downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        applicationArchiveUrl:
          'https://user:password@example.test/app.tar.gz?token=secret#fragment',
        graphqlClient: createMockGraphqlClient({}),
        robotAccessToken: null,
        extensions: ['app'],
      });

      await expect(download).rejects.toThrow(
        `Failed to download the application archive at https://example.test/app.tar.gz (HTTP ${status})`
      );
      await expect(download).rejects.not.toThrow(/password|secret|fragment/);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('downloads from applicationArchiveUrl returned by GraphQL', async () => {
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });

    jest.mocked(fetch).mockResolvedValue(
      createSuccessfulResponse({
        body: APP_TAR_GZ_BUFFER,
        url: APPLICATION_ARCHIVE_URL,
      })
    );

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
    });

    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      APPLICATION_ARCHIVE_URL,
      expect.objectContaining({ headers: undefined })
    );
    expect(artifactPath).toBeDefined();
    expect(await fs.promises.readFile(path.join(artifactPath, 'TestApp'), 'utf8')).toBe(
      'i am executable\n'
    );
  });

  it('downloads an archive containing app bundle contents at its root', async () => {
    jest.mocked(fetch).mockResolvedValue(
      createSuccessfulResponse({
        body: await createFlatAppTarGzBufferAsync(),
        url: APPLICATION_ARCHIVE_URL,
      })
    );

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
      graphqlClient: createMockGraphqlClient({}),
      robotAccessToken: null,
      extensions: ['app'],
    });

    expect(path.extname(artifactPath)).toBe('.app');
    expect(await fs.promises.readFile(path.join(artifactPath, 'TestApp'), 'utf8')).toBe(
      'i am executable\n'
    );
  });

  it('should handle a straight-up file', async () => {
    const applicationArchiveUrl = `https://expo.dev/artifacts/eas/${randomUUID()}.apk`;
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl,
    });

    jest
      .mocked(fetch)
      .mockResolvedValue(
        createSuccessfulResponse({ body: Buffer.from('hello'), url: applicationArchiveUrl })
      );

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId: randomUUID(),
      graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
    });

    expect(artifactPath).toBeDefined();
    expect(await fs.promises.readFile(artifactPath, 'utf-8')).toBe('hello');
  });

  it('downloads a direct application archive URL without querying GraphQL or forwarding the EAS token', async () => {
    const applicationArchiveUrl = `https://artifacts.example.test/${randomUUID()}.apk`;
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });

    jest
      .mocked(fetch)
      .mockResolvedValue(
        createSuccessfulResponse({ body: Buffer.from('hello'), url: applicationArchiveUrl })
      );

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      applicationArchiveUrl,
      graphqlClient,
      robotAccessToken: 'scoped-eas-token',
      extensions: ['apk'],
    });

    expect(graphqlClient.query).not.toHaveBeenCalled();
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      applicationArchiveUrl,
      expect.objectContaining({ headers: undefined })
    );
    expect(await fs.promises.readFile(artifactPath, 'utf-8')).toBe('hello');
  });

  it('uses the Content-Disposition filename for an extensionless URL', async () => {
    const applicationArchiveUrl = 'https://artifacts.example.test/download';
    jest.mocked(fetch).mockResolvedValue(
      createSuccessfulResponse({
        body: Buffer.from('hello'),
        url: applicationArchiveUrl,
        headers: { 'content-disposition': 'attachment; filename="app.apk"' },
      })
    );

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      applicationArchiveUrl,
      graphqlClient: createMockGraphqlClient({}),
      robotAccessToken: null,
      extensions: ['apk'],
    });

    expect(path.basename(artifactPath)).toBe('app.apk');
    expect(await fs.promises.readFile(artifactPath, 'utf-8')).toBe('hello');
  });

  it('uses the expected extension when the URL has no filename', async () => {
    const applicationArchiveUrl = 'https://artifacts.example.test/';
    jest
      .mocked(fetch)
      .mockResolvedValue(
        createSuccessfulResponse({ body: Buffer.from('hello'), url: applicationArchiveUrl })
      );

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      applicationArchiveUrl,
      graphqlClient: createMockGraphqlClient({}),
      robotAccessToken: null,
      extensions: ['apk'],
    });

    expect(path.basename(artifactPath)).toBe('application.apk');
    expect(await fs.promises.readFile(artifactPath, 'utf-8')).toBe('hello');
  });

  it('passes the abort signal to the build lookup', async () => {
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });
    jest
      .mocked(fetch)
      .mockResolvedValue(
        createSuccessfulResponse({ body: APP_TAR_GZ_BUFFER, url: APPLICATION_ARCHIVE_URL })
      );
    const buildId = randomUUID();

    await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
      signal: new AbortController().signal,
    });

    expect(graphqlClient.query).toHaveBeenCalledWith(
      expect.anything(),
      { buildId },
      { fetch: expect.any(Function) }
    );
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      APPLICATION_ARCHIVE_URL,
      expect.objectContaining({ signal: expect.any(Object) })
    );
  });

  it('stops a pending build lookup when aborted', async () => {
    // The lookup request runs through the abort-aware fetch from graphqlAbortContext and
    // hangs until its signal fires, like a stalled API call.
    const realFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
        })
    ) as typeof globalThis.fetch;
    const graphqlClient = {
      query: jest.fn((_query, _variables, context: { fetch: typeof globalThis.fetch }) => ({
        toPromise: () =>
          context.fetch('https://api.expo.dev/graphql', {}).then(
            () => ({ data: undefined }),
            (networkError: Error) => ({ error: new CombinedError({ networkError }) })
          ),
      })),
    } as unknown as Client;
    const controller = new AbortController();
    const failure = new Error('daemon failed');

    try {
      const download = downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        buildId: randomUUID(),
        graphqlClient,
        robotAccessToken: null,
        extensions: ['app'],
        signal: controller.signal,
      });
      await new Promise(resolve => setImmediate(resolve));
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      controller.abort(failure);

      await expect(download).rejects.toBe(failure);
      expect(jest.mocked(fetch)).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('lets a started extraction finish before it reports an abort', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValue(
        createSuccessfulResponse({ body: APP_TAR_GZ_BUFFER, url: APPLICATION_ARCHIVE_URL })
      );
    const { decompressTarAsync } = jest.requireActual<typeof files>('../../../utils/files');
    const controller = new AbortController();
    const failure = new Error('daemon failed');
    let extractionDirectory: string | undefined;
    let extractionFinished = false;
    const decompressSpy = jest.spyOn(files, 'decompressTarAsync').mockImplementation(async args => {
      extractionDirectory = args.destinationDirectory;
      // The startup fails while the archive is being extracted.
      controller.abort(failure);
      await decompressTarAsync(args);
      extractionFinished = true;
    });

    try {
      await expect(
        downloadBuildAsync({
          logger: createLogger({ name: 'test' }),
          applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
          graphqlClient: createMockGraphqlClient({}),
          robotAccessToken: null,
          extensions: ['app'],
          signal: controller.signal,
        })
      ).rejects.toBe(failure);

      // The download settled only after the extraction wrote its last file.
      expect(extractionFinished).toBe(true);
      expect(
        await fs.promises.readFile(
          path.join(extractionDirectory!, 'TestApp.app', 'TestApp'),
          'utf8'
        )
      ).toBe('i am executable\n');
    } finally {
      decompressSpy.mockRestore();
    }
  });

  it('does not look up the build when already aborted', async () => {
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });
    const failure = new Error('boot failed');

    await expect(
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        buildId: randomUUID(),
        graphqlClient,
        robotAccessToken: null,
        extensions: ['app'],
        signal: AbortSignal.abort(failure),
      })
    ).rejects.toBe(failure);
    expect(graphqlClient.query).not.toHaveBeenCalled();
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('rejects missing or ambiguous build sources', async () => {
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });

    await expect(
      // @ts-expect-error Verify the runtime guard for callers without TypeScript.
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        graphqlClient,
        robotAccessToken: null,
        extensions: ['app'],
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
      message: 'Pass buildId or applicationArchiveUrl.',
    });

    await expect(
      // @ts-expect-error Verify the runtime guard for callers without TypeScript.
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        buildId: randomUUID(),
        applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
        graphqlClient,
        robotAccessToken: null,
        extensions: ['app'],
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
      message: 'Pass only one of buildId or applicationArchiveUrl.',
    });

    expect(graphqlClient.query).not.toHaveBeenCalled();
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('rejects a non-HTTP application archive URL', async () => {
    await expect(
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        applicationArchiveUrl: 'file:///tmp/app.apk',
        graphqlClient: createMockGraphqlClient({}),
        robotAccessToken: null,
        extensions: ['apk'],
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_BUILD_INVALID_APPLICATION_ARCHIVE_URL',
      message: 'application_archive_url must be a valid HTTP or HTTPS URL.',
    });
  });

  it('throws UserError when the build has no application archive url', async () => {
    const graphqlClient = createMockGraphqlClient({ applicationArchiveUrl: null });

    await expect(
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        buildId: randomUUID(),
        graphqlClient,
        robotAccessToken: null,
        extensions: ['app'],
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_BUILD_NO_APPLICATION_ARCHIVE',
      message: 'Build does not have an application archive url',
    });

    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('throws SystemError with the cause code after retrying a failing build lookup', async () => {
    useFakeBackoffTimers();
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      error: createUndiciNetworkError('ECONNRESET'),
    });
    const datadogLog = jest.spyOn(Datadog, 'log');

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(SystemError);
    await fireBackoffTimersAsync(5);

    await rejection;
    await expect(promise).rejects.toMatchObject({
      message: `Could not fetch build ${buildId}: [Network] fetch failed (ECONNRESET)`,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(6);
    expect(datadogLog).toHaveBeenCalledWith('download_build.build_lookup failed on attempt 6', {
      event: 'network_retry',
      operation: 'download_build.build_lookup',
      outcome: 'failed',
      attempts: '6',
      code: 'ECONNRESET',
    });
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([
    ['a network error', createUndiciNetworkError('ECONNRESET'), 'ECONNRESET'],
    [
      'a transient GraphQL error',
      new CombinedError({
        graphQLErrors: [
          {
            message: 'Too many requests',
            extensions: { isTransient: true, errorCode: 'TOO_MANY_REQUESTS' },
          },
        ],
        response: { status: 200 },
      }),
      'TOO_MANY_REQUESTS',
    ],
  ])('downloads after a build lookup that failed once with %s', async (_, transientError, code) => {
    useFakeBackoffTimers();
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
      transientError,
    });
    jest
      .mocked(fetch)
      .mockResolvedValue(
        createSuccessfulResponse({ body: Buffer.from('hello'), url: 'https://cdn.test/app.apk' })
      );

    const datadogLog = jest.spyOn(Datadog, 'log');

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['apk'],
    });
    await fireBackoffTimersAsync(1);

    const { artifactPath } = await promise;
    expect(path.basename(artifactPath)).toBe('app.apk');
    expect(graphqlClient.query).toHaveBeenCalledTimes(2);
    expect(datadogLog).toHaveBeenCalledWith('download_build.build_lookup recovered on attempt 2', {
      event: 'network_retry',
      operation: 'download_build.build_lookup',
      outcome: 'recovered',
      attempts: '2',
      code,
    });
  });

  it('throws SystemError when GraphQL request returns 5xx', async () => {
    useFakeBackoffTimers();
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      error: new CombinedError({
        graphQLErrors: [{ message: 'Internal Server Error' }],
        response: { status: 500 },
      }),
    });

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(SystemError);
    await fireBackoffTimersAsync(5);

    await rejection;
    await expect(promise).rejects.toMatchObject({
      message: `Could not fetch build ${buildId}: [GraphQL] Internal Server Error`,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(6);
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('throws UserError when GraphQL returns a client error', async () => {
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      error: new CombinedError({
        graphQLErrors: [{ message: 'Build not found' }],
      }),
    });

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
    });

    await expect(promise).rejects.toBeInstanceOf(UserError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_BUILD_FETCH_FAILED',
      message: `Could not fetch build ${buildId}: [GraphQL] Build not found`,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('downloads after an archive request that failed once with a socket error', async () => {
    useFakeBackoffTimers();
    const graphqlClient = createMockGraphqlClient({});
    jest
      .mocked(fetch)
      .mockRejectedValueOnce(createSocketFetchError(APPLICATION_ARCHIVE_URL, 'ECONNRESET'))
      .mockResolvedValueOnce(
        createSuccessfulResponse({ body: Buffer.from('hello'), url: 'https://cdn.test/app.apk' })
      );

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['apk'],
    });
    await fireBackoffTimersAsync(1);

    const { artifactPath } = await promise;
    expect(path.basename(artifactPath)).toBe('app.apk');
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('throws SystemError with the cause code after retrying a failing build archive request', async () => {
    useFakeBackoffTimers();
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });
    jest
      .mocked(fetch)
      .mockRejectedValue(createSocketFetchError(APPLICATION_ARCHIVE_URL, 'ETIMEDOUT'));
    const datadogLog = jest.spyOn(Datadog, 'log');

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId: randomUUID(),
      graphqlClient,
      robotAccessToken: null,
      extensions: ['apk'],
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(SystemError);
    await fireBackoffTimersAsync(5);

    await rejection;
    await expect(promise).rejects.toMatchObject({
      message: `Could not download the application archive: request to ${APPLICATION_ARCHIVE_URL} failed, reason: connect ETIMEDOUT`,
    });
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(6);
    expect(datadogLog).toHaveBeenCalledWith('download_build.archive_download failed on attempt 6', {
      event: 'network_retry',
      operation: 'download_build.archive_download',
      outcome: 'failed',
      attempts: '6',
      code: 'ETIMEDOUT',
    });
  });

  function createBrokenBody(code: string): Readable {
    return Readable.from(
      (async function* () {
        yield Buffer.from('he');
        throw Object.assign(new Error(`body failed with ${code}`), { code });
      })()
    );
  }

  it.each(['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET'])(
    'downloads again when the archive body breaks off with %s after the headers arrived',
    async code => {
      useFakeBackoffTimers();
      const graphqlClient = createMockGraphqlClient({});
      const brokenBody = createBrokenBody(code);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          createSuccessfulResponse({ body: brokenBody, url: 'https://cdn.test/app.apk' })
        )
        .mockResolvedValueOnce(
          createSuccessfulResponse({ body: Buffer.from('hello'), url: 'https://cdn.test/app.apk' })
        );
      const datadogLog = jest.spyOn(Datadog, 'log');

      const promise = downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
        graphqlClient,
        robotAccessToken: null,
        extensions: ['apk'],
      });
      await fireBackoffTimersAsync(1);

      const { artifactPath } = await promise;
      expect(await fs.promises.readFile(artifactPath, 'utf-8')).toBe('hello');
      expect(jest.mocked(fetch)).toHaveBeenCalledTimes(2);
      expect(datadogLog).toHaveBeenCalledWith(
        'download_build.archive_download recovered on attempt 2',
        expect.objectContaining({ outcome: 'recovered', code })
      );
    }
  );

  it('throws SystemError when the build archive body keeps breaking off', async () => {
    useFakeBackoffTimers();
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });
    jest.mocked(fetch).mockImplementation(async () =>
      createSuccessfulResponse({
        body: createBrokenBody('ECONNRESET'),
        url: 'https://cdn.test/app.apk',
      })
    );
    const datadogLog = jest.spyOn(Datadog, 'log');

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId: randomUUID(),
      graphqlClient,
      robotAccessToken: null,
      extensions: ['apk'],
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(SystemError);
    await fireBackoffTimersAsync(5);

    await rejection;
    await expect(promise).rejects.toMatchObject({
      message: 'Could not download the application archive: body failed with ECONNRESET',
    });
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(6);
    expect(datadogLog).toHaveBeenCalledWith(
      'download_build.archive_download failed on attempt 6',
      expect.objectContaining({ outcome: 'failed', code: 'ECONNRESET' })
    );
  });

  it('does not start another archive attempt after an abort during the backoff', async () => {
    useFakeBackoffTimers();
    const graphqlClient = createMockGraphqlClient({});
    jest
      .mocked(fetch)
      .mockRejectedValueOnce(createSocketFetchError(APPLICATION_ARCHIVE_URL, 'ECONNRESET'));
    const controller = new AbortController();
    const reason = new Error('step timed out');

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['apk'],
      signal: controller.signal,
    });
    const rejection = expect(promise).rejects.toBe(reason);
    await waitForBackoffTimerAsync();
    controller.abort(reason);
    await jest.advanceTimersToNextTimerAsync();

    await rejection;
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('rethrows the raw error of a failing user-supplied archive URL after the retries', async () => {
    useFakeBackoffTimers();
    const graphqlClient = createMockGraphqlClient({});
    jest
      .mocked(fetch)
      .mockRejectedValue(createSocketFetchError(APPLICATION_ARCHIVE_URL, 'ENOTFOUND'));

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['apk'],
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(ActualFetchError);
    await fireBackoffTimersAsync(5);

    await rejection;
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(6);
  });

  it('should throw an error if no matching files are found', async () => {
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });

    jest.mocked(fetch).mockResolvedValue(
      createSuccessfulResponse({
        body: APP_TAR_GZ_BUFFER,
        url: APPLICATION_ARCHIVE_URL,
      })
    );

    await expect(
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        buildId: randomUUID(),
        graphqlClient,
        robotAccessToken: null,
        extensions: ['apk'],
      })
    ).rejects.toThrow('No .apk entries found in the archive.');
  });
});

describe('createDownloadBuildFunction', () => {
  it('aborts a pending archive request when the step times out', async () => {
    let requestAborted = false;
    jest.mocked(fetch).mockImplementation(
      async (_url, options) =>
        await new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            requestAborted = true;
            reject(new Error('Archive request aborted'));
          });
        })
    );
    const graphqlClient = createMockGraphqlClient({});
    const step = createDownloadBuildFunction({
      graphqlClient,
    } as any).createBuildStepFromFunctionCall(
      createGlobalContextMock({ staticContextContent: { job: {} } }),
      {
        callInputs: { application_archive_url: APPLICATION_ARCHIVE_URL, extensions: ['ipa'] },
        timeoutMs: 100,
      }
    );

    await expect(step.executeAsync()).rejects.toThrow('timed out');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestAborted).toBe(true);
    expect(graphqlClient.query).not.toHaveBeenCalled();
  });

  describe('with a device run session token in the job env', () => {
    const { Response: ActualResponse } = jest.requireActual(
      'node-fetch'
    ) as typeof import('node-fetch');
    const workerApiUrl = 'https://api.expo.test/v2/device-run-session-worker/application';

    function createSessionCtx(graphqlClient: Client): any {
      return {
        graphqlClient,
        env: { EAS_DEVICE_RUN_SESSION_TOKEN: 'session-token' },
        expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      };
    }

    function createApplicationResponse(buildId: string): Response {
      return new ActualResponse(
        JSON.stringify({
          data: {
            build: {
              id: buildId,
              gitCommitHash: null,
              applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
            },
          },
        }),
        { status: 200 }
      );
    }

    function createStep(ctx: any, callInputs: Record<string, unknown>) {
      return createDownloadBuildFunction(ctx).createBuildStepFromFunctionCall(
        createGlobalContextMock({
          logger: createMockLogger(),
          staticContextContent: { job: { secrets: { robotAccessToken: 'session-token' } } },
        }),
        { callInputs }
      );
    }

    it('looks up build_id through the worker API and downloads without an Authorization header', async () => {
      const buildId = randomUUID();
      const graphqlClient = createMockGraphqlClient({});
      jest.mocked(fetch).mockImplementation(async url => {
        if (url === workerApiUrl) {
          return createApplicationResponse(buildId);
        }
        return {
          ok: false,
          text: () => Promise.resolve('Internal Server Error'),
          status: 500,
        } as unknown as Response;
      });

      await expect(
        createStep(createSessionCtx(graphqlClient), {
          build_id: buildId,
          extensions: ['app'],
        }).executeAsync()
      ).rejects.toThrow('Internal Server Error');

      expect(jest.mocked(fetch)).toHaveBeenCalledWith(
        workerApiUrl,
        expect.objectContaining({
          method: 'GET',
          headers: { 'expo-device-run-session-token': 'session-token' },
        })
      );
      expect(jest.mocked(fetch)).toHaveBeenCalledWith(
        APPLICATION_ARCHIVE_URL,
        expect.objectContaining({ headers: undefined })
      );
      expect(graphqlClient.query).not.toHaveBeenCalled();
    });

    it('retries the worker API lookup after a 5xx response', async () => {
      useFakeBackoffTimers();
      const buildId = randomUUID();
      const graphqlClient = createMockGraphqlClient({});
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(new ActualResponse('Service Unavailable', { status: 503 }))
        .mockResolvedValueOnce(createApplicationResponse(buildId))
        .mockResolvedValueOnce(
          createSuccessfulResponse({ body: Buffer.from('hello'), url: 'https://cdn.test/app.apk' })
        );

      const execution = createStep(createSessionCtx(graphqlClient), {
        build_id: buildId,
        extensions: ['apk'],
      }).executeAsync();
      await fireBackoffTimersAsync(1);

      await execution;
      expect(jest.mocked(fetch)).toHaveBeenCalledTimes(3);
      expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
        workerApiUrl,
        workerApiUrl,
        APPLICATION_ARCHIVE_URL,
      ]);
    });

    it('does not call the worker API for an application_archive_url input', async () => {
      const graphqlClient = createMockGraphqlClient({});
      jest.mocked(fetch).mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Internal Server Error'),
        status: 500,
      } as unknown as Response);

      await expect(
        createStep(createSessionCtx(graphqlClient), {
          application_archive_url: APPLICATION_ARCHIVE_URL,
          extensions: ['app'],
        }).executeAsync()
      ).rejects.toThrow('Internal Server Error');

      expect(jest.mocked(fetch)).toHaveBeenCalledTimes(1);
      expect(jest.mocked(fetch)).toHaveBeenCalledWith(
        APPLICATION_ARCHIVE_URL,
        expect.objectContaining({ headers: undefined })
      );
      expect(graphqlClient.query).not.toHaveBeenCalled();
    });
  });

  it('should download a build', async () => {
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });
    const downloadBuild = createDownloadBuildFunction({ graphqlClient } as any);
    const logger = createMockLogger();

    const buildStep = downloadBuild.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        logger,
        staticContextContent: {
          expoApiServerURL: 'http://api.expo.test',
          job: {},
        },
      }),
      {
        callInputs: {
          build_id: buildId,
          extensions: ['app'],
        },
      }
    );

    jest.mocked(fetch).mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Internal Server Error'),
      status: 500,
    } as unknown as Response);

    await expect(buildStep.executeAsync()).rejects.toThrow('Internal Server Error');
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      APPLICATION_ARCHIVE_URL,
      expect.objectContaining({ headers: undefined })
    );
  });
});
