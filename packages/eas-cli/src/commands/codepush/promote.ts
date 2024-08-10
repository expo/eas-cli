/**
 * $ appcenter codepush promote --help

Create a new release for the destination deployment, which includes the exact code and metadata from the latest release of the source deployment

Usage: appcenter codepush promote -s|--source-deployment-name <arg> -d|--destination-deployment-name <arg>
         [-t|--target-binary-version <arg>] [-r|--rollout <arg>] [--disable-duplicate-release-error]
         [-x|--disabled] [-m|--mandatory] [-l|--label <arg>] [--description <arg>] [-a|--app <arg>]

Options:
    -s|--source-deployment-name <arg>                  Specifies source deployment name
    -d|--destination-deployment-name <arg>             Specifies destination deployment name
    -t|--target-binary-version <arg>                   Specifies binary app version(s) that specifies this
                                                       release is targeting for. (The value must be a
                                                       semver expression such as 1.1.0, ~1.2.3)
    -r|--rollout <arg>                                 Specifies percentage of users this release should be
                                                       immediately available to. (The specified number must
                                                       be an integer between 1 and 100)
       --disable-duplicate-release-error               Specifies that if the update is identical to the
                                                       latest release on the deployment, the CLI should
                                                       generate a warning instead of an error
    -x|--disabled                                      Specifies whether this release should be immediately
                                                       downloadable. (Putting -x flag means disabled)
    -m|--mandatory                                     Specifies whether this release should be considered
                                                       mandatory. (Putting -m flag means mandatory)
    -l|--label <arg>                                   Allows you to pick the specified label from the
                                                       source deployment and promote it to the destination
                                                       deployment
       --description <arg>                             Specifies description of the changes made to the app
                                                       with this release
    -a|--app <arg>                                     Specify app in the <ownerName>/<appName> format

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
import nullthrows from 'nullthrows';

import { createUpdateBranchOnAppAsync } from '../../branch/queries';
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
  createRolloutBranchMapping,
  getRolloutInfoFromBranchMapping,
  isRolloutBranchMapping,
} from '../../rollout/branch-mapping';
import { republishAsync } from '../../update/republish';
import { getCodeSigningInfoAsync } from '../../utils/code-signing';
import { enableJsonOutput } from '../../utils/json';

export default class CodepushPromote extends EasCommand {
  static override hidden = true;
  static override description =
    'republish latest release from source deployment to destination deployment';

  static override flags = {
    sourceDeploymentName: Flags.string({
      char: 's',
      description: 'Source deployment',
      required: true,
    }),
    destinationDeploymentName: Flags.string({
      char: 'd',
      description: 'Destination deployment',
      required: true,
    }),
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
    'private-key-path': Flags.string({
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory. Only relevant if you are using code signing: https://docs.expo.dev/eas-update/code-signing/`,
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
      flags: {
        sourceDeploymentName,
        destinationDeploymentName,
        rollout,
        disabled,
        'private-key-path': privateKeyPath,
        json: jsonFlag,
        'non-interactive': nonInteractive,
      },
    } = await this.parse(CodepushPromote);
    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(CodepushPromote, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!sourceDeploymentName) {
      throw new Error('Source deployment name may not be empty.');
    }

    if (!destinationDeploymentName) {
      throw new Error('Source deployment name may not be empty.');
    }

    const [sourceChannel, destinationChannel] = await Promise.all([
      ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
        appId: projectId,
        channelName: sourceDeploymentName,
      }),
      ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
        appId: projectId,
        channelName: destinationDeploymentName,
      }),
    ]);

    const sourceBranchMappingString = sourceChannel.branchMapping;
    let latestBranchIdOnSourceChannel: string;
    if (!sourceBranchMappingString) {
      throw new Error(
        'No releases on source deployment. Publish an release with the `release-react` command.'
      );
    } else {
      const existingBranchMapping = getBranchMapping(sourceBranchMappingString);
      if (isEmptyBranchMapping(existingBranchMapping)) {
        throw new Error(
          'No releases on source deployment. Publish an update with the `release-react` command.'
        );
      } else if (isAlwaysTrueBranchMapping(existingBranchMapping)) {
        latestBranchIdOnSourceChannel = existingBranchMapping.data[0].branchId;
      } else if (isRolloutBranchMapping(existingBranchMapping)) {
        const rolloutInfo = getRolloutInfoFromBranchMapping(existingBranchMapping);
        latestBranchIdOnSourceChannel = rolloutInfo.rolledOutBranchId;
      } else {
        throw new Error('Unrecognized custom deployment structure');
      }
    }

    const latestBranchOnSourceChannel = nullthrows(
      sourceChannel.updateBranches.find(b => b.id === latestBranchIdOnSourceChannel)
    );

    // republish latest updates from source branch to new destination branch
    const createdBranch = await createUpdateBranchOnAppAsync(graphqlClient, {
      appId: projectId,
      name: latestBranchOnSourceChannel.name, // maybe change name
    });

    const updateGroupToRepublish = latestBranchOnSourceChannel.updateGroups[0];
    const codeSigningInfo = await getCodeSigningInfoAsync(exp, privateKeyPath ?? undefined);
    const arbitraryUpdate = updateGroupToRepublish[0];
    const { message: oldUpdateMessage, group: oldGroupId } = arbitraryUpdate;
    const newUpdateMessage = `Republish "${oldUpdateMessage!}" - group: ${oldGroupId}`;
    await republishAsync({
      graphqlClient,
      app: {
        projectId,
        exp,
      },
      updatesToPublish: updateGroupToRepublish.map(update => ({
        ...update,
        groupId: update.group,
        branchId: update.branch.id,
        branchName: update.branch.name,
      })),
      codeSigningInfo,
      targetBranch: { branchId: createdBranch.id, branchName: createdBranch.name },
      updateMessage: newUpdateMessage,
    });

    // set destination channel rollout
    const destinationRolloutPercent = disabled ? 0 : rollout ?? 100;

    const destinationBranchMappingString = destinationChannel.branchMapping;
    let updatedBranchMapping: BranchMapping;
    if (!destinationBranchMappingString) {
      if (destinationRolloutPercent !== 100) {
        throw new Error('Cannot roll out first release on deployment'); // TODO(wschurman): this needs to be possible
      }
      updatedBranchMapping = getAlwaysTrueBranchMapping(createdBranch.id);
    } else {
      const existingBranchMapping = getBranchMapping(destinationBranchMappingString);
      if (isEmptyBranchMapping(existingBranchMapping)) {
        if (destinationRolloutPercent !== 100) {
          throw new Error('Cannot roll out first release on deployment'); // TODO(wschurman): this needs to be possible
        }
        updatedBranchMapping = getAlwaysTrueBranchMapping(createdBranch.id);
      } else if (isAlwaysTrueBranchMapping(existingBranchMapping)) {
        const existingDestinationBranchId = existingBranchMapping.data[0].branchId;
        updatedBranchMapping =
          destinationRolloutPercent === 100
            ? getAlwaysTrueBranchMapping(existingDestinationBranchId)
            : createRolloutBranchMapping({
                defaultBranchId: existingBranchMapping.data[0].branchId,
                rolloutBranchId: createdBranch.id,
                runtimeVersion: arbitraryUpdate.runtimeVersion,
                percent: destinationRolloutPercent,
              });
      } else if (isRolloutBranchMapping(existingBranchMapping)) {
        if (destinationRolloutPercent !== 100) {
          throw new Error(
            'Cannot roll out first release on deployment that already has a roll out in progress'
          ); // TODO(wschurman): handle runtime versions (only check for roll out for runtime version)
        }
        updatedBranchMapping = getAlwaysTrueBranchMapping(createdBranch.id);
      } else {
        throw new Error('Unrecognized custom deployment structure');
      }
    }

    const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: destinationChannel.id,
      branchMapping: JSON.stringify(updatedBranchMapping),
    });

    Log.addNewLineIfNone();
    Log.log(`✅ Successfuly updated rollout on ${newChannelInfo.name}`);
  }
}
