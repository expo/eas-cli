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
  static override description = 'generate the local store configuration from the app stores';

  static override flags = {
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Metadata is in beta and subject to breaking changes.');

    const { flags } = await this.parse(MetadataPull);
    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

    // this command is interactive (all nonInteractive flags passed to utility functions are false)
    await getProjectIdAsync(exp, { nonInteractive: false });
    await ensureProjectConfiguredAsync({ projectDir, nonInteractive: false });

    const credentialsCtx = new CredentialsContext({
      exp,
      projectDir,
      user: await ensureLoggedInAsync({ nonInteractive: false }),
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
      Log.log(`🎉 Your store config is ready.

- Update the ${chalk.bold(relativePath)} file to prepare the app information.
- Run ${chalk.bold('eas submit')} or manually upload a new app version to the app stores.
- Once the app is uploaded, run ${chalk.bold('eas metadata:push')} to sync the store config.
- ${learnMore('https://docs.expo.dev/eas-metadata/introduction/')}`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }
}
