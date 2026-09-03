import type { bunyan } from '@expo/logger';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentAuthLeaseClient } from '../AgentAuthLeaseClient';
import { CLAUDE_CODE_VERSION } from '../ClaudeCliRuntime';
import { CodexAppServerRuntime } from '../CodexAppServerRuntime';
import { CODEX_VERSION } from '../CodexExecRuntime';

const execFileAsync = promisify(execFile);
const contractTest = process.env.EAS_AGENT_RUNTIME_CONTRACT_TESTS === '1' ? test : test.skip;

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

describe('pinned agent runtime contracts', () => {
  contractTest('Claude Code accepts an access token without saved credentials', async () => {
    const result = await execFileAsync('claude', ['auth', 'status', '--json'], {
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: 'contract-test-access-token',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
      },
      timeout: 10_000,
    });
    const status = JSON.parse(result.stdout);

    expect(status).toMatchObject({
      loggedIn: true,
      authMethod: 'oauth_token',
      apiProvider: 'firstParty',
    });
    expect(await executableVersionAsync('claude')).toContain(CLAUDE_CODE_VERSION);
  });

  contractTest('Codex app-server accepts experimental external ChatGPT auth', async () => {
    const leaseClient = {
      getLeaseAsync: jest.fn(async () => ({
        provider: 'openai' as const,
        idToken: 'contract-test-id-token',
        accessToken: fakeJwt(),
        accountId: 'contract-test-account',
        plan: 'pro',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        accessTokenFingerprint: 'f'.repeat(43),
      })),
    } as unknown as AgentAuthLeaseClient;
    const runtime = new CodexAppServerRuntime(leaseClient);

    const session = await runtime.startAsync({
      env: process.env,
      logger: { warn: jest.fn() } as unknown as bunyan,
    });

    await session.stopAsync();
    expect(await executableVersionAsync('codex')).toContain(CODEX_VERSION);
  });
});

async function executableVersionAsync(executable: string): Promise<string> {
  const result = await execFileAsync(executable, ['--version'], { timeout: 10_000 });
  return `${result.stdout}${result.stderr}`;
}

function fakeJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: 'contract-test', exp: Math.floor(Date.now() / 1000) + 600 })
  ).toString('base64url');
  return `${header}.${payload}.contract-test-signature`;
}
