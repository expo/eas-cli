import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../../commandUtils/flags';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import Log from '../../../log';

export default class ProjectIconUnset extends EasCommand {
  static override description =
    'remove the project icon displayed on the EAS dashboard (requires the Admin role)';

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ProjectIconUnset);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectIconUnset, {
      nonInteractive: flags['non-interactive'],
    });

    const { fullName } = await AppMutation.removeProfileImageAsync(graphqlClient, projectId);
    Log.withTick(`Removed the icon for ${chalk.bold(fullName)}`);
  }
}
