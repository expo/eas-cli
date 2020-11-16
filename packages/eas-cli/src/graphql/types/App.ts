import { Fragment } from '../fragment';
import { IosAppCredentials } from './credentials/IosAppCredentials';

export interface App {
  id: string;
  iosAppCredentials: IosAppCredentials[];
}

export const AppFragment: Fragment = {
  name: 'app',
  definition: `
    fragment app on App {
      id
    }
  `,
};
