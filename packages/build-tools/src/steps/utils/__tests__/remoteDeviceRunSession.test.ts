import { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import * as ngrok from '@ngrok/ngrok';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { sleepAsync } from '../../../utils/retry';
import {
  createServeSimArgs,
  ensureFfmpegInstalledAsync,
  fetchServeSimTurnArgsAsync,
  metricsCorsOriginToServeSimArgs,
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
