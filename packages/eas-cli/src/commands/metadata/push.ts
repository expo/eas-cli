import { Flags } from '@oclif/core';

import { ensureProjectConfiguredAsync } from '../../build/configure';
import EasCommand, {
  EASCommandLoggedInContext,
  EASCommandProjectConfigContext,
  EASCommandProjectDirContext,
} from '../../commandUtils/EasCommand';
import { CredentialsContext } from '../../credentials/context';
import Log, { learnMore } from '../../log';
import { createMetadataContextAsync } from '../../metadata/context';
import { handleMetadataError } from '../../metadata/errors';
import { uploadMetadataAsync } from '../../metadata/upload';

export default class MetadataPush extends EasCommand {
  static override description = 'sync the local store configuration to the app stores';

  static override flags = {
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  static override contextDefinition = {
    ...EASCommandProjectConfigContext,
    ...EASCommandLoggedInContext,
    ...EASCommandProjectDirContext,
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Metadata is in beta and subject to breaking changes.');

    const { flags } = await this.parse(MetadataPush);
    const {
      actor,
      projectConfig: { exp, projectId },
      projectDir,
    } = await this.getContextAsync(MetadataPush, {
      nonInteractive: false,
    });

    // this command is interactive (all nonInteractive flags passed to utility functions are false)
    await ensureProjectConfiguredAsync({ projectDir, nonInteractive: false });

    const credentialsCtx = new CredentialsContext({
      projectInfo: { exp, projectId },
      projectDir,
      user: actor,
      nonInteractive: false,
    });

    const metadataCtx = await createMetadataContextAsync({
      credentialsCtx,
      projectDir,
      exp,
      profileName: flags.profile,
    });

    try {
      const { appleLink } = await uploadMetadataAsync(metadataCtx);
      Log.addNewLineIfNone();
      Log.log(`🎉 Store configuration is synced with the app stores.

${learnMore(appleLink, { learnMoreMessage: 'See the changes in App Store Connect' })}`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }
}
