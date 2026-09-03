import { Args } from '@oclif/core';
import chalk from 'chalk';

import { unprotectUpdateChannelAsync } from '../../channel/protection';
import { selectChannelOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { toggleConfirmAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ChannelUnprotect extends EasCommand {
  static override description = "remove a channel's admin-only publishing restriction";

  static override args = {
    name: Args.string({
      required: false,
      description: 'Name of the channel to unprotect',
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
    const { args, flags } = await this.parse(ChannelUnprotect);
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
    } = await this.getContextAsync(ChannelUnprotect, { nonInteractive });
    const existingChannel = args.name
      ? await ChannelQuery.viewUpdateChannelBasicInfoAsync(graphqlClient, {
          appId: projectId,
          channelName: args.name,
        })
      : await selectChannelOnAppAsync(graphqlClient, {
          projectId,
          selectionPromptTitle: 'Select a channel to unprotect',
          paginatedQueryOptions: { json, nonInteractive, offset: 0 },
        });

    if (!existingChannel.isProtected) {
      if (json) {
        printJsonOnlyOutput(existingChannel);
      } else {
        Log.log(chalk`Channel {bold ${existingChannel.name}} is already unprotected.`);
      }
      return;
    }

    if (!nonInteractive) {
      const confirmed = await toggleConfirmAsync({
        message: chalk`Remove protection from channel {bold ${existingChannel.name}}?`,
      });
      if (!confirmed) {
        Log.error(chalk`Canceled removing protection from channel {bold ${existingChannel.name}}.`);
        process.exit(1);
      }
    }

    const channel = await unprotectUpdateChannelAsync(graphqlClient, {
      channelId: existingChannel.id,
    });

    if (json) {
      printJsonOnlyOutput(channel);
    } else {
      Log.withTick(chalk`Channel {bold ${channel.name}} is no longer protected.`);
    }
  }
}
