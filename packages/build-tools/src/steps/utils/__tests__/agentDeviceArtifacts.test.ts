import { bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';
import timers from 'node:timers/promises';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  listAgentDeviceArtifactsAsync,
  pollAgentDeviceArtifactsForUploadAsync,
  uploadAgentDeviceArtifactAsync,
} from '../agentDeviceArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');
jest.mock('node-fetch');

const sleepWithSignal = timers.setTimeout;
const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

async function readStreamAsync(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const chunk of stream as Readable) {
    void chunk;
  }
}

async function flushPromisesAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as bunyan;
}

describe(listAgentDeviceArtifactsAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
  });

  it('lists agent-device artifacts with bearer auth', async () => {
    jest.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          artifacts: [
            {
              id: 'artifact-id',
              artifactType: 'agent-device-test-report',
              filename: 'report.json',
              mimeType: 'application/json',
              sizeBytes: 123,
              createdAt: '2026-07-02T12:00:00.000Z',
              expiresAt: '2026-07-02T12:15:00.000Z',
            },
            {
              id: 'untyped-artifact-id',
              artifactType: null,
              filename: 'untyped-report.json',
              mimeType: 'application/json',
              sizeBytes: 456,
              createdAt: '2026-07-02T12:00:00.000Z',
              expiresAt: '2026-07-02T12:15:00.000Z',
            },
          ],
        })
      )
    );

    const artifacts = await listAgentDeviceArtifactsAsync({
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
    });

    expect(artifacts).toEqual([
      {
        id: 'artifact-id',
        artifactType: 'agent-device-test-report',
        filename: 'report.json',
      },
      {
        id: 'untyped-artifact-id',
        artifactType: null,
        filename: 'untyped-report.json',
      },
    ]);
    expect(jest.mocked(fetch)).toHaveBeenCalledWith('http://127.0.0.1:1234/artifacts', {
      headers: { Authorization: 'Bearer daemon-token' },
    });
  });

  it('reports artifact inventory as unsupported when the daemon does not expose the endpoint', async () => {
    jest.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    await expect(
      listAgentDeviceArtifactsAsync({
        daemonUrl: 'http://127.0.0.1:1234',
        daemonToken: 'daemon-token',
      })
    ).rejects.toThrow('agent-device daemon does not expose artifact inventory.');
  });

  it('keeps a screenshot display rotation and drops an unknown one', async () => {
    jest.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          artifacts: [
            {
              id: 'rotated',
              artifactType: 'screenshot',
              filename: 'rotated.png',
              displayRotation: 'landscape-left',
            },
            {
              id: 'future',
              artifactType: 'screenshot',
              filename: 'future.png',
              displayRotation: 'sideways',
            },
          ],
        })
      )
    );

    const artifacts = await listAgentDeviceArtifactsAsync({
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
    });

    expect(artifacts.map(artifact => artifact.displayRotation)).toEqual([
      'landscape-left',
      undefined,
    ]);
  });
});

describe(uploadAgentDeviceArtifactAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset();
  });

  it('downloads an agent-device artifact and uploads it as a device run session artifact', async () => {
    const data = Buffer.from('artifact-data');
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response(Readable.from([data])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementationOnce(async (_ctx, { openStream }) => {
        await readStreamAsync(openStream());
      });

    await uploadAgentDeviceArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
      logger,
      artifact: {
        id: 'artifact-id',
        artifactType: 'agent-device-test-report',
        filename: 'report.json',
      },
    });

    expect(jest.mocked(fetch)).toHaveBeenCalledWith('http://127.0.0.1:1234/artifacts/artifact-id', {
      headers: { Authorization: 'Bearer daemon-token' },
    });
    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(ctx, {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-id',
      name: 'report.json (artifact-id)',
      filename: 'report.json',
      kind: 'agent-device-test-report',
      size: data.length,
      openStream: expect.any(Function),
    });
  });

  it('uploads null artifact types as an explicit undefined kind', async () => {
    const data = Buffer.from('artifact-data');
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response(Readable.from([data])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementationOnce(async (_ctx, { openStream }) => {
        await readStreamAsync(openStream());
      });

    await uploadAgentDeviceArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
      logger,
      artifact: {
        id: 'artifact-id',
        artifactType: null,
        filename: 'report.json',
      },
    });

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        kind: undefined,
      })
    );
  });

  it('uploads a screenshot display rotation as artifact metadata', async () => {
    const data = Buffer.from('png-data');
    const ctx = {} as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response(Readable.from([data])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementationOnce(async (_ctx, { openStream }) => {
        await readStreamAsync(openStream());
      });

    await uploadAgentDeviceArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
      logger: createLoggerMock(),
      artifact: {
        id: 'artifact-id',
        artifactType: 'screenshot',
        filename: 'shot.png',
        displayRotation: 'landscape-right',
      },
    });

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        kind: 'screenshot',
        metadata: { displayRotation: 'landscape-right' },
      })
    );
  });

  it('uploads no metadata when the artifact has no display rotation', async () => {
    const data = Buffer.from('artifact-data');
    const ctx = {} as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response(Readable.from([data])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementationOnce(async (_ctx, { openStream }) => {
        await readStreamAsync(openStream());
      });

    await uploadAgentDeviceArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
      logger: createLoggerMock(),
      artifact: { id: 'artifact-id', artifactType: 'screenshot', filename: 'shot.png' },
    });

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync).mock.calls[0][1]).not.toHaveProperty(
      'metadata'
    );
  });
});

describe(pollAgentDeviceArtifactsForUploadAsync, () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Keep fake-clock tests deterministic; cancellation tests use the native abortable timer.
    jest
      .spyOn(timers, 'setTimeout')
      .mockImplementation((delay, value, options) =>
        options?.signal
          ? sleepWithSignal(delay, value, options)
          : new Promise(resolve => setTimeout(resolve, delay, value))
      );
    jest.mocked(fetch).mockReset();
    jest.mocked(Sentry.capture).mockReset();
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('cancels a warm poller during its wait without another inventory request', async () => {
    jest.useRealTimers();
    const controller = new AbortController();
    jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ artifacts: [] })));
    const polling = pollAgentDeviceArtifactsForUploadAsync({} as CustomBuildContext, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'token',
      logger: createLoggerMock(),
      signal: controller.signal,
    });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await polling;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('cancels an in-flight warm artifact transfer and drains the poller', async () => {
    jest.useRealTimers();
    const controller = new AbortController();
    let downloading!: () => void;
    const started = new Promise<void>(resolve => {
      downloading = resolve;
    });
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ artifacts: [{ id: 'new-artifact', filename: 'new.png' }] }))
      )
      .mockImplementationOnce(async (_url, options) => {
        const signal = options?.signal as AbortSignal;
        expect(signal).toBe(controller.signal);
        downloading();
        return await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      });
    const logger = createLoggerMock();
    const polling = pollAgentDeviceArtifactsForUploadAsync({} as CustomBuildContext, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'token',
      logger,
      signal: controller.signal,
    });
    await started;
    controller.abort(new Error('session ended'));
    await polling;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(uploadDeviceRunSessionArtifactAsync).not.toHaveBeenCalled();
  });

  it('finishes an active cloud upload and collects final artifacts after normal stop', async () => {
    jest.useRealTimers();
    const stopPolling = new AbortController();
    const cancellation = new AbortController();
    let releaseUpload!: () => void;
    let uploadStarted!: () => void;
    const pendingUpload = new Promise<void>(resolve => {
      releaseUpload = resolve;
    });
    const started = new Promise<void>(resolve => {
      uploadStarted = resolve;
    });
    let inventories = 0;
    const first = { id: 'first', filename: 'first.png' };
    const last = { id: 'last', filename: 'last.png' };
    jest
      .mocked(fetch)
      .mockImplementation(async url =>
        String(url).endsWith('/artifacts')
          ? new Response(
              JSON.stringify({ artifacts: ++inventories === 1 ? [first] : [first, last] })
            )
          : new Response(Readable.from(['png']))
      );
    let transferSignal: AbortSignal | undefined;
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, options) => {
      await readStreamAsync(options.openStream());
      if (options.artifactId === 'first') {
        transferSignal = options.signal;
        uploadStarted();
        await pendingUpload;
      }
    });
    const polling = pollAgentDeviceArtifactsForUploadAsync({} as CustomBuildContext, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'token',
      logger: createLoggerMock(),
      signal: cancellation.signal,
      stopPollingSignal: stopPolling.signal,
    });
    let finished = false;
    void polling.then(() => {
      finished = true;
    });
    try {
      await started;
      stopPolling.abort();
      await new Promise(resolve => setImmediate(resolve));
      expect(transferSignal?.aborted).toBe(false);
      expect(finished).toBe(false);
      releaseUpload();
      await polling;
      expect(inventories).toBe(2);
      expect(
        jest
          .mocked(uploadDeviceRunSessionArtifactAsync)
          .mock.calls.map(([, options]) => options.artifactId)
      ).toEqual(['first', 'last']);
    } finally {
      releaseUpload();
      cancellation.abort();
      await polling;
    }
  });

  it('checks for an artifact created between the last poll and normal stop', async () => {
    jest.useRealTimers();
    const stopPolling = new AbortController();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifacts: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ artifacts: [{ id: 'last', filename: 'last.png' }] }))
      )
      .mockResolvedValueOnce(new Response(Readable.from(['png'])));
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, options) => {
      await readStreamAsync(options.openStream());
    });
    const polling = pollAgentDeviceArtifactsForUploadAsync({} as CustomBuildContext, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'token',
      logger: createLoggerMock(),
      stopPollingSignal: stopPolling.signal,
    });
    await new Promise(resolve => setImmediate(resolve));
    stopPolling.abort();
    await polling;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ artifactId: 'last' })
    );
  });

  it('reports a failed final inventory after normal stop', async () => {
    jest.useRealTimers();
    const stopPolling = new AbortController();
    const logger = createLoggerMock();
    const error = new Error('daemon is not ready');
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifacts: [] })))
      .mockRejectedValueOnce(error);
    const polling = pollAgentDeviceArtifactsForUploadAsync({} as CustomBuildContext, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'token',
      logger,
      stopPollingSignal: stopPolling.signal,
    });
    await new Promise(resolve => setImmediate(resolve));
    stopPolling.abort();
    await polling;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error, failedArtifactListCount: 1 },
      'Could not list agent-device remote session artifacts.'
    );
    expect(Sentry.capture).toHaveBeenCalledTimes(1);
  });

  it('cancels a graceful collector immediately when the job is cancelled', async () => {
    jest.useRealTimers();
    const stopPolling = new AbortController();
    const cancellation = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    jest.mocked(fetch).mockImplementation(async (_url, options) => {
      const signal = options?.signal as AbortSignal;
      entered();
      return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const polling = pollAgentDeviceArtifactsForUploadAsync({} as CustomBuildContext, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'token',
      logger: createLoggerMock(),
      signal: cancellation.signal,
      stopPollingSignal: stopPolling.signal,
    });
    await started;
    cancellation.abort();
    await polling;
    expect(stopPolling.signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels a stuck transfer after the normal-stop drain budget expires', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const stopPolling = new AbortController();
    const logger = createLoggerMock();
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ artifacts: [{ id: 'large', filename: 'large.mp4' }] }))
      )
      .mockResolvedValueOnce(new Response(Readable.from(['video'])));
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, options) => {
      await readStreamAsync(options.openStream());
      entered();
      return await new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
          once: true,
        });
      });
    });
    const polling = pollAgentDeviceArtifactsForUploadAsync({} as CustomBuildContext, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'token',
      logger,
      stopPollingSignal: stopPolling.signal,
    });
    await started;
    stopPolling.abort();
    await jest.advanceTimersByTimeAsync(30_000);
    await polling;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Timed out draining agent-device artifacts; some session artifacts may not have been uploaded.'
    );
  });

  it('reports artifact listing errors on every fifth consecutive failure', async () => {
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;
    const error = new Error('daemon is not ready');

    jest.mocked(fetch).mockRejectedValue(error);

    void pollAgentDeviceArtifactsForUploadAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
      logger,
    });

    await flushPromisesAsync();
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(20_000);
    await flushPromisesAsync();
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(5);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenLastCalledWith(
      { err: error, failedArtifactListCount: 5 },
      'Could not list agent-device remote session artifacts.'
    );
    expect(Sentry.capture).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(25_000);
    await flushPromisesAsync();
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(10);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(
      { err: error, failedArtifactListCount: 10 },
      'Could not list agent-device remote session artifacts.'
    );
    expect(Sentry.capture).toHaveBeenCalledTimes(2);
  });

  it('retries an artifact after a failed upload', async () => {
    const data = Buffer.from('artifact-data');
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;
    const artifact = {
      id: 'artifact-id',
      filename: 'report.json',
    };
    const listResponse = () => new Response(JSON.stringify({ artifacts: [artifact] }));

    jest
      .mocked(fetch)
      .mockResolvedValueOnce(listResponse())
      .mockResolvedValueOnce(new Response(Readable.from([data])))
      .mockResolvedValueOnce(listResponse())
      .mockResolvedValueOnce(new Response(Readable.from([data])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockImplementationOnce(async (_ctx, { openStream }) => {
        await readStreamAsync(openStream());
      });

    void pollAgentDeviceArtifactsForUploadAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      daemonUrl: 'http://127.0.0.1:1234',
      daemonToken: 'daemon-token',
      logger,
    });

    await flushPromisesAsync();
    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5_000);
    await flushPromisesAsync();

    expect(jest.mocked(uploadDeviceRunSessionArtifactAsync)).toHaveBeenCalledTimes(2);
  });

  it('stops polling when the daemon does not expose artifact inventory', async () => {
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response('Not found', { status: 404 }));

    await expect(
      pollAgentDeviceArtifactsForUploadAsync(ctx, {
        deviceRunSessionId: 'drs-id',
        daemonUrl: 'http://127.0.0.1:1234',
        daemonToken: 'daemon-token',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'agent-device daemon does not expose artifact inventory; remote session artifact uploads are disabled.'
    );
  });
});
