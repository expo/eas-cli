import { ExpoConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log, { learnMore } from '../../log';
import { enforceRollBackToEmbeddedUpdateSupportAsync } from '../../project/projectUtils';
import { getUpdateMessageForCommandAsync } from '../../project/publish';
import { confirmAsync, promptAsync } from '../../prompts';
import { scheduleUpdateGroupDeletionAsync } from '../../update/delete';
import {
  UpdateToRepublish,
  askUpdateGroupForEachPublishPlatformFilteringByRuntimeVersionAsync,
  getOrAskUpdateMessageAsync,
  getUpdateGroupAsync,
  republishAsync,
} from '../../update/republish';
import { publishRollBackToEmbeddedUpdateAsync } from '../../update/roll-back-to-embedded';
import { UpdatePublishPlatform } from '../../update/utils';
import { CodeSigningInfo, getCodeSigningInfoAsync } from '../../utils/code-signing';
import { enableJsonOutput } from '../../utils/json';
import { pollForBackgroundJobReceiptAsync } from '../../utils/pollForBackgroundJobReceiptAsync';
import { Client } from '../../vcs/vcs';

type RolloutUpdate = UpdateToRepublish & {
  rolloutPercentage: NonNullable<UpdateToRepublish['rolloutPercentage']>;
};

type RolloutUpdateWithControlUpdate = RolloutUpdate & {
  rolloutControlUpdate: NonNullable<UpdateToRepublish['rolloutControlUpdate']>;
};

type UpdateRevertUpdateRolloutRawFlags = {
  branch?: string;
  channel?: string;
  group?: string;
  message?: string;
  'private-key-path'?: string;
  'non-interactive': boolean;
  json?: boolean;
};

type UpdateRevertUpdateRolloutFlags = {
  branchName?: string;
  channelName?: string;
  groupId?: string;
  updateMessage?: string;
  privateKeyPath?: string;
  nonInteractive: boolean;
  json: boolean;
};

export function nonNullish<TValue>(value: TValue | null | undefined): value is NonNullable<TValue> {
  return value !== null && value !== undefined;
}

export default class UpdateRevertUpdateRollout extends EasCommand {
  static override description = 'revert a rollout update for a project';

  static override flags = {
    channel: Flags.string({
      description: 'Channel name to select an update group to revert the rollout update from',
      exclusive: ['branch', 'group'],
    }),
    branch: Flags.string({
      description: 'Branch name to select an update group to revert the rollout update from',
      exclusive: ['channel', 'group'],
    }),
    group: Flags.string({
      description: 'Rollout update group ID to revert',
      exclusive: ['branch', 'channel'],
    }),
    message: Flags.string({
      char: 'm',
      description: 'Short message describing the revert',
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
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(UpdateRevertUpdateRollout);
    const flags = this.sanitizeFlags(rawFlags);

    const {
      privateProjectConfig: { exp, projectId, projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(UpdateRevertUpdateRollout, {
      nonInteractive: flags.nonInteractive,
      withServerSideEnvironment: null,
    });

    if (flags.json) {
      enableJsonOutput();
    }

    const codeSigningInfo = await getCodeSigningInfoAsync(exp, flags.privateKeyPath);

    let updateGroupToRepublish: RolloutUpdate[];
    if (flags.groupId) {
      const updateGroup = await getUpdateGroupAsync(graphqlClient, flags.groupId);
      if (!updateGroupIsRolloutUpdateGroup(updateGroup)) {
        throw new Error(
          `The update group with ID "${flags.groupId}" is not a rollout update group.`
        );
      }
      updateGroupToRepublish = updateGroup;
    } else {
      const latestUpdateGroupForEachPublishPlatform =
        await askUpdateGroupForEachPublishPlatformFilteringByRuntimeVersionAsync(
          graphqlClient,
          projectId,
          flags
        );

      const uniqueUpdateGroups = getUniqueUpdateGroups(
        Object.values(latestUpdateGroupForEachPublishPlatform).filter(nonNullish)
      );

      const rolloutUpdateGroups = uniqueUpdateGroups.filter(updateGroupIsRolloutUpdateGroup);

      if (rolloutUpdateGroups.length === 0) {
        throw new Error(`No rollout update groups found.`);
      }

      if (rolloutUpdateGroups.length === 1) {
        updateGroupToRepublish = rolloutUpdateGroups[0];
      } else {
        const { choice: chosenId } = await promptAsync({
          type: 'select',
          message: 'Which rollout update group would you like to revert?',
          name: 'choice',
          choices: rolloutUpdateGroups.map(ug => ({
            title: `Rollout update group ID: ${ug[0].groupId}, Platform: ${ug[0].platform}, Rollout Percentage: ${ug[0].rolloutPercentage}`,
            value: ug[0].groupId,
          })),
        });

        if (!chosenId) {
          throw new Error('No rollout update group selected.');
        }

        const chosenUpdateGroup = rolloutUpdateGroups.find(ug => ug[0].groupId === chosenId);

        if (!chosenUpdateGroup) {
          throw new Error('No rollout update group selected.');
        }

        updateGroupToRepublish = chosenUpdateGroup;
      }
    }

    const rolloutUpdateGroupWithControlUpdates: RolloutUpdateWithControlUpdate[] | null =
      updateGroupIsUpdateGroupWithControlUpdate(updateGroupToRepublish)
        ? updateGroupToRepublish
        : null;
    if (rolloutUpdateGroupWithControlUpdates) {
      await this.deleteRolloutUpdateGroupAndRepublishControlUpdatesAsync({
        graphqlClient,
        exp,
        projectId,
        rolloutUpdateGroupWithControlUpdates,
        codeSigningInfo,
        flags,
      });
    } else {
      await this.deleteRolloutUpdateGroupAndPublishRollBackToEmbeddedAsync({
        graphqlClient,
        vcsClient,
        exp,
        projectDir,
        projectId,
        rolloutUpdateGroup: updateGroupToRepublish,
        codeSigningInfo,
        flags,
      });
    }
  }

  private async deleteRolloutUpdateGroupAndRepublishControlUpdatesAsync({
    graphqlClient,
    exp,
    projectId,
    rolloutUpdateGroupWithControlUpdates,
    codeSigningInfo,
    flags,
  }: {
    graphqlClient: ExpoGraphqlClient;
    exp: ExpoConfig;
    projectId: string;
    rolloutUpdateGroupWithControlUpdates: RolloutUpdateWithControlUpdate[];
    codeSigningInfo: CodeSigningInfo | undefined;
    flags: UpdateRevertUpdateRolloutFlags;
  }): Promise<void> {
    const controlUpdateGroupIdsToRepublish = Array.from(
      new Set(rolloutUpdateGroupWithControlUpdates.map(update => update.rolloutControlUpdate.group))
    );

    const updateGroupsToRepublish = await Promise.all(
      controlUpdateGroupIdsToRepublish.map(controlUpdateGroupIdToRepublish =>
        getUpdateGroupAsync(graphqlClient, controlUpdateGroupIdToRepublish)
      )
    );

    const updateGroupOrGroupsClause =
      controlUpdateGroupIdsToRepublish.length > 1
        ? `control update groups (IDs: ${controlUpdateGroupIdsToRepublish
            .map(id => `"${id}"`)
            .join(', ')})`
        : `control update group (ID: "${controlUpdateGroupIdsToRepublish[0]}")`;

    if (!flags.nonInteractive) {
      const confirmMessage = `Are you sure you want to revert the rollout update group with ID "${rolloutUpdateGroupWithControlUpdates[0].groupId}"? This will delete the rollout update group and republish the ${updateGroupOrGroupsClause}.`;
      const didConfirm = await confirmAsync({ message: confirmMessage });
      if (!didConfirm) {
        throw new Error('Aborting...');
      }
    }

    const updateMessages: string[] = [];
    for (const updateGroup of updateGroupsToRepublish) {
      updateMessages.push(await getOrAskUpdateMessageAsync(updateGroup, flags));
    }

    // assert all updateGroupsToRepublish have the same branch name and id
    const branchNames = updateGroupsToRepublish.flatMap(updateGroup => updateGroup[0].branchName);
    const branchIds = updateGroupsToRepublish.map(updateGroup => updateGroup[0].branchId);
    assert(
      branchNames.every(name => name === branchNames[0]),
      'All update groups being republished must belong to the same branch.'
    );
    assert(
      branchIds.every(id => id === branchIds[0]),
      'All update groups being republished must belong to the same branch.'
    );
    const targetBranch = {
      branchName: branchNames[0],
      branchId: branchIds[0],
    };

    await this.deleteRolloutUpdateGroupAsync({
      graphqlClient,
      rolloutUpdateGroup: rolloutUpdateGroupWithControlUpdates,
    });

    for (let i = 0; i < updateGroupsToRepublish.length; i++) {
      const updateGroupToRepublish = updateGroupsToRepublish[i];
      const updateMessage = updateMessages[i];

      await republishAsync({
        graphqlClient,
        app: { exp, projectId },
        updatesToPublish: updateGroupToRepublish,
        targetBranch,
        updateMessage,
        codeSigningInfo,
        json: flags.json,
      });
    }
  }

  private async deleteRolloutUpdateGroupAndPublishRollBackToEmbeddedAsync({
    graphqlClient,
    vcsClient,
    exp,
    projectDir,
    projectId,
    rolloutUpdateGroup,
    codeSigningInfo,
    flags,
  }: {
    graphqlClient: ExpoGraphqlClient;
    vcsClient: Client;
    exp: ExpoConfig;
    projectDir: string;
    projectId: string;
    rolloutUpdateGroup: RolloutUpdate[];
    codeSigningInfo: CodeSigningInfo | undefined;
    flags: UpdateRevertUpdateRolloutFlags;
  }): Promise<void> {
    const rolloutUpdateGroupId = rolloutUpdateGroup[0].groupId;

    if (!flags.nonInteractive) {
      const confirmMessage = `Are you sure you want to revert the rollout update group with ID "${rolloutUpdateGroupId}"? This will delete the rollout update group and publish a new roll-back-to-embedded update (no control update to roll back to), whose behavior may not be a true revert depending on the previous state of the branch. ${learnMore(
        'https://expo.fyi/eas-update-update-rollouts',
        { learnMoreMessage: 'More info' }
      )})`;
      const didConfirm = await confirmAsync({ message: confirmMessage });
      if (!didConfirm) {
        throw new Error('Aborting...');
      }
    }

    // check that the expo-updates package version supports roll back to embedded
    await enforceRollBackToEmbeddedUpdateSupportAsync(projectDir);
    const updateMessage = await getUpdateMessageForCommandAsync(vcsClient, {
      updateMessageArg: flags.updateMessage,
      autoFlag: false,
      nonInteractive: flags.nonInteractive,
      jsonFlag: flags.json,
    });

    await this.deleteRolloutUpdateGroupAsync({
      graphqlClient,
      rolloutUpdateGroup,
    });

    const platforms = rolloutUpdateGroup.map(update => update.platform) as UpdatePublishPlatform[];
    const runtimeVersion = rolloutUpdateGroup[0].runtimeVersion;
    const targetBranch = {
      name: rolloutUpdateGroup[0].branchName,
      id: rolloutUpdateGroup[0].branchId,
    };

    await publishRollBackToEmbeddedUpdateAsync({
      graphqlClient,
      projectId,
      exp,
      updateMessage,
      branch: targetBranch,
      codeSigningInfo,
      platforms,
      runtimeVersion,
      json: flags.json,
    });
  }

  private async deleteRolloutUpdateGroupAsync({
    graphqlClient,
    rolloutUpdateGroup,
  }: {
    graphqlClient: ExpoGraphqlClient;
    rolloutUpdateGroup: RolloutUpdate[];
  }): Promise<void> {
    const rolloutUpdateGroupId = rolloutUpdateGroup[0].groupId;

    const updateGroupDeletionReceipt = await scheduleUpdateGroupDeletionAsync(graphqlClient, {
      group: rolloutUpdateGroupId,
    });
    const successfulReceipt = await pollForBackgroundJobReceiptAsync(
      graphqlClient,
      updateGroupDeletionReceipt
    );
    Log.debug('Rollout update group deletion result', { successfulReceipt });
  }

  private sanitizeFlags(
    rawFlags: UpdateRevertUpdateRolloutRawFlags
  ): UpdateRevertUpdateRolloutFlags {
    const branchName = rawFlags.branch;
    const channelName = rawFlags.channel;
    const groupId = rawFlags.group;
    const nonInteractive = rawFlags['non-interactive'];
    const privateKeyPath = rawFlags['private-key-path'];

    if (nonInteractive && !groupId) {
      throw new Error('Only --group can be used in non-interactive mode');
    }

    return {
      branchName,
      channelName,
      groupId,

      updateMessage: rawFlags.message,
      privateKeyPath,
      json: rawFlags.json ?? false,
      nonInteractive,
    };
  }
}

function getUniqueUpdateGroups(updateGroups: UpdateToRepublish[][]): UpdateToRepublish[][] {
  const uniqueUpdateGroups = new Map<string, UpdateToRepublish[]>();
  for (const updateGroup of updateGroups) {
    const groupId = updateGroup[0].groupId;
    if (!uniqueUpdateGroups.has(groupId)) {
      uniqueUpdateGroups.set(groupId, updateGroup);
    }
  }
  return Array.from(uniqueUpdateGroups.values());
}

function updateGroupIsRolloutUpdateGroup(
  updateGroup: UpdateToRepublish[]
): updateGroup is RolloutUpdate[] {
  return updateGroup.every(updateIsRolloutUpdate);
}

function updateIsRolloutUpdate(updateGroup: UpdateToRepublish): updateGroup is RolloutUpdate {
  return updateGroup.rolloutPercentage !== undefined && updateGroup.rolloutPercentage !== null;
}

function updateGroupIsUpdateGroupWithControlUpdate(
  updateGroup: RolloutUpdate[]
): updateGroup is RolloutUpdateWithControlUpdate[] {
  return updateGroup.every(updateIsRolloutWithControlUpdate);
}

function updateIsRolloutWithControlUpdate(
  updateGroup: RolloutUpdate
): updateGroup is RolloutUpdateWithControlUpdate {
  return !!updateGroup.rolloutControlUpdate;
}
