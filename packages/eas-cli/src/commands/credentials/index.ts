import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { SelectPlatform } from '../../credentials/manager/SelectPlatform';

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override flags = {
    platform: Flags.enum({ char: 'p', options: ['android', 'ios'] }),
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
      flags.platform
    ).runAsync();
  }
}
