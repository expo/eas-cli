import { Fragment } from '../../fragment';
import { AppleTeam } from './AppleTeam';

export interface AppleDistributionCertificate {
  id: string;
  certificateP12: string;
  certificatePassword: string;
  serialNumber: string;
  developerPortalIdentifier: string;
  validityNotBefore: Date;
  validityNotAfter: Date;
  appleTeam?: AppleTeam;
}

export const AppleDistributionCertificateFragment: Fragment = {
  name: 'appleDistCert',
  definition: `
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
