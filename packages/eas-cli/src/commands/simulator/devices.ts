import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { appPlatformDisplayNames } from '../../platform';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import {
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';
import {
  DEVICE_RUN_SESSION_PLATFORM_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_PLATFORM_FLAG_VALUES,
  DeviceRunSessionPlatformFlagValue,
} from '../../simulator/utils';

const PLATFORM_ORDER: readonly DeviceRunSessionPlatformFlagValue[] = ['ios', 'android'];

function formatDeviceFlagValue(identifier: string): string {
  return /^[\w-]+$/.test(identifier) ? identifier : JSON.stringify(identifier);
}

export default class SimulatorDevices extends EasCommand {
  static override aliases = getSimulatorCommandAliases('devices');
  static override hiddenAliases = getSimulatorCommandHiddenAliases('devices');
  static override description = 'list the devices Expo suggests for a remote simulator session';

  static override flags = {
    platform: Flags.option({
      char: 'p',
      description: 'Show the devices of one platform',
      options: DEVICE_RUN_SESSION_PLATFORM_FLAG_VALUES,
    })(),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorDevices);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorDevices, {
      nonInteractive,
    });

    const fetchSpinner = jsonFlag ? null : ora('Fetching simulator devices').start();
    let profiles;
    try {
      profiles = await DeviceRunSessionQuery.profilesAsync(graphqlClient);
      fetchSpinner?.stop();
    } catch (err) {
      fetchSpinner?.fail('Failed to fetch simulator devices');
      throw err;
    }

    const platforms = PLATFORM_ORDER.filter(
      platform => !flags.platform || flags.platform === platform
    );

    if (jsonFlag) {
      printJsonOnlyOutput(
        Object.fromEntries(
          platforms.map(platform => [
            platform,
            profiles[platform].devices.map(({ identifier, displayName }) => ({
              identifier,
              displayName,
            })),
          ])
        )
      );
      return;
    }

    const devices = platforms.flatMap(platform =>
      profiles[platform].devices.map(({ identifier, displayName }) => ({
        platform,
        displayName,
        flagValue: formatDeviceFlagValue(identifier),
      }))
    );
    if (devices.length === 0) {
      Log.log('No simulator devices found.');
      return;
    }

    const header = ['Platform', 'Device', '--device value'];
    const rows = devices.map(({ platform, displayName, flagValue }) => [
      appPlatformDisplayNames[DEVICE_RUN_SESSION_PLATFORM_BY_FLAG_VALUE[platform]],
      displayName,
      flagValue,
    ]);
    const widths = header.map((title, column) =>
      Math.max(title.length, ...rows.map(row => row[column].length))
    );
    const formatRow = (row: string[]): string =>
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join('  ')
        .trimEnd();
    Log.log([chalk.dim(formatRow(header)), ...rows.map(formatRow)].join('\n'));
    Log.newLine();
    Log.log(
      `Start a session with: eas simulator:start --platform ${devices[0].platform} --device ${devices[0].flagValue}`
    );
  }
}
