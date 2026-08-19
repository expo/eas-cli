import { BuildRuntimePlatform } from '@expo/steps';

import { AndroidEmulatorUtils } from '../../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { selectXcodeDeveloperDirectoryAsync } from '../../utils/remoteDeviceRunSession';

import { resolveAppium3VersionSpec, resolveAppiumDeviceAsync } from '../startAppiumRemoteSession';

jest.mock('../../../utils/AndroidEmulatorUtils', () => ({
  AndroidEmulatorUtils: { getAttachedDevicesAsync: jest.fn() },
}));
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: { getAvailableDevicesAsync: jest.fn() },
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
}));

const logger = { info: jest.fn(), warn: jest.fn() } as never;

describe(resolveAppium3VersionSpec, () => {
  it('uses the worker-supported Appium 3 version by default', () => {
    expect(resolveAppium3VersionSpec(undefined)).toBe('^3');
  });

  it.each(['3', '^3', '3.x', '3.5.0', '>=3 <4'])('accepts Appium 3 version %s', version => {
    expect(resolveAppium3VersionSpec(version)).toBe(version);
  });

  it.each(['2', '2.19.0', 'latest', '4.0.0', '>=3'])('rejects version %s', version => {
    expect(() => resolveAppium3VersionSpec(version)).toThrow(
      `Appium 3 is required for EAS Simulator sessions. Received package version "${version}".`
    );
  });
});

describe(resolveAppiumDeviceAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns XCUITest capabilities for the booted iOS simulator', async () => {
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockResolvedValue([{ udid: 'ios-simulator-id' } as never]);

    await expect(
      resolveAppiumDeviceAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: {},
        logger,
      })
    ).resolves.toEqual({
      platformName: 'iOS',
      automationName: 'XCUITest',
      driverName: 'xcuitest',
      udid: 'ios-simulator-id',
    });
    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledWith({ env: {}, logger });
    expect(IosSimulatorUtils.getAvailableDevicesAsync).toHaveBeenCalledWith({
      env: {},
      filter: 'booted',
    });
  });

  it('returns UiAutomator2 capabilities for the booted Android emulator', async () => {
    jest
      .mocked(AndroidEmulatorUtils.getAttachedDevicesAsync)
      .mockResolvedValue([{ serialId: 'emulator-5554', state: 'device' } as never]);

    await expect(
      resolveAppiumDeviceAsync({
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger,
      })
    ).resolves.toEqual({
      platformName: 'Android',
      automationName: 'UiAutomator2',
      driverName: 'uiautomator2',
      udid: 'emulator-5554',
    });
    expect(AndroidEmulatorUtils.getAttachedDevicesAsync).toHaveBeenCalledWith({ env: {} });
    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
  });
});
