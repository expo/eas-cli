import { Platform } from '@expo/config';
import { Flags } from '@oclif/core';

import { getUpdateGroupUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { Update } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { getBranchNameFromChannelNameAsync } from '../../update/getBranchNameFromChannelNameAsync';
import { selectUpdateGroupOnBranchAsync } from '../../update/queries';
import { truncateString as truncateUpdateMessage } from '../../update/utils';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const defaultRepublishPlatforms: Platform[] = ['android', 'ios'];

type UpdateRepublishRawFlags = {
  branch?: string;
  channel?: string;
  group?: string;
  message?: string;
  platform: string;
  'non-interactive': boolean;
  json?: boolean;
};

type UpdateRepublishFlags = {
  branchName?: string;
  channelName?: string;
  groupId?: string;
  updateMessage?: string;
  platform: Platform[];
  nonInteractive: boolean;
  json: boolean;
};

type UpdateToRepublish = {
  groupId: string;
  branchId: string;
  branchName: string;
} & Pick<
  Update,
  | 'message'
  | 'runtimeVersion'
  | 'manifestFragment'
  | 'platform'
  | 'gitCommitHash'
  | 'codeSigningInfo'
>;

export default class UpdateRepublish extends EasCommand {
  static override description = 'roll back to an existing update';

  static override flags = {
    channel: Flags.string({
      description: 'Channel name to select an update to republish from',
      exclusive: ['branch', 'group'],
    }),
    branch: Flags.string({
      description: 'Branch name to select an update to republish from',
      exclusive: ['channel', 'group'],
    }),
    group: Flags.string({
      description: 'Update group ID to republish',
      exclusive: ['branch', 'channel'],
    }),
    message: Flags.string({
      description: 'Short message describing the republished update',
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
      privateProjectConfig: { exp, projectId },
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
        `There are no updates on branch "${
          existingUpdates[0].branchName
        }" published for the platform(s) "${rawFlags.platform}" with group ID "${
          flags.groupId ? flags.groupId : updatesToPublish[0].groupId
        }". Did you mean to publish a new update instead?`
      );
    }

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

    // This command only republishes a single update group
    // The update group properties are the same for all updates
    const { branchId, branchName, runtimeVersion } = updatesToPublish[0];

    const updateMessage = await getOrAskUpdateMessageAsync(updatesToPublish, flags);

    // If codesigning was created for the original update, we need to add it to the republish
    const shouldRepublishWithCodesigning = updatesToPublish.some(update => update.codeSigningInfo);
    if (shouldRepublishWithCodesigning) {
      Log.withTick(
        `The republished update will be signed with the same codesigning as the original update.`
      );
    }

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
          gitCommitHash: updatesToPublish[0].gitCommitHash,
          awaitingCodeSigningInfo: shouldRepublishWithCodesigning,
        },
      ]);

      if (shouldRepublishWithCodesigning) {
        const codeSigningByPlatform = Object.fromEntries(
          updatesToPublish.map(update => [update.platform, update.codeSigningInfo])
        );

        await Promise.all(
          updatesRepublished.map(async update => {
            const codeSigning = codeSigningByPlatform[update.platform];
            if (codeSigning) {
              await PublishMutation.setCodeSigningInfoAsync(graphqlClient, update.id, codeSigning);
            }
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
    const channelName = rawFlags.channel;
    const groupId = rawFlags.group;
    const nonInteractive = rawFlags['non-interactive'];

    if (nonInteractive && !groupId) {
      throw new Error('Only --group can be used in non-interactive mode');
    }
    if (!groupId && !(branchName || channelName)) {
      throw new Error(`--channel, --branch, or --group must be specified`);
    }

    const platform =
      rawFlags.platform === 'all' ? defaultRepublishPlatforms : ([rawFlags.platform] as Platform[]);

    return {
      branchName,
      channelName,
      groupId,
      platform,
      updateMessage: rawFlags.message,
      json: rawFlags.json ?? false,
      nonInteractive,
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
      groupId: group.group,
      branchId: group.branch.id,
      branchName: group.branch.name,
    }));
  }

  if (flags.branchName) {
    return await askUpdatesFromBranchNameAsync(graphqlClient, {
      ...flags,
      branchName: flags.branchName,
      projectId,
    });
  }

  if (flags.channelName) {
    return await askUpdatesFromChannelNameAsync(graphqlClient, {
      ...flags,
      channelName: flags.channelName,
      projectId,
    });
  }

  throw new Error('--channel, --branch, or --group is required');
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
    ...group,
    groupId: group.id,
    branchId: group.branch.id,
    branchName: group.branch.name,
  }));
}
/** Ask the user which update needs to be republished by channel name, this requires interactive mode */
async function askUpdatesFromChannelNameAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    channelName,
    json,
    nonInteractive,
  }: { projectId: string; channelName: string; json: boolean; nonInteractive: boolean }
): Promise<UpdateToRepublish[]> {
  if (nonInteractive) {
    throw new Error('Must supply --group when in non-interactive mode');
  }

  const branchName = await getBranchNameFromChannelNameAsync(graphqlClient, projectId, channelName);

  return await askUpdatesFromBranchNameAsync(graphqlClient, {
    projectId,
    branchName,
    json,
    nonInteractive,
  });
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

function sanitizeUpdateMessage(updateMessage: string): string {
  if (updateMessage !== truncateUpdateMessage(updateMessage, 1024)) {
    Log.warn('Update message exceeds the allowed 1024 character limit, truncated update message.');
    return truncateUpdateMessage(updateMessage, 1024);
  }

  return updateMessage;
}
