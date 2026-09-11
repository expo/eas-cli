import { Flags } from '@oclif/core';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  EasProjectIdFlag,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../../commandUtils/pagination';
import { WorkflowRunTriggerEventType } from '../../../graphql/generated';
import { WorkflowsInsightsQuery } from '../../../graphql/queries/WorkflowsInsightsQuery';
import { InsightsTimeRangeFlags, resolveInsightsTimeRange } from '../../../insights/timeRange';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import {
  INSIGHTS_RUN_STATUSES,
  WorkflowsInsightsSharedFilterFlags,
  getAppliedWorkflowsInsightsFilters,
  resolveWorkflowsInsightsFiltersInputAsync,
} from '../../../workflow/insights/filters';
import {
  buildWorkflowsInsightsJson,
  buildWorkflowsInsightsTable,
  toWorkflowsInsightsSummary,
} from '../../../workflow/insights/formatInsights';
import { alignInsightsTimespan } from '../../../workflow/insights/granularity';
import { withInsightsPlanGateHandlingAsync } from '../../../workflow/insights/planGating';

const DEFAULT_WORKFLOWS_LIMIT = 50;
const MAX_WORKFLOWS_LIMIT = 100;

export default class WorkflowInsights extends EasCommand {
  static override description =
    'display run counts, success rate, and per-workflow trends for a time range';

  static override flags = {
    ...WorkflowsInsightsSharedFilterFlags,
    status: Flags.option({
      description: 'Only include runs with this status (can be specified multiple times).',
      options: INSIGHTS_RUN_STATUSES,
      multiple: true,
    })(),
    trigger: Flags.option({
      description: 'Only include runs started by this trigger (can be specified multiple times).',
      options: Object.values(WorkflowRunTriggerEventType),
      multiple: true,
    })(),
    ...InsightsTimeRangeFlags,
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_WORKFLOWS_LIMIT,
      limit: MAX_WORKFLOWS_LIMIT,
      description: `The number of workflows to list. Defaults to ${DEFAULT_WORKFLOWS_LIMIT} and is capped at ${MAX_WORKFLOWS_LIMIT}.`,
    }),
    ...EasProjectIdFlag,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WorkflowInsights);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (json) {
      enableJsonOutput();
    }

    const { timespan, granularity } = alignInsightsTimespan(resolveInsightsTimeRange(flags));

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowInsights, {
      nonInteractive,
      projectIdOverride: flags['project-id'],
    });

    const filters = await resolveWorkflowsInsightsFiltersInputAsync(
      graphqlClient,
      projectId,
      flags
    );
    const app = await withInsightsPlanGateHandlingAsync(() =>
      WorkflowsInsightsQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        startTime: timespan.startTime,
        endTime: timespan.endTime,
        filters,
        granularity,
        first: flags.limit ?? DEFAULT_WORKFLOWS_LIMIT,
      })
    );

    const summary = toWorkflowsInsightsSummary(app, {
      timespan,
      granularity,
      filters: getAppliedWorkflowsInsightsFilters(flags),
    });

    if (json) {
      printJsonOnlyOutput(buildWorkflowsInsightsJson(summary));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildWorkflowsInsightsTable(summary));
    }
  }
}
