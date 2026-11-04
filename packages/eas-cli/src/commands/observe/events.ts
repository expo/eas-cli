import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  EasProjectIdFlag,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import Log from '../../log';
import { AppObserveUserEventPropertyFilter } from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveCustomEventsAsync } from '../../observe/fetchCustomEvents';
import {
  ObserveAfterFlag,
  ObserveAppVersionFlag,
  ObserveBuildNumberFlag,
  ObserveEnvironmentFlag,
  ObservePlatformFlag,
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
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { observePlatformsFromFlag } from '../../observe/platforms';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_EVENTS_LIMIT = 10;

export default class ObserveEvents extends EasCommand {
  static override description =
    'display individual events emitted by the app via `logEvent`, filtered by the event name in the argument. With no arguments, a list of the available event names and associated event counts is returned';

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
    ...ObserveBuildNumberFlag,
    ...ObserveUpdateIdFlag,
    ...ObserveEnvironmentFlag,
    'session-id': Flags.string({
      description:
        'Filter by session ID. When no event name is given, lists the events in the session instead of the event-name summary.',
    }),
    property: Flags.custom<AppObserveUserEventPropertyFilter>({
      description:
        'Filter by event property (key=value, exact match). Repeat to require all. Without an event name, lists matching events.',
      multiple: true,
      parse: parsePropertyFilterAsync,
    })(),
    'all-events': Flags.boolean({
      description:
        'When no event name argument is provided, list all events across all event names instead of a summary of event names + counts.',
      default: false,
    }),
    ...EasProjectIdFlag,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
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

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveEvents, {
      nonInteractive,
      projectIdOverride: flags['project-id'],
    });

    if (json) {
      enableJsonOutput();
    }

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    const platforms = observePlatformsFromFlag(flags.platform);

    // A session ID or property filter narrows the events, so show them
    // (like --all-events) instead of the account-wide name+count summary, which
    // supports neither filter.
    if (!args.eventName && !flags['all-events'] && !flags['session-id'] && !flags.property) {
      const { names, isTruncated } = await withObservePlanGateHandlingAsync(() =>
        ObserveQuery.customEventNamesAsync(graphqlClient, {
          appId: projectId,
          startTime,
          endTime,
          platforms,
          environment: flags.environment,
        })
      );

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

    const { events, pageInfo } = await withObservePlanGateHandlingAsync(() =>
      fetchObserveCustomEventsAsync(graphqlClient, projectId, {
        eventName: args.eventName,
        limit: flags.limit ?? DEFAULT_EVENTS_LIMIT,
        ...(flags.after && { after: flags.after }),
        startTime,
        endTime,
        platforms,
        appVersion: flags['app-version'],
        buildNumber: flags['build-number'],
        updateId: flags['update-id'],
        sessionId: flags['session-id'],
        environment: flags.environment,
        propertyFilters: flags.property,
      })
    );

    // A session, app version, build number, update ID, or property may not
    // contain the event even when the name is valid, so only suggest other names
    // when the event name is the sole narrowing filter.
    if (
      args.eventName &&
      events.length === 0 &&
      !flags['session-id'] &&
      !flags['app-version'] &&
      !flags['build-number'] &&
      !flags['update-id'] &&
      !flags.property
    ) {
      const { names, isTruncated } = await ObserveQuery.customEventNamesAsync(graphqlClient, {
        appId: projectId,
        startTime,
        endTime,
        platforms,
        environment: flags.environment,
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

// Split on the first "=" so values may contain "=".
async function parsePropertyFilterAsync(input: string): Promise<AppObserveUserEventPropertyFilter> {
  const separatorIndex = input.indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error(`Invalid property filter "${input}". Expected key=value format.`);
  }
  return { key: input.slice(0, separatorIndex), value: input.slice(separatorIndex + 1) };
}
