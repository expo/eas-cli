import { print } from 'graphql';
import gql from 'graphql-tag';

import { AppleTeamFragmentNode } from './AppleTeam';

export const AppStoreConnectApiKeyFragmentNode = gql`
  fragment AppStoreConnectApiKeyFragment on AppStoreConnectApiKey {
    id
    appleTeam {
      id
      ...AppleTeamFragment
    }
    issuerIdentifier
    keyIdentifier
    name
    roles
    createdAt
    updatedAt
  }
  ${print(AppleTeamFragmentNode)}
`;
