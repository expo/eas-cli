import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import Log from '../../log';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveCustomEventsAsync } from '../../observe/fetchCustomEvents';
import {
  ObserveAfterFlag,
  ObserveAppVersionFlag,
  ObserveClientIdFlag,
  ObservePlatformFlag,
  ObserveProjectIdFlag,
  ObserveTimeRangeFlags,
  ObserveUpdateIdFlag,
} from '../../observe/flags';
import {
  buildObserveCustomEventNamesJson,
  buildObserveCustomEventNamesTable,
  buildObserveCustomEventsEmptyWithSuggestionsJson,
  buildObserveCustomEventsEmptyWithSuggestionsTable,
  buildObserveCustomEventsJson,
  buildObserveCustomEventsTable,
} from '../../observe/formatCustomEvents';
import { appObservePlatformFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_EVENTS_LIMIT = 10;

export default class ObserveEvents extends EasCommand {
  static override description =
    'display individual events emitted by the app via `logEvent`, filtered by the event name in the argument. With no arguments, a list of the available event names and associated event counts is returned.';

  static override args = {
    eventName: Args.string({
      description: 'Event name to filter by',
      required: false,
    }),
  };

  static override flags = {
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
    'session-id': Flags.string({
      description: 'Filter by session ID',
    }),
    'all-events': Flags.boolean({
      description:
        'When no event name argument is provided, list all events across all event names instead of a summary of event names + counts.',
      default: false,
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
    const { flags, args } = await this.parse(ObserveEvents);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (args.eventName && flags['all-events']) {
      throw new Error(
        '--all-events cannot be combined with an event name argument. Pass an event name to filter by it, or pass --all-events to list all events across all event names.'
      );
    }

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveEvents,
      loggedInOnlyContextDefinition: ObserveEvents.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive,
    });

    if (json) {
      enableJsonOutput();
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

      if (json) {
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
      easClientId: flags['client-id'],
    });

    if (args.eventName && events.length === 0) {
      const { names, isTruncated } = await ObserveQuery.customEventNamesAsync(graphqlClient, {
        appId: projectId,
        startTime,
        endTime,
        platform,
      });

      if (json) {
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

    if (json) {
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
