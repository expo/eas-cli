import fs from 'node:fs';
import { setTimeout } from 'timers/promises';

import spawn from '@expo/turtle-spawn';
import { asyncResult } from '@expo/results';

import {
  AndroidDeviceSerialId,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../AndroidEmulatorUtils';
import { createMockLogger } from '../../__tests__/utils/logger';

// We need to use real fs for cloning devices to work.
jest.unmock('fs');
jest.unmock('node:fs');

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
      expect(devices.map((device) => device.serialId)).toContain(serialId);
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

    await spawn('adb', ['-s', serialId, 'emu', 'kill'], { env: process.env });
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
      serialId,
      env: process.env,
    });
    await asyncResult(emulatorPromiseClone);
  }, 60_000);

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
