import { SystemError } from '@expo/eas-build-job';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { SshConnectionConfig, UptermHost, startUptermHostAsync } from '../upterm';
import {
  formatSshIdleTimeoutForLog,
  getSshRelayServerUrl,
  getWorkflowJobIdOrThrow,
  holdSshSessionUntilIdleAsync,
  isWorkflowSshEnabled,
  startSshSessionAsync,
} from '../turtleSshSession';

jest.mock('../retry', () => ({
  sleepAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../upterm', () => ({
  ...jest.requireActual('../upterm'),
  startUptermHostAsync: jest.fn(),
}));

const mockedStartUptermHost = jest.mocked(startUptermHostAsync);

describe(isWorkflowSshEnabled, () => {
  it('is true when the flag is set', () => {
    expect(isWorkflowSshEnabled({ EAS_WORKFLOW_SSH_ENABLED: 'true' })).toBe(true);
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

describe(getSshRelayServerUrl, () => {
  it('returns the injected relay url', () => {
    expect(getSshRelayServerUrl({ EAS_SSH_RELAY_URL: 'wss://relay.expo.dev' })).toBe(
      'wss://relay.expo.dev'
    );
  });

  it('defaults to the public upterm relay when not set', () => {
    expect(getSshRelayServerUrl({})).toBe('wss://uptermd.upterm.dev');
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

  let createResult: { data?: unknown; error?: { message: string } };
  let updateResult: { error?: { message: string } };
  let mutation: jest.Mock;
  let ctx: BuildContext;

  function makeHost(overrides: Partial<UptermHost> = {}): UptermHost {
    return {
      connectionConfig: config1,
      getConnectedClientCountAsync: jest.fn().mockResolvedValue(3),
      isAlive: jest.fn().mockReturnValue(true),
      redialAsync: jest.fn().mockResolvedValue(config2),
      stopAsync: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  beforeEach(() => {
    createResult = {
      data: {
        turtleSshSession: { createTurtleSshSession: { id: 'ts-1', idleTimeoutSeconds: 900 } },
      },
    };
    updateResult = {};
    mutation = jest
      .fn()
      .mockReturnValueOnce({ toPromise: async () => createResult })
      .mockReturnValue({ toPromise: async () => updateResult });
    ctx = {
      logger: createMockLogger(),
      graphqlClient: { mutation },
    } as unknown as BuildContext;
  });

  it('creates the session and returns a handle plus idle timeout that delegates to the host', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle, idleTimeoutSeconds } = await startSshSessionAsync(ctx, {
      workflowJobId: 'wj-1',
      relayServerUrl: 'wss://relay.expo.dev',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      workflowJobId: 'wj-1',
      connectionConfig: config1,
    });
    expect(idleTimeoutSeconds).toBe(900);
    await handle.getConnectedClientCountAsync();
    expect(host.getConnectedClientCountAsync).toHaveBeenCalled();
    await handle.stopAsync();
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('throws and tears down the dialed host when creating the session fails', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);
    createResult = { error: { message: 'boom' } };

    await expect(
      startSshSessionAsync(ctx, { workflowJobId: 'wj-1', relayServerUrl: 'wss://r' })
    ).rejects.toThrow('boom');
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('throws "no data returned" when create succeeds without a payload', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);
    createResult = {};

    await expect(
      startSshSessionAsync(ctx, { workflowJobId: 'wj-1', relayServerUrl: 'wss://r' })
    ).rejects.toThrow(/no data returned/);
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('still rethrows create failures when tearing down the host itself fails', async () => {
    const host = makeHost({
      stopAsync: jest.fn().mockRejectedValue(new Error('teardown failed')),
    });
    mockedStartUptermHost.mockResolvedValue(host);
    createResult = { error: { message: 'boom' } };

    await expect(
      startSshSessionAsync(ctx, { workflowJobId: 'wj-1', relayServerUrl: 'wss://r' })
    ).rejects.toThrow('boom');
    expect(host.stopAsync).toHaveBeenCalled();
  });

  it('closes the turtle ssh session through the returned handle', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);
    mutation = jest
      .fn()
      .mockReturnValueOnce({ toPromise: async () => createResult })
      .mockReturnValueOnce({ toPromise: async () => ({}) });
    ctx = { logger: createMockLogger(), graphqlClient: { mutation } } as unknown as BuildContext;

    const { handle } = await startSshSessionAsync(ctx, {
      workflowJobId: 'wj-1',
      relayServerUrl: 'wss://r',
    });
    await handle.closeSessionAsync();

    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), { turtleSshSessionId: 'ts-1' });
  });

  it('surfaces closeSession errors from the GraphQL mutation', async () => {
    const host = makeHost();
    mockedStartUptermHost.mockResolvedValue(host);
    mutation = jest
      .fn()
      .mockReturnValueOnce({ toPromise: async () => createResult })
      .mockReturnValueOnce({ toPromise: async () => ({ error: { message: 'already closed' } }) });
    ctx = { logger: createMockLogger(), graphqlClient: { mutation } } as unknown as BuildContext;

    const { handle } = await startSshSessionAsync(ctx, {
      workflowJobId: 'wj-1',
      relayServerUrl: 'wss://r',
    });

    await expect(handle.closeSessionAsync()).rejects.toThrow(/already closed/);
  });

  it('ensureConnected is a no-op while the host is alive', async () => {
    const host = makeHost({ isAlive: jest.fn().mockReturnValue(true) });
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle } = await startSshSessionAsync(ctx, {
      workflowJobId: 'wj-1',
      relayServerUrl: 'wss://r',
    });
    await handle.ensureConnectedAsync();

    expect(host.redialAsync).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('redials and re-reports the fresh config when the host has dropped', async () => {
    const host = makeHost({ isAlive: jest.fn().mockReturnValue(false) });
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle } = await startSshSessionAsync(ctx, {
      workflowJobId: 'wj-1',
      relayServerUrl: 'wss://r',
    });
    await handle.ensureConnectedAsync();

    expect(host.redialAsync).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      turtleSshSessionId: 'ts-1',
      connectionConfig: config2,
    });
  });

  it('retries only the report (no second redial) when reporting the fresh config fails', async () => {
    let alive = false;
    const host = makeHost({
      isAlive: jest.fn(() => alive),
      redialAsync: jest.fn(async () => {
        alive = true;
        return config2;
      }),
    });
    mockedStartUptermHost.mockResolvedValue(host);
    // create ok, first report fails (flaky mutation), second report succeeds
    mutation = jest
      .fn()
      .mockReturnValueOnce({ toPromise: async () => createResult })
      .mockReturnValueOnce({ toPromise: async () => ({ error: { message: 'flaky' } }) })
      .mockReturnValue({ toPromise: async () => ({}) });
    ctx = { logger: createMockLogger(), graphqlClient: { mutation } } as unknown as BuildContext;

    const { handle } = await startSshSessionAsync(ctx, {
      workflowJobId: 'wj-1',
      relayServerUrl: 'wss://r',
    });
    await handle.ensureConnectedAsync();

    expect(host.redialAsync).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      turtleSshSessionId: 'ts-1',
      connectionConfig: config2,
    });
  });

  it('throws once the redial budget is exhausted', async () => {
    const host = makeHost({
      isAlive: jest.fn().mockReturnValue(false),
      redialAsync: jest.fn().mockRejectedValue(new Error('relay down')),
    });
    mockedStartUptermHost.mockResolvedValue(host);

    const { handle } = await startSshSessionAsync(ctx, {
      workflowJobId: 'wj-1',
      relayServerUrl: 'wss://r',
    });

    await expect(handle.ensureConnectedAsync()).rejects.toThrow(/after 5 attempts/);
    expect(host.redialAsync).toHaveBeenCalledTimes(5);
  });
});

describe(holdSshSessionUntilIdleAsync, () => {
  const logger = createMockLogger();

  it('checks the relay connection before releasing an idle hold', async () => {
    let ensureCalls = 0;
    await holdSshSessionUntilIdleAsync({
      ensureConnected: async () => {
        ensureCalls += 1;
      },
      getConnectedClientCount: async () => 0,
      idleTimeoutSeconds: 0,
      logger,
    });
    expect(ensureCalls).toBe(1);
  });

  it('logs each client connecting and disconnecting with the current count', async () => {
    const clientCounts = [1, 2, 1, 0];
    await holdSshSessionUntilIdleAsync({
      ensureConnected: async () => {},
      getConnectedClientCount: async () => clientCounts.shift() ?? 0,
      idleTimeoutSeconds: 0,
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith('An SSH client connected.');
    expect(logger.info).toHaveBeenCalledWith('An SSH client connected (2 connected).');
    expect(logger.info).toHaveBeenCalledWith('An SSH client disconnected (1 still connected).');
    expect(logger.info).toHaveBeenCalledWith('The SSH client disconnected.');
  });

  it('closes the session when the relay connection cannot be restored', async () => {
    let clientCountCalls = 0;
    await holdSshSessionUntilIdleAsync({
      ensureConnected: async () => {
        throw new SystemError('relay down');
      },
      getConnectedClientCount: async () => {
        clientCountCalls += 1;
        return 1;
      },
      idleTimeoutSeconds: 300,
      logger,
    });
    expect(clientCountCalls).toBe(0);
  });

  it('does not close while a client stays connected, even past the idle timeout', async () => {
    let polls = 0;
    await holdSshSessionUntilIdleAsync({
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
      logger,
    });
    expect(polls).toBeGreaterThan(3);
  });

  it('closes the session when the client count stays unknown past the idle timeout', async () => {
    let polls = 0;
    await holdSshSessionUntilIdleAsync({
      ensureConnected: async () => {},
      getConnectedClientCount: async () => {
        polls += 1;
        return null;
      },
      idleTimeoutSeconds: 0,
      logger,
    });
    expect(polls).toBe(1);
  });
});
