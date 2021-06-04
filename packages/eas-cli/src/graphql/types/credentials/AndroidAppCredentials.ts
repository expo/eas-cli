import gql from 'graphql-tag';

import { AppFragmentNode } from '../App';
import { AndroidAppBuildCredentialsFragmentNode } from './AndroidAppBuildCredentials';
import { AndroidFcmFragmentNode } from './AndroidFcm';

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
    androidAppBuildCredentialsList {
      id
      ...AndroidAppBuildCredentialsFragment
    }
  }
  ${AppFragmentNode}
  ${AndroidFcmFragmentNode}
  ${AndroidAppBuildCredentialsFragmentNode}
`;
