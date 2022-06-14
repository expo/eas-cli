import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';

import { ensureProjectConfiguredAsync } from '../../build/configure';
import EasCommand from '../../commandUtils/EasCommand';
import { CredentialsContext } from '../../credentials/context';
import Log from '../../log';
import { createMetadataContextAsync } from '../../metadata/context';
import { handleMetadataError } from '../../metadata/errors';
import { uploadMetadataAsync } from '../../metadata/upload';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';

export default class MetadataPush extends EasCommand {
  static hidden = true;
  static description = 'sync the local store configuration to the app stores';

  static flags = {
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  static args = [];

  async runAsync(): Promise<void> {
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
      await uploadMetadataAsync(metadataCtx);
      Log.addNewLineIfNone();
      Log.log(`🎉 Store configuration is synced with the app stores.`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }
}
