import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';

import { getExpoWebsiteBaseUrl } from '../api';
import fetch, { RequestError } from '../fetch';
import Log from '../log';
import { ora } from '../ora';

/**
 * The Expo dashboard AI chat lives in a Next.js API route on the website (`/api/chat`), not on the
 * GraphQL API server. It authenticates by reading the session secret from a cookie named after the
 * website's auth storage key and forwarding it to the GraphQL API as the `expo-session` header
 * (see `getAuthStorageKey` / `createServerGraphQLClient` in the website). We mirror that cookie name
 * here so the CLI's stored session secret authenticates exactly like a browser session would.
 */
function getWebsiteAuthCookieName(): string {
  if (process.env.EXPO_STAGING) {
    return 'staging.expo.auth.sessionSecret';
  } else if (process.env.EXPO_LOCAL) {
    return 'local.expo.auth.sessionSecret';
  } else {
    return 'io.expo.auth.sessionSecret';
  }
}

/**
 * Human-readable labels for the assistant's tools, shown while it works so the terminal user has
 * the same transparency the dashboard gives with its structured tables.
 */
const TOOL_LABELS: Record<string, string> = {
  get_projects: 'Looking up your projects',
  get_latest_builds: 'Looking up builds',
  get_build: 'Looking up a build',
  get_build_logs: 'Reading build logs',
  get_activity: 'Looking up recent activity',
  get_updates: 'Looking up updates',
  get_workflow_runs: 'Looking up workflow runs',
  get_workflow_run: 'Looking up a workflow run',
  get_workflow_run_logs: 'Reading workflow logs',
  get_submissions: 'Looking up submissions',
  get_channels: 'Looking up channels',
  get_branches: 'Looking up branches',
  get_worker_deployments: 'Looking up deployments',
  get_environment_variables: 'Looking up environment variables',
  get_account_members: 'Looking up account members',
  get_usage: 'Looking up usage',
  get_usage_history: 'Looking up usage history',
  get_invoices: 'Looking up invoices',
  search_expo_docs: 'Searching Expo docs',
  navigate: 'Finding the right page',
};

function describeTool(toolName: string): string {
  return TOOL_LABELS[toolName] ?? `Using ${toolName.replace(/_/g, ' ')}`;
}

type UIMessageStreamFrame = {
  type: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** A single turn in the conversation, in the AI SDK `UIMessage` shape the endpoint expects. */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: { type: 'text'; text: string }[];
};

export function makeUserMessage(text: string): ChatMessage {
  return { id: uuidv4(), role: 'user', parts: [{ type: 'text', text }] };
}

export function makeAssistantMessage(text: string): ChatMessage {
  return { id: uuidv4(), role: 'assistant', parts: [{ type: 'text', text }] };
}

export type ChatToolCall = {
  toolName: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type ChatResult = {
  /** The assistant's full text answer (may be empty when it only returned tool data). */
  text: string;
  /** Tools the assistant invoked, in call order, with their inputs and outputs. */
  toolCalls: ChatToolCall[];
};

/**
 * Sends the conversation so far to the dashboard AI chat endpoint and returns the assistant's reply.
 * The full `messages` history is sent every turn (the endpoint is stateless for model context), so
 * the caller appends each assistant reply and follow-up before calling again.
 *
 * When `stream` is true, the assistant's text is written to stdout incrementally and tool calls are
 * surfaced as brief status lines. When false (e.g. `--json` mode), nothing is written to stdout and
 * the full result is returned for the caller to serialize.
 */
export async function streamChatResponseAsync({
  messages,
  accountName,
  sessionSecret,
  stream,
}: {
  messages: ChatMessage[];
  accountName: string | undefined;
  sessionSecret: string;
  stream: boolean;
}): Promise<ChatResult> {
  let response;
  try {
    response = await fetch(`${getExpoWebsiteBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: `${getWebsiteAuthCookieName()}=${encodeURIComponent(sessionSecret)}`,
        ...(accountName ? { 'x-account-name': accountName } : {}),
      },
      body: JSON.stringify({ messages }),
    });
  } catch (error) {
    throw toFriendlyChatError(error);
  }

  if (!response.body) {
    throw new Error('The chat service returned an empty response.');
  }

  const spinner = stream ? ora('Thinking…').start() : undefined;
  const toolCallsById = new Map<string, ChatToolCall>();
  const announcedTools = new Set<string>();
  let fullText = '';
  let streamingText = false;
  let errorText: string | undefined;
  let buffer = '';

  const announceTool = (toolName: string): void => {
    if (!stream || announcedTools.has(toolName)) {
      return;
    }
    announcedTools.add(toolName);
    const label = describeTool(toolName);
    if (streamingText) {
      process.stdout.write(chalk.dim(`\n(${label})\n`));
    } else if (spinner) {
      spinner.text = `${label}…`;
    }
  };

  const handleFrame = (frame: UIMessageStreamFrame): void => {
    switch (frame.type) {
      case 'text-delta': {
        const delta = typeof frame.delta === 'string' ? frame.delta : '';
        if (!delta) {
          return;
        }
        fullText += delta;
        if (stream) {
          if (!streamingText) {
            spinner?.stop();
            streamingText = true;
          }
          process.stdout.write(delta);
        }
        break;
      }
      case 'tool-input-start':
      case 'tool-input-available': {
        const { toolCallId, toolName } = frame;
        if (!toolCallId || !toolName) {
          return;
        }
        const existing = toolCallsById.get(toolCallId);
        toolCallsById.set(toolCallId, {
          toolName,
          input: frame.input ?? existing?.input,
          output: existing?.output,
          errorText: existing?.errorText,
        });
        announceTool(toolName);
        break;
      }
      case 'tool-output-available': {
        const { toolCallId } = frame;
        if (!toolCallId) {
          return;
        }
        const existing = toolCallsById.get(toolCallId);
        if (existing) {
          existing.output = frame.output;
        }
        break;
      }
      case 'tool-output-error': {
        const { toolCallId } = frame;
        if (toolCallId && toolCallsById.has(toolCallId) && typeof frame.errorText === 'string') {
          toolCallsById.get(toolCallId)!.errorText = frame.errorText;
        }
        break;
      }
      case 'error': {
        if (typeof frame.errorText === 'string') {
          errorText = frame.errorText;
        }
        break;
      }
    }
  };

  try {
    for await (const chunk of response.body) {
      buffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice('data:'.length).trim();
        if (!data || data === '[DONE]') {
          continue;
        }
        let frame: UIMessageStreamFrame;
        try {
          frame = JSON.parse(data);
        } catch {
          continue;
        }
        handleFrame(frame);
      }
    }
  } finally {
    if (spinner?.isSpinning) {
      spinner.stop();
    }
  }

  if (errorText) {
    throw new Error(errorText);
  }

  const toolCalls = [...toolCallsById.values()];

  if (stream) {
    if (fullText.length > 0) {
      Log.newLine();
    } else {
      Log.log(
        chalk.dim(
          toolCalls.length > 0
            ? 'The assistant looked up your data but did not return a text response. Try asking a more specific question.'
            : 'The assistant did not return a response.'
        )
      );
    }
  }

  return { text: fullText, toolCalls };
}

function toFriendlyChatError(error: unknown): Error {
  if (error instanceof RequestError) {
    const status = error.response.status;
    if (status === 401) {
      return new Error('Your Expo session is not valid for chat. Run `eas login` and try again.');
    }
    if (status === 403) {
      return new Error(
        'Chat is not enabled for this account yet. It is still rolling out. If you think you should have access, reach out to Expo.'
      );
    }
    if (status === 429) {
      return new Error(
        'You have reached your chat usage limit. Try again later or upgrade your plan for a larger allowance.'
      );
    }
    return new Error(`The chat request failed (HTTP ${status}).`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
