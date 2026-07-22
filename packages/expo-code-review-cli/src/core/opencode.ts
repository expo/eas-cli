import { createOpencode } from '@opencode-ai/sdk';

import type { LoadedConfig } from '../config/schema.js';
import { toolMap } from './tools.js';
import { sleep } from './util.js';

export interface OpencodeHandle {
  client: any;
  url: string;
  close: () => void;
}

/** Token usage as reported on an OpenCode assistant message's `info.tokens`. */
export interface TokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

export interface PromptResult {
  text: string;
  cost: number;
  sessionID: string;
  /** True when this reply came from the finalize ("wrap up now") path — i.e. the
   * agent ran out of time and returned partial findings rather than converging. */
  truncated?: boolean;
  /** Token usage for the model request that produced this reply (for cache metrics). */
  tokens?: TokenUsage;
}

/** Sum token usage across attempts (for per-task/run totals). */
export function addTokenUsage(into: TokenUsage, from?: TokenUsage): TokenUsage {
  if (!from) {
    return into;
  }
  into.input = (into.input ?? 0) + (from.input ?? 0);
  into.output = (into.output ?? 0) + (from.output ?? 0);
  into.reasoning = (into.reasoning ?? 0) + (from.reasoning ?? 0);
  into.cache = {
    read: (into.cache?.read ?? 0) + (from.cache?.read ?? 0),
    write: (into.cache?.write ?? 0) + (from.cache?.write ?? 0),
  };
  return into;
}

// The coordinator consolidates findings; it needs no repo tools.
const COORDINATOR_TOOLS = toolMap([]);
// Agent id for the single combined cross-cutting pass (see review.ts). It MUST be
// defined here so OpenCode uses this restricted tool set — otherwise the model
// falls back to a default agent with full tools and crawls the whole repo, which
// is why the cross-file pass used to wander for its entire time budget.
export const CROSS_CUTTING_AGENT = 'cross-cutting';
// Deliberately NO `glob`/`list`: the cross-file pass is given the changed files'
// patch paths already, and directory crawling is exactly what made it wander into
// unrelated packages. `read` (open a known file) + `grep` (find a cross-reference
// among the changed files) are enough to trace interactions.
const CROSS_CUTTING_TOOLS = toolMap(['read', 'grep']);

// Verifies a finding by re-reading the actual file (adversarial refute pass). Same
// restricted tool set — it opens the cited file and checks the claim.
export const VERIFIER_AGENT = 'verifier';
const VERIFIER_TOOLS = toolMap(['read', 'grep']);

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
  agent[CROSS_CUTTING_AGENT] = {
    description: 'Cross-file reviewer: issues spanning multiple changed files.',
    mode: 'all',
    // Use the default reviewing model (agents share it unless overridden).
    model: config.agents[0]?.model ?? config.coordinator.model,
    temperature: config.agents[0]?.temperature ?? 0.1,
    prompt:
      'You are the cross-file code reviewer. Follow the user message exactly and return only the requested JSON.',
    tools: CROSS_CUTTING_TOOLS,
  };
  agent[VERIFIER_AGENT] = {
    description: 'Verifies a finding against the real file (adversarial refute pass).',
    mode: 'all',
    model: config.agents[0]?.model ?? config.coordinator.model,
    temperature: config.agents[0]?.temperature ?? 0.1,
    prompt:
      'You verify code-review findings against the actual source. Follow the user message exactly and return only the requested JSON.',
    tools: VERIFIER_TOOLS,
  };
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

const POLL_INTERVAL_MS = 1000;
// Emit a "still working" heartbeat if this long passes with no tool activity, so
// a long model-thinking stretch doesn't look hung in the logs.
const HEARTBEAT_MS = 45_000;
// Default per-attempt ceiling. Focused chunk passes finish well under this; the
// cross-cutting pass is given more (see review.ts). Hitting the cap does NOT mean
// "retry" — we first interrupt the run and ask the agent to return whatever
// findings it already has (finalizeOnTimeout), and only fail if that also runs
// over. Callers must treat AgentTimeoutError as "abandon", never "retry".
const DEFAULT_MAX_WAIT_MS = 8 * 60 * 1000;
// Extra budget for the "stop and summarize what you have" finalization prompt.
const FINALIZE_WAIT_MS = 90 * 1000;

const FINALIZE_PROMPT =
  'You have reached your time budget. STOP investigating now — do NOT read, grep, ' +
  'glob, list, or open any more files, and do not call any tools. Based ONLY on ' +
  'what you have already examined, reply with the single JSON object exactly as ' +
  'specified in your instructions, containing whatever findings you are already ' +
  'confident about. If you have nothing solid, return an empty findings array.';

/**
 * Internal signal that a poll loop passed its deadline. Carries the best-effort
 * cost/tokens of the in-progress (never-completed) assistant message so a
 * timed-out task's spend isn't dropped from the run's metrics.
 */
class DeadlineReached extends Error {
  constructor(
    readonly cost: number = 0,
    readonly tokens?: TokenUsage
  ) {
    super('deadline reached');
  }
}

/**
 * Thrown when an agent exceeds its time budget even after being asked to wrap up.
 * Callers MUST treat this as "abandon this task" — retrying just repeats the same
 * non-convergent run. Carries the cost/tokens burned so the caller can still
 * account for the (abandoned) work.
 */
export class AgentTimeoutError extends Error {
  readonly cost: number;
  readonly tokens?: TokenUsage;
  constructor(agent: string, minutes: number, cost = 0, tokens?: TokenUsage) {
    super(`Agent "${agent}" timed out after ${minutes} minutes (including finalize)`);
    this.name = 'AgentTimeoutError';
    this.cost = cost;
    this.tokens = tokens;
  }
}

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
    /** Per-attempt time ceiling. Defaults to DEFAULT_MAX_WAIT_MS. */
    maxWaitMs?: number;
    /**
     * Soft ceiling on the number of distinct tool calls the investigation may make.
     * Exceeding it trips the same soft-landing as the wall-clock cap (interrupt +
     * ask for findings so far). This bounds an agent that WANDERS — reads/greps
     * without converging — which is the root cause of the non-convergent 15-minute
     * timeouts. Undefined = no tool-call cap.
     */
    maxToolCalls?: number;
    /**
     * On hitting the ceiling, interrupt the run and ask the agent to return the
     * findings it has so far (a soft landing) instead of throwing immediately.
     */
    finalizeOnTimeout?: boolean;
  }
): Promise<PromptResult> {
  const session = unwrap<{ id: string }>(
    await handle.client.session.create({ body: { title: args.title } })
  );
  const reportedTools = new Set<string>();
  await sendSessionPrompt(handle, session.id, {
    agent: args.agent,
    system: args.system,
    text: args.text,
  });

  const maxWaitMs = args.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  try {
    return await pollForCompletion(handle, session.id, {
      agent: args.agent,
      fromIndex: 0,
      deadline: Date.now() + maxWaitMs,
      onActivity: args.onActivity,
      reportedTools,
      maxToolCalls: args.maxToolCalls,
    });
  } catch (error) {
    if (!(error instanceof DeadlineReached)) {
      throw error;
    }
    // Cost/tokens burned during the (never-completed) investigation, so the
    // finalize reply or the abandon path still accounts for them.
    const spentCost = error.cost;
    const spentTokens = error.tokens;
    // Time budget hit. Interrupt the wandering run first.
    await abortQuietly(handle, session.id);
    if (!args.finalizeOnTimeout) {
      throw new AgentTimeoutError(args.agent, Math.round(maxWaitMs / 60000), spentCost, spentTokens);
    }
    // Soft landing: ask the (same, context-carrying) session to return whatever
    // it has now. Only messages after this point count as the answer.
    const baseline = (await fetchMessages(handle, session.id)).length;
    args.onActivity?.('time budget reached — asking for findings so far');
    await sendSessionPrompt(handle, session.id, {
      agent: args.agent,
      system: args.system,
      text: FINALIZE_PROMPT,
    });
    try {
      const result = await pollForCompletion(handle, session.id, {
        agent: args.agent,
        fromIndex: baseline,
        deadline: Date.now() + FINALIZE_WAIT_MS,
        onActivity: args.onActivity,
        reportedTools,
      });
      return {
        ...result,
        cost: result.cost + spentCost,
        tokens: addTokenUsage(addTokenUsage({}, spentTokens), result.tokens),
        truncated: true,
      };
    } catch (finalizeError) {
      if (finalizeError instanceof DeadlineReached) {
        await abortQuietly(handle, session.id);
        throw new AgentTimeoutError(
          args.agent,
          Math.round((maxWaitMs + FINALIZE_WAIT_MS) / 60000),
          spentCost + finalizeError.cost,
          addTokenUsage(addTokenUsage({}, spentTokens), finalizeError.tokens)
        );
      }
      throw finalizeError;
    }
  }
}

const CORRECTIVE =
  '\n\nIMPORTANT: your previous reply could not be parsed. Reply with ONLY the single ' +
  'JSON object described above — no prose, no code fences, no partial output.';

// Budget for a corrective "re-emit the JSON" reply — no fresh investigation, so
// it should return almost immediately.
const CORRECTIVE_WAIT_MS = 2 * 60 * 1000;

/**
 * Prompt an agent and parse its reply. On a JSON-parse failure, first retry in
 * the SAME session: the model still holds all the file context it read, so the
 * corrective is a cache read and a cheap re-emit — and better for recall than
 * re-investigating from scratch (the usual failure is a truncated/malformed reply
 * after a sound investigation). Only if that also fails do we fall back to a fresh
 * session as a clean-slate last resort. A timeout is NOT a parse failure:
 * promptAgent throws AgentTimeoutError, which propagates so the caller abandons
 * the task instead of retrying a non-convergent run.
 */
export async function promptAndParse<T>(
  handle: OpencodeHandle,
  args: {
    agent: string;
    system: string;
    text: string;
    title: string;
    onActivity?: (line: string) => void;
    maxWaitMs?: number;
    maxToolCalls?: number;
    finalizeOnTimeout?: boolean;
  },
  parse: (text: string) => T
): Promise<{ value: T; cost: number; truncated: boolean; tokens: TokenUsage }> {
  let cost = 0;
  let truncated = false;
  const tokens: TokenUsage = {};
  const record = (result: PromptResult): void => {
    cost += result.cost;
    truncated = truncated || (result.truncated ?? false);
    addTokenUsage(tokens, result.tokens);
  };

  const first = await promptAgent(handle, args);
  record(first);
  try {
    return { value: parse(first.text), cost, truncated, tokens };
  } catch {
    // Same-session corrective retry: send the nudge as a follow-up and wait for
    // the NEW assistant message (past the current message count).
    try {
      const baseline = (await fetchMessages(handle, first.sessionID)).length;
      await sendSessionPrompt(handle, first.sessionID, {
        agent: args.agent,
        system: args.system,
        text: CORRECTIVE,
      });
      const retry = await pollForCompletion(handle, first.sessionID, {
        agent: args.agent,
        fromIndex: baseline,
        deadline: Date.now() + CORRECTIVE_WAIT_MS,
        onActivity: args.onActivity,
        reportedTools: new Set<string>(),
      });
      record(retry);
      return { value: parse(retry.text), cost, truncated, tokens };
    } catch {
      // Fresh-session last resort: a clean slate for a genuinely confused run.
      const fresh = await promptAgent(handle, {
        ...args,
        text: args.text + CORRECTIVE,
        finalizeOnTimeout: false,
      });
      record(fresh);
      try {
        return { value: parse(fresh.text), cost, truncated, tokens };
      } catch (finalError) {
        throw new Error(
          `Agent "${args.agent}" did not return parseable JSON after retries: ${
            finalError instanceof Error ? finalError.message : String(finalError)
          }`
        );
      }
    }
  }
}

// ---- session helpers (shared by promptAgent + promptAndParse) ----

interface RawMessage {
  info?: {
    role?: string;
    error?: unknown;
    cost?: number;
    tokens?: TokenUsage;
    time?: { completed?: number };
  };
  parts?: Array<{
    id?: string;
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: { status?: string; title?: string };
  }>;
}

async function fetchMessages(handle: OpencodeHandle, sessionID: string): Promise<RawMessage[]> {
  return unwrap<RawMessage[]>(await handle.client.session.messages({ path: { id: sessionID } }));
}

async function sendSessionPrompt(
  handle: OpencodeHandle,
  sessionID: string,
  args: { agent: string; system: string; text: string }
): Promise<void> {
  unwrap(
    await handle.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: args.agent,
        system: args.system,
        parts: [{ type: 'text', text: args.text }],
      },
    })
  );
}

async function abortQuietly(handle: OpencodeHandle, sessionID: string): Promise<void> {
  try {
    await handle.client.session.abort({ path: { id: sessionID } });
  } catch {
    // best effort — the session may already be gone
  }
}

/**
 * Poll a session for the first assistant message at or after `fromIndex` to
 * complete. `fromIndex` lets a follow-up prompt (finalize, corrective retry)
 * skip the earlier completed message and wait for the NEW reply instead. Throws
 * DeadlineReached once `deadline` passes.
 */
async function pollForCompletion(
  handle: OpencodeHandle,
  sessionID: string,
  opts: {
    agent: string;
    fromIndex: number;
    deadline: number;
    onActivity?: (line: string) => void;
    reportedTools: Set<string>;
    maxToolCalls?: number;
  }
): Promise<PromptResult> {
  // Best-effort usage of the in-progress assistant message, so a task that times
  // out before completing still contributes its spend to the run's metrics.
  let lastCost = 0;
  let lastTokens: TokenUsage | undefined;
  const startedAt = Date.now();
  let lastEmitAt = startedAt;
  const emit = (line: string): void => {
    lastEmitAt = Date.now();
    opts.onActivity?.(line);
  };
  for (;;) {
    if (Date.now() > opts.deadline) {
      throw new DeadlineReached(lastCost, lastTokens);
    }
    await sleep(POLL_INTERVAL_MS);

    // Heartbeat if nothing has been reported for a while (e.g. the model is
    // reasoning without calling tools), so a long pass doesn't look hung.
    if (opts.onActivity && Date.now() - lastEmitAt >= HEARTBEAT_MS) {
      emit(`still working… ${Math.round((Date.now() - startedAt) / 1000)}s elapsed`);
    }

    const messages = await fetchMessages(handle, sessionID);
    const recent = messages.slice(opts.fromIndex);
    const assistant = [...recent].reverse().find(message => message.info?.role === 'assistant');
    if (!assistant) {
      continue;
    }
    if (typeof assistant.info?.cost === 'number') {
      lastCost = assistant.info.cost;
    }
    if (assistant.info?.tokens) {
      lastTokens = assistant.info.tokens;
    }

    // Track each distinct tool call once (for the tool-call cap) and, the first
    // time it starts, emit a live line so a long run shows what the agent is doing.
    for (const part of assistant.parts ?? []) {
      if (part?.type !== 'tool') {
        continue;
      }
      const key = part.callID ?? part.id;
      const status = part.state?.status;
      if (key && status && status !== 'pending' && !opts.reportedTools.has(key)) {
        opts.reportedTools.add(key);
        if (opts.onActivity) {
          const tool = part.tool ?? 'tool';
          const title = part.state?.title;
          emit(title ? `${tool}: ${title}` : tool);
        }
      }
    }
    if (assistant.info?.error) {
      throw new Error(
        `Agent "${opts.agent}" returned an error: ${JSON.stringify(assistant.info.error)}`
      );
    }

    // A completed message ALWAYS wins — return it regardless of tool count; the
    // work is done, so there's nothing to finalize.
    if (assistant.info?.time?.completed != null) {
      const text = (assistant.parts ?? [])
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text as string)
        .join('\n')
        .trim();
      return {
        text,
        cost: assistant.info?.cost ?? 0,
        sessionID,
        tokens: assistant.info?.tokens,
      };
    }

    // Still in progress: enforce the tool-call cap. An agent that has made this
    // many tool calls without finishing is wandering, not converging — trip the
    // same soft-landing as the wall-clock deadline so it returns what it has.
    if (opts.maxToolCalls != null && opts.reportedTools.size > opts.maxToolCalls) {
      emit(`made ${opts.reportedTools.size} tool calls — wrapping up to stay on budget`);
      throw new DeadlineReached(lastCost, lastTokens);
    }
  }
}
