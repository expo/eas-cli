import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type AgentInvocation,
  MCP_SERVER_NAME,
  type McpServer,
  createContinuationPrompt,
  createProviderMismatchError,
} from './agent';
import { type AgentRunProviderCredentials } from '../agentRunLease';

// The flags and settings below are only known to hold for this version.
export const CODEX_CLI = { packageSpec: '@openai/codex@0.160.1', bin: 'codex' };

export async function prepareCodexAsync({
  homeDirectory,
  minimalEnv,
  mcpServer,
  prompt,
  credentials,
  isResuming,
}: {
  homeDirectory: string;
  minimalEnv: Record<string, string>;
  mcpServer: McpServer;
  prompt: string;
  credentials: AgentRunProviderCredentials;
  isResuming: boolean;
}): Promise<AgentInvocation> {
  if (credentials.provider !== 'openai') {
    throw createProviderMismatchError('Codex', credentials);
  }
  const codexHomeDirectory = path.join(homeDirectory, '.codex');
  await fs.mkdir(codexHomeDirectory, { recursive: true });
  await fs.writeFile(
    path.join(codexHomeDirectory, 'config.toml'),
    [
      'approval_policy = "never"',
      // Codex always offers `apply_patch`.
      'sandbox_mode = "read-only"',
      'web_search = "disabled"',
      'check_for_update_on_startup = false',
      '',
      '[features]',
      'shell_tool = false',
      'view_image = false',
      'image_generation = false',
      // Apps and plugins installed on the credential owner's ChatGPT account.
      'apps = false',
      'plugins = false',
      '',
      // A subagent's session could otherwise be the one `resume --last` picks.
      '[agents]',
      'enabled = false',
      '',
      '[analytics]',
      'enabled = false',
      '',
      `[mcp_servers.${MCP_SERVER_NAME}]`,
      // JSON strings are valid TOML basic strings.
      `url = ${JSON.stringify(mcpServer.url)}`,
      // `approval_policy` would otherwise refuse the server's tools that are not read-only.
      'default_tools_approval_mode = "approve"',
      '',
      `[mcp_servers.${MCP_SERVER_NAME}.http_headers]`,
      ...Object.entries(mcpServer.headers).map(
        ([name, value]) => `${JSON.stringify(name)} = ${JSON.stringify(value)}`
      ),
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  await fs.writeFile(
    path.join(codexHomeDirectory, 'auth.json'),
    JSON.stringify({
      auth_mode: 'chatgptAuthTokens',
      tokens: {
        id_token: credentials.idToken,
        access_token: credentials.accessToken,
        // www keeps the refresh token.
        refresh_token: '',
        account_id: credentials.accountId,
      },
      // Codex sends no bearer token unless this is set.
      last_refresh: new Date().toISOString(),
    }),
    { mode: 0o600 }
  );
  return {
    args: [
      'exec',
      // Without it Codex skips settings it does not know, leaving on whatever they turn off.
      '--strict-config',
      ...['--json', '--skip-git-repo-check'],
      ...(isResuming ? ['resume', '--last', '-'] : []),
    ],
    env: minimalEnv,
    stdin: isResuming ? createContinuationPrompt(prompt) : prompt,
    secrets: [credentials.accessToken, credentials.idToken],
  };
}
