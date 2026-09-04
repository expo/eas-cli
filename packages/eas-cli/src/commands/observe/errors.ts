import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { AppObserveErrorSeverity } from '../../graphql/generated';
import Log from '../../log';
import {
  fetchObserveErrorGroupsAsync,
  fetchObserveErrorOccurrencesAsync,
} from '../../observe/fetchErrors';
import {
  ObserveAfterFlag,
  ObserveAppVersionFlag,
  ObserveBuildNumberFlag,
  ObserveEnvironmentFlag,
  ObservePlatformFlag,
  ObserveProjectIdFlag,
  ObserveTimeRangeFlags,
  ObserveUpdateIdFlag,
} from '../../observe/flags';
import {
  buildObserveErrorGroupsJson,
  buildObserveErrorGroupsTable,
  buildObserveErrorOccurrencesJson,
  buildObserveErrorOccurrencesTable,
} from '../../observe/formatErrors';
import { withObservePlanGateHandlingAsync } from '../../observe/planGating';
import { observePlatformsFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const SEVERITY_BY_FLAG: Record<string, AppObserveErrorSeverity> = {
  fatal: AppObserveErrorSeverity.Fatal,
  error: AppObserveErrorSeverity.Error,
};

const DEFAULT_OCCURRENCES_LIMIT = 10;

export default class ObserveErrors extends EasCommand {
  static override description =
    'display error and exception issue groups (grouped by fingerprint) for the app';

  static override flags = {
    ...ObservePlatformFlag,
    fingerprint: Flags.string({
      description:
        'Show individual occurrences (with stack traces) for this error group fingerprint instead of the grouped summary',
      required: false,
    }),
    severity: Flags.option({
      description: 'Filter by severity (ignored when --fingerprint is set)',
      options: Object.keys(SEVERITY_BY_FLAG),
      required: false,
    })(),
    ...ObserveAfterFlag,
    limit: getLimitFlagWithCustomValues({
      defaultTo: DEFAULT_OCCURRENCES_LIMIT,
      limit: 100,
    }),
    ...ObserveTimeRangeFlags,
    ...ObserveAppVersionFlag,
    ...ObserveBuildNumberFlag,
    ...ObserveUpdateIdFlag,
    ...ObserveEnvironmentFlag,
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
    const { flags } = await this.parse(ObserveErrors);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveErrors,
      loggedInOnlyContextDefinition: ObserveErrors.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive,
    });

    if (!flags.fingerprint && (flags.after || flags.limit)) {
      throw new Error(
        '--after or --limit can only be used in combination with the --fingerprint flag.'
      );
    }

    if (json) {
      enableJsonOutput();
    }

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

    if (flags.fingerprint) {
      const { occurrences, pageInfo } = await withObservePlanGateHandlingAsync(() =>
        fetchObserveErrorOccurrencesAsync(graphqlClient, projectId, {
          fingerprint: flags.fingerprint as string,
          startTime,
          endTime,
          platforms: observePlatformsFromFlag(flags.platform),
          appVersion: flags['app-version'],
          buildNumber: flags['build-number'],
          updateId: flags['update-id'],
          environment: flags.environment,
          limit: flags.limit ?? DEFAULT_OCCURRENCES_LIMIT,
          ...(flags.after && { after: flags.after }),
        })
      );

      if (json) {
        printJsonOnlyOutput(buildObserveErrorOccurrencesJson(occurrences, pageInfo));
      } else {
        Log.addNewLineIfNone();
        Log.log(
          buildObserveErrorOccurrencesTable(occurrences, pageInfo, {
            fingerprint: flags.fingerprint,
            daysBack,
            startTime,
            endTime,
          })
        );
      }
      return;
    }

    const { groups, isTruncated } = await withObservePlanGateHandlingAsync(() =>
      fetchObserveErrorGroupsAsync(graphqlClient, projectId, {
        startTime,
        endTime,
        platforms: observePlatformsFromFlag(flags.platform),
        appVersion: flags['app-version'],
        buildNumber: flags['build-number'],
        updateId: flags['update-id'],
        environment: flags.environment,
        ...(flags.severity && { severity: SEVERITY_BY_FLAG[flags.severity] }),
      })
    );

    if (json) {
      printJsonOnlyOutput(buildObserveErrorGroupsJson(groups, isTruncated));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildObserveErrorGroupsTable(groups, { daysBack, startTime, endTime }));
      if (isTruncated) {
        Log.warn('Result is truncated; not all error groups are shown.');
      }
    }
  }
}
