/**
 * $ appcenter codepush patch --help

Update the metadata for an existing CodePush release

Usage: appcenter codepush patch [-r|--rollout <arg>] [-d|--description <arg>]
         [-t|--target-binary-version <arg>] [-x|--disabled] [-m|--mandatory]
         [-l|--existing-release-label <arg>] [-a|--app <arg>] <deployment-name>

Options:
    -r|--rollout <arg>                            Specifies percentage of users this release should be
                                                  immediately available to. (The specified number must be
                                                  an integer between 1 and 100)
    -d|--description <arg>                        Specifies description of the changes made to the app with
                                                  this release
    -t|--target-binary-version <arg>              Specifies binary app version(s) that specifies this
                                                  release is targeting for. (The value must be a semver
                                                  expression such as 1.1.0, ~1.2.3)
    -x|--disabled                                 Specifies whether this release should be immediately
                                                  downloadable. (Putting -x flag means disabled)
    -m|--mandatory                                Specifies whether this release should be considered
                                                  mandatory. (Putting -m flag means mandatory)
    -l|--existing-release-label <arg>             Specifies label of one existing release to update.
                                                  (Defaults to the latest release within the specified
                                                  deployment)
    -a|--app <arg>                                Specify app in the <ownerName>/<appName> format
    deployment-name                               Specifies one existing deployment name.

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

import { Flags } from '@oclif/core';

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
  editRolloutBranchMapping,
  getRolloutInfoFromBranchMapping,
  isRolloutBranchMapping,
} from '../../rollout/branch-mapping';
import { enableJsonOutput } from '../../utils/json';

export default class CodepushPatch extends EasCommand {
  static override hidden = true;
  static override description = 'update the metadata for the latest release on a deployment';

  static override args = [
    {
      name: 'name',
      required: true,
      description: 'Name of the codepush deployment to patch the latest release on',
    },
  ];

  static override flags = {
    rollout: Flags.integer({
      char: 'r',
      description: 'Percentage of users this release should be available to',
      required: false,
    }),
    disabled: Flags.boolean({
      char: 'x',
      description: 'Specifies whether this release should be immediately downloadable',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { rollout, disabled, json: jsonFlag, 'non-interactive': nonInteractive },
      args: { name: deploymentName },
    } = await this.parse(CodepushPatch);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushPatch, {
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
    const rolloutPercent = disabled ? 0 : rollout ?? 100;

    const existingBranchMappingString = channel.branchMapping;
    let updatedBranchMapping: BranchMapping;
    if (!existingBranchMappingString) {
      throw new Error(
        'No existing rollout on deployment. Publish an release with the `release-react` command.'
      );
    } else {
      const existingBranchMapping = getBranchMapping(existingBranchMappingString);
      if (isEmptyBranchMapping(existingBranchMapping)) {
        throw new Error(
          'No existing rollout on deployment. Publish an release with the `release-react` command.'
        );
      } else if (isAlwaysTrueBranchMapping(existingBranchMapping)) {
        throw new Error(
          'No existing rollout on deployment. Publish an release with the `release-react` command.'
        );
      } else if (isRolloutBranchMapping(existingBranchMapping)) {
        const rolloutInfo = getRolloutInfoFromBranchMapping(existingBranchMapping);
        const existingRolloutRolloutBranchId = rolloutInfo.rolledOutBranchId;
        updatedBranchMapping =
          rolloutPercent === 100
            ? getAlwaysTrueBranchMapping(existingRolloutRolloutBranchId)
            : editRolloutBranchMapping(existingBranchMapping, rolloutPercent);
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
