import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppObservePlatform, AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import { fetchObserveMetricsAsync } from '../../observe/fetchMetrics';
import {
  StatisticKey,
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  resolveStatKey,
} from '../../observe/formatMetrics';
import { METRIC_ALIASES, resolveMetricName } from '../../observe/metricNames';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_METRICS = [
  'expo.app_startup.cold_launch_time',
  'expo.app_startup.warm_launch_time',
  'expo.app_startup.tti',
  'expo.app_startup.ttr',
  'expo.app_startup.bundle_load_time',
];

const DEFAULT_STATS_TABLE: StatisticKey[] = ['median', 'eventCount'];
const DEFAULT_STATS_JSON: StatisticKey[] = [
  'min',
  'median',
  'max',
  'average',
  'p80',
  'p90',
  'p99',
  'eventCount',
];

export default class ObserveMetrics extends EasCommand {
  static override hidden = true;
  static override description = 'display app performance metrics grouped by app version';

  static override flags = {
    platform: Flags.option({
      description: 'Filter by platform',
      options: Object.values(AppObservePlatform).map(s => s.toLowerCase()),
    })(),
    metric: Flags.option({
      description: 'Metric name to display (can be specified multiple times).',
      multiple: true,
      options: Object.keys(METRIC_ALIASES),
    })(),
    stat: Flags.option({
      description: 'Statistic to display per metric (can be specified multiple times)',
      multiple: true,
      options: DEFAULT_STATS_JSON,
    })(),
    start: Flags.string({
      description: 'Start of time range for metrics data (ISO date).',
      exclusive: ['days'],
    }),
    end: Flags.string({
      description: 'End of time range for metrics data (ISO date).',
      exclusive: ['days'],
    }),
    days: Flags.integer({
      description: 'Show metrics from the last N days (mutually exclusive with --start/--end)',
      min: 1,
      exclusive: ['start', 'end'],
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

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ObserveMetrics);
    const {
      projectId: contextProjectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveMetrics, {
      nonInteractive: flags['non-interactive'],
    });

    const projectId = flags['project-id'] ?? contextProjectId;

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Observe is in preview and subject to breaking changes.');
    }

    const metricNames = flags.metric?.length
      ? flags.metric.map(resolveMetricName)
      : DEFAULT_METRICS;

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    const platforms: AppPlatform[] = flags.platform
      ? [flags.platform === 'android' ? AppPlatform.Android : AppPlatform.Ios]
      : [AppPlatform.Android, AppPlatform.Ios];

    const { metricsMap, buildNumbersMap, updateIdsMap, totalEventCounts } =
      await fetchObserveMetricsAsync(
        graphqlClient,
        projectId,
        metricNames,
        platforms,
        startTime,
        endTime
      );

    const argumentsStat = flags.stat?.length
      ? Array.from(new Set(flags.stat.map(resolveStatKey)))
      : undefined;

    if (flags.json) {
      const stats: StatisticKey[] = argumentsStat ?? DEFAULT_STATS_JSON;
      printJsonOnlyOutput(
        buildObserveMetricsJson(metricsMap, metricNames, stats, totalEventCounts)
      );
    } else {
      const stats: StatisticKey[] = argumentsStat ?? DEFAULT_STATS_TABLE;
      Log.addNewLineIfNone();
      Log.log(
        buildObserveMetricsTable(metricsMap, metricNames, stats, {
          daysBack,
          buildNumbersMap,
          updateIdsMap,
          totalEventCounts,
        })
      );
    }
  }
}
