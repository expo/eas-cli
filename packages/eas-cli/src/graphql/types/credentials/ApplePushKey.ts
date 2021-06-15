import { print } from 'graphql';
import gql from 'graphql-tag';

import { AppleTeamFragmentNode } from './AppleTeam';

export const ApplePushKeyFragmentNode = gql`
  fragment ApplePushKeyFragment on ApplePushKey {
    id
    keyIdentifier
    updatedAt
    appleTeam {
      id
      ...AppleTeamFragment
    }
  }
  ${print(AppleTeamFragmentNode)}
`;
