import type { bunyan } from '@expo/logger';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';

import type { AgentAuthLeaseClient } from '../AgentAuthLeaseClient';
import { CodexAppServerRuntime } from '../CodexAppServerRuntime';

jest.mock('../processUtils', () => ({
  ...jest.requireActual('../processUtils'),
  assertAgentExecutableVersionAsync: jest.fn(async () => {}),
}));

function openAILease(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    provider: 'openai' as const,
    idToken: 'id-token',
    accessToken: 'access-token',
    accountId: 'account-id',
    plan: 'pro',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    accessTokenFingerprint: 'f'.repeat(43),
    ...overrides,
  };
}

function createFakeAppServer(
  respond: (message: Record<string, any>) => {
    result?: unknown;
    notifications?: Record<string, unknown>[];
  } = () => ({ result: {} })
): {
  child: ChildProcessWithoutNullStreams;
  messages: Array<Record<string, any>>;
  stdout: PassThrough;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: jest.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
  const messages: Array<Record<string, any>> = [];
  child.stdin.on('data', chunk => {
    for (const line of chunk.toString().trim().split('\n')) {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.id !== undefined) {
        const response = respond(message);
        stdout.write(`${JSON.stringify({ id: message.id, result: response.result ?? {} })}\n`);
        for (const notification of response.notifications ?? []) {
          stdout.write(`${JSON.stringify(notification)}\n`);
        }
      }
    }
  });
  return { child, messages, stdout };
}

describe(CodexAppServerRuntime, () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes experimental external auth without persisting auth.json', async () => {
    const { child, messages } = createFakeAppServer();
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => openAILease()),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );

    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    expect(messages[0]).toMatchObject({
      method: 'initialize',
      params: { capabilities: { experimentalApi: true } },
    });
    expect(messages[1]).toEqual({ method: 'initialized' });
    expect(messages[2]).toMatchObject({
      method: 'account/login/start',
      params: {
        type: 'chatgptAuthTokens',
        accessToken: 'access-token',
        chatgptAccountId: 'account-id',
        chatgptPlanType: 'pro',
      },
    });
    const codexHome = (runtime as any).spawnProcess.mock.calls[0][2].env.CODEX_HOME;
    await expect(fs.stat(`${codexHome}/auth.json`)).rejects.toThrow();

    await session.stopAsync();
    await expect(fs.stat(codexHome)).rejects.toThrow();
  });

  it('runs a thread and resolves after its matching turn completes', async () => {
    const { child, messages } = createFakeAppServer(message => {
      switch (message.method) {
        case 'thread/start':
          return { result: { thread: { id: 'thread-1' } } };
        case 'turn/start':
          return {
            result: { turn: { id: 'turn-1' } },
            notifications: [
              {
                method: 'item/completed',
                params: {
                  threadId: 'thread-1',
                  turnId: 'turn-1',
                  item: { type: 'agentMessage', text: 'Finished task' },
                },
              },
              {
                method: 'turn/completed',
                params: {
                  threadId: 'thread-other',
                  turn: { id: 'turn-1', status: 'completed', items: [] },
                },
              },
              {
                method: 'turn/completed',
                params: {
                  threadId: 'thread-1',
                  turn: { id: 'turn-1', status: 'completed', items: [] },
                },
              },
            ],
          };
        default:
          return { result: {} };
      }
    });
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => openAILease()),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    const thread = await session.startThreadAsync({ cwd: '/working-directory' });
    const result = await session.runTurnAsync({
      threadId: thread.id,
      prompt: 'Do the task',
      maximumInvocationSeconds: 60,
    });

    expect(messages).toContainEqual(
      expect.objectContaining({
        method: 'thread/start',
        params: {
          cwd: '/working-directory',
          approvalPolicy: 'never',
          sandbox: 'workspace-write',
        },
      })
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        method: 'turn/start',
        params: {
          threadId: 'thread-1',
          input: [{ type: 'text', text: 'Do the task', textElements: [] }],
        },
      })
    );
    expect(result).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      finalResponse: 'Finished task',
    });
    await session.stopAsync();
  });

  it('rejects a failed turn without exposing its raw payload', async () => {
    const { child } = createFakeAppServer(message => {
      if (message.method === 'turn/start') {
        return {
          result: { turn: { id: 'turn-1' } },
          notifications: [
            {
              method: 'turn/completed',
              params: {
                threadId: 'thread-1',
                turn: {
                  id: 'turn-1',
                  status: 'failed',
                  error: { additionalDetails: 'secret provider response' },
                },
              },
            },
          ],
        };
      }
      return { result: {} };
    });
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => openAILease()),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    await expect(
      session.runTurnAsync({
        threadId: 'thread-1',
        prompt: 'Do the task',
        maximumInvocationSeconds: 60,
      })
    ).rejects.toThrow('Codex could not complete the agent turn.');
    await session.stopAsync();
  });

  it('interrupts a turn that exceeds its invocation limit', async () => {
    jest.useFakeTimers();
    const { child, messages } = createFakeAppServer(message => {
      if (message.method === 'turn/start') {
        return { result: { turn: { id: 'turn-1' } } };
      }
      return { result: {} };
    });
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => openAILease()),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    const turn = session.runTurnAsync({
      threadId: 'thread-1',
      prompt: 'Do the task',
      maximumInvocationSeconds: 1,
    });
    const turnExpectation = expect(turn).rejects.toThrow('exceeded the job time limit');
    await jest.advanceTimersByTimeAsync(1_000);

    await turnExpectation;
    expect(messages).toContainEqual(
      expect.objectContaining({
        method: 'turn/interrupt',
        params: { threadId: 'thread-1', turnId: 'turn-1' },
      })
    );
    (child as any).exitCode = 0;
    await session.stopAsync();
  });

  it('answers an unauthorized refresh with a new access-only lease', async () => {
    const { child, messages, stdout } = createFakeAppServer();
    const leaseClient = {
      getLeaseAsync: jest
        .fn()
        .mockResolvedValueOnce(openAILease())
        .mockResolvedValueOnce(
          openAILease({
            accessToken: 'new-access-token',
            accessTokenFingerprint: 'n'.repeat(43),
          })
        ),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    stdout.write(
      `${JSON.stringify({
        id: 77,
        method: 'account/chatgptAuthTokens/refresh',
        params: { reason: 'unauthorized', previousAccountId: 'account-id' },
      })}\n`
    );
    await new Promise(resolve => setImmediate(resolve));

    expect(leaseClient.getLeaseAsync).toHaveBeenLastCalledWith(
      { reason: 'unauthorized', previousAccessTokenFingerprint: 'f'.repeat(43) },
      expect.any(AbortSignal)
    );
    expect(messages).toContainEqual({
      id: 77,
      result: {
        accessToken: 'new-access-token',
        chatgptAccountId: 'account-id',
        chatgptPlanType: 'pro',
      },
    });
    expect(JSON.stringify(messages)).not.toContain('id-token');

    await session.stopAsync();
  });

  it('coalesces simultaneous unauthorized refresh requests', async () => {
    const { child, messages, stdout } = createFakeAppServer();
    let resolveRefresh!: (lease: ReturnType<typeof openAILease>) => void;
    const refresh = new Promise<ReturnType<typeof openAILease>>(resolve => {
      resolveRefresh = resolve;
    });
    const leaseClient = {
      getLeaseAsync: jest.fn().mockResolvedValueOnce(openAILease()).mockReturnValueOnce(refresh),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    for (const id of [80, 81]) {
      stdout.write(
        `${JSON.stringify({
          id,
          method: 'account/chatgptAuthTokens/refresh',
          params: { reason: 'unauthorized', previousAccountId: 'account-id' },
        })}\n`
      );
    }
    await new Promise(resolve => setImmediate(resolve));
    resolveRefresh(
      openAILease({ accessToken: 'new-access-token', accessTokenFingerprint: 'n'.repeat(43) })
    );
    await new Promise(resolve => setImmediate(resolve));

    expect(leaseClient.getLeaseAsync).toHaveBeenCalledTimes(2);
    expect(messages.filter(message => message.id === 80 || message.id === 81)).toHaveLength(2);
    await session.stopAsync();
  });

  it('aborts an in-flight refresh when the job is cancelled', async () => {
    const { child, stdout } = createFakeAppServer();
    let refreshSignal: AbortSignal | undefined;
    const leaseClient = {
      getLeaseAsync: jest
        .fn()
        .mockResolvedValueOnce(openAILease())
        .mockImplementationOnce((_request, signal) => {
          refreshSignal = signal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const cancellationController = new AbortController();
    const session = await runtime.startAsync({
      env: {},
      logger: { warn: jest.fn() } as any,
      signal: cancellationController.signal,
    });
    stdout.write(
      `${JSON.stringify({
        id: 82,
        method: 'account/chatgptAuthTokens/refresh',
        params: { reason: 'unauthorized', previousAccountId: 'account-id' },
      })}\n`
    );
    await new Promise(resolve => setImmediate(resolve));

    cancellationController.abort();
    await new Promise(resolve => setImmediate(resolve));

    expect(refreshSignal?.aborted).toBe(true);
    await session.stopAsync();
  });

  it('answers unsupported host requests and stops the session', async () => {
    const { child, messages, stdout } = createFakeAppServer();
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => openAILease()),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    stdout.write(`${JSON.stringify({ id: 90, method: 'item/tool/requestUserInput' })}\n`);
    await new Promise(resolve => setImmediate(resolve));

    expect(messages).toContainEqual({
      id: 90,
      error: { code: -32601, message: 'This EAS agent runtime does not support the request.' },
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await session.stopAsync();
  });

  it('rejects an identity change during refresh', async () => {
    const { child, messages, stdout } = createFakeAppServer();
    const leaseClient = {
      getLeaseAsync: jest
        .fn()
        .mockResolvedValueOnce(openAILease())
        .mockResolvedValueOnce(openAILease({ accountId: 'other-account-id' })),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    stdout.write(
      `${JSON.stringify({
        id: 78,
        method: 'account/chatgptAuthTokens/refresh',
        params: { reason: 'unauthorized', previousAccountId: 'account-id' },
      })}\n`
    );
    await new Promise(resolve => setImmediate(resolve));

    expect(messages).toContainEqual({
      id: 78,
      error: { code: -32000, message: 'EAS could not refresh provider access.' },
    });
    await session.stopAsync();
  });

  it('replaces the external token before it expires', async () => {
    jest.useFakeTimers();
    const { child, messages } = createFakeAppServer();
    const leaseClient = {
      getLeaseAsync: jest
        .fn()
        .mockResolvedValueOnce(
          openAILease({ expiresAt: new Date(Date.now() + 61 * 1000).toISOString() })
        )
        .mockResolvedValueOnce(
          openAILease({
            accessToken: 'proactive-access-token',
            accessTokenFingerprint: 'p'.repeat(43),
          })
        ),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const session = await runtime.startAsync({ env: {}, logger: { warn: jest.fn() } as any });

    await jest.advanceTimersByTimeAsync(1_100);

    expect(leaseClient.getLeaseAsync).toHaveBeenLastCalledWith(
      { reason: 'proactive' },
      expect.any(AbortSignal)
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        method: 'account/login/start',
        params: expect.objectContaining({ accessToken: 'proactive-access-token' }),
      })
    );
    await session.stopAsync();
  });

  it('stops the app-server when the job is cancelled', async () => {
    const { child } = createFakeAppServer();
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => openAILease()),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(
      leaseClient,
      '/bin/codex',
      jest.fn(() => child) as any
    );
    const cancellationController = new AbortController();
    const session = await runtime.startAsync({
      env: {},
      logger: { warn: jest.fn() } as any,
      signal: cancellationController.signal,
    });

    cancellationController.abort();
    await new Promise(resolve => setImmediate(resolve));

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await session.stopAsync();
  });
});
