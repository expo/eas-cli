import { Device } from '@expo/apple-utils';
import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
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
import { AppleDevice, AppleTeamFragment, Maybe } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class DeviceRename extends EasCommand {
  static override description = 'rename a registered device';

  static override flags = {
    'apple-team-id': Flags.string({ description: 'The Apple team ID on which to find the device' }),
    udid: Flags.string({ description: 'The Apple device ID to rename' }),
    name: Flags.string({ description: 'The new name for the device' }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(DeviceRename);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    let { 'apple-team-id': appleTeamIdentifier, udid, name } = flags;
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(DeviceRename, {
      nonInteractive: paginatedQueryOptions.nonInteractive,
    });
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    let appleTeamName;

    if (paginatedQueryOptions.json) {
      enableJsonOutput();
    }

    let appleTeam: AppleTeamFragment;

    if (!appleTeamIdentifier) {
      appleTeam = await selectAppleTeamOnAccountAsync(graphqlClient, {
        accountName: account.name,
        selectionPromptTitle: `What Apple team would you like to list devices for?`,
        paginatedQueryOptions,
      });
      appleTeamIdentifier = appleTeam.appleTeamIdentifier;
      appleTeamName = appleTeam.appleTeamName;
    }

    assert(appleTeamIdentifier, 'No team identifier is specified');

    const chosenDevice = udid
      ? await AppleDeviceQuery.getByDeviceIdentifierAsync(graphqlClient, account.name, udid)
      : await selectAppleDeviceOnAppleTeamAsync(graphqlClient, {
          accountName: account.name,
          appleTeamIdentifier,
          selectionPromptTitle: `Which device would you like to rename?`,
          paginatedQueryOptions,
        });

    const newDeviceName = name ? name : await this.promptForNewDeviceNameAsync(chosenDevice.name);

    this.logChosenDevice(chosenDevice, appleTeamName, appleTeamIdentifier, paginatedQueryOptions);

    await this.renameDeviceOnExpoAsync(graphqlClient, chosenDevice, newDeviceName!);

    await this.renameDeviceOnAppleAsync(chosenDevice, appleTeamIdentifier, newDeviceName!);
  }

  async promptForNewDeviceNameAsync(
    initial: Maybe<string> | undefined
  ): Promise<string | undefined> {
    const { name } = await promptAsync({
      type: 'text',
      name: 'name',
      message: 'New device name:',
      initial: initial ?? undefined,
    });
    return name;
  }

  async renameDeviceOnExpoAsync(
    graphqlClient: ExpoGraphqlClient,
    chosenDevice: AppleDevice | AppleDeviceQueryResult,
    newDeviceName: string
  ): Promise<void> {
    const removalSpinner = ora(`Renaming Apple device on Expo`).start();
    try {
      await AppleDeviceMutation.updateAppleDeviceAsync(graphqlClient, chosenDevice.id, {
        name: newDeviceName,
      });
      removalSpinner.succeed('Renamed Apple device on Expo');
    } catch (err) {
      removalSpinner.fail();
      throw err;
    }
  }

  async renameDeviceOnAppleAsync(
    device: AppleDevice | AppleDeviceQueryResult,
    appleTeamIdentifier: string,
    newDeviceName: string
  ): Promise<void> {
    const ctx = await authenticateAsync({ teamId: appleTeamIdentifier });
    const context = getRequestContext(ctx);

    Log.addNewLineIfNone();
    const removeAppleSpinner = ora('Renaming device on Apple').start();
    try {
      const appleValidatedDevices = await Device.getAsync(context);
      const appleValidatedDevice = appleValidatedDevices.find(
        d => d.attributes.udid === device.identifier
      );
      if (appleValidatedDevice) {
        await appleValidatedDevice.updateAsync({ name: newDeviceName });
        removeAppleSpinner.succeed('Renamed device on Apple');
      } else {
        removeAppleSpinner.warn(
          'Device not found on Apple Developer Portal. Expo-registered devices will not appear there until they are chosen for an internal distribution build.'
        );
      }
    } catch (err) {
      removeAppleSpinner.fail();
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
          appleTeamIdentifier,
        })
      );
      Log.newLine();
    }
  }
}
