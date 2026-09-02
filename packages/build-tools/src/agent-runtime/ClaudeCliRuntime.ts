import { errors } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import type { SpawnResult } from '@expo/turtle-spawn';

import { AgentAuthLeaseClient } from './AgentAuthLeaseClient';
import {
  assertAgentExecutableVersionAsync,
  assertLeaseCoversInvocation,
  runBoundedAgentProcessAsync,
} from './processUtils';

export const CLAUDE_CODE_VERSION = '2.1.246';

export class ClaudeCliRuntime {
  public constructor(
    private readonly leaseClient: AgentAuthLeaseClient,
    private readonly executable = 'claude'
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
    if (args.includes('--bare')) {
      throw new errors.UserError(
        'EAS_AGENT_CLAUDE_BARE_UNSUPPORTED',
        'Claude Code --bare mode is not supported for EAS agent jobs. Remove --bare and start a new job.'
      );
    }
    await assertAgentExecutableVersionAsync({
      executable: this.executable,
      expectedVersion: CLAUDE_CODE_VERSION,
      displayName: 'Claude Code',
    });
    const lease = await this.leaseClient.getLeaseAsync({ reason: 'startup' }, signal);
    if (lease.provider !== 'anthropic') {
      throw new errors.UserError(
        'EAS_AGENT_PROVIDER_MISMATCH',
        'This agent job is bound to a different provider. Select a Claude connection and start a new job.'
      );
    }
    assertLeaseCoversInvocation(lease.expiresAt, maximumInvocationSeconds);

    const processEnv = { ...env };
    delete processEnv.ANTHROPIC_API_KEY;
    delete processEnv.ANTHROPIC_AUTH_TOKEN;
    processEnv.CLAUDE_CODE_OAUTH_TOKEN = lease.accessToken;
    return await runBoundedAgentProcessAsync({
      command: this.executable,
      args,
      cwd,
      env: processEnv,
      logger,
      maximumInvocationSeconds,
      secrets: [lease.accessToken],
      signal,
    });
  }
}
