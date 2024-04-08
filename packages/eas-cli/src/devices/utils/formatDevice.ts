import { AppleDevice, AppleDeviceClass, AppleTeam } from '../../graphql/generated';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';

type Device = Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'deviceClass' | 'enabled' | 'model'>;
type NewDevice = Pick<AppleDevice, 'identifier' | 'name' | 'deviceClass'>;

export type AppleTeamIdAndName = Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName'>;

const DEVICE_CLASS_DISPLAY_NAMES: Record<AppleDeviceClass, string> = {
  [AppleDeviceClass.Iphone]: 'iPhone',
  [AppleDeviceClass.Ipad]: 'iPad',
  [AppleDeviceClass.Mac]: 'Mac',
  [AppleDeviceClass.Unknown]: 'Unknown',
};

function formatDeviceClass(device: Device | NewDevice): string {
  if (!device.deviceClass || !DEVICE_CLASS_DISPLAY_NAMES[device.deviceClass]) {
    return 'Unknown';
  }

  return [DEVICE_CLASS_DISPLAY_NAMES[device.deviceClass], 'model' in device ? device.model : '']
    .filter(value => !!value)
    .join(' ');
}

export default function formatDevice(device: Device, team?: AppleTeamIdAndName): string {
  const fields: FormatFieldsItem[] = [
    { label: 'UDID', value: device.identifier },
    { label: 'Name', value: device.name ?? 'Unknown' },
    {
      label: 'Class',
      value: formatDeviceClass(device),
    },
  ];

  if (team) {
    fields.push(
      { label: 'Apple Team ID', value: team.appleTeamIdentifier },
      { label: 'Apple Team Name', value: team.appleTeamName ?? 'Unknown' }
    );
  }

  return formatFields(fields);
}

export function formatNewDevice(device: NewDevice, team?: AppleTeamIdAndName): string {
  const fields: FormatFieldsItem[] = [
    { label: 'Name', value: device.name ?? '(empty)' },
    {
      label: 'Class',
      value: formatDeviceClass(device),
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
