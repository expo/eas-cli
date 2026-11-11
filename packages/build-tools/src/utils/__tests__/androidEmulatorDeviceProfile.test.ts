import spawn from '@expo/turtle-spawn';

import { createMockLogger } from '../../__tests__/utils/logger';
import { type AndroidDeviceName, type AndroidDeviceSerialId } from '../AndroidEmulatorUtils';
import { AndroidEmulatorDeviceProfile } from '../androidEmulatorDeviceProfile';
import { buildAndroidResourceOverlayApkAsync } from '../androidResourceOverlayApk';
import { retryAsync } from '../retry';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../androidResourceOverlayApk', () => ({
  buildAndroidResourceOverlayApkAsync: jest.fn(),
}));

jest.mock('../retry', () => ({
  retryAsync: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedRetryAsync = jest.mocked(retryAsync);

const serialId = 'emulator-5554' as AndroidDeviceSerialId;
const pixel9 = 'pixel_9' as AndroidDeviceName;

const OVERLAY_LIST_DISABLED = [
  'android',
  '[ ] com.android.internal.emulation.pixel_8',
  '[ ] com.android.internal.emulation.pixel_9',
  '[x] com.google.android.overlay.pixelconfigcommon',
  'com.android.systemui',
  '[ ] com.android.systemui.emulation.pixel_9',
].join('\n');
const OVERLAY_LIST_ENABLED = [
  'android',
  '[ ] com.android.internal.emulation.pixel_8',
  '[x] com.android.internal.emulation.pixel_9',
  '[x] com.google.android.overlay.pixelconfigcommon',
  'com.android.systemui',
  '[x] com.android.systemui.emulation.pixel_9',
].join('\n');
const STATUS_BAR_HIDDEN = '  InsetsSource id=1 type=statusBars frame=[0,0][0,0] visible=true';
const STATUS_BAR_SHOWN = '  InsetsSource id=1 type=statusBars frame=[0,0][1080,142] visible=true';

/** Answers adb shell calls from queues; the last entry of a queue repeats. */
function mockAdb({
  overlayLists,
  pids,
  windows = [STATUS_BAR_SHOWN],
}: {
  overlayLists: string[];
  pids: (string | null)[];
  windows?: string[];
}): void {
  const next = <T>(queue: T[]): T => (queue.length > 1 ? queue.shift()! : queue[0]);
  mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
    const shellArgs = args.slice(3).join(' ');
    if (shellArgs === 'cmd overlay list') {
      return { stdout: next(overlayLists) };
    }
    if (shellArgs === 'dumpsys window') {
      return { stdout: next(windows) };
    }
    if (shellArgs === 'pidof com.android.systemui') {
      const pid = next(pids);
      if (!pid) {
        throw Object.assign(new Error('pidof failed'), { stdout: '' });
      }
      return { stdout: `${pid}\n` };
    }
    return { stdout: '' };
  }) as any);
}

function adbShellCalls(): string[] {
  return mockedSpawn.mock.calls.map(([, args]) => (args as string[]).slice(3).join(' '));
}

describe('AndroidEmulatorDeviceProfile', () => {
  beforeEach(() => {
    mockedRetryAsync.mockImplementation(async (fn, { retryOptions }) => {
      let lastErr: unknown;
      for (let attemptCount = 0; attemptCount <= retryOptions.retries; attemptCount++) {
        try {
          return await fn(attemptCount);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    });
  });

  describe(AndroidEmulatorDeviceProfile.parseOverlayState, () => {
    it('reads enabled, disabled, and missing overlays', () => {
      const overlayList = '[x] a.enabled\r\n[ ] a.disabled\r\n--- a.unavailable\n';
      expect(AndroidEmulatorDeviceProfile.parseOverlayState(overlayList, 'a.enabled')).toBe(
        'enabled'
      );
      expect(AndroidEmulatorDeviceProfile.parseOverlayState(overlayList, 'a.disabled')).toBe(
        'disabled'
      );
      expect(AndroidEmulatorDeviceProfile.parseOverlayState(overlayList, 'a.unavailable')).toBe(
        'disabled'
      );
      expect(AndroidEmulatorDeviceProfile.parseOverlayState(overlayList, 'a')).toBe('missing');
    });
  });

  describe(AndroidEmulatorDeviceProfile.getStatusBarHeight, () => {
    it('reads the height of a laid-out status bar and 0 otherwise', () => {
      expect(AndroidEmulatorDeviceProfile.getStatusBarHeight(STATUS_BAR_SHOWN)).toBe(142);
      expect(AndroidEmulatorDeviceProfile.getStatusBarHeight(STATUS_BAR_HIDDEN)).toBe(0);
      expect(AndroidEmulatorDeviceProfile.getStatusBarHeight('no insets')).toBe(0);
    });
  });

  describe(AndroidEmulatorDeviceProfile.reloadAsync, () => {
    it('turns the profile overlays on, then restarts System UI and waits for its status bar', async () => {
      const logger = createMockLogger();
      mockAdb({
        overlayLists: [OVERLAY_LIST_DISABLED],
        pids: ['1144', '1144', '4303'],
        windows: [STATUS_BAR_HIDDEN, STATUS_BAR_SHOWN],
      });

      await AndroidEmulatorDeviceProfile.reloadAsync({
        serialId,
        deviceIdentifier: pixel9,
        env: {},
        logger,
      });

      expect(adbShellCalls()).toEqual([
        'cmd overlay list',
        'cmd overlay enable-exclusive --user 0 --category com.android.internal.emulation.pixel_9',
        'cmd overlay enable-exclusive --user 0 --category com.android.systemui.emulation.pixel_9',
        'pidof com.android.systemui',
        'am crash com.android.systemui',
        'pidof com.android.systemui',
        'pidof com.android.systemui',
        'dumpsys window',
        'pidof com.android.systemui',
        'dumpsys window',
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        'Restarting System UI to load the pixel_9 device profile.'
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not turn on overlays that are already on', async () => {
      mockAdb({ overlayLists: [OVERLAY_LIST_ENABLED], pids: ['1144', '4303'] });

      await AndroidEmulatorDeviceProfile.reloadAsync({
        serialId,
        deviceIdentifier: pixel9,
        env: {},
        logger: createMockLogger(),
      });

      expect(adbShellCalls()).not.toContainEqual(expect.stringContaining('enable-exclusive'));
      expect(adbShellCalls()).toContain('am crash com.android.systemui');
    });

    it('does nothing without a device identifier', async () => {
      await AndroidEmulatorDeviceProfile.reloadAsync({
        serialId,
        deviceIdentifier: undefined,
        env: {},
        logger: createMockLogger(),
      });

      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('skips the restart when the system image has no overlays for the profile', async () => {
      const logger = createMockLogger();
      mockAdb({ overlayLists: [OVERLAY_LIST_ENABLED], pids: ['1144'] });

      await AndroidEmulatorDeviceProfile.reloadAsync({
        serialId,
        deviceIdentifier: 'medium_phone' as AndroidDeviceName,
        env: {},
        logger,
      });

      expect(adbShellCalls()).toEqual(['cmd overlay list']);
      expect(logger.info).toHaveBeenCalledWith(
        'The system image has no medium_phone device profile overlays, skipping the System UI restart.'
      );
    });

    it('logs and swallows a System UI that does not come back', async () => {
      const logger = createMockLogger();
      mockAdb({ overlayLists: [OVERLAY_LIST_ENABLED], pids: ['1144'] });

      await expect(
        AndroidEmulatorDeviceProfile.reloadAsync({
          serialId,
          deviceIdentifier: pixel9,
          env: {},
          logger,
          systemUiTimeoutMs: 2_000,
        })
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            message: 'System UI on emulator-5554 has not restarted yet.',
          }),
        }),
        'Failed to reload the pixel_9 device profile.'
      );
    });
  });

  describe(AndroidEmulatorDeviceProfile.applyCorrectionsAsync, () => {
    const corrections = {
      pixel_9: {
        source: 'test source',
        overlays: [
          {
            targetPackage: 'android' as const,
            values: [{ type: 'dimen' as const, name: 'status_bar_height_portrait', value: '66dp' }],
          },
          {
            targetPackage: 'com.android.systemui' as const,
            values: [{ type: 'dimen' as const, name: 'status_bar_padding_top', value: '1dp' }],
          },
        ],
      },
    };
    const FRAMEWORK = 'expo.eas.emulator.profile.pixel_9.framework';
    const SYSTEM_UI = 'expo.eas.emulator.profile.pixel_9.systemui';

    /** A fake emulator: the correction overlays show up after the first framework restart. */
    function mockDevice({ uid = '0', firstRemount = 'Now reboot your device' } = {}): void {
      let frameworkStarts = 0;
      let remounts = 0;
      let enabled = false;
      mockedSpawn.mockImplementation((async (_command: string, args: string[]) => {
        const adbArgs = args.slice(2).join(' ');
        if (adbArgs === 'shell cmd overlay list') {
          const corrections =
            frameworkStarts === 0
              ? []
              : [
                  `${enabled ? '[x]' : '[ ]'} ${FRAMEWORK}`,
                  `${enabled ? '[x]' : '[ ]'} ${SYSTEM_UI}`,
                ];
          return { stdout: [OVERLAY_LIST_DISABLED, ...corrections].join('\n') };
        }
        if (adbArgs === 'shell id -u') {
          return { stdout: `${uid}\n` };
        }
        if (adbArgs === 'remount') {
          remounts += 1;
          return { stdout: remounts === 1 ? firstRemount : 'Remount succeeded', stderr: '' };
        }
        if (adbArgs === 'shell start') {
          frameworkStarts += 1;
          if (frameworkStarts === 2) {
            enabled = true;
          }
        }
        if (adbArgs === 'shell getprop sys.boot_completed') {
          return { stdout: '1\n' };
        }
        return { stdout: '', stderr: '' };
      }) as any);
    }

    function adbCalls(): string[] {
      return mockedSpawn.mock.calls.map(([, args]) => (args as string[]).slice(2).join(' '));
    }

    beforeEach(() => {
      jest
        .mocked(buildAndroidResourceOverlayApkAsync)
        .mockImplementation(async ({ packageName }) => `/tmp/${packageName}.apk`);
    });

    it('builds, installs, and turns on the correction overlays', async () => {
      const logger = createMockLogger();
      mockDevice();

      await expect(
        AndroidEmulatorDeviceProfile.applyCorrectionsAsync({
          serialId,
          deviceIdentifier: pixel9,
          env: {},
          logger,
          corrections,
        })
      ).resolves.toBe(true);

      expect(buildAndroidResourceOverlayApkAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: FRAMEWORK,
          targetPackage: 'android',
          category: 'expo.eas.emulator.profile',
          values: corrections.pixel_9.overlays[0].values,
        })
      );
      expect(adbCalls()).toEqual([
        'shell cmd overlay list',
        'root',
        'shell getprop sys.boot_completed',
        'shell id -u',
        'remount',
        'reboot',
        'shell getprop sys.boot_completed',
        'root',
        'shell getprop sys.boot_completed',
        'shell id -u',
        'remount',
        'shell mkdir -p /product/overlay/EasProfile_pixel_9_framework',
        `push /tmp/${FRAMEWORK}.apk /product/overlay/EasProfile_pixel_9_framework/EasProfile_pixel_9_framework.apk`,
        'shell mkdir -p /product/overlay/EasProfile_pixel_9_systemui',
        `push /tmp/${SYSTEM_UI}.apk /product/overlay/EasProfile_pixel_9_systemui/EasProfile_pixel_9_systemui.apk`,
        'shell stop',
        'shell setprop sys.boot_completed 0',
        'shell start',
        'shell getprop sys.boot_completed',
        'shell cmd overlay list',
        `shell cmd overlay enable --user 0 ${FRAMEWORK}`,
        `shell cmd overlay set-priority ${FRAMEWORK} highest`,
        `shell cmd overlay enable --user 0 ${SYSTEM_UI}`,
        `shell cmd overlay set-priority ${SYSTEM_UI} highest`,
        'shell cmd overlay list',
        'shell cmd overlay enable-exclusive --user 0 --category com.android.internal.emulation.pixel_9',
        'shell cmd overlay enable-exclusive --user 0 --category com.android.systemui.emulation.pixel_9',
        'shell stop',
        'shell setprop sys.boot_completed 0',
        'shell start',
        'shell getprop sys.boot_completed',
        'shell cmd overlay list',
        'unroot',
        'shell getprop sys.boot_completed',
      ]);
      expect(logger.info).toHaveBeenCalledWith('Applied the pixel_9 device profile corrections.');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('skips the reboot when the system partitions are already writable', async () => {
      mockDevice({ firstRemount: 'Remount succeeded' });

      await AndroidEmulatorDeviceProfile.applyCorrectionsAsync({
        serialId,
        deviceIdentifier: pixel9,
        env: {},
        logger: createMockLogger(),
        corrections,
      });

      expect(adbCalls()).not.toContain('reboot');
    });

    it('does nothing for a profile without corrections', async () => {
      await expect(
        AndroidEmulatorDeviceProfile.applyCorrectionsAsync({
          serialId,
          deviceIdentifier: 'medium_phone' as AndroidDeviceName,
          env: {},
          logger: createMockLogger(),
          corrections,
        })
      ).resolves.toBe(false);

      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('does nothing when the corrections are already on', async () => {
      const logger = createMockLogger();
      mockedSpawn.mockResolvedValue({
        stdout: `[x] ${FRAMEWORK}\n[x] ${SYSTEM_UI}`,
      } as any);

      await expect(
        AndroidEmulatorDeviceProfile.applyCorrectionsAsync({
          serialId,
          deviceIdentifier: pixel9,
          env: {},
          logger,
          corrections,
        })
      ).resolves.toBe(false);

      expect(adbCalls()).toEqual(['shell cmd overlay list']);
      expect(logger.info).toHaveBeenCalledWith(
        'The pixel_9 device profile corrections are already applied.'
      );
    });

    it('skips the corrections on a system image without root', async () => {
      const logger = createMockLogger();
      mockDevice({ uid: '2000' });

      await expect(
        AndroidEmulatorDeviceProfile.applyCorrectionsAsync({
          serialId,
          deviceIdentifier: pixel9,
          env: {},
          logger,
          corrections,
        })
      ).resolves.toBe(false);

      expect(adbCalls()).not.toContain('remount');
      expect(logger.warn).toHaveBeenCalledWith(
        'The pixel_9 device profile corrections need root, which this system image does not allow (for example Google Play images). Skipping them.'
      );
    });

    it('logs a failure, restores adbd, and reports the restart', async () => {
      const logger = createMockLogger();
      mockDevice();
      const deviceMock = mockedSpawn.getMockImplementation()!;
      mockedSpawn.mockImplementation(((command: string, args: string[], options: any) =>
        args[2] === 'push'
          ? Promise.reject(new Error('push failed'))
          : deviceMock(command, args, options)) as any);

      await expect(
        AndroidEmulatorDeviceProfile.applyCorrectionsAsync({
          serialId,
          deviceIdentifier: pixel9,
          env: {},
          logger,
          corrections,
        })
      ).resolves.toBe(true);

      expect(adbCalls()).toContain('unroot');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.objectContaining({ message: 'push failed' }) }),
        'Failed to apply the pixel_9 device profile corrections.'
      );
    });
  });
});
