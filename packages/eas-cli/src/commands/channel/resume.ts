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
  ResumeUpdateChannelMutation,
  ResumeUpdateChannelMutationVariables,
  UpdateChannelBasicInfoFragment,
} from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import { UpdateChannelBasicInfoFragmentNode } from '../../graphql/types/UpdateChannelBasicInfo';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export async function resumeUpdateChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  { channelId }: ResumeUpdateChannelMutationVariables
): Promise<UpdateChannelBasicInfoFragment> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<ResumeUpdateChannelMutation, ResumeUpdateChannelMutationVariables>(
        gql`
          mutation ResumeUpdateChannel($channelId: ID!) {
            updateChannel {
              resumeUpdateChannel(channelId: $channelId) {
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
  const channel = data.updateChannel.resumeUpdateChannel;
  if (!channel) {
    throw new Error(`Could not find a channel with id: ${channelId}`);
  }
  return channel;
}

export default class ChannelResume extends EasCommand {
  static override description = 'resume a channel to start sending updates';

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
    } = await this.parse(ChannelResume);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelResume, {
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

    const channel = await resumeUpdateChannelAsync(graphqlClient, {
      channelId: existingChannel.id,
    });

    if (json) {
      printJsonOnlyOutput(channel);
    } else {
      Log.withTick(chalk`Channel {bold ${channel.name}} is now active.\n`);
      Log.addNewLineIfNone();
      Log.log(chalk`Users with builds on channel {bold ${channel.name}} will now receive updates.`);
    }
  }
}
