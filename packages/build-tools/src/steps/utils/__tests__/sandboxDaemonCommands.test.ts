jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');
jest.unmock('@expo/logger');

import {
  type SandboxDaemonCommandResult,
  type SandboxDaemonMethod,
  SandboxDaemonResponseZ,
} from '@expo/eas-build-job';
import fs from 'node:fs/promises';
import Log from '@expo/logger';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';

import { startSandboxDaemonAsync } from '../sandboxDaemon';

describe('sandbox daemon commands', () => {
  let sendCommandAsync: (
    method: SandboxDaemonMethod,
    params: unknown
  ) => Promise<SandboxDaemonCommandResult<SandboxDaemonMethod>>;
  let stopAsync: () => Promise<void>;
  let workingDirectory: string;

  beforeEach(async () => {
    workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-command-executor-'));
    ({ sendCommandAsync, stopAsync } = await startTestDaemonAsync(workingDirectory));
  });

  afterEach(async () => {
    await stopAsync();
    await fs.chmod(workingDirectory, 0o700);
    await fs.rm(workingDirectory, { recursive: true, force: true });
  });

  it('returns output and the exit code for a completed command', async () => {
    const result = await sendCommandAsync('execCommand', { cmd: 'printf hello' });

    expect(result).toMatchObject({ output: 'hello', exitCode: 0 });
    expect('sessionId' in result).toBe(false);
  });

  it('returns a session id and accepts stdin for a running command', async () => {
    const started = await sendCommandAsync('execCommand', {
      cmd: `node -e "process.stdin.once('data', data => process.stdout.write(data.toString().toUpperCase(), () => process.exit(0)))"`,
      yieldTimeMs: 10,
    });
    const sessionId = getSessionId(started);

    const completed = await sendCommandAsync('writeStdin', {
      sessionId,
      chars: 'hello',
      yieldTimeMs: 1_000,
    });

    expect(completed).toMatchObject({ output: 'HELLO', exitCode: 0 });
    expect('sessionId' in completed).toBe(false);
  });

  it('returns only output produced since the previous call', async () => {
    const started = await sendCommandAsync('execCommand', {
      cmd: `node -e "console.log('first'); setTimeout(() => console.log('second'), 100)"`,
      yieldTimeMs: 50,
    });
    const sessionId = getSessionId(started);

    expect(started).toMatchObject({ output: 'first\n' });
    const completed = await sendCommandAsync('writeStdin', { sessionId, yieldTimeMs: 1_000 });

    expect(completed).toMatchObject({ output: 'second\n', exitCode: 0 });
  });

  it('provides a TTY when requested', async () => {
    const result = await sendCommandAsync('execCommand', {
      cmd: 'test -t 0 && test -t 1 && test -t 2',
      tty: true,
    });

    expect(result).toMatchObject({ exitCode: 0 });
  });

  it('uses pipes by default', async () => {
    const result = await sendCommandAsync('execCommand', { cmd: 'test -t 0' });

    expect(result).toMatchObject({ exitCode: 1 });
  });

  it('sends Ctrl+C to the foreground PTY process', async () => {
    const started = await sendCommandAsync('execCommand', {
      cmd: `node -e "process.on('SIGINT', () => { console.log('interrupted'); process.exit(0); }); setInterval(() => {}, 1000)"`,
      tty: true,
      yieldTimeMs: 50,
    });

    const completed = await sendCommandAsync('writeStdin', {
      sessionId: getSessionId(started),
      chars: '\u0003',
      yieldTimeMs: 1_000,
    });

    expect(completed.output).toContain('interrupted');
    expect(completed).toMatchObject({ exitCode: 0 });
  });

  it('writes U+0003 as literal input in pipe mode', async () => {
    const started = await sendCommandAsync('execCommand', {
      cmd: `node -e "process.stdin.once('data', data => { console.log(data[0]); process.exit(0); })"`,
      yieldTimeMs: 10,
    });

    const completed = await sendCommandAsync('writeStdin', {
      sessionId: getSessionId(started),
      chars: '\u0003',
      yieldTimeMs: 1_000,
    });

    expect(completed).toMatchObject({ output: '3\n', exitCode: 0 });
  });

  it('reports a termination signal without an exit code', async () => {
    const result = await sendCommandAsync('execCommand', { cmd: 'kill -TERM $$' });

    expect(result).toMatchObject({ terminationSignal: 'SIGTERM' });
    expect('exitCode' in result).toBe(false);
  });

  it('measures the duration of each API call', async () => {
    const started = await sendCommandAsync('execCommand', {
      cmd: `node -e "setTimeout(() => {}, 100)"`,
      yieldTimeMs: 1,
    });
    await setTimeoutAsync(200);

    const completed = await sendCommandAsync('writeStdin', {
      sessionId: getSessionId(started),
      yieldTimeMs: 0,
    });

    expect(completed).toMatchObject({ exitCode: 0 });
    expect(completed.wallTimeSeconds).toBeLessThan(0.1);
  });

  it('uses the requested working directory', async () => {
    const childDirectory = path.join(workingDirectory, 'child');
    await fs.mkdir(childDirectory);

    const result = await sendCommandAsync('execCommand', { cmd: 'pwd', workdir: 'child' });

    expect(result).toMatchObject({ output: `${await fs.realpath(childDirectory)}\n`, exitCode: 0 });
  });

  it('reports a missing working directory', async () => {
    await expect(
      sendCommandAsync('execCommand', { cmd: 'true', workdir: 'missing' })
    ).rejects.toThrow(
      `Working directory does not exist: ${path.join(workingDirectory, 'missing')}`
    );
  });

  it('reports a working directory that is not a directory', async () => {
    const file = path.join(workingDirectory, 'file');
    await fs.writeFile(file, 'content');

    await expect(sendCommandAsync('execCommand', { cmd: 'true', workdir: 'file' })).rejects.toThrow(
      `Working directory is not a directory: ${file}`
    );
  });

  it('reports an inaccessible working directory', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directory = path.join(workingDirectory, 'inaccessible');
    await fs.mkdir(directory, 0o000);

    await expect(
      sendCommandAsync('execCommand', { cmd: 'true', workdir: 'inaccessible' })
    ).rejects.toThrow(`Working directory is not accessible: ${directory}`);

    await fs.chmod(directory, 0o700);
  });

  it.each([false, true])('stops command descendants when tty is %s', async tty => {
    const started = await sendCommandAsync('execCommand', {
      cmd: `node -e "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(child.pid); setInterval(() => {}, 1000)"`,
      tty,
      yieldTimeMs: 100,
    });
    const childPid = Number(/\d+/.exec(started.output)?.[0]);
    expect(childPid).toBeGreaterThan(0);

    await stopAsync();
    await setTimeoutAsync(50);

    expect(isProcessRunning(childPid)).toBe(false);
  });
});

function getSessionId(result: unknown): number {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('sessionId' in result) ||
    typeof result.sessionId !== 'number'
  ) {
    throw new Error('Expected the command to still be running.');
  }
  return result.sessionId;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

async function startTestDaemonAsync(workingDirectory: string): Promise<{
  sendCommandAsync: (
    method: SandboxDaemonMethod,
    params: unknown
  ) => Promise<SandboxDaemonCommandResult<SandboxDaemonMethod>>;
  stopAsync: () => Promise<void>;
}> {
  const httpServer = http.createServer();
  const server = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (request, socket, head) => {
    server.handleUpgrade(request, socket, head, client => server.emit('connection', client));
  });
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address() as AddressInfo;
  const connection = new Promise<WebSocket>(resolve => server.once('connection', resolve));
  const daemon = await startSandboxDaemonAsync({
    credential: 'secret-token',
    serverUrl: `ws://127.0.0.1:${address.port}`,
    reconnectDelayMs: 10,
    logger: Log,
    workingDirectory,
  });
  const socket = await connection;
  await daemon.ready;
  let nextRequestId = 1;
  const pending = new Map<
    string,
    {
      resolve: (result: SandboxDaemonCommandResult<SandboxDaemonMethod>) => void;
      reject: (error: Error) => void;
    }
  >();
  socket.on('message', message => {
    const response = SandboxDaemonResponseZ.parse(JSON.parse(message.toString()));
    const request = pending.get(response.id);
    if (!request) {
      return;
    }
    pending.delete(response.id);
    if ('error' in response) {
      request.reject(new Error(response.error.message));
    } else {
      request.resolve(response.result as SandboxDaemonCommandResult<SandboxDaemonMethod>);
    }
  });

  let stopped = false;
  return {
    sendCommandAsync: async (method, params) => {
      const id = String(nextRequestId++);
      const result = new Promise<SandboxDaemonCommandResult<SandboxDaemonMethod>>(
        (resolve, reject) => {
          pending.set(id, { resolve, reject });
        }
      );
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      return await result;
    },
    stopAsync: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await daemon.stopAsync();
      server.close();
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
    },
  };
}
