import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { WorkflowRunStatus, WorkflowRunTriggerEventType } from '../../graphql/generated';
import { WorkflowsInsightsQuery } from '../../graphql/queries/WorkflowsInsightsQuery';
import { INSIGHTS_DEFAULT_DAYS_BACK, resolveInsightsTimeRange } from '../../insights/timeRange';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import {
  getAppliedWorkflowsInsightsFilters,
  resolveWorkflowsInsightsFiltersInputAsync,
} from '../../workflow/insights/filters';
import {
  buildWorkflowsInsightsJson,
  buildWorkflowsInsightsTable,
  toWorkflowsInsightsSummary,
} from '../../workflow/insights/formatInsights';
import { granularityForTimespan } from '../../workflow/insights/granularity';
import { withWorkflowsInsightsPlanGateHandlingAsync } from '../../workflow/insights/planGating';

const DEFAULT_WORKFLOWS_LIMIT = 50;
const MAX_WORKFLOWS_LIMIT = 100;

// Insights only cover finished runs, so the other run statuses would never match.
const INSIGHTS_RUN_STATUSES = [
  WorkflowRunStatus.Success,
  WorkflowRunStatus.Failure,
  WorkflowRunStatus.Canceled,
] as const;

export default class WorkflowInsights extends EasCommand {
  static override description =
    'display run counts, success rate, and per-workflow trends for a time range';

  static override flags = {
    workflow: Flags.string({
      description:
        'Only include runs of this workflow file name (can be specified multiple times).',
      multiple: true,
    }),
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
    'git-ref': Flags.string({
      description:
        'Only include runs requested for this git ref, for example main or refs/heads/main.',
    }),
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
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_WORKFLOWS_LIMIT,
      limit: MAX_WORKFLOWS_LIMIT,
      description: `The number of workflows to list. Defaults to ${DEFAULT_WORKFLOWS_LIMIT} and is capped at ${MAX_WORKFLOWS_LIMIT}.`,
    }),
    'project-id': Flags.string({
      description: 'EAS project ID (defaults to the project ID of the current directory)',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  private static loggedInOnlyContextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WorkflowInsights);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const timespan = resolveInsightsTimeRange(flags);
    const granularity = granularityForTimespan(timespan.startTime, timespan.endTime);

    const { projectId, graphqlClient } = await this.resolveProjectContextAsync(
      flags['project-id'],
      nonInteractive
    );

    if (json) {
      enableJsonOutput();
    }

    const filters = await resolveWorkflowsInsightsFiltersInputAsync(
      graphqlClient,
      projectId,
      flags
    );
    const app = await withWorkflowsInsightsPlanGateHandlingAsync(() =>
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

  /**
   * With `--project-id` the command runs outside a project directory, so only the
   * login context is needed.
   */
  private async resolveProjectContextAsync(
    projectIdOverride: string | undefined,
    nonInteractive: boolean
  ): Promise<{ projectId: string; graphqlClient: ExpoGraphqlClient }> {
    if (projectIdOverride) {
      const {
        loggedIn: { graphqlClient },
      } = await this.getContextAsync(
        { contextDefinition: WorkflowInsights.loggedInOnlyContextDefinition },
        { nonInteractive }
      );
      return { projectId: projectIdOverride, graphqlClient };
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowInsights, { nonInteractive });
    return { projectId, graphqlClient };
  }
}
