import { SystemError, UserError } from '@expo/eas-build-job';
import { Client, fetchExchange } from '@urql/core';

import * as sandboxDaemon from '../../utils/sandboxDaemon';
import * as sandboxGitCredentials from '../../utils/sandboxGitCredentials';

import { createStartSandboxBuildFunction, markSandboxReadyAsync } from '../startSandbox';

describe('sandbox build functions', () => {
  let configureGitCredentials: jest.SpyInstance;

  beforeEach(() => {
    configureGitCredentials = jest
      .spyOn(sandboxGitCredentials, 'configureSandboxGitCredentialsAsync')
      .mockImplementation(async ({ env }) => env);
  });

  afterEach(() => {
    configureGitCredentials.mockRestore();
  });

  it.each([
    { completion: 'duration', duration: 0.02 },
    { completion: 'cancellation', duration: 60 },
    { completion: 'duration', duration: 0.0001 },
  ])(
    'stops after $completion with $duration seconds only after readiness',
    async ({ completion, duration }) => {
      const controller = new AbortController();
      let ready!: () => void;
      const stopAsync = jest.fn(async () => {});
      const start = jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync').mockResolvedValue({
        ready: new Promise<void>(resolve => {
          ready = resolve;
        }),
        stopAsync,
      });
      const mutation = jest.fn(() => ({ toPromise: async () => ({ data: {} }) }));
      const logger = { info: jest.fn(), child: jest.fn() };
      logger.child.mockReturnValue(logger);
      const fn = createStartSandboxBuildFunction({
        mcpServerUrl: 'ws://localhost:8787',
        graphqlClient: { mutation },
      } as any);
      try {
        const pending = fn.fn!({ logger } as any, {
          inputs: {
            sandbox_id: { value: 'sandbox-id' },
            max_duration_seconds: { value: duration },
          },
          outputs: {},
          env: { __EAS_SANDBOX_MCP_TOKEN: 'token' },
          signal: controller.signal,
        });
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(mutation).not.toHaveBeenCalled();
        expect(stopAsync).not.toHaveBeenCalled();
        ready();
        if (completion === 'cancellation') {
          await new Promise(resolve => setImmediate(resolve));
          expect(stopAsync).not.toHaveBeenCalled();
          controller.abort();
        }
        await pending;
        expect(mutation).toHaveBeenCalledTimes(1);
        expect(stopAsync).toHaveBeenCalledTimes(1);
        const timeoutMessage = `Sandbox reached its maximum runtime of ${duration} seconds. Stopping.`;
        if (completion === 'duration') {
          expect(logger.info).toHaveBeenCalledWith(timeoutMessage);
        } else {
          expect(logger.info).not.toHaveBeenCalledWith(timeoutMessage);
        }
      } finally {
        start.mockRestore();
      }
    }
  );

  it.each([0, -1, Infinity, NaN])(
    'rejects invalid maximum duration %s before starting the daemon',
    async duration => {
      const start = jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync');
      const fn = createStartSandboxBuildFunction({
        mcpServerUrl: 'ws://localhost:8787',
      } as any);
      try {
        const result = fn.fn!({} as any, {
          inputs: {
            sandbox_id: { value: 'sandbox-id' },
            max_duration_seconds: { value: duration },
          },
          outputs: {},
          env: { __EAS_SANDBOX_MCP_TOKEN: 'token' },
        });
        await expect(result).rejects.toBeInstanceOf(UserError);
        await expect(result).rejects.toThrow(
          `Invalid sandbox maximum duration: ${duration}. Provide a finite number greater than zero, or omit max_duration_seconds.`
        );
        expect(start).not.toHaveBeenCalled();
      } finally {
        start.mockRestore();
      }
    }
  );

  it('aborts an active ready request and keeps its authentication headers', async () => {
    const controller = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>(resolve => {
      requestStarted = resolve;
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token');
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
        requestStarted();
      });
    });
    const graphqlClient = new Client({
      url: 'https://api.expo.test/graphql',
      exchanges: [fetchExchange],
      fetchOptions: { headers: { Authorization: 'Bearer test-token' } },
    });
    try {
      const pending = markSandboxReadyAsync(
        { graphqlClient } as any,
        'sandbox-id',
        controller.signal
      );
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await started;
      controller.abort();
      await rejected;
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('does not mark the sandbox ready if startup was canceled', async () => {
    const controller = new AbortController();
    const stopAsync = jest.fn(async () => {});
    const start = jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockImplementation(async options => {
        expect(options.signal).toBe(controller.signal);
        controller.abort();
        return { ready: Promise.resolve(), stopAsync };
      });
    const mutation = jest.fn();
    const fn = createStartSandboxBuildFunction({
      env: { __EAS_SANDBOX_MCP_TOKEN: 'token' },
      mcpServerUrl: 'ws://localhost:8787',
      graphqlClient: { mutation },
    } as any);
    try {
      await expect(
        fn.fn!({ logger: {} } as any, {
          inputs: { sandbox_id: { value: 'sandbox-id' } },
          outputs: {},
          env: { __EAS_SANDBOX_MCP_TOKEN: 'token' },
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(mutation).not.toHaveBeenCalled();
      expect(stopAsync).toHaveBeenCalledTimes(1);
    } finally {
      start.mockRestore();
    }
  });
  it('excludes the MCP token from the command environment', async () => {
    const env = {
      PREPARED_BY_EARLIER_STEP: 'value',
      EXPO_TOKEN: 'expo-token',
      __EAS_SANDBOX_MCP_TOKEN: 'token',
    };
    const startupError = new Error('stop after checking options');
    const start = jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockRejectedValue(startupError);
    const fn = createStartSandboxBuildFunction({
      env: { __EAS_SANDBOX_MCP_TOKEN: 'token' },
      mcpServerUrl: 'ws://localhost:8787',
    } as any);
    try {
      await expect(
        fn.fn!({ logger: {} } as any, {
          inputs: { sandbox_id: { value: 'sandbox-id' } },
          outputs: {},
          env,
        })
      ).rejects.toBe(startupError);
      expect(start.mock.calls[0][0]).toMatchObject({ credential: 'token' });
      expect(start.mock.calls[0][0].env).toEqual({
        PREPARED_BY_EARLIER_STEP: 'value',
        EXPO_TOKEN: 'expo-token',
      });
      expect(env.__EAS_SANDBOX_MCP_TOKEN).toBe('token');
    } finally {
      start.mockRestore();
    }
  });

  it('hands the daemon the git credential environment', async () => {
    const gitEnv = { PREPARED_BY_EARLIER_STEP: 'value', GIT_TERMINAL_PROMPT: '0' };
    configureGitCredentials.mockResolvedValue(gitEnv);
    const stopAsync = jest.fn(async () => {});
    const start = jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockResolvedValue({ ready: Promise.resolve(), stopAsync });
    const mutation = jest.fn(() => ({ toPromise: async () => ({ data: {} }) }));
    const logger = { info: jest.fn(), child: jest.fn() };
    logger.child.mockReturnValue(logger);
    const ctx = { mcpServerUrl: 'ws://localhost:8787', graphqlClient: { mutation } };
    const fn = createStartSandboxBuildFunction(ctx as any);
    const stepCtx = { logger, workingDirectory: '/work' };
    const signal = new AbortController().signal;
    try {
      await fn.fn!(stepCtx as any, {
        inputs: {
          sandbox_id: { value: 'sandbox-id' },
          max_duration_seconds: { value: 0.001 },
        },
        outputs: {},
        env: { PREPARED_BY_EARLIER_STEP: 'value', __EAS_SANDBOX_MCP_TOKEN: 'token' },
        signal,
      });
      expect(configureGitCredentials).toHaveBeenCalledWith({
        stepCtx,
        env: { PREPARED_BY_EARLIER_STEP: 'value' },
        signal,
      });
      expect(start.mock.calls[0][0].env).toBe(gitEnv);
      expect(stopAsync).toHaveBeenCalledTimes(1);
    } finally {
      start.mockRestore();
    }
  });

  it('throws a system error when the sandbox token is missing', async () => {
    const fn = createStartSandboxBuildFunction({
      job: {},
      env: {},
      mcpServerUrl: 'ws://localhost:8787',
    } as any);

    await expect(
      fn.fn!({} as any, {
        inputs: { sandbox_id: { value: 'sandbox-id' } },
        outputs: {},
        env: {},
      })
    ).rejects.toBeInstanceOf(SystemError);
  });

  it('throws a system error when the MCP server URL is missing', async () => {
    const fn = createStartSandboxBuildFunction({
      job: {},
      env: { __EAS_SANDBOX_MCP_TOKEN: 'sandbox-token' },
    } as any);

    await expect(
      fn.fn!({} as any, {
        inputs: { sandbox_id: { value: 'sandbox-id' } },
        outputs: {},
        env: { __EAS_SANDBOX_MCP_TOKEN: 'sandbox-token' },
      })
    ).rejects.toThrow('MCP server URL is required to start the sandbox daemon.');
  });

  it('marks the sandbox as ready', async () => {
    const mutation = jest.fn(() => ({
      toPromise: async () => ({ data: { sandbox: { markSandboxReady: { id: 'sandbox-id' } } } }),
    }));

    await markSandboxReadyAsync({ graphqlClient: { mutation } } as any, 'sandbox-id');

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      { sandboxId: 'sandbox-id' },
      undefined
    );
  });

  it('throws a system error when marking the sandbox as ready fails', async () => {
    const mutation = jest.fn(() => ({
      toPromise: async () => ({ error: new Error('request failed') }),
    }));

    await expect(
      markSandboxReadyAsync({ graphqlClient: { mutation } } as any, 'sandbox-id')
    ).rejects.toThrow('Failed to mark sandbox sandbox-id as ready.');
  });
});
