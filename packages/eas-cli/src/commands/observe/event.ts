import { Args } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import Log from '../../log';
import {
  buildObserveCustomEventDetail,
  buildObserveCustomEventJson,
} from '../../observe/formatCustomEvents';
import { buildObserveEventDetail, buildObserveEventJson } from '../../observe/formatEvents';
import { ObserveProjectIdFlag } from '../../observe/flags';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ObserveEvent extends EasCommand {
  static override description = 'display a single Observe event (metric or log) by its ID';

  static override args = {
    id: Args.string({
      description:
        'ID of the event to display (from `eas observe:events` or `eas observe:session`)',
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
    const { flags, args } = await this.parse(ObserveEvent);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveEvent,
      loggedInOnlyContextDefinition: ObserveEvent.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive,
    });

    if (json) {
      enableJsonOutput();
    }

    // An event ID is either a metric-event ID or a custom (log) event ID, and
    // their formats don't overlap, so we look up both and use whichever the
    // server resolves. Both are null when nothing matches.
    const { event, customEvent } = await withObservePlanGateHandlingAsync(() =>
      ObserveQuery.eventByIdAsync(graphqlClient, { appId: projectId, id: args.id })
    );

    if (customEvent) {
      if (json) {
        printJsonOnlyOutput({ type: 'log', event: buildObserveCustomEventJson(customEvent) });
      } else {
        Log.addNewLineIfNone();
        Log.log(buildObserveCustomEventDetail(customEvent));
      }
      return;
    }

    if (event) {
      if (json) {
        printJsonOnlyOutput({ type: 'metric', event: buildObserveEventJson(event) });
      } else {
        Log.addNewLineIfNone();
        Log.log(buildObserveEventDetail(event));
      }
      return;
    }

    throw new EasCommandError(
      `No Observe event found with ID "${args.id}". IDs come from \`eas observe:events\` or \`eas observe:session\`, and events age out of retention.`
    );
  }
}
