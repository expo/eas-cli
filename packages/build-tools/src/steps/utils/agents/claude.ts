import { UserError } from '@expo/eas-build-job';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  type AgentCli,
  type AgentInvocation,
  type AgentLogMessage,
  ContentBlocksSchema,
  MCP_SERVER_NAME,
  type McpServer,
  contentBlocksText,
  createContinuationPrompt,
  createProviderMismatchError,
  parseJsonLine,
  tolerantArray,
} from './agent';
import { type AgentRunProviderCredentials } from '../agentRunLease';

// The flags and the output format below are only known to hold for this version.
export const CLAUDE_CODE_CLI: AgentCli = {
  packageSpec: '@anthropic-ai/claude-code@2.1.291',
  bin: 'claude',
  formatOutputLine: formatClaudeCodeOutputLine,
  findFatalError: findUnconnectedMcpServersError,
};

export async function prepareClaudeCodeAsync({
  homeDirectory,
  minimalEnv,
  mcpServer,
  userMcpServers,
  prompt,
  credentials,
  isResuming,
}: {
  homeDirectory: string;
  minimalEnv: Record<string, string>;
  mcpServer: McpServer;
  userMcpServers: Record<string, McpServer>;
  prompt: string;
  credentials: AgentRunProviderCredentials;
  isResuming: boolean;
}): Promise<AgentInvocation> {
  if (credentials.provider !== 'anthropic') {
    throw createProviderMismatchError('Claude Code', credentials);
  }
  const mcpServers = { [MCP_SERVER_NAME]: mcpServer, ...userMcpServers };
  const mcpConfigPath = path.join(homeDirectory, 'mcp.json');
  await fs.writeFile(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: Object.fromEntries(
        Object.entries(mcpServers).map(([name, server]) => [name, { type: 'http', ...server }])
      ),
    }),
    { mode: 0o600 }
  );
  return {
    args: [
      '-p',
      ...(isResuming ? ['--continue'] : []),
      // Print mode requires `--verbose` for `stream-json`.
      ...['--output-format', 'stream-json', '--verbose'],
      // No built-in tools. Print mode denies any tool without an allow rule, so each MCP server
      // gets one.
      ...[
        '--tools',
        '',
        '--allowedTools',
        ...Object.keys(mcpServers).map(name => `mcp__${name}__*`),
      ],
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

function findUnconnectedMcpServersError(outputLine: string): Error | undefined {
  const event = ClaudeCodeEventSchema.safeParse(parseJsonLine(outputLine));
  if (!event.success || event.data.type !== 'system') {
    return undefined;
  }
  const unconnectedServers = event.data.mcp_servers.filter(
    server => server.name !== MCP_SERVER_NAME && server.status !== 'connected'
  );
  if (unconnectedServers.length === 0) {
    return undefined;
  }
  const unconnectedServersFormatted = unconnectedServers
    .map(server => `${server.name} (${server.status})`)
    .join(', ');
  return new UserError(
    'EAS_RUN_AGENT_MCP_SERVER_NOT_CONNECTED',
    `The agent could not connect to the following MCP servers: ${unconnectedServersFormatted}. Check each server's URL and headers for errors, then start the agent run again.`
  );
}

const AssistantBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
]);
const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  content: z.union([z.string(), ContentBlocksSchema]).default(''),
  is_error: z.boolean().optional(),
});
const ClaudeCodeEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('system'),
    subtype: z.literal('init'),
    mcp_servers: tolerantArray(z.object({ name: z.string(), status: z.string() })),
  }),
  z.object({
    type: z.literal('assistant'),
    message: z.object({ content: tolerantArray(AssistantBlockSchema) }),
  }),
  z.object({
    type: z.literal('user'),
    message: z.object({ content: tolerantArray(ToolResultBlockSchema) }),
  }),
  z.object({
    type: z.literal('result'),
    subtype: z.string(),
    is_error: z.boolean(),
    result: z.string().optional(),
    errors: z.array(z.string()).optional(),
  }),
]);

function formatClaudeCodeOutputLine(line: string): AgentLogMessage[] {
  const json = parseJsonLine(line);
  if (json === undefined) {
    return [{ level: 'info', message: line }];
  }
  const event = ClaudeCodeEventSchema.safeParse(json);
  if (!event.success) {
    return [];
  }
  switch (event.data.type) {
    case 'system':
      return event.data.mcp_servers.map(server =>
        server.status === 'connected'
          ? { level: 'info', message: `MCP server ${server.name} is connected.` }
          : {
              level: 'warn',
              message: `MCP server ${server.name} is not connected (${server.status}).`,
            }
      );
    case 'assistant':
      return event.data.message.content.map(block => {
        switch (block.type) {
          case 'text':
            return { level: 'info', message: `Agent: ${block.text}` };
          case 'tool_use':
            return {
              level: 'info',
              message: `Tool call: ${block.name} ${JSON.stringify(block.input)}`,
            };
        }
      });
    case 'user':
      return event.data.message.content.map(block => {
        const text =
          typeof block.content === 'string' ? block.content : contentBlocksText(block.content);
        return block.is_error
          ? { level: 'warn', message: `Tool error: ${text}` }
          : { level: 'info', message: `Tool result: ${text}` };
      });
    case 'result': {
      // `result` repeats the agent's last text block, so on success there is nothing to add.
      const { is_error, result, errors, subtype } = event.data;
      return is_error
        ? [
            {
              level: 'error',
              message: `Agent failed: ${result || errors?.join('\n') || subtype}`,
            },
          ]
        : [];
    }
  }
}
