import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { asyncResult } from '@expo/results';

import { retryAsync } from '../../utils/retry';
import {
  AndroidDeviceName,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../utils/AndroidEmulatorUtils';

export function createStartAndroidEmulatorBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_android_emulator',
    name: 'Start Android Emulator',
    __metricsId: 'eas/start_android_emulator',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'device_name',
        required: false,
        defaultValue: 'EasAndroidDevice01',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'device_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'system_image_package',
        required: false,
        defaultValue: AndroidEmulatorUtils.defaultSystemImagePackage,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'count',
        required: false,
        defaultValue: 1,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
    ],
    fn: async ({ logger }, { inputs, env }) => {
      try {
        const availableDevices = await AndroidEmulatorUtils.getAvailableDevicesAsync({ env });
        logger.info(`Available Android devices:\n- ${availableDevices.join(`\n- `)}`);
      } catch (error) {
        logger.info('Failed to list available Android devices.', error);
      } finally {
        logger.info('');
      }

      const deviceName = `${inputs.device_name.value}` as AndroidVirtualDeviceName;
      const systemImagePackage = `${inputs.system_image_package.value}`;
      // We can cast because allowedValueTypeName validated this is a string.
      const deviceIdentifier = inputs.device_identifier.value as AndroidDeviceName | undefined;

      logger.info('Making sure system image is installed');
      await retryAsync(
        async () => {
          await spawn('sdkmanager', [systemImagePackage], {
            env,
            logger,
          });
        },
        {
          logger,
          retryOptions: {
            retries: 3, // Retry 3 times
            retryIntervalMs: 1_000,
          },
        }
      );

      logger.info('Creating emulator device');
      await AndroidEmulatorUtils.createAsync({
        deviceName,
        systemImagePackage,
        deviceIdentifier: deviceIdentifier ?? null,
        env,
        logger,
      });

      logger.info('Starting emulator device');
      const { emulatorPromise, serialId } = await AndroidEmulatorUtils.startAsync({
        deviceName,
        env,
      });
      await AndroidEmulatorUtils.waitForReadyAsync({
        env,
        serialId,
      });
      logger.info(`${deviceName} is ready.`);

      const count = Number(inputs.count.value ?? 1);
      if (count > 1) {
        logger.info(`Requested ${count} emulators, shutting down ${deviceName} for cloning.`);
        await spawn('adb', ['-s', serialId, 'shell', 'reboot', '-p'], {
          logger,
          env,
        });
        // Waiting for source emulator to shutdown.
        // We don't care about resolved/rejected.
        await asyncResult(emulatorPromise);

        for (let i = 0; i < count; i++) {
          const cloneIdentifier = `eas-simulator-${i + 1}` as AndroidVirtualDeviceName;
          logger.info(`Cloning ${deviceName} to ${cloneIdentifier}...`);
          await AndroidEmulatorUtils.cloneAsync({
            sourceDeviceName: deviceName,
            destinationDeviceName: cloneIdentifier,
            env,
            logger,
          });

          logger.info('Starting emulator device');
          const { serialId } = await AndroidEmulatorUtils.startAsync({
            deviceName: cloneIdentifier,
            env,
          });

          logger.info('Waiting for emulator to become ready');
          await AndroidEmulatorUtils.waitForReadyAsync({
            serialId,
            env,
          });

          logger.info(`${cloneIdentifier} is ready.`);
        }
      }
    },
  });
}
