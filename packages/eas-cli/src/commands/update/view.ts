import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { UpdateInsightsQuery } from '../../graphql/queries/UpdateInsightsQuery';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import { resolveInsightsTimeRange } from '../../insights/timeRange';
import Log from '../../log';
import {
  UpdateInsightsSummary,
  buildUpdateInsightsJson,
  buildUpdateInsightsTable,
  toUpdateInsightsSummary,
} from '../../update/insights/formatInsights';
import {
  formatUpdateGroup,
  getUpdateGroupDescriptions,
  getUpdateJsonInfosForUpdates,
} from '../../update/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class UpdateView extends EasCommand {
  static override description = 'update group details';

  static override args = {
    groupId: Args.string({
      required: true,
      description: 'The ID of an update group.',
    }),
  };

  static override flags = {
    insights: Flags.boolean({
      description:
        'Also show insights (launches, crash rate, unique users, payload size) for the update group.',
      default: false,
    }),
    days: Flags.integer({
      description: 'Show insights from the last N days (default 7). Only used with --insights.',
      min: 1,
      exclusive: ['start', 'end'],
    }),
    start: Flags.string({
      description: 'Start of insights time range (ISO date). Only used with --insights.',
      exclusive: ['days'],
    }),
    end: Flags.string({
      description: 'End of insights time range (ISO date). Only used with --insights.',
      exclusive: ['days'],
    }),
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId },
      flags: { json: jsonFlag, insights: insightsFlag, days, start, end },
    } = await this.parse(UpdateView);

    if (!insightsFlag && (days !== undefined || start !== undefined || end !== undefined)) {
      throw new Error('--days, --start, and --end can only be used with --insights.');
    }

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateView, { nonInteractive: true });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const updatesByGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, { groupId });

    let insightsSummary: UpdateInsightsSummary | null = null;
    if (insightsFlag) {
      const { daysBack, startTime, endTime } = resolveInsightsTimeRange({ days, start, end });
      const updatesWithInsights = await UpdateInsightsQuery.viewUpdateGroupInsightsAsync(
        graphqlClient,
        { groupId, startTime, endTime }
      );
      insightsSummary = toUpdateInsightsSummary(groupId, updatesWithInsights, {
        startTime,
        endTime,
        daysBack,
      });
    }

    if (jsonFlag) {
      if (insightsSummary) {
        printJsonOnlyOutput({
          updates: getUpdateJsonInfosForUpdates(updatesByGroup),
          insights: buildUpdateInsightsJson(insightsSummary),
        });
      } else {
        printJsonOnlyOutput(getUpdateJsonInfosForUpdates(updatesByGroup));
      }
    } else {
      const [updateGroupDescription] = getUpdateGroupDescriptions([updatesByGroup]);

      Log.log(chalk.bold('Update group:'));

      Log.log(formatUpdateGroup(updateGroupDescription));

      if (insightsSummary) {
        Log.addNewLineIfNone();
        Log.log(buildUpdateInsightsTable(insightsSummary));
      }
    }
  }
}
