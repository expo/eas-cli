import { Client } from '@urql/core';
import fetch, { Response } from 'node-fetch';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as tar from 'tar';

import { CustomBuildContext } from '../../../customBuildContext';
import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createDownloadAppArchiveFunction } from '../downloadAppArchive';

const url = 'https://storage.googleapis.com/submission-service-archives/app.tar.gz?signature=test';
const query = jest.fn();

function createStep(applicationArchiveUrl = url, extensions?: string[]) {
  return createDownloadAppArchiveFunction({
    graphqlClient: { query } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: {
      application_archive_url: applicationArchiveUrl,
      ...(extensions ? { extensions } : {}),
    },
  });
}

it.each([undefined, ['ipa'], ['apk']])(
  'downloads and unpacks the input URL with extensions %j without an API lookup or token',
  async extensions => {
    const directory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'download-app-archive-test-')
    );
    const bytes = Buffer.from('IPA contents');
    await fs.promises.writeFile(path.join(directory, 'app.ipa'), bytes);
    await tar.c({ gzip: true, cwd: directory, file: path.join(directory, 'app.tar.gz') }, [
      'app.ipa',
    ]);
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      url,
      body: Readable.from(await fs.promises.readFile(path.join(directory, 'app.tar.gz'))),
      headers: { get: () => null },
    } as unknown as Response);
    const step = createStep(url, extensions);
    try {
      if (extensions?.[0] === 'apk') {
        await expect(step.executeAsync()).rejects.toThrow('No .apk entries found in the archive');
      } else {
        await step.executeAsync();
        expect(await fs.promises.readFile(step.getOutputValueByName('artifact_path')!)).toEqual(
          bytes
        );
      }
      expect(query).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith(url, { headers: undefined, signal: undefined });
    } finally {
      await fs.promises.rm(directory, { recursive: true });
    }
  }
);

it('rejects a non-HTTP URL before downloading', async () => {
  await expect(createStep('file:///tmp/app.ipa').executeAsync()).rejects.toThrow('HTTP or HTTPS');
  expect(fetch).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});
