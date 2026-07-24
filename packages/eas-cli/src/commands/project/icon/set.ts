import { Args } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { getProjectDashboardUrl } from '../../../build/utils/url';
import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../../commandUtils/flags';
import { AppUploadSessionType } from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import { uploadAppScopedFileAtPathToGCSAsync } from '../../../uploads';
import { sleepAsync } from '../../../utils/promise';

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // matches the upload session's GCS limit
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

export default class ProjectIconSet extends EasCommand {
  static override description = 'set the project icon displayed on the EAS dashboard';

  static override args = {
    path: Args.string({
      required: true,
      description: 'Path to the icon image (PNG or JPEG, at most 10 MB, ideally square)',
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

    await validateImageAsync(imagePath);

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

async function validateImageAsync(imagePath: string): Promise<void> {
  if (!(await fs.pathExists(imagePath))) {
    throw new Error(`No file found at ${imagePath}`);
  }
  const extension = path.extname(imagePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error(
      `Unsupported image format "${extension}". The icon must be a PNG or JPEG file.`
    );
  }
  const { size } = await fs.stat(imagePath);
  if (size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `The image is ${(size / 1024 / 1024).toFixed(1)} MB, but the maximum allowed size is 10 MB.`
    );
  }
}

async function pollForProfileImageChangeAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    previousProfileImageUrl,
    projectDashboardUrl,
  }: {
    projectId: string;
    previousProfileImageUrl: string | null;
    projectDashboardUrl: string;
  }
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleepAsync(POLL_INTERVAL_MS);
    const profileImageUrl = await AppQuery.byIdProfileImageUrlAsync(graphqlClient, projectId);
    if (profileImageUrl && profileImageUrl !== previousProfileImageUrl) {
      return;
    }
  }
  throw new Error(
    `Timed out waiting for the icon to be processed. It may still appear on the project page shortly: ${chalk.underline(
      projectDashboardUrl
    )}`
  );
}
