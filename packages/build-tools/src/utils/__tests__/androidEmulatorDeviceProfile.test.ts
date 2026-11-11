import spawn from '@expo/turtle-spawn';

import { createMockLogger } from '../../__tests__/utils/logger';
import { type AndroidDeviceName, type AndroidDeviceSerialId } from '../AndroidEmulatorUtils';
import { AndroidEmulatorDeviceProfile } from '../androidEmulatorDeviceProfile';
import { retryAsync } from '../retry';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
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
});
