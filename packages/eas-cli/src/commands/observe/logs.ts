import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import Log from '../../log';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveCustomEventsAsync } from '../../observe/fetchCustomEvents';
import {
  buildObserveCustomEventNamesJson,
  buildObserveCustomEventNamesTable,
  buildObserveCustomEventsEmptyWithSuggestionsJson,
  buildObserveCustomEventsEmptyWithSuggestionsTable,
  buildObserveCustomEventsJson,
  buildObserveCustomEventsTable,
} from '../../observe/formatCustomEvents';
import { allowedPlatformFlagValues, appObservePlatformFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_EVENTS_LIMIT = 10;

export default class ObserveLogs extends EasCommand {
  static override hidden = true;
  static override description =
    'display individual custom events (logs) emitted by the app, filtered by the event name in the argument. With no arguments, a list of the available event names and associated event counts is returned.';

  static override args = {
    eventName: Args.string({
      description: 'Custom event name to filter by',
      required: false,
    }),
  };

  static override flags = {
    platform: Flags.option({
      description: 'Filter by platform',
      options: allowedPlatformFlagValues,
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
    'all-events': Flags.boolean({
      description:
        'When no event name argument is provided, list all events across all event names instead of a summary of event names + counts.',
      default: false,
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

    if (args.eventName && flags['all-events']) {
      throw new Error(
        '--all-events cannot be combined with an event name argument. Pass an event name to filter by it, or pass --all-events to list all events across all event names.'
      );
    }

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveLogs,
      loggedInOnlyContextDefinition: ObserveLogs.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive: flags['non-interactive'],
    });

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Observe is in preview and subject to breaking changes.');
    }

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    const platform = appObservePlatformFromFlag(flags.platform);

    if (!args.eventName && !flags['all-events']) {
      const { names, isTruncated } = await ObserveQuery.customEventNamesAsync(graphqlClient, {
        appId: projectId,
        startTime,
        endTime,
        platform,
      });

      if (flags.json) {
        printJsonOnlyOutput(buildObserveCustomEventNamesJson(names, isTruncated));
      } else {
        Log.addNewLineIfNone();
        Log.log(
          buildObserveCustomEventNamesTable(names, {
            daysBack,
            startTime,
            endTime,
            isTruncated,
          })
        );
      }
      return;
    }

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

    if (args.eventName && events.length === 0) {
      const { names, isTruncated } = await ObserveQuery.customEventNamesAsync(graphqlClient, {
        appId: projectId,
        startTime,
        endTime,
        platform,
      });

      if (flags.json) {
        printJsonOnlyOutput(
          buildObserveCustomEventsEmptyWithSuggestionsJson(args.eventName, names, isTruncated)
        );
      } else {
        Log.addNewLineIfNone();
        Log.log(
          buildObserveCustomEventsEmptyWithSuggestionsTable(args.eventName, names, {
            daysBack,
            startTime,
            endTime,
            isTruncated,
          })
        );
      }
      return;
    }

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
