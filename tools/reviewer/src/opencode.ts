import { createOpencode } from '@opencode-ai/sdk';

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

/** hey-api style responses come back as { data, error }; unwrap or throw. */
function unwrap<T>(res: any): T {
  if (res && typeof res === 'object' && ('data' in res || 'error' in res)) {
    if (res.error) {
      throw new Error(
        typeof res.error === 'string' ? res.error : JSON.stringify(res.error)
      );
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

/**
 * Run a single prompt against the named agent in a fresh session and return the
 * concatenated assistant text. `system` carries the assembled role instructions;
 * `text` carries the task and file manifest.
 */
export async function promptAgent(
  handle: OpencodeHandle,
  args: { agent: string; system: string; text: string; title: string }
): Promise<PromptResult> {
  const session = unwrap<{ id: string }>(
    await handle.client.session.create({ body: { title: args.title } })
  );

  const response = unwrap<{
    info?: { cost?: number; error?: unknown };
    parts?: Array<{ type?: string; text?: string }>;
  }>(
    await handle.client.session.prompt({
      path: { id: session.id },
      body: {
        agent: args.agent,
        system: args.system,
        parts: [{ type: 'text', text: args.text }],
      },
    })
  );

  if (response.info?.error) {
    throw new Error(
      `Agent "${args.agent}" returned an error: ${JSON.stringify(response.info.error)}`
    );
  }

  const text = (response.parts ?? [])
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('\n')
    .trim();

  return { text, cost: response.info?.cost ?? 0, sessionID: session.id };
}
