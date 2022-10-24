import spawnAsync from '@expo/spawn-async';
import path from 'path';

import * as simulator from './simulator';
import { validateSystemRequirementsAsync } from './systemRequirements';

export async function runAppOnIosSimulatorAsync(appPath: string): Promise<void> {
  await validateSystemRequirementsAsync();

  const selectedSimulator = await simulator.selectSimulatorAsync();
  await simulator.ensureSimulatorBootedAsync(selectedSimulator);

  await simulator.ensureSimulatorAppOpenedAsync(selectedSimulator.udid);

  const bundleIdentifier = await getAppBundleIdentifierAsync(appPath);
  await simulator.installAppAsync(selectedSimulator.udid, appPath);

  await simulator.launchAppAsync(selectedSimulator.udid, bundleIdentifier);
}

async function getAppBundleIdentifierAsync(appPath: string): Promise<string> {
  const { stdout, stderr } = await spawnAsync('xcrun', [
    'plutil',
    '-extract',
    'CFBundleIdentifier',
    'raw',
    path.join(appPath, 'Info.plist'),
  ]);

  if (!stdout) {
    throw new Error(
      `Could not read app bundle identifier from ${path.join(appPath, 'Info.plist')}: ${stderr}`
    );
  }

  return stdout.trim();
}
