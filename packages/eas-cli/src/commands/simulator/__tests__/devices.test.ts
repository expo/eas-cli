import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionProfilesQuery } from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorDevices from '../devices';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = {
      fail: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../utils/json');
jest.mock('chalk', () => ({
  __esModule: true,
  default: { bold: (text: string) => text, dim: (text: string) => text },
}));

const mockProfilesAsync = jest.mocked(DeviceRunSessionQuery.profilesAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);

const profiles: DeviceRunSessionProfilesQuery['deviceRunSessions']['profiles'] = {
  __typename: 'DeviceRunSessionProfiles',
  ios: {
    __typename: 'IosDeviceRunSessionProfiles',
    devices: [
      {
        __typename: 'IosDeviceRunSessionDevice',
        identifier: 'iPhone 17',
        displayName: 'iPhone 17',
        isDefault: true,
      },
      {
        __typename: 'IosDeviceRunSessionDevice',
        identifier: 'iPhone 17 Pro',
        displayName: 'iPhone 17 Pro',
        isDefault: false,
      },
    ],
  },
  android: {
    __typename: 'AndroidDeviceRunSessionProfiles',
    devices: [
      {
        __typename: 'AndroidDeviceRunSessionDevice',
        identifier: 'medium_phone',
        displayName: 'Medium Phone',
        isDefault: true,
      },
      {
        __typename: 'AndroidDeviceRunSessionDevice',
        identifier: 'pixel_9',
        displayName: 'Pixel 9',
        isDefault: false,
      },
    ],
  },
};

const iosDevices = [
  { identifier: 'iPhone 17', displayName: 'iPhone 17', isDefault: true },
  { identifier: 'iPhone 17 Pro', displayName: 'iPhone 17 Pro', isDefault: false },
];
const androidDevices = [
  { identifier: 'medium_phone', displayName: 'Medium Phone', isDefault: true },
  { identifier: 'pixel_9', displayName: 'Pixel 9', isDefault: false },
];

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(SimulatorDevices, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    mockProfilesAsync.mockResolvedValue(profiles);
  });

  function createCommand(argv: string[]): SimulatorDevices {
    const command = new SimulatorDevices(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('does not need a project', () => {
    expect(Object.keys(SimulatorDevices.contextDefinition)).toEqual(['loggedIn']);
  });

  it('logs the devices of both platforms', async () => {
    await createCommand([]).runAsync();

    expect(mockProfilesAsync).toHaveBeenCalledWith(graphqlClient);
    expect(mockLog).toHaveBeenCalledWith(
      [
        'Platform  Device                  --device value',
        'iOS       iPhone 17 (default)     "iPhone 17"',
        'iOS       iPhone 17 Pro           "iPhone 17 Pro"',
        'Android   Medium Phone (default)  medium_phone',
        'Android   Pixel 9                 pixel_9',
      ].join('\n')
    );
    expect(mockLog).toHaveBeenCalledWith(
      'Start a session with: eas simulator:start --platform ios --device "iPhone 17"'
    );
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });

  it('logs the devices of one platform with --platform', async () => {
    await createCommand(['--platform', 'android']).runAsync();

    expect(mockLog).toHaveBeenCalledWith(
      [
        'Platform  Device                  --device value',
        'Android   Medium Phone (default)  medium_phone',
        'Android   Pixel 9                 pixel_9',
      ].join('\n')
    );
    expect(mockLog).toHaveBeenCalledWith(
      'Start a session with: eas simulator:start --platform android --device medium_phone'
    );
  });

  it('uses the default flag from the API instead of the device name or list order', async () => {
    mockProfilesAsync.mockResolvedValue({
      ...profiles,
      ios: {
        ...profiles.ios,
        devices: profiles.ios.devices.map(device => ({
          ...device,
          isDefault: device.identifier === 'iPhone 17 Pro',
        })),
      },
    });

    await createCommand(['--platform', 'ios']).runAsync();

    const table = mockLog.mock.calls[0][0];
    expect(table).toContain('iPhone 17 Pro (default)');
    expect(table).not.toContain('iPhone 17 (default)');
    expect(table).toContain('"iPhone 17 Pro"');
  });

  it('says so when the service lists no devices', async () => {
    mockProfilesAsync.mockResolvedValue({
      ...profiles,
      ios: { ...profiles.ios, devices: [] },
      android: { ...profiles.android, devices: [] },
    });

    await createCommand([]).runAsync();

    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith('No simulator devices found.');
  });

  it('emits JSON for both platforms', async () => {
    await createCommand(['--json']).runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      ios: iosDevices,
      android: androidDevices,
    });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('emits JSON for one platform with --platform', async () => {
    await createCommand(['--json', '-p', 'ios']).runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({ ios: iosDevices });
  });

  it('propagates a query failure', async () => {
    mockProfilesAsync.mockRejectedValue(new Error('network down'));

    await expect(createCommand([]).runAsync()).rejects.toThrow('network down');
  });
});
