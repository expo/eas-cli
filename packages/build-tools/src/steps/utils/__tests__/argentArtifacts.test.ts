import { bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';
import * as timersPromises from 'node:timers/promises';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  listArgentArtifactsAsync,
  pollArgentArtifactsForUploadAsync,
  uploadArgentArtifactAsync,
} from '../argentArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');
jest.mock('node-fetch');
jest.mock('node:timers/promises', () => {
  const actual = jest.requireActual('node:timers/promises');
  return { ...actual, setTimeout: jest.fn(actual.setTimeout) };
});

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');
const { setTimeout: actualSetTimeoutAsync } = jest.requireActual(
  'node:timers/promises'
) as typeof import('node:timers/promises');

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
              kind: 'native-profile-report',
              filename: 'report.json',
              mimeType: 'application/json',
              isDirectory: false,
            },
            {
              id: 'legacy-artifact-id',
              filename: 'screen.png',
              mimeType: 'image/png',
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
        kind: 'native-profile-report',
        filename: 'report.json',
        mimeType: 'application/json',
        isDirectory: false,
      },
      {
        id: 'legacy-artifact-id',
        filename: 'screen.png',
        mimeType: 'image/png',
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
      kind: undefined,
      size: data.length,
      stream: expect.anything(),
    });
  });

  async function uploadAsync(artifact: {
    id: string;
    kind?: string;
    filename: string;
    mimeType: string;
    isDirectory?: boolean;
  }): Promise<CustomBuildContext> {
    const ctx = {} as unknown as CustomBuildContext;
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(new Response(Readable.from([Buffer.from('artifact-data')])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementationOnce(async (_ctx, { stream }) => {
        await readStreamAsync(stream);
      });

    await uploadArgentArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      toolsUrl: 'http://127.0.0.1:1234',
      logger: createLoggerMock(),
      artifact,
    });

    return ctx;
  }

  it.each([
    { mimeType: 'image/png', filename: 'screen.png', kind: 'screenshot' },
    { mimeType: 'image/jpeg', filename: 'screen.jpg', kind: 'screenshot' },
    // Media types are case-insensitive and may carry parameters.
    { mimeType: 'IMAGE/PNG; charset=binary', filename: 'screen.png', kind: 'screenshot' },
    { mimeType: 'video/mp4', filename: 'session.mp4', kind: 'screen-recording' },
    { mimeType: 'video/quicktime', filename: 'session.mov', kind: 'screen-recording' },
    { mimeType: 'application/json', filename: 'report.json', kind: undefined },
    { mimeType: 'text/plain', filename: 'log.txt', kind: undefined },
  ])('uploads $mimeType with kind $kind', async ({ mimeType, filename, kind }) => {
    const ctx = await uploadAsync({ id: 'artifact-id', filename, mimeType });

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ filename, kind })
    );
  });

  it('uses the semantic kind reported by Argent', async () => {
    const ctx = await uploadAsync({
      id: 'artifact-id',
      kind: 'native-profile-report',
      filename: 'native-profile-report.md',
      mimeType: 'text/markdown',
    });

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        filename: 'native-profile-report.md',
        kind: 'native-profile-report',
      })
    );
  });

  it('keeps the semantic kind when a directory is uploaded as a tarball', async () => {
    const ctx = await uploadAsync({
      id: 'artifact-id',
      kind: 'native-profile-trace',
      filename: 'native-profile.trace',
      mimeType: 'application/octet-stream',
      isDirectory: true,
    });

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        filename: 'native-profile.trace.tar.gz',
        kind: 'native-profile-trace',
      })
    );
  });

  it('leaves an older unclassified directory artifact without a kind', async () => {
    const ctx = await uploadAsync({
      id: 'artifact-id',
      filename: 'screenshots',
      mimeType: 'image/png',
      isDirectory: true,
    });

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ filename: 'screenshots.tar.gz', kind: undefined })
    );
  });
});

describe(pollArgentArtifactsForUploadAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
    jest.mocked(Sentry.capture).mockReset();
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset();
  });

  it('reports artifact listing errors on every fifth consecutive failure', async () => {
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;
    const abortController = new AbortController();
    const error = new Error('tool server is not ready');
    let listCallCount = 0;
    jest.mocked(timersPromises.setTimeout).mockResolvedValue(undefined);

    jest.mocked(fetch).mockImplementation(async () => {
      listCallCount += 1;
      if (listCallCount === 11) {
        abortController.abort();
      }
      throw error;
    });

    try {
      await pollArgentArtifactsForUploadAsync(ctx, {
        deviceRunSessionId: 'drs-id',
        toolsUrl: 'http://127.0.0.1:1234',
        toolsAuthToken: 'tools-token',
        logger,
        signal: abortController.signal,
      });

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenNthCalledWith(
        1,
        { err: error, failedArtifactListCount: 5 },
        'Could not list Argent remote session artifacts.'
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        2,
        { err: error, failedArtifactListCount: 10 },
        'Could not list Argent remote session artifacts.'
      );
      expect(Sentry.capture).toHaveBeenCalledTimes(2);
    } finally {
      jest.mocked(timersPromises.setTimeout).mockImplementation(actualSetTimeoutAsync);
    }
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
