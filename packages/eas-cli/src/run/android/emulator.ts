import spawnAsync, { SpawnResult } from '@expo/spawn-async';
import assert from 'assert';
import chalk from 'chalk';
import os from 'os';
import path from 'path';

import {
  AndroidEmulator,
  adbAsync,
  getFirstRunningEmulatorAsync,
  isEmulatorBootedAsync,
  waitForEmulatorToBeBootedAsync,
} from './adb';
import { getAndroidSdkRootAsync } from './sdk';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { truthy } from '../../utils/expodash/filter';

export const EMULATOR_MAX_WAIT_TIMEOUT_MS = 60 * 1000 * 3;

export async function getEmulatorExecutableAsync(): Promise<string> {
  const sdkRoot = await getAndroidSdkRootAsync();
  if (sdkRoot) {
    return path.join(sdkRoot, 'emulator', 'emulator');
  }

  return 'emulator';
}

async function emulatorAsync(...options: string[]): Promise<SpawnResult> {
  const emulatorExecutable = await getEmulatorExecutableAsync();
  try {
    return await spawnAsync(emulatorExecutable, options);
  } catch (error: any) {
    if (error.stderr) {
      Log.error(error.stderr);
    }
    throw error;
  }
}

async function getAvaliableAndroidEmulatorsAsync(): Promise<AndroidEmulator[]> {
  try {
    const { stdout } = await emulatorAsync('-list-avds');

    return stdout
      .split(os.EOL)
      .filter(truthy)
      .map(name => ({
        name,
      }));
  } catch {
    return [];
  }
}

/** Start an Android device and wait until it is booted. */
async function bootEmulatorAsync(
  emulator: AndroidEmulator,
  {
    timeout = EMULATOR_MAX_WAIT_TIMEOUT_MS,
    interval = 1000,
  }: {
    /** Time in milliseconds to wait before asserting a timeout error. */
    timeout?: number;
    interval?: number;
  } = {}
): Promise<AndroidEmulator> {
  Log.newLine();
  Log.log(`Opening emulator ${chalk.bold(emulator.name)}`);

  const emulatorExecutable = await getEmulatorExecutableAsync();

  // Start a process to open an emulator
  const emulatorProcess = spawnAsync(emulatorExecutable, [`@${emulator.name}`], {
    stdio: 'ignore',
    detached: true,
  });

  // we don't want to wait for the emulator process to exit before we can finish `eas build:run` command
  // https://github.com/expo/eas-cli/pull/1485#discussion_r1007935871
  emulatorProcess.child.unref();

  return await waitForEmulatorToBeBootedAsync(timeout, interval);
}

export async function selectEmulatorAsync(): Promise<AndroidEmulator> {
  const runningEmulator = await getFirstRunningEmulatorAsync();

  if (runningEmulator) {
    Log.newLine();
    Log.log(`Using open emulator: ${chalk.bold(runningEmulator.name)}`);

    return runningEmulator;
  }

  const emulators = await getAvaliableAndroidEmulatorsAsync();

  Log.newLine();
  const { selectedEmulator } = await promptAsync({
    type: 'select',
    message: `Select an emulator to run your app on`,
    name: 'selectedEmulator',
    choices: emulators.map(emulator => ({
      title: emulator.name,
      value: emulator,
    })),
  });

  return selectedEmulator;
}

export async function ensureEmulatorBootedAsync(
  emulator: AndroidEmulator
): Promise<AndroidEmulator> {
  if (!emulator.pid || !(await isEmulatorBootedAsync(emulator.pid))) {
    return await bootEmulatorAsync(emulator);
  }

  return emulator;
}

export async function installAppAsync(
  emulator: AndroidEmulator,
  apkFilePath: string
): Promise<void> {
  Log.newLine();
  Log.log('Installing your app...');

  assert(emulator.pid);
  await adbAsync('-s', emulator.pid, 'install', '-r', '-d', apkFilePath);

  Log.succeed('Successfully installed your app!');
}

export async function startAppAsync(
  emulator: AndroidEmulator,
  packageName: string,
  activityName: string
): Promise<void> {
  Log.newLine();
  Log.log('Starting your app...');

  assert(emulator.pid);
  await adbAsync(
    '-s',
    emulator.pid,
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.MAIN',
    '-f',
    '0x20000000', // FLAG_ACTIVITY_SINGLE_TOP -- If set, the activity will not be launched if it is already running at the top of the history stack.
    '-n',
    `${packageName}/${activityName}`
  );

  Log.succeed('Successfully started your app!');
}
