import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import { fetchObserveVersionsAsync } from '../../observe/fetchVersions';
import {
  ObservePlatformFlag,
  ObserveProjectIdFlag,
  ObserveTimeRangeFlags,
} from '../../observe/flags';
import { buildObserveVersionsJson, buildObserveVersionsTable } from '../../observe/formatVersions';
import { appPlatformsFromFlag } from '../../observe/platforms';
import { resolveObserveCommandContextAsync } from '../../observe/resolveProjectContext';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ObserveVersions extends EasCommand {
  static override hidden = true;
  static override description = 'display app versions with build and update details';

  static override flags = {
    ...ObservePlatformFlag,
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
    const { flags } = await this.parse(ObserveVersions);

    const { projectId, graphqlClient } = await resolveObserveCommandContextAsync({
      command: this,
      commandClass: ObserveVersions,
      loggedInOnlyContextDefinition: ObserveVersions.loggedInOnlyContextDefinition,
      projectIdOverride: flags['project-id'],
      nonInteractive: flags['non-interactive'],
    });

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Observe is in preview and subject to breaking changes.');
    }

    const { startTime, endTime } = resolveTimeRange(flags);

    const platforms = appPlatformsFromFlag(flags.platform);

    const results = await fetchObserveVersionsAsync(
      graphqlClient,
      projectId,
      platforms,
      startTime,
      endTime
    );

    if (flags.json) {
      printJsonOnlyOutput(buildObserveVersionsJson(results));
    } else {
      Log.addNewLineIfNone();
      Log.log(buildObserveVersionsTable(results));
    }
  }
}
