import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../../commandUtils/pagination';
import { AppPlatform } from '../../../graphql/generated';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import {
  EmbeddedUpdateFragment,
  EmbeddedUpdateQuery,
} from '../../../graphql/queries/EmbeddedUpdateQuery';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import { selectAsync } from '../../../prompts';
import { fromNow } from '../../../utils/date';
import formatFields from '../../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const CHANNELS_LIMIT = 50;

export default class UpdateEmbeddedList extends EasCommand {
  static override description = 'list embedded updates registered with EAS Update for this project';

  static override flags = {
    platform: Flags.option({
      char: 'p',
      description: 'Filter by platform',
      options: [Platform.IOS, Platform.ANDROID] as const,
    })(),
    'runtime-version': Flags.string({
      description: 'Filter by runtime version',
    }),
    channel: Flags.string({
      description: 'Filter by channel name (pass "all" to skip the channel prompt)',
    }),
    limit: getLimitFlagWithCustomValues({ defaultTo: DEFAULT_LIMIT, limit: MAX_LIMIT }),
    'after-cursor': Flags.string({
      description: 'Return items after this cursor (for pagination)',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateEmbeddedList);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateEmbeddedList, { nonInteractive });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const platform: AppPlatform | undefined = flags.platform
      ? toAppPlatform(flags.platform)
      : undefined;

    // Resolve channel filter:
    // - `--channel <name>`: use it
    // - `--channel all` (or no flag in non-interactive / json): no channel filter
    // - no flag in interactive: prompt with the project's channels + "All channels"
    let channel: string | undefined;
    if (flags.channel) {
      channel = flags.channel.toLowerCase() === 'all' ? undefined : flags.channel;
    } else if (!nonInteractive && !jsonFlag) {
      channel = await promptForChannelAsync(graphqlClient, projectId);
    }

    const filter =
      platform || flags['runtime-version'] || channel
        ? {
            platform,
            runtimeVersion: flags['runtime-version'],
            channel,
          }
        : undefined;

    const limit = flags.limit ?? DEFAULT_LIMIT;
    const connection = await EmbeddedUpdateQuery.viewPaginatedAsync(graphqlClient, {
      appId: projectId,
      filter,
      first: limit,
      after: flags['after-cursor'],
    });

    const embeddedUpdates = connection.edges.map(e => e.node);

    if (jsonFlag) {
      printJsonOnlyOutput({
        embeddedUpdates,
        pageInfo: connection.pageInfo,
      });
      return;
    }

    if (embeddedUpdates.length === 0) {
      Log.log('No embedded updates found.');
      return;
    }

    Log.addNewLineIfNone();
    Log.log(
      chalk.bold(
        `Embedded updates (${embeddedUpdates.length}${connection.pageInfo.hasNextPage ? '+' : ''}):`
      )
    );
    Log.newLine();
    Log.log(embeddedUpdates.map(formatEmbeddedUpdateRow).join(`\n\n${chalk.dim('———')}\n\n`));

    if (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor) {
      Log.newLine();
      Log.log(
        chalk.dim(
          `Showing ${embeddedUpdates.length}. For the next page, run with --after-cursor ${connection.pageInfo.endCursor}`
        )
      );
    }
  }
}

// Sentinel for the "All channels" option. We can't use `undefined` here because
// the underlying `prompts` library substitutes a choice's index when its value
// is undefined, which then leaks into the GraphQL filter.
const ALL_CHANNELS = '__embedded_update_list__all_channels__';

async function promptForChannelAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<string | undefined> {
  const channels = await ChannelQuery.viewUpdateChannelsOnAppAsync(graphqlClient, {
    appId: projectId,
    offset: 0,
    limit: CHANNELS_LIMIT,
  });

  if (channels.length === 0) {
    // Nothing to choose from — fall back to listing everything.
    return undefined;
  }

  const selected = await selectAsync<string>('Filter embedded updates by which channel?', [
    ...channels.map(c => ({ title: c.name, value: c.name })),
    { title: 'All channels', value: ALL_CHANNELS },
  ]);
  return selected === ALL_CHANNELS ? undefined : selected;
}

function formatEmbeddedUpdateRow(embeddedUpdate: EmbeddedUpdateFragment): string {
  const createdAt = new Date(embeddedUpdate.createdAt);
  return formatFields([
    { label: 'ID', value: embeddedUpdate.id },
    { label: 'Platform', value: embeddedUpdate.platform.toLowerCase() },
    { label: 'Runtime version', value: embeddedUpdate.runtimeVersion },
    { label: 'Channel', value: embeddedUpdate.channel },
    { label: 'Created', value: `${fromNow(createdAt)} ago` },
  ]);
}
