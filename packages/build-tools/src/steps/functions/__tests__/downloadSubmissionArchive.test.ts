import { Client, CombinedError } from '@urql/core';
import fetch, { Response } from 'node-fetch';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createDownloadSubmissionArchiveFunction } from '../downloadSubmissionArchive';

function createStep(query: jest.Mock) {
  const fn = createDownloadSubmissionArchiveFunction({
    graphqlClient: { query } as unknown as Client,
  } as CustomBuildContext);
  return fn.createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: randomUUID() },
  });
}

describe('download submission archive', () => {
  it('fetches a fresh URL at execution time and downloads without leaking an API token', async () => {
    const url =
      'https://storage.googleapis.com/submission-service-archives/app.ipa?signature=fresh';
    const query = jest.fn().mockReturnValue({
      toPromise: async () => ({ data: { submissions: { byId: { archiveUrl: url } } } }),
    });
    const bytes = Buffer.from('IPA archive contents');
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      url,
      body: Readable.from(bytes),
      headers: { get: () => null },
    } as unknown as Response);
    const step = createStep(query);
    await step.executeAsync();
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      requestPolicy: 'network-only',
    });
    expect(fetch).toHaveBeenCalledWith(url, { headers: undefined, signal: undefined });
    expect(await fs.promises.readFile(step.getOutputValueByName('artifact_path')!)).toEqual(bytes);
  });

  it.each([
    {
      result: { data: { submissions: { byId: { archiveUrl: null } } } },
      message: 'no downloadable archive',
    },
    {
      result: { error: new CombinedError({ networkError: new Error('offline') }) },
      message: 'offline',
    },
  ])('fails before download when archive lookup fails ($message)', async ({ result, message }) => {
    const step = createStep(jest.fn().mockReturnValue({ toPromise: async () => result }));
    await expect(step.executeAsync()).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });
});
