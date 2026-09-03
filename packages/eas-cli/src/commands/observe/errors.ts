import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppObserveErrorSeverity } from '../../graphql/generated';
import Log from '../../log';
import { fetchObserveErrorGroupsAsync } from '../../observe/fetchErrors';
import {
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

export default class ObserveErrors extends EasCommand {
  static override description =
    'display error and exception issue groups (grouped by fingerprint) for the app';

  static override flags = {
    ...ObservePlatformFlag,
    severity: Flags.option({
      description: 'Filter by severity',
      options: Object.keys(SEVERITY_BY_FLAG),
      required: false,
    })(),
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

    if (json) {
      enableJsonOutput();
    }

    const { daysBack, startTime, endTime } = resolveTimeRange(flags);

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
