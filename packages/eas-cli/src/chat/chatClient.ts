import { StringDecoder } from 'node:string_decoder';

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

const CHAT_SYSTEM_GUIDANCE = [
  'You are being used through the EAS CLI in a terminal, not the web dashboard.',
  'The user cannot see the interactive tables the dashboard renders from tool results, so include the important details directly in your text answer instead of assuming a table is shown.',
  'Whenever you reference a specific artifact (a build, update, submission, deployment, workflow run, channel, or branch), include its direct https://expo.dev link so the user can open it.',
  'Use only simple markdown: bold, inline code, and bullet or numbered lists.',
].join(' ');

function getWebsiteAuthCookieName(): string {
  if (process.env.EXPO_STAGING) {
    return 'staging.expo.auth.sessionSecret';
  } else if (process.env.EXPO_LOCAL) {
    return 'local.expo.auth.sessionSecret';
  } else {
    return 'io.expo.auth.sessionSecret';
  }
}

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

const ASSISTANT_LABEL_TEXT = 'Expo';
const ASSISTANT_LABEL = `${chalk.bold.magenta(ASSISTANT_LABEL_TEXT)}${chalk.dim(' > ')}`;
const ASSISTANT_INDENT = ' '.repeat(`${ASSISTANT_LABEL_TEXT} > `.length);
const ASSISTANT_SPINNER_PREFIX = `${chalk.bold.magenta(ASSISTANT_LABEL_TEXT)}${chalk.dim(' >')}`;

type UIMessageStreamFrame = {
  type: string;
  id?: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'step-start' }
  | {
      type: `tool-${string}`;
      toolCallId: string;
      state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
      input: unknown;
      output?: unknown;
      errorText?: string;
    };

export type ChatMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: ChatMessagePart[];
};

function makeSystemMessage(text: string): ChatMessage {
  return { id: uuidv4(), role: 'system', parts: [{ type: 'text', text }] };
}

export function makeUserMessage(text: string): ChatMessage {
  return { id: uuidv4(), role: 'user', parts: [{ type: 'text', text }] };
}

function makeAssistantMessage(parts: ChatMessagePart[]): ChatMessage {
  return { id: uuidv4(), role: 'assistant', parts };
}

export type ChatToolCall = {
  toolName: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type ChatResult = {
  text: string;
  toolCalls: ChatToolCall[];
  assistantMessage: ChatMessage;
};

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

  const spinner = stream
    ? ora({ text: 'Thinking…', discardStdin: false, prefixText: ASSISTANT_SPINNER_PREFIX }).start()
    : undefined;

  let spinnerStopped = false;
  const stopSpinner = (): void => {
    if (!spinner || spinnerStopped) {
      return;
    }
    spinnerStopped = true;
    spinner.stop();
    if (process.stdout.isTTY) {
      process.stdout.write('\r');
    }
  };
  const toolCallsById = new Map<string, ChatToolCall>();
  const toolMessagePartsById = new Map<string, Extract<ChatMessagePart, { toolCallId: string }>>();
  const textMessagePartsById = new Map<string, Extract<ChatMessagePart, { type: 'text' }>>();
  const assistantMessageParts: ChatMessagePart[] = [];
  const announcedTools = new Set<string>();
  const markdownState: MarkdownRenderState = createMarkdownRenderState();
  let fullText = '';
  let streamingText = false;
  let errorText: string | undefined;
  let buffer = '';
  let displayBuffer = '';
  let wroteAssistantLine = false;
  let currentTextMessagePart: Extract<ChatMessagePart, { type: 'text' }> | undefined;

  const getOrCreateToolMessagePart = (
    toolCallId: string,
    toolName: string
  ): Extract<ChatMessagePart, { toolCallId: string }> => {
    const existing = toolMessagePartsById.get(toolCallId);
    if (existing) {
      return existing;
    }
    const part: Extract<ChatMessagePart, { toolCallId: string }> = {
      type: `tool-${toolName}`,
      toolCallId,
      state: 'input-streaming',
      input: undefined,
    };
    toolMessagePartsById.set(toolCallId, part);
    assistantMessageParts.push(part);
    return part;
  };

  const getOrCreateTextMessagePart = (
    id: string | undefined
  ): Extract<ChatMessagePart, { type: 'text' }> => {
    const existing = id ? textMessagePartsById.get(id) : currentTextMessagePart;
    if (existing) {
      return existing;
    }
    const part: Extract<ChatMessagePart, { type: 'text' }> = { type: 'text', text: '' };
    if (id) {
      textMessagePartsById.set(id, part);
    }
    currentTextMessagePart = part;
    assistantMessageParts.push(part);
    return part;
  };

  const writeAssistantLine = (rendered: string, withNewline: boolean): void => {
    if (!streamingText) {
      stopSpinner();
      streamingText = true;
    }
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
      case 'start-step': {
        assistantMessageParts.push({ type: 'step-start' });
        currentTextMessagePart = undefined;
        break;
      }
      case 'text-start': {
        currentTextMessagePart = getOrCreateTextMessagePart(frame.id);
        break;
      }
      case 'text-delta': {
        const delta = typeof frame.delta === 'string' ? frame.delta : '';
        if (!delta) {
          return;
        }
        fullText += delta;
        getOrCreateTextMessagePart(frame.id).text += delta;
        if (stream) {
          displayBuffer += delta;
          flushDisplayLines(false);
        }
        break;
      }
      case 'text-end': {
        currentTextMessagePart = undefined;
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
        const toolPart = getOrCreateToolMessagePart(toolCallId, toolName);
        if (frame.type === 'tool-input-available') {
          toolPart.state = 'input-available';
          toolPart.input = frame.input;
          delete toolPart.output;
          delete toolPart.errorText;
        }
        announceTool(toolName);
        break;
      }
      case 'tool-input-error': {
        const { toolCallId, toolName } = frame;
        if (!toolCallId || !toolName || typeof frame.errorText !== 'string') {
          return;
        }
        toolCallsById.set(toolCallId, {
          toolName,
          input: frame.input,
          errorText: frame.errorText,
        });
        const toolPart = getOrCreateToolMessagePart(toolCallId, toolName);
        toolPart.state = 'output-error';
        toolPart.input = frame.input;
        delete toolPart.output;
        toolPart.errorText = frame.errorText;
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
          delete existing.errorText;
          const toolPart = getOrCreateToolMessagePart(toolCallId, existing.toolName);
          toolPart.state = 'output-available';
          toolPart.output = frame.output;
          delete toolPart.errorText;
        }
        break;
      }
      case 'tool-output-error': {
        const { toolCallId } = frame;
        if (toolCallId && toolCallsById.has(toolCallId) && typeof frame.errorText === 'string') {
          const toolCall = toolCallsById.get(toolCallId)!;
          delete toolCall.output;
          toolCall.errorText = frame.errorText;
          const toolPart = getOrCreateToolMessagePart(toolCallId, toolCall.toolName);
          toolPart.state = 'output-error';
          delete toolPart.output;
          toolPart.errorText = frame.errorText;
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

  const decoder = new StringDecoder('utf8');
  try {
    for await (const chunk of response.body) {
      buffer += decoder.write(chunk as Buffer);
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
    if (stream) {
      flushDisplayLines(true);
    }
    stopSpinner();
  }

  if (errorText) {
    throw new Error(errorText);
  }

  const toolCalls = [...toolCallsById.values()];
  const assistantMessage = makeAssistantMessage(
    assistantMessageParts.filter(
      part =>
        part.type === 'text' ||
        part.type === 'step-start' ||
        part.state === 'output-available' ||
        part.state === 'output-error'
    )
  );

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

  return { text: fullText, toolCalls, assistantMessage };
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
