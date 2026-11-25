import fetch, { Response } from 'node-fetch';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  fireBackoffTimersAsync,
  useFakeBackoffTimers,
} from '../../../__tests__/utils/backoffTimers';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { DownloadNetworkError } from '../../../storage/downloadToFile';
import { downloadArtifactAsync } from '../downloadArtifact';

const { FetchError: ActualFetchError, Response: ActualResponse } = jest.requireActual(
  'node-fetch'
) as typeof import('node-fetch');

const EXPO_API_SERVER_URL = 'http://api.expo.test';
const ROBOT_ACCESS_TOKEN = 'robot-access-token';
const SIGNED_URL = 'https://storage.example.test/artifacts/my%20file.apk?signature=secret';

function createSuccessfulResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    url: SIGNED_URL,
    body: Readable.from(body),
  } as unknown as Response;
}

afterEach(() => {
  jest.useRealTimers();
  jest.mocked(fetch).mockReset();
});

describe(downloadArtifactAsync, () => {
  it('downloads an artifact by ID to a file named after the response URL', async () => {
    const workflowRunId = randomUUID();
    const artifactId = randomUUID();
    jest.mocked(fetch).mockResolvedValue(createSuccessfulResponse('artifact content'));

    const { artifactPath } = await downloadArtifactAsync({
      logger: createMockLogger(),
      workflowRunId,
      expoApiServerURL: EXPO_API_SERVER_URL,
      robotAccessToken: ROBOT_ACCESS_TOKEN,
      params: { artifactId },
    });

    expect(path.basename(artifactPath)).toBe('my_20file.apk');
    expect(path.dirname(path.dirname(artifactPath))).toBe(os.tmpdir());
    expect(await fs.promises.readFile(artifactPath, 'utf8')).toBe('artifact content');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${EXPO_API_SERVER_URL}/v2/workflows/${workflowRunId}/download-artifact?artifactId=${artifactId}`,
      expect.objectContaining({ headers: { Authorization: `Bearer ${ROBOT_ACCESS_TOKEN}` } })
    );
  });

  it('downloads an artifact by name', async () => {
    const workflowRunId = randomUUID();
    jest.mocked(fetch).mockResolvedValue(createSuccessfulResponse('artifact content'));

    await downloadArtifactAsync({
      logger: createMockLogger(),
      workflowRunId,
      expoApiServerURL: EXPO_API_SERVER_URL,
      robotAccessToken: ROBOT_ACCESS_TOKEN,
      params: { name: 'my artifact' },
    });

    expect(fetch).toHaveBeenCalledWith(
      `${EXPO_API_SERVER_URL}/v2/workflows/${workflowRunId}/download-artifact?name=my+artifact`,
      expect.anything()
    );
  });

  it('downloads again after a request that failed once with a socket error', async () => {
    useFakeBackoffTimers();
    jest
      .mocked(fetch)
      .mockRejectedValueOnce(
        new ActualFetchError(`request to ${SIGNED_URL} failed, reason: read ECONNRESET`, 'system', {
          code: 'ECONNRESET',
        } as any)
      )
      .mockResolvedValueOnce(createSuccessfulResponse('artifact content'));

    const download = downloadArtifactAsync({
      logger: createMockLogger(),
      workflowRunId: randomUUID(),
      expoApiServerURL: EXPO_API_SERVER_URL,
      robotAccessToken: ROBOT_ACCESS_TOKEN,
      params: { name: 'my artifact' },
    });
    await fireBackoffTimersAsync(1);

    const { artifactPath } = await download;
    expect(await fs.promises.readFile(artifactPath, 'utf8')).toBe('artifact content');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws without the signed URL when the request keeps failing', async () => {
    useFakeBackoffTimers();
    jest.mocked(fetch).mockRejectedValue(
      new ActualFetchError(`request to ${SIGNED_URL} failed, reason: read ECONNRESET`, 'system', {
        code: 'ECONNRESET',
      } as any)
    );

    const download = downloadArtifactAsync({
      logger: createMockLogger(),
      workflowRunId: randomUUID(),
      expoApiServerURL: EXPO_API_SERVER_URL,
      robotAccessToken: ROBOT_ACCESS_TOKEN,
      params: { name: 'my artifact' },
    });
    const settled = download.catch(error => error);
    await fireBackoffTimersAsync(5);
    const error = await settled;

    expect(error).toBeInstanceOf(DownloadNetworkError);
    expect(error.message).toBe('Download failed: ECONNRESET.');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('reports the status and the response text of an HTTP error', async () => {
    jest.mocked(fetch).mockResolvedValue(new ActualResponse('Artifact not found', { status: 404 }));

    await expect(
      downloadArtifactAsync({
        logger: createMockLogger(),
        workflowRunId: randomUUID(),
        expoApiServerURL: EXPO_API_SERVER_URL,
        robotAccessToken: ROBOT_ACCESS_TOKEN,
        params: { name: 'my artifact' },
      })
    ).rejects.toThrow('Unexpected response from server (404): Artifact not found');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
