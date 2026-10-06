import { SystemError } from '@expo/eas-build-job';
import turtleSpawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { leaseAgentRunProviderCredentialsAsync } from '../../utils/agentRunLease';
import { createRunAgentBuildFunction } from '../runAgent';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(),
}));
jest.mock('../../utils/agentRunLease');

const installMock = jest.mocked(turtleSpawn);
const spawnMock = jest.mocked(spawn);
const leaseMock = jest.mocked(leaseAgentRunProviderCredentialsAsync);

const ctx = {
  expoApiV2BaseUrl: 'https://staging-api.expo.test/v2/',
  mcpServerUrl: 'wss://staging-mcp.expo.test',
} as any;
const inputs = {
  agent_kind: { value: 'claude-code' },
  agent_run_id: { value: '0199b0a0-1111-7222-8333-444455556666' },
  max_duration_seconds: { value: 1800 },
  prompt: { value: 'Fix the failing test.' },
};
const env = {
  PATH: '/usr/local/bin:/usr/bin',
  HOME: '/home/expo',
  EXPO_TOKEN: 'expo-token',
  __API_SERVER_URL: 'https://staging-api.expo.test',
  EAS_BUILD_ID: 'build-id',
  NODE_OPTIONS: '--max-old-space-size=3072',
  USER_DEFINED_SECRET: 'secret',
};

async function runAsync(
  overrides: {
    ctx?: any;
    inputs?: Record<string, { value: unknown }>;
    env?: Record<string, string>;
  } = {}
): Promise<void> {
  const fn = createRunAgentBuildFunction(overrides.ctx ?? ctx);
  await fn.fn!({ logger: createMockLogger() } as any, {
    inputs: overrides.inputs ?? inputs,
    outputs: {},
    env: overrides.env ?? env,
  });
}

function mockSuccessfulRun(): { mcpConfig?: any } {
  const captured: { mcpConfig?: any } = {};
  leaseMock.mockResolvedValue({ provider: 'anthropic', accessToken: 'anthropic-access-token' });
  installMock.mockResolvedValue({} as any);
  spawnMock.mockImplementation(((_command: string, _args: string[], spawnOptions: any) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: { on: jest.fn(), end: jest.fn() },
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    captured.mcpConfig = JSON.parse(
      vol.readFileSync(path.join(spawnOptions.env.HOME, 'mcp.json'), 'utf8') as string
    );
    process.nextTick(() => {
      child.emit('exit', 0, null);
      child.stdout.end();
      child.stderr.end();
      void Promise.all([once(child.stdout, 'end'), once(child.stderr, 'end')]).then(() =>
        child.emit('close')
      );
    });
    return child;
  }) as any);
  return captured;
}

describe(createRunAgentBuildFunction, () => {
  it('is the eas/run_agent function', () => {
    expect(createRunAgentBuildFunction(ctx).getFullId()).toBe('eas/run_agent');
  });

  it('passes none of the job environment to npm or the agent', async () => {
    mockSuccessfulRun();

    await runAsync();

    expect(leaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expoApiV2BaseUrl: 'https://staging-api.expo.test/v2/',
        expoToken: 'expo-token',
        agentRunId: '0199b0a0-1111-7222-8333-444455556666',
      })
    );
    const npmEnv = installMock.mock.calls[0][2]!.env!;
    const agentEnv = spawnMock.mock.calls[0][2].env!;
    expect(Object.keys(npmEnv).sort()).toEqual(['HOME', 'LANG', 'PATH', 'TMPDIR']);
    expect(Object.keys(agentEnv).sort()).toEqual([
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'HOME',
      'LANG',
      'PATH',
      'TMPDIR',
    ]);
    expect(agentEnv.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(agentEnv.HOME).not.toBe('/home/expo');
  });

  it.each([
    ['wss://staging-mcp.expo.test', 'https://staging-mcp.expo.test/mcp'],
    ['ws://localhost:8787', 'http://localhost:8787/mcp'],
  ])('points the agent at the HTTP endpoint of %s', async (mcpServerUrl, mcpUrl) => {
    const captured = mockSuccessfulRun();

    await runAsync({ ctx: { ...ctx, mcpServerUrl } });

    expect(captured.mcpConfig.mcpServers.expo.url).toBe(mcpUrl);
  });

  it.each([
    ['an unknown agent_kind', { inputs: { ...inputs, agent_kind: { value: 'gemini' } } }],
    ['a malformed agent_run_id', { inputs: { ...inputs, agent_run_id: { value: 'not-a-uuid' } } }],
    ['an empty agent_run_id', { inputs: { ...inputs, agent_run_id: { value: '' } } }],
    ['a zero duration', { inputs: { ...inputs, max_duration_seconds: { value: 0 } } }],
    ['a negative duration', { inputs: { ...inputs, max_duration_seconds: { value: -300 } } }],
    ['a fractional duration', { inputs: { ...inputs, max_duration_seconds: { value: 12.5 } } }],
    ['an empty prompt', { inputs: { ...inputs, prompt: { value: '' } } }],
    ['no EXPO_TOKEN', { env: { ...env, EXPO_TOKEN: '' } }],
    ['no PATH', { env: { ...env, PATH: '' } }],
    ['no Expo API URL', { ctx: { ...ctx, expoApiV2BaseUrl: undefined } }],
    ['no MCP server URL', { ctx: { ...ctx, mcpServerUrl: undefined } }],
  ])('throws a system error for %s', async (_name, overrides) => {
    await expect(runAsync(overrides)).rejects.toBeInstanceOf(SystemError);

    expect(leaseMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports every invalid input at once', async () => {
    await expect(
      runAsync({
        inputs: {
          ...inputs,
          agent_run_id: { value: 'not-a-uuid' },
          max_duration_seconds: { value: 0 },
        },
      })
    ).rejects.toThrow(
      'The "agent_run_id" input must be the UUID of an agent run, but received "not-a-uuid". ' +
        'The "max_duration_seconds" input must be a positive whole number of seconds, but received "0".'
    );
  });
});
