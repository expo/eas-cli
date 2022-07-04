import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';

import { ensureProjectConfiguredAsync } from '../../build/configure.js';
import EasCommand from '../../commandUtils/EasCommand.js';
import { CredentialsContext } from '../../credentials/context.js';
import Log, { learnMore } from '../../log.js';
import { createMetadataContextAsync } from '../../metadata/context.js';
import { handleMetadataError } from '../../metadata/errors.js';
import { uploadMetadataAsync } from '../../metadata/upload.js';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils.js';
import { ensureLoggedInAsync } from '../../user/actions.js';

export default class MetadataPush extends EasCommand {
  static description = 'sync the local store configuration to the app stores';

  static flags = {
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Metadata is in beta and subject to breaking changes.');

    const { flags } = await this.parse(MetadataPush);
    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    await getProjectIdAsync(exp);
    await ensureProjectConfiguredAsync({ projectDir, nonInteractive: false });

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
      const { appleLink } = await uploadMetadataAsync(metadataCtx);
      Log.addNewLineIfNone();
      Log.log(`🎉 Store configuration is synced with the app stores.

${learnMore(appleLink, { learnMoreMessage: 'See the changes in App Store Connect' })}`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }
}
