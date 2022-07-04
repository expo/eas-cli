import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { AppleDistributionCertificateFragmentNode } from './AppleDistributionCertificate.js';
import { AppleProvisioningProfileFragmentNode } from './AppleProvisioningProfile.js';

export const IosAppBuildCredentialsFragmentNode = gql`
  fragment IosAppBuildCredentialsFragment on IosAppBuildCredentials {
    id
    iosDistributionType
    distributionCertificate {
      id
      ...AppleDistributionCertificateFragment
    }
    provisioningProfile {
      id
      ...AppleProvisioningProfileFragment
    }
  }
  ${print(AppleDistributionCertificateFragmentNode)}
  ${print(AppleProvisioningProfileFragmentNode)}
`;
