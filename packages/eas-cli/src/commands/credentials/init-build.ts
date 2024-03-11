import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { SelectPlatform } from '../../credentials/manager/SelectPlatform';

export default class InitializeBuildCredentials extends EasCommand {
  static override description = 'Set up credentials for building your project.';

  static override flags = {
    platform: Flags.enum({ char: 'p', options: ['android', 'ios'], required: true }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
      default: 'production',
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

    await new SelectPlatform(
      actor,
      graphqlClient,
      vcsClient,
      analytics,
      privateProjectConfig ?? null,
      getDynamicPrivateProjectConfigAsync,
      flags.platform
    ).runAsync();
  }
}
