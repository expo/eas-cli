import * as osascript from '@expo/osascript';
import spawnAsync, { SpawnOptions, SpawnResult } from '@expo/spawn-async';
import chalk from 'chalk';
import path from 'path';

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

export async function runAppOnIosSimulatorAsync(appPath: string): Promise<void> {
  assertPlatform();

  const selectedSimulator = await getBestIosSimulatorAsync();
  await ensureSimulatorBootedAsync(selectedSimulator);

  await ensureSimulatorAppOpenedAsync(selectedSimulator.udid);

  const bundleIdentifier = await getAppBundleIdentifierAsync(appPath);
  await installAppOnIosAsync(selectedSimulator.udid, appPath);

  await launchAppOnIosSimulatorAsync(selectedSimulator.udid, bundleIdentifier);
}

async function installAppOnIosAsync(deviceId: string, filePath: string): Promise<void> {
  Log.newLine();
  Log.log('Installing your app on the simulator...');

  await simctlAsync(['install', deviceId, filePath]);

  Log.succeed('Successfully installed your app on the simulator!');
}

async function simctlAsync(
  args: (string | undefined)[],
  options?: SpawnOptions
): Promise<SpawnResult> {
  return xcrunAsync(['simctl', ...args], options);
}

async function xcrunAsync(
  args: (string | undefined)[],
  options?: SpawnOptions
): Promise<SpawnResult> {
  try {
    return await spawnAsync('xcrun', args.filter(Boolean) as string[], options);
  } catch (e) {
    throwXcrunError(e);
  }
}

function throwXcrunError(e: any): never {
  if (isLicenseOutOfDate(e.stdout) || isLicenseOutOfDate(e.stderr)) {
    throw new Error('Xcode license is not accepted. Please run `sudo xcodebuild -license`.');
  } else if (e.stderr?.includes('not a developer tool or in PATH')) {
    throw new Error(
      `You may need to run ${chalk.bold(
        'sudo xcode-select -s /Applications/Xcode.app'
      )} and try again.`
    );
  }

  if (Array.isArray(e.output)) {
    e.message += '\n' + e.output.join('\n').trim();
  } else if (e.stderr) {
    e.message += '\n' + e.stderr;
  }

  throw new Error(
    `Some other error occurred while running xcrun command.
${e.message}`
  );
}

function isLicenseOutOfDate(text: string): boolean {
  if (!text) {
    return false;
  }

  const lower = text.toLowerCase();
  return lower.includes('xcode') && lower.includes('license');
}

async function getBestIosSimulatorAsync(): Promise<IosSimulator> {
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
      title: `ios ${simulator.osVersion} ${simulator.name}`,
      value: simulator,
    })),
  });

  return selectedSimulator;
}

async function getFirstBootedIosSimulatorAsync(): Promise<IosSimulator | undefined> {
  const bootedSimulators = await getAvaliableIosSimulatorsListAsync('booted');

  if (bootedSimulators.length > 0) {
    return bootedSimulators[0];
  }
  return undefined;
}

async function getAvaliableIosSimulatorsListAsync(query?: string): Promise<IosSimulator[]> {
  const { stdout } = await simctlAsync(['list', 'devices', '--json', query]);
  const info = parseSimControlJsonResults(stdout);

  const iosSimulators = [];

  for (const runtime of Object.keys(info.devices)) {
    // Given a string like 'com.apple.CoreSimulator.SimRuntime.tvOS-13-4'
    const runtimeSuffix = runtime.split('com.apple.CoreSimulator.SimRuntime.').pop()!;
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

async function ensureSimulatorBootedAsync(simulator: IosSimulator): Promise<void> {
  if (simulator.state === 'Booted') {
    return;
  }

  await simctlAsync(['boot', simulator.udid]);
}

async function openSimulatorAppAsync(simulatorUdid: string): Promise<void> {
  const args = ['-a', 'Simulator'];
  if (simulatorUdid) {
    // This has no effect if the app is already running.
    args.push('--args', '-CurrentDeviceUDID', simulatorUdid);
  }
  await spawnAsync('open', args);
}

async function launchAppOnIosSimulatorAsync(
  simulatorUdid: string,
  bundleIdentifier: string
): Promise<void> {
  Log.newLine();
  Log.log('Launching your app...');

  await simctlAsync(['launch', simulatorUdid, bundleIdentifier]);

  Log.succeed('Successfully launched your app!');
}

async function getAppBundleIdentifierAsync(appPath: string): Promise<string> {
  const { stdout } = await spawnAsync('xcrun', [
    'plutil',
    '-extract',
    'CFBundleIdentifier',
    'raw',
    path.join(appPath, 'Info.plist'),
  ]);

  if (!stdout) {
    throw new Error(
      `Could not read app bundle identifier from ${path.join(appPath, 'Info.plist')}`
    );
  }

  return stdout.trim();
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
  throw new Error('Timed out waiting for simulator app to start.');
}

async function isSimulatorAppRunningAsync(): Promise<boolean> {
  try {
    const zeroMeansNo = (
      await osascript.execAsync(
        'tell app "System Events" to count processes whose name is "Simulator"'
      )
    ).trim();
    if (zeroMeansNo === '0') {
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

async function ensureSimulatorAppOpenedAsync(simulatorUuid: string): Promise<void> {
  if (await isSimulatorAppRunningAsync()) {
    return;
  }

  await openSimulatorAppAsync(simulatorUuid);
  await waitForSimulatorAppToStartAsync(60 * 1000, 1000);
}

function assertPlatform(): void {
  if (process.platform !== 'darwin') {
    Log.error(
      chalk`iOS apps can only be built on macOS devices. Use {cyan eas build -p ios} to build in the cloud.`
    );
    throw Error('iOS apps can only be built on macOS devices.');
  }
}
