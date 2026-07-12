import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';

import { getExpoWebsiteBaseUrl } from '../api';
import fetch, { RequestError } from '../fetch';
import Log from '../log';
import { ora } from '../ora';
import {
  MarkdownRenderState,
  createMarkdownRenderState,
  renderMarkdownLine,
  wrapToWidth,
} from './renderMarkdown';

/**
 * Client-side steering sent as a leading system message on every request. The server owns the base
 * system prompt (which we cannot change), so this only adds guidance that is specific to running in
 * a terminal instead of the web dashboard.
 */
const CHAT_SYSTEM_GUIDANCE = [
  'You are being used through the EAS CLI in a terminal, not the web dashboard.',
  'The user cannot see the interactive tables the dashboard renders from tool results, so include the important details directly in your text answer instead of assuming a table is shown.',
  'Whenever you reference a specific artifact (a build, update, submission, deployment, workflow run, channel, or branch), include its direct https://expo.dev link so the user can open it.',
  'Use only simple markdown: bold, inline code, and bullet or numbered lists.',
].join(' ');

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

// The assistant's reply is labeled "Expo > " and continuation lines are indented to align under it,
// mirroring the "Chat > " prompt the user types into.
const ASSISTANT_LABEL_TEXT = 'Expo';
const ASSISTANT_LABEL = `${chalk.bold.magenta(ASSISTANT_LABEL_TEXT)}${chalk.dim(' > ')}`;
const ASSISTANT_INDENT = ' '.repeat(`${ASSISTANT_LABEL_TEXT} > `.length);

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
  role: 'system' | 'user' | 'assistant';
  parts: { type: 'text'; text: string }[];
};

function makeSystemMessage(text: string): ChatMessage {
  return { id: uuidv4(), role: 'system', parts: [{ type: 'text', text }] };
}

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
      body: JSON.stringify({ messages: [makeSystemMessage(CHAT_SYSTEM_GUIDANCE), ...messages] }),
    });
  } catch (error) {
    throw toFriendlyChatError(error);
  }

  if (!response.body) {
    throw new Error('The chat service returned an empty response.');
  }

  // discardStdin: false so the spinner does not pause stdin, which the interactive readline prompt
  // relies on staying open between turns. indent aligns the spinner (and tool status) with the
  // "Expo > " reply body.
  const spinner = stream
    ? ora({ text: 'Thinking…', discardStdin: false, indent: ASSISTANT_INDENT.length }).start()
    : undefined;

  // ora leaves the cursor at its indent column after clearing on stop (its clear() ends with
  // cursorTo(indent)), which would push the reply right by the indent. Reset to the line start.
  const stopSpinner = (): void => {
    if (!spinner) {
      return;
    }
    spinner.stop();
    if (process.stdout.isTTY) {
      process.stdout.write('\r');
    }
  };
  const toolCallsById = new Map<string, ChatToolCall>();
  const announcedTools = new Set<string>();
  const markdownState: MarkdownRenderState = createMarkdownRenderState();
  let fullText = '';
  let streamingText = false;
  let errorText: string | undefined;
  let buffer = '';
  let displayBuffer = '';
  let wroteAssistantLine = false;

  // Prefixes the first written line with the "Expo > " label and every following line with a matching
  // indent, so the whole reply lines up under the label. Long lines are wrapped to the terminal
  // width (minus the indent) so terminal soft-wrapping does not drop wrapped text back to column 0.
  const writeAssistantLine = (rendered: string, withNewline: boolean): void => {
    const columns = process.stdout.columns ?? 0;
    const width = columns > 0 ? columns - ASSISTANT_INDENT.length : 0;
    const segments = wrapToWidth(rendered, width);
    segments.forEach((segment, index) => {
      const prefix = wroteAssistantLine ? ASSISTANT_INDENT : ASSISTANT_LABEL;
      wroteAssistantLine = true;
      const isLastSegment = index === segments.length - 1;
      const needsNewline = !isLastSegment || withNewline;
      process.stdout.write(`${prefix}${segment}${needsNewline ? '\n' : ''}`);
    });
  };

  // Render markdown one completed line at a time: the assistant streams token by token, but markdown
  // markers (e.g. **bold**) can span several tokens, so we can only style a line once it is whole.
  const flushDisplayLines = (flushRemainder: boolean): void => {
    let newlineIndex: number;
    while ((newlineIndex = displayBuffer.indexOf('\n')) !== -1) {
      const rawLine = displayBuffer.slice(0, newlineIndex);
      displayBuffer = displayBuffer.slice(newlineIndex + 1);
      const rendered = renderMarkdownLine(rawLine, markdownState);
      if (rendered !== null) {
        writeAssistantLine(rendered, true);
      }
    }
    if (flushRemainder && displayBuffer.length > 0) {
      const rendered = renderMarkdownLine(displayBuffer, markdownState);
      displayBuffer = '';
      if (rendered !== null) {
        writeAssistantLine(rendered, false);
      }
    }
  };

  const announceTool = (toolName: string): void => {
    if (!stream || announcedTools.has(toolName)) {
      return;
    }
    announcedTools.add(toolName);
    const label = describeTool(toolName);
    if (streamingText) {
      flushDisplayLines(true);
      process.stdout.write(chalk.dim(`\n${ASSISTANT_INDENT}(${label})\n`));
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
            stopSpinner();
            streamingText = true;
          }
          displayBuffer += delta;
          flushDisplayLines(false);
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
    stopSpinner();
    if (stream) {
      flushDisplayLines(true);
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
