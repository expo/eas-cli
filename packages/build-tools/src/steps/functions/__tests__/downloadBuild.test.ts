import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { createLogger } from '@expo/logger';
import fetch, { Response } from 'node-fetch';

import { createDownloadBuildFunction, downloadBuildAsync } from '../downloadBuild';
import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';

// contains a 'TestApp.app/TestApp' file with 'i am executable' content
const APP_TAR_GZ_BUFFER = Buffer.from(
  'H4sIAMK9HGgAA+2SWwrDIBBF/e4qXIEZjY/v7qEbsMHQlASkGujyI40UWvqgEFNK5/xcYUSvHFlFigMARil6ST0nCDlnhnKVhrzWOg2Ai1pwQlX5aoSMIdpTqhKOzWHoXG+f7Evb2vbFOfkd1/wRWLVzIW69Z9b7Qn/hI/8Gkn8pNfpfhVv/eb3wHW/9i3v/yihDKCzc4yF/7r+jdqDu7Jox2n3vNt/ugyAIgqzDBKNW1bQAD' +
    Array.from({ length: 442 }, () => 'A') +
    '=',
  'base64'
);

describe('downloadBuild', () => {
  it('should handle an archive', async () => {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      body: Readable.from(APP_TAR_GZ_BUFFER),
      url: `https://storage.googleapis.com/eas-workflows-production/artifacts/${randomUUID()}/${randomUUID()}/application-${randomUUID()}.tar.gz?X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    } as unknown as Response);

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId: randomUUID(),
      expoApiServerURL: 'http://api.expo.test',
      robotAccessToken: null,
      extensions: ['app'],
    });

    expect(artifactPath).toBeDefined();
    expect(await fs.promises.readFile(path.join(artifactPath, 'TestApp'), 'utf8')).toBe(
      'i am executable\n'
    );
  });

  it('should handle a straight-up file', async () => {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      body: Readable.from(Buffer.from('hello')),
      url: `https://storage.googleapis.com/eas-workflows-production/artifacts/${randomUUID()}/${randomUUID()}/application-${randomUUID()}.txt?X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    } as unknown as Response);

    const { artifactPath } = await downloadBuildAsync({
      logger: createLogger({ name: 'test' }),
      buildId: randomUUID(),
      expoApiServerURL: 'http://api.expo.test',
      robotAccessToken: null,
      extensions: ['app'],
    });

    expect(artifactPath).toBeDefined();
    expect(await fs.promises.readFile(artifactPath, 'utf-8')).toBe('hello');
  });

  it('should throw an error if no matching files are found', async () => {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      body: Readable.from(APP_TAR_GZ_BUFFER),
      url: `https://storage.googleapis.com/eas-workflows-production/artifacts/${randomUUID()}/${randomUUID()}/application-${randomUUID()}.tar.gz?X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    } as unknown as Response);

    await expect(
      downloadBuildAsync({
        logger: createLogger({ name: 'test' }),
        buildId: randomUUID(),
        expoApiServerURL: 'http://api.expo.test',
        robotAccessToken: null,
        extensions: ['apk'],
      })
    ).rejects.toThrow('No .apk entries found in the archive.');
  });
});

describe('createDownloadBuildFunction', () => {
  it('should download a build', async () => {
    const downloadBuild = createDownloadBuildFunction();
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
          build_id: randomUUID(),
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
  });
});
