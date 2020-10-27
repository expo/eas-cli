import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';

import { AppleDeviceMutation } from '../../../graphql/mutations/credentials/AppleDeviceMutation';
import { AppleDeviceClass } from '../../../graphql/types/credentials/AppleDevice';
import { AppleTeam } from '../../../graphql/types/credentials/AppleTeam';
import log from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { isValidUDID, normalizeUDID } from '../../udids';

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

  let registerNextDevice = true;
  while (registerNextDevice) {
    await collectDataAndRegisterDeviceAsync({ accountId, appleTeam });
    log.newLine();
    registerNextDevice = await confirmAsync({
      message: 'Do you want to register another device?',
    });
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
    await AppleDeviceMutation.createAppleDeviceAsync(
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
  appleTeam: AppleTeam,
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
    { title: 'iPhone', value: AppleDeviceClass.IPHONE },
    { title: 'iPad', value: AppleDeviceClass.IPAD },
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
