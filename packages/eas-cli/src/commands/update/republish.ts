import { Platform } from '@expo/config';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { getBranchNameFromChannelNameAsync } from '../../update/getBranchNameFromChannelNameAsync';
import { selectUpdateGroupOnBranchAsync } from '../../update/queries';
import { UpdateToRepublish, republishAsync } from '../../update/republish';
import { truncateString as truncateUpdateMessage } from '../../update/utils';
import { getCodeSigningInfoAsync } from '../../utils/code-signing';
import { enableJsonOutput } from '../../utils/json';

const defaultRepublishPlatforms: Platform[] = ['android', 'ios'];

type UpdateRepublishRawFlags = {
  branch?: string;
  channel?: string;
  group?: string;
  message?: string;
  platform: string;
  'private-key-path'?: string;
  'non-interactive': boolean;
  json?: boolean;
};

type UpdateRepublishFlags = {
  branchName?: string;
  channelName?: string;
  groupId?: string;
  updateMessage?: string;
  platform: Platform[];
  privateKeyPath?: string;
  nonInteractive: boolean;
  json: boolean;
};

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
      char: 'm',
      description: 'Short message describing the republished update',
      required: false,
    }),
    platform: Flags.enum({
      char: 'p',
      options: [...defaultRepublishPlatforms, 'all'],
      default: 'all',
      required: false,
    }),
    'private-key-path': Flags.string({
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory.`,
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

    const codeSigningInfo = await getCodeSigningInfoAsync(exp, flags.privateKeyPath);

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

    const updateMessage = await getOrAskUpdateMessageAsync(updatesToPublish, flags);
    const arbitraryUpdate = updatesToPublish[0];
    await republishAsync({
      graphqlClient,
      app: { exp, projectId },
      updatesToPublish,
      targetBranch: { branchId: arbitraryUpdate.branchId, branchName: arbitraryUpdate.branchName },
      updateMessage,
      codeSigningInfo,
      json: flags.json,
    });
  }

  private sanitizeFlags(rawFlags: UpdateRepublishRawFlags): UpdateRepublishFlags {
    const branchName = rawFlags.branch;
    const channelName = rawFlags.channel;
    const groupId = rawFlags.group;
    const nonInteractive = rawFlags['non-interactive'];
    const privateKeyPath = rawFlags['private-key-path'];

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
      privateKeyPath,
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
    const updateGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, {
      groupId: flags.groupId,
    });

    return updateGroup.map(update => ({
      ...update,
      groupId: update.group,
      branchId: update.branch.id,
      branchName: update.branch.name,
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

  const updateGroup = await selectUpdateGroupOnBranchAsync(graphqlClient, {
    projectId,
    branchName,
    paginatedQueryOptions: getPaginatedQueryOptions({ json, 'non-interactive': nonInteractive }),
  });

  return updateGroup.map(update => ({
    ...update,
    groupId: update.group,
    branchId: update.branch.id,
    branchName: update.branch.name,
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
