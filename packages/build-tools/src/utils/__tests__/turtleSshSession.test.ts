import { SshSettings, SystemError } from '@expo/eas-build-job';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { sleepAsync } from '../retry';
import {
  formatSshIdleTimeoutForLog,
  getSshIdleTimeoutSeconds,
  getSshRelayServerUrl,
  getTurtleSshTarget,
  getWorkflowJobIdOrThrow,
  isWorkflowSshEnabled,
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

describe(isWorkflowSshEnabled, () => {
  it('is true when job.ssh is present', () => {
    expect(isWorkflowSshEnabled(sshJob(0))).toBe(true);
  });

  it('is false otherwise', () => {
    expect(isWorkflowSshEnabled({})).toBe(false);
  });
});

describe(getWorkflowJobIdOrThrow, () => {
  it('returns the injected workflow job id', () => {
    expect(getWorkflowJobIdOrThrow({ __WORKFLOW_JOB_ID: 'wj-1' })).toBe('wj-1');
  });

  it('throws when not set', () => {
    expect(() => getWorkflowJobIdOrThrow({})).toThrow(SystemError);
  });
});

describe(getSshIdleTimeoutSeconds, () => {
  it('returns idleTimeoutSeconds from job.ssh', () => {
    expect(getSshIdleTimeoutSeconds(sshJob(900))).toBe(900);
    expect(getSshIdleTimeoutSeconds(sshJob(0))).toBe(0);
    expect(getSshIdleTimeoutSeconds(sshJob(3600))).toBe(3600);
  });

  it('throws when job.ssh is missing', () => {
    expect(() => getSshIdleTimeoutSeconds({})).toThrow(SystemError);
  });

  it('throws when the value is not an integer in range', () => {
    for (const idleTimeoutSeconds of [300.5, -1, 3601]) {
      expect(() => getSshIdleTimeoutSeconds(sshJob(idleTimeoutSeconds))).toThrow(SystemError);
    }
  });
});

describe(getTurtleSshTarget, () => {
  it('uses turtleBuildId when the job has a platform', () => {
    expect(getTurtleSshTarget({ buildId: 'b-1', hasPlatform: true })).toEqual({
      turtleBuildId: 'b-1',
    });
  });

  it('uses turtleJobRunId otherwise', () => {
    expect(getTurtleSshTarget({ buildId: 'jr-1', hasPlatform: false })).toEqual({
      turtleJobRunId: 'jr-1',
    });
  });
});

describe(getSshRelayServerUrl, () => {
  it('returns the relay url from the job ssh settings', () => {
    expect(getSshRelayServerUrl(sshJob(0))).toBe('wss://relay.expo.dev');
  });

  it('throws when the job carries no relay url', () => {
    expect(() => getSshRelayServerUrl({})).toThrow(/job\.ssh\.relayServerUrl/);
  });
});

describe(formatSshIdleTimeoutForLog, () => {
  it.each([
    [0, '0 seconds'],
    [1, '1 second'],
    [45, '45 seconds'],
    [60, '1 minute'],
    [90, '1 minute 30 seconds'],
    [120, '2 minutes'],
    [3600, '1 hour'],
    [3661, '1 hour 1 minute 1 second'],
    [7200, '2 hours'],
  ] as const)('formats %i as %s', (seconds, expected) => {
    expect(formatSshIdleTimeoutForLog(seconds)).toBe(expected);
  });
});

describe(startSshSessionAsync, () => {
  const config1: SshConnectionConfig = {
    type: 'upterm-v1',
    host: 'relay.expo.dev',
    secret: 'secret-1',
  };
  const config2: SshConnectionConfig = { ...config1, secret: 'secret-2' };
  const target = { turtleJobRunId: 'jr-1' } as const;

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
      turtleJobRunId: 'jr-1',
      turtleBuildId: null,
      connectionConfig: { ...config1, reconnecting: false, type: 'UPTERM_V1' },
      sessionSettings: { idleTimeoutSeconds: 900 },
    });
    expect(idleTimeoutSeconds).toBe(900);
    await handle.getConnectedClientCountAsync();
    expect(host.getConnectedClientCountAsync).toHaveBeenCalled();
    await handle.stopAsync();
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('reports turtleBuildId when the target is a build', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);

    await startSshSessionAsync(ctx, {
      target: { turtleBuildId: 'b-1' },
      relayServerUrl: 'wss://relay.expo.dev',
      idleTimeoutSeconds: 900,
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      turtleJobRunId: null,
      turtleBuildId: 'b-1',
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

  it('still throws the create error when host teardown itself fails', async () => {
    const host = makeHost({
      stopAsync: jest.fn().mockRejectedValue(new Error('teardown failed')),
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
      turtleJobRunId: 'jr-1',
      turtleBuildId: null,
      connectionConfig: { ...config2, reconnecting: false, type: 'UPTERM_V1' },
      sessionSettings: { idleTimeoutSeconds: 300 },
    });
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
      turtleJobRunId: 'jr-1',
      turtleBuildId: null,
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
      ensureConnected: async () => {
        if (polls >= 5) {
          throw new SystemError('stop the loop');
        }
      },
      getConnectedClientCount: async () => {
        polls += 1;
        return 0;
      },
      idleTimeoutSeconds: 0,
      hasJobFinished: () => false,
      logger,
    });
    expect(polls).toBe(5);
  });

  it('closes as soon as the job finishes when the idle timeout is 0', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      ensureConnected: async () => {},
      getConnectedClientCount: async () => {
        polls += 1;
        return 0;
      },
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
      ensureConnected: async () => {},
      getConnectedClientCount: async () => {
        polls += 1;
        return clientCounts.shift() ?? 0;
      },
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
        ensureConnected: async () => {},
        getConnectedClientCount: async () => {
          polls += 1;
          if (polls >= 5) {
            jobHasFinished = true;
          }
          return 0;
        },
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

  it('logs each client connecting and disconnecting with the current count', async () => {
    const clientCounts = [1, 2, 1, 0];
    await superviseSshSessionAsync({
      ensureConnected: async () => {},
      getConnectedClientCount: async () => clientCounts.shift() ?? 0,
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith('An SSH client connected.');
    expect(logger.info).toHaveBeenCalledWith('An SSH client connected (2 connected).');
    expect(logger.info).toHaveBeenCalledWith('An SSH client disconnected (1 still connected).');
    expect(logger.info).toHaveBeenCalledWith('The SSH client disconnected.');
  });

  it('closes the session when the relay connection cannot be restored', async () => {
    let clientCountCalls = 0;
    await superviseSshSessionAsync({
      ensureConnected: async () => {
        throw new SystemError('relay down');
      },
      getConnectedClientCount: async () => {
        clientCountCalls += 1;
        return 1;
      },
      idleTimeoutSeconds: 300,
      hasJobFinished: () => false,
      logger,
    });
    expect(clientCountCalls).toBe(0);
  });

  it('does not close while a client stays connected, even past the idle timeout', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      ensureConnected: async () => {
        if (polls > 3) {
          throw new SystemError('stop the loop');
        }
      },
      getConnectedClientCount: async () => {
        polls += 1;
        return 1;
      },
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(polls).toBeGreaterThan(3);
  });

  it('does not close on a single unknown client count after the job finishes', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      ensureConnected: async () => {
        if (polls >= 2) {
          throw new SystemError('stop the loop');
        }
      },
      getConnectedClientCount: async () => {
        polls += 1;
        return null;
      },
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(logger.info).not.toHaveBeenCalledWith(
      'The job finished and no SSH client is connected. Closing the session.'
    );
  });

  it('ignores unknown client counts while the job is still running', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      ensureConnected: async () => {
        if (polls >= 2) {
          throw new SystemError('stop the loop');
        }
      },
      getConnectedClientCount: async () => {
        polls += 1;
        return null;
      },
      idleTimeoutSeconds: 0,
      hasJobFinished: () => false,
      logger,
    });
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  it('closes after unknown client count persists past the grace window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      mockedSleep.mockImplementation(async () => {
        jest.setSystemTime(Date.now() + 10_000);
      });
      let polls = 0;
      await superviseSshSessionAsync({
        ensureConnected: async () => {},
        getConnectedClientCount: async () => {
          polls += 1;
          return null;
        },
        idleTimeoutSeconds: 0,
        hasJobFinished: () => true,
        logger,
      });
      // 30s grace / 10s per poll → closes on the poll after grace is reached.
      expect(polls).toBeGreaterThan(1);
      expect(logger.info).toHaveBeenCalledWith(
        'Could not determine whether an SSH client is still connected after the job finished. Closing the session.'
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
