import { gql } from 'graphql-tag';

import { AppFragmentNode } from '../App.js';
import { AndroidAppBuildCredentialsFragmentNode } from './AndroidAppBuildCredentials.js';
import { AndroidFcmFragmentNode } from './AndroidFcm.js';
import { GoogleServiceAccountKeyFragmentNode } from './GoogleServiceAccountKey.js';

export const CommonAndroidAppCredentialsFragmentNode = gql`
  fragment CommonAndroidAppCredentialsFragment on AndroidAppCredentials {
    id
    applicationIdentifier
    isLegacy
    app {
      id
      ...AppFragment
    }
    androidFcm {
      id
      ...AndroidFcmFragment
    }
    googleServiceAccountKeyForSubmissions {
      id
      ...GoogleServiceAccountKeyFragment
    }
    androidAppBuildCredentialsList {
      id
      ...AndroidAppBuildCredentialsFragment
    }
  }
  ${AppFragmentNode}
  ${AndroidFcmFragmentNode}
  ${GoogleServiceAccountKeyFragmentNode}
  ${AndroidAppBuildCredentialsFragmentNode}
`;
