import * as osascript from '@expo/osascript';
import spawnAsync from '@expo/spawn-async';

import { simctlAsync } from './simctl';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { sleepAsync } from '../../utils/promise';

interface IosSimulator {
  runtime: string;
  osVersion: string;
  windowName: string;
  osType: 'iOS';
  state: 'Booted' | 'Shutdown';
  isAvailable: boolean;
  name: string;
  udid: string;
  lastBootedAt?: Date;
}

export async function selectSimulatorAsync(): Promise<IosSimulator> {
  const bootedSimulator = await getFirstBootedIosSimulatorAsync();

  if (bootedSimulator) {
    return bootedSimulator;
  }

  const simulators = await getAvaliableIosSimulatorsListAsync();

  Log.newLine();
  const { selectedSimulator } = await promptAsync({
    type: 'select',
    message: `Select a simulator to run your app on`,
    name: 'selectedSimulator',
    choices: simulators.map(simulator => ({
      title: `iOS ${simulator.osVersion} ${simulator.name}`,
      value: simulator,
    })),
  });

  return selectedSimulator;
}

export async function getFirstBootedIosSimulatorAsync(): Promise<IosSimulator | undefined> {
  const bootedSimulators = await getAvaliableIosSimulatorsListAsync('booted');

  if (bootedSimulators.length > 0) {
    return bootedSimulators[0];
  }
  return undefined;
}

export async function getAvaliableIosSimulatorsListAsync(query?: string): Promise<IosSimulator[]> {
  const { stdout } = query
    ? await simctlAsync(['list', 'devices', '--json', query])
    : await simctlAsync(['list', 'devices', '--json']);
  const info = parseSimControlJsonResults(stdout);

  const iosSimulators = [];

  for (const runtime of Object.keys(info.devices)) {
    // Given a string like 'com.apple.CoreSimulator.SimRuntime.tvOS-13-4'
    const runtimeSuffix = runtime.split('com.apple.CoreSimulator.SimRuntime.').pop();

    if (!runtimeSuffix) {
      continue;
    }

    // Create an array [tvOS, 13, 4]
    const [osType, ...osVersionComponents] = runtimeSuffix.split('-');

    if (osType === 'iOS') {
      // Join the end components [13, 4] -> '13.4'
      const osVersion = osVersionComponents.join('.');
      const sims = info.devices[runtime];
      for (const device of sims) {
        if (device.isAvailable) {
          iosSimulators.push({
            ...device,
            runtime,
            osVersion,
            windowName: `${device.name} (${osVersion})`,
            osType: 'iOS' as const,
            state: device.state as 'Booted' | 'Shutdown',
            lastBootedAt: device.lastBootedAt ? new Date(device.lastBootedAt) : undefined,
          });
        }
      }
    }
  }
  return iosSimulators;
}

function parseSimControlJsonResults(input: string): any {
  try {
    return JSON.parse(input);
  } catch (error: any) {
    // Nov 15, 2020: Observed this can happen when opening the simulator and the simulator prompts the user to update the xcode command line tools.
    // Unexpected token I in JSON at position 0
    if (error.message.includes('Unexpected token')) {
      Log.error(`Apple's simctl returned malformed JSON:\n${input}`);
    }
    throw error;
  }
}

export async function ensureSimulatorBootedAsync(simulator: IosSimulator): Promise<void> {
  if (simulator.state === 'Booted') {
    return;
  }

  await simctlAsync(['boot', simulator.udid]);
}

export async function openSimulatorAppAsync(simulatorUdid: string): Promise<void> {
  const args = ['-a', 'Simulator'];
  if (simulatorUdid) {
    // This has no effect if the app is already running.
    args.push('--args', '-CurrentDeviceUDID', simulatorUdid);
  }
  await spawnAsync('open', args);
}

export async function launchAppAsync(
  simulatorUdid: string,
  bundleIdentifier: string
): Promise<void> {
  Log.newLine();
  Log.log('Launching your app...');

  await simctlAsync(['launch', simulatorUdid, bundleIdentifier]);

  Log.succeed('Successfully launched your app!');
}

// I think the app can be open while no simulators are booted.
async function waitForSimulatorAppToStartAsync(
  maxWaitTimeMs: number,
  intervalMs: number
): Promise<void> {
  Log.newLine();
  Log.log('Waiting for Simulator app to start...');

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitTimeMs) {
    if (await isSimulatorAppRunningAsync()) {
      return;
    }
    await sleepAsync(Math.min(intervalMs, Math.max(maxWaitTimeMs - (Date.now() - startTime), 0)));
  }
  throw new Error('Timed out waiting for the iOS simulator to start.');
}

async function isSimulatorAppRunningAsync(): Promise<boolean> {
  try {
    const result = await osascript.execAsync(
      'tell app "System Events" to count processes whose name is "Simulator"'
    );

    if (result.trim() === '0') {
      return false;
    }
  } catch (error: any) {
    if (error.message.includes('Application isn’t running')) {
      return false;
    }
    throw error;
  }

  return true;
}

export async function ensureSimulatorAppOpenedAsync(simulatorUuid: string): Promise<void> {
  if (await isSimulatorAppRunningAsync()) {
    return;
  }

  await openSimulatorAppAsync(simulatorUuid);
  await waitForSimulatorAppToStartAsync(60 * 1000, 1000);
}

export async function installAppAsync(deviceId: string, filePath: string): Promise<void> {
  Log.newLine();
  Log.log('Installing your app on the simulator...');

  await simctlAsync(['install', deviceId, filePath]);

  Log.succeed('Successfully installed your app on the simulator!');
}

export async function getSimulatorAppIdAsync(): Promise<string | undefined> {
  try {
    return (await osascript.execAsync('id of app "Simulator"')).trim();
  } catch {
    return undefined;
  }
}
