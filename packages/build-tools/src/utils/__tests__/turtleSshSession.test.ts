import { SshSettings, SystemError } from '@expo/eas-build-job';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { sleepAsync } from '../retry';
import {
  SshSessionHandle,
  getSshIdleTimeoutSeconds,
  getSshRelayServerUrl,
  isSshEnabled,
  startSshSessionAsync,
  superviseSshSessionAsync,
} from '../turtleSshSession';
import { SshConnectionConfig, UptermHost, startUptermHostAsync } from '../upterm';

jest.mock('../retry', () => ({
  sleepAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../upterm', () => ({
  ...jest.requireActual('../upterm'),
  startUptermHostAsync: jest.fn(),
}));

const mockedStartUptermHost = jest.mocked(startUptermHostAsync);

function sshJob(idleTimeoutSeconds: number): { ssh: SshSettings } {
  return { ssh: { idleTimeoutSeconds, relayServerUrl: 'wss://relay.expo.dev' } };
}

function superviseHandle(
  overrides: Partial<SshSessionHandle> &
    Pick<SshSessionHandle, 'getConnectedClientCountAsync' | 'ensureConnectedAsync'>
): SshSessionHandle {
  return {
    stopAsync: async () => {},
    ...overrides,
  };
}

describe(isSshEnabled, () => {
  it('is true when job.ssh is present', () => {
    expect(isSshEnabled(sshJob(0))).toBe(true);
  });

  it('is false otherwise', () => {
    expect(isSshEnabled({})).toBe(false);
  });
});

describe(getSshIdleTimeoutSeconds, () => {
  it('returns idleTimeoutSeconds from job.ssh', () => {
    expect(getSshIdleTimeoutSeconds(sshJob(900))).toBe(900);
    expect(getSshIdleTimeoutSeconds(sshJob(0))).toBe(0);
    expect(getSshIdleTimeoutSeconds(sshJob(3600))).toBe(3600);
  });

  it('defaults to 0 when job.ssh is missing', () => {
    expect(getSshIdleTimeoutSeconds({})).toBe(0);
  });

  it('throws when the value is not an integer in range', () => {
    for (const idleTimeoutSeconds of [300.5, -1, 3601]) {
      expect(() => getSshIdleTimeoutSeconds(sshJob(idleTimeoutSeconds))).toThrow(SystemError);
    }
  });
});

describe(getSshRelayServerUrl, () => {
  it('returns the relay url from the job ssh settings', () => {
    expect(getSshRelayServerUrl(sshJob(0))).toBe('wss://relay.expo.dev');
  });

  it('throws when the job carries no relay url', () => {
    expect(() => getSshRelayServerUrl({})).toThrow(/no relay server URL/);
  });
});

describe(startSshSessionAsync, () => {
  const config1: SshConnectionConfig = {
    type: 'upterm-v1',
    host: 'relay.expo.dev',
    secret: 'secret-1',
  };
  const config2: SshConnectionConfig = { ...config1, secret: 'secret-2' };
  const target = { type: 'JOB_RUN', id: 'jr-1' } as const;

  let createOrUpdateResult: { data?: unknown; error?: { message: string } };
  let mutation: jest.Mock;
  let ctx: BuildContext;

  function makeHost(overrides: Partial<UptermHost> = {}): UptermHost {
    const host: UptermHost = {
      connectionConfig: config1,
      getConnectedClientCountAsync: jest.fn().mockResolvedValue(3),
      isAlive: jest.fn().mockReturnValue(true),
      redialAsync: jest.fn(async () => {
        host.connectionConfig = config2;
        return config2;
      }),
      stopAsync: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    return host;
  }

  beforeEach(() => {
    createOrUpdateResult = {
      data: {
        turtleSshSession: {
          createOrUpdateTurtleSshSession: {
            id: 'ts-1',
            sessionSettings: { idleTimeoutSeconds: 900 },
          },
        },
      },
    };
    mutation = jest.fn().mockReturnValue({ toPromise: async () => createOrUpdateResult });
    ctx = {
      logger: createMockLogger(),
      graphqlClient: { mutation },
    } as unknown as BuildContext;
  });

  it('creates or updates the session and returns a handle plus idle timeout that delegates to the host', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle, idleTimeoutSeconds } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://relay.expo.dev',
      idleTimeoutSeconds: 900,
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      target: { type: 'JOB_RUN', id: 'jr-1' },
      connectionConfig: { ...config1, reconnecting: false, type: 'UPTERM_V1' },
      sessionSettings: { idleTimeoutSeconds: 900 },
    });
    expect(idleTimeoutSeconds).toBe(900);
    await handle.getConnectedClientCountAsync();
    expect(host.getConnectedClientCountAsync).toHaveBeenCalled();
    await handle.stopAsync();
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('reports a build target', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);

    await startSshSessionAsync(ctx, {
      target: { type: 'BUILD', id: 'b-1' },
      relayServerUrl: 'wss://relay.expo.dev',
      idleTimeoutSeconds: 900,
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      target: { type: 'BUILD', id: 'b-1' },
      connectionConfig: { ...config1, reconnecting: false, type: 'UPTERM_V1' },
      sessionSettings: { idleTimeoutSeconds: 900 },
    });
  });

  it('throws and tears down the dialed host when creating or updating the session fails', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);
    createOrUpdateResult = { error: { message: 'boom' } };

    await expect(
      startSshSessionAsync(ctx, {
        target,
        relayServerUrl: 'wss://r',
        idleTimeoutSeconds: 300,
      })
    ).rejects.toThrow('boom');
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('still rethrows when teardown after a create/update failure also fails', async () => {
    const host = makeHost({
      stopAsync: jest.fn().mockRejectedValue(new Error('already gone')),
    });
    mockedStartUptermHost.mockResolvedValue(host);
    createOrUpdateResult = { error: { message: 'boom' } };

    await expect(
      startSshSessionAsync(ctx, {
        target,
        relayServerUrl: 'wss://r',
        idleTimeoutSeconds: 300,
      })
    ).rejects.toThrow('boom');
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('throws "no data returned" when create or update succeeds without a payload', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);
    createOrUpdateResult = {};

    await expect(
      startSshSessionAsync(ctx, {
        target,
        relayServerUrl: 'wss://r',
        idleTimeoutSeconds: 300,
      })
    ).rejects.toThrow(/no data returned/);
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('ensureConnected is a no-op while the host is alive', async () => {
    const host = makeHost({ isAlive: jest.fn().mockReturnValue(true) });
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });
    await handle.ensureConnectedAsync();

    expect(host.redialAsync).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('marks reconnecting, redials, then reports the fresh config', async () => {
    const host = makeHost({ isAlive: jest.fn().mockReturnValue(false) });
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });
    await handle.ensureConnectedAsync();

    expect(host.redialAsync).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectionConfig: expect.objectContaining({ reconnecting: true }),
      })
    );
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      target: { type: 'JOB_RUN', id: 'jr-1' },
      connectionConfig: { ...config2, reconnecting: false, type: 'UPTERM_V1' },
      sessionSettings: { idleTimeoutSeconds: 300 },
    });
  });

  it('continues redial when the reconnecting status update fails', async () => {
    const host = makeHost({ isAlive: jest.fn().mockReturnValue(false) });
    mockedStartUptermHost.mockResolvedValue(host);
    mutation
      .mockReturnValueOnce({ toPromise: async () => createOrUpdateResult }) // initial create
      .mockReturnValueOnce({
        toPromise: async () => {
          throw new Error('www unreachable');
        },
      }) // reconnecting=true best-effort
      .mockReturnValue({ toPromise: async () => createOrUpdateResult }); // post-redial

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });
    await handle.ensureConnectedAsync();

    expect(host.redialAsync).toHaveBeenCalledTimes(1);
  });

  it('retries only the report (no second redial) when reporting the fresh config fails', async () => {
    let alive = false;
    const host = makeHost({
      isAlive: jest.fn(() => alive),
    });
    host.redialAsync = jest.fn(async () => {
      alive = true;
      host.connectionConfig = config2;
      return config2;
    });
    mockedStartUptermHost.mockResolvedValue(host);
    mutation = jest
      .fn()
      .mockReturnValueOnce({ toPromise: async () => createOrUpdateResult })
      .mockReturnValueOnce({ toPromise: async () => createOrUpdateResult })
      .mockReturnValueOnce({ toPromise: async () => ({ error: { message: 'flaky' } }) })
      .mockReturnValue({ toPromise: async () => createOrUpdateResult });
    ctx = { logger: createMockLogger(), graphqlClient: { mutation } } as unknown as BuildContext;

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });
    await handle.ensureConnectedAsync();

    expect(host.redialAsync).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      target: { type: 'JOB_RUN', id: 'jr-1' },
      connectionConfig: { ...config2, reconnecting: false, type: 'UPTERM_V1' },
      sessionSettings: { idleTimeoutSeconds: 300 },
    });
  });

  it('throws once the redial budget is exhausted', async () => {
    const host = makeHost({
      isAlive: jest.fn().mockReturnValue(false),
      redialAsync: jest.fn().mockRejectedValue(new Error('relay down')),
    });
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });

    await expect(handle.ensureConnectedAsync()).rejects.toThrow(/after 10 attempts/);
    expect(host.redialAsync).toHaveBeenCalledTimes(10);
  });
});

describe(superviseSshSessionAsync, () => {
  const logger = createMockLogger();
  const mockedSleep = jest.mocked(sleepAsync);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSleep.mockResolvedValue(undefined);
  });

  it('keeps the session open while the job is running, even with a 0 idle timeout', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle({
        ensureConnectedAsync: async () => {
          if (polls >= 5) {
            throw new SystemError('stop the loop');
          }
        },
        getConnectedClientCountAsync: async () => {
          polls += 1;
          return 0;
        },
      }),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => false,
      logger,
    });
    expect(polls).toBe(5);
  });

  it('closes as soon as the job finishes when the idle timeout is 0', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle({
        ensureConnectedAsync: async () => {},
        getConnectedClientCountAsync: async () => {
          polls += 1;
          return 0;
        },
      }),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(polls).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      'The job finished and no SSH client is connected. Closing the session.'
    );
  });

  it('waits for a connected client to disconnect before closing with a 0 idle timeout', async () => {
    const clientCounts = [1, 1, 0];
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle({
        ensureConnectedAsync: async () => {},
        getConnectedClientCountAsync: async () => {
          polls += 1;
          return clientCounts.shift() ?? 0;
        },
      }),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(polls).toBe(3);
  });

  it('starts the idle countdown when the job finishes, not when the session opens', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      let jobHasFinished = false;
      let polls = 0;
      mockedSleep.mockImplementation(async () => {
        jest.setSystemTime(Date.now() + 60_000);
      });
      await superviseSshSessionAsync({
        handle: superviseHandle({
          ensureConnectedAsync: async () => {},
          getConnectedClientCountAsync: async () => {
            polls += 1;
            if (polls >= 5) {
              jobHasFinished = true;
            }
            return 0;
          },
        }),
        idleTimeoutSeconds: 300,
        hasJobFinished: () => jobHasFinished,
        logger,
      });
      // Nobody connects, so the 4 idle minutes spent during the job must not count towards the
      // 5 minute timeout: it closes 5 minutes after the job finished, on the 10th poll.
      expect(polls).toBe(10);
    } finally {
      jest.useRealTimers();
    }
  });

  it('logs the connected client count whenever it changes', async () => {
    const clientCounts = [1, 2, 1, 0];
    await superviseSshSessionAsync({
      handle: superviseHandle({
        ensureConnectedAsync: async () => {},
        getConnectedClientCountAsync: async () => clientCounts.shift() ?? 0,
      }),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 1');
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 2');
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 1');
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 0');
  });

  it('closes the session when the relay connection cannot be restored', async () => {
    let clientCountCalls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle({
        ensureConnectedAsync: async () => {
          throw new SystemError('relay down');
        },
        getConnectedClientCountAsync: async () => {
          clientCountCalls += 1;
          return 1;
        },
      }),
      idleTimeoutSeconds: 300,
      hasJobFinished: () => false,
      logger,
    });
    expect(clientCountCalls).toBe(0);
  });

  it('does not close while a client stays connected, even past the idle timeout', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle({
        ensureConnectedAsync: async () => {
          if (polls > 3) {
            throw new SystemError('stop the loop');
          }
        },
        getConnectedClientCountAsync: async () => {
          polls += 1;
          return 1;
        },
      }),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(polls).toBeGreaterThan(3);
  });

  it('closes when the client count cannot be read', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle({
        ensureConnectedAsync: async () => {},
        getConnectedClientCountAsync: async () => {
          polls += 1;
          throw new SystemError(
            'Could not read the SSH client count from the upterm admin socket.'
          );
        },
      }),
      idleTimeoutSeconds: 300,
      hasJobFinished: () => false,
      logger,
    });
    expect(polls).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'Could not read the SSH client count. Closing the session.'
    );
  });
});
