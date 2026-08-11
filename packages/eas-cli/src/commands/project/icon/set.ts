import { Args } from '@oclif/core';
import chalk from 'chalk';

import { getProjectDashboardUrl } from '../../../build/utils/url';
import EasCommand from '../../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../../commandUtils/flags';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import {
  pollForProfileImageChangeAsync,
  uploadProjectIconAsync,
  validateIconAsync,
} from '../../../project/projectIcon';

export default class ProjectIconSet extends EasCommand {
  static override description = 'set the project icon displayed on the EAS dashboard';

  static override args = {
    path: Args.string({
      required: true,
      description:
        'Path to the icon image (PNG or JPEG, at most 10 MB). Non-square images are center-cropped to a square.',
    }),
  };

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { path: imagePath },
      flags,
    } = await this.parse(ProjectIconSet);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectIconSet, {
      nonInteractive: flags['non-interactive'],
    });

    await validateIconAsync(imagePath);

    const app = await AppQuery.byIdAsync(graphqlClient, projectId);
    const projectDashboardUrl = getProjectDashboardUrl(app.ownerAccount.name, app.slug);
    const previousProfileImageUrl = await AppQuery.byIdProfileImageUrlAsync(
      graphqlClient,
      projectId
    );

    const spinner = ora('Uploading project icon').start();
    try {
      await uploadProjectIconAsync(graphqlClient, { projectId, imagePath });

      // The icon is processed asynchronously (resized and assigned to the
      // project by the server), so poll until the icon URL changes.
      spinner.text = 'Processing project icon';
      await pollForProfileImageChangeAsync(graphqlClient, {
        projectId,
        previousProfileImageUrl,
        projectDashboardUrl,
      });
      spinner.succeed(`Set icon for ${chalk.bold(app.fullName)}`);
      Log.withTick(`View it on the project page: ${link(projectDashboardUrl)}`);
    } catch (error) {
      spinner.fail('Failed to set project icon');
      throw error;
    }
  }
}
