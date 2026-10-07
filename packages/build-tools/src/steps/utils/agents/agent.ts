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

export function createProviderMismatchError(
  cliName: string,
  credentials: AgentRunProviderCredentials
): SystemError {
  return new SystemError(
    `The agent run uses ${cliName}, but Expo issued ${credentials.provider} credentials for it. This is a problem on our side; contact Expo support.`
  );
}
