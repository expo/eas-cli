import gql from 'graphql-tag';

import { Fragment } from '../../fragment';

export const AppleDistributionCertificateFragment: Fragment = {
  name: 'appleDistCert',
  definition: gql`
    fragment appleDistCert on AppleDistributionCertificate {
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
  `,
};
