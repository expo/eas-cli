import { Fragment } from '../../fragment';
import { AppleAppIdentifier } from './AppleAppIdentifier';
import { AppleDevice } from './AppleDevice';
import { AppleTeam } from './AppleTeam';

export interface AppleProvisioningProfile {
  id: string;
  expiration: Date;
  developerPortalIdentifier: string;
  provisioningProfile: string;
  appleTeam?: AppleTeam;
  appleAppIdentifier?: AppleAppIdentifier;
  appleDevices?: AppleDevice[];
}

export const AppleProvisioningProfileFragment: Fragment = {
  name: 'appleProvisioningProfile',
  definition: `
    fragment appleProvisioningProfile on AppleProvisioningProfile {
      id
      expiration
      developerPortalIdentifier
      provisioningProfile
    }
  `,
};
