import spawnAsync, { SpawnOptions, SpawnResult } from '@expo/spawn-async';
import chalk from 'chalk';

import Log from '../../log';

export async function runAppOnIosSimulatorAsync(filePath: string): Promise<void> {
  await installAppOnIosAsync('53F5D928-D122-4482-A030-852DBBDE144F', filePath);
}

export async function installAppOnIosAsync(
  deviceId: string,
  filePath: string
): Promise<SpawnResult> {
  return simctlAsync(['install', deviceId, filePath]);
}

export async function simctlAsync(
  args: (string | undefined)[],
  options?: SpawnOptions
): Promise<SpawnResult> {
  return xcrunAsync(['simctl', ...args], options);
}

export async function xcrunAsync(
  args: (string | undefined)[],
  options?: SpawnOptions
): Promise<SpawnResult> {
  Log.debug('Running: xcrun ' + args.join(' '));
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
