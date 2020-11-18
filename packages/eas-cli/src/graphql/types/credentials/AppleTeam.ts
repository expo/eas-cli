import { Fragment } from '../../fragment';
import { AppleAppIdentifier } from './AppleAppIdentifier';
import { AppleDevice } from './AppleDevice';
import { AppleDistributionCertificate } from './AppleDistributionCertificate';

export interface AppleTeam {
  id: string;
  appleTeamIdentifier: string;
  appleTeamName?: string;
  appleAppIdentifiers?: AppleAppIdentifier[];
  appleDistributionCertificates?: AppleDistributionCertificate[];
  appleDevices?: AppleDevice[];
}

export const AppleTeamFragment: Fragment = {
  name: 'appleTeam',
  definition: `
    fragment appleTeam on AppleTeam {
      id
      appleTeamIdentifier
      appleTeamName
    }
  `,
};
