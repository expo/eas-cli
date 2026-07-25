import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { sleepAsync } from '../retry';
import {
  isUptermProcessAlive,
  parseUptermSessionJson,
  redactConnectionSecrets,
  resolveUptermArch,
  startUptermHostAsync,
} from '../upterm';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../retry', () => ({ sleepAsync: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  __esModule: true,
  default: {
    access: jest.fn(),
    mkdtemp: jest.fn(),
    writeFile: jest.fn(),
    rm: jest.fn(),
    readdir: jest.fn(),
  },
}));

describe(resolveUptermArch, () => {
  it('maps arm64 to arm64 and everything else to amd64', () => {
    expect(resolveUptermArch('arm64')).toBe('arm64');
    expect(resolveUptermArch('x64')).toBe('amd64');
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

  it('leaves output without userinfo untouched', () => {
    expect(redactConnectionSecrets('dialing wss://relay.expo.dev')).toBe(
      'dialing wss://relay.expo.dev'
    );
  });
});

describe(isUptermProcessAlive, () => {
  it('is alive while the process is running', () => {
    expect(isUptermProcessAlive({ exitCode: null, signalCode: null, killed: false })).toBe(true);
  });

  it('is dead after a normal exit', () => {
    expect(isUptermProcessAlive({ exitCode: 0, signalCode: null, killed: false })).toBe(false);
    expect(isUptermProcessAlive({ exitCode: 1, signalCode: null, killed: false })).toBe(false);
  });

  it('is dead after an external signal termination (the regression case)', () => {
    expect(isUptermProcessAlive({ exitCode: null, signalCode: 'SIGTERM', killed: false })).toBe(
      false
    );
    expect(isUptermProcessAlive({ exitCode: null, signalCode: 'SIGKILL', killed: false })).toBe(
      false
    );
  });

  it('is dead once we have killed it, and when there is no process', () => {
    expect(isUptermProcessAlive({ exitCode: null, signalCode: null, killed: true })).toBe(false);
    expect(isUptermProcessAlive(null)).toBe(false);
    expect(isUptermProcessAlive(undefined)).toBe(false);
  });
});

describe(startUptermHostAsync, () => {
  const mockedSpawn = jest.mocked(spawn);
  const mockedSleep = jest.mocked(sleepAsync);
  const mockedFs = jest.mocked(fs);

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

  function makeHostProcess(): typeof hostProcess {
    return {
      child: {
        stdout: {
          on: jest.fn(),
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

  function makeCtx(): BuildContext {
    return {
      logger: createMockLogger(),
      env: {},
    } as unknown as BuildContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'kill').mockReturnValue(true);
    hostProcess = makeHostProcess();
    sessionStdout = JSON.stringify({
      sessionId: 'TOKENx',
      host: 'ssh://relay.expo.dev:22',
      clientCount: 0,
    });
    mockedSleep.mockResolvedValue(undefined);
    mockedFs.access.mockResolvedValue(undefined as never);
    mockedFs.mkdtemp.mockResolvedValue('/tmp/eas-ssh-1' as never);
    mockedFs.writeFile.mockResolvedValue(undefined as never);
    mockedFs.rm.mockResolvedValue(undefined as never);
    mockedFs.readdir.mockResolvedValue(['default.sock'] as never);
    mockedSpawn.mockImplementation(((_cmd: string, args: string[]) => {
      if (Array.isArray(args) && args[0] === 'host') {
        return hostProcess as never;
      }
      if (Array.isArray(args) && args[0] === 'session') {
        return Promise.resolve({ stdout: sessionStdout, stderr: '' }) as never;
      }
      return Promise.resolve({ stdout: '', stderr: '' }) as never;
    }) as never);
  });

  it('resolves the baked client, dials, and returns a handle with the parsed config', async () => {
    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://relay.expo.dev' });

    expect(host.connectionConfig).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'TOKENx',
    });
    expect(host.isAlive()).toBe(true);
  });

  it('throws when the baked upterm client is missing', async () => {
    mockedFs.access.mockRejectedValue(new Error('ENOENT') as never);

    await expect(startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' })).rejects.toThrow(
      /was not found/
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
