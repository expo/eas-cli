import gql from 'graphql-tag';

import { AppFragmentNode } from '../App';
import { AndroidAppBuildCredentialsFragmentNode } from './AndroidAppBuildCredentials';

export const CommonAndroidAppCredentialsFragmentNode = gql`
  fragment CommonAndroidAppCredentialsFragment on AndroidAppCredentials {
    id
    applicationIdentifier
    isLegacy
    app {
      id
      ...AppFragment
    }
    androidAppBuildCredentialsList {
      id
      ...AndroidAppBuildCredentialsFragment
    }
  }
  ${AppFragmentNode}
  ${AndroidAppBuildCredentialsFragmentNode}
`;
