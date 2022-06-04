import { getConfig } from '@expo/config';
import { Errors, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { createMetadataContextAsync } from '../../metadata/context';
import { handleMetadataError } from '../../metadata/errors';
import { uploadMetadataAsync } from '../../metadata/upload';
import { RequestedPlatform } from '../../platform';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';

type RawCommandFlags = {
  platform?: string;
  profile?: string;
};

type CommandFlags = {
  requestedPlatforms: RequestedPlatform;
  profile?: string;
};

export default class Metadata extends EasCommand {
  static hidden = true;
  static description = 'upload metadata configuration to the app stores';

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
    const { flags: rawFlags } = await this.parse(Metadata);
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    await getProjectIdAsync(exp);

    const metadataContext = await createMetadataContextAsync({
      projectDir,
      exp,
      profileName: flags.profile,
    });

    try {
      Log.addNewLineIfNone();
      await uploadMetadataAsync(metadataContext);
      Log.addNewLineIfNone();
      Log.succeed(`Store has been updated with your ${metadataContext.metadataFile} configuration`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }

  private async sanitizeFlagsAsync(flags: RawCommandFlags): Promise<CommandFlags> {
    const { profile } = flags;

    return {
      // TODO: add support for multiple platforms, right now we only support ios
      requestedPlatforms: RequestedPlatform.Ios, // enforced by the flag options
      profile,
    };
  }
}
