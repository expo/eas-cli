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
  resolveAppConfigIconAsync,
  uploadProjectIconAsync,
  validateIconAsync,
} from '../../../project/projectIcon';

export default class ProjectIconSet extends EasCommand {
  static override description =
    'set the project icon displayed on the EAS dashboard (requires the Admin role)';

  static override args = {
    path: Args.string({
      description:
        'Path to the icon image (PNG or JPEG, at most 10 MB). The image is resized to a 1024x1024 PNG, and a non-square image is center-cropped. Defaults to the icon in the app config.',
      ignoreStdin: true,
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
      args: { path: pathArgument },
      flags,
    } = await this.parse(ProjectIconSet);
    const {
      projectId,
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectIconSet, {
      nonInteractive: flags['non-interactive'],
    });

    const imagePath = pathArgument ?? (await getAppConfigIconPathAsync(projectDir));
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

async function getAppConfigIconPathAsync(projectDir: string): Promise<string> {
  const icon = await resolveAppConfigIconAsync(projectDir);
  if (!icon) {
    throw new Error(
      'No local icon found in the app config (icon, ios.icon or android.adaptiveIcon.foregroundImage). Pass the path to an image instead.'
    );
  }
  Log.log(`Using "${icon.field}" from your app config: ${icon.path}`);
  return icon.path;
}
