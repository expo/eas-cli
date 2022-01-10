import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand from '../../commandUtils/EasCommand';
import { chooseDevicesToDeleteAsync } from '../../credentials/ios/actions/DeviceUtils';
import { AppleDeviceMutation } from '../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import {
  AppleDeviceQuery,
  AppleDeviceQueryResult,
} from '../../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import { AppleTeamQuery } from '../../credentials/ios/api/graphql/queries/AppleTeamQuery';
import formatDevice from '../../devices/utils/formatDevice';
import { AppleDevice } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync, toggleConfirmAsync } from '../../prompts';

export default class DeviceDelete extends EasCommand {
  static description = 'remove a registered device from your account';

  static flags = {
    'apple-team-id': Flags.string(),
    udid: Flags.string({ multiple: true }),
  };

  async runAsync(): Promise<void> {
    let {
      flags: { 'apple-team-id': appleTeamIdentifier, udid: udids },
    } = await this.parse(DeviceDelete);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);

    if (!appleTeamIdentifier) {
      const teamSpinner = ora().start('Fetching the list of teams for the project…');

      try {
        const teams = await AppleTeamQuery.getAllForAccountAsync(accountName);

        if (teams.length > 0) {
          teamSpinner.succeed();

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
          teamSpinner.fail(`Couldn't find any teams for the account ${accountName}`);
        }
      } catch (e) {
        teamSpinner.fail(`Something went wrong and we couldn't fetch the list of teams`);
        throw e;
      }
    }

    assert(appleTeamIdentifier, 'No team identifier is specified');

    const devicesSpinner = ora().start('Fetching the list of devices for the team…');

    try {
      const result = await AppleDeviceQuery.getAllForAppleTeamAsync(
        accountName,
        appleTeamIdentifier
      );

      if (result?.appleDevices.length) {
        const { appleTeamName, appleDevices } = result;

        let chosenDevices: (AppleDeviceQueryResult | AppleDevice)[] = [];

        devicesSpinner.succeed(
          `Found ${appleDevices.length} devices for team ${appleTeamName ?? appleTeamIdentifier}`
        );

        Log.newLine();
        if (udids) {
          udids.forEach(udid => {
            const foundDevice = appleDevices.find(device => device.identifier === udid);
            if (foundDevice) {
              chosenDevices.push(foundDevice);
            } else {
              Log.warn(`No device found with UDID ${udid}.`);
            }
          });
        }

        if (chosenDevices.length === 0) {
          Log.addNewLineIfNone();
          chosenDevices = await chooseDevicesToDeleteAsync(appleDevices);
          Log.newLine();
        }

        Log.addNewLineIfNone();
        chosenDevices.forEach(device => {
          Log.log(
            `${formatDevice(device, {
              appleTeamName,
              appleTeamIdentifier: appleTeamIdentifier!,
            })}`
          );
          Log.newLine();
        });

        if (chosenDevices.length > 0) {
          Log.warn(
            `You are about to remove the Apple device${
              chosenDevices.length > 1 ? 's' : ''
            } listed above from your Expo account.`
          );
          Log.warn(
            `${
              chosenDevices.length > 1 ? 'They' : 'It'
            } will not be removed from your Apple team, only from your Expo account.`
          );
          Log.newLine();

          const confirmed = await toggleConfirmAsync({
            message: 'Are you sure you wish to proceed?',
          });

          if (confirmed) {
            const removalSpinner = ora(`Removing Apple devices on Expo`).start();
            try {
              chosenDevices.forEach(async chosenDevice => {
                await AppleDeviceMutation.deleteAppleDeviceAsync(chosenDevice.id);
              });
            } catch (err) {
              removalSpinner.fail();
              throw err;
            }
            removalSpinner.succeed();
          }
        } else {
          Log.newLine();
          Log.warn('No devices were chosen to be removed.');
        }
      } else {
        devicesSpinner.fail(`Couldn't find any devices for the team ${appleTeamIdentifier}`);
      }
    } catch (e) {
      devicesSpinner.fail(`Something went wrong and we couldn't fetch the device list`);
      throw e;
    }
  }
}
