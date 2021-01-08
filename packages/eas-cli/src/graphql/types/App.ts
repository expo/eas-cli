import gql from 'graphql-tag';

import { Fragment } from '../fragment';

export const AppFragment: Fragment = {
  name: 'app',
  definition: gql`
    fragment app on App {
      id
    }
  `,
};
