import { SandboxDaemonCommands, SandboxDaemonRequestZ, SandboxDaemonResponseZ } from '../sandbox';

describe('sandbox daemon protocol', () => {
  it('validates command parameters', () => {
    expect(
      SandboxDaemonCommands.execCommand.params.parse({
        cmd: 'pwd',
        workdir: '/tmp',
        tty: true,
        yieldTimeMs: 10,
      })
    ).toEqual({ cmd: 'pwd', workdir: '/tmp', tty: true, yieldTimeMs: 10 });
    expect(
      SandboxDaemonCommands.writeStdin.params.parse({
        sessionId: 1,
        chars: '\u0003',
        yieldTimeMs: 0,
      })
    ).toEqual({ sessionId: 1, chars: '\u0003', yieldTimeMs: 0 });
  });

  it.each([
    { output: '', wallTimeSeconds: 0, exitCode: 0 },
    { output: '', wallTimeSeconds: 0, terminationSignal: 'SIGTERM' },
    { output: '', wallTimeSeconds: 0, sessionId: 1 },
  ])('validates a command result with one terminal state', result => {
    expect(SandboxDaemonCommands.execCommand.result.parse(result)).toEqual(result);
  });

  it.each([
    { output: '', wallTimeSeconds: 0 },
    { output: '', wallTimeSeconds: 0, exitCode: 0, sessionId: 1 },
  ])('rejects a command result without exactly one terminal state', result => {
    expect(() => SandboxDaemonCommands.writeStdin.result.parse(result)).toThrow();
  });

  it('validates success and error response envelopes', () => {
    expect(
      SandboxDaemonRequestZ.parse({
        jsonrpc: '2.0',
        id: 'request-id',
        method: 'execCommand',
        params: { cmd: 'pwd' },
      })
    ).toEqual({
      jsonrpc: '2.0',
      id: 'request-id',
      method: 'execCommand',
      params: { cmd: 'pwd' },
    });
    expect(
      SandboxDaemonResponseZ.parse({ jsonrpc: '2.0', id: 'request-id', result: { output: '' } })
    ).toEqual({ jsonrpc: '2.0', id: 'request-id', result: { output: '' } });
    expect(
      SandboxDaemonResponseZ.parse({
        jsonrpc: '2.0',
        id: 'request-id',
        error: { code: -32603, message: 'Command failed' },
      })
    ).toEqual({
      jsonrpc: '2.0',
      id: 'request-id',
      error: { code: -32603, message: 'Command failed' },
    });
  });
});
