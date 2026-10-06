import { SystemError } from '@expo/eas-build-job';

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
