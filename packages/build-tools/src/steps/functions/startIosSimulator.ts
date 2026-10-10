import { UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildRuntimePlatform,
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
  resolveLocalEgressServeSimBootEnvironmentAsync,
  startLocalEgressGuardRelayAsync,
  verifyLocalEgressGuardAsync,
} from '../utils/localEgressGuard';

import {
  IosSimulatorName,
  IosSimulatorUtils,
  IosSimulatorUuid,
} from '../../utils/IosSimulatorUtils';

import { readIosApplicationIdentifierAsync } from './installBuild';
import {
  type ServeSimLaunchOptions,
  parseServeSimLaunchInputs,
  validateServeSimLaunchOptions,
} from '../utils/remoteDeviceRunSession';

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

          await prepareBootedIosSimulatorAsync({ udid: cloneUdid, env, logger });

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

  const deviceIdentifier = await selectIosSimulatorIdentifierAsync({
    deviceIdentifier: deviceIdentifierInput,
    env,
  });

  if (enableAccessibilitySettings) {
    await IosSimulatorUtils.enableAccessibilitySettingsAsync({ deviceIdentifier, env });
  }
  const udid = await bootWithLocalEgressAsync({ deviceIdentifier, env, logger });
  await prepareBootedIosSimulatorAsync({ udid, env, logger });

  logger.info('');

  const device = await IosSimulatorUtils.getDeviceAsync({ udid, env });
  const displayName = device?.displayName ?? deviceIdentifier;
  logger.info(`${displayName} is ready.`);
  return { deviceIdentifier, udid, displayName };
}

type BootedIosSimulatorOptions = {
  udid: IosSimulatorUuid;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
};

export async function prepareBootedIosSimulatorAsync(
  options: BootedIosSimulatorOptions
): Promise<void> {
  await disableIosSimulatorPushAsync(options);
  await IosSimulatorUtils.waitForReadyAsync({ udid: options.udid, env: options.env });
}

export async function disableIosSimulatorPushAsync({
  udid,
  env,
  logger,
  signal,
}: BootedIosSimulatorOptions): Promise<void> {
  try {
    await IosSimulatorUtils.disableApsdAsync({ udid, env });
  } catch (err) {
    signal?.throwIfAborted();
    logger.warn({ err }, 'Failed to disable apsd in the Simulator.');
  }
  signal?.throwIfAborted();
}

export async function resolveIosSimulatorUdidAsync({
  deviceIdentifier,
  env,
}: {
  deviceIdentifier?: IosSimulatorUuid | IosSimulatorName;
  env: BuildStepEnv;
}): Promise<IosSimulatorUuid> {
  const selectedIdentifier = await selectIosSimulatorIdentifierAsync({ deviceIdentifier, env });
  const udid = await IosSimulatorUtils.resolveUdidAsync({
    deviceIdentifier: selectedIdentifier,
    env,
  });
  return udid.toUpperCase() as IosSimulatorUuid;
}

async function selectIosSimulatorIdentifierAsync({
  deviceIdentifier,
  env,
}: {
  deviceIdentifier?: IosSimulatorUuid | IosSimulatorName;
  env: BuildStepEnv;
}): Promise<IosSimulatorUuid | IosSimulatorName> {
  const selectedIdentifier = deviceIdentifier ?? (await findMostGenericIphoneUuidAsync({ env }));
  if (!selectedIdentifier) {
    throw new Error('Could not find an iPhone among available simulator devices.');
  }
  return selectedIdentifier;
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

export type IosSessionStartup = {
  iosSimulatorUdid: string;
  installAppPath?: string;
  bootEnv?: Record<string, string>;
};

export async function resolveIosSessionStartupAsync({
  runtimePlatform,
  bootSimulator,
  deviceIdentifier,
  installAppPath,
  launchAppIdentifier,
  launchArgs,
  openUrl,
  env,
  logger,
  signal,
}: {
  runtimePlatform: BuildRuntimePlatform;
  bootSimulator?: boolean;
  deviceIdentifier?: string;
  installAppPath?: string;
  launchAppIdentifier?: unknown;
  launchArgs?: unknown;
  openUrl?: unknown;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<{ launch: ServeSimLaunchOptions; iosStartup?: IosSessionStartup }> {
  signal?.throwIfAborted();
  if ((bootSimulator || installAppPath) && runtimePlatform !== BuildRuntimePlatform.DARWIN) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      'install_app_path is only supported for iOS Simulator sessions.'
    );
  }
  const applicationIdentifier =
    launchAppIdentifier ??
    (installAppPath
      ? await readIosApplicationIdentifierAsync({ artifactPath: installAppPath, env })
      : undefined);
  const launch = parseServeSimLaunchInputs(
    { launchAppIdentifier: applicationIdentifier, launchArgs, openUrl },
    { runtimePlatform }
  );
  if (
    runtimePlatform !== BuildRuntimePlatform.DARWIN ||
    (!bootSimulator && !deviceIdentifier && !installAppPath)
  ) {
    return { launch };
  }
  validateServeSimLaunchOptions(launch);
  signal?.throwIfAborted();
  const iosSimulatorUdid = await resolveIosSimulatorUdidAsync({
    deviceIdentifier: deviceIdentifier as IosSimulatorUuid | IosSimulatorName | undefined,
    env,
  });
  const bootEnv = await resolveLocalEgressServeSimBootEnvironmentAsync();
  signal?.throwIfAborted();
  if (bootEnv) {
    const device = await IosSimulatorUtils.getDeviceAsync({ udid: iosSimulatorUdid, env });
    signal?.throwIfAborted();
    if (device && device.state !== 'Shutdown') {
      logger.info(`Shutting down ${iosSimulatorUdid} to apply the local egress guard at boot.`);
      await spawn('xcrun', ['simctl', 'shutdown', iosSimulatorUdid], { env, logger, signal });
    }
    signal?.throwIfAborted();
    await startLocalEgressGuardRelayAsync({ logger });
  }
  signal?.throwIfAborted();
  return {
    launch,
    iosStartup: { iosSimulatorUdid, installAppPath, bootEnv: bootEnv ?? undefined },
  };
}
