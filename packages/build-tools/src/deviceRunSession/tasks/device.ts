import { Platform } from '@expo/eas-build-job';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertAndroidEmulatorHostSupportAsync,
  startAndroidEmulatorAsync,
} from '../../steps/functions/startAndroidEmulator';
import { bootIosSimulatorAsync } from '../../steps/functions/startIosSimulator';
import {
  type AndroidDeviceName,
  AndroidEmulatorUtils,
  type AndroidVirtualDeviceName,
} from '../../utils/AndroidEmulatorUtils';
import { type IosSimulatorName, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';
import { type SessionTask } from '../runtime';

export const BOOT_DEVICE_TASK_ID = 'boot_device';
const ANDROID_VIRTUAL_DEVICE_NAME = 'EasAndroidDevice01' as AndroidVirtualDeviceName;

/** Boots the iOS Simulator or Android emulator described by the job and waits until it accepts input. */
export function createBootDeviceTask({ needs }: { needs: readonly string[] }): SessionTask {
  return {
    id: BOOT_DEVICE_TASK_ID,
    displayName: 'Start device',
    needs,
    onFailure: 'fail-session',
    run: async ({ runtime, logger }) => {
      const { device, env } = runtime;
      if (device.platform === Platform.IOS) {
        const booted = await bootIosSimulatorAsync({
          deviceIdentifier: device.deviceIdentifier as
            | IosSimulatorUuid
            | IosSimulatorName
            | undefined,
          env,
          logger,
        });
        runtime.state.device = { displayName: booted.displayName, udid: booted.udid };
        return;
      }

      if (env.EAS_NO_EMULATOR_HOST_SUPPORT_CHECK !== '1') {
        await assertAndroidEmulatorHostSupportAsync({ env });
      }
      try {
        const availableDevices = await AndroidEmulatorUtils.getAvailableDevicesAsync({ env });
        logger.info(`Available Android devices:\n- ${availableDevices.join(`\n- `)}`);
      } catch (error) {
        logger.info('Failed to list available Android devices.', error);
      }
      const logcatDirectory = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'eas-android-emulator-logcat-')
      );
      const adjustAnimationScale =
        env.ANDROID_EMULATOR_ADJUST_ANIMATION_SCALE !== 'false' &&
        env.ANDROID_EMULATOR_ADJUST_ANIMATION_SCALE !== '0';
      const { serialId } = await startAndroidEmulatorAsync({
        deviceName: ANDROID_VIRTUAL_DEVICE_NAME,
        deviceIdentifier: device.deviceIdentifier as AndroidDeviceName,
        systemImagePackage: device.systemImagePackage,
        lcdWidth: device.lcdWidth ?? null,
        lcdHeight: device.lcdHeight ?? null,
        lcdDensity: device.lcdDensity ?? null,
        adjustAnimationScale,
        logcatDirectory,
        env,
        logger,
      });
      runtime.state.device = { displayName: ANDROID_VIRTUAL_DEVICE_NAME, serialId };
    },
  };
}
