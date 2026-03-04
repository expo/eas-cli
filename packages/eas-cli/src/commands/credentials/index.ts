import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { SelectPlatform } from '../../credentials/manager/SelectPlatform';

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override flags = {
    platform: Flags.option({ char: 'p', options: ['android', 'ios'] as const })(),
    profile: Flags.string({
      char: 'e',
      description: 'Name of the profile to manage',
      helpValue: 'PROFILE_NAME',
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
    const { flags } = await this.parse(Credentials);
    console.error(`The flags! ${flags}`);
    const {
      loggedIn: { actor, graphqlClient },
      optionalPrivateProjectConfig: privateProjectConfig,
      getDynamicPrivateProjectConfigAsync,
      analytics,
      vcsClient,
    } = await this.getContextAsync(Credentials, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    await new SelectPlatform(
      actor,
      graphqlClient,
      vcsClient,
      analytics,
      privateProjectConfig ?? null,
      getDynamicPrivateProjectConfigAsync,
      {
        flagPlatform: flags.platform,
        flagProfileName: flags.profile,
      }
    ).runAsync();
  }
}
