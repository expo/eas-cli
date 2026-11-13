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
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import {
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';

const PLATFORM_FLAG_VALUES = ['android', 'ios'] as const;
type PlatformFlagValue = (typeof PLATFORM_FLAG_VALUES)[number];

const PLATFORM_ORDER: readonly PlatformFlagValue[] = ['ios', 'android'];
const PLATFORM_TITLES: Record<PlatformFlagValue, string> = {
  ios: 'iOS',
  android: 'Android',
};

type SimulatorDevice = { identifier: string; displayName: string };

export default class SimulatorDevices extends EasCommand {
  static override aliases = getSimulatorCommandAliases('devices');
  static override hiddenAliases = getSimulatorCommandHiddenAliases('devices');
  static override description = 'list the devices a remote simulator session can start';

  static override flags = {
    platform: Flags.option({
      char: 'p',
      description: 'Show the devices of one platform',
      options: PLATFORM_FLAG_VALUES,
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
    const devicesByPlatform = Object.fromEntries(
      platforms.map(platform => [
        platform,
        profiles[platform].devices.map(
          ({ identifier, displayName }): SimulatorDevice => ({ identifier, displayName })
        ),
      ])
    ) as Partial<Record<PlatformFlagValue, SimulatorDevice[]>>;

    if (jsonFlag) {
      printJsonOnlyOutput(devicesByPlatform);
      return;
    }

    const sections = platforms.map(platform => {
      const devices = devicesByPlatform[platform] ?? [];
      const width = Math.max(0, ...devices.map(({ identifier }) => identifier.length));
      const lines = devices.map(({ identifier, displayName }) =>
        identifier === displayName
          ? `  ${identifier}`
          : `  ${identifier.padEnd(width)}  ${chalk.dim(displayName)}`
      );
      return [chalk.bold(PLATFORM_TITLES[platform]), ...lines].join('\n');
    });
    Log.log(sections.join('\n\n'));
    Log.newLine();
    Log.log('Pass a device to eas simulator:start with --platform and --device.');
  }
}
