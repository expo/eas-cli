import spawn from '@expo/turtle-spawn';

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
  beforeEach(() => {
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mockedRetryAsync.mockImplementation(async fn => await fn(0));
  });

  describe(AndroidEmulatorUtils.waitForReadyAsync, () => {
    it('checks boot completion and verifies network by pinging 1.1.1.1 with timeout', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'ping' && args[8] === '1.1.1.1') {
          return { stdout: '1 packets transmitted, 1 received', stderr: '' } as any;
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
        ['-s', 'emulator-5554', 'shell', 'ping', '-c', '1', '-W', '1', '1.1.1.1'],
        { env: process.env }
      );
    });

    it('throws when network is unavailable despite completed boot', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args[3] === 'getprop') {
          return { stdout: '1\n', stderr: '' } as any;
        }
        if (args[3] === 'ping') {
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
        if (args[3] === 'sh' && args[4] === '-c' && args[5] === 'exit 0') {
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
        ['-s', 'emulator-5554', 'shell', 'sh', '-c', 'exit 0'],
        expect.objectContaining({
          env: expect.objectContaining({
            ANDROID_EMULATOR_NETWORK_READY_COMMAND: 'exit 0',
          }),
        })
      );
      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'ping', '-c', '1', '-W', '1', '1.1.1.1'],
        expect.anything()
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
