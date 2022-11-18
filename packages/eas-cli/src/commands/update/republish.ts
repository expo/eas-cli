import { Platform } from '@expo/config';
import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import { ensureBranchExistsAsync } from '../../branch/queries';
import { getUpdateGroupUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { Update } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { PublishQuery } from '../../graphql/queries/PublishQuery';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { selectUpdateGroupOnBranchAsync } from '../../update/queries';
import { truncateString as truncateUpdateMessage } from '../../update/utils';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const defaultRepublishPlatforms: Platform[] = ['android', 'ios'];

type UpdateRepublishRawFlags = {
  branch?: string;
  group?: string;
  message?: string;
  platform: string;
  'non-interactive': boolean;
  json?: boolean;
};

type UpdateRepublishFlags = {
  branchName?: string;
  groupId?: string;
  updateMessage?: string;
  platform: Platform[];
  nonInteractive: boolean;
  json: boolean;
};

type UpdateToRepublish = {
  groupId: string;
  branchName: string;
} & Pick<Update, 'message' | 'runtimeVersion' | 'manifestFragment' | 'platform' | 'gitCommitHash'>;

export default class UpdateRepublish extends EasCommand {
  static override description = 'rollback to an existing update';

  static override flags = {
    branch: Flags.string({
      description: 'Branch name to select an update from',
    }),
    group: Flags.string({
      description: 'Update group ID to republish',
    }),
    message: Flags.string({
      description: 'Short message describing the update',
      required: false,
    }),
    platform: Flags.enum({
      char: 'p',
      options: [...defaultRepublishPlatforms, 'all'],
      default: 'all',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(UpdateRepublish);
    const flags = this.sanitizeFlags(rawFlags);

    const {
      projectConfig: { exp, projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateRepublish, {
      nonInteractive: flags.nonInteractive,
    });

    if (flags.json) {
      enableJsonOutput();
    }

    const existingUpdates = await getOrAskUpdatesAsync(graphqlClient, projectId, flags);
    const updatesToPublish = existingUpdates.filter(update =>
      flags.platform.includes(update.platform as Platform)
    );

    if (existingUpdates.length === 0) {
      throw new Error(`There are no published updates found`);
    }

    if (updatesToPublish.length === 0) {
      throw new Error(
        `There are no updates on branch "${flags.branchName}" published for the platform(s) "${
          rawFlags.platform
        }" with group ID "${
          flags.groupId ? flags.groupId : updatesToPublish[0].groupId
        }". Did you mean to publish a new update instead?`
      );
    }

    // This command only republishes a single update group, but branch name might be different
    // It can be used to "promote" and existing update to a different branch
    const groupId = updatesToPublish[0].groupId;
    const runtimeVersion = updatesToPublish[0].runtimeVersion;
    const branchName = flags.branchName ?? updatesToPublish[0].branchName;

    // Prevent users from republishing updates to a different branch.
    // When using environment variables, the branch name is not updated, possibly causing unexpected sideeffects.
    assertBranchNameIsEqualToExistingUpdateBranch(updatesToPublish, branchName, flags);

    if (rawFlags.platform === 'all') {
      Log.withTick(`The republished update will appear only on: ${rawFlags.platform}`);
    } else {
      const platformsFromUpdates = updatesToPublish.map(update => update.platform);
      if (platformsFromUpdates.length < defaultRepublishPlatforms.length) {
        Log.warn(`You are republishing an update that wasn't published for all platforms.`);
      }

      Log.withTick(
        `The republished update will appear on the same platforms it was originally published on: ${platformsFromUpdates.join(
          ', '
        )}`
      );
    }

    // If codesigning was created for the original update, we need to add it to the republish
    const codeSigningByPlatform = await PublishQuery.getCodeSigningInfoFromUpdateGroupAsync(
      graphqlClient,
      groupId
    );

    const shouldCodeSignRepublish = Object.keys(codeSigningByPlatform).length > 0;
    if (shouldCodeSignRepublish) {
      Log.withTick(
        `The republished update will be signed with the same codesigning as the original update.`
      );
    }

    const updateMessage = await getOrAskUpdateMessageAsync(updatesToPublish, flags);
    const { branchId } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName,
    });

    const publishIndicator = ora('Republishing...').start();
    let updatesRepublished: Awaited<ReturnType<typeof PublishMutation.publishUpdateGroupAsync>>;

    try {
      updatesRepublished = await PublishMutation.publishUpdateGroupAsync(graphqlClient, [
        {
          branchId,
          runtimeVersion,
          message: updateMessage,
          updateInfoGroup: Object.fromEntries(
            updatesToPublish.map(update => [update.platform, JSON.parse(update.manifestFragment)])
          ),
          awaitingCodeSigningInfo: shouldCodeSignRepublish,
          // Try to inherit the git commit hash
          gitCommitHash: updatesToPublish[0].gitCommitHash,
        },
      ]);

      if (shouldCodeSignRepublish) {
        await Promise.all(
          updatesRepublished
            .filter(update => update.platform in codeSigningByPlatform)
            .map(async update => {
              const codeSigningInfo = codeSigningByPlatform[update.platform as Platform];
              assert(
                codeSigningInfo,
                `Code signing info not found for update on platform ${update.platform}, can't republish update.`
              );

              await PublishMutation.setCodeSigningInfoAsync(graphqlClient, update.id, {
                alg: codeSigningInfo.alg,
                keyid: codeSigningInfo.keyid,
                sig: codeSigningInfo.sig,
              });
            })
        );
      }

      publishIndicator.succeed('Republished update');
    } catch (error: any) {
      publishIndicator.fail('Failed to republish update');
      throw error;
    }

    if (flags.json) {
      return printJsonOnlyOutput(updatesRepublished);
    }

    const updatesRepublishedByPlatform = Object.fromEntries(
      updatesRepublished.map(update => [update.platform, update])
    );

    const updateGroupUrl = getUpdateGroupUrl(
      (await getOwnerAccountForProjectIdAsync(graphqlClient, projectId)).name,
      exp.slug,
      updatesRepublished[0].group
    );

    Log.addNewLineIfNone();
    Log.log(
      formatFields([
        { label: 'Branch', value: branchName },
        { label: 'Runtime version', value: updatesRepublished[0].runtimeVersion },
        { label: 'Platform', value: updatesRepublished.map(update => update.platform).join(', ') },
        { label: 'Update Group ID', value: updatesRepublished[0].id },
        ...(updatesRepublishedByPlatform.android
          ? [{ label: 'Android update ID', value: updatesRepublishedByPlatform.android.id }]
          : []),
        ...(updatesRepublishedByPlatform.ios
          ? [{ label: 'iOS update ID', value: updatesRepublishedByPlatform.ios.id }]
          : []),
        { label: 'Message', value: updateMessage },
        { label: 'Website link', value: link(updateGroupUrl, { dim: false }) },
      ])
    );
  }

  sanitizeFlags(rawFlags: UpdateRepublishRawFlags): UpdateRepublishFlags {
    const branchName = rawFlags.branch;
    const groupId = rawFlags.group;

    if (!branchName && !groupId) {
      throw new Error('Either --branch or --group must be specified');
    }

    const platform =
      rawFlags.platform === 'all' ? defaultRepublishPlatforms : ([rawFlags.platform] as Platform[]);

    return {
      branchName,
      groupId,
      platform,
      updateMessage: rawFlags.message,
      json: rawFlags.json ?? false,
      nonInteractive: rawFlags['non-interactive'],
    };
  }
}

/** Retrieve the update group from either the update group id, or select from branch name. */
async function getOrAskUpdatesAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  flags: UpdateRepublishFlags
): Promise<UpdateToRepublish[]> {
  if (flags.groupId) {
    const updateGroups = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, {
      groupId: flags.groupId,
    });

    return updateGroups.map(group => ({
      ...group,
      branchName: group.branch.name,
      groupId: group.group,
    }));
  }

  if (flags.branchName) {
    return await askUpdatesFromBranchNameAsync(graphqlClient, {
      ...flags,
      branchName: flags.branchName,
      projectId,
    });
  }

  throw new Error('Must supply --group or --branch');
}

/** Ask the user which update needs to be republished by branch name, this requires interactive mode */
async function askUpdatesFromBranchNameAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    branchName,
    json,
    nonInteractive,
  }: { projectId: string; branchName: string; json: boolean; nonInteractive: boolean }
): Promise<UpdateToRepublish[]> {
  if (nonInteractive) {
    throw new Error('Must supply --group when in non-interactive mode');
  }

  const updateGroups = await selectUpdateGroupOnBranchAsync(graphqlClient, {
    projectId,
    branchName,
    paginatedQueryOptions: getPaginatedQueryOptions({ json, 'non-interactive': nonInteractive }),
  });

  return updateGroups.map(group => ({
    groupId: group.id,
    branchName: group.branch.name,
    ...group,
  }));
}

/** Get or ask the user for the update (group) message for the republish */
async function getOrAskUpdateMessageAsync(
  updates: UpdateToRepublish[],
  flags: UpdateRepublishFlags
): Promise<string> {
  if (flags.updateMessage) {
    return sanitizeUpdateMessage(flags.updateMessage);
  }

  if (flags.nonInteractive || flags.json) {
    throw new Error('Must supply --message when in non-interactive mode');
  }

  // This command only uses a single update group to republish, meaning these values are always identical
  const oldGroupId = updates[0].groupId;
  const oldUpdateMessage = updates[0].message;

  const { updateMessage } = await promptAsync({
    type: 'text',
    name: 'updateMessage',
    message: 'Provide an update message.',
    initial: `Republish "${oldUpdateMessage!}" - group: ${oldGroupId}`,
    validate: (value: any) => (value ? true : 'Update message may not be empty.'),
  });

  return sanitizeUpdateMessage(updateMessage);
}

/**
 * Make sure the user-provided branch name matches the original update group branch name.
 * Because no new artifacts are created during republish, environment variables containing the
 * branch name are not updated. This may cause unexpected side effects when "promoting" updates
 * to different branches.
 */
function assertBranchNameIsEqualToExistingUpdateBranch(
  updates: UpdateToRepublish[],
  branchName: string,
  flags: UpdateRepublishFlags
): void {
  if (flags.branchName && updates[0].branchName !== branchName) {
    Log.addNewLineIfNone();
    Log.warn(
      `The original update was published to branch ${updates[0].branchName}, and can't be republished to ${branchName}.`
    );
    Log.warn(`Instead, create a new update on branch ${branchName}:`);

    const { gitCommitHash } = updates.find(update => update.gitCommitHash) ?? {};
    if (gitCommitHash) {
      Log.warn(`  ${chalk.bold(`git checkout ${gitCommitHash}`)}`);
    }

    Log.warn(`  ${chalk.bold(`eas update --branch ${branchName}`)}`);
    Log.addNewLineIfNone();

    throw new Error('Cannot republish update to a different branch');
  }
}

function sanitizeUpdateMessage(updateMessage: string): string {
  if (updateMessage !== truncateUpdateMessage(updateMessage, 1024)) {
    Log.warn('Update message exceeds the allowed 1024 character limit, truncated update message.');
    return truncateUpdateMessage(updateMessage, 1024);
  }

  return updateMessage;
}
