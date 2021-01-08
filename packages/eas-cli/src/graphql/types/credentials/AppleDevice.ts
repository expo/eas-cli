import gql from 'graphql-tag';

import { Fragment } from '../../fragment';
import { AppleDeviceClass } from '../../generated';

export const APPLE_DEVICE_CLASS_LABELS: Record<AppleDeviceClass, string> = {
  [AppleDeviceClass.Ipad]: 'iPad',
  [AppleDeviceClass.Iphone]: 'iPhone',
};

export const AppleDeviceFragment: Fragment = {
  name: 'appleDevice',
  definition: gql`
    fragment appleDevice on AppleDevice {
      id
      identifier
      name
      model
      deviceClass
    }
  `,
};
