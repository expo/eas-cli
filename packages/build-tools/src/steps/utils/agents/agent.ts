import { SystemError } from '@expo/eas-build-job';
import { z } from 'zod';

import { type AgentRunProviderCredentials } from '../agentRunLease';

export const MCP_SERVER_NAME = 'expo';

export interface McpServer {
  url: string;
  headers: Record<string, string>;
}

export interface AgentInvocation {
  args: string[];
  env: Record<string, string>;
  stdin: string;
  secrets: string[];
}

export type AgentEvent =
  | { type: 'message'; text: string }
  | { type: 'tool_call'; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; text: string; isError: boolean }
  | { type: 'error'; message: string };

export interface AgentLogMessage {
  level: 'info' | 'warn' | 'error';
  message: string;
  agentEvent?: AgentEvent;
}

export interface AgentCli {
  packageSpec: string;
  bin: string;
  formatOutputLine(line: string): AgentLogMessage[];
}

export function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export function tolerantArray<Element extends z.ZodType>(element: Element) {
  // `.catch(undefined)` turns an element the schema rejects into `undefined`.
  return z
    .array(element.optional().catch(undefined))
    .transform(elements =>
      elements.filter((parsed): parsed is z.output<Element> => parsed !== undefined)
    );
}

/** The text of a list of content blocks, as both the Anthropic API and MCP shape them. */
export const ContentBlocksTextSchema = tolerantArray(
  z.object({ type: z.literal('text'), text: z.string() })
).transform(blocks => blocks.map(block => block.text).join('\n'));

// Repeats the task because Codex's `resume --last` starts a new session when none was saved,
// and that session would otherwise have no task.
export function createContinuationPrompt(prompt: string): string {
  return `Your previous run of this task stopped before it was finished. Continue it from where it stopped; do not start over. The task was:\n\n${prompt}`;
}

export function createProviderMismatchError(
  cliName: string,
  credentials: AgentRunProviderCredentials
): SystemError {
  return new SystemError(
    `The agent run uses ${cliName}, but Expo issued ${credentials.provider} credentials for it. This is a problem on our side; contact Expo support.`
  );
}
