import fs from 'node:fs/promises';
import * as path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { getSignedDeploymentUrlAsync } from '../../worker/deployment';
import { createTarOfFolderAsync } from '../../worker/pack';
import { uploadWorkerAsync } from '../../worker/upload';

const isDirectory = (directoryPath: string): Promise<boolean> =>
  fs.stat(directoryPath)
    .then((stat) => stat.isDirectory())
    .catch(() => false);

export default class WorkerDeploy extends EasCommand {
  static override description = 'deploy an Expo web build';
  static override aliases = ['deploy'];

  static override flags = {
    // TODO: Allow deployment identifier to be specified
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Worker Deployments are in beta and subject to breaking changes.');

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(WorkerDeploy, {
      nonInteractive: true,
    });

    const distLocation = path.resolve(projectDir, 'dist');
    if (!(await isDirectory(distLocation))) {
      throw new Error(
        `No "dist/" folder found at ${distLocation}. Prepare your project for deployment with "npx expo export"`
      );
    } else if (
      !(await isDirectory(path.join(distLocation, 'server'))) ||
      !(await isDirectory(path.join(distLocation, 'client')))
    ) {
      throw new Error(
        `No "dist/server/" folder found in ${distLocation}. Ensure the app.json key "expo.web.output" is set to "server"`
      );
    }

    // TODO: Create manifest from user configuration
    const manifest = { env: {} };
    const tar = await createTarOfFolderAsync(distLocation, manifest);

    const uploadUrl = await getSignedDeploymentUrlAsync(graphqlClient, exp, {
      appId: projectId,
    });

    const result = await uploadWorkerAsync(uploadUrl, tar);

    Log.addNewLineIfNone();

    // TODO(Kadi): read url from api reponse
    Log.log(
      `🎉 Your worker deployment is ready. (https://${result.fullName}.${
        process.env.EXPO_STAGING ? 'staging.' : ''
      }expo.app)`
    );
  }
}
