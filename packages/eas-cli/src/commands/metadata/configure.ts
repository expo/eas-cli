import { getConfig } from '@expo/config';
import { Errors, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';
import { createMetadataContextAsync } from '../../metadata/context';
import { downloadMetadataAsync } from '../../metadata/download';
import { handleMetadataError } from '../../metadata/errors';
import { RequestedPlatform } from '../../platform';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';

type RawCommandFlags = {
  platform?: string;
  profile?: string;
  'non-interactive': boolean;
};

type CommandFlags = {
  requestedPlatforms: RequestedPlatform;
  profile?: string;
  nonInteractive: boolean;
};

export default class MetadataConfigure extends EasCommand {
  static hidden = true;
  static description = 'configure the store configuration file in your project';

  static flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['ios'],
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  static args = [];

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(MetadataConfigure);
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    await getProjectIdAsync(exp);

    const metadataContext = await createMetadataContextAsync({
      projectDir,
      exp,
      profileName: flags.profile,
      nonInteractive: flags.nonInteractive,
    });

    try {
      Log.addNewLineIfNone();
      const filePath = await downloadMetadataAsync(metadataContext);
      Log.addNewLineIfNone();

      Log.succeed('Your store configuration has been generated!');
      Log.log(filePath);
      Log.log(learnMore('https://docs.expo.dev/eas-metadata/introduction/'));
    } catch (error: any) {
      handleMetadataError(error);
    }
  }

  private async sanitizeFlagsAsync(flags: RawCommandFlags): Promise<CommandFlags> {
    const { platform, profile, 'non-interactive': nonInteractive } = flags;

    if (!platform && nonInteractive) {
      Errors.error('--platform is required when building in non-interactive mode', { exit: 1 });
    }

    return {
      // TODO: add support for multiple platforms, right now we only support ios
      requestedPlatforms: RequestedPlatform.Ios, // enforced by the flag options
      profile,
      nonInteractive,
    };
  }
}
