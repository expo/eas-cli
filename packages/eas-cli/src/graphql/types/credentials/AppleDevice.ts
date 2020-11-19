import { Fragment } from '../../fragment';
import { AppleTeam } from './AppleTeam';

export interface AppleDevice {
  id: string;
  identifier: string;
  name?: string;
  model?: string;
  deviceClass?: AppleDeviceClass;
  appleTeam?: AppleTeam;
}

export enum AppleDeviceClass {
  IPHONE = 'IPHONE',
  IPAD = 'IPAD',
}

export const APPLE_DEVICE_CLASS_LABELS: Record<AppleDeviceClass, string> = {
  [AppleDeviceClass.IPAD]: 'iPad',
  [AppleDeviceClass.IPHONE]: 'iPhone',
};

export const AppleDeviceFragment: Fragment = {
  name: 'appleDevice',
  definition: `
    fragment appleDevice on AppleDevice {
      id
      identifier
      name
      model
      deviceClass
    }
  `,
};
