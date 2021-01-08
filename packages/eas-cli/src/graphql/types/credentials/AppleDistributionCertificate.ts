import { Fragment } from '../../fragment';

export const AppleDistributionCertificateFragment: Fragment = {
  name: 'appleDistCert',
  definition: /* GraphQL*/ `
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
