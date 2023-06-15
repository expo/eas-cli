import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import Log, { learnMore, link } from '../../log';
import { RequestedPlatform } from '../../platform';
import {
  ensureEASUpdateIsConfiguredAsync,
  ensureEASUpdateIsConfiguredInEasJsonAsync,
} from '../../update/configure';
import { getVcsClient } from '../../vcs';

export default class UpdateConfigure extends EasCommand {
  static override description = 'configure the project to support EAS Update';

  static override flags = {
    platform: Flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
      default: 'all',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateConfigure);
    const platform = flags.platform as RequestedPlatform;
    const {
      privateProjectConfig: { projectId, exp, projectDir },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateConfigure, {
      nonInteractive: flags['non-interactive'],
    });

    Log.log(
      '💡 The following process will configure your project to run EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    await getVcsClient().ensureRepoExistsAsync();

    await ensureEASUpdateIsConfiguredAsync(graphqlClient, {
      exp,
      projectId,
      projectDir,
      platform,
    });

    await ensureEASUpdateIsConfiguredInEasJsonAsync(projectDir);

    Log.addNewLineIfNone();
    Log.log(`🎉 Your app is configured with EAS Update!`);
    Log.newLine();
    Log.log(`- Run ${chalk.bold('eas build:configure')} to complete your installation`);
    Log.log(
      `- ${learnMore('https://docs.expo.dev/eas-update/introduction/', {
        learnMoreMessage: 'Learn more about other capabilities of EAS Update',
      })}`
    );
  }
}
