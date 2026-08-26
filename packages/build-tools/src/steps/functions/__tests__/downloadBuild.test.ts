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
}: {
  applicationArchiveUrl?: string | null;
  error?: Error;
}): Client {
  const toPromise = jest.fn().mockResolvedValue(
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
  body: Buffer;
  url: string;
  headers?: Record<string, string>;
}): Response {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
  );

  return {
    ok: true,
    body: Readable.from(body),
    url,
    headers: {
      get: (name: string): string | null => normalizedHeaders[name.toLowerCase()] ?? null,
    },
  } as unknown as Response;
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

describe('downloadBuild', () => {
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

  it('throws SystemError when GraphQL request fails with a network error', async () => {
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      error: new CombinedError({
        networkError: new Error('Network request failed'),
      }),
    });

    const promise = downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId,
      graphqlClient,
      robotAccessToken: null,
      extensions: ['app'],
    });

    await expect(promise).rejects.toBeInstanceOf(SystemError);
    await expect(promise).rejects.toMatchObject({
      message: `Could not fetch build ${buildId}: [Network] Network request failed`,
    });

    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('throws SystemError when GraphQL request returns 5xx', async () => {
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      error: Object.assign(new Error('Internal Server Error'), {
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

    await expect(promise).rejects.toBeInstanceOf(SystemError);
    await expect(promise).rejects.toMatchObject({
      message: `Could not fetch build ${buildId}: Internal Server Error`,
    });

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

    expect(jest.mocked(fetch)).not.toHaveBeenCalled();
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
