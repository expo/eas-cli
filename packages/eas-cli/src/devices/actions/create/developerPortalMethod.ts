import { Device, DeviceClass } from '@expo/apple-utils';

import { AppleDeviceMutation } from '../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import {
  AppleDeviceFragmentWithAppleTeam,
  AppleDeviceQuery,
} from '../../../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import AppStoreApi from '../../../credentials/ios/appstore/AppStoreApi';
import { getRequestContext } from '../../../credentials/ios/appstore/authenticate';
import { AuthCtx } from '../../../credentials/ios/appstore/authenticateTypes';
import { AppleDeviceClass, AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { ora } from '../../../ora';
import { promptAsync } from '../../../prompts';
import chunk from '../../../utils/expodash/chunk';

const DEVICE_IMPORT_CHUNK_SIZE = 10;
const DEVICE_CLASS_TO_GRAPHQL_TYPE: Partial<Record<DeviceClass, AppleDeviceClass>> = {
  [DeviceClass.IPAD]: AppleDeviceClass.Ipad,
  [DeviceClass.IPHONE]: AppleDeviceClass.Iphone,
};

export async function runDeveloperPortalMethodAsync(
  appStoreApi: AppStoreApi,
  accountId: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
): Promise<void> {
  const appleAuthCtx = await appStoreApi.ensureAuthenticatedAsync();
  const unregisteredPortalDevices = await findUnregisteredPortalDevicesAsync(
    appleAuthCtx,
    accountId,
    appleTeam
  );
  if (unregisteredPortalDevices.length === 0) {
    Log.log('All your devices registered on Apple Developer Portal are already imported to EAS.');
    return;
  }
  const devicesToImport = await chooseDevicesToImportAsync(unregisteredPortalDevices);
  await importDevicesAsync(accountId, appleTeam, devicesToImport);
}

async function importDevicesAsync(
  accountId: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>,
  devices: Device[]
): Promise<void> {
  const spinner = ora(
    `Importing ${devices.length} Apple device${devices.length === 1 ? '' : 's'} to EAS`
  ).start();
  const deviceChunks = chunk(devices, DEVICE_IMPORT_CHUNK_SIZE);
  try {
    for (const deviceChunk of deviceChunks) {
      await importDeviceChunkAsync(accountId, appleTeam, deviceChunk);
    }
  } catch (err) {
    spinner.fail();
    throw err;
  }
  spinner.succeed();
}

async function importDeviceChunkAsync(
  accountId: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>,
  devices: Device[]
): Promise<void> {
  const promises = devices.map(device => {
    return AppleDeviceMutation.createAppleDeviceAsync(
      {
        appleTeamId: appleTeam.id,
        identifier: device.attributes.udid,
        name: device.attributes.name,
        deviceClass: DEVICE_CLASS_TO_GRAPHQL_TYPE[device.attributes.deviceClass] ?? undefined,
      },
      accountId
    );
  });
  await Promise.all(promises);
}

async function findUnregisteredPortalDevicesAsync(
  appleAuthCtx: AuthCtx,
  accountId: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
): Promise<Device[]> {
  const expoRegisteredDevices = await AppleDeviceQuery.getAllByAppleTeamIdentifierAsync(
    accountId,
    appleTeam.appleTeamIdentifier,
    { useCache: false }
  );
  const expoRegisteredDevicesByUdid = expoRegisteredDevices.reduce((acc, device) => {
    acc[device.identifier] = device;
    return acc;
  }, {} as Record<string, AppleDeviceFragmentWithAppleTeam>);

  const portalDevices = await Device.getAllIOSProfileDevicesAsync(getRequestContext(appleAuthCtx));
  return portalDevices.filter(
    portalDevice =>
      !(portalDevice.attributes.udid in expoRegisteredDevicesByUdid) &&
      [DeviceClass.IPAD, DeviceClass.IPHONE].includes(portalDevice.attributes.deviceClass)
  );
}

async function chooseDevicesToImportAsync(devices: Device[]): Promise<Device[]> {
  const { chosenDevices } = await promptAsync({
    type: 'multiselect',
    name: 'chosenDevices',
    message: 'Which devices do you want to import to EAS?',
    choices: devices.map(device => ({
      value: device,
      title: formatDeviceLabel(device),
      selected: true,
    })),
  });
  return chosenDevices;
}

export function formatDeviceLabel(device: Device): string {
  const deviceDetails = formatDeviceDetails(device);
  return `${device.attributes.name} - ${device.attributes.udid})${
    deviceDetails !== '' ? ` - ${deviceDetails}` : ''
  }`;
}

function formatDeviceDetails(device: Device): string {
  let details: string = device.attributes.deviceClass;
  if (device.attributes.model) {
    details = device.attributes.model;
  }
  return details === '' ? details : `(${details})`;
}
