import spawnAsync, { SpawnOptions, SpawnResult } from '@expo/spawn-async';
import chalk from 'chalk';

import Log from '../../log';
import { sleepAsync } from '../../utils/promise';

export async function xcrunAsync(args: string[], options?: SpawnOptions): Promise<SpawnResult> {
  try {
    return await spawnAsync('xcrun', args, options);
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

export async function isXcrunInstalledAsync(): Promise<boolean> {
  try {
    await spawnAsync('xcrun', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function installXcrunAsync(): Promise<void> {
  await spawnAsync('xcode-select', ['--install']);

  await waitForXcrunInstallToFinishAsync(60 * 1000, 1000);
}

async function waitForXcrunInstallToFinishAsync(
  maxWaitTimeMs: number,
  intervalMs: number
): Promise<void> {
  Log.newLine();
  Log.log('Waiting for Xcode Command Line Tools install to finish...');

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitTimeMs) {
    if (await isXcrunInstalledAsync()) {
      return;
    }
    await sleepAsync(Math.min(intervalMs, Math.max(maxWaitTimeMs - (Date.now() - startTime), 0)));
  }
  throw new Error('Timed out waiting for Xcode Command Line Tools install to finish');
}
