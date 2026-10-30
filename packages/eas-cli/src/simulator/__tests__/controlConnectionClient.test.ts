import * as fs from 'fs-extra';
import { ChildProcess, fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Socket, createConnection, createServer } from 'node:net';

import { DeviceRunSessionStatus } from '../../graphql/generated';
import {
  assertControlKeepAliveSupported,
  borrowControlConnectionAsync,
  createControlConnectionIdentityAsync,
  inspectControlConnectionAsync,
  openControlConnectionAsync,
} from '../controlConnection';
import {
  CONTROL_BOOTSTRAP_TIMEOUT_MS,
  CONTROL_SETUP_TIMEOUT_MS,
  ControlConnectionChannel,
  ControlConnectionInfo,
} from '../controlConnectionProtocol';

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  fork: jest.fn(),
}));
jest.mock('node:net', () => {
  const actual = jest.requireActual<typeof import('node:net')>('node:net');
  return { ...actual, createConnection: jest.fn(actual.createConnection) };
});

describe('control connection client failures', () => {
  let dir: string;
  let identity: Awaited<ReturnType<typeof createControlConnectionIdentityAsync>>;
  const info: ControlConnectionInfo = {
    version: 3,
    pid: 123,
    session: {
      id: 'session-one',
      name: null,
      project: '@fixture/app',
      status: DeviceRunSessionStatus.InProgress,
      device: { udid: 'device-one' },
    },
    idleTimeoutMs: 120_000,
    idleDeadline: null,
    busy: false,
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp('/tmp/ctl-client-');
    identity = await createControlConnectionIdentityAsync(
      'session-one',
      dir,
      { accessToken: 'fixture', sessionSecret: null },
      dir
    );
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest
      .mocked(createConnection)
      .mockImplementation(jest.requireActual('node:net').createConnection);
    await fs.remove(dir);
  });

  it('keeps cold commands available on Windows while refusing keep-alive', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(assertControlKeepAliveSupported).toThrow('macOS and Linux');
      await expect(borrowControlConnectionAsync(identity)).resolves.toBeNull();
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  });

  it('requires a nonempty credential for helper discovery', async () => {
    await expect(
      createControlConnectionIdentityAsync('session-one', dir, {
        accessToken: '',
        sessionSecret: null,
      })
    ).rejects.toThrow('Sign in');
  });

  it.each(['error', 'exit', 'timeout'] as const)(
    'cleans up failed bootstrap after a child %s',
    async failure => {
      let sent!: () => void;
      const sentBootstrap = new Promise<void>(resolve => {
        sent = resolve;
      });
      const child = Object.assign(new EventEmitter(), {
        connected: true,
        exitCode: null as number | null,
        signalCode: null,
        send: jest.fn(() => {
          sent();
          if (failure === 'exit') {
            child.exitCode = 1;
          }
          if (failure !== 'timeout') {
            child.emit(failure, failure === 'error' ? new Error('spawn failed') : 1);
          }
        }),
        kill: jest.fn(),
        disconnect: jest.fn(),
        unref: jest.fn(),
      });
      jest.mocked(fork).mockReturnValueOnce(child as unknown as ChildProcess);
      const opening = openControlConnectionAsync(identity, async () => {
        if (failure === 'timeout') {
          jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        }
        return {
          access: { apiUrl: 'http://fixture.invalid', token: 'fixture' },
          session: info.session,
        };
      });
      const rejected = expect(opening).rejects.toThrow(
        failure === 'error'
          ? 'Could not start'
          : failure === 'exit'
            ? 'exited during setup'
            : 'did not become ready'
      );
      await sentBootstrap;
      if (failure === 'timeout') {
        jest.advanceTimersByTime(CONTROL_BOOTSTRAP_TIMEOUT_MS);
      }
      await rejected;
      expect(child.kill).toHaveBeenCalledTimes(failure === 'exit' ? 0 : 1);
      expect(child.disconnect).toHaveBeenCalledTimes(1);
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(await fs.pathExists(identity.socketPath + '.lock')).toBe(false);
    }
  );

  it.each(['timeout', 'EACCES'] as const)(
    'rejects an unavailable local transport (%s) without silently running cold',
    async failure => {
      const server = createServer();
      await new Promise<void>(resolve => server.listen(identity.socketPath, resolve));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const socket = new Socket();
      let connecting!: () => void;
      const started = new Promise<void>(resolve => {
        connecting = resolve;
      });
      jest.mocked(createConnection).mockImplementationOnce(() => {
        connecting();
        return socket;
      });
      try {
        const pending = inspectControlConnectionAsync(identity);
        const rejected = expect(pending).rejects.toThrow(
          failure === 'timeout' ? 'timed out' : 'denied'
        );
        await started;
        if (failure === 'timeout') {
          jest.advanceTimersByTime(CONTROL_SETUP_TIMEOUT_MS);
        } else {
          socket.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' }));
        }
        await rejected;
        expect(socket.destroyed).toBe(true);
      } finally {
        socket.destroy();
        jest.useRealTimers();
        await new Promise<void>(resolve =>
          server.close(() => {
            resolve();
          })
        );
      }
    }
  );

  it('serves the cached catalog and refuses a mismatched reply without replaying', async () => {
    const requests: unknown[] = [];
    const catalog = { 'clipboard.read': { type: 'object' } };
    const server = createServer(socket => {
      const channel = new ControlConnectionChannel(socket);
      void (async () => {
        await channel.readAsync();
        await channel.writeAsync({ info, catalog });
        requests.push(await channel.readAsync());
        await channel.writeAsync({ id: 99, stdout: '', stderr: '', exitCode: 0 });
      })().catch(error => {
        channel.destroy(error);
      });
    });
    await new Promise<void>(resolve => server.listen(identity.socketPath, resolve));
    const borrowed = await borrowControlConnectionAsync(identity);
    try {
      expect(borrowed).not.toBeNull();
      await expect(borrowed!.connection.requestAsync('actions.describe')).resolves.toMatchObject({
        stdout: JSON.stringify(catalog),
      });
      expect(requests).toEqual([]);
      await expect(borrowed!.connection.requestAsync('clipboard.read')).rejects.toThrow(
        'did not match'
      );
      expect(requests).toEqual([{ id: 1, action: 'clipboard.read', params: {} }]);
    } finally {
      borrowed?.connection.close();
      await new Promise<void>(resolve =>
        server.close(() => {
          resolve();
        })
      );
    }
  });
});
