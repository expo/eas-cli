import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { RequestedPlatform } from '../../platform';
import { ensureEASUpdatesIsConfiguredAsync } from '../../update/configure';

export default class UpdateConfigure extends EasCommand {
  static override description = 'configure the project to support EAS Update';

  static override flags = {
    platform: Flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
      default: 'all',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    Log.log(
      '💡 The following process will configure your project to run EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    const { flags } = await this.parse(UpdateConfigure);
    const platform = flags.platform as RequestedPlatform;
    const {
      projectConfig: { projectId, exp, projectDir },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateConfigure, {
      nonInteractive: true,
    });

    await ensureEASUpdatesIsConfiguredAsync(graphqlClient, {
      exp,
      projectId,
      projectDir,
      platform,
    });

    Log.addNewLineIfNone();
    Log.log(`🎉 Your app is configured to run EAS Update!`);
  }
}
