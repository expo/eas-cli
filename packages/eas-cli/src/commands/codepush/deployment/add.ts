/**
 * $ appcenter codepush deployment add --help

Add a new deployment to an app

Usage: appcenter codepush deployment add [-a|--app <arg>] <new-deployment-name>

Options:
    new-deployment-name             New CodePush deployment name
 */

import chalk from 'chalk';

import { createChannelOnAppWithNoBranchAsync } from '../../../channel/queries';
import EasCommand from '../../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../../commandUtils/flags';
import Log from '../../../log';
import { getDisplayNameForProjectIdAsync } from '../../../project/projectUtils';
import formatFields from '../../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class CodepushDeploymentAdd extends EasCommand {
  static override hidden = true;
  static override description = 'create a deployment';

  static override args = [
    {
      name: 'name',
      required: true,
      description: 'Name of the deployment to create',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { name: deploymentName },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(CodepushDeploymentAdd);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushDeploymentAdd, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!deploymentName) {
      throw new Error('Deployment name may not be empty.');
    }

    const createChannelResult = await createChannelOnAppWithNoBranchAsync(graphqlClient, {
      appId: projectId,
      channelName: deploymentName,
    });

    const newChannel = createChannelResult.updateChannel.createUpdateChannelForApp;

    if (jsonFlag) {
      printJsonOnlyOutput(newChannel);
    } else {
      Log.addNewLineIfNone();
      Log.withTick(
        `Created a new deployment on project ${chalk.bold(
          await getDisplayNameForProjectIdAsync(graphqlClient, projectId)
        )}`
      );
      Log.log(
        formatFields([
          { label: 'Name', value: newChannel.name },
          { label: 'ID', value: newChannel.id },
        ])
      );
    }
  }
}
