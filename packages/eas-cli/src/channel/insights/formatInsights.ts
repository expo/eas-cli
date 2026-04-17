import chalk from 'chalk';

import { ChannelRuntimeInsights } from '../../graphql/queries/ChannelInsightsQuery';
import { formatTimespan } from '../../insights/formatTimespan';
import formatFields from '../../utils/formatFields';
import renderTextTable from '../../utils/renderTextTable';

export interface ChannelInsightsTimespan {
  startTime: string;
  endTime: string;
  daysBack?: number;
}

export interface ChannelMostPopularUpdate {
  rank: number;
  groupId: string;
  message: string | null;
  platform: string;
  totalUniqueUsers: number;
}

export interface ChannelInsightsSummary {
  channelName: string;
  runtimeVersion: string;
  startTime: string;
  endTime: string;
  daysBack?: number;
  embeddedUpdateTotalUniqueUsers: number;
  otaTotalUniqueUsers: number;
  mostPopularUpdates: ChannelMostPopularUpdate[];
  cumulativeMetricsAtLastTimestamp: { id: string; label: string; data: number }[];
  uniqueUsersOverTime: {
    labels: string[];
    datasets: { id: string; label: string; data: (number | null)[] }[];
  };
  cumulativeMetricsOverTime: {
    labels: string[];
    datasets: { id: string; label: string; data: (number | null)[] }[];
  };
}

export function toChannelInsightsSummary(
  channelName: string,
  runtimeVersion: string,
  insights: ChannelRuntimeInsights,
  timespan: ChannelInsightsTimespan
): ChannelInsightsSummary {
  const mostPopular: ChannelMostPopularUpdate[] = insights.mostPopularUpdates.map((u, i) => ({
    rank: i + 1,
    groupId: u.group,
    message: u.message ?? null,
    platform: u.platform,
    totalUniqueUsers: u.insights.totalUniqueUsers,
  }));

  const otaTotalUniqueUsers = mostPopular.reduce((sum, u) => sum + u.totalUniqueUsers, 0);

  return {
    channelName,
    runtimeVersion,
    startTime: timespan.startTime,
    endTime: timespan.endTime,
    daysBack: timespan.daysBack,
    embeddedUpdateTotalUniqueUsers: insights.embeddedUpdateTotalUniqueUsers,
    otaTotalUniqueUsers,
    mostPopularUpdates: mostPopular,
    cumulativeMetricsAtLastTimestamp: insights.cumulativeMetricsOverTime.metricsAtLastTimestamp.map(
      m => ({ id: m.id, label: m.label, data: m.data })
    ),
    uniqueUsersOverTime: {
      labels: insights.uniqueUsersOverTime.data.labels,
      datasets: insights.uniqueUsersOverTime.data.datasets.map(d => ({
        id: d.id,
        label: d.label,
        data: d.data,
      })),
    },
    cumulativeMetricsOverTime: {
      labels: insights.cumulativeMetricsOverTime.data.labels,
      datasets: insights.cumulativeMetricsOverTime.data.datasets.map(d => ({
        id: d.id,
        label: d.label,
        data: d.data,
      })),
    },
  };
}

export function buildChannelInsightsJson(summary: ChannelInsightsSummary): object {
  return {
    channel: summary.channelName,
    runtimeVersion: summary.runtimeVersion,
    timespan: {
      start: summary.startTime,
      end: summary.endTime,
      ...(summary.daysBack !== undefined ? { daysBack: summary.daysBack } : {}),
    },
    embeddedUpdateTotalUniqueUsers: summary.embeddedUpdateTotalUniqueUsers,
    otaTotalUniqueUsers: summary.otaTotalUniqueUsers,
    mostPopularUpdates: summary.mostPopularUpdates,
    cumulativeMetricsAtLastTimestamp: summary.cumulativeMetricsAtLastTimestamp,
    uniqueUsersOverTime: summary.uniqueUsersOverTime,
    cumulativeMetricsOverTime: summary.cumulativeMetricsOverTime,
  };
}

export function buildChannelInsightsTable(summary: ChannelInsightsSummary): string {
  const sections: string[] = [];

  sections.push(chalk.bold('Channel insights:'));
  sections.push(
    formatFields([
      { label: 'Channel', value: summary.channelName },
      { label: 'Runtime version', value: summary.runtimeVersion },
      { label: 'Time range', value: formatTimespan(summary) },
      {
        label: 'Embedded update users',
        value: summary.embeddedUpdateTotalUniqueUsers.toLocaleString(),
      },
      { label: 'OTA update users', value: summary.otaTotalUniqueUsers.toLocaleString() },
    ])
  );

  if (summary.cumulativeMetricsAtLastTimestamp.length > 0) {
    sections.push('');
    sections.push(chalk.bold('Cumulative metrics at last timestamp:'));
    sections.push(
      formatFields(
        summary.cumulativeMetricsAtLastTimestamp.map(m => ({
          label: m.label,
          value: m.data.toLocaleString(),
        }))
      )
    );
  }

  if (summary.mostPopularUpdates.length > 0) {
    sections.push('');
    sections.push(chalk.bold(`Most popular updates${formatTrailingTimespan(summary)}:`));
    sections.push(renderMostPopularTable(summary.mostPopularUpdates));
  } else {
    sections.push('');
    sections.push(chalk.yellow('No update launches recorded for this channel and runtime.'));
  }

  return sections.join('\n');
}

function formatTrailingTimespan(summary: ChannelInsightsSummary): string {
  return summary.daysBack ? ` (last ${summary.daysBack} days)` : '';
}

function renderMostPopularTable(rows: ChannelMostPopularUpdate[]): string {
  return renderTextTable(
    ['#', 'Group ID', 'Platform', 'Unique users', 'Message'],
    rows.map(r => [
      String(r.rank),
      r.groupId,
      r.platform,
      r.totalUniqueUsers.toLocaleString(),
      r.message ?? '',
    ])
  );
}
