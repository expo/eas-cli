import {
  SandboxDaemonCommands,
  SandboxDaemonErrorCode,
  SandboxDaemonRequestZ,
  SandboxDaemonResponseZ,
} from '../sandbox';

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

  it.each(['maxTextBytes', 'maxImageBytes'])(
    'requires the caller to set %s when reading a file',
    limit => {
      const params: Record<string, unknown> = {
        path: 'screenshot.png',
        maxTextBytes: 40_000,
        maxImageBytes: 3_000_000,
      };
      delete params[limit];

      expect(() => SandboxDaemonCommands.readFile.params.parse(params)).toThrow();
    }
  );

  it('rejects an image result with both data and an error', () => {
    expect(() =>
      SandboxDaemonCommands.readFile.result.parse({
        kind: 'image',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
        size: 8,
        error: 'tooLarge',
      })
    ).toThrow();
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

  it.each([
    { path: '', name: 'Crash log' },
    { path: 'crash.log', name: '' },
    { path: 'crash.log', name: 'a'.repeat(1025) },
    { path: 'crash.log', name: 'Crash log', yieldTimeMs: 30_001 },
  ])('rejects invalid artifact upload parameters', params => {
    expect(() => SandboxDaemonCommands.uploadArtifact.params.parse(params)).toThrow();
  });

  it('accepts a valid artifact name', () => {
    const params = { path: 'crash.log', name: 'a'.repeat(1024) };
    expect(SandboxDaemonCommands.uploadArtifact.params.parse(params)).toEqual(params);
  });

  it('rejects an artifact upload result without a status, with a non-UUID id or extra fields', () => {
    const id = '0199c0de-7b3a-7c1e-8f00-1234567890ab';
    const result = { id, status: 'uploading' };
    expect(SandboxDaemonCommands.uploadArtifact.result.parse(result)).toEqual(result);
    expect(() => SandboxDaemonCommands.uploadArtifact.result.parse({ id })).toThrow();
    expect(() =>
      SandboxDaemonCommands.uploadArtifact.result.parse({ ...result, id: 'artifact' })
    ).toThrow();
    expect(() =>
      SandboxDaemonCommands.uploadArtifact.result.parse({ ...result, url: 'https://r2.test' })
    ).toThrow();
  });

  it('requires a download URL exactly when an artifact upload result is uploaded', () => {
    const id = '0199c0de-7b3a-7c1e-8f00-1234567890ab';
    const downloadUrl = 'https://r2.test/artifact?X-Amz-Signature=signature';
    const uploaded = { id, status: 'uploaded', downloadUrl };
    expect(SandboxDaemonCommands.uploadArtifact.result.parse(uploaded)).toEqual(uploaded);
    expect(() =>
      SandboxDaemonCommands.uploadArtifact.result.parse({ id, status: 'uploaded' })
    ).toThrow();
    expect(() =>
      SandboxDaemonCommands.uploadArtifact.result.parse({ id, status: 'failed', downloadUrl })
    ).toThrow();
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

  it('accepts an error code that this version does not define', () => {
    const response = {
      jsonrpc: '2.0',
      id: 'request-id',
      error: { code: 99, message: 'Added by a newer daemon' },
    };
    expect(Object.values(SandboxDaemonErrorCode)).not.toContain(99);
    expect(SandboxDaemonResponseZ.parse(response)).toEqual(response);
  });
});
