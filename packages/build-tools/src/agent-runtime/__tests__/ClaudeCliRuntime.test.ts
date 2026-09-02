import type { bunyan } from '@expo/logger';

import type { AgentAuthLeaseClient } from '../AgentAuthLeaseClient';
import { ClaudeCliRuntime } from '../ClaudeCliRuntime';
import { runBoundedAgentProcessAsync } from '../processUtils';

jest.mock('../processUtils', () => ({
  ...jest.requireActual('../processUtils'),
  assertAgentExecutableVersionAsync: jest.fn(async () => {}),
  runBoundedAgentProcessAsync: jest.fn(async () => ({ stdout: '', stderr: '' })),
}));

describe(ClaudeCliRuntime, () => {
  it('runs Claude with an access token only and keeps resume arguments', async () => {
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => ({
        provider: 'anthropic' as const,
        accessToken: 'claude-access-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new ClaudeCliRuntime(leaseClient, '/bin/claude');

    await runtime.runAsync({
      args: ['--resume', 'session-id', '-p', 'Continue'],
      env: {
        ANTHROPIC_API_KEY: 'api-key',
        ANTHROPIC_AUTH_TOKEN: 'auth-token',
        PATH: '/bin',
      },
      logger: {} as bunyan,
      maximumInvocationSeconds: 300,
    });

    expect(runBoundedAgentProcessAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/bin/claude',
        args: ['--resume', 'session-id', '-p', 'Continue'],
        env: {
          PATH: '/bin',
          CLAUDE_CODE_OAUTH_TOKEN: 'claude-access-token',
        },
        secrets: ['claude-access-token'],
      })
    );
  });

  it('rejects bare mode before requesting a lease', async () => {
    const leaseClient = { getLeaseAsync: jest.fn() } as unknown as AgentAuthLeaseClient;
    const runtime = new ClaudeCliRuntime(leaseClient);

    await expect(
      runtime.runAsync({
        args: ['--bare'],
        env: {},
        logger: {} as bunyan,
        maximumInvocationSeconds: 300,
      })
    ).rejects.toThrow('--bare mode is not supported');
    expect(leaseClient.getLeaseAsync).not.toHaveBeenCalled();
  });
});
