import { asyncResult } from '@expo/results';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import {
  AndroidDeviceName,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../utils/AndroidEmulatorUtils';
import { retryAsync } from '../../utils/retry';

const ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS = [60_000, 120_000, 180_000];
const ANDROID_STARTUP_RETRIES_COUNT = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS.length - 1;

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

      let emulatorPromise = null;
      let serialId = null;
      await retryAsync(
        async attemptCount => {
          const timeoutMs = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS[attemptCount];
          const attempt = attemptCount + 1;
          const maxAttempts = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS.length;
          const attemptSuffix = attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : '';
          let attemptSerialId = null;

          try {
            logger.info(`Creating emulator device${attemptSuffix}.`);
            await AndroidEmulatorUtils.createAsync({
              deviceName,
              systemImagePackage,
              deviceIdentifier: deviceIdentifier ?? null,
              env,
              logger,
            });

            logger.info(`Starting emulator device${attemptSuffix}.`);
            const startResult = await AndroidEmulatorUtils.startAsync({
              deviceName,
              env,
            });
            attemptSerialId = startResult.serialId;
            await AndroidEmulatorUtils.waitForReadyAsync({
              env,
              serialId: attemptSerialId,
              timeoutMs,
              logger,
            });
            logger.info(`${deviceName} is ready.`);

            serialId = attemptSerialId;
            emulatorPromise = startResult.emulatorPromise;
          } catch (err) {
            logger.warn(
              { err },
              `${deviceName} failed to start on attempt ${attempt}/${maxAttempts}.`
            );
            try {
              if (attemptSerialId) {
                await AndroidEmulatorUtils.deleteAsync({
                  serialId: attemptSerialId,
                  deviceName,
                  env,
                });
              } else {
                await AndroidEmulatorUtils.deleteAsync({
                  deviceName,
                  env,
                });
              }
            } catch (cleanupErr) {
              logger.warn({ err: cleanupErr }, `Failed to clean up ${deviceName}.`);
            }
            throw err;
          }
        },
        {
          logger,
          retryOptions: {
            retries: ANDROID_STARTUP_RETRIES_COUNT,
            retryIntervalMs: 1_000,
          },
        }
      );

      if (!serialId || !emulatorPromise) {
        throw new Error(`Failed to start emulator ${deviceName}.`);
      }

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
          await retryAsync(
            async attemptCount => {
              const timeoutMs = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS[attemptCount];
              const attempt = attemptCount + 1;
              const maxAttempts = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS.length;
              const attemptSuffix = attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : '';
              let cloneSerialId = null;
              try {
                logger.info(`Cloning ${deviceName} to ${cloneIdentifier}${attemptSuffix}.`);
                await AndroidEmulatorUtils.cloneAsync({
                  sourceDeviceName: deviceName,
                  destinationDeviceName: cloneIdentifier,
                  env,
                  logger,
                });

                logger.info(`Starting emulator device${attemptSuffix}.`);
                const startResult = await AndroidEmulatorUtils.startAsync({
                  deviceName: cloneIdentifier,
                  env,
                });
                cloneSerialId = startResult.serialId;

                logger.info('Waiting for emulator to become ready');
                await AndroidEmulatorUtils.waitForReadyAsync({
                  serialId: cloneSerialId,
                  env,
                  timeoutMs,
                  logger,
                });

                logger.info(`${cloneIdentifier} is ready.`);
              } catch (err) {
                logger.warn(
                  { err },
                  `${cloneIdentifier} failed to start on attempt ${attempt}/${maxAttempts}.`
                );
                try {
                  if (cloneSerialId) {
                    await AndroidEmulatorUtils.deleteAsync({
                      serialId: cloneSerialId,
                      deviceName: cloneIdentifier,
                      env,
                    });
                  } else {
                    await AndroidEmulatorUtils.deleteAsync({
                      deviceName: cloneIdentifier,
                      env,
                    });
                  }
                } catch (cleanupErr) {
                  logger.warn({ err: cleanupErr }, `Failed to clean up ${cloneIdentifier}.`);
                }
                throw err;
              }
            },
            {
              logger,
              retryOptions: {
                retries: ANDROID_STARTUP_RETRIES_COUNT,
                retryIntervalMs: 1_000,
              },
            }
          );
        }
      }
    },
  });
}
