import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { withErrorHandlingAsync } from '../../graphql/client';
import {
  PauseUpdateChannelMutation,
  PauseUpdateChannelMutationVariables,
  UpdateChannelBasicInfoFragment,
} from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import { UpdateChannelBasicInfoFragmentNode } from '../../graphql/types/UpdateChannelBasicInfo';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export async function pauseUpdateChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  { channelId }: PauseUpdateChannelMutationVariables
): Promise<UpdateChannelBasicInfoFragment> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<PauseUpdateChannelMutation, PauseUpdateChannelMutationVariables>(
        gql`
          mutation PauseUpdateChannel($channelId: ID!) {
            updateChannel {
              pauseUpdateChannel(channelId: $channelId) {
                id
                ...UpdateChannelBasicInfoFragment
              }
            }
          }
          ${print(UpdateChannelBasicInfoFragmentNode)}
        `,
        { channelId }
      )
      .toPromise()
  );
  const channel = data.updateChannel.pauseUpdateChannel;
  if (!channel) {
    throw new Error(`Could not find a channel with id: ${channelId}`);
  }
  return channel;
}

export default class ChannelPause extends EasCommand {
  static override description = 'pause a channel to stop it from sending updates';

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
      flags: { json, 'non-interactive': nonInteractive },
    } = await this.parse(ChannelPause);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelPause, {
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

    const channel = await pauseUpdateChannelAsync(graphqlClient, {
      channelId: existingChannel.id,
    });

    if (json) {
      printJsonOnlyOutput(channel);
    } else {
      Log.withTick(chalk`Channel {bold ${channel.name}} is now paused.\n`);
      Log.addNewLineIfNone();
      Log.log(
        chalk`Users with builds on channel {bold ${channel.name}} will no longer receive updates.`
      );
    }
  }
}
