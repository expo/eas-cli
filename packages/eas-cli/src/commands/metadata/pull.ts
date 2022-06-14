import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import path from 'path';

import { ensureProjectConfiguredAsync } from '../../build/configure';
import EasCommand from '../../commandUtils/EasCommand';
import { CredentialsContext } from '../../credentials/context';
import Log, { learnMore } from '../../log';
import { createMetadataContextAsync } from '../../metadata/context';
import { downloadMetadataAsync } from '../../metadata/download';
import { handleMetadataError } from '../../metadata/errors';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';

export default class MetadataPull extends EasCommand {
  static hidden = true;
  static description = 'generate the local store configuration from the app stores';

  static flags = {
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(MetadataPull);
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
      const filePath = await downloadMetadataAsync(metadataCtx);
      const relativePath = path.relative(process.cwd(), filePath);

      Log.addNewLineIfNone();
      Log.log(`🎉 Your store configuration is ready.

- Update the ${chalk.bold(relativePath)} file to prepare the app information.
- Run ${chalk.bold('eas submit')} or manually upload a new app version to the app stores.
- Once the app is uploaded, run ${chalk.bold('eas metadata')} to sync the store information.
- ${learnMore('https://docs.expo.dev/eas-metadata/introduction/')}`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }
}
