import gql from 'graphql-tag';

import { AndroidAppBuildCredentialsFragmentNode } from './AndroidAppBuildCredentials';
import { AndroidFcmFragmentNode } from './AndroidFcm';
import { GoogleServiceAccountKeyFragmentNode } from './GoogleServiceAccountKey';
import { AppFragmentNode } from '../App';

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
