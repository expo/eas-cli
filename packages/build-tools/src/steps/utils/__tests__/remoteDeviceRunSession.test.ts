import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import fetch from 'node-fetch';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  fetchServeSimTurnArgsAsync,
  listArgentArtifactsAsync,
  turnIceServersToServeSimArgs,
  uploadArgentArtifactAsync,
} from '../remoteDeviceRunSession';

jest.mock('../../../utils/turtleFetch');
jest.mock('../../../sentry');
jest.mock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as bunyan;
}

function createCtxMock(): CustomBuildContext {
  return {
    env: {
      __API_SERVER_URL: 'https://api.expo.test',
    },
    job: {
      secrets: { robotAccessToken: 'robot-token' },
    },
  } as unknown as CustomBuildContext;
}

function createEnvMock(): BuildStepEnv {
  return { DEVICE_RUN_SESSION_ID: 'drs-id' } as unknown as BuildStepEnv;
}

describe(turnIceServersToServeSimArgs, () => {
  it('returns no args for an empty ICE server list', () => {
    expect(turnIceServersToServeSimArgs([])).toEqual([]);
  });

  it('builds --stun-url and --turn-url flags from Cloudflare ICE servers', () => {
    expect(
      turnIceServersToServeSimArgs([
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'user-123',
          credential: 'cred-456',
        },
      ])
    ).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478,stun:stun.cloudflare.com:53',
      '--turn-url',
      'turn:turn.cloudflare.com:3478?transport=udp,turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'user-123',
      '--turn-credential',
      'cred-456',
    ]);
  });

  it('emits only --turn-url flags when no credential-less (STUN) entry is present', () => {
    expect(
      turnIceServersToServeSimArgs([
        {
          urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
          username: 'u',
          credential: 'c',
        },
      ])
    ).toEqual([
      '--turn-url',
      'turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'u',
      '--turn-credential',
      'c',
    ]);
  });

  it('emits only --stun-url when there is no credentialed TURN entry', () => {
    expect(turnIceServersToServeSimArgs([{ urls: ['stun:stun.cloudflare.com:3478'] }])).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478',
    ]);
  });
});

describe(fetchServeSimTurnArgsAsync, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it('requests TURN ICE servers from the device run session endpoint and returns serve-sim args', async () => {
    jest.mocked(turtleFetch).mockResolvedValue({
      json: async () => ({
        data: {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            {
              urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
              username: 'u',
              credential: 'c',
            },
          ],
        },
      }),
    } as unknown as Awaited<ReturnType<typeof turtleFetch>>);

    const args = await fetchServeSimTurnArgsAsync(createCtxMock(), {
      env: createEnvMock(),
      logger: createLoggerMock(),
    });

    expect(args).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478',
      '--turn-url',
      'turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'u',
      '--turn-credential',
      'c',
    ]);
    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      'https://api.expo.test/v2/device-run-sessions/drs-id/turn-ice-servers',
      'POST',
      expect.objectContaining({
        headers: { Authorization: 'Bearer robot-token' },
      })
    );
  });

  it('returns [] and warns when the request fails so serve-sim falls back to P2P/STUN', async () => {
    jest.mocked(turtleFetch).mockRejectedValue(new Error('boom'));
    const logger = createLoggerMock();

    const args = await fetchServeSimTurnArgsAsync(createCtxMock(), {
      env: createEnvMock(),
      logger,
    });

    expect(args).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(jest.mocked(Sentry).capture).toHaveBeenCalled();
  });
});

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
              size: 12,
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
        size: 12,
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
  });

  it('streams an Argent artifact through a signed upload URL', async () => {
    const data = Buffer.from('artifact-data');
    const reportedSize = 1024;
    const mutation = jest.fn().mockReturnValue({
      toPromise: async () => ({
        data: {
          deviceRunSession: {
            createArtifactUploadSession: {
              uploadSession: {
                url: 'https://uploads.expo.test/artifact',
                headers: {
                  'Content-Length': String(reportedSize),
                  'Content-Type': 'application/octet-stream',
                },
              },
            },
          },
        },
      }),
    });
    const ctx = {
      graphqlClient: {
        mutation,
      },
    } as unknown as CustomBuildContext;

    jest
      .mocked(fetch)
      .mockResolvedValueOnce(new Response(data))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadArgentArtifactAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      toolsUrl: 'http://127.0.0.1:1234',
      toolsAuthToken: 'tools-token',
      artifact: {
        id: 'artifact-id',
        filename: 'report.json',
        mimeType: 'application/json',
        size: reportedSize,
      },
      logger: createLoggerMock(),
    });

    expect(jest.mocked(fetch)).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:1234/artifacts/artifact-id',
      {
        headers: { Authorization: 'Bearer tools-token' },
      }
    );
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceRunSessionId: 'drs-id',
        input: {
          name: 'Argent artifact report.json (artifact-id)',
          filename: 'report.json',
          size: reportedSize,
        },
      })
    );
    expect(jest.mocked(fetch)).toHaveBeenNthCalledWith(
      2,
      'https://uploads.expo.test/artifact',
      expect.objectContaining({
        method: 'PUT',
        body: expect.anything(),
      })
    );
  });
});
