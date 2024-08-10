/**
 * $ appcenter codepush deployment history --help

Display the release history for a CodePush deployment

Usage: appcenter codepush deployment history [-a|--app <arg>] <deployment-name>

Options:
    -a|--app <arg>              Specify app in the <ownerName>/<appName> format
    deployment-name             Specifies CodePush deployment name to view history

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

import EasCommand from '../../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../../commandUtils/flags';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import Log from '../../../log';
import { printRollout } from '../../../rollout/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class CodepushDeploymentHistory extends EasCommand {
  static override hidden = true;
  static override description = 'get the release history for a deployment';

  static override args = [
    {
      name: 'name',
      required: true,
      description: 'Name of the deployment',
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
    } = await this.parse(CodepushDeploymentHistory);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushDeploymentHistory, {
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

    if (jsonFlag) {
      printJsonOnlyOutput(existingChannel);
    } else {
      Log.withTick(chalk`Deployment {bold ${existingChannel.name}} info:\n`);
      Log.addNewLineIfNone();
      printRollout(existingChannel);
      Log.warn('For formatted output, add the --json flag to your command.');
    }
  }
}
