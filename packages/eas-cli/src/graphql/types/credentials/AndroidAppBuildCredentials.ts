import { print } from 'graphql';
import gql from 'graphql-tag';

import { AndroidKeystoreFragmentNode } from './AndroidKeystore';

export const AndroidAppBuildCredentialsFragmentNode = gql`
  fragment AndroidAppBuildCredentialsFragment on AndroidAppBuildCredentials {
    id
    isDefault
    isLegacy
    name
    androidKeystore {
      id
      ...AndroidKeystoreFragment
    }
  }
  ${print(AndroidKeystoreFragmentNode)}
`;
