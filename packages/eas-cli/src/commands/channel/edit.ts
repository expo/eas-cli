import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { selectBranchOnAppAsync } from '../../branch/queries';
import {
  getAlwaysTrueBranchMapping,
  hasEmptyBranchMap,
  hasStandardBranchMap,
} from '../../channel/branch-mapping';
import { selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { withErrorHandlingAsync } from '../../graphql/client';
import {
  UpdateChannelBasicInfoFragment,
  UpdateChannelBranchMappingMutation,
  UpdateChannelBranchMappingMutationVariables,
} from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import { UpdateChannelBasicInfoFragmentNode } from '../../graphql/types/UpdateChannelBasicInfo';
import Log from '../../log';
import { isRollout } from '../../rollout/branch-mapping';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export async function updateChannelBranchMappingAsync(
  graphqlClient: ExpoGraphqlClient,
  { channelId, branchMapping }: UpdateChannelBranchMappingMutationVariables
): Promise<UpdateChannelBasicInfoFragment> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<UpdateChannelBranchMappingMutation, UpdateChannelBranchMappingMutationVariables>(
        gql`
          mutation UpdateChannelBranchMapping($channelId: ID!, $branchMapping: String!) {
            updateChannel {
              editUpdateChannel(channelId: $channelId, branchMapping: $branchMapping) {
                id
                ...UpdateChannelBasicInfoFragment
              }
            }
          }
          ${print(UpdateChannelBasicInfoFragmentNode)}
        `,
        { channelId, branchMapping }
      )
      .toPromise()
  );
  const channel = data.updateChannel.editUpdateChannel;
  if (!channel) {
    throw new Error(`Could not find a channel with id: ${channelId}`);
  }
  return channel;
}

export default class ChannelEdit extends EasCommand {
  static override description = 'point a channel at a new branch';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to edit',
    },
  ];

  static override flags = {
    branch: Flags.string({
      description: 'Name of the branch to point to',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args,
      flags: { branch: branchFlag, json, 'non-interactive': nonInteractive },
    } = await this.parse(ChannelEdit);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelEdit, {
      nonInteractive,
    });
    if (json) {
      enableJsonOutput();
    }

    const existingChannel = args.name
      ? await ChannelQuery.viewUpdateChannelBasicInfoAsync(graphqlClient, {
          appId: projectId,
          channelName: args.name,
        })
      : await selectChannelOnAppAsync(graphqlClient, {
          projectId,
          selectionPromptTitle: 'Select a channel to edit',
          paginatedQueryOptions: { json, nonInteractive, offset: 0 },
        });

    if (isRollout(existingChannel)) {
      throw new Error('There is a rollout in progress. Manage it with "channel:rollout" instead.');
    } else if (!hasStandardBranchMap(existingChannel) && !hasEmptyBranchMap(existingChannel)) {
      throw new Error('Only standard branch mappings can be edited with this command.');
    }

    const branch = branchFlag
      ? await BranchQuery.getBranchByNameAsync(graphqlClient, {
          appId: projectId,
          name: branchFlag,
        })
      : await selectBranchOnAppAsync(graphqlClient, {
          projectId,
          promptTitle: `Which branch would you like ${existingChannel.name} to point at?`,
          displayTextForListItem: updateBranch => ({ title: updateBranch.name }),
          paginatedQueryOptions: {
            json,
            nonInteractive,
            offset: 0,
          },
        });

    const channel = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: existingChannel.id,
      branchMapping: JSON.stringify(getAlwaysTrueBranchMapping(branch.id)),
    });

    if (json) {
      printJsonOnlyOutput(channel);
    } else {
      Log.withTick(
        chalk`Channel {bold ${channel.name}} is now set to branch {bold ${branch.name}}.\n`
      );
      Log.addNewLineIfNone();
      Log.log(
        chalk`Users with builds on channel {bold ${channel.name}} will now receive the active update on {bold ${branch.name}}.`
      );
    }
  }
}
