import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import Log from '../../log';
import { fetchObserveMetricsAsync } from '../../observe/fetchMetrics';
import {
  ObservePlatformFlag,
  ObserveProjectIdFlag,
  ObserveTimeRangeFlags,
} from '../../observe/flags';
import {
  StatisticKey,
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  resolveStatKey,
} from '../../observe/formatMetrics';
import { METRIC_ALIASES, resolveMetricName } from '../../observe/metricNames';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { appPlatformsFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
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

export default class ObserveMetricsSummary extends EasCommand {
  static override description =
    'display aggregated performance metric statistics grouped by app version';

  static override flags = {
    ...ObservePlatformFlag,
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
    ...ObserveTimeRangeFlags,
    ...ObserveProjectIdFlag,
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
    const { flags } = await this.parse(ObserveMetricsSummary);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveMetricsSummary,
      loggedInOnlyContextDefinition: ObserveMetricsSummary.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive,
    });

    if (json) {
      enableJsonOutput();
    }

    const metricNames = flags.metric?.length
      ? flags.metric.map(resolveMetricName)
      : DEFAULT_METRICS;

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    const platforms = appPlatformsFromFlag(flags.platform);

    const { metricsMap, buildNumbersMap, updateIdsMap, totalEventCounts } =
      await withObservePlanGateHandlingAsync(() =>
        fetchObserveMetricsAsync(
          graphqlClient,
          projectId,
          metricNames,
          platforms,
          startTime,
          endTime
        )
      );

    const argumentsStat = flags.stat?.length
      ? Array.from(new Set(flags.stat.map(resolveStatKey)))
      : undefined;

    if (json) {
      const stats: StatisticKey[] = argumentsStat ?? DEFAULT_STATS_JSON;
      printJsonOnlyOutput(
        buildObserveMetricsJson(
          metricsMap,
          metricNames,
          stats,
          totalEventCounts,
          buildNumbersMap,
          updateIdsMap
        )
      );
    } else {
      const stats: StatisticKey[] = argumentsStat ?? DEFAULT_STATS_TABLE;
      Log.addNewLineIfNone();
      Log.log(
        buildObserveMetricsTable(metricsMap, metricNames, stats, {
          daysBack,
          buildNumbersMap,
          totalEventCounts,
        })
      );
    }
  }
}
