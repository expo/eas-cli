import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { AppObservePlatform } from '../../graphql/generated';
import Log from '../../log';
import {
  EventsOrderPreset,
  fetchObserveEventsAsync,
  resolveOrderBy,
} from '../../observe/fetchEvents';
import { METRIC_ALIASES, resolveMetricName } from '../../observe/metricNames';
import { validateDateFlag } from '../../observe/fetchMetrics';
import { buildObserveEventsJson, buildObserveEventsTable } from '../../observe/formatEvents';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { DEFAULT_DAYS_BACK, startAndEndTime } from '../../observe/startAndEndTime';

const DEFAULT_EVENTS_LIMIT = 10;

export default class ObserveEvents extends EasCommand {
  static override hidden = true;
  static override description = 'display individual app performance events ordered by metric value';

  static override args = {
    metric: Args.string({
      description: 'Metric to query (e.g. tti, cold_launch). Defaults to tti.',
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
    platform: Flags.option({
      description: 'Filter by platform',
      options: Object.values(AppObservePlatform).map(s => s.toLowerCase()),
    })(),
    after: Flags.string({
      description:
        'Cursor for pagination. Use the endCursor from a previous query to fetch the next page.',
    }),
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_EVENTS_LIMIT,
      limit: 100,
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
      description: 'Show events from the last N days (mutually exclusive with --start/--end)',
      min: 1,
      exclusive: ['start', 'end'],
    }),
    'app-version': Flags.string({
      description: 'Filter by app version',
    }),
    'update-id': Flags.string({
      description: 'Filter by EAS update ID',
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
    const { flags, args } = await this.parse(ObserveEvents);
    const {
      projectId: contextProjectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveEvents, {
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

    const metricName = resolveMetricName(args.metric ?? 'tti');
    const orderBy = resolveOrderBy(flags.sort);

    const daysBack = flags.days ?? (flags.start ? undefined : DEFAULT_DAYS_BACK);
    const { startTime, endTime } = startAndEndTime({
      daysBack,
      start: flags.start,
      end: flags.end,
    });

    const platform = flags.platform
      ? flags.platform === 'android'
        ? AppObservePlatform.Android
        : AppObservePlatform.Ios
      : undefined;

    const { events, pageInfo } = await fetchObserveEventsAsync(graphqlClient, projectId, {
      metricName,
      orderBy,
      limit: flags.limit ?? DEFAULT_EVENTS_LIMIT,
      ...(flags.after && { after: flags.after }),
      startTime,
      endTime,
      platform,
      appVersion: flags['app-version'],
      updateId: flags['update-id'],
    });

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
        })
      );
    }
  }
}
