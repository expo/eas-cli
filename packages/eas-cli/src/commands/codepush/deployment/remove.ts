/**
 * $ appcenter codepush deployment remove --help

Remove CodePush deployment

Usage: appcenter codepush deployment remove [-a|--app <arg>] <deployment-name>

Options:
    -a|--app <arg>              Specify app in the <ownerName>/<appName> format
    deployment-name             Specifies CodePush deployment name to be removed

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

import { deleteChannelOnAppAsync } from '../../../channel/queries';
import EasCommand from '../../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../../commandUtils/flags';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class CodepushDeploymentRemove extends EasCommand {
  static override hidden = true;
  static override description = 'Delete a deployment';

  static override args = [
    {
      name: 'name',
      required: true,
      description: 'Name of the deployment to delete',
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
    } = await this.parse(CodepushDeploymentRemove);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushDeploymentRemove, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!deploymentName) {
      throw new Error('Deployment name may not be empty.');
    }

    const { id: channelId, name: channelName } = await ChannelQuery.viewUpdateChannelAsync(
      graphqlClient,
      {
        appId: projectId,
        channelName: deploymentName,
      }
    );

    const deletionResult = await deleteChannelOnAppAsync(graphqlClient, {
      channelId,
    });

    if (jsonFlag) {
      printJsonOnlyOutput(deletionResult);
    } else {
      Log.withTick(`Deleted deployment "${channelName}".`);
    }
  }
}
