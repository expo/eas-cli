import { Args } from '@oclif/core';
import chalk from 'chalk';

import { protectUpdateChannelAsync } from '../../channel/protection';
import { selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ChannelProtect extends EasCommand {
  static override description = 'protect a channel so only account admins can publish to it';

  static override args = {
    name: Args.string({
      required: false,
      description: 'Name of the channel to protect',
    }),
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(ChannelProtect);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }
    if (!args.name && nonInteractive) {
      throw new Error('Channel name must be set when running in non-interactive mode');
    }
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelProtect, { nonInteractive });
    const existingChannel = args.name
      ? await ChannelQuery.viewUpdateChannelBasicInfoAsync(graphqlClient, {
          appId: projectId,
          channelName: args.name,
        })
      : await selectChannelOnAppAsync(graphqlClient, {
          projectId,
          selectionPromptTitle: 'Select a channel to protect',
          paginatedQueryOptions: { json, nonInteractive, offset: 0 },
        });

    if (existingChannel.isProtected) {
      if (json) {
        printJsonOnlyOutput(existingChannel);
      } else {
        Log.log(chalk`Channel {bold ${existingChannel.name}} is already protected.`);
      }
      return;
    }

    const channel = await protectUpdateChannelAsync(graphqlClient, {
      channelId: existingChannel.id,
    });

    if (json) {
      printJsonOnlyOutput(channel);
    } else {
      Log.withTick(chalk`Channel {bold ${channel.name}} is now protected.`);
    }
  }
}
