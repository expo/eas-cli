import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  type AgentCli,
  type AgentInvocation,
  type AgentLogMessage,
  ContentBlocksTextSchema,
  MCP_SERVER_NAME,
  type McpServer,
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
};

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

const AssistantBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string().optional(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
]);
const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().optional(),
  content: z.union([z.string(), ContentBlocksTextSchema]).default(''),
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
      return event.data.mcp_servers
        .filter(server => server.status !== 'connected')
        .map(server => ({
          level: 'warn',
          message: `MCP server ${server.name} is not connected (${server.status}).`,
          agentEvent: {
            type: 'error',
            message: `MCP server ${server.name} is not connected (${server.status}).`,
          },
        }));
    case 'assistant':
      return event.data.message.content.map(block => {
        switch (block.type) {
          case 'text':
            return {
              level: 'info',
              message: `Agent: ${block.text}`,
              agentEvent: { type: 'message', text: block.text },
            };
          case 'tool_use':
            return {
              level: 'info',
              message: `Tool call: ${block.name} ${JSON.stringify(block.input)}`,
              agentEvent: block.id
                ? { type: 'tool_call', callId: block.id, name: block.name, arguments: block.input }
                : undefined,
            };
        }
      });
    case 'user':
      return event.data.message.content.map(block => ({
        level: block.is_error ? 'warn' : 'info',
        message: `${block.is_error ? 'Tool error' : 'Tool result'}: ${block.content}`,
        agentEvent: block.tool_use_id
          ? {
              type: 'tool_result',
              callId: block.tool_use_id,
              text: block.content,
              isError: !!block.is_error,
            }
          : undefined,
      }));
    case 'result': {
      // `result` repeats the agent's last text block, so on success there is nothing to add.
      const { is_error, result, errors, subtype } = event.data;
      return is_error
        ? [
            {
              level: 'error',
              message: `Agent failed: ${(result ?? errors?.join('\n')) || subtype}`,
              agentEvent: { type: 'error', message: (result ?? errors?.join('\n')) || subtype },
            },
          ]
        : [];
    }
  }
}
