import { Flags } from '@oclif/core';

import EasCommand from '../commandUtils/EasCommand';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';

const PLATFORM_FLAG_OPTIONS = ['android', 'ios'];

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override flags = {
    platform: Flags.string({ char: 'p', options: PLATFORM_FLAG_OPTIONS }),
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
      privateProjectConfig,
      getDynamicPrivateProjectConfigAsync,
      analytics,
      vcsClient,
    } = await this.getContextAsync(Credentials, {
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
