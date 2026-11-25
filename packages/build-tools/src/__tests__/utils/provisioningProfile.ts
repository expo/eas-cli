import plist, { PlistObject } from '@expo/plist';

import { IosDistributionType } from '../../steps/utils/ios/credentials/storedCredentialsQueries';

const PROVISIONED_DEVICES = ['00008030-000A11112222002E'];
const PROFILE_FIELDS_BY_TYPE: Record<
  IosDistributionType,
  { getTaskAllow: boolean; devices: PlistObject }
> = {
  APP_STORE: { getTaskAllow: false, devices: {} },
  AD_HOC: { getTaskAllow: false, devices: { ProvisionedDevices: PROVISIONED_DEVICES } },
  DEVELOPMENT: { getTaskAllow: true, devices: { ProvisionedDevices: PROVISIONED_DEVICES } },
  ENTERPRISE: { getTaskAllow: false, devices: { ProvisionsAllDevices: true } },
};

export function createTestProvisioningProfileBase64({
  bundleIdentifierPattern,
  expirationDate = new Date('2100-01-01T00:00:00.000Z'),
  type = 'APP_STORE',
}: {
  bundleIdentifierPattern: string;
  expirationDate?: Date;
  type?: IosDistributionType;
}): string {
  const { getTaskAllow, devices } = PROFILE_FIELDS_BY_TYPE[type];
  return Buffer.from(
    plist.build({
      ExpirationDate: expirationDate,
      Entitlements: {
        'application-identifier': `ABCDE12345.${bundleIdentifierPattern}`,
        'get-task-allow': getTaskAllow,
      },
      ...devices,
    })
  ).toString('base64');
}
