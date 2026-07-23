import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { sleepAsync } from '../retry';
import {
  isUptermProcessAlive,
  parseUptermConnection,
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

describe(parseUptermConnection, () => {
  it('parses the host and secret from the upterm proxy line', () => {
    const output = [
      'some noise',
      '=== SSH SESSION ===',
      'Connect: upterm proxy wss://TOKENabc123@relay.expo.dev',
      'more noise',
    ].join('\n');
    expect(parseUptermConnection(output)).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'TOKENabc123',
    });
  });

  it('strips the trailing quote when the line is inside a quoted ssh ProxyCommand', () => {
    const output =
      "ssh -o ProxyCommand='upterm proxy wss://TOKENabc123@uptermd.upterm.dev' TOKENabc123@uptermd.upterm.dev\n";
    expect(parseUptermConnection(output)).toEqual({
      type: 'upterm-v1',
      host: 'uptermd.upterm.dev',
      secret: 'TOKENabc123',
    });
  });

  it('returns null before the connection line is printed', () => {
    expect(parseUptermConnection('still starting up...')).toBeNull();
  });

  it('waits for a complete line before parsing a partially-streamed connection line', () => {
    const partial = 'noise\nConnect: upterm proxy wss://TOKENabc123@relay.expo.dev';
    expect(parseUptermConnection(partial)).toBeNull();
    expect(parseUptermConnection(`${partial}\n`)).toEqual({
      type: 'upterm-v1',
      host: 'relay.expo.dev',
      secret: 'TOKENabc123',
    });
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

  const CONNECTION_LINE = 'Connect: upterm proxy wss://TOKENx@relay.expo.dev\n';

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
    catch: (cb: (err: unknown) => void) => void;
  };
  let sessionStdout: string;

  function makeHostProcess(emitLine: string | null): typeof hostProcess {
    return {
      child: {
        stdout: {
          on: (_event, cb) => {
            if (emitLine !== null) {
              cb(Buffer.from(emitLine));
            }
          },
        },
        stderr: { on: jest.fn() },
        pid: 4242,
        kill: jest.fn(),
        unref: jest.fn(),
        exitCode: null,
        signalCode: null,
        killed: false,
      },
      catch: cb => cb(new Error('exited')),
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
    hostProcess = makeHostProcess(CONNECTION_LINE);
    sessionStdout = '0';
    mockedSleep.mockResolvedValue(undefined);
    mockedFs.access.mockResolvedValue(undefined as never);
    mockedFs.mkdtemp.mockResolvedValue('/tmp/eas-ssh-1' as never);
    mockedFs.writeFile.mockResolvedValue(undefined as never);
    mockedFs.rm.mockResolvedValue(undefined as never);
    mockedFs.readdir.mockResolvedValue([] as never);
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
      hostProcess = makeHostProcess(null);
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
    it('returns 0 when no admin socket exists yet', async () => {
      mockedFs.readdir.mockResolvedValue([] as never);
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      expect(await host.getConnectedClientCountAsync()).toBe(0);
    });

    it('returns the client count reported by the admin socket', async () => {
      mockedFs.readdir.mockResolvedValue(['default.sock'] as never);
      sessionStdout = '4';
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      expect(await host.getConnectedClientCountAsync()).toBe(4);
    });

    it('returns null (unknown) when the count query fails', async () => {
      mockedFs.readdir.mockResolvedValue(['default.sock'] as never);
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      mockedSpawn.mockImplementation((() => Promise.reject(new Error('socket gone'))) as never);
      expect(await host.getConnectedClientCountAsync()).toBeNull();
    });

    it('returns null (unknown) when the reported count is not a number', async () => {
      mockedFs.readdir.mockResolvedValue(['default.sock'] as never);
      sessionStdout = 'not-a-number';
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      expect(await host.getConnectedClientCountAsync()).toBeNull();
    });

    it('returns 0 when the socket dir cannot be read', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      mockedFs.readdir.mockRejectedValue(new Error('no dir') as never);
      expect(await host.getConnectedClientCountAsync()).toBe(0);
    });
  });
});
