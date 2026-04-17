import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { UpdateInsightsQuery } from '../../graphql/queries/UpdateInsightsQuery';
import { INSIGHTS_DEFAULT_DAYS_BACK, resolveInsightsTimeRange } from '../../insights/timeRange';
import Log from '../../log';
import {
  buildUpdateInsightsJson,
  buildUpdateInsightsTable,
  toUpdateInsightsSummary,
} from '../../update/insights/formatInsights';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class UpdateInsights extends EasCommand {
  static override description =
    'display launch, crash, unique-user, and size insights for an update group';

  static override args = {
    groupId: Args.string({
      required: true,
      description: 'The ID of an update group.',
    }),
  };

  static override flags = {
    platform: Flags.option({
      description: 'Filter to a single platform.',
      options: ['ios', 'android'] as const,
    })(),
    days: Flags.integer({
      description: `Show insights from the last N days (default ${INSIGHTS_DEFAULT_DAYS_BACK}, mutually exclusive with --start/--end).`,
      min: 1,
      exclusive: ['start', 'end'],
    }),
    start: Flags.string({
      description: 'Start of insights time range (ISO date).',
      exclusive: ['days'],
    }),
    end: Flags.string({
      description: 'End of insights time range (ISO date).',
      exclusive: ['days'],
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId },
      flags,
    } = await this.parse(UpdateInsights);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateInsights, { nonInteractive });

    if (json) {
      enableJsonOutput();
    }

    const { daysBack, startTime, endTime } = resolveInsightsTimeRange(flags);

    const allUpdates = await UpdateInsightsQuery.viewUpdateGroupInsightsAsync(graphqlClient, {
      groupId,
      startTime,
      endTime,
    });

    const updates = flags.platform
      ? allUpdates.filter(u => u.platform === flags.platform)
      : allUpdates;
    if (updates.length === 0) {
      throw new Error(
        `Update group "${groupId}" has no ${flags.platform} update (available platforms: ${allUpdates
          .map(u => u.platform)
          .sort()
          .join(', ')}).`
      );
    }

    const summary = toUpdateInsightsSummary(groupId, updates, { startTime, endTime, daysBack });

    if (json) {
      printJsonOnlyOutput(buildUpdateInsightsJson(summary));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildUpdateInsightsTable(summary));
    }
  }
}
