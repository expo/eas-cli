import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppPlatform, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import {
  DEFAULT_DAYS_BACK,
  DEFAULT_LIMIT,
  DEFAULT_METRICS,
  fetchObserveMetricsAsync,
  validateDateFlag,
} from '../../observe/fetchMetrics';
import { buildObserveMetricsJson, buildObserveMetricsTable } from '../../observe/formatMetrics';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ObserveMetrics extends EasCommand {
  static override description = 'display app performance metrics grouped by recent builds';

  static override flags = {
    platform: Flags.enum<'android' | 'ios'>({
      description: 'Filter by platform',
      options: ['android', 'ios'],
    }),
    metric: Flags.string({
      description: 'Metric name to display (can be specified multiple times)',
      multiple: true,
    }),
    start: Flags.string({
      description: 'Start of time range (ISO date)',
    }),
    end: Flags.string({
      description: 'End of time range (ISO date)',
    }),
    limit: Flags.integer({
      description: 'Number of builds to show',
      default: DEFAULT_LIMIT,
      min: 1,
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

    const metricNames = flags.metric?.length ? flags.metric : DEFAULT_METRICS;

    const endTime = flags.end ?? new Date().toISOString();
    const startTime =
      flags.start ??
      new Date(Date.now() - DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();

    const platformFilter = flags.platform
      ? flags.platform === 'android'
        ? AppPlatform.Android
        : AppPlatform.Ios
      : undefined;

    const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      limit: flags.limit ?? DEFAULT_LIMIT,
      offset: 0,
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

    if (flags.json) {
      printJsonOnlyOutput(buildObserveMetricsJson(builds, metricsMap, metricNames));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildObserveMetricsTable(builds, metricsMap, metricNames));
    }
  }
}
