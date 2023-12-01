import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { easJsonExistsAsync } from '../../build/configure';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import Log, { learnMore } from '../../log';
import { RequestedPlatform } from '../../platform';
import {
  ensureEASUpdateIsConfiguredAsync,
  ensureEASUpdateIsConfiguredInEasJsonAsync,
} from '../../update/configure';

const PLATFORM_FLAG_OPTIONS = ['android', 'ios', 'all'];

export default class UpdateConfigure extends EasCommand {
  static override description = 'configure the project to support EAS Update';

  static override flags = {
    platform: Flags.string({
      description: 'Platform to configure',
      char: 'p',
      options: PLATFORM_FLAG_OPTIONS,
      default: 'all',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateConfigure);
    const platform = flags.platform as RequestedPlatform;
    const {
      privateProjectConfig: { projectId, exp, projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(UpdateConfigure, {
      nonInteractive: flags['non-interactive'],
    });

    Log.log(
      '💡 The following process will configure your project to use EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    await vcsClient.ensureRepoExistsAsync();

    await ensureEASUpdateIsConfiguredAsync(graphqlClient, {
      exp,
      projectId,
      projectDir,
      platform,
      vcsClient,
    });

    await ensureEASUpdateIsConfiguredInEasJsonAsync(projectDir);

    Log.addNewLineIfNone();
    Log.log(`🎉 Your app is configured to use EAS Update!`);
    Log.newLine();
    const easJsonExists = await easJsonExistsAsync(projectDir);
    if (!easJsonExists) {
      Log.log(`- Run ${chalk.bold('eas build:configure')} to complete your installation`);
    }
    Log.log(
      `- ${learnMore('https://docs.expo.dev/eas-update/introduction/', {
        learnMoreMessage: 'Learn more about other capabilities of EAS Update',
      })}`
    );
  }
}
