import chalk from 'chalk';
import indentString from 'indent-string';

import {
  WorkflowDeviceTestCaseInsightsTimeSeriesGranularity,
  WorkflowDeviceTestCaseStatus,
} from '../../graphql/generated';
import {
  AppWithMaestroFlowHistoryObject,
  AppWithMaestroInsightsObject,
} from '../../graphql/queries/WorkflowDeviceTestCaseInsightsQuery';
import { buildRunsOverTimeSection } from '../../insights/formatRunsOverTime';
import {
  InsightsTimespanFields,
  formatTimespan,
  toDateTime,
  toTimespanJson,
} from '../../insights/formatTimespan';
import { formatAppliedFilters } from '../../insights/formatFilters';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';
import renderTextTable from '../../utils/renderTextTable';
import { sanitizeTerminalText, truncate } from '../../utils/terminalText';
import { AppliedMaestroInsightsFilters } from './maestroFilters';
import { MaestroSortDirection, MaestroSortOption } from './maestroSort';
import {
  InsightsMetricSummary,
  formatCountWithTrend,
  formatPercent,
  formatRateWithDelta,
  formatTrend,
  ratePercent,
  toMetricSummary,
} from '../../insights/metrics';

/** Durations are unknown until at least one run in the window reported one. */
export interface NullableMetricSummary {
  current: number | null;
  previous: number | null;
}

/** The Maestro tab's overview tiles. */
export interface MaestroInsightsTotals {
  totalRuns: InsightsMetricSummary;
  passRatePercent: InsightsMetricSummary;
  distinctFlakyFlows: InsightsMetricSummary;
  avgDurationMs: NullableMetricSummary;
}

/** The tiles of one flow's detail view, which shows no previous-period comparison. */
export interface MaestroFlowTotals {
  totalRuns: number;
  passRatePercent: number;
  flakyRuns: number;
  p90DurationMs: number | null;
}

export interface MaestroInsightsBucket {
  start: string;
  passedClean: number;
  flaky: number;
  failed: number;
}

export interface MaestroFlowSummary {
  path: string;
  name: string;
  totalRuns: number;
  passRatePercent: number;
  failed: number;
  flakeRatePercent: number;
  p90DurationMs: number | null;
  lastRunAt: string;
  lastRunStatus: WorkflowDeviceTestCaseStatus;
  lastRunIsFlaky: boolean;
}

export interface MaestroInsightsSummary extends InsightsTimespanFields {
  appFullName: string;
  granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity;
  filters?: AppliedMaestroInsightsFilters;
  totals: MaestroInsightsTotals;
  runsOverTime: MaestroInsightsBucket[];
  flows: MaestroFlowSummary[];
  totalFlows: number;
  hasMoreFlows: boolean;
  sort: { field: MaestroSortOption; direction: MaestroSortDirection };
}

export interface MaestroErrorPatternSummary {
  count: number;
  sampleMessage: string;
}

export interface MaestroRecentRunSummary {
  id: string;
  status: WorkflowDeviceTestCaseStatus;
  isFlaky: boolean;
  durationMs: number | null;
  createdAt: string;
  workflowRunId: string;
  workflowRunName: string;
  gitRef: string | null;
  commitSha: string | null;
}

export interface MaestroFlowHistorySummary extends InsightsTimespanFields {
  appFullName: string;
  flowPath: string;
  granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity;
  filters?: Pick<AppliedMaestroInsightsFilters, 'workflows' | 'gitRef'>;
  totals: MaestroFlowTotals;
  runsOverTime: MaestroInsightsBucket[];
  errorPatterns: MaestroErrorPatternSummary[];
  recentRuns: MaestroRecentRunSummary[];
  totalRecentRuns: number;
  hasMoreRecentRuns: boolean;
}

type OverviewTotalsObject =
  AppWithMaestroInsightsObject['workflowDeviceTestCaseInsights']['totals'];
type FlowTotalsObject = AppWithMaestroFlowHistoryObject['workflowDeviceTestCaseHistory']['totals'];
type BucketObject =
  AppWithMaestroInsightsObject['workflowDeviceTestCaseInsights']['timeSeries'][number];

export function toMaestroInsightsSummary(
  app: AppWithMaestroInsightsObject,
  {
    timespan,
    granularity,
    filters,
    sort,
  }: {
    timespan: InsightsTimespanFields;
    granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity;
    filters?: AppliedMaestroInsightsFilters;
    sort: { field: MaestroSortOption; direction: MaestroSortDirection };
  }
): MaestroInsightsSummary {
  const { totals, timeSeries, tests } = app.workflowDeviceTestCaseInsights;
  return {
    appFullName: app.fullName,
    ...timespan,
    granularity,
    filters,
    totals: toOverviewTotals(totals),
    runsOverTime: timeSeries.map(toBucket),
    flows: tests.edges.map(({ node }) => ({
      path: node.path,
      name: node.name,
      totalRuns: node.totalRuns,
      passRatePercent: ratePercent(node.passedCleanCount + node.flakyCount, node.totalRuns),
      failed: node.failedCount,
      flakeRatePercent: ratePercent(node.flakyCount, node.totalRuns),
      p90DurationMs: node.p90DurationMs ?? null,
      lastRunAt: node.lastRunAt,
      lastRunStatus: node.lastRunStatus,
      lastRunIsFlaky: node.lastRunIsFlaky,
    })),
    totalFlows: tests.totalCount,
    hasMoreFlows: tests.pageInfo.hasNextPage,
    sort,
  };
}

export function toMaestroFlowHistorySummary(
  app: AppWithMaestroFlowHistoryObject,
  {
    flowPath,
    timespan,
    granularity,
    filters,
  }: {
    flowPath: string;
    timespan: InsightsTimespanFields;
    granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity;
    filters?: AppliedMaestroInsightsFilters;
  }
): MaestroFlowHistorySummary {
  const { totals, timeSeries, errorPatterns, recentRuns } = app.workflowDeviceTestCaseHistory;
  return {
    appFullName: app.fullName,
    flowPath,
    ...timespan,
    granularity,
    filters,
    totals: toFlowTotals(totals),
    runsOverTime: timeSeries.map(toBucket),
    errorPatterns: errorPatterns.map(pattern => ({
      count: pattern.count,
      sampleMessage: pattern.sampleMessage,
    })),
    recentRuns: recentRuns.edges.map(({ node }) => ({
      id: node.id,
      status: node.status,
      isFlaky: node.isFlaky,
      durationMs: node.durationMs ?? null,
      createdAt: node.createdAt,
      workflowRunId: node.workflowRunId,
      workflowRunName: node.workflowRunName,
      gitRef: node.gitRef ?? null,
      commitSha: node.commitSha ?? null,
    })),
    totalRecentRuns: recentRuns.totalCount,
    hasMoreRecentRuns: recentRuns.pageInfo.hasNextPage,
  };
}

function toOverviewTotals(totals: OverviewTotalsObject): MaestroInsightsTotals {
  const totalRuns = toMetricSummary(totals.totalRuns);
  const passedClean = toMetricSummary(totals.passedCleanCount);
  const flaky = toMetricSummary(totals.flakyCount);
  return {
    totalRuns,
    passRatePercent: {
      current: ratePercent(passedClean.current + flaky.current, totalRuns.current),
      previous: ratePercent(passedClean.previous + flaky.previous, totalRuns.previous),
    },
    distinctFlakyFlows: toMetricSummary(totals.distinctFlakyTestCount),
    avgDurationMs: {
      current: totals.avgDurationMs.currentValue ?? null,
      previous: totals.avgDurationMs.previousValue ?? null,
    },
  };
}

function toFlowTotals(totals: FlowTotalsObject): MaestroFlowTotals {
  const totalRuns = totals.totalRuns.currentValue;
  const flakyRuns = totals.flakyCount.currentValue;
  return {
    totalRuns,
    passRatePercent: ratePercent(totals.passedCleanCount.currentValue + flakyRuns, totalRuns),
    flakyRuns,
    p90DurationMs: totals.p90DurationMs.currentValue ?? null,
  };
}

function toBucket(bucket: BucketObject): MaestroInsightsBucket {
  return {
    start: bucket.bucketStartAt,
    passedClean: bucket.passedClean,
    flaky: bucket.flaky,
    failed: bucket.failed,
  };
}

export function buildMaestroInsightsJson(summary: MaestroInsightsSummary): object {
  return {
    project: summary.appFullName,
    timespan: toTimespanJson(summary),
    ...(summary.filters ? { filters: summary.filters } : {}),
    totals: summary.totals,
    runsOverTime: { granularity: summary.granularity, buckets: summary.runsOverTime },
    flows: summary.flows,
    totalFlows: summary.totalFlows,
    hasMoreFlows: summary.hasMoreFlows,
    sort: summary.sort,
  };
}

export function buildMaestroFlowHistoryJson(summary: MaestroFlowHistorySummary): object {
  return {
    project: summary.appFullName,
    flow: summary.flowPath,
    timespan: toTimespanJson(summary),
    ...(summary.filters ? { filters: summary.filters } : {}),
    totals: summary.totals,
    runsOverTime: { granularity: summary.granularity, buckets: summary.runsOverTime },
    errorPatterns: summary.errorPatterns,
    recentRuns: summary.recentRuns,
    totalRecentRuns: summary.totalRecentRuns,
    hasMoreRecentRuns: summary.hasMoreRecentRuns,
  };
}

export function buildMaestroInsightsTable(summary: MaestroInsightsSummary): string {
  const sections: string[] = [];

  sections.push(chalk.bold('Maestro insights:'));
  sections.push(
    formatFields([
      { label: 'Project', value: summary.appFullName },
      { label: 'Time range', value: formatTimespan(summary) },
      ...(summary.filters ? [{ label: 'Filters', value: formatFilters(summary.filters) }] : []),
    ])
  );

  sections.push('');
  sections.push(chalk.bold('Overview (compared with the previous period):'));
  sections.push(formatFields(buildOverviewTotalsFields(summary.totals)));

  sections.push(...buildMaestroRunsOverTimeSection(summary.runsOverTime, summary.granularity));

  sections.push('');
  if (summary.flows.length === 0) {
    sections.push(chalk.bold('Flows:'));
    sections.push(chalk.dim('  No flows matched in this time range.'));
  } else {
    const scope = formatListScope(summary.flows.length, summary.totalFlows, summary.hasMoreFlows);
    sections.push(
      chalk.bold(`Flows (${scope}, sorted by ${summary.sort.field} ${summary.sort.direction}):`)
    );
    sections.push('');
    sections.push(indentString(renderFlowsTable(summary.flows), 2));
  }

  return sections.join('\n');
}

export function buildMaestroFlowHistoryTable(summary: MaestroFlowHistorySummary): string {
  const sections: string[] = [];

  sections.push(chalk.bold('Maestro flow insights:'));
  sections.push(
    formatFields([
      { label: 'Project', value: summary.appFullName },
      { label: 'Flow', value: summary.flowPath },
      { label: 'Time range', value: formatTimespan(summary) },
      ...(summary.filters ? [{ label: 'Filters', value: formatFilters(summary.filters) }] : []),
    ])
  );

  sections.push('');
  sections.push(chalk.bold('Overview:'));
  sections.push(formatFields(buildFlowTotalsFields(summary.totals)));

  sections.push(...buildMaestroRunsOverTimeSection(summary.runsOverTime, summary.granularity));

  sections.push('');
  if (summary.errorPatterns.length === 0) {
    sections.push(chalk.bold('Error patterns:'));
    sections.push(chalk.dim('  No failures in this time range.'));
  } else {
    sections.push(chalk.bold(`Error patterns (top ${summary.errorPatterns.length}):`));
    sections.push('');
    sections.push(indentString(renderErrorPatternsTable(summary.errorPatterns), 2));
  }

  sections.push('');
  if (summary.recentRuns.length === 0) {
    sections.push(chalk.bold('Recent runs:'));
    sections.push(
      chalk.dim('  No runs of this flow in this time range. The flow path must match the overview.')
    );
  } else {
    const scope = formatListScope(
      summary.recentRuns.length,
      summary.totalRecentRuns,
      summary.hasMoreRecentRuns
    );
    sections.push(chalk.bold(`Recent runs (${scope}):`));
    sections.push('');
    sections.push(indentString(renderRecentRunsTable(summary.recentRuns), 2));
  }

  return sections.join('\n');
}

function buildOverviewTotalsFields(totals: MaestroInsightsTotals): FormatFieldsItem[] {
  return [
    { label: 'Maestro runs', value: formatCountWithTrend(totals.totalRuns) },
    { label: 'Pass rate', value: formatRateWithDelta(totals.passRatePercent, totals.totalRuns) },
    {
      label: 'Flaky flows',
      value: formatCountWithTrend(totals.distinctFlakyFlows, { lowerIsBetter: true }),
    },
    { label: 'Avg duration', value: formatDurationWithTrend(totals.avgDurationMs) },
  ];
}

function buildFlowTotalsFields(totals: MaestroFlowTotals): FormatFieldsItem[] {
  return [
    { label: 'Maestro runs', value: totals.totalRuns.toLocaleString() },
    {
      label: 'Pass rate',
      value: totals.totalRuns === 0 ? chalk.dim('n/a') : formatPercent(totals.passRatePercent),
    },
    { label: 'Flaky runs', value: totals.flakyRuns.toLocaleString() },
    {
      label: 'P90 duration',
      value:
        totals.p90DurationMs === null ? chalk.dim('n/a') : formatDurationMs(totals.p90DurationMs),
    },
  ];
}

function formatListScope(shown: number, total: number, hasMore: boolean): string {
  return hasMore ? `showing ${shown} of ${total.toLocaleString()}` : `${shown}`;
}

function buildMaestroRunsOverTimeSection(
  buckets: MaestroInsightsBucket[],
  granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity
): string[] {
  return buildRunsOverTimeSection(buckets, granularity, {
    runs: bucket => bucket.passedClean + bucket.flaky + bucket.failed,
    columns: ['Passed', 'Flaky', 'Failed'],
    toRow: bucket => [
      bucket.passedClean.toLocaleString(),
      bucket.flaky.toLocaleString(),
      bucket.failed.toLocaleString(),
    ],
  });
}

function renderFlowsTable(flows: MaestroFlowSummary[]): string {
  return renderTextTable(
    ['Flow', 'Runs', 'Pass rate', 'Fails', 'Flake rate', 'P90', 'Last run', 'Last status'],
    flows.map(flow => [
      flow.path,
      flow.totalRuns.toLocaleString(),
      formatPercent(flow.passRatePercent),
      flow.failed.toLocaleString(),
      formatPercent(flow.flakeRatePercent),
      formatDurationMs(flow.p90DurationMs),
      toDateTime(flow.lastRunAt),
      formatRunStatus(flow.lastRunStatus, flow.lastRunIsFlaky),
    ])
  );
}

function renderErrorPatternsTable(patterns: MaestroErrorPatternSummary[]): string {
  const SAMPLE_MESSAGE_MAX_LENGTH = 100;
  return renderTextTable(
    ['Count', 'Sample message'],
    patterns.map(pattern => [
      pattern.count.toLocaleString(),
      truncate(sanitizeTerminalText(pattern.sampleMessage), SAMPLE_MESSAGE_MAX_LENGTH),
    ])
  );
}

function renderRecentRunsTable(runs: MaestroRecentRunSummary[]): string {
  return renderTextTable(
    ['Started', 'Status', 'Duration', 'Branch', 'Commit', 'Workflow run'],
    runs.map(run => [
      toDateTime(run.createdAt),
      formatRunStatus(run.status, run.isFlaky),
      formatDurationMs(run.durationMs),
      run.gitRef ?? '',
      run.commitSha?.slice(0, 7) ?? '',
      `${run.workflowRunName} (${run.workflowRunId})`,
    ])
  );
}

function formatFilters(filters: AppliedMaestroInsightsFilters): string {
  return formatAppliedFilters([
    ['workflows', filters.workflows],
    ['statuses', filters.statuses],
    ['tags', filters.tags],
    ['search', filters.search],
    ['git ref', filters.gitRef],
  ]);
}

/** A flaky run passed only after a retry, so it is shown as its own state. */
function formatRunStatus(status: WorkflowDeviceTestCaseStatus, isFlaky: boolean): string {
  return isFlaky ? 'FLAKY' : status;
}

/** Matches the dashboard's duration format. */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) {
    // Plain text: this lands in table cells, which renderTextTable pads by string length.
    return 'n/a';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDurationWithTrend(metric: NullableMetricSummary): string {
  if (metric.current === null) {
    return chalk.dim('n/a');
  }
  const trend =
    metric.previous === null
      ? chalk.dim('n/a')
      : formatTrend(
          { current: metric.current, previous: metric.previous },
          { lowerIsBetter: true }
        );
  return `${formatDurationMs(metric.current)} (${trend})`;
}
