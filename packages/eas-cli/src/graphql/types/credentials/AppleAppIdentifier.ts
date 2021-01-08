import gql from 'graphql-tag';

import { Fragment } from '../../fragment';

export const AppleAppIdentifierFragment: Fragment = {
  name: 'appleAppIdentifier',
  definition: gql`
    fragment appleAppIdentifier on AppleAppIdentifier {
      id
      bundleIdentifier
    }
  `,
};
