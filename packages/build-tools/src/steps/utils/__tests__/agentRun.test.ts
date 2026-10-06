import { SystemError } from '@expo/eas-build-job';
import turtleSpawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { killProcessGroup } from '../../../utils/processes';
import { runAgentAsync } from '../agentRun';
import {
  type AgentRunProviderCredentials,
  leaseAgentRunProviderCredentialsAsync,
} from '../agentRunLease';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(),
}));
jest.mock('../agentRunLease');
jest.mock('../../../utils/processes', () => ({
  ...jest.requireActual('../../../utils/processes'),
  killProcessGroup: jest.fn(),
}));

const installMock = jest.mocked(turtleSpawn);
const spawnMock = jest.mocked(spawn);
const leaseMock = jest.mocked(leaseAgentRunProviderCredentialsAsync);
const killProcessGroupMock = jest.mocked(killProcessGroup);

const agentRunId = '0199b0a0-1111-7222-8333-444455556666';
const anthropicLease: AgentRunProviderCredentials = {
  provider: 'anthropic',
  accessToken: 'anthropic-access-token',
};
const openaiLease: AgentRunProviderCredentials = {
  provider: 'openai',
  idToken: 'openai-id-token',
  accessToken: 'openai-access-token',
  accountId: 'openai-account-id',
};

interface AgentInvocation {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  stdin: jest.Mock;
  child: EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  /** The run removes its files when it ends, so call this while the agent is running. */
  readHomeFile(relativePath: string): { content: string; mode: number };
  exit(status: number | null, signal?: NodeJS.Signals, options?: { closeOutput: boolean }): void;
  closeOutput(): void;
}

function mockSpawn({
  onAgent,
  onInstall,
}: {
  onAgent: (invocation: AgentInvocation) => void;
  onInstall?: () => void;
}): AgentInvocation[] {
  installMock.mockImplementation((() => {
    try {
      onInstall?.();
      return Promise.resolve({});
    } catch (error) {
      return Promise.reject(error);
    }
  }) as any);
  const invocations: AgentInvocation[] = [];
  spawnMock.mockImplementation(((command: string, args: string[], spawnOptions: any) => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdin: { on: jest.fn(), end: jest.fn() },
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    // Like a real child: `close` comes after everything it printed has been read.
    const closeOutput = (): void => {
      child.stdout.end();
      child.stderr.end();
      void Promise.all([once(child.stdout, 'end'), once(child.stderr, 'end')]).then(() =>
        child.emit('close')
      );
    };
    const invocation: AgentInvocation = {
      command,
      args,
      env: spawnOptions.env,
      cwd: spawnOptions.cwd,
      stdin: child.stdin.end,
      child,
      readHomeFile(relativePath) {
        const filePath = path.join(spawnOptions.env.HOME, relativePath);
        return {
          content: vol.readFileSync(filePath, 'utf8') as string,
          mode: vol.statSync(filePath).mode & 0o777,
        };
      },
      exit(status, signal, options = { closeOutput: true }) {
        process.nextTick(() => {
          child.emit('exit', status, signal ?? null);
          if (options.closeOutput) {
            closeOutput();
          }
        });
      },
      closeOutput,
    };
    invocations.push(invocation);
    onAgent(invocation);
    return child;
  }) as any);
  return invocations;
}

function runDirectories(): string[] {
  return (vol.readdirSync(os.tmpdir()) as string[]).filter(name =>
    name.startsWith('eas-agent-run-')
  );
}

function createOptions(
  overrides: Partial<Parameters<typeof runAgentAsync>[0]> = {}
): Parameters<typeof runAgentAsync>[0] {
  return {
    agentKind: 'claude-code',
    agentRunId,
    maxDurationSeconds: 60,
    prompt: 'Fix the failing test.',
    expoToken: 'expo-token',
    expoApiV2BaseUrl: 'https://staging-api.expo.test/v2/',
    mcpUrl: 'https://staging-mcp.expo.test/mcp',
    pathEnv: '/usr/local/bin:/usr/bin',
    npmRegistryUrl: 'https://npm-cache.expo.test',
    logger: createMockLogger(),
    ...overrides,
  };
}

describe(runAgentAsync, () => {
  afterEach(() => {
    jest.useRealTimers();
    expect(runDirectories()).toEqual([]);
  });

  it('runs Claude Code with MCP as its only tool source and an allowlisted environment', async () => {
    leaseMock.mockResolvedValue(anthropicLease);
    const invocations = mockSpawn({
      onAgent: agent => {
        const mcpConfig = agent.readHomeFile('mcp.json');
        expect(JSON.parse(mcpConfig.content)).toEqual({
          mcpServers: {
            expo: {
              type: 'http',
              url: 'https://staging-mcp.expo.test/mcp',
              headers: {
                Authorization: 'Bearer expo-token',
                'X-Expo-Agent-Run-Id': agentRunId,
              },
            },
          },
        });
        expect(mcpConfig.mode).toBe(0o600);
        agent.exit(0);
      },
    });

    await runAgentAsync(createOptions());

    expect(installMock.mock.calls[0].slice(0, 2)).toEqual([
      'npm',
      [
        'install',
        '--prefix',
        expect.stringMatching(/eas-agent-run-.*\/cli$/),
        '--no-save',
        '--package-lock=false',
        '--no-audit',
        '--no-fund',
        '--registry',
        'https://npm-cache.expo.test',
        '@anthropic-ai/claude-code@2.1.291',
      ],
    ]);
    expect(invocations).toHaveLength(1);
    const [agent] = invocations;
    const runDirectory = path.dirname(agent.env.HOME);
    expect(path.dirname(runDirectory)).toBe(os.tmpdir());
    expect(agent.command).toBe(path.join(runDirectory, 'cli', 'node_modules', '.bin', 'claude'));
    expect(agent.args).toEqual([
      '-p',
      '--session-id',
      expect.any(String),
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      '',
      '--allowedTools',
      'mcp__expo',
      '--mcp-config',
      path.join(agent.env.HOME, 'mcp.json'),
      '--strict-mcp-config',
    ]);
    expect(agent.env).toEqual({
      PATH: '/usr/local/bin:/usr/bin',
      HOME: path.join(runDirectory, 'home'),
      TMPDIR: path.join(runDirectory, 'tmp'),
      LANG: 'C.UTF-8',
      CLAUDE_CODE_OAUTH_TOKEN: 'anthropic-access-token',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    expect(agent.cwd).toBe(path.join(runDirectory, 'cwd'));
    expect(agent.stdin).toHaveBeenCalledWith('Fix the failing test.');
  });

  it('logs whole lines of agent output with the leased credentials masked', async () => {
    leaseMock.mockResolvedValue(anthropicLease);
    const logger = createMockLogger();
    mockSpawn({
      onAgent: agent => {
        // One JSON event split across two chunks, in the middle of the token.
        agent.child.stdout.write('{"token":"anthropic-acc');
        agent.child.stdout.write('ess-token"}\n{"next":1}\n');
        agent.child.stderr.write('warning: anthropic-access-token\n');
        agent.exit(0);
      },
    });

    await runAgentAsync(createOptions({ logger }));

    const child = jest.mocked(logger.child);
    expect(child.mock.calls).toEqual([[{ source: 'stdout' }], [{ source: 'stderr' }]]);
    const [stdoutLogger, stderrLogger] = child.mock.results.map(result => result.value);
    expect(stdoutLogger.info.mock.calls).toEqual([['{"token":"[redacted]"}'], ['{"next":1}']]);
    expect(stderrLogger.info.mock.calls).toEqual([['warning: [redacted]']]);
  });

  it('runs Codex with its shell tool off and the credentials in a private home', async () => {
    leaseMock.mockResolvedValue(openaiLease);
    const invocations = mockSpawn({
      onAgent: agent => {
        const config = agent.readHomeFile('.codex/config.toml');
        expect(config.content).toContain(
          '[features]\nshell_tool = false\nview_image = false\nimage_generation = false\napps = false\nplugins = false\n'
        );
        expect(config.content).toContain('sandbox_mode = "read-only"');
        expect(config.content).toContain('[agents]\nenabled = false\n');
        expect(config.content).toContain(
          [
            '[mcp_servers.expo]',
            'url = "http://localhost:8787/mcp"',
            'default_tools_approval_mode = "approve"',
            '',
            '[mcp_servers.expo.http_headers]',
            '"Authorization" = "Bearer expo-token"',
            `"X-Expo-Agent-Run-Id" = "${agentRunId}"`,
          ].join('\n')
        );
        expect(config.mode).toBe(0o600);
        const auth = agent.readHomeFile('.codex/auth.json');
        expect(JSON.parse(auth.content)).toEqual({
          auth_mode: 'chatgptAuthTokens',
          tokens: {
            id_token: 'openai-id-token',
            access_token: 'openai-access-token',
            refresh_token: '',
            account_id: 'openai-account-id',
          },
          last_refresh: expect.any(String),
        });
        expect(auth.mode).toBe(0o600);
        agent.exit(0);
      },
    });

    await runAgentAsync(
      createOptions({
        agentKind: 'codex',
        mcpUrl: 'http://localhost:8787/mcp',
        npmRegistryUrl: undefined,
      })
    );

    const npmArgs = installMock.mock.calls[0][1]!;
    expect(npmArgs).not.toContain('--registry');
    expect(npmArgs.at(-1)).toBe('@openai/codex@0.160.1');
    const [agent] = invocations;
    const runDirectory = path.dirname(agent.env.HOME);
    expect(agent.command).toBe(path.join(runDirectory, 'cli', 'node_modules', '.bin', 'codex'));
    expect(agent.args).toEqual(['exec', '--strict-config', '--json', '--skip-git-repo-check']);
    expect(agent.cwd).toBe(path.join(runDirectory, 'cwd'));
    expect(agent.env).toEqual({
      PATH: '/usr/local/bin:/usr/bin',
      HOME: path.join(runDirectory, 'home'),
      TMPDIR: path.join(runDirectory, 'tmp'),
      LANG: 'C.UTF-8',
    });
    expect(agent.stdin).toHaveBeenCalledWith('Fix the failing test.');
  });

  it('stops the agent at its maximum duration, which does not include the installation', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    leaseMock.mockResolvedValue(anthropicLease);
    let agentStarted!: () => void;
    const started = new Promise<void>(resolve => {
      agentStarted = resolve;
    });
    const invocations = mockSpawn({
      onInstall: () => jest.advanceTimersByTime(600_000),
      onAgent: () => agentStarted(),
    });

    const run = runAgentAsync(createOptions({ maxDurationSeconds: 60 }));
    const rejection = expect(run).rejects.toMatchObject({ errorCode: 'EAS_RUN_AGENT_TIMEOUT' });
    await started;
    const [agent] = invocations;

    await jest.advanceTimersByTimeAsync(59_000);
    expect(killProcessGroupMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(killProcessGroupMock.mock.calls).toEqual([[agent.child, 'SIGTERM']]);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(killProcessGroupMock.mock.calls).toEqual([
      [agent.child, 'SIGTERM'],
      [agent.child, 'SIGKILL'],
    ]);
    agent.exit(null, 'SIGKILL');

    await rejection;
    expect(leaseMock).toHaveBeenCalledTimes(1);
  });

  it('ends what the agent left running and waits a bounded time for its output', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    leaseMock.mockResolvedValue(anthropicLease);
    let agentStarted!: () => void;
    const started = new Promise<void>(resolve => {
      agentStarted = resolve;
    });
    const invocations = mockSpawn({ onAgent: () => agentStarted() });

    const run = runAgentAsync(createOptions({ maxDurationSeconds: 60 }));
    await started;
    await jest.advanceTimersByTimeAsync(59_000);
    invocations[0].exit(0, undefined, { closeOutput: false });
    // The deadline passes during the bounded wait for the output.
    await jest.advanceTimersByTimeAsync(5_000);

    await expect(run).resolves.toBeUndefined();
    expect(killProcessGroupMock.mock.calls).toEqual([[invocations[0].child, 'SIGKILL']]);
  });

  it('stops the agent when the step is aborted', async () => {
    leaseMock.mockResolvedValue(anthropicLease);
    const controller = new AbortController();
    const invocations = mockSpawn({
      onAgent: agent => {
        queueMicrotask(() => {
          controller.abort();
          agent.exit(null, 'SIGTERM');
        });
      },
    });

    await expect(runAgentAsync(createOptions({ signal: controller.signal }))).rejects.toMatchObject(
      { name: 'AbortError' }
    );

    expect(killProcessGroupMock.mock.calls).toEqual([
      [invocations[0].child, 'SIGTERM'],
      [invocations[0].child, 'SIGKILL'],
    ]);
    expect(leaseMock).toHaveBeenCalledTimes(1);
  });

  it('resumes Claude Code with new credentials when the lease changed during the run', async () => {
    const renewedLease: AgentRunProviderCredentials = {
      ...anthropicLease,
      accessToken: 'renewed-access-token',
    };
    leaseMock.mockResolvedValueOnce(anthropicLease).mockResolvedValueOnce(renewedLease);
    const invocations = mockSpawn({
      onAgent: agent => agent.exit(invocations.length === 1 ? 1 : 0),
    });

    await runAgentAsync(createOptions());

    expect(installMock).toHaveBeenCalledTimes(1);
    expect(invocations).toHaveLength(2);
    const [first, resumed] = invocations;
    const sessionId = first.args[2];
    expect(resumed.args).toEqual(['-p', '--resume', sessionId, ...first.args.slice(3)]);
    expect(resumed.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('renewed-access-token');
    expect(resumed.stdin).toHaveBeenCalledWith(
      expect.stringMatching(/^Your previous run of this task stopped.*\n\nFix the failing test\.$/s)
    );
  });

  it('resumes Codex with new credentials when the lease changed during the run', async () => {
    const renewedLease: AgentRunProviderCredentials = {
      ...openaiLease,
      accessToken: 'renewed-access-token',
      idToken: 'renewed-id-token',
    };
    leaseMock.mockResolvedValueOnce(openaiLease).mockResolvedValueOnce(renewedLease);
    const invocations = mockSpawn({
      onAgent: agent => {
        if (invocations.length === 1) {
          agent.exit(1);
          return;
        }
        expect(JSON.parse(agent.readHomeFile('.codex/auth.json').content).tokens).toMatchObject({
          id_token: 'renewed-id-token',
          access_token: 'renewed-access-token',
        });
        agent.exit(0);
      },
    });

    await runAgentAsync(createOptions({ agentKind: 'codex' }));

    expect(invocations).toHaveLength(2);
    expect(invocations[1].args).toEqual([
      'exec',
      '--strict-config',
      '--json',
      '--skip-git-repo-check',
      'resume',
      '--last',
      '-',
    ]);
    expect(invocations[1].stdin).toHaveBeenCalledWith(
      expect.stringContaining('\n\nFix the failing test.')
    );
    expect(invocations[1].cwd).toBe(invocations[0].cwd);
  });

  it('gives a resumed agent only the time that is left', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    leaseMock
      .mockResolvedValueOnce(anthropicLease)
      .mockResolvedValueOnce({ ...anthropicLease, accessToken: 'renewed-access-token' });
    const waiters: (() => void)[] = [];
    const nextAgentStarted = (): Promise<void> => new Promise(resolve => waiters.push(resolve));
    const invocations = mockSpawn({ onAgent: () => waiters.shift()?.() });

    const firstStarted = nextAgentStarted();
    const run = runAgentAsync(createOptions({ maxDurationSeconds: 60 }));
    const rejection = expect(run).rejects.toMatchObject({ errorCode: 'EAS_RUN_AGENT_TIMEOUT' });
    await firstStarted;
    await jest.advanceTimersByTimeAsync(40_000);
    const resumedStarted = nextAgentStarted();
    invocations[0].exit(1);
    await resumedStarted;
    const resumed = invocations[1];

    await jest.advanceTimersByTimeAsync(19_000);
    expect(killProcessGroupMock).not.toHaveBeenCalledWith(resumed.child, 'SIGTERM');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(killProcessGroupMock).toHaveBeenCalledWith(resumed.child, 'SIGTERM');
    resumed.exit(null, 'SIGTERM');

    await rejection;
  });

  it('does not resume an agent whose time ran out while its credentials were renewed', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    leaseMock.mockResolvedValueOnce(anthropicLease).mockImplementationOnce(async () => {
      jest.advanceTimersByTime(2_000);
      return { ...anthropicLease, accessToken: 'renewed-access-token' };
    });
    let agentStarted!: () => void;
    const started = new Promise<void>(resolve => {
      agentStarted = resolve;
    });
    const invocations = mockSpawn({ onAgent: () => agentStarted() });

    const run = runAgentAsync(createOptions({ maxDurationSeconds: 60 }));
    const rejection = expect(run).rejects.toMatchObject({ errorCode: 'EAS_RUN_AGENT_TIMEOUT' });
    await started;
    await jest.advanceTimersByTimeAsync(59_000);
    invocations[0].exit(1);

    await rejection;
    expect(invocations).toHaveLength(1);
  });

  it.each([
    [2, undefined, 'exited with code 2'],
    [null, 'SIGKILL' as const, 'was terminated by SIGKILL'],
  ])(
    'fails when the agent fails and the lease is unchanged (status %p, signal %p)',
    async (status, signal, description) => {
      leaseMock.mockResolvedValue(anthropicLease);
      const invocations = mockSpawn({ onAgent: agent => agent.exit(status, signal) });

      await expect(runAgentAsync(createOptions())).rejects.toMatchObject({
        errorCode: 'EAS_RUN_AGENT_FAILED',
        message: expect.stringContaining(description),
      });

      expect(invocations).toHaveLength(1);
      expect(leaseMock).toHaveBeenCalledTimes(2);
    }
  );

  it('fails with the lease error when the lease cannot be renewed after the agent failed', async () => {
    leaseMock
      .mockResolvedValueOnce(anthropicLease)
      .mockRejectedValueOnce(new Error('lease refused'));
    const invocations = mockSpawn({ onAgent: agent => agent.exit(1) });

    await expect(runAgentAsync(createOptions())).rejects.toThrow('lease refused');

    expect(invocations).toHaveLength(1);
  });

  it('reports an agent CLI that cannot start', async () => {
    leaseMock.mockResolvedValue(anthropicLease);
    mockSpawn({
      onAgent: agent => {
        process.nextTick(() => agent.child.emit('error', new Error('spawn claude ENOENT')));
      },
    });

    await expect(runAgentAsync(createOptions())).rejects.toThrow(
      'Could not start the agent CLI on the worker: spawn claude ENOENT.'
    );

    expect(leaseMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up when the installation fails', async () => {
    leaseMock.mockResolvedValue(anthropicLease);
    const invocations = mockSpawn({
      onInstall: () => {
        throw new Error('npm ERR! network');
      },
      onAgent: agent => agent.exit(0),
    });

    await expect(runAgentAsync(createOptions())).rejects.toBeInstanceOf(SystemError);

    expect(invocations).toHaveLength(0);
  });

  it('does not install or start anything when the lease is refused', async () => {
    leaseMock.mockRejectedValue(new Error('lease refused'));
    mockSpawn({ onAgent: agent => agent.exit(0) });

    await expect(runAgentAsync(createOptions())).rejects.toThrow('lease refused');

    expect(installMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('refuses credentials of the wrong provider', async () => {
    leaseMock.mockResolvedValue(openaiLease);
    const invocations = mockSpawn({ onAgent: agent => agent.exit(0) });

    await expect(runAgentAsync(createOptions({ agentKind: 'claude-code' }))).rejects.toBeInstanceOf(
      SystemError
    );

    expect(invocations).toHaveLength(0);
  });
});
