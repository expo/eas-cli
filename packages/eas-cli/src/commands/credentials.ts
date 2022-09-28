import { Flags } from '@oclif/core';

import EasCommand from '../commandUtils/EasCommand';
import { SelectPlatform } from '../credentials/manager/SelectPlatform';

export default class Credentials extends EasCommand {
  static override description = 'manage credentials';

  static override flags = {
    platform: Flags.enum({ char: 'p', options: ['android', 'ios'] }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.OptionalProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(Credentials);
    const { actor, projectConfig } = await this.getContextAsync(Credentials, {
      nonInteractive: false,
    });

    await new SelectPlatform(actor, projectConfig ?? null, flags.platform).runAsync();
  }
}
