/**
 * $ appcenter codepush rollback --help

Rollback a deployment to a previous release

Usage: appcenter codepush rollback [--target-release <arg>] [-a|--app <arg>] <deployment-name>

Options:
       --target-release <arg>             Specifies the release label to be rolled back
    -a|--app <arg>                        Specify app in the <ownerName>/<appName> format
    deployment-name                       Specifies deployment name to be rolled back

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

import {
  BranchMapping,
  getAlwaysTrueBranchMapping,
  getBranchMapping,
  isAlwaysTrueBranchMapping,
  isEmptyBranchMapping,
} from '../../channel/branch-mapping';
import { updateChannelBranchMappingAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import {
  getRolloutInfoFromBranchMapping,
  isRolloutBranchMapping,
} from '../../rollout/branch-mapping';
import { enableJsonOutput } from '../../utils/json';

export default class CodepushRollback extends EasCommand {
  static override hidden = true;
  static override description = 'roll back a rollout on a deployment';

  static override args = [
    {
      name: 'name',
      required: true,
      description: 'Name of the codepush deployment to roll back the current rollout on',
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
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
      args: { name: deploymentName },
    } = await this.parse(CodepushRollback);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushRollback, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!deploymentName) {
      throw new Error('Deployment name may not be empty.');
    }

    const channel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: deploymentName,
    });

    // set channel rollout

    const existingBranchMappingString = channel.branchMapping;
    let updatedBranchMapping: BranchMapping;
    if (!existingBranchMappingString) {
      throw new Error('No existing rollout on deployment.');
    } else {
      const existingBranchMapping = getBranchMapping(existingBranchMappingString);
      if (isEmptyBranchMapping(existingBranchMapping)) {
        throw new Error('No existing rollout on deployment.');
      } else if (isAlwaysTrueBranchMapping(existingBranchMapping)) {
        throw new Error('No existing rollout on deployment.');
      } else if (isRolloutBranchMapping(existingBranchMapping)) {
        const rolloutInfo = getRolloutInfoFromBranchMapping(existingBranchMapping);
        const existingRolloutDefaultBranchId = rolloutInfo.defaultBranchId;
        updatedBranchMapping = getAlwaysTrueBranchMapping(existingRolloutDefaultBranchId);
      } else {
        throw new Error('Unrecognized custom deployment structure');
      }
    }

    const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: channel.id,
      branchMapping: JSON.stringify(updatedBranchMapping),
    });

    Log.addNewLineIfNone();
    Log.log(`✅ Successfuly updated rollout on ${newChannelInfo.name}`);
  }
}
