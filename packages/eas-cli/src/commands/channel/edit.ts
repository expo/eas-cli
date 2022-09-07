import { Flags } from '@oclif/core';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { selectBranchOnAppAsync } from '../../branch/queries';
import { selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  UpdateChannelBranchMappingMutation,
  UpdateChannelBranchMappingMutationVariables,
} from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export async function updateChannelBranchMappingAsync({
  channelId,
  branchMapping,
}: UpdateChannelBranchMappingMutationVariables): Promise<
  UpdateChannelBranchMappingMutation['updateChannel']['editUpdateChannel']
> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<UpdateChannelBranchMappingMutation, UpdateChannelBranchMappingMutationVariables>(
        gql`
          mutation UpdateChannelBranchMapping($channelId: ID!, $branchMapping: String!) {
            updateChannel {
              editUpdateChannel(channelId: $channelId, branchMapping: $branchMapping) {
                id
                name
                branchMapping
              }
            }
          }
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
    ...EasJsonOnlyFlag,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(ChannelEdit);
    if (flags.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    const existingChannel = args.name
      ? await ChannelQuery.viewUpdateChannelAsync({ appId: projectId, channelName: args.name })
      : await selectChannelOnAppAsync({
          projectId,
          selectionPromptTitle: 'Select a channel to edit',
          paginatedQueryOptions: { json: flags.json, nonInteractive: flags.json, offset: 0 },
        });

    if (existingChannel.updateBranches.length > 1) {
      throw new Error('There is a rollout in progress. Manage it with "channel:rollout" instead.');
    }

    const branch = flags.branch
      ? await BranchQuery.getBranchByNameAsync({
          appId: projectId,
          name: flags.branch,
        })
      : await selectBranchOnAppAsync({
          projectId,
          promptTitle: `Which branch would you like ${existingChannel.name} to point at?`,
          displayTextForListItem: updateBranch => updateBranch.name,
          paginatedQueryOptions: {
            json: flags.json,
            nonInteractive: flags.json,
            offset: 0,
          },
        });

    const channel = await updateChannelBranchMappingAsync({
      channelId: existingChannel.id,
      // todo: move branch mapping logic to utility
      branchMapping: JSON.stringify({
        data: [{ branchId: branch.id, branchMappingLogic: 'true' }],
        version: 0,
      }),
    });

    if (flags.json) {
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
