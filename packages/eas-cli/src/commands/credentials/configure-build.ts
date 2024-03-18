import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
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
      required: true,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.OptionalProjectConfig,
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
    });

    const platform = await selectPlatformAsync(flags.platform);

    await new SetUpBuildCredentialsCommandAction(
      actor,
      graphqlClient,
      vcsClient,
      analytics,
      privateProjectConfig ?? null,
      getDynamicPrivateProjectConfigAsync,
      platform,
      flags.profile
    ).runAsync();
  }
}
