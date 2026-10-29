import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  EasProjectIdFlag,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import Log from '../../log';
import { fetchObserveSpansAsync } from '../../observe/fetchSpans';
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
  buildObserveSpanNamesJson,
  buildObserveSpanNamesTable,
  buildObserveSpansJson,
  buildObserveSpansTable,
} from '../../observe/formatSpans';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { observePlatformsFromFlag } from '../../observe/platforms';
import {
  allowedSpanKindFlagValues,
  allowedSpanStatusFlagValues,
  spanKindsFromFlag,
  spanStatusCodesFromFlag,
} from '../../observe/spanFilters';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_SPANS_LIMIT = 20;

export default class ObserveTraces extends EasCommand {
  static override description =
    'display request trace spans recorded by the app, newest first. With no span filters, a summary of span names and kinds with counts is returned. Pass --all-spans or a span filter (--name, --kind, --status, --host, --http-status, --min-duration, --root-only, --session-id) to list individual spans';

  static override flags = {
    ...ObservePlatformFlag,
    ...ObserveAfterFlag,
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_SPANS_LIMIT,
      limit: 100,
    }),
    ...ObserveTimeRangeFlags,
    ...ObserveAppVersionFlag,
    ...ObserveBuildNumberFlag,
    ...ObserveUpdateIdFlag,
    ...ObserveEnvironmentFlag,
    'session-id': Flags.string({
      description: 'Filter by session ID',
    }),
    name: Flags.string({
      description: 'Filter by span name, such as GET or POST (can be specified multiple times)',
      multiple: true,
    }),
    kind: Flags.option({
      description: 'Filter by span kind (can be specified multiple times)',
      multiple: true,
      options: allowedSpanKindFlagValues,
    })(),
    status: Flags.option({
      description: 'Filter by span status (can be specified multiple times)',
      multiple: true,
      options: allowedSpanStatusFlagValues,
    })(),
    host: Flags.string({
      description: 'Filter by request host (can be specified multiple times)',
      multiple: true,
    }),
    'http-status': Flags.integer({
      description: 'Filter by HTTP response status code (can be specified multiple times)',
      multiple: true,
    }),
    'min-duration': Flags.integer({
      description: 'Only spans that took at least this many milliseconds',
      min: 0,
    }),
    'root-only': Flags.boolean({
      description: 'Only root spans (spans with no parent)',
      default: false,
    }),
    'all-spans': Flags.boolean({
      description:
        'List individual spans instead of the summary of span names + counts, even with no span filter',
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
    const { flags } = await this.parse(ObserveTraces);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveTraces, {
      nonInteractive,
      projectIdOverride: flags['project-id'],
    });

    if (json) {
      enableJsonOutput();
    }

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);
    const platforms = observePlatformsFromFlag(flags.platform);

    const hasSpanFilter =
      flags['session-id'] !== undefined ||
      (flags.name?.length ?? 0) > 0 ||
      (flags.kind?.length ?? 0) > 0 ||
      (flags.status?.length ?? 0) > 0 ||
      (flags.host?.length ?? 0) > 0 ||
      (flags['http-status']?.length ?? 0) > 0 ||
      flags['min-duration'] !== undefined ||
      flags['root-only'];

    // The names summary has no span-level filters and no pagination, so any of
    // those (or --all-spans) means the caller wants the span list.
    if (!hasSpanFilter && !flags['all-spans'] && !flags.after) {
      const { names, isTruncated } = await withObservePlanGateHandlingAsync(() =>
        ObserveQuery.spanNamesAsync(graphqlClient, {
          appId: projectId,
          input: {
            startTime,
            endTime,
            ...(platforms?.length && { platforms }),
            ...(flags.environment && { environment: flags.environment }),
            ...(flags['app-version'] && { appVersion: flags['app-version'] }),
            ...(flags['build-number'] && { appBuildNumber: flags['build-number'] }),
            ...(flags['update-id'] && { appUpdateId: flags['update-id'] }),
          },
        })
      );

      if (json) {
        printJsonOnlyOutput(buildObserveSpanNamesJson(names, isTruncated));
      } else {
        Log.addNewLineIfNone();
        Log.log(
          buildObserveSpanNamesTable(names, {
            daysBack,
            startTime,
            endTime,
            isTruncated,
          })
        );
      }
      return;
    }

    const { spans, pageInfo } = await withObservePlanGateHandlingAsync(() =>
      fetchObserveSpansAsync(graphqlClient, projectId, {
        limit: flags.limit ?? DEFAULT_SPANS_LIMIT,
        ...(flags.after && { after: flags.after }),
        startTime,
        endTime,
        platforms,
        appVersion: flags['app-version'],
        buildNumber: flags['build-number'],
        updateId: flags['update-id'],
        environment: flags.environment,
        sessionId: flags['session-id'],
        names: flags.name,
        kinds: spanKindsFromFlag(flags.kind),
        statusCodes: spanStatusCodesFromFlag(flags.status),
        hosts: flags.host,
        httpStatusCodes: flags['http-status'],
        minDurationMs: flags['min-duration'],
        rootOnly: flags['root-only'],
      })
    );

    if (json) {
      printJsonOnlyOutput(buildObserveSpansJson(spans, pageInfo));
    } else {
      Log.addNewLineIfNone();
      Log.log(
        buildObserveSpansTable(spans, pageInfo, {
          daysBack,
          startTime,
          endTime,
          sessionId: flags['session-id'],
        })
      );
    }
  }
}
