import { asyncResult } from '@expo/results';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'timers/promises';

import { createMockLogger } from '../../__tests__/utils/logger';
import {
  AndroidDeviceSerialId,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../AndroidEmulatorUtils';
import { retryAsync } from '../retry';

// We need to use real fs for cloning devices to work.
jest.unmock('fs');
jest.unmock('node:fs');

async function setPerAvdSettingAsync({
  deviceName,
  key,
  value,
}: {
  deviceName: AndroidVirtualDeviceName;
  key: string;
  value: string;
}): Promise<void> {
  const avdConfPath = path.join(
    process.env.HOME as string,
    '.android',
    'avd',
    `${deviceName}.avd`,
    'AVD.conf'
  );

  let content = '';
  try {
    content = await fs.promises.readFile(avdConfPath, 'utf8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!content.includes('[perAvd]')) {
    content = `${content.trimEnd()}\n[perAvd]\n`;
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRegex = new RegExp(`^${escapedKey}=.*$`, 'm');
  if (keyRegex.test(content)) {
    content = content.replace(keyRegex, `${key}=${value}`);
  } else {
    content = `${content.trimEnd()}\n${key}=${value}\n`;
  }

  await fs.promises.writeFile(avdConfPath, content);
}

describe('AndroidEmulatorUtils', () => {
  beforeEach(async () => {
    const devices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env: process.env });
    for (const { serialId } of devices) {
      try {
        await AndroidEmulatorUtils.deleteAsync({
          serialId,
          env: process.env,
        });
      } catch (error) {
        console.error('Failed to delete emulator', error);
      }
    }
  });

  afterAll(async () => {
    const devices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env: process.env });
    for (const { serialId } of devices) {
      try {
        await AndroidEmulatorUtils.deleteAsync({
          serialId,
          env: process.env,
        });
      } catch (error) {
        console.error('Failed to delete emulator', error);
      }
    }
  });

  describe('getAvailableDevicesAsync', () => {
    it('should return available devices', async () => {
      const devices = await AndroidEmulatorUtils.getAvailableDevicesAsync({ env: process.env });
      expect(devices).toContain('Nexus 6');
    });
  });

  describe('getAttachedDevicesAsync', () => {
    it('should return no attached devices if no devices are attached', async () => {
      const devices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env: process.env });
      expect(devices).toEqual([]);
    });

    it('should return connected devices if devices are connected', async () => {
      const deviceName = 'android-emulator-connected-utils-test' as AndroidVirtualDeviceName;
      let serialId: AndroidDeviceSerialId | null = null;

      await AndroidEmulatorUtils.createAsync({
        deviceName,
        systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
        deviceIdentifier: null,
        env: process.env,
        logger: createMockLogger({ logToConsole: true }),
      });
      ({ serialId } = await AndroidEmulatorUtils.startAsync({
        deviceName,
        env: { ...process.env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
      }));
      await AndroidEmulatorUtils.waitForReadyAsync({
        serialId,
        env: process.env,
      });

      const devices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env: process.env });
      expect(devices.map(device => device.serialId)).toContain(serialId);
    }, 30_000);
  });

  it('should work end-to-end', async () => {
    const deviceName = 'android-emulator-end-to-end-test' as AndroidVirtualDeviceName;
    await AndroidEmulatorUtils.createAsync({
      deviceName,
      systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
      deviceIdentifier: null,
      env: process.env,
      logger: createMockLogger({ logToConsole: true }),
    });
    const { serialId, emulatorPromise } = await AndroidEmulatorUtils.startAsync({
      deviceName,
      env: { ...process.env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
    });
    await AndroidEmulatorUtils.waitForReadyAsync({
      serialId,
      env: process.env,
    });

    const { stdout } = await spawn('adb', ['-s', serialId, 'shell', 'ls'], {
      env: process.env,
    });
    expect(stdout).toContain('data');

    await AndroidEmulatorUtils.stopAsync({
      serialId,
      env: process.env,
    });
    await asyncResult(emulatorPromise);

    const cloneDeviceName = (deviceName + '-clone') as AndroidVirtualDeviceName;
    await AndroidEmulatorUtils.cloneAsync({
      sourceDeviceName: deviceName,
      destinationDeviceName: cloneDeviceName,
      env: process.env,
      logger: createMockLogger({ logToConsole: true }),
    });

    const { serialId: serialIdClone, emulatorPromise: emulatorPromiseClone } =
      await AndroidEmulatorUtils.startAsync({
        deviceName: cloneDeviceName,
        env: { ...process.env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
      });
    await AndroidEmulatorUtils.waitForReadyAsync({
      serialId: serialIdClone,
      env: process.env,
    });

    const { stdout: stdoutClone } = await spawn('adb', ['-s', serialIdClone, 'shell', 'ls'], {
      env: process.env,
    });
    expect(stdoutClone).toContain('data');

    await AndroidEmulatorUtils.deleteAsync({
      deviceName,
      env: process.env,
    });
    await asyncResult(emulatorPromiseClone);
  }, 60_000);

  it('should delete a running emulator by device name', async () => {
    const deviceName = 'android-emulator-delete-by-name-test' as AndroidVirtualDeviceName;
    const avdPath = `${process.env.HOME}/.android/avd/${deviceName}.avd`;

    await AndroidEmulatorUtils.createAsync({
      deviceName,
      systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
      deviceIdentifier: null,
      env: process.env,
      logger: createMockLogger({ logToConsole: true }),
    });

    const { serialId, emulatorPromise } = await AndroidEmulatorUtils.startAsync({
      deviceName,
      env: { ...process.env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
    });
    await AndroidEmulatorUtils.waitForReadyAsync({
      serialId,
      env: process.env,
    });

    await AndroidEmulatorUtils.deleteAsync({
      deviceName,
      env: process.env,
    });
    await asyncResult(emulatorPromise);

    const devices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env: process.env });
    expect(devices.map(device => device.serialId)).not.toContain(serialId);

    await expect(fs.promises.access(avdPath)).rejects.toThrow();
  }, 60_000);

  it('should retry when first startup has data disabled in AVD.conf', async () => {
    const deviceName = 'android-emulator-network-retry-test' as AndroidVirtualDeviceName;
    let attemptCounter = 0;
    let sawNetworkNotReadyError = false;

    await retryAsync(
      async attemptCount => {
        attemptCounter += 1;
        const shouldDisableData = attemptCount === 0;
        const envForAttempt: NodeJS.ProcessEnv = {
          ...process.env,
          ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1',
        };

        let serialId: AndroidDeviceSerialId | null = null;
        let emulatorPromise: Promise<unknown> | null = null;

        try {
          await AndroidEmulatorUtils.createAsync({
            deviceName,
            systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
            deviceIdentifier: null,
            env: envForAttempt,
            logger: createMockLogger({ logToConsole: true }),
          });

          if (shouldDisableData) {
            // See Pixel_5.avd/AVD.conf on local hosts; this setting can reproduce no-network startup.
            await setPerAvdSettingAsync({
              deviceName,
              key: 'cell\\data_status',
              value: '4',
            });
          }

          const startResult = await AndroidEmulatorUtils.startAsync({
            deviceName,
            env: envForAttempt,
          });
          serialId = startResult.serialId;
          emulatorPromise = asyncResult(startResult.emulatorPromise);

          await AndroidEmulatorUtils.waitForReadyAsync({
            serialId,
            env: envForAttempt,
            timeoutMs: shouldDisableData ? 30_000 : 120_000,
            logger: createMockLogger({ logToConsole: true }),
          });

          await AndroidEmulatorUtils.deleteAsync({
            serialId,
            deviceName,
            env: process.env,
          });
          await emulatorPromise;
        } catch (err: any) {
          if (err?.message?.includes('network is not ready')) {
            sawNetworkNotReadyError = true;
          }
          try {
            if (serialId) {
              await AndroidEmulatorUtils.deleteAsync({
                serialId,
                deviceName,
                env: process.env,
              });
            } else {
              await AndroidEmulatorUtils.deleteAsync({
                deviceName,
                env: process.env,
              });
            }
          } catch (cleanupError) {
            console.warn('Cleanup failed during retry test', cleanupError);
          }
          if (emulatorPromise) {
            await emulatorPromise;
          }
          throw err;
        }
      },
      {
        logger: createMockLogger({ logToConsole: true }),
        retryOptions: {
          retries: 1,
          retryIntervalMs: 1_000,
        },
      }
    );

    expect(attemptCounter).toBe(2);
    expect(sawNetworkNotReadyError).toBe(true);
  }, 180_000);

  it('should work with screen recording', async () => {
    const deviceName = 'android-emulator-screen-recording-test' as AndroidVirtualDeviceName;
    await AndroidEmulatorUtils.createAsync({
      deviceName,
      systemImagePackage: AndroidEmulatorUtils.defaultSystemImagePackage,
      deviceIdentifier: null,
      env: process.env,
      logger: createMockLogger({ logToConsole: true }),
    });

    const { serialId, emulatorPromise } = await AndroidEmulatorUtils.startAsync({
      deviceName,
      env: { ...process.env, ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL: '1' },
    });

    await AndroidEmulatorUtils.waitForReadyAsync({
      serialId,
      env: process.env,
    });

    const { recordingSpawn } = await AndroidEmulatorUtils.startScreenRecordingAsync({
      serialId,
      env: process.env,
    });

    await setTimeout(5_000);

    const { outputPath } = await AndroidEmulatorUtils.stopScreenRecordingAsync({
      serialId,
      recordingSpawn,
      env: process.env,
    });

    const { size } = await fs.promises.stat(outputPath);
    expect(size).toBeGreaterThan(1024);

    const { stdout } = await spawn('file', ['-I', '-b', outputPath], {
      env: process.env,
    });
    expect(stdout).toContain('video/mp4');

    await AndroidEmulatorUtils.deleteAsync({
      serialId,
      env: process.env,
    });
    await asyncResult(emulatorPromise);
  }, 60_000);
});
