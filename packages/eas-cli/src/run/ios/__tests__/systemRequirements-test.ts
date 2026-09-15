import spawnAsync from '@expo/spawn-async';

import { getSimulatorAppIdAsync } from '../simulator';
import { validateSystemRequirementsAsync } from '../systemRequirements';
import { getXcodeVersionAsync } from '../xcode';
import { isXcrunInstalledAsync } from '../xcrun';

jest.mock('@expo/spawn-async');
jest.mock('../simulator');
jest.mock('../xcode');
jest.mock('../xcrun');
jest.mock('../../../log');

const originalPlatform = process.platform;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  jest.mocked(getXcodeVersionAsync).mockResolvedValue('27.0.0');
  jest.mocked(isXcrunInstalledAsync).mockResolvedValue(true);
  jest.mocked(spawnAsync).mockResolvedValue({} as any);
});

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe(validateSystemRequirementsAsync, () => {
  it.each([
    ['Simulator.app', 'com.apple.iphonesimulator'],
    ['Simulator.app trampoline', 'com.apple.CoreSimulator.SimulatorTrampoline'],
    ['Device Hub', 'com.apple.dt.Devices'],
  ])('accepts %s', async (_label, appId) => {
    jest.mocked(getSimulatorAppIdAsync).mockResolvedValue(appId);

    await expect(validateSystemRequirementsAsync()).resolves.toBeUndefined();

    expect(spawnAsync).toHaveBeenCalledWith('xcrun', ['simctl', 'help']);
  });

  it('rejects an unknown app id', async () => {
    jest.mocked(getSimulatorAppIdAsync).mockResolvedValue('com.example.Other');

    await expect(validateSystemRequirementsAsync()).rejects.toThrow(
      "identified as 'com.example.Other'"
    );
  });

  it('rejects when no simulator host app can be found', async () => {
    jest.mocked(getSimulatorAppIdAsync).mockResolvedValue(undefined);

    await expect(validateSystemRequirementsAsync()).rejects.toThrow(
      "Can't determine id of Device Hub or Simulator app"
    );
  });
});
