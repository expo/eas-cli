import gql from 'graphql-tag';

import { AppStoreConnectApiKeyFragmentNode } from './AppStoreConnectApiKey';
import { AppleAppIdentifierFragmentNode } from './AppleAppIdentifier';
import { ApplePushKeyFragmentNode } from './ApplePushKey';
import { AppleTeamFragmentNode } from './AppleTeam';
import { IosAppBuildCredentialsFragmentNode } from './IosAppBuildCredentials';
import { AppFragmentNode } from '../App';

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
    appStoreConnectApiKeyForSubmissions {
      id
      ...AppStoreConnectApiKeyFragment
    }
  }
  ${AppFragmentNode}
  ${AppleTeamFragmentNode}
  ${AppleAppIdentifierFragmentNode}
  ${ApplePushKeyFragmentNode}
  ${AppStoreConnectApiKeyFragmentNode}
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
