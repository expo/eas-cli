import { Client, CombinedError } from '@urql/core';
import fetch, { Response } from 'node-fetch';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createDownloadSubmissionArchiveFunction } from '../downloadSubmissionArchive';

const submissionId = 'aabbccdd-1234-4321-abcd-123456789012';
const url = 'https://storage.example/app.ipa?signature=secret';

it('requests a fresh URL on each execution, downloads without auth and does not log the URL', async () => {
  const mutation = jest.fn(() => ({
    toPromise: async () => ({
      data: {
        submission: { generateSubmissionArchiveDownloadUrl: url },
      },
    }),
  }));
  const logger = createMockLogger();
  const fn = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext);
  for (let i = 0; i < 2; i++) {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      url,
      body: Readable.from(Buffer.from('IPA bytes')),
      headers: { get: () => null },
    } as unknown as Response);
    const step = fn.createBuildStepFromFunctionCall(createGlobalContextMock({ logger }), {
      callInputs: { submission_id: submissionId },
    });
    await step.executeAsync();
    expect(await fs.promises.readFile(step.getOutputValueByName('artifact_path')!, 'utf8')).toBe(
      'IPA bytes'
    );
  }
  expect(mutation).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledWith(url, { headers: undefined, signal: undefined });
  expect(JSON.stringify(jest.mocked(logger.info).mock.calls)).not.toContain(url);
});

it('does not expose a URL returned in an API error', async () => {
  const mutation = jest.fn(() => ({
    toPromise: async () => ({
      error: new CombinedError({ networkError: new Error(url) }),
    }),
  }));
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: submissionId },
  });
  await expect(step.executeAsync()).rejects.toThrow('Could not request the submission archive');
  expect(fetch).not.toHaveBeenCalled();
});
