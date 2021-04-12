import { print } from 'graphql';
import gql from 'graphql-tag';

import { AppleDeviceFragmentNode } from './AppleDevice';
import { AppleTeamFragmentNode } from './AppleTeam';

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
      ...AppleTeamFragment
    }
    appleDevices {
      id
      ...AppleDeviceFragment
    }
  }
  ${print(AppleDeviceFragmentNode)}
  ${print(AppleTeamFragmentNode)}
`;
export const AppleProvisioningProfileIdentifiersFragmentNode = gql`
  fragment AppleProvisioningProfileIdentifiersFragment on AppleProvisioningProfile {
    id
    developerPortalIdentifier
  }
`;
