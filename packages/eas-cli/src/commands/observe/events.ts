import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { AppObservePlatform } from '../../graphql/generated';
import Log from '../../log';
import {
  type EventsOrderPreset,
  fetchObserveEventsAsync,
  resolveOrderBy,
} from '../../observe/fetchEvents';
import { resolveMetricName } from '../../observe/metricNames';
import { validateDateFlag } from '../../observe/fetchMetrics';
import { buildObserveEventsJson, buildObserveEventsTable } from '../../observe/formatEvents';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_EVENTS_LIMIT = 10;
const DEFAULT_DAYS_BACK = 60;

export default class ObserveEvents extends EasCommand {
  static override description = 'display individual app performance events ordered by metric value';

  static override flags = {
    metric: Flags.string({
      description:
        'Metric to query (full name or alias: tti, ttr, cold_launch, warm_launch, bundle_load)',
      required: true,
    }),
    sort: Flags.enum<EventsOrderPreset>({
      description: 'Sort order for events',
      options: ['slowest', 'fastest', 'newest', 'oldest'],
      default: 'slowest',
    }),
    platform: Flags.enum<'android' | 'ios'>({
      description: 'Filter by platform',
      options: ['android', 'ios'],
    }),
    after: Flags.string({
      description:
        'Cursor for pagination. Use the endCursor from a previous query to fetch the next page.',
    }),
    limit: getLimitFlagWithCustomValues({ defaultTo: DEFAULT_EVENTS_LIMIT, limit: 100 }),
    start: Flags.string({
      description: 'Start of time range (ISO date)',
      exclusive: ['days-from-now'],
    }),
    end: Flags.string({
      description: 'End of time range (ISO date)',
      exclusive: ['days-from-now'],
    }),
    'days-from-now': Flags.integer({
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
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ObserveEvents);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveEvents, {
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

    const metricName = resolveMetricName(flags.metric);
    const orderBy = resolveOrderBy(flags.sort);

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
      Log.log(buildObserveEventsTable(events, pageInfo));
    }
  }
}
