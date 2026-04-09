import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import path from 'path';

import { ensureProjectConfiguredAsync } from '../../build/configure';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { CredentialsContext } from '../../credentials/context';
import Log, { learnMore } from '../../log';
import { downloadMetadataAsync } from '../../metadata/download';
import { handleMetadataError } from '../../metadata/errors';
import { getProfilesAsync } from '../../utils/profiles';

export default class MetadataPull extends EasCommand {
  static override description = 'generate the local store configuration from the app stores';

  static override flags = {
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Metadata is in beta and subject to breaking changes.');

    const { flags } = await this.parse(MetadataPull);
    const nonInteractive = flags['non-interactive'];
    const {
      loggedIn: { actor, graphqlClient },
      privateProjectConfig: { exp, projectId, projectDir },
      analytics,
      vcsClient,
    } = await this.getContextAsync(MetadataPull, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    await ensureProjectConfiguredAsync({ projectDir, nonInteractive, vcsClient });

    const submitProfiles = await getProfilesAsync({
      type: 'submit',
      easJsonAccessor: EasJsonAccessor.fromProjectPath(projectDir),
      platforms: [Platform.IOS],
      profileName: flags.profile,
      projectDir,
    });

    if (submitProfiles.length !== 1) {
      throw new Error('Metadata only supports iOS and a single submit profile.');
    }

    const submitProfile = submitProfiles[0].profile;
    const credentialsCtx = new CredentialsContext({
      projectInfo: { exp, projectId },
      projectDir,
      user: actor,
      graphqlClient,
      analytics,
      nonInteractive,
      vcsClient,
    });

    try {
      const filePath = await downloadMetadataAsync({
        analytics,
        exp,
        credentialsCtx,
        projectDir,
        profile: submitProfile,
        nonInteractive,
        graphqlClient,
        projectId,
      });
      const relativePath = path.relative(process.cwd(), filePath);

      Log.addNewLineIfNone();
      Log.log(`🎉 Your store config is ready.

- Update the ${chalk.bold(relativePath)} file to prepare the app information.
- Run ${chalk.bold('eas submit')} or manually upload a new app version to the app stores.
- Once the app is uploaded, run ${chalk.bold('eas metadata:push')} to sync the store config.
- ${learnMore('https://docs.expo.dev/eas/metadata/')}`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }
}
