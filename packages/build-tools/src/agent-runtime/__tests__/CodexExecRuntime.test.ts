import type { bunyan } from '@expo/logger';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentAuthLeaseClient } from '../AgentAuthLeaseClient';
import { CodexExecRuntime } from '../CodexExecRuntime';
import { runBoundedAgentProcessAsync } from '../processUtils';

jest.mock('../processUtils', () => ({
  ...jest.requireActual('../processUtils'),
  assertAgentExecutableVersionAsync: jest.fn(async () => {}),
  runBoundedAgentProcessAsync: jest.fn(),
}));

describe(CodexExecRuntime, () => {
  it('uses a private access-only auth file and removes the isolated Codex home', async () => {
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => ({
        provider: 'openai' as const,
        idToken: 'id-token',
        accessToken: 'access-token',
        accountId: 'account-id',
        plan: 'pro',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        accessTokenFingerprint: 'f'.repeat(43),
      })),
    } as unknown as AgentAuthLeaseClient;
    let codexHome: string | undefined;
    jest.mocked(runBoundedAgentProcessAsync).mockImplementation(async ({ env }) => {
      codexHome = env.CODEX_HOME;
      expect(codexHome).toBeDefined();
      const authPath = path.join(codexHome!, 'auth.json');
      expect((await fs.stat(authPath)).mode & 0o777).toBe(0o600);
      const auth = JSON.parse(await fs.readFile(authPath, 'utf8'));
      expect(auth).toMatchObject({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'eas-access-only-lease',
          account_id: 'account-id',
        },
      });
      expect(JSON.stringify(auth)).not.toContain('canonical-refresh-token');
      return { stdout: '', stderr: '' } as any;
    });
    const runtime = new CodexExecRuntime(leaseClient, '/bin/codex');

    await runtime.runAsync({
      args: ['exec', 'Fix the tests'],
      env: { OPENAI_API_KEY: 'api-key', PATH: '/bin' },
      logger: {} as bunyan,
      maximumInvocationSeconds: 300,
    });

    expect(runBoundedAgentProcessAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/bin/codex',
        args: ['exec', 'Fix the tests'],
        env: expect.objectContaining({ PATH: '/bin', CODEX_HOME: expect.any(String) }),
        secrets: ['id-token', 'access-token'],
      })
    );
    expect(jest.mocked(runBoundedAgentProcessAsync).mock.calls[0][0].env.OPENAI_API_KEY).toBe(
      undefined
    );
    await expect(fs.stat(codexHome!)).rejects.toThrow();
  });
});
