import { Args } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasCommandError } from '../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  EasProjectIdFlag,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import Log from '../../log';
import { buildObserveTraceJson, buildObserveTraceTable } from '../../observe/formatSpans';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

// A trace ID is the 32-character hex string of the OTLP JSON encoding.
const TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;

export default class ObserveTrace extends EasCommand {
  static override description =
    'display every span of a single request trace by its trace ID, oldest first, with child spans indented under their parent. Trace IDs are shown by `eas observe:traces`. In `--json` output a span with no `parentSpanId` is a root span, and a span with no `http` object is not an HTTP request';

  static override args = {
    traceId: Args.string({
      description: 'ID of the trace to display',
      required: true,
    }),
  };

  static override flags = {
    ...EasProjectIdFlag,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(ObserveTrace);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const traceId = args.traceId;
    if (!TRACE_ID_REGEX.test(traceId)) {
      throw new EasCommandError(
        `"${traceId}" is not a valid trace ID. A trace ID is 32 hexadecimal characters; copy it from the Trace ID column of \`eas observe:traces\`.`
      );
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveTrace, {
      nonInteractive,
      projectIdOverride: flags['project-id'],
    });

    if (json) {
      enableJsonOutput();
    }

    const trace = await withObservePlanGateHandlingAsync(() =>
      ObserveQuery.traceByIdAsync(graphqlClient, { appId: projectId, id: traceId })
    );

    if (!trace) {
      throw new EasCommandError(
        `No trace found with ID "${traceId}". Trace IDs come from \`eas observe:traces\`, and traces age out of retention.`
      );
    }

    if (json) {
      printJsonOnlyOutput(buildObserveTraceJson(trace));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildObserveTraceTable(trace));
    }
  }
}
