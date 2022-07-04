import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand.js';
import { AppleDeviceQuery } from '../../credentials/ios/api/graphql/queries/AppleDeviceQuery.js';
import { AppleTeamQuery } from '../../credentials/ios/api/graphql/queries/AppleTeamQuery.js';
import formatDevice from '../../devices/utils/formatDevice.js';
import Log from '../../log.js';
import { Ora, ora } from '../../ora.js';
import { getExpoConfig } from '../../project/expoConfig.js';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils.js';
import { promptAsync } from '../../prompts.js';

export default class BuildList extends EasCommand {
  static description = 'list all registered devices for your account';

  static flags = {
    'apple-team-id': Flags.string(),
  };

  async runAsync(): Promise<void> {
    let appleTeamIdentifier = (await this.parse(BuildList)).flags['apple-team-id'];

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const accountName = await getProjectAccountNameAsync(exp);

    let spinner: Ora;

    if (!appleTeamIdentifier) {
      spinner = ora().start('Fetching the list of teams for the project…');

      try {
        const teams = await AppleTeamQuery.getAllForAccountAsync(accountName);

        if (teams.length > 0) {
          spinner.succeed();

          if (teams.length === 1) {
            appleTeamIdentifier = teams[0].appleTeamIdentifier;
          } else {
            const result = await promptAsync({
              type: 'select',
              name: 'appleTeamIdentifier',
              message: 'What Apple Team would you like to list devices for?',
              choices: teams.map(team => ({
                title: team.appleTeamName
                  ? `${team.appleTeamName} (ID: ${team.appleTeamIdentifier})`
                  : team.appleTeamIdentifier,
                value: team.appleTeamIdentifier,
              })),
            });

            appleTeamIdentifier = result.appleTeamIdentifier;
          }
        } else {
          spinner.fail(`Couldn't find any teams for the account ${accountName}`);
        }
      } catch (e) {
        spinner.fail(`Something went wrong and we couldn't fetch the list of teams`);
        throw e;
      }
    }

    assert(appleTeamIdentifier, 'No team identifier is specified');

    spinner = ora().start('Fetching the list of devices for the team…');

    try {
      const result = await AppleDeviceQuery.getAllForAppleTeamAsync(
        accountName,
        appleTeamIdentifier
      );

      if (result?.appleDevices.length) {
        const { appleTeamName, appleDevices } = result;

        spinner.succeed(
          `Found ${appleDevices.length} devices for team ${appleTeamName ?? appleTeamIdentifier}`
        );

        const list = appleDevices
          .map(device =>
            formatDevice(device, { appleTeamName, appleTeamIdentifier: appleTeamIdentifier! })
          )
          .join(`\n\n${chalk.dim('———')}\n\n`);

        Log.log(`\n${list}`);
      } else {
        spinner.fail(`Couldn't find any devices for the team ${appleTeamIdentifier}`);
      }
    } catch (e) {
      spinner.fail(`Something went wrong and we couldn't fetch the device list`);
      throw e;
    }
  }
}
