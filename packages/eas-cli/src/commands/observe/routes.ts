import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import Log from '../../log';
import { fetchObserveNavigationRoutesAsync } from '../../observe/fetchNavigationRoutes';
import {
  ObserveAfterFlag,
  ObserveAppVersionFlag,
  ObservePlatformFlag,
  ObserveProjectIdFlag,
  ObserveTimeRangeFlags,
  ObserveUpdateIdFlag,
} from '../../observe/flags';
import {
  NAVIGATION_METRIC_NAMES,
  NavigationStatKey,
  buildObserveNavigationRoutesJson,
  buildObserveNavigationRoutesTable,
  resolveNavigationStatKey,
} from '../../observe/formatNavigationRoutes';
import { NAVIGATION_METRIC_ALIASES, resolveNavigationMetricName } from '../../observe/metricNames';
import { appPlatformsFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_ROUTES_LIMIT = 50;

const STAT_OPTIONS = ['median', 'med', 'p90', 'count', 'event_count', 'eventCount'];

const DEFAULT_STATS_TABLE: NavigationStatKey[] = ['median', 'count'];
const DEFAULT_STATS_JSON: NavigationStatKey[] = ['median', 'p90', 'count'];

export default class ObserveRoutes extends EasCommand {
  static override description =
    'display app navigation route metrics (Cold TTR, Warm TTR, TTI) grouped by route name';

  static override flags = {
    ...ObservePlatformFlag,
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
    ...ObserveAfterFlag,
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_ROUTES_LIMIT,
      limit: 200,
    }),
    ...ObserveTimeRangeFlags,
    ...ObserveAppVersionFlag,
    ...ObserveUpdateIdFlag,
    'build-number': Flags.string({
      description: 'Filter by app build number',
    }),
    'route-name': Flags.string({
      description:
        'Filter by route name (can be specified multiple times to include several routes)',
      multiple: true,
    }),
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
    }

    const metricNames = flags.metric?.length
      ? Array.from(new Set(flags.metric.map(resolveNavigationMetricName)))
      : NAVIGATION_METRIC_NAMES;

    const argumentsStat = flags.stat?.length
      ? Array.from(new Set(flags.stat.map(resolveNavigationStatKey)))
      : undefined;

    const routeNames = flags['route-name']?.length
      ? Array.from(new Set(flags['route-name']))
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
        routeNames,
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
