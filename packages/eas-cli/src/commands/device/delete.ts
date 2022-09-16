import { Device, DeviceStatus } from '@expo/apple-utils';
import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand from '../../commandUtils/EasCommand';
import { chooseDevicesToDeleteAsync } from '../../credentials/ios/actions/DeviceUtils';
import { AppleDeviceMutation } from '../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import {
  AppleDeviceQuery,
  AppleDeviceQueryResult,
  AppleDevicesByTeamIdentifierQueryResult,
} from '../../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import { AppleTeamQuery } from '../../credentials/ios/api/graphql/queries/AppleTeamQuery';
import { authenticateAsync, getRequestContext } from '../../credentials/ios/appstore/authenticate';
import formatDevice from '../../devices/utils/formatDevice';
import { AppleDevice, Maybe } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getOwnerAccountForProjectIdAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync, toggleConfirmAsync } from '../../prompts';

export default class DeviceDelete extends EasCommand {
  static override description = 'remove a registered device from your account';

  static override flags = {
    'apple-team-id': Flags.string(),
    udid: Flags.string({ multiple: true }),
  };

  async runAsync(): Promise<void> {
    let {
      flags: { 'apple-team-id': appleTeamIdentifier, udid: udids },
    } = await this.parse(DeviceDelete);

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    // this command is interactive by design
    const projectId = await getProjectIdAsync(exp, { nonInteractive: false });
    const account = await getOwnerAccountForProjectIdAsync(projectId);

    if (!appleTeamIdentifier) {
      appleTeamIdentifier = await this.askForAppleTeamAsync(account.name);
    }

    assert(appleTeamIdentifier, 'No team identifier is specified');

    const appleDevicesResult = await this.getDevicesForTeamAsync(account.name, appleTeamIdentifier);

    if (!appleDevicesResult) {
      return;
    }

    const { appleTeamName, appleDevices } = appleDevicesResult;

    const chosenDevices = await this.chooseDevicesToDeleteAsync(appleDevices, udids);

    if (chosenDevices.length === 0) {
      Log.newLine();
      Log.warn('No devices were chosen to be removed.');
      return;
    }

    this.logChosenDevices(chosenDevices, appleTeamName, appleTeamIdentifier);

    const hasRemoved = await this.askAndRemoveFromExpoAsync(chosenDevices);

    if (!hasRemoved) {
      return;
    }

    await this.askAndDisableOnAppleAsync(chosenDevices, appleTeamIdentifier);
  }

  async askAndDisableOnAppleAsync(
    chosenDevices: (AppleDevice | AppleDeviceQueryResult)[],
    appleTeamIdentifier: string
  ): Promise<void> {
    Log.newLine();
    const deleteOnApple = await toggleConfirmAsync({
      message: 'Do you want to disable these devices on your Apple account as well?',
    });

    if (!deleteOnApple) {
      return;
    }

    const ctx = await authenticateAsync({ teamId: appleTeamIdentifier });
    const context = getRequestContext(ctx);

    Log.addNewLineIfNone();
    const removeAppleSpinner = ora('Disabling devices on Apple').start();
    try {
      const chosenDeviceIdentifiers = chosenDevices.map(cd => cd.identifier);
      const allDevices = await Device.getAsync(context);
      const realDevices = allDevices.filter(d =>
        chosenDeviceIdentifiers.includes(d.attributes.udid)
      );

      for (const device of realDevices) {
        await device.updateAsync({ status: DeviceStatus.DISABLED });
      }

      removeAppleSpinner.succeed('Disabled devices on Apple');
    } catch (err) {
      removeAppleSpinner.fail();
      throw err;
    }
  }

  async askAndRemoveFromExpoAsync(
    chosenDevices: (AppleDevice | AppleDeviceQueryResult)[]
  ): Promise<boolean> {
    Log.warn(
      `You are about to remove the Apple device${
        chosenDevices.length > 1 ? 's' : ''
      } listed above from your Expo account.`
    );
    Log.newLine();

    const confirmed = await toggleConfirmAsync({
      message: 'Are you sure you wish to proceed?',
    });

    if (confirmed) {
      const removalSpinner = ora(`Removing Apple devices on Expo`).start();
      try {
        for (const chosenDevice of chosenDevices) {
          await AppleDeviceMutation.deleteAppleDeviceAsync(chosenDevice.id);
        }
        removalSpinner.succeed('Removed Apple devices from Expo');
      } catch (err) {
        removalSpinner.fail();
        throw err;
      }
    }

    return confirmed;
  }

  logChosenDevices(
    chosenDevices: (AppleDevice | AppleDeviceQueryResult)[],
    appleTeamName: Maybe<string> | undefined,
    appleTeamIdentifier: string
  ): void {
    Log.addNewLineIfNone();
    chosenDevices.forEach(device => {
      Log.log(
        formatDevice(device, {
          appleTeamName,
          appleTeamIdentifier: appleTeamIdentifier!,
        })
      );
      Log.newLine();
    });
  }

  async chooseDevicesToDeleteAsync(
    appleDevices: AppleDeviceQueryResult[],
    udids: string[]
  ): Promise<(AppleDevice | AppleDeviceQueryResult)[]> {
    let chosenDevices: (AppleDeviceQueryResult | AppleDevice)[] = [];
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

    return chosenDevices;
  }

  async getDevicesForTeamAsync(
    accountName: string,
    appleTeamIdentifier: string
  ): Promise<AppleDevicesByTeamIdentifierQueryResult | undefined> {
    const devicesSpinner = ora().start('Fetching the list of devices for the team…');

    try {
      const result = await AppleDeviceQuery.getAllForAppleTeamAsync(
        accountName,
        appleTeamIdentifier
      );

      if (result?.appleDevices.length) {
        const { appleTeamName, appleDevices } = result;

        devicesSpinner.succeed(
          `Found ${appleDevices.length} devices for team ${appleTeamName ?? appleTeamIdentifier}`
        );

        return result;
      } else {
        devicesSpinner.fail(`Couldn't find any devices for the team ${appleTeamIdentifier}`);
        return;
      }
    } catch (e) {
      devicesSpinner.fail(`Something went wrong and we couldn't fetch the device list`);
      throw e;
    }
  }

  async askForAppleTeamAsync(accountName: string): Promise<string | undefined> {
    const teamSpinner = ora().start('Fetching the list of teams for the project…');

    try {
      const teams = await AppleTeamQuery.getAllForAccountAsync(accountName);

      if (teams.length > 0) {
        teamSpinner.succeed('Fetched the list of teams for the project');

        if (teams.length === 1) {
          return teams[0].appleTeamIdentifier;
        }

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

        return result.appleTeamIdentifier;
      } else {
        teamSpinner.fail(`Couldn't find any teams for the account ${accountName}`);
        return;
      }
    } catch (e) {
      teamSpinner.fail(`Something went wrong and we couldn't fetch the list of teams`);
      throw e;
    }
  }
}
