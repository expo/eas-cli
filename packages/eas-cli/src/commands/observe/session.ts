import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../../log';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { EventsOrderPreset } from '../../observe/fetchEvents';
import {
  fetchObserveSessionEventsAsync,
  fetchSessionLogCandidatesAsync,
  fetchSessionMetricCandidatesAsync,
} from '../../observe/fetchSessions';
import { ObserveProjectIdFlag, ObserveTimeRangeFlags } from '../../observe/flags';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import {
  buildObserveSessionEventsJson,
  buildObserveSessionEventsTable,
  formatLogCandidateTitle,
  formatMetricCandidateTitle,
} from '../../observe/formatSessions';
import {
  METRIC_SHORT_NAMES,
  isKnownMetricName,
  resolveMetricName,
} from '../../observe/metricNames';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { ExpoChoice, selectAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

// Fixed at 100 — the maximum page size accepted by the underlying events and
// customEventList queries. Until there's a dedicated sessions query, this
// command pulls one page of each and merges client-side.
const SESSION_PAGE_SIZE = 100;

// How many candidate events to present in the picker. Small enough to browse;
// users narrow further with --days / --sort.
const PICKER_CANDIDATE_LIMIT = 25;

export default class ObserveSession extends EasCommand {
  static override description =
    'display the timeline of metric and log events for a specific session';

  static override args = {
    sessionId: Args.string({
      description: 'Session ID to inspect (omit in interactive mode to pick one from a list)',
      required: false,
    }),
  };

  static override flags = {
    sort: Flags.option({
      description:
        'Sort order for candidate events when picking a session (if omitted in interactive mode, you will be prompted)',
      options: Object.values(EventsOrderPreset).map(s => s.toLowerCase()),
      required: false,
    })(),
    'event-name': Flags.string({
      description:
        'Metric or log event name to pick candidate sessions by (e.g. tti, cold_launch, login_pressed). If omitted in interactive mode, you will be prompted.',
    }),
    ...ObserveTimeRangeFlags,
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
    const { flags, args } = await this.parse(ObserveSession);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveSession,
      loggedInOnlyContextDefinition: ObserveSession.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive,
    });

    if (json) {
      enableJsonOutput();
    }

    let sessionId: string;
    if (args.sessionId) {
      const pickerFlagsProvided =
        flags['event-name'] !== undefined ||
        flags.sort !== undefined ||
        flags.days !== undefined ||
        flags.start !== undefined ||
        flags.end !== undefined;
      if (pickerFlagsProvided) {
        throw new EasCommandError(
          'The picker flags (--event-name, --sort, --days, --start, --end) describe how to find a session and cannot be combined with a session ID argument.'
        );
      }
      sessionId = args.sessionId;
    } else if (nonInteractive) {
      throw new EasCommandError(
        'A session ID argument is required in non-interactive mode. In interactive mode, you can omit the session ID to pick one from a list of events.'
      );
    } else {
      sessionId = await pickSessionIdInteractivelyAsync({
        graphqlClient,
        projectId,
        eventNameFlag: flags['event-name'],
        sort: flags.sort,
        timeRangeFlags: { days: flags.days, start: flags.start, end: flags.end },
      });
    }

    const { entries, metadata, hasMoreMetricEvents, hasMoreLogEvents } =
      await withObservePlanGateHandlingAsync(() =>
        fetchObserveSessionEventsAsync(graphqlClient, projectId, {
          sessionId,
          limit: SESSION_PAGE_SIZE,
        })
      );

    if (json) {
      printJsonOnlyOutput(
        buildObserveSessionEventsJson(
          entries,
          sessionId,
          metadata,
          hasMoreMetricEvents,
          hasMoreLogEvents
        )
      );
    } else {
      Log.addNewLineIfNone();
      Log.log(
        buildObserveSessionEventsTable(entries, {
          metadata,
          hasMoreMetricEvents,
          hasMoreLogEvents,
        })
      );
    }
  }
}

interface EventNameChoice {
  name: string;
  isMetric: boolean;
}

async function pickSessionIdInteractivelyAsync({
  graphqlClient,
  projectId,
  eventNameFlag,
  sort,
  timeRangeFlags,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  eventNameFlag: string | undefined;
  sort: string | undefined;
  timeRangeFlags: { days: number | undefined; start: string | undefined; end: string | undefined };
}): Promise<string> {
  const { startTime, endTime } = resolveTimeRange(timeRangeFlags);

  const eventNameChoice: EventNameChoice = eventNameFlag
    ? { name: eventNameFlag, isMetric: isKnownMetricName(eventNameFlag) }
    : await promptForEventNameAsync({ graphqlClient, projectId, startTime, endTime });

  let sortValue: string;
  if (sort) {
    const preset = sort.toUpperCase() as EventsOrderPreset;
    const sortIsValueBased =
      preset === EventsOrderPreset.Slowest || preset === EventsOrderPreset.Fastest;
    if (!eventNameChoice.isMetric && sortIsValueBased) {
      throw new EasCommandError(
        `--sort=${sort} is only supported for metric events. Use newest or oldest for log events.`
      );
    }
    sortValue = sort;
  } else {
    sortValue = await promptForSortOrderAsync(eventNameChoice.isMetric);
  }

  const candidates: CandidateEvent[] = eventNameChoice.isMetric
    ? (
        await fetchSessionMetricCandidatesAsync(graphqlClient, projectId, {
          metricName: resolveMetricName(eventNameChoice.name),
          sort: sortValue,
          startTime,
          endTime,
          limit: PICKER_CANDIDATE_LIMIT,
        })
      ).map(event => ({ sessionId: event.sessionId, title: formatMetricCandidateTitle(event) }))
    : (
        await fetchSessionLogCandidatesAsync(graphqlClient, projectId, {
          eventName: eventNameChoice.name,
          orderAscending: sortValue.toUpperCase() === EventsOrderPreset.Oldest,
          startTime,
          endTime,
          limit: PICKER_CANDIDATE_LIMIT,
        })
      ).map(event => ({ sessionId: event.sessionId, title: formatLogCandidateTitle(event) }));

  if (candidates.length === 0) {
    throw new EasCommandError(
      `No events found for "${eventNameChoice.name}" in the selected time range. Try widening the window with --days or picking a different --event-name.`
    );
  }

  return await promptForSessionIdAsync(candidates);
}

async function promptForSortOrderAsync(isMetric: boolean): Promise<string> {
  const choices: ExpoChoice<string>[] = [
    { title: 'Newest first', value: EventsOrderPreset.Newest.valueOf().toLowerCase() },
    { title: 'Oldest first', value: EventsOrderPreset.Oldest.valueOf().toLowerCase() },
    ...(isMetric
      ? [
          {
            title: 'Slowest first (highest metric value)',
            value: EventsOrderPreset.Slowest.valueOf().toLowerCase(),
          },
          {
            title: 'Fastest first (lowest metric value)',
            value: EventsOrderPreset.Fastest.valueOf().toLowerCase(),
          },
        ]
      : []),
  ];
  return await selectAsync('Sort candidate events by', choices);
}

async function promptForEventNameAsync({
  graphqlClient,
  projectId,
  startTime,
  endTime,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  startTime: string;
  endTime: string;
}): Promise<EventNameChoice> {
  const { names: customEventNames } = await ObserveQuery.customEventNamesAsync(graphqlClient, {
    appId: projectId,
    startTime,
    endTime,
  });

  const metricChoices: ExpoChoice<EventNameChoice>[] = Object.entries(METRIC_SHORT_NAMES).map(
    ([fullName, displayName]) => ({
      title: `${displayName} (metric)`,
      value: { name: fullName, isMetric: true },
    })
  );

  const logChoices: ExpoChoice<EventNameChoice>[] = customEventNames.map(
    ({ eventName, count }) => ({
      title: `${eventName} (${count} log event${count === 1 ? '' : 's'})`,
      value: { name: eventName, isMetric: false },
    })
  );

  const choices = [...metricChoices, ...logChoices];
  if (choices.length === 0) {
    throw new EasCommandError(
      'No metric or log events found for the selected time range. Widen the window with --days or wait for data to arrive.'
    );
  }

  return await selectAsync('Select an event name', choices);
}

interface CandidateEvent {
  sessionId: string;
  title: string;
}

async function promptForSessionIdAsync(candidates: CandidateEvent[]): Promise<string> {
  const choices: ExpoChoice<string>[] = candidates.map(c => ({
    title: c.title,
    value: c.sessionId,
  }));
  return await selectAsync('Select an event (its session will be shown)', choices);
}
