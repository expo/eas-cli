import { promptAsync } from '../.././../prompts';
import { AppleDevice, AppleDeviceClass, AppleDeviceFragment } from '../../../graphql/generated';
import { APPLE_DEVICE_CLASS_LABELS } from '../../../graphql/types/credentials/AppleDevice';
import { ApplePlatform } from '../appstore/constants';

export function filterDevicesForApplePlatform(
  devices: AppleDeviceFragment[],
  applePlatform: ApplePlatform
): AppleDeviceFragment[] {
  if (applePlatform === ApplePlatform.TV_OS) {
    throw new Error('Filtering for tvOS is not supported yet');
  }

  if (applePlatform === ApplePlatform.VISION_OS) {
    throw new Error('Filtering for visionOS is not supported yet');
  }

  return devices.filter(device => isDeviceCompatibleWithApplePlatform(device, applePlatform));
}

function isDeviceCompatibleWithApplePlatform(
  device: AppleDeviceFragment,
  applePlatform: Exclude<ApplePlatform, ApplePlatform.TV_OS | ApplePlatform.VISION_OS>
): boolean {
  switch (applePlatform) {
    case ApplePlatform.IOS:
      return (
        device.deviceClass === AppleDeviceClass.Iphone ||
        device.deviceClass === AppleDeviceClass.Ipad
      );
    case ApplePlatform.MAC_OS:
      return device.deviceClass === AppleDeviceClass.Mac;
  }
}

export async function chooseDevicesAsync(
  allDevices: AppleDeviceFragment[],
  preselectedDeviceIdentifiers: string[] = []
): Promise<AppleDevice[]> {
  const preselectedDeviceIdentifierSet = new Set(preselectedDeviceIdentifiers);
  const isSelected = (device: AppleDeviceFragment): boolean =>
    preselectedDeviceIdentifierSet.has(device.identifier);
  const { devices } = await promptAsync({
    type: 'multiselect',
    name: 'devices',
    selectionFormat: '<num> devices selected',
    message: 'Select devices for the ad hoc build:',
    hint:
      '- / search. Enter applies search; Enter again submits. Space toggles; a toggles visible',
    searchable: true,
    choices: allDevices.map(device => ({
      value: device,
      title: formatDeviceLabel(device),
      selected: isSelected(device),
    })),
    instructions: false,
    min: 1,
  });
  return devices;
}

export function formatDeviceLabel(device: AppleDeviceFragment): string {
  const deviceDetails = formatDeviceDetails(device);
  return `${device.identifier}${deviceDetails !== '' ? ` ${deviceDetails}` : ''}${
    device.name ? ` (${device.name})` : ''
  }${device.createdAt ? ` (created at: ${device.createdAt})` : ''}`;
}

function formatDeviceDetails(device: AppleDeviceFragment): string {
  let details = '';
  if (device.deviceClass) {
    details += APPLE_DEVICE_CLASS_LABELS[device.deviceClass];
  }
  if (device.model) {
    details += details === '' ? device.model : ` ${device.model}`;
  }
  return details === '' ? details : `(${details})`;
}
