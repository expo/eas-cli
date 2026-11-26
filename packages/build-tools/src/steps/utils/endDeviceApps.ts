import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';

import { AndroidEmulatorUtils } from '../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils } from '../../utils/IosSimulatorUtils';

/** A wedged device must not hold the job: the session is already stopped. */
const END_DEVICE_APPS_TIMEOUT_MS = 30_000;

/**
 * Ends the apps on every booted Simulator or emulator. An app that ends closes its connections,
 * so a dev server reached through a tunnel drops the app's debugger page. The VM delete after the
 * job closes nothing: the page then stays listed until the dev server restarts.
 */
export async function endDeviceAppsAsync({
  runtimePlatform,
  env,
  logger,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  const signal = AbortSignal.timeout(END_DEVICE_APPS_TIMEOUT_MS);
  switch (runtimePlatform) {
    case BuildRuntimePlatform.DARWIN: {
      const simulators = await IosSimulatorUtils.getAvailableDevicesAsync({
        env,
        filter: 'booted',
        signal,
      });
      await endOnEachDeviceAsync(
        simulators.map(({ udid }) => [
          `Simulator ${udid}`,
          () => IosSimulatorUtils.terminateUserAppsAsync({ udid, env, logger, signal }),
        ])
      );
      return;
    }
    case BuildRuntimePlatform.LINUX: {
      const emulators = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env, signal });
      await endOnEachDeviceAsync(
        emulators
          .filter(({ state }) => state === 'device')
          .map(({ serialId }) => [
            `emulator ${serialId}`,
            async () => {
              await AndroidEmulatorUtils.forceStopUserAppsAsync({ serialId, env, signal });
              logger.info(`Ended the installed apps on the emulator ${serialId}.`);
            },
          ])
      );
      return;
    }
  }
}

/** Every device gets its turn; one that fails does not keep the apps of the others running. */
async function endOnEachDeviceAsync(
  devices: [name: string, endAsync: () => Promise<void>][]
): Promise<void> {
  const errors: Error[] = [];
  for (const [name, endAsync] of devices) {
    try {
      await endAsync();
    } catch (err) {
      errors.push(new Error(`Could not end the apps on the ${name}.`, { cause: err }));
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `Could not end the apps on ${errors.length} device(s).`);
  }
}
