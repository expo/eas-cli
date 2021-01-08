import { Fragment } from '../../fragment';

export const AppleAppIdentifierFragment: Fragment = {
  name: 'appleAppIdentifier',
  definition: /* GraphQL*/ `
    fragment appleAppIdentifier on AppleAppIdentifier {
      id
      bundleIdentifier
    }
  `,
};
