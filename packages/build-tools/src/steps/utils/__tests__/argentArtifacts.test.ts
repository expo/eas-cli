import { bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  listArgentArtifactsAsync,
  pollArgentArtifactsForUploadAsync,
  uploadArgentArtifactAsync,
} from '../argentArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');
jest.mock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

async function readStreamAsync(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const chunk of stream as Readable) {
    void chunk;
  }
}

async function waitForAssertionAsync(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as bunyan;
}

describe(listArgentArtifactsAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
  });

  it('lists Argent artifacts with bearer auth', async () => {
    jest.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          artifacts: [
            {
              id: 'artifact-id',
              filename: 'report.json',
              mimeType: 'application/json',
              isDirectory: false,
            },
          ],
        })
      )
    );

    const artifacts = await listArgentArtifactsAsync({
      toolsUrl: 'http://127.0.0.1:1234',
      toolsAuthToken: 'tools-token',
    });

    expect(artifacts).toEqual([
      {
        id: 'artifact-id',
        filename: 'report.json',
        mimeType: 'application/json',
        isDirectory: false,
      },
    ]);
    expect(jest.mocked(fetch)).toHaveBeenCalledWith('http://127.0.0.1:1234/artifacts', {
      headers: { Authorization: 'Bearer tools-token' },
      signal: expect.any(AbortSignal),
    });
  });
});

describe(uploadArgentArtifactAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset();
  });

  it('downloads an Argent artifact and uploads it as a device run session artifact', async () => {
    const data = Buffer.from('artifact-data');
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response(Readable.from([data])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementationOnce(async (_ctx, { stream }) => {
        await readStreamAsync(stream);
      });

    await uploadArgentArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      toolsUrl: 'http://127.0.0.1:1234',
      toolsAuthToken: 'tools-token',
      logger,
      artifact: {
        id: 'artifact-id',
        filename: 'report.json',
        mimeType: 'application/json',
      },
    });

    expect(jest.mocked(fetch)).toHaveBeenCalledWith('http://127.0.0.1:1234/artifacts/artifact-id', {
      headers: { Authorization: 'Bearer tools-token' },
      signal: expect.any(AbortSignal),
    });
    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(ctx, {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-id',
      name: 'report.json (artifact-id)',
      filename: 'report.json',
      size: data.length,
      stream: expect.anything(),
    });
  });
});

describe(pollArgentArtifactsForUploadAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset();
  });

  it('stops polling when aborted, performs a final drain, and waits for uploads', async () => {
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;
    const abortController = new AbortController();
    let listCallCount = 0;

    jest.mocked(fetch).mockImplementation(async url => {
      const urlString = String(url);
      if (urlString.endsWith('/artifacts')) {
        listCallCount += 1;
        return new Response(
          JSON.stringify({
            artifacts:
              listCallCount === 1
                ? [
                    {
                      id: 'artifact-a',
                      filename: 'a.json',
                      mimeType: 'application/json',
                    },
                  ]
                : [
                    {
                      id: 'artifact-a',
                      filename: 'a.json',
                      mimeType: 'application/json',
                    },
                    {
                      id: 'artifact-b',
                      filename: 'b.json',
                      mimeType: 'application/json',
                    },
                  ],
          })
        );
      }
      if (urlString.endsWith('/artifacts/artifact-a')) {
        return new Response(Readable.from([Buffer.from('artifact-a-data')]));
      }
      if (urlString.endsWith('/artifacts/artifact-b')) {
        return new Response(Readable.from([Buffer.from('artifact-b-data')]));
      }
      throw new Error(`Unexpected URL ${urlString}`);
    });
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementation(async (_ctx, { stream }) => {
        await readStreamAsync(stream);
      });

    const pollingPromise = pollArgentArtifactsForUploadAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      toolsUrl: 'http://127.0.0.1:1234',
      toolsAuthToken: 'tools-token',
      logger,
      signal: abortController.signal,
    });

    await waitForAssertionAsync(() => {
      expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledTimes(1);
    });
    abortController.abort();
    await pollingPromise;

    expect(listCallCount).toBe(2);
    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledTimes(2);
    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenLastCalledWith(ctx, {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-b',
      name: 'b.json (artifact-b)',
      filename: 'b.json',
      size: 'artifact-b-data'.length,
      stream: expect.anything(),
    });
  });

  it('throws when pending uploads do not finish before the cleanup timeout', async () => {
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;
    const abortController = new AbortController();
    const originalSetTimeout = global.setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((
        callback: Parameters<typeof setTimeout>[0],
        timeout?: number,
        ...args: unknown[]
      ) =>
        originalSetTimeout(
          callback,
          timeout === 30_000 ? 0 : timeout,
          ...args
        )) as typeof setTimeout);

    try {
      jest.mocked(fetch).mockImplementation(async url => {
        const urlString = String(url);
        if (urlString.endsWith('/artifacts')) {
          return new Response(
            JSON.stringify({
              artifacts: [
                {
                  id: 'artifact-a',
                  filename: 'a.json',
                  mimeType: 'application/json',
                },
              ],
            })
          );
        }
        if (urlString.endsWith('/artifacts/artifact-a')) {
          return new Response(Readable.from([Buffer.from('artifact-a-data')]));
        }
        throw new Error(`Unexpected URL ${urlString}`);
      });
      jest
        .mocked(uploadDeviceRunSessionArtifactAsync)
        .mockImplementation(() => new Promise<void>(() => {}));

      const pollingPromise = pollArgentArtifactsForUploadAsync(ctx, {
        deviceRunSessionId: 'drs-id',
        toolsUrl: 'http://127.0.0.1:1234',
        toolsAuthToken: 'tools-token',
        logger,
        signal: abortController.signal,
      });

      await waitForAssertionAsync(() => {
        expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledTimes(1);
      });
      abortController.abort();

      await expect(pollingPromise).rejects.toThrow(
        'Timed out after 30s waiting for Argent artifact uploads.'
      );
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
