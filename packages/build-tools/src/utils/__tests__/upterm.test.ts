import downloadFile from '@expo/downloader';
import spawn from '@expo/turtle-spawn';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { sleepAsync } from '../retry';
import {
  redactConnectionSecrets,
  resolveUptermGcsObjectName,
  startUptermHostAsync,
} from '../upterm';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@expo/downloader', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../retry', () => ({ sleepAsync: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  __esModule: true,
  default: {
    chmod: jest.fn(),
    mkdtemp: jest.fn(),
    writeFile: jest.fn(),
    rm: jest.fn(),
  },
}));

const SESSION_ID = 'pJbIEKJ3dhB4qIUMoNku';

const DETACH_JSON = JSON.stringify(
  {
    name: 'eas-1a2b3c4',
    launchId: '71c3af039c2557ea',
    status: 'ready',
    sessionId: SESSION_ID,
    adminSocket: '/tmp/eas-ssh-1/upterm/sessions/eas-1a2b3c4/admin.sock',
    attachSocket: '/tmp/eas-ssh-1/upterm/sessions/eas-1a2b3c4/attach.sock',
    pid: 73366,
    command: 'bash -lc sleep 21600',
    forceCommand: '/tmp/eas-ssh-1/join.sh',
    sshCommand: `ssh ${SESSION_ID}@relay.expo.dev -p 2222`,
    joinCommand: `upterm join ssh://${SESSION_ID}@relay.expo.dev:2222`,
    sshConfig: `Host eas-1a2b3c4\n  HostName relay.expo.dev\n  User ${SESSION_ID}\n  Port 2222`,
    host: 'ssh://relay.expo.dev:2222',
    clientCount: 0,
    guestCount: 0,
    reconnect: 'supported',
  },
  null,
  2
);

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

describe(redactConnectionSecrets, () => {
  it('strips the session id from every field of the --detach JSON output', () => {
    const redacted = redactConnectionSecrets(DETACH_JSON);
    expect(redacted).not.toContain(SESSION_ID);
    expect(redacted).toContain('"sshCommand": "ssh <redacted>@relay.expo.dev -p 2222"');
    expect(redacted).toContain('User <redacted>');
  });

  it('strips control characters (incl. ESC) while keeping newlines', () => {
    // ESC alone is enough to neutralize CSI; leftover printable "[31m" is harmless in logs.
    expect(redactConnectionSecrets('ok\n\u001b[31mfail\u001b[0m\r\nbad\u0007')).toBe(
      'ok\n[31mfail[0m\nbad'
    );
  });
});

describe(startUptermHostAsync, () => {
  const mockedSpawn = jest.mocked(spawn);
  const mockedFs = jest.mocked(fs);
  const mockedDownloadFile = jest.mocked(downloadFile);

  type SpawnCall = { cmd: string; args: string[]; options: any };
  let calls: SpawnCall[];
  let hostResult: () => Promise<{ stdout: string; stderr: string }>;
  let currentResult: () => Promise<{ stdout: string; stderr: string }>;
  let stopResult: () => Promise<{ stdout: string; stderr: string }>;
  let daemonRunning: boolean;
  let uptermOnPath: boolean;

  function ok(stdout: string): () => Promise<{ stdout: string; stderr: string }> {
    return async () => ({ stdout, stderr: '' });
  }

  function current(fields: Record<string, unknown>): string {
    return JSON.stringify({ sessionId: SESSION_ID, host: 'ssh://relay.expo.dev:2222', ...fields });
  }

  function makeCtx(
    env: Record<string, string> = {},
    buildDirectory = '/workingdir/build'
  ): BuildContext {
    return {
      logger: createMockLogger(),
      env,
      buildDirectory,
    } as unknown as BuildContext;
  }

  function callsOf(...prefix: string[]): SpawnCall[] {
    return calls.filter(c => prefix.every((arg, i) => c.args[i] === arg));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    calls = [];
    daemonRunning = true;
    uptermOnPath = false;
    hostResult = ok(DETACH_JSON);
    currentResult = ok(current({ status: 'ready', guestCount: 0 }));
    stopResult = ok('session eas-1a2b3c4 stopped\n');
    jest.spyOn(process, 'kill').mockImplementation(() => {
      if (daemonRunning) {
        return true;
      }
      throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
    });
    jest.mocked(sleepAsync).mockResolvedValue(undefined);
    mockedFs.chmod.mockResolvedValue(undefined as never);
    mockedFs.mkdtemp.mockImplementation((async (prefix: string) =>
      String(prefix).includes('eas-upterm') ? '/tmp/eas-upterm-1' : '/tmp/eas-ssh-1') as never);
    mockedFs.writeFile.mockResolvedValue(undefined as never);
    mockedFs.rm.mockResolvedValue(undefined as never);
    mockedDownloadFile.mockResolvedValue(undefined as never);
    mockedSpawn.mockImplementation(((cmd: string, args: string[], options: unknown) => {
      calls.push({ cmd, args, options });
      if (cmd === 'upterm' && args[0] === 'version') {
        return uptermOnPath
          ? Promise.resolve({ stdout: 'Upterm version 0.0.0', stderr: '' })
          : Promise.reject(new Error('spawn upterm ENOENT'));
      }
      if (args[0] === 'host') {
        return hostResult();
      }
      if (args[0] === 'session' && args[1] === 'current') {
        return currentResult();
      }
      if (args[0] === 'session' && args[1] === 'stop') {
        return stopResult();
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts a detached session under a short unique name and takes the session id from its JSON', async () => {
    const host = await startUptermHostAsync(makeCtx({ CUSTOM: '1' }), {
      relayServerUrl: 'wss://relay.expo.dev',
    });
    await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://relay.expo.dev' });

    expect(host.connectionConfig).toEqual({ type: 'upterm-v1', secret: SESSION_ID });
    const [first, second] = callsOf('host');
    const nameOf = (call: SpawnCall): string => call.args[call.args.indexOf('--name') + 1];
    expect(nameOf(first).length).toBeLessThanOrEqual(11);
    expect(nameOf(first)).not.toBe(nameOf(second));
    expect(first.args).toEqual(
      expect.arrayContaining(['--accept', '--detach', '--output', 'json'])
    );
    expect(first.args.slice(first.args.indexOf('--'))).toEqual([
      '--',
      'bash',
      '-lc',
      'sleep 21600',
    ]);
    expect(first.options).toMatchObject({
      env: { CUSTOM: '1', XDG_RUNTIME_DIR: '/tmp/eas-ssh-1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('reports whether the session was already reconnecting when it started', async () => {
    hostResult = ok(DETACH_JSON.replace('"status": "ready"', '"status": "reconnecting"'));
    const reconnecting = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
    hostResult = ok(DETACH_JSON);
    const ready = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });

    expect(reconnecting.startedReconnecting).toBe(true);
    expect(ready.startedReconnecting).toBe(false);
  });

  it('downloads upterm from GCS even when one is on PATH', async () => {
    uptermOnPath = true;

    await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://relay.expo.dev' });

    expect(calls.some(c => c.cmd === 'upterm')).toBe(false);
    expect(mockedDownloadFile).toHaveBeenCalledWith(
      'https://storage.googleapis.com/turtle-v2/upterm/' + resolveUptermGcsObjectName(),
      expect.stringContaining('/tmp/eas-upterm-1'),
      expect.objectContaining({ retry: 3 })
    );
    expect(callsOf('host')[0].cmd).toContain('/tmp/eas-upterm-1');
  });

  it('starts each client shell in the build directory', async () => {
    const realFs = jest.requireActual<typeof import('node:fs')>('node:fs');
    const tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'eas-upterm-join-'));
    try {
      const buildDirectory = path.join(tmpDir, "it's $HOME `pwd`", 'build');
      realFs.mkdirSync(buildDirectory, { recursive: true });

      await startUptermHostAsync(makeCtx({}, buildDirectory), { relayServerUrl: 'wss://r' });

      const joinScriptCall = mockedFs.writeFile.mock.calls.find(
        ([file]) => file === '/tmp/eas-ssh-1/join.sh'
      );
      const joinScriptPath = path.join(tmpDir, 'join.sh');
      realFs.writeFileSync(joinScriptPath, String(joinScriptCall?.[1]));
      const result = spawnSync('bash', [joinScriptPath], {
        cwd: tmpDir,
        env: { PATH: process.env.PATH, HOME: tmpDir },
        input: 'pwd\n',
        encoding: 'utf8',
      });

      expect(result.stdout.trim()).toBe(buildDirectory);
    } finally {
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs the client's command in the build directory and returns its exit status", async () => {
    const realFs = jest.requireActual<typeof import('node:fs')>('node:fs');
    const tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'eas-upterm-join-'));
    try {
      const buildDirectory = path.join(tmpDir, "it's $HOME `pwd`", 'build');
      realFs.mkdirSync(buildDirectory, { recursive: true });

      await startUptermHostAsync(makeCtx({}, buildDirectory), { relayServerUrl: 'wss://r' });

      const joinScriptCall = mockedFs.writeFile.mock.calls.find(
        ([file]) => file === '/tmp/eas-ssh-1/join.sh'
      );
      const joinScriptPath = path.join(tmpDir, 'join.sh');
      realFs.writeFileSync(joinScriptPath, String(joinScriptCall?.[1]));
      const result = spawnSync('bash', [joinScriptPath], {
        cwd: tmpDir,
        env: { PATH: process.env.PATH, HOME: tmpDir, SSH_ORIGINAL_COMMAND: 'pwd; exit 3' },
        input: '',
        encoding: 'utf8',
      });

      expect(result.stdout.trim()).toBe(buildDirectory);
      expect(result.status).toBe(3);
    } finally {
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('downloads through the cache proxy when one is configured', async () => {
    await startUptermHostAsync(
      makeCtx({ EAS_BUILD_COCOAPODS_CACHE_URL: 'http://10.0.0.1:8081/repository/proxy' }),
      { relayServerUrl: 'wss://relay.expo.dev' }
    );

    expect(mockedDownloadFile).toHaveBeenCalledTimes(1);
    expect(mockedDownloadFile).toHaveBeenCalledWith(
      expect.stringMatching(
        /^http:\/\/10\.0\.0\.1:8081\/repository\/proxy\/storage\.googleapis\.com\/turtle-v2\/upterm\/upterm-/
      ),
      expect.stringContaining('/tmp/eas-upterm-1'),
      expect.objectContaining({ retry: 3 })
    );
  });

  it('falls back to the direct URL when the proxied download fails', async () => {
    mockedDownloadFile.mockRejectedValueOnce(new Error('502 Bad Gateway') as never);

    await startUptermHostAsync(
      makeCtx({ EAS_BUILD_COCOAPODS_CACHE_URL: 'http://10.0.0.1:8081/repository/proxy' }),
      { relayServerUrl: 'wss://relay.expo.dev' }
    );

    expect(mockedDownloadFile).toHaveBeenCalledTimes(2);
    expect(mockedDownloadFile).toHaveBeenLastCalledWith(
      expect.stringMatching(/^https:\/\/storage\.googleapis\.com\/turtle-v2\/upterm\/upterm-/),
      expect.stringContaining('/tmp/eas-upterm-1'),
      expect.objectContaining({ retry: 3 })
    );
  });

  it('names the direct URL when both the proxied and the direct download fail', async () => {
    mockedDownloadFile.mockRejectedValue(new Error('403 Forbidden') as never);

    await expect(
      startUptermHostAsync(
        makeCtx({ EAS_BUILD_COCOAPODS_CACHE_URL: 'http://10.0.0.1:8081/repository/proxy' }),
        { relayServerUrl: 'wss://r' }
      )
    ).rejects.toThrow(/could not be downloaded from https:\/\/storage\.googleapis\.com/);
  });

  it('still throws when download fails with a non-Error and temp cleanup also fails', async () => {
    mockedDownloadFile.mockRejectedValue('network down' as never);
    mockedFs.rm.mockRejectedValue(new Error('EPERM') as never);

    await expect(startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' })).rejects.toThrow(
      /network down/
    );
  });

  it('stops the session and removes the state and download dirs when upterm cannot start it', async () => {
    hostResult = () =>
      Promise.reject(
        Object.assign(new Error('upterm exited with non-zero code: 1'), {
          status: 1,
          signal: null,
          stdout: '',
          stderr:
            'upterm: session eas-3418b73 could not start: ssh://127.0.0.1:32222: Permission denied (publickey); the 1 identity offered was refused.',
        })
      );

    const error = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' }).catch(
      e => e
    );

    expect(error.message).toMatch(/could not register with the relay/);
    expect(error.message).toContain('Permission denied (publickey)');
    expect(callsOf('session', 'stop')).toHaveLength(1);
    expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-ssh-1', expect.anything());
    expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-upterm-1', expect.anything());
  });

  it('reports a start that ran into its timeout as not registered in time', async () => {
    hostResult = () =>
      Promise.reject(
        Object.assign(new Error('upterm exited with signal: SIGTERM'), {
          status: null,
          signal: 'SIGTERM',
          stdout: '',
          stderr: '',
        })
      );

    await expect(startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' })).rejects.toThrow(
      /did not register with the relay within 60s/
    );
    expect(callsOf('host')[0].options).toMatchObject({ timeout: 60_000 });
  });

  it('stops a session whose start JSON says guests cannot reach it', async () => {
    hostResult = ok(DETACH_JSON.replace('"status": "ready"', '"status": "disconnected"'));

    const error = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' }).catch(
      e => e
    );

    expect(error.message).toMatch(/did not report a usable session/);
    expect(error.message).not.toContain(SESSION_ID);
    expect(callsOf('session', 'stop')).toHaveLength(1);
  });

  it('stopAsync stops the session by name with the start environment and removes the state and download dirs', async () => {
    const host = await startUptermHostAsync(makeCtx({ CUSTOM: '1' }), {
      relayServerUrl: 'wss://r',
    });
    await host.stopAsync();

    const name = callsOf('host')[0].args[callsOf('host')[0].args.indexOf('--name') + 1];
    const [stop] = callsOf('session', 'stop');
    expect(stop.args).toEqual(['session', 'stop', name]);
    expect(stop.options.env).toMatchObject({ CUSTOM: '1', XDG_RUNTIME_DIR: '/tmp/eas-ssh-1' });
    expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-ssh-1', expect.anything());
    expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-upterm-1', expect.anything());
  });

  it('stopAsync throws the stop output but still removes the state and download dirs when the stop fails', async () => {
    const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
    stopResult = () =>
      Promise.reject(
        Object.assign(new Error('exited with non-zero code: 1'), {
          stdout: '',
          stderr: "upterm: session eas-1a2b3c4 isn't answering on its admin socket (pid 73366)",
        })
      );

    await expect(host.stopAsync()).rejects.toThrow(/isn't answering on its admin socket/);
    expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-ssh-1', expect.anything());
    expect(mockedFs.rm).toHaveBeenCalledWith('/tmp/eas-upterm-1', expect.anything());
  });

  describe('readStatusAsync', () => {
    it('reads the status and client count from the admin socket the start JSON named', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      currentResult = ok(current({ status: 'reconnecting', guestCount: 2 }));

      expect(await host.readStatusAsync()).toEqual({
        state: 'reconnecting',
        connectedClientCount: 2,
      });
      expect(callsOf('session', 'current')[0].args).toEqual([
        'session',
        'current',
        '--admin-socket',
        '/tmp/eas-ssh-1/upterm/sessions/eas-1a2b3c4/admin.sock',
        '--output',
        'json',
      ]);
    });

    it("counts guests only, not the session's own terminals", async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      currentResult = ok(current({ status: 'ready', clientCount: 1, guestCount: 0 }));

      expect(await host.readStatusAsync()).toEqual({ state: 'ready', connectedClientCount: 0 });
    });

    it.each([
      [
        { status: 'disconnected', tunnelReason: 'reconnect_unsupported' },
        'disconnected (reconnect_unsupported)',
      ],
      [{ status: 'ending' }, 'ending'],
    ])('treats %j as gone for good', async (fields, reason) => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      currentResult = ok(current({ guestCount: 0, ...fields }));

      expect(await host.readStatusAsync()).toEqual({ state: 'gone', reason });
    });

    it.each([
      'relay_key_changed',
      'auth_refused',
      'proof_refused',
      'agent_refused',
      'relay_unsupported',
    ])('treats a reconnect blocked by %s as gone for good', async tunnelReason => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      currentResult = ok(current({ status: 'reconnecting', tunnelReason, guestCount: 0 }));

      expect(await host.readStatusAsync()).toEqual({
        state: 'gone',
        reason: `reconnecting (${tunnelReason})`,
      });
    });

    it.each(['network', 'relay_error', 'agent_unavailable'])(
      'keeps a session reconnecting after %s',
      async tunnelReason => {
        const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
        currentResult = ok(current({ status: 'reconnecting', tunnelReason, guestCount: 0 }));

        expect(await host.readStatusAsync()).toEqual({
          state: 'reconnecting',
          connectedClientCount: 0,
        });
      }
    );

    it('reports the session as gone when the read fails and the session process has exited', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      currentResult = () => Promise.reject(new Error('exited with non-zero code: 4'));
      daemonRunning = false;

      expect(await host.readStatusAsync()).toEqual({
        state: 'gone',
        reason: 'the upterm session process exited',
      });
      expect(process.kill).toHaveBeenCalledWith(73366, 0);
    });

    it('retries a failed read while the session process runs, then throws', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      currentResult = () => Promise.reject(new Error('deadline exceeded'));

      await expect(host.readStatusAsync()).rejects.toThrow(/client count/i);
      expect(callsOf('session', 'current')).toHaveLength(4);
    });

    it('does not guess at a status it does not know', async () => {
      const host = await startUptermHostAsync(makeCtx(), { relayServerUrl: 'wss://r' });
      currentResult = ok(current({ status: 'starting', guestCount: 0 }));

      await expect(host.readStatusAsync()).rejects.toThrow(/client count/i);
    });
  });
});
