import { Fragment } from '../../fragment';

export interface AppleAppIdentifier {
  id: string;
  bundleIdentifier: string;
}

export const AppleAppIdentifierFragment: Fragment = {
  name: 'appleAppIdentifier',
  definition: `
    fragment appleAppIdentifier on AppleAppIdentifier {
      id
      bundleIdentifier
    }
  `,
};
