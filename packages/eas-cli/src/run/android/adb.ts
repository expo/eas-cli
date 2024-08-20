import spawnAsync, { SpawnResult } from '@expo/spawn-async';
import os from 'os';
import path from 'path';

import { getAndroidSdkRootAsync } from './sdk';
import Log from '../../log';
import { truthy } from '../../utils/expodash/filter';
import { sleepAsync } from '../../utils/promise';

export interface AndroidEmulator {
  pid?: string;
  name: string;
}

const BEGINNING_OF_ADB_ERROR_MESSAGE = 'error: ';

export async function adbAsync(...args: string[]): Promise<SpawnResult> {
  const adbExecutable = await getAdbExecutableAsync();
  try {
    return await spawnAsync(adbExecutable, args);
  } catch (error: any) {
    let errorMessage = (error.stderr || error.stdout || error.message).trim();
    if (errorMessage.startsWith(BEGINNING_OF_ADB_ERROR_MESSAGE)) {
      errorMessage = errorMessage.substring(BEGINNING_OF_ADB_ERROR_MESSAGE.length);
    }
    error.message = errorMessage;
    throw error;
  }
}

export async function getAdbExecutableAsync(): Promise<string> {
  const sdkRoot = await getAndroidSdkRootAsync();
  if (!sdkRoot) {
    Log.debug('Failed to resolve the Android SDK path, falling back to global adb executable');
    return 'adb';
  }

  return path.join(sdkRoot, 'platform-tools/adb');
}

export function sanitizeAdbDeviceName(deviceName: string): string | undefined {
  return deviceName.trim().split(/[\r\n]+/)[0];
}

/**
 * Return the Emulator name for an emulator ID, this can be used to determine if an emulator is booted.
 *
 * @param devicePid a value like `emulator-5554` from `abd devices`
 */
export async function getAdbNameForDeviceIdAsync(emulatorPid: string): Promise<string | null> {
  const { stdout } = await adbAsync('-s', emulatorPid, 'emu', 'avd', 'name');

  if (stdout.match(/could not connect to TCP port .*: Connection refused/)) {
    // Can also occur when the emulator does not exist.
    throw new Error(`Emulator not found: ${stdout}`);
  }

  return sanitizeAdbDeviceName(stdout) ?? null;
}

// TODO: This is very expensive for some operations.
export async function getRunningEmulatorsAsync(): Promise<AndroidEmulator[]> {
  const { stdout } = await adbAsync('devices', '-l');

  const splitItems = stdout.trim().split(os.EOL);

  const attachedDevices: {
    pid: string;
    type: string;
  }[] = splitItems
    // First line is `"List of devices attached"`, remove it
    .slice(1, splitItems.length)
    .map(line => {
      // unauthorized: ['FA8251A00719', 'unauthorized', 'usb:338690048X', 'transport_id:5']
      // authorized: ['FA8251A00719', 'device', 'usb:336592896X', 'product:walleye', 'model:Pixel_2', 'device:walleye', 'transport_id:4']
      // emulator: ['emulator-5554', 'offline', 'transport_id:1']
      const [pid] = line.split(' ').filter(truthy);
      const type = line.includes('emulator') ? 'emulator' : 'device';
      return { pid, type };
    })
    .filter(({ pid, type }) => !!pid && type === 'emulator');

  const devicePromises = attachedDevices.map<Promise<AndroidEmulator>>(async ({ pid }) => {
    const name = (await getAdbNameForDeviceIdAsync(pid)) ?? '';
    return {
      pid,
      name,
    };
  });

  return await Promise.all(devicePromises);
}

export async function getFirstRunningEmulatorAsync(): Promise<AndroidEmulator | null> {
  const emulators = await getRunningEmulatorsAsync();
  return emulators[0] ?? null;
}

/**
 * Returns true if emulator is booted
 *
 * @param emulatorPid
 */
export async function isEmulatorBootedAsync(emulatorPid: string): Promise<boolean> {
  try {
    const { stdout } = await adbAsync('-s', emulatorPid, 'shell', 'getprop', 'sys.boot_completed');
    if (stdout.trim() === '1') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function waitForEmulatorToBeBootedAsync(
  maxWaitTimeMs: number,
  intervalMs: number
): Promise<AndroidEmulator> {
  Log.newLine();
  Log.log('Waiting for the Android emulator to start...');

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitTimeMs) {
    const emulator = await getFirstRunningEmulatorAsync();
    if (emulator?.pid && (await isEmulatorBootedAsync(emulator.pid))) {
      return emulator;
    }
    await sleepAsync(intervalMs);
  }
  throw new Error('Timed out waiting for the Android emulator to start.');
}
