import { Fragment } from '../../fragment';
import { AppleDevice } from './AppleDevice';
import { AppleDistributionCertificate } from './AppleDistributionCertificate';
import { AppleProvisioningProfile } from './AppleProvisioningProfile';

export enum IosDistributionType {
  APP_STORE = 'APP_STORE',
  ENTERPRISE = 'ENTERPRISE',
  AD_HOC = 'AD_HOC',
  DEVELOPMENT = 'DEVELOPMENT',
}

export interface IosAppBuildCredentials {
  id: string;
  distributionCertificate?: AppleDistributionCertificate;
  provisioningProfile?: AppleProvisioningProfile;
  iosDistributionType: IosDistributionType;
  appleDevices: AppleDevice[];
}

export const IosAppBuildCredentialsFragment: Fragment = {
  name: 'iosAppBuildCredentials',
  definition: `
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
