import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { AppObservePlatform } from '../../graphql/generated';
import Log from '../../log';
import { fetchObserveCustomEventsAsync } from '../../observe/fetchCustomEvents';
import {
  buildObserveCustomEventsJson,
  buildObserveCustomEventsTable,
} from '../../observe/formatCustomEvents';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_EVENTS_LIMIT = 10;

export default class ObserveLogs extends EasCommand {
  static override hidden = true;
  static override description = 'display individual custom events (logs) emitted by the app';

  static override args = {
    eventName: Args.string({
      description: 'Custom event name to filter by',
      required: false,
    }),
  };

  static override flags = {
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
    'session-id': Flags.string({
      description: 'Filter by session ID',
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
    const { flags, args } = await this.parse(ObserveLogs);

    let projectId: string;
    let graphqlClient;
    if (flags['project-id']) {
      projectId = flags['project-id'];
      const ctx = await this.getContextAsync(
        { contextDefinition: ObserveLogs.loggedInOnlyContextDefinition },
        { nonInteractive: flags['non-interactive'] }
      );
      graphqlClient = ctx.loggedIn.graphqlClient;
    } else {
      const ctx = await this.getContextAsync(ObserveLogs, {
        nonInteractive: flags['non-interactive'],
      });
      projectId = ctx.projectId;
      graphqlClient = ctx.loggedIn.graphqlClient;
    }

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Observe is in preview and subject to breaking changes.');
    }

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    const platform = flags.platform
      ? flags.platform === 'android'
        ? AppObservePlatform.Android
        : AppObservePlatform.Ios
      : undefined;

    const { events, pageInfo } = await fetchObserveCustomEventsAsync(graphqlClient, projectId, {
      eventName: args.eventName,
      limit: flags.limit ?? DEFAULT_EVENTS_LIMIT,
      ...(flags.after && { after: flags.after }),
      startTime,
      endTime,
      platform,
      appVersion: flags['app-version'],
      updateId: flags['update-id'],
      sessionId: flags['session-id'],
    });

    if (flags.json) {
      printJsonOnlyOutput(buildObserveCustomEventsJson(events, pageInfo));
    } else {
      Log.addNewLineIfNone();
      Log.log(
        buildObserveCustomEventsTable(events, pageInfo, {
          eventName: args.eventName,
          daysBack,
          startTime,
          endTime,
        })
      );
    }
  }
}
