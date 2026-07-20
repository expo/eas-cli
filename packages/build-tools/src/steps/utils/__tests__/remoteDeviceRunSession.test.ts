import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  fetchServeSimTurnArgsAsync,
  metricsCorsOriginToServeSimArgs,
  startServeSimWithTunnelAsync,
  turnIceServersToServeSimArgs,
  waitForDeviceRunSessionStoppedAsync,
} from '../remoteDeviceRunSession';

jest.mock('node:timers/promises');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../sentry');
jest.mock('@expo/turtle-spawn');

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

describe(metricsCorsOriginToServeSimArgs, () => {
  it('returns no args when the origin is unset or empty', () => {
    expect(metricsCorsOriginToServeSimArgs({} as BuildStepEnv)).toEqual([]);
    expect(
      metricsCorsOriginToServeSimArgs({ EAS_SIMULATOR_METRICS_CORS_ORIGIN: '' } as BuildStepEnv)
    ).toEqual([]);
  });

  it('builds one flag per comma-separated origin', () => {
    expect(
      metricsCorsOriginToServeSimArgs({
        EAS_SIMULATOR_METRICS_CORS_ORIGIN: 'https://expo.dev',
      } as BuildStepEnv)
    ).toEqual(['--metrics-cors-origin', 'https://expo.dev']);
    expect(
      metricsCorsOriginToServeSimArgs({
        EAS_SIMULATOR_METRICS_CORS_ORIGIN: 'https://expo.dev, https://staging.expo.dev',
      } as BuildStepEnv)
    ).toEqual([
      '--metrics-cors-origin',
      'https://expo.dev',
      '--metrics-cors-origin',
      'https://staging.expo.dev',
    ]);
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

describe(startServeSimWithTunnelAsync, () => {
  const baseDomain = 'sim.expo.test';

  beforeEach(() => {
    jest.mocked(turtleFetch).mockResolvedValue({
      json: async () => ({ data: { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] } }),
    } as unknown as Awaited<ReturnType<typeof turtleFetch>>);
  });

  function mockServeSimSpawn(tunnelOutput: string): void {
    const stdout = {
      on: (event: string, cb: (chunk: Buffer) => void): void => {
        if (event === 'data') {
          cb(Buffer.from(tunnelOutput));
        }
      },
    };
    const child = { pid: 123, unref: jest.fn(), stdout, stderr: { on: jest.fn() } };
    const result = Object.assign(Promise.resolve({}), { child });
    jest.mocked(spawn).mockReturnValue(result as unknown as ReturnType<typeof spawn>);
  }

  it('passes the metrics CORS origin through to serve-sim', async () => {
    mockServeSimSpawn(`Tunnel: https://abc.${baseDomain}\n`);

    const { previewUrl } = await startServeSimWithTunnelAsync(createCtxMock(), {
      baseDomain,
      env: {
        ...createEnvMock(),
        EAS_SIMULATOR_METRICS_CORS_ORIGIN: 'https://expo.dev',
      } as BuildStepEnv,
      logger: createLoggerMock(),
      timeoutMs: 1_000,
    });

    expect(previewUrl).toBe(`https://abc.${baseDomain}`);
    const spawnArgs = jest.mocked(spawn).mock.calls[0][1];
    expect(spawnArgs).toContain('--metrics-cors-origin');
    expect(spawnArgs).toContain('https://expo.dev');
  });

  it('omits the metrics CORS args when no origin is set', async () => {
    mockServeSimSpawn(`Tunnel: https://abc.${baseDomain}\n`);

    await startServeSimWithTunnelAsync(createCtxMock(), {
      baseDomain,
      env: createEnvMock(),
      logger: createLoggerMock(),
      timeoutMs: 1_000,
    });

    expect(jest.mocked(spawn).mock.calls[0][1]).not.toContain('--metrics-cors-origin');
  });
});
