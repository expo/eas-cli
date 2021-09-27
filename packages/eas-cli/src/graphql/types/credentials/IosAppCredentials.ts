import gql from 'graphql-tag';

import { AppFragmentNode } from '../App';
import { AppleAppIdentifierFragmentNode } from './AppleAppIdentifier';
import { ApplePushKeyFragmentNode } from './ApplePushKey';
import { AppleTeamFragmentNode } from './AppleTeam';
import { IosAppBuildCredentialsFragmentNode } from './IosAppBuildCredentials';

export const CommonIosAppCredentialsWithoutBuildCredentialsFragmentNode = gql`
  fragment CommonIosAppCredentialsWithoutBuildCredentialsFragment on IosAppCredentials {
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
  }
  ${AppFragmentNode}
  ${AppleTeamFragmentNode}
  ${AppleAppIdentifierFragmentNode}
  ${ApplePushKeyFragmentNode}
`;

export const CommonIosAppCredentialsFragmentNode = gql`
  fragment CommonIosAppCredentialsFragment on IosAppCredentials {
    id
    ...CommonIosAppCredentialsWithoutBuildCredentialsFragment
    iosAppBuildCredentialsList {
      id
      ...IosAppBuildCredentialsFragment
    }
  }
  ${CommonIosAppCredentialsWithoutBuildCredentialsFragmentNode}
  ${IosAppBuildCredentialsFragmentNode}
`;
