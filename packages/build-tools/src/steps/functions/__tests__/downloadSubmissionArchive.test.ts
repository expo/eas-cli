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

it('reports invalid submission ID and extensions together', async () => {
  const mutation = jest.fn();
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: 'invalid', extensions: [123] },
  });

  await expect(step.executeAsync()).rejects.toMatchObject({
    issues: expect.arrayContaining([
      expect.objectContaining({ path: ['submissionId'] }),
      expect.objectContaining({ path: ['extensions', 0] }),
    ]),
  });
  expect(mutation).not.toHaveBeenCalled();
});

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

it('preserves the API error as the cause without downloading', async () => {
  const error = new CombinedError({ networkError: new Error('Connection reset') });
  const mutation = jest.fn(() => ({
    toPromise: async () => ({
      error,
    }),
  }));
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: submissionId },
  });
  await expect(step.executeAsync()).rejects.toMatchObject({
    message: 'Could not request the submission archive. Try again later.',
    cause: error,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(mutation).toHaveBeenCalledTimes(4);
});

it('retries a temporary URL request failure and then downloads the archive', async () => {
  const mutation = jest
    .fn()
    .mockReturnValueOnce({
      toPromise: async () => ({
        error: new CombinedError({ networkError: new Error('Connection reset') }),
      }),
    })
    .mockReturnValue({
      toPromise: async () => ({
        data: { submission: { generateSubmissionArchiveDownloadUrl: url } },
      }),
    });
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    url,
    body: Readable.from(Buffer.from('IPA bytes')),
    headers: { get: () => null },
  } as unknown as Response);
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: submissionId },
  });

  await step.executeAsync();

  expect(mutation).toHaveBeenCalledTimes(2);
  expect(await fs.promises.readFile(step.getOutputValueByName('artifact_path')!, 'utf8')).toBe(
    'IPA bytes'
  );
});

it('does not retry an access error', async () => {
  const error = new CombinedError({ graphQLErrors: [{ message: 'Not authorized' }] });
  const mutation = jest.fn(() => ({ toPromise: async () => ({ error }) }));
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: submissionId },
  });

  await expect(step.executeAsync()).rejects.toMatchObject({ cause: error });
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('does not send another URL request after the step times out during retry backoff', async () => {
  const mutation = jest.fn(() => ({
    toPromise: async () => ({
      error: new CombinedError({ networkError: new Error('Connection reset') }),
    }),
  }));
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: submissionId },
    timeoutMs: 100,
  });

  await expect(step.executeAsync()).rejects.toThrow('timed out');
  await new Promise(resolve => setTimeout(resolve, 1100));

  expect(mutation).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('uses the requested extension for an archive without a filename extension', async () => {
  const mutation = jest.fn(() => ({
    toPromise: async () => ({
      data: {
        submission: { generateSubmissionArchiveDownloadUrl: 'https://storage.example/archive' },
      },
    }),
  }));
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    url: 'https://storage.example/archive',
    body: Readable.from(Buffer.from('Android archive bytes')),
    headers: { get: () => null },
  } as unknown as Response);
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: submissionId, extensions: ['aab'] },
  });

  await step.executeAsync();

  const artifactPath = step.getOutputValueByName('artifact_path')!;
  expect(artifactPath).toMatch(/\.aab$/);
  expect(await fs.promises.readFile(artifactPath, 'utf8')).toBe('Android archive bytes');
});

it('propagates the original download error', async () => {
  const error = new Error('Download failed');
  const mutation = jest.fn(() => ({
    toPromise: async () => ({
      data: { submission: { generateSubmissionArchiveDownloadUrl: url } },
    }),
  }));
  jest.mocked(fetch).mockRejectedValue(error);
  const step = createDownloadSubmissionArchiveFunction({
    graphqlClient: { mutation } as unknown as Client,
  } as CustomBuildContext).createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { submission_id: submissionId },
  });

  await expect(step.executeAsync()).rejects.toBe(error);
});
