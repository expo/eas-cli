import { SandboxProtocol } from '../sandboxProtocol';

describe(SandboxProtocol.name, () => {
  it('reports malformed JSON', async () => {
    const send = jest.fn();
    const protocol = new SandboxProtocol(send);

    await protocol.handleMessageAsync('{');

    expect(send).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });

  it('reports unknown methods', async () => {
    const send = jest.fn();
    const protocol = new SandboxProtocol(send);

    await protocol.handleMessageAsync(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown' }));

    expect(send).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    });
  });
});
