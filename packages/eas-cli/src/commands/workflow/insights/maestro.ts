import { Flags } from '@oclif/core';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  EasProjectIdFlag,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../../commandUtils/pagination';
import { WorkflowDeviceTestCaseInsightsQuery } from '../../../graphql/queries/WorkflowDeviceTestCaseInsightsQuery';
import { InsightsTimeRangeFlags, resolveInsightsTimeRange } from '../../../insights/timeRange';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import { WorkflowsInsightsSharedFilterFlags } from '../../../workflow/insights/filters';
import {
  buildMaestroFlowHistoryJson,
  buildMaestroFlowHistoryTable,
  buildMaestroInsightsJson,
  buildMaestroInsightsTable,
  toMaestroFlowHistorySummary,
  toMaestroInsightsSummary,
} from '../../../workflow/insights/formatMaestroInsights';
import { alignMaestroInsightsTimespan } from '../../../workflow/insights/granularity';
import {
  MAESTRO_STATUS_OPTIONS,
  getAppliedMaestroInsightsFilters,
  resolveMaestroHistoryFiltersInputAsync,
  resolveMaestroInsightsFiltersInputAsync,
} from '../../../workflow/insights/maestroFilters';
import {
  MAESTRO_SORT_DIRECTIONS,
  MAESTRO_SORT_OPTIONS,
  SORT_DIRECTION_BY_OPTION,
  SORT_FIELD_BY_OPTION,
} from '../../../workflow/insights/maestroSort';
import { withInsightsPlanGateHandlingAsync } from '../../../workflow/insights/planGating';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ERROR_PATTERNS_LIMIT = 5;

// These only shape the flows table, so they cannot be combined with a single flow's history.
const OVERVIEW_ONLY_FLAGS = ['status', 'tag', 'search', 'sort', 'sort-direction'];

export default class WorkflowInsightsMaestro extends EasCommand {
  static override description =
    "display Maestro test insights for a time range: pass and flake rates, per-flow stats, and a single flow's history";

  static override flags = {
    ...WorkflowsInsightsSharedFilterFlags,
    status: Flags.option({
      description:
        'Only include flow runs with this status (can be specified multiple times). PASSED means passed on the first attempt.',
      options: MAESTRO_STATUS_OPTIONS,
      multiple: true,
      exclusive: ['flow'],
    })(),
    tag: Flags.string({
      description: 'Only include flow runs with this tag (can be specified multiple times).',
      multiple: true,
      exclusive: ['flow'],
    }),
    search: Flags.string({
      description: 'Only list flows whose path contains this text.',
      exclusive: ['flow'],
    }),
    sort: Flags.option({
      description: 'Sort the flows table by this column.',
      options: MAESTRO_SORT_OPTIONS,
      default: 'fails',
      exclusive: ['flow'],
    })(),
    'sort-direction': Flags.option({
      description: 'Sort direction for the flows table.',
      options: MAESTRO_SORT_DIRECTIONS,
      default: 'desc',
      exclusive: ['flow'],
    })(),
    flow: Flags.string({
      description: `Show one flow's history instead of the overview, by flow path. Cannot be combined with ${OVERVIEW_ONLY_FLAGS.map(
        flag => `--${flag}`
      ).join(', ')}.`,
      exclusive: OVERVIEW_ONLY_FLAGS,
    }),
    ...InsightsTimeRangeFlags,
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_LIMIT,
      limit: MAX_LIMIT,
      description: `The number of flows to list, or of recent runs with --flow. Defaults to ${DEFAULT_LIMIT} and is capped at ${MAX_LIMIT}.`,
    }),
    ...EasProjectIdFlag,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WorkflowInsightsMaestro);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (json) {
      enableJsonOutput();
    }

    const { timespan, granularity } = alignMaestroInsightsTimespan(resolveInsightsTimeRange(flags));

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowInsightsMaestro, {
      nonInteractive,
      projectIdOverride: flags['project-id'],
    });

    const appliedFilters = getAppliedMaestroInsightsFilters(flags);
    const limit = flags.limit ?? DEFAULT_LIMIT;

    if (flags.flow !== undefined) {
      const flowPath = flags.flow;
      const filters = await resolveMaestroHistoryFiltersInputAsync(graphqlClient, projectId, flags);
      const app = await withInsightsPlanGateHandlingAsync(() =>
        WorkflowDeviceTestCaseInsightsQuery.historyByAppIdAsync(graphqlClient, {
          appId: projectId,
          path: flowPath,
          startTime: timespan.startTime,
          endTime: timespan.endTime,
          filters,
          granularity,
          errorPatternsFirst: ERROR_PATTERNS_LIMIT,
          recentRunsFirst: limit,
        })
      );
      const summary = toMaestroFlowHistorySummary(app, {
        flowPath,
        timespan,
        granularity,
        filters: appliedFilters,
      });
      if (json) {
        printJsonOnlyOutput(buildMaestroFlowHistoryJson(summary));
      } else {
        Log.addNewLineIfNone();
        Log.log(buildMaestroFlowHistoryTable(summary));
      }
      return;
    }

    const filters = await resolveMaestroInsightsFiltersInputAsync(graphqlClient, projectId, flags);
    const sort = { field: flags.sort, direction: flags['sort-direction'] };
    const app = await withInsightsPlanGateHandlingAsync(() =>
      WorkflowDeviceTestCaseInsightsQuery.insightsByAppIdAsync(graphqlClient, {
        appId: projectId,
        startTime: timespan.startTime,
        endTime: timespan.endTime,
        filters,
        granularity,
        sortField: SORT_FIELD_BY_OPTION[sort.field],
        sortDirection: SORT_DIRECTION_BY_OPTION[sort.direction],
        search: flags.search,
        first: limit,
      })
    );
    const summary = toMaestroInsightsSummary(app, {
      timespan,
      granularity,
      filters: appliedFilters,
      sort,
    });
    if (json) {
      printJsonOnlyOutput(buildMaestroInsightsJson(summary));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildMaestroInsightsTable(summary));
    }
  }
}
