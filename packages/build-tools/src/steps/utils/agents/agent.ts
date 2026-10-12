import { type AgentRunEvent, type AgentRunEventContent, SystemError } from '@expo/eas-build-job';
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

export interface AgentLogMessage {
  level: 'info' | 'warn' | 'error';
  message: string;
  agentEvent?: Pick<AgentRunEvent, 'producer' | 'content'>;
}

export interface AgentContentLogMessage {
  level: AgentLogMessage['level'];
  message: string;
  content?: AgentRunEventContent;
}

const AgentCliEventSchema = z.object({ type: z.string() }).passthrough();

/** Keep one structured record per CLI event alongside its readable log messages. */
export function formatAgentOutputLine(
  line: string,
  producer: AgentRunEvent['producer'],
  formatEvent: (data: Record<string, unknown>) => AgentContentLogMessage[]
): AgentLogMessage[] {
  const json = parseJsonLine(line);
  if (json === undefined) {
    return [{ level: 'info', message: line }];
  }
  const event = AgentCliEventSchema.safeParse(json);
  if (!event.success) {
    return [];
  }
  const messages = formatEvent(event.data);
  const content = messages.flatMap(message => (message.content ? [message.content] : []));
  const logs: AgentLogMessage[] = messages.length
    ? messages.map(({ level, message }) => ({ level, message }))
    : [{ level: 'info', message: `Agent event: ${event.data.type}` }];
  logs[0].agentEvent = { producer, content };
  return logs;
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

/** The text blocks of a content list, as both the Anthropic API and MCP shape them. */
export const ContentBlocksSchema = tolerantArray(
  z.object({ type: z.literal('text'), text: z.string() })
);

export function contentBlocksText(blocks: z.output<typeof ContentBlocksSchema>): string {
  return blocks.map(block => block.text).join('\n');
}

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
