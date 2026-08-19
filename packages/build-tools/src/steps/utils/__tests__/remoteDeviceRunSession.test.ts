import { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import * as ngrok from '@ngrok/ngrok';
import {
  clearTimeout as clearTimeoutCallback,
  setTimeout as setTimeoutCallback,
} from 'node:timers';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { PassThrough } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { sleepAsync } from '../../../utils/retry';
import {
  createServeSimArgs,
  ensureFfmpegInstalledAsync,
  fetchServeSimTurnArgsAsync,
  metricsCorsOriginToServeSimArgs,
  spawnDetached,
  startNgrokTunnelAsync,
  turnIceServersToServeSimArgs,
  waitForDeviceRunSessionStoppedAsync,
  waitForDeviceRunSessionStoppedOrResourceFailureAsync,
  waitForServeSimReadyAsync,
} from '../remoteDeviceRunSession';

jest.mock('@ngrok/ngrok');
jest.mock('node:timers');
jest.mock('node:timers/promises');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../utils/retry', () => ({ sleepAsync: jest.fn() }));
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
  )[],
  { ensureStoppedError }: { ensureStoppedError?: Error } = {}
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

  const mutation = jest.fn(() => ({
    toPromise: async () => {
      if (ensureStoppedError) {
        return { error: ensureStoppedError };
      }
      return {
        data: {
          deviceRunSession: {
            ensureDeviceRunSessionStopped: { id: 'drs-id', status: 'STOPPED' },
          },
        },
      };
    },
  }));

  return {
    graphqlClient: {
      query,
      mutation,
    },
  } as unknown as CustomBuildContext;
}

function createEnvMock(): BuildStepEnv {
  return { DEVICE_RUN_SESSION_ID: 'drs-id' } as unknown as BuildStepEnv;
}

function mockNgrokSdk({
  joinPromise = new Promise<void>(() => {}),
}: { joinPromise?: Promise<void> } = {}): {
  closeListener: jest.Mock;
  closeSession: jest.Mock;
  endpointBuilder: Record<string, jest.Mock>;
  sessionBuilder: Record<string, jest.Mock>;
} {
  const closeListener = jest.fn().mockResolvedValue(undefined);
  const listener = {
    url: jest.fn().mockReturnValue('https://serve-sim.example.test'),
    close: closeListener,
    join: jest.fn().mockReturnValue(joinPromise),
  };
  const endpointBuilder = {
    domain: jest.fn().mockReturnThis(),
    metadata: jest.fn().mockReturnThis(),
    requestHeader: jest.fn().mockReturnThis(),
    listenAndForward: jest.fn().mockResolvedValue(listener),
  };
  const closeSession = jest.fn().mockResolvedValue(undefined);
  const session = {
    httpEndpoint: jest.fn().mockReturnValue(endpointBuilder),
    close: closeSession,
  };
  const sessionBuilder = {
    authtoken: jest.fn().mockReturnThis(),
    metadata: jest.fn().mockReturnThis(),
    handleDisconnection: jest.fn().mockReturnThis(),
    handleHeartbeat: jest.fn().mockReturnThis(),
    connect: jest.fn().mockResolvedValue(session),
  };
  jest
    .mocked(ngrok.SessionBuilder)
    .mockImplementation(() => sessionBuilder as unknown as ngrok.SessionBuilder);
  return { closeListener, closeSession, endpointBuilder, sessionBuilder };
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

  it('appends metrics CORS args after the TURN args when provided', () => {
    const args = createServeSimArgs({
      port: 4321,
      turnArgs: ['--turn-url', 'turns:turn.example.test:443'],
      metricsCorsArgs: ['--metrics-cors-origin', 'https://expo.dev'],
    });
    expect(args.slice(-4)).toEqual([
      '--turn-url',
      'turns:turn.example.test:443',
      '--metrics-cors-origin',
      'https://expo.dev',
    ]);
  });
});

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
  beforeEach(() => {
    jest.mocked(ngrok.SessionBuilder).mockReset();
    jest.mocked(setTimeoutCallback).mockReset();
    jest.mocked(clearTimeoutCallback).mockReset();
  });

  it('uses a shared, observable session and a joinable listener', async () => {
    const { closeListener, closeSession, endpointBuilder, sessionBuilder } = mockNgrokSdk();

    const tunnel = await startNgrokTunnelAsync({
      port: 4321,
      subdomainPrefix: 'serve-sim',
      baseDomain: 'tunnel.example.test',
      authtoken: 'token',
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
    });

    expect(sessionBuilder.authtoken).toHaveBeenCalledWith('token');
    expect(sessionBuilder.metadata).toHaveBeenCalledWith(
      JSON.stringify({ deviceRunSessionId: 'drs-id', product: 'eas-simulator' })
    );
    expect(endpointBuilder.domain).toHaveBeenCalledWith(
      expect.stringMatching(/^serve-sim-[a-f0-9]{32}\.tunnel\.example\.test$/)
    );
    expect(endpointBuilder.metadata).toHaveBeenCalledWith(
      JSON.stringify({ deviceRunSessionId: 'drs-id', tunnelType: 'serve-sim' })
    );
    expect(endpointBuilder.listenAndForward).toHaveBeenCalledWith('http://127.0.0.1:4321');
    expect(tunnel.url).toBe('https://serve-sim.example.test');
    await tunnel.stopAsync();
    await tunnel.stopAsync();
    expect(closeListener).toHaveBeenCalledTimes(1);
    expect(closeSession).toHaveBeenCalledTimes(1);
  });

  it('surfaces terminal forwarding failures', async () => {
    let rejectJoin: (error: Error) => void = () => {};
    const joinPromise = new Promise<void>((_resolve, reject) => {
      rejectJoin = reject;
    });
    mockNgrokSdk({ joinPromise });
    const tunnel = await startNgrokTunnelAsync({
      port: 4321,
      subdomainPrefix: 'serve-sim',
      baseDomain: 'tunnel.example.test',
      authtoken: 'token',
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
    });

    const failurePromise = tunnel.waitForFailureAsync();
    rejectJoin(new Error('forwarder stopped'));
    await expect(failurePromise).rejects.toThrow('forwarder stopped');
    await tunnel.stopAsync();
  });

  it('keeps the shared session open until its last tunnel stops', async () => {
    const { closeSession } = mockNgrokSdk();
    const logger = createLoggerMock();
    const tunnelOptions = {
      baseDomain: 'tunnel.example.test',
      authtoken: 'token',
      deviceRunSessionId: 'drs-id',
      logger,
    };
    const firstTunnel = await startNgrokTunnelAsync({
      ...tunnelOptions,
      port: 4321,
      subdomainPrefix: 'argent',
    });
    const secondTunnel = await startNgrokTunnelAsync({
      ...tunnelOptions,
      port: 4322,
      subdomainPrefix: 'serve-sim',
    });

    expect(ngrok.SessionBuilder).toHaveBeenCalledTimes(1);
    await firstTunnel.stopAsync();
    expect(closeSession).not.toHaveBeenCalled();
    await secondTunnel.stopAsync();
    expect(closeSession).toHaveBeenCalledTimes(1);
  });

  it('lets ngrok reconnect transient disconnects and fails after the grace period', async () => {
    const disconnectTimeout = { unref: jest.fn() } as unknown as NodeJS.Timeout;
    jest.mocked(setTimeoutCallback).mockReturnValue(disconnectTimeout);
    const logger = createLoggerMock();
    const { sessionBuilder } = mockNgrokSdk();
    const tunnel = await startNgrokTunnelAsync({
      port: 4321,
      subdomainPrefix: 'serve-sim',
      baseDomain: 'tunnel.example.test',
      authtoken: 'token',
      deviceRunSessionId: 'drs-id',
      logger,
    });

    const onDisconnect = sessionBuilder.handleDisconnection.mock.calls[0][0] as (
      address: string,
      error: string
    ) => boolean;
    expect(onDisconnect('connect.ngrok-agent.com:443', 'network unavailable')).toBe(true);
    expect(setTimeoutCallback).toHaveBeenCalledWith(expect.any(Function), 60_000);

    const failurePromise = tunnel.waitForFailureAsync();
    const disconnectTimeoutCallback = jest.mocked(setTimeoutCallback).mock.calls[0][0];
    disconnectTimeoutCallback();
    await expect(failurePromise).rejects.toThrow('did not reconnect within 60 seconds');
    await tunnel.stopAsync();
  });
});

describe(spawnDetached, () => {
  it('keeps bounded diagnostic output for long-running processes', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const processPromise = Object.assign(new Promise<never>(() => {}), {
      child: {
        pid: undefined,
        stdout,
        stderr,
        unref: jest.fn(),
      },
    });
    jest.mocked(spawn).mockReturnValue(processPromise as never);

    const process = spawnDetached({
      command: 'long-running-command',
      args: [],
      env: {} as BuildStepEnv,
    });
    stdout.write('x'.repeat(300_000));

    expect(process.getOutput().startsWith('[... earlier output truncated ...]\n')).toBe(true);
    expect(process.getOutput().length).toBeLessThan(263_000);
    await process.stopAsync();
  });

  it('surfaces an unexpected child-process exit', async () => {
    let rejectProcess: (error: Error) => void = () => {};
    const processPromise = Object.assign(
      new Promise<never>((_resolve, reject) => {
        rejectProcess = reject;
      }),
      {
        child: {
          pid: undefined,
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          unref: jest.fn(),
        },
      }
    );
    jest.mocked(spawn).mockReturnValue(processPromise as never);
    const process = spawnDetached({
      command: 'failing-command',
      args: [],
      env: {} as BuildStepEnv,
    });

    const failurePromise = process.waitForFailureAsync();
    rejectProcess(new Error('exit code 1'));
    await expect(failurePromise).rejects.toThrow(
      'failing-command exited unexpectedly: exit code 1'
    );
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
  const durationTimeout = {} as NodeJS.Timeout;

  beforeEach(() => {
    jest.mocked(Sentry).capture.mockReset();
    jest.mocked(setTimeoutCallback).mockReset();
    jest.mocked(setTimeoutCallback).mockReturnValue(durationTimeout);
    jest.mocked(clearTimeoutCallback).mockReset();
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
    expect(setTimeoutCallback).not.toHaveBeenCalled();
  });

  it('returns normally when the maximum duration elapses', async () => {
    const ctx = createStatusCtxMock([{ status: 'IN_PROGRESS' }]);
    const logger = createLoggerMock();
    const waitPromise = waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger,
      maxDurationSeconds: 1,
    });

    expect(setTimeoutCallback).toHaveBeenCalledWith(expect.any(Function), 1_000);
    const durationTimeoutCallback = jest.mocked(setTimeoutCallback).mock.calls[0][0];
    durationTimeoutCallback();
    await waitPromise;

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Device run session drs-id reached its maximum duration.'
    );
    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('clears the duration timeout when the session stops first', async () => {
    await waitForDeviceRunSessionStoppedAsync({
      ctx: createStatusCtxMock([{ status: 'STOPPED' }]),
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
      maxDurationSeconds: 30,
    });

    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('does not poll when the build step is already aborted', async () => {
    const ctx = createStatusCtxMock([]);
    const abortController = new AbortController();
    abortController.abort();

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
      maxDurationSeconds: 30,
      signal: abortController.signal,
    });

    expect(ctx.graphqlClient.query).not.toHaveBeenCalled();
    expect(setTimeoutCallback).not.toHaveBeenCalled();
  });

  it('throws when the device run session errors', async () => {
    const ctx = createStatusCtxMock([{ status: 'ERRORED' }]);

    await expect(
      waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger: createLoggerMock(),
        maxDurationSeconds: 30,
      })
    ).rejects.toThrow('Device run session drs-id errored.');
    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('clears the duration timeout when the build step is aborted', async () => {
    const ctx = createStatusCtxMock([{ status: 'IN_PROGRESS' }]);
    const abortController = new AbortController();
    const waitPromise = waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
      maxDurationSeconds: 30,
      signal: abortController.signal,
    });

    abortController.abort();
    await waitPromise;

    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(clearTimeoutCallback).toHaveBeenCalledWith(durationTimeout);
  });

  it('stops polling and surfaces supervised resource failures', async () => {
    const ctx = createStatusCtxMock([{ status: 'IN_PROGRESS' }]);
    let pollSignal: AbortSignal | undefined;
    jest.mocked(setTimeoutAsync).mockImplementation(
      async (_timeoutMs, _value, options): Promise<undefined> =>
        await new Promise<undefined>((_resolve, reject) => {
          pollSignal = options?.signal;
          pollSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })
    );
    let rejectResource: (error: Error) => void = () => {};
    const resourceFailure = new Promise<void>((_resolve, reject) => {
      rejectResource = reject;
    });
    const waitPromise = waitForDeviceRunSessionStoppedOrResourceFailureAsync({
      ctx,
      deviceRunSessionId: 'drs-id',
      logger: createLoggerMock(),
      resources: [{ waitForFailureAsync: () => resourceFailure }],
    });
    await Promise.resolve();
    await Promise.resolve();

    rejectResource(new Error('tunnel failed'));
    await expect(waitPromise).rejects.toThrow('tunnel failed');
    expect(pollSignal?.aborted).toBe(true);
    expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(1);
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

  describe('with an idle timeout', () => {
    beforeEach(() => {
      // Fake timers make Date.now() advance by exactly the poll interval per
      // loop iteration, so idle time accumulates deterministically.
      jest.useFakeTimers();
      jest.mocked(setTimeoutAsync).mockImplementation(async delayMs => {
        jest.advanceTimersByTime(delayMs ?? 0);
        return undefined;
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function manyInProgressStatuses(): { status: 'IN_PROGRESS' }[] {
      return Array.from({ length: 20 }, () => ({ status: 'IN_PROGRESS' as const }));
    }

    it('stops the session when no activity is observed within the max idle time', async () => {
      const ctx = createStatusCtxMock(manyInProgressStatuses());
      const logger = createLoggerMock();

      await waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger,
        idleTimeout: {
          maxIdleTimeMinutes: 1,
          getLastEventObservedAt: () => undefined,
        },
      });

      // One minute at the 5-second poll interval is 12 status polls.
      expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(12);
      expect(ctx.graphqlClient.mutation).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        'Device run session drs-id had no activity for 1 minute(s) (max idle time). Stopping the session.'
      );
    });

    it('keeps the session alive while events keep arriving', async () => {
      const ctx = createStatusCtxMock([...manyInProgressStatuses(), { status: 'STOPPED' }]);
      const logger = createLoggerMock();

      await waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger,
        idleTimeout: {
          maxIdleTimeMinutes: 1,
          // Fresh activity on every check; 20 polls exceed one minute, so the
          // session would have been stopped without these events.
          getLastEventObservedAt: () => new Date(),
        },
      });

      expect(ctx.graphqlClient.query).toHaveBeenCalledTimes(21);
      expect(ctx.graphqlClient.mutation).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Device run session drs-id was stopped.');
    });

    it('still returns when the session cannot be marked stopped', async () => {
      const ctx = createStatusCtxMock(manyInProgressStatuses(), {
        ensureStoppedError: new Error('forbidden'),
      });
      const logger = createLoggerMock();

      await waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId: 'drs-id',
        logger,
        idleTimeout: {
          maxIdleTimeMinutes: 1,
          getLastEventObservedAt: () => undefined,
        },
      });

      expect(ctx.graphqlClient.mutation).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'Could not mark device run session drs-id as stopped. The session job ends anyway.'
      );
      expect(jest.mocked(Sentry).capture).toHaveBeenCalledWith(
        'Could not mark idle device run session as stopped',
        expect.any(Error),
        { level: 'warning', extras: { deviceRunSessionId: 'drs-id' } }
      );
    });
  });
});

describe(ensureFfmpegInstalledAsync, () => {
  const spawnMock = jest.mocked(spawn);

  function spawnResolved(): ReturnType<typeof spawn> {
    return Promise.resolve({}) as unknown as ReturnType<typeof spawn>;
  }

  function spawnRejected(): ReturnType<typeof spawn> {
    return Promise.reject(new Error('boom')) as unknown as ReturnType<typeof spawn>;
  }

  beforeEach(() => {
    spawnMock.mockReset();
    jest.mocked(Sentry).capture.mockReset();
  });

  it('does not install when ffmpeg is on PATH', async () => {
    spawnMock.mockReturnValueOnce(spawnResolved());

    await ensureFfmpegInstalledAsync({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: createEnvMock(),
      logger: createLoggerMock(),
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith('ffmpeg', ['-version'], expect.anything());
  });

  it('installs ffmpeg with Homebrew on darwin when it is missing', async () => {
    spawnMock.mockReturnValueOnce(spawnRejected()).mockReturnValueOnce(spawnResolved());

    await ensureFfmpegInstalledAsync({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: createEnvMock(),
      logger: createLoggerMock(),
    });

    expect(spawnMock).toHaveBeenLastCalledWith(
      'brew',
      ['install', 'ffmpeg'],
      expect.objectContaining({
        env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' }),
      })
    );
  });

  it('installs ffmpeg with apt on linux when it is missing', async () => {
    spawnMock
      .mockReturnValueOnce(spawnRejected()) // ffmpeg -version
      .mockReturnValueOnce(spawnResolved()) // apt-get update
      .mockReturnValueOnce(spawnResolved()); // apt-get install

    await ensureFfmpegInstalledAsync({
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: createEnvMock(),
      logger: createLoggerMock(),
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'sudo',
      ['apt-get', 'update'],
      expect.objectContaining({
        env: expect.objectContaining({ DEBIAN_FRONTEND: 'noninteractive' }),
      })
    );
    expect(spawnMock).toHaveBeenLastCalledWith(
      'sudo',
      ['apt-get', 'install', '-y', 'ffmpeg'],
      expect.objectContaining({
        env: expect.objectContaining({ DEBIAN_FRONTEND: 'noninteractive' }),
      })
    );
  });

  it('still installs on linux when the apt index refresh fails', async () => {
    spawnMock
      .mockReturnValueOnce(spawnRejected()) // ffmpeg -version
      .mockReturnValueOnce(spawnRejected()) // apt-get update
      .mockReturnValueOnce(spawnResolved()); // apt-get install
    const logger = createLoggerMock();

    await ensureFfmpegInstalledAsync({
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: createEnvMock(),
      logger,
    });

    expect(spawnMock).toHaveBeenLastCalledWith(
      'sudo',
      ['apt-get', 'install', '-y', 'ffmpeg'],
      expect.anything()
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns and resolves when the install fails, so the session still starts', async () => {
    spawnMock.mockReturnValueOnce(spawnRejected()).mockReturnValueOnce(spawnRejected());
    const logger = createLoggerMock();

    await expect(
      ensureFfmpegInstalledAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: createEnvMock(),
        logger,
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
    expect(jest.mocked(Sentry).capture).toHaveBeenCalled();
  });

  // The caller runs this with `void` and the worker installs no unhandledRejection
  // handler, so a rejection here would crash the process. `spawn` is not async and
  // can throw synchronously, which `asyncResult` cannot catch.
  it('resolves when the availability check throws synchronously', async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('sync spawn failure');
    });
    const logger = createLoggerMock();

    await expect(
      ensureFfmpegInstalledAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: createEnvMock(),
        logger,
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
    expect(jest.mocked(Sentry).capture).toHaveBeenCalled();
  });
});
