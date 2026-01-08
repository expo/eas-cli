import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import { setTimeout } from 'node:timers/promises';
import path from 'node:path';

import { bunyan } from '@expo/logger';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import FastGlob from 'fast-glob';
import { z } from 'zod';

import { retryAsync } from './retry';

/** Android Virtual Device is the device we run. */
export type AndroidVirtualDeviceName = string & z.BRAND<'AndroidVirtualDeviceName'>;
/** Android device is configuration for the AVD -- screen size, etc. */
export type AndroidDeviceName = string & z.BRAND<'AndroidDeviceName'>;
export type AndroidDeviceSerialId = string & z.BRAND<'AndroidDeviceSerialId'>;

export namespace AndroidEmulatorUtils {
  export const defaultSystemImagePackage = `system-images;android-30;default;${
    process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
  }`;

  export async function getAvailableDevicesAsync({
    env,
  }: {
    env: NodeJS.ProcessEnv;
  }): Promise<AndroidDeviceName[]> {
    const result = await spawn('avdmanager', ['list', 'device', '--compact', '--null'], { env });
    return result.stdout.split('\0').filter((line) => line !== '') as AndroidDeviceName[];
  }

  export async function getAttachedDevicesAsync({
    env,
  }: {
    env: NodeJS.ProcessEnv;
  }): Promise<{ serialId: AndroidDeviceSerialId; state: 'offline' | 'device' }[]> {
    const result = await spawn('adb', ['devices', '-l'], {
      env,
    });
    return result.stdout
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((line) => line.startsWith('emulator'))
      .map((line) => {
        const [serialId, state] = line.split(/\s+/) as [
          AndroidDeviceSerialId,
          'offline' | 'device',
        ];
        return {
          serialId,
          state,
        };
      });
  }

  export async function getSerialIdAsync({
    deviceName,
    env,
  }: {
    deviceName: AndroidVirtualDeviceName;
    env: NodeJS.ProcessEnv;
  }): Promise<AndroidDeviceSerialId | null> {
    const adbDevices = await spawn('adb', ['devices'], { env });
    for (const adbDeviceLine of adbDevices.stdout.split('\n')) {
      if (!adbDeviceLine.startsWith('emulator')) {
        continue;
      }

      const matches = adbDeviceLine.match(/^(\S+)/);
      if (!matches) {
        continue;
      }

      const [, serialId] = matches;
      // Previously we were using `qemu.uuid` to identify the emulator,
      // but this does not work for newer emulators, because there is
      // a limit on properties and custom properties get ignored.
      // See https://stackoverflow.com/questions/2214377/how-to-get-serial-number-or-id-of-android-emulator-after-it-runs#comment98259121_42038655
      const adbEmuAvdName = await spawn('adb', ['-s', serialId, 'emu', 'avd', 'name'], {
        env,
      });
      if (adbEmuAvdName.stdout.replace(/\r\n/g, '\n').split('\n')[0] === deviceName) {
        return serialId as AndroidDeviceSerialId;
      }
    }

    return null;
  }

  export async function createAsync({
    deviceName,
    systemImagePackage,
    deviceIdentifier,
    env,
    logger,
  }: {
    deviceName: AndroidVirtualDeviceName;
    systemImagePackage: string;
    deviceIdentifier: AndroidDeviceName | null;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
  }): Promise<void> {
    const avdManager = spawn(
      'avdmanager',
      [
        'create',
        'avd',
        '--name',
        deviceName,
        '--package',
        systemImagePackage,
        '--force',
        ...(deviceIdentifier ? ['--device', deviceIdentifier] : []),
      ],
      {
        env,
        stdio: 'pipe',
      }
    );
    // `avdmanager create` always asks about creating a custom hardware profile.
    // > Do you wish to create a custom hardware profile? [no]
    // We answer "no".
    avdManager.child.stdin?.write('no');
    avdManager.child.stdin?.end();
    await avdManager;

    // Add extra config to the device's ini file.
    const configIniFile = `${env.HOME}/.android/avd/${deviceName}.avd/config.ini`;
    try {
      let configIniFileContent = await fs.promises.readFile(configIniFile, 'utf-8');

      logger.info('Setting hw.ramSize to 2048.');
      configIniFileContent = `${configIniFileContent}\nhw.ramSize=2048\n`;

      const shouldResizeScreen =
        env.ANDROID_EMULATOR_ADJUST_SCREEN === 'true' || env.ANDROID_EMULATOR_ADJUST_SCREEN === '1';
      if (shouldResizeScreen) {
        const currentDensityString = configIniFileContent.match(/hw.lcd.density=(\d+)/)?.[1];
        const currentDensity = currentDensityString
          ? parseInt(currentDensityString, 10)
          : undefined;
        const currentHeightString = configIniFileContent.match(/hw.lcd.height=(\d+)/)?.[1];
        const currentHeight = currentHeightString ? parseInt(currentHeightString, 10) : undefined;
        const currentWidthString = configIniFileContent.match(/hw.lcd.width=(\d+)/)?.[1];
        const currentWidth = currentWidthString ? parseInt(currentWidthString, 10) : undefined;

        if (currentDensity && currentDensity > 220) {
          logger.info(
            `Current density is ${currentDensity}, which we believe may impact performance.`
          );
          if (currentHeight && currentWidth) {
            const newDensity = 220;
            logger.info(`Setting hw.lcd.density to ${newDensity}.`);
            configIniFileContent = `${configIniFileContent}\nhw.lcd.density=${newDensity}\n`;

            const newHeight = Math.round((currentHeight * newDensity) / currentDensity);
            const newWidth = Math.round((currentWidth * newDensity) / currentDensity);
            logger.info(
              `Setting scaled screen resolution: hw.lcd.height to ${newHeight} and hw.lcd.width to ${newWidth}.`
            );
            configIniFileContent = `${configIniFileContent}\nhw.lcd.height=${newHeight}\nhw.lcd.width=${newWidth}\n`;
          } else {
            logger.info(
              'Could not find current screen resolution, setting to 1170x540 and 220 ppi.'
            );
            configIniFileContent = `${configIniFileContent}\nhw.lcd.height=${1170}\nhw.lcd.width=${540}\nhw.lcd.density=220\n`;
          }
        }
      }

      const shouldAdjustHeapSize =
        env.ANDROID_EMULATOR_ADJUST_HEAP_SIZE !== 'false' &&
        env.ANDROID_EMULATOR_ADJUST_HEAP_SIZE !== '0';
      if (shouldAdjustHeapSize) {
        const heapSizeString = configIniFileContent.match(/vm.heapSize=(\d\w+)/)?.[1];
        if (!heapSizeString) {
          logger.info('Setting vm.heapSize to 768 MB.');
          configIniFileContent = `${configIniFileContent}\nvm.heapSize=768\n`;
        } else if (heapSizeString) {
          const heapSize = parseInt(heapSizeString, 10);
          const lowerCaseHeapSizeString = heapSizeString.toLocaleLowerCase();
          if (lowerCaseHeapSizeString.includes('g')) {
            logger.info('vm.heapSize is in GB, skipping adjustment.');
          } else if (heapSize < 768) {
            logger.info('Bumping vm.heapSize to 768 MB.');
            configIniFileContent = `${configIniFileContent}\nvm.heapSize=768\n`;
          }
        }
      }

      if (env.ANDROID_EMULATOR_EXTRA_CONFIG) {
        logger.info(
          `Adding extra config from $ANDROID_EMULATOR_EXTRA_CONFIG:\n${env.ANDROID_EMULATOR_EXTRA_CONFIG}`
        );
        configIniFileContent = `${configIniFileContent}\n${env.ANDROID_EMULATOR_EXTRA_CONFIG}\n`;
      }

      await fs.promises.writeFile(configIniFile, configIniFileContent);
    } catch (err) {
      logger.warn({ err }, `Failed to add extra config to ${configIniFile}.`);
    }
  }

  export async function cloneAsync({
    sourceDeviceName,
    destinationDeviceName,
    env,
    logger,
  }: {
    sourceDeviceName: AndroidVirtualDeviceName;
    destinationDeviceName: AndroidVirtualDeviceName;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
  }): Promise<void> {
    const cloneIniFile = `${env.HOME}/.android/avd/${destinationDeviceName}.ini`;

    try {
      // Clean destination device files
      await fs.promises.rm(`${env.HOME}/.android/avd/${destinationDeviceName}.avd`, {
        recursive: true,
        force: true,
      });
      await fs.promises.rm(cloneIniFile, { force: true });
    } catch (err) {
      logger.warn({ err }, `Failed to remove destination device files ${destinationDeviceName}.`);
    }

    try {
      // Remove lockfiles from source device
      const sourceLockfiles = await FastGlob('./**/*.lock', {
        cwd: `${env.HOME}/.android/avd/${sourceDeviceName}.avd`,
        absolute: true,
      });
      await Promise.all(
        sourceLockfiles.map((lockfile) => fs.promises.rm(lockfile, { force: true }))
      );
    } catch (err) {
      logger.warn({ err }, `Failed to remove lockfiles from source device ${sourceDeviceName}.`);
    }

    // Copy source to destination
    await fs.promises.cp(
      `${env.HOME}/.android/avd/${sourceDeviceName}.avd`,
      `${env.HOME}/.android/avd/${destinationDeviceName}.avd`,
      { recursive: true, verbatimSymlinks: true, force: true }
    );

    await fs.promises.cp(`${env.HOME}/.android/avd/${sourceDeviceName}.ini`, cloneIniFile, {
      verbatimSymlinks: true,
      force: true,
    });

    // Remove lockfiles from destination device
    try {
      const lockfiles = await FastGlob('./**/*.lock', {
        cwd: `${env.HOME}/.android/avd/${destinationDeviceName}.avd`,
        absolute: true,
      });
      await Promise.all(lockfiles.map((lockfile) => fs.promises.rm(lockfile, { force: true })));
    } catch (err) {
      logger.warn(
        { err },
        `Failed to remove lockfiles from destination device ${destinationDeviceName}.`
      );
    }

    const filesToReplaceDeviceNameIn = // TODO: Test whether we need to use `spawnAsync` here.
      (
        await spawn('grep', [
          '--binary-files=without-match',
          '--recursive',
          '--files-with-matches',
          `${sourceDeviceName}`,
          `${env.HOME}/.android/avd/${destinationDeviceName}.avd`,
        ])
      ).stdout
        .split('\n')
        .filter((file) => file !== '');

    for (const file of [...filesToReplaceDeviceNameIn, cloneIniFile]) {
      try {
        const txtFile = await fs.promises.readFile(file, 'utf-8');
        const replaceRegex = new RegExp(`${sourceDeviceName}`, 'g');
        const updatedTxtFile = txtFile.replace(replaceRegex, destinationDeviceName);
        await fs.promises.writeFile(file, updatedTxtFile);
      } catch (err) {
        logger.warn({ err }, `Failed to replace device name in ${file}.`);
      }
    }
  }

  export async function startAsync({
    deviceName,
    env,
  }: {
    deviceName: AndroidVirtualDeviceName;
    env: NodeJS.ProcessEnv;
  }): Promise<{ emulatorPromise: SpawnPromise<SpawnResult>; serialId: AndroidDeviceSerialId }> {
    const emulatorPromise = spawn(
      `${process.env.ANDROID_HOME}/emulator/emulator`,
      [
        '-no-window',
        '-no-boot-anim',
        '-writable-system',
        '-noaudio',
        '-no-snapshot-save',
        '-avd',
        deviceName,
        '-accel',
        'on',
        ...(typeof env.ANDROID_EMULATOR_EXTRA_ARGS === 'string'
          ? env.ANDROID_EMULATOR_EXTRA_ARGS.split(' ')
          : []),
      ],
      {
        detached: true,
        stdio: 'inherit',
        env: {
          ...env,
          // We don't need to wait for emulator to exit gracefully.
          ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1',
        },
      }
    );
    // If emulator fails to start, throw its error.
    if (!emulatorPromise.child.pid) {
      await emulatorPromise;
    }
    emulatorPromise.child.unref();

    const serialId = await retryAsync(
      async () => {
        const serialId = await getSerialIdAsync({ deviceName, env });
        assert(
          serialId,
          `Failed to configure emulator (${serialId}): emulator with required ID not found.`
        );
        return serialId;
      },
      {
        retryOptions: {
          retries: 3 * 60,
          retryIntervalMs: 1_000,
        },
      }
    );

    // We don't want to await the SpawnPromise here.
    // eslint-disable-next-line @typescript-eslint/return-await
    return { emulatorPromise, serialId };
  }

  export async function waitForReadyAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<void> {
    await retryAsync(
      async () => {
        const { stdout } = await spawn(
          'adb',
          ['-s', serialId, 'shell', 'getprop', 'sys.boot_completed'],
          { env }
        );

        if (!stdout.startsWith('1')) {
          throw new Error(`Emulator (${serialId}) boot has not completed.`);
        }
      },
      {
        // Retry every second for 3 minutes.
        retryOptions: {
          retries: 3 * 60,
          retryIntervalMs: 1_000,
        },
      }
    );
  }

  export async function collectLogsAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<{ outputPath: string }> {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'android-emulator-logs-'));
    const outputPath = path.join(outputDir, `${serialId}.log`);

    // Pipe adb logcat output directly to the file to avoid loading it all into memory
    await new Promise<void>((resolve, reject) => {
      const { child } = spawn('adb', ['-s', serialId, 'logcat', '-d'], {
        env,
        stdio: ['ignore', 'pipe', 'inherit'],
      });

      if (!child.stdout) {
        reject(new Error('"adb logcat" did not start correctly.'));
        return;
      }

      const writeStream = fs.createWriteStream(outputPath);
      child.stdout.pipe(writeStream);
      child.stdout.on('error', reject);

      child.on('error', reject);
      writeStream.on('error', reject);

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`"adb logcat" exited with code ${code}`));
        }
      });
    });

    return { outputPath };
  }

  export async function deleteAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<void> {
    const adbEmuAvdName = await spawn('adb', ['-s', serialId, 'emu', 'avd', 'name'], {
      env,
    });
    const deviceName = adbEmuAvdName.stdout.replace(/\r\n/g, '\n').split('\n')[0];

    await spawn('adb', ['-s', serialId, 'emu', 'kill'], { env });

    await retryAsync(
      async () => {
        const devices = await getAttachedDevicesAsync({ env });
        if (devices.some((device) => device.serialId === serialId)) {
          throw new Error(`Emulator (${serialId}) is still attached.`);
        }
      },
      {
        retryOptions: {
          retries: 3 * 60,
          retryIntervalMs: 1_000,
        },
      }
    );

    await spawn('avdmanager', ['delete', 'avd', '-n', deviceName], { env });
  }

  export async function startScreenRecordingAsync({
    serialId,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    env: NodeJS.ProcessEnv;
  }): Promise<{
    recordingSpawn: SpawnPromise<SpawnResult>;
  }> {
    let isReady = false;

    // Ensure /sdcard/ is ready to write to. (If the emulator was just booted, it might not be ready yet.)
    for (let i = 0; i < 30; i++) {
      try {
        await spawn('adb', ['-s', serialId, 'shell', 'touch', '/sdcard/.expo-recording-ready'], {
          env,
        });
        isReady = true;
        break;
      } catch {
        await setTimeout(1000);
      }
    }

    if (!isReady) {
      throw new Error(`Emulator (${serialId}) filesystem was not ready in time.`);
    }

    const screenrecordArgs = [
      '-s',
      serialId,
      'shell',
      'screenrecord',
      '--verbose',
      '/sdcard/expo-recording.mp4',
    ];

    const screenrecordHelp = await spawn(
      'adb',
      ['-s', serialId, 'shell', 'screenrecord', '--help'],
      {
        env,
      }
    );

    if (screenrecordHelp.stdout.includes('remove the time limit')) {
      screenrecordArgs.push('--time-limit', '0');
    }

    const recordingSpawn = spawn('adb', screenrecordArgs, {
      env,
      stdio: 'pipe',
    });
    recordingSpawn.child.unref();

    // We are returning the SpawnPromise here, so we don't await it.
    // eslint-disable-next-line @typescript-eslint/return-await
    return {
      recordingSpawn,
    };
  }

  export async function stopScreenRecordingAsync({
    serialId,
    recordingSpawn,
    env,
  }: {
    serialId: AndroidDeviceSerialId;
    recordingSpawn: SpawnPromise<SpawnResult>;
    env: NodeJS.ProcessEnv;
  }): Promise<{ outputPath: string }> {
    recordingSpawn.child.kill(1);

    try {
      await recordingSpawn;
    } catch {
      // do nothing
    }

    let isRecordingBusy = true;
    for (let i = 0; i < 30; i++) {
      const lsof = await spawn(
        'adb',
        ['-s', serialId, 'shell', 'lsof -t /sdcard/expo-recording.mp4'],
        { env }
      );
      if (lsof.stdout.trim() === '') {
        isRecordingBusy = false;
        break;
      }
      await setTimeout(1000);
    }

    if (isRecordingBusy) {
      throw new Error(`Recording file is busy.`);
    }

    const outputDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'android-screen-recording-')
    );
    const outputPath = path.join(outputDir, `${serialId}.mp4`);

    await spawn('adb', ['-s', serialId, 'pull', '/sdcard/expo-recording.mp4', outputPath], { env });

    return { outputPath };
  }
}
