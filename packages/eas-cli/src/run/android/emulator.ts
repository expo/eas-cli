import spawnAsync, { SpawnResult } from '@expo/spawn-async';
import chalk from 'chalk';
import assert from 'node:assert';
import os from 'os';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import {
  AndroidEmulator,
  adbAsync,
  getFirstRunningEmulatorAsync,
  isEmulatorBootedAsync,
  waitForEmulatorToBeBootedAsync,
} from './adb';
import { sdkRoot } from './sdk';

export const EMULATOR_MAX_WAIT_TIMEOUT = 60 * 1000 * 3;

export const emulatorExecutable = getEmulatorExecutable();

function getEmulatorExecutable(): string {
  if (sdkRoot) {
    return `${sdkRoot}/emulator/emulator`;
  }

  return 'emulator';
}

async function emulatorAsync(...options: string[]): Promise<SpawnResult> {
  return await spawnAsync(emulatorExecutable, options);
}

async function getAvaliableAndroidEmulatorsAsync(): Promise<AndroidEmulator[]> {
  try {
    const { stdout } = await emulatorAsync('-list-avds');

    return stdout
      .split(os.EOL)
      .filter(Boolean)
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
    timeout = EMULATOR_MAX_WAIT_TIMEOUT,
    interval = 1000,
  }: {
    /** Time in milliseconds to wait before asserting a timeout error. */
    timeout?: number;
    interval?: number;
  } = {}
): Promise<AndroidEmulator> {
  Log.newLine();
  Log.log(`Opening emulator ${chalk.bold(emulator.name)}`);

  // Start a process to open an emulator
  const emulatorProcess = spawnAsync(
    emulatorExecutable,
    [
      `@${emulator.name}`,
      // disable animation for faster boot -- this might make it harder to detect if it mounted properly tho
      //'-no-boot-anim'
    ],
    {
      stdio: 'ignore',
      detached: true,
    }
  );

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
    message: `Select a emulator to run your app on`,
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
  if (emulator.pid && (await isEmulatorBootedAsync(emulator.pid))) {
    return emulator;
  }

  return await bootEmulatorAsync(emulator);
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
    'android.intent.action.RUN',
    '-f',
    '0x20000000', // FLAG_ACTIVITY_SINGLE_TOP -- If set, the activity will not be launched if it is already running at the top of the history stack.
    '-n',
    `${packageName}/${activityName}`
  );

  Log.succeed('Successfully started your app!');
}
