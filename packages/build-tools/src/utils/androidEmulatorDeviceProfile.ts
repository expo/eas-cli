import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type AndroidDeviceName, type AndroidDeviceSerialId } from './AndroidEmulatorUtils';
import {
  ANDROID_EMULATOR_DEVICE_PROFILE_CORRECTIONS,
  type AndroidEmulatorDeviceProfileCorrection,
  type AndroidResourceOverlay,
} from './androidEmulatorDeviceProfileCorrections';
import { buildAndroidResourceOverlayApkAsync } from './androidResourceOverlayApk';
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
  export const OVERLAY_ENABLED_TIMEOUT_MS = 60_000;
  export const BOOT_TIMEOUT_MS = 180_000;
  /**
   * The profile overlays have no category. Turning one on "exclusive in its category" turns off
   * every other overlay without one, so the correction overlays need their own.
   */
  export const CORRECTION_OVERLAY_CATEGORY = 'expo.eas.emulator.profile';

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

  export function getCorrectionOverlayPackage(
    deviceIdentifier: AndroidDeviceName,
    targetPackage: AndroidResourceOverlay['targetPackage']
  ): string {
    return `${CORRECTION_OVERLAY_CATEGORY}.${deviceIdentifier}.${getTargetSuffix(targetPackage)}`;
  }

  /**
   * Installs overlays that make the device profile match the real device (see
   * ANDROID_EMULATOR_DEVICE_PROFILE_CORRECTIONS). They go to /product/overlay, which needs root
   * and an emulator started with -writable-system, and the framework restarts twice to load them.
   * Returns true when it restarted adbd or the framework, so the caller should wait for the
   * emulator to be ready again. Failures are logged and ignored.
   */
  export async function applyCorrectionsAsync({
    serialId,
    deviceIdentifier,
    env,
    logger,
    corrections = ANDROID_EMULATOR_DEVICE_PROFILE_CORRECTIONS,
    bootTimeoutMs = BOOT_TIMEOUT_MS,
    overlayTimeoutMs = OVERLAY_ENABLED_TIMEOUT_MS,
  }: {
    serialId: AndroidDeviceSerialId;
    deviceIdentifier: AndroidDeviceName | null | undefined;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
    corrections?: Readonly<Partial<Record<string, AndroidEmulatorDeviceProfileCorrection>>>;
    bootTimeoutMs?: number;
    overlayTimeoutMs?: number;
  }): Promise<boolean> {
    const correction = deviceIdentifier ? corrections[deviceIdentifier] : undefined;
    if (!deviceIdentifier || !correction) {
      return false;
    }

    const overlays = correction.overlays.map(overlay => {
      const suffix = getTargetSuffix(overlay.targetPackage);
      const directoryName = `EasProfile_${deviceIdentifier}_${suffix}`;
      return {
        ...overlay,
        packageName: getCorrectionOverlayPackage(deviceIdentifier, overlay.targetPackage),
        devicePath: `/product/overlay/${directoryName}/${directoryName}.apk`,
      };
    });
    const adb = (args: string[]): ReturnType<typeof spawn> =>
      spawn('adb', ['-s', serialId, ...args], { env });

    let hasRestarted = false;
    let workingDirectory: string | null = null;
    try {
      const { stdout: overlayList } = await adb(['shell', 'cmd', 'overlay', 'list']);
      if (
        overlays.every(
          ({ packageName }) => parseOverlayState(overlayList, packageName) === 'enabled'
        )
      ) {
        logger.info(`The ${deviceIdentifier} device profile corrections are already applied.`);
        return false;
      }

      logger.info(`Applying the ${deviceIdentifier} device profile corrections.`);
      logger.info(`Source: ${correction.source}`);
      workingDirectory = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'eas-emulator-profile-overlays-')
      );
      const apkPaths: string[] = [];
      for (const overlay of overlays) {
        apkPaths.push(
          await buildAndroidResourceOverlayApkAsync({
            packageName: overlay.packageName,
            targetPackage: overlay.targetPackage,
            category: CORRECTION_OVERLAY_CATEGORY,
            values: overlay.values,
            workingDirectory,
            env,
            logger,
          })
        );
      }

      if (!(await enableRootAsync({ serialId, env, timeoutMs: bootTimeoutMs }))) {
        logger.warn(
          `The ${deviceIdentifier} device profile corrections need root, which this system image does not allow (for example Google Play images). Skipping them.`
        );
        return false;
      }
      hasRestarted = true;

      // The first remount of a -writable-system emulator sets up overlayfs and needs a reboot.
      const firstRemount = await adbRemountAsync({ serialId, env });
      if (/reboot/i.test(firstRemount)) {
        logger.info('Rebooting the emulator to make the system partitions writable.');
        await adb(['reboot']);
        await waitForBootAsync({ serialId, env, timeoutMs: bootTimeoutMs });
        if (!(await enableRootAsync({ serialId, env, timeoutMs: bootTimeoutMs }))) {
          throw new Error(`Could not restart adbd as root on ${serialId} after the reboot.`);
        }
        const secondRemount = await adbRemountAsync({ serialId, env });
        if (!/remount succeeded/i.test(secondRemount)) {
          throw new Error(`Could not remount the system partitions: ${secondRemount.trim()}`);
        }
      }

      for (const [index, overlay] of overlays.entries()) {
        await adb(['shell', 'mkdir', '-p', path.posix.dirname(overlay.devicePath)]);
        await adb(['push', apkPaths[index], overlay.devicePath]);
      }

      // The package manager scans /product/overlay when the framework starts.
      await restartFrameworkAsync({ serialId, env, timeoutMs: bootTimeoutMs });
      await waitForOverlaysAsync({
        serialId,
        env,
        packageNames: overlays.map(({ packageName }) => packageName),
        isReady: state => state !== 'missing',
        timeoutMs: overlayTimeoutMs,
      });
      for (const { packageName } of overlays) {
        await adb(['shell', 'cmd', 'overlay', 'enable', '--user', '0', packageName]);
        await adb(['shell', 'cmd', 'overlay', 'set-priority', packageName, 'highest']);
      }
      // The reboot and the framework restart stop the emulator from turning the profile on.
      await enableProfileOverlaysAsync({ serialId, deviceIdentifier, env });

      // The window manager reads the status bar height when the framework starts.
      await restartFrameworkAsync({ serialId, env, timeoutMs: bootTimeoutMs });
      await waitForOverlaysAsync({
        serialId,
        env,
        packageNames: overlays.map(({ packageName }) => packageName),
        isReady: state => state === 'enabled',
        timeoutMs: overlayTimeoutMs,
      });
      logger.info(`Applied the ${deviceIdentifier} device profile corrections.`);
      return hasRestarted;
    } catch (err) {
      logger.warn({ err }, `Failed to apply the ${deviceIdentifier} device profile corrections.`);
      return hasRestarted;
    } finally {
      if (hasRestarted) {
        try {
          await adb(['unroot']);
          await waitForBootAsync({ serialId, env, timeoutMs: bootTimeoutMs });
        } catch (err) {
          logger.warn({ err }, `Failed to restart adbd without root on ${serialId}.`);
        }
      }
      if (workingDirectory) {
        await fs.promises.rm(workingDirectory, { recursive: true, force: true });
      }
    }
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

  function getTargetSuffix(targetPackage: AndroidResourceOverlay['targetPackage']): string {
    return targetPackage === 'android' ? 'framework' : 'systemui';
  }

  /** Restarts adbd as root. Returns false when the system image does not allow it. */
  async function enableRootAsync({
    serialId,
    env,
    timeoutMs,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }): Promise<boolean> {
    try {
      await spawn('adb', ['-s', serialId, 'root'], { env });
    } catch {
      return false;
    }
    await waitForBootAsync({ serialId, env, timeoutMs });
    const { stdout } = await spawn('adb', ['-s', serialId, 'shell', 'id', '-u'], { env });
    return stdout.trim() === '0';
  }

  async function adbRemountAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<string> {
    const { stdout, stderr } = await spawn('adb', ['-s', serialId, 'remount'], { env });
    return `${stdout}\n${stderr}`;
  }

  /** Restarts the Android framework (system_server and the apps) without rebooting the kernel. */
  async function restartFrameworkAsync({
    serialId,
    env,
    timeoutMs,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }): Promise<void> {
    await spawn('adb', ['-s', serialId, 'shell', 'stop'], { env });
    await spawn('adb', ['-s', serialId, 'shell', 'setprop', 'sys.boot_completed', '0'], { env });
    await spawn('adb', ['-s', serialId, 'shell', 'start'], { env });
    await waitForBootAsync({ serialId, env, timeoutMs });
  }

  async function waitForBootAsync({
    serialId,
    env,
    timeoutMs,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }): Promise<void> {
    await retryAsync(
      async () => {
        const { stdout } = await spawn(
          'adb',
          ['-s', serialId, 'shell', 'getprop', 'sys.boot_completed'],
          { env }
        );
        if (stdout.trim() !== '1') {
          throw new Error(`Emulator (${serialId}) boot has not completed.`);
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

  async function waitForOverlaysAsync({
    serialId,
    env,
    packageNames,
    isReady,
    timeoutMs,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
    packageNames: string[];
    isReady: (state: 'enabled' | 'disabled' | 'missing') => boolean;
    timeoutMs: number;
  }): Promise<void> {
    await retryAsync(
      async () => {
        const { stdout } = await spawn('adb', ['-s', serialId, 'shell', 'cmd', 'overlay', 'list'], {
          env,
        });
        const notReady = packageNames.filter(
          packageName => !isReady(parseOverlayState(stdout, packageName))
        );
        if (notReady.length > 0) {
          throw new Error(`Overlays are not ready on ${serialId}: ${notReady.join(', ')}.`);
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
