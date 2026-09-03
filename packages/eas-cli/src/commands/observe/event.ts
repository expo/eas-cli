import { Args } from '@oclif/core';
import { validate as isUuid } from 'uuid';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { GraphqlError } from '../../graphql/client';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import Log from '../../log';
import {
  buildObserveCustomEventDetail,
  buildObserveCustomEventJson,
} from '../../observe/formatCustomEvents';
import { buildObserveErrorDetail, buildObserveErrorJson } from '../../observe/formatErrors';
import { buildObserveEventDetail, buildObserveEventJson } from '../../observe/formatEvents';
import { ObserveProjectIdFlag } from '../../observe/flags';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ObserveEvent extends EasCommand {
  static override description =
    'display a single Observe event (metric, log, or error) by its ID. IDs are included in event data when the `--json` flag is passed to `eas observe:session`, `eas observe:metrics`, or `eas observe:events`.';

  static override args = {
    id: Args.string({
      description: 'ID of the event to display',
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

    const id = args.id;

    // A log event ID (user event or error) is a UUID; a metric event ID is
    // base64url-encoded JSON. Route to the matching query so we never issue the
    // query that is guaranteed to fail for this ID, and reject anything that is
    // neither up front.
    if (isUuid(id)) {
      const log = await fetchObserveEventAsync(id, () =>
        ObserveQuery.logByIdAsync(graphqlClient, { appId: projectId, id })
      );
      if (!log) {
        throw eventNotFoundError(id);
      }
      if (log.__typename === 'AppObserveError') {
        if (json) {
          printJsonOnlyOutput({ type: 'error', event: buildObserveErrorJson(log) });
        } else {
          Log.addNewLineIfNone();
          Log.log(buildObserveErrorDetail(log));
        }
      } else if (json) {
        printJsonOnlyOutput({ type: 'log', event: buildObserveCustomEventJson(log) });
      } else {
        Log.addNewLineIfNone();
        Log.log(buildObserveCustomEventDetail(log));
      }
      return;
    }

    if (parsesAsBase64(id)) {
      const event = await fetchObserveEventAsync(id, () =>
        ObserveQuery.metricByIdAsync(graphqlClient, { appId: projectId, id })
      );
      if (!event) {
        throw eventNotFoundError(id);
      }
      if (json) {
        printJsonOnlyOutput({ type: 'metric', event: buildObserveEventJson(event) });
      } else {
        Log.addNewLineIfNone();
        Log.log(buildObserveEventDetail(event));
      }
      return;
    }

    throw new EasCommandError(
      `"${id}" is not a valid Observe event ID. IDs come from \`eas observe:events\` or \`eas observe:session\`.`
    );
  }
}

/**
 * A metric event ID is canonical base64url (of JSON). Round-tripping rejects
 * strings that only coincidentally contain base64 characters, so a value that
 * is neither a UUID nor this is treated as an invalid ID.
 */
function parsesAsBase64(id: string): boolean {
  if (id.length === 0) {
    return false;
  }
  return Buffer.from(id, 'base64url').toString('base64url') === id;
}

function eventNotFoundError(id: string): EasCommandError {
  return new EasCommandError(
    `No Observe event found with ID "${id}". IDs come from \`eas observe:events\` or \`eas observe:session\`, and events age out of retention.`
  );
}

/**
 * Runs an Observe event lookup, translating plan-gate rejections to their
 * upgrade message and any other server error into an actionable message that
 * preserves the underlying error and request ID for support.
 */
async function fetchObserveEventAsync<T>(id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withObservePlanGateHandlingAsync(fn);
  } catch (error) {
    if (error instanceof EasCommandError) {
      throw error;
    }
    throw new EasCommandError(
      `Could not retrieve Observe event with ID "${id}". ` +
        'The ID may be invalid or the event may not exist (events also age out of retention). ' +
        'Verify it was copied in full from `eas observe:events` or `eas observe:session`.' +
        `\n\n${describeObserveServerError(error)}`
    );
  }
}

/**
 * Extract a human-readable description from a GraphQL/server error, including
 * the request ID(s) so a support request can reference them. Falls back to the
 * error's own message for non-GraphQL errors.
 */
function describeObserveServerError(error: unknown): string {
  if (error instanceof GraphqlError && error.graphQLErrors.length > 0) {
    return error.graphQLErrors
      .map(graphQLError => {
        const message = graphQLError.message.replace('[GraphQL] ', '');
        const requestId = graphQLError.extensions?.requestId;
        return requestId ? `${message} (Request ID: ${String(requestId)})` : message;
      })
      .join('\n');
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
