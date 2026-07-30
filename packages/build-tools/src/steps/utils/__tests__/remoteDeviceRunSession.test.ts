import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import * as ngrok from '@ngrok/ngrok';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { sleepAsync } from '../../../utils/retry';
import {
  createServeSimArgs,
  fetchServeSimTurnArgsAsync,
  startNgrokTunnelAsync,
  turnIceServersToServeSimArgs,
  waitForDeviceRunSessionStoppedAsync,
  waitForServeSimReadyAsync,
} from '../remoteDeviceRunSession';

jest.mock('@ngrok/ngrok');
jest.mock('node:timers/promises');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../utils/retry', () => ({ sleepAsync: jest.fn() }));
jest.mock('../../../sentry');

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

function createStatusCtxMock(
  results: (
    | { status: 'NEW' | 'IN_PROGRESS' | 'STOPPED' | 'ERRORED' }
    | { error: Error }
    | { data: unknown }
  )[]
): CustomBuildContext {
  const query = jest.fn(() => {
    const result = results.shift();
    if (!result) {
      throw new Error('No mocked status result available');
    }
    return {
      toPromise: async () => {
        if ('error' in result) {
          throw result.error;
        }
        if ('data' in result) {
          return { data: result.data };
        }
        return {
          data: {
            deviceRunSessions: {
              byId: {
                id: 'drs-id',
                status: result.status,
              },
            },
          },
        };
      },
    };
  });

  return {
    graphqlClient: {
      query,
    },
  } as unknown as CustomBuildContext;
}

function createEnvMock(): BuildStepEnv {
  return { DEVICE_RUN_SESSION_ID: 'drs-id' } as unknown as BuildStepEnv;
}

describe(createServeSimArgs, () => {
  it('uses the latest Expo package and applies the EAS streaming policy', () => {
    expect(
      createServeSimArgs({
        port: 4321,
        turnArgs: ['--turn-url', 'turns:turn.example.test:443'],
      })
    ).toEqual([
      '--yes',
      '@expo/serve-sim@latest',
      '--port',
      '4321',
      '--host',
      '127.0.0.1',
      '--transport',
      'webrtc',
      '--webrtc-codec',
      'vp8',
      '--max-dimension',
      '1280',
      '--mjpeg-quality',
      '0.55',
      '--video-bitrate',
      '3000000',
      '--video-fps',
      '60',
      '--turn-url',
      'turns:turn.example.test:443',
    ]);
  });
});

describe(waitForServeSimReadyAsync, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
    jest.mocked(sleepAsync).mockReset();
    jest.mocked(sleepAsync).mockResolvedValue(undefined);
  });

  it('waits for the stable readiness endpoint', async () => {
    jest
      .mocked(turtleFetch)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({
        json: async () => ({ status: 'ready', device: 'DEVICE-A' }),
      } as unknown as Awaited<ReturnType<typeof turtleFetch>>);

    await waitForServeSimReadyAsync({
      serveSim: { pid: undefined, getOutput: () => '' },
      port: 4321,
      timeoutMs: 10_000,
    });

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledTimes(2);
    expect(jest.mocked(turtleFetch)).toHaveBeenLastCalledWith(
      'http://127.0.0.1:4321/readyz',
      'GET',
      expect.objectContaining({ retries: 0 })
    );
    expect(sleepAsync).toHaveBeenCalledTimes(1);
  });
});

describe(startNgrokTunnelAsync, () => {
  it('uses a 128-bit capability hostname and exposes explicit cleanup', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    jest.mocked(ngrok.forward).mockResolvedValue({
      url: () => 'https://serve-sim.example.test',
      close,
    } as never);

    const tunnel = await startNgrokTunnelAsync({
      port: 4321,
      subdomainPrefix: 'serve-sim',
      baseDomain: 'tunnel.example.test',
      authtoken: 'token',
      logger: createLoggerMock(),
    });

    expect(ngrok.forward).toHaveBeenCalledWith(
      expect.objectContaining({
        addr: 4321,
        authtoken: 'token',
        domain: expect.stringMatching(/^serve-sim-[a-f0-9]{32}\.tunnel\.example\.test$/),
      })
    );
    expect(tunnel.url).toBe('https://serve-sim.example.test');
    await tunnel.stopAsync();
    await tunnel.stopAsync();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

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

describe(waitForDeviceRunSessionStoppedAsync, () => {
  beforeEach(() => {
    jest.mocked(Sentry).capture.mockReset();
    jest.mocked(setTimeoutAsync).mockReset();
    jest.mocked(setTimeoutAsync).mockResolvedValue(undefined);
  });

  it('continues polling until the device run session is stopped', async () => {
    const ctx = createStatusCtxMock([{ status: 'IN_PROGRESS' }, { status: 'STOPPED' }]);
    const logger = createLoggerMock();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
    });

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('Device run session drs-id was stopped.');
  });

  it('throws when the device run session errors', async () => {
    const ctx = createStatusCtxMock([{ status: 'ERRORED' }]);

    await expect(
      waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger: createLoggerMock(),
      })
    ).rejects.toThrow('Device run session drs-id errored.');
  });

  it('logs and retries transient polling errors', async () => {
    const ctx = createStatusCtxMock([{ error: new Error('network down') }, { status: 'STOPPED' }]);
    const logger = createLoggerMock();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
    });

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failedStatusPollCount: 1 }),
      'Could not poll device run session status; will retry.'
    );
    expect(jest.mocked(Sentry).capture).toHaveBeenCalledWith(
      'Could not poll device run session status',
      expect.any(Error),
      { level: 'warning' }
    );
  });

  it('logs and retries when the status response is missing', async () => {
    const ctx = createStatusCtxMock([
      { data: { deviceRunSessions: { byId: null } } },
      { status: 'STOPPED' },
    ]);
    const logger = createLoggerMock();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
    });

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failedStatusPollCount: 1 }),
      'Could not poll device run session status; will retry.'
    );
    expect(jest.mocked(Sentry).capture).toHaveBeenCalledWith(
      'Could not poll device run session status',
      expect.objectContaining({
        message: 'Device run session drs-id status response was missing.',
      }),
      { level: 'warning' }
    );
  });
});
