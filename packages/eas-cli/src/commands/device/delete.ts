import { Device, DeviceStatus } from '@expo/apple-utils';
import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand, { CommandContext } from '../../commandUtils/EasCommand';
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
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';

export default class DeviceDelete extends EasCommand {
  static override description = 'remove a registered device from your account';

  static override flags = {
    'apple-team-id': Flags.string(),
    udid: Flags.string({ multiple: true }),
  };

  protected async runAsync(commandContext: CommandContext): Promise<{ jsonOutput: object }> {
    let {
      flags: { 'apple-team-id': appleTeamIdentifier, udid: udids },
    } = await this.parse(DeviceDelete);

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const accountName = await getProjectAccountNameAsync(exp);

    if (!appleTeamIdentifier) {
      if (commandContext.nonInteractive) {
        throw new Error('Must supply `apple-team-id` in non-interactive mode');
      }
      appleTeamIdentifier = await this.askForAppleTeamAsync(commandContext, accountName);
    }

    assert(appleTeamIdentifier, 'No team identifier is specified');

    const appleDevicesResult = await this.getDevicesForTeamAsync(
      commandContext,
      accountName,
      appleTeamIdentifier
    );

    if (!appleDevicesResult) {
      return { jsonOutput: [] };
    }

    const { appleTeamName, appleDevices } = appleDevicesResult;

    const chosenDevices = await this.chooseDevicesToDeleteAsync(
      commandContext,
      appleDevices,
      udids
    );

    if (chosenDevices.length === 0) {
      commandContext.logger.newLine();
      commandContext.logger.warn('No devices were chosen to be removed.');
      return { jsonOutput: [] };
    }

    this.logChosenDevices(commandContext, chosenDevices, appleTeamName, appleTeamIdentifier);

    const hasRemoved = await this.askAndRemoveFromExpoAsync(commandContext, chosenDevices);
    if (!hasRemoved) {
      return { jsonOutput: [] };
    }

    await this.askAndDisableOnAppleAsync(commandContext, chosenDevices, appleTeamIdentifier);

    return { jsonOutput: chosenDevices.map(it => it.id) };
  }

  async askAndDisableOnAppleAsync(
    { nonInteractive, logger, prompts: { toggleConfirmAsync }, ora }: CommandContext,
    chosenDevices: (AppleDevice | AppleDeviceQueryResult)[],
    appleTeamIdentifier: string
  ): Promise<void> {
    logger.newLine();
    const deleteOnApple = nonInteractive
      ? true
      : await toggleConfirmAsync({
          message: 'Do you want to disable these devices on your Apple account as well?',
        });

    if (!deleteOnApple) {
      return;
    }

    const ctx = await authenticateAsync({ teamId: appleTeamIdentifier });
    const context = getRequestContext(ctx);

    logger.addNewLineIfNone();
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
    { nonInteractive, logger, prompts: { toggleConfirmAsync }, ora }: CommandContext,
    chosenDevices: (AppleDevice | AppleDeviceQueryResult)[]
  ): Promise<boolean> {
    logger.warn(
      `You are about to remove the Apple device${
        chosenDevices.length > 1 ? 's' : ''
      } listed above from your Expo account.`
    );
    logger.newLine();

    const confirmed = nonInteractive
      ? true
      : await toggleConfirmAsync({
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
    { logger }: CommandContext,
    chosenDevices: (AppleDevice | AppleDeviceQueryResult)[],
    appleTeamName: Maybe<string> | undefined,
    appleTeamIdentifier: string
  ): void {
    logger.addNewLineIfNone();
    chosenDevices.forEach(device => {
      logger.log(
        formatDevice(device, {
          appleTeamName,
          appleTeamIdentifier: appleTeamIdentifier!,
        })
      );
      logger.newLine();
    });
  }

  async chooseDevicesToDeleteAsync(
    { nonInteractive, logger }: CommandContext,
    appleDevices: AppleDeviceQueryResult[],
    udids: string[]
  ): Promise<(AppleDevice | AppleDeviceQueryResult)[]> {
    let chosenDevices: (AppleDeviceQueryResult | AppleDevice)[] = [];
    logger.newLine();
    if (udids) {
      udids.forEach(udid => {
        const foundDevice = appleDevices.find(device => device.identifier === udid);
        if (foundDevice) {
          chosenDevices.push(foundDevice);
        } else {
          logger.warn(`No device found with UDID ${udid}.`);
        }
      });
    }

    if (chosenDevices.length === 0) {
      if (nonInteractive) {
        throw new Error('Must supply `udid` paramter in non-interactive mode');
      }
      logger.addNewLineIfNone();
      chosenDevices = await chooseDevicesToDeleteAsync(appleDevices);
      logger.newLine();
    }

    return chosenDevices;
  }

  async getDevicesForTeamAsync(
    { ora }: CommandContext,
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

  async askForAppleTeamAsync(
    { prompts: { promptAsync }, ora }: CommandContext,
    accountName: string
  ): Promise<string | undefined> {
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
