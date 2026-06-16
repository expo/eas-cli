import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { UpdateFragment } from '../../graphql/generated';
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
      description: 'The ID of an update group, or the ID of a platform-specific update.',
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
      args: { groupId: idArg },
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

    const { groupId, updatesByGroup } = await UpdateView.resolveUpdateGroupAsync(
      graphqlClient,
      idArg
    );

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

  /**
   * Resolves the provided ID into an update group and its updates. The ID may be either an
   * update group ID or the ID of a single platform-specific update. We first try to look it up
   * as a group; if no updates are found, we fall back to resolving it as a platform-specific
   * update and then fetch the group that update belongs to.
   */
  private static async resolveUpdateGroupAsync(
    graphqlClient: ExpoGraphqlClient,
    id: string
  ): Promise<{ groupId: string; updatesByGroup: UpdateFragment[] }> {
    try {
      const updatesByGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, { groupId: id });
      return { groupId: id, updatesByGroup };
    } catch (groupError) {
      let update: UpdateFragment | undefined;
      try {
        update = await UpdateQuery.viewByUpdateAsync(graphqlClient, { updateId: id });
      } catch {
        // The ID is neither a valid update group nor a valid platform-specific update; surface
        // the original group lookup error since the group ID is the primary input.
        throw groupError;
      }

      const updatesByGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, {
        groupId: update.group,
      });
      return { groupId: update.group, updatesByGroup };
    }
  }
}
