import { Args } from '@oclif/core';
import chalk from 'chalk';

import { getProjectDashboardUrl } from '../../../build/utils/url';
import EasCommand from '../../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../../commandUtils/flags';
import { AppUploadSessionType } from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import { uploadAppScopedFileAtPathToGCSAsync } from '../../../uploads';
import {
  pollForProfileImageChangeAsync,
  validateProfileImageAsync,
} from '../../../utils/profileImages';

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

    await validateProfileImageAsync(imagePath);

    const app = await AppQuery.byIdAsync(graphqlClient, projectId);
    const projectDashboardUrl = getProjectDashboardUrl(app.ownerAccount.name, app.slug);
    const previousProfileImageUrl = await AppQuery.byIdProfileImageUrlAsync(
      graphqlClient,
      projectId
    );

    const spinner = ora('Uploading project icon').start();
    try {
      await uploadAppScopedFileAtPathToGCSAsync(graphqlClient, {
        type: AppUploadSessionType.ProfileImageUpload,
        appId: projectId,
        path: imagePath,
      });

      spinner.text = 'Processing project icon';
      await pollForProfileImageChangeAsync({
        fetchProfileImageUrlAsync: async () =>
          await AppQuery.byIdProfileImageUrlAsync(graphqlClient, projectId),
        previousProfileImageUrl,
        fallbackUrl: projectDashboardUrl,
      });
      spinner.succeed(`Set icon for ${chalk.bold(app.fullName)}`);
      Log.withTick(`View it on the project page: ${link(projectDashboardUrl)}`);
    } catch (error) {
      spinner.fail('Failed to set project icon');
      throw error;
    }
  }
}
