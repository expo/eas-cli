import { SystemError, UserError } from '@expo/eas-build-job';
import { createLogger } from '@expo/logger';
import { Client, CombinedError } from '@urql/core';
import fetch, { Response } from 'node-fetch';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

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

describe('downloadBuild', () => {
  it('downloads from applicationArchiveUrl returned by GraphQL', async () => {
    const buildId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl: APPLICATION_ARCHIVE_URL,
    });

    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      body: Readable.from(APP_TAR_GZ_BUFFER),
      url: APPLICATION_ARCHIVE_URL,
    } as unknown as Response);

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

  it('should handle a straight-up file', async () => {
    const applicationArchiveUrl = `https://expo.dev/artifacts/eas/${randomUUID()}.apk`;
    const graphqlClient = createMockGraphqlClient({
      applicationArchiveUrl,
    });

    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      body: Readable.from(Buffer.from('hello')),
      url: applicationArchiveUrl,
    } as unknown as Response);

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

    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      body: Readable.from(APP_TAR_GZ_BUFFER),
      url: APPLICATION_ARCHIVE_URL,
    } as unknown as Response);

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
