import { Device, DeviceClass } from '@expo/apple-utils';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDeviceMutation } from '../../../credentials/ios/api/graphql/mutations/AppleDeviceMutation';
import {
  AppleDeviceFragmentWithAppleTeam,
  AppleDeviceQuery,
} from '../../../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import AppStoreApi from '../../../credentials/ios/appstore/AppStoreApi';
import { getRequestContext } from '../../../credentials/ios/appstore/authenticate';
import { AuthCtx } from '../../../credentials/ios/appstore/authenticateTypes';
import { AccountFragment, AppleDeviceClass, AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { ora } from '../../../ora';
import { promptAsync } from '../../../prompts';
import chunk from '../../../utils/expodash/chunk';

const DEVICE_IMPORT_CHUNK_SIZE = 10;
const DEVICE_CLASS_TO_GRAPHQL_TYPE: Partial<Record<DeviceClass, AppleDeviceClass>> = {
  [DeviceClass.IPAD]: AppleDeviceClass.Ipad,
  [DeviceClass.IPHONE]: AppleDeviceClass.Iphone,
  [DeviceClass.MAC]: AppleDeviceClass.Mac,
};

export async function runDeveloperPortalMethodAsync(
  graphqlClient: ExpoGraphqlClient,
  appStoreApi: AppStoreApi,
  account: AccountFragment,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
): Promise<void> {
  const appleAuthCtx = await appStoreApi.ensureAuthenticatedAsync();
  const unregisteredPortalDevices = await findUnregisteredPortalDevicesAsync(
    graphqlClient,
    appleAuthCtx,
    account.name,
    appleTeam
  );
  if (unregisteredPortalDevices.length === 0) {
    Log.log('All your devices registered on Apple Developer Portal are already imported to EAS.');
    return;
  }
  const devicesToImport = await chooseDevicesToImportAsync(unregisteredPortalDevices);
  await importDevicesAsync(graphqlClient, account.id, appleTeam, devicesToImport);
}

async function importDevicesAsync(
  graphqlClient: ExpoGraphqlClient,
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
      await importDeviceChunkAsync(graphqlClient, accountId, appleTeam, deviceChunk);
    }
  } catch (err) {
    spinner.fail();
    throw err;
  }
  spinner.succeed();
}

async function importDeviceChunkAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>,
  devices: Device[]
): Promise<void> {
  const promises = devices.map(device => {
    return AppleDeviceMutation.createAppleDeviceAsync(
      graphqlClient,
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
  graphqlClient: ExpoGraphqlClient,
  appleAuthCtx: AuthCtx,
  accountName: string,
  appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
): Promise<Device[]> {
  const expoRegisteredDevices = await AppleDeviceQuery.getAllByAppleTeamIdentifierAsync(
    graphqlClient,
    accountName,
    appleTeam.appleTeamIdentifier,
    { useCache: false }
  );
  const expoRegisteredDevicesByUdid = expoRegisteredDevices.reduce(
    (acc, device) => {
      acc[device.identifier] = device;
      return acc;
    },
    {} as Record<string, AppleDeviceFragmentWithAppleTeam>
  );

  const portalDevices = await Device.getAsync(getRequestContext(appleAuthCtx));
  return portalDevices.filter(
    portalDevice =>
      !(portalDevice.attributes.udid in expoRegisteredDevicesByUdid) &&
      [DeviceClass.IPAD, DeviceClass.IPHONE, DeviceClass.APPLE_TV, DeviceClass.MAC].includes(
        portalDevice.attributes.deviceClass
      )
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
