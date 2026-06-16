import { Args } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import {
  fetchObserveSessionEventsAsync,
  fetchObserveSessionListAsync,
} from '../../observe/fetchSessions';
import {
  ObserveAppVersionFlag,
  ObserveEventNameFlag,
  ObservePlatformFlag,
  ObserveProjectIdFlag,
  ObserveTimeRangeFlags,
  ObserveUpdateIdFlag,
} from '../../observe/flags';
import {
  buildObserveSessionEventsJson,
  buildObserveSessionEventsTable,
  buildObserveSessionListJson,
  buildObserveSessionListTable,
} from '../../observe/formatSessions';
import { appObservePlatformFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

// Fixed at 100 — the maximum page size accepted by the underlying events and
// customEventList queries. Until there's a dedicated sessions query, this
// command pulls one page of each and groups client-side.
const SESSIONS_PAGE_SIZE = 100;

export default class ObserveSessions extends EasCommand {
  static override description =
    'list distinct session IDs in a time window, or display the timeline of metric and log events for a specific session';

  static override args = {
    sessionId: Args.string({
      description: 'Session ID to inspect; if omitted, lists distinct session IDs in the window',
      required: false,
    }),
  };

  static override flags = {
    ...ObservePlatformFlag,
    ...ObserveTimeRangeFlags,
    ...ObserveAppVersionFlag,
    ...ObserveUpdateIdFlag,
    ...ObserveEventNameFlag,
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
    const { flags, args } = await this.parse(ObserveSessions);

    if (args.sessionId && flags['event-name']) {
      throw new Error(
        '--event-name cannot be combined with a session ID argument. Pass an event name to filter the list of sessions, or pass a session ID to inspect a single session.'
      );
    }

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveSessions,
      loggedInOnlyContextDefinition: ObserveSessions.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive: flags['non-interactive'],
    });

    if (flags.json) {
      enableJsonOutput();
    }

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);
    const platform = appObservePlatformFromFlag(flags.platform);

    if (!args.sessionId) {
      const { sessions, scannedMetricEventCount, scannedLogEventCount, isTruncated } =
        await fetchObserveSessionListAsync(graphqlClient, projectId, {
          startTime,
          endTime,
          platform,
          appVersion: flags['app-version'],
          updateId: flags['update-id'],
          eventName: flags['event-name'],
          limit: SESSIONS_PAGE_SIZE,
        });

      if (flags.json) {
        printJsonOnlyOutput(
          buildObserveSessionListJson(
            sessions,
            scannedMetricEventCount,
            scannedLogEventCount,
            isTruncated
          )
        );
      } else {
        Log.addNewLineIfNone();
        Log.log(
          buildObserveSessionListTable(sessions, {
            daysBack,
            startTime,
            endTime,
            eventName: flags['event-name'],
            scannedMetricEventCount,
            scannedLogEventCount,
            isTruncated,
          })
        );
      }
      return;
    }

    const { entries, metadata, hasMoreMetricEvents, hasMoreLogEvents } =
      await fetchObserveSessionEventsAsync(graphqlClient, projectId, {
        startTime,
        endTime,
        sessionId: args.sessionId,
        platform,
        appVersion: flags['app-version'],
        updateId: flags['update-id'],
        limit: SESSIONS_PAGE_SIZE,
      });

    if (flags.json) {
      printJsonOnlyOutput(
        buildObserveSessionEventsJson(
          entries,
          args.sessionId,
          metadata,
          hasMoreMetricEvents,
          hasMoreLogEvents
        )
      );
    } else {
      Log.addNewLineIfNone();
      Log.log(
        buildObserveSessionEventsTable(entries, args.sessionId, {
          metadata,
          hasMoreMetricEvents,
          hasMoreLogEvents,
        })
      );
    }
  }
}
