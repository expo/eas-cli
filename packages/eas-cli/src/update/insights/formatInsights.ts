import chalk from 'chalk';

import { UpdateWithInsightsObject } from '../../graphql/queries/UpdateInsightsQuery';
import { formatTimespan, toDateOnly } from '../../insights/formatTimespan';
import formatFields from '../../utils/formatFields';
import renderTextTable from '../../utils/renderTextTable';

export interface UpdateInsightsTimespan {
  startTime: string;
  endTime: string;
  daysBack?: number;
}

export interface UpdateInsightsDailyEntry {
  date: string;
  installs: number;
  failedInstalls: number;
}

export interface UpdateInsightsPlatformSummary {
  platform: string;
  updateId: string;
  totalUniqueUsers: number;
  totalInstalls: number;
  totalFailedInstalls: number;
  crashRatePercent: number;
  launchAssetCount: number;
  averageUpdatePayloadBytes: number;
  daily: UpdateInsightsDailyEntry[];
}

export interface UpdateInsightsSummary {
  groupId: string;
  startTime: string;
  endTime: string;
  daysBack?: number;
  platforms: UpdateInsightsPlatformSummary[];
}

export function toUpdateInsightsSummary(
  groupId: string,
  updates: UpdateWithInsightsObject[],
  timespan: UpdateInsightsTimespan
): UpdateInsightsSummary {
  const platforms = updates
    .map(toPlatformSummary)
    .sort((a, b) => a.platform.localeCompare(b.platform));

  return {
    groupId,
    startTime: timespan.startTime,
    endTime: timespan.endTime,
    daysBack: timespan.daysBack,
    platforms,
  };
}

function toPlatformSummary(update: UpdateWithInsightsObject): UpdateInsightsPlatformSummary {
  const { insights } = update;
  const { totalInstalls, totalFailedInstalls } = insights.cumulativeMetrics.metricsAtLastTimestamp;
  const denom = totalInstalls + totalFailedInstalls;
  const crashRatePercent = denom === 0 ? 0 : (totalFailedInstalls / denom) * 100;

  const { labels, installsDataset, failedInstallsDataset } = insights.cumulativeMetrics.data;
  const daily: UpdateInsightsDailyEntry[] = labels.map((date, i) => ({
    date,
    installs: installsDataset.difference[i] ?? 0,
    failedInstalls: failedInstallsDataset.difference[i] ?? 0,
  }));

  return {
    platform: update.platform,
    updateId: update.id,
    totalUniqueUsers: insights.totalUniqueUsers,
    totalInstalls,
    totalFailedInstalls,
    crashRatePercent,
    launchAssetCount: insights.cumulativeAverageMetrics.launchAssetCount,
    averageUpdatePayloadBytes: insights.cumulativeAverageMetrics.averageUpdatePayloadBytes,
    daily,
  };
}

export function buildUpdateInsightsJson(summary: UpdateInsightsSummary): object {
  return {
    groupId: summary.groupId,
    timespan: {
      start: summary.startTime,
      end: summary.endTime,
      ...(summary.daysBack !== undefined ? { daysBack: summary.daysBack } : {}),
    },
    platforms: summary.platforms.map(p => ({
      platform: p.platform,
      updateId: p.updateId,
      totals: {
        uniqueUsers: p.totalUniqueUsers,
        installs: p.totalInstalls,
        failedInstalls: p.totalFailedInstalls,
        crashRatePercent: p.crashRatePercent,
      },
      payload: {
        launchAssetCount: p.launchAssetCount,
        averageUpdatePayloadBytes: p.averageUpdatePayloadBytes,
      },
      daily: p.daily,
    })),
  };
}

export function buildUpdateInsightsTable(summary: UpdateInsightsSummary): string {
  const sections: string[] = [];

  sections.push(chalk.bold('Update group insights:'));
  sections.push(
    formatFields([
      { label: 'Group ID', value: summary.groupId },
      { label: 'Time range', value: formatTimespan(summary) },
      { label: 'Platforms', value: summary.platforms.map(p => p.platform).join(', ') || 'N/A' },
    ])
  );

  const dailyHeader = summary.daysBack ? ` (last ${summary.daysBack} days)` : '';

  for (const platform of summary.platforms) {
    sections.push('');
    sections.push(chalk.bold(`${chalk.cyan(platform.platform)}:`));
    sections.push(
      formatFields([
        { label: 'Update ID', value: platform.updateId },
        { label: 'Launches', value: platform.totalInstalls.toLocaleString() },
        { label: 'Failed launches', value: platform.totalFailedInstalls.toLocaleString() },
        { label: 'Crash rate', value: formatPercent(platform.crashRatePercent) },
        { label: 'Unique users', value: platform.totalUniqueUsers.toLocaleString() },
        { label: 'Launch assets', value: platform.launchAssetCount.toLocaleString() },
        { label: 'Avg payload size', value: formatBytes(platform.averageUpdatePayloadBytes) },
      ])
    );
    if (platform.daily.length > 0) {
      sections.push('');
      sections.push(chalk.bold(`  Daily breakdown${dailyHeader}:`));
      sections.push('');
      sections.push(indent(renderDailyTable(platform.daily), 2));
    }
  }

  return sections.join('\n');
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function renderDailyTable(rows: UpdateInsightsDailyEntry[]): string {
  return renderTextTable(
    ['Date', 'Launches', 'Crashes'],
    rows.map(r => [
      toDateOnly(r.date),
      r.installs.toLocaleString(),
      r.failedInstalls.toLocaleString(),
    ])
  );
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(line => (line.length > 0 ? pad + line : line))
    .join('\n');
}
