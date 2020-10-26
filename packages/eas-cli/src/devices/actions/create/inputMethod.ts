import assert from 'assert';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';
import ora from 'ora';

import { graphqlClient } from '../../../api';
import { AppleTeam } from '../../../credentials/ios/api/AppleTeam';
import log from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { isValidUDID } from '../../udids';

interface AppleDevice {
  id: string;
}

export enum AppleDeviceClass {
  IPHONE = 'IPHONE',
  IPAD = 'IPAD',
}

interface DeviceData {
  udid: string;
  name?: string;
  deviceClass: AppleDeviceClass | null;
}

const DEVICE_CLASS_DISPLAY_NAMES: Record<AppleDeviceClass, string> = {
  [AppleDeviceClass.IPHONE]: 'iPhone',
  [AppleDeviceClass.IPAD]: 'iPad',
};

export async function runInputMethodAsync(accountId: string, appleTeam: AppleTeam): Promise<void> {
  log.newLine();
  log(chalk.yellow('This is an advanced option. Use at your own risk.'));
  log.newLine();

  let finished = false;
  while (!finished) {
    await collectDataAndRegisterDeviceAsync({ accountId, appleTeam });
    log.newLine();
    finished = !(await confirmAsync({
      message: 'Do you want to register another device?',
    }));
  }
}

async function collectDataAndRegisterDeviceAsync({
  accountId,
  appleTeam,
}: {
  accountId: string;
  appleTeam: AppleTeam;
}): Promise<void> {
  const { udid, deviceClass, name } = await collectDeviceDataAsync(appleTeam);

  const spinner = ora(`Registering Apple Device on the Expo servers`).start();
  try {
    await registerDeviceAsync({
      accountId,
      appleTeamId: appleTeam.id,
      identifier: udid,
      name,
      deviceClass: deviceClass ?? undefined,
    });
  } catch (err) {
    spinner.fail();
    throw err;
  }
  spinner.succeed();
}

async function collectDeviceDataAsync(
  appleTeam: AppleTeam,
  placeholders: Partial<DeviceData> = {}
): Promise<DeviceData> {
  const udid = await promptForUDIDAsync(placeholders.udid);
  const name = await promptForNameAsync(placeholders.name);
  const deviceClass = await promptForDeviceClassAsync(placeholders.deviceClass);
  const deviceData: DeviceData = {
    udid,
    name,
    deviceClass,
  };

  log.newLine();
  log(
    `We are going to register the following device in our database.
This will ${chalk.bold('not')} register the device on the Apple Developer Portal yet.`
  );
  log.newLine();
  printDeviceDataSummary(deviceData, appleTeam);
  log.newLine();

  const registrationConfirmed = await confirmAsync({
    message: 'Is this what you want to register?',
  });
  if (!registrationConfirmed) {
    log('No worries, just try again.');
    log.newLine();
    return await collectDeviceDataAsync(appleTeam, deviceData);
  } else {
    return deviceData;
  }
}

async function promptForUDIDAsync(placeholder?: string): Promise<string> {
  const { udid } = await promptAsync({
    type: 'text',
    name: 'udid',
    message: 'UDID:',
    initial: placeholder,
    validate: val => {
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
  });
  return udid;
}

async function promptForNameAsync(placeholder?: string): Promise<string | undefined> {
  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Device name (optional):',
    initial: placeholder,
  });
  return name;
}

async function promptForDeviceClassAsync(
  placeholder?: AppleDeviceClass | null
): Promise<AppleDeviceClass | null> {
  const choices = [
    { title: 'iPhone', value: AppleDeviceClass.IPHONE },
    { title: 'iPad', value: AppleDeviceClass.IPAD },
    { title: 'Not sure (leave empty)', value: null },
  ];
  const values = choices.map(({ value }) => value);
  const initial = placeholder !== undefined && values.indexOf(placeholder);

  const { deviceClass } = await promptAsync({
    type: 'select',
    name: 'deviceClass',
    message: 'Device class (optional):',
    choices,
    initial,
  });
  return deviceClass;
}

function printDeviceDataSummary(
  { udid, name, deviceClass }: DeviceData,
  appleTeam: AppleTeam
): void {
  const deviceSummary = new Table({
    colWidths: [25, 55],
    wordWrap: true,
  });
  deviceSummary.push(
    ['Apple Team ID', appleTeam.appleTeamIdentifier],
    ['Apple Team Name', appleTeam.appleTeamName ?? '(unknown)'],
    ['Device UDID', udid],
    ['Device Name', name ?? '(empty)'],
    ['Device Class', deviceClass ? DEVICE_CLASS_DISPLAY_NAMES[deviceClass] : '(unknown)']
  );
  log(deviceSummary.toString());
}

async function registerDeviceAsync({
  accountId,
  appleTeamId,
  identifier,
  name,
  deviceClass,
}: {
  accountId: string;
  appleTeamId: string;
  identifier: string;
  name?: string;
  deviceClass?: AppleDeviceClass;
}): Promise<AppleDevice> {
  const result = await graphqlClient
    .mutation(
      gql`
        mutation AppleDeviceMutation($appleDeviceInput: AppleDeviceInput!, $accountId: ID!) {
          appleDevice {
            createAppleDevice(appleDeviceInput: $appleDeviceInput, accountId: $accountId) {
              id
            }
          }
        }
      `,
      {
        appleDeviceInput: {
          appleTeamId,
          identifier,
          name,
          deviceClass,
        },
        accountId,
      }
    )
    .toPromise();

  const { data, error } = result;
  if (error?.graphQLErrors) {
    const err = error?.graphQLErrors[0];
    throw err;
  }
  const device: AppleDevice = data?.appleDevice?.createAppleDevice;
  assert(device, `Failed to create the Apple Device`);
  return device;
}
