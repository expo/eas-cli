import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../../commandUtils/pagination';
import { AppPlatform } from '../../../graphql/generated';
import {
  EmbeddedUpdateFragment,
  EmbeddedUpdateQuery,
} from '../../../graphql/queries/EmbeddedUpdateQuery';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import formatFields from '../../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

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
      description: 'Filter by channel name',
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
      ? toAppPlatform(flags.platform as Platform)
      : undefined;
    const filter =
      (platform ?? flags['runtime-version'] ?? flags.channel)
        ? {
            platform,
            runtimeVersion: flags['runtime-version'],
            channel: flags.channel,
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

    for (const embeddedUpdate of embeddedUpdates) {
      Log.log(formatEmbeddedUpdateRow(embeddedUpdate));
      Log.addNewLineIfNone();
    }

    if (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor) {
      Log.log(
        `Showing ${embeddedUpdates.length} result${embeddedUpdates.length === 1 ? '' : 's'}. ` +
          `For the next page, run with --after-cursor ${connection.pageInfo.endCursor}`
      );
    }
  }
}

function formatEmbeddedUpdateRow(embeddedUpdate: EmbeddedUpdateFragment): string {
  return formatFields([
    { label: 'ID', value: embeddedUpdate.id },
    { label: 'Platform', value: embeddedUpdate.platform.toLowerCase() },
    { label: 'Runtime version', value: embeddedUpdate.runtimeVersion },
    { label: 'Channel', value: embeddedUpdate.channel },
    { label: 'Created at', value: new Date(embeddedUpdate.createdAt).toLocaleString() },
  ]);
}
