import gql from 'graphql-tag';

import { Fragment } from '../../fragment';

export const AppleTeamFragment: Fragment = {
  name: 'appleTeam',
  definition: gql`
    fragment appleTeam on AppleTeam {
      id
      appleTeamIdentifier
      appleTeamName
    }
  `,
};
