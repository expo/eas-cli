import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppObservePlatform } from '../../graphql/generated';
import Log from '../../log';
import {
  DEFAULT_EVENTS_LIMIT,
  type EventsOrderPreset,
  fetchObserveEventsAsync,
  resolveMetricName,
  resolveOrderBy,
} from '../../observe/fetchEvents';
import { DEFAULT_DAYS_BACK, validateDateFlag } from '../../observe/fetchMetrics';
import { buildObserveEventsJson, buildObserveEventsTable } from '../../observe/formatEvents';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

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
    limit: Flags.integer({
      description: 'Number of events to show',
      default: DEFAULT_EVENTS_LIMIT,
      min: 1,
      max: 100,
    }),
    start: Flags.string({
      description: 'Start of time range (ISO date)',
    }),
    end: Flags.string({
      description: 'End of time range (ISO date)',
    }),
    'app-version': Flags.string({
      description: 'Filter by app version',
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

    const endTime = flags.end ?? new Date().toISOString();
    const startTime =
      flags.start ??
      new Date(Date.now() - DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();

    const platform = flags.platform
      ? flags.platform === 'android'
        ? AppObservePlatform.Android
        : AppObservePlatform.Ios
      : undefined;

    const { events } = await fetchObserveEventsAsync(graphqlClient, projectId, {
      metricName,
      orderBy,
      limit: flags.limit ?? DEFAULT_EVENTS_LIMIT,
      startTime,
      endTime,
      platform,
      appVersion: flags['app-version'],
    });

    if (flags.json) {
      printJsonOnlyOutput(buildObserveEventsJson(events));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildObserveEventsTable(events));
    }
  }
}
