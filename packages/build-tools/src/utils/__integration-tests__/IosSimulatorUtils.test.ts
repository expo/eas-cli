import fs from 'node:fs';
import { setTimeout } from 'timers/promises';

import spawn from '@expo/turtle-spawn';

import { IosSimulatorName, IosSimulatorUtils } from '../IosSimulatorUtils';

// We need to use real fs for cloning devices to work.
jest.unmock('fs');
jest.unmock('node:fs');

describe('IosSimulatorUtils', () => {
  beforeEach(async () => {
    const devices = await IosSimulatorUtils.getAvailableDevicesAsync({
      env: process.env,
      filter: 'booted',
    });
    for (const { udid } of devices) {
      try {
        await IosSimulatorUtils.deleteAsync({
          deviceIdentifier: udid,
          env: process.env,
        });
      } catch (error) {
        console.error('Failed to delete emulator', error);
      }
    }
  });

  afterAll(async () => {
    const devices = await IosSimulatorUtils.getAvailableDevicesAsync({
      env: process.env,
      filter: 'booted',
    });
    for (const { udid } of devices) {
      try {
        await IosSimulatorUtils.deleteAsync({
          deviceIdentifier: udid,
          env: process.env,
        });
      } catch (error) {
        console.error('Failed to delete simulator', error);
      }
    }
  });

  describe('getAvailableDevicesAsync(filter: "available")', () => {
    it('should return available devices', async () => {
      const devices = await IosSimulatorUtils.getAvailableDevicesAsync({
        env: process.env,
        filter: 'available',
      });
      expect(devices).toContainEqual(
        expect.objectContaining({ name: expect.stringMatching(/iPhone \d+/) })
      );
    });
  });

  describe('getAttachedDevicesAsync(filter: "booted")', () => {
    it('should return no attached devices if no devices are attached', async () => {
      const devices = await IosSimulatorUtils.getAvailableDevicesAsync({
        env: process.env,
        filter: 'booted',
      });
      expect(devices).toEqual([]);
    });

    it('should return booted devices if devices are booted', async () => {
      const deviceName = 'ios-booted-test' as IosSimulatorName;

      await IosSimulatorUtils.cloneAsync({
        sourceDeviceIdentifier: 'iPhone 16' as IosSimulatorName,
        destinationDeviceName: deviceName,
        env: process.env,
      });

      const { udid } = await IosSimulatorUtils.startAsync({
        deviceIdentifier: deviceName,
        env: process.env,
      });

      await IosSimulatorUtils.waitForReadyAsync({
        udid,
        env: process.env,
      });

      const devices = await IosSimulatorUtils.getAvailableDevicesAsync({
        env: process.env,
        filter: 'booted',
      });
      expect(devices.map((device) => device.udid)).toContain(udid);
    }, 60_000);
  });

  it('should work end-to-end', async () => {
    const deviceName = 'ios-end-to-end-test' as IosSimulatorName;

    await IosSimulatorUtils.cloneAsync({
      sourceDeviceIdentifier: 'iPhone 16' as IosSimulatorName,
      destinationDeviceName: deviceName,
      env: process.env,
    });

    const { udid } = await IosSimulatorUtils.startAsync({
      deviceIdentifier: deviceName,
      env: process.env,
    });
    await IosSimulatorUtils.waitForReadyAsync({
      udid,
      env: process.env,
    });

    const { stdout } = await spawn('xcrun', ['simctl', 'ui', udid, 'appearance'], {
      env: process.env,
    });
    expect(stdout).toContain('light');

    await spawn('xcrun', ['simctl', 'shutdown', udid], { env: process.env });

    const cloneDeviceName = (deviceName + '-clone') as IosSimulatorName;
    await IosSimulatorUtils.cloneAsync({
      sourceDeviceIdentifier: deviceName,
      destinationDeviceName: cloneDeviceName,
      env: process.env,
    });

    const { udid: udidClone } = await IosSimulatorUtils.startAsync({
      deviceIdentifier: cloneDeviceName,
      env: process.env,
    });
    await IosSimulatorUtils.waitForReadyAsync({
      udid: udidClone,
      env: process.env,
    });

    const { stdout: stdoutClone } = await spawn(
      'xcrun',
      ['simctl', 'ui', udidClone, 'appearance'],
      {
        env: process.env,
      }
    );
    expect(stdoutClone).toContain('light');

    await IosSimulatorUtils.deleteAsync({
      deviceIdentifier: udidClone,
      env: process.env,
    });
  }, 60_000);

  it('should work with screen recording', async () => {
    const deviceName = 'ios-screen-recording-test' as IosSimulatorName;
    await IosSimulatorUtils.cloneAsync({
      sourceDeviceIdentifier: 'iPhone 16' as IosSimulatorName,
      destinationDeviceName: deviceName,
      env: process.env,
    });

    const { udid } = await IosSimulatorUtils.startAsync({
      deviceIdentifier: deviceName,
      env: process.env,
    });

    await IosSimulatorUtils.waitForReadyAsync({
      udid,
      env: process.env,
    });

    const { recordingSpawn, outputPath } = await IosSimulatorUtils.startScreenRecordingAsync({
      deviceIdentifier: udid,
      env: process.env,
    });

    await setTimeout(5_000);

    await IosSimulatorUtils.stopScreenRecordingAsync({
      recordingSpawn,
    });

    const { size } = await fs.promises.stat(outputPath);
    expect(size).toBeGreaterThan(1024);

    const { stdout } = await spawn('file', ['-I', '-b', outputPath], {
      env: process.env,
    });
    expect(stdout).toContain('video/quicktime');

    await IosSimulatorUtils.deleteAsync({
      deviceIdentifier: udid,
      env: process.env,
    });
  }, 60_000);
});
