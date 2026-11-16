import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { AndroidEmulatorUtils } from '../../utils/AndroidEmulatorUtils';

const RUNNING_IOS_APP = /\tUIKitApplication:([^[\s]+)\[/;

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
  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    await endIosAppsAsync(env, logger);
  } else {
    await endAndroidAppsAsync(env, logger);
  }
}

async function endIosAppsAsync(env: BuildStepEnv, logger: bunyan): Promise<void> {
  const list = await spawn('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { env });
  const { devices } = JSON.parse(list.stdout) as { devices: Record<string, { udid: string }[]> };
  for (const { udid } of Object.values(devices).flat()) {
    const labels = await spawn('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], { env });
    const apps = new Set(
      labels.stdout
        .split('\n')
        .map(line => RUNNING_IOS_APP.exec(line)?.[1])
        .filter((app): app is string => !!app && !app.startsWith('com.apple.'))
    );
    for (const app of apps) {
      // An app that exited since the list answers "found nothing to terminate".
      const result = await spawn('xcrun', ['simctl', 'terminate', udid, app], { env }).catch(
        (err: unknown) => err
      );
      if (result instanceof Error) {
        logger.warn({ err: result }, `Could not end ${app} on the Simulator ${udid}.`);
      } else {
        logger.info(`Ended ${app} on the Simulator ${udid}.`);
      }
    }
  }
}

async function endAndroidAppsAsync(env: BuildStepEnv, logger: bunyan): Promise<void> {
  const devices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env });
  for (const { serialId } of devices.filter(({ state }) => state === 'device')) {
    await spawn(
      'adb',
      [
        '-s',
        serialId,
        'shell',
        'for p in $(pm list packages -3 | cut -d: -f2); do am force-stop "$p"; done',
      ],
      { env }
    );
    logger.info(`Ended the installed apps on the emulator ${serialId}.`);
  }
}
