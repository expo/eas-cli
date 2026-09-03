import { errors } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import type { SpawnResult } from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentAuthLeaseClient } from './AgentAuthLeaseClient';
import {
  assertAgentExecutableVersionAsync,
  assertLeaseCoversInvocation,
  runBoundedAgentProcessAsync,
} from './processUtils';

export const CODEX_VERSION = '0.149.1';

const NON_REFRESHING_SENTINEL = 'eas-access-only-lease';

export class CodexExecRuntime {
  public constructor(
    private readonly leaseClient: AgentAuthLeaseClient,
    private readonly executable = 'codex'
  ) {}

  public async runAsync({
    args,
    cwd,
    env,
    logger,
    maximumInvocationSeconds,
    signal,
  }: {
    args: string[];
    cwd?: string;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
    maximumInvocationSeconds: number;
    signal?: AbortSignal;
  }): Promise<SpawnResult> {
    await assertAgentExecutableVersionAsync({
      executable: this.executable,
      expectedVersion: CODEX_VERSION,
      displayName: 'Codex CLI',
    });
    const lease = await this.leaseClient.getLeaseAsync({ reason: 'startup' }, signal);
    if (lease.provider !== 'openai') {
      throw new errors.UserError(
        'EAS_AGENT_PROVIDER_MISMATCH',
        'This agent job is bound to a different provider. Select a Codex connection and start a new job.'
      );
    }
    assertLeaseCoversInvocation(lease.expiresAt, maximumInvocationSeconds);

    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-codex-'));
    try {
      await fs.writeFile(
        path.join(codexHome, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          tokens: {
            id_token: lease.idToken,
            access_token: lease.accessToken,
            refresh_token: NON_REFRESHING_SENTINEL,
            account_id: lease.accountId,
          },
          last_refresh: new Date().toISOString(),
        }),
        { mode: 0o600 }
      );
      const processEnv: NodeJS.ProcessEnv = { ...env, CODEX_HOME: codexHome };
      delete processEnv.OPENAI_API_KEY;
      return await runBoundedAgentProcessAsync({
        command: this.executable,
        args,
        cwd,
        env: processEnv,
        logger,
        maximumInvocationSeconds,
        secrets: [lease.idToken, lease.accessToken],
        signal,
      });
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  }
}
