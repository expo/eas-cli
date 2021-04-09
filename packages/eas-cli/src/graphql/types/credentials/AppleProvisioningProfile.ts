import { print } from 'graphql';
import gql from 'graphql-tag';

import { AppleDeviceFragmentNode } from './AppleDevice';

export const AppleProvisioningProfileFragmentNode = gql`
  fragment AppleProvisioningProfileFragment on AppleProvisioningProfile {
    id
    expiration
    developerPortalIdentifier
    provisioningProfile
    updatedAt
    status
    appleTeam {
      id
      appleTeamIdentifier
      appleTeamName
    }
    appleDevices {
      id
      ...AppleDeviceFragment
    }
  }
  ${print(AppleDeviceFragmentNode)}
`;
export const AppleProvisioningProfileIdentifiersFragmentNode = gql`
  fragment AppleProvisioningProfileIdentifiersFragment on AppleProvisioningProfile {
    id
    developerPortalIdentifier
  }
`;
