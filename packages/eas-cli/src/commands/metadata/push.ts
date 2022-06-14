import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { CredentialsContext } from '../../credentials/context';
import Log from '../../log';
import { createMetadataContextAsync } from '../../metadata/context';
import { handleMetadataError } from '../../metadata/errors';
import { uploadMetadataAsync } from '../../metadata/upload';
import { RequestedPlatform } from '../../platform';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';

type RawCommandFlags = {
  platform?: string;
  profile?: string;
};

type CommandFlags = {
  requestedPlatforms: RequestedPlatform;
  profile?: string;
};

export default class MetadataPush extends EasCommand {
  static hidden = true;
  static description = 'upload metadata configuration to the app stores';
  static aliases = ['metadata'];

  static flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['ios'],
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  static args = [];

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(MetadataPush);
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    await getProjectIdAsync(exp);

    const credentialsCtx = new CredentialsContext({
      exp,
      projectDir,
      user: await ensureLoggedInAsync(),
      nonInteractive: false,
    });

    const metadataCtx = await createMetadataContextAsync({
      credentialsCtx,
      projectDir,
      exp,
      profileName: flags.profile,
    });

    try {
      Log.addNewLineIfNone();
      await uploadMetadataAsync(metadataCtx);
      Log.addNewLineIfNone();
      Log.succeed(`Store has been updated with your ${metadataCtx.metadataPath} configuration`);
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
