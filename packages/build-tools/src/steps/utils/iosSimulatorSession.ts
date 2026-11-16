import { UserError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import { minBy } from 'lodash';

import {
  type IosSimulatorName,
  IosSimulatorUtils,
  type IosSimulatorUuid,
} from '../../utils/IosSimulatorUtils';
import { readIosApplicationIdentifierAsync } from './iosAppArtifact';
import {
  type ServeSimLaunchOptions,
  parseServeSimLaunchInputs,
  validateServeSimLaunchOptions,
} from './remoteDeviceRunSession';

export type IosSessionStartup = {
  iosSimulatorUdid: string;
  installAppPath?: string;
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
  let selectedIdentifier = (deviceIdentifier ?? undefined) as
    | IosSimulatorUuid
    | IosSimulatorName
    | undefined;
  if (selectedIdentifier === undefined) {
    const devices = await IosSimulatorUtils.getAvailableDevicesAsync({ env, filter: 'available' });
    selectedIdentifier = minBy(
      devices.filter(device => device.name.startsWith('iPhone')),
      device => device.name.length
    )?.udid;
  }
  if (!selectedIdentifier) {
    throw new Error('Could not find an iPhone among available simulator devices.');
  }
  const iosSimulatorUdid = (
    await IosSimulatorUtils.resolveUdidAsync({ deviceIdentifier: selectedIdentifier, env })
  ).toUpperCase() as IosSimulatorUuid;
  signal?.throwIfAborted();
  return {
    launch,
    iosStartup: { iosSimulatorUdid, installAppPath },
  };
}
