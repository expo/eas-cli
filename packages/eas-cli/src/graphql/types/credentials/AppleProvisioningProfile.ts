import gql from 'graphql-tag';

import { Fragment } from '../../fragment';

export const AppleProvisioningProfileFragment: Fragment = {
  name: 'appleProvisioningProfile',
  definition: gql`
    fragment appleProvisioningProfile on AppleProvisioningProfile {
      id
      expiration
      developerPortalIdentifier
      provisioningProfile
      appleTeam {
        id
        appleTeamIdentifier
        appleTeamName
      }
      appleDevices {
        id
        identifier
        name
        model
        deviceClass
      }
    }
  `,
};
