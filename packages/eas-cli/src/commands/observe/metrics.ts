import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
} from '../../commandUtils/pagination';
import { AppPlatform, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import {
  DEFAULT_DAYS_BACK,
  DEFAULT_BUILDS_LIMIT,
  DEFAULT_METRICS,
  fetchObserveMetricsAsync,
  validateDateFlag,
  MAX_BUILDS_LIMIT,
} from '../../observe/fetchMetrics';
import {
  DEFAULT_STATS_JSON,
  DEFAULT_STATS_TABLE,
  StatisticKey,
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  resolveStatKey,
} from '../../observe/formatMetrics';
import { resolveMetricName } from '../../observe/metricNames';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ObserveMetrics extends EasCommand {
  static override description = 'display app performance metrics grouped by recent builds';

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
      description:
        'Start of time range for metrics data (ISO date). Does not filter build selection.',
      exclusive: ['days-from-now'],
    }),
    end: Flags.string({
      description:
        'End of time range for metrics data (ISO date). Does not filter build selection.',
      exclusive: ['days-from-now'],
    }),
    'days-from-now': Flags.integer({
      description: 'Show metrics from the last N days (mutually exclusive with --start/--end)',
      min: 1,
      exclusive: ['start', 'end'],
    }),
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_BUILDS_LIMIT,
      limit: MAX_BUILDS_LIMIT,
      description: `The number of most recent finished builds to fetch (not filtered by --start/--end). Defaults to ${DEFAULT_BUILDS_LIMIT} and is capped at ${MAX_BUILDS_LIMIT}.`,
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

    const platformFilter = flags.platform
      ? flags.platform === 'android'
        ? AppPlatform.Android
        : AppPlatform.Ios
      : undefined;

    // TODO @ubax: builds are fetched independently of --start/--end; ideally we should also
    // filter builds by the requested time range so irrelevant builds aren't included.
    const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      limit: flags.limit ?? DEFAULT_BUILDS_LIMIT,
      offset: flags.offset ?? 0,
      filter: {
        status: BuildStatus.Finished,
        ...(platformFilter ? { platform: platformFilter } : {}),
      },
    });

    if (builds.length === 0) {
      if (flags.json) {
        printJsonOnlyOutput([]);
      } else {
        Log.warn('No finished builds found.');
      }
      return;
    }

    const platformsInBuilds = new Set(builds.map(b => b.platform));

    const metricsMap = await fetchObserveMetricsAsync(
      graphqlClient,
      projectId,
      metricNames,
      platformsInBuilds,
      startTime,
      endTime
    );

    const argumentsStat = flags.stat?.length
      ? Array.from(new Set(flags.stat.map(resolveStatKey)))
      : undefined;

    if (flags.json) {
      const stats: StatisticKey[] = argumentsStat ?? DEFAULT_STATS_JSON;
      printJsonOnlyOutput(buildObserveMetricsJson(builds, metricsMap, metricNames, stats));
    } else {
      const stats: StatisticKey[] = argumentsStat ?? DEFAULT_STATS_TABLE;
      Log.addNewLineIfNone();
      Log.log(buildObserveMetricsTable(builds, metricsMap, metricNames, stats));
    }
  }
}
