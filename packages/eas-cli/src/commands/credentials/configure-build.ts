import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { SelectBuildProfileFromEasJson } from '../../credentials/manager/SelectBuildProfileFromEasJson';
import { SetUpBuildCredentialsCommandAction } from '../../credentials/manager/SetUpBuildCredentialsCommandAction';
import { selectPlatformAsync } from '../../platform';

export default class InitializeBuildCredentials extends EasCommand {
  static override description = 'Set up credentials for building your project.';

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: [Platform.ANDROID, Platform.IOS],
    }),
    profile: Flags.string({
      char: 'e',
      description: 'The name of the build profile in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(InitializeBuildCredentials);
    const {
      loggedIn: { actor, graphqlClient },
      privateProjectConfig,
      getDynamicPrivateProjectConfigAsync,
      analytics,
      vcsClient,
    } = await this.getContextAsync(InitializeBuildCredentials, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const platform = await selectPlatformAsync(flags.platform);

    const buildProfile =
      flags.profile ??
      (await new SelectBuildProfileFromEasJson(
        privateProjectConfig.projectDir,
        Platform.IOS
      ).getProfileNameFromEasConfigAsync());

    await new SetUpBuildCredentialsCommandAction(
      actor,
      graphqlClient,
      vcsClient,
      analytics,
      privateProjectConfig ?? null,
      getDynamicPrivateProjectConfigAsync,
      platform,
      buildProfile,
      process.cwd()
    ).runAsync();
  }
}
