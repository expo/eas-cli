import { gql } from 'graphql-tag';

import { AppFragmentNode } from '../App.js';
import { AppStoreConnectApiKeyFragmentNode } from './AppStoreConnectApiKey.js';
import { AppleAppIdentifierFragmentNode } from './AppleAppIdentifier.js';
import { ApplePushKeyFragmentNode } from './ApplePushKey.js';
import { AppleTeamFragmentNode } from './AppleTeam.js';
import { IosAppBuildCredentialsFragmentNode } from './IosAppBuildCredentials.js';

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
