import { bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { listArgentArtifactsAsync, uploadArgentArtifactAsync } from '../argentArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

async function readStreamAsync(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const chunk of stream as Readable) {
    void chunk;
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
