import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppObservePlatform, AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import { fetchObserveMetricsAsync, validateDateFlag } from '../../observe/fetchMetrics';
import {
  StatisticKey,
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  resolveStatKey,
} from '../../observe/formatMetrics';
import { METRIC_ALIASES, METRIC_SHORT_NAMES, resolveMetricName } from '../../observe/metricNames';
import { DEFAULT_DAYS_BACK, startAndEndTime } from '../../observe/startAndEndTime';
import { selectAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

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

    if (flags.start) {
      validateDateFlag(flags.start, '--start');
    }
    if (flags.end) {
      validateDateFlag(flags.end, '--end');
    }

    let metricNames: string[];
    if (flags.metric?.length) {
      metricNames = flags.metric.map(resolveMetricName);
    } else if (flags['non-interactive']) {
      throw new EasCommandError(
        'A --metric flag is required in non-interactive mode. Available metrics: ' +
          Object.keys(METRIC_ALIASES).join(', ')
      );
    } else {
      const choices = Object.entries(METRIC_SHORT_NAMES).map(([fullName, displayName]) => ({
        title: `${displayName} (${fullName})`,
        value: fullName,
      }));
      const selected = await selectAsync('Select a metric', choices);
      metricNames = [selected];
    }

    const daysBack = flags['days'] ?? (flags.start ? undefined : DEFAULT_DAYS_BACK);
    const { startTime, endTime } = startAndEndTime({
      daysBack,
      start: flags.start,
      end: flags.end,
    });

    const platforms: AppPlatform[] = flags.platform
      ? [flags.platform === 'android' ? AppPlatform.Android : AppPlatform.Ios]
      : [AppPlatform.Android, AppPlatform.Ios];

    const { metricsMap, buildNumbersMap, updateIdsMap } = await fetchObserveMetricsAsync(
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
      Log.log(
        buildObserveMetricsTable(metricsMap, metricNames, stats, {
          daysBack,
          buildNumbersMap,
          updateIdsMap,
        })
      );
    }
  }
}
