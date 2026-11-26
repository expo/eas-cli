import { UserError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { minBy } from 'lodash';

import {
  type IosSimulatorName,
  IosSimulatorUtils,
  type IosSimulatorUuid,
} from '../../utils/IosSimulatorUtils';
import {
  resolveLocalEgressServeSimBootEnvironmentAsync,
  startLocalEgressGuardRelayAsync,
} from './localEgressGuard';
import { readIosApplicationIdentifierAsync } from './iosAppArtifact';
import {
  type ServeSimLaunchOptions,
  parseServeSimLaunchInputs,
  validateServeSimLaunchOptions,
} from './remoteDeviceRunSession';
import { WarmSessionAdoptionError } from './warmDeviceSessionHost';

export type IosSessionStartup = {
  iosSimulatorUdid: string;
  installAppPath?: string;
  bootEnv?: Record<string, string>;
};

export async function resolveIosSessionStartupAsync({
  runtimePlatform,
  bootSimulator,
  deviceIdentifier,
  warmDeviceUdid,
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
  warmDeviceUdid?: string;
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
    (!bootSimulator && !deviceIdentifier && !warmDeviceUdid && !installAppPath)
  ) {
    return { launch };
  }
  validateServeSimLaunchOptions(launch);
  signal?.throwIfAborted();
  let iosSimulatorUdid: IosSimulatorUuid;
  if (warmDeviceUdid !== undefined) {
    try {
      iosSimulatorUdid = (
        await IosSimulatorUtils.resolveUdidAsync({
          deviceIdentifier: warmDeviceUdid as IosSimulatorUuid,
          env,
          ...(signal ? { signal } : {}),
        })
      ).toUpperCase() as IosSimulatorUuid;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof UserError && error.errorCode === 'EAS_IOS_SIMULATOR_NOT_FOUND') {
        throw new WarmSessionAdoptionError();
      }
      throw error;
    }
  } else if (deviceIdentifier !== undefined) {
    try {
      iosSimulatorUdid = (
        await IosSimulatorUtils.resolveUdidAsync({
          deviceIdentifier: deviceIdentifier as IosSimulatorUuid | IosSimulatorName,
          env,
          ...(signal ? { signal } : {}),
        })
      ).toUpperCase() as IosSimulatorUuid;
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    }
  } else {
    let devices: IosSimulatorUtils.SimulatorDevice[];
    try {
      devices = await IosSimulatorUtils.getAvailableDevicesAsync({
        env,
        filter: 'available',
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    }
    signal?.throwIfAborted();
    const defaultUdid = minBy(
      devices.filter(device => device.isAvailable !== false && device.name.startsWith('iPhone')),
      device => device.name.length
    )?.udid;
    if (!defaultUdid) {
      throw new Error('Could not find an iPhone among available simulator devices.');
    }
    iosSimulatorUdid = defaultUdid.toUpperCase() as IosSimulatorUuid;
  }
  const bootEnv = await resolveLocalEgressServeSimBootEnvironmentAsync();
  signal?.throwIfAborted();
  if (bootEnv) {
    const device = await IosSimulatorUtils.getDeviceAsync({ udid: iosSimulatorUdid, env });
    signal?.throwIfAborted();
    if (device && device.state !== 'Shutdown') {
      logger.info(`Shutting down ${iosSimulatorUdid} to apply the local egress guard at boot.`);
      try {
        await spawn('xcrun', ['simctl', 'shutdown', iosSimulatorUdid], { env, logger, signal });
      } catch (error) {
        signal?.throwIfAborted();
        throw error;
      }
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
