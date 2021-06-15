import gql from 'graphql-tag';

import { AppFragmentNode } from '../App';
import { AppleAppIdentifierFragmentNode } from './AppleAppIdentifier';
import { ApplePushKeyFragmentNode } from './ApplePushKey';
import { AppleTeamFragmentNode } from './AppleTeam';
import { IosAppBuildCredentialsFragmentNode } from './IosAppBuildCredentials';

export const IosAppCredentialsFragmentNode = gql`
  fragment IosAppCredentialsFragment on IosAppCredentials {
    id
  }
`;

export const CommonIosAppCredentialsFragmentNode = gql`
  fragment CommonIosAppCredentialsFragment on IosAppCredentials {
    id
    app {
      id
      ...AppFragment
    }
    appleTeam {
      id
      ...AppleTeamFragment
    }
    appleAppIdentifier {
      id
      ...AppleAppIdentifierFragment
    }
    pushKey {
      id
      ...ApplePushKeyFragment
    }
    iosAppBuildCredentialsList {
      id
      ...IosAppBuildCredentialsFragment
    }
  }
  ${AppFragmentNode}
  ${AppleTeamFragmentNode}
  ${AppleAppIdentifierFragmentNode}
  ${ApplePushKeyFragmentNode}
  ${IosAppBuildCredentialsFragmentNode}
`;
