import { AppleDevice, AppleTeam } from '../../graphql/generated';
import formatFields from '../../utils/formatFields';

type Device = Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'deviceClass' | 'enabled' | 'model'>;

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
      ...[
        { label: 'Apple Team ID', value: team.appleTeamIdentifier },
        { label: 'Apple Team Name', value: team.appleTeamName ?? 'Unknown' },
      ]
    );
  }

  return formatFields(fields);
}
