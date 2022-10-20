import { AppleDevice, AppleDeviceClass, AppleTeam } from '../../graphql/generated';
import formatFields from '../../utils/formatFields';

type Device = Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'deviceClass' | 'enabled' | 'model'>;
type NewDevice = Pick<AppleDevice, 'identifier' | 'name' | 'deviceClass'>;

export type AppleTeamIdAndName = Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName'>;

export default function formatDevice(device: Device, team?: AppleTeamIdAndName): string {
  const fields = [
    { label: 'ID', value: device.id },
    { label: 'Name', value: device.name ?? 'Unknown' },
    {
      label: 'Class',
      value: device.deviceClass
        ? `${device.deviceClass}${device.model ? ` ${device.model}` : ''}`
        : 'Unknown',
    },
    { label: 'UDID', value: device.identifier },
  ];

  if (team) {
    fields.push(
      { label: 'Apple Team ID', value: team.appleTeamIdentifier },
      { label: 'Apple Team Name', value: team.appleTeamName ?? 'Unknown' }
    );
  }

  return formatFields(fields);
}

// TODO: integrate this with `formatDevice`
const DEVICE_CLASS_DISPLAY_NAMES: Record<AppleDeviceClass, string> = {
  [AppleDeviceClass.Iphone]: 'iPhone',
  [AppleDeviceClass.Ipad]: 'iPad',
};

export function formatNewDevice(device: NewDevice, team?: AppleTeamIdAndName): string {
  const fields = [
    { label: 'Name', value: device.name ?? '(empty)' },
    {
      label: 'Class',
      value: device.deviceClass ? DEVICE_CLASS_DISPLAY_NAMES[device.deviceClass] : 'Unknown',
    },
    { label: 'UDID', value: device.identifier },
  ];

  if (team) {
    fields.push(
      { label: 'Apple Team ID', value: team.appleTeamIdentifier },
      { label: 'Apple Team Name', value: team.appleTeamName ?? 'Unknown' }
    );
  }

  return formatFields(fields);
}
