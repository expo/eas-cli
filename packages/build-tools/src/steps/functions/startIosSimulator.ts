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
  resolveLocalEgressBootEnvironmentAsync,
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
      const deviceIdentifierInput = inputs.device_identifier.value?.toString() as
        | IosSimulatorUuid
        | IosSimulatorName
        | undefined;
      const enableAccessibilitySettings = Boolean(inputs.enable_accessibility_settings.value);
      const { deviceIdentifier: originalDeviceIdentifier, displayName: formattedDevice } =
        await bootIosSimulatorAsync({
          deviceIdentifier: deviceIdentifierInput,
          enableAccessibilitySettings,
          env,
          logger,
        });

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
 * Boots one iOS Simulator and waits until it is ready: the requested device, or the
 * most generic iPhone when none is given.
 */
export async function bootIosSimulatorAsync({
  deviceIdentifier: deviceIdentifierInput,
  enableAccessibilitySettings = false,
  env,
  logger,
}: {
  deviceIdentifier?: IosSimulatorUuid | IosSimulatorName;
  enableAccessibilitySettings?: boolean;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<{
  deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
  udid: IosSimulatorUuid;
  displayName: string;
}> {
  let availableDevices:
    | Awaited<ReturnType<typeof IosSimulatorUtils.getAvailableDevicesAsync>>
    | undefined;
  try {
    availableDevices = await IosSimulatorUtils.getAvailableDevicesAsync({
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

  let deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
  let resolvedUdid: IosSimulatorUuid | undefined;
  if (deviceIdentifierInput !== undefined) {
    deviceIdentifier = deviceIdentifierInput;
  } else {
    const defaultUdid = findMostGenericIphoneUuid(
      availableDevices ??
        (await IosSimulatorUtils.getAvailableDevicesAsync({
          env,
          filter: 'available',
        }))
    );
    if (!defaultUdid) {
      throw new Error('Could not find an iPhone among available simulator devices.');
    }
    deviceIdentifier = defaultUdid;
    resolvedUdid = defaultUdid;
  }

  if (enableAccessibilitySettings) {
    await IosSimulatorUtils.enableAccessibilitySettingsAsync({ deviceIdentifier, env });
  }
  const udid = await bootWithLocalEgressAsync({
    deviceIdentifier,
    resolvedUdid,
    availableDevices,
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
  const displayName = device?.displayName ?? deviceIdentifier;
  logger.info(`${displayName} is ready.`);
  return { deviceIdentifier, udid, displayName };
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
  resolvedUdid,
  availableDevices,
  env,
  logger,
}: {
  deviceIdentifier: IosSimulatorUuid | IosSimulatorName;
  resolvedUdid?: IosSimulatorUuid;
  availableDevices?: IosSimulatorUtils.SimulatorDevice[];
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<IosSimulatorUuid> {
  const udid =
    resolvedUdid ??
    (await IosSimulatorUtils.resolveUdidAsync({
      deviceIdentifier,
      env,
      ...(availableDevices !== undefined ? { availableDevices } : {}),
    }));
  // The guard and proxy variables ride the boot itself, so launchd has them
  // before it spawns its first process.
  const launchdEnvironment = await resolveLocalEgressBootEnvironmentAsync();
  await IosSimulatorUtils.bootAsync({
    deviceIdentifier: udid,
    env,
    launchdEnvironment: launchdEnvironment ?? {},
  });
  // Also set them through launchctl, for a device that was already booted.
  const guardInstalled = await installLocalEgressGuardAsync({ udid, env, logger });
  await configureSimulatorProxyEnvironmentAsync({ udid, env, logger });
  await IosSimulatorUtils.startAsync({ deviceIdentifier: udid, env });
  if (guardInstalled) {
    await verifyLocalEgressGuardAsync({ udid, env, logger });
  }
  return udid;
}

function findMostGenericIphoneUuid(
  availableSimulatorDevices: Awaited<ReturnType<typeof IosSimulatorUtils.getAvailableDevicesAsync>>
): IosSimulatorUuid | null {
  const availableIphones = availableSimulatorDevices.filter(
    device => device.isAvailable !== false && device.name.startsWith('iPhone')
  );
  // It's funny, but it works.
  const iphoneWithShortestName = minBy(availableIphones, device => device.name.length);
  return (iphoneWithShortestName?.udid.toUpperCase() as IosSimulatorUuid | undefined) ?? null;
}
