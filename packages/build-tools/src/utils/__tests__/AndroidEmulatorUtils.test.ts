import spawn from '@expo/turtle-spawn';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createMockLogger } from '../../__tests__/utils/logger';
import { AndroidEmulatorUtils } from '../AndroidEmulatorUtils';
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
    await Promise.all(
      temporaryDirectories.map(async temporaryDirectory => {
        await fs.promises.rm(temporaryDirectory, { force: true, recursive: true });
      })
    );
  });

  describe('AndroidEmulatorUtils.startLogcatStreamingAsync', () => {
    function createSpawnPromise() {
      const child = Object.assign(new EventEmitter(), {
        pid: 1234,
        stdout: new PassThrough(),
        unref: jest.fn(),
      });
      const spawnPromise = Promise.resolve({ stdout: '', stderr: '' }) as any;
      spawnPromise.child = child;
      return { child, spawnPromise };
    }

    it('streams logcat to a staged file', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const logger = createMockLogger();
      const { child, spawnPromise } = createSpawnPromise();
      mockedSpawn.mockReturnValueOnce(spawnPromise);
      const originalCreateWriteStream = fs.createWriteStream.bind(fs);
      let writeStream: fs.WriteStream | undefined;
      const createWriteStreamSpy = jest.spyOn(fs, 'createWriteStream').mockImplementation(((
        ...args
      ) => {
        writeStream = originalCreateWriteStream(...args);
        return writeStream;
      }) as typeof fs.createWriteStream);
      try {
        const result = await AndroidEmulatorUtils.startLogcatStreamingAsync({
          serialId: 'emulator-5554' as any,
          outputDir,
          env: process.env,
          logger,
        });

        expect(result).not.toBeNull();
        expect(mockedSpawn).toHaveBeenCalledWith(
          'adb',
          ['-s', 'emulator-5554', 'logcat', '-v', 'threadtime'],
          {
            env: process.env,
            stdio: ['ignore', 'pipe', 'ignore'],
          }
        );
        expect(child.unref).toHaveBeenCalled();

        child.stdout.write('log line\n');
        child.stdout.end();
        child.emit('close', 0);
        expect(writeStream).toBeDefined();
        await once(writeStream!, 'finish');

        expect(result!.outputPath.startsWith(outputDir)).toBe(true);
        await expect(fs.promises.readFile(result!.outputPath, 'utf-8')).resolves.toContain(
          'log line'
        );
        expect(path.basename(result!.outputPath)).toBe('1234-emulator-5554.log');
      } finally {
        createWriteStreamSpy.mockRestore();
      }
    });

    it('returns null and warns when logcat cannot start', async () => {
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logcat-staging-'));
      temporaryDirectories.push(outputDir);
      const logger = createMockLogger();
      mockedSpawn.mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await expect(
        AndroidEmulatorUtils.startLogcatStreamingAsync({
          serialId: 'emulator-5554' as any,
          outputDir,
          env: process.env,
          logger,
        })
      ).resolves.toBeNull();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: 'spawn failed' }),
        }),
        'Failed to start Android emulator logcat stream for emulator-5554.'
      );
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
