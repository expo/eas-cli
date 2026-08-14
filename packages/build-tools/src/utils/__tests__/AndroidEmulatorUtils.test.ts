import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createMockLogger } from '../../__tests__/utils/logger';
import { AndroidEmulatorUtils, AndroidVirtualDeviceName } from '../AndroidEmulatorUtils';
import { retryAsync } from '../retry';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../retry', () => ({
  retryAsync: jest.fn(async fn => await fn(0)),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedRetryAsync = jest.mocked(retryAsync);

describe('AndroidEmulatorUtils', () => {
  let temporaryDirectories: string[] = [];

  beforeEach(() => {
    temporaryDirectories = [];
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mockedRetryAsync.mockImplementation(async fn => await fn(0));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      temporaryDirectories.map(async temporaryDirectory => {
        await fs.promises.rm(temporaryDirectory, { force: true, recursive: true });
      })
    );
  });

  describe(AndroidEmulatorUtils.startAsync, () => {
    function mockSuccessfulStart(deviceName: AndroidVirtualDeviceName) {
      const child = Object.assign(new EventEmitter(), {
        pid: 1234,
        unref: jest.fn(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      const spawnPromise = Promise.resolve({ stdout: '', stderr: '' }) as any;
      spawnPromise.child = child;
      mockedSpawn.mockImplementation(((command: string, args: string[]) => {
        if (command.endsWith('/emulator/emulator')) {
          return spawnPromise;
        }
        if (command === 'adb' && args[0] === 'devices') {
          return Promise.resolve({ stdout: 'emulator-5554\tdevice\n', stderr: '' });
        }
        if (command === 'adb' && args[0] === '-s' && args[2] === 'emu') {
          return Promise.resolve({ stdout: `${deviceName}\nOK\n`, stderr: '' });
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }) as any);
      return { child };
    }

    it('captures logcat and emulator process output', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      const { child } = mockSuccessfulStart(deviceName);
      const createWriteStreamSpy = jest.spyOn(fs, 'createWriteStream');

      const result = await AndroidEmulatorUtils.startAsync({
        deviceName,
        env: process.env,
        logcatDirectory: outputDir,
      });

      expect(result.logcatOutputPath).toMatch(
        new RegExp(`^${outputDir}/eas-simulator-[a-f0-9]{8}-[a-f0-9]{4}-logcat\\.log$`)
      );
      expect(result.emulatorOutputPath).toMatch(
        new RegExp(`^${outputDir}/eas-simulator-[a-f0-9]{8}-[a-f0-9]{4}-emulator\\.log$`)
      );
      await expect(fs.promises.access(result.logcatOutputPath)).resolves.toBeUndefined();
      await expect(fs.promises.access(result.emulatorOutputPath)).resolves.toBeUndefined();
      expect(mockedSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/\/emulator\/emulator$/),
        expect.arrayContaining(['-logcat', '*:v', '-logcat-output', result.logcatOutputPath]),
        expect.objectContaining({
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          ignoreStdio: true,
        })
      );
      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'adb',
        expect.arrayContaining(['logcat']),
        expect.anything()
      );
      expect(child.unref).toHaveBeenCalled();
      const emulatorOutputStream = createWriteStreamSpy.mock.results[0].value;
      const emulatorOutputStreamClosed = once(emulatorOutputStream, 'close');
      child.emit('close');
      await emulatorOutputStreamClosed;
    });

    it('throws a SystemError when the staging directory cannot be prepared', async () => {
      const outputDir = '/unwritable/logcat-staging';
      const deviceName = 'eas-simulator' as AndroidVirtualDeviceName;
      const mkdirError = new Error('mkdir failed');
      const mkdirSpy = jest.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(mkdirError);

      try {
        await expect(
          AndroidEmulatorUtils.startAsync({
            deviceName,
            env: process.env,
            logcatDirectory: outputDir,
          })
        ).rejects.toEqual(
          new SystemError('Failed to prepare Android emulator output for eas-simulator.', {
            cause: mkdirError,
          })
        );
        expect(mockedSpawn).not.toHaveBeenCalled();
      } finally {
        mkdirSpy.mockRestore();
      }
    });
  });

  describe(AndroidEmulatorUtils.waitForReadyAsync, () => {
    it('checks boot completion and verifies network with netcat to 1.1.1.1:443', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'nc' && args[6] === '1.1.1.1' && args[7] === '443') {
          return { stdout: '', stderr: '' } as any;
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId: 'emulator-5554' as any,
        env: process.env,
        timeoutMs: 60_000,
      });

      expect(mockedRetryAsync).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          retryOptions: expect.objectContaining({
            retries: 59,
            retryIntervalMs: 1_000,
          }),
        })
      );
      expect(mockedSpawn).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'nc', '-w', '1', '1.1.1.1', '443'],
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    });

    it('throws when network is unavailable despite completed boot', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'nc') {
          throw new Error('network unreachable');
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await expect(
        AndroidEmulatorUtils.waitForReadyAsync({
          serialId: 'emulator-5554' as any,
          env: process.env,
        })
      ).rejects.toThrow('network is not ready');
    });

    it('uses overridden network readiness command when provided', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'exit 0') {
          return { stdout: '', stderr: '' } as any;
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId: 'emulator-5554' as any,
        env: {
          ...process.env,
          ANDROID_EMULATOR_NETWORK_READY_COMMAND: 'exit 0',
        },
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'exit 0'],
        expect.objectContaining({
          env: expect.objectContaining({
            ANDROID_EMULATOR_NETWORK_READY_COMMAND: 'exit 0',
          }),
        })
      );
      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'nc', '-w', '1', '1.1.1.1', '443'],
        expect.anything()
      );
    });
  });

  describe(AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync, () => {
    it('sets window and transition animation scales to zero', async () => {
      const logger = createMockLogger();

      await AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync({
        serialId: 'emulator-5554' as any,
        env: process.env,
        logger,
      });

      expect(logger.info).toHaveBeenNthCalledWith(
        1,
        'Disabling Android emulator window animations.'
      );
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        1,
        'adb',
        [
          '-s',
          'emulator-5554',
          'shell',
          'settings',
          'put',
          'global',
          'window_animation_scale',
          '0',
        ],
        { env: process.env }
      );
      expect(logger.info).toHaveBeenNthCalledWith(
        2,
        'Disabling Android emulator transition animations.'
      );
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        2,
        'adb',
        [
          '-s',
          'emulator-5554',
          'shell',
          'settings',
          'put',
          'global',
          'transition_animation_scale',
          '0',
        ],
        { env: process.env }
      );
    });

    it('logs and swallows failures when disabling animations', async () => {
      const logger = createMockLogger();
      mockedSpawn
        .mockRejectedValueOnce(new Error('window failed'))
        .mockRejectedValueOnce(new Error('transition failed'));

      await expect(
        AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync({
          serialId: 'emulator-5554' as any,
          env: process.env,
          logger,
        })
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          err: expect.objectContaining({ message: 'window failed' }),
        }),
        'Failed to disable Android emulator window animations.'
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          err: expect.objectContaining({ message: 'transition failed' }),
        }),
        'Failed to disable Android emulator transition animations.'
      );
    });
  });

  describe(AndroidEmulatorUtils.stopAsync, () => {
    it('kills emulator and waits for it to detach', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[2] === 'emu' && args[3] === 'kill') {
          return { stdout: '', stderr: '' } as any;
        }
        if (args[0] === 'devices') {
          return { stdout: 'List of devices attached\n\n', stderr: '' } as any;
        }
        throw new Error(`Unexpected adb command args: ${args.join(' ')}`);
      }) as any);

      await AndroidEmulatorUtils.stopAsync({
        serialId: 'emulator-5554' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith('adb', ['-s', 'emulator-5554', 'emu', 'kill'], {
        env: process.env,
      });
      expect(mockedSpawn).toHaveBeenCalledWith('adb', ['devices', '-l'], {
        env: process.env,
      });
    });
  });

  describe(AndroidEmulatorUtils.deleteAsync, () => {
    it('stops by serial id and then deletes the AVD', async () => {
      mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

      await AndroidEmulatorUtils.deleteAsync({
        serialId: 'emulator-5554' as any,
        deviceName: 'eas-simulator-1' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith('adb', ['-s', 'emulator-5554', 'emu', 'kill'], {
        env: process.env,
      });
      expect(mockedSpawn).toHaveBeenCalledWith(
        'avdmanager',
        ['delete', 'avd', '-n', 'eas-simulator-1'],
        {
          env: process.env,
        }
      );
    });
  });
});
