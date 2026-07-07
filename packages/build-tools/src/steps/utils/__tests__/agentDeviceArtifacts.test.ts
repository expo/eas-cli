import { bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  listAgentDeviceArtifactsAsync,
  pollAgentDeviceArtifactsForUploadAsync,
  uploadAgentDeviceArtifactAsync,
} from '../agentDeviceArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('node-fetch');

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
      .mockImplementationOnce(async (_ctx, { stream }) => {
        await readStreamAsync(stream);
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
      stream: expect.anything(),
    });
  });

  it('uploads null artifact types as an explicit undefined kind', async () => {
    const data = Buffer.from('artifact-data');
    const logger = createLoggerMock();
    const ctx = {} as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response(Readable.from([data])));
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementationOnce(async (_ctx, { stream }) => {
        await readStreamAsync(stream);
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
});

describe(pollAgentDeviceArtifactsForUploadAsync, () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(fetch).mockReset();
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
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
      .mockImplementationOnce(async (_ctx, { stream }) => {
        await readStreamAsync(stream);
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
