import {
  BuildFunction,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { minBy } from 'lodash';

import { configureSimulatorProxyEnvironmentAsync } from '../utils/localEgress';
import {
  installLocalEgressGuardAsync,
  verifyLocalEgressGuardAsync,
} from '../utils/localEgressGuard';

import {
  IosSimulatorName,
  IosSimulatorUtils,
  IosSimulatorUuid,
} from '../../utils/IosSimulatorUtils';

export function createStartIosSimulatorBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_ios_simulator',
    name: 'Start iOS Simulator',
    __metricsId: 'eas/start_ios_simulator',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'device_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'count',
        required: false,
        defaultValue: 1,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'enable_accessibility_settings',
        required: false,
        defaultValue: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
    ],
    fn: async ({ logger }, { inputs, env }) => {
      try {
        const availableDevices = await IosSimulatorUtils.getAvailableDevicesAsync({
          env,
          filter: 'available',
        });
        logger.info(
          `Available Simulator devices:\n- ${availableDevices
            .map(device => device.displayName)
            .join(`\n- `)}`
        );
      } catch (error) {
        logger.info('Failed to list available Simulator devices.', error);
      } finally {
        logger.info('');
      }

      const deviceIdentifierInput = inputs.device_identifier.value?.toString() as
        | IosSimulatorUuid
        | IosSimulatorName
        | undefined;
      const originalDeviceIdentifier =
        deviceIdentifierInput ?? (await findMostGenericIphoneUuidAsync({ env }));
      const enableAccessibilitySettings = Boolean(inputs.enable_accessibility_settings.value);

      if (!originalDeviceIdentifier) {
        throw new Error('Could not find an iPhone among available simulator devices.');
      }

      if (enableAccessibilitySettings) {
        await IosSimulatorUtils.enableAccessibilitySettingsAsync({
          deviceIdentifier: originalDeviceIdentifier,
          env,
        });
      }
      const udid = await bootWithLocalEgressAsync({
        deviceIdentifier: originalDeviceIdentifier,
        env,
        logger,
      });

      try {
        await IosSimulatorUtils.disableApsdAsync({ udid, env });
      } catch (err) {
        logger.warn({ err }, 'Failed to disable apsd in the Simulator.');
      }

      await IosSimulatorUtils.waitForReadyAsync({ udid, env });

      logger.info('');

      const device = await IosSimulatorUtils.getDeviceAsync({ udid, env });
      const formattedDevice = device?.displayName ?? originalDeviceIdentifier;
      logger.info(`${formattedDevice} is ready.`);

      const count = Number(inputs.count.value ?? 1);
      if (count > 1) {
        logger.info(`Requested ${count} Simulators, shutting down ${formattedDevice} for cloning.`);
        await spawn('xcrun', ['simctl', 'shutdown', originalDeviceIdentifier], {
          logger,
          env,
        });

        for (let i = 0; i < count; i++) {
          const cloneDeviceName = `eas-simulator-${i + 1}` as IosSimulatorName;
          logger.info(`Cloning ${formattedDevice} to ${cloneDeviceName}...`);

          await IosSimulatorUtils.cloneAsync({
            sourceDeviceIdentifier: originalDeviceIdentifier,
            destinationDeviceName: cloneDeviceName,
            env,
          });

          if (enableAccessibilitySettings) {
            await IosSimulatorUtils.enableAccessibilitySettingsAsync({
              deviceIdentifier: cloneDeviceName,
              env,
            });
          }
          const cloneUdid = await bootWithLocalEgressAsync({
            deviceIdentifier: cloneDeviceName,
            env,
            logger,
          });

          try {
            await IosSimulatorUtils.disableApsdAsync({ udid: cloneUdid, env });
          } catch (err) {
            logger.warn({ err }, 'Failed to disable apsd in the Simulator.');
          }

          await IosSimulatorUtils.waitForReadyAsync({
            udid: cloneUdid,
            env,
          });

          logger.info(`${cloneDeviceName} is ready.`);
          logger.info('');
        }
      }
    },
  });
}

/**
 * Boot a device with the local egress environment in place before anything
 * inside it starts. `simctl boot` returns once the simulator's launchd is up
 * and before it has spawned anything else, which is the only moment at which
 * launchd environment reaches every process of the boot. The proxy variables
 * and the guard are set in that gap; then the boot is waited for and the
 * guard is verified in a fresh process. Nothing here applies when no local
 * egress session is active.
 */
async function bootWithLocalEgressAsync({
  deviceIdentifier,
  env,
  logger,
}: {
  deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<IosSimulatorUuid> {
  const udid = await IosSimulatorUtils.resolveUdidAsync({ deviceIdentifier, env });
  await IosSimulatorUtils.bootAsync({ deviceIdentifier: udid, env });
  // The guard goes first: it is the enforcement, and every process launchd
  // spawns from here on must inherit it. The proxy variables follow.
  const guardInstalled = await installLocalEgressGuardAsync({ udid, env, logger });
  await configureSimulatorProxyEnvironmentAsync({ udid, env, logger });
  await IosSimulatorUtils.startAsync({ deviceIdentifier: udid, env });
  if (guardInstalled) {
    await verifyLocalEgressGuardAsync({ udid, env, logger });
  }
  return udid;
}

async function findMostGenericIphoneUuidAsync({
  env,
}: {
  env: BuildStepEnv;
}): Promise<IosSimulatorUuid | null> {
  const availableSimulatorDevices = await IosSimulatorUtils.getAvailableDevicesAsync({
    env,
    filter: 'available',
  });
  const availableIphones = availableSimulatorDevices.filter(device =>
    device.name.startsWith('iPhone')
  );
  // It's funny, but it works.
  const iphoneWithShortestName = minBy(availableIphones, device => device.name.length);
  return iphoneWithShortestName?.udid ?? null;
}
