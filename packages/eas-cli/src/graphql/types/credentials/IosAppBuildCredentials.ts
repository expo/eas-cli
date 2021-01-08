import gql from 'graphql-tag';

import { Fragment } from '../../fragment';

export const IosAppBuildCredentialsFragment: Fragment = {
  name: 'iosAppBuildCredentials',
  definition: gql`
    fragment iosAppBuildCredentials on IosAppBuildCredentials {
      id
      iosDistributionType
      distributionCertificate {
        id
        certificateP12
        certificatePassword
        serialNumber
        developerPortalIdentifier
        validityNotBefore
        validityNotAfter
        appleTeam {
          id
          appleTeamIdentifier
          appleTeamName
        }
      }
      provisioningProfile {
        id
        expiration
        developerPortalIdentifier
        provisioningProfile
        appleDevices {
          id
          identifier
          name
          model
          deviceClass
        }
        appleTeam {
          id
          appleTeamIdentifier
          appleTeamName
        }
      }
      appleDevices {
        id
        identifier
        name
        model
        deviceClass
        appleTeam {
          id
          appleTeamIdentifier
          appleTeamName
        }
      }
    }
  `,
};
