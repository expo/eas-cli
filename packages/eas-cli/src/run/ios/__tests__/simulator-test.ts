import * as osascript from '@expo/osascript';
import spawnAsync from '@expo/spawn-async';

import {
  ensureSimulatorAppOpenedAsync,
  getSimulatorAppIdAsync,
  openSimulatorAppAsync,
} from '../simulator';

jest.mock('@expo/osascript');
jest.mock('@expo/spawn-async');
jest.mock('../../../log');

const UDID = '5B3F6A41-9F2A-4C7B-8B26-2A2E39B3A1D0';

beforeEach(() => {
  jest.mocked(osascript.safeIdOfAppAsync).mockReset();
  jest.mocked(osascript.execAsync).mockReset();
  jest.mocked(spawnAsync).mockReset();
});

describe(getSimulatorAppIdAsync, () => {
  it('returns the Simulator.app id on Xcode 26 and older', async () => {
    jest.mocked(osascript.safeIdOfAppAsync).mockResolvedValueOnce('com.apple.iphonesimulator');

    await expect(getSimulatorAppIdAsync()).resolves.toBe('com.apple.iphonesimulator');

    expect(osascript.safeIdOfAppAsync).toHaveBeenCalledTimes(1);
    expect(osascript.safeIdOfAppAsync).toHaveBeenCalledWith('Simulator');
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('returns the DeviceHub.app id on Xcode 27', async () => {
    jest
      .mocked(osascript.safeIdOfAppAsync)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('com.apple.dt.Devices');

    await expect(getSimulatorAppIdAsync()).resolves.toBe('com.apple.dt.Devices');

    expect(osascript.safeIdOfAppAsync).toHaveBeenNthCalledWith(1, 'Simulator');
    expect(osascript.safeIdOfAppAsync).toHaveBeenNthCalledWith(2, 'DeviceHub');
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('still checks DeviceHub when the Simulator lookup returns an empty id', async () => {
    jest
      .mocked(osascript.safeIdOfAppAsync)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('com.apple.dt.Devices');

    await expect(getSimulatorAppIdAsync()).resolves.toBe('com.apple.dt.Devices');
  });

  it('falls back to the Simulator.app Info.plist inside the selected Xcode', async () => {
    jest.mocked(osascript.safeIdOfAppAsync).mockResolvedValue(null);
    jest
      .mocked(spawnAsync)
      .mockResolvedValueOnce({ stdout: '/Applications/Xcode.app/Contents/Developer\n' } as any)
      .mockResolvedValueOnce({ stdout: 'com.apple.iphonesimulator\n' } as any);

    await expect(getSimulatorAppIdAsync()).resolves.toBe('com.apple.iphonesimulator');

    expect(spawnAsync).toHaveBeenNthCalledWith(1, 'xcode-select', ['--print-path']);
    expect(spawnAsync).toHaveBeenNthCalledWith(2, 'defaults', [
      'read',
      '/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/Contents/Info.plist',
      'CFBundleIdentifier',
    ]);
  });

  it('falls back to the DeviceHub.app Info.plist inside the selected Xcode', async () => {
    jest.mocked(osascript.safeIdOfAppAsync).mockResolvedValue(null);
    jest
      .mocked(spawnAsync)
      .mockResolvedValueOnce({ stdout: '/Applications/Xcode.app/Contents/Developer\n' } as any)
      .mockRejectedValueOnce(new Error('does not exist'))
      .mockResolvedValueOnce({ stdout: 'com.apple.dt.Devices\n' } as any);

    await expect(getSimulatorAppIdAsync()).resolves.toBe('com.apple.dt.Devices');

    expect(spawnAsync).toHaveBeenNthCalledWith(3, 'defaults', [
      'read',
      '/Applications/Xcode.app/Contents/Applications/DeviceHub.app/Contents/Info.plist',
      'CFBundleIdentifier',
    ]);
  });

  it('returns undefined when neither app can be found', async () => {
    jest.mocked(osascript.safeIdOfAppAsync).mockResolvedValue(null);
    jest.mocked(spawnAsync).mockRejectedValue(new Error('not found'));

    await expect(getSimulatorAppIdAsync()).resolves.toBeUndefined();
  });
});

describe(openSimulatorAppAsync, () => {
  it('opens Simulator.app focused on the device on Xcode 26 and older', async () => {
    jest.mocked(spawnAsync).mockResolvedValue({} as any);

    await openSimulatorAppAsync(UDID);

    expect(spawnAsync).toHaveBeenCalledTimes(1);
    expect(spawnAsync).toHaveBeenCalledWith('open', [
      '-a',
      'Simulator',
      '--args',
      '-CurrentDeviceUDID',
      UDID,
    ]);
  });

  it('opens Device Hub focused on the device when Simulator.app is missing', async () => {
    jest
      .mocked(spawnAsync)
      .mockRejectedValueOnce(new Error('Unable to find application named Simulator'))
      .mockResolvedValueOnce({} as any);

    await openSimulatorAppAsync(UDID);

    expect(spawnAsync).toHaveBeenNthCalledWith(2, 'open', [`devices://device/open?id=${UDID}`]);
  });

  it('opens Device Hub without focusing when no device is given', async () => {
    jest
      .mocked(spawnAsync)
      .mockRejectedValueOnce(new Error('Unable to find application named Simulator'))
      .mockResolvedValueOnce({} as any);

    await openSimulatorAppAsync('');

    expect(spawnAsync).toHaveBeenNthCalledWith(2, 'open', ['-a', 'DeviceHub']);
  });

  it('rethrows the Simulator.app error when Device Hub cannot be opened either', async () => {
    jest
      .mocked(spawnAsync)
      .mockRejectedValueOnce(new Error('LaunchServices failed to open Simulator'))
      .mockRejectedValueOnce(new Error('Unable to find application named DeviceHub'));

    await expect(openSimulatorAppAsync(UDID)).rejects.toThrow(
      'LaunchServices failed to open Simulator'
    );
  });
});

describe(ensureSimulatorAppOpenedAsync, () => {
  it('treats a running Device Hub process as the simulator app being open', async () => {
    jest.mocked(osascript.execAsync).mockResolvedValue('1');

    await ensureSimulatorAppOpenedAsync(UDID);

    expect(osascript.execAsync).toHaveBeenCalledWith(
      'tell app "System Events" to count processes whose name is "Simulator" or name is "DeviceHub"'
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('opens the simulator app when neither process is running', async () => {
    jest.mocked(osascript.execAsync).mockResolvedValueOnce('0').mockResolvedValue('1');
    jest.mocked(spawnAsync).mockResolvedValue({} as any);

    await ensureSimulatorAppOpenedAsync(UDID);

    expect(spawnAsync).toHaveBeenCalledWith('open', [
      '-a',
      'Simulator',
      '--args',
      '-CurrentDeviceUDID',
      UDID,
    ]);
  });
});
