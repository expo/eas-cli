import { z } from 'zod';

type JsonRpcId = string | number | null;

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      error: { code: number; message: string; data?: unknown };
    };

export type SandboxMethodHandler = (params: unknown) => Promise<unknown>;

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});

export class SandboxProtocol {
  private readonly methodHandlers = new Map<string, SandboxMethodHandler>();

  public constructor(private readonly send: (response: JsonRpcResponse) => void) {
    this.registerMethod('ping', async () => ({}));
  }

  public registerMethod(method: string, handler: SandboxMethodHandler): void {
    this.methodHandlers.set(method, handler);
  }

  public async handleMessageAsync(message: string): Promise<void> {
    let request: unknown;
    try {
      request = JSON.parse(message);
    } catch {
      this.sendError(null, -32700, 'Parse error');
      return;
    }

    const parsedRequest = jsonRpcRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      this.sendError(null, -32600, 'Invalid request', parsedRequest.error.flatten());
      return;
    }

    const { id, method, params } = parsedRequest.data;
    const handler = this.methodHandlers.get(method);
    if (!handler) {
      this.sendError(id, -32601, 'Method not found');
      return;
    }

    try {
      const result = await handler(params);
      this.send({ jsonrpc: '2.0', id, result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        this.sendError(id, -32602, 'Invalid params', error.flatten());
        return;
      }
      this.sendError(id, -32603, error instanceof Error ? error.message : 'Internal error');
    }
  }

  private sendError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    this.send({
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    });
  }
}
