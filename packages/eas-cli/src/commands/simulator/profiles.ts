import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const PLATFORM_FLAG_VALUES = ['android', 'ios'] as const;
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
] as const;
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
] as const;
const DEFAULT_DEVICE: (typeof DEVICES)[number] = 'pixel_9';
const NO_IOS_PROFILES_MESSAGE = 'No simulator profiles are available for iOS yet.';

export default class SimulatorProfiles extends EasCommand {
  static override hidden = true;
  static override aliases = ['sim:profiles'];
  static override description =
    '[EXPERIMENTAL] list available device and system image profiles for EAS Simulator';

  static override flags = {
    platform: Flags.option({
      char: 'p',
      description: 'Device platform',
      options: PLATFORM_FLAG_VALUES,
      required: true,
    })(),
    ...EasJsonOnlyFlag,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorProfiles);

    if (flags.json) {
      enableJsonOutput();
    }

    if (flags.platform === 'ios') {
      if (flags.json) {
        printJsonOnlyOutput({ error: NO_IOS_PROFILES_MESSAGE });
      } else {
        Log.log(NO_IOS_PROFILES_MESSAGE);
      }
      return;
    }

    if (flags.json) {
      printJsonOnlyOutput({ devices: DEVICES, images: IMAGES });
      return;
    }

    Log.log(
      [
        chalk.bold('Devices:'),
        ...DEVICES.map(formatDevice),
        '',
        chalk.bold('System images:'),
        ...IMAGES.map(image => `  ${image}`),
      ].join('\n')
    );
  }
}

function formatDevice(device: (typeof DEVICES)[number]): string {
  const formattedDevice = device === DEFAULT_DEVICE ? chalk.green(device) : device;
  const defaultLabel = device === DEFAULT_DEVICE ? ` ${chalk.green('(default)')}` : '';
  return `  ${formattedDevice}${defaultLabel}`;
}
