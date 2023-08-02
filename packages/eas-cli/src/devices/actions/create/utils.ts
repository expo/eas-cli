import chalk from 'chalk';

import { AppleDeviceClass, AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { isValidUDID, normalizeUDID } from '../../udids';
import { formatNewDevice } from '../../utils/formatDevice';

export interface DeviceData {
  udid: string;
  name?: string;
  deviceClass: AppleDeviceClass | null;
}

export async function promptForDeviceClassAsync(
  initial?: AppleDeviceClass | null
): Promise<AppleDeviceClass | null> {
  const choices = [
    { title: 'iPhone', value: AppleDeviceClass.Iphone },
    { title: 'iPad', value: AppleDeviceClass.Ipad },
    { title: 'Mac', value: AppleDeviceClass.Mac },
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

export async function promptForNameAsync(initial?: string): Promise<string | undefined> {
  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Device name (optional):',
    initial,
  });
  return name;
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

export function printDeviceData(
  deviceData: DeviceData,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName'>
): void {
  Log.newLine();
  Log.log(
    `We are going to register the following device in our database.
  This device will ${chalk.bold(
    'not'
  )} be registered on the Apple Developer Portal until it is chosen for an internal distribution build.`
  );
  Log.newLine();
  Log.log(formatNewDevice({ ...deviceData, identifier: deviceData.udid }, appleTeam));
  Log.newLine();
}
