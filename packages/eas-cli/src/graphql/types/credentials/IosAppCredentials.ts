import { Fragment } from '../../fragment';
import { AppleAppIdentifier } from './AppleAppIdentifier';
import { AppleTeam } from './AppleTeam';
import { IosAppBuildCredentials } from './IosAppBuildCredentials';

export interface IosAppCredentials {
  id: string;
  appleTeam?: AppleTeam;
  appleAppIdentifier: AppleAppIdentifier;
  iosAppBuildCredentialsArray?: IosAppBuildCredentials[];
}

export const IosAppCredentialsFragment: Fragment = {
  name: 'iosAppCredentials',
  definition: `
    fragment iosAppCredentials on IosAppCredentials {
      id
    }
  `,
};
