import { Args } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import { fetchObserveSessionEventsAsync } from '../../observe/fetchSessions';
import { ObserveProjectIdFlag } from '../../observe/flags';
import {
  buildObserveSessionEventsJson,
  buildObserveSessionEventsTable,
} from '../../observe/formatSessions';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

// Fixed at 100 — the maximum page size accepted by the underlying events and
// customEventList queries. Until there's a dedicated sessions query, this
// command pulls one page of each and merges client-side.
const SESSION_PAGE_SIZE = 100;

export default class ObserveSession extends EasCommand {
  static override description =
    'display the timeline of metric and log events for a specific session';

  static override args = {
    sessionId: Args.string({
      description: 'Session ID to inspect',
      required: true,
    }),
  };

  static override flags = {
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

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveSession,
      loggedInOnlyContextDefinition: ObserveSession.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive: flags['non-interactive'],
    });

    if (flags.json) {
      enableJsonOutput();
    }

    const { entries, metadata, hasMoreMetricEvents, hasMoreLogEvents } =
      await fetchObserveSessionEventsAsync(graphqlClient, projectId, {
        sessionId: args.sessionId,
        limit: SESSION_PAGE_SIZE,
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
        buildObserveSessionEventsTable(entries, {
          metadata,
          hasMoreMetricEvents,
          hasMoreLogEvents,
        })
      );
    }
  }
}
