import { Args } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { ExpoGoPlatform, getExpoGoDownloadUrlAsync } from '../../utils/expoGo';

export default class GoUrl extends EasCommand {
  static override description = 'print the Expo Go download URL for a platform';

  static override args = {
    platform: Args.string({
      description: 'Platform to get the Expo Go download URL for',
      options: ['ios', 'android'],
      required: true,
    }),
    sdkVersion: Args.string({
      description: 'Expo SDK version, or "latest". Defaults to the current project SDK, or latest.',
      required: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { args } = await this.parse(GoUrl);
    const { url } = await getExpoGoDownloadUrlAsync(args.platform as ExpoGoPlatform, {
      sdkVersion: args.sdkVersion,
    });

    Log.log(url);
  }
}
