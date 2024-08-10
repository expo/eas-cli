/**
 * $ appcenter codepush deployment clear --help

Clear the release history associated with a deployment

Usage: appcenter codepush deployment clear [-a|--app <arg>] <deployment-name>

Options:
    -a|--app <arg>              Specify app in the <ownerName>/<appName> format
    deployment-name             Specifies CodePush deployment name to be cleared

Common Options (works on all commands):
       --disable-telemetry             Disable telemetry for this command
    -v|--version                       Display appcenter version
       --quiet                         Auto-confirm any prompts without waiting for input
    -h|--help                          Display help for current command
       --env <arg>                     Environment when using API token
       --token <arg>                   API token
       --output <arg>                  Output format: json
       --debug                         Display extra output for debugging
 */

import chalk from 'chalk';

import { getEmptyBranchMapping } from '../../../channel/branch-mapping';
import { updateChannelBranchMappingAsync } from '../../../channel/queries';
import EasCommand from '../../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../../commandUtils/flags';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class CodepushDeploymentClear extends EasCommand {
  static override hidden = true;
  static override description = 'clear a deployment';

  static override args = [
    {
      name: 'name',
      required: true,
      description: 'Name of the deployment to clear',
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
    } = await this.parse(CodepushDeploymentClear);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushDeploymentClear, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!deploymentName) {
      throw new Error('Deployment name may not be empty.');
    }

    const existingChannel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: deploymentName,
    });

    const channel = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: existingChannel.id,
      branchMapping: JSON.stringify(getEmptyBranchMapping()),
    });

    if (jsonFlag) {
      printJsonOnlyOutput(channel);
    } else {
      Log.withTick(chalk`Deployment {bold ${channel.name}} is now cleared.\n`);
      Log.addNewLineIfNone();
      Log.log(
        chalk`Users with builds on deployment {bold ${channel.name}} will no longer have an available update.`
      );
    }
  }
}
