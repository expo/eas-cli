import { Config } from '@oclif/core';
import chalk from 'chalk';

import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorProfiles from '../profiles';

jest.mock('../../../log');
jest.mock('../../../utils/json');

const DEVICES = [
  'pixel_6',
  'pixel_6_pro',
  'pixel_6a',
  'pixel_7',
  'pixel_7_pro',
  'pixel_7a',
  'pixel_8',
  'pixel_8_pro',
  'pixel_8a',
  'pixel_9',
  'pixel_9_pro',
  'pixel_9_pro_xl',
  'pixel_9a',
];
const IMAGES = [
  'system-images;android-30;default;x86_64',
  'system-images;android-30;google_apis;x86_64',
  'system-images;android-32;default;x86_64',
  'system-images;android-32;google_apis;x86_64',
  'system-images;android-34;default;x86_64',
  'system-images;android-34;google_apis;x86_64',
  'system-images;android-35;default;x86_64',
  'system-images;android-35;google_apis;x86_64',
  'system-images;android-36;default;x86_64',
  'system-images;android-36;google_apis;x86_64',
];
const NO_IOS_PROFILES_MESSAGE = 'No simulator profiles are available for iOS yet.';

const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(SimulatorProfiles, () => {
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits Android profiles as JSON', async () => {
    const command = new SimulatorProfiles(['--platform', 'android', '--json'], mockConfig);

    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({ devices: DEVICES, images: IMAGES });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('formats Android profiles and marks the default device', async () => {
    const command = new SimulatorProfiles(['--platform', 'android'], mockConfig);

    await command.runAsync();

    expect(mockEnableJsonOutput).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(
      [
        chalk.bold('Devices:'),
        ...DEVICES.map(
          device =>
            `  ${device === 'pixel_9' ? chalk.green(device) : device}${
              device === 'pixel_9' ? ` ${chalk.green('(default)')}` : ''
            }`
        ),
        '',
        chalk.bold('System images:'),
        ...IMAGES.map(image => `  ${image}`),
      ].join('\n')
    );
  });

  it('reports that iOS profiles are unavailable', async () => {
    const command = new SimulatorProfiles(['--platform', 'ios'], mockConfig);

    await command.runAsync();

    expect(mockLog).toHaveBeenCalledWith(NO_IOS_PROFILES_MESSAGE);
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });

  it('reports unavailable iOS profiles as a JSON error', async () => {
    const command = new SimulatorProfiles(['--platform', 'ios', '--json'], mockConfig);

    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({ error: NO_IOS_PROFILES_MESSAGE });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('requires --platform', async () => {
    const command = new SimulatorProfiles([], mockConfig);

    await expect(command.runAsync()).rejects.toThrow('Missing required flag platform');
  });

  it('rejects unsupported platforms', async () => {
    const command = new SimulatorProfiles(['--platform', 'web'], mockConfig);

    await expect(command.runAsync()).rejects.toThrow(
      'Expected --platform=web to be one of: android, ios'
    );
  });
});
