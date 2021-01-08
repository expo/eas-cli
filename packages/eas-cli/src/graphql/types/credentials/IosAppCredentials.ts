import gql from 'graphql-tag';

import { Fragment } from '../../fragment';

export const IosAppCredentialsFragment: Fragment = {
  name: 'iosAppCredentials',
  definition: gql`
    fragment iosAppCredentials on IosAppCredentials {
      id
    }
  `,
};
