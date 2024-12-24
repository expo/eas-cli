import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import os from 'os';

import { DeviceData, printDeviceData, promptForNameAsync } from './utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import { AppleDeviceClass, AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync } from '../../../prompts';
import { DeviceCreateError } from '../../utils/errors';

export async function runCurrentMachineMethodAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
): Promise<void> {
  Log.newLine();
  Log.log(chalk.white('Checking if current machine is an Apple Silicon one.'));
  if (!isMachineAppleSilicon()) {
    throw new DeviceCreateError(
      "Current machine is not of Apple Silicon type - provisioning UDID can't be added automatically."
    );
  }
  Log.log(chalk.green('Check successful.'));

  await collectDataAndRegisterDeviceAsync(graphqlClient, { accountId, appleTeam });
}

function isMachineAppleSilicon(): boolean {
  return os.cpus()[0].model.includes('Apple M') && process.platform === 'darwin';
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
  const deviceData = await collectDeviceDataAsync(appleTeam);
  if (!deviceData) {
    return;
  }

  const { udid, deviceClass, name } = deviceData;
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
): Promise<DeviceData | null> {
  Log.log(chalk.white('Fetching the provisioning UDID.'));
  const [udid, defaultMachineName] = await fetchCurrentMachineUDIDAsync();
  Log.log(chalk.green(`Fetched the provisioning UDID - ${udid}`));
  const name = await promptForNameAsync(defaultMachineName ?? initialValues.name);
  const deviceClass = AppleDeviceClass.Mac;
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
    return null;
  } else {
    return deviceData;
  }
}

async function fetchCurrentMachineUDIDAsync(): Promise<[string, string?]> {
  try {
    const profilerData = (
      await spawnAsync('system_profiler', ['-json', 'SPHardwareDataType'])
    ).stdout.trim();
    if (!profilerData) {
      const message = 'Failed to fetch the provisioning UDID from system profiler';
      Log.error(message);
      throw new DeviceCreateError(message);
    }

    const profilerDataJSON = JSON.parse(profilerData);
    const provisioningUDID = profilerDataJSON?.SPHardwareDataType[0]?.provisioning_UDID;
    if (!provisioningUDID) {
      const message = 'System profiler data did not contain the provisioning UDID';
      Log.error(message);
      throw new DeviceCreateError(message);
    }

    const defaultMachineName = profilerDataJSON?.SPHardwareDataType[0]?.machine_name;
    return [provisioningUDID, defaultMachineName];
  } catch (err: any) {
    if (!(err instanceof DeviceCreateError)) {
      const message = `Failed to fetch the provisioning UDID of the current machine - ${err.message}`;
      Log.error(message);
      throw new DeviceCreateError(message);
    }
    throw err;
  }
}
