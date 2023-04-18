import chalk from 'chalk';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import { AppleDeviceClass, AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync, promptAsync } from '../../../prompts';
import { isValidUDID, normalizeUDID } from '../../udids';
import { formatNewDevice } from '../../utils/formatDevice';

interface DeviceData {
  udid: string;
  name?: string;
  deviceClass: AppleDeviceClass | null;
}

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

  const spinner = ora(`Registering Apple device on Expo`).start();
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

  Log.newLine();
  Log.log(
    `We are going to register the following device in our database.
This will ${chalk.bold('not')} register the device on the Apple Developer Portal yet.`
  );
  Log.newLine();
  Log.log(formatNewDevice({ ...deviceData, identifier: deviceData.udid }, appleTeam));
  Log.newLine();

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

export async function promptForUDIDAsync(initial?: string): Promise<string> {
  const { udid } = await promptAsync({
    type: 'text',
    name: 'udid',
    message: 'UDID:',
    initial,
    validate: (rawVal: string) => {
      const val = normalizeUDID(rawVal);
      if (!val || val === '') {
        return 'UDID cannot be empty';
      } else if (val.length !== 25 && val.length !== 40) {
        return 'UDID should be a 25 or 40-character string';
      } else if (!isValidUDID(val)) {
        return 'UDID is invalid';
      } else {
        return true;
      }
    },
    format: (val: string) => normalizeUDID(val),
  });
  return udid;
}

async function promptForNameAsync(initial?: string): Promise<string | undefined> {
  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Device name (optional):',
    initial,
  });
  return name;
}

async function promptForDeviceClassAsync(
  initial?: AppleDeviceClass | null
): Promise<AppleDeviceClass | null> {
  const choices = [
    { title: 'iPhone', value: AppleDeviceClass.Iphone },
    { title: 'iPad', value: AppleDeviceClass.Ipad },
    { title: 'Not sure (leave empty)', value: null },
  ];
  const values = choices.map(({ value }) => value);

  const { deviceClass } = await promptAsync({
    type: 'select',
    name: 'deviceClass',
    message: 'Device class (optional):',
    choices,
    initial: initial !== undefined && values.indexOf(initial),
  });
  return deviceClass;
}
