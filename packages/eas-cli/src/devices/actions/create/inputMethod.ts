import chalk from 'chalk';

import {
  DeviceData,
  printDeviceData,
  promptForDeviceClassAsync,
  promptForNameAsync,
  promptForUDIDAsync,
} from './utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import { AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync } from '../../../prompts';

export async function runInputMethodAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
): Promise<void> {
  Log.newLine();
  Log.log(chalk.yellow('This is an advanced option. Use at your own risk.'));
  Log.newLine();

  let registerNextDevice = true;
  while (registerNextDevice) {
    await collectDataAndRegisterDeviceAsync(graphqlClient, { accountId, appleTeam });
    Log.newLine();
    registerNextDevice = await confirmAsync({
      message: 'Do you want to register another device?',
    });
  }
}

async function collectDataAndRegisterDeviceAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    accountId,
    appleTeam,
  }: {
    accountId: string;
    appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>;
  }
): Promise<void> {
  const { udid, deviceClass, name } = await collectDeviceDataAsync(appleTeam);

  const spinner = ora(`Registering Apple device on EAS`).start();
  try {
    await AppleDeviceMutation.createAppleDeviceAsync(
      graphqlClient,
      {
        appleTeamId: appleTeam.id,
        identifier: udid,
        name,
        deviceClass: deviceClass ?? undefined,
      },
      accountId
    );
  } catch (err) {
    spinner.fail();
    throw err;
  }
  spinner.succeed();
}

async function collectDeviceDataAsync(
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName'>,
  initialValues: Partial<DeviceData> = {}
): Promise<DeviceData> {
  const udid = await promptForUDIDAsync(initialValues.udid);
  const name = await promptForNameAsync(initialValues.name);
  const deviceClass = await promptForDeviceClassAsync(initialValues.deviceClass);
  const deviceData: DeviceData = {
    udid,
    name,
    deviceClass,
  };

  printDeviceData(deviceData, appleTeam);

  const registrationConfirmed = await confirmAsync({
    message: 'Is this what you want to register?',
  });
  if (!registrationConfirmed) {
    Log.log('No worries, just try again.');
    Log.newLine();
    return await collectDeviceDataAsync(appleTeam, deviceData);
  } else {
    return deviceData;
  }
}
