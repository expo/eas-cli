import { print } from 'graphql';
import gql from 'graphql-tag';

import { AppleAppIdentifierFragmentNode } from './AppleAppIdentifier';
import { AppleTeamFragmentNode } from './AppleTeam';
import { AppFragmentNode } from '../App';

export const ApplePushKeyFragmentNode = gql`
  fragment ApplePushKeyFragment on ApplePushKey {
    id
    keyIdentifier
    updatedAt
    appleTeam {
      id
      ...AppleTeamFragment
    }
    iosAppCredentialsList {
      id
      app {
        id
        ...AppFragment
      }
      appleAppIdentifier {
        id
        ...AppleAppIdentifierFragment
      }
    }
  }
  ${print(AppleTeamFragmentNode)}
  ${print(AppFragmentNode)}
  ${print(AppleAppIdentifierFragmentNode)}
`;
