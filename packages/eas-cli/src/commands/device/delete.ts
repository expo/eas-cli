import { Device, DeviceStatus } from '@expo/apple-utils';
import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand, { EASCommandProjectConfigContext } from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { PaginatedQueryOptions, getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { AppleDeviceMutation } from '../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import {
  AppleDeviceQuery,
  AppleDeviceQueryResult,
} from '../../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import { authenticateAsync, getRequestContext } from '../../credentials/ios/appstore/authenticate';
import {
  selectAppleDeviceOnAppleTeamAsync,
  selectAppleTeamOnAccountAsync,
} from '../../devices/queries';
import formatDevice from '../../devices/utils/formatDevice';
import { AppleDevice, Maybe } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { toggleConfirmAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class DeviceDelete extends EasCommand {
  static override description = 'remove a registered device from your account';

  static override flags = {
    'apple-team-id': Flags.string({ description: 'The Apple team ID on which to find the device' }),
    udid: Flags.string({ description: 'The Apple device ID to disable' }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...EASCommandProjectConfigContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(DeviceDelete);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    let { 'apple-team-id': appleTeamIdentifier, udid } = flags;
    const {
      projectConfig: { projectId },
    } = await this.getContextAsync(DeviceDelete, {
      nonInteractive: paginatedQueryOptions.nonInteractive,
    });
    const account = await getOwnerAccountForProjectIdAsync(projectId);
    let appleTeamName;

    if (paginatedQueryOptions.json) {
      enableJsonOutput();
    }

    if (!appleTeamIdentifier) {
      const appleTeam = await selectAppleTeamOnAccountAsync({
        accountName: account.name,
        selectionPromptTitle: `What Apple Team would you like to list devices for?`,
        paginatedQueryOptions,
      });
      appleTeamIdentifier = appleTeam.appleTeamIdentifier;
      appleTeamName = appleTeam.appleTeamName;
    }

    assert(appleTeamIdentifier, 'No team identifier is specified');

    const chosenDevice = udid
      ? await AppleDeviceQuery.getByDeviceIdentifierAsync(account.name, udid)
      : await selectAppleDeviceOnAppleTeamAsync({
          accountName: account.name,
          appleTeamIdentifier,
          selectionPromptTitle: `Which device would you like to disable?`,
          paginatedQueryOptions,
        });

    this.logChosenDevice(chosenDevice, appleTeamName, appleTeamIdentifier, paginatedQueryOptions);

    if (!(await this.shouldRemoveDeviceFromExpoAsync(paginatedQueryOptions))) {
      return;
    }

    await this.removeDeviceFromExpoAsync(chosenDevice);

    if (await this.shouldDisableDeviceOnAppleAsync(paginatedQueryOptions)) {
      await this.disableDeviceOnAppleAsync(chosenDevice, appleTeamIdentifier);
    }
  }

  async shouldDisableDeviceOnAppleAsync({
    nonInteractive,
  }: PaginatedQueryOptions): Promise<boolean> {
    if (!nonInteractive) {
      Log.newLine();
      return await toggleConfirmAsync({
        message: 'Do you want to disable this device on your Apple account as well?',
      });
    }
    return true;
  }

  async disableDeviceOnAppleAsync(
    device: AppleDevice | AppleDeviceQueryResult,
    appleTeamIdentifier: string
  ): Promise<void> {
    const ctx = await authenticateAsync({ teamId: appleTeamIdentifier });
    const context = getRequestContext(ctx);

    Log.addNewLineIfNone();
    const removeAppleSpinner = ora('Disabling device on Apple').start();
    try {
      const appleValidatedDevices = await Device.getAsync(context);
      const appleValidatedDevice = appleValidatedDevices.find(d => d.id === device.id);
      if (appleValidatedDevice) {
        await appleValidatedDevice.updateAsync({ status: DeviceStatus.DISABLED });
      }
      removeAppleSpinner.succeed('Disabled device on Apple');
    } catch (err) {
      removeAppleSpinner.fail();
      throw err;
    }
  }

  async shouldRemoveDeviceFromExpoAsync({
    nonInteractive,
  }: PaginatedQueryOptions): Promise<boolean> {
    if (!nonInteractive) {
      Log.warn(`You are about to remove the Apple device listed above from your Expo account.`);
      Log.newLine();

      return await toggleConfirmAsync({
        message: 'Are you sure you wish to proceed?',
      });
    }
    return true;
  }

  async removeDeviceFromExpoAsync(
    chosenDevice: AppleDevice | AppleDeviceQueryResult
  ): Promise<void> {
    const removalSpinner = ora(`Removing Apple device on Expo`).start();
    try {
      await AppleDeviceMutation.deleteAppleDeviceAsync(chosenDevice.id);
      removalSpinner.succeed('Removed Apple device from Expo');
    } catch (err) {
      removalSpinner.fail();
      throw err;
    }
  }

  logChosenDevice(
    device: AppleDevice | AppleDeviceQueryResult,
    appleTeamName: Maybe<string> | undefined,
    appleTeamIdentifier: string,
    { json }: PaginatedQueryOptions
  ): void {
    if (json) {
      printJsonOnlyOutput(device);
    } else {
      Log.addNewLineIfNone();
      Log.log(
        formatDevice(device, {
          appleTeamName,
          appleTeamIdentifier: appleTeamIdentifier!,
        })
      );
      Log.newLine();
    }
  }
}
