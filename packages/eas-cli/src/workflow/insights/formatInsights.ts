import chalk from 'chalk';
import indentString from 'indent-string';

import { WorkflowsInsightsRunsOverTimeGranularity } from '../../graphql/generated';
import { AppWithWorkflowsInsightsObject } from '../../graphql/queries/WorkflowsInsightsQuery';
import { buildRunsOverTimeSection } from '../../insights/formatRunsOverTime';
import {
  InsightsTimespanFields,
  formatTimespan,
  toDateTime,
  toTimespanJson,
} from '../../insights/formatTimespan';
import { formatAppliedFilters } from '../../insights/formatFilters';
import { AppliedWorkflowsInsightsFilters } from './filters';
import formatFields from '../../utils/formatFields';
import renderTextTable from '../../utils/renderTextTable';
import {
  InsightsMetricSummary,
  formatCountWithTrend,
  formatPercent,
  formatRateWithDelta,
  ratePercent,
  toMetricSummary,
} from '../../insights/metrics';

export interface WorkflowsInsightsBucket {
  start: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  canceledRuns: number;
}

export interface WorkflowsInsightsWorkflowSummary {
  workflowId: string;
  fileName: string;
  name: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  canceledRuns: number;
  successRatePercent: number;
  lastRunAt: string;
}

export interface WorkflowsInsightsSummary extends InsightsTimespanFields {
  appFullName: string;
  granularity: WorkflowsInsightsRunsOverTimeGranularity;
  filters?: AppliedWorkflowsInsightsFilters;
  overview: {
    totalRuns: InsightsMetricSummary;
    successRatePercent: InsightsMetricSummary;
    activeWorkflows: InsightsMetricSummary;
    failedRuns: InsightsMetricSummary;
  };
  runsOverTime: WorkflowsInsightsBucket[];
  workflows: WorkflowsInsightsWorkflowSummary[];
  hasMoreWorkflows: boolean;
}

// Dataset ids assigned by the server's `runsOverTime` resolver.
const RUNS_OVER_TIME_DATASET_IDS = {
  total: 'WorkflowsInsightsRunsOverTimeDataset:total',
  success: 'WorkflowsInsightsRunsOverTimeDataset:success',
  failure: 'WorkflowsInsightsRunsOverTimeDataset:failure',
  canceled: 'WorkflowsInsightsRunsOverTimeDataset:canceled',
};

export function toWorkflowsInsightsSummary(
  app: AppWithWorkflowsInsightsObject,
  {
    timespan,
    granularity,
    filters,
  }: {
    timespan: InsightsTimespanFields;
    granularity: WorkflowsInsightsRunsOverTimeGranularity;
    filters?: AppliedWorkflowsInsightsFilters;
  }
): WorkflowsInsightsSummary {
  const { overviewMetrics, runsOverTime, workflows } = app.workflowsInsights;
  // Insights rows carry the workflow's YAML name, which is neither unique nor what
  // `--workflow` accepts, so the table is keyed by file name instead.
  const fileNamesByWorkflowId = new Map(app.workflows.map(w => [w.id, w.fileName]));

  return {
    appFullName: app.fullName,
    ...timespan,
    granularity,
    filters,
    overview: {
      totalRuns: toMetricSummary(overviewMetrics.totalRuns),
      successRatePercent: {
        current: ratePercent(
          overviewMetrics.successfulRuns.currentValue,
          overviewMetrics.totalRuns.currentValue
        ),
        previous: ratePercent(
          overviewMetrics.successfulRuns.previousValue,
          overviewMetrics.totalRuns.previousValue
        ),
      },
      activeWorkflows: toMetricSummary(overviewMetrics.activeWorkflows),
      failedRuns: toMetricSummary(overviewMetrics.failedRuns),
    },
    runsOverTime: toBuckets(runsOverTime.lineChart),
    workflows: workflows.edges.map(({ node }) => ({
      workflowId: node.workflowId,
      fileName: fileNamesByWorkflowId.get(node.workflowId) ?? node.workflowId,
      name: node.name,
      totalRuns: node.totalRuns,
      successfulRuns: node.successfulRuns,
      failedRuns: node.failedRuns,
      canceledRuns: node.canceledRuns,
      successRatePercent: ratePercent(node.successfulRuns, node.totalRuns),
      lastRunAt: node.lastRunAt,
    })),
    hasMoreWorkflows: workflows.pageInfo.hasNextPage,
  };
}

function toBuckets(lineChart: {
  labels: string[];
  datasets: { id: string; data: (number | null)[] }[];
}): WorkflowsInsightsBucket[] {
  const dataset = (id: string): (number | null)[] => {
    const match = lineChart.datasets.find(d => d.id === id);
    if (!match) {
      throw new Error(`Workflows insights response is missing the "${id}" dataset.`);
    }
    return match.data;
  };
  const total = dataset(RUNS_OVER_TIME_DATASET_IDS.total);
  const success = dataset(RUNS_OVER_TIME_DATASET_IDS.success);
  const failure = dataset(RUNS_OVER_TIME_DATASET_IDS.failure);
  const canceled = dataset(RUNS_OVER_TIME_DATASET_IDS.canceled);

  return lineChart.labels.map((start, i) => ({
    start,
    totalRuns: total[i] ?? 0,
    successfulRuns: success[i] ?? 0,
    failedRuns: failure[i] ?? 0,
    canceledRuns: canceled[i] ?? 0,
  }));
}

export function buildWorkflowsInsightsJson(summary: WorkflowsInsightsSummary): object {
  return {
    project: summary.appFullName,
    timespan: toTimespanJson(summary),
    ...(summary.filters ? { filters: summary.filters } : {}),
    overview: summary.overview,
    runsOverTime: {
      granularity: summary.granularity,
      buckets: summary.runsOverTime,
    },
    workflows: summary.workflows,
    hasMoreWorkflows: summary.hasMoreWorkflows,
  };
}

export function buildWorkflowsInsightsTable(summary: WorkflowsInsightsSummary): string {
  const sections: string[] = [];

  sections.push(chalk.bold('Workflows insights:'));
  sections.push(
    formatFields([
      { label: 'Project', value: summary.appFullName },
      { label: 'Time range', value: formatTimespan(summary) },
      ...(summary.filters ? [{ label: 'Filters', value: formatFilters(summary.filters) }] : []),
    ])
  );

  const { overview } = summary;
  sections.push('');
  sections.push(chalk.bold('Overview (compared with the previous period):'));
  sections.push(
    formatFields([
      { label: 'Total runs', value: formatCountWithTrend(overview.totalRuns) },
      {
        label: 'Success rate',
        value: formatRateWithDelta(overview.successRatePercent, overview.totalRuns),
      },
      { label: 'Active workflows', value: formatCountWithTrend(overview.activeWorkflows) },
      {
        label: 'Failed runs',
        value: formatCountWithTrend(overview.failedRuns, { lowerIsBetter: true }),
      },
    ])
  );

  sections.push(
    ...buildRunsOverTimeSection(summary.runsOverTime, summary.granularity, {
      runs: bucket => bucket.totalRuns,
      columns: ['Total', 'Successful', 'Failed', 'Canceled'],
      toRow: bucket => [
        bucket.totalRuns.toLocaleString(),
        bucket.successfulRuns.toLocaleString(),
        bucket.failedRuns.toLocaleString(),
        bucket.canceledRuns.toLocaleString(),
      ],
    })
  );

  sections.push('');
  if (summary.workflows.length === 0) {
    sections.push(chalk.bold('Workflows:'));
    sections.push(chalk.dim('  No workflow runs in this time range.'));
  } else {
    sections.push(
      chalk.bold(
        summary.hasMoreWorkflows
          ? `Workflows (showing the ${summary.workflows.length} with the most runs):`
          : 'Workflows:'
      )
    );
    sections.push('');
    sections.push(indentString(renderWorkflowsTable(summary.workflows), 2));
  }

  return sections.join('\n');
}

function formatFilters(filters: AppliedWorkflowsInsightsFilters): string {
  return formatAppliedFilters([
    ['workflows', filters.workflows],
    ['statuses', filters.statuses],
    ['triggers', filters.triggerEventTypes],
    ['git ref', filters.gitRef],
  ]);
}

function renderWorkflowsTable(workflows: WorkflowsInsightsWorkflowSummary[]): string {
  return renderTextTable(
    ['Workflow', 'Runs', 'Successful', 'Failed', 'Canceled', 'Success rate', 'Last run'],
    workflows.map(workflow => [
      workflow.fileName,
      workflow.totalRuns.toLocaleString(),
      workflow.successfulRuns.toLocaleString(),
      workflow.failedRuns.toLocaleString(),
      workflow.canceledRuns.toLocaleString(),
      formatPercent(workflow.successRatePercent),
      toDateTime(workflow.lastRunAt),
    ])
  );
}
