import { print } from 'graphql';
import gql from 'graphql-tag';

import { AppFragmentNode } from '../App';
import { AppleAppIdentifierFragmentNode } from './AppleAppIdentifier';
import { AppleProvisioningProfileIdentifiersFragmentNode } from './AppleProvisioningProfile';
import { AppleTeamFragmentNode } from './AppleTeam';

export const AppleDistributionCertificateFragmentNode = gql`
  fragment AppleDistributionCertificateFragment on AppleDistributionCertificate {
    id
    certificateP12
    certificatePassword
    serialNumber
    developerPortalIdentifier
    validityNotBefore
    validityNotAfter
    updatedAt
    appleTeam {
      id
      ...AppleTeamFragment
    }
    iosAppBuildCredentialsList {
      id
      iosAppCredentials {
        id
        app {
          id
          ...AppFragment
        }
        appleAppIdentifier {
          id
          ...AppleAppIdentifierFragment
        }
      }
      provisioningProfile {
        id
        ...AppleProvisioningProfileIdentifiersFragment
      }
    }
  }
  ${print(AppleTeamFragmentNode)}
  ${print(AppFragmentNode)}
  ${print(AppleAppIdentifierFragmentNode)}
  ${print(AppleProvisioningProfileIdentifiersFragmentNode)}
`;
