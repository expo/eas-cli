import {
  BuildFunction,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { minBy } from 'lodash';

import { bootResidentIosSimulatorAsync } from '../utils/residentIosSimulator';

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
    fn: async ({ logger }, { inputs, env, signal }) => {
      const deviceIdentifierInput = inputs.device_identifier.value?.toString() as
        | IosSimulatorUuid
        | IosSimulatorName
        | undefined;
      const enableAccessibilitySettings = Boolean(inputs.enable_accessibility_settings.value);
      const { deviceIdentifier: originalDeviceIdentifier, displayName: formattedDevice } =
        await bootIosSimulatorAsync({
          deviceIdentifier: deviceIdentifierInput,
          enableAccessibilitySettings,
          signal,
          env,
          logger,
        });

      const count = Number(inputs.count.value ?? 1);
      if (count > 1) {
        signal?.throwIfAborted();
        logger.info(`Requested ${count} Simulators, shutting down ${formattedDevice} for cloning.`);
        await spawn('xcrun', ['simctl', 'shutdown', originalDeviceIdentifier], {
          logger,
          env,
          signal,
        });

        for (let i = 0; i < count; i++) {
          signal?.throwIfAborted();
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
          const cloneUdid = await bootWithResidentEgressAsync({
            deviceIdentifier: cloneDeviceName,
            env,
            logger,
            signal,
          });

          logger.info(`${cloneDeviceName} is ready.`);
          logger.info('');
        }
      }
    },
  });
}

/**
 * Boots one iOS Simulator and waits until it is ready: the requested device, or the
 * most generic iPhone when none is given.
 */
export async function bootIosSimulatorAsync({
  deviceIdentifier: deviceIdentifierInput,
  enableAccessibilitySettings = false,
  signal,
  env,
  logger,
}: {
  deviceIdentifier?: IosSimulatorUuid | IosSimulatorName;
  enableAccessibilitySettings?: boolean;
  signal?: AbortSignal;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<{
  deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
  udid: IosSimulatorUuid;
  displayName: string;
}> {
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

  const deviceIdentifier = deviceIdentifierInput ?? (await findMostGenericIphoneUuidAsync({ env }));
  if (!deviceIdentifier) {
    throw new Error('Could not find an iPhone among available simulator devices.');
  }

  if (enableAccessibilitySettings) {
    await IosSimulatorUtils.enableAccessibilitySettingsAsync({ deviceIdentifier, env });
  }
  const udid = await bootWithResidentEgressAsync({ deviceIdentifier, env, logger, signal });

  logger.info('');

  const device = await IosSimulatorUtils.getDeviceAsync({ udid, env });
  const displayName = device?.displayName ?? deviceIdentifier;
  logger.info(`${displayName} is ready.`);
  return { deviceIdentifier, udid, displayName };
}

async function bootWithResidentEgressAsync({
  deviceIdentifier,
  env,
  logger,
  signal,
}: {
  deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<IosSimulatorUuid> {
  const udid = await IosSimulatorUtils.resolveUdidAsync({ deviceIdentifier, env });
  signal?.throwIfAborted();
  await bootResidentIosSimulatorAsync({ udid, env, logger, signal });
  signal?.throwIfAborted();
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
