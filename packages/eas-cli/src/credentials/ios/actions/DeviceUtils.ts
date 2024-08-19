import { promptAsync } from '../.././../prompts';
import { AppleDevice, AppleDeviceFragment } from '../../../graphql/generated';
import { APPLE_DEVICE_CLASS_LABELS } from '../../../graphql/types/credentials/AppleDevice';

export async function chooseDevicesAsync(
  allDevices: AppleDeviceFragment[],
  preselectedDeviceIdentifiers: string[] = []
): Promise<AppleDevice[]> {
  const preselectedDeviceIdentifierSet = new Set(preselectedDeviceIdentifiers);
  const isSelected = (device: AppleDeviceFragment): boolean =>
    preselectedDeviceIdentifierSet.size === 0 ||
    preselectedDeviceIdentifierSet.has(device.identifier);
  const { devices } = await promptAsync({
    type: 'multiselect',
    name: 'devices',
    selectionFormat: '<num> devices selected',
    message: 'Select devices for the ad hoc build:',
    hint: '- Space to select. Return to submit',
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
