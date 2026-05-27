import { Args } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import {
  ExpoGoPlatform,
  copyExpoGoToPathAsync,
  downloadExpoGoAsync,
  isSdkVersionInput,
} from '../../utils/expoGo';

export default class GoDownload extends EasCommand {
  static override description = 'download Expo Go for a platform';

  static override args = {
    platform: Args.string({
      description: 'Platform to download Expo Go for',
      options: ['ios', 'android'],
      required: true,
    }),
    sdkVersion: Args.string({
      description:
        'Expo SDK version to download, or "latest". Defaults to the current project SDK, or latest.',
      required: false,
    }),
    outputPath: Args.string({
      description:
        'Output path. Defaults to the current directory. Pass an SDK version (or "latest") to use it.',
      required: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { args } = await this.parse(GoDownload);
    const platform = args.platform as ExpoGoPlatform;
    if (args.sdkVersion && !isSdkVersionInput(args.sdkVersion)) {
      throw new Error(
        `Expected "${args.sdkVersion}" to be an Expo SDK version or "latest". Pass "latest" as the SDK version to download the default Expo Go to a specific output path.`
      );
    }

    const download = await downloadExpoGoAsync(platform, {
      sdkVersion: args.sdkVersion,
    });
    const copiedPath = await copyExpoGoToPathAsync({
      destinationPath: args.outputPath,
      platform,
      sourcePath: download.path,
    });

    Log.log(`Expo Go downloaded to ${chalk.bold(copiedPath)}`);
  }
}
