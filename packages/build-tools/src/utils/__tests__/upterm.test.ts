import { SystemError } from '@expo/eas-build-job';
import downloadFile from '@expo/downloader';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { sleepAsync } from '../retry';
import {
  parseUptermSessionJson,
  redactConnectionSecrets,
  redactSpawnErrorForLog,
  resolveUptermGcsObjectName,
  startUptermHostAsync,
} from '../upterm';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@expo/downloader', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../retry', () => ({ sleepAsync: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  __esModule: true,
  default: {
    access: jest.fn(),
    mkdir: jest.fn(),
    chmod: jest.fn(),
    mkdtemp: jest.fn(),
    writeFile: jest.fn(),
    rm: jest.fn(),
    readdir: jest.fn(),
  },
}));

describe(resolveUptermGcsObjectName, () => {
  it('maps worker platforms to GCS object names', () => {
    expect(resolveUptermGcsObjectName('darwin', 'arm64')).toBe('upterm-darwin-arm64');
    expect(resolveUptermGcsObjectName('linux', 'x64')).toBe('upterm-linux-amd64');
  });

  it('rejects unsupported platforms', () => {
    expect(() => resolveUptermGcsObjectName('darwin', 'x64')).toThrow(/only available/);
    expect(() => resolveUptermGcsObjectName('linux', 'arm64')).toThrow(/only available/);
  });
});

describe(parseUptermSessionJson, () => {
  it('parses sessionId and host from json', () => {
    expect(
      parseUptermSessionJson(
        JSON.stringify({
          sessionId: 'TOKENabc123',
          host: 'ssh://relay.expo.dev:22',
          clientCount: 0,
        })
      )
    ).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'TOKENabc123',
    });
  });

  it('accepts a bare hostname', () => {
    expect(
      parseUptermSessionJson(JSON.stringify({ sessionId: 'tok', host: 'relay.expo.dev' }))
    ).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'tok',
    });
  });

  it('keeps a non-default port so the CLI can pass it to ssh -p', () => {
    expect(
      parseUptermSessionJson(
        JSON.stringify({ sessionId: 'tok', host: 'ssh://relay.expo.dev:2222' })
      )
    ).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev:2222',
      secret: 'tok',
    });
  });

  it('returns null for incomplete json', () => {
    expect(parseUptermSessionJson('{}')).toBeNull();
    expect(parseUptermSessionJson('not-json')).toBeNull();
  });

  it('returns null when the host is not a parseable url', () => {
    expect(parseUptermSessionJson(JSON.stringify({ sessionId: 'tok', host: 'ssh://' }))).toBeNull();
    expect(
      parseUptermSessionJson(JSON.stringify({ sessionId: 'tok', host: 'ssh://[' }))
    ).toBeNull();
  });
});

describe(redactConnectionSecrets, () => {
  it('strips the userinfo secret from a connection string', () => {
    expect(
      redactConnectionSecrets('Connect: upterm proxy wss://TOKENabc123@relay.expo.dev now')
    ).toBe('Connect: upterm proxy wss://<redacted>@relay.expo.dev now');
  });

  it('strips the bare token that trails the ssh ProxyCommand line', () => {
    const line =
      "ssh -o ProxyCommand='upterm proxy wss://TOKENabc123@uptermd.upterm.dev' TOKENabc123@uptermd.upterm.dev";
    const redacted = redactConnectionSecrets(line);
    expect(redacted).not.toContain('TOKENabc123');
    expect(redacted).toBe(
      "ssh -o ProxyCommand='upterm proxy wss://<redacted>@uptermd.upterm.dev' <redacted>@uptermd.upterm.dev"
    );
  });

  it('strips the bare token for ws:// relay URLs too', () => {
    const line =
      "ssh -o ProxyCommand='upterm proxy ws://TOKENabc123@relay.local' TOKENabc123@relay.local";
    const redacted = redactConnectionSecrets(line);
    expect(redacted).not.toContain('TOKENabc123');
    expect(redacted).toBe(
      "ssh -o ProxyCommand='upterm proxy ws://<redacted>@relay.local' <redacted>@relay.local"
    );
  });

  it('leaves output without userinfo untouched', () => {
    expect(redactConnectionSecrets('dialing wss://relay.expo.dev')).toBe(
      'dialing wss://relay.expo.dev'
    );
  });

  it('strips control characters (incl. ESC) while keeping newlines', () => {
    // ESC alone is enough to neutralize CSI; leftover printable "[31m" is harmless in logs.
    expect(redactConnectionSecrets('ok\n\u001b[31mfail\u001b[0m\r\nbad\u0007')).toBe(
      'ok\n[31mfail[0m\nbad'
    );
  });
});

describe(redactSpawnErrorForLog, () => {
  it('redacts secrets in message, stdout, and stderr', () => {
    expect(
      redactSpawnErrorForLog({
        message: 'failed wss://TOKENabc@relay.expo.dev',
        stdout: 'upterm proxy wss://TOKENabc@relay.expo.dev',
        stderr: 'ssh dial error: wss://TOKENabc@relay.expo.dev',
        code: 1,
      })
    ).toEqual({
      message: 'failed wss://<redacted>@relay.expo.dev',
      stdout: 'upterm proxy wss://<redacted>@relay.expo.dev',
      stderr: 'ssh dial error: wss://<redacted>@relay.expo.dev',
      code: 1,
    });
  });

  it('passes through non-objects', () => {
    expect(redactSpawnErrorForLog('boom')).toBe('boom');
    expect(redactSpawnErrorForLog(null)).toBeNull();
  });

  it('leaves non-string message/stdout/stderr fields alone', () => {
    expect(
      redactSpawnErrorForLog({
        message: 42,
        stdout: Buffer.from('x'),
        code: 1,
      })
    ).toEqual({
      message: 42,
      stdout: Buffer.from('x'),
      code: 1,
    });
  });
});

describe(startUptermHostAsync, () => {
  const mockedSpawn = jest.mocked(spawn);
  const mockedSleep = jest.mocked(sleepAsync);
  const mockedFs = jest.mocked(fs);
  const mockedDownloadFile = jest.mocked(downloadFile);

  let hostProcess: {
    child: {
      stdout: { on: (event: string, cb: (chunk: Buffer) => void) => void };
      stderr: { on: jest.Mock };
      pid: number;
      kill: jest.Mock;
      unref: jest.Mock;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      killed: boolean;
    };
    catch: (cb: (err: unknown) => void) => Promise<void>;
  };
  let sessionStdout: string;
  let uptermOnPath = true;

  function makeHostProcess(): typeof hostProcess {
    return {
      child: {
        stdout: {
          on: jest.fn((_event: string, cb: (chunk: Buffer) => void) => {
            cb(Buffer.from('host output'));
          }),
        },
        stderr: { on: jest.fn() },
        pid: 4242,
        kill: jest.fn(),
        unref: jest.fn(),
        exitCode: null,
        signalCode: null,
        killed: false,
      },
      catch: cb => {
        cb(new Error('exited'));
        return Promise.resolve();
      },
    };
  }

  function makeCtx(env: Record<string, string> = {}): BuildContext {
    return {
      logger: createMockLogger(),
      env,
    } as unknown as BuildContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'kill').mockReturnValue(true);
    hostProcess = makeHostProcess();
    uptermOnPath = true;
    sessionStdout = JSON.stringify({
      sessionId: 'TOKENx',
      host: 'ssh://relay.expo.dev:22',
      clientCount: 0,
    });
    mockedSleep.mockResolvedValue(undefined);
    mockedFs.access.mockRejectedValue(new Error('ENOENT') as never);
    mockedFs.mkdir.mockResolvedValue(undefined as never);
    mockedFs.chmod.mockResolvedValue(undefined as never);
    mockedFs.mkdtemp.mockResolvedValue('/tmp/eas-ssh-1' as never);
    mockedFs.writeFile.mockResolvedValue(undefined as never);
    mockedFs.rm.mockResolvedValue(undefined as never);
    mockedFs.readdir.mockResolvedValue(['default.sock'] as never);
    mockedDownloadFile.mockResolvedValue(undefined as never);
    mockedSpawn.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === 'upterm' && Array.isArray(args) && args[0] === 'version') {
        if (!uptermOnPath) {
          return Promise.reject(new Error('not found')) as never;
        }
        return Promise.resolve({ stdout: 'upterm version 0.24.0\n', stderr: '' }) as never;
      }
      if (Array.isArray(args) && args[0] === 'host') {
        return hostProcess as never;
      }
      if (Array.isArray(args) && args[0] === 'session') {
        return Promise.resolve({ stdout: sessionStdout, stderr: '' }) as never;
      }
      return Promise.resolve({ stdout: '', stderr: '' }) as never;
    }) as never);
  });

  it('uses upterm on PATH, dials, and returns a handle with the parsed config', async () => {
    const env = { PATH: '/job/bin', CUSTOM: '1' };
    const host = await startUptermHostAsync(makeCtx(env), {
      relayServerUrl: 'wss://relay.expo.dev',
    });

    expect(host.connectionConfig).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'TOKENx',
    });
    expect(host.isAlive()).toBe(true);
    expect(mockedDownloadFile).not.toHaveBeenCalled();
    expect(mockedSpawn).toHaveBeenCalledWith('upterm', ['version'], {
      stdio: 'pipe',
      env,
    });
    expect(mockedSpawn).toHaveBeenCalledWith(
      'upterm',
      expect.arrayContaining(['host']),
      expect.objectContaining({ env: expect.objectContaining({ CUSTOM: '1', PATH: '/job/bin' }) })
    );
  });

  it('downloads from GCS when upterm is not on PATH', async () => {
    uptermOnPath = false;
    mockedFs.access.mockRejectedValue(new Error('ENOENT') as never);

    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://relay.expo.dev' });

    expect(host.connectionConfig.secret).toBe('TOKENx');
    expect(mockedDownloadFile).toHaveBeenCalledWith(
      expect.stringMatching(/storage\.googleapis\.com\/turtle-v2\/upterm\/upterm-/),
      expect.stringContaining('eas-upterm'),
      expect.objectContaining({ retry: 3 })
    );
  });

  it('reuses a previously downloaded binary from the cache dir', async () => {
    uptermOnPath = false;
    mockedFs.access.mockResolvedValue(undefined as never);

    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://relay.expo.dev' });

    expect(host.connectionConfig.secret).toBe('TOKENx');
    expect(mockedDownloadFile).not.toHaveBeenCalled();
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.stringContaining('eas-upterm'),
      expect.arrayContaining(['host']),
      expect.anything()
    );
  });

  it('throws when upterm is missing from PATH and the GCS download fails', async () => {
    uptermOnPath = false;
    mockedDownloadFile.mockRejectedValue(new Error('403 Forbidden') as never);

    await expect(startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' })).rejects.toThrow(
      /could not be downloaded/
    );
  });

  it('still throws when download fails with a non-Error and cache cleanup also fails', async () => {
    uptermOnPath = false;
    mockedDownloadFile.mockRejectedValue('network down' as never);
    mockedFs.rm.mockRejectedValue(new Error('EPERM') as never);

    await expect(startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' })).rejects.toThrow(
      /network down/
    );
  });

  it('tears down and rethrows when the host never registers with the relay', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      mockedFs.readdir.mockResolvedValue([] as never);
      mockedSleep.mockImplementation(async () => {
        jest.setSystemTime(Date.now() + 61_000);
      });

      await expect(startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' })).rejects.toThrow(
        /did not register/
      );
      expect(process.kill).toHaveBeenCalledWith(-4242, 'SIGTERM');
      expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-ssh-1', expect.anything());
    } finally {
      jest.useRealTimers();
    }
  });

  it('stopAsync kills the process and removes the state dir', async () => {
    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
    await host.stopAsync();

    expect(process.kill).toHaveBeenCalledWith(-4242, 'SIGTERM');
    expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-ssh-1', expect.anything());
  });

  it('falls back to child.kill when process.kill on the process group fails', async () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
    await host.stopAsync();

    expect(hostProcess.child.kill).toHaveBeenCalled();
  });

  it('skips process.kill when the host process has no pid', async () => {
    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
    hostProcess.child.pid = undefined as unknown as number;
    await host.stopAsync();

    expect(process.kill).not.toHaveBeenCalled();
    expect(hostProcess.child.kill).not.toHaveBeenCalled();
  });

  it('redialAsync re-establishes the connection', async () => {
    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
    const config = await host.redialAsync();

    expect(config).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'TOKENx',
    });
    expect(host.connectionConfig).toEqual(config);
  });

  it('redialAsync waits for the old process to exit before clearing its socket dir', async () => {
    const order: string[] = [];
    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });

    // Keep the give-up timer pending so only the process exit can unblock the redial.
    mockedSleep.mockImplementation(() => new Promise<void>(() => {}));
    let resolveExit: (() => void) | undefined;
    hostProcess.catch = () =>
      new Promise<void>(resolve => {
        resolveExit = () => {
          order.push('exited');
          resolve();
        };
      });
    mockedFs.rm.mockImplementation((() => {
      order.push('rm');
      return Promise.resolve(undefined);
    }) as never);
    jest.spyOn(process, 'kill').mockImplementation(() => {
      order.push('kill');
      // A real SIGTERM is asynchronous, so the exit lands after the kill returns.
      setImmediate(() => resolveExit?.());
      return true;
    });

    await host.redialAsync();

    expect(order).toEqual(['kill', 'exited', 'rm']);
  });

  it('redialAsync gives up waiting when the old process does not exit', async () => {
    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
    hostProcess.catch = () => new Promise<void>(() => {});

    await expect(host.redialAsync()).resolves.toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'TOKENx',
    });
    expect(mockedSleep).toHaveBeenCalledWith(5_000);
  });

  it('continues when the previous socket dir cannot be cleared', async () => {
    mockedFs.rm.mockImplementation(((dir: string) =>
      dir === '/tmp/eas-ssh-1/upterm'
        ? Promise.reject(new Error('busy'))
        : Promise.resolve(undefined)) as never);

    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });

    expect(host.connectionConfig.secret).toBe('TOKENx');
  });

  describe('getConnectedClientCountAsync', () => {
    it('returns null (unknown) when no admin socket exists yet', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      mockedFs.readdir.mockResolvedValue([] as never);
      expect(await host.getConnectedClientCountAsync()).toBeNull();
    });

    it('returns the client count reported by the admin socket', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      sessionStdout = JSON.stringify({
        sessionId: 'TOKENx',
        host: 'relay.expo.dev',
        clientCount: 4,
      });
      expect(await host.getConnectedClientCountAsync()).toBe(4);
    });

    it('returns null (unknown) when the count query fails', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      mockedSpawn.mockImplementation((() => Promise.reject(new Error('socket gone'))) as never);
      expect(await host.getConnectedClientCountAsync()).toBeNull();
    });

    it('returns null (unknown) when the reported count is not a number', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      sessionStdout = JSON.stringify({
        sessionId: 'TOKENx',
        host: 'relay.expo.dev',
        clientCount: 'nope',
      });
      expect(await host.getConnectedClientCountAsync()).toBeNull();
    });

    it('returns 0 when the socket dir cannot be read', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      mockedFs.readdir.mockRejectedValue(new Error('no dir') as never);
      expect(await host.getConnectedClientCountAsync()).toBeNull();
    });
  });
});
