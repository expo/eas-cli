import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { getBareJobRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import {
  AppPlatform,
  DeviceRunSessionFilterInput,
  DeviceRunSessionStatus,
} from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import {
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  deviceRunSessionTypeToFlagValue,
} from '../../simulator/utils';
import { fromNow } from '../../utils/date';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const STATUS_FLAG_VALUES: Record<DeviceRunSessionStatus, string> = {
  [DeviceRunSessionStatus.New]: 'new',
  [DeviceRunSessionStatus.InProgress]: 'in-progress',
  [DeviceRunSessionStatus.Stopped]: 'stopped',
  [DeviceRunSessionStatus.Errored]: 'errored',
};
const STATUS_BY_FLAG_VALUE = Object.fromEntries(
  Object.entries(STATUS_FLAG_VALUES).map(([status, value]) => [
    value,
    status as DeviceRunSessionStatus,
  ])
);

const PLATFORM_FLAG_VALUES: Record<AppPlatform, string> = {
  [AppPlatform.Android]: 'android',
  [AppPlatform.Ios]: 'ios',
};
const PLATFORM_BY_FLAG_VALUE = Object.fromEntries(
  Object.entries(PLATFORM_FLAG_VALUES).map(([platform, value]) => [value, platform as AppPlatform])
);

export default class SimulatorList extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] list remote simulator sessions for the current project';

  static override flags = {
    status: Flags.option({
      description: 'Filter by session status (repeatable)',
      options: Object.values(STATUS_FLAG_VALUES),
      multiple: true,
    })(),
    type: Flags.option({
      description: 'Filter by session type (repeatable)',
      options: Object.values(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES),
      multiple: true,
    })(),
    platform: Flags.option({
      description: 'Filter by device platform (repeatable)',
      options: Object.values(PLATFORM_FLAG_VALUES),
      multiple: true,
    })(),
    limit: getLimitFlagWithCustomValues({ defaultTo: DEFAULT_LIMIT, limit: MAX_LIMIT }),
    after: Flags.string({
      description:
        'Cursor for pagination. Use the endCursor from a previous query to fetch the next page.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorList);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorList, {
      nonInteractive,
    });

    const filter: DeviceRunSessionFilterInput = {};
    if (flags.status && flags.status.length > 0) {
      filter.statuses = flags.status.map(value => STATUS_BY_FLAG_VALUE[value]);
    }
    if (flags.type && flags.type.length > 0) {
      filter.types = flags.type.map(value => DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE[value]);
    }
    if (flags.platform && flags.platform.length > 0) {
      filter.platforms = flags.platform.map(value => PLATFORM_BY_FLAG_VALUE[value]);
    }

    const limit = flags.limit ?? DEFAULT_LIMIT;

    const fetchSpinner = jsonFlag ? null : ora('Fetching device run sessions').start();
    let connection;
    try {
      connection = await DeviceRunSessionQuery.listByAppIdAsync(graphqlClient, {
        appId: projectId,
        first: limit,
        after: flags.after,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      });
      fetchSpinner?.succeed(`Fetched ${connection.edges.length} device run session(s)`);
    } catch (err) {
      fetchSpinner?.fail('Failed to fetch device run sessions');
      throw err;
    }

    const sessions = connection.edges.map(edge => edge.node);

    if (jsonFlag) {
      printJsonOnlyOutput({
        sessions: sessions.map(session => ({
          id: session.id,
          type: deviceRunSessionTypeToFlagValue(session.type),
          status: session.status,
          platform: session.platform,
          createdAt: session.createdAt,
          startedAt: session.startedAt ?? undefined,
          finishedAt: session.finishedAt ?? undefined,
          jobRunUrl: session.turtleJobRun
            ? getBareJobRunUrl(
                session.app.ownerAccount.name,
                session.app.slug,
                session.turtleJobRun.id
              )
            : undefined,
        })),
        pageInfo: connection.pageInfo,
      });
      return;
    }

    if (sessions.length === 0) {
      Log.newLine();
      Log.log('No device run sessions found.');
      return;
    }

    Log.newLine();
    const formattedEntries = sessions.map(session => {
      const jobRunUrl = session.turtleJobRun
        ? getBareJobRunUrl(session.app.ownerAccount.name, session.app.slug, session.turtleJobRun.id)
        : null;
      const lines = [
        `ID:       ${session.id}`,
        `Type:     ${session.type}`,
        `Status:   ${session.status}`,
        `Platform: ${session.platform}`,
        `Created:  ${fromNow(new Date(session.createdAt))} ago`,
      ];
      if (jobRunUrl) {
        lines.push(`URL:      ${link(jobRunUrl)}`);
      }
      return lines.join('\n');
    });
    Log.log(formattedEntries.join(`\n\n${chalk.dim('———')}\n\n`));

    if (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor) {
      Log.newLine();
      Log.log(
        `More results available. Re-run with --after ${connection.pageInfo.endCursor} to fetch the next page.`
      );
    }
  }
}
