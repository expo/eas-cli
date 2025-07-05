import { Platform } from '@expo/config';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import Log from '../../log';
import { getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync } from '../../update/getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync';
import {
  UpdateToRepublish,
  getOrAskUpdateMessageAsync,
  getUpdateGroupOrAskForUpdateGroupAsync,
  republishAsync,
} from '../../update/republish';
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
  'rollout-percentage'?: number;
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
  rolloutPercentage?: number;
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
    'rollout-percentage': Flags.integer({
      description: `Percentage of users this update should be immediately available to. Users not in the rollout will be served the previous latest update on the branch, even if that update is itself being rolled out. The specified number must be an integer between 1 and 100. When not specified, this defaults to 100.`,
      required: false,
      min: 0,
      max: 100,
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

    const existingUpdates = await getUpdateGroupOrAskForUpdateGroupAsync(
      graphqlClient,
      projectId,
      flags
    );
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

    if (rawFlags.platform !== 'all') {
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
      rolloutPercentage: flags.rolloutPercentage,
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
      rolloutPercentage: rawFlags['rollout-percentage'],
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
