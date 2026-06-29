import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import os from 'node:os';
import path from 'node:path';

import { IosSimulatorUtils } from '../IosSimulatorUtils';
import { retryAsync } from '../retry';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../retry', () => ({
  retryAsync: jest.fn(async fn => await fn(0)),
}));

const mockedSpawn = jest.mocked(spawn);

describe('IosSimulatorUtils', () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
  });

  describe(IosSimulatorUtils.startAsync, () => {
    it('waits for boot completion without writing accessibility prefs', async () => {
      mockedSpawn.mockImplementation((async (command: string, args: string[]) => {
        if (command === 'xcrun' && args.join(' ') === 'simctl bootstatus test-udid -b') {
          return {
            stdout: 'Monitoring boot status for iPhone 15 (test-udid).\n',
            stderr: '',
          } as any;
        }
        return { stdout: '', stderr: '' } as any;
      }) as any);

      await IosSimulatorUtils.startAsync({
        deviceIdentifier: 'test-udid' as any,
        env: process.env,
      });

      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'list', 'devices', '--json', '--no-escape-slashes', 'test-udid'],
        expect.anything()
      );
      expect(mockedSpawn).not.toHaveBeenCalledWith('plutil', expect.anything(), expect.anything());
    });
  });

  describe(IosSimulatorUtils.enableAccessibilitySettingsAsync, () => {
    function device(overrides: Record<string, unknown> = {}) {
      return {
        dataPath: '/tmp/eas-test-simulator-data',
        dataPathSize: 1,
        logPath: '/tmp/eas-test-simulator-logs',
        udid: 'test-udid',
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15',
        state: 'Shutdown',
        name: 'iPhone 15',
        ...overrides,
      };
    }

    function mockAvailableDevices(devices: Record<string, unknown>[]) {
      mockedSpawn.mockImplementation((async (command: string, args: string[]) => {
        if (
          command === 'xcrun' &&
          args.join(' ') === 'simctl list devices --json --no-escape-slashes available'
        ) {
          return {
            stdout: JSON.stringify({
              devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-18-0': devices,
              },
            }),
            stderr: '',
          } as any;
        }
        return { stdout: '', stderr: '' } as any;
      }) as any);
    }

    it('writes accessibility prefs for an exact shutdown simulator match', async () => {
      mockAvailableDevices([
        device({
          udid: 'test-udid-pro',
          name: 'iPhone 17 Pro',
          dataPath: '/tmp/eas-test-simulator-data-pro',
        }),
        device({ name: 'iPhone 17' }),
      ]);

      await expect(
        IosSimulatorUtils.enableAccessibilitySettingsAsync({
          deviceIdentifier: 'iPhone 17' as any,
          env: process.env,
        })
      ).resolves.toBeUndefined();

      for (const key of [
        'AutomationEnabled',
        'IgnoreAXServerEntitlements',
        'AccessibilityEnabled',
        'ApplicationAccessibilityEnabled',
      ]) {
        expect(mockedSpawn).toHaveBeenCalledWith(
          'plutil',
          [
            '-replace',
            key,
            '-bool',
            'true',
            '/tmp/eas-test-simulator-data/Library/Preferences/com.apple.Accessibility.plist',
          ],
          { env: process.env }
        );
      }
    });

    it('throws UserError when no available simulator exactly matches the identifier', async () => {
      mockAvailableDevices([device({ name: 'iPhone 17 Pro' })]);

      await expect(
        IosSimulatorUtils.enableAccessibilitySettingsAsync({
          deviceIdentifier: 'iPhone 17' as any,
          env: process.env,
        })
      ).rejects.toThrow(UserError);

      expect(mockedSpawn).not.toHaveBeenCalledWith('plutil', expect.anything(), expect.anything());
    });

    it('throws UserError when the matched simulator is already booted', async () => {
      mockAvailableDevices([device({ state: 'Booted' })]);

      await expect(
        IosSimulatorUtils.enableAccessibilitySettingsAsync({
          deviceIdentifier: 'test-udid' as any,
          env: process.env,
        })
      ).rejects.toThrow(UserError);
    });

    it('throws SystemError when pre-boot accessibility setup fails', async () => {
      mockedSpawn.mockRejectedValue(new Error('Failed to list simulators'));

      await expect(
        IosSimulatorUtils.enableAccessibilitySettingsAsync({
          deviceIdentifier: 'test-udid' as any,
          env: process.env,
        })
      ).rejects.toThrow(SystemError);
    });
  });

  describe(IosSimulatorUtils.waitForReadyAsync, () => {
    it('takes the readiness screenshot into a writable temp file, not /dev/null', async () => {
      await IosSimulatorUtils.waitForReadyAsync({
        udid: 'test-udid' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        [
          'simctl',
          'io',
          'test-udid',
          'screenshot',
          path.join(os.tmpdir(), 'eas-simulator-readiness.png'),
        ],
        { env: process.env }
      );
    });
  });

  describe(IosSimulatorUtils.disableApsdAsync, () => {
    it('disables and boots out apsd in the simulator', async () => {
      await IosSimulatorUtils.disableApsdAsync({
        udid: 'test-udid' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'spawn', 'test-udid', 'launchctl', 'disable', 'system/com.apple.apsd'],
        { env: process.env }
      );
      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'spawn', 'test-udid', 'launchctl', 'bootout', 'system/com.apple.apsd'],
        { env: process.env }
      );
    });
  });
});
