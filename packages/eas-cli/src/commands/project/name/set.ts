import { Args } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../../commandUtils/flags';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import Log from '../../../log';
import { getPrivateExpoConfigAsync } from '../../../project/expoConfig';

export default class ProjectNameSet extends EasCommand {
  static override description =
    'set the project display name shown on the EAS dashboard (does not change the slug)';

  static override args = {
    name: Args.string({
      description: 'Display name, at most 255 characters. Defaults to the name in the app config.',
    }),
  };

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { name: nameArgument },
      flags,
    } = await this.parse(ProjectNameSet);
    const {
      projectId,
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectNameSet, {
      nonInteractive: flags['non-interactive'],
    });

    const displayName = (nameArgument ?? (await getPrivateExpoConfigAsync(projectDir)).name).trim();
    if (!displayName) {
      throw new Error('The display name cannot be blank.');
    }

    const app = await AppMutation.setDisplayNameAsync(graphqlClient, {
      appId: projectId,
      displayName,
    });
    Log.withTick(`Set the display name of ${chalk.bold(app.fullName)} to ${chalk.bold(app.name)}`);
  }
}
