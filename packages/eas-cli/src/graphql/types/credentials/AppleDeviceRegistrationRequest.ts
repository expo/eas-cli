import { Fragment } from '../../fragment';

export interface AppleDeviceRegistrationRequest {
  id: string;
}

export const AppleDeviceRegistrationRequestFragment: Fragment = {
  name: 'appleDeviceRegistrationRequest',
  definition: `
    fragment appleDeviceRegistrationRequest on AppleDeviceRegistrationRequest {
      id
    }
  `,
};
