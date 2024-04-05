import gql from 'graphql-tag';

import { AppleDeviceClass } from '../../generated';

export const APPLE_DEVICE_CLASS_LABELS: Record<AppleDeviceClass, string> = {
  [AppleDeviceClass.Ipad]: 'iPad',
  [AppleDeviceClass.Iphone]: 'iPhone',
  [AppleDeviceClass.Mac]: 'Mac',
  [AppleDeviceClass.Unknown]: 'Unknown',
};

export const AppleDeviceFragmentNode = gql`
  fragment AppleDeviceFragment on AppleDevice {
    id
    identifier
    name
    model
    deviceClass
    createdAt
  }
`;
