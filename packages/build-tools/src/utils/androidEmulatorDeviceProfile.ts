import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { type AndroidDeviceName, type AndroidDeviceSerialId } from './AndroidEmulatorUtils';
import { retryAsync } from './retry';

const SYSTEM_UI_PACKAGE = 'com.android.systemui';
const RETRY_INTERVAL_MS = 1_000;

/**
 * Emulator system images ship overlays per Pixel hardware profile, one for the framework
 * (`com.android.internal.emulation.<profile>`) and one for System UI
 * (`com.android.systemui.emulation.<profile>`). They set the display cutout, the rounded corners,
 * and the status bar height for that device. Profiles without them (for example `medium_phone`)
 * use the generic values.
 */
export namespace AndroidEmulatorDeviceProfile {
  export const SYSTEM_UI_RESTART_TIMEOUT_MS = 30_000;

  export function getProfileOverlayPackages(deviceIdentifier: AndroidDeviceName): string[] {
    return [
      `com.android.internal.emulation.${deviceIdentifier}`,
      `com.android.systemui.emulation.${deviceIdentifier}`,
    ];
  }

  /**
   * The emulator turns the profile overlays on from the host after boot, with
   * `adb shell cmd overlay enable-exclusive --category <overlay>`. This often happens after
   * System UI has started, which then keeps a status bar without the profile's height and no
   * display cutout. The command also fails while adbd restarts. Turning the overlays on here and
   * restarting System UI loads the device profile on every boot. Failures are logged and ignored,
   * the emulator stays usable.
   */
  export async function reloadAsync({
    serialId,
    deviceIdentifier,
    env,
    logger,
    systemUiTimeoutMs = SYSTEM_UI_RESTART_TIMEOUT_MS,
  }: {
    serialId: AndroidDeviceSerialId;
    deviceIdentifier: AndroidDeviceName | null | undefined;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
    systemUiTimeoutMs?: number;
  }): Promise<void> {
    if (!deviceIdentifier) {
      return;
    }

    try {
      const hasProfileOverlays = await enableProfileOverlaysAsync({
        serialId,
        deviceIdentifier,
        env,
      });
      if (!hasProfileOverlays) {
        logger.info(
          `The system image has no ${deviceIdentifier} device profile overlays, skipping the System UI restart.`
        );
        return;
      }

      logger.info(`Restarting System UI to load the ${deviceIdentifier} device profile.`);
      await restartSystemUiAsync({ serialId, env, timeoutMs: systemUiTimeoutMs });
    } catch (err) {
      logger.warn({ err }, `Failed to reload the ${deviceIdentifier} device profile.`);
    }
  }

  /**
   * Turns the profile overlays on the way the emulator does. Returns false when the system image
   * has no overlays for the profile.
   */
  export async function enableProfileOverlaysAsync({
    serialId,
    deviceIdentifier,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    deviceIdentifier: AndroidDeviceName;
    env: NodeJS.ProcessEnv;
  }): Promise<boolean> {
    const { stdout: overlayList } = await spawn(
      'adb',
      ['-s', serialId, 'shell', 'cmd', 'overlay', 'list'],
      { env }
    );
    const overlayPackages = getProfileOverlayPackages(deviceIdentifier).filter(
      overlayPackage => parseOverlayState(overlayList, overlayPackage) !== 'missing'
    );
    if (overlayPackages.length === 0) {
      return false;
    }
    for (const overlayPackage of overlayPackages) {
      if (parseOverlayState(overlayList, overlayPackage) !== 'enabled') {
        await spawn(
          'adb',
          [
            '-s',
            serialId,
            'shell',
            'cmd',
            'overlay',
            'enable-exclusive',
            '--user',
            '0',
            '--category',
            overlayPackage,
          ],
          { env }
        );
      }
    }
    return true;
  }

  /**
   * Restarts System UI without root, so it also works on Google Play images. `am crash` ends the
   * process the way an app crash does; the system starts the persistent System UI again.
   */
  export async function restartSystemUiAsync({
    serialId,
    env,
    timeoutMs = SYSTEM_UI_RESTART_TIMEOUT_MS,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }): Promise<void> {
    const previousPid = await getSystemUiPidAsync({ serialId, env });
    await spawn('adb', ['-s', serialId, 'shell', 'am', 'crash', SYSTEM_UI_PACKAGE], { env });
    // The new process starts within seconds; its status bar window follows several seconds later.
    await retryAsync(
      async () => {
        const pid = await getSystemUiPidAsync({ serialId, env });
        if (!pid || pid === previousPid) {
          throw new Error(`System UI on ${serialId} has not restarted yet.`);
        }
        const { stdout } = await spawn('adb', ['-s', serialId, 'shell', 'dumpsys', 'window'], {
          env,
        });
        if (!(getStatusBarHeight(stdout) > 0)) {
          throw new Error(`System UI on ${serialId} has not shown its status bar yet.`);
        }
      },
      {
        retryOptions: {
          retries: Math.max(0, Math.ceil(timeoutMs / RETRY_INTERVAL_MS) - 1),
          retryIntervalMs: RETRY_INTERVAL_MS,
        },
      }
    );
  }

  /** Reads the status bar height from the `statusBars` insets source in `dumpsys window`. */
  export function getStatusBarHeight(dumpsysWindow: string): number {
    const match = dumpsysWindow.match(/type=statusBars frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!match) {
      return 0;
    }
    const [, left, top, right, bottom] = match.map(Number);
    return right > left ? bottom - top : 0;
  }

  /** Reads the overlay state from `cmd overlay list`: `[x]` enabled, `[ ]` disabled. */
  export function parseOverlayState(
    overlayList: string,
    overlayPackage: string
  ): 'enabled' | 'disabled' | 'missing' {
    for (const line of overlayList.replace(/\r\n/g, '\n').split('\n')) {
      const match = line.trim().match(/^(\[x\]|\[ \]|---)\s+(\S+)$/);
      if (match?.[2] === overlayPackage) {
        return match[1] === '[x]' ? 'enabled' : 'disabled';
      }
    }
    return 'missing';
  }

  async function getSystemUiPidAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<string | null> {
    try {
      const { stdout } = await spawn('adb', ['-s', serialId, 'shell', 'pidof', SYSTEM_UI_PACKAGE], {
        env,
      });
      return stdout.trim() || null;
    } catch {
      // `pidof` exits with 1 while System UI is not running.
      return null;
    }
  }
}
