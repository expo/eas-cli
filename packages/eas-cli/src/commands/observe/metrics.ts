import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
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
  ObserveClientIdFlag,
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
      description: 'Metric to query (e.g. tti, cold_launch, nav_tti)',
      required: false,
      options: Object.keys(METRIC_ALIASES),
    }),
  };

  static override flags = {
    'all-metrics': Flags.boolean({
      description:
        'Return samples across all metrics instead of a single one. Cannot be combined with a metric argument.',
      default: false,
    }),
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
    ...ObserveClientIdFlag,
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
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveMetrics,
      loggedInOnlyContextDefinition: ObserveMetrics.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive,
    });

    if (json) {
      enableJsonOutput();
    }

    if (args.metric && flags['all-metrics']) {
      throw new EasCommandError(
        '--all-metrics cannot be combined with a metric argument. Pass a metric to filter by it, or pass --all-metrics to return samples across all metrics.'
      );
    }

    // --json alone should not suppress the metric picker: only an explicit
    // --non-interactive flag or a non-interactive terminal (e.g. piped output,
    // CI) does. In those cases we can't prompt, so we default to all metrics
    // rather than erroring out.
    const canPromptForMetric = !flags['non-interactive'] && !!process.stdin.isTTY;

    const ALL_METRICS = '__all__';
    let metricName: string | undefined;
    if (args.metric) {
      metricName = resolveMetricName(args.metric);
    } else if (flags['all-metrics'] || !canPromptForMetric) {
      metricName = undefined;
    } else {
      const choices = [
        { title: 'All metrics', value: ALL_METRICS },
        ...Object.entries(METRIC_SHORT_NAMES).map(([fullName, displayName]) => ({
          title: `${displayName} (${fullName})`,
          value: fullName,
        })),
      ];
      const selected = await selectAsync('Select a metric', choices);
      metricName = selected === ALL_METRICS ? undefined : selected;
    }
    const orderBy = resolveOrderBy(flags.sort);

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    const platform = appObservePlatformFromFlag(flags.platform);
    const platforms = appPlatformsFromFlag(flags.platform);

    // The total-event-count query is per-metric, so it only applies when a
    // single metric is requested.
    const [{ events, pageInfo }, totalEventCount] = await Promise.all([
      fetchObserveEventsAsync(graphqlClient, projectId, {
        ...(metricName && { metricName }),
        orderBy,
        limit: flags.limit ?? DEFAULT_EVENTS_LIMIT,
        ...(flags.after && { after: flags.after }),
        startTime,
        endTime,
        platform,
        appVersion: flags['app-version'],
        updateId: flags['update-id'],
        easClientId: flags['client-id'],
      }),
      metricName
        ? fetchTotalEventCountAsync(
            graphqlClient,
            projectId,
            metricName,
            platforms,
            startTime,
            endTime
          )
        : Promise.resolve(undefined),
    ]);

    if (json) {
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
