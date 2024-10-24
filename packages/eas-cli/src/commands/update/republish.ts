import { Platform } from '@expo/config';
import { Flags } from '@oclif/core';

import { selectBranchOnAppAsync } from '../../branch/queries';
import { selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync } from '../../update/getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync';
import { selectUpdateGroupOnBranchAsync } from '../../update/queries';
import { UpdateToRepublish, republishAsync } from '../../update/republish';
import { truncateString as truncateUpdateMessage } from '../../update/utils';
import { getCodeSigningInfoAsync } from '../../utils/code-signing';
import { enableJsonOutput } from '../../utils/json';

const defaultRepublishPlatforms: Platform[] = ['android', 'ios'];

type UpdateRepublishRawFlags = {
  branch?: string;
  channel?: string;
  'destination-channel'?: string;
  'destination-branch'?: string;
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
  destinationChannelName?: string;
  destinationBranchName?: string;
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
      description: 'Channel name to select an update group to republish from',
      exclusive: ['branch', 'group'],
    }),
    branch: Flags.string({
      description: 'Branch name to select an update group to republish from',
      exclusive: ['channel', 'group'],
    }),
    group: Flags.string({
      description: 'Update group ID to republish',
      exclusive: ['branch', 'channel'],
    }),
    'destination-channel': Flags.string({
      description:
        'Channel name to select a branch to republish to if republishing to a different branch',
      exclusive: ['destination-branch'],
    }),
    'destination-branch': Flags.string({
      description: 'Branch name to republish to if republishing to a different branch',
      exclusive: ['destination-channel'],
    }),
    message: Flags.string({
      char: 'm',
      description: 'Short message describing the republished update group',
      required: false,
    }),
    platform: Flags.enum({
      char: 'p',
      options: [...defaultRepublishPlatforms, 'all'],
      default: 'all',
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
    const { flags: rawFlags } = await this.parse(UpdateRepublish);
    const flags = this.sanitizeFlags(rawFlags);

    const {
      privateProjectConfig: { exp, projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateRepublish, {
      nonInteractive: flags.nonInteractive,
      withServerSideEnvironment: null,
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
      Log.withTick(`The republished update group will appear only on: ${rawFlags.platform}`);
    } else {
      const platformsFromUpdates = updatesToPublish.map(update => update.platform);
      if (platformsFromUpdates.length < defaultRepublishPlatforms.length) {
        Log.warn(`You are republishing an update group that wasn't published for all platforms.`);
      }

      Log.withTick(
        `The republished update group will appear on the same platforms it was originally published on: ${platformsFromUpdates.join(
          ', '
        )}`
      );
    }

    const arbitraryUpdate = updatesToPublish[0];
    const targetBranch = await getOrAskTargetBranchAsync(
      graphqlClient,
      projectId,
      flags,
      arbitraryUpdate
    );

    const updateMessage = await getOrAskUpdateMessageAsync(updatesToPublish, flags);

    await republishAsync({
      graphqlClient,
      app: { exp, projectId },
      updatesToPublish,
      targetBranch,
      updateMessage,
      codeSigningInfo,
      json: flags.json,
    });
  }

  private sanitizeFlags(rawFlags: UpdateRepublishRawFlags): UpdateRepublishFlags {
    const branchName = rawFlags.branch;
    const channelName = rawFlags.channel;
    const groupId = rawFlags.group;
    const destinationChannelName = rawFlags['destination-channel'];
    const destinationBranchName = rawFlags['destination-branch'];
    const nonInteractive = rawFlags['non-interactive'];
    const privateKeyPath = rawFlags['private-key-path'];

    if (nonInteractive && !groupId) {
      throw new Error('Only --group can be used in non-interactive mode');
    }

    const platform =
      rawFlags.platform === 'all' ? defaultRepublishPlatforms : ([rawFlags.platform] as Platform[]);

    return {
      branchName,
      channelName,
      destinationChannelName,
      destinationBranchName,
      groupId,
      platform,
      updateMessage: rawFlags.message,
      privateKeyPath,
      json: rawFlags.json ?? false,
      nonInteractive,
    };
  }
}

async function getOrAskTargetBranchAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  flags: UpdateRepublishFlags,
  arbitraryUpdate: UpdateToRepublish
): Promise<{ branchId: string; branchName: string }> {
  // if branch name supplied, use that
  if (flags.destinationBranchName) {
    const branch = await BranchQuery.getBranchByNameAsync(graphqlClient, {
      appId: projectId,
      name: flags.destinationBranchName,
    });
    return { branchId: branch.id, branchName: branch.name };
  }

  // if provided channel name but was non-interactive
  if (flags.destinationChannelName) {
    return await getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
      graphqlClient,
      projectId,
      flags.destinationChannelName
    );
  }

  // if neither provided, assume republish on same branch
  return { branchId: arbitraryUpdate.branchId, branchName: arbitraryUpdate.branchName };
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

  if (flags.nonInteractive) {
    throw new Error('Must supply --group when in non-interactive mode');
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

  const { choice } = await promptAsync({
    type: 'select',
    message: 'Find update by branch or channel?',
    name: 'choice',
    choices: [
      { title: 'Branch', value: 'branch' },
      { title: 'Channel', value: 'channel' },
    ],
  });

  if (choice === 'channel') {
    const { name } = await selectChannelOnAppAsync(graphqlClient, {
      projectId,
      selectionPromptTitle: 'Select a channel to view',
      paginatedQueryOptions: {
        json: flags.json,
        nonInteractive: flags.nonInteractive,
        offset: 0,
      },
    });

    return await askUpdatesFromChannelNameAsync(graphqlClient, {
      ...flags,
      channelName: name,
      projectId,
    });
  } else if (choice === 'branch') {
    const { name } = await selectBranchOnAppAsync(graphqlClient, {
      projectId,
      promptTitle: 'Select branch from which to choose update',
      displayTextForListItem: updateBranch => ({
        title: updateBranch.name,
      }),
      // discard limit and offset because this query is not their intended target
      paginatedQueryOptions: {
        json: flags.json,
        nonInteractive: flags.nonInteractive,
        offset: 0,
      },
    });

    return await askUpdatesFromBranchNameAsync(graphqlClient, {
      ...flags,
      branchName: name,
      projectId,
    });
  } else {
    throw new Error('Must choose update via channel or branch');
  }
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
  const { branchName } = await getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
    graphqlClient,
    projectId,
    channelName
  );

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
