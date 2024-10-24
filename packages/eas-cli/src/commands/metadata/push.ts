import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import { Flags } from '@oclif/core';

import { ensureProjectConfiguredAsync } from '../../build/configure';
import EasCommand from '../../commandUtils/EasCommand';
import { CredentialsContext } from '../../credentials/context';
import Log, { learnMore } from '../../log';
import { handleMetadataError } from '../../metadata/errors';
import { uploadMetadataAsync } from '../../metadata/upload';
import { getProfilesAsync } from '../../utils/profiles';

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
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Metadata is in beta and subject to breaking changes.');

    const { flags } = await this.parse(MetadataPush);
    const {
      loggedIn: { actor, graphqlClient },
      privateProjectConfig: { exp, projectId, projectDir },
      analytics,
      vcsClient,
    } = await this.getContextAsync(MetadataPush, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    // this command is interactive (all nonInteractive flags passed to utility functions are false)
    await ensureProjectConfiguredAsync({ projectDir, nonInteractive: false, vcsClient });

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
      nonInteractive: false,
      vcsClient,
    });

    try {
      const { appleLink } = await uploadMetadataAsync({
        analytics,
        exp,
        credentialsCtx,
        projectDir,
        profile: submitProfile,
      });

      Log.addNewLineIfNone();
      Log.log(`🎉 Store configuration is synced with the app stores.

${learnMore(appleLink, { learnMoreMessage: 'See the changes in App Store Connect' })}`);
    } catch (error: any) {
      handleMetadataError(error);
    }
  }
}
