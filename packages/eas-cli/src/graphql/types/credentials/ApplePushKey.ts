import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { AppFragmentNode } from '../App.js';
import { AppleAppIdentifierFragmentNode } from './AppleAppIdentifier.js';
import { AppleTeamFragmentNode } from './AppleTeam.js';

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
