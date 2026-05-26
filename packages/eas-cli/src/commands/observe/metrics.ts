import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import Log from '../../log';
import {
  EventsOrderPreset,
  fetchObserveEventsAsync,
  fetchTotalEventCountAsync,
  resolveOrderBy,
} from '../../observe/fetchEvents';
import {
  ObserveAfterFlag,
  ObserveAppVersionFlag,
  ObservePlatformFlag,
  ObserveProjectIdFlag,
  ObserveTimeRangeFlags,
  ObserveUpdateIdFlag,
} from '../../observe/flags';
import { METRIC_ALIASES, METRIC_SHORT_NAMES, resolveMetricName } from '../../observe/metricNames';
import { buildObserveEventsJson, buildObserveEventsTable } from '../../observe/formatEvents';
import { appObservePlatformFromFlag, appPlatformsFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { selectAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_EVENTS_LIMIT = 10;

export default class ObserveMetrics extends EasCommand {
  static override description = 'display individual performance metric samples ordered by value';

  static override args = {
    metric: Args.string({
      description: 'Metric to query (e.g. tti, cold_launch)',
      required: false,
      options: Object.keys(METRIC_ALIASES),
    }),
  };

  static override flags = {
    sort: Flags.option({
      description: 'Sort order for events',
      options: Object.values(EventsOrderPreset).map(s => s.toLowerCase()),
      required: false,
      default: EventsOrderPreset.Oldest.valueOf().toLowerCase(),
    })(),
    ...ObservePlatformFlag,
    ...ObserveAfterFlag,
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_EVENTS_LIMIT,
      limit: 100,
    }),
    ...ObserveTimeRangeFlags,
    ...ObserveAppVersionFlag,
    ...ObserveUpdateIdFlag,
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
    const { flags, args } = await this.parse(ObserveMetrics);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveMetrics,
      loggedInOnlyContextDefinition: ObserveMetrics.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive: flags['non-interactive'],
    });

    if (flags.json) {
      enableJsonOutput();
    }

    let metricName: string;
    if (args.metric) {
      metricName = resolveMetricName(args.metric);
    } else if (flags['non-interactive']) {
      throw new EasCommandError(
        'A metric argument is required in non-interactive mode. Available metrics: ' +
          Object.keys(METRIC_ALIASES).join(', ')
      );
    } else {
      const choices = Object.entries(METRIC_SHORT_NAMES).map(([fullName, displayName]) => ({
        title: `${displayName} (${fullName})`,
        value: fullName,
      }));
      metricName = await selectAsync('Select a metric', choices);
    }
    const orderBy = resolveOrderBy(flags.sort);

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    const platform = appObservePlatformFromFlag(flags.platform);
    const platforms = appPlatformsFromFlag(flags.platform);

    const [{ events, pageInfo }, totalEventCount] = await Promise.all([
      fetchObserveEventsAsync(graphqlClient, projectId, {
        metricName,
        orderBy,
        limit: flags.limit ?? DEFAULT_EVENTS_LIMIT,
        ...(flags.after && { after: flags.after }),
        startTime,
        endTime,
        platform,
        appVersion: flags['app-version'],
        updateId: flags['update-id'],
      }),
      fetchTotalEventCountAsync(
        graphqlClient,
        projectId,
        metricName,
        platforms,
        startTime,
        endTime
      ),
    ]);

    if (flags.json) {
      printJsonOnlyOutput(buildObserveEventsJson(events, pageInfo));
    } else {
      Log.addNewLineIfNone();
      Log.log(
        buildObserveEventsTable(events, pageInfo, {
          metricName,
          daysBack,
          startTime,
          endTime,
          totalEventCount,
        })
      );
    }
  }
}
