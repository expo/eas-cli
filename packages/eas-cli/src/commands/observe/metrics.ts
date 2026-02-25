import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import { fetchObserveMetricsAsync, validateDateFlag } from '../../observe/fetchMetrics';
import {
  StatisticKey,
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  resolveStatKey,
} from '../../observe/formatMetrics';
import { resolveMetricName } from '../../observe/metricNames';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_METRICS = [
  'expo.app_startup.cold_launch_time',
  'expo.app_startup.warm_launch_time',
  'expo.app_startup.tti',
  'expo.app_startup.ttr',
  'expo.app_startup.bundle_load_time',
];

const DEFAULT_DAYS_BACK = 60;

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
  static override description = 'display app performance metrics grouped by app version';

  static override flags = {
    platform: Flags.enum<'android' | 'ios'>({
      description: 'Filter by platform',
      options: ['android', 'ios'],
    }),
    metric: Flags.string({
      description:
        'Metric name to display (can be specified multiple times). Supports aliases: tti, ttr, cold_launch, warm_launch, bundle_load',
      multiple: true,
    }),
    stat: Flags.string({
      description:
        'Statistic to display per metric (can be specified multiple times). Options: min, max, med, avg, p80, p90, p99, count',
      multiple: true,
    }),
    start: Flags.string({
      description: 'Start of time range for metrics data (ISO date).',
      exclusive: ['days-from-now'],
    }),
    end: Flags.string({
      description: 'End of time range for metrics data (ISO date).',
      exclusive: ['days-from-now'],
    }),
    'days-from-now': Flags.integer({
      description: 'Show metrics from the last N days (mutually exclusive with --start/--end)',
      min: 1,
      exclusive: ['start', 'end'],
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
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveMetrics, {
      nonInteractive: flags['non-interactive'],
    });

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Observe is in preview and subject to breaking changes.');
    }

    if (flags.start) {
      validateDateFlag(flags.start, '--start');
    }
    if (flags.end) {
      validateDateFlag(flags.end, '--end');
    }

    const metricNames = flags.metric?.length
      ? flags.metric.map(resolveMetricName)
      : DEFAULT_METRICS;

    let startTime: string;
    let endTime: string;

    if (flags['days-from-now']) {
      endTime = new Date().toISOString();
      startTime = new Date(Date.now() - flags['days-from-now'] * 24 * 60 * 60 * 1000).toISOString();
    } else {
      endTime = flags.end ?? new Date().toISOString();
      startTime =
        flags.start ?? new Date(Date.now() - DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
    }

    const platforms: AppPlatform[] = flags.platform
      ? [flags.platform === 'android' ? AppPlatform.Android : AppPlatform.Ios]
      : [AppPlatform.Android, AppPlatform.Ios];

    const metricsMap = await fetchObserveMetricsAsync(
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
      printJsonOnlyOutput(buildObserveMetricsJson(metricsMap, metricNames, stats));
    } else {
      const stats: StatisticKey[] = argumentsStat ?? DEFAULT_STATS_TABLE;
      Log.addNewLineIfNone();
      Log.log(buildObserveMetricsTable(metricsMap, metricNames, stats));
    }
  }
}
