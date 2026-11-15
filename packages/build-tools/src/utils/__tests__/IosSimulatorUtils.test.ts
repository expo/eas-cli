import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import os from 'node:os';
import path from 'node:path';

import { IosSimulatorUtils } from '../IosSimulatorUtils';
import { retryAsync } from '../retry';
import { waitForWarmSimulatorCleanupAsync } from '../warmSimulatorCleanup';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../retry', () => ({
  retryAsync: jest.fn(async fn => await fn(0)),
}));
jest.mock('../warmSimulatorCleanup');

const mockedSpawn = jest.mocked(spawn);

describe('IosSimulatorUtils', () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    jest.mocked(waitForWarmSimulatorCleanupAsync).mockReset().mockResolvedValue(undefined);
  });

  describe(IosSimulatorUtils.getAvailableRuntimesAsync, () => {
    it('returns available iOS runtimes', async () => {
      mockedSpawn.mockResolvedValue({
        stdout: JSON.stringify({
          runtimes: [
            {
              identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-3',
              isAvailable: true,
              version: '18.3.1',
            },
            {
              identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5',
              isAvailable: false,
              version: '17.5',
            },
          ],
        }),
        stderr: '',
      } as any);

      await expect(
        IosSimulatorUtils.getAvailableRuntimesAsync({ env: process.env })
      ).resolves.toEqual([
        {
          identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-3',
          isAvailable: true,
          version: '18.3.1',
        },
      ]);
      expect(mockedSpawn).toHaveBeenCalledWith('xcrun', ['simctl', 'list', 'runtimes', '--json'], {
        env: process.env,
      });
    });
  });

  describe(IosSimulatorUtils.getAvailableDevicesAsync, () => {
    it('adds a human-readable runtime display name', async () => {
      mockedSpawn.mockResolvedValue({
        stdout: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-6': [
              {
                dataPath: '/tmp/eas-test-simulator-data',
                dataPathSize: 1,
                logPath: '/tmp/eas-test-simulator-logs',
                udid: 'test-udid',
                isAvailable: true,
                deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                state: 'Booted',
                name: 'iPhone 16',
              },
            ],
          },
        }),
        stderr: '',
      } as any);

      await expect(
        IosSimulatorUtils.getAvailableDevicesAsync({ env: process.env, filter: 'booted' })
      ).resolves.toEqual([
        expect.objectContaining({
          name: 'iPhone 16',
          runtimeDisplayName: 'iOS 18.6',
        }),
      ]);
    });
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

    it('waits for warm cleanup before checking device state and writing accessibility prefs', async () => {
      let finishCleanup: (() => void) | undefined;
      jest.mocked(waitForWarmSimulatorCleanupAsync).mockImplementationOnce(
        async () =>
          await new Promise<void>(resolve => {
            finishCleanup = resolve;
          })
      );
      mockAvailableDevices([device()]);

      const setup = IosSimulatorUtils.enableAccessibilitySettingsAsync({
        deviceIdentifier: device().udid as any,
        env: {},
      });
      expect(mockedSpawn).not.toHaveBeenCalled();
      expect(finishCleanup).toBeDefined();
      finishCleanup?.();
      await setup;

      expect(mockedSpawn).toHaveBeenCalledWith('plutil', expect.anything(), {
        env: {},
      });
    });

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
    const readinessScreenshotPath = path.join(os.tmpdir(), 'eas-simulator-readiness.png');

    it('takes the readiness screenshot into a writable temp file, not /dev/null', async () => {
      mockSimulator({});

      await IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'io', 'test-udid', 'screenshot', readinessScreenshotPath],
        { env: process.env }
      );
    });

    it('names the first integrated screen when the device has several (iPhone Duo on iOS 27.2)', async () => {
      // Connected screens from `xcrun simctl io <udid> enumerate` on an iPhone Duo (iOS 27.2).
      mockSimulator({
        version: '27.2',
        connectedScreens: `    Connected Screens:
    (1) LCD:
        Screen ID: 1
        Screen Type: Integrated
    (2) TVOut:
        Screen ID: 2
        Screen Type: TVOut
    (3) LCD-1:
        Screen ID: 3
        Screen Type: Integrated
`,
      });

      await IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'io', 'test-udid', 'screenshot', '--display=1', readinessScreenshotPath],
        { env: process.env }
      );
    });

    it('takes the first listed integrated screen, skipping screens that are not integrated', async () => {
      mockSimulator({
        connectedScreens: `    Connected Screens:
    (1) TVOut:
        Screen ID: 1
        Screen Type: TVOut
    (2) LCD-1:
        Screen ID: 5
        Screen Type: Integrated
    (3) LCD:
        Screen ID: 3
        Screen Type: Integrated
`,
      });

      await IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'io', 'test-udid', 'screenshot', '--display=5', readinessScreenshotPath],
        { env: process.env }
      );
    });

    it('keeps the plain screenshot when the device has one integrated screen', async () => {
      mockSimulator({
        connectedScreens: `    Connected Screens:
    (2) TVOut:
        Screen ID: 2
        Screen Type: TVOut
    (1) LCD:
        Screen ID: 1
        Screen Type: Integrated
`,
      });

      await IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'io', 'test-udid', 'screenshot', readinessScreenshotPath],
        { env: process.env }
      );
    });

    it.each(['27.2', '27.3', '28.0'])(
      'does not wait for com.apple.datamigrator to exit on iOS %s, where it stays resident',
      async version => {
        mockSimulator({ version, dataMigratorRunning: true });

        await IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env });

        expect(mockedSpawn).not.toHaveBeenCalledWith('ps', expect.anything(), expect.anything());
      }
    );

    it.each(['27.1', '26.3.1', '18.6'])(
      'waits for com.apple.datamigrator to exit on iOS %s',
      async version => {
        mockSimulator({ version, dataMigratorRunning: true });

        await expect(
          IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env })
        ).rejects.toThrow('com.apple.datamigrator still running');
        expect(mockedSpawn).toHaveBeenCalledWith('ps', ['-eo', 'pid,comm'], { env: process.env });
      }
    );

    it('waits for com.apple.datamigrator to exit when the device is not listed', async () => {
      mockSimulator({ listed: false, dataMigratorRunning: true });

      await expect(
        IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env })
      ).rejects.toThrow('com.apple.datamigrator still running');
    });

    it('waits for com.apple.datamigrator to exit when the runtime reports no version', async () => {
      mockSimulator({ version: null, dataMigratorRunning: true });
      await expect(
        IosSimulatorUtils.waitForReadyAsync({ udid: 'test-udid' as any, env: process.env })
      ).rejects.toThrow('com.apple.datamigrator still running');
    });

    function mockSimulator({
      version = '26.4',
      listed = true,
      connectedScreens = '',
      dataMigratorRunning = false,
    }: {
      version?: string | null;
      listed?: boolean;
      connectedScreens?: string;
      dataMigratorRunning?: boolean;
    }): void {
      const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-4';
      const otherRuntime = {
        identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-2',
        version: '27.2',
      };
      mockedSpawn.mockImplementation((async (command: string, args: string[]) => {
        if (command === 'ps') {
          return {
            stdout: dataMigratorRunning
              ? '  123 /sbin/launchd_sim\n  456 /Library/Developer/CoreSimulator/Volumes/iOS_23E244/XPCServices/com.apple.datamigrator.xpc/com.apple.datamigrator\n'
              : '  123 /sbin/launchd_sim\n',
            stderr: '',
          } as any;
        }
        if (args.includes('runtimes')) {
          return {
            stdout: JSON.stringify({
              runtimes: [
                otherRuntime,
                version === null ? { identifier: runtime } : { identifier: runtime, version },
              ],
            }),
            stderr: '',
          } as any;
        }
        if (args.includes('list')) {
          return {
            stdout: JSON.stringify({
              devices: { [runtime]: listed ? [{ udid: 'test-udid' }] : [] },
            }),
            stderr: '',
          } as any;
        }
        if (args.includes('enumerate')) {
          return { stdout: connectedScreens, stderr: '' } as any;
        }
        return { stdout: '', stderr: '' } as any;
      }) as any);
    }
  });

  describe(IosSimulatorUtils.disableApsdAsync, () => {
    it('disables and boots out apsd in the simulator foreground user domain', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args.join(' ') === 'simctl spawn test-udid launchctl list com.apple.apsd') {
          throw Object.assign(new Error('apsd not loaded'), { status: 113 });
        }
        return { stdout: '', stderr: '' } as any;
      }) as any);

      await IosSimulatorUtils.disableApsdAsync({
        udid: 'test-udid' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'spawn', 'test-udid', 'launchctl', 'disable', 'user/foreground/com.apple.apsd'],
        { env: process.env }
      );
      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'spawn', 'test-udid', 'launchctl', 'bootout', 'user/foreground/com.apple.apsd'],
        { env: process.env }
      );
      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'spawn', 'test-udid', 'launchctl', 'list', 'com.apple.apsd'],
        { env: process.env }
      );
      expect(mockedSpawn).not.toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'spawn', 'test-udid', 'launchctl', 'disable', 'system/com.apple.apsd'],
        { env: process.env }
      );
    });

    it('succeeds when bootout fails after apsd is already stopped', async () => {
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (
          args.join(' ') ===
          'simctl spawn test-udid launchctl bootout user/foreground/com.apple.apsd'
        ) {
          throw Object.assign(new Error('bootout failed'), { status: 3 });
        }
        if (args.join(' ') === 'simctl spawn test-udid launchctl list com.apple.apsd') {
          throw Object.assign(new Error('apsd not loaded'), { status: 113 });
        }
        return { stdout: '', stderr: '' } as any;
      }) as any);

      await expect(
        IosSimulatorUtils.disableApsdAsync({
          udid: 'test-udid' as any,
          env: process.env,
        })
      ).resolves.toBeUndefined();
    });

    it('falls back to the system domain when the foreground user domain keeps apsd running', async () => {
      let listCount = 0;
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        if (args.join(' ') === 'simctl spawn test-udid launchctl list com.apple.apsd') {
          listCount += 1;
          if (listCount === 2) {
            throw Object.assign(new Error('apsd not loaded'), { status: 113 });
          }
        }
        return { stdout: '', stderr: '' } as any;
      }) as any);

      await IosSimulatorUtils.disableApsdAsync({
        udid: 'test-udid' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'spawn', 'test-udid', 'launchctl', 'disable', 'system/com.apple.apsd'],
        { env: process.env }
      );
    });

    it('throws a SystemError when apsd is still running after all disable attempts', async () => {
      mockedSpawn.mockImplementation((async () => {
        return { stdout: '', stderr: '' } as any;
      }) as any);

      await expect(
        IosSimulatorUtils.disableApsdAsync({
          udid: 'test-udid' as any,
          env: process.env,
        })
      ).rejects.toThrow(SystemError);
    });
  });
  describe(IosSimulatorUtils.setLaunchdEnvironmentAsync, () => {
    it('sets every variable in the simulator launchd with one invocation', async () => {
      await IosSimulatorUtils.setLaunchdEnvironmentAsync({
        udid: 'test-udid' as any,
        env: process.env,
        variables: { https_proxy: 'http://127.0.0.1:8899', no_proxy: 'localhost,127.0.0.1' },
      });

      expect(mockedSpawn.mock.calls).toEqual([
        [
          'xcrun',
          [
            'simctl',
            'spawn',
            'test-udid',
            'launchctl',
            'setenv',
            'https_proxy',
            'http://127.0.0.1:8899',
            'no_proxy',
            'localhost,127.0.0.1',
          ],
          { env: process.env },
        ],
      ]);
    });

    it('does nothing for an empty variable set', async () => {
      await IosSimulatorUtils.setLaunchdEnvironmentAsync({
        udid: 'test-udid' as any,
        env: process.env,
        variables: {},
      });
      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('propagates a launchctl failure', async () => {
      mockedSpawn.mockRejectedValueOnce(new Error('launchctl failed'));

      await expect(
        IosSimulatorUtils.setLaunchdEnvironmentAsync({
          udid: 'test-udid' as any,
          env: process.env,
          variables: { https_proxy: 'http://127.0.0.1:8899' },
        })
      ).rejects.toThrow('launchctl failed');
    });
  });

  describe(IosSimulatorUtils.resolveUdidAsync, () => {
    it('passes a udid through without listing devices', async () => {
      await expect(
        IosSimulatorUtils.resolveUdidAsync({
          deviceIdentifier: '8027F627-9534-4679-85BF-0F14AFF228E8' as any,
          env: process.env,
        })
      ).resolves.toBe('8027F627-9534-4679-85BF-0F14AFF228E8');
      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('uppercases a udid given in lowercase, matching how simctl lists devices', async () => {
      await expect(
        IosSimulatorUtils.resolveUdidAsync({
          deviceIdentifier: '8027f627-9534-4679-85bf-0f14aff228e8' as any,
          env: process.env,
        })
      ).resolves.toBe('8027F627-9534-4679-85BF-0F14AFF228E8');
    });

    it('resolves a device name to the first available device with that name', async () => {
      mockedSpawn.mockResolvedValue({
        stdout: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
              { udid: 'AAAA', name: 'iPhone 17', isAvailable: true, state: 'Shutdown' },
              { udid: 'BBBB', name: 'iPhone Air', isAvailable: true, state: 'Shutdown' },
            ],
          },
        }),
        stderr: '',
      } as any);

      await expect(
        IosSimulatorUtils.resolveUdidAsync({
          deviceIdentifier: 'iPhone Air' as any,
          env: process.env,
        })
      ).resolves.toBe('BBBB');
      await expect(
        IosSimulatorUtils.resolveUdidAsync({
          deviceIdentifier: 'iPhone 99' as any,
          env: process.env,
        })
      ).rejects.toThrow(UserError);
    });
  });

  describe(IosSimulatorUtils.bootAsync, () => {
    it('boots without waiting and tolerates an already booted device', async () => {
      await IosSimulatorUtils.bootAsync({ deviceIdentifier: 'AAAA' as any, env: process.env });
      expect(mockedSpawn).toHaveBeenCalledWith('xcrun', ['simctl', 'boot', 'AAAA'], {
        env: process.env,
        stdio: 'pipe',
      });

      mockedSpawn.mockRejectedValueOnce(
        Object.assign(new Error('boot failed'), {
          stderr: 'Unable to boot device in current state: Booted',
        })
      );
      await expect(
        IosSimulatorUtils.bootAsync({ deviceIdentifier: 'AAAA' as any, env: process.env })
      ).resolves.toBeUndefined();

      mockedSpawn.mockRejectedValueOnce(
        Object.assign(new Error('boot failed'), { stderr: 'other' })
      );
      await expect(
        IosSimulatorUtils.bootAsync({ deviceIdentifier: 'AAAA' as any, env: process.env })
      ).rejects.toThrow('boot failed');
    });

    it('hands launchd environment to the boot through SIMCTL_CHILD_ variables', async () => {
      await IosSimulatorUtils.bootAsync({
        deviceIdentifier: 'AAAA' as any,
        env: { PATH: '/usr/bin' },
        launchdEnvironment: {
          DYLD_INSERT_LIBRARIES: '/w/guard.dylib',
          https_proxy: 'http://127.0.0.1:8899',
        },
      });
      expect(mockedSpawn).toHaveBeenCalledWith('xcrun', ['simctl', 'boot', 'AAAA'], {
        env: {
          PATH: '/usr/bin',
          SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: '/w/guard.dylib',
          SIMCTL_CHILD_https_proxy: 'http://127.0.0.1:8899',
        },
        stdio: 'pipe',
      });
    });
  });
});
