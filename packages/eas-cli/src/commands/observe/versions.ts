import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppObservePlatform, AppPlatform } from '../../graphql/generated';
import Log from '../../log';
import { fetchObserveVersionsAsync } from '../../observe/fetchVersions';
import { buildObserveVersionsJson, buildObserveVersionsTable } from '../../observe/formatVersions';
import { resolveTimeRange } from '../../observe/startAndEndTime';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class ObserveVersions extends EasCommand {
  static override hidden = true;
  static override description = 'display app versions with build and update details';

  static override flags = {
    platform: Flags.option({
      description: 'Filter by platform',
      options: Object.values(AppObservePlatform).map(s => s.toLowerCase()),
    })(),
    start: Flags.string({
      description: 'Start of time range (ISO date)',
      exclusive: ['days'],
    }),
    end: Flags.string({
      description: 'End of time range (ISO date)',
      exclusive: ['days'],
    }),
    days: Flags.integer({
      description: 'Show versions from the last N days (mutually exclusive with --start/--end)',
      min: 1,
      exclusive: ['start', 'end'],
    }),
    'project-id': Flags.string({
      description: 'EAS project ID (defaults to the project ID of the current directory)',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ObserveVersions);
    const {
      projectId: contextProjectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ObserveVersions, {
      nonInteractive: flags['non-interactive'],
    });

    const projectId = flags['project-id'] ?? contextProjectId;

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Observe is in preview and subject to breaking changes.');
    }

    const { startTime, endTime } = resolveTimeRange(flags);

    const platforms: AppPlatform[] = flags.platform
      ? [flags.platform === 'android' ? AppPlatform.Android : AppPlatform.Ios]
      : [AppPlatform.Android, AppPlatform.Ios];

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
