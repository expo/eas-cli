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
import {
  SshConnectionConfig,
  UptermHost,
  UptermSessionStatus,
  startUptermHostAsync,
} from '../upterm';

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

function superviseHandle(readStatusAsync: () => Promise<UptermSessionStatus>): SshSessionHandle {
  return { readStatusAsync, stopAsync: async () => {} };
}

function ready(connectedClientCount: number): UptermSessionStatus {
  return { state: 'ready', connectedClientCount };
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
  const config1: SshConnectionConfig = { type: 'upterm-v1', secret: 'secret-1' };
  const target = { type: 'JOB_RUN', id: 'jr-1' } as const;

  let createOrUpdateResult: { data?: unknown; error?: { message: string } };
  let mutation: jest.Mock;
  let ctx: BuildContext;

  function makeHost(overrides: Partial<UptermHost> = {}): UptermHost {
    return {
      connectionConfig: config1,
      startedReconnecting: false,
      readStatusAsync: jest.fn().mockResolvedValue(ready(3)),
      stopAsync: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function hostWithStatuses(statuses: UptermSessionStatus[]): UptermHost {
    return makeHost({
      readStatusAsync: jest.fn(async () => {
        const status = statuses.shift();
        if (!status) {
          throw new Error('no more statuses');
        }
        return status;
      }),
    });
  }

  function reportedReconnecting(): boolean[] {
    return mutation.mock.calls.map(([, vars]) => vars.connectionConfig.reconnecting);
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
      connectionConfig: { type: 'UPTERM_V1', secret: 'secret-1', reconnecting: false },
      sessionSettings: { idleTimeoutSeconds: 900 },
    });
    expect(idleTimeoutSeconds).toBe(900);
    expect(await handle.readStatusAsync()).toEqual(ready(3));
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
      connectionConfig: { type: 'UPTERM_V1', secret: 'secret-1', reconnecting: false },
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

  it('tells www about reconnecting only when the status changes, with the same session id', async () => {
    const reconnecting: UptermSessionStatus = { state: 'reconnecting', connectedClientCount: 0 };
    mockedStartUptermHost.mockResolvedValue(
      hostWithStatuses([ready(1), reconnecting, reconnecting, ready(0), ready(0)])
    );

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });
    for (let poll = 0; poll < 5; poll++) {
      await handle.readStatusAsync();
    }

    expect(reportedReconnecting()).toEqual([false, true, false]);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      target: { type: 'JOB_RUN', id: 'jr-1' },
      connectionConfig: { type: 'UPTERM_V1', secret: 'secret-1', reconnecting: false },
      sessionSettings: { idleTimeoutSeconds: 300 },
    });
  });

  it('sends the start status in the create call and tracks transitions from it', async () => {
    const reconnecting: UptermSessionStatus = { state: 'reconnecting', connectedClientCount: 0 };
    mockedStartUptermHost.mockResolvedValue({
      ...hostWithStatuses([reconnecting, ready(0), ready(0)]),
      startedReconnecting: true,
    });

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });
    for (let poll = 0; poll < 3; poll++) {
      await handle.readStatusAsync();
    }

    expect(reportedReconnecting()).toEqual([true, false]);
  });

  it('retries a failed report on the next poll and drops it when the status flips back first', async () => {
    const reconnecting: UptermSessionStatus = { state: 'reconnecting', connectedClientCount: 0 };
    mockedStartUptermHost.mockResolvedValue(
      hostWithStatuses([reconnecting, reconnecting, ready(0), reconnecting, ready(0)])
    );
    mutation
      .mockReturnValueOnce({ toPromise: async () => createOrUpdateResult })
      .mockReturnValueOnce({ toPromise: async () => ({ error: { message: 'www down' } }) })
      .mockReturnValueOnce({ toPromise: async () => createOrUpdateResult })
      .mockReturnValueOnce({ toPromise: async () => ({ error: { message: 'www down' } }) })
      .mockReturnValue({ toPromise: async () => createOrUpdateResult });

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });
    for (let poll = 0; poll < 5; poll++) {
      await handle.readStatusAsync();
    }

    // create, true (fails), true, false (fails), nothing while www still has true, false.
    expect(reportedReconnecting()).toEqual([false, true, true, false, false]);
  });

  it('passes a session that is gone for good through without telling www', async () => {
    mockedStartUptermHost.mockResolvedValue(
      hostWithStatuses([{ state: 'gone', reason: 'disconnected (reconnect_unsupported)' }])
    );

    const { handle } = await startSshSessionAsync(ctx, {
      target,
      relayServerUrl: 'wss://r',
      idleTimeoutSeconds: 300,
    });

    expect(await handle.readStatusAsync()).toEqual({
      state: 'gone',
      reason: 'disconnected (reconnect_unsupported)',
    });
    expect(mutation).toHaveBeenCalledTimes(1);
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
      handle: superviseHandle(async () => {
        polls += 1;
        return polls > 5 ? { state: 'gone', reason: 'ending' } : ready(0);
      }),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => false,
      logger,
    });
    expect(polls).toBe(6);
  });

  it('closes as soon as the job finishes when the idle timeout is 0', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle(async () => {
        polls += 1;
        return ready(0);
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
      handle: superviseHandle(async () => {
        polls += 1;
        return ready(clientCounts.shift() ?? 0);
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
        handle: superviseHandle(async () => {
          polls += 1;
          if (polls >= 5) {
            jobHasFinished = true;
          }
          return ready(0);
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
      handle: superviseHandle(async () => ready(clientCounts.shift() ?? 0)),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 1');
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 2');
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 1');
    expect(logger.info).toHaveBeenCalledWith('SSH clients connected: 0');
  });

  it('keeps the session open while upterm reconnects, then closes it once it is gone for good', async () => {
    const statuses: UptermSessionStatus[] = [
      { state: 'reconnecting', connectedClientCount: 0 },
      { state: 'reconnecting', connectedClientCount: 0 },
      { state: 'gone', reason: 'disconnected (reconnect_unsupported)' },
      ready(1),
    ];
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle(async () => {
        polls += 1;
        return statuses.shift() ?? ready(1);
      }),
      idleTimeoutSeconds: 300,
      hasJobFinished: () => false,
      logger,
    });
    expect(polls).toBe(3);
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not restore the SSH relay connection (disconnected (reconnect_unsupported)). Closing the session.'
    );
  });

  it('does not close while a client stays connected, even past the idle timeout', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle(async () => {
        polls += 1;
        return polls > 4 ? { state: 'gone', reason: 'ending' } : ready(1);
      }),
      idleTimeoutSeconds: 0,
      hasJobFinished: () => true,
      logger,
    });
    expect(polls).toBe(5);
  });

  it('closes when the client count cannot be read', async () => {
    let polls = 0;
    await superviseSshSessionAsync({
      handle: superviseHandle(async () => {
        polls += 1;
        throw new SystemError('Could not read the SSH client count from the upterm admin socket.');
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
