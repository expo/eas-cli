import chalk from 'chalk';
import indentString from 'indent-string';

import {
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
  WorkflowsInsightsRunsOverTimeGranularity,
} from '../../graphql/generated';
import { AppWithWorkflowsInsightsObject } from '../../graphql/queries/WorkflowsInsightsQuery';
import {
  InsightsTimespanFields,
  formatTimespan,
  toDateOnly,
  toDateTime,
} from '../../insights/formatTimespan';
import formatFields from '../../utils/formatFields';
import renderTextTable from '../../utils/renderTextTable';

/** The filters as the user typed them, before workflow file names are resolved to IDs. */
export interface AppliedWorkflowsInsightsFilters {
  workflows?: string[];
  statuses?: WorkflowRunStatus[];
  triggerEventTypes?: WorkflowRunTriggerEventType[];
  gitRef?: string;
}

/** A metric for the selected window and for the window of equal length right before it. */
export interface WorkflowsInsightsMetricSummary {
  current: number;
  previous: number;
}

export interface WorkflowsInsightsBucket {
  start: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  canceledRuns: number;
}

export interface WorkflowsInsightsWorkflowSummary {
  workflowId: string;
  fileName: string | null;
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
    totalRuns: WorkflowsInsightsMetricSummary;
    successRatePercent: WorkflowsInsightsMetricSummary;
    activeWorkflows: WorkflowsInsightsMetricSummary;
    failedRuns: WorkflowsInsightsMetricSummary;
  };
  runsOverTime: WorkflowsInsightsBucket[];
  workflows: WorkflowsInsightsWorkflowSummary[];
  hasMoreWorkflows: boolean;
}

const GRANULARITY_PRESENTATION: Record<
  WorkflowsInsightsRunsOverTimeGranularity,
  {
    label: string;
    unitPlural: string;
    columnHeader: string;
    formatBucketStart: (isoTimestamp: string) => string;
  }
> = {
  [WorkflowsInsightsRunsOverTimeGranularity.Minute]: {
    label: 'per minute, UTC',
    unitPlural: 'minutes',
    columnHeader: 'Time',
    formatBucketStart: toDateTime,
  },
  [WorkflowsInsightsRunsOverTimeGranularity.Hour]: {
    label: 'hourly, UTC',
    unitPlural: 'hours',
    columnHeader: 'Time',
    formatBucketStart: toDateTime,
  },
  [WorkflowsInsightsRunsOverTimeGranularity.Day]: {
    label: 'daily, UTC',
    unitPlural: 'days',
    columnHeader: 'Date',
    formatBucketStart: toDateOnly,
  },
};

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
        current: successRatePercent(
          overviewMetrics.successfulRuns.currentValue,
          overviewMetrics.totalRuns.currentValue
        ),
        previous: successRatePercent(
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
      fileName: fileNamesByWorkflowId.get(node.workflowId) ?? null,
      name: node.name,
      totalRuns: node.totalRuns,
      successfulRuns: node.successfulRuns,
      failedRuns: node.failedRuns,
      canceledRuns: node.canceledRuns,
      successRatePercent: successRatePercent(node.successfulRuns, node.totalRuns),
      lastRunAt: node.lastRunAt,
    })),
    hasMoreWorkflows: workflows.pageInfo.hasNextPage,
  };
}

function toMetricSummary(metric: {
  currentValue: number;
  previousValue: number;
}): WorkflowsInsightsMetricSummary {
  return { current: metric.currentValue, previous: metric.previousValue };
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

export function successRatePercent(successfulRuns: number, totalRuns: number): number {
  return totalRuns === 0 ? 0 : (successfulRuns / totalRuns) * 100;
}

export function buildWorkflowsInsightsJson(summary: WorkflowsInsightsSummary): object {
  return {
    project: summary.appFullName,
    timespan: {
      start: summary.startTime,
      end: summary.endTime,
      ...(summary.daysBack !== undefined ? { daysBack: summary.daysBack } : {}),
    },
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
      { label: 'Total runs', value: formatCount(overview.totalRuns) },
      {
        label: 'Success rate',
        value: formatSuccessRate(overview.successRatePercent, overview.totalRuns),
      },
      { label: 'Active workflows', value: formatCount(overview.activeWorkflows) },
      { label: 'Failed runs', value: formatCount(overview.failedRuns, { lowerIsBetter: true }) },
    ])
  );

  const granularity = GRANULARITY_PRESENTATION[summary.granularity];
  // The server fills the whole window with buckets, so a quiet project would print one
  // zero row per day. The JSON output keeps every bucket.
  const bucketsWithRuns = summary.runsOverTime.filter(bucket => bucket.totalRuns > 0);
  if (bucketsWithRuns.length > 0) {
    const omittedNote =
      bucketsWithRuns.length < summary.runsOverTime.length
        ? `; ${granularity.unitPlural} with no runs omitted`
        : '';
    sections.push('');
    sections.push(chalk.bold(`Runs over time (${granularity.label}${omittedNote}):`));
    sections.push('');
    sections.push(indentString(renderRunsOverTimeTable(bucketsWithRuns, granularity), 2));
  }

  sections.push('');
  if (summary.workflows.length === 0) {
    sections.push(chalk.bold('Workflows:'));
    sections.push(chalk.dim('  No workflow runs in this time range.'));
  } else {
    sections.push(
      chalk.bold(
        summary.hasMoreWorkflows
          ? `Workflows (the ${summary.workflows.length} with the most runs):`
          : 'Workflows:'
      )
    );
    sections.push('');
    sections.push(indentString(renderWorkflowsTable(summary.workflows), 2));
  }

  return sections.join('\n');
}

function formatFilters(filters: AppliedWorkflowsInsightsFilters): string {
  const parts: string[] = [];
  if (filters.workflows?.length) {
    parts.push(`workflows: ${filters.workflows.join(', ')}`);
  }
  if (filters.statuses?.length) {
    parts.push(`statuses: ${filters.statuses.join(', ')}`);
  }
  if (filters.triggerEventTypes?.length) {
    parts.push(`triggers: ${filters.triggerEventTypes.join(', ')}`);
  }
  if (filters.gitRef) {
    parts.push(`git ref: ${filters.gitRef}`);
  }
  return parts.join('; ');
}

function formatCount(
  metric: WorkflowsInsightsMetricSummary,
  options?: { lowerIsBetter?: boolean }
): string {
  return `${metric.current.toLocaleString()}  ${formatTrend(metric, options)}`;
}

function formatSuccessRate(
  successRate: WorkflowsInsightsMetricSummary,
  totalRuns: WorkflowsInsightsMetricSummary
): string {
  if (totalRuns.current === 0) {
    return chalk.dim('n/a');
  }
  if (totalRuns.previous === 0) {
    return `${formatPercent(successRate.current)}  ${chalk.dim('n/a')}`;
  }
  const delta = successRate.current - successRate.previous;
  return `${formatPercent(successRate.current)}  ${formatSignedChange(delta, ' pts', delta > 0)}`;
}

/** `n/a` when the previous period had no data, since a change from zero has no meaningful percentage. */
export function formatTrend(
  metric: WorkflowsInsightsMetricSummary,
  { lowerIsBetter = false }: { lowerIsBetter?: boolean } = {}
): string {
  if (metric.previous === 0) {
    return chalk.dim('n/a');
  }
  const pct = ((metric.current - metric.previous) / metric.previous) * 100;
  return formatSignedChange(pct, '%', lowerIsBetter ? pct < 0 : pct > 0);
}

function formatSignedChange(value: number, unit: string, isImprovement: boolean): string {
  if (value === 0) {
    return chalk.dim(`0.0${unit}`);
  }
  const text = `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}${unit}`;
  return isImprovement ? chalk.green(text) : chalk.red(text);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function renderRunsOverTimeTable(
  buckets: WorkflowsInsightsBucket[],
  granularity: (typeof GRANULARITY_PRESENTATION)[WorkflowsInsightsRunsOverTimeGranularity]
): string {
  return renderTextTable(
    [granularity.columnHeader, 'Total', 'Successful', 'Failed', 'Canceled'],
    buckets.map(bucket => [
      granularity.formatBucketStart(bucket.start),
      bucket.totalRuns.toLocaleString(),
      bucket.successfulRuns.toLocaleString(),
      bucket.failedRuns.toLocaleString(),
      bucket.canceledRuns.toLocaleString(),
    ])
  );
}

function renderWorkflowsTable(workflows: WorkflowsInsightsWorkflowSummary[]): string {
  return renderTextTable(
    ['Workflow', 'Runs', 'Successful', 'Failed', 'Canceled', 'Success rate', 'Last run'],
    workflows.map(workflow => [
      workflow.fileName ?? workflow.name,
      workflow.totalRuns.toLocaleString(),
      workflow.successfulRuns.toLocaleString(),
      workflow.failedRuns.toLocaleString(),
      workflow.canceledRuns.toLocaleString(),
      formatPercent(workflow.successRatePercent),
      toDateTime(workflow.lastRunAt),
    ])
  );
}
