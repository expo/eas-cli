import fs from 'fs-extra';
import * as path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { getSignedDeploymentUrlAsync } from '../../worker/deployment';
import { createTarOfFolderAsync } from '../../worker/pack';
import { uploadWorkerAsync } from '../../worker/upload';

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

    const distLocation = path.join(projectDir, 'dist');

    if (!(await fs.pathExists(distLocation))) {
      throw new Error(
        `No dist folder found in ${distLocation}. Prepare your project for deployment with "npx expo export"`
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
