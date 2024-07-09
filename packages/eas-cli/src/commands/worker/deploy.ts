import * as path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { DeploymentsMutation } from '../../worker/mutations';
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
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(WorkerDeploy, {
      nonInteractive: true,
    });

    // TODO: Create manifest from user configuration
    const manifest = { env: {} };
    const tar = await createTarOfFolderAsync(path.join(projectDir, 'dist'), manifest);

    const uploadUrl = await DeploymentsMutation.createSignedDeploymentUrlAsync(graphqlClient, {
      appId: projectId,
    });

    const result = await uploadWorkerAsync(uploadUrl, tar);

    Log.addNewLineIfNone();
    Log.log(`🎉 Your worker deployment is ready. (https://${result.fullName}.expo.app)`);
  }
}
