import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import Log from '../../log';
import { fetchObserveNavigationRoutesAsync } from '../../observe/fetchNavigationRoutes';
import {
  NAVIGATION_METRIC_NAMES,
  NavigationStatKey,
  buildObserveNavigationRoutesJson,
  buildObserveNavigationRoutesTable,
  resolveNavigationStatKey,
} from '../../observe/formatNavigationRoutes';
import { NAVIGATION_METRIC_ALIASES, resolveNavigationMetricName } from '../../observe/metricNames';
import { allowedPlatformFlagValues, appPlatformsFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_ROUTES_LIMIT = 50;

const STAT_OPTIONS = ['median', 'med', 'p90', 'count', 'event_count', 'eventCount'];

const DEFAULT_STATS_TABLE: NavigationStatKey[] = ['median', 'count'];
const DEFAULT_STATS_JSON: NavigationStatKey[] = ['median', 'p90', 'count'];

export default class ObserveRoutes extends EasCommand {
  static override hidden = true;
  static override description =
    'display app navigation route metrics (Cold TTR, Warm TTR, TTI) grouped by route name';

  static override flags = {
    platform: Flags.option({
      description: 'Filter by platform',
      options: allowedPlatformFlagValues,
    })(),
    metric: Flags.option({
      description:
        'Navigation metric to display (can be specified multiple times). Defaults to all three.',
      multiple: true,
      options: Object.keys(NAVIGATION_METRIC_ALIASES),
    })(),
    stat: Flags.option({
      description: 'Statistic to display per metric (can be specified multiple times)',
      multiple: true,
      options: STAT_OPTIONS,
    })(),
    after: Flags.string({
      description:
        'Cursor for pagination. Use the endCursor from a previous query to fetch the next page.',
    }),
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_ROUTES_LIMIT,
      limit: 200,
    }),
    start: Flags.string({
      description: 'Start of time range (ISO date)',
      exclusive: ['days'],
    }),
    end: Flags.string({
      description: 'End of time range (ISO date)',
      exclusive: ['days'],
    }),
    days: Flags.integer({
      description: 'Show routes from the last N days (mutually exclusive with --start/--end)',
      min: 1,
      exclusive: ['start', 'end'],
    }),
    'app-version': Flags.string({
      description: 'Filter by app version',
    }),
    'update-id': Flags.string({
      description: 'Filter by EAS update ID',
    }),
    'build-number': Flags.string({
      description: 'Filter by app build number',
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

  private static loggedInOnlyContextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ObserveRoutes);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveRoutes,
      loggedInOnlyContextDefinition: ObserveRoutes.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive: flags['non-interactive'],
    });

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Observe is in preview and subject to breaking changes.');
    }

    const metricNames = flags.metric?.length
      ? Array.from(new Set(flags.metric.map(resolveNavigationMetricName)))
      : NAVIGATION_METRIC_NAMES;

    const argumentsStat = flags.stat?.length
      ? Array.from(new Set(flags.stat.map(resolveNavigationStatKey)))
      : undefined;

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);
    const platforms = appPlatformsFromFlag(flags.platform);

    const { routes, pageInfoByPlatform } = await fetchObserveNavigationRoutesAsync(
      graphqlClient,
      projectId,
      {
        startTime,
        endTime,
        platforms,
        limit: flags.limit ?? DEFAULT_ROUTES_LIMIT,
        ...(flags.after && { after: flags.after }),
        appVersion: flags['app-version'],
        updateId: flags['update-id'],
        buildNumber: flags['build-number'],
      }
    );

    if (flags.json) {
      const stats = argumentsStat ?? DEFAULT_STATS_JSON;
      printJsonOnlyOutput(
        buildObserveNavigationRoutesJson(routes, metricNames, stats, pageInfoByPlatform)
      );
    } else {
      const stats = argumentsStat ?? DEFAULT_STATS_TABLE;
      Log.addNewLineIfNone();
      Log.log(
        buildObserveNavigationRoutesTable(routes, metricNames, stats, {
          daysBack,
          startTime,
          endTime,
          pageInfoByPlatform,
        })
      );
    }
  }
}
