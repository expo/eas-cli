import { Fragment } from '../../fragment';

export const AppleAppIdentifierFragment: Fragment = {
  name: 'appleAppIdentifier',
  definition: `
    fragment appleAppIdentifier on AppleAppIdentifier {
      id
      bundleIdentifier
    }
  `,
};
