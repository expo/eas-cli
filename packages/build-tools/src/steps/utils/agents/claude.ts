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

// The flags below are only known to hold for this version.
export const CLAUDE_CODE_CLI = { packageSpec: '@anthropic-ai/claude-code@2.1.291', bin: 'claude' };

export async function prepareClaudeCodeAsync({
  homeDirectory,
  minimalEnv,
  mcpServer,
  sessionId,
  prompt,
  credentials,
  isResuming,
}: {
  homeDirectory: string;
  minimalEnv: Record<string, string>;
  mcpServer: McpServer;
  sessionId: string;
  prompt: string;
  credentials: AgentRunProviderCredentials;
  isResuming: boolean;
}): Promise<AgentInvocation> {
  if (credentials.provider !== 'anthropic') {
    throw createProviderMismatchError('Claude Code', credentials);
  }
  const mcpConfigPath = path.join(homeDirectory, 'mcp.json');
  await fs.writeFile(
    mcpConfigPath,
    JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: 'http', ...mcpServer } } }),
    { mode: 0o600 }
  );
  return {
    args: [
      '-p',
      ...(isResuming ? ['--resume', sessionId] : ['--session-id', sessionId]),
      // Print mode requires `--verbose` for `stream-json`.
      ...['--output-format', 'stream-json', '--verbose'],
      // No built-in tools. Print mode denies any tool without an allow rule, so the MCP server
      // gets one.
      ...['--tools', '', '--allowedTools', `mcp__${MCP_SERVER_NAME}`],
      ...['--mcp-config', mcpConfigPath, '--strict-mcp-config'],
    ],
    env: {
      ...minimalEnv,
      CLAUDE_CODE_OAUTH_TOKEN: credentials.accessToken,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    stdin: isResuming ? createContinuationPrompt(prompt) : prompt,
    secrets: [credentials.accessToken],
  };
}
