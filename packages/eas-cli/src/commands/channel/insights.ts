import { Flags } from '@oclif/core';

import {
  buildChannelInsightsJson,
  buildChannelInsightsTable,
  toChannelInsightsSummary,
} from '../../channel/insights/formatInsights';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { ChannelInsightsQuery } from '../../graphql/queries/ChannelInsightsQuery';
import { resolveInsightsTimeRange } from '../../insights/timeRange';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ChannelInsights extends EasCommand {
  static override description =
    'display adoption, crash, and unique-user insights for a channel + runtime version';

  static override flags = {
    channel: Flags.string({
      description: 'Name of the channel.',
      required: true,
    }),
    'runtime-version': Flags.string({
      description: 'Runtime version to query insights for.',
      required: true,
    }),
    days: Flags.integer({
      description:
        'Show insights from the last N days (default 7, mutually exclusive with --start/--end).',
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
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ChannelInsights);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelInsights, { nonInteractive });

    if (json) {
      enableJsonOutput();
    }

    const { daysBack, startTime, endTime } = resolveInsightsTimeRange(flags);

    const insights = await ChannelInsightsQuery.viewChannelRuntimeInsightsAsync(graphqlClient, {
      appId: projectId,
      channelName: flags.channel,
      runtimeVersion: flags['runtime-version'],
      startTime,
      endTime,
    });

    const summary = toChannelInsightsSummary(flags.channel, flags['runtime-version'], insights, {
      startTime,
      endTime,
      daysBack,
    });

    if (json) {
      printJsonOnlyOutput(buildChannelInsightsJson(summary));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildChannelInsightsTable(summary));
    }
  }
}
