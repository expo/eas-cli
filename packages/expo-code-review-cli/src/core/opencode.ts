import { createOpencode } from '@opencode-ai/sdk';

import type { LoadedConfig } from '../config/schema.js';

export interface OpencodeHandle {
  client: any;
  url: string;
  close: () => void;
}

export interface PromptResult {
  text: string;
  cost: number;
  sessionID: string;
}

const COORDINATOR_TOOLS: Record<string, boolean> = {
  read: false,
  grep: false,
  glob: false,
  list: false,
  bash: false,
  write: false,
  edit: false,
  patch: false,
};

/** Build the inline OpenCode config (agents + coordinator) from a repo config. */
export function buildOpencodeConfig(config: LoadedConfig): Record<string, unknown> {
  const agent: Record<string, unknown> = {};
  for (const reviewer of config.agents) {
    agent[reviewer.id] = {
      description: `${reviewer.id} reviewer`,
      mode: 'all',
      model: reviewer.model,
      temperature: reviewer.temperature,
      prompt: `You are the ${reviewer.id} code reviewer. Follow the user message exactly and return only the requested JSON.`,
      tools: reviewer.tools,
    };
  }
  agent['coordinator'] = {
    description: 'Consolidates specialist findings into one decision.',
    mode: 'all',
    model: config.coordinator.model,
    temperature: config.coordinator.temperature,
    prompt:
      'You are the review coordinator. Follow the user message exactly and return only the requested JSON.',
    tools: COORDINATOR_TOOLS,
  };
  return { $schema: 'https://opencode.ai/config.json', agent };
}

/** hey-api style responses come back as { data, error }; unwrap or throw. */
function unwrap<T>(res: any): T {
  if (res && typeof res === 'object' && ('data' in res || 'error' in res)) {
    if (res.error) {
      throw new Error(typeof res.error === 'string' ? res.error : JSON.stringify(res.error));
    }
    return res.data as T;
  }
  return res as T;
}

/** Start an in-process OpenCode server with the given inline config. */
export async function startOpencode(config: unknown): Promise<OpencodeHandle> {
  const { client, server } = await createOpencode({
    hostname: '127.0.0.1',
    config: config as any,
  });
  return { client, url: server.url, close: () => server.close() };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const POLL_INTERVAL_MS = 2000;
// Per-attempt ceiling. A focused chunk should finish well under this; hitting it
// means the session stalled (e.g. provider rate-limiting), so we abort and let the
// caller retry rather than sitting for many minutes.
const MAX_WAIT_MS = 8 * 60 * 1000;

/**
 * Run a single prompt against the named agent in a fresh session and return the
 * concatenated assistant text.
 *
 * Uses the async prompt + polling rather than the synchronous `session.prompt`:
 * a large diff can keep an agent busy well past undici's 300s headers timeout,
 * which would kill a long-held synchronous request. promptAsync returns
 * immediately and we poll the message list (quick GETs) until the assistant
 * message completes.
 */
export async function promptAgent(
  handle: OpencodeHandle,
  args: {
    agent: string;
    system: string;
    text: string;
    title: string;
    /** Called once per tool the agent runs, for live progress (e.g. "read foo.ts"). */
    onActivity?: (line: string) => void;
  }
): Promise<PromptResult> {
  const session = unwrap<{ id: string }>(
    await handle.client.session.create({ body: { title: args.title } })
  );

  unwrap(
    await handle.client.session.promptAsync({
      path: { id: session.id },
      body: {
        agent: args.agent,
        system: args.system,
        parts: [{ type: 'text', text: args.text }],
      },
    })
  );

  const reportedTools = new Set<string>();
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      // Free the stalled session server-side before giving up.
      try {
        await handle.client.session.abort({ path: { id: session.id } });
      } catch {
        // best effort
      }
      throw new Error(`Agent "${args.agent}" timed out after ${MAX_WAIT_MS / 60000} minutes`);
    }
    await sleep(POLL_INTERVAL_MS);

    const messages = unwrap<
      Array<{
        info?: { role?: string; error?: unknown; cost?: number; time?: { completed?: number } };
        parts?: Array<{
          id?: string;
          type?: string;
          text?: string;
          tool?: string;
          callID?: string;
          state?: { status?: string; title?: string };
        }>;
      }>
    >(await handle.client.session.messages({ path: { id: session.id } }));

    const assistant = [...messages].reverse().find(message => message.info?.role === 'assistant');
    if (!assistant) {
      continue;
    }

    // Emit a live line the first time each tool call starts, so a long run shows
    // what the agent is actually doing instead of going silent.
    if (args.onActivity) {
      for (const part of assistant.parts ?? []) {
        if (part?.type !== 'tool') {
          continue;
        }
        const key = part.callID ?? part.id;
        const status = part.state?.status;
        if (key && status && status !== 'pending' && !reportedTools.has(key)) {
          reportedTools.add(key);
          const tool = part.tool ?? 'tool';
          const title = part.state?.title;
          args.onActivity(title ? `${tool}: ${title}` : tool);
        }
      }
    }

    if (assistant.info?.error) {
      throw new Error(
        `Agent "${args.agent}" returned an error: ${JSON.stringify(assistant.info.error)}`
      );
    }
    if (assistant.info?.time?.completed == null) {
      continue;
    }

    const text = (assistant.parts ?? [])
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string)
      .join('\n')
      .trim();
    return { text, cost: assistant.info?.cost ?? 0, sessionID: session.id };
  }
}

const CORRECTIVE =
  '\n\nIMPORTANT: your previous reply could not be parsed. Reply with ONLY the single ' +
  'JSON object described above — no prose, no code fences, no partial output.';

/**
 * Prompt an agent and parse its reply, retrying once with a corrective nudge in a
 * fresh session if parsing fails. Models occasionally emit malformed or truncated
 * JSON; this keeps an intermittent bad reply from failing the whole review.
 */
export async function promptAndParse<T>(
  handle: OpencodeHandle,
  args: {
    agent: string;
    system: string;
    text: string;
    title: string;
    onActivity?: (line: string) => void;
  },
  parse: (text: string) => T
): Promise<{ value: T; cost: number }> {
  let cost = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await promptAgent(handle, {
      ...args,
      text: attempt === 0 ? args.text : args.text + CORRECTIVE,
    });
    cost += result.cost;
    try {
      return { value: parse(result.text), cost };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Agent "${args.agent}" did not return parseable JSON after a retry: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}
